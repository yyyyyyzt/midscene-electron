const logEl = document.getElementById('log');
const taskEl = document.getElementById('task');
const runBtn = document.getElementById('run');
const statusEl = document.getElementById('status');
const saveBtn = document.getElementById('save');
const saveHint = document.getElementById('saveHint');

const apiKeyEl = document.getElementById('apiKey');
const baseUrlEl = document.getElementById('baseUrl');
const modelNameEl = document.getElementById('modelName');
const modelFamilyEl = document.getElementById('modelFamily');

function appendLog(line) {
  const t = new Date().toLocaleTimeString();
  logEl.textContent += `[${t}] ${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

window.desktopApi.onLog((line) => appendLog(line));

async function refreshConfig() {
  const cfg = await window.desktopApi.loadConfig();
  apiKeyEl.value = cfg.apiKey || '';
  baseUrlEl.value = cfg.baseUrl || '';
  modelNameEl.value = cfg.modelName || '';
  modelFamilyEl.value = cfg.modelFamily || '';
}

refreshConfig().catch((e) => appendLog(`加载配置失败: ${e}`));

saveBtn.addEventListener('click', async () => {
  saveHint.textContent = '';
  try {
    await window.desktopApi.saveConfig({
      apiKey: apiKeyEl.value,
      baseUrl: baseUrlEl.value,
      modelName: modelNameEl.value,
      modelFamily: modelFamilyEl.value,
    });
    saveHint.textContent = '已保存';
  } catch (e) {
    saveHint.textContent = e instanceof Error ? e.message : String(e);
  }
});

runBtn.addEventListener('click', async () => {
  statusEl.textContent = '';
  runBtn.disabled = true;
  try {
    const res = await window.desktopApi.runTask(taskEl.value);
    if (!res.ok) {
      statusEl.textContent = res.error || '失败';
    } else {
      statusEl.textContent = '完成';
    }
  } catch (e) {
    statusEl.textContent = e instanceof Error ? e.message : String(e);
  } finally {
    runBtn.disabled = false;
  }
});
