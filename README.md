# Midscene 桌面浏览器助手

基于 **Electron** + **Midscene.js**（`@midscene/web`）的桌面工具：在**已登录的桌面 Chrome** 上执行自然语言自动化（推荐 **Bridge + Midscene 扩展**），支持多次调试、沉淀业务上下文，并用**单行 JSON 任务包**通过微信等渠道分享给同事（**不含 API Key**）。

macOS 开发验证与 Windows 日常使用均以「本机 Chrome + 登录态」为主流程。

---

## 典型工作流（与你描述的场景对齐）

1. **准备**：在桌面 Chrome 安装 [Midscene 扩展（Bridge 模式）](https://midscenejs.com/bridge-mode)；在本工具中配置各同事的 **API Key**（仅存本机）。
2. **登录**：同事用普通方式打开业务网站并完成登录（扫码 / 密码 / SSO），**不要**依赖「启动新 Chrome」模式（那是干净配置，没有 Cookie）。
3. **调试**：在「业务上下文」里逐步写入术语、菜单位置、校验规则；在「主任务」里写要执行的操作；反复点 **运行** 直到稳定。
4. **定稿传播**：点 **复制任务包**（单行 JSON），微信发给其他人；对方 **从剪贴板导入** 后，只需自己配置 Key、自行登录同一系统，再点运行。

任务包格式（`v` 为版本号，便于以后兼容升级）：

```json
{"v":1,"n":"可选名称","m":"主任务","c":"可选业务上下文"}
```

---

## 浏览器连接方式

| 模式 | 适用场景 |
| ---- | -------- |
| **Bridge（默认）** | 日常推荐。控制**已打开**的桌面 Chrome 当前标签，**复用登录态与 Cookie**。需安装 Midscene 官方扩展。 |
| **CDP** | 高级：Chrome 以 `--remote-debugging-port` 启动后，将 DevTools 的 **WebSocket 地址**（`ws://...`）粘贴到设置中；**不会**由本工具关闭你的浏览器。 |
| **启动新 Chrome** | 排障或无需登录的公开页；**不会**带上你在日常 Chrome 里的登录。 |

Bridge 默认监听本机端口 **3766**（可在界面修改），与 Midscene 文档一致。

---

## 实现计划（已完成项）

1. **脚手架**：`package.json` 使用 `"type": "module"`，入口 `src/main.js`，预加载 `src/preload.js`，渲染进程为静态 `renderer/`。
2. **多连接策略**：`src/chrome-runner.js` — `launch` 使用 Puppeteer + `PuppeteerAgent`；`bridge` 使用 `AgentOverChromeBridge` + `connectCurrentTab`；`cdp` 使用 `puppeteer.connect` + `PuppeteerAgent`。
3. **任务与传播**：主任务 + 业务上下文合并为一条模型提示（`mergeTaskPrompts`）；`src/task-bundle.js` 导出/导入单行 JSON；`src/recipe-store.js` 将草稿存 `userData/task-recipe.json`。
4. **配置持久化**：`src/config-store.js` — `app-config.json` 含模型参数与连接方式（明文 JSON，原型阶段；生产可换钥匙串）。
5. **界面**：连接方式、Bridge 端口、CDP ws、任务包复制/导入、草稿保存。

---

## 快速开始

### 环境要求

- Node.js **≥ 20**
- **Google Chrome**（稳定版）与 **Midscene Chrome 扩展**（Bridge 模式）

### 安装与运行

```bash
cd midscene-desktop-app
npm install
npm start
```

若希望 **跳过** Puppeteer 下载 Chromium（日常只用 Bridge/CDP/系统 Chrome），可在安装前设置：

```bash
export PUPPETEER_SKIP_DOWNLOAD=1
npm install
```

---

## 模型与 OpenAI Key 配置

| 界面字段 | Midscene 键 |
| -------- | ----------- |
| API Key | `MIDSCENE_MODEL_API_KEY` |
| Base URL | `MIDSCENE_MODEL_BASE_URL` |
| 模型名称 | `MIDSCENE_MODEL_NAME` |
| 模型族 | `MIDSCENE_MODEL_FAMILY` |

官方说明：[Model configuration](https://midscenejs.com/model-config.html)、[Common model configuration](https://midscenejs.com/model-common-config.html)。

---

## 报告与运行产物

Midscene 运行目录：`{Electron userData}/midscene_run`（报告、日志以 Midscene 版本为准）。

---

## 安全提示

- API Key 与任务包分离：**任务包不要包含密钥**；转发前确认微信/群聊可信。
- 明文 `app-config.json` 仅适合个人开发机；生产环境请考虑系统钥匙串或企业密钥托管。

---

## Windows 后续工作（占位）

- 安装包签名、自动更新、企业内扩展分发说明。
- CDP 启动 Chrome 的快捷方式或文档化脚本。

---

## 手动测试建议

1. Bridge：扩展已启用 → 打开已登录业务页并置于前台 → 本工具选 Bridge → 运行简单指令（如「总结当前页顶部标题」）。
2. 任务包：填写主任务与业务上下文 → 复制任务包 → 清空表单 → 从剪贴板导入 → 确认字段一致。
3. CDP（可选）：用远程调试端口启动 Chrome，填入 `ws://` 地址，运行同一任务。
4. 检查 `userData/midscene_run` 是否生成报告；模型族与厂商文档是否一致。
