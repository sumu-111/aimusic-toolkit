# AI 音乐工作平台 · 修音不黑盒

> 人主导 + AI 辅助的可编辑修音工作台：每一步都看得见、改得动、听得回。

上传一段人声或器乐，平台会先**分析**出小节位置与逐帧音高；你直接用自然语言说要什么效果（"这段唱跑调了，修准"、"全首歌降两个半音"），AI 把它解析成**可编辑的修音计划**；确认后执行，并以**修前/修后偏差曲线 + A/B 同框试听**让你判断是否满意 —— 整个过程没有黑盒。

## 功能特性

| 环节 | 说明 |
|---|---|
| 🎵 音频导入 | WAV / MP3，支持 44.1kHz 等常见采样率 |
| 🔍 分析 | librosa 小节定位 + pyin 逐帧音高检测（含置信度），画布与波形联动 |
| 💬 意图解析 | 规则模板 + DeepSeek LLM 双通道："修准 / 移调 / 区间修音"等自然语言指令 |
| ✏️ 计划可编辑 | 执行前可改区间、强度、mode/scale（修准）或半音数（移调 ±12） |
| 🎛️ 修音执行 | Phase Vocoder 渲染：`correct_pitch`（吸附最近音高）与 `transpose`（整体移调） |
| 📊 偏差验证 | 修前→修后 cents 折线对比（修准）；移调展示「±N 半音」位移 |
| 🎧 A/B 对比 | 原声与修音同框双波形，可独立播放、进度联动、循环小节 |

## 技术栈

- **前端**：Electron 44 + Vite 8 + React 18 + TypeScript + zustand + wavesurfer.js + @xyflow/react（pnpm workspace）
- **后端**：Python 3.13 + Flask（worker :8787）+ librosa（小节定位 / pyin 音高检测 / Phase Vocoder）+ 规则模板 / DeepSeek LLM 意图解析

## 快速开始

```bash
# 1) 后端（:8787）
cd backend
python -m venv .venv
# Windows: .venv\Scripts\pip install -r requirements.txt
# macOS/Linux: .venv/bin/pip install -r requirements.txt
.venv/Scripts/python.exe worker.py          # Windows
# .venv/bin/python worker.py                # macOS/Linux

# 2) 前端（Electron，另开终端）
pnpm install --node-linker=hoisted          # 中文路径环境需要 hoisted
pnpm dev:electron                            # Electron 全栈联调（pnpm dev 为浏览器 web 模式）
```

需要真实 LLM 意图解析时，给 worker 注入 `DEEPSEEK_API_KEY` 环境变量后重启即可；未注入时自动走规则模板通道（示例见 `.env.example`）。

## 项目结构

```
├── backend/               # Flask worker：/analyze /parse_intent /execute_plan + 修音引擎
│   ├── agent/             # 意图解析（规则模板 rules.py / LLM schema）
│   ├── scripts/           # 演示素材生成 / 稳定性走查
│   └── output/            # 渲染与验证产物（gitignored，不入库）
├── electron/              # Electron main / preload / workerBridge（契约收敛，HTTP 桥接）
├── src/                   # React 渲染层
│   ├── components/        # canvas 流程画布 / waveform 波形 / chat / render / history / inspector
│   ├── ipc/               # IPC client + mock
│   └── store/             # zustand 全局状态
├── assets/                # 演示音频素材（真人声 / 跑调 / 移调）
└── public/                # 静态资源
```

## 使用流程

```
导入音频 → 分析（小节 / 音高 / 置信度）
         → 自然语言下达指令 → 生成修音计划 →（可选）编辑参数
         → 执行渲染 → 偏差验证（修前→修后）→ A/B 对比试听
```

画布上的节点（导入 → 分析 → 修音）记录每一步状态；点击节点可在右侧查看详情；历史面板可回溯已执行的计划。

## 验证

- API 全链路（规则通道）与 DeepSeek 真 LLM 通道均通过（`/analyze` → `/parse_intent` → `/execute_plan`）
- 移调端到端：规则解析 `降调` → `transpose(-2)` → 渲染 → pyin 复核整段 F0 中位数位移 ≈ -200 cents（精确 1 个半音）
- 修准可听差异：离调素材渲染后偏差 28.2c → 5.6c，A/B 试听差异明显
- 真机 UI 自动化：导入 → 分析 → 意图 → 参数编辑 → 渲染 → A/B 全链路通过

## License

[MIT](LICENSE) © sumu-111
