import { app, BrowserWindow, Menu, powerSaveBlocker, ipcMain, shell } from 'electron';
import fs from 'fs';
import os from 'os';
import https from 'https';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindowRef = null;

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
      // .cjs, not .js -- podium/package.json sets "type":"module", and a
      // sandboxed preload script (Electron's default since v20) cannot use
      // ESM import syntax reliably. An ambiguous/ESM-parsed preload here
      // means contextBridge.exposeInMainWorld() silently never runs, so
      // window.electronAPI stays undefined and every IPC call from the
      // renderer fails with "podium-command IPC bridge is not available".
      preload: path.join(__dirname, 'preload.cjs'),
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

  mainWindowRef = mainWindow;
  mainWindow.on('closed', () => {
    if (mainWindowRef === mainWindow) {
      mainWindowRef = null;
    }
  });
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

// Live-control-driven viewer window -- separate from presentationWindows
// (which caches manual "preview"/"open in app" windows keyed by fileUrl).
// Only one of these is ever open at a time: it's what load_presentation /
// play / next_slide / prev_slide / exit_slideshow from the operator's
// dashboard actually control.
let liveEmbeddedWindow = null;
let liveState = 'offline';

/**
 * Opens a PPTX/PDF in an embedded Office Online viewer (falling back to
 * Google Docs viewer if Office Online errors), inside its own
 * Electron-controlled BrowserWindow -- not native PowerPoint. Shared by
 * both the live-control flow and the manual preview/open-in-app feature.
 *
 * @param {{ emergencyExit?: boolean }} [options] - When true (live-control
 *   path only), injects a visible on-screen "Exit Presentation" button and
 *   an Escape-key fallback. Once the window goes fullscreen for the actual
 *   slideshow there is no native title bar/close button reachable by mouse
 *   or keyboard, so this is the operator's/presenter's only way to bail out
 *   locally without going back to the main-panel dashboard.
 */
