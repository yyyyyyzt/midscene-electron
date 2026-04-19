import puppeteer from 'puppeteer';
import { PuppeteerAgent } from '@midscene/web/puppeteer';
import { AgentOverChromeBridge } from '@midscene/web/bridge-mode';

/**
 * @typedef {'launch' | 'bridge' | 'cdp'} ConnectMode
 */

/**
 * @param {string} main
 * @param {string} businessContext
 */
export function mergeTaskPrompts(main, businessContext) {
  const m = (main || '').trim();
  const c = (businessContext || '').trim();
  if (!c) return m;
  return `【业务背景与术语（可多次迭代补充）】\n${c}\n\n【当前要执行的操作】\n${m}`;
}

const DEFAULT_AI_CONTEXT =
  'You automate only the browser tab under control. The user may have logged in beforehand; respect existing session and cookies. Prefer safe actions; never exfiltrate secrets or credentials.';

/**
 * @param {string} task merged full prompt
 * @param {{
 *   modelConfig: Record<string, string | number>;
 *   connectMode?: ConnectMode;
 *   cdpWsUrl?: string;
 *   bridgePort?: number;
 *   aiActContext?: string;
 * }} opts
 * @param {(line: string) => void} log
 */
export async function runNaturalLanguageTask(task, opts, log) {
  const mode = opts.connectMode || 'launch';
  const modelOpts = {
    modelConfig: opts.modelConfig,
    generateReport: true,
    autoPrintReportMsg: true,
    aiActContext: [DEFAULT_AI_CONTEXT, opts.aiActContext].filter(Boolean).join('\n'),
  };

  if (mode === 'bridge') {
    const port = typeof opts.bridgePort === 'number' && opts.bridgePort > 0 ? opts.bridgePort : 3766;
    log(
      `Bridge 模式：请在桌面 Chrome 中安装并启用 Midscene 扩展，本机将监听端口 ${port} 等待扩展连接…`,
    );
    const agent = new AgentOverChromeBridge({
      ...modelOpts,
      port,
      closeConflictServer: true,
    });
    try {
      log('正在附加到当前活动标签页（请确保目标页面已是前台标签）…');
      await agent.connectCurrentTab();
      log('已连接，开始执行自然语言任务（可能需要几分钟）…');
      const summary = await agent.ai(task);
      log(typeof summary === 'string' && summary ? summary : '任务已结束。');
    } finally {
      await agent.destroy().catch(() => {});
    }
    return;
  }

  if (mode === 'cdp') {
    const ws = (opts.cdpWsUrl || '').trim();
    if (!ws.startsWith('ws://') && !ws.startsWith('wss://')) {
      throw new Error('CDP 模式需要填写完整的 WebSocket 调试地址（以 ws:// 或 wss:// 开头）');
    }
    log('CDP 模式：正在连接到已启动的 Chrome（不会关闭你的浏览器）…');
    const browser = await puppeteer.connect({ browserWSEndpoint: ws });
    try {
      const pages = await browser.pages();
      const page = pages[0] || (await browser.newPage());
      const agent = new PuppeteerAgent(page, modelOpts);
      try {
        log('已连接页面，开始执行自然语言任务（可能需要几分钟）…');
        const summary = await agent.ai(task);
        log(typeof summary === 'string' && summary ? summary : '任务已结束。');
      } finally {
        await agent.destroy().catch(() => {});
      }
    } finally {
      await browser.disconnect().catch(() => {});
    }
    return;
  }

  const baseLaunch = {
    headless: false,
    defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 0 },
    args: ['--no-first-run', '--no-default-browser-check'],
  };

  let browser;
  const preferChrome = process.platform === 'darwin' || process.platform === 'win32';
  if (preferChrome) {
    try {
      log('正在启动系统 Google Chrome（全新会话）…');
      browser = await puppeteer.launch({ ...baseLaunch, channel: 'chrome' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`无法启动系统 Chrome（${msg}），改用 Puppeteer 内置 Chromium…`);
      browser = await puppeteer.launch(baseLaunch);
    }
  } else {
    log('正在启动 Puppeteer 内置 Chromium…');
    browser = await puppeteer.launch(baseLaunch);
  }
  const pages = await browser.pages();
  const page = pages[0] || (await browser.newPage());

  const agent = new PuppeteerAgent(page, modelOpts);

  try {
    log('已连接页面，开始执行自然语言任务（可能需要几分钟）…');
    const summary = await agent.ai(task);
    log(typeof summary === 'string' && summary ? summary : '任务已结束。');
  } finally {
    await agent.destroy().catch(() => {});
    await browser.close().catch(() => {});
  }
}
