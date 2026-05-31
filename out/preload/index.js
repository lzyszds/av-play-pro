"use strict";
const electron = require("electron");
const preload = require("electron-trpc-experimental/preload");
preload.exposeElectronTRPC();
electron.contextBridge.exposeInMainWorld("electronAPI", {
  download: {
    onProgress: (callback) => {
      const handler = (_event, data) => callback(_event, data);
      electron.ipcRenderer.on("download-progress", handler);
      return () => electron.ipcRenderer.removeListener("download-progress", handler);
    }
  },
  extension: {
    onTaskPushed: (callback) => {
      const handler = (_event, data) => callback(_event, data);
      electron.ipcRenderer.on("extension-task-pushed", handler);
      return () => electron.ipcRenderer.removeListener("extension-task-pushed", handler);
    }
  }
});
