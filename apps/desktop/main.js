// Affinix for Windows: a native window around affinix.space (the web app is the app; this only gives it its own window, icon and
// taskbar entry). Everything the site does works the same, and it is always the current version because it loads the live site.
const { app, BrowserWindow, shell, Menu } = require("electron");
const path = require("path");

const START_URL = process.env.AFFINIX_URL || "https://affinix.space/#/app/arena";
const HOME = new URL(START_URL).origin;
// Sign-in goes through Supabase and Google inside this window; any other link opens in the normal browser.
const IN_APP = [/(^|\.)affinix\.space$/, /(^|\.)supabase\.co$/, /(^|\.)google\.com$/, /(^|\.)gstatic\.com$/];
const isInApp = (u) => { try { const h = new URL(u).hostname; return h === "localhost" || IN_APP.some((re) => re.test(h)); } catch { return false; } };

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

function create() {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 960, minHeight: 640,
    backgroundColor: "#101114",
    title: "Affinix",
    icon: path.join(__dirname, "build", "icon.png"),
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });
  // Google refuses sign-in from a user agent that says "Electron": present the same Chromium the app is built on.
  win.webContents.setUserAgent(win.webContents.getUserAgent().replace(/\sElectron\/\S+/, "").replace(/\saffinix-desktop\/\S+/, ""));
  win.once("ready-to-show", () => win.show());
  win.loadURL(START_URL);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isInApp(url)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("did-fail-load", (_e, code, _desc, url, isMain) => {
    if (isMain && code !== -3) win.loadFile(path.join(__dirname, "offline.html"), { query: { retry: url } });
  });
  win.on("closed", () => { win = null; });
}

app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  create();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) create(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
