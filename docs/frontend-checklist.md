# 前端 A 开发清单（AI 音乐工作平台 · 黑客松）

> 技术栈锁定：Vite + React 18 + TypeScript + Electron + React Flow + WaveSurfer.js v7 + Zustand
> 铁律：**Electron 只是壳**，核心链路必须能在纯浏览器 + mock 数据下跑通（Plan B 兜底）。

---

## 0. 全局约定（先写死，后面所有代码依赖它）

- 时间单位一律 **秒（float）**；音频 **44.1kHz WAV**；强度 `0-1`；修正量默认 ±2 半音
- 所有 IPC 错误统一 `{ error_code, message }`
- `VITE_MOCK=1` 时全部走本地 mock，不启动 Python worker
- 状态机（全局唯一）：`idle → analyzing → analyzed → parsing → plan_pending → executing → rendered → reverted`

### 接口契约 v1（后端 B 已确认，前端按此写 TS 类型）

| 通道 | 方向 | 载荷 |
|---|---|---|
| `analyze` | → | `{ track_id, file_path }` |
| `analysis_result` | ← | `{ bars:[{index,start_sec,end_sec}], pitch:[{t,pitch,confidence}] }` |
| `parse_intent` | → | `{ text, project_state }` |
| `plan` | ← | `{ op:'correct_pitch', track, start_sec, end_sec, mode, scale, strength }` |
| `execute_plan` | → | `{ plan_id, parameters }` |
| `render_result` | ← | `{ output_path, before_cents, after_cents, curve }` |
| `project.json` | 本地 | `{ nodes, analysis, history, version }` |

---

## D-2 / D-1 赛前准备

- [ ] Node 20 + pnpm 装好，`pnpm create vite` 建 React+TS 工程，`pnpm dev` 能起
- [ ] Electron 壳能起（`contextIsolation: true` / `nodeIntegration: false` / preload 暴露 `window.api`）
- [ ] React Flow 空画布能渲染、能拖节点
- [ ] WaveSurfer 能加载一个本地 WAV 并播放
- [ ] 写死 `src/types/contract.ts`（上表全部类型）
- [ ] 造 mock 数据：`src/mock/analysis.json`（含 8 个 bar + 一段 pitch）、`plan.json`、`render.json`
- [ ] 与后端 B 敲定 IPC **通道名字符串**与错误码枚举，写进同一个 `contract.ts`

**赛前退出标准**：`VITE_MOCK=1 pnpm dev` 在浏览器里能导入 WAV → 播放 → 画布上出现 3 个节点。

---

## Day 1：工程骨架 + 导入播放 + 分析结果上图（里程碑 M1）

### 上午 09:00-12:00 — 骨架
- [ ] 目录结构落地（见下方"目录结构"）
- [ ] Electron main：窗口创建 + `spawn` Python worker（进程句柄、日志转发、退出清理）
- [ ] preload `contextBridge.exposeInMainWorld('api', { analyze, parseIntent, executePlan, onEvent })`
- [ ] `src/ipc/client.ts`：统一封装 `invoke<T>(channel, payload)`，**内部按 `VITE_MOCK` 分流到 `mock.ts`**
- [ ] Zustand `useProjectStore`：`{ track, analysis, plan, render, history, status, error }`

### 下午 13:00-18:00 — 画布与节点
- [ ] React Flow 三类自定义节点：`AudioImportNode` / `AnalysisNode` / `PitchFixNode`
- [ ] 节点参数面板占位（右侧 Inspector 抽屉）
- [ ] 节点图读写 Zustand，节点连线关系固定为 导入→分析→修音

### 晚上 19:00-24:00 — 波形与小节窗口
- [ ] 文件选择 + 拖拽导入 WAV（Electron 走 `dialog`，浏览器走 `<input type=file>` + ObjectURL）
- [ ] WaveSurfer：波形渲染、播放/暂停、进度跳转、当前时间显示
- [ ] 用 WaveSurfer **Regions 插件**把 `bars` 画成小节边界，**第 3 小节高亮且可选中**（选中后写入 store 的 `selectedBar`）
- [ ] 分析中 loading 态 + 分析失败的错误条（显示 `error_code`，带「重试」「降级为整段修音」两个按钮）

**M1 验收**：导入 30 秒素材 → 点分析 → ≤15 秒后画布节点显示分析元数据，波形上小节边界与时间轴对齐，第 3 小节可点选。

---

## Day 2：对话 + 计划确认 + 执行 + A/B + 回退（里程碑 M2）

