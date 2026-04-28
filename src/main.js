import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from 'electron';

import { loadConfig, saveConfig, buildModelEnv } from './store/config-store.js';
import {
  loadAllTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
} from './store/task-store.js';
import {
  listRecentRuns,
  getRun,
  stats,
  deleteRuns,
  clearRuns,
} from './store/run-store.js';
import {
  listAlerts,
  updateAlertState,
  deleteAlerts,
  clearAlerts,
} from './store/alert-store.js';
import { Scheduler } from './scheduler/scheduler.js';
import { notify, openReport } from './alerts/notifier.js';
import { runInspection } from './runtime/inspection-runner.js';
import { generateTaskFromPrompt } from './runtime/task-generator.js';
import { parseFlowInput, describeFlow } from './runtime/yaml-flow.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow = null;
/** @type {Scheduler | null} */
let scheduler = null;
let tray = null;
let quitting = false;
let runDir = '';
let testRunning = false;

function userDataPath() {
  return app.getPath('userData');
}

function broadcast(channel, payload) {
  if (mainWindow?.webContents) {
    mainWindow.webContents.send(channel, payload);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function setupTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('自动办公助手');
  const menu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        if (!mainWindow) createWindow();
        mainWindow.show();
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => {
    if (!mainWindow) return;
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}

function ensureRunDir() {
  runDir = path.join(userDataPath(), 'midscene_run');
  fs.mkdirSync(runDir, { recursive: true });
}

function startScheduler() {
  scheduler = new Scheduler({
    userDataPath: userDataPath(),
    runDir,
    onLog: (line) => broadcast('task:log', line),
    onRunUpdate: (run) => broadcast('scheduler:event', { type: 'run-update', run }),
  });
  scheduler.on((evt) => {
    broadcast('scheduler:event', evt);
    if (evt.type === 'alert-new' && evt.shouldNotify) {
      notify({
        title: `巡检异常: ${evt.event.taskName}`,
        body: evt.event.lastMessage,
        onClick: () => {
          mainWindow?.show();
          broadcast('scheduler:event', { type: 'open-alert', alertId: evt.event.id });
        },
      });
    } else if (evt.type === 'alert-update' && evt.shouldNotify) {
      notify({
        title: `异常持续: ${evt.event.taskName}（共 ${evt.event.count} 次）`,
        body: evt.event.lastMessage,
        silent: true,
      });
    } else if (evt.type === 'alert-recovered') {
      notify({
        title: `已恢复: ${evt.event.taskName}`,
        body: '最近一次巡检通过。',
      });
    }
  });
  scheduler.start();
}

app.whenReady().then(() => {
  ensureRunDir();
  createWindow();
  setupTray();
  startScheduler();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });
});

app.on('window-all-closed', (e) => {
  if (process.platform !== 'darwin') {
    if (!quitting) {
      e.preventDefault();
    }
  }
});

app.on('before-quit', () => {
  quitting = true;
  scheduler?.stop();
});

ipcMain.handle('config:load', () => loadConfig(userDataPath()));
ipcMain.handle('config:save', (_e, patch) => saveConfig(userDataPath(), patch ?? {}));

ipcMain.handle('task:list', () => loadAllTasks(userDataPath()));
ipcMain.handle('task:get', (_e, id) => getTask(userDataPath(), id));
ipcMain.handle('task:create', (_e, patch) => createTask(userDataPath(), patch ?? {}));
ipcMain.handle('task:update', (_e, { id, patch }) => updateTask(userDataPath(), id, patch ?? {}));
ipcMain.handle('task:delete', (_e, id) => {
  deleteTask(userDataPath(), id);
  return { ok: true };
});
ipcMain.handle('task:pause', (_e, { id, paused }) => {
  const updated = updateTask(userDataPath(), id, { paused: Boolean(paused) });
  if (updated && !paused) {
    // 重新激活时把 nextRunAt 推后一个间隔，避免立刻执行
    const interval = Math.max(1, Number(updated.schedule?.intervalMinutes) || 10);
    return updateTask(userDataPath(), id, { nextRunAt: Date.now() + interval * 60_000 });
  }
  return updated;
});
ipcMain.handle('task:run', (_e, id) => {
  if (!scheduler) return { ok: false, error: 'scheduler 未启动' };
  scheduler.enqueueNow(id);
  return { ok: true };
});

/**
 * 向导里“测试执行一次”的独立入口，不走调度器，不写入执行记录，
 * 仅返回提取结果与规则结果，便于用户校验 prompt/schema/规则。
 */
ipcMain.handle('task:test', async (_e, taskPayload) => {
  if (testRunning) return { ok: false, error: '已有测试在执行' };
  testRunning = true;
  try {
    const cfg = loadConfig(userDataPath());
    if (!cfg.defaultModel.apiKey?.trim()) {
      return { ok: false, error: '请先在设置中填写默认模型 API Key。' };
    }
    const modelConfig = buildModelEnv(cfg, runDir);
    const log = (line) => broadcast('task:log', `[test] ${line}`);
    const result = await runInspection({
      task: taskPayload,
      modelConfig,
      bridgePort: cfg.bridgePort,
      timeoutMs: (taskPayload.schedule?.timeoutSeconds || 180) * 1000,
      log,
    });
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    testRunning = false;
  }
});

ipcMain.handle('run:list', (_e, { taskId, limit }) =>
  listRecentRuns(userDataPath(), taskId || null, limit || 50),
);
ipcMain.handle('run:get', (_e, id) => getRun(userDataPath(), id));
ipcMain.handle('run:openReport', (_e, p) => {
  openReport(p);
  return { ok: true };
});
ipcMain.handle('run:stats', () => stats(userDataPath()));
ipcMain.handle('run:delete', (_e, runIds) => deleteRuns(userDataPath(), runIds || []));
ipcMain.handle('run:clear', (_e, taskId) => clearRuns(userDataPath(), taskId || null));

ipcMain.handle('alert:list', () => listAlerts(userDataPath()));
ipcMain.handle('alert:update', (_e, { id, action, minutes }) =>
  updateAlertState(userDataPath(), id, action, minutes),
);
ipcMain.handle('alert:delete', (_e, ids) => deleteAlerts(userDataPath(), ids || []));
ipcMain.handle('alert:clear', (_e, scope) => clearAlerts(userDataPath(), scope || 'all'));

ipcMain.handle('task:generate', async (_e, { description, flowYaml }) => {
  const cfg = loadConfig(userDataPath());
  return generateTaskFromPrompt({
    description: String(description || ''),
    flowYaml: String(flowYaml || ''),
    profile: cfg.defaultModel,
  });
});

ipcMain.handle('flow:parse', (_e, text) => {
  const r = parseFlowInput(String(text || ''));
  if (!r.ok) return r;
  return {
    ok: true,
    source: r.source,
    meta: r.meta,
    warnings: r.warnings,
    total: r.steps.length,
    steps: describeFlow(r.steps),
  };
});
