// Electron main process: window management and an "app://" protocol that serves the game files
// (ES modules and import maps need a standard, secure origin rather than file://).
const { app, BrowserWindow, protocol, net, ipcMain, Menu, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const DEBUG = process.env.CIELI_DEBUG === '1';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0a121d',
    title: 'Cieli Aperti Flight Simulator',
    icon: path.join(ROOT, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      devTools: DEBUG,
    },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key;
    if (key === 'F11' && !input.control && !input.alt && !input.shift && process.env.CIELI_F11_FULLSCREEN === '1') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    } else if (key === 'Enter' && input.alt) {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    } else if (!DEBUG && ((input.control && key.toLowerCase() === 'r') || key === 'F5' && input.control)) {
      event.preventDefault();
    } else if (!DEBUG && input.control && input.shift && key.toLowerCase() === 'i') {
      event.preventDefault();
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL('app://bundle/index.html');
  if (DEBUG) win.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  ipcMain.on('cieli:quit', () => app.quit());
  ipcMain.on('cieli:fullscreen', () => win && win.setFullScreen(!win.isFullScreen()));
  createWindow();
});

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('window-all-closed', () => app.quit());
