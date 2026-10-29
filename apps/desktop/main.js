// Affinix for desktop (Windows, Linux): the web app in its own native window. The site is the app, so everything works the same and it is always the
// current version; this shell adds what a browser tab does not have: its own window / taskbar entry / icon, one instance only, remembered window
// position, a tray icon, the affinix:// links, start with the system, a native menu in the system language, automatic updates, safe link handling.
const { app, BrowserWindow, Menu, Tray, shell, session, screen, nativeImage, nativeTheme, Notification } = require("electron");
const fs = require("fs");
const path = require("path");
const lib = require("./lib.js");

const START_URL = process.env.AFFINIX_URL || `${lib.SITE}/#/app/arena`;
const HOME = new URL(START_URL).origin;
const ICON = path.join(__dirname, "build", "icon.png");
const PROTOCOL = "affinix";

app.setAppUserModelId("space.affinix.app"); // Windows: notifications and the taskbar group belong to Affinix, not to "electron.app"
nativeTheme.themeSource = "dark";
if (process.platform === "linux") app.commandLine.appendSwitch("enable-features", "WaylandWindowDecorations");

// ---- one instance, and the affinix:// protocol --------------------------------------------------------------------------------------------
let win = null;
let tray = null;
let quitting = false;
let pendingLink = process.argv.find((a) => /^affinix:/i.test(a)) ?? null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    const link = argv.find((a) => /^affinix:/i.test(a));
    showWindow();
    if (link) openLink(link);
  });
}

if (process.defaultApp) {
  if (process.argv.length >= 2) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}
app.on("open-url", (e, url) => { e.preventDefault(); pendingLink = url; if (win) openLink(url); }); // macOS

function openLink(link) {
  const target = lib.fromDeepLink(link);
  if (!target || !win) return;
  const hash = target.slice(HOME.length + 1); // "#/app/arena"
  if (win.webContents.getURL().startsWith(HOME)) win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(hash.replace(/^#/, ""))}`).catch(() => {});
  else win.loadURL(target);
}

// ---- settings kept on this computer ---------------------------------------------------------------------------------------------------------
const stateFile = () => path.join(app.getPath("userData"), "window-state.json");
function readState() { try { return JSON.parse(fs.readFileSync(stateFile(), "utf8")); } catch { return {}; } }
let state = {};
function saveState() {
  if (!win) return;
  try {
    const b = win.isMaximized() || win.isFullScreen() ? state.bounds : win.getBounds();
    state = { ...state, bounds: b, maximized: win.isMaximized() };
    fs.writeFileSync(stateFile(), JSON.stringify(state));
  } catch { /* a read-only profile must not stop the app */ }
}
function setSetting(key, value) { state = { ...state, [key]: value }; try { fs.writeFileSync(stateFile(), JSON.stringify(state)); } catch { /* ignore */ } }

// ---- the window ---------------------------------------------------------------------------------------------------------------------------------
function createWindow() {
  const saved = lib.boundsVisible(state.bounds, screen.getAllDisplays()) ? state.bounds : {};
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 960, minHeight: 600, ...saved,
    backgroundColor: "#101114",
    title: "Affinix",
    icon: ICON,
    autoHideMenuBar: true, // Alt shows the menu
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true, devTools: !app.isPackaged },
  });
  if (state.maximized) win.maximize();
  // Google refuses sign-in from a user agent that says "Electron": present the Chromium the app is built on.
  win.webContents.setUserAgent(win.webContents.getUserAgent().replace(/\sElectron\/\S+/, "").replace(/\saffinix-desktop\/\S+/, ""));
  win.once("ready-to-show", () => { win.show(); if (pendingLink) { openLink(pendingLink); pendingLink = null; } });
  setTimeout(() => { if (win && !win.isVisible()) win.show(); }, 8000); // never leave the person with an invisible app, whatever the first page does
  win.loadURL(START_URL);

  // links: the site and its sign-in stay here, everything else opens in the normal browser (and only web / mail links, never a program)
  const external = (url) => { if (lib.isSafeExternal(url)) shell.openExternal(url); };
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (lib.isInApp(url)) return { action: "allow" };
    external(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (url.startsWith("file:") || lib.isInApp(url)) return;
    e.preventDefault();
    external(url);
  });
  win.webContents.on("did-fail-load", (_e, code, _desc, url, isMain) => {
    if (!isMain || code === -3) return; // -3: the page itself cancelled a navigation (a redirect), not a failure
    win.loadFile(path.join(__dirname, "offline.html"), { query: { retry: url || START_URL } });
    if (!win.isVisible()) win.show();
  });
  win.webContents.on("context-menu", (_e, p) => contextMenu(p));

  win.on("close", (e) => {
    saveState();
    if (!quitting && state.closeToTray && tray) { e.preventDefault(); win.hide(); }
  });
  win.on("resized", saveState);
  win.on("moved", saveState);
  win.on("closed", () => { win = null; });
}

