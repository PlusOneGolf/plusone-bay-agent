const { app, BrowserWindow, globalShortcut, ipcMain, screen, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");

function getConfigPath() {
  return path.join(app.getPath("userData"), "bay-config.json");
}

function loadConfig() {
  try {
    const data = fs.readFileSync(getConfigPath(), "utf-8");
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
}

function saveConfig(config) {
  fs.writeFileSync(getConfigPath(), JSON.stringify(config), "utf-8");
}

ipcMain.handle("config:load", () => {
  return loadConfig();
});

ipcMain.handle("config:save", (event, config) => {
  saveConfig(config);
  return true;
});

const DISPLAY_WAKE_CMD = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = [System.Drawing.Point]::new(1,1); Start-Sleep -Milliseconds 100; [System.Windows.Forms.Cursor]::Position = [System.Drawing.Point]::new(0,0)"`;

function getLocalConfig() {
  try {
    const data = fs.readFileSync(path.join(__dirname, "config.json"), "utf-8");
    return JSON.parse(data);
  } catch (e) {
    return {};
  }
}

ipcMain.handle("app:config:load", () => {
  return getLocalConfig();
});

ipcMain.handle("dialog:open-file", async (event, opts) => {
  const wasKiosk = win && win.isKiosk();
  const wasFullscreen = win && win.isFullScreen();
  if (wasKiosk) win.setKiosk(false);
  if (wasFullscreen) win.setFullScreen(false);
  if (win) win.setAlwaysOnTop(false);

  let result;
  try {
    result = await dialog.showOpenDialog(win || undefined, {
      title: opts.title || "Select file",
      filters: opts.filters || [{ name: "Executables", extensions: ["exe"] }],
      properties: ["openFile"],
    });
  } finally {
    if (win) {
      if (wasFullscreen) win.setFullScreen(true);
      if (wasKiosk) win.setKiosk(true);
      win.setAlwaysOnTop(true, "screen-saver");
      win.focus();
    }
  }
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("app:config:save", (event, config) => {
  try {
    const existing = getLocalConfig();
    const merged = Object.assign({}, existing, config);
    fs.writeFileSync(path.join(__dirname, "config.json"), JSON.stringify(merged, null, 2), "utf-8");
    return true;
  } catch (e) {
    return false;
  }
});

function getNircmdPath(cfg) {
  return cfg.nircmdPath || path.join(process.resourcesPath, "nircmd.exe");
}

ipcMain.on("display:off", () => {
  const cfg = getLocalConfig();
  exec(`"${getNircmdPath(cfg)}" monitor off`);
});

ipcMain.on("display:wake", () => {
  exec(DISPLAY_WAKE_CMD);
});

ipcMain.on("tps:kill", () => {
  const cfg = getLocalConfig();
  const name = cfg.tpsProcessName || "TPS";
  exec(`taskkill /IM "${name}.exe" /F`);
});

ipcMain.on("tps:launch", () => {
  const cfg = getLocalConfig();
  if (cfg.tpsPath) {
    exec(`start "" "${cfg.tpsPath}"`);
  }
});

function getLogPath() {
  return path.join(app.getPath("userData"), "bay-agent.log");
}

const MAX_LOG_BYTES = 5 * 1024 * 1024;

ipcMain.on("log:write", (event, message) => {
  try {
    const stamp = new Date().toISOString();
    const line = `[${stamp}] ${message}\n`;
    const logPath = getLogPath();
    let stat;
    try { stat = fs.statSync(logPath); } catch (e) { stat = null; }
    if (stat && stat.size > MAX_LOG_BYTES) {
      fs.writeFileSync(logPath, line, "utf-8");
    } else {
      fs.appendFileSync(logPath, line, "utf-8");
    }
  } catch (e) {}
});

let win;
let isOverlayVisible = false;
let currentMode = "setup";

function createWindow() {
  win = new BrowserWindow({
    width: 500,
    height: 660,
    frame: false,
    fullscreen: false,
    kiosk: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    focusable: true,
    autoHideMenuBar: true,
    resizable: false,
    minimizable: false,
    closable: false,
    center: true,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  win.loadFile(path.join(__dirname, "renderer.html"));

  win.on("blur", () => {
    if (currentMode === "kiosk") {
      win.setAlwaysOnTop(true, "screen-saver");
      win.focus();
    }
  });

  win.on("close", (e) => {
    e.preventDefault();
  });
}

function setKioskMode() {
  if (!win) return;
  currentMode = "kiosk";
  isOverlayVisible = true;
  win.setIgnoreMouseEvents(false);
  win.setSkipTaskbar(true);
  win.setAlwaysOnTop(true, "screen-saver");
  win.setKiosk(true);
  win.setFullScreen(true);
  win.show();
  win.focus();
}

function setTimerBarMode() {
  if (!win) return;
  const display = screen.getPrimaryDisplay();
  const screenWidth = display.workAreaSize.width;
  const barWidth = 220;
  const barHeight = 50;
  const xPos = Math.round((screenWidth - barWidth) / 2);

  currentMode = "timer";
  isOverlayVisible = true;
  win.setKiosk(false);
  win.setFullScreen(false);

  setTimeout(() => {
    win.setSize(barWidth, barHeight);
    win.setPosition(xPos, 0);
    win.setAlwaysOnTop(true, "floating");
    win.setIgnoreMouseEvents(true);
    win.setSkipTaskbar(true);
    win.showInactive();
  }, 250);
}

function setNotifyBarMode() {
  if (!win) return;
  const display = screen.getPrimaryDisplay();
  const screenWidth = display.workAreaSize.width;
  const barWidth = 420;
  const barHeight = 48;
  const xPos = Math.round((screenWidth - barWidth) / 2);

  currentMode = "notify";
  isOverlayVisible = true;
  win.setKiosk(false);
  win.setFullScreen(false);

  setTimeout(() => {
    win.setSize(barWidth, barHeight);
    win.setPosition(xPos, 0);
    win.setAlwaysOnTop(true, "floating");
    win.setIgnoreMouseEvents(true);
    win.setSkipTaskbar(true);
    win.showInactive();
  }, 250);
}

function setHiddenMode() {
  if (!win) return;
  currentMode = "hidden";
  isOverlayVisible = false;
  win.setIgnoreMouseEvents(false);
  win.setAlwaysOnTop(false);
  win.setKiosk(false);
  win.setFullScreen(false);
  win.setSkipTaskbar(false);
  win.hide();
}

function setSetupMode() {
  if (!win) return;
  currentMode = "setup";
  isOverlayVisible = true;
  win.setKiosk(false);
  win.setFullScreen(false);
  win.setAlwaysOnTop(false);
  win.setIgnoreMouseEvents(false);
  win.setSkipTaskbar(false);
  win.setSize(500, 660);
  win.center();
  win.show();
  win.focus();
}

ipcMain.on("window:mode", (event, mode) => {
  switch (mode) {
    case "kiosk":
      setKioskMode();
      break;
    case "timer":
      setTimerBarMode();
      break;
    case "notify":
      setNotifyBarMode();
      break;
    case "hidden":
      setHiddenMode();
      break;
    case "setup":
      setSetupMode();
      break;
  }
});

app.on("ready", () => {
  createWindow();

  globalShortcut.register("Alt+F4", () => {});
  globalShortcut.register("CommandOrControl+W", () => {});
  globalShortcut.register("CommandOrControl+Q", () => {});

  globalShortcut.register("CommandOrControl+Shift+X", () => {
    if (win) {
      win.removeAllListeners("close");
      app.quit();
    }
  });

  globalShortcut.register("CommandOrControl+Shift+D", () => {
    if (win) {
      win.webContents.openDevTools({ mode: "detach" });
    }
  });

  ipcMain.handle("log:path", () => getLogPath());

  ipcMain.on("app:quit", () => {
    if (win) win.removeAllListeners("close");
    app.quit();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
