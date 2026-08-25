"""稳定性走查：连续 5 次全链路 + 错误路径（Day 3 后端验收项，提前做）

用 Flask test_client 走完整 HTTP 栈（不占端口），对素材循环：
  /analyze → /parse_intent → /execute_plan
并覆盖错误路径：文件不存在 / 意图无法解析 / 修音守卫拒绝。
输出：backend/output/stability_report.json + 控制台汇总
"""
from __future__ import annotations

import os
import sys
import time
import json
import shutil
import traceback

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # backend/

from worker import app

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".."))
ASSETS = {
    "light": os.path.join(REPO_ROOT, "assets", "test_offpitch.wav"),
    "heavy": os.path.join(REPO_ROOT, "assets", "demo_heavy_30s.wav"),  # heavy 档（±55~90 cents），覆盖较重跑调
}
ROUNDS = 5
BUDGET_MS = 60000   # 全链路预算


def full_chain(client, file_path: str) -> dict:
    """跑一条完整链路，返回各环节耗时与结果摘要。"""
    t_start = time.time()

    # 1. analyze
    t0 = time.time()
    r = client.post("/analyze", json={"track_id": "t1", "file_path": file_path})
    t_analyze = (time.time() - t0) * 1000
    assert r.status_code == 200, f"analyze 失败 {r.status_code}: {r.data[:200]}"
    analysis = r.get_json()
    assert len(analysis["pitch"]) > 0, "pitch 为空"
    duration = analysis["duration_sec"]

    # 2. parse_intent（整段修音，不依赖小节定位结果）
    t0 = time.time()
    state = {"analysis": analysis}
    r = client.post("/parse_intent", json={"text": "整段修音", "project_state": state})
    t_intent = (time.time() - t0) * 1000
    assert r.status_code == 200, f"parse_intent 失败 {r.status_code}: {r.data[:200]}"
    plan = r.get_json()["plan"]

    # 3. execute_plan
    t0 = time.time()
    params = {**plan, "start_sec": 0.0, "end_sec": duration}
    r = client.post("/execute_plan", json={
        "plan_id": "stability", "file_path": file_path,
        "parameters": params,
    })
    t_render = (time.time() - t0) * 1000
    assert r.status_code == 200, f"execute_plan 失败 {r.status_code}: {r.data[:200]}"
    result = r.get_json()
    assert result["before_cents"] is not None and result["after_cents"] is not None
    assert os.path.exists(result["output_path"]), "产物文件不存在"

    total = (time.time() - t_start) * 1000
    return {
        "ok": True,
        "analyze_ms": round(t_analyze),
        "intent_ms": round(t_intent),
        "render_ms": round(t_render),
        "total_ms": round(total),
        "before_cents": result["before_cents"],
        "after_cents": result["after_cents"],
        "improved": result["after_cents"] < result["before_cents"],
        "output": result["output_path"],
    }


def error_paths(client) -> list[dict]:
    """覆盖错误路径：文件不存在 / 意图无法解析 / 噪声素材守卫。"""
    cases = []
    # 文件不存在
    r = client.post("/analyze", json={"track_id": "x", "file_path": "C:/nope.wav"})
    cases.append({"case": "analyze_file_not_found",
                  "ok": r.status_code == 404 and "error_code" in r.get_json()})
    # 意图无法解析（空指令）
    r = client.post("/parse_intent", json={"text": "", "project_state": {}})
    cases.append({"case": "intent_empty",
                  "ok": r.status_code == 400 and "error_code" in r.get_json()})
    # 意图指向不存在的小节
    state = {"analysis": {"duration_sec": 10, "bars": [{"index": 1, "start_sec": 0, "end_sec": 10}]}}
    r = client.post("/parse_intent", json={"text": "第 9 小节修准", "project_state": state})
    cases.append({"case": "intent_bar_out_of_range",
                  "ok": r.status_code == 400 and "error_code" in r.get_json()})
    # 噪声素材 → 守卫拒绝
    import numpy as np, soundfile as sf
    noise_path = os.path.join(REPO_ROOT, "backend", "output", "_noise_test.wav")
    sf.write(noise_path, np.random.randn(44100 * 2) * 0.1, 44100)
    r = client.post("/execute_plan", json={
        "plan_id": "x", "file_path": noise_path,
        "parameters": {"track": "vocals", "start_sec": 0, "end_sec": 2,
                       "mode": "auto", "correction_strength": 0.8},
    })
    cases.append({"case": "pitch_guard_noise",
                  "ok": r.status_code == 422 and r.get_json()["error_code"] == "PITCH_GUARD"})
    os.remove(noise_path)
    return cases


def main():
    client = app.test_client()
    report = {"date": time.strftime("%Y-%m-%d %H:%M:%S"), "rounds": {}, "error_paths": None}
    all_ok = True

    for name, path in ASSETS.items():
        if not os.path.exists(path):
            print(f"⚠ 素材缺失，跳过: {path}")
            all_ok = False
            continue
        rounds = []
        for i in range(1, ROUNDS + 1):
            try:
                res = full_chain(client, path)
                res["round"] = i
                rounds.append(res)
                status = "✅" if (res["ok"] and res["improved"] and res["total_ms"] <= BUDGET_MS) else "❌"
                print(f"{status} {name} round {i}: 总耗时 {res['total_ms']}ms "
                      f"| {res['before_cents']}→{res['after_cents']} cents")
                if status == "❌":
                    all_ok = False
            except Exception as e:
                rounds.append({"round": i, "ok": False, "error": str(e)})
                print(f"❌ {name} round {i} 异常: {e}")
                traceback.print_exc()
                all_ok = False
        report["rounds"][name] = rounds

    # 错误路径
    errs = error_paths(client)
    report["error_paths"] = errs
    for e in errs:
        mark = "✅" if e["ok"] else "❌"
        print(f"{mark} 错误路径: {e['case']}")
        if not e["ok"]:
            all_ok = False

    report["all_ok"] = all_ok
    out = os.path.join(REPO_ROOT, "backend", "output", "stability_report.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\n{'🎉 全部通过' if all_ok else '⚠ 存在失败项'}"
          f"（预算 {BUDGET_MS}ms）→ 报告: {out}")


if __name__ == "__main__":
    main()