function showWindow() {
  if (!win) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function contextMenu(p) {
  const s = lib.t(app.getLocale());
  const items = [];
  for (const word of p.dictionarySuggestions ?? []) items.push({ label: word, click: () => win.webContents.replaceMisspelling(word) });
  if (items.length) items.push({ type: "separator" });
  if (p.linkURL) {
    items.push({ label: s.openLink, click: () => lib.isSafeExternal(p.linkURL) && shell.openExternal(p.linkURL) });
    items.push({ label: s.copyLink, click: () => require("electron").clipboard.writeText(p.linkURL) }, { type: "separator" });
  }
  if (p.isEditable) items.push({ label: s.cut, role: "cut", enabled: p.editFlags.canCut }, { label: s.copy, role: "copy", enabled: p.editFlags.canCopy }, { label: s.paste, role: "paste", enabled: p.editFlags.canPaste }, { label: s.selectAll, role: "selectAll" });
  else if (p.selectionText) items.push({ label: s.copy, role: "copy" });
  else items.push({ label: s.back, enabled: win.webContents.canGoBack(), click: () => win.webContents.goBack() }, { label: s.forward, enabled: win.webContents.canGoForward(), click: () => win.webContents.goForward() }, { label: s.reload, role: "reload" });
  Menu.buildFromTemplate(items).popup({ window: win });
}

// ---- menu and tray ------------------------------------------------------------------------------------------------------------------------------
let updateReady = false;
function buildMenu() {
  const s = lib.t(app.getLocale());
  const go = (hash) => () => { showWindow(); openLink(`${PROTOCOL}://${hash}`); };
  const template = [
    { label: s.file, submenu: [
      { label: s.reload, accelerator: "CmdOrCtrl+R", click: () => win?.webContents.reload() },
      { label: s.openBrowser, click: () => shell.openExternal(win?.webContents.getURL().startsWith(HOME) ? win.webContents.getURL() : START_URL) },
      { type: "separator" },
      { label: s.tray, type: "checkbox", checked: !!state.closeToTray, click: (m) => setSetting("closeToTray", m.checked) },
      ...(process.platform === "darwin" ? [] : [{ label: s.login, type: "checkbox", checked: app.getLoginItemSettings().openAtLogin, click: (m) => app.setLoginItemSettings({ openAtLogin: m.checked }) }]),
      ...(updateReady ? [{ type: "separator" }, { label: s.updateReady, click: () => { quitting = true; require("electron-updater").autoUpdater.quitAndInstall(); } }] : []),
      { type: "separator" },
      { label: s.quit, accelerator: "CmdOrCtrl+Q", click: () => { quitting = true; app.quit(); } },
    ] },
    { label: s.edit, submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: s.view, submenu: [
      { label: s.zoomIn, role: "zoomIn" }, { label: s.zoomOut, role: "zoomOut" }, { label: s.zoomReset, role: "resetZoom" },
      { type: "separator" }, { label: s.fullscreen, role: "togglefullscreen" },
      ...(app.isPackaged ? [] : [{ type: "separator" }, { role: "toggleDevTools" }]),
    ] },
    { label: s.go, submenu: [
      { label: s.arena, accelerator: "CmdOrCtrl+1", click: go("app/arena") },
      { label: s.styles, accelerator: "CmdOrCtrl+2", click: go("app/styles") },
      { label: s.feed, accelerator: "CmdOrCtrl+3", click: go("app/feed") },
      { label: s.messages, accelerator: "CmdOrCtrl+4", click: go("app/messages") },
      { label: s.settings, accelerator: "CmdOrCtrl+,", click: go("app/settings") },
    ] },
    { label: s.help, submenu: [
      { label: s.website, click: () => shell.openExternal(lib.SITE) },
      { label: s.download, click: () => shell.openExternal(`${lib.SITE}/#/download`) },
      { type: "separator" },
      { label: `${s.about} ${app.getVersion()}`, enabled: false },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  if (process.platform === "darwin") return;
  try {
    const img = nativeImage.createFromPath(ICON).resize({ width: 20, height: 20 });
    tray = new Tray(img);
    tray.setToolTip("Affinix");
    const s = lib.t(app.getLocale());
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: s.show, click: showWindow },
      { label: s.arena, click: () => { showWindow(); openLink(`${PROTOCOL}://app/arena`); } },
      { type: "separator" },
      { label: s.quit, click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on("click", showWindow);
  } catch { tray = null; /* a desktop without a tray: the setting then simply does nothing */ }
}

// ---- permissions: only what the site needs, only for the site -----------------------------------------------------------------------------------
const ALLOWED = new Set(["notifications", "clipboard-sanitized-write", "clipboard-read", "media", "fullscreen"]);
function setupPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => callback(ALLOWED.has(permission) && lib.isInApp(details.requestingUrl || "")));
  ses.setPermissionCheckHandler((_wc, permission, origin) => ALLOWED.has(permission) && lib.isInApp(origin || ""));
}

// ---- updates: Windows installer and Linux AppImage update themselves from the GitHub release ------------------------------------------
function setupUpdates() {
  if (!app.isPackaged || process.env.AFFINIX_NO_UPDATE) return;
  let autoUpdater;
  try { ({ autoUpdater } = require("electron-updater")); } catch { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-downloaded", () => {
    updateReady = true;
    buildMenu();
    try { new Notification({ title: "Affinix", body: lib.t(app.getLocale()).updated, icon: ICON }).show(); } catch { /* notifications can be off */ }
  });
  autoUpdater.on("error", () => { /* offline, a .deb install (it updates through the package manager) or no release yet: nothing to tell the person */ });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 15_000);
  setInterval(check, 4 * 60 * 60 * 1000);
}

// ---- start --------------------------------------------------------------------------------------------------------------------------------------
app.whenReady().then(() => {
  if (!gotLock) return; // a second copy: the first one was told to show itself, this one only quits
  state = readState();
  setupPermissions();
  buildMenu();
  createWindow();
  createTray();
  setupUpdates();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("before-quit", () => { quitting = true; });
app.on("window-all-closed", () => { if (process.platform !== "darwin" && !(state.closeToTray && tray)) app.quit(); });
