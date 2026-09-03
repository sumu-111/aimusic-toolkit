"""音乐分析层：小节定位 + 音高轨迹 + 结构分段

契约对齐：analysis_result = {
  bars:[{index,start_sec,end_sec}],
  pitch:[{t,pitch,confidence}],
  sections:[{label,label_cn,start_sec,end_sec,bar_start,bar_end,energy}],  # B3 结构分段
  duration_sec, sr,
}
- 小节定位：librosa beat.beat_track + onset 估算边界，按 4/4 拍每 4 拍为 1 小节
- 音高轨迹：librosa pyin 帧级音高（hop≈20ms）与置信度
- 结构分段：按小节 RMS 能量粗分 前奏/主歌/副歌/尾声（供"副歌/高潮"语义定位换算秒数）
- 定位失败降级：整段视为 1 个小节，供 Agent 降级为"整段修音"
"""
from __future__ import annotations

import os
import numpy as np
import librosa

DEFAULT_SR = 44100
HOP_LENGTH = 882          # 20ms @44.1kHz
FMIN = librosa.note_to_hz("C2")   # 65.4 Hz
FMAX = librosa.note_to_hz("C6")   # 1046.5 Hz
BEATS_PER_BAR = 4         # 默认 4/4


def load_audio(file_path: str, sr: int = DEFAULT_SR) -> tuple[np.ndarray, int]:
    y, sr = librosa.load(file_path, sr=sr, mono=True)
    return y, sr


def _estimate_bpm(y: np.ndarray, sr: int) -> float | None:
    """从 onset 能量自相关粗估 BPM（40~200）。无节奏感（纯持续音）返回 None。

    在 beat_track 锁不住拍（无人声伴奏、纯人声）时兜底使用。
    """
    try:
        oenv = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP_LENGTH)
        # 无节奏门限：onset 峰太少（纯持续音/静音）视为无节奏
        if oenv.size < 8:
            return None
        thr = float(np.mean(oenv)) + 2.0 * float(np.std(oenv))
        if int(np.sum(oenv > thr)) < 3:
            return None
        oenv = oenv - float(np.mean(oenv))
        ac = librosa.autocorrelate(oenv)
        sr_hz = sr / HOP_LENGTH  # onset 帧率
        best_bpm, best_score = None, -1.0
        for bpm in range(40, 201):
            lag = sr_hz * 60.0 / bpm
            i0 = max(1, int(round(lag)) - 1)
            i1 = min(ac.size - 1, int(round(lag)) + 2)
            if i1 > i0:
                score = float(np.max(ac[i0:i1]))
                if score > best_score:
                    best_score, best_bpm = score, bpm
        # 弱节奏门限：主峰显著高于滞后旁瓣典型值，否则视为无节奏
        noise = float(np.median(np.abs(ac[1:])))
        if best_score < noise * 3 + 1e-9:
            return None
        return best_bpm
    except Exception:
        return None


def detect_bars(y: np.ndarray, sr: int, beats_per_bar: int = BEATS_PER_BAR) -> list[dict]:
    """估算小节边界，输出 bars 列表。失败降级为整段 1 小节。"""
    duration = len(y) / sr
    try:
        tempo, beat_frames = librosa.beat.beat_track(
            y=y, sr=sr, hop_length=HOP_LENGTH, trim=False
        )
        beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=HOP_LENGTH)
        if len(beat_times) < beats_per_bar + 1:
            raise ValueError("beat 数量不足")
        bars = []
        for i in range(0, len(beat_times) - 1, beats_per_bar):
            start = float(beat_times[i])
            end_idx = min(i + beats_per_bar, len(beat_times) - 1)
            end = float(beat_times[end_idx])
            bars.append({"index": len(bars) + 1,
                         "start_sec": round(start, 3),
                         "end_sec": round(min(end, duration), 3)})
        if bars and bars[-1]["end_sec"] - bars[-1]["start_sec"] < 0.05:
            bars[-1]["end_sec"] = round(duration, 3)
        return bars
    except Exception:
        # 兜底：onset 节奏自相关估 BPM → 均匀小节（无打击乐人声可用）；
        # 仍失败（纯持续音等）→ 整段视为 1 小节
        bpm = _estimate_bpm(y, sr)
        if not bpm:
            return [{"index": 1, "start_sec": 0.0, "end_sec": round(duration, 3)}]
        bar_sec = 60.0 / bpm * beats_per_bar
        n = max(2, int(duration / bar_sec))
        bars = []
        for i in range(n):
            start = i * bar_sec
            end = min((i + 1) * bar_sec, duration)
            if end - start < 0.05:
                continue
            bars.append({"index": len(bars) + 1,
                         "start_sec": round(start, 3),
                         "end_sec": round(end, 3)})
        return bars


