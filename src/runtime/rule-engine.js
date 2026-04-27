/**
 * 基于 aiQuery 返回值的规则判断。
 *
 * 一条规则有两层语义：
 *   1. 「条件」：由 type + field/op/value 或 expression 组成，是个纯布尔判断。
 *   2. 「触发方向 when」：
 *        - 'fail'（默认 · 推荐）：条件成立 → 触发告警；多用于「< 10 报警」「字段缺失就报警」类需求。
 *        - 'pass'：条件成立 → 通过；多用于「期望 > 0」类健康检查。
 *      普通用户描述需求时几乎都是 fail 语义，所以 fail 设为默认。
 *
 * 输出 RuleResult 中：
 *   - conditionMet: 条件是否成立（与 when 无关）
 *   - triggered:    是否触发告警（综合 when 后的最终判断）
 *   - ok = !triggered（保留向前兼容字段）
 *
 * 任何表达式求值在独立 VM 上下文中进行，防止主进程作用域泄漏。
 */

import vm from 'node:vm';

/**
 * @typedef {import('../store/task-store.js').RuleDef} RuleDef
 *
 * @typedef {{
 *   ruleId: string;
 *   ruleType: 'threshold' | 'missing' | 'expression';
 *   when: 'fail' | 'pass';
 *   severity: 'info' | 'warning' | 'critical';
 *   conditionMet: boolean;
 *   conditionLabel: string;
 *   actual: any;
 *   triggered: boolean;
 *   ok: boolean;
 *   message: string;
 *   error: string | null;
 * }} RuleResult
 */

/** @param {string} field @param {any} data */
function pickField(field, data) {
  if (!field) return data;
  const parts = String(field).split('.').map((p) => p.trim()).filter(Boolean);
  let cur = data;
  for (const part of parts) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

function coerceNumber(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[,\s]/g, '').replace(/%$/, '');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

function isEmpty(v) {
  if (v == null) return true;
  if (typeof v === 'string' && v.trim() === '') return true;
  if (Array.isArray(v) && v.length === 0) return true;
  if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return true;
  return false;
}

function evalExpression(expr, data) {
  if (!expr || !expr.trim()) {
    return { ok: false, err: '表达式为空' };
  }
  let script;
  try {
    script = new vm.Script(`(function(data){ return (${expr}); })`);
  } catch (e) {
    return { ok: false, err: `表达式语法错误：${e instanceof Error ? e.message : String(e)}` };
  }
  const ctx = vm.createContext({ Math, Date });
  try {
    const fn = script.runInContext(ctx);
    const result = fn(data);
    return { ok: Boolean(result), err: null, raw: result };
  } catch (e) {
    return { ok: false, err: e instanceof Error ? e.message : String(e) };
  }
}

function fmtVal(v) {
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return JSON.stringify(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}

function whenOf(rule) {
  return rule.when === 'pass' ? 'pass' : 'fail';
}

/**
 * @param {RuleDef} rule
 * @param {any} data
 * @returns {RuleResult}
 */
export function evaluateRule(rule, data) {
  const severity = rule.severity || 'warning';
  const when = whenOf(rule);

  /** 内部统一收尾 */
  const finalize = (partial) => {
    const triggered = partial.error
      ? true
      : when === 'fail'
        ? partial.conditionMet
        : !partial.conditionMet;
    let message = partial.message;
    if (!message) {
      if (partial.error) {
        message = `规则执行失败：${partial.error}`;
      } else if (triggered) {
        message =
          rule.message ||
          (when === 'fail'
            ? `命中告警条件：${partial.conditionLabel}`
            : `期望成立但未成立：${partial.conditionLabel}`);
      } else {
        message =
          when === 'fail'
            ? `未触发：${partial.conditionLabel}`
            : `期望成立且已成立：${partial.conditionLabel}`;
      }
    }
    return {
      ruleId: rule.id,
      ruleType: rule.type,
      when,
      severity,
      conditionMet: Boolean(partial.conditionMet),
      conditionLabel: partial.conditionLabel,
      actual: partial.actual,
      triggered,
      ok: !triggered,
      message,
      error: partial.error || null,
    };
  };

  try {
    if (rule.type === 'threshold') {
      const actual = pickField(rule.field, data);
      const num = coerceNumber(actual);
      const valLabel = rule.op === 'between'
        ? `${rule.field} 在 [${rule.value}, ${rule.value2}]`
        : `${rule.field} ${rule.op} ${rule.value}`;
      if (Number.isNaN(num)) {
        return finalize({
          conditionMet: false,
          conditionLabel: valLabel,
          actual,
          error: `字段 ${rule.field} 不是数字（实际: ${fmtVal(actual)}）`,
        });
      }
      const target = coerceNumber(rule.value);
      let condition = false;
      switch (rule.op) {
        case '>': condition = num > target; break;
        case '>=': condition = num >= target; break;
        case '<': condition = num < target; break;
        case '<=': condition = num <= target; break;
        case '==': condition = num === target; break;
        case '!=': condition = num !== target; break;
        case 'between': {
          const hi = coerceNumber(rule.value2);
          condition = num >= target && num <= hi;
          break;
        }
        default: condition = false;
      }
      return finalize({
        conditionMet: condition,
        conditionLabel: `${valLabel}（实际 ${num}）`,
        actual: num,
      });
    }

    if (rule.type === 'missing') {
      const actual = pickField(rule.field, data);
      const miss = isEmpty(actual);
      return finalize({
        conditionMet: miss,
        conditionLabel: `${rule.field} 缺失或为空`,
        actual,
      });
    }

    if (rule.type === 'expression') {
      const r = evalExpression(rule.expression || '', data);
      if (r.err) {
        return finalize({
          conditionMet: false,
          conditionLabel: rule.expression || '',
          actual: undefined,
          error: r.err,
        });
      }
      return finalize({
        conditionMet: r.ok,
        conditionLabel: rule.expression || '',
        actual: r.raw,
      });
    }

    return finalize({
      conditionMet: false,
      conditionLabel: `未知规则类型：${rule.type}`,
      actual: undefined,
      error: `未知规则类型：${rule.type}`,
    });
  } catch (e) {
    return finalize({
      conditionMet: false,
      conditionLabel: '',
      actual: undefined,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * @param {RuleDef[]} rules
 * @param {any} data
 */
export function evaluateRules(rules, data) {
  /** @type {RuleResult[]} */
  const results = [];
  for (const rule of rules || []) {
    results.push(evaluateRule(rule, data));
  }
  const triggered = results.filter((r) => r.triggered);
  return { results, triggered };
}