function createEmbeddedViewerWindow(fileUrl, title, options = {}) {
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
      webSecurity: false, // allow loading cross-origin S3 content
      allowRunningInsecureContent: true,
    },
  });

  // Spoof a regular Chrome user-agent so viewers don't block Electron
  win.webContents.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );
  win.setMenuBarVisibility(false);

  if (options.emergencyExit) {
    // Escape-key fallback -- BrowserWindow.setFullScreen() is native-window
    // fullscreen, not the content's requestFullscreen(), so Chromium's
    // built-in "Escape exits fullscreen" behavior does NOT apply here and
    // has to be wired up manually.
    win.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        win.close();
      }
    });

    const injectEmergencyExitButton = () => {
      win.webContents.insertCSS(`
        #podium-emergency-exit {
          position: fixed;
          top: 14px;
          right: 14px;
          z-index: 2147483647;
          background: #dc2626;
          color: #fff;
          border: none;
          border-radius: 6px;
          padding: 10px 18px;
          font: 700 14px/1 -apple-system, Segoe UI, Arial, sans-serif;
          cursor: pointer;
          box-shadow: 0 2px 10px rgba(0,0,0,0.45);
          opacity: 0.85;
        }
        #podium-emergency-exit:hover { opacity: 1; }
      `).catch(() => {});
      win.webContents
        .executeJavaScript(`
          (function() {
            if (document.getElementById('podium-emergency-exit')) return;
            var btn = document.createElement('button');
            btn.id = 'podium-emergency-exit';
            btn.type = 'button';
            btn.textContent = '\\u2715 Exit Presentation';
            btn.onclick = function() { window.close(); };
            document.documentElement.appendChild(btn);
          })();
        `)
        .catch(() => {});
    };

    // Re-injected on every load -- the Office Online -> Google Docs fallback
    // navigates to a whole new page, which wipes out any previous injection.
    win.webContents.on('did-finish-load', injectEmergencyExitButton);
  }

  // Try Office Online first; if it errors, fall back to Google Docs viewer
  const officeUrl = `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(fileUrl)}`;
  win.loadURL(officeUrl);

  win.webContents.on('did-finish-load', () => {
    win.webContents.executeJavaScript('document.title').then((t) => {
      if (typeof t === 'string' && (t.includes('Error') || t.includes('error') || t === '')) {
        const googleUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(fileUrl)}&embedded=true`;
        win.loadURL(googleUrl);
      }
    }).catch(() => {});
  });

  return win;
}

/**
 * Simulates a single arrow-key press in the embedded viewer window to move
 * to the next/previous slide. Office Online's and Google Docs' viewers both
 * bind Right/Left arrows to slide navigation -- this is the only remote
 * control surface an embedded read-only viewer exposes (no automation API,
 * unlike PowerPoint's COM object model).
 */
function sendNavigationKey(win, direction) {
  const keyCode = direction === 'next' ? 'Right' : 'Left';
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
}

app.whenReady().then(() => {
  ipcMain.handle('podium-command', async (_event, cmd) => {
    try {
      switch (cmd.type) {
        case 'load_presentation': {
          if (liveEmbeddedWindow && !liveEmbeddedWindow.isDestroyed()) {
            liveEmbeddedWindow.close();
          }
          // The embedded viewer fetches directly from the (public/presigned)
          // fileUrl over HTTP -- no local download needed here, unlike the
          // PowerPoint COM path this replaces.
          const newWin = createEmbeddedViewerWindow(cmd.fileUrl, cmd.presentationId, {
            emergencyExit: true,
          });
          liveEmbeddedWindow = newWin;
          newWin.on('closed', () => {
            // Guard against a stale 'closed' event from an OLD window
            // (e.g. the .close() call above, replacing a previous load)
            // firing after liveEmbeddedWindow has already been reassigned
            // to this newer window -- without this check that race would
            // wrongly null out the reference to the window actually in use.
            if (liveEmbeddedWindow !== newWin) return;
            liveEmbeddedWindow = null;
            liveState = 'offline';
            // Covers the operator's normal Disconnect flow AND the
            // in-window emergency exit button/Escape key -- either way the
            // operator dashboard's Activity Log should reflect that the
            // display dropped out of the live session.
            mainWindowRef?.webContents.send('podium-status', {
              type: 'status',
              sessionId: cmd.sessionId ?? null,
              status: 'offline',
              timestamp: Date.now(),
            });
          });
          liveState = 'ready';
          break;
        }

        case 'play': {
          if (!liveEmbeddedWindow || liveEmbeddedWindow.isDestroyed()) {
            throw new Error('No presentation loaded; call load_presentation first.');
          }
          liveEmbeddedWindow.show();
          liveEmbeddedWindow.focus();
          liveEmbeddedWindow.setFullScreen(true);
          liveState = 'playing';
          break;
        }

        case 'next_slide':
        case 'prev_slide': {
          if (!liveEmbeddedWindow || liveEmbeddedWindow.isDestroyed() || liveState !== 'playing') {
            throw new Error('Slideshow is not running; call play first.');
          }
          sendNavigationKey(liveEmbeddedWindow, cmd.type === 'next_slide' ? 'next' : 'prev');
          break;
        }

        case 'goto_slide': {
          throw new Error('goto_slide is not supported by the embedded viewer.');
        }

        case 'exit_slideshow': {
          // Deliberately only exits fullscreen rather than closing the
          // window -- mirrors the original PowerPoint-COM semantics where
          // exit_slideshow stopped the slideshow but kept the presentation
          // loaded (state -> 'ready'), so a later 'play' resumes instantly
          // instead of re-fetching and reloading the file. The window is
          // only ever destroyed by a fresh load_presentation or the
          // in-window emergency exit/Escape.
          if (liveEmbeddedWindow && !liveEmbeddedWindow.isDestroyed()) {
            liveEmbeddedWindow.setFullScreen(false);
          }
          liveState = 'ready';
          break;
        }

        default:
          throw new Error(`Unknown command type: ${cmd.type}`);
      }

      mainWindowRef?.webContents.send('podium-status', {
        type: 'status',
        sessionId: cmd.sessionId ?? null,
        status: liveState,
        timestamp: Date.now(),
      });
      return { success: true, status: { totalSlides: null } };
    } catch (err) {
      const message = err?.message ?? String(err);
      mainWindowRef?.webContents.send('podium-error', {
        type: 'error',
        sessionId: cmd.sessionId ?? null,
        code: 'presentation_error',
        message,
        timestamp: Date.now(),
      });
      return { success: false, error: message };
    }
  });

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
