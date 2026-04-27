/**
 * 逐步执行 step（来自 Recorder Playwright / YAML 解析后的统一形态）。
 *
 * 设计目标：
 *   - **严格按录制顺序复现**，每一步都是显式的 agent.aiTap / aiScroll 调用，
 *     与 Recorder 在 Playwright 里执行的逻辑等价；不把整个流程黑盒丢给 ai()。
 *   - **逐步可见**：每步 onStep(stepResult) 实时上报到 UI，失败时知道是哪一步。
 *   - **可选 AI 兜底**：当 step 失败、且任务开启 aiFallback 时，
 *     退回 agent.aiAct(自然语言重述)，把整步交给规划模型，再执行一次。
 *   - **错误不立即抛出**：跑完后由调用方决定是否汇总成失败。
 *
 * 不在这里做超时控制（外层 inspection-runner 做整体超时）。
 */

/**
 * @typedef {{
 *   action: string;
 *   locate?: string;
 *   prompt?: string;
 *   value?: string;
 *   keyName?: string;
 *   direction?: 'down' | 'up' | 'left' | 'right';
 *   scrollType?: 'singleAction' | 'scrollToBottom' | 'scrollToTop' | 'scrollToRight' | 'scrollToLeft';
 *   distance?: number;
 *   ms?: number;
 *   timeoutMs?: number;
 *   options?: any;
 *   raw?: string;
 * }} Step
 *
 * @typedef {{
 *   index: number;
 *   action: string;
 *   description: string;
 *   raw?: string;
 *   status: 'ok' | 'error' | 'recovered';
 *   startedAt: number;
 *   durationMs: number;
 *   error: string | null;
 *   recoveredBy: 'aiAct' | null;
 *   recoveredError: string | null;
 * }} StepResult
 */

/**
 * @param {{
 *   agent: any;
 *   steps: Step[];
 *   aiFallback: boolean;
 *   log: (line: string) => void;
 *   onStep?: (r: StepResult) => void;
 * }} ctx
 * @returns {Promise<{
 *   ok: boolean;
 *   stepResults: StepResult[];
 *   firstError: { stepIndex: number; message: string } | null;
 * }>}
 */
export async function runSteps(ctx) {
  const { agent, steps, aiFallback, log } = ctx;
  /** @type {StepResult[]} */
  const stepResults = [];
  let firstError = null;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const description = describe(step);
    const startedAt = Date.now();
    log(`▸ [${i + 1}/${steps.length}] ${step.action}: ${description}`);

    /** @type {StepResult} */
    const rec = {
      index: i,
      action: step.action,
      description,
      raw: step.raw,
      status: 'ok',
      startedAt,
      durationMs: 0,
      error: null,
      recoveredBy: null,
      recoveredError: null,
    };

    try {
      await executeStep(agent, step);
      rec.durationMs = Date.now() - startedAt;
      log(`  ✔ 通过（${rec.durationMs} ms）`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`  ✘ 失败：${msg}`);
      if (aiFallback && hasNaturalLanguageFallback(step)) {
        try {
          log('  ↻ 尝试 AI 兜底（aiAct）…');
          await agent.aiAct(buildFallbackPrompt(step));
          rec.status = 'recovered';
          rec.recoveredBy = 'aiAct';
          rec.error = msg;
          rec.durationMs = Date.now() - startedAt;
          log('  ✔ AI 兜底成功');
        } catch (e2) {
          rec.status = 'error';
          rec.error = msg;
          rec.recoveredError = e2 instanceof Error ? e2.message : String(e2);
          rec.durationMs = Date.now() - startedAt;
          log(`  ✘ AI 兜底也失败：${rec.recoveredError}`);
          if (!firstError) firstError = { stepIndex: i, message: msg };
          stepResults.push(rec);
          ctx.onStep?.(rec);
          break;
        }
      } else {
        rec.status = 'error';
        rec.error = msg;
        rec.durationMs = Date.now() - startedAt;
        if (!firstError) firstError = { stepIndex: i, message: msg };
        stepResults.push(rec);
        ctx.onStep?.(rec);
        break;
      }
    }

    stepResults.push(rec);
    ctx.onStep?.(rec);
  }

  return {
    ok: !firstError,
    stepResults,
    firstError,
  };
}

