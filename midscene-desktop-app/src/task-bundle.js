/**
 * 单行 JSON 任务包，便于微信等渠道粘贴传播（不含 API Key）。
 * 格式: {"v":1,"n":"名称","m":"主任务","c":"业务上下文"}
 */

const BUNDLE_VERSION = 1;

/**
 * @param {{ name?: string, mainPrompt: string, businessContext?: string }} r
 * @returns {string} 单行 JSON
 */
export function exportTaskBundle(r) {
  const main = (r.mainPrompt || '').trim();
  if (!main) {
    throw new Error('主任务不能为空');
  }
  const obj = {
    v: BUNDLE_VERSION,
    n: (r.name || '').trim() || undefined,
    m: main,
    c: (r.businessContext || '').trim() || undefined,
  };
  return JSON.stringify(obj);
}

/**
 * @param {string} text
 * @returns {{ name: string, mainPrompt: string, businessContext: string }}
 */
export function importTaskBundle(text) {
  const raw = (text || '').trim();
  if (!raw) {
    throw new Error('粘贴内容为空');
  }
  let p;
  try {
    p = JSON.parse(raw);
  } catch {
    throw new Error('不是有效的 JSON，请粘贴完整的一行任务包');
  }
  if (p.v !== BUNDLE_VERSION) {
    throw new Error(`不支持的版本 v=${p.v}，当前仅支持 v=${BUNDLE_VERSION}`);
  }
  if (typeof p.m !== 'string' || !p.m.trim()) {
    throw new Error('任务包缺少字段 m（主任务）');
  }
  return {
    name: typeof p.n === 'string' ? p.n : '',
    mainPrompt: p.m.trim(),
    businessContext: typeof p.c === 'string' ? p.c : '',
  };
}
