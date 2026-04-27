# Bridge 巡检工作台 — 总体进度

> 以 `AGENTS.md` 为最终规范。此文件是 milestone 进度与差异记录。
>
> 产品形态：**Bridge-only 的 Electron 巡检工作台**（Windows 专用值守电脑 + 桌面 Chrome + Midscene 扩展）。

---

## 里程碑 M1 — Bridge 专用化闭环

> 让执行路径与产品形态对齐到 Bridge-only；允许“当前标签 / 新建标签”两种附加方式。

- [x] `runtime/chrome-runner.js`：按 `runMode` 支持 `newTabWithUrl` / `currentTab`；默认 `newTabWithUrl`。
- [x] Bridge agent 保留一次性复用点，避免每个任务重复连接。
- [x] 为执行链提供 `aiWaitFor + aiAssert + aiQuery + rule` 的专用入口。
- [x] 提供手动测试入口（保留老 UI 的手动单任务执行，作为调试通道）。

## 里程碑 M2 — 单任务巡检闭环

- [x] 任务模型 `InspectionTask`（结构化配置 + schema 校验与默认值）。
- [x] 多任务存储 `tasks.json`（替代旧 `task-recipe.json`，老文件仅一次性迁移）。
- [x] 规则引擎 `rule-engine.js`：阈值 / 波动 / 缺失 / 登录失效 / 自定义 JS 表达式。
- [x] 执行器 `inspection-runner.js`：一次完整巡检流程 + 证据（截图 / 报告 / 原始提取 / 规则命中）。
- [x] 执行记录 `run-store.js`：按任务落目录，保留最近 N 次。
- [x] 调度器 `scheduler.js`：串行队列、间隔、工作时段、重试、超时。
- [x] 告警状态机 `alert-store.js`：未处理 / 已确认 / 已静默 / 已恢复，首发 + 合并 + 恢复。
- [x] 本地通知 `notifier.js`：Electron `Notification` + 可选声音（占位：系统默认）。
- [x] Electron 主进程：托盘常驻 + 主窗口隐藏到托盘。

## 里程碑 M3 — 工作台 UI

- [x] 左侧导航：总览 / 任务 / 执行记录 / 告警 / 设置。
- [x] 总览：Bridge 状态 + 今日执行次数 + 异常数 + 下次执行时间。
- [x] 任务列表：卡片展示 + 状态 + 快捷操作（运行、暂停、编辑、查看报告）。
- [x] 任务创建/编辑向导（5 步）：连接与运行方式 / 目标页面 / 就绪与取数 / 异常规则 / 调度与告警。
- [x] 执行记录页：时间、状态、耗时、提取结果 JSON、命中规则、报告入口、原始日志。
- [x] 告警中心：事件 + 生命周期按钮（确认 / 静默 / 恢复）。
- [x] 设置：Bridge 端口 + 模型分层配置 + 模型高级折叠面板。

## 里程碑 M4 — 高级能力

- [x] 高级模型策略：默认执行模型 + Planning 模型（可选）+ Insight 模型（可选）。
- [x] 模型配置按 Midscene 约定输出 `MIDSCENE_MODEL_*` / `MIDSCENE_PLANNING_MODEL_*` / `MIDSCENE_INSIGHT_MODEL_*`。
- [ ] （预留）任务导入导出（YAML / JSON Bundle）。
- [ ] （预留）Recorder / YAML 集成增强。
- [x] 告警中心恢复通知（与状态机联动）。

## 里程碑 M5 — 普通用户友好化（AI 任务生成）

- [x] 后端 `runtime/task-generator.js`：调用 OpenAI 兼容 chat/completions，单次返回完整任务结构（含规则）。
- [x] 任务页默认入口改为「新建任务（AI 帮手）」对话框，用户输入一句中文即可生成任务草稿；「高级模式」5 步向导依然可用，且可从 AI 结果一键切到向导继续微调。
- [x] AI 生成结果展示为可读摘要（任务名 / URL / 间隔 / 业务背景 / 就绪 / 取数 / 规则），关键字段允许直接编辑后保存。
- [x] 设置页加入「模型预设」下拉，一键填充 `baseUrl` / `modelName` / `family`；豆包 Doubao-Seed-2.0 全系列内置（mini-260215 首推）。
- [x] 总览页新增「新手指引」：扩展安装 → 设置 → 新建任务 → Chrome 内允许连接。
- [x] AI 帮手与 Midscene 默认执行模型共用一组配置，单模型即可承担「生成 + 巡检 + 取数」。

## 里程碑 M7 — 复杂交互：YAML 操作流程

