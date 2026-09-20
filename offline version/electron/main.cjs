const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

const DEV_URL = "http://127.0.0.1:5174";
const isDev = !app.isPackaged;

/** @type {BrowserWindow | null} */
let mainWindow = null;

/**
 * Resolve runtime config without candidate setup.
 * Priority:
 * 1) config.json next to the executable (portable Win / ops override)
 * 2) config.json in app resources (shipped with the build)
 * 3) empty → renderer falls back to baked-in VITE_API_BASE
 */
function loadRuntimeConfig() {
  const candidates = [];

  try {
    candidates.push(path.join(path.dirname(process.execPath), "config.json"));
  } catch {
    // ignore
  }

  if (!isDev) {
    candidates.push(path.join(process.resourcesPath, "config.json"));
  }

  // Dev: project resources/
  candidates.push(path.join(__dirname, "..", "resources", "config.json"));

  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      const apiBaseUrl = typeof parsed.apiBaseUrl === "string" ? parsed.apiBaseUrl.trim() : "";
      if (apiBaseUrl && !apiBaseUrl.includes("YOUR-PRODUCTION-API")) {
        return { apiBaseUrl: apiBaseUrl.replace(/\/$/, ""), source: filePath };
      }
      // Placeholder still counts as "found" for ops, but treat as unset
      if (apiBaseUrl) {
        return { apiBaseUrl: "", source: filePath, placeholder: true };
      }
    } catch {
      // try next
    }
  }

  return { apiBaseUrl: "", source: null };
}

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
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    mainWindow.once("ready-to-show", () => {
      mainWindow?.show();
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

  ipcMain.handle("get-runtime-config", async () => {
    const cfg = loadRuntimeConfig();
    return {
      apiBaseUrl: cfg.apiBaseUrl || "",
    };
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
