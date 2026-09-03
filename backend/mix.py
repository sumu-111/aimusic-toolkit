"""SFX 混音渲染层：mixdown = mix(stem, clips)（确定性、幂等）

契约（任务书 §2.2 / §2.3）：
  POST /execute_plan { plan_id, parameters: { op: "mix", clips: [SfxClip...] }, file_path }
  → 输出 mixdown_<ts>.wav + 每条 clip 分离轨 sfx_<clip_id>.wav

SfxClip 字段（与前端 contract.ts 对齐）：
  clip_id / sfx_id / name / start_sec(绝对秒) / end_sec?(绝对秒)
  loop? / gain_db(默认 -12) / fade_in_ms(默认 200) / fade_out_ms(默认 500)
  locate? / from_text?(仅供展示与追溯)

区间语义：
  - start_sec = 素材在 stem 时间轴上的**绝对起点**（与分析层其它 op 一致，禁止 AI 造秒数）
  - end_sec 缺省 → 素材按原长播完（到 stem 末尾截断）
  - end_sec - start_sec <= 素材原长 → 截取前段（用户缩短时长）
  - end_sec - start_sec > 素材原长 且 loop=true → 循环铺满（接缝 8ms 交叉淡化）
  - 超出原长且 loop 缺省/false → 仍按素材原长（单发素材不强行拉长）

安全与确定性：
  - 素材必须命中库内真实 sfx_id（sfx.resolve_asset_file），失败抛 MixError 附可选项
  - 线性淡入/淡出防边界爆音；循环接缝交叉淡化；叠加越界整体限幅（不破音）
  - 相同输入恒同波形（文件名带时间戳仅用于区分产物）
"""
from __future__ import annotations

import os
import re
import time
import numpy as np
import librosa
import soundfile as sf

from analysis import DEFAULT_SR
from sfx import resolve_asset_file

LOOP_XFADE_MS = 8          # 循环接缝交叉淡化时长
CLIP_ID_FS = re.compile(r"[^A-Za-z0-9_-]+")


class MixError(Exception):
    """混音参数/素材错误（业务 400）。"""


def _sfx_filename(clip_id: str) -> str:
    return f"sfx_{CLIP_ID_FS.sub('_', clip_id or 'clip')}.wav"


def _loop_to_overlap(asset: np.ndarray, n_target: int, sr: int, fade: int) -> np.ndarray:
    """显式重叠相加的循环拼接：每段 prev 尾 X 样本与下一 asset 头 X 样本线性交叉淡化。

    注意：仅当 take > fade 时做重叠（保证每次迭代净增长 > 0），
    否则整段拼接后由末尾截断，避免剩余恰好等于 fade 时死循环。
    """
    out = asset.copy()
    a_len = len(asset)
    while len(out) < n_target:
        remain = n_target - len(out)
        take = min(remain, a_len)
        if fade > 0 and take > fade and len(out) >= fade:
            ramp = np.linspace(0, 1, fade)
            seg = out[-fade:] * (1 - ramp) + asset[:fade] * ramp
            out[-fade:] = seg
            out = np.concatenate([out, asset[fade:take]])
        else:
            out = np.concatenate([out, asset[:take]])
    return out[:n_target]


