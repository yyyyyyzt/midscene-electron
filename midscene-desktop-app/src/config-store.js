import fs from 'node:fs';
import path from 'node:path';

const FILE_NAME = 'app-config.json';

/** @typedef {{ apiKey: string, baseUrl: string, modelName: string, modelFamily: string }} AppConfig */

/** @type {AppConfig} */
const DEFAULTS = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  modelName: 'gpt-4.1',
  modelFamily: 'gpt-4',
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
    return {
      ...DEFAULTS,
      ...parsed,
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : DEFAULTS.apiKey,
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : DEFAULTS.baseUrl,
      modelName: typeof parsed.modelName === 'string' ? parsed.modelName : DEFAULTS.modelName,
      modelFamily: typeof parsed.modelFamily === 'string' ? parsed.modelFamily : DEFAULTS.modelFamily,
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
  const next = {
    ...current,
    ...patch,
    apiKey: typeof patch.apiKey === 'string' ? patch.apiKey : current.apiKey,
    baseUrl: typeof patch.baseUrl === 'string' ? patch.baseUrl : current.baseUrl,
    modelName: typeof patch.modelName === 'string' ? patch.modelName : current.modelName,
    modelFamily: typeof patch.modelFamily === 'string' ? patch.modelFamily : current.modelFamily,
  };
  const file = configFilePath(userDataPath);
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
  return next;
}
