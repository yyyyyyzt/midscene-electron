import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain } from 'electron';
import { loadConfig, saveConfig } from './config-store.js';
import { runNaturalLanguageTask } from './chrome-runner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow = null;
let running = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 640,
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

ipcMain.handle('task:run', async (_e, task) => {
  if (running) {
    return { ok: false, error: '已有任务在执行，请等待结束。' };
  }
  const trimmed = typeof task === 'string' ? task.trim() : '';
  if (!trimmed) {
    return { ok: false, error: '请输入任务描述。' };
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

  running = true;
  try {
    await runNaturalLanguageTask(
      trimmed,
      { modelConfig, midsceneRunDir },
      (line) => broadcastLog(line),
    );
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    broadcastLog(`错误: ${message}`);
    return { ok: false, error: message };
  } finally {
    running = false;
  }
});