def detect_pitch(y: np.ndarray, sr: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """pyin 帧级音高。返回 (f0, voiced_flag, voiced_probs)，无音高帧 f0=nan。"""
    f0, voiced_flag, voiced_probs = librosa.pyin(
        y, fmin=FMIN, fmax=FMAX, sr=sr, hop_length=HOP_LENGTH
    )
    return f0, voiced_flag, voiced_probs


def detect_pitch_track(y: np.ndarray, sr: int) -> list[dict]:
    """输出 pitch 数组 [{t, pitch, confidence}]，pitch 为 None 表示无音高帧。"""
    f0, _, probs = detect_pitch(y, sr)
    times = librosa.times_like(f0, sr=sr, hop_length=HOP_LENGTH)
    out = []
    for t, f, c in zip(times, f0, probs):
        out.append({
            "t": round(float(t), 3),
            "pitch": None if np.isnan(f) else round(float(f), 2),
            "confidence": round(float(c), 3),
        })
    return out


def detect_sections(y: np.ndarray, sr: int, bars: list[dict]) -> list[dict]:
    """按小节 RMS 能量粗分结构（前奏/主歌/副歌/尾声），B3 结构分段。

    方法（demo 级、确定性、无监督、单遍）：
    1) 每小节 RMS 能量 e；med=中位数，hi=med+0.75*(max-med)；
    2) 首尾"显著低于中位数"(e<0.6*med) 的连续小节 → intro / outro（各限 ~1/3 曲长）；
    3) 中间 e>=0.92*hi 的小节 → chorus，其余 verse；连续同类合并为段；
    4) 被单个主歌小节隔开的两个副歌段合并（抗小节能量凹陷）；
       仅 1 小节的孤立 chorus 尖峰降回 verse；全部降级时保留峰值段兜底。
    无足够结构（bars<3 / 几乎静音 / 无能量起伏）→ 返回 []，调用方整首兜底。
    """
    if not bars or len(bars) < 3:
        return []
    rms = []
    for b in bars:
        s = int(round(float(b["start_sec"]) * sr))
        e = int(round(float(b["end_sec"]) * sr))
        seg = y[max(0, s):e]
        rms.append(float(np.sqrt(np.mean(seg ** 2))) if seg.size else 0.0)
    e = np.asarray(rms, dtype=float)
    mx = float(e.max()) if e.size else 0.0
    med = float(np.median(e)) if e.size else 0.0
    # 几乎静音 或 动态范围不足（峰值仅比中位高 ~15%，持续音/平能量）→ 无结构
    if mx <= 1e-9 or mx <= med * 1.15:
        return []
    hi = med + 0.75 * (mx - med)
    if hi - med < 1e-9:
        return []

    n = int(e.size)
    cap = max(1, n // 3 + 1)
    # 首尾安静区：显著低于中位数才算"前奏/尾声"（防把低声部主歌误判成前奏）
    p = 0
    while p < n and p < cap and float(e[p]) < 0.6 * med:
        p += 1
    s = 0
    while s < n and s < cap and float(e[n - 1 - s]) < 0.6 * med:
        s += 1
    if p + s >= n:  # 全曲都过于安静（异常）→ 退化为无结构
        return []

    # 中间按能量标 chorus/verse（0.92 余量：吸收小节边界微差）
    labels = []
    for i in range(n):
        if i < p:
            labels.append("intro")
        elif i >= n - s:
            labels.append("outro")
        elif float(e[i]) >= 0.92 * hi:
            labels.append("chorus")
        else:
            labels.append("verse")

    # 连续同类合并 → 段
    runs: list[list] = []  # [start_idx, end_idx(含), label]
    for i, lab in enumerate(labels):
        if runs and runs[-1][2] == lab:
            runs[-1][1] = i
        else:
            runs.append([i, i, lab])
    # 被单个主歌小节隔开的两个副歌段 → 合并（把凹陷小节并入左侧副歌）
    changed = True
    while changed:
        changed = False
        for i in range(1, len(runs) - 1):
            if (runs[i][2] == "verse" and runs[i][1] - runs[i][0] == 0
                    and runs[i - 1][2] == "chorus" and runs[i + 1][2] == "chorus"):
                runs[i - 1][1] = runs[i + 1][1]
                del runs[i:i + 2]
                changed = True
                break
    # 孤立 1 小节 chorus 尖峰 → 降回 verse
    runs = [r for r in runs if not (r[2] == "chorus" and r[1] - r[0] < 1)]
    # 全部 chorus 被降级 → 保留能量峰值所在段为副歌兜底
    if not any(r[2] == "chorus" for r in runs):
        peak_i = int(np.argmax(e))
        for r in runs:
            if r[0] <= peak_i <= r[1]:
                r[2] = "chorus"
                break

    cn = {"intro": "前奏", "verse": "主歌", "chorus": "副歌", "outro": "尾声"}
    out = []
    for lo_i, hi_i, lab in runs:
        b0, b1 = bars[lo_i], bars[hi_i]
        out.append({
            "label": lab,
            "label_cn": cn[lab],
            "start_sec": round(float(b0["start_sec"]), 3),
            "end_sec": round(float(b1["end_sec"]), 3),
            "bar_start": int(b0["index"]),
            "bar_end": int(b1["index"]),
            "energy": round(float(np.mean(e[lo_i:hi_i + 1])), 4),
        })
    return out


def analyze_file(file_path: str, sr: int = DEFAULT_SR) -> dict:
    """完整分析入口：返回 analysis_result。"""
    y, sr = load_audio(file_path, sr)
    bars = detect_bars(y, sr)
    pitch = detect_pitch_track(y, sr)
    return {
        "bars": bars,
        "pitch": pitch,
        "sections": detect_sections(y, sr, bars),
        "duration_sec": round(len(y) / sr, 3),
        "sr": sr,
    }


# 简单结果缓存：同文件（mtime 未变）不重复分析，demo 重复请求秒回
_cache: dict[tuple, dict] = {}


def analyze_file_cached(file_path: str, sr: int = DEFAULT_SR) -> dict:
    """带缓存的 analyze_file。key=(路径, mtime, 文件大小)，文件变更自动失效。"""
    st = os.stat(file_path)
    key = (file_path, st.st_mtime, st.st_size)
    if key in _cache:
        return _cache[key]
    result = analyze_file(file_path, sr)
    _cache[key] = result
    return result


if __name__ == "__main__":
    import json
    import sys
    path = sys.argv[1] if len(sys.argv) > 1 else "../assets/test_offpitch.wav"
    res = analyze_file(path)
    print(json.dumps(res, ensure_ascii=False, indent=2)[:2500])
    print(f"\nbars 数量: {len(res['bars'])}, pitch 帧数: {len(res['pitch'])}, "
          f"sections: {[(s['label'], s['start_sec'], s['end_sec']) for s in res.get('sections', [])]}, "
          f"时长: {res['duration_sec']}s")
