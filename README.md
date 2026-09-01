# AI 音乐工作平台（修音不黑盒）

黑客松项目：人主导 + AI 辅助的可编辑修音工作台。上传音频 → 小节定位与音高检测 → 意图解析 → 可编辑修音 → 偏差验证 → A/B 对比，全程可视、可改、可回听。

## 技术栈

- **前端**：Electron 44 + Vite 8 + React 18 + TypeScript 6 + zustand + wavesurfer.js + @xyflow/react（pnpm workspace）
- **后端**：Python 3.13 + Flask（worker :8787）+ librosa 1.0.0（小节定位 + pyin 音高检测 + Phase Vocoder 修音）+ 规则模板 / DeepSeek LLM 双通道意图解析

## 分支策略

**`demo` 是唯一主线（全栈）**：前端 + 后端 + Electron 桥接，clone 后即可本地全栈联调。

历史分支已归档为 tag（内容均并入 demo，勿再基于旧分支开发）：

| Tag | 对应旧分支 | 内容 |
|---|---|---|
| `archive/fronted-final` | fronted | 纯前端全量（含 workerBridge 桥接） |
| `archive/main-backend-docs` | main | 纯后端 + 方案文档（pptx / 验收报告 / 任务清单） |

## 启动方式

```bash
# 后端（:8787）
cd backend
.venv/Scripts/python.exe worker.py        # Windows；macOS/Linux: .venv/bin/python worker.py

# 前端（Electron）
pnpm install --node-linker=hoisted        # 中文路径环境必须 hoisted
pnpm dev:electron                          # Electron 全栈联调；pnpm dev 仅浏览器 web 模式
```

需要真实 LLM 通道时：`DEEPSEEK_API_KEY=<key>` 注入 worker 环境变量后重启。

## 目录结构

```
├── backend/            # Flask worker：/analyze /parse_intent /execute_plan + 修音引擎
│   ├── agent/          # 意图解析（规则模板 + LLM）
│   ├── scripts/        # 素材生成 / 稳定性走查
│   └── output/         # 运行产物（baseline / stability 报告）
├── electron/           # main / preload / workerBridge（契约收敛，:8787 HTTP 桥接）
├── src/                # React 前端：流程画布 / 波形 / 聊天计划 / A-B 对比 / 历史
│   ├── components/     # canvas / waveform / chat / render / history / inspector
│   ├── ipc/            # IPC client + mock
│   └── store/          # zustand 状态
├── assets/             # 演示与验证素材（真人声 / 跑调 / 明暗演示）
└── docs/               # 方案、验收报告、参考项目借鉴点等
```

## 核心链路

上传音频 → librosa 小节定位 + pyin 音高检测 → 规则模板 / LLM 意图解析（生成修音计划）→ Phase Vocoder 修音 → 偏差验证（修前/修后对比）→ A/B 播放。

## 验证

- API 级全链路（规则通道）13/13、LLM 通道、真机 UI 自动化 9/9 均通过（脚本见 `.workbuddy/tmp/`，不入库）
- 真人声素材：16 小节 / 1497 音高点，渲染偏差约 28c → 6c
