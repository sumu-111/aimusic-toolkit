"""后端 Worker：IPC 服务端（Flask，本地 localhost）

通道（契约 v1）：
  POST /analyze       {track_id, file_path}          → analysis_result
  POST /parse_intent  {text, project_state}          → plan（LLM→规则模板双通道）
  POST /execute_plan  {plan_id, parameters, file_path} → render_result
  GET  /health        → {status:"ok", version}
错误统一：{error_code, message}
支持 CORS（浏览器版 Plan B 兜底）。
"""
from __future__ import annotations

import os
import sys
import time
import json

from flask import Flask, request, jsonify
from flask_cors import CORS

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from analysis import analyze_file_cached, DEFAULT_SR
from pitch import render_and_export, PitchGuardError, verify_wav
from agent.intent import parse_intent, IntentError, preflight

app = Flask(__name__)
CORS(app)  # 浏览器兜底

OUT_DIR = os.environ.get("RENDER_OUT_DIR", os.path.join(os.path.dirname(__file__), "output"))
os.makedirs(OUT_DIR, exist_ok=True)

RENDER_BUDGET_MS = int(os.environ.get("RENDER_BUDGET_MS", "30000"))  # 渲染预算：超时自动降采样兜底
LOW_SR = 16000  # 兜底采样率

# 内存态：track_id → 资产信息（真实工程保存由 project.json 负责，前端管理）
TRACKS: dict[str, dict] = {}

# plan 持久化文件：worker 重启后历史 plan（含 file_path 关联）仍可执行
PLANS_FILE = os.environ.get("PLANS_FILE", os.path.join(OUT_DIR, "plans.json"))


def _load_plans():
    """启动时从磁盘恢复 plan / file_path 条目。"""
    try:
        if os.path.exists(PLANS_FILE):
            with open(PLANS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            for pid, entry in data.items():
                TRACKS[pid] = entry
            print(f"[worker] plans 恢复 {len(data)} 条", flush=True)
    except Exception as e:
        print(f"[worker] plans 加载失败（忽略）: {e}", flush=True)


def _save_plans():
    """仅持久化轻量字段 plan / file_path（analysis 体积大且渲染前会现读文件，不落盘）。"""
    try:
        plans: dict[str, dict] = {}
        for pid, entry in TRACKS.items():
            out: dict = {}
            if "plan" in entry:
                out["plan"] = entry["plan"]
            if "file_path" in entry:
                out["file_path"] = entry["file_path"]
            if out:
                plans[pid] = out
        with open(PLANS_FILE, "w", encoding="utf-8") as f:
            json.dump(plans, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[worker] plans 保存失败（忽略）: {e}", flush=True)


def err(code: str, message: str, status: int = 400):
    return jsonify({"error_code": code, "message": message}), status


@app.get("/health")
def health():
    return jsonify({"status": "ok", "service": "ai-music-backend", "time": time.time()})


@app.post("/analyze")
def analyze():
    body = request.get_json(silent=True) or {}
    track_id = body.get("track_id")
    file_path = body.get("file_path")
    if not track_id or not file_path:
        return err("INVALID_REQUEST", "缺少 track_id 或 file_path")
    if not os.path.exists(file_path):
        return err("FILE_NOT_FOUND", f"文件不存在: {file_path}", 404)
    try:
        result = analyze_file_cached(file_path)
        TRACKS[track_id] = {"file_path": file_path, "analysis": result}
        _save_plans()
        return jsonify({"track_id": track_id, **result})
    except Exception as e:
        return err("ANALYZE_FAILED", f"分析失败: {e}", 500)


@app.post("/parse_intent")
def parse_intent_endpoint():
    body = request.get_json(silent=True) or {}
    text = body.get("text")
    project_state = body.get("project_state") or {}
    if not text:
        return err("INVALID_REQUEST", "缺少 text")
    try:
        plan = parse_intent(text, project_state)
        plan_id = f"plan_{int(time.time() * 1000)}"
        TRACKS[plan_id] = {"plan": plan}
        _save_plans()
        return jsonify({"plan_id": plan_id, "plan": plan, "status": "pending_confirm"})
    except IntentError as e:
        return err("INTENT_PARSE_FAILED", str(e))
    except Exception as e:
        return err("INTENT_PARSE_FAILED", f"解析异常: {e}", 500)


@app.post("/execute_plan")
def execute_plan_endpoint():
    body = request.get_json(silent=True) or {}
    plan_id = body.get("plan_id")
    parameters = body.get("parameters") or {}
    file_path = body.get("file_path")
    prefer_low_sr = bool(body.get("prefer_low_sr"))  # 前端可选：直接走 16kHz
    plan = {"parameters": parameters}
    if plan_id and plan_id in TRACKS and "plan" in TRACKS[plan_id]:
        plan = TRACKS[plan_id]["plan"]
        # 仅当前端带新参数时覆盖；空参数沿用 plan 自身字段，
        # 否则 plan.get("parameters", plan) 会拿到空 dict 导致 preflight 误报失败
        if parameters:
            plan["parameters"] = parameters
    # file_path 恢复：body → plan_id 关联 → plan.track 关联（worker 重启后仍可用）
    if (not file_path or not os.path.exists(file_path)) and plan_id and plan_id in TRACKS:
        file_path = TRACKS[plan_id].get("file_path") or file_path
    track_key = plan.get("track") or parameters.get("track")
    if (not file_path or not os.path.exists(file_path)) and track_key and track_key in TRACKS:
        file_path = TRACKS[track_key].get("file_path") or file_path
    if not file_path or not os.path.exists(file_path):
        return err("FILE_NOT_FOUND", "缺少有效 file_path", 404)
    try:
        # 参数预检：与 parse_intent 同一套 preflight 规则（时间/模式/强度/范围）
        import soundfile as _sf
        actual = plan.get("parameters", plan)
        check_plan = dict(actual)
        check_plan.setdefault("track", "vocals")
        check_state = {"analysis": {"duration_sec": _sf.info(file_path).duration}}
        errs = preflight(check_plan, check_state)
        if errs:
            return err("PREFLIGHT_FAILED", "; ".join(errs), 400)
        # 正常路径：44.1kHz；请求指定或超预算时自动降采样 16kHz 兜底
        result = render_and_export(file_path, plan, out_dir=OUT_DIR,
                                   resample_to=LOW_SR if prefer_low_sr else None)
        if not prefer_low_sr and result["render_ms"] > RENDER_BUDGET_MS:
            result = render_and_export(file_path, plan, out_dir=OUT_DIR, resample_to=LOW_SR)
            result["fallback"] = "low_sr_16k"
        result["wav_check"] = verify_wav(result["output_path"])
        result["plan_id"] = plan_id
        return jsonify(result)
    except PitchGuardError as e:
        return err("PITCH_GUARD", str(e), 422)
    except Exception as e:
        return err("RENDER_FAILED", f"渲染失败: {e}", 500)


if __name__ == "__main__":
    port = int(os.environ.get("WORKER_PORT", "8787"))
    print(f"[worker] starting on http://127.0.0.1:{port}", flush=True)
    _load_plans()
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
