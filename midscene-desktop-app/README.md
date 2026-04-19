# Midscene 桌面浏览器助手

基于 **Electron** + **Midscene.js**（`@midscene/web` + `PuppeteerAgent`）的最小桌面工具：输入自然语言任务后，由主进程启动 **有界面** 的 Chromium 系浏览器并调用 Midscene 的 `agent.ai()` 执行自动化。

当前目标环境以 **macOS 上的开发自测** 为主；**Windows** 打包与路径适配留待后续迭代。

---

## 实现计划（已完成项）

1. **脚手架**：`package.json` 使用 `"type": "module"`，入口 `src/main.js`，预加载 `src/preload.js`，渲染进程为静态 `renderer/`。
2. **浏览器**：`src/chrome-runner.js` 使用 Puppeteer；在 macOS / Windows 上优先 `channel: 'chrome'` 启动系统 **Google Chrome**，失败则回退到 Puppeteer 自带的 Chromium（便于无 Chrome 机器排错）。
3. **Midscene**：对页面构造 `PuppeteerAgent`，通过 `modelConfig` 传入 `MIDSCENE_MODEL_*`，调用 `agent.ai(task)` 做自动规划与执行。
4. **配置与持久化**：`src/config-store.js` 将 API Key、Base URL、模型名、模型族写入 Electron `userData` 目录下的 `app-config.json`（简单明文 JSON，适合本地原型；生产环境请考虑系统钥匙串等方案）。
5. **界面**：任务文本框、运行按钮、模型配置表单、日志区；通过 `contextBridge` 暴露 `desktopApi`。
6. **文档**：本 README 说明安装、模型配置、报告目录与手动测试要点。

---

## 快速开始

### 环境要求

- Node.js **≥ 20**
- macOS：建议安装 **Google Chrome**（稳定版），以便使用系统 Chrome 通道。

### 安装与运行

```bash
cd midscene-desktop-app
npm install
npm start
```

若希望 **跳过** Puppeteer 下载 Chromium（仅使用系统 Chrome），可在安装前设置：

```bash
export PUPPETEER_SKIP_DOWNLOAD=1
npm install
```

---

## 模型与 OpenAI Key 配置

界面中字段与 Midscene 环境变量对应关系如下（写入 `modelConfig`）：

| 界面字段   | Midscene 键                 |
| ---------- | --------------------------- |
| API Key    | `MIDSCENE_MODEL_API_KEY`    |
| Base URL   | `MIDSCENE_MODEL_BASE_URL`   |
| 模型名称   | `MIDSCENE_MODEL_NAME`       |
| 模型族     | `MIDSCENE_MODEL_FAMILY`     |

默认值偏向 OpenAI 官方兼容端点；若使用其它厂商，请将 Base URL 设为对方 **OpenAI 兼容** 的 `/v1` 根路径，并按厂商文档填写 `MIDSCENE_MODEL_NAME` 与 **`MIDSCENE_MODEL_FAMILY`**（该字段影响坐标与视觉理解策略，务必与所用模型族一致）。

官方说明可参考：[Model configuration](https://midscenejs.com/model-config.html)、[Common model configuration](https://midscenejs.com/model-common-config.html)。

---

## 报告与运行产物

每次执行会将 Midscene 运行目录设为：

`{Electron userData}/midscene_run`

控制台可能出现报告路径提示；也可在该目录中查看 HTML 报告与日志（具体文件名以 Midscene 版本为准）。

---

## 安全提示

- API Key 以 **明文 JSON** 存储在用户目录，请勿在共享电脑或不可信环境中使用。
- 自然语言自动化会操作真实浏览器，请仅对自己信任的网站与账号进行测试。

---

## Windows 后续工作（占位）

- 验证 `puppeteer.launch({ channel: 'chrome' })` 在目标 Windows 版本上的行为。
- 安装包签名、自动更新、以及可选的「固定 Chrome 路径」配置项。

---

## 手动测试建议（由你本地执行）

1. 填写有效的 API Key 与模型参数后点击「保存配置」，重启应用确认配置仍在。
2. 简单任务：`打开 https://example.com 并说明页面主标题含义`。
3. 复杂一点的表单/搜索流程，观察 Chrome 窗口是否按步骤操作。
4. 检查 `userData/midscene_run` 是否生成报告；若执行失败，查看日志区报错与 Midscene 文档中的模型族配置是否匹配。
