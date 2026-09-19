const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

const DEV_URL = "http://127.0.0.1:5174";
const isDev = !app.isPackaged;

/** @type {BrowserWindow | null} */
let mainWindow = null;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 1024,
      minHeight: 640,
      title: "Live Coding Exam",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    if (isDev) {
      mainWindow.loadURL(DEV_URL);
    } else {
      mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
    }

    mainWindow.on("closed", () => {
      mainWindow = null;
    });
  }

  ipcMain.on("quit-app", () => {
    app.quit();
  });

  app.whenReady().then(createWindow);

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}
