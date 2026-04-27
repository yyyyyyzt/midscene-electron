/**
 * 开发者取数：在 Bridge 已附加的 Chrome 页面上下文中执行 evaluateJavaScript，
 * 复用 Cookie / 登录态，返回 JSON 或脚本结果，再可选做字段映射供规则引擎使用。
 */

import vm from 'node:vm';

/**
 * @typedef {{
 *   mode: 'http' | 'script';
 *   method: string;
 *   url: string;
 *   headers: Record<string, string>;
 *   body: string;
 *   preScript: string;
 *   pageScript: string;
 *   fieldMappings: Array<{
 *     key: string;
 *     path?: string;
 *     expression?: string;
 *   }>;
 * }} DeveloperExtractConfig
 */

/** @param {any} raw @returns {DeveloperExtractConfig} */
export function normalizeDeveloperExtract(raw) {
  const base = {
    mode: 'http',
    method: 'GET',
    url: '',
    headers: {},
    body: '',
    preScript: '',
    pageScript: '',
    fieldMappings: [],
  };
  if (!raw || typeof raw !== 'object') return base;
  const mode = raw.mode === 'script' ? 'script' : 'http';
  const headers = raw.headers && typeof raw.headers === 'object' && !Array.isArray(raw.headers)
    ? { ...raw.headers }
    : {};
  const mappings = Array.isArray(raw.fieldMappings)
    ? raw.fieldMappings
        .filter((m) => m && typeof m === 'object' && String(m.key || '').trim())
        .map((m) => ({
          key: String(m.key).trim(),
          path: typeof m.path === 'string' ? m.path.trim() : '',
          expression: typeof m.expression === 'string' ? m.expression.trim() : '',
        }))
    : [];
  return {
    ...base,
    ...raw,
    mode,
    method: typeof raw.method === 'string' && raw.method.trim() ? raw.method.trim().toUpperCase() : 'GET',
    url: typeof raw.url === 'string' ? raw.url.trim() : '',
    headers,
    body: typeof raw.body === 'string' ? raw.body : '',
    preScript: typeof raw.preScript === 'string' ? raw.preScript : '',
    pageScript: typeof raw.pageScript === 'string' ? raw.pageScript : '',
    fieldMappings: mappings,
  };
}

