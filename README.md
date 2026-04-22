# Midscene 桌面浏览器助手

基于 **Electron** + **Midscene.js**（`@midscene/web`）的桌面工具：在**已登录的桌面 Chrome** 上通过 **Bridge + Midscene 扩展** 执行自然语言自动化，支持多次调试、沉淀业务上下文，并用**单行 JSON 任务包**通过微信等渠道分享给同事（**不含 API Key**）。

本工具**仅支持 Bridge 模式**，面向「用户已在桌面 Chrome 登录、附加当前标签」这一场景；不内置或下载额外浏览器，便于 Windows 打包分发。

macOS 开发验证与 Windows 日常使用均以「本机 Chrome + 登录态」为主流程。


## 安装与运行

```bash
cd midscene-desktop-app
npm install
npm start
```

## Windows 分发前提

- 用户机需安装 **Google Chrome** 与 **Midscene Chrome 扩展**（手动或企业内分发）；扩展启用后会连接到本工具监听的 Bridge 端口（默认 3766）。
