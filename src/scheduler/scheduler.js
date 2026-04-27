import { loadAllTasks, updateTask } from '../store/task-store.js';
import { startRun, finishRun } from '../store/run-store.js';
import { reportFailure, reportRecovery } from '../store/alert-store.js';
import { loadConfig, buildModelEnv } from '../store/config-store.js';
import { runInspection } from '../runtime/inspection-runner.js';

/**
 * 专用值守电脑：**串行** 执行所有巡检任务。
 *
 *   - 每分钟 tick 扫描到期任务
 *   - 同一时间最多 1 个任务执行（AGENTS.md 8.3）
 *   - 工作时段外 / 暂停任务跳过
 *   - 支持重试（仅针对 error，alert 不重试）
 *
 * 调度器独立于 UI；UI 能观察并触发立即执行。
 */

const TICK_MS = 30_000;

function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(hhmm || '');
  if (!m) return null;
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const mi = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return h * 60 + mi;
}

function inActiveWindow(task) {
  const from = toMinutes(task.schedule.activeFrom);
  const to = toMinutes(task.schedule.activeTo);
  if (from == null || to == null) return true;
  const now = new Date();
  const curr = now.getHours() * 60 + now.getMinutes();
  if (from <= to) return curr >= from && curr <= to;
  return curr >= from || curr <= to;
}

export class Scheduler {
  /**
   * @param {{
   *   userDataPath: string;
   *   runDir: string;
   *   onRunUpdate?: (run: any) => void;
   *   onLog?: (line: string) => void;
   * }} opts
   */
  constructor(opts) {
    this.userDataPath = opts.userDataPath;
    this.runDir = opts.runDir;
    this.onRunUpdate = opts.onRunUpdate || (() => {});
    this.onLog = opts.onLog || (() => {});
    /** @type {string[]} */
    this.queue = [];
    this.running = false;
    this.timer = null;
    this.currentTaskId = null;
    /** @type {Map<string, number>} retry attempts per task */
    this.retries = new Map();
    /** emitted so UI / notifier can react */
    this.listeners = new Set();
  }

  /** @param {(evt: any) => void} cb */
  on(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  emit(evt) {
    for (const cb of this.listeners) {
      try { cb(evt); } catch {}
    }
  }

  start() {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 计算下次执行时间并写回 task */
  _scheduleNext(task) {
    const interval = Math.max(1, Number(task.schedule.intervalMinutes) || 10);
    const nextRunAt = Date.now() + interval * 60_000;
    updateTask(this.userDataPath, task.id, { nextRunAt });
  }

  /** @param {string} taskId */
  enqueueNow(taskId) {
    if (!this.queue.includes(taskId)) this.queue.push(taskId);
    this.drain();
  }

  tick() {
    try {
      const tasks = loadAllTasks(this.userDataPath);
      const now = Date.now();
      for (const t of tasks) {
        if (t.paused) continue;
        if (!t.schedule.enabled) continue;
        if (!inActiveWindow(t)) continue;
        const due = !t.nextRunAt || t.nextRunAt <= now;
        if (due && !this.queue.includes(t.id)) this.queue.push(t.id);
      }
      this.drain();
    } catch (e) {
      this.onLog(`scheduler tick 错误：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async drain() {
    if (this.running) return;
    const next = this.queue.shift();
    if (!next) return;
    this.running = true;
    this.currentTaskId = next;
    try {
      await this._runOne(next);
    } catch (e) {
      this.onLog(`执行异常：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.running = false;
      this.currentTaskId = null;
      if (this.queue.length) setImmediate(() => this.drain());
    }
  }

  async _runOne(taskId) {
    const tasks = loadAllTasks(this.userDataPath);
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const cfg = loadConfig(this.userDataPath);
    if (!cfg.defaultModel.apiKey?.trim()) {
      this.onLog(`任务 ${task.name}: 未配置默认模型 API Key，跳过。`);
      this._scheduleNext(task);
      return;
    }

    const modelConfig = buildModelEnv(cfg, this.runDir);
    const rec = startRun(this.userDataPath, { taskId: task.id, taskName: task.name });
    this.emit({ type: 'run-start', run: rec });
    this.onLog(`开始执行 [${task.name}]`);

    const pushLog = (line) => {
      const stamped = `[${new Date().toLocaleTimeString()}] ${line}`;
      rec.log.push(stamped);
      this.onLog(`[${task.name}] ${line}`);
      this.onRunUpdate({ ...rec });
    };

    try {
      const result = await runInspection({
        task,
        modelConfig,
        bridgePort: cfg.bridgePort,
        timeoutMs: (task.schedule.timeoutSeconds || 180) * 1000,
        log: pushLog,
      });
      rec.status = result.status;
      rec.extracted = result.extracted;
      rec.ruleResults = result.ruleResults;
      rec.phases = result.phases || [];
      rec.reportPath = result.reportPath;
      rec.error = result.error;

      if (result.status === 'ok') {
        const recovery = reportRecovery(this.userDataPath, {
          taskId: task.id,
          taskName: task.name,
          runId: rec.id,
        });
        if (recovery.event) {
          this.emit({ type: 'alert-recovered', event: recovery.event });
        }
        this.retries.delete(task.id);
      } else if (result.status === 'alert') {
        const msg = (result.triggeredMessages || []).join('；') || '任务规则判定异常';
        const severity = guessSeverity(result.ruleResults);
        const info = reportFailure(this.userDataPath, {
          taskId: task.id,
          taskName: task.name,
          runId: rec.id,
          message: msg,
          severity,
        });
        this.emit({
          type: info.isNew ? 'alert-new' : 'alert-update',
          event: info.event,
          shouldNotify: info.shouldNotify && task.alert.enabled,
          run: rec,
        });
        this.retries.delete(task.id);
      }
    } catch (e) {
      rec.status = 'error';
      rec.error = e instanceof Error ? e.message : String(e);
      const tries = (this.retries.get(task.id) || 0) + 1;
      if (tries <= Math.max(0, task.schedule.retry || 0)) {
        this.retries.set(task.id, tries);
        this.onLog(`任务失败将重试 (${tries}/${task.schedule.retry})：${rec.error}`);
        this.queue.unshift(task.id);
      } else {
        this.retries.delete(task.id);
        const isLogin = rec.error === 'LOGIN_OR_ERROR_PAGE';
        const info = reportFailure(this.userDataPath, {
          taskId: task.id,
          taskName: task.name,
          runId: rec.id,
          message: isLogin ? '疑似登录失效，请重新登录后点击恢复' : rec.error || '执行失败',
          severity: 'critical',
        });
        this.emit({
          type: info.isNew ? 'alert-new' : 'alert-update',
          event: info.event,
          shouldNotify: info.shouldNotify && task.alert.enabled,
          run: rec,
        });
      }
    } finally {
      finishRun(this.userDataPath, rec);
      updateTask(this.userDataPath, task.id, {
        lastStatus:
          rec.status === 'ok' ? 'ok' : rec.status === 'alert' ? 'alert' : 'error',
        lastRunAt: rec.startedAt,
      });
      this._scheduleNext(task);
      this.emit({ type: 'run-finish', run: rec });
    }
  }
}

function guessSeverity(ruleResults) {
  let s = 'warning';
  for (const r of ruleResults || []) {
    if (r.triggered ?? !r.ok) {
      if (r.severity === 'critical') return 'critical';
      if (r.severity === 'warning') s = 'warning';
    }
  }
  return s;
}