/** @param {string} field @param {any} data */
function pickPath(field, data) {
  if (!field) return data;
  const parts = String(field).split('.').map((p) => p.trim()).filter(Boolean);
  let cur = data;
  for (const part of parts) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

/** @param {Record<string, any>} obj @param {string} dotted @param {any} val */
function setDeep(obj, dotted, val) {
  const parts = dotted.split('.').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return;
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = val;
}

/**
 * @param {any} raw
 * @param {DeveloperExtractConfig['fieldMappings']} mappings
 * @returns {{ mapped: Record<string, any>; errors: string[] }}
 */
export function applyFieldMappings(raw, mappings) {
  if (!mappings?.length) {
    return { mapped: raw, errors: [] };
  }
  const out = {};
  const errors = [];
  const ctxBase = { raw, JSON, Math, Date, String, Number, Boolean, Array, Object };

  for (const m of mappings) {
    const key = m.key;
    try {
      if (m.expression) {
        const script = new vm.Script(`(function(raw){ return (${m.expression}); })`);
        const fn = script.runInContext(vm.createContext(ctxBase));
        const v = fn(raw);
        setDeep(out, key, v);
      } else if (m.path) {
        setDeep(out, key, pickPath(m.path, raw));
      } else {
        setDeep(out, key, undefined);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${key}: ${msg}`);
      setDeep(out, key, undefined);
    }
  }
  return { mapped: out, errors };
}

function summarizeForLog(value, maxLen = 4000) {
  try {
    const s = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    if (s.length <= maxLen) return s;
    return `${s.slice(0, maxLen)}…（已截断，共 ${s.length} 字符）`;
  } catch {
    return String(value).slice(0, maxLen);
  }
}

/**
 * @param {DeveloperExtractConfig} c
 * @returns {string}
 */
function buildHttpScript(c) {
  const method = c.method || 'GET';
  const url = c.url || '';
  const headersJson = JSON.stringify(c.headers || {});
  const bodyStr = c.body != null ? String(c.body) : '';
  const pre = (c.preScript || '').trim();

  return `
(async function () {
  ${pre ? `${pre}\n` : ''}
  var __method = ${JSON.stringify(method)};
  var __url = ${JSON.stringify(url)};
  var __headers = ${headersJson};
  var __bodyStr = ${JSON.stringify(bodyStr)};
  var absUrl = new URL(__url, document.baseURI || location.href).toString();
  var init = { method: __method, headers: __headers };
  if (__bodyStr && __method !== 'GET' && __method !== 'HEAD') {
    init.body = __bodyStr;
  }
  var res = await fetch(absUrl, init);
  var text = await res.text();
  var json = null;
  try { json = JSON.parse(text); } catch (e) {}
  return {
    ok: res.ok,
    status: res.status,
    requestUrl: absUrl,
    json: json,
    textPreview: json == null ? text.slice(0, 12000) : undefined
  };
})()
`;
}

/**
 * @param {DeveloperExtractConfig} c
 * @returns {string}
 */
function buildScriptModeWrapper(c) {
  const pre = (c.preScript || '').trim();
  const body = (c.pageScript || '').trim();
  if (!body) {
    return `(async function(){ return null; })()`;
  }
  return `
(async function () {
  ${pre ? `${pre}\n` : ''}
  ${body}
})()
`;
}

/**
 * @param {{ evaluateJavaScript: (s: string) => Promise<any> }} agent
 * @param {DeveloperExtractConfig} config
 * @param {(line: string) => void} log
 */
export async function executeDeveloperExtract(agent, config, log) {
  const c = normalizeDeveloperExtract(config);
  if (c.mode === 'http') {
    if (!c.url?.trim()) {
      throw new Error('开发者取数（HTTP）：请填写 URL');
    }
  } else if (!c.pageScript?.trim()) {
    throw new Error('开发者取数（页面脚本）：请填写页面上下文 JavaScript');
  }

  const script = c.mode === 'http' ? buildHttpScript(c) : buildScriptModeWrapper(c);
  log(`开发者取数：执行页面脚本（${c.mode === 'http' ? 'HTTP' : '自定义脚本'}）…`);
  const started = Date.now();
  const rawFromPage = await agent.evaluateJavaScript(script);
  const durationMs = Date.now() - started;
  log(`开发者取数：页面返回（${durationMs} ms）`);

  const { mapped, errors } = applyFieldMappings(rawFromPage, c.fieldMappings);
  if (errors.length) {
    for (const err of errors) log(`字段映射警告：${err}`);
  }

  const rawSummary = summarizeForLog(rawFromPage);

  return {
    rawFromPage,
    rawSummary,
    mapped,
    mappingErrors: errors,
    durationMs,
    detail: {
      extractSource: 'developer',
      developerMode: c.mode,
      durationMs,
      rawSummary,
      rawFromPage,
      fieldMappings: c.fieldMappings,
      mapped,
      mappingErrors: errors.length ? errors : null,
      requestSummary: c.mode === 'http'
        ? { method: c.method, url: c.url, headerKeys: Object.keys(c.headers || {}) }
        : { scriptChars: c.pageScript.length },
    },
  };
}

/**
 * @param {import('../store/task-store.js').InspectionTask} task
 * @returns {boolean}
 */
export function taskUsesDeveloperExtract(task) {
  if (task.extractMode !== 'developer') return false;
  const c = normalizeDeveloperExtract(task.developerExtract);
  if (c.mode === 'http') return Boolean(c.url?.trim());
  return Boolean(c.pageScript?.trim());
}
