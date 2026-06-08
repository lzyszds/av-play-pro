import { Tray, Menu, app, nativeImage, BrowserWindow } from "electron";
import { join } from "path";
import { existsSync } from "fs";
import { log } from "./logger";

let tray: Tray | null = null;
let isQuitting = false;

export function getIsQuitting(): boolean {
  return isQuitting;
}

export function markQuitting(): void {
  isQuitting = true;
}

function resolveTrayIcon(): string | undefined {
  const candidates = [
    join(__dirname, "../../resources/logo.png"),
    join(process.resourcesPath || "", "resources", "logo.png"),
    join(process.resourcesPath || "", "logo.png"),
  ];
  return candidates.find((p) => existsSync(p));
}

export function setupTray(window: BrowserWindow): Tray | null {
  if (tray) return tray;

  const iconPath = resolveTrayIcon();
  const image = iconPath
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();

  tray = new Tray(image);
  tray.setToolTip("AVPlayPro");

  const showWindow = () => {
    if (window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  };

  const buildMenu = () =>
    Menu.buildFromTemplate([
      {
        label: window.isVisible() ? "隐藏主窗口" : "显示主窗口",
        click: () => (window.isVisible() ? window.hide() : showWindow()),
      },
      { type: "separator" },
      {
        label: "退出 AVPlayPro",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);

  tray.setContextMenu(buildMenu());
  tray.on("double-click", showWindow);
  tray.on("click", showWindow);

  window.on("show", () => tray?.setContextMenu(buildMenu()));
  window.on("hide", () => tray?.setContextMenu(buildMenu()));

  log.info("[tray] initialized");
  return tray;
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
