import { BrowserWindow, app } from "electron";
import { join } from "path";
import { t } from "../trpc";
import { getMainWindow, setDownloadWidgetWindow, getDownloadWidgetWindow } from "../windowState";
import { screen } from "electron";

let libraryWidgetWindow: BrowserWindow | null = null;

const DOWNLOAD_WIDGET_COLLAPSED = { width: 96, height: 96 };
const DOWNLOAD_WIDGET_EXPANDED = { width: 340, height: 220 };

function loadRendererWindow(window: BrowserWindow, query: string): void {
  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devUrl) {
    const separator = devUrl.includes("?") ? "&" : "?";
    window.loadURL(`${devUrl}${separator}${query}`);
  } else {
    window.loadFile(join(__dirname, "../renderer/index.html"), {
      query: Object.fromEntries(new URLSearchParams(query)),
    });
  }
}

const mainWindowProxy = {
  minimize: () => getMainWindow()?.minimize(),
  isMaximized: () => getMainWindow()?.isMaximized(),
  unmaximize: () => getMainWindow()?.unmaximize(),
  maximize: () => getMainWindow()?.maximize(),
  focus: () => {
    const window = getMainWindow();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  },
  close: () => getMainWindow()?.close(),
};

export const windowRouter = t.router({
    minimize: t.procedure.mutation(() => {
      mainWindowProxy.minimize();
      return { success: true };
    }),
    maximize: t.procedure.mutation(() => {
      if (mainWindowProxy.isMaximized()) {
        mainWindowProxy.unmaximize();
      } else {
        mainWindowProxy.maximize();
      }
      return { success: true };
    }),
    close: t.procedure.mutation(() => {
      mainWindowProxy.close();
      return { success: true };
    }),
    focus: t.procedure.mutation(() => {
      mainWindowProxy.focus();
      return { success: true };
    }),
    setPipMode: t.procedure
      .input((input: unknown) => input as { enabled: boolean; width?: number; height?: number })
      .mutation(({ input }) => {
        const window = getMainWindow();
        if (!window) return { success: false };
        if (input.enabled) {
          window.setAlwaysOnTop(true, "floating");
          window.setAspectRatio((input.width || 16) / (input.height || 9));
          window.setMinimumSize(320, 180);
          if (input.width && input.height) {
            window.setSize(input.width, input.height);
          }
        } else {
          window.setAlwaysOnTop(false);
          window.setAspectRatio(0);
          window.setMinimumSize(800, 600);
        }
        return { success: true };
      }),
    openLibraryWidget: t.procedure
      .input((input: unknown) => input as { rootPath: string })
      .mutation(({ input }) => {
        if (libraryWidgetWindow && !libraryWidgetWindow.isDestroyed()) {
          libraryWidgetWindow.show();
          libraryWidgetWindow.focus();
          return { success: true };
        }

        libraryWidgetWindow = new BrowserWindow({
          width: 300,
          height: 210,
          minWidth: 260,
          minHeight: 180,
          frame: false,
          resizable: true,
          alwaysOnTop: true,
          skipTaskbar: true,
          show: false,
          title: "片库小组件",
          webPreferences: {
            preload: join(__dirname, "../preload/index.js"),
            sandbox: false,
            contextIsolation: true,
            nodeIntegration: false,
          },
        });

        libraryWidgetWindow.once("ready-to-show", () => {
          libraryWidgetWindow?.show();
        });
        libraryWidgetWindow.on("closed", () => {
          libraryWidgetWindow = null;
        });

        const params = new URLSearchParams({
          widget: "library",
          rootPath: input.rootPath || "",
        });
        loadRendererWindow(libraryWidgetWindow, params.toString());
        return { success: true };
      }),
    closeLibraryWidget: t.procedure.mutation(() => {
      libraryWidgetWindow?.close();
      libraryWidgetWindow = null;
      return { success: true };
    }),
    /* ============ 下载桌面小组件（圆形悬浮球） ============ */
    openDownloadWidget: t.procedure.mutation(() => {
      const existing = getDownloadWidgetWindow();
      if (existing && !existing.isDestroyed()) {
        existing.show();
        return { success: true };
      }

      // 放在主屏右下角
      const display = screen.getPrimaryDisplay();
      const { workArea } = display;
      const x = workArea.x + workArea.width - DOWNLOAD_WIDGET_COLLAPSED.width - 24;
      const y = workArea.y + workArea.height - DOWNLOAD_WIDGET_COLLAPSED.height - 24;

      const win = new BrowserWindow({
        width: DOWNLOAD_WIDGET_COLLAPSED.width,
        height: DOWNLOAD_WIDGET_COLLAPSED.height,
        x,
        y,
        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
        resizable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,
        show: false,
        title: "下载小组件",
        webPreferences: {
          preload: join(__dirname, "../preload/index.js"),
          sandbox: false,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      win.setAlwaysOnTop(true, "floating");

      setDownloadWidgetWindow(win);

      win.once("ready-to-show", () => win.show());
      win.on("closed", () => setDownloadWidgetWindow(null));

      loadRendererWindow(win, "widget=download");
      return { success: true };
    }),
    closeDownloadWidget: t.procedure.mutation(() => {
      const win = getDownloadWidgetWindow();
      if (win && !win.isDestroyed()) win.close();
      setDownloadWidgetWindow(null);
      return { success: true };
    }),
    setDownloadWidgetExpanded: t.procedure
      .input((input: unknown) => input as { expanded: boolean })
      .mutation(({ input }) => {
        const win = getDownloadWidgetWindow();
        if (!win || win.isDestroyed()) return { success: false };
        const target = input.expanded
          ? DOWNLOAD_WIDGET_EXPANDED
          : DOWNLOAD_WIDGET_COLLAPSED;
        const [curW, curH] = win.getSize();
        const [curX, curY] = win.getPosition();
        // 保持右下角对齐
        const newX = curX + (curW - target.width);
        const newY = curY + (curH - target.height);
        win.setBounds(
          { x: newX, y: newY, width: target.width, height: target.height },
          true,
        );
        return { success: true };
      }),
    isDownloadWidgetOpen: t.procedure.query(() => {
      const win = getDownloadWidgetWindow();
      return { open: !!(win && !win.isDestroyed() && win.isVisible()) };
    }),
  });
