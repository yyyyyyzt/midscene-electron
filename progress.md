# Bridge 模式专用化 — 进度与计划

**目标**：产品明确只支持 **Bridge**（Midscene Chrome 扩展 + 本机端口），面向「用户已在桌面 Chrome 登录、附加当前标签」场景；简化依赖与安装（避免 Puppeteer 下载 Chrome for Testing），便于 Windows 打包分发。

**文档状态**：计划已写入；后续实施请在各阶段完成后勾选并补充日期/备注。

---

## 一、现状摘要

| 区域 | 当前行为 |
|------|-----------|
| 默认连接 | `config-store.js` 默认已是 `connectMode: 'bridge'` |
| 运行逻辑 | `src/chrome-runner.js` 仍实现 `launch` / `cdp` / `bridge` 三路；`launch` 会拉系统 Chrome 或内置 Chromium |
| 依赖 | 根目录显式依赖 `puppeteer` + `postinstall` 执行 `puppeteer-postinstall.cjs`（易触发下载失败或缓存残缺） |
| UI | `renderer/index.html` 仍提供连接方式下拉（含 CDP、启动新 Chrome） |
| 上游 | `@midscene/web` 已自带 `puppeteer-core`；`puppeteer` 在 peer 中为 **optional**（Bridge 路径不强制要求根项目安装完整 `puppeteer`） |

---

## 二、与「仅 Bridge」不一致或可精简项

1. **`src/chrome-runner.js`**：`import puppeteer` 与 `PuppeteerAgent` 仅服务于 CDP/Launch；Bridge 分支只用 `AgentOverChromeBridge`。专用化后可删除非 Bridge 分支及相关类型。
2. **`package.json`**：可移除 `puppeteer` 与 `postinstall`（或改为无下载的占位脚本），安装体积与 `npm i` 失败面下降。**实施前需在干净目录跑一次 `npm i` + 运行任务**，确认 `@midscene/web/bridge-mode` 在无根级 `puppeteer` 时仍可解析所有运行时依赖。
3. **`scripts/puppeteer-postinstall.cjs`**：无 `puppeteer` 完整包时可删除；若短期保留 `puppeteer` 仅作 peer 满足，可改为文档要求 `PUPPETEER_SKIP_DOWNLOAD=1`，长期仍以移除为宜。
4. **`src/config-store.js`**：`connectMode`、`cdpWsUrl` 可收敛为仅 `bridgePort`（或保留 `connectMode` 固定为 `'bridge'` 以兼容已存在的 `app-config.json`）。需在 `loadConfig` 中对旧配置做迁移：忽略或清空 `launch`/`cdp` 相关字段。
5. **`renderer/index.html` + `renderer/index.js`**：去掉连接方式选择与 CDP 表单项；保留 **Bridge 端口** 与说明文案；保存设置时只提交 `bridgePort`（及必要的模型字段）。
6. **`src/main.js`**：`task:run` 传入的 `connectMode`/`cdpWsUrl` 与精简后的配置结构对齐。
7. **`README.md`（及如有 `AGENTS.md`）**：架构说明改为「仅 Bridge」；删除或标注为历史的 Launch/CDP 说明；补充 Windows 打包前提：用户需安装 Chrome + Midscene 扩展。

---

## 三、分阶段实施计划

### 阶段 A — UI 与配置收敛（行为以 Bridge 为准，可暂保留后端多模式代码）

- [ ] 移除连接方式下拉及 CDP 相关 DOM；默认展示 Bridge 端口与扩展文档链接。
- [ ] `renderer/index.js`：删除 `connectMode`/`cdpWsUrl` 的读写与 `updateConnectModeUi`；保存应用设置时只写 `bridgePort`（若仍调用 `saveConfig`，可传固定 `connectMode: 'bridge'` 直至阶段 B）。
- [ ] 用户文案：强调「仅支持 Bridge」，避免与已删除选项矛盾。

### 阶段 B — 运行时与配置模型

- [ ] `chrome-runner.js`：删除 `cdp` / `launch` 分支；`runNaturalLanguageTask` 仅保留 Bridge 逻辑；移除对 `puppeteer`、`@midscene/web/puppeteer` 的 import（若整文件无引用）。
- [ ] `config-store.js`：类型与默认值去掉 `launch`/`cdp`；`loadConfig` 将历史 JSON 中的 `connectMode` 归一为 `bridge`，并不再向外暴露 CDP 字段（或保留读入但忽略，避免破坏旧文件结构——二选一在提交说明中写清）。
- [ ] `main.js`：`runNaturalLanguageTask` 调用参数与新的 `loadConfig` 形状一致。

### 阶段 C — 依赖与安装链路

- [ ] `package.json`：移除 `puppeteer`；移除 `postinstall`（或替换为不再下载浏览器的脚本）。
- [ ] 删除 `scripts/puppeteer-postinstall.cjs`（若已无引用）。
- [ ] 在干净 clone 下执行 `npm i`（可配合现有 `.npmrc` 的 `audit=false` 等），确认无 postinstall 错误且应用可启动。
- [ ] 可选：`package-lock.json` 随依赖变更更新并提交。

### 阶段 D — 文档与分发说明

- [ ] 更新 `README.md`：连接方式仅 Bridge；Windows 用户扩展 + 端口说明；与 exe 分发相关的先决条件。
- [ ] 若有 Electron 打包脚本/README 小节，注明不需要随应用分发 Puppeteer 自带浏览器。

---

## 四、验收标准（阶段 C+D 完成后）

1. 未安装完整 `puppeteer` 时，`npm i` 可成功完成（无浏览器下载 postinstall）。
2. 配置界面仅 Bridge 相关项；修改端口保存后重启应用仍生效。
3. 桌面 Chrome 已装 Midscene 扩展并监听时，点击「运行」可完成一次自然语言任务（与现网 Bridge 流程一致）。
4. 旧版 `app-config.json` 含 `connectMode: 'cdp'` 或 `launch` 时，应用不崩溃且行为归一为 Bridge（或给出一次性提示，由实现阶段 B 时决定）。

---

## 五、风险与待验证点

- **`@midscene/web` 版本升级**：peer 与内部依赖可能变化；升级后重复跑验收。
- **Electron 打包**：确认 `asar` 打包后 `bridge-mode` 与 socket 监听无额外 native 模块问题（一般纯 JS）。
- **本计划不自动执行代码修改**；实施时建议按阶段 A→B→C→D 提交，便于回滚与 code review。

---

## 六、进度勾选（实施时更新）

| 阶段 | 状态 | 备注 |
|------|------|------|
| A UI/配置 | 待开始 | |
| B 运行时 | 待开始 | |
| C 依赖 | 待开始 | |
| D 文档 | 待开始 | |
