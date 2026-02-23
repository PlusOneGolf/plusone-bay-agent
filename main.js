const { app, BrowserWindow, globalShortcut, ipcMain } = require("electron");
const path = require("path");

let win;
let isOverlayVisible = true;

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
