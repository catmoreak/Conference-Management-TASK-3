import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  versions: process.versions,
  openFileForPresentation: (url, filename) =>
    ipcRenderer.invoke('open-file-for-presentation', { url, filename }),
  openPresentationWindow: (fileUrl, title) =>
    ipcRenderer.invoke('open-presentation-window', { fileUrl, title }),
});
