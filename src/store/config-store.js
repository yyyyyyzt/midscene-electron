import fs from 'node:fs';
import path from 'node:path';

const FILE_NAME = 'app-config.json';

/**
 * @typedef {{
 *   apiKey: string;
 *   baseUrl: string;
 *   modelName: string;
 *   modelFamily: string;
 * }} ModelProfile
 */

/**
 * @typedef {{
 *   bridgePort: number;
 *   runHeadlessWindow: boolean;
 *   notificationSound: boolean;
 *   defaultModel: ModelProfile;
 *   planningModel: ModelProfile | null;
 *   insightModel: ModelProfile | null;
 * }} AppConfig
 */

/** @type {ModelProfile} */
const EMPTY_PROFILE = {
  apiKey: '',
  baseUrl: '',
  modelName: '',
  modelFamily: '',
};

/** @type {AppConfig} */
const DEFAULTS = {
  bridgePort: 3766,
  runHeadlessWindow: true,
  notificationSound: true,
  defaultModel: {
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    modelName: 'gpt-4.1',
    modelFamily: 'gpt-4',
  },
  planningModel: null,
  insightModel: null,
};

/** @param {string} userDataPath */
export function configFilePath(userDataPath) {
  return path.join(userDataPath, FILE_NAME);
}

/**
 * @param {any} raw
 * @returns {ModelProfile}
 */
function pickProfile(raw) {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_PROFILE };
  return {
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
    baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : '',
    modelName: typeof raw.modelName === 'string' ? raw.modelName : '',
    modelFamily: typeof raw.modelFamily === 'string' ? raw.modelFamily : '',
  };
}

/** 忽略未配置（apiKey + modelName 都空视为未配置） */
function isProfileSet(p) {
  if (!p) return false;
  return Boolean((p.apiKey || '').trim() && (p.modelName || '').trim());
}

/**
 * 读取配置，兼容旧的 Bridge-only 单任务产品。
 * 旧字段 { apiKey, baseUrl, modelName, modelFamily } 会自动迁移到 defaultModel。
 *
 * @param {string} userDataPath
 * @returns {AppConfig}
 */
export function loadConfig(userDataPath) {
  const file = configFilePath(userDataPath);
  /** @type {any} */
  let parsed = {};
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return JSON.parse(JSON.stringify(DEFAULTS));
  }

  const bridgePortRaw = Number(parsed.bridgePort);
  const bridgePort = Number.isFinite(bridgePortRaw) && bridgePortRaw > 0
    ? Math.floor(bridgePortRaw)
    : DEFAULTS.bridgePort;

  let defaultModel;
  if (parsed.defaultModel && typeof parsed.defaultModel === 'object') {
    defaultModel = pickProfile(parsed.defaultModel);
    if (!defaultModel.baseUrl) defaultModel.baseUrl = DEFAULTS.defaultModel.baseUrl;
    if (!defaultModel.modelName) defaultModel.modelName = DEFAULTS.defaultModel.modelName;
    if (!defaultModel.modelFamily) defaultModel.modelFamily = DEFAULTS.defaultModel.modelFamily;
  } else {
    defaultModel = {
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : DEFAULTS.defaultModel.apiKey,
      baseUrl: typeof parsed.baseUrl === 'string' && parsed.baseUrl
        ? parsed.baseUrl
        : DEFAULTS.defaultModel.baseUrl,
      modelName: typeof parsed.modelName === 'string' && parsed.modelName
        ? parsed.modelName
        : DEFAULTS.defaultModel.modelName,
      modelFamily: typeof parsed.modelFamily === 'string' && parsed.modelFamily
        ? parsed.modelFamily
        : DEFAULTS.defaultModel.modelFamily,
    };
  }

  const planningRaw = pickProfile(parsed.planningModel);
  const insightRaw = pickProfile(parsed.insightModel);

  return {
    bridgePort,
    runHeadlessWindow: parsed.runHeadlessWindow !== false,
    notificationSound: parsed.notificationSound !== false,
    defaultModel,
    planningModel: isProfileSet(planningRaw) ? planningRaw : null,
    insightModel: isProfileSet(insightRaw) ? insightRaw : null,
  };
}

