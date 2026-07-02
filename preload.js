const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  launchGame: (serverAddress) => ipcRenderer.invoke('launch-game', serverAddress),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  runUpdate: () => ipcRenderer.invoke('run-update'),
  onUpdateProgress: (callback) => ipcRenderer.on('update-progress', callback),
  getLauncherConfig: () => ipcRenderer.invoke('get-launcher-config'),
  fetchPatchNotes: () => ipcRenderer.invoke('fetch-patch-notes'),
  fetchRoadmap: () => ipcRenderer.invoke('fetch-roadmap'),
  fetchEvents: () => ipcRenderer.invoke('fetch-events'),
  fetchPortalStatus: () => ipcRenderer.invoke('fetch-portal-status'),
  checkServerStatus: (address) => ipcRenderer.invoke('check-server-status', address),
  checkGameInstalled: () => ipcRenderer.invoke('check-game-installed'),
  selectGameFolder: () => ipcRenderer.invoke('select-game-folder'),
  validateLogin: (credentials) => ipcRenderer.invoke('validate-login', credentials),
});
