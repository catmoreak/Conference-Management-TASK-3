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

  // Load backend domain (or localhost for dev, or local dist/index.html for packaged app)
  if (isDev) {
    const devUrl = process.env.PODIUM_DEV_URL ?? process.env.PODIUM_BACKEND_URL ?? 'http://localhost:5173';
    mainWindow.loadURL(devUrl);
    if (!isKioskRequested) {
      mainWindow.webContents.openDevTools();
    }
  } else if (process.env.PODIUM_BACKEND_URL) {
    mainWindow.loadURL(process.env.PODIUM_BACKEND_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
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
 * Creates the BrowserWindow shell shared by the live-control embedded
 * viewer (real files, via loadFileIntoViewer) and the cover-slide screen
 * (via loadCoverIntoViewer) -- window chrome, Chrome user-agent spoof, and
 * the optional emergency-exit wiring are identical either way; only what
 * gets loaded into the window differs. Also shared by the manual
 * preview/open-in-app feature.
 *
 * @param {{ emergencyExit?: boolean }} [options] - When true (live-control
 *   path only), injects a visible on-screen "Exit Presentation" button and
 *   an Escape-key fallback. Once the window goes fullscreen for the actual
 *   slideshow there is no native title bar/close button reachable by mouse
 *   or keyboard, so this is the operator's/presenter's only way to bail out
 *   locally without going back to the main-panel dashboard.
 */
function createLiveViewerWindowShell(title, options = {}) {
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

  if (isDev) {
    // F12/Ctrl+Shift+I normally open DevTools via Electron's default
    // application menu accelerators, but Menu.setApplicationMenu(null) (set
    // globally for this app) strips that menu out entirely, along with the
    // shortcut -- so without this, there's no way to open DevTools on this
    // window at all, dev build or not.
    win.webContents.on('before-input-event', (_event, input) => {
      if (input.type !== 'keyDown') return;
      const isDevToolsShortcut =
        input.key === 'F12' || ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i');
      if (isDevToolsShortcut) {
        win.webContents.toggleDevTools();
      }
    });
  }

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
    // (or a fresh cover load) navigates to a whole new page, which wipes
    // out any previous injection.
    win.webContents.on('did-finish-load', injectEmergencyExitButton);
  }

  return win;
}

/**
 * Loads a PPTX/PDF into a viewer window via Office Online, falling back to
 * Google Docs viewer if Office Online errors -- not native PowerPoint.
 */
function loadFileIntoViewer(win, fileUrl) {
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
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Loads a plain-text "cover" screen into a viewer window -- fills the
 * projector with large centered text (e.g. the event name) instead of a
 * real presentation, so it doesn't go dark between two presentations.
 */
function loadCoverIntoViewer(win, text) {
  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Cover</title></head>
<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#090d16;color:#f8fafc;font:600 6vw/1.3 -apple-system, Segoe UI, Arial, sans-serif;text-align:center;padding:0 6vw;box-sizing:border-box;">
  <div>${escapeHtml(text)}</div>
</body>
</html>`;
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

/**
 * Collects a frame and every descendant frame in its subtree (recursively
 * walking .frames rather than relying on the newer .framesInSubtree getter,
 * to stay compatible regardless of exact Electron version). Office Online
 * renders its actual toolbar and slide content inside a nested iframe --
 * confirmed via DevTools -- so a script run only via
 * webContents.executeJavaScript() (which is scoped to the main frame) can
 * never see those elements at all, matching or not, explaining why the
 * on-screen "Start Slide Show" button and next/prev arrows were never
 * found in any prior attempt despite clearly existing.
 */
function collectFrames(frame, out = []) {
  if (!frame) return out;
  out.push(frame);
  for (const child of frame.frames) {
    collectFrames(child, out);
  }
  return out;
}

/**
 * Runs `script` in every frame of the window (main frame plus every nested
 * iframe, same-origin or not) and returns the first frame's truthy result
 * (the script returns false on no match, or a details object on a match).
 * Each frame gets its own try/catch since a cross-origin, detached, or
 * mid-navigation frame can reject execution entirely.
 */
async function clickInAnyFrame(win, script) {
  if (win.isDestroyed()) return false;
  const frames = collectFrames(win.webContents.mainFrame);
  console.log(`[navigateSlide] searching ${frames.length} frame(s)`);
  for (const frame of frames) {
    try {
      const result = await frame.executeJavaScript(script);
      console.log(`[navigateSlide] frame url=${frame.url} result=${JSON.stringify(result)}`);
      if (result) return result;
    } catch (err) {
      console.log(`[navigateSlide] frame url=${frame.url} threw: ${err?.message ?? err}`);
    }
  }
  return false;
}

/**
 * Moves to the next/previous slide in the embedded viewer window. Confirmed
 * by hand that this viewer's real navigation surface is a clickable
 * on-screen prev/next arrow next to the "SLIDE X OF Y" indicator at the
 * bottom-center of the window, NOT a keyboard shortcut -- a synthetic arrow
 * keypress here was silently doing nothing across every prior test, even
 * with DOM focus established, while manually clicking the on-screen arrow
 * worked every time. So this clicks that control directly (matched by its
 * accessible label, searched across every frame per clickInAnyFrame above)
 * and only falls back to a coordinate-based click -- at the bottom-center
 * position seen in a live screenshot, not screen edges as first guessed --
 * if no matching labeled element is found (e.g. an icon-only control).
 * sendInputEvent operates at the window/compositor level, so unlike the DOM
 * search this fallback reaches on-screen content regardless of iframe
 * boundaries. The keypress is still sent too, harmlessly, in case a
 * different viewer state (e.g. the Google Docs fallback) does bind it.
 */
async function navigateSlide(win, direction) {
  const term = direction === 'next' ? 'next' : 'previous';
  const clickScript = `
    (function() {
      function isVisible(el) {
        var r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false;
        // Rejects elements parked off-screen (e.g. a collapsed toolbar's
        // controls still present in the DOM at a negative position) --
        // width/height alone doesn't catch that, since such elements can
        // still report a normal size, just outside the visible viewport.
        if (r.right <= 0 || r.bottom <= 0) return false;
        var s = getComputedStyle(el);
        return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) !== 0;
      }
      // Anchored to the WHOLE label (^...$), not just a substring match --
      // otherwise this matches unrelated controls that merely contain the
      // word "next"/"previous", e.g. a viewer's own "Find next" (Ctrl+F
      // search) button, which is a real false positive seen in testing.
      var re = new RegExp('^${term}(\\\\s+(slide|page))?$', 'i');
      var candidates = document.querySelectorAll('button, a, [role="button"]');
      for (var i = 0; i < candidates.length; i++) {
        var el = candidates[i];
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
        var label = (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
        if (!label || !re.test(label) || !isVisible(el)) continue;

        // el.click() only fires a synthetic "click" DOM event -- it does NOT
        // simulate the pointerdown/mousedown/mouseup sequence a real click
        // produces. If this control's handler is bound to one of those
        // lower-level events instead (common in React/Fluent-UI-style
        // components for snappier feel), .click() finds the right element
        // but silently does nothing -- so dispatch the full realistic
        // sequence instead of relying on .click() alone.
        var rect = el.getBoundingClientRect();
        var cx = rect.left + rect.width / 2;
        var cy = rect.top + rect.height / 2;
        var opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, buttons: 1 };
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (type) {
          var Ctor = type.indexOf('pointer') === 0 ? PointerEvent : MouseEvent;
          el.dispatchEvent(new Ctor(type, opts));
        });

        return {
          tag: el.tagName,
          label: label,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        };
      }
      return false;
    })();
  `;

  const result = await clickInAnyFrame(win, clickScript);
  console.log(`[navigateSlide] direction=${direction} result=${JSON.stringify(result)}`);
  const clicked = Boolean(result);

  if (!clicked && !win.isDestroyed()) {
    const bounds = win.getContentBounds();
    const y = Math.round(bounds.height * 0.975);
    const x = Math.round(bounds.width * (direction === 'next' ? 0.56 : 0.44));
    console.log(`[navigateSlide] falling back to coordinate click at (${x}, ${y}) within ${bounds.width}x${bounds.height}`);
    win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  }

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
          const newWin = createLiveViewerWindowShell(cmd.presentationId, { emergencyExit: true });
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
          loadFileIntoViewer(newWin, cmd.fileUrl);
          liveState = 'ready';
          break;
        }

        case 'show_cover': {
          if (liveEmbeddedWindow && !liveEmbeddedWindow.isDestroyed()) {
            liveEmbeddedWindow.close();
          }
          const newWin = createLiveViewerWindowShell(cmd.presentationId, { emergencyExit: true });
          liveEmbeddedWindow = newWin;
          newWin.on('closed', () => {
            if (liveEmbeddedWindow !== newWin) return;
            liveEmbeddedWindow = null;
            liveState = 'offline';
            mainWindowRef?.webContents.send('podium-status', {
              type: 'status',
              sessionId: cmd.sessionId ?? null,
              status: 'offline',
              timestamp: Date.now(),
            });
          });
          loadCoverIntoViewer(newWin, cmd.text ?? '');
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

          // Establishes DOM focus on the viewer content before any
          // next_slide/prev_slide arrives -- confirmed by hand that this
          // viewer's own on-screen arrows are what actually navigate (see
          // navigateSlide()), but a real click here first still helps make
          // sure the page itself is focused/settled after the fullscreen
          // transition. Delayed slightly since that transition can briefly
          // invalidate content bounds.
          await new Promise((resolve) => setTimeout(resolve, 400));
          if (!liveEmbeddedWindow.isDestroyed()) {
            const bounds = liveEmbeddedWindow.getContentBounds();
            const x = Math.round(bounds.width / 2);
            const y = Math.round(bounds.height / 2);
            liveEmbeddedWindow.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
            liveEmbeddedWindow.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
          }
          break;
        }

        case 'next_slide':
        case 'prev_slide': {
          if (!liveEmbeddedWindow || liveEmbeddedWindow.isDestroyed() || liveState !== 'playing') {
            throw new Error('Slideshow is not running; call play first.');
          }
          await navigateSlide(liveEmbeddedWindow, cmd.type === 'next_slide' ? 'next' : 'prev');
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
      // Visible in the terminal running the podium app (main-process console,
      // not devtools) -- without this, a failure here was only reported over
      // the WS relay pipe, which itself had bugs that silently swallowed or
      // genericized real error messages, making local debugging impossible.
      console.error(`[podium-command] ${cmd.type} failed:`, err);
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