/** @param {Step} step */
function describe(step) {
  if (step.action === 'sleep') return `${step.ms || 0} ms`;
  if (step.action === 'aiScroll') {
    const parts = [];
    if (step.locate) parts.push(step.locate);
    if (step.direction) parts.push(step.direction);
    if (step.distance) parts.push(`${step.distance}px`);
    if (step.scrollType) parts.push(`[${step.scrollType}]`);
    return parts.join(' ').trim();
  }
  if (step.action === 'aiInput') return `${step.locate || ''} ← "${step.value || ''}"`;
  if (step.action === 'aiKeyboardPress') return `${step.locate || ''} → ${step.keyName || ''}`;
  return step.locate || step.prompt || step.raw || '';
}

/** @param {any} agent @param {Step} step */
async function executeStep(agent, step) {
  switch (step.action) {
    case 'sleep':
      await sleep(Math.max(0, Number(step.ms) || 0));
      return;
    case 'aiTap':
      requireFn(agent, 'aiTap');
      return await agent.aiTap(step.locate, step.options || undefined);
    case 'aiHover':
      requireFn(agent, 'aiHover');
      return await agent.aiHover(step.locate, step.options || undefined);
    case 'aiInput':
      requireFn(agent, 'aiInput');
      // 优先采用 locate-first 新签名（@midscene/web 1.x）；老签名 (value, locate) 也兼容
      try {
        return await agent.aiInput(step.locate, { value: step.value });
      } catch (e) {
        if (e instanceof TypeError) {
          return await agent.aiInput(step.value, step.locate);
        }
        throw e;
      }
    case 'aiKeyboardPress':
      requireFn(agent, 'aiKeyboardPress');
      return await agent.aiKeyboardPress(step.locate, { keyName: step.keyName });
    case 'aiScroll': {
      requireFn(agent, 'aiScroll');
      const opts = {
        direction: step.direction,
        scrollType: step.scrollType,
      };
      if (typeof step.distance === 'number') opts.distance = step.distance;
      if (step.locate) return await agent.aiScroll(step.locate, opts);
      return await agent.aiScroll(undefined, opts);
    }
    case 'aiWaitFor':
      requireFn(agent, 'aiWaitFor');
      return await agent.aiWaitFor(step.prompt, { timeoutMs: step.timeoutMs || 30000 });
    case 'aiAssert':
      requireFn(agent, 'aiAssert');
      return await agent.aiAssert(step.prompt);
    case 'aiQuery':
      requireFn(agent, 'aiQuery');
      return await agent.aiQuery(step.prompt);
    case 'aiAct':
      requireFn(agent, 'aiAct');
      return await agent.aiAct(step.prompt);
    case 'unknown':
      throw new Error(`未识别的步骤：${step.raw || ''}`);
    default:
      throw new Error(`未支持的动作：${step.action}`);
  }
}

function requireFn(agent, name) {
  if (typeof agent[name] !== 'function') {
    throw new Error(`当前 Midscene agent 不支持 ${name}，请升级 @midscene/web`);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function hasNaturalLanguageFallback(step) {
  return Boolean(step.locate || step.prompt);
}

function buildFallbackPrompt(step) {
  if (step.action === 'aiTap') return `在页面上点击：${step.locate}`;
  if (step.action === 'aiHover') return `把鼠标移到：${step.locate}`;
  if (step.action === 'aiInput') return `在「${step.locate}」中输入「${step.value}」`;
  if (step.action === 'aiKeyboardPress') return `聚焦「${step.locate}」并按下 ${step.keyName}`;
  if (step.action === 'aiScroll') {
    const where = step.locate ? `在「${step.locate}」` : '在当前可见容器';
    if (step.scrollType && step.scrollType !== 'singleAction') {
      return `${where}向${step.direction || ''}方向滚动到${step.scrollType.replace('scrollTo', '')}`;
    }
    return `${where}向${step.direction || '下'}滚动${step.distance ? step.distance + ' 像素' : ''}`;
  }
  if (step.action === 'aiWaitFor') return `等待页面满足条件：${step.prompt}`;
  if (step.action === 'aiAssert') return `请确认页面上：${step.prompt}`;
  if (step.action === 'aiQuery') return step.prompt;
  return step.prompt || step.locate || '';
}
