# Bridge 巡检工作台

面向 **Windows 专用值守电脑** 的 **Electron 巡检工作台**，通过 [Midscene](https://midscenejs.com/) 的 **Chrome Extension Bridge 模式** 驱动已登录的桌面 Chrome，定时对业务后台进行巡检、取数、规则判定和告警。

> 本产品不是通用自动化平台。请先阅读 `AGENTS.md` 明确产品边界。

## 核心特性

- **仅 Bridge 模式**：复用用户手工登录好的桌面 Chrome 会话，不启动 Chromium / 不走 CDP / 不内置下载浏览器。
- **专用值守定位**：定时任务默认 `newTabWithUrl`，手动调试使用 `currentTab`。
- **结构化任务**：每个任务包含入口 URL、就绪条件、`aiAssert`、`aiQuery`、规则引擎、调度与告警。
- **规则引擎**：数值阈值、字段缺失、JavaScript 表达式；对 `aiQuery` 返回值做判定。
- **调度串行**：共享同一桌面 Chrome 会话，按 FIFO 串行执行；支持工作时段与失败重试。
- **告警状态机**：未处理 / 已确认 / 已静默 / 已恢复；首发通知 + 持续合并 + 恢复通知。
- **本地存储**：配置 / 任务 / 执行记录 / 告警 全部 JSON 文件，位于 Electron userData。
- **分层模型**：默认执行模型（必填、视觉多模态） + 可选 Planning / Insight 高级模型。

## 运行时前提

目标机器必须满足：

1. Windows（macOS 可作为开发验证）
2. 已安装 Google Chrome
3. 已安装 [Midscene Chrome 扩展](https://midscenejs.com/bridge-mode) 并切换到 Bridge 模式
4. 业务系统已在 Chrome 中手工完成登录
5. 建议使用专用电脑长期保持登录态与网络

## 安装与运行（开发）

```bash
npm install
npm start
```

启动后：

1. 打开应用 → 设置，填写 Bridge 端口（默认 3766）与默认执行模型（API Key / BaseURL / 模型名 / Family）。
2. 任务 → 新建任务，按 5 步向导完成：连接方式 → 目标页面 → 就绪与取数 → 规则 → 调度与告警。
3. 打开桌面 Chrome 的 Midscene 扩展 → Bridge Mode → 允许连接；然后在应用中点击「立即执行」或等待调度触发。

## 任务执行流程（固定模板）

1. 连接 Bridge（`newTabWithUrl` 默认 / `currentTab` 调试）
2. `aiWaitFor` 等待页面就绪
3. `aiAssert` 校验非登录页 / 非错误页 / 非空白页
4. `aiQuery` 按 Prompt + Schema 提取结构化 JSON
5. 规则引擎（`threshold` / `missing` / `expression`）判定异常
6. 保存执行记录（提取结果 / 规则判定 / 日志 / 报告路径）
7. 触发告警 / 恢复通知

## 数据与存储

所有文件在 Electron userData 下：

- `app-config.json`：Bridge 端口、模型分层配置、通知偏好
- `tasks.json`：任务列表
- `runs/`：每次执行一个 JSON；同一任务保留最近 100 次
- `runs/runs-index.json`：按 taskId 的 runId 倒序索引
- `alerts.json`：告警状态机事件
- `midscene_run/`：Midscene 生成的报告与截图

## 关于模型配置

- **默认执行模型**必填，必须是支持视觉的多模态模型，负责元素定位与所有未单独配置的意图。
- **Planning 模型**（可选）：负责 `ai` / `aiAct` 的任务规划。不要假设它是纯文本 LLM，建议同样选择多模态模型。
- **Insight 模型**（可选）：负责 `aiQuery` / `aiAssert` / `aiWaitFor` / `aiAsk`，对巡检取数尤为重要。
- 三者按 Midscene 约定映射为 `MIDSCENE_MODEL_*` / `MIDSCENE_PLANNING_MODEL_*` / `MIDSCENE_INSIGHT_MODEL_*` 环境变量。

## 非目标（请勿回退）

- ❌ 不提供 CDP / Launch / 内置 Chromium / 自动发现调试端口等选项。
- ❌ 不把 Electron 作为目标业务系统的容器。
- ❌ 不默认并发执行多个 Bridge 任务。
- ❌ 不先做 YAML 编辑器。`YAML` 仅保留作为未来的辅助能力。

## 里程碑

见 [`progress.md`](./progress.md)。
