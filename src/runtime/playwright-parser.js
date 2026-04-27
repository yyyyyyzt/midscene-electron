/**
 * 解析 Midscene Recorder 输出的 Playwright 代码，提取 page.goto / setViewportSize
 * 以及 test 函数体内的 ai* 调用。
 *
 * 我们不真的执行 Playwright（Bridge 模式下也跑不了 Playwright，AGENTS.md §3 / §4），
 * 只把它当作「步骤说明」转换成 Bridge 上能逐条执行的 step 数组。
 *
 * 解析策略：纯正则 + JSON.parse 处理参数对象，无外部 AST 依赖。
 * 支持的动作：aiTap / aiHover / aiInput / aiKeyboardPress / aiScroll
 *           / aiWaitFor / aiAssert / aiQuery / aiAct(ai) / sleep。
 *
 * 任何一行未识别都返回 warning，但仍会保留原文供 UI 展示。
 */

const ACTION_NAMES = [
  'aiTap',
  'aiHover',
  'aiInput',
  'aiKeyboardPress',
  'aiScroll',
  'aiWaitFor',
  'aiAssert',
  'aiQuery',
  'aiAct',
  'aiAsk',
  'aiBoolean',
  'aiNumber',
  'aiString',
];

/**
 * @param {string} text
 * @returns {{ ok: true; flow: any[]; meta: any; warnings: string[] } | { ok: false; error: string }}
 */
