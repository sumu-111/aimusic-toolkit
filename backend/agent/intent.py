"""Agent 层：LLM 意图解析 + JSON Schema 预检 + 规则模板兜底（双通道）

流程：LLM(JSON Schema 约束) → JSON 解析 → 预检（schema + 语义）→ 失败降级规则模板
坐标来源：music analysis 层（bars/pitch），LLM 只做意图映射与参数翻译。
op 分流：correct_pitch / transpose（时间范围修音移调）
        add_sfx / remove_sfx（音效增删，素材只能命中库，位置只用语义 locate）
"""
from __future__ import annotations

import json
import os
import sys
from typing import Callable

import jsonschema

# 兼容直接运行（python agent/intent.py）：把仓库根加入 sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agent.schema import (
    CORRECT_PITCH_SCHEMA, TRANSPOSE_SCHEMA, ADD_SFX_SCHEMA, REMOVE_SFX_SCHEMA, OP_DOC,
)
from agent.rules import parse_intent_rules
from sfx import list_assets, resolve_best_asset, asset_briefs, SfxError

MAX_SEMITONES = 2.0
PITCH_OPS = ("correct_pitch", "transpose")
SFX_OPS = ("add_sfx", "remove_sfx")
ALL_OPS = PITCH_OPS + SFX_OPS


class IntentError(Exception):
    """意图解析/预检失败。"""


# ---------- 定位换算（语义 locate → 秒） ----------

def locate_to_sec(locate: str | None, analysis: dict) -> tuple[float, float]:
    """把语义位置翻译成 [start_sec, end_sec]。

    规则：副歌/高潮→首个 chorus 段（无 sections 时整首兜底）；开头→第 1 小节；
    结尾→最后 1 小节（无 bars 时取时长末尾 4s）；第N小节→按小节表；
    缺省/整首→[0, duration]。
    """
    duration = float((analysis or {}).get("duration_sec") or 0.0)
    bars = (analysis or {}).get("bars") or []
    sections = (analysis or {}).get("sections") or []

    if not locate or locate in ("整首", None):
        return 0.0, duration

    low = (locate or "").lower()
    # 副歌 / 高潮
    if "副歌" in locate or "高潮" in low or "chorus" in low:
        for sec in sections:
            if str(sec.get("label", "")).lower().startswith("chorus"):
                return float(sec["start_sec"]), float(sec["end_sec"])
        return 0.0, duration  # sections 未就绪前整首兜底（B3 后精化）

    if "结尾" in locate or "尾声" in locate or "outro" in low:
        if bars:
            last = bars[-1]
            return float(last["start_sec"]), float(last["end_sec"])
        return max(0.0, duration - 4.0), duration

    if "开头" in locate or "前奏" in locate or "intro" in low:
        if bars:
            first = bars[0]
            return float(first["start_sec"]), float(first["end_sec"])
        return 0.0, min(duration, 4.0)

    m = __import__("re").search(r"第\s*(\d+)\s*小节", locate or "")
    if m:
        idx = int(m.group(1))
        for b in bars:
            if b.get("index") == idx:
                return float(b["start_sec"]), float(b["end_sec"])
        return 0.0, duration  # 越界退化整段

    return 0.0, duration  # 未知语义 → 整首


def _match_existing_clips(query: str, clips: list[dict]) -> list[dict]:
    """在当前工程 clips 中按名称/来源指令匹配要移除的 clip（query 命中任一即收）。"""
    if not query:
        return []
    q = query.lower()
    out = []
    for c in clips:
        hay = " ".join(str(x) for x in (
            c.get("name"), c.get("from_text"), c.get("locate"),
            c.get("sfx_id"), c.get("keywords", []),
        )).lower()
        if q in hay or any(t and t in hay for t in q.split() if len(t) >= 2):
            out.append(c)
    return out


# ---------- LLM 调用封装 ----------

