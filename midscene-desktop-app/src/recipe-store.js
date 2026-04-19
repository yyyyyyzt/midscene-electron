import fs from 'node:fs';
import path from 'node:path';

const FILE_NAME = 'task-recipe.json';

/** @typedef {{ name: string, mainPrompt: string, businessContext: string }} TaskRecipe */

/** @type {TaskRecipe} */
const EMPTY = {
  name: '',
  mainPrompt: '',
  businessContext: '',
};

/**
 * @param {string} userDataPath
 */
export function recipePath(userDataPath) {
  return path.join(userDataPath, FILE_NAME);
}

/**
 * @param {string} userDataPath
 * @returns {TaskRecipe}
 */
export function loadRecipe(userDataPath) {
  try {
    const raw = fs.readFileSync(recipePath(userDataPath), 'utf8');
    const p = JSON.parse(raw);
    return {
      name: typeof p.name === 'string' ? p.name : '',
      mainPrompt: typeof p.mainPrompt === 'string' ? p.mainPrompt : '',
      businessContext: typeof p.businessContext === 'string' ? p.businessContext : '',
    };
  } catch {
    return { ...EMPTY };
  }
}

/**
 * @param {string} userDataPath
 * @param {Partial<TaskRecipe>} patch
 * @returns {TaskRecipe}
 */
export function saveRecipe(userDataPath, patch) {
  const cur = loadRecipe(userDataPath);
  const next = {
    name: typeof patch.name === 'string' ? patch.name : cur.name,
    mainPrompt: typeof patch.mainPrompt === 'string' ? patch.mainPrompt : cur.mainPrompt,
    businessContext:
      typeof patch.businessContext === 'string' ? patch.businessContext : cur.businessContext,
  };
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(recipePath(userDataPath), JSON.stringify(next, null, 2), 'utf8');
  return next;
}
