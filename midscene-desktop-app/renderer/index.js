const logEl = document.getElementById('log');
const recipeNameEl = document.getElementById('recipeName');
const businessContextEl = document.getElementById('businessContext');
const mainPromptEl = document.getElementById('mainPrompt');
const runBtn = document.getElementById('run');
const statusEl = document.getElementById('status');
const saveRecipeBtn = document.getElementById('saveRecipe');
const copyBundleBtn = document.getElementById('copyBundle');
const pasteBundleBtn = document.getElementById('pasteBundle');

const connectModeEl = document.getElementById('connectMode');
const bridgePortEl = document.getElementById('bridgePort');
const cdpWsUrlEl = document.getElementById('cdpWsUrl');
const bridgeFields = document.getElementById('bridgeFields');
const cdpFields = document.getElementById('cdpFields');
const saveAppSettingsBtn = document.getElementById('saveAppSettings');
const settingsHint = document.getElementById('settingsHint');

const saveModelBtn = document.getElementById('saveModel');
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

function updateConnectModeUi() {
  const m = connectModeEl.value;
  bridgeFields.classList.toggle('hidden', m !== 'bridge');
  cdpFields.classList.toggle('hidden', m !== 'cdp');
}

connectModeEl.addEventListener('change', updateConnectModeUi);

async function refreshAll() {
  const cfg = await window.desktopApi.loadConfig();
  apiKeyEl.value = cfg.apiKey || '';
  baseUrlEl.value = cfg.baseUrl || '';
  modelNameEl.value = cfg.modelName || '';
  modelFamilyEl.value = cfg.modelFamily || '';
  connectModeEl.value = cfg.connectMode || 'bridge';
  bridgePortEl.value = cfg.bridgePort != null ? String(cfg.bridgePort) : '3766';
  cdpWsUrlEl.value = cfg.cdpWsUrl || '';
  updateConnectModeUi();

  const recipe = await window.desktopApi.loadRecipe();
  recipeNameEl.value = recipe.name || '';
  businessContextEl.value = recipe.businessContext || '';
  mainPromptEl.value = recipe.mainPrompt || '';
}

refreshAll().catch((e) => appendLog(`加载失败: ${e}`));

saveRecipeBtn.addEventListener('click', async () => {
  statusEl.textContent = '';
  try {
    await window.desktopApi.saveRecipe({
      name: recipeNameEl.value,
      businessContext: businessContextEl.value,
      mainPrompt: mainPromptEl.value,
    });
    statusEl.textContent = '草稿已保存';
  } catch (e) {
    statusEl.textContent = e instanceof Error ? e.message : String(e);
  }
});

copyBundleBtn.addEventListener('click', async () => {
  statusEl.textContent = '';
  try {
    const line = await window.desktopApi.exportBundle({
      name: recipeNameEl.value,
      mainPrompt: mainPromptEl.value,
      businessContext: businessContextEl.value,
    });
    await window.desktopApi.clipboardWrite(line);
    statusEl.textContent = '已复制单行任务包，可粘贴到微信';
  } catch (e) {
    statusEl.textContent = e instanceof Error ? e.message : String(e);
  }
});

pasteBundleBtn.addEventListener('click', async () => {
  statusEl.textContent = '';
  try {
    const text = await window.desktopApi.clipboardRead();
    const r = await window.desktopApi.importBundle(text);
    recipeNameEl.value = r.name || '';
    mainPromptEl.value = r.mainPrompt || '';
    businessContextEl.value = r.businessContext || '';
    statusEl.textContent = '已从剪贴板导入任务包';
  } catch (e) {
    statusEl.textContent = e instanceof Error ? e.message : String(e);
  }
});

saveAppSettingsBtn.addEventListener('click', async () => {
  settingsHint.textContent = '';
  try {
    const port = Number.parseInt(bridgePortEl.value, 10);
    await window.desktopApi.saveConfig({
      connectMode: connectModeEl.value,
      cdpWsUrl: cdpWsUrlEl.value,
      bridgePort: Number.isFinite(port) ? port : 3766,
    });
    settingsHint.textContent = '已保存';
  } catch (e) {
    settingsHint.textContent = e instanceof Error ? e.message : String(e);
  }
});

saveModelBtn.addEventListener('click', async () => {
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
    const res = await window.desktopApi.runTask({
      mainPrompt: mainPromptEl.value,
      businessContext: businessContextEl.value,
    });
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