def _build_content(asset: np.ndarray, sr: int, clip: dict, stem_len: int) -> np.ndarray:
    """按 clip 区间语义生成最终内容（已应用增益与淡入/淡出）。

    返回内容信号（float），用于叠加进 mix bus 并另存为分离轨。
    """
    a_len = len(asset)
    start = float(clip.get("start_sec", 0))
    if start < 0:
        raise MixError(f"clip '{clip.get('clip_id')}' start_sec 不能为负: {start}")
    end_abs = clip.get("end_sec")
    loop = bool(clip.get("loop"))
    if end_abs is not None:
        try:
            end_abs = float(end_abs)
        except (TypeError, ValueError):
            raise MixError(f"clip '{clip.get('clip_id')}' end_sec 非法: {end_abs!r}")
        if end_abs <= start:
            raise MixError(
                f"clip '{clip.get('clip_id')}' end_sec({end_abs}) 必须大于 start_sec({start})")

    # 目标时长（秒）
    if end_abs is None:
        target_dur = a_len / sr
    else:
        span = end_abs - start
        target_dur = min(span, a_len / sr) if not loop else span
    n_target = min(int(round(target_dur * sr)), max(0, stem_len - int(round(start * sr))))
    if n_target <= 0:
        raise MixError(
            f"clip '{clip.get('clip_id')}' 起点 {start:.2f}s 已超出音频长度 {stem_len / sr:.2f}s")

    if n_target <= a_len:
        content = asset[:n_target].copy()
    elif loop:
        content = _loop_to_overlap(asset, n_target, sr,
                                   min(int(LOOP_XFADE_MS / 1000 * sr), a_len // 4))
    else:
        content = asset.copy()  # 单发不拉长：到素材原长即止
        n_target = len(content)

    # 增益
    gain_db = float(clip.get("gain_db", -12))
    content = content * float(10 ** (gain_db / 20.0))

    # 淡入/淡出（防边界爆音；淡入后增益开头为 0，先淡后gain等效线性）
    fade_in = max(0, int(float(clip.get("fade_in_ms", 200)) / 1000 * sr))
    fade_out = max(0, int(float(clip.get("fade_out_ms", 500)) / 1000 * sr))
    if fade_in > 0 and len(content) > fade_in:
        content[:fade_in] *= np.linspace(0, 1, fade_in)
    elif fade_in >= len(content) and len(content) > 0:
        content *= np.linspace(0, 1, len(content))  # 片段极短：整体斜坡
    if fade_out > 0 and len(content) > fade_out:
        content[-fade_out:] *= np.linspace(1, 0, fade_out)
    elif fade_out >= len(content) and len(content) > 0:
        content *= np.linspace(1, 0, len(content))
    return content


def _soft_limit(bus: np.ndarray, limit: float = 0.999) -> np.ndarray:
    """防破音：仅当叠加越界时整体按峰值归一（不改变相对电平与静音段）。"""
    peak = float(np.max(np.abs(bus))) if bus.size else 0.0
    if peak > limit:
        bus = bus * (limit / peak)
    return bus


def mix_render(
    stem_path: str,
    clips: list[dict],
    out_dir: str = "output",
    sr: int = DEFAULT_SR,
    resample_to: int | None = None,
) -> dict:
    """mixdown = mix(stem, clips)。返回 render_result。

    clips 为空列表 → mixdown 与原始一致（可逆性：删光 clip 即还原）。
    返回：{op, output_path, clip_tracks:[{clip_id,name,sfx_id,start_sec,end_sec,
            duration_sec,path}], render_ms, sr}
    """
    t0 = time.time()
    if not isinstance(clips, list):
        raise MixError("parameters.clips 必须是数组（可为空）")

    stem, srs = librosa.load(stem_path, sr=sr, mono=True)
    if resample_to and resample_to != srs:
        stem = librosa.resample(stem, orig_sr=srs, target_sr=resample_to)
        sr = resample_to
    stem_len = len(stem)
    os.makedirs(out_dir, exist_ok=True)
    ts = int(time.time() * 1000)

    bus = stem.copy().astype(np.float64)
    clip_tracks: list[dict] = []
    missing: list[str] = []

    for clip in clips:
        if not isinstance(clip, dict):
            raise MixError(f"非法 clip 项: {clip!r}")
        cid = str(clip.get("clip_id") or "")
        sfx_id = str(clip.get("sfx_id") or "")
        if not sfx_id:
            raise MixError(f"clip '{cid}' 缺少 sfx_id")
        asset_path = resolve_asset_file(sfx_id)
        if not asset_path:
            missing.append(sfx_id)
            continue
        asset, _ = librosa.load(asset_path, sr=sr, mono=True)
        content = _build_content(asset, sr, clip, stem_len)
        start_sample = int(round(float(clip.get("start_sec", 0)) * sr))
        n = min(len(content), stem_len - start_sample)
        bus[start_sample:start_sample + n] += content[:n]

        clip_sig = _soft_limit(content[:n])
        clip_path = os.path.join(out_dir, _sfx_filename(cid))
        sf.write(clip_path, (clip_sig * 32767).astype(np.int16), sr,
                 subtype="PCM_16")
        clip_tracks.append({
            "clip_id": cid,
            "name": clip.get("name") or sfx_id,
            "sfx_id": sfx_id,
            "start_sec": round(start_sample / sr, 3),
            "end_sec": round((start_sample + n) / sr, 3),
            "duration_sec": round(n / sr, 3),
            "path": clip_path,
        })

    if missing:
        names = ", ".join(missing[:5])
        raise MixError(f"以下素材不存在于内置/用户库: {names}")

    bus = _soft_limit(bus)
    out_path = os.path.join(out_dir, f"mixdown_{ts}.wav")
    sf.write(out_path, (bus * 32767).astype(np.int16), sr, subtype="PCM_16")

    return {
        "op": "mix",
        "output_path": out_path,
        "clip_tracks": clip_tracks,
        "clip_count": len(clip_tracks),
        "render_ms": int((time.time() - t0) * 1000),
        "sr": sr,
    }


if __name__ == "__main__":
    import json
    import sys
    stem = sys.argv[1] if len(sys.argv) > 1 else "../assets/human_vocal.wav"
    demo = [
        {"clip_id": "c_demo_rain", "sfx_id": "amb_rain_01", "name": "窗边大雨",
         "start_sec": 4.0, "end_sec": 12.0, "gain_db": -10, "from_text": "副歌加雨声"},
        {"clip_id": "c_demo_clap", "sfx_id": "hit_applause_01", "name": "人群掌声欢呼",
         "start_sec": 20.0, "gain_db": -8},
        {"clip_id": "c_demo_loop", "sfx_id": "amb_rain_02", "name": "城市雨声",
         "start_sec": 22.0, "end_sec": 28.0, "loop": True, "gain_db": -14},
    ]
    res = mix_render(stem, demo, out_dir=os.path.join(os.path.dirname(__file__), "output"))
    print(json.dumps(res, ensure_ascii=False, indent=2))
