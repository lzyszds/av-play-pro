import { BrowserWindow, shell, app, dialog, ipcMain } from "electron";
import { join } from "path";
import { existsSync } from "fs";
import { readSettingsJson, writeSettingsJson } from "../lib/settingsFile";
import { createIPCHandler } from "electron-trpc-experimental/main";
import { appRouter } from "../router";
import { setMainWindow } from "../windowState";
import { setScrapeImpl } from "../postprocess/queue";
import { setupTray, getIsQuitting, markQuitting } from "../tray";
import { log } from "../logger";
import { triggerAutoCloudBackup } from "../routers/syncRouter";

function resolveAppIcon(): string | undefined {
  const candidates = [
    join(__dirname, "../../resources/logo.png"),
    join(process.resourcesPath || "", "resources", "logo.png"),
    join(process.resourcesPath || "", "logo.png"),
  ];
  return candidates.find((p) => existsSync(p));
}

// 读取已保存的 closeAction（'ask' | 'tray' | 'quit'），首次为 ask
function readCloseAction(): "ask" | "tray" | "quit" {
  const data = readSettingsJson<{ closeAction?: "ask" | "tray" | "quit" }>();
  return data?.closeAction ?? "ask";
}

function writeCloseAction(action: "tray" | "quit"): void {
  try {
    const prev = readSettingsJson() ?? {};
    writeSettingsJson({ ...prev, closeAction: action });
  } catch (err) {
    log.error("[createMainWindow] writeCloseAction failed", err);
  }
}

export function createMainWindow(): void {
  const appIcon = resolveAppIcon();
  const isMac = process.platform === "darwin";
  const window = new BrowserWindow({
    width: 1520,
    height: 860,
    minWidth: 1280,
    minHeight: 820,
    show: false,
    frame: false,
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    // macOS: 将红绿灯按钮定位到标题栏内部，避免与自定义 Logo 重叠
    ...(isMac ? { trafficLightPosition: { x: 10, y: 10 } } : {}),
    ...(appIcon ? { icon: appIcon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      webSecurity: true,
    },
  });

  setMainWindow(window);

  createIPCHandler({ router: appRouter, windows: [window] });

  // 全局界面缩放（设置页个性化里 85%–120%）：避免重复注册，先移除再挂载
  ipcMain.removeHandler("app:set-zoom");
  ipcMain.handle("app:set-zoom", (_event, factor: unknown) => {
    const zoom = typeof factor === "number" ? factor : 1;
    window.webContents.setZoomFactor(Math.max(0.6, Math.min(2, zoom)));
  });

  // 注入刮削实现，供下载后处理队列调用（通过 trpc createCaller 复用 metaRouter 逻辑）
  setScrapeImpl(async (folderPath: string) => {
    try {
      const caller = appRouter.createCaller({});
      const r = await caller.meta.scrapeMetadata({ folderPath });
      return r as { success: boolean; error?: string };
    } catch (e: any) {
      return { success: false, error: e?.message || String(e) };
    }
  });

  setupTray(window);

  // 关闭行为：根据 settings.closeAction 决定是隐藏还是退出
  window.on("close", (event) => {
    if (getIsQuitting()) return;
    let action = readCloseAction();

    if (action === "ask") {
      event.preventDefault();
      const result = dialog.showMessageBoxSync(window, {
        type: "question",
        buttons: ["最小化到托盘", "彻底退出", "取消"],
        defaultId: 0,
        cancelId: 2,
        title: "关闭确认",
        message: "关闭主窗口时希望执行哪种操作？",
        detail: "选择后会被记住，可在「设置 → 关闭主窗口时」修改。",
      });
      if (result === 2) return; // 取消
      action = result === 0 ? "tray" : "quit";
      writeCloseAction(action);
    }

    if (action === "tray") {
      event.preventDefault();
      window.hide();
      void triggerAutoCloudBackup("tray_hide");
      return;
    }
    // quit
    markQuitting();
    app.quit();
  });

  window.on("ready-to-show", () => {
    window?.show();
  });

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  log.info(
    `[主进程] ELECTRON_RENDERER_URL=${process.env["ELECTRON_RENDERER_URL"]}`,
  );

  if (process.env["ELECTRON_RENDERER_URL"]) {
    window.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    window.webContents.openDevTools();
  } else {
    window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}
