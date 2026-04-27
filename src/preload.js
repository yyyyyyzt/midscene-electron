const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (patch) => ipcRenderer.invoke('config:save', patch),

  listTasks: () => ipcRenderer.invoke('task:list'),
  getTask: (id) => ipcRenderer.invoke('task:get', id),
  createTask: (patch) => ipcRenderer.invoke('task:create', patch),
  updateTask: (id, patch) => ipcRenderer.invoke('task:update', { id, patch }),
  deleteTask: (id) => ipcRenderer.invoke('task:delete', id),
  pauseTask: (id, paused) => ipcRenderer.invoke('task:pause', { id, paused }),
  runTaskNow: (id) => ipcRenderer.invoke('task:run', id),
  testExtract: (payload) => ipcRenderer.invoke('task:test', payload),

  listRuns: (taskId, limit) => ipcRenderer.invoke('run:list', { taskId, limit }),
  getRun: (id) => ipcRenderer.invoke('run:get', id),
  openReport: (p) => ipcRenderer.invoke('run:openReport', p),
  stats: () => ipcRenderer.invoke('run:stats'),
  deleteRuns: (runIds) => ipcRenderer.invoke('run:delete', runIds),
  clearRuns: (taskId) => ipcRenderer.invoke('run:clear', taskId || null),

  listAlerts: () => ipcRenderer.invoke('alert:list'),
  updateAlertState: (id, action, minutes) =>
    ipcRenderer.invoke('alert:update', { id, action, minutes }),
  deleteAlerts: (ids) => ipcRenderer.invoke('alert:delete', ids),
  clearAlerts: (scope) => ipcRenderer.invoke('alert:clear', scope || 'all'),

  generateTask: (description, flowYaml) =>
    ipcRenderer.invoke('task:generate', { description, flowYaml }),
  parseFlow: (text) => ipcRenderer.invoke('flow:parse', text),

  onSchedulerEvent: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('scheduler:event', listener);
    return () => ipcRenderer.removeListener('scheduler:event', listener);
  },
  onLog: (cb) => {
    const listener = (_e, line) => cb(line);
    ipcRenderer.on('task:log', listener);
    return () => ipcRenderer.removeListener('task:log', listener);
  },
});
