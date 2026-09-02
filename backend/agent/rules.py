"""Agent 兜底：规则模板解析（断网/API 失败时离线可用）

解析示例：
- "只把人声第 3 小节高音修准" → correct_pitch plan
- "全首歌降两个半音" / "整首升调" → transpose plan
支持："第 N 小节"、"高音/修准/修正/修音"、"强度 X"、"降调/升调/移调" 等口语模板。
"""
from __future__ import annotations

import re

DEFAULT_STRENGTH = 0.8


def parse_intent_rules(text: str, project_state: dict) -> dict | None:
    """规则模板解析。project_state 需含 analysis.bars（小节列表）。

    返回 plan dict（correct_pitch / transpose），无法解析返回 None。
    """
    bars = (project_state or {}).get("analysis", {}).get("bars") or []
    duration = (project_state or {}).get("analysis", {}).get("duration_sec") or 0.0

    # 1. 小节范围：第 N 小节 / 第 N 到 M 小节
    # 1. 小节范围：第 N 小节 / 第 N 到 M 小节（bars 缺失时退化为整段）
    start_sec = end_sec = None
    m = re.search(r"第\s*(\d+)\s*(?:到|至|至第|-)\s*(\d+)\s*小节", text) or \
        re.search(r"第\s*(\d+)\s*小节", text)
    if m:
        if len(m.groups()) == 2:
            start_idx, end_idx = int(m.group(1)), int(m.group(2))
        else:
            start_idx = end_idx = int(m.group(1))
        if bars:
            for b in bars:
                if b["index"] == start_idx:
                    start_sec, end_sec = b["start_sec"], b["end_sec"]
                    break
            if start_sec is not None and end_idx != start_idx:
                for b in bars:
                    if b["index"] == end_idx:
                        end_sec = b["end_sec"]
                        break
    if start_sec is None:
        # 2. 未指定小节（或小节表缺失/索引越界）→ 整段
        start_sec, end_sec = 0.0, duration or 0.0
        if end_sec <= 0:
            return None

    # 3a. 移调意图：降调/升调/降 key/降 N 个半音/移调
    # 要求 降/升 后紧跟 调|key|半音（中间可夹数字/中文数字/个），
    # 避免误伤「升高音」「降低音量」等非移调说法
    mt = re.search(
        r"(降|升)\s*[\d两一二三四五六七八九十]*\s*(?:个)?\s*(?:调|key|Key|KEY|半音)",
        text,
    ) or re.search(r"移调\s*(?:到)?\s*([+-]?\d+(?:\.\d+)?)?\s*个?\s*半音", text) \
      or re.search(r"移调\s*(?:到)?\s*([+-]?\d+(?:\.\d+)?)?\s*个?\s*(?:key|Key|KEY)?", text)
    if mt:
        direction = -1.0 if mt.group(0).startswith("降") else 1.0
        steps = 1.0
        mnum = re.search(r"([+-]?\d+(?:\.\d+)?)", mt.group(0))
        if mnum:
            steps = float(mnum.group(1))
        elif re.search(r"[两二]", mt.group(0)):
            steps = 2.0
        return {
            "op": "transpose",
            "track": "vocals",
            "start_sec": round(float(start_sec), 3),
            "end_sec": round(float(end_sec), 3),
            "semitones": round(direction * steps, 2),
            "source": "rules",
        }

    # 3b. 强度：默认 0.8（仅 correct_pitch 使用）
    strength = DEFAULT_STRENGTH
    ms = re.search(r"强度\s*([0-9]*\.?[0-9]+)", text)
    if ms:
        strength = min(1.0, max(0.0, float(ms.group(1))))

    mode = "auto"
    ms2 = re.search(r"音阶\s*([A-G](#|b)?)", text)
    if ms2:
        mode = "scale"

    return {
        "op": "correct_pitch",
        "track": "vocals",
        "start_sec": round(float(start_sec), 3),
        "end_sec": round(float(end_sec), 3),
        "mode": mode,
        "scale": ms2.group(1) if ms2 else None,
        "correction_strength": round(strength, 2),
        "source": "rules",
    }


if __name__ == "__main__":
    # 自测
    state = {
        "analysis": {
            "duration_sec": 30.0,
            "bars": [
                {"index": i, "start_sec": (i - 1) * 4.0, "end_sec": i * 4.0}
                for i in range(1, 8)
            ],
        }
    }
    for s in ["只把人声第 3 小节高音修准", "第 2 到 4 小节修正", "整段修音，强度 0.5"]:
        print(s, "→", parse_intent_rules(s, state))
