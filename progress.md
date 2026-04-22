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
