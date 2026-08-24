"""Baseline 脚本：检测 → 修正 → 重检测，输出 baseline 数字（赛前证据清单第 1 项）

用法：python scripts/baseline.py <wav路径> [start_sec] [end_sec]
输出：修正前/后平均 cents 偏差、单段修正量、处理耗时、产物路径
"""
from __future__ import annotations

import sys
import os
import time
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from analysis import analyze_file
from pitch import render_and_export, correct_pitch, load_audio


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "assets/test_offpitch.wav"
    # 相对仓库根目录解析（backend/scripts/xxx → 仓库根/xxx）
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    path = path if os.path.isabs(path) else os.path.join(repo_root, path)
    path = os.path.abspath(path)
    if not os.path.exists(path):
        print(f"素材不存在: {path}")
        sys.exit(1)

    start = float(sys.argv[2]) if len(sys.argv) > 2 else 0.0
    end = float(sys.argv[3]) if len(sys.argv) > 3 else None

    print("=" * 60)
    print("Baseline：检测 → 修正 → 重检测")
    print(f"素材: {path}")

    # 1. 分析（小节/音高）
    t0 = time.time()
    analysis = analyze_file(path)
    t_analysis = (time.time() - t0) * 1000
    print(f"[1] 分析耗时: {t_analysis:.0f}ms | bars: {len(analysis['bars'])} | "
          f"pitch帧: {len(analysis['pitch'])} | 时长: {analysis['duration_sec']}s")
    for b in analysis["bars"][:6]:
        print(f"    小节{b['index']}: {b['start_sec']:.2f}s ~ {b['end_sec']:.2f}s")

    # 2. 修正 + 重检测（整段）
    end = end or analysis["duration_sec"]
    y, sr = load_audio(path)
    t1 = time.time()
    result = render_and_export(path, {"parameters": {
        "track": "vocals", "start_sec": start, "end_sec": end,
        "mode": "auto", "correction_strength": 0.9,
    }}, out_dir=os.path.join(repo_root, "backend", "output"))
    t_render = (time.time() - t1) * 1000

    print(f"\n[2] 渲染耗时: {t_render:.0f}ms")
    print(f"    修正前平均偏差: {result['before_cents']} cents")
    print(f"    修正后平均偏差: {result['after_cents']} cents")
    print(f"    单段修正量(半音): {result['applied_shifts']}")
    print(f"    产物: {result['output_path']}")
    print(f"[3] 全链路总耗时: {t_analysis + t_render:.0f}ms (目标 ≤60000ms)")

    # 3. 输出 baseline JSON（赛前证据）
    baseline = {
        "date": time.strftime("%Y-%m-%d %H:%M:%S"),
        "file": os.path.basename(path),
        "analysis_ms": round(t_analysis),
        "render_ms": round(t_render),
        "before_cents": result["before_cents"],
        "after_cents": result["after_cents"],
        "applied_shifts": result["applied_shifts"],
        "target_budget_ms": 60000,
        "note": "修正量限制 ±2 半音；强度 0.9",
    }
    out_json = os.path.join(repo_root, "backend", "output", "baseline.json")
    os.makedirs(os.path.dirname(out_json), exist_ok=True)
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(baseline, f, ensure_ascii=False, indent=2)
    print(f"\nbaseline 已保存: {out_json}")


if __name__ == "__main__":
    main()
