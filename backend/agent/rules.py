"""Agent 兜底：规则模板解析（断网/API 失败时离线可用）

解析示例：
- "只把人声第 3 小节高音修准" → correct_pitch plan
- "全首歌降两个半音" / "整首升调" → transpose plan
- "副歌加雨声" / "来点掌声" → add_sfx plan（素材命中内置/用户库）
- "去掉掌声" / "删掉鼓点" → remove_sfx plan（匹配工程现有 clips）
支持："第 N 小节"、"高音/修准/修正/修音"、"强度 X"、"降调/升调/移调" 等口语模板。
"""
from __future__ import annotations

import os
import re
import sys

# 兼容直接运行（python agent/rules.py）：把仓库根加入 sys.path（sfx 模块在仓库根下）
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DEFAULT_STRENGTH = 0.8

# 音效语义定位词
_LOCATE_PAT = {
    "副歌": r"副歌|高潮|chorus|Chorus",
    "结尾": r"结尾|尾声|末尾|最后|outro|Outro",
    "开头": r"开头|前奏|开始|intro|Intro",
}
# 中文量词/语气噪声（解析音效词时跳过）
_NOISE = r"(?:一点|一些|点儿|点|个|一|两|三|阵|段|层|条|上|进去|进来)?"
# 增加动词 → 音效意图（注意：不用裸"来/整"，避免误伤"接下来/整首歌"）
_ADD_VERB = r"加上|配上|添加|加入|混入|来点|来一些|来些|来一|来阵|来段|加|配|铺"
# 移除动词 → 音效意图
_DEL_VERB = r"去掉|删掉|删除|移除|去除|拿掉|取消|撤掉|清除"
# 音效名词强信号（防止音效句被误判成修音；命中即屏蔽 correct_pitch 兜底）
_SFX_NOUNS = (
    r"掌声|鼓掌|鼓点|雨声|大雨|小雨|雷雨|雷声|风声|狂风|海浪|海|鸟鸣|鸟叫|虫鸣|心跳|"
    r"音乐盒|号角|钟声|爆炸|轰鸣|枪声|欢呼|喝彩|笑声|叮当|铃声|"
    r"音效|特效|whoosh|riser|braam|boing"
)


def parse_intent_rules(text: str, project_state: dict) -> dict | None:
    """规则模板解析。project_state 需含 analysis.bars（小节列表）与可选 sfx_clips。

    返回 plan dict（correct_pitch / transpose / add_sfx / remove_sfx），
    无法解析返回 None。
    """
    analysis = (project_state or {}).get("analysis", {})
    bars = analysis.get("bars") or []
    duration = analysis.get("duration_sec") or 0.0
    clips = (project_state or {}).get("sfx_clips") or []

    # ── 0. 音效增删意图（优先于修音，避免落入 correct_pitch 默认分支） ──
    sfx_plan = _parse_sfx(text, analysis, clips)
    if sfx_plan is not None:
        return sfx_plan
    # 含音效强信号但结构解析失败 → 屏蔽修音兜底（宁可报错也不误修）
    if re.search(_SFX_NOUNS, text) and re.search(
            rf"{_ADD_VERB}|{_DEL_VERB}|把|将", text):
        return None

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


def _pick_locate(text: str) -> str | None:
    """识别语义位置（副歌/结尾/开头/第N小节/整首），无则 None。"""
    for locate, pat in _LOCATE_PAT.items():
        if re.search(pat, text):
            return locate
    m = re.search(r"第\s*\d+\s*小节", text)
    if m:
        return m.group(0)
    return None


def _extract_sfx_query(text: str, verb_pat: str) -> str | None:
    """取动词之后紧跟的音效词（1~10 个中文字/词），失败返回 None。

    注意：verb_pat 含裸 |，必须整体包进 (?:...) 组，否则正则被 | 拆散，
    后面的 \\s*噪声(音效词) 只挂到最后一个动词分支上，其余动词匹配时
    group(1) 未参与 → None（"副歌加雨声氛围" 曾在此崩溃）。
    """
    m = re.search(
        rf"(?:{verb_pat})\s*{_NOISE}([\u4e00-\u9fffA-Za-z0-9]{{1,10}})",
        text,
    )
    if not m:
        return None
    q = m.group(1)
    # 掐掉尾随的位置/连接噪声（"雨声到结尾"→雨声）
    q = re.split(r"(?:到|在|放|铺|里|上|吧|啊|呢|的|和|与|然后|，|。|！|？)", q)[0]
    # 掐掉尾随的"音效/声音/效果/氛围"等泛词尾（雨声音效→雨声）
    # 不能裸删"声"：掌声/雨声/雷雨声会被拆成 掌/雨/雷雨
    q = re.sub(r"(音效|声音|效果|氛围)$", "", q)
    return q.strip() or None


