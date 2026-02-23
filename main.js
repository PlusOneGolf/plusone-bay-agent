const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require("electron");
const path = require("path");

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
    if (currentMode === "kiosk" || currentMode === "alert") {
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

function setAlertMode() {
  if (!win) return;
  currentMode = "alert";
  isOverlayVisible = true;
  win.setIgnoreMouseEvents(false);
  win.setSkipTaskbar(true);

  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;
  win.setSize(width, height);
  win.setPosition(0, 0);
  win.setAlwaysOnTop(true, "screen-saver");
  win.setFullScreen(true);
  win.show();
  win.focus();
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
    case "alert":
      setAlertMode();
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
