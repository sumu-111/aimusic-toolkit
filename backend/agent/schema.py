"""correct_pitch / transpose / add_sfx / remove_sfx 工具 schema（与前端 zod 对齐）"""
from __future__ import annotations

CORRECT_PITCH_SCHEMA = {
    "name": "correct_pitch",
    "description": "修正指定时间范围内人声的音准",
    "parameters": {
        "type": "object",
        "properties": {
            "track": {"type": "string"},
            "start_sec": {"type": "number", "minimum": 0},
            "end_sec": {"type": "number", "minimum": 0},
            "mode": {"type": "string", "enum": ["auto", "scale"]},
            "scale": {
                "type": "string",
                "enum": ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"],
            },
            "correction_strength": {"type": "number", "minimum": 0, "maximum": 1},
        },
        "required": ["track", "start_sec", "end_sec", "mode"],
    },
}

TRANSPOSE_SCHEMA = {
    "name": "transpose",
    "description": "对指定时间范围整体升调或降调（移调），保持相对音高关系不变",
    "parameters": {
        "type": "object",
        "properties": {
            "track": {"type": "string"},
            "start_sec": {"type": "number", "minimum": 0},
            "end_sec": {"type": "number", "minimum": 0},
            "semitones": {"type": "number", "minimum": -12, "maximum": 12},
        },
        "required": ["track", "start_sec", "end_sec", "semitones"],
    },
}

ADD_SFX_SCHEMA = {
    "name": "add_sfx",
    "description": "向歌曲的某个位置添加音效（必须从提供的可用素材中选一条）",
    "parameters": {
        "type": "object",
        "properties": {
            "track": {"type": "string"},
            "query": {"type": "string", "description": "用户想要的声音，如 雨声/掌声/心跳"},
            "asset": {
                "type": "object",
                "description": "从可用素材清单中选中的素材",
                "properties": {"sfx_id": {"type": "string"}},
                "required": ["sfx_id"],
            },
            "placement": {
                "type": "object",
                "description": "语义位置：只允许写 副歌/开头/结尾/第N小节/整首，禁止填秒数",
                "properties": {
                    "locate": {"type": "string",
                               "enum": ["开头", "结尾", "副歌", "高潮", "第N小节", "整首"]},
                },
                "required": ["locate"],
            },
        },
        "required": ["track", "query", "asset", "placement"],
    },
}

REMOVE_SFX_SCHEMA = {
    "name": "remove_sfx",
    "description": "移除工程中已添加的音效（clip_id 必须来自当前工程的 clips 清单）",
    "parameters": {
        "type": "object",
        "properties": {
            "track": {"type": "string"},
            "query": {"type": "string", "description": "用户要移除的声音描述，如 掌声"},
            "clip_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "当前工程 clips 中匹配的 clip_id 列表",
            },
        },
        "required": ["track", "query", "clip_ids"],
    },
}

# 供 LLM 提示词与前端共享的操作描述
OP_DOC = (
    "可用操作：\n"
    "1. correct_pitch（修正音准）\n"
    "   参数：track(轨道名), start_sec(起始秒), end_sec(结束秒), "
    "mode(auto|scale), scale(音阶，mode=scale 时必须), correction_strength(0-1，默认0.8)\n"
    "2. transpose（整体移调，升调/降调）\n"
    "   参数：track(轨道名), start_sec(起始秒), end_sec(结束秒), "
    "semitones(半音数，正数升调、负数降调，如 -2 表示降两个半音)\n"
    "3. add_sfx（添加音效）\n"
    "   参数：track(vocals), query(用户想要的声音描述), "
    "asset.sfx_id(必须从提供的可用素材清单中选择，禁止编造 sfx_id), "
    "placement.locate(语义位置：开头|结尾|副歌|高潮|第N小节|整首，禁止填秒数)\n"
    "4. remove_sfx（移除已添加的音效）\n"
    "   参数：track(vocals), query(要移除的声音描述), "
    "clip_ids(当前工程 clips 中匹配的 clip_id 列表；若工程无匹配 clip 则 clip_ids 为空数组)\n"
    "时间坐标必须来自提供的 bars/pitch 上下文，不得自行猜测。"
)
