import { AgentOverChromeBridge } from '@midscene/web/bridge-mode';

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
 *   bridgePort?: number;
 *   aiActContext?: string;
 * }} opts
 * @param {(line: string) => void} log
 */
export async function runNaturalLanguageTask(task, opts, log) {
  const modelOpts = {
    modelConfig: opts.modelConfig,
    generateReport: true,
    autoPrintReportMsg: true,
    aiActContext: [DEFAULT_AI_CONTEXT, opts.aiActContext].filter(Boolean).join('\n'),
  };

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
}
