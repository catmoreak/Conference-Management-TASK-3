const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  versions: process.versions,
  openFileForPresentation: (url, filename) =>
    ipcRenderer.invoke('open-file-for-presentation', { url, filename }),
  openPresentationWindow: (fileUrl, title) =>
    ipcRenderer.invoke('open-presentation-window', { fileUrl, title }),
  runPodiumCommand: (cmd) => ipcRenderer.invoke('podium-command', cmd),
  onPodiumStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('podium-status', listener);
    return () => ipcRenderer.removeListener('podium-status', listener);
  },
  onPodiumError: (callback) => {
    const listener = (_event, error) => callback(error);
    ipcRenderer.on('podium-error', listener);
    return () => ipcRenderer.removeListener('podium-error', listener);
  },
});
