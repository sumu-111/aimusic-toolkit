"""后端 Worker：IPC 服务端（Flask，本地 localhost）

通道（契约 v1）：
  POST /analyze       {track_id, file_path}          → analysis_result
  POST /parse_intent  {text, project_state}          → plan（LLM→规则模板双通道）
  POST /execute_plan  {plan_id, parameters, file_path} → render_result
    op 分流（parameters.op 优先，缺省取 plan.op）：
      - correct_pitch / transpose → pitch 渲染路径
      - mix        → 纯确定性混音（parameters.clips 全量）
      - add_sfx    → plan.asset + parameters.clips 合并新 clip → 渲染 → 回填权威 clips + added_clip
      - remove_sfx → parameters.clip_ids（或 plan.clips）从 clips 中删除 → 渲染剩余 → 回填 clips + removed
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
from sfx import list_assets, import_sfx, delete_sfx, resolve_asset_file, SfxError
from mix import mix_render, MixError

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


def _norm_num(v, default=None):
    """宽松数值转换：非法输入回落默认值（前端滑杆/输入框可能传字符串）。"""
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _normalize_clips(clips) -> list:
    """回填权威 clips 状态：逐条补齐默认字段 + 类型强转。

    前端持久化 project.json 应以本返回为准（后端无状态，不记忆）；
    muted 标记原样保留（状态在、渲染跳过，由 mix_render 处理）。
    """
    if clips is None:
        return []
    if not isinstance(clips, list):
        raise MixError("parameters.clips 必须是数组（可为空）")
    out = []
    for i, c in enumerate(clips):
        if not isinstance(c, dict):
            raise MixError(f"非法 clip 项: {c!r}")
        n = dict(c)  # 透传 locate / from_text / keywords 等展示字段
        n["clip_id"] = str(c.get("clip_id") or f"clip_{int(time.time() * 1000)}_{i}")
        n["sfx_id"] = str(c.get("sfx_id") or "")
        if not n["sfx_id"]:
            raise MixError(f"clip '{n['clip_id']}' 缺少 sfx_id")
        n["name"] = c.get("name") or n["sfx_id"]
        n["start_sec"] = _norm_num(c.get("start_sec"), 0.0)
        if c.get("end_sec") is not None:
            n["end_sec"] = _norm_num(c.get("end_sec"))
        else:
            n.pop("end_sec", None)
        n["loop"] = bool(c.get("loop"))
        n["gain_db"] = _norm_num(c.get("gain_db"), -12.0)
        n["fade_in_ms"] = _norm_num(c.get("fade_in_ms"), 200.0)
        n["fade_out_ms"] = _norm_num(c.get("fade_out_ms"), 500.0)
        out.append(n)
    return out


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
        if plan.get("op") in ("add_sfx", "remove_sfx"):
            plan.setdefault("from_text", text)  # 指令原文，execute 时透传进 clip.from_text
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

    # op 分流：mix（音效全量确定性混音）走 mix.py，修音/移调沿用 pitch 路径
    op = (parameters or {}).get("op") or plan.get("op")
    if op == "mix":
        try:
            result = mix_render(
                file_path,
                (parameters or {}).get("clips") or [],
                out_dir=OUT_DIR,
                resample_to=LOW_SR if prefer_low_sr else None,
            )
            result["wav_check"] = verify_wav(result["output_path"])
            result["plan_id"] = plan_id
            return jsonify(result)
        except MixError as e:
            return err("MIX_FAILED", str(e), 400)
        except Exception as e:
            return err("RENDER_FAILED", f"混音失败: {e}", 500)

    # add_sfx / remove_sfx：一步式执行（合并/删除 clip → 渲染 → 回填权威 clips）
    # 后端无状态：clips 全量由前端下发，返回值即前端应持久化的最新事实
    if op in ("add_sfx", "remove_sfx"):
        try:
            current = _normalize_clips((parameters or {}).get("clips"))
        except MixError as e:
            return err("MIX_FAILED", str(e), 400)
        low = LOW_SR if prefer_low_sr else None
        if op == "add_sfx":
            asset = plan.get("asset") or (parameters or {}).get("asset") or {}
            sfx_id = asset.get("sfx_id")
            name = asset.get("name") or sfx_id
            if not sfx_id:
                return err("INVALID_REQUEST", "add_sfx 缺少 asset.sfx_id（plan 或 parameters 需提供）")
            if not resolve_asset_file(sfx_id):
                return err("SFX_ASSET_NOT_FOUND", f"素材不存在于内置/用户库: {sfx_id}")
            locate = (plan.get("placement") or {}).get("locate")
            new_clip = {
                "clip_id": str((parameters or {}).get("clip_id")
                               or f"clip_{int(time.time() * 1000)}"),
                "sfx_id": sfx_id,
                "name": name,
                "start_sec": _norm_num((parameters or {}).get("start_sec"),
                                       _norm_num(plan.get("start_sec"), 0.0)),
                "loop": bool((parameters or {}).get("loop", False)),
                "gain_db": _norm_num((parameters or {}).get("gain_db"), -12.0),
                "fade_in_ms": _norm_num((parameters or {}).get("fade_in_ms"), 200.0),
                "fade_out_ms": _norm_num((parameters or {}).get("fade_out_ms"), 500.0),
                "locate": locate,
                "from_text": ((parameters or {}).get("from_text")
                              or plan.get("from_text")
                              or f"{locate or ''}加{plan.get('query') or name}"),
            }
            end_v = (parameters or {}).get("end_sec", plan.get("end_sec"))
            if end_v is not None:
                new_clip["end_sec"] = _norm_num(end_v)
            if any(c["clip_id"] == new_clip["clip_id"] for c in current):
                return err("CLIP_ID_CONFLICT", f"clip_id 已存在: {new_clip['clip_id']}")
            merged = current + [new_clip]
            try:
                result = mix_render(file_path, merged, out_dir=OUT_DIR, resample_to=low)
            except MixError as e:
                return err("MIX_FAILED", str(e), 400)
            except Exception as e:
                return err("RENDER_FAILED", f"混音失败: {e}", 500)
            result["op"] = "add_sfx"
            result["clips"] = merged
            result["added_clip"] = new_clip
        else:  # remove_sfx
            plan_clips = plan.get("clips") or []
            targets = set((parameters or {}).get("clip_ids")
                          or [c.get("clip_id") for c in plan_clips if c.get("clip_id")])
            # plan clip 缺 clip_id 时按 sfx_id 退化匹配
            sfx_targets = {c.get("sfx_id") for c in plan_clips
                           if not c.get("clip_id") and c.get("sfx_id")}
            removed = [c for c in current
                       if c["clip_id"] in targets or c["sfx_id"] in sfx_targets]
            if not removed:
                return err("REMOVE_NO_MATCH", "当前 clips 中未找到要移除的目标音效", 400)
            removed_ids = {c["clip_id"] for c in removed}
            remaining = [c for c in current if c["clip_id"] not in removed_ids]
            try:
                result = mix_render(file_path, remaining, out_dir=OUT_DIR, resample_to=low)
            except MixError as e:
                return err("MIX_FAILED", str(e), 400)
            except Exception as e:
                return err("RENDER_FAILED", f"混音失败: {e}", 500)
            result["op"] = "remove_sfx"
            result["clips"] = remaining
            result["removed"] = removed
        result["wav_check"] = verify_wav(result["output_path"])
        result["plan_id"] = plan_id
        return jsonify(result)

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


@app.get("/sfx/list")
def sfx_list():
    """内置 + 用户合并的音效资产列表。"""
    try:
        return jsonify({"assets": list_assets()})
    except SfxError as e:
        return err(e.code, e.message)
    except Exception as e:
        return err("SFX_LIST_FAILED", f"音效库读取失败: {e}", 500)


@app.post("/sfx/import")
def sfx_import():
    """导入用户本地音效 → 用户库。"""
    body = request.get_json(silent=True) or {}
    file_path = body.get("file_path")
    if not file_path:
        return err("INVALID_REQUEST", "缺少 file_path")
    try:
        asset = import_sfx(file_path=file_path,
                           name=body.get("name"),
                           category=body.get("category"),
                           keywords=body.get("keywords"))
        return jsonify({"asset": asset, "imported": True})
    except SfxError as e:
        return err(e.code, e.message)
    except Exception as e:
        return err("SFX_IMPORT_FAILED", f"导入失败: {e}", 500)


@app.post("/sfx/delete")
def sfx_delete():
    """删除用户库音效（仅 user 来源）。"""
    body = request.get_json(silent=True) or {}
    sfx_id = body.get("sfx_id")
    if not sfx_id:
        return err("INVALID_REQUEST", "缺少 sfx_id")
    try:
        delete_sfx(sfx_id)
        return jsonify({"deleted": True, "sfx_id": sfx_id})
    except SfxError as e:
        return err(e.code, e.message)
    except Exception as e:
        return err("SFX_DELETE_FAILED", f"删除失败: {e}", 500)


if __name__ == "__main__":
    port = int(os.environ.get("WORKER_PORT", "8787"))
    print(f"[worker] starting on http://127.0.0.1:{port}", flush=True)
    _load_plans()
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