def _default_llm(text: str, context: dict) -> str:
    """默认 LLM 调用（OpenAI 兼容接口，环境变量配置）。

    断网/无 Key/异常 → 抛异常，由上层降级到规则模板。
    """
    import urllib.request

    api_key = os.environ.get("OPENAI_API_KEY") or os.environ.get("DEEPSEEK_API_KEY")
    base = os.environ.get("LLM_BASE_URL", "https://api.deepseek.com/v1")
    model = os.environ.get("LLM_MODEL", "deepseek-chat")
    if not api_key:
        raise RuntimeError("未配置 LLM API Key")

    # 可用素材清单（供 add_sfx 选中，禁止编造 sfx_id）
    try:
        briefs = asset_briefs()
        sfx_hint = "可用素材：\n" + json.dumps(briefs, ensure_ascii=False)
    except Exception:
        sfx_hint = "可用素材：（不可用）"

    payload = {
        "model": model,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "system",
                "content": (
                    "你是音乐工作台的自然语言解析器。只输出一个 JSON 对象，不要任何解释。\n"
                    f"可用操作说明：\n{OP_DOC}\n"
                    f"{sfx_hint}\n"
                    "add_sfx 的 asset.sfx_id 必须来自上面可用素材清单；"
                    "placement.locate 只能写语义位置（副歌/开头/结尾/第N小节/整首），禁止写秒数。\n"
                    "remove_sfx 的 clip_ids 必须来自项目上下文 sfx_clips；"
                    "若工程没有匹配 clip，clip_ids 输出空数组。\n"
                    "correct_pitch/transpose 的时间坐标必须从上下文的小节数据换算，不要猜测。"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"用户指令：{text}\n"
                    f"项目上下文：\n{json.dumps(context, ensure_ascii=False)}"
                ),
            },
        ],
    }
    req = urllib.request.Request(
        f"{base}/chat/completions",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode())
    return data["choices"][0]["message"]["content"]


# ---------- 预检 ----------

def preflight(plan: dict, project_state: dict) -> list[str]:
    """预检规则：track 存在 / 时间在音频长度内 / 参数 bounds / 音效素材命中。

    返回错误列表，空列表表示通过。
    """
    errors: list[str] = []
    analysis = (project_state or {}).get("analysis", {})
    duration = analysis.get("duration_sec") or 0.0
    nodes = (project_state or {}).get("nodes") or []
    op = plan.get("op")

    # 1. track 存在（音效操作同样面向整轨，track 可省）
    track = plan.get("track")
    if op in PITCH_OPS and track not in ("vocals", "track", "人声", None):
        errors.append(f"track '{track}' 不存在，当前仅支持 vocals")

    if op in PITCH_OPS:
        # 2. 时间范围在音频长度内
        start, end = plan.get("start_sec"), plan.get("end_sec")
        if start is None or end is None:
            errors.append("缺少 start_sec/end_sec")
        else:
            if start < 0 or end > duration + 0.05:
                errors.append(f"时间范围 [{start},{end}] 超出音频长度 {duration:.2f}s")
            if end <= start:
                errors.append("end_sec 必须大于 start_sec")

        # 3. 参数 bounds（按操作类型分流）
        if op == "transpose":
            semitones = plan.get("semitones")
            if semitones is None:
                errors.append("缺少 semitones")
            elif not (-12 <= semitones <= 12):
                errors.append(f"semitones {semitones} 超出 ±12 半音")
        else:
            strength = plan.get("correction_strength", 0.8)
            if not (0 <= strength <= 1):
                errors.append(f"correction_strength {strength} 超出 0-1")
            if plan.get("mode") not in ("auto", "scale"):
                errors.append(f"mode '{plan.get('mode')}' 非法")
            if plan.get("mode") == "scale" and plan.get("scale") is None:
                errors.append("mode=scale 时必须指定 scale")

        # 4. 目标节点未锁定
        for n in nodes:
            if n.get("locked") and n.get("type") == "pitch_correct":
                errors.append("目标修音节点已锁定，需先解锁")

    elif op == "add_sfx":
        # 素材必须真实存在于库中；LLM/规则若未选中或 sfx_id 失效 → 用 query 再解析一次
        asset = plan.get("asset") or {}
        sfx_id = asset.get("sfx_id")
        query = (plan.get("query") or "").strip()
        if sfx_id:
            try:
                if not any(a.get("sfx_id") == sfx_id for a in list_assets()):
                    sfx_id = None
            except SfxError as e:
                errors.append(str(e.message))
        if not sfx_id:
            cands = resolve_best_asset(query, limit=6) if query else []
            if cands:
                plan["asset"] = {"sfx_id": cands[0]["sfx_id"],
                                 "name": cands[0]["name"],
                                 "category": cands[0]["category"]}
            else:
                names = [a["name"] for a in list_assets()[:8]]
                errors.append(
                    f"未找到与「{query or '该请求'}」匹配的音效素材"
                    + (f"；可选：{', '.join(names)}" if names else "")
                )

    elif op == "remove_sfx":
        clips = plan.get("clips") or []
        if not clips:
            errors.append("没有匹配到可移除的音效（当前工程中不存在目标音效）")

    return errors


