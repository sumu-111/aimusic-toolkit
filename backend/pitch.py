"""修音执行层：Phase Vocoder 参数化修正 + 重检测验证

流程：裁切窗口 → pyin 检测 → 逐音符分段 → pitch_shift（Phase Vocoder）逐段修正
     → 合成回原音频 → 重检测 → 输出 before/after 偏差曲线与平均 cents
约束：默认修正量 ±2 半音，超出阈值拒绝执行（绝不静默硬改）
"""
from __future__ import annotations

import os
import time
import numpy as np
import librosa
import soundfile as sf

from analysis import load_audio, detect_pitch, DEFAULT_SR, HOP_LENGTH

MAX_SEMITONES = 2.0          # ±2 半音限制
NOTE_JUMP_ST = 0.5           # 音符分段：音高跳变阈值（半音）
MIN_NOTE_SEC = 0.12          # 最小音符段时长
CROSSFADE_MS = 25            # 拼接交叉淡化，避免爆音


class PitchGuardError(Exception):
    """修正量超出阈值，拒绝执行。"""


# ---------- 音高/音分工具 ----------

def hz_to_semitones(freq: float) -> float:
    """频率 → 以 A4=440Hz 为基准的半音值（可含小数）。"""
    return 69.0 + 12.0 * np.log2(freq / 440.0)


def cents_to_nearest_semitone(f0: np.ndarray) -> np.ndarray:
    """每个有音高帧到最近平均律半音的偏差（cents，可为负）。"""
    st = hz_to_semitones(f0)
    nearest = np.round(st)
    return (st - nearest) * 100.0


def mean_cents_deviation(f0: np.ndarray, voiced: np.ndarray) -> float | None:
    """平均 cents 偏差（绝对值），无有效帧返回 None。"""
    valid = voiced & ~np.isnan(f0)
    if valid.sum() == 0:
        return None
    cents = np.abs(cents_to_nearest_semitone(f0[valid]))
    return float(np.mean(cents))


# ---------- 音符分段 ----------

def segment_notes(f0: np.ndarray, voiced: np.ndarray, times: np.ndarray) -> list[tuple[int, int]]:
    """把音高轨迹切成分段音符。返回 [(start_idx, end_idx)]（含端点）。

    规则：无音高帧中断；音高跳变 >0.5 半音视为新音符；过短片段丢弃。
    """
    segs: list[tuple[int, int]] = []
    start = None
    last_pitch = None
    n = len(f0)
    for i in range(n):
        if voiced[i] and not np.isnan(f0[i]):
            if start is None:
                start = i
                last_pitch = f0[i]
            else:
                jump = abs(hz_to_semitones(f0[i]) - hz_to_semitones(last_pitch))
                if jump > NOTE_JUMP_ST:
                    if i - start >= 1:
                        segs.append((start, i - 1))
                    start = i
                last_pitch = f0[i]
        else:
            if start is not None:
                if i - start >= 1:
                    segs.append((start, i - 1))
                start = None
                last_pitch = None
    if start is not None and start <= n - 1:
        segs.append((start, n - 1))
    # 过滤过短片段
    segs = [s for s in segs if times[s[1]] - times[s[0]] >= MIN_NOTE_SEC]
    return segs


# ---------- 单段修正 ----------

