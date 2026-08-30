# Codex 执行指令（前端 A · 按顺序逐条投喂）

用法：在 `F:\AA-VibeProject\fronted` 目录下开 Codex，**一次只给一条 Prompt**，跑完验收通过再给下一条。
每条 Prompt 都自带上下文，可以独立粘贴。

---

## Prompt 0 · 项目初始化（赛前 D-2）

```
在当前空目录初始化一个前端工程，技术栈固定：Vite + React 18 + TypeScript + Electron + React Flow + WaveSurfer.js v7 + Zustand。包管理器用 pnpm。

要求：
1. Vite React-TS 模板；再加 Electron 壳（electron + vite-plugin-electron），main 进程 electron/main.ts，preload 在 electron/preload.ts。
2. Electron 安全配置必须是 contextIsolation: true、nodeIntegration: false，preload 用 contextBridge 暴露能力。
3. 关键约束：所有业务代码不得直接 import electron。渲染进程只通过 window.api 访问宿主能力；window.api 不存在时（纯浏览器）必须能自动降级，不报错。
4. package.json 提供三个脚本：dev（纯浏览器 Vite）、dev:electron（Electron 壳）、build。
5. 建立目录骨架并放空文件占位：
   src/types/contract.ts
   src/ipc/client.ts, src/ipc/mock.ts
   src/store/useProjectStore.ts
   src/components/{canvas,waveform,chat,render,history}/
   src/mock/
6. 加 .env.example，含 VITE_MOCK=1。

完成后运行 pnpm dev 和 pnpm dev:electron 各验证一次能起来，把结果告诉我。不要写任何业务逻辑。
```

---

## Prompt 1 · 接口契约类型 + IPC 客户端 + Mock 层（赛前 D-1，最重要的一条）

```
实现前后端接口契约的 TypeScript 类型与 IPC 客户端。这是整个前端的地基，后面所有组件都依赖它。

一、src/types/contract.ts，严格按以下契约定义类型（时间单位一律秒 float，音频 44.1kHz WAV，strength 0-1）：

- Bar: { index: number; start_sec: number; end_sec: number }
- PitchPoint: { t: number; pitch: number; confidence: number }
- AnalyzeReq: { track_id: string; file_path: string }
- AnalysisResult: { bars: Bar[]; pitch: PitchPoint[] }
- ParseIntentReq: { text: string; project_state: ProjectState }
- Plan: { plan_id: string; op: "correct_pitch"; track: string; start_sec: number; end_sec: number; mode: string; scale: string; strength: number }
- ExecutePlanReq: { plan_id: string; parameters: Partial<Plan> }
- RenderResult: { output_path: string; before_cents: number; after_cents: number; curve: { t: number; before: number; after: number }[] }
- ApiError: { error_code: string; message: string }
- ProjectFile: { nodes: unknown[]; analysis: AnalysisResult | null; history: HistoryItem[]; version: string }
- 导出 IPC 通道名常量 CHANNELS：analyze / analysis_result / parse_intent / plan / execute_plan / render_result
- 导出错误码枚举 ErrorCode：ANALYZE_FAILED / PARSE_FAILED / PRECHECK_FAILED / RENDER_FAILED / RENDER_TIMEOUT / CANCELLED / WORKER_DOWN

二、src/ipc/client.ts：
- 导出 analyze / parseIntent / executePlan / cancel 四个 async 函数，返回 Result 风格 { ok: true, data } 或 { ok: false, error }，绝不 throw。
- 内部判断：import.meta.env.VITE_MOCK === "1" 或 window.api 不存在 时走 mock，否则走 window.api。
- 每次调用打点耗时，console.info("[ipc] channel=xx cost=xxms")，Day3 排练要用。

三、src/ipc/mock.ts + src/mock/*.json：
- analysis.json：8 个 bar，每 2 秒一个（0~16 秒），pitch 数组约 200 个点，故意让第 3 小节（index=2，即 4~6 秒）的 pitch 偏离目标音 30~60 cents。
- plan.json：一条 correct_pitch，start_sec=4，end_sec=6，mode=scale，scale=C_major，strength=0.8。
- render.json：before_cents=42，after_cents=8，curve 约 20 个点，after 明显收敛。
- mock 函数带真实延时：analyze 1200ms、parseIntent 800ms、executePlan 2500ms。
- 提供开关 MOCK_FAIL（读 localStorage），打开时让对应接口返回错误，用于演练失败路径。

四、electron/preload.ts 通过 contextBridge 暴露 window.api，含上述四个方法加 onWorkerEvent(cb)；electron/main.ts 里先用 ipcMain.handle 占位（原样转发到一个还不存在的 Python worker，失败就返回 WORKER_DOWN 错误），这一步不要真去 spawn 进程。

五、写一个临时页面按钮，点一下依次调 analyze → parseIntent → executePlan 并把结果打到 console，验证 mock 全链路通。跑通后告诉我三个接口的耗时。
```

---

## Prompt 2 · 全局状态机 + 三栏布局（Day1 上午）

