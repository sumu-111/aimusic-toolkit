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

## 快速开始（开发环境）

> 以下为规划中的本地开发流程，MVP 阶段逐步落地。

```bash
# 1. 安装前端依赖
cd frontend
npm install
npm run dev

# 2. 启动 AI 推理 worker（Python 独立进程）
cd worker
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m sounder_worker   # 或 demucs / audiocraft 服务

# 3. 在 Electron 壳中运行（开发模式）
npm run electron:dev
```

运行时成本预估：

- Demucs htdemucs_ft：建议 8GB+ 显存，无 GPU 可用 CPU（慢）
- MusicGen small：约 3GB 显存；medium 约 8GB；large 约 16GB
- 无 GPU 机器演示方案：预生成素材缓存，或现场用 CPU 小模型出短片段

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
