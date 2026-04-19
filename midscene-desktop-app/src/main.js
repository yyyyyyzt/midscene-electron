import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, clipboard } from 'electron';
import { loadConfig, saveConfig } from './config-store.js';
import { mergeTaskPrompts, runNaturalLanguageTask } from './chrome-runner.js';
import { loadRecipe, saveRecipe } from './recipe-store.js';
import { exportTaskBundle, importTaskBundle } from './task-bundle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow = null;
let running = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 760,
    height: 820,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

function broadcastLog(line) {
  if (mainWindow?.webContents) {
    mainWindow.webContents.send('task:log', line);
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('config:load', () => loadConfig(app.getPath('userData')));

ipcMain.handle('config:save', (_e, patch) => saveConfig(app.getPath('userData'), patch ?? {}));

ipcMain.handle('recipe:load', () => loadRecipe(app.getPath('userData')));

ipcMain.handle('recipe:save', (_e, patch) => saveRecipe(app.getPath('userData'), patch ?? {}));

ipcMain.handle('bundle:export', (_e, recipe) => {
  return exportTaskBundle({
    name: recipe?.name,
    mainPrompt: recipe?.mainPrompt ?? '',
    businessContext: recipe?.businessContext ?? '',
  });
});

ipcMain.handle('bundle:import', (_e, text) => importTaskBundle(text));

ipcMain.handle('clipboard:write', (_e, text) => {
  clipboard.writeText(String(text ?? ''));
  return { ok: true };
});

ipcMain.handle('clipboard:read', () => clipboard.readText());

ipcMain.handle('task:run', async (_e, payload) => {
  if (running) {
    return { ok: false, error: '已有任务在执行，请等待结束。' };
  }

  let mainPrompt = '';
  let businessContext = '';
  if (typeof payload === 'string') {
    mainPrompt = payload;
  } else if (payload && typeof payload === 'object') {
    mainPrompt = payload.mainPrompt ?? '';
    businessContext = payload.businessContext ?? '';
  }

  const main = String(mainPrompt).trim();
  if (!main) {
    return { ok: false, error: '请填写主任务（要执行的操作）。' };
  }

  const cfg = loadConfig(app.getPath('userData'));
  if (!cfg.apiKey?.trim()) {
    return { ok: false, error: '请先在设置中填写 API Key。' };
  }

  const midsceneRunDir = path.join(app.getPath('userData'), 'midscene_run');
  const modelConfig = {
    MIDSCENE_MODEL_API_KEY: cfg.apiKey.trim(),
    MIDSCENE_MODEL_BASE_URL: cfg.baseUrl.trim() || 'https://api.openai.com/v1',
    MIDSCENE_MODEL_NAME: cfg.modelName.trim() || 'gpt-4.1',
    MIDSCENE_MODEL_FAMILY: cfg.modelFamily.trim() || 'gpt-4',
    MIDSCENE_RUN_DIR: midsceneRunDir,
  };

  const merged = mergeTaskPrompts(main, businessContext);

  running = true;
  try {
    await runNaturalLanguageTask(merged, {
      modelConfig,
      connectMode: cfg.connectMode,
      cdpWsUrl: cfg.cdpWsUrl,
      bridgePort: cfg.bridgePort,
    }, (line) => broadcastLog(line));
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    broadcastLog(`错误: ${message}`);
    return { ok: false, error: message };
  } finally {
    running = false;
  }
});
