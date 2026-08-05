import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

function createWindow() {
  const isKioskRequested = process.argv.includes('--kiosk') || process.env.PODIUM_KIOSK === 'true';

  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Podium - Conference Presentation',
    backgroundColor: '#090d16',
    // Apply kiosk settings if requested
    kiosk: isKioskRequested,
    frame: !isKioskRequested,
    autoHideMenuBar: isKioskRequested,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // Persistent partition so cookies behave correctly and survive app restarts
      partition: 'persist:podium',
      devTools: !isKioskRequested, // Disable devTools in kiosk mode
    },
  });

  if (isKioskRequested) {
    mainWindow.setMenuBarVisibility(false);
  }

  // Load backend domain (or localhost for dev)
  const targetUrl = process.env.PODIUM_BACKEND_URL ?? 'http://localhost:3000';

  if (isDev) {
    mainWindow.loadURL(targetUrl);
    if (!isKioskRequested) {
      mainWindow.webContents.openDevTools();
    }
  } else {
    mainWindow.loadURL(targetUrl);
  }

  if (!isKioskRequested) {
    mainWindow.setMenuBarVisibility(true);
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
