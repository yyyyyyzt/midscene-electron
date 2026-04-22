import { createBridgeAgent } from './chrome-runner.js';
import { evaluateRules } from './rule-engine.js';

/**
 * 跑一次完整的巡检任务：
 *   1. 连接 Bridge（newTabWithUrl 默认 / currentTab 调试）
 *   2. aiWaitFor 页面就绪
 *   3. aiAssert 非登录页 / 非错误页
 *   4. aiQuery 提取结构化数据
 *   5. 规则引擎判断异常
 *   6. 汇总返回
 *
 * 仅抛最终异常；内部的规则判定通过返回值体现。
 *
 * @param {{
 *   task: import('../store/task-store.js').InspectionTask;
 *   modelConfig: Record<string, string | number>;
 *   bridgePort: number;
 *   timeoutMs: number;
 *   log: (line: string) => void;
 * }} ctx
 * @returns {Promise<{
 *   status: 'ok' | 'alert' | 'error';
 *   extracted: any;
 *   ruleResults: Array<{ruleId: string; ok: boolean; severity: 'info'|'warning'|'critical'; message: string}>;
 *   failedMessages: string[];
 *   error: string | null;
 *   reportPath: string | null;
 * }>}
 */
export async function runInspection(ctx) {
  const { task, log } = ctx;
  const isCurrentTab = task.runMode === 'currentTab';

  const agentPromise = createBridgeAgent({
    modelConfig: ctx.modelConfig,
    bridgePort: ctx.bridgePort,
    aiActContext: task.description || '',
    runMode: task.runMode || 'newTabWithUrl',
    entryUrl: task.entryUrl,
    closeTabAfter: !isCurrentTab && task.closeTabAfter !== false,
    log,
  });

  const timeoutMs = Math.max(30_000, Number(ctx.timeoutMs) || 180_000);
  const result = await withTimeout(
    (async () => {
      const agent = await agentPromise;
      try {
        let reportPath = null;
        let extracted = null;

        if (task.readyPrompt?.trim()) {
          log('aiWaitFor 等待页面就绪…');
          try {
            await agent.aiWaitFor(task.readyPrompt.trim(), { timeoutMs: 60_000 });
            log('页面就绪。');
          } catch (e) {
            log(`页面就绪超时：${e instanceof Error ? e.message : String(e)}`);
            throw new Error('页面加载超时或内容未就绪');
          }
        }

        if (task.loginAssertPrompt?.trim()) {
          log('aiAssert 确认非登录页 / 非错误页…');
          try {
            await agent.aiAssert(task.loginAssertPrompt.trim());
          } catch (e) {
            log(`页面状态异常：${e instanceof Error ? e.message : String(e)}`);
            throw new Error('LOGIN_OR_ERROR_PAGE');
          }
        }

        if (task.extractPrompt?.trim()) {
          log('aiQuery 开始提取结构化数据…');
          const schema = task.extractSchema?.trim();
          const prompt = schema
            ? `${task.extractPrompt.trim()}\n\n返回 JSON，结构需满足：${schema}`
            : task.extractPrompt.trim();
          try {
            extracted = await agent.aiQuery(prompt);
            log(`aiQuery 返回：${JSON.stringify(extracted).slice(0, 600)}`);
          } catch (e) {
            throw new Error(
              `aiQuery 失败：${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }

        const { results, failed } = evaluateRules(task.rules || [], extracted);
        const failedMessages = failed.map((r) => r.message);

        try {
          reportPath = typeof agent.reportFile === 'string' ? agent.reportFile : null;
        } catch {}

        if (failed.length) {
          log(`命中 ${failed.length} 条异常规则。`);
          return {
            status: 'alert',
            extracted,
            ruleResults: results,
            failedMessages,
            error: null,
            reportPath,
          };
        }

        log('规则全部通过。');
        return {
          status: 'ok',
          extracted,
          ruleResults: results,
          failedMessages: [],
          error: null,
          reportPath,
        };
      } finally {
        try {
          await agent.destroy(!isCurrentTab && task.closeTabAfter !== false);
        } catch {}
      }
    })(),
    timeoutMs,
  );

  return result;
}

/**
 * @template T
 * @param {Promise<T>} p
 * @param {number} ms
 * @returns {Promise<T>}
 */
function withTimeout(p, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`任务总超时 ${ms}ms`)), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch((e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}
