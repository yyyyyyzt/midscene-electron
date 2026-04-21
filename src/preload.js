const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (patch) => ipcRenderer.invoke('config:save', patch),
  loadRecipe: () => ipcRenderer.invoke('recipe:load'),
  saveRecipe: (patch) => ipcRenderer.invoke('recipe:save', patch),
  exportBundle: (recipe) => ipcRenderer.invoke('bundle:export', recipe),
  importBundle: (text) => ipcRenderer.invoke('bundle:import', text),
  clipboardWrite: (text) => ipcRenderer.invoke('clipboard:write', text),
  clipboardRead: () => ipcRenderer.invoke('clipboard:read'),
  runTask: (payload) => ipcRenderer.invoke('task:run', payload),
  onLog: (cb) => {
    const listener = (_e, line) => cb(line);
    ipcRenderer.on('task:log', listener);
    return () => ipcRenderer.removeListener('task:log', listener);
  },
});
