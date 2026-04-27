import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const RUNS_DIR = 'runs';
const INDEX_FILE = 'runs-index.json';
const MAX_RUNS_PER_TASK = 100;

/**
 * @typedef {{
 *   id: string;
 *   taskId: string;
 *   taskName: string;
 *   startedAt: number;
 *   finishedAt: number | null;
 *   status: 'running' | 'ok' | 'alert' | 'error';
 *   durationMs: number | null;
 *   extracted: any;
 *   ruleResults: Array<import('../runtime/rule-engine.js').RuleResult>;
 *   phases: Array<{
 *     name: string;
 *     label: string;
 *     status: 'skipped' | 'ok' | 'error';
 *     startedAt: number;
 *     durationMs: number;
 *     error: string | null;
 *     detail: any;
 *   }>;
 *   error: string | null;
 *   log: string[];
 *   reportPath: string | null;
 * }} RunRecord
 */

/** @param {string} userDataPath */
function runsDirFor(userDataPath) {
  const dir = path.join(userDataPath, RUNS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function indexPath(userDataPath) {
  return path.join(runsDirFor(userDataPath), INDEX_FILE);
}

/**
 * @param {string} userDataPath
 * @returns {Record<string, string[]>} taskId -> runId[] (newest first)
 */
function loadIndex(userDataPath) {
  try {
    const raw = JSON.parse(fs.readFileSync(indexPath(userDataPath), 'utf8'));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  } catch {}
  return {};
}

function saveIndex(userDataPath, idx) {
  fs.writeFileSync(indexPath(userDataPath), JSON.stringify(idx, null, 2), 'utf8');
}

function runFilePath(userDataPath, runId) {
  return path.join(runsDirFor(userDataPath), `${runId}.json`);
}

/**
 * @param {string} userDataPath
 * @param {Pick<RunRecord,'taskId'|'taskName'>} seed
 * @returns {RunRecord}
 */
export function startRun(userDataPath, seed) {
  /** @type {RunRecord} */
  const rec = {
    id: randomUUID(),
    taskId: seed.taskId,
    taskName: seed.taskName,
    startedAt: Date.now(),
    finishedAt: null,
    status: 'running',
    durationMs: null,
    extracted: null,
    ruleResults: [],
    phases: [],
    error: null,
    log: [],
    reportPath: null,
  };
  fs.writeFileSync(runFilePath(userDataPath, rec.id), JSON.stringify(rec, null, 2), 'utf8');
  return rec;
}

/**
 * @param {string} userDataPath
 * @param {RunRecord} rec
 */
export function finishRun(userDataPath, rec) {
  rec.finishedAt = Date.now();
  rec.durationMs = rec.finishedAt - rec.startedAt;
  fs.writeFileSync(runFilePath(userDataPath, rec.id), JSON.stringify(rec, null, 2), 'utf8');

  const idx = loadIndex(userDataPath);
  const list = idx[rec.taskId] || [];
  list.unshift(rec.id);
  if (list.length > MAX_RUNS_PER_TASK) {
    const removed = list.splice(MAX_RUNS_PER_TASK);
    for (const rid of removed) {
      try {
        fs.rmSync(runFilePath(userDataPath, rid), { force: true });
      } catch {}
    }
  }
  idx[rec.taskId] = list;
  saveIndex(userDataPath, idx);
  return rec;
}

/**
 * @param {string} userDataPath
 * @param {string} runId
 * @returns {RunRecord | null}
 */
export function getRun(userDataPath, runId) {
  try {
    return JSON.parse(fs.readFileSync(runFilePath(userDataPath, runId), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * @param {string} userDataPath
 * @param {string | null} taskId
 * @param {number} limit
 */
export function listRecentRuns(userDataPath, taskId, limit = 50) {
  const idx = loadIndex(userDataPath);
  let ids;
  if (taskId) {
    ids = (idx[taskId] || []).slice(0, limit);
  } else {
    /** @type {{ id: string, startedAt: number }[]} */
    const all = [];
    for (const list of Object.values(idx)) {
      for (const rid of list) {
        const rec = getRun(userDataPath, rid);
        if (rec) all.push({ id: rid, startedAt: rec.startedAt });
      }
    }
    all.sort((a, b) => b.startedAt - a.startedAt);
    ids = all.slice(0, limit).map((x) => x.id);
  }
  return ids.map((rid) => getRun(userDataPath, rid)).filter(Boolean);
}

/**
 * 删除指定的若干条执行记录。
 *
 * @param {string} userDataPath
 * @param {string[]} runIds
 */
export function deleteRuns(userDataPath, runIds) {
  if (!Array.isArray(runIds) || runIds.length === 0) return { ok: true, deleted: 0 };
  const idx = loadIndex(userDataPath);
  const set = new Set(runIds);
  let deleted = 0;
  for (const taskId of Object.keys(idx)) {
    const before = idx[taskId];
    const after = before.filter((rid) => !set.has(rid));
    if (after.length !== before.length) {
      idx[taskId] = after;
    }
  }
  for (const rid of runIds) {
    try {
      fs.rmSync(runFilePath(userDataPath, rid), { force: true });
      deleted++;
    } catch {}
  }
  saveIndex(userDataPath, idx);
  return { ok: true, deleted };
}

/**
 * 清空所有执行记录（可选只清某个任务）。
 *
 * @param {string} userDataPath
 * @param {string | null} [taskId]
 */
export function clearRuns(userDataPath, taskId) {
  const idx = loadIndex(userDataPath);
  /** @type {string[]} */
  let toRemove = [];
  if (taskId) {
    toRemove = idx[taskId] || [];
    delete idx[taskId];
  } else {
    for (const list of Object.values(idx)) toRemove.push(...list);
    for (const k of Object.keys(idx)) delete idx[k];
  }
  for (const rid of toRemove) {
    try { fs.rmSync(runFilePath(userDataPath, rid), { force: true }); } catch {}
  }
  saveIndex(userDataPath, idx);
  return { ok: true, deleted: toRemove.length };
}

/**
 * 统计数据。
 * @param {string} userDataPath
 */
export function stats(userDataPath) {
  const idx = loadIndex(userDataPath);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = today.getTime();

  let todayCount = 0;
  let todayAlerts = 0;
  let todayErrors = 0;
  for (const list of Object.values(idx)) {
    for (const rid of list) {
      const rec = getRun(userDataPath, rid);
      if (!rec) continue;
      if (rec.startedAt < start) break;
      todayCount++;
      if (rec.status === 'alert') todayAlerts++;
      if (rec.status === 'error') todayErrors++;
    }
  }
  return { todayCount, todayAlerts, todayErrors };
}
