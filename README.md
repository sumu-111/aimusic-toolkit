# AI 音乐平台

> 以**人工为主导、AI 为辅助**的可编辑音乐工作平台 —— 用自然语言表达想法，AI 生成可逐条确认、可编辑的修音操作序列；扒歌、生成、修剪、混音在统一节点画布中完成。

[English](#english) · [完整方案](docs/方案.md)

---

## 一句话定位

一个把「AI 扒歌 → AI 生成 → 修剪 → 混音」集成为统一工作流的**白盒、可编辑**音乐编辑平台。AI 不直接产出黑盒成品，而是先给出一条可解释、可回退的操作序列，由创作者逐条把关后再渲染成音频。

## 核心理念

- **人工为主，AI 赋能**：用户是创作者，AI 是提效助手，不做黑盒替代。
- **过程可编辑**：AI 产出可解释的操作步骤，用户确认 / 修改 / 撤销后才渲染成音频。
- **工作流统一**：把散落在多个工具里的能力（扒歌、生成、剪辑、混音）收进一个画布。

## 核心功能模块

| 模块 | 说明 |
|------|------|
| AI 扒歌（音源分离） | 基于 Demucs（htdemucs_ft），人声 / 鼓 / 贝斯 / 其他 4 轨分离 |
| AI 音乐生成 | 集成 MusicGen（文本 / 旋律条件生成）作为生成节点 |
| 节点式工作流画布 | React Flow 构建，节点即操作，连线即处理管线 |
| 音乐修剪与剪辑 | 波形可视化，时间轴选区裁剪、分割、拼接、淡入淡出 |
| 混音 | 音量 / 声像 / 均衡 / 压缩 / 混响等效果节点，实时预览 |
| 修音 Agent（智能中枢） | 自然语言 → 结构化操作计划 → 可编辑节点序列 → 用户确认 → 执行 |
| 工程管理 | 工程文件保存节点图 + 音频资产 + 修音操作历史，管线可存为模板 |

## 技术架构

```
┌─────────────────────────────────────────┐
│ 前端层（Electron 壳 + React）            │
│  - React Flow 节点画布                    │
│  - 波形/时间轴编辑（WaveSurfer.js）       │
│  - 对话输入框（Agent 交互入口）            │
├─────────────────────────────────────────┤
│ Agent 层（修音 Agent）                   │
│  - LLM 意图解析 + tool-calling           │
│  - 操作计划生成 / 状态管理               │
├─────────────────────────────────────────┤
│ 音频引擎层                               │
│  - Web Audio API + Tone.js（实时预览）   │
│  - FFmpeg.wasm（裁剪/转码/拼接）          │
├─────────────────────────────────────────┤
│ AI 推理层（Python 独立 worker 进程）      │
│  - Demucs（扒歌）· MusicGen（生成）       │
│  - PyTorch / ONNX Runtime                │
├─────────────────────────────────────────┤
│ 数据层                                   │
│  - 工程文件（节点图 + 资产 + 操作历史）    │
│  - 本地文件存储                           │
└─────────────────────────────────────────┘
```

## 技术栈

| 层 | 主选 | 备选 |
|----|------|------|
| 前端框架 | React 18 | Vue |
| 节点画布 | React Flow (@xyflow/react) | Svelte Flow |
| 波形 / 时间轴 | WaveSurfer.js | waveform-playlist |
| 状态管理 | Zustand | Redux Toolkit |
| 桌面壳 | Electron | Tauri |
| 实时音频 | Web Audio API + Tone.js | 原生 Audio Worklet |
| 剪辑 / 转码 | FFmpeg.wasm | fluent-ffmpeg |
| 音源分离 | Demucs (htdemucs_ft) | Spleeter / UVR5 |
| 音乐生成 | MusicGen / AudioCraft | Stable Audio Open / Riffusion |
| 推理框架 | PyTorch | ONNX Runtime |
| LLM 接入 | OpenAI / DeepSeek API + function calling | 本地 ollama |
| 参数约束 | JSON Schema / zod | — |

完整方案、MVP 范围与 48 小时排期见 [docs/方案.md](docs/方案.md)。

## 当前 MVP 进度（2026-08-25）

> 黑客松 48h 收敛：MVP = **一条修音准闭环**（导入 → 分析 → 自然语言 → 可编辑操作 → 渲染 → 对比 → 回退）。扒歌/生成/混音列为加分项与后续方向。

**后端（backend/，已完成 ✅）**

| 模块 | 实现 | 验证结果 |
|------|------|----------|
| 音乐分析 | librosa 小节定位（真人声 16 小节 ✅）+ pyin 音高轨迹 | 30s 素材分析 ≤3.5s |
| 修音引擎 | 逐音符分段 + Phase Vocoder 修正 + 重检测验证 | 合成 28.23→3.67 cents；真人声有效段 29→19 cents（余为生理颤音） |
| Agent | LLM 意图解析 + Schema 预检 + 规则模板兜底（断网可用） | 「第 3 小节」→ 3.76~5.72s ✅ |
| IPC | Flask worker：`/analyze` `/parse_intent` `/execute_plan` `/health` | 端口 8787，CORS + 分析缓存 |
| 质量守卫 | 低置信段跳过 + 全部无效拒绝，绝不静默硬改 | 噪声输入正确拒绝 ✅ |
| 稳定性 | 2 素材 × 5 轮全链路 + 4 错误路径 | 全部通过；全链路 1.2~7s（预算 60s） |
| 优化 | 16kHz 降采样兜底（快 5 倍）、WAV 字节校验、兜底渲染预生成 | ✅ |

**前端（未启动）**：Electron/React Flow/WaveSurfer 待开发，接口契约见《后端任务清单.md》。

**demo 素材**：真人声 `assets/human_vocal.wav`（29.9s，小节定位 + 修正均验证通过）；合成素材备选见 `docs/素材准备指南.md`。

## 快速开始（开发环境 · 当前实际可用）

```bash
# 1. 启动后端 worker（Python venv 已就绪）
cd backend
./.venv/Scripts/python.exe worker.py        # 监听 http://127.0.0.1:8787

# 2. 验证接口
curl http://127.0.0.1:8787/health
# POST /analyze       {"track_id":"t1","file_path":"C:/.../assets/human_vocal.wav"}
# POST /parse_intent  {"text":"只把人声第 3 小节高音修准","project_state":{...}}
# POST /execute_plan  {"plan_id":"p1","file_path":"...","parameters":{...}}

# 3. baseline / 稳定性 / 兜底脚本
./.venv/Scripts/python.exe scripts/baseline.py assets/human_vocal.wav
./.venv/Scripts/python.exe scripts/stability.py
./.venv/Scripts/python.exe scripts/make_fallback.py assets/human_vocal.wav
```

前端层（React + Electron 壳）为规划中的后续开发，接口契约已定，见《后端任务清单.md》。

### 当前 MVP 运行时成本

- 依赖仅 `librosa/soundfile/numpy/scipy/flask`，**无 torch / 无 GPU 需求**（选型底线）
- 30 秒素材全链路 ≤ 7s（预算 60s）；渲染超预算自动降采样 16kHz 兜底
- LLM 意图解析为可选增强：配置 `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` 走真通道，不配则自动走规则模板（断网可用）

## 目录结构（规划）

```
ai-music-platform/
├── docs/                 # 方案文档
├── frontend/             # React + React Flow 节点画布
├── worker/               # Python AI 推理独立进程（Demucs / MusicGen）
├── electron/             # 桌面壳
└── assets/               # 示例音频与测试素材
```

## 协作者

- 仓库 Owner：[@sumu-111](https://github.com/sumu-111)
- 协作者：[@LIUFelix2004Felix](https://github.com/LIUFelix2004Felix)（Admin）

## 许可证

本项目代码以 [MIT License](LICENSE) 开源。

> 注意：部分模型权重（如 MusicGen / AudioCraft）采用 CC-BY-NC 4.0 许可，仅可用于非商业场景；商业用途需替换开源权重。详见 [docs/方案.md](docs/方案.md) 风险章节。

---

## English

**AI Music Platform** — a human-led, AI-assisted *editable* music workstation. Express ideas in natural language; the AI produces an explainable, editable sequence of audio-editing operations (stem separation, generation, trimming, mixing) on a unified node canvas. No black-box one-click output — every step is confirmable and reversible.

Participating in the **Rebuild Hackathon** (AI + X track). See [docs/方案.md](docs/方案.md) for the full design (in Chinese).