def _crossfade(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """等长拼接，首尾交叉淡化防爆音。"""
    n = min(len(a), len(b))
    if n == 0:
        return np.concatenate([a, b])
    fade = int(min(CROSSFADE_MS / 1000 * DEFAULT_SR, n // 4))
    if fade < 4:
        return np.concatenate([a, b])
    env = np.ones(n)
    env[:fade] = np.linspace(0, 1, fade)
    a2, b2 = a.copy(), b.copy()
    a2[-fade:] *= 1 - env[:fade]
    b2[:fade] *= env[:fade]
    return a2 + b2


def _shift_segment(seg: np.ndarray, sr: int, n_steps: float) -> np.ndarray:
    """对单段做 Phase Vocoder 音高平移，返回等长结果。"""
    if abs(n_steps) < 0.01:
        return seg.copy()
    return librosa.effects.pitch_shift(seg, sr=sr, n_steps=float(n_steps))


# ---------- 主入口 ----------

def _correct_pitch_internal(
    y: np.ndarray,
    sr: int,
    start_sec: float,
    end_sec: float,
    mode: str = "auto",
    scale: str | None = None,
    correction_strength: float = 0.8,
    max_semitones: float = MAX_SEMITONES,
) -> tuple[np.ndarray, dict]:
    """执行修音。返回 (修正后完整音频, 验证结果 dict)。

    mode="auto"：修正到最近平均律半音；mode="scale"：修正到指定音阶内最近音。
    验证结果含 before_cents/after_cents/curve/applied_shifts。
    修正量超阈值抛 PitchGuardError（绝不静默硬改）。
    """
    if correction_strength < 0 or correction_strength > 1:
        raise ValueError("correction_strength 必须在 0-1 之间")

    start_sample = max(0, int(start_sec * sr))
    end_sample = min(len(y), int(end_sec * sr))
    if end_sample <= start_sample:
        raise ValueError("时间范围无效：end_sec 必须大于 start_sec")

    window = y[start_sample:end_sample]
    f0, voiced, probs = detect_pitch(window, sr)
    times = librosa.times_like(f0, sr=sr, hop_length=HOP_LENGTH)

    before_cents = mean_cents_deviation(f0, voiced)
    segs = segment_notes(f0, voiced, times)

    if not segs:
        raise PitchGuardError("未检测到有效音符段，请缩小修正范围或更换素材")

    # 逐段计算目标与修正量
    shifts: list[float] = []
    out_window = window.copy()

    for s, e in segs:
        seg_f0 = f0[s:e + 1]
        seg_voiced = voiced[s:e + 1]
        valid = seg_voiced & ~np.isnan(seg_f0)
        if valid.sum() == 0:
            continue
        median_f = float(np.median(seg_f0[valid]))
        # 置信度守卫：段内平均置信度过低 → 检测不可靠，拒绝执行（对应"检测置信度过低时不执行"）
        mean_conf = float(np.mean(probs[s:e + 1][valid]))
        if mean_conf < 0.5:
            raise PitchGuardError(
                f"第 {len(shifts) + 1} 段平均置信度 {mean_conf:.2f} 过低（<0.5），"
                "检测结果不可靠，拒绝执行：请更换素材或缩小修正范围"
            )
        target_st = round(hz_to_semitones(median_f))          # 最近平均律半音
        if mode == "scale" and scale:
            target_st = _nearest_in_scale(median_f, scale)
        shift = target_st - hz_to_semitones(median_f)
        if abs(shift) > max_semitones:
            raise PitchGuardError(
                f"第 {len(shifts) + 1} 段修正量 {shift:.1f} 半音超过阈值 ±{max_semitones}，"
                "拒绝执行：请调整素材或缩小修正范围"
            )
        shift *= correction_strength                      # 强度缩放
        shifts.append(shift)
        seg_audio = window[s * HOP_LENGTH: min(len(window), (e + 1) * HOP_LENGTH)]
        shifted = _shift_segment(seg_audio, sr, shift)
        out_window[s * HOP_LENGTH: min(len(window), (e + 1) * HOP_LENGTH)] = shifted[:len(seg_audio)]

    # 合成回原音频
    result = y.copy()
    result[start_sample:end_sample] = out_window

    # 重检测验证
    f0_after, voiced_after, _ = detect_pitch(result[start_sample:end_sample], sr)
    after_cents = mean_cents_deviation(f0_after, voiced_after)

    curve = _build_curve(f0, voiced, f0_after, voiced_after, times)

    verify = {
        "before_cents": round(before_cents, 2) if before_cents is not None else None,
        "after_cents": round(after_cents, 2) if after_cents is not None else None,
        "applied_shifts": [round(s, 3) for s in shifts],
        "curve": curve,
    }
    return result, verify


def correct_pitch(
    y: np.ndarray,
    sr: int,
    start_sec: float,
    end_sec: float,
    mode: str = "auto",
    scale: str | None = None,
    correction_strength: float = 0.8,
    max_semitones: float = MAX_SEMITONES,
) -> dict:
    """公开 API：执行修音，只返回验证结果（baseline 脚本用）。"""
    _, verify = _correct_pitch_internal(
        y, sr, start_sec, end_sec,
        mode=mode, scale=scale,
        correction_strength=correction_strength, max_semitones=max_semitones,
    )
    return verify


def correct_pitch_with_audio(
    y: np.ndarray,
    sr: int,
    start_sec: float,
    end_sec: float,
    mode: str = "auto",
    scale: str | None = None,
    correction_strength: float = 0.8,
    max_semitones: float = MAX_SEMITONES,
) -> tuple[np.ndarray, dict]:
    """公开 API：执行修音，返回 (修正后完整音频, 验证结果)。渲染/导出用。"""
    return _correct_pitch_internal(
        y, sr, start_sec, end_sec,
        mode=mode, scale=scale,
        correction_strength=correction_strength, max_semitones=max_semitones,
    )


def _nearest_in_scale(freq: float, scale: str) -> float:
    """音阶内最近音的半音值（MIDI）。scale 为音名如 'C'。"""
    base = librosa.note_to_midi(f"{scale}4") % 12
    st = hz_to_semitones(freq)
    # 大调音阶半音间隔 [0,2,4,5,7,9,11]
    scale_offsets = [0, 2, 4, 5, 7, 9, 11]
    candidates = []
    for octave in range(2, 8):
        for off in scale_offsets:
            candidates.append(octave * 12 + base + off)
    return float(min(candidates, key=lambda c: abs(c - st)))


def _build_curve(f0, voiced, f0_after, voiced_after, times, max_points: int = 80) -> dict:
    """输出修正前后偏差曲线（下采样到 ≤80 点，控制 JSON 体积）。"""
    def curve_of(f, v):
        cents = np.full(len(f), np.nan)
        valid = v & ~np.isnan(f)
        cents[valid] = cents_to_nearest_semitone(f[valid])
        return cents

    before = curve_of(f0, voiced)
    after = curve_of(f0_after, voiced_after)
    n = len(times)
    if n > max_points:
        idx = np.linspace(0, n - 1, max_points, dtype=int)
    else:
        idx = np.arange(n)
    t_out = [round(float(times[i]), 3) for i in idx]
    b_out = [None if np.isnan(before[i]) else round(float(before[i]), 1) for i in idx]
    a_out = [None if np.isnan(after[i]) else round(float(after[i]), 1) for i in idx]
    return {"times": t_out, "before": b_out, "after": a_out}


def render_and_export(
    file_path: str,
    plan: dict,
    out_dir: str = "output",
    sr: int = DEFAULT_SR,
    resample_to: int | None = None,
) -> dict:
    """完整渲染入口：读文件 → 修正 → 合成 → 写 WAV → 返回 render_result。

    plan 兼容两种形态：完整 plan dict（含 parameters）或参数 dict 本身。
    resample_to：指定时先降/升采样到该采样率再处理（16kHz 兜底路径），输出即该采样率 WAV。
    返回 render_result：{output_path, before_cents, after_cents, curve, applied_shifts, render_ms, sr}
    """
    t0 = time.time()
    y, sr = load_audio(file_path, sr)
    out_sr = sr
    if resample_to and resample_to != sr:
        y = librosa.resample(y, orig_sr=sr, target_sr=resample_to)
        sr, out_sr = resample_to, resample_to
    params = plan.get("parameters", plan)
    y_corrected, verify = correct_pitch_with_audio(
        y, sr,
        start_sec=params["start_sec"],
        end_sec=params["end_sec"],
        mode=params.get("mode", "auto"),
        scale=params.get("scale"),
        correction_strength=params.get("correction_strength", 0.8),
    )
    os.makedirs(out_dir, exist_ok=True)
    stem = os.path.splitext(os.path.basename(file_path))[0]
    suffix = f"_sr{out_sr}" if out_sr != DEFAULT_SR else ""
    out_path = os.path.join(out_dir, f"{stem}_corrected{suffix}.wav")
    sf.write(out_path, y_corrected, out_sr)
    verify["output_path"] = out_path
    verify["render_ms"] = int((time.time() - t0) * 1000)
    verify["sr"] = out_sr
    return verify


def verify_wav(file_path: str) -> dict:
    """WAV 产物校验：字节可读、采样率/时长、无 NaN/Inf。返回校验报告。"""
    import soundfile as _sf
    info = _sf.info(file_path)
    data, sr = _sf.read(file_path, always_2d=False)
    bad = int(np.isnan(data).sum() + np.isinf(data).sum())
    return {
        "ok": bad == 0 and info.frames > 0,
        "frames": int(info.frames),
        "sr": int(sr),
        "duration_sec": round(info.frames / sr, 3),
        "channels": int(info.channels),
        "nan_or_inf_samples": bad,
    }


if __name__ == "__main__":
    import sys, json
    path = sys.argv[1] if len(sys.argv) > 1 else "../assets/test_offpitch.wav"
    y, sr = load_audio(path)
    dur = len(y) / sr
    res = correct_pitch(y, sr, 0.0, dur, mode="auto", correction_strength=0.9)
    print(json.dumps(res, ensure_ascii=False, indent=2))
