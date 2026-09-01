"""兜底渲染预生成：赛前把标准 demo 素材渲染好并记录 plan，现场可秒级兜底

用法：python scripts/make_fallback.py [素材路径]
产出：backend/output/fallback/ 下 corrected wav + plan.json + result.json
"""
from __future__ import annotations

import os
import sys
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pitch import render_and_export, verify_wav

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".."))
FALLBACK_DIR = os.path.join(REPO_ROOT, "backend", "output", "fallback")

# 标准兜底计划（与 demo 台词一致：整段修音，强度 0.8）
FALLBACK_PLAN = {
    "op": "correct_pitch",
    "track": "vocals",
    "start_sec": 0.0,
    "end_sec": None,  # 运行时填素材时长
    "mode": "auto",
    "correction_strength": 0.8,
    "source": "fallback_prerender",
}


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "assets/test_offpitch_30s.wav"
    path = path if os.path.isabs(path) else os.path.join(REPO_ROOT, path)
    if not os.path.exists(path):
        print(f"素材不存在: {path}")
        sys.exit(1)

    from analysis import load_audio
    _, sr = load_audio(path)
    plan = dict(FALLBACK_PLAN)
    plan["end_sec"] = round(len(load_audio(path)[0]) / sr, 3)

    os.makedirs(FALLBACK_DIR, exist_ok=True)
    result = render_and_export(path, {"parameters": plan}, out_dir=FALLBACK_DIR)
    result["wav_check"] = verify_wav(result["output_path"])

    with open(os.path.join(FALLBACK_DIR, "plan.json"), "w", encoding="utf-8") as f:
        json.dump(plan, f, ensure_ascii=False, indent=2)
    with open(os.path.join(FALLBACK_DIR, "result.json"), "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2, default=str)

    print(f"✅ 兜底渲染已生成:")
    print(f"  素材: {path} ({plan['end_sec']}s)")
    print(f"  产物: {result['output_path']}")
    print(f"  验证: {result['before_cents']} → {result['after_cents']} cents | "
          f"耗时 {result['render_ms']}ms | wav_check={result['wav_check']['ok']}")
    print(f"  plan/result 已存: {FALLBACK_DIR}/")


if __name__ == "__main__":
    main()