```
基于已有的 src/types/contract.ts 和 src/ipc/client.ts，实现全局状态与主布局。

一、src/store/useProjectStore.ts（Zustand）：
state: track / analysis / selectedBarIndex / plan / render / history / status / error / elapsedMs
status 联合类型严格是：idle | analyzing | analyzed | parsing | plan_pending | executing | rendered | reverted
actions: setTrack / runAnalyze / selectBar / runParseIntent(text) / updatePlanParam(key,value) / confirmPlan / cancelExecute / revert / reset
- 每个 action 内部负责状态机流转，非法流转直接 return 并 console.warn，不要让 UI 自己管状态。
- revert 不清 history，只把 status 退回 plan_pending 并把当前播放源切回原声。

二、App.tsx 三栏布局（CSS Grid，暗色主题，底色 #0f1115，主色 #7c5cff）：
顶栏：导入 WAV 按钮 | 当前 status 徽章（不同颜色）| 保存 | 回退
左栏 320px：React Flow 画布占位
中栏 flex-1：波形区占位
右栏 380px：对话 / 计划 / 曲线 / 历史 占位
窗口最小宽度 1400px，不做响应式（黑客松演示固定分辨率）。

三、导入 WAV：Electron 下走 window.api（先只实现浏览器分支也可以），浏览器下用 input[type=file] 加拖拽到中栏区域，生成 ObjectURL 存进 store.track。

验收：能导入一个 wav，顶栏 status 从 idle 变化，三栏骨架显示正常。
```

---

## Prompt 3 · React Flow 画布三节点（Day1 下午）

```
在左栏实现 React Flow 画布。

三个自定义节点（固定顺序 导入 → 分析 → 修音，固定连线，不做自由编排）：
1. AudioImportNode：显示文件名、时长、采样率；无 track 时显示"待导入"
2. AnalysisNode：显示 bars 数量、pitch 点数、平均置信度；analyzing 时显示 loading 动画；失败时红边框
3. PitchFixNode：显示当前 plan 的 start_sec~end_sec / mode / strength；rendered 后追加 before_cents → after_cents

要求：
- 节点数据全部从 useProjectStore 读，节点本身不发请求。
- 点击节点在右栏顶部展开 Inspector 区域显示该节点完整元数据（JSON 折叠视图即可）。
- 节点位置持久化进 store，供后续 project.json 保存。
- 节点样式统一：圆角 12px、深色卡片、状态色描边（灰=待办 / 蓝=进行中 / 绿=完成 / 红=失败）。
```

---

## Prompt 4 · 波形 + 小节 Region（Day1 晚上，M1 关键）

```
在中栏实现波形面板，这是 Day1 里程碑 M1 的验收对象。

用 WaveSurfer.js v7 加 Regions 插件：
1. 加载 store.track.url，渲染波形，实现播放/暂停/进度跳转/当前时间显示（mm:ss.SSS）。
2. 分析完成后，把 analysis.bars 每一项渲染成一个 Region（半透明色块加顶部小节序号标签），边界必须与波形时间轴精确对齐。
3. 第 3 小节（bars[2]）默认高亮为主色，点击任意小节把 index 写进 store.selectedBarIndex，选中态加亮描边。
4. Region 边界可拖动，拖完把新的 start_sec/end_sec 同步到 store（Day2 计划面板要联动）。
5. 在波形下方叠加一条 pitch 轨迹折线（用 analysis.pitch，confidence 小于 0.5 的点画成淡色虚线）。
6. 分析中显示进度遮罩；分析失败显示错误条，含 error_code、message 和两个按钮：「重试」「降级为整段修音」（后者把 selectedBar 设为全曲范围）。

验收：导入 30 秒 wav → 点分析 → mock 1.2 秒后小节色块出现，第 3 小节高亮，点击可切换选中，边界可拖。
```

---

## Prompt 5 · 对话输入 + 计划确认面板（Day2 上午，M2 关键）

```
在右栏实现对话与计划确认。

一、ChatInput：
- 输入框加发送按钮（Enter 发送，Shift+Enter 换行），预置快捷短语按钮"只把人声第 3 小节高音修准"。
- 发送时调用 store.runParseIntent(text)，把当前 project_state（track 摘要 + bars + selectedBarIndex）一并传给后端。
- 三态清晰可见：parsing 显示骨架屏加"正在解析意图…"；失败显示错误卡片（error_code + message + 「重试」+「用规则模板」两个按钮）；成功滚动到计划面板。

二、PlanPanel（计划确认面板）：
- 一次只显示 1 条操作，卡片标题 correct_pitch。
- 参数全部可编辑并双向绑定到 store.plan：
  start_sec / end_sec：数字输入框（步进 0.01），修改后同步更新波形上的 Region；反过来拖 Region 也要更新这里
  mode：下拉（scale / fixed / auto）
  scale：下拉（C_major / A_minor / chromatic）
  strength：滑杆 0~1，步进 0.05，右侧显示数值
- 本地预检：end_sec 大于 start_sec、区间不超出音频时长、区间长度不超过 15 秒，违规时禁用「确认执行」并给红字提示。
- 底部「确认执行」「取消」按钮，驱动状态机 plan_pending → executing / idle。

验收：输入一句话 → 1 秒后出现可编辑计划 → 改 strength 和时间 → 波形 Region 跟着动 → 确认按钮可点。
```

