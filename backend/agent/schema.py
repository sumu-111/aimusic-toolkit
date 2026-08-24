"""correct_pitch 工具 schema（与前端 zod 对齐）"""
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

# 供 LLM 提示词与前端共享的操作描述
OP_DOC = (
    "可用操作：correct_pitch（修正音准）\n"
    "参数：track(轨道名), start_sec(起始秒), end_sec(结束秒), "
    "mode(auto|scale), scale(音阶，mode=scale 时必须), correction_strength(0-1，默认0.8)\n"
    "时间坐标必须来自提供的 bars/pitch 上下文，不得自行猜测。"
)