- [x] 引入 `js-yaml` + `runtime/yaml-flow.js`：解析 Recorder YAML（兼容完整 yaml / 仅 tasks / 仅 flow），抽取 `web.url / viewport`，描述每一步用于 UI 预览。
- [x] `InspectionTask.flowYaml` 字段；inspection-runner 在 `aiWaitFor` 与 `aiAssert` 之间新增 `flow` 阶段。
- [x] AI 帮手对话框增加可选「YAML 输入区」+「解析并预览」按钮；YAML 步骤摘要列表（动作 + 定位）。
- [x] 5 步向导第 3 步同时支持 YAML 粘贴 + 预览，与就绪/取数共用一屏。
- [x] 任务列表卡片显示「📜 含 流程」标记；详情弹窗的 phases 时间线展示 flow 步数。
- [x] task-generator 同时接收描述与 YAML，合成完整任务（entryUrl / extractPrompt / extractSchema / rules / flowYaml）。

## 里程碑 M8 — 严格按 Recorder 复现 + Playwright 代码 + AI 兜底

> 反馈：YAML 黑盒整体执行（runYaml）容易在某一步出错却看不到位置；同时 Recorder 还会产出 Playwright 代码，本质和 YAML 一样都是 ai* 调用列表，但更直观。

- [x] 新增 `runtime/playwright-parser.js`：纯正则 + 平衡括号 + JSON 修补，提取 `page.goto / setViewportSize` 与 `aiTap / aiScroll / aiInput / aiKeyboardPress / aiWaitFor / aiAssert / aiQuery / aiAct / sleep` 调用。
- [x] `runtime/yaml-flow.js` 新增统一入口 `parseFlowInput`：自动识别 YAML / Playwright，输出与 step-runner 同构的 step 数组。
- [x] 新增 `runtime/step-runner.js`：**严格按录制顺序**逐步调用 `agent.aiTap/aiScroll/...`，每步 `onStep` + 结构化 StepResult；任务可开 `aiFallback`，失败时退回 `agent.aiAct(自然语言)` 一次性补救。
- [x] `inspection-runner` 的 flow 阶段改用 step-runner，错误信息精确到「第 X/Y 步：[action] 定位 → 错误」。
- [x] `task-store.aiFallback` 字段；5 步向导加复选框；任务卡片显示来源（YAML / PW）。
- [x] 详情弹窗 flow 阶段展开后展示**逐步表格**（动作 / 定位 / 状态 / 耗时 / 错误 / 兜底错误）；Markdown 复制也带逐步表，方便贴给模型 debug。
- [x] IPC `yaml:parse` → `flow:parse`；返回 source 标识；前端「解析并预览」按钮文案改为「解析并预览步骤」。

## 里程碑 M6 — 规则语义修正与执行格式化

- [x] **规则语义修正**：增加 `when` 字段（`fail` 默认 / `pass` 可选），普通用户描述「< 10 报警」直接对应 `op:'<', value:10, when:'fail'`；不再需要反向思维写阈值。AI 系统提示词同步修正，并给两个示例。
- [x] 规则结果输出 `RuleResult{ triggered, conditionMet, conditionLabel, actual, when, severity, message, error }`，向前兼容 `ok=!triggered`。
- [x] 执行流程结构化：`inspection-runner` 输出 `phases[]`（connect / ready / assertNotLogin / extract / rules），每步含状态、耗时、详情、错误。
- [x] 执行详情弹窗：阶段时间线表格、提取结果 JSON、规则结果卡片（条件 / 实际值 / 触发与否 / 错误）、执行日志；提供「复制为 Markdown」按钮，方便粘给 LLM debug。
- [x] 5 步向导规则编辑器加 `when` 切换；新建阈值规则默认 `op:'<'`、默认 `when:'fail'`，更贴近报警直觉。
- [x] 执行记录列表的「命中规则」改为「{触发}/{总数} 触发」表达。

---

## 迁移说明

- 旧 `task-recipe.json` 中的 `mainPrompt` / `businessContext` 会在首次启动时合并为一条 `legacy` 来源的任务样板，供用户参考或改造；原文件保留供回滚，但本产品不再读写。
- 旧 `app-config.json` 的 `apiKey / baseUrl / modelName / modelFamily` 升级到“默认执行模型”组；新字段 `planningModel` / `insightModel` 默认留空并走回落逻辑。
- `runMode` 引入默认值 `newTabWithUrl`，老调用链改调 `connectCurrentTab` 时需显式切换。

---

## 边界重申（避免返工）

1. 不再引入 CDP / Launch / 自启 Chromium / Puppeteer 启动选项。
2. 默认并发 = 1（串行）；Bridge 是共享的桌面 Chrome 会话。
3. 巡检判定优先 `aiQuery + 规则引擎`；`aiAssert` 只做登录页 / 错误页 / 空白页等粗粒度判断。
4. Planning 模型不是“纯文本 LLM 专用通道”。默认模型必填且必须是视觉多模态。