---

## Prompt 6 · 执行进度 + A/B 对比 + 偏差曲线（Day2 下午）

```
实现执行反馈与效果对比，这是路演最出效果的部分。

一、ProgressBar：
- 确认后进入 executing，显示进度条加"已用时 X.X 秒"实时计时加「取消」按钮。
- 后端不给进度事件，所以用假进度：0 到 85% 在预估耗时（默认 30 秒）内缓动逼近，收到 render_result 才跳 100%。
- 超过 45 秒显示黄色提示"渲染较慢，可取消后改用 16kHz 兜底"。

二、ABCompare：
- 两个 WaveSurfer 实例：上=原声（track.url），下=修音后（render.output_path，mock 下用同一个 url）。
- 一个 A/B 切换开关，切换时必须 seek 到同一个 currentTime 后继续播放，听感上无缝。
- 可选开关：只循环播放当前选中 bar 区间。

三、CentsChart：
- 顶部两个大数字：修正前平均偏差 before_cents、修正后 after_cents，中间画箭头，下降时显示绿色降幅百分比。
- 下方折线图：用 render.curve 画 before/after 两条线，横轴时间秒，纵轴 cents，画 0 基准线。用内联 SVG 手撸，不要引入图表库。

验收：确认执行 → 进度条走完 → A/B 能切换且位置同步 → 大数字 42 → 8 且折线明显收敛。
```

---

## Prompt 7 · 回退 + 历史日志 + 工程自动保存（Day2 晚上）

```
实现回退与持久化，闭环最后一块。

一、回退：
- 顶栏和渲染结果卡片各放一个「回退」按钮，点击后 status 回到 plan_pending，播放源切回原声，计划参数保持可编辑，不清空 history。
- 回退后再次「确认执行」必须能重新渲染，对应 demo 脚本里"拖动强度重渲染一次"那一段。

二、HistoryPanel：
- 倒序列表，每条含：时间、指令原文、关键参数（区间 / mode / strength）、结果（before → after cents）、状态徽章（已渲染 / 已回退 / 失败）。
- 点某条历史可"恢复该参数"到当前 plan。

三、工程自动保存：
- 组织成 ProjectFile：nodes / analysis / history / version=1.0。
- Electron 下写到 userData/project.json（走 window.api，main 进程用 fs 写）；浏览器下写 localStorage。
- 触发时机：状态机每次变更，以及参数修改 debounce 1 秒。启动时自动读回并恢复（音频文件本身不恢复，提示"请重新导入音频"）。

四、全链路耗时埋点：console 打印每段耗时（导入 / 分析 / 解析 / 渲染 / 总计），并在顶栏右侧显示"本次全链路 XX.X 秒"，Day3 排练直接看这个数。

验收：完整跑一遍 输入 → 确认 → 渲染 → A/B → 回退 → 改参 → 重渲染，history 有 2 条记录，刷新页面后节点图和历史还在。
```

---

## Prompt 8 · Plan B 兜底与演示打磨（Day3）

```
做演示前的稳定性收尾，不加新功能。

1. 降级自检：启动时检测 window.api 是否存在，不存在时顶栏显示黄色徽章"浏览器兜底模式（mock）"，保证 Electron 崩了能秒切浏览器演示。
2. 全局错误边界：React ErrorBoundary 包住三栏，任何组件崩溃只崩那一栏，显示"该面板异常，点击重置"，不白屏。
3. 断网兜底 UI：parse_intent 返回 PARSE_FAILED 或超时 8 秒时，自动弹出「使用规则模板」按钮，点击后本地生成一条 plan（第 N 小节映射到对应 bars 区间，mode=scale，strength=0.8），让 UI 链路继续走完。
4. 演示模式快捷键：Ctrl+Shift+D 一键重置到初始状态并自动导入预置素材，方便走查 5 次。
5. 窗口固定 1600x1000，字号整体调大一档（正文 15px，数字指标 32px），保证投影可读。
6. 视觉打磨：状态徽章配色、节点描边动效、按钮 hover，不要改任何逻辑。

完成后跑 5 次完整走查，把每次的全链路耗时列给我。
```

---

## 投喂节奏建议

| 时间 | 给哪几条 |
|---|---|
| D-2 晚 | Prompt 0 |
| D-1 全天 | Prompt 1（重点，务必跑通 mock 全链路） |
| Day1 上午 | Prompt 2 |
| Day1 下午 | Prompt 3 |
| Day1 晚 | Prompt 4 → 联调 M1 |
| Day2 上午 | Prompt 5 |
| Day2 下午 | Prompt 6 |
| Day2 晚 | Prompt 7 → 联调 M2 |
| Day3 上午 | Prompt 8 |

**卡住时的处置**：任何一条 Prompt 超过 2 小时没验收通过，立刻按方案第 18 页的砍项顺序降级（模板保存 → 多轮修改 → Demucs → 真实小节定位），不要在一个组件上死磕。
