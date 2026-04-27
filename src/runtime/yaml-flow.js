import yaml from 'js-yaml';

/**
 * Midscene YAML 流程解析器。
 *
 * 设计：
 *  - 在巡检产品里我们不直接整体执行 yaml；浏览器/连接由 Bridge runner 管理。
 *  - 因此从用户粘贴的 yaml 中：
 *      1) 取出 `web.viewportWidth/Height`（仅作展示与日志，Bridge 模式不能调整桌面 Chrome 窗口尺寸，AGENTS.md 5 节）
 *      2) 取出第 1 个 task 的 `flow` 数组，作为我们要在 Bridge 上重放的指令
 *  - 重放方式直接调用 `agent.runYaml(reconstructedYaml)`，避免自实现每条指令的分发逻辑。
 *
 * 我们也要列出步骤摘要，给前端预览和详情弹窗用。
 */

const SUPPORTED_KEYS = new Set([
  'ai',
  'aiAct',
  'aiTap',
  'aiHover',
  'aiInput',
  'aiKeyboardPress',
  'aiScroll',
  'aiWaitFor',
  'aiAssert',
  'aiQuery',
  'aiBoolean',
  'aiString',
  'aiNumber',
  'aiAsk',
  'sleep',
  'javascript',
  'recordToReport',
]);

/**
 * 把任意输入（完整 yaml / 仅 tasks 列表 / 仅 flow 数组）规范化为 flow 步骤数组。
 *
 * @param {string} text
 * @returns {{
 *   ok: true;
 *   flow: any[];
 *   warnings: string[];
 *   meta: {
 *     viewportWidth?: number;
 *     viewportHeight?: number;
 *     entryUrl?: string;
 *   };
 * } | { ok: false; error: string }}
 */
export function parseYamlFlow(text) {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, error: 'YAML 内容为空' };

  /** @type {any} */
  let doc;
  try {
    doc = yaml.load(raw, { schema: yaml.JSON_SCHEMA });
  } catch (e) {
    return { ok: false, error: `YAML 解析失败：${e instanceof Error ? e.message : String(e)}` };
  }

  /** @type {string[]} */
  const warnings = [];
  /** @type {any[]} */
  let flow = [];
  /** @type {{viewportWidth?:number; viewportHeight?:number; entryUrl?:string}} */
  const meta = {};

  if (Array.isArray(doc)) {
    flow = doc;
  } else if (doc && typeof doc === 'object') {
    if (doc.web && typeof doc.web === 'object') {
      if (typeof doc.web.url === 'string' && doc.web.url) meta.entryUrl = doc.web.url;
      if (Number.isFinite(doc.web.viewportWidth)) meta.viewportWidth = Number(doc.web.viewportWidth);
      if (Number.isFinite(doc.web.viewportHeight)) meta.viewportHeight = Number(doc.web.viewportHeight);
    }
    if (doc.android || doc.ios || doc.computer) {
      warnings.push('YAML 里包含 android/ios/computer 配置，Bridge 巡检工作台只会执行 web flow。');
    }
    if (Array.isArray(doc.tasks)) {
      if (doc.tasks.length > 1) warnings.push(`检测到 ${doc.tasks.length} 个 task，仅使用第 1 个。`);
      const firstFlow = doc.tasks[0]?.flow;
      if (Array.isArray(firstFlow)) flow = firstFlow;
    } else if (Array.isArray(doc.flow)) {
      flow = doc.flow;
    } else {
      return {
        ok: false,
        error: '解析后未找到 tasks[0].flow 或顶层 flow 数组，请确保粘贴 Midscene Recorder 输出的完整 YAML。',
      };
    }
  } else {
    return { ok: false, error: '不是有效的 YAML 对象。' };
  }

  if (!Array.isArray(flow) || flow.length === 0) {
    return { ok: false, error: 'flow 为空，没有可执行的步骤。' };
  }

  for (let i = 0; i < flow.length; i++) {
    const step = flow[i];
    if (!step || typeof step !== 'object' || Array.isArray(step)) {
      return { ok: false, error: `第 ${i + 1} 步不是对象：${JSON.stringify(step)}` };
    }
    const keys = Object.keys(step);
    const action = keys.find((k) => SUPPORTED_KEYS.has(k));
    if (!action) {
      warnings.push(`第 ${i + 1} 步未识别动作：${keys.join(', ')}（仍会原样转交 Midscene）`);
    }
  }

  return { ok: true, flow, warnings, meta };
}

/**
 * 把 flow 数组重新打包成可被 agent.runYaml 接受的最小 yaml 字符串。
 * 注意：runYaml 只解析 tasks 部分，我们不必再写 web/agent 配置。
 *
 * @param {any[]} flow
 * @param {string} taskName
 */
export function buildRunnableYaml(flow, taskName = '巡检流程') {
  const wrapper = {
    tasks: [{ name: taskName, flow }],
  };
  return yaml.dump(wrapper, {
    noRefs: true,
    skipInvalid: true,
    lineWidth: 120,
  });
}

/**
 * 给 UI 展示用的步骤摘要。
 *
 * @param {any[]} flow
 */
export function describeFlow(flow) {
  if (!Array.isArray(flow)) return [];
  return flow.map((step, idx) => {
    const keys = Object.keys(step || {});
    const action = keys.find((k) => SUPPORTED_KEYS.has(k)) || keys[0] || 'unknown';
    let summary = '';
    const v = step[action];
    if (typeof v === 'string') summary = v;
    else if (typeof v === 'number') summary = `${v}`;
    else if (v && typeof v === 'object') {
      summary = v.prompt || v.locate?.prompt || JSON.stringify(v);
    }
    if (action === 'aiInput' && step.value != null) summary = `${summary} → "${step.value}"`;
    if (action === 'aiKeyboardPress' && step.keyName) summary = `${summary} → ${step.keyName}`;
    if (action === 'aiScroll') {
      const obj = (v && typeof v === 'object') ? v : step;
      const target = (obj.locate || obj.prompt || step.locate || '').toString();
      const dir = obj.direction || step.direction || '';
      const dist = obj.distance || step.distance;
      const t = obj.scrollType || step.scrollType || '';
      const parts = [];
      if (target) parts.push(`locate=${target}`);
      if (dir) parts.push(`dir=${dir}`);
      if (dist) parts.push(`${dist}px`);
      if (t) parts.push(`[${t}]`);
      summary = parts.join(' ');
    }
    return {
      index: idx,
      action,
      summary: String(summary).slice(0, 200),
    };
  });
}