### 上午 09:00-12:00 — 对话与计划确认
- [ ] `ChatInput`：输入框 + 发送，调 `parse_intent`，传入 `project_state`（当前 track/analysis/selectedBar）
- [ ] 三态展示：解析中（骨架屏）/ 失败（错误 + 重试 + 「用模板」按钮）/ 已生成计划
- [ ] `PlanPanel` 计划确认面板：展示 1 条 `correct_pitch` 操作，**参数全部可编辑**
  - `start_sec` / `end_sec`（数字输入，联动波形 region 拖动）
  - `mode`（下拉）/ `scale`（下拉）/ `strength`（滑杆 0-1）
- [ ] 「确认执行」「取消」按钮，驱动状态机

### 下午 13:00-18:00 — 执行与对比
- [ ] 执行进度条（后端无进度事件就用假进度 + 「已用时 Xs」）+ 「取消」按钮
- [ ] `ABCompare`：原声 / 修音后 双 WaveSurfer 实例，A/B 一键切换且**播放位置同步**
- [ ] `CentsChart`：before/after 平均 cents 大数字 + 逐音符偏差折线（用 `render_result.curve`，SVG 手撸或 recharts）

### 晚上 19:00-24:00 — 回退与保存
- [ ] 「回退」：回到 `plan_pending` 可编辑态，音频切回原声，**保留操作日志**
- [ ] `HistoryPanel`：操作日志列表（时间 / 指令原文 / 参数 / 结果 cents）
- [ ] 工程自动保存 `project.json`（节点图 + analysis + history + version），启动时自动恢复
- [ ] 全链路串联 + 计时埋点（在 console 打每段耗时，Day3 排练要用）

**M2 验收**：输入「只把人声第 3 小节高音修准」→ 计划确认 → 改强度 → 执行 → A/B → 回退 → 再次确认重渲染，全链路 ≤ 60 秒。

---

## Day 3：打磨与路演（里程碑 M3）

- [ ] 3 分钟 demo 脚本逐段排练，**记录每段实际耗时**（对照 PPT 第 20 页时间表）
- [ ] Plan B 演练三条：断网走规则模板 / 渲染超时走 16kHz / Electron 崩了切浏览器版
- [ ] 全流程走查 5 次并计时，全过
- [ ] 录 3 分钟正片 + 30 秒高光；截图：小节窗口、偏差曲线、计划面板
- [ ] 富余时间才做：UI 打磨（暗色主题、节点动效）
- [ ] **最后 1 小时封版**：只查演示设备、音量、窗口尺寸（建议固定 1600×1000）

---

## 目录结构

```
fronted/
├─ electron/
│  ├─ main.ts            # 窗口 + spawn python worker + IPC 转发
│  └─ preload.ts         # contextBridge 暴露 window.api
├─ src/
│  ├─ types/contract.ts  # ★ 接口契约类型（与后端共享）
│  ├─ ipc/
│  │  ├─ client.ts       # invoke 封装 + mock 分流
│  │  └─ mock.ts         # 读 src/mock/*.json，带延时模拟
│  ├─ store/useProjectStore.ts
│  ├─ components/
│  │  ├─ canvas/{FlowCanvas,nodes/*}.tsx
│  │  ├─ waveform/{WaveformPanel,BarRegions,ABCompare}.tsx
│  │  ├─ chat/{ChatInput,PlanPanel}.tsx
│  │  ├─ render/{ProgressBar,CentsChart}.tsx
│  │  └─ history/HistoryPanel.tsx
│  ├─ mock/{analysis,plan,render}.json
│  └─ App.tsx
└─ docs/
```

## 布局（一屏三栏，别做多页面）

```
┌──────────────────────────────────────────────┐
│ 顶栏：导入 WAV │ 状态机指示 │ 保存/回退       │
├───────────┬──────────────────┬───────────────┤
│ React Flow│  波形区（上=原声  │ 右栏：         │
│ 画布      │  下=修音后 A/B）  │ 对话输入       │
│ 3 节点    │  小节 Region      │ 计划确认面板   │
│           │                  │ 偏差曲线       │
│           │                  │ 历史日志       │
└───────────┴──────────────────┴───────────────┘
```

## 前端专属风险与兜底

| 风险 | 兜底 |
|---|---|
| Electron 起不来 / 打包异常 | 所有业务代码零 Electron 依赖，`window.api` 缺失自动降级浏览器 mock |
| 后端接口没就绪 | `VITE_MOCK=1` 全链路可演，UI 不阻塞 |
| WaveSurfer v7 Regions API 变更 | 赛前就跑通 region 创建/拖动，别留到 Day1 晚上 |
| 双 WaveSurfer 播放不同步 | A/B 用同一个 currentTime 驱动，切换时 seek 到同一秒 |
| 大 WAV 波形卡顿 | 素材封顶 30 秒；开 `peaks` 预计算或 `barWidth` 降精度 |
