/**
 * AI 任务生成器：把一句中文描述变成结构化巡检任务。
 *
 * 设计目标：
 *  - 默认走「默认执行模型」（与 Midscene 共用一套配置），无需额外配 Key。
 *  - 走 OpenAI 兼容 chat/completions 接口（豆包/Doubao 在方舟上即兼容）。
 *  - 强制返回 JSON；解析失败时返回友好错误，让 UI 提示用户改用高级模式。
 *  - 不直接执行任何浏览器操作，只生成草稿。
 */

import { taskTemplate } from '../store/task-store.js';

/** 系统提示词，约束模型严格按 schema 返回 JSON。 */
const SYSTEM_PROMPT = `你是一个浏览器巡检任务生成助手。
用户会用一句话或一段话描述他想监控的页面，请输出一个 JSON 对象，描述完整的巡检任务，字段含义如下：

{
  "name": string,                       // 简洁中文名，例如「订单系统-实时成交量」
  "systemName": string,                 // 推断的业务系统名，无法判断时可空
  "entryUrl": string,                   // 入口 URL；用户没说就留空字符串
  "description": string,                // 业务背景与术语，写给后续模型的上下文
  "runMode": "newTabWithUrl" | "currentTab",  // 默认 newTabWithUrl
  "closeTabAfter": boolean,             // 默认 true
  "readyPrompt": string,                // 给 aiWaitFor 用：判断页面就绪的中文条件
  "extractPrompt": string,              // 给 aiQuery 用：提取关键指标的指令
  "extractSchema": string,              // 自然语言描述返回结构，例如 { "orderCount": number }
  "loginAssertPrompt": string,          // 给 aiAssert 用：用于判断不是登录页/错误页/空白页
  "rules": Array<RuleDef>,              // 巡检规则
  "schedule": {
    "enabled": boolean,                  // 默认 true
    "intervalMinutes": number,            // 默认 10
    "activeFrom": string,                 // 默认 "00:00"
    "activeTo": string,                   // 默认 "23:59"
    "timeoutSeconds": number,             // 默认 180
    "retry": number                       // 默认 1
  },
  "alert": {
    "enabled": boolean,                   // 默认 true
    "repeatSuppressMinutes": number       // 默认 30
  }
}

【规则语义 · 极其重要】
每条规则都是「告警条件」，即「条件成立时触发告警」。请用 when 显式标注：
  - when="fail"（推荐 · 默认）：条件成立就报警。例如「余额 < 10 就报警」请生成
        {"type":"threshold","when":"fail","field":"balance","op":"<","value":10}
  - when="pass"：条件成立才算通过。仅当用户明确表述「期望成立」「应该 xxx」时才用。
不要用反向思维写阈值。用户说「< 10 报警」就直接写 op:"<" + value:10 + when:"fail"，
**不要**改成 op:">=" 让它通过。

RuleDef 三选一：
  数值阈值: { "id": "rXXXX", "type": "threshold", "when": "fail"|"pass", "field": "字段路径", "op": ">|>=|<|<=|==|!=|between", "value": number|string, "value2"?: number, "severity": "info|warning|critical", "message"?: string }
  字段缺失: { "id": "rXXXX", "type": "missing", "when": "fail", "field": "字段路径", "severity": "info|warning|critical", "message"?: string }
  JS 表达式: { "id": "rXXXX", "type": "expression", "when": "fail"|"pass", "expression": "data.xxx < 10", "severity": "info|warning|critical", "message"?: string }

写规则时务必保证：
  - extractSchema 描述的字段名要和 rules 里的 field 完全一致；
  - severity 默认 warning；用户用「严重 / 立刻 / 紧急」等词汇时升级为 critical；
  - 如果是「字段缺失/页面没有显示 X」的需求，使用 missing 规则（默认 when=fail）；
  - 默认 runMode 为 newTabWithUrl；只有用户明确说「我已经打开页面」「当前标签」才用 currentTab；
  - 规则的 message 字段写一句中文，给值班人员看的告警标题。

【示例】
用户："监控 https://x.example/finance，余额低于 10 元就提醒我"
应输出（节选）:
  "rules":[{"id":"r_low_balance","type":"threshold","when":"fail","field":"balance","op":"<","value":10,"severity":"warning","message":"账户余额低于阈值"}]

用户："看下 https://crm.example/orders 今天订单数还正常吗，少于 50 单就报警，0 单立即报警"
应输出（节选）:
  "rules":[
    {"id":"r_low","type":"threshold","when":"fail","field":"orderCount","op":"<","value":50,"severity":"warning","message":"今日订单偏少"},
    {"id":"r_zero","type":"threshold","when":"fail","field":"orderCount","op":"==","value":0,"severity":"critical","message":"今日订单为零"}
  ]

只输出 JSON 对象，禁止任何解释、Markdown、代码块标记。`;

