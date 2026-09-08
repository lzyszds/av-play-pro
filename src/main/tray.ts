// 托盘指挥台（B205）
// 把系统托盘从“显示/退出”升级为常驻控制台：快速开页、最近动态、立即云备份、隐私隐藏。

import { Tray, Menu, app, nativeImage, BrowserWindow } from "electron";
import { join } from "path";
import { existsSync } from "fs";
import { log } from "./logger";
import { readActivities } from "./routers/activityRouter";
import { triggerAutoCloudBackup } from "./routers/syncRouter";

let tray: Tray | null = null;
let isQuitting = false;
let refreshTimer: NodeJS.Timeout | null = null;

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

function short(text: string, max = 42): string {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

const PAGE_ENTRIES: Array<{ page: string; label: string }> = [
  { page: "player", label: "播放器" },
  { page: "download", label: "下载" },
  { page: "discover", label: "发现" },
  { page: "web", label: "网页" },
  { page: "news", label: "资讯" },
  { page: "command", label: "指挥中心" },
  { page: "stats", label: "统计" },
];

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

  const sendCommand = (data: { type: string; page?: string }) => {
    if (window.isDestroyed()) return;
    showWindow();
    try {
      window.webContents.send("app:tray-command", data);
    } catch (err) {
      log.warn(`[tray] send command failed: ${err}`);
    }
  };

  const backupNow = async () => {
    try {
      const res: any = await triggerAutoCloudBackup("manual");
      log.info(`[tray] 手动备份完成: ${res?.success ? "成功" : JSON.stringify(res)}`);
    } catch (err) {
      log.warn(`[tray] 手动备份失败: ${err}`);
    }
  };

  const buildRecentSubmenu = () => {
    const items = readActivities().slice(0, 6);
    if (!items.length) {
      return [{ label: "暂无动态", enabled: false }];
    }
    return items.map((rec) => ({
      label: `[${rec.type}] ${short(rec.detail || rec.title)}`,
      enabled: false,
    }));
  };

  const buildMenu = () =>
    Menu.buildFromTemplate([
      {
        label: window.isVisible() ? "隐藏主窗口" : "显示主窗口",
        click: () => (window.isVisible() ? window.hide() : showWindow()),
      },
      { type: "separator" },
      {
        label: "快速打开",
        submenu: PAGE_ENTRIES.map((entry) => ({
          label: entry.label,
          click: () => sendCommand({ type: "navigate", page: entry.page }),
        })),
      },
      { type: "separator" },
      {
        label: "最近动态",
        submenu: buildRecentSubmenu(),
      },
      {
        label: "打开设置",
        click: () => sendCommand({ type: "open-settings" }),
      },
      {
        label: "开关日志控制台",
        click: () => sendCommand({ type: "toggle-console" }),
      },
      { type: "separator" },
      {
        label: "立即备份到云端",
        click: () => {
          void backupNow();
        },
      },
      {
        label: "隐藏窗口（隐私）",
        click: () => {
          if (!window.isDestroyed()) window.hide();
        },
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

  const refresh = () => {
    if (!tray || window.isDestroyed()) return;
    tray.setContextMenu(buildMenu());
  };

  refresh();
  tray.on("double-click", showWindow);
  window.on("show", refresh);
  window.on("hide", refresh);

  // 定期刷新：保持“显示/隐藏”文案与最近动态的新鲜度
  refreshTimer = setInterval(refresh, 20_000);

  log.info("[tray] initialized");
  return tray;
}

export function destroyTray(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  tray?.destroy();
  tray = null;
}
