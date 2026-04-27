# Bridge 自动化工作台

面向 **Windows 专用或闲置时段电脑** 的 **Electron 自动化工作台**：默认场景是 **后台报表巡检**（取数 + 规则 + 告警），同一套 **Bridge-only** 能力也可承载 **简单定时流程**（例如固定步骤的重复操作），前提是接受与巡检相同的 **单 Chrome 会话、串行执行**，不干扰日常办公主力机上的浏览器。

对于可信内网系统，本产品优先鼓励更稳定、省 token 的 **开发者取数模式**：在已登录的真实 Chrome 页面上下文中执行 `fetch` / XHR / JavaScript，直接复用 Cookie、登录态、CSRF token 与页面内动态变量，拿到 JSON 后交给规则引擎判断；视觉 AI 与 Recorder 步骤更多作为无接口或复杂导航时的兜底能力。

通过 [Midscene](https://midscenejs.com/) 的 **Chrome Extension Bridge 模式** 驱动本机已登录的 **桌面 Google Chrome**（不启动内置 Chromium、不走 CDP）。

> 连接方式与产品边界见 `AGENTS.md`；实现进度与路线图见 `progress.md`。

## 核心特性

- **AI 帮手新建任务**：一句中文描述 → 模型生成结构化任务（入口 URL、`aiQuery`、Schema、规则、调度与告警等）；可附带 Recorder **YAML 或 Playwright**，系统自动识别并逐步重放。
- **开发者取数模式（规划中）**：面向懂技术的内网使用者，从 DevTools 复制 XHR / fetch 请求或编写页面上下文 JS，直接获取接口 JSON / DOM / 全局状态，再用 JSONPath / JS 字段映射和规则引擎判断。
- **复杂交互**：Recorder 输出的 **YAML 或 Playwright** 粘贴进任务后，**严格逐步重放**（`aiTap` / `aiScroll` / `aiWaitFor` 等），可选 `aiAct` 兜底；**有操作流程时**不先跑独立的「页面就绪」，避免与录制脚本里最终断言顺序冲突。Recorder 主要用于导航、筛选、打开弹窗等动作，不建议作为长期稳定取数的唯一方式。
- **模型预设**：设置页内置豆包 Doubao-Seed-2.0 系列等一键填充；**默认执行模型**须为视觉多模态；可选 Planning / Insight。
- **仅 Bridge**：复用用户手工登录好的桌面 Chrome；**不**提供 CDP / Launch / 内置浏览器选项。
- **默认值守策略**：定时任务默认 `newTabWithUrl`；调试可用 `currentTab`；调度 **FIFO 串行**。
- **规则引擎**：阈值、缺失、JS 表达式；对 `aiQuery` 返回值判定；适合巡检，也可用于「流程跑完后的简单检查」。
- **告警**：本地通知 + 可选声音；告警中心每条仅 **确认无误**、**查看执行详情**、**删除**；任务恢复成功时自动标记告警已恢复。
- **本地存储**：任务、配置、执行记录、告警均为 JSON / 目录，位于 Electron `userData`。
- **分层模型**：`MIDSCENE_MODEL_*` / `MIDSCENE_PLANNING_MODEL_*` / `MIDSCENE_INSIGHT_MODEL_*`。

## 运行时前提

1. Windows（macOS/Linux 可用于开发）
2. 已安装 Google Chrome
3. 已安装 [Midscene Chrome 扩展](https://midscenejs.com/bridge-mode) 并启用 Bridge
4. 目标站点已在 Chrome 中手工登录（本产品不做自动登录）
5. 建议使用 **专用或约定无人值守时段** 的机器，避免与人工操作抢同一浏览器会话

## 安装与运行（开发）

```bash
npm install
npm start
```

## 构建 Windows 安装包

使用 `electron-builder` 生成 Windows NSIS 安装器（`.exe`）。

```bash
npm install
npm run dist:win
npm run dist:win-portable
npm run dist
```

产出在 `dist/` 目录。

### 跨平台构建与签名

- 在 **Windows** 上打 Windows 包最省事。
- 在 macOS/Linux 上打 Windows 包可能依赖 Wine/Mono，详见 [electron-builder](https://www.electron.build/)。
- 代码签名：按需配置 `CSC_LINK` / `CSC_KEY_PASSWORD` 等，见官方文档。

### 自定义图标（可选）

将 `build/icon.ico`（Windows）、`build/icon.icns`（macOS）、`build/icon.png`（Linux）放入仓库 `build/`。

### 用户数据目录

数据写入 Electron `userData`（升级安装不丢任务与历史）：

- Windows: `%APPDATA%\Bridge 巡检工作台\`
- macOS: `~/Library/Application Support/Bridge 巡检工作台/`
- Linux: `~/.config/Bridge 巡检工作台/`

典型文件：`app-config.json`、`tasks.json`、`runs/`、`alerts.json`、`midscene_run/`。

## 快速上手（普通用户）

1. **设置 → 默认执行模型**：选预设或自填 Base URL、模型名、API Key → 保存。
2. **任务 → 新建任务（AI 帮手）**：描述监控目标；若有下拉/筛选等，先在 Chrome 用 Recorder 录一段，把 **YAML 或 Playwright** 粘进「操作流程」再生成。
3. Chrome 扩展切到 Bridge 并允许连接。
4. 在应用内「立即执行」或等待调度；结果在 **执行记录** 与 **告警中心**。

## 推荐取数策略

面向巡检任务时，按稳定性和成本建议采用以下顺序：

1. **接口 JSON 取数**：如果 DevTools 中能看到标准 XHR / fetch 响应，优先在页面上下文复用登录态直接请求，拿 JSON 后做字段映射和规则判断。
2. **页面脚本 / DOM 取数**：接口难复现但页面结构稳定时，使用页面上下文 JavaScript 读取表格、文本或业务前端全局状态。
3. **`aiQuery` 视觉取数**：没有清晰接口或 DOM 结构复杂时，由多模态模型理解页面并提取结构化 JSON。
4. **Recorder 流程复现**：用于到达目标状态，例如登录后进入菜单、选择时间范围、打开详情弹窗；避免把「点击空白区域」「固定滚动距离」作为主要取数方式。

## 下一步 UI 布局思路

为方便后续编码，开发者取数相关 UI 建议按「普通用户不被打扰，高级用户有完整工作流」组织：

1. **任务向导第三步改成取数工作区**：顶部用 Segmented Tabs 切换「开发者取数」「视觉取数」「仅流程操作」；默认推荐开发者取数，但保留 `aiQuery` 作为无接口兜底。
2. **开发者取数 Tab 采用左右布局**：
   - 左侧填写请求或脚本：请求名称、method、URL、headers、body、页面上下文 JS。
   - 右侧展示测试结果：原始 JSON、字段映射预览、规则命中预览、错误日志。
3. **字段映射独立成卡片**：支持从 JSON 预览里复制路径，配置输出字段名、取值表达式、类型与默认值，生成规则引擎输入。
4. **操作流程作为可折叠前置步骤**：Recorder / Playwright 用于进入页面、选择时间范围、打开弹窗，不占据取数区主视觉。
5. **执行记录详情增强**：按阶段展示「前置流程」「开发者取数 / aiQuery」「规则判定」，开发者取数任务应保存请求摘要、响应摘要、字段映射结果与规则命中。

## 任务执行流程（概念顺序）

1. 连接 Bridge（`newTabWithUrl` / `currentTab`）
2. **无**操作流程时：`aiWaitFor(readyPrompt)`；**有**操作流程时：跳过本步，由流程内步骤负责就绪
3. （可选）逐步重放 Recorder 步骤
4. `aiAssert` 粗检非登录页 / 错误页
5. 优先页面上下文接口 / JS 取数；无合适接口时使用 `aiQuery` + Schema 提取 JSON（简单任务可弱化）
6. 规则引擎判定
7. 写执行记录、通知与告警

## 非目标（请勿回退）

- 不提供 CDP / Launch / 内置 Chromium / 自动发现调试端口。
- 不把 Electron 当作业务系统主容器。
- 不默认多任务并发抢同一 Bridge 会话。
- 不把产品重心做成大型 YAML IDE。

## 里程碑与详细进度

见 [`progress.md`](./progress.md)。