/**
 * @param {{
 *   description: string;
 *   profile: { apiKey: string; baseUrl: string; modelName: string; modelFamily?: string };
 *   signal?: AbortSignal;
 * }} input
 * @returns {Promise<{ ok: true; task: any } | { ok: false; error: string; raw?: string }>}
 */
export async function generateTaskFromPrompt(input) {
  const { description, profile } = input;
  if (!description?.trim()) {
    return { ok: false, error: '请输入任务描述（一句话即可）。' };
  }
  const apiKey = (profile.apiKey || '').trim();
  const baseUrl = (profile.baseUrl || '').trim().replace(/\/+$/, '');
  const modelName = (profile.modelName || '').trim();
  if (!apiKey || !baseUrl || !modelName) {
    return {
      ok: false,
      error:
        '默认模型未完整配置，请到「设置 → 默认执行模型」填入 API Key、Base URL 与模型名（豆包用户可点「使用豆包预设」一键填充）。',
    };
  }

  const url = `${baseUrl}/chat/completions`;
  const body = {
    model: modelName,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `用户描述：\n${description.trim()}` },
    ],
  };

  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: input.signal,
    });
  } catch (e) {
    return {
      ok: false,
      error: `调用模型失败：${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (!resp.ok) {
    const text = await safeText(resp);
    return {
      ok: false,
      error: `模型返回 HTTP ${resp.status}：${text.slice(0, 600)}`,
    };
  }

  /** @type {any} */
  let payload;
  try {
    payload = await resp.json();
  } catch (e) {
    return { ok: false, error: '模型响应无法解析为 JSON。' };
  }

  const content = extractContent(payload);
  if (!content) {
    return { ok: false, error: '模型未返回内容。', raw: JSON.stringify(payload).slice(0, 800) };
  }

  /** @type {any} */
  let parsed;
  try {
    parsed = JSON.parse(stripCodeFence(content));
  } catch {
    return {
      ok: false,
      error: '模型未返回合法 JSON，请尝试换一种描述或改用「高级模式」。',
      raw: content.slice(0, 800),
    };
  }

  const task = mergeWithTemplate(parsed);
  return { ok: true, task };
}

function safeText(r) {
  return r.text().catch(() => '');
}

function extractContent(payload) {
  const choice = payload?.choices?.[0];
  if (!choice) return '';
  const c = choice.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('');
  }
  return '';
}

function stripCodeFence(s) {
  let t = String(s || '').trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  }
  return t;
}

/** 把模型输出与默认模板合并，保证字段齐全。 */
function mergeWithTemplate(parsed) {
  const tpl = taskTemplate();
  const out = { ...tpl, ...parsed };
  out.runMode = parsed.runMode === 'currentTab' ? 'currentTab' : 'newTabWithUrl';
  out.closeTabAfter = parsed.closeTabAfter !== false;
  out.schedule = { ...tpl.schedule, ...(parsed.schedule || {}) };
  out.alert = { ...tpl.alert, ...(parsed.alert || {}) };
  if (!Array.isArray(parsed.rules)) out.rules = [];
  else {
    out.rules = parsed.rules
      .filter((r) => r && typeof r === 'object')
      .map((r, idx) => {
        const id = typeof r.id === 'string' && r.id ? r.id : `r_${Date.now().toString(36)}_${idx}`;
        const severity = ['info', 'warning', 'critical'].includes(r.severity) ? r.severity : 'warning';
        const when = r.when === 'pass' ? 'pass' : 'fail';
        if (r.type === 'threshold') {
          return {
            id, type: 'threshold', when,
            field: String(r.field || ''),
            op: ['>', '>=', '<', '<=', '==', '!=', 'between'].includes(r.op) ? r.op : '<',
            value: r.value,
            value2: r.value2,
            severity,
            message: typeof r.message === 'string' ? r.message : undefined,
          };
        }
        if (r.type === 'missing') {
          return {
            id, type: 'missing', when,
            field: String(r.field || ''),
            severity,
            message: typeof r.message === 'string' ? r.message : undefined,
          };
        }
        return {
          id, type: 'expression', when,
          expression: typeof r.expression === 'string' ? r.expression : '',
          severity,
          message: typeof r.message === 'string' ? r.message : undefined,
        };
      });
  }
  // 任务名兜底
  if (!out.name?.trim()) {
    out.name = '新巡检任务';
  }
  return out;
}