def _clean_remove_query(raw: str) -> str:
    """清洗 remove 的原始匹配串：先掐"把/将"前缀与位置前缀，再去尾缀/泛词尾/指代词。"""
    # "在结尾把掌声去掉" → 取最后一个"把/将"之后 → "掌声"（"把掌声去掉"同理）
    q = re.split(r"[把将]", raw)[-1].strip()
    q = re.split(r"(?:掉|了|的|吧|啊|呢|，|。|！|？)", q)[0]
    q = re.sub(r"(音效|声音|效果)$", "", q).strip()
    q = re.sub(r"^(?:那个|这个|这些|那些|刚才的|刚刚的|之前加的|我加的|你加的|加的)", "", q).strip()
    return q


def _parse_sfx(text: str, analysis: dict, clips: list[dict]) -> dict | None:
    """解析 add_sfx / remove_sfx。素材命中库（search_assets），remove 匹配现有 clips。"""
    duration = float(analysis.get("duration_sec") or 0.0)

    # ── remove：去掉/删掉/移除 + 声音描述（动词在前或声音在前均可） ──
    q = None
    mdel = re.search(
        rf"({_DEL_VERB})\s*{_NOISE}([\u4e00-\u9fffA-Za-z0-9]{{1,10}})",
        text,
    )
    if mdel:
        q = _clean_remove_query(mdel.group(2))
    if not q:
        # 动词后置："把掌声去掉" / "掌声删掉"
        mdel2 = re.search(
            rf"([\u4e00-\u9fffA-Za-z0-9]{{1,10}})\s*(?:要|就|都|想)?\s*({_DEL_VERB})",
            text,
        )
        if mdel2:
            q = _clean_remove_query(mdel2.group(1))
    if q:
        hits = _match_clips(q, clips)
        return {
            "op": "remove_sfx",
            "track": "vocals",
            "query": q,
            "clips": hits,
            "start_sec": 0.0, "end_sec": duration,
            "source": "rules",
        }

    # ── add：加/配/铺/来点/添加 + 音效词（定位可前置或后置） ──
    q = _extract_sfx_query(text, _ADD_VERB)
    if q:
        # 素材命中（延迟 import 避免循环/路径问题；resolve_best_asset 含尾词宽松兜底）
        from sfx import resolve_best_asset
        cands = resolve_best_asset(q, limit=3)
        asset = None
        if cands:
            best = cands[0]
            asset = {"sfx_id": best["sfx_id"], "name": best["name"],
                     "category": best["category"]}
        locate = _pick_locate(text)
        plan = {
            "op": "add_sfx",
            "track": "vocals",
            "query": q,
            "placement": {"locate": locate or "整首"},
            "start_sec": 0.0, "end_sec": duration,
            "source": "rules",
        }
        if asset:
            plan["asset"] = asset
        return plan

    return None


def _match_clips(query: str, clips: list[dict]) -> list[dict]:
    """按 query 在现有 clips（name/from_text/sfx_id/keywords）里模糊匹配。"""
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


if __name__ == "__main__":
    # 自测
    state = {
        "analysis": {
            "duration_sec": 30.0,
            "bars": [
                {"index": i, "start_sec": (i - 1) * 4.0, "end_sec": i * 4.0}
                for i in range(1, 8)
            ],
        },
        "sfx_clips": [
            {"clip_id": "c1", "name": "人群掌声欢呼", "from_text": "副歌加掌声"},
        ],
    }
    for s in ["只把人声第 3 小节高音修准", "第 2 到 4 小节修正", "整段修音，强度 0.5",
              "副歌加雨声氛围", "来点掌声", "在结尾加一些雷雨声",
              "去掉掌声", "删掉雨声", "把掌声去掉", "在结尾把掌声去掉"]:
        try:
            print(s, "→", parse_intent_rules(s, state))
        except Exception as e:
            print(s, "→ ERR", e)
