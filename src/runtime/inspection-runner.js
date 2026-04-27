import { createBridgeAgent } from './chrome-runner.js';
import { evaluateRules } from './rule-engine.js';
import { parseFlowInput } from './yaml-flow.js';
import { runSteps } from './step-runner.js';

/**
 * 跑一次完整的巡检任务：
 *   1. 连接 Bridge（newTabWithUrl 默认 / currentTab 调试）
 *   2. aiWaitFor 页面就绪
 *   3. （可选）执行用户提供的 YAML flow，做下拉/点击/滚动等复杂导航
 *   4. aiAssert 非登录页 / 非错误页
 *   5. aiQuery 提取结构化数据
 *   6. 规则引擎判断异常（按 when 决定是否触发告警）
 *   7. 汇总返回，包含每个 phase 的耗时与结果
 */

const PHASE = {
  CONNECT: 'connect',
  READY: 'ready',
  FLOW: 'flow',
  ASSERT: 'assertNotLogin',
  QUERY: 'extract',
  RULES: 'rules',
};

/**
 * @typedef {{
 *   name: 'connect' | 'ready' | 'assertNotLogin' | 'extract' | 'rules';
 *   label: string;
 *   status: 'skipped' | 'ok' | 'error';
 *   startedAt: number;
 *   durationMs: number;
 *   error: string | null;
 *   detail: any;
 * }} PhaseRecord
 */

/**
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
 *   ruleResults: import('./rule-engine.js').RuleResult[];
 *   triggeredMessages: string[];
 *   error: string | null;
 *   reportPath: string | null;
 *   phases: PhaseRecord[];
 * }>}
 */
export async function runInspection(ctx) {
  const { task, log } = ctx;
  const isCurrentTab = task.runMode === 'currentTab';
  const phases = [];

  /**
   * @param {PhaseRecord['name']} name
   * @param {string} label
   * @param {() => Promise<any>} run
   */
  const runPhase = async (name, label, run) => {
    const startedAt = Date.now();
    log(`▶ ${label} 开始`);
    try {
      const detail = await run();
      const durationMs = Date.now() - startedAt;
      const rec = {
        name, label, status: 'ok', startedAt, durationMs, error: null, detail: detail ?? null,
      };
      phases.push(rec);
      log(`✔ ${label} 完成（${durationMs} ms）`);
      return rec;
    } catch (e) {
      const durationMs = Date.now() - startedAt;
      const message = e instanceof Error ? e.message : String(e);
      const rec = {
        name, label, status: 'error', startedAt, durationMs, error: message, detail: null,
      };
      phases.push(rec);
      log(`✘ ${label} 失败（${durationMs} ms）：${message}`);
      throw Object.assign(new Error(message), { phase: name });
    }
  };

  const skipPhase = (name, label, reason) => {
    phases.push({
      name, label, status: 'skipped', startedAt: Date.now(),
      durationMs: 0, error: null, detail: reason || null,
    });
    log(`◌ ${label} 跳过${reason ? '：' + reason : ''}`);
  };

  const timeoutMs = Math.max(30_000, Number(ctx.timeoutMs) || 180_000);

  return await withTimeout((async () => {
    let agent = null;
    try {
      const connected = await runPhase(PHASE.CONNECT, '连接 Bridge', async () => {
        agent = await createBridgeAgent({
          modelConfig: ctx.modelConfig,
          bridgePort: ctx.bridgePort,
          aiActContext: task.description || '',
          runMode: task.runMode || 'newTabWithUrl',
          entryUrl: task.entryUrl,
          closeTabAfter: !isCurrentTab && task.closeTabAfter !== false,
          log,
        });
        return {
          runMode: task.runMode || 'newTabWithUrl',
          entryUrl: task.entryUrl || '',
        };
      });

      if (task.readyPrompt?.trim()) {
        await runPhase(PHASE.READY, '页面就绪 aiWaitFor', async () => {
          await agent.aiWaitFor(task.readyPrompt.trim(), { timeoutMs: 60_000 });
          return { prompt: task.readyPrompt.trim() };
        });
      } else {
        skipPhase(PHASE.READY, '页面就绪 aiWaitFor', '未配置 readyPrompt');
      }

      if (task.flowYaml && task.flowYaml.trim()) {
        await runPhase(PHASE.FLOW, '操作流程（逐步重放）', async () => {
          const parsed = parseFlowInput(task.flowYaml);
          if (!parsed.ok) {
            throw new Error(parsed.error);
          }
          for (const w of parsed.warnings || []) log(`flow 警告：${w}`);
          log(`即将逐步重放 ${parsed.steps.length} 步（来源 ${parsed.source}）…`);
          const result = await runSteps({
            agent,
            steps: parsed.steps,
            aiFallback: task.aiFallback !== false,
            log,
          });
          if (!result.ok && result.firstError) {
            const idx = result.firstError.stepIndex;
            const step = parsed.steps[idx];
            throw new Error(
              `第 ${idx + 1}/${parsed.steps.length} 步失败：[${step?.action}] ${step?.locate || step?.prompt || ''} → ${result.firstError.message}`,
            );
          }
          return {
            source: parsed.source,
            total: parsed.steps.length,
            warnings: parsed.warnings,
            stepResults: result.stepResults,
          };
        });
      } else {
        skipPhase(PHASE.FLOW, '操作流程（逐步重放）', '未配置 flow');
      }

      if (task.loginAssertPrompt?.trim()) {
        try {
          await runPhase(PHASE.ASSERT, '页面校验 aiAssert', async () => {
            await agent.aiAssert(task.loginAssertPrompt.trim());
            return { prompt: task.loginAssertPrompt.trim() };
          });
        } catch (e) {
          throw Object.assign(new Error('LOGIN_OR_ERROR_PAGE'), {
            phase: PHASE.ASSERT,
            cause: e?.message,
          });
        }
      } else {
        skipPhase(PHASE.ASSERT, '页面校验 aiAssert', '未配置 loginAssertPrompt');
      }

      let extracted = null;
      if (task.extractPrompt?.trim()) {
        const r = await runPhase(PHASE.QUERY, '提取数据 aiQuery', async () => {
          const schema = task.extractSchema?.trim();
          const prompt = schema
            ? `${task.extractPrompt.trim()}\n\n返回 JSON，结构需满足：${schema}`
            : task.extractPrompt.trim();
          const out = await agent.aiQuery(prompt);
          return { prompt, schema: schema || null, value: out };
        });
        extracted = r.detail.value;
      } else {
        skipPhase(PHASE.QUERY, '提取数据 aiQuery', '未配置 extractPrompt');
      }

      const rulePhase = await runPhase(PHASE.RULES, '规则判定', async () => {
        const { results, triggered } = evaluateRules(task.rules || [], extracted);
        return { results, triggered, total: results.length };
      });
      const { results, triggered } = rulePhase.detail;
      const triggeredMessages = triggered.map((r) => r.message);

      let reportPath = null;
      try {
        reportPath = typeof agent.reportFile === 'string' ? agent.reportFile : null;
      } catch {}

      const overall = triggered.length ? 'alert' : 'ok';
      log(
        triggered.length
          ? `命中 ${triggered.length}/${results.length} 条告警条件。`
          : results.length
            ? `所有 ${results.length} 条规则均未触发告警。`
            : '无规则；判定为正常。',
      );

      return {
        status: overall,
        extracted,
        ruleResults: results,
        triggeredMessages,
        error: null,
        reportPath,
        phases,
      };
    } finally {
      if (agent) {
        try { await agent.destroy(!isCurrentTab && task.closeTabAfter !== false); } catch {}
      }
    }
  })(), timeoutMs);
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
