/**
 * 基于 aiQuery 返回值的规则判断。
 *
 * 支持：
 *   - threshold: 对单字段做数值比较 (>, >=, <, <=, ==, !=, between)
 *   - missing:   字段为空 / null / undefined / 空数组 / 空字符串
 *   - expression: JS 表达式，`data` 为 aiQuery 的返回值
 *
 * 任何表达式求值在独立 VM 上下文中进行，防止主进程作用域泄漏。
 */

import vm from 'node:vm';

/**
 * @typedef {import('../store/task-store.js').RuleDef} RuleDef
 */

/**
 * @param {string} field
 * @param {any} data
 */
function pickField(field, data) {
  if (!field) return data;
  const parts = String(field)
    .split('.')
    .map((p) => p.trim())
    .filter(Boolean);
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
  if (!expr || !expr.trim()) return { ok: true, err: null };
  const script = new vm.Script(`(function(data){ return (${expr}); })`);
  const ctx = vm.createContext({ Math, Date });
  try {
    const fn = script.runInContext(ctx);
    const result = fn(data);
    return { ok: Boolean(result), err: null, raw: result };
  } catch (e) {
    return { ok: false, err: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * @param {RuleDef} rule
 * @param {any} data
 * @returns {{ ok: boolean; message: string; severity: 'info' | 'warning' | 'critical' }}
 */
export function evaluateRule(rule, data) {
  const severity = rule.severity || 'warning';
  try {
    if (rule.type === 'threshold') {
      const actual = pickField(rule.field, data);
      const num = coerceNumber(actual);
      if (Number.isNaN(num)) {
        return {
          ok: false,
          severity,
          message:
            rule.message ||
            `字段 ${rule.field} 无法转为数字（实际: ${JSON.stringify(actual)}）`,
        };
      }
      const target = coerceNumber(rule.value);
      let pass = true;
      switch (rule.op) {
        case '>': pass = num > target; break;
        case '>=': pass = num >= target; break;
        case '<': pass = num < target; break;
        case '<=': pass = num <= target; break;
        case '==': pass = num === target; break;
        case '!=': pass = num !== target; break;
        case 'between': {
          const hi = coerceNumber(rule.value2);
          pass = num >= target && num <= hi;
          break;
        }
        default: pass = true;
      }
      return {
        ok: pass,
        severity,
        message: pass
          ? `规则通过：${rule.field} ${rule.op} ${rule.value}（实际 ${num}）`
          : rule.message ||
            `规则失败：${rule.field} ${rule.op} ${rule.value}（实际 ${num}）`,
      };
    }

    if (rule.type === 'missing') {
      const actual = pickField(rule.field, data);
      const miss = isEmpty(actual);
      return {
        ok: !miss,
        severity,
        message: miss
          ? rule.message || `字段 ${rule.field} 缺失或为空`
          : `字段 ${rule.field} 存在`,
      };
    }

    if (rule.type === 'expression') {
      const r = evalExpression(rule.expression || '', data);
      if (r.err) {
        return {
          ok: false,
          severity,
          message: rule.message || `表达式执行失败：${r.err}`,
        };
      }
      return {
        ok: r.ok,
        severity,
        message: r.ok
          ? `表达式通过：${rule.expression}`
          : rule.message || `表达式不满足：${rule.expression}`,
      };
    }

    return { ok: true, severity, message: `未知规则类型：${rule.type}` };
  } catch (e) {
    return {
      ok: false,
      severity: 'critical',
      message: `规则执行异常：${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * @param {RuleDef[]} rules
 * @param {any} data
 */
export function evaluateRules(rules, data) {
  const results = [];
  for (const rule of rules || []) {
    const r = evaluateRule(rule, data);
    results.push({
      ruleId: rule.id,
      ok: r.ok,
      severity: r.severity,
      message: r.message,
    });
  }
  const failed = results.filter((r) => !r.ok);
  return { results, failed };
}
