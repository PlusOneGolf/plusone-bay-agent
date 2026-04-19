const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require("electron");
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

const NIRCMD = "C:\\nircmd\\nircmd.exe";
const DISPLAY_WAKE_CMD = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = [System.Drawing.Point]::new(1,1); Start-Sleep -Milliseconds 100; [System.Windows.Forms.Cursor]::Position = [System.Drawing.Point]::new(0,0)"`;

ipcMain.on("display:off", () => {
  exec(`"${NIRCMD}" monitor off`);
});

ipcMain.on("display:wake", () => {
  exec(DISPLAY_WAKE_CMD);
});

let win;
let isOverlayVisible = true;
let currentMode = "kiosk";

function createWindow() {
  win = new BrowserWindow({
    width: 1920,
    height: 1080,
    frame: false,
    fullscreen: true,
    kiosk: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    autoHideMenuBar: true,
    resizable: false,
    minimizable: false,
    closable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true);
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
  const barWidth = 240;
  const barHeight = 48;
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
  }, 100);
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
  }, 100);
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
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