/**
 * @param {string} userDataPath
 * @param {Partial<AppConfig> & { apiKey?: string; baseUrl?: string; modelName?: string; modelFamily?: string }} patch
 * @returns {AppConfig}
 */
export function saveConfig(userDataPath, patch) {
  const current = loadConfig(userDataPath);

  const legacyHasFlat = [patch.apiKey, patch.baseUrl, patch.modelName, patch.modelFamily].some(
    (v) => typeof v === 'string',
  );
  const defaultModel = patch.defaultModel
    ? { ...current.defaultModel, ...pickProfile(patch.defaultModel) }
    : legacyHasFlat
      ? {
          apiKey: typeof patch.apiKey === 'string' ? patch.apiKey : current.defaultModel.apiKey,
          baseUrl: typeof patch.baseUrl === 'string' ? patch.baseUrl : current.defaultModel.baseUrl,
          modelName:
            typeof patch.modelName === 'string' ? patch.modelName : current.defaultModel.modelName,
          modelFamily:
            typeof patch.modelFamily === 'string'
              ? patch.modelFamily
              : current.defaultModel.modelFamily,
        }
      : current.defaultModel;

  const planningModel =
    patch.planningModel === null
      ? null
      : patch.planningModel
        ? pickProfile(patch.planningModel)
        : current.planningModel;

  const insightModel =
    patch.insightModel === null
      ? null
      : patch.insightModel
        ? pickProfile(patch.insightModel)
        : current.insightModel;

  const bridgePortRaw = Number(patch.bridgePort);
  const bridgePort = Number.isFinite(bridgePortRaw) && bridgePortRaw > 0
    ? Math.floor(bridgePortRaw)
    : current.bridgePort;

  const next = {
    bridgePort,
    runHeadlessWindow:
      typeof patch.runHeadlessWindow === 'boolean' ? patch.runHeadlessWindow : current.runHeadlessWindow,
    notificationSound:
      typeof patch.notificationSound === 'boolean' ? patch.notificationSound : current.notificationSound,
    defaultModel,
    planningModel: planningModel && isProfileSet(planningModel) ? planningModel : null,
    insightModel: insightModel && isProfileSet(insightModel) ? insightModel : null,
  };

  const file = configFilePath(userDataPath);
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

/**
 * 把应用配置展开成 Midscene modelConfig 环境变量对象。
 * Default 必填；Planning/Insight 可选，缺失时不写入对应变量，Midscene 会自动回落到默认。
 *
 * @param {AppConfig} cfg
 * @param {string} runDir
 */
export function buildModelEnv(cfg, runDir) {
  const env = {};
  const d = cfg.defaultModel;
  env.MIDSCENE_MODEL_API_KEY = (d.apiKey || '').trim();
  env.MIDSCENE_MODEL_BASE_URL = (d.baseUrl || 'https://api.openai.com/v1').trim();
  env.MIDSCENE_MODEL_NAME = (d.modelName || 'gpt-4.1').trim();
  env.MIDSCENE_MODEL_FAMILY = (d.modelFamily || 'gpt-4').trim();
  env.MIDSCENE_RUN_DIR = runDir;

  if (cfg.planningModel) {
    const p = cfg.planningModel;
    if (p.apiKey?.trim()) env.MIDSCENE_PLANNING_MODEL_API_KEY = p.apiKey.trim();
    if (p.baseUrl?.trim()) env.MIDSCENE_PLANNING_MODEL_BASE_URL = p.baseUrl.trim();
    if (p.modelName?.trim()) env.MIDSCENE_PLANNING_MODEL_NAME = p.modelName.trim();
    if (p.modelFamily?.trim()) env.MIDSCENE_PLANNING_MODEL_FAMILY = p.modelFamily.trim();
  }
  if (cfg.insightModel) {
    const p = cfg.insightModel;
    if (p.apiKey?.trim()) env.MIDSCENE_INSIGHT_MODEL_API_KEY = p.apiKey.trim();
    if (p.baseUrl?.trim()) env.MIDSCENE_INSIGHT_MODEL_BASE_URL = p.baseUrl.trim();
    if (p.modelName?.trim()) env.MIDSCENE_INSIGHT_MODEL_NAME = p.modelName.trim();
    if (p.modelFamily?.trim()) env.MIDSCENE_INSIGHT_MODEL_FAMILY = p.modelFamily.trim();
  }
  return env;
}
