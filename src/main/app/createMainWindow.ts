import { BrowserWindow, shell, app, dialog } from "electron";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { createIPCHandler } from "electron-trpc-experimental/main";
import { appRouter } from "../router";
import { setMainWindow } from "../windowState";
import { setScrapeImpl } from "../postprocess/queue";
import { setupTray, getIsQuitting, markQuitting } from "../tray";
import { log } from "../logger";

function resolveAppIcon(): string | undefined {
  const candidates = [
    join(__dirname, "../../resources/logo.png"),
    join(process.resourcesPath || "", "resources", "logo.png"),
    join(process.resourcesPath || "", "logo.png"),
  ];
  return candidates.find((p) => existsSync(p));
}

// 读取已保存的 closeAction（'ask' | 'tray' | 'quit'），首次为 ask
function getSettingsPath(): string {
  return join(app.getPath("userData"), "settings.json");
}

function readCloseAction(): "ask" | "tray" | "quit" {
  try {
    const file = getSettingsPath();
    if (!existsSync(file)) return "ask";
    const data = JSON.parse(readFileSync(file, "utf8")) as {
      closeAction?: "ask" | "tray" | "quit";
    };
    return data.closeAction ?? "ask";
  } catch {
    return "ask";
  }
}

function writeCloseAction(action: "tray" | "quit"): void {
  try {
    const file = getSettingsPath();
    mkdirSync(join(file, ".."), { recursive: true });
    const prev = existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>)
      : {};
    writeFileSync(
      file,
      JSON.stringify({ ...prev, closeAction: action }, null, 2),
      "utf8",
    );
  } catch (err) {
    log.error("[createMainWindow] writeCloseAction failed", err);
  }
}

export function createMainWindow(): void {
  const appIcon = resolveAppIcon();
  const window = new BrowserWindow({
    width: 1520,
    height: 860,
    minWidth: 1280,
    minHeight: 720,
    show: false,
    frame: false,
    titleBarStyle: "hidden",
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
