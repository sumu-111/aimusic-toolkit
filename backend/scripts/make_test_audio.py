"""生成合成测试 WAV：跑调人声模拟（谐波丰富音色，便于 pyin 检测）

用法：python scripts/make_test_audio.py [输出路径] [重复次数] [profile]
  profile: light（轻微跑调 ±15~45 cents，默认）/ heavy（较重跑调 ±55~90 cents）
"""
from __future__ import annotations

import sys
import os
import numpy as np
import soundfile as sf

SR = 44100

# 旋律：A3, C4, E4, G4, E4, C4（每音 2.5s，含 0.3s 间隔）
MELODY_FREQS = [220.00, 261.63, 329.63, 392.00, 329.63, 261.63]
NOTE_DUR, GAP = 2.5, 0.3

# 跑调档位：light=轻微（接近真实轻微跑调），heavy=较重（接近半音边界但不越界）
PROFILES = {
    "light": [35, -25, 45, -30, 20, -15],     # 平均 |cents|≈28
    "heavy": [85, -65, 90, -75, 55, -60],     # 平均 |cents|≈72，仍 <100 不跨半音
}


def gen_tone(freq: float, dur: float, cents: float, sr: int = SR) -> np.ndarray:
    """谐波丰富的音色（基频 + 2/3 次谐波 + 居中颤音），模拟人声元音。

    颤音用标准 FM：瞬时频率 f*(1 + depth*sin(2π*rate*t))，音高始终围绕 freq 振荡。
    """
    t = np.linspace(0, dur, int(sr * dur), endpoint=False)
    f = freq * 2 ** (cents / 1200.0)
    depth, rate = 0.003, 5.0            # ±3 cents @5Hz 颤音，居中
    # phase = 2π f [t - depth/(2π rate) * cos(2π rate t)]，保证平均频率 = f
    phase = 2 * np.pi * f * (t - depth / (2 * np.pi * rate) * np.cos(2 * np.pi * rate * t))
    sig = np.sin(phase)
    sig += 0.35 * np.sin(2 * phase)      # 二次谐波
    sig += 0.15 * np.sin(3 * phase)      # 三次谐波
    # 音量包络（起音/收音，避免爆音）
    n = len(sig)
    env = np.ones(n)
    a = int(0.02 * sr)
    r = int(0.05 * sr)
    env[:a] = np.linspace(0, 1, a)
    env[-r:] = np.linspace(1, 0, r)
    return 0.5 * sig * env


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "assets/test_offpitch.wav"
    repeat = int(sys.argv[2]) if len(sys.argv) > 2 else 1  # 重复次数，凑 30s 素材
    profile = sys.argv[3] if len(sys.argv) > 3 else "light"
    cents_list = PROFILES.get(profile, PROFILES["light"])
    # 相对仓库根目录解析（仓库根/xxx）
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    out = out if os.path.isabs(out) else os.path.join(repo_root, out)
    out = os.path.abspath(out)
    os.makedirs(os.path.dirname(out), exist_ok=True)

    chunks = []
    for _ in range(repeat):
        for freq, cents in zip(MELODY_FREQS, cents_list):
            chunks.append(gen_tone(freq, NOTE_DUR, cents))
            if GAP > 0:
                chunks.append(np.zeros(int(SR * GAP)))
    audio = np.concatenate(chunks)
    sf.write(out, audio, SR)
    print(f"已生成: {out}  时长: {len(audio)/SR:.1f}s  采样率: {SR}Hz  档位: {profile} "
          f"(|cents| 均值≈{sum(abs(c) for c in cents_list)//len(cents_list)})")


if __name__ == "__main__":
    main()
