import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const FILE_NAME = 'tasks.json';
const LEGACY_RECIPE = 'task-recipe.json';

/**
 * 巡检规则。
 *
 *  - when='fail' (默认): 条件成立 → 触发告警（普通用户写「<10 报警」就用 fail）
 *  - when='pass'        : 条件成立 → 通过（健康检查语义）
 *
 * @typedef {{
 *   id: string;
 *   type: 'threshold' | 'missing' | 'expression';
 *   when?: 'fail' | 'pass';
 *   field?: string;
 *   op?: '>' | '>=' | '<' | '<=' | '==' | '!=' | 'between';
 *   value?: number | string;
 *   value2?: number;
 *   expression?: string;
 *   message?: string;
 *   severity?: 'info' | 'warning' | 'critical';
 * }} RuleDef
 */

/**
 * @typedef {{
 *   id: string;
 *   name: string;
 *   systemName: string;
 *   entryUrl: string;
 *   description: string;
 *   runMode: 'newTabWithUrl' | 'currentTab';
 *   closeTabAfter: boolean;
 *   readyPrompt: string;
 *   extractPrompt: string;
 *   extractSchema: string;
 *   loginAssertPrompt: string;
 *   flowYaml: string;
 *   flowSource: 'playwright' | 'yaml' | 'auto' | 'none';
 *   aiFallback: boolean;
 *   rules: RuleDef[];
 *   schedule: {
 *     enabled: boolean;
 *     intervalMinutes: number;
 *     activeFrom: string;
 *     activeTo: string;
 *     timeoutSeconds: number;
 *     retry: number;
 *   };
 *   alert: {
 *     enabled: boolean;
 *     repeatSuppressMinutes: number;
 *   };
 *   paused: boolean;
 *   lastStatus: 'never' | 'ok' | 'alert' | 'error';
 *   lastRunAt: number | null;
 *   nextRunAt: number | null;
 *   createdAt: number;
 *   updatedAt: number;
 * }} InspectionTask
 */

/** @type {Omit<InspectionTask, 'id' | 'createdAt' | 'updatedAt'>} */
const TEMPLATE = {
  name: '新巡检任务',
  systemName: '',
  entryUrl: '',
  description: '',
  runMode: 'newTabWithUrl',
  closeTabAfter: true,
  readyPrompt: '请在页面上确认主要指标卡片/表格已经加载完成',
  extractPrompt: '请提取页面上的关键指标，返回 JSON 对象',
  extractSchema: '',
  loginAssertPrompt: '当前页面是业务后台页面，不是登录页、错误页、空白页',
  flowYaml: '',
  flowSource: 'auto',
  aiFallback: true,
  rules: [],
  schedule: {
    enabled: true,
    intervalMinutes: 10,
    activeFrom: '00:00',
    activeTo: '23:59',
    timeoutSeconds: 180,
    retry: 1,
  },
  alert: {
    enabled: true,
    repeatSuppressMinutes: 30,
  },
  paused: false,
  lastStatus: 'never',
  lastRunAt: null,
  nextRunAt: null,
};

function now() {
  return Date.now();
}

function tasksFilePath(userDataPath) {
  return path.join(userDataPath, FILE_NAME);
}

/**
 * 合并默认值，保证读到的老数据不缺字段。
 * @param {any} raw
 * @returns {InspectionTask | null}
 */
function normalizeTask(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const t = /** @type {InspectionTask} */ ({
    id: typeof raw.id === 'string' && raw.id ? raw.id : randomUUID(),
    ...TEMPLATE,
    ...raw,
    schedule: { ...TEMPLATE.schedule, ...(raw.schedule || {}) },
    alert: { ...TEMPLATE.alert, ...(raw.alert || {}) },
    rules: Array.isArray(raw.rules) ? raw.rules : [],
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now(),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now(),
  });
  if (t.runMode !== 'currentTab') t.runMode = 'newTabWithUrl';
  return t;
}

/**
 * 迁移老的 task-recipe.json 到首条任务（仅在 tasks.json 不存在时执行一次）。
 * @param {string} userDataPath
 * @returns {InspectionTask[]}
 */
function migrateLegacy(userDataPath) {
  const legacy = path.join(userDataPath, LEGACY_RECIPE);
  try {
    const raw = JSON.parse(fs.readFileSync(legacy, 'utf8'));
    const name = (raw.name || '').trim() || '来自旧版本的任务样板';
    const main = (raw.mainPrompt || '').trim();
    const ctx = (raw.businessContext || '').trim();
    if (!main && !ctx) return [];
    return [
      normalizeTask({
        id: randomUUID(),
        name,
        systemName: '',
        entryUrl: '',
        description: ctx,
        runMode: 'currentTab',
        closeTabAfter: false,
        readyPrompt: '页面主要内容已加载',
        extractPrompt: main || '请按说明操作或提取关键数据',
        paused: true,
      }),
    ];
  } catch {
    return [];
  }
}

/**
 * @param {string} userDataPath
 * @returns {InspectionTask[]}
 */
export function loadAllTasks(userDataPath) {
  const file = tasksFilePath(userDataPath);
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeTask).filter(Boolean);
  } catch {
    const migrated = migrateLegacy(userDataPath);
    if (migrated.length) {
      saveAllTasks(userDataPath, migrated);
    }
    return migrated;
  }
}

/**
 * @param {string} userDataPath
 * @param {InspectionTask[]} tasks
 */
export function saveAllTasks(userDataPath, tasks) {
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(tasksFilePath(userDataPath), JSON.stringify(tasks, null, 2), 'utf8');
}

/**
 * @param {string} userDataPath
 * @param {Partial<InspectionTask>} input
 * @returns {InspectionTask}
 */
export function createTask(userDataPath, input) {
  const all = loadAllTasks(userDataPath);
  const task = normalizeTask({
    ...TEMPLATE,
    ...input,
    id: randomUUID(),
    createdAt: now(),
    updatedAt: now(),
  });
  all.push(task);
  saveAllTasks(userDataPath, all);
  return task;
}

/**
 * @param {string} userDataPath
 * @param {string} id
 * @param {Partial<InspectionTask>} patch
 * @returns {InspectionTask | null}
 */
export function updateTask(userDataPath, id, patch) {
  const all = loadAllTasks(userDataPath);
  const idx = all.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  const merged = normalizeTask({
    ...all[idx],
    ...patch,
    id: all[idx].id,
    createdAt: all[idx].createdAt,
    updatedAt: now(),
    schedule: { ...all[idx].schedule, ...(patch.schedule || {}) },
    alert: { ...all[idx].alert, ...(patch.alert || {}) },
  });
  all[idx] = merged;
  saveAllTasks(userDataPath, all);
  return merged;
}

/**
 * @param {string} userDataPath
 * @param {string} id
 */
export function deleteTask(userDataPath, id) {
  const all = loadAllTasks(userDataPath).filter((t) => t.id !== id);
  saveAllTasks(userDataPath, all);
}

/** @param {string} userDataPath @param {string} id */
export function getTask(userDataPath, id) {
  return loadAllTasks(userDataPath).find((t) => t.id === id) || null;
}

/** 供 UI 使用的任务模板默认值 */
export function taskTemplate() {
  return JSON.parse(JSON.stringify(TEMPLATE));
}
