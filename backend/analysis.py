"""音乐分析层：小节定位 + 音高轨迹

契约对齐：analysis_result = {bars:[{index,start_sec,end_sec}], pitch:[{t,pitch,confidence}]}
- 小节定位：librosa beat.beat_track + onset 估算边界，按 4/4 拍每 4 拍为 1 小节
- 音高轨迹：librosa pyin 帧级音高（hop≈20ms）与置信度
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
        # 降级：整段视为 1 小节
        return [{"index": 1, "start_sec": 0.0, "end_sec": round(duration, 3)}]


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


def analyze_file(file_path: str, sr: int = DEFAULT_SR) -> dict:
    """完整分析入口：返回 analysis_result。"""
    y, sr = load_audio(file_path, sr)
    bars = detect_bars(y, sr)
    pitch = detect_pitch_track(y, sr)
    return {
        "bars": bars,
        "pitch": pitch,
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
    print(json.dumps(res, ensure_ascii=False, indent=2)[:2000])
    print(f"\nbars 数量: {len(res['bars'])}, pitch 帧数: {len(res['pitch'])}, 时长: {res['duration_sec']}s")
