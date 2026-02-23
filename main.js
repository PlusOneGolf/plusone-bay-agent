const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require("electron");
const path = require("path");

app.disableHardwareAcceleration();

let win;
let timerWin;
let isOverlayVisible = true;
let isTimerVisible = false;
let timerReady = false;

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
    if (isOverlayVisible) {
      win.setAlwaysOnTop(true, "screen-saver");
      win.focus();
    }
  });

  win.on("close", (e) => {
    e.preventDefault();
  });
}

function createTimerWindow() {
  const display = screen.getPrimaryDisplay();
  const screenWidth = display.workAreaSize.width;
  const hudWidth = 240;
  const hudHeight = 48;
  const xPos = Math.round((screenWidth - hudWidth) / 2);

  timerWin = new BrowserWindow({
    width: hudWidth,
    height: hudHeight,
    x: xPos,
    y: 0,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  timerWin.setAlwaysOnTop(true, "floating");
  timerWin.setIgnoreMouseEvents(true);
  timerWin.setVisibleOnAllWorkspaces(true);
  timerWin.loadFile(path.join(__dirname, "timer-hud.html"));

  timerWin.webContents.on("did-finish-load", () => {
    timerReady = true;
    timerWin.webContents.setBackgroundThrottling(false);
  });
}

function showTimer() {
  if (timerWin && !isTimerVisible && timerReady) {
    isTimerVisible = true;
    timerWin.showInactive();
  }
}

function hideTimer() {
  if (timerWin && isTimerVisible) {
    isTimerVisible = false;
    timerWin.hide();
  }
}

ipcMain.on("overlay:show", () => {
  if (win && !isOverlayVisible) {
    isOverlayVisible = true;
    win.show();
    win.setKiosk(true);
    win.setFullScreen(true);
    win.setAlwaysOnTop(true, "screen-saver");
    win.setSkipTaskbar(true);
    win.focus();
  }
});

ipcMain.on("overlay:hide", () => {
  if (win && isOverlayVisible) {
    isOverlayVisible = false;
    win.setAlwaysOnTop(false);
    win.setKiosk(false);
    win.setFullScreen(false);
    win.setSkipTaskbar(false);
    win.hide();
  }
});

ipcMain.on("timer:show", () => {
  showTimer();
});

ipcMain.on("timer:hide", () => {
  hideTimer();
});

ipcMain.on("timer:update", (event, data) => {
  if (timerWin && isTimerVisible) {
    timerWin.webContents.send("timer:update", data);
  }
});

app.on("ready", () => {
  createWindow();
  createTimerWindow();

  globalShortcut.register("Alt+F4", () => {});
  globalShortcut.register("CommandOrControl+W", () => {});
  globalShortcut.register("CommandOrControl+Q", () => {});

  globalShortcut.register("CommandOrControl+Shift+X", () => {
    if (win) {
      win.removeAllListeners("close");
      if (timerWin) {
        timerWin.destroy();
      }
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
