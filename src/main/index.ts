import { app, BrowserWindow } from "electron";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import { createMainWindow } from "./app/createMainWindow";
import { setupCdnProxyProtocol } from "./protocols/cdnProxyProtocol";
import { setupLocalMediaProtocol } from "./protocols/localMediaProtocol";
import { startLocalMediaProxyServer } from "./protocols/localMediaProxy";
import { registerAppProtocolSchemes } from "./protocols/registerSchemes";
import { startExtensionPushServer } from "./extensions/pushServer";
import { setupMissavWebSession } from "./webview/missavWebSession";
import { runStartupScrape } from "./routers/scrapeRouter";
import { initLogger, installGlobalErrorHandlers, log } from "./logger";
import { markQuitting } from "./tray";

registerAppProtocolSchemes();

app.whenReady().then(async () => {
  initLogger();
  installGlobalErrorHandlers();

  electronApp.setAppUserModelId("com.avplaypro.app");

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  setupCdnProxyProtocol();
  setupLocalMediaProtocol();
  startLocalMediaProxyServer();
  startExtensionPushServer();
  await setupMissavWebSession();
  createMainWindow();

  // 启动后延迟抓取一次 missav 列表并写入缓存（等 webview 过盾）
  runStartupScrape();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });

  log.info("[app] ready");
});

app.on("before-quit", () => {
  markQuitting();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
