const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  quit: () => ipcRenderer.send("quit-app"),
  isElectron: true,
  getRuntimeConfig: () => ipcRenderer.invoke("get-runtime-config"),
});
