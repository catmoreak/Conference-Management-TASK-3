import { app, BrowserWindow, Menu, powerSaveBlocker } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
let powerSaveBlockerId = null;

function ensurePowerSaveBlocker() {
  if (powerSaveBlockerId !== null) {
    return;
  }

  powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
}

function releasePowerSaveBlocker() {
  if (powerSaveBlockerId === null) {
    return;
  }

  powerSaveBlocker.stop(powerSaveBlockerId);
  powerSaveBlockerId = null;
}

function createWindow() {
  const isKioskRequested = process.argv.includes('--kiosk') || process.env.PODIUM_KIOSK === 'true';

  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1280,
    minHeight: 800,
    resizable: false,
    title: 'Podium - Conference Presentation',
    backgroundColor: '#090d16',
    fullscreen: isKioskRequested,
    kiosk: isKioskRequested,
    frame: !isKioskRequested,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // Persistent partition so cookies behave correctly and survive app restarts
      partition: 'persist:podium',
      devTools: !isKioskRequested, // Disable devTools in kiosk mode
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.setMenuBarVisibility(false);

  // Load backend domain (or localhost for dev)
  const targetUrl = process.env.PODIUM_BACKEND_URL ?? 'http://localhost:5173';

  if (isDev) {
    mainWindow.loadURL(targetUrl);
    if (!isKioskRequested) {
      mainWindow.webContents.openDevTools();
    }
  } else {
    mainWindow.loadURL(targetUrl);
  }

  if (!isKioskRequested) {
    mainWindow.setMenuBarVisibility(false);
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  ensurePowerSaveBlocker();

  if (process.platform === 'win32') {
    app.setLoginItemSettings({
      openAtLogin: false,
      path: app.getPath('exe'),
    });
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  releasePowerSaveBlocker();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  releasePowerSaveBlocker();
});
