
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  launchGame: (serverAddress) => ipcRenderer.send('launch-game', serverAddress),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  startDownload: (url, fileName) => ipcRenderer.send('start-download', { url, fileName }),
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', callback),
  onDownloadComplete: (callback) => ipcRenderer.on('download-complete', callback),
  getLauncherConfig: () => ipcRenderer.invoke('get-launcher-config'),
  fetchPatchNotes: () => ipcRenderer.invoke('fetch-patch-notes'),
  fetchRoadmap: () => ipcRenderer.invoke('fetch-roadmap'),
  fetchEvents: () => ipcRenderer.invoke('fetch-events'),
  checkServerStatus: (url) => ipcRenderer.invoke('check-server-status', url),
  checkGameInstalled: () => ipcRenderer.invoke('check-game-installed'),
  selectGameFolder: () => ipcRenderer.invoke('select-game-folder'),
  validateLogin: (credentials) => ipcRenderer.invoke('validate-login', credentials)
});
