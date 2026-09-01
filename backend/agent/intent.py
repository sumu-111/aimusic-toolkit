"""Agent 层：LLM 意图解析 + JSON Schema 预检 + 规则模板兜底（双通道）

流程：LLM(JSON Schema 约束) → JSON 解析 → 预检（schema + 语义）→ 失败降级规则模板
坐标来源：music analysis 层（bars/pitch），LLM 只做意图映射与参数翻译。
"""
from __future__ import annotations

import json
import os
import sys
from typing import Callable

import jsonschema

# 兼容直接运行（python agent/intent.py）：把仓库根加入 sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agent.schema import CORRECT_PITCH_SCHEMA, OP_DOC
from agent.rules import parse_intent_rules

MAX_SEMITONES = 2.0


class IntentError(Exception):
    """意图解析/预检失败。"""


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

    payload = {
        "model": model,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "system",
                "content": (
                    "你是修音工作台的自然语言解析器。只输出一个 JSON 对象，不要任何解释。\n"
                    f"可用操作说明：\n{OP_DOC}\n"
                    "输出格式：{\"op\":\"correct_pitch\",\"track\":\"vocals\","
                    "\"start_sec\":0.0,\"end_sec\":0.0,\"mode\":\"auto\","
                    "\"correction_strength\":0.8}\n"
                    "时间坐标必须从上下文的小节数据换算，不要猜测。"
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
    """预检规则：track 存在 / 时间在音频长度内 / 参数 bounds / 节点未锁定。

    返回错误列表，空列表表示通过。
    """
    errors: list[str] = []
    analysis = (project_state or {}).get("analysis", {})
    duration = analysis.get("duration_sec") or 0.0
    nodes = (project_state or {}).get("nodes") or []

    # 1. track 存在
    track = plan.get("track")
    if track not in ("vocals", "track", "人声", None):
        errors.append(f"track '{track}' 不存在，当前仅支持 vocals")

    # 2. 时间范围在音频长度内
    start, end = plan.get("start_sec"), plan.get("end_sec")
    if start is None or end is None:
        errors.append("缺少 start_sec/end_sec")
    else:
        if start < 0 or end > duration + 0.05:
            errors.append(f"时间范围 [{start},{end}] 超出音频长度 {duration:.2f}s")
        if end <= start:
            errors.append("end_sec 必须大于 start_sec")

    # 3. 参数 bounds
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

    return errors


# ---------- 主入口 ----------

def parse_intent(
    text: str,
    project_state: dict,
    llm_fn: Callable[[str, dict], str] | None = None,
) -> dict:
    """自然语言 → plan。LLM 失败自动降级规则模板。

    project_state 需含 analysis：{bars, pitch, duration_sec}。
    """
    llm = llm_fn or _default_llm
    plan = None
    errors: list[str] = []

    # 通道 1：LLM
    try:
        raw = llm(text, project_state)
        parsed = json.loads(raw)
        if isinstance(parsed, dict) and parsed.get("op") == "correct_pitch":
            # 第一层预检：JSON Schema 结构校验（类型/枚举/required），
            # 校验失败抛 ValidationError → 自动降级规则模板
            jsonschema.validate(parsed, CORRECT_PITCH_SCHEMA["parameters"])
            plan = parsed
            plan["source"] = "llm"
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
        raise IntentError("意图无法解析：请用类似「第 N 小节高音修准」的表述")

    # 预检
    errs = preflight(plan, project_state)
    if errs:
        raise IntentError("预检未通过: " + "; ".join(errs))

    plan.pop("scale", None) if plan.get("mode") != "scale" else None
    return plan


if __name__ == "__main__":
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    state = {
        "analysis": {
            "duration_sec": 30.0,
            "bars": [
                {"index": i, "start_sec": (i - 1) * 4.0, "end_sec": i * 4.0}
                for i in range(1, 8)
            ],
        }
    }
    # 无 LLM key 时自动走规则模板
    print(parse_intent("只把人声第 3 小节高音修准", state))
