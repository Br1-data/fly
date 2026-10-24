// Exposes a minimal, safe desktop API to the renderer.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  quit: () => ipcRenderer.send('cieli:quit'),
  toggleFullscreen: () => ipcRenderer.send('cieli:fullscreen'),
});
