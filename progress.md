# Bridge 巡检工作台 — 进度与路线图

> 规范与边界以 `AGENTS.md` 为准；本文件记录**已实现能力**与**后续方向**，便于人类与 Agent 对齐。

## 产品快照

- **形态**：Electron 工作台 + **仅** Midscene **Bridge** 模式 + 本机桌面 Chrome（专用/半专用机）。
- **执行**：`newTabWithUrl`（默认）/ `currentTab`（调试）；任务**串行**；可选 Recorder **YAML 或 Playwright 代码**逐步重放 + `aiAct` 兜底。
- **主链**：连接 Bridge →（可选）流程步骤 → `aiAssert` → `aiQuery` → 规则引擎 → 执行记录与本地通知。
- **有流程时**：跳过独立「页面就绪」`aiWaitFor`，避免与录制脚本里「导航后的最终状态」顺序冲突（见 `inspection-runner.js`）。

---

## 已实现（按能力域）

### Bridge 与运行时

- [x] `chrome-runner.js`：`newTabWithUrl` / `currentTab`；Bridge agent 生命周期与报告路径。
- [x] `inspection-runner.js`：分阶段执行（connect / ready / flow / assert / extract / rules）、总超时、有 `flowYaml` 时跳过独立 ready。
- [x] `step-runner.js` + `playwright-parser.js` + `yaml-flow.js`：YAML / Playwright 统一解析与逐步执行。

### 任务、调度、记录

- [x] `task-store.js`：`InspectionTask`（含 `flowYaml`、`aiFallback`、`when` 规则语义等）。
- [x] `scheduler.js`：定时 tick、工作时段、重试（仅 error）、与告警状态机联动（`reportFailure` / `reportRecovery`）。
- [x] `run-store.js`：执行记录、索引、与详情弹窗（阶段时间线、规则卡片、Markdown 导出）。

### 告警与通知

- [x] `alert-store.js`：按任务合并的告警事件（`active` / `ack` / `silenced` / `recovered`）；恢复由调度器在任务 `ok` 时自动写入。
- [x] `notifier.js`：Electron 通知 + 可选声音。
- [x] **告警中心 UI**：每条仅 **确认无误**（ack）、**查看执行详情**、**删除**；角标仅统计「未处理」(`active`)。

### 工作台 UI

- [x] 导航：总览 / 任务 / 执行记录 / 告警 / 设置。
- [x] AI 帮手 `task-generator.js` + 5 步向导；模型预设与高级 Planning / Insight。

---

## 进行中 / 近期

- [ ] 任务导入导出（JSON 包等）。
- [ ] Recorder 与流程编辑体验增强（在不大改「结构化任务为主」的前提下）。

---

## 远期（在不变更 Bridge 专机前提下适度通用化）

在 **不引入 CDP/Launch、不默认多任务并发** 的前提下，可逐步支持：

- **简单定时自动化**：例如固定入口 + 少量 `aiTap` / `aiWaitFor` + 无规则或弱规则（「打卡类」流程），仍走同一执行链与同一 Chrome 会话。
- **干扰控制**：依赖用户自觉使用**专用或闲置时段的机器**；产品侧保持 `newTabWithUrl` 默认可关标签、串行队列，避免与日常办公浏览器抢同一会话。

实现任何新能力前仍应满足：`AGENTS.md` 第 11 节「不要做的事情」与 Bridge-only 约束。

---

## 数据文件（userData）

| 文件 / 目录 | 用途 |
|-------------|------|
| `app-config.json` | Bridge 端口、模型分层、通知偏好 |
| `tasks.json` | 任务列表 |
| `runs/`、`runs-index.json` | 执行记录与索引 |
| `alerts.json` | 告警事件 |
| `midscene_run/` | Midscene 报告与截图 |

---

## 已移除或弱化的历史表述

- 告警中心不再提供「静默」「手动标记恢复」等独立按钮；静默/恢复仍可由存储层与调度逻辑使用或保留字段兼容旧数据。
- 不再强调「从旧 task-recipe 迁移」等历史路径；若仓库中仍有一次性迁移代码，以源码为准。
