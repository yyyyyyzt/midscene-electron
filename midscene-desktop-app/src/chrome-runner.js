import puppeteer from 'puppeteer';
import { PuppeteerAgent } from '@midscene/web/puppeteer';

/**
 * Launch Google Chrome (stable) when available; otherwise fall back to Puppeteer's bundled Chromium.
 * @param {{ modelConfig: Record<string, string>, midsceneRunDir: string }} opts
 * @param {(line: string) => void} log
 */
export async function runNaturalLanguageTask(task, opts, log) {
  const baseLaunch = {
    headless: false,
    defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 0 },
    args: ['--no-first-run', '--no-default-browser-check'],
  };

  let browser;
  const preferChrome = process.platform === 'darwin' || process.platform === 'win32';
  if (preferChrome) {
    try {
      log('正在启动系统 Google Chrome…');
      browser = await puppeteer.launch({ ...baseLaunch, channel: 'chrome' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`无法启动系统 Chrome（${msg}），改用 Puppeteer 内置 Chromium…`);
      browser = await puppeteer.launch(baseLaunch);
    }
  } else {
    log('正在启动 Puppeteer 内置 Chromium（当前平台未强制系统 Chrome）…');
    browser = await puppeteer.launch(baseLaunch);
  }
  const pages = await browser.pages();
  const page = pages[0] || (await browser.newPage());

  const agent = new PuppeteerAgent(page, {
    modelConfig: opts.modelConfig,
    generateReport: true,
    autoPrintReportMsg: true,
    aiActContext:
      'You automate only the browser tab under control. Prefer safe actions; do not exfiltrate secrets.',
  });

  try {
    log('已连接页面，开始执行自然语言任务（可能需要几分钟）…');
    const summary = await agent.ai(task);
    log(typeof summary === 'string' && summary ? summary : '任务已结束。');
  } finally {
    await agent.destroy().catch(() => {});
    await browser.close().catch(() => {});
  }
}