export function parsePlaywrightCode(text) {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, error: 'Playwright 代码为空' };

  if (!/@midscene\/web|aiTap|aiScroll|aiWaitFor|aiAssert/.test(raw)) {
    return {
      ok: false,
      error: '看起来不像 Midscene Recorder 输出的 Playwright 代码（缺少 ai* 调用）',
    };
  }

  /** @type {string[]} */
  const warnings = [];
  /** @type {{entryUrl?:string; viewportWidth?:number; viewportHeight?:number}} */
  const meta = {};

  const gotoMatch = raw.match(/page\.goto\(\s*(['"`])([^'"`]+)\1\s*\)/);
  if (gotoMatch) meta.entryUrl = gotoMatch[2];

  const vpMatch = raw.match(/setViewportSize\(\s*\{([^}]+)\}\s*\)/);
  if (vpMatch) {
    const w = vpMatch[1].match(/width\s*:\s*(\d+)/);
    const h = vpMatch[1].match(/height\s*:\s*(\d+)/);
    if (w) meta.viewportWidth = Number(w[1]);
    if (h) meta.viewportHeight = Number(h[1]);
  }

  const flow = [];
  /**
   * 用一个滚动光标按出现顺序提取所有 await ...(...) 调用。
   * 不依赖换行；JSON 风格的对象参数允许跨行。
   */
  const callRegex = /await\s+(?:\w+\s*\.\s*)?(\w+)\s*\(/g;
  let m;
  let cursor = 0;
  let bodyStart = -1;

  // 优先在 test('...', async ({ ... }) => { ... }) 体内查找。
  const testMatch = raw.match(/test\s*\(\s*['"`][^'"`]*['"`]\s*,\s*async[^)]*\)\s*=>\s*\{/);
  if (testMatch) {
    bodyStart = testMatch.index + testMatch[0].length;
    cursor = bodyStart;
  }

  callRegex.lastIndex = cursor;
  while ((m = callRegex.exec(raw))) {
    const fnName = m[1];
    if (!ACTION_NAMES.includes(fnName) && fnName !== 'sleep' && fnName !== 'page') {
      continue;
    }
    const argsStart = m.index + m[0].length;
    const argsRange = matchBalancedParens(raw, argsStart - 1);
    if (!argsRange) continue;
    const argsText = raw.slice(argsStart, argsRange.end);
    const step = makeStep(fnName, argsText);
    if (step) {
      flow.push(step);
    } else {
      warnings.push(`无法识别参数：${fnName}(${argsText.slice(0, 80)}…)`);
    }
    callRegex.lastIndex = argsRange.end + 1;
  }

  if (!flow.length) {
    return { ok: false, error: '未能从 Playwright 代码中提取任何步骤' };
  }
  return { ok: true, flow, meta, warnings };
}

/** 找到从 openIdx 处 '(' 对应的 ')' 位置（含简单字符串 / 模板串处理）。 */
function matchBalancedParens(s, openIdx) {
  if (s[openIdx] !== '(') return null;
  let depth = 0;
  let i = openIdx;
  let inStr = null;
  let escaped = false;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && s[i + 1] === '*') {
      i += 2;
      while (i < s.length - 1 && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i++;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return { end: i };
    }
  }
  return null;
}

/**
 * 把 ai* 的参数文本转成 step 对象，供 step-runner 使用。
 *
 * @param {string} fn
 * @param {string} args
 */
function makeStep(fn, args) {
  if (fn === 'sleep') {
    const n = Number(args.trim());
    if (Number.isFinite(n)) return { action: 'sleep', ms: n, raw: `sleep(${n})` };
    return null;
  }

  if (fn === 'page') {
    return null;
  }

  // 解析第一个字符串参数（promptArg）
  const splitArgs = splitTopLevelArgs(args);
  if (!splitArgs.length) return null;
  const first = splitArgs[0];
  const second = splitArgs[1];
  const third = splitArgs[2];

  const promptArg = parseStringLiteral(first);

  if (fn === 'aiTap' || fn === 'aiHover') {
    return {
      action: fn,
      locate: promptArg,
      options: parseObjectLiteral(second),
      raw: `${fn}(${first}${second ? ', ' + second : ''})`,
    };
  }

  if (fn === 'aiInput') {
    // Recorder 大多是 aiInput(value, locate) 老签名 / aiInput(locate, {value}) 新签名
    const maybeOpts = parseObjectLiteral(second);
    if (maybeOpts && typeof maybeOpts.value === 'string') {
      return { action: 'aiInput', locate: promptArg, value: maybeOpts.value, options: maybeOpts, raw: `${fn}(${first}, ${second})` };
    }
    const valueAsLocate = parseStringLiteral(second);
    return {
      action: 'aiInput',
      locate: valueAsLocate || promptArg,
      value: valueAsLocate ? promptArg : '',
      raw: `${fn}(${first}${second ? ', ' + second : ''})`,
    };
  }

  if (fn === 'aiKeyboardPress') {
    const maybeOpts = parseObjectLiteral(second);
    return {
      action: 'aiKeyboardPress',
      locate: promptArg,
      keyName: maybeOpts?.keyName || parseStringLiteral(second) || '',
      raw: `${fn}(${first}${second ? ', ' + second : ''})`,
    };
  }

  if (fn === 'aiScroll') {
    const opts = parseObjectLiteral(second) || {};
    return {
      action: 'aiScroll',
      locate: promptArg,
      direction: opts.direction || 'down',
      scrollType: opts.scrollType || 'singleAction',
      distance: typeof opts.distance === 'number' ? opts.distance : undefined,
      raw: `${fn}(${first}${second ? ', ' + second : ''})`,
    };
  }

  if (fn === 'aiWaitFor') {
    const opts = parseObjectLiteral(second) || {};
    return {
      action: 'aiWaitFor',
      prompt: promptArg,
      timeoutMs: typeof opts.timeoutMs === 'number' ? opts.timeoutMs : (typeof opts.timeout === 'number' ? opts.timeout : 30000),
      raw: `${fn}(${first}${second ? ', ' + second : ''})`,
    };
  }

  if (fn === 'aiAssert') {
    return {
      action: 'aiAssert',
      prompt: promptArg,
      raw: `${fn}(${first})`,
    };
  }

  if (fn === 'aiQuery' || fn === 'aiAsk' || fn === 'aiBoolean' || fn === 'aiNumber' || fn === 'aiString') {
    return {
      action: fn,
      prompt: promptArg,
      raw: `${fn}(${first})`,
    };
  }

  if (fn === 'aiAct' || fn === 'ai') {
    return {
      action: 'aiAct',
      prompt: promptArg,
      raw: `${fn}(${first})`,
    };
  }

  return null;
}

/** 简单字符串字面量解析：'..' / ".." / `..`（不处理嵌入表达式） */
function parseStringLiteral(s) {
  if (!s) return '';
  const t = s.trim();
  if (!t) return '';
  const ch = t[0];
  if (ch !== '"' && ch !== "'" && ch !== '`') return '';
  if (t[t.length - 1] !== ch) return '';
  return t.slice(1, -1).replace(/\\n/g, '\n').replace(/\\(['"`\\])/g, '$1');
}

/** 解析对象字面量 { direction:'down', scrollType:'singleAction', distance: 96 }。 */
function parseObjectLiteral(s) {
  if (!s) return null;
  const t = s.trim();
  if (!t.startsWith('{') || !t.endsWith('}')) return null;
  // 把 JS 对象快速转成 JSON：单引号 → 双引号；裸键加引号；去除尾逗号
  let json = t
    .replace(/(['"`])((?:\\.|(?!\1).)*)\1/g, (_, q, body) =>
      JSON.stringify(body.replace(/\\n/g, '\n').replace(/\\(['"`\\])/g, '$1')),
    )
    .replace(/([\{\,\s])([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
    .replace(/,\s*([}\]])/g, '$1');
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** 顶层逗号切分参数（同样要处理括号 / 字符串嵌套） */
function splitTopLevelArgs(s) {
  const out = [];
  let depth = 0;
  let inStr = null;
  let buf = '';
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      buf += ch;
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      buf += ch;
      inStr = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') { depth++; buf += ch; continue; }
    if (ch === ')' || ch === ']' || ch === '}') { depth--; buf += ch; continue; }
    if (ch === ',' && depth === 0) {
      out.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
