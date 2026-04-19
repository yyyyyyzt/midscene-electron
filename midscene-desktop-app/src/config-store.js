import fs from 'node:fs';
import path from 'node:path';

const FILE_NAME = 'app-config.json';

/**
 * @typedef {{
 *   apiKey: string;
 *   baseUrl: string;
 *   modelName: string;
 *   modelFamily: string;
 *   connectMode: 'launch' | 'bridge' | 'cdp';
 *   cdpWsUrl: string;
 *   bridgePort: number;
 * }} AppConfig
 */

/** @type {AppConfig} */
const DEFAULTS = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  modelName: 'gpt-4.1',
  modelFamily: 'gpt-4',
  connectMode: 'bridge',
  cdpWsUrl: '',
  bridgePort: 3766,
};

/**
 * @param {string} userDataPath
 * @returns {string}
 */
export function configFilePath(userDataPath) {
  return path.join(userDataPath, FILE_NAME);
}

/**
 * @param {string} userDataPath
 * @returns {AppConfig}
 */
export function loadConfig(userDataPath) {
  const file = configFilePath(userDataPath);
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    const connectMode =
      parsed.connectMode === 'launch' || parsed.connectMode === 'bridge' || parsed.connectMode === 'cdp'
        ? parsed.connectMode
        : DEFAULTS.connectMode;
    const bridgePort =
      typeof parsed.bridgePort === 'number' && Number.isFinite(parsed.bridgePort)
        ? Math.floor(parsed.bridgePort)
        : DEFAULTS.bridgePort;
    return {
      ...DEFAULTS,
      ...parsed,
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : DEFAULTS.apiKey,
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : DEFAULTS.baseUrl,
      modelName: typeof parsed.modelName === 'string' ? parsed.modelName : DEFAULTS.modelName,
      modelFamily: typeof parsed.modelFamily === 'string' ? parsed.modelFamily : DEFAULTS.modelFamily,
      connectMode,
      cdpWsUrl: typeof parsed.cdpWsUrl === 'string' ? parsed.cdpWsUrl : DEFAULTS.cdpWsUrl,
      bridgePort: bridgePort > 0 ? bridgePort : DEFAULTS.bridgePort,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * @param {string} userDataPath
 * @param {Partial<AppConfig>} patch
 * @returns {AppConfig}
 */
export function saveConfig(userDataPath, patch) {
  const current = loadConfig(userDataPath);
  const connectMode =
    patch.connectMode === 'launch' || patch.connectMode === 'bridge' || patch.connectMode === 'cdp'
      ? patch.connectMode
      : current.connectMode;
  const bridgePort =
    typeof patch.bridgePort === 'number' && Number.isFinite(patch.bridgePort)
      ? Math.max(1, Math.floor(patch.bridgePort))
      : current.bridgePort;
  const next = {
    ...current,
    ...patch,
    apiKey: typeof patch.apiKey === 'string' ? patch.apiKey : current.apiKey,
    baseUrl: typeof patch.baseUrl === 'string' ? patch.baseUrl : current.baseUrl,
    modelName: typeof patch.modelName === 'string' ? patch.modelName : current.modelName,
    modelFamily: typeof patch.modelFamily === 'string' ? patch.modelFamily : current.modelFamily,
    connectMode,
    cdpWsUrl: typeof patch.cdpWsUrl === 'string' ? patch.cdpWsUrl : current.cdpWsUrl,
    bridgePort,
  };
  const file = configFilePath(userDataPath);
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
  return next;
}
