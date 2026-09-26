const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  globalShortcut,
  nativeImage,
  screen,
  session,
  shell,
  ipcMain,
} = require('electron');
const fs = require('fs');
const path = require('path');
const store = require('./store');

const HOME_URL = 'https://www.youtube.com';
const SIGNIN_URL =
  'https://accounts.google.com/ServiceLogin?service=youtube&continue=' +
  encodeURIComponent('https://www.youtube.com/signin?action_handle_signin=true&next=%2F');
const PARTITION = 'persist:ytfloat';
const MIN_W = 320;
const MIN_H = 180;
const BAR_HEIGHT = 24;

// Present as regular desktop Chrome (no "Electron"/app tokens) so Google sign-in isn't blocked.
const CHROME_UA =
  `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ` +
  `(KHTML, like Gecko) Chrome/${process.versions.chrome.split('.')[0]}.0.0.0 Safari/537.36`;
app.userAgentFallback = CHROME_UA;

// Google blocks sign-in when a "Chrome" UA lacks real Chrome's client hints, which Electron
// can't provide. Firefox sends no client hints, so the sign-in window presents as Firefox.
// Firefox ships every 4 weeks; derive a current-looking version from 128 (2024-07-09).
const FIREFOX_VERSION = 128 + Math.floor((Date.now() - Date.UTC(2024, 6, 9)) / (28 * 864e5));
const FIREFOX_UA =
  `Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:${FIREFOX_VERSION}.0) ` +
  `Gecko/20100101 Firefox/${FIREFOX_VERSION}.0`;

const injectCss = fs.readFileSync(path.join(__dirname, 'inject.css'), 'utf8');

let win = null;
let tray = null;
let signinWin = null;
let barVisible = false;
let barHideTimer = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function defaultBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 480;
  const height = 270;
  return {
    width,
    height,
    x: workArea.x + workArea.width - width - 24,
    y: workArea.y + workArea.height - height - 24,
  };
}

function boundsAreVisible(b) {
  return screen.getAllDisplays().some(({ workArea: a }) =>
    b.x < a.x + a.width - 40 && b.x + b.width > a.x + 40 &&
    b.y < a.y + a.height - 40 && b.y + b.height > a.y);
}

function applyAlwaysOnTop(on) {
  // 'screen-saver' level floats above full-screen apps.
  win.setAlwaysOnTop(on, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
}

function applyAspect(on) {
  win.setAspectRatio(on ? 16 / 9 : 0);
}

function applyDock(show) {
  if (!app.dock) return;
  if (show) app.dock.show();
  else app.dock.hide();
}

function createWindow() {
  const saved = store.get('bounds');
  const bounds = saved && boundsAreVisible(saved) ? saved : defaultBounds();

  win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_W,
    minHeight: MIN_H,
    frame: false,
    resizable: true,
    hasShadow: true,
    roundedCorners: true,
    fullscreenable: false,
    backgroundColor: '#0f0f0f',
    show: false,
    title: 'YT Float',
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  applyAlwaysOnTop(store.get('alwaysOnTop'));
  applyAspect(store.get('lockAspect'));
  win.setOpacity(store.get('opacity'));

  const wc = win.webContents;
  wc.setUserAgent(CHROME_UA);

  wc.on('dom-ready', () => {
    wc.insertCSS(injectCss);
    wc.send('compact', store.get('compact'));
    wc.send('bar-visible', barVisible);
  });

  // Keep YouTube/Google links in this window; send everything else to the default browser.
  // Send Google sign-in to the separate Firefox-UA window instead of the embedded page.
  const interceptSignin = (e, url) => {
    if (isSigninUrl(url)) {
      e.preventDefault();
      openSigninWindow(url);
    }
  };
  wc.on('will-navigate', (e) => interceptSignin(e, e.url));
  wc.on('will-redirect', (e) => interceptSignin(e, e.url));

  wc.setWindowOpenHandler(({ url }) => {
    if (isSigninUrl(url)) {
      openSigninWindow(url);
      return { action: 'deny' };
    }
    if (isInternalUrl(url)) wc.loadURL(url);
    else shell.openExternal(url);
    return { action: 'deny' };
  });

  const saveBounds = () => {
    if (!win.isDestroyed()) store.set('bounds', win.getBounds());
  };
  win.on('moved', saveBounds);
  win.on('resized', saveBounds);

  win.on('close', (e) => {
    saveBounds();
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('show', updateTrayMenu);
  win.on('hide', updateTrayMenu);

  win.once('ready-to-show', () => win.show());
  win.loadURL(HOME_URL);

  startHoverWatcher();
}

function isInternalUrl(url) {
  try {
    const { hostname } = new URL(url);
    return /(^|\.)(youtube\.com|youtu\.be|google\.com|googleusercontent\.com)$/.test(hostname);
  } catch {
    return false;
  }
}

function isSigninUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === 'accounts.google.com' &&
      /^\/(ServiceLogin|signin|v3\/signin|AccountChooser|AddSession)/i.test(u.pathname);
  } catch {
    return false;
  }
}

// Frameless windows can't hover-detect reliably over drag regions, so poll the cursor.
function startHoverWatcher() {
  setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
    const inTopStrip = inside && p.y < b.y + BAR_HEIGHT + 4;
    if (inTopStrip) {
      clearTimeout(barHideTimer);
      barHideTimer = null;
      setBarVisible(true);
    } else if (barVisible && !barHideTimer) {
      barHideTimer = setTimeout(() => {
        barHideTimer = null;
        setBarVisible(false);
      }, 500);
    }
  }, 100);
}

