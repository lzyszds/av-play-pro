import { BrowserWindow, shell } from "electron";
import { join } from "path";
import { existsSync } from "fs";
import { createIPCHandler } from "electron-trpc-experimental/main";
import { appRouter } from "../router";
import { setMainWindow } from "../windowState";

// 解析应用图标路径（dev 在项目根 resources/，打包后随 extraResources 落到 resourcesPath）
function resolveAppIcon(): string | undefined {
  const candidates = [
    join(__dirname, "../../resources/icon.png"),
    join(process.resourcesPath || "", "resources", "icon.png"),
    join(process.resourcesPath || "", "icon.png"),
  ];
  return candidates.find((p) => existsSync(p));
}

export function createMainWindow(): void {
  const appIcon = resolveAppIcon();
  const window = new BrowserWindow({
    width: 1280,
    height: 760,
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

  // 设置主窗口引用给 router
  setMainWindow(window);

  // 创建 tRPC IPC Handler
  createIPCHandler({ router: appRouter, windows: [window] });

  window.on("ready-to-show", () => {
    window?.show();
  });

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  console.log(
    "[主进程] ELECTRON_RENDERER_URL:",
    process.env["ELECTRON_RENDERER_URL"],
  );

  if (process.env["ELECTRON_RENDERER_URL"]) {
    window.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    window.webContents.openDevTools();
  } else {
    window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}
