const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (patch) => ipcRenderer.invoke('config:save', patch),
  runTask: (task) => ipcRenderer.invoke('task:run', task),
  onLog: (cb) => {
    const listener = (_e, line) => cb(line);
    ipcRenderer.on('task:log', listener);
    return () => ipcRenderer.removeListener('task:log', listener);
  },
});
