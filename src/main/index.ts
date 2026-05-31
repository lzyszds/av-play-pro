import { app, BrowserWindow } from "electron";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import { createMainWindow } from "./app/createMainWindow";
import { setupCdnProxyProtocol } from "./protocols/cdnProxyProtocol";
import { setupLocalMediaProtocol } from "./protocols/localMediaProtocol";
import { registerAppProtocolSchemes } from "./protocols/registerSchemes";
import { startExtensionPushServer } from "./extensions/pushServer";
import { setupMissavWebSession } from "./webview/missavWebSession";

registerAppProtocolSchemes();

app.whenReady().then(async () => {
  electronApp.setAppUserModelId("com.avplaypro.app");

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  setupCdnProxyProtocol();
  setupLocalMediaProtocol();
  startExtensionPushServer();
  await setupMissavWebSession();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