function setBarVisible(v) {
  if (v === barVisible) return;
  barVisible = v;
  win.webContents.send('bar-visible', v);
}

ipcMain.on('bar-action', (_e, action) => {
  const wc = win.webContents;
  if (action === 'back') {
    if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  } else if (action === 'home') {
    wc.loadURL(HOME_URL);
  } else if (action === 'close') {
    win.hide();
  }
});

function toggleWindow() {
  if (win.isVisible()) {
    win.hide();
  } else {
    win.show();
    win.focus();
  }
}

function toggleAlwaysOnTop() {
  const on = !store.get('alwaysOnTop');
  store.set('alwaysOnTop', on);
  applyAlwaysOnTop(on);
  updateMenus();
}

function changeOpacity(delta) {
  const next = Math.round(Math.min(1, Math.max(0.4, store.get('opacity') + delta)) * 100) / 100;
  store.set('opacity', next);
  win.setOpacity(next);
}

function toggleCompact() {
  const on = !store.get('compact');
  store.set('compact', on);
  win.webContents.send('compact', on);
  updateMenus();
}

function toggleAspect() {
  const on = !store.get('lockAspect');
  store.set('lockAspect', on);
  applyAspect(on);
  if (on) {
    const b = win.getBounds();
    win.setBounds({ ...b, height: Math.max(MIN_H, Math.round(b.width * 9 / 16)) });
  }
  updateMenus();
}

function toggleDock() {
  const show = !store.get('showInDock');
  store.set('showInDock', show);
  applyDock(show);
  updateMenus();
  // Hiding the dock icon can drop focus; bring the window back.
  if (win.isVisible()) win.show();
}

function resetPosition() {
  win.setBounds(defaultBounds());
  store.set('bounds', win.getBounds());
  if (!win.isVisible()) win.show();
}

