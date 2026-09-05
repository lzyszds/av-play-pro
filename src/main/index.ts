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
import { triggerAutoCloudBackup } from "./routers/syncRouter";

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

  // 1. 进入应用时静默自动备份（延迟 3.5 秒等待窗口完成渲染）
  setTimeout(() => {
    void triggerAutoCloudBackup("startup");
  }, 3500);

  // 2. 运行中每 30 分钟后台定时自动备份
  setInterval(() => {
    void triggerAutoCloudBackup("interval");
  }, 30 * 60 * 1000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });

  log.info("[app] ready");
});

let isBackingUpBeforeQuit = false;
let quitBackupDone = false;

// 3. 应用退出前自动备份
app.on("before-quit", async (event) => {
  markQuitting();

  if (quitBackupDone) {
    return;
  }

  if (isBackingUpBeforeQuit) {
    event.preventDefault();
    return;
  }

  isBackingUpBeforeQuit = true;
  event.preventDefault();
  log.info("[app] before-quit: 正在执行退出前自动备份...");

  try {
    // 5秒最长超时保障，即使断网或服务异常也绝不阻塞退出
    await Promise.race([
      triggerAutoCloudBackup("exit"),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  } catch (err) {
    log.error("[app] before-quit 自动备份异常:", err);
  } finally {
    quitBackupDone = true;
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
