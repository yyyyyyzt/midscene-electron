import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const FILE_NAME = 'alerts.json';

/**
 * 告警状态机：
 *  - active   任务异常中，未处理
 *  - ack      用户已确认，但问题仍在发生
 *  - silenced 用户手动静默，不再弹通知（到期/手动恢复解除）
 *  - recovered 任务恢复正常
 *
 * @typedef {{
 *   id: string;
 *   taskId: string;
 *   taskName: string;
 *   firstSeenAt: number;
 *   lastSeenAt: number;
 *   recoveredAt: number | null;
 *   count: number;
 *   lastRunId: string | null;
 *   lastMessage: string;
 *   lastSeverity: 'info' | 'warning' | 'critical';
 *   state: 'active' | 'ack' | 'silenced' | 'recovered';
 *   silencedUntil: number | null;
 *   lastNotifiedAt: number | null;
 * }} AlertEvent
 */

function filePath(userDataPath) {
  return path.join(userDataPath, FILE_NAME);
}

const VALID_ALERT_STATES = new Set(['active', 'ack', 'silenced', 'recovered']);

/** @param {unknown} raw */
function normalizeAlertState(raw) {
  if (raw == null || raw === '') return 'active';
  const s = String(raw).trim().toLowerCase();
  if (VALID_ALERT_STATES.has(s)) return /** @type {'active' | 'ack' | 'silenced' | 'recovered'} */ (s);
  return 'active';
}

function load(userDataPath) {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath(userDataPath), 'utf8'));
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((e) => e && typeof e === 'object')
      .map((e) => ({ ...e, state: normalizeAlertState(e.state) }));
  } catch {}
  return [];
}

function save(userDataPath, list) {
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(filePath(userDataPath), JSON.stringify(list, null, 2), 'utf8');
}

/**
 * 找到给定任务当前未恢复的告警（active / ack / silenced）。
 */
function findOpen(list, taskId) {
  return list.find(
    (e) => e.taskId === taskId && e.state !== 'recovered',
  );
}

/**
 * @param {string} userDataPath
 * @returns {AlertEvent[]}
 */
export function listAlerts(userDataPath) {
  return load(userDataPath).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

/**
 * @param {string} userDataPath
 * @param {{
 *   taskId: string;
 *   taskName: string;
 *   runId: string;
 *   message: string;
 *   severity: 'info' | 'warning' | 'critical';
 * }} input
 * @returns {{ event: AlertEvent; shouldNotify: boolean; isNew: boolean }}
 */
export function reportFailure(userDataPath, input) {
  const list = load(userDataPath);
  const existing = findOpen(list, input.taskId);
  const nowTs = Date.now();
  if (existing) {
    existing.state = normalizeAlertState(existing.state);
    existing.lastSeenAt = nowTs;
    existing.count += 1;
    existing.lastRunId = input.runId;
    existing.lastMessage = input.message;
    existing.lastSeverity = input.severity;
    if (existing.state === 'silenced') {
      if (existing.silencedUntil && existing.silencedUntil <= nowTs) {
        existing.state = 'active';
        existing.silencedUntil = null;
      }
    }
    const shouldNotify = existing.state === 'active' || existing.state === 'ack';
    if (shouldNotify) existing.lastNotifiedAt = nowTs;
    save(userDataPath, list);
    return { event: existing, shouldNotify, isNew: false };
  }

  /** @type {AlertEvent} */
  const ev = {
    id: randomUUID(),
    taskId: input.taskId,
    taskName: input.taskName,
    firstSeenAt: nowTs,
    lastSeenAt: nowTs,
    recoveredAt: null,
    count: 1,
    lastRunId: input.runId,
    lastMessage: input.message,
    lastSeverity: input.severity,
    state: 'active',
    silencedUntil: null,
    lastNotifiedAt: nowTs,
  };
  list.push(ev);
  save(userDataPath, list);
  return { event: ev, shouldNotify: true, isNew: true };
}

/**
 * 任务成功时调用：如果之前有 open 告警，切换为 recovered 并返回恢复事件。
 * @param {string} userDataPath
 * @param {{ taskId: string; taskName: string; runId: string }} input
 * @returns {{ event: AlertEvent | null; shouldNotify: boolean }}
 */
export function reportRecovery(userDataPath, input) {
  const list = load(userDataPath);
  const existing = findOpen(list, input.taskId);
  if (!existing) return { event: null, shouldNotify: false };
  existing.state = 'recovered';
  existing.recoveredAt = Date.now();
  existing.lastRunId = input.runId;
  save(userDataPath, list);
  return { event: existing, shouldNotify: true };
}

/**
 * @param {string} userDataPath
 * @param {string} id
 * @param {'ack' | 'silence' | 'recover'} action
 * @param {number} [silenceMinutes]
 */
export function updateAlertState(userDataPath, id, action, silenceMinutes) {
  const list = load(userDataPath);
  const ev = list.find((e) => e.id === id);
  if (!ev) return null;
  ev.state = normalizeAlertState(ev.state);
  if (action === 'ack') {
    ev.state = 'ack';
  } else if (action === 'silence') {
    ev.state = 'silenced';
    const mins = Number(silenceMinutes) || 60;
    ev.silencedUntil = Date.now() + mins * 60 * 1000;
  } else if (action === 'recover') {
    ev.state = 'recovered';
    ev.recoveredAt = Date.now();
  }
  save(userDataPath, list);
  return ev;
}

/**
 * 未处理 / 活跃告警数量（用于 badge）。
 * @param {string} userDataPath
 */
export function countUnresolved(userDataPath) {
  return load(userDataPath).filter((e) => {
    const st = normalizeAlertState(e.state);
    return st === 'active' || st === 'ack';
  }).length;
}

/**
 * 删除指定告警事件。
 * @param {string} userDataPath
 * @param {string[]} ids
 */
export function deleteAlerts(userDataPath, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return { ok: true, deleted: 0 };
  const set = new Set(ids);
  const list = load(userDataPath);
  const next = list.filter((e) => !set.has(e.id));
  save(userDataPath, next);
  return { ok: true, deleted: list.length - next.length };
}

/**
 * 清空告警。
 *  - scope='all'        全清
 *  - scope='resolved'   仅清已恢复
 * @param {string} userDataPath
 * @param {'all' | 'resolved'} [scope]
 */
export function clearAlerts(userDataPath, scope = 'all') {
  const list = load(userDataPath);
  const next = scope === 'resolved' ? list.filter((e) => e.state !== 'recovered') : [];
  save(userDataPath, next);
  return { ok: true, deleted: list.length - next.length };
}