// Fallback: Google sign-in in a normal framed window that shares the same session.
function openSigninWindow(url = SIGNIN_URL) {
  if (signinWin && !signinWin.isDestroyed()) {
    signinWin.show();
    signinWin.focus();
    return;
  }
  signinWin = new BrowserWindow({
    width: 480,
    height: 680,
    title: 'Sign in to Google',
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, 'signin-preload.js'),
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  signinWin.setAlwaysOnTop(true, 'screen-saver');
  const swc = signinWin.webContents;
  swc.setUserAgent(FIREFOX_UA);
  swc.setWindowOpenHandler(({ url: u }) => {
    swc.loadURL(u);
    return { action: 'deny' };
  });
  swc.on('did-navigate', (_e, u) => {
    // Once Google hands us back to YouTube, we're signed in.
    if (new URL(u).hostname.endsWith('youtube.com')) {
      signinWin.close();
      win.webContents.loadURL(HOME_URL);
      win.show();
    }
  });
  signinWin.on('closed', () => { signinWin = null; });
  signinWin.loadURL(url);
}

function buildAppMenu() {
  // Hidden app menu: provides the local shortcuts and standard Edit keys (⌘C/⌘V in sign-in forms).
  return Menu.buildFromTemplate([
    {
      label: 'YT Float',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Always on Top', type: 'checkbox', checked: store.get('alwaysOnTop'), accelerator: 'Alt+Command+T', click: toggleAlwaysOnTop },
        { label: 'Compact Mode', type: 'checkbox', checked: store.get('compact'), accelerator: 'Alt+Command+C', click: toggleCompact },
        { label: 'Lock 16:9 Aspect Ratio', type: 'checkbox', checked: store.get('lockAspect'), click: toggleAspect },
        { type: 'separator' },
        { label: 'Increase Opacity', accelerator: 'Alt+Command+Up', click: () => changeOpacity(0.1) },
        { label: 'Decrease Opacity', accelerator: 'Alt+Command+Down', click: () => changeOpacity(-0.1) },
        { type: 'separator' },
        { label: 'Back', accelerator: 'Command+[', click: () => ipcMain.emit('bar-action', null, 'back') },
        { label: 'Home', accelerator: 'Shift+Command+H', click: () => win.webContents.loadURL(HOME_URL) },
        { role: 'reload' },
        { role: 'toggleDevTools' },
      ],
    },
  ]);
}

function trayImage() {
  const img = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'trayTemplate.png'));
  img.setTemplateImage(true);
  return img;
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: win.isVisible() ? 'Hide' : 'Show', accelerator: 'Alt+Command+Y', click: toggleWindow },
    { type: 'separator' },
    { label: 'Compact Mode', type: 'checkbox', checked: store.get('compact'), click: toggleCompact },
    { label: 'Always on Top', type: 'checkbox', checked: store.get('alwaysOnTop'), click: toggleAlwaysOnTop },
    { label: 'Lock 16:9 Aspect Ratio', type: 'checkbox', checked: store.get('lockAspect'), click: toggleAspect },
    { label: 'Show Dock Icon', type: 'checkbox', checked: store.get('showInDock'), click: toggleDock },
    { type: 'separator' },
    { label: 'Reset Window Position', click: resetPosition },
    { label: 'Sign in with Google (separate window)…', click: () => openSigninWindow() },
    { type: 'separator' },
    { label: 'Quit YT Float', accelerator: 'Command+Q', click: () => app.quit() },
  ]);
}

function updateTrayMenu() {
  if (tray && win) tray.setContextMenu(buildTrayMenu());
}

function updateMenus() {
  Menu.setApplicationMenu(buildAppMenu());
  updateTrayMenu();
}

app.on('second-instance', () => {
  if (win) { win.show(); win.focus(); }
});

app.whenReady().then(() => {
  const ses = session.fromPartition(PARTITION);
  ses.setUserAgent(CHROME_UA);
  // Strip Chromium client hints from the sign-in window so it looks consistently like Firefox.
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = details.requestHeaders;
    if (signinWin && !signinWin.isDestroyed() && details.webContentsId === signinWin.webContents.id) {
      for (const k of Object.keys(headers)) {
        if (/^sec-ch-ua/i.test(k)) delete headers[k];
      }
      headers['User-Agent'] = FIREFOX_UA;
    }
    callback({ requestHeaders: headers });
  });
  applyDock(store.get('showInDock'));

  createWindow();

  tray = new Tray(trayImage());
  tray.setToolTip('YT Float');
  updateMenus();

  if (!globalShortcut.register('Alt+Command+Y', toggleWindow)) {
    console.warn('Could not register ⌥⌘Y (already in use by another app).');
  }
});

app.on('before-quit', () => {
  quitting = true;
  if (win && !win.isDestroyed()) store.set('bounds', win.getBounds());
  store.flush();
});

app.on('will-quit', () => globalShortcut.unregisterAll());

// Keep running in the menu bar when the window is hidden.
app.on('window-all-closed', (e) => e.preventDefault());