# ---------- 主入口 ----------

def parse_intent(
    text: str,
    project_state: dict,
    llm_fn: Callable[[str, dict], str] | None = None,
) -> dict:
    """自然语言 → plan。LLM 失败自动降级规则模板。

    project_state 需含 analysis：{bars, pitch, duration_sec}；音效工程另含 sfx_clips。
    """
    llm = llm_fn or _default_llm
    plan = None
    errors: list[str] = []

    # 通道 1：LLM
    try:
        raw = llm(text, project_state)
        parsed = json.loads(raw)
        if isinstance(parsed, dict) and parsed.get("op") in ALL_OPS:
            schema_map = {
                "correct_pitch": CORRECT_PITCH_SCHEMA,
                "transpose": TRANSPOSE_SCHEMA,
                "add_sfx": ADD_SFX_SCHEMA,
                "remove_sfx": REMOVE_SFX_SCHEMA,
            }
            jsonschema.validate(parsed, schema_map[parsed["op"]]["parameters"])
            plan = parsed
            plan["source"] = "llm"
            # remove_sfx：把 clip_ids 解析为真实 clip 对象（校验存在性）
            if plan["op"] == "remove_sfx":
                clip_ids = plan.get("clip_ids") or []
                existing = (project_state or {}).get("sfx_clips") or []
                by_id = {c.get("clip_id"): c for c in existing}
                plan["clips"] = [by_id[cid] for cid in clip_ids if cid in by_id]
                plan.pop("clip_ids", None)
    except Exception as e:
        errors.append(f"LLM 解析失败: {e}")

    # 通道 2：规则模板兜底
    if plan is None:
        try:
            plan = parse_intent_rules(text, project_state)
            if plan is not None:
                plan["source"] = "rules"
        except Exception:
            plan = None

    if plan is None:
        raise IntentError("意图无法解析：可试试「副歌加雨声」「去掉掌声」「第 3 小节高音修准」")

    # 音效 op：补齐定位换算（语义 locate → start_sec/end_sec，供渲染与展示）
    op = plan.get("op")
    if op in SFX_OPS:
        analysis = (project_state or {}).get("analysis", {})
        locate = ((plan.get("placement") or {}).get("locate")
                  if op == "add_sfx" else None)
        if op == "add_sfx":
            if "placement" not in plan:
                plan["placement"] = {"locate": "整首"}
        start, end = locate_to_sec(locate, analysis)
        plan["start_sec"] = round(start, 3)
        plan["end_sec"] = round(end, 3)

    # 预检
    errs = preflight(plan, project_state)
    if errs:
        raise IntentError("预检未通过: " + "; ".join(errs))

    plan.pop("scale", None) if plan.get("mode") != "scale" else None
    return plan


if __name__ == "__main__":
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    analysis = {
        "duration_sec": 30.0,
        "bars": [
            {"index": i, "start_sec": (i - 1) * 4.0, "end_sec": i * 4.0}
            for i in range(1, 8)
        ],
    }
    state = {"analysis": analysis, "sfx_clips": []}
    state2 = {"analysis": analysis, "sfx_clips": [
        {"clip_id": "c1", "name": "人群掌声欢呼", "from_text": "副歌加掌声",
         "locate": "副歌", "sfx_id": "hit_applause_01", "keywords": ["掌声", "欢呼"]},
    ]}
    # 无 LLM key 时自动走规则模板；add 需命中内置素材，remove 需匹配工程已有 clip
    cases = [
        ("只把人声第 3 小节高音修准", state, True),
        ("副歌加雨声氛围", state, True),
        ("在结尾加一些雷雨声", state, True),
        ("来点掌声", state, True),
        ("去掉掌声", state2, True),
        ("把掌声去掉", state2, True),
        ("删掉雨声", state, False),  # 工程里没有雨声 clip → 预期预检失败
    ]
    for s, st, ok in cases:
        try:
            print(("✓" if ok else "?"), s, "→",
                  json.dumps(parse_intent(s, st), ensure_ascii=False))
        except Exception as e:
            print(("?" if ok else "✓"), s, "→ ERR", e)
