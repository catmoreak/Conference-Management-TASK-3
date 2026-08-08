import { app, BrowserWindow, Menu, powerSaveBlocker, ipcMain, shell } from 'electron';
import fs from 'fs';
import os from 'os';
import https from 'https';
import http from 'http';
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

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    const request = proto.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlink(destPath, () => {});
        downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        file.close();
        fs.unlink(destPath, () => {});
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => file.close(() => resolve(destPath)));
    });
    request.on('error', (err) => {
      file.close();
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

const presentationWindows = new Map();

app.whenReady().then(() => {
  ipcMain.handle('open-file-for-presentation', async (_event, { url, filename }) => {
    try {
      const tmpDir = os.tmpdir();
      const safeName = filename.replace(/[^\w.\-]/g, '_');
      const destPath = path.join(tmpDir, `podium_${Date.now()}_${safeName}`);
      await downloadFile(url, destPath);
      const result = await shell.openPath(destPath);
      if (result) return { success: false, error: result };
      return { success: true, path: destPath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('open-presentation-window', async (_event, { fileUrl, title }) => {
    // Download the PPTX to a temp file and serve a local viewer page
    const key = fileUrl;
    if (presentationWindows.has(key)) {
      const existing = presentationWindows.get(key);
      if (!existing.isDestroyed()) {
        existing.focus();
        return { success: true };
      }
    }

    const win = new BrowserWindow({
      width: 1366,
      height: 768,
      title: title || 'Presentation',
      backgroundColor: '#0f172a',
      autoHideMenuBar: true,
      resizable: true,
      maximizable: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: false,   // allow loading cross-origin S3 content
        allowRunningInsecureContent: true,
        // Use Chrome user-agent so Office Online and Google Docs accept the request
        additionalArguments: [],
      },
    });

    // Spoof a regular Chrome user-agent so viewers don't block Electron
    win.webContents.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    win.setMenuBarVisibility(false);

    // Try Office Online first; if it fails in 8 s, fall back to Google Docs viewer
    const officeUrl = `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(fileUrl)}`;
    win.loadURL(officeUrl);

    win.webContents.on('did-finish-load', () => {
      // Check if Office Online showed an error page by inspecting the title
      win.webContents.executeJavaScript('document.title').then((t) => {
        if (typeof t === 'string' && (t.includes('Error') || t.includes('error') || t === '')) {
          const googleUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(fileUrl)}&embedded=true`;
          win.loadURL(googleUrl);
        }
      }).catch(() => {});
    });

    win.on('closed', () => presentationWindows.delete(key));
    presentationWindows.set(key, win);
    return { success: true };
  });
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
