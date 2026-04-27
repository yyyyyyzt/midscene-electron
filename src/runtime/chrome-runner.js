import { AgentOverChromeBridge } from '@midscene/web/bridge-mode';

/**
 * Bridge-only 运行时封装。
 *
 * 遵循 AGENTS.md：只做 Bridge。两种附加方式：
 *  - newTabWithUrl（默认，巡检）
 *  - currentTab（调试）
 *
 * 为避免每次任务都重新建立 socket，工厂允许共享同一 agent 实例，
 * 但调度器仍应串行调用（AGENTS.md 3.3 / 8.3）。
 */

const DEFAULT_AI_CONTEXT =
  '你在巡检一个已登录的业务后台系统。只读优先，不要主动退出登录、不要提交破坏性操作；所有操作对象仅限当前 Chrome tab。';

/**
 * @typedef {{
 *   bridgePort?: number;
 *   aiActContext?: string;
 *   modelConfig: Record<string, string | number>;
 * }} AgentOpts
 */

/**
 * 创建一个 Bridge Agent 并按 runMode 附加到一个 tab。
 * @param {AgentOpts & {
 *   runMode: 'newTabWithUrl' | 'currentTab';
 *   entryUrl?: string;
 *   closeTabAfter?: boolean;
 *   log: (line: string) => void;
 * }} opts
 */
export async function createBridgeAgent(opts) {
  const port = Number.isFinite(opts.bridgePort) && opts.bridgePort > 0 ? opts.bridgePort : 3766;
  const agent = new AgentOverChromeBridge({
    modelConfig: opts.modelConfig,
    generateReport: true,
    autoPrintReportMsg: true,
    aiActContext: [DEFAULT_AI_CONTEXT, opts.aiActContext].filter(Boolean).join('\n'),
    port,
    closeConflictServer: true,
    closeNewTabsAfterDisconnect: opts.closeTabAfter !== false,
  });

  opts.log(`Bridge 模式已就绪，监听端口 ${port}，等待 Chrome 扩展连接…`);

  if (opts.runMode === 'currentTab') {
    opts.log('附加到当前活动标签页（currentTab，用于手动调试）…');
    await agent.connectCurrentTab();
  } else {
    const url = (opts.entryUrl || '').trim();
    if (!url) {
      throw new Error('newTabWithUrl 模式必须提供任务的入口 URL');
    }
    opts.log(`新建标签页并打开 ${url}（newTabWithUrl）…`);
    await agent.connectNewTabWithUrl(url);
  }
  return agent;
}

/**
 * 仅供手动调试（旧入口）：跑一段自然语言提示。
 *
 * @param {string} prompt
 * @param {AgentOpts & { runMode: 'newTabWithUrl' | 'currentTab'; entryUrl?: string; closeTabAfter?: boolean }} opts
 * @param {(line: string) => void} log
 */
export async function runNaturalLanguageTask(prompt, opts, log) {
  const agent = await createBridgeAgent({ ...opts, log });
  try {
    log('开始执行自然语言任务…');
    const out = await agent.ai(prompt);
    log(typeof out === 'string' && out ? out : '任务已结束。');
  } finally {
    await agent.destroy(opts.closeTabAfter !== false).catch(() => {});
  }
}

/**
 * 合并主 prompt 与业务上下文（兼容旧单任务入口）。
 * @param {string} main
 * @param {string} businessContext
 */
export function mergeTaskPrompts(main, businessContext) {
  const m = (main || '').trim();
  const c = (businessContext || '').trim();
  if (!c) return m;
  return `【业务背景与术语（可多次迭代补充）】\n${c}\n\n【当前要执行的操作】\n${m}`;
}
