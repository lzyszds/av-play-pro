import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bug,
  ChevronLeft,
  ChevronRight,
  Globe,
  Home,
  RefreshCw,
  ShieldOff,
} from "lucide-react";
import { PageLoader } from "../components/PageLoader";

const DEFAULT_WEB_URL = "https://missav.ai/dm816/cn/uncensored-leak?page=1";
const WEBVIEW_PARTITION = "persist:missav-web";
const RAW_WEBVIEW_PARTITION = "persist:missav-web-raw";

interface WebPageProps {
  onAddSystemLog: (
    text: string,
    level: "INFO" | "WARNING" | "SUCCESS" | "ERROR",
  ) => void;
}

type ElectronWebview = HTMLElement & {
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  loadURL: (url: string) => void;
  getURL: () => string;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  openDevTools: () => void;
};

type WebviewEvent = Event & {
  url?: string;
  errorCode?: number;
  errorDescription?: string;
  isMainFrame?: boolean;
  title?: string;
  level?: number;
  message?: string;
  sourceId?: string;
  line?: number;
  reason?: string;
  exitCode?: number;
};

export function WebPage({ onAddSystemLog }: WebPageProps) {
  const webviewRef = useRef<ElectronWebview | null>(null);
  const [currentUrl, setCurrentUrl] = useState(DEFAULT_WEB_URL);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isRawMode, setIsRawMode] = useState(false);
  const [webviewKey, setWebviewKey] = useState(0);

  const syncNavState = useCallback(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    try {
      setCanGoBack(webview.canGoBack());
      setCanGoForward(webview.canGoForward());
      setCurrentUrl(webview.getURL() || DEFAULT_WEB_URL);
    } catch {}
  }, []);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const handleStart = () => {
      setLoadError(null);
      setIsLoading(true);
    };
    const handleStop = () => {
      setIsLoading(false);
      syncNavState();
    };
    const handleNavigate = (event: Event) => {
      const url = (event as WebviewEvent).url;
      if (url) setCurrentUrl(url);
      syncNavState();
    };
    const handleTitle = (event: Event) => {
      const title = (event as WebviewEvent).title;
      if (title) onAddSystemLog(`网页标题已更新: ${title}`, "INFO");
    };
    const handleFailLoad = (event: Event) => {
      const { errorCode, errorDescription, isMainFrame, url } =
        event as WebviewEvent;

      if (errorCode === -3) return;

      const message = `${errorDescription || "Unknown load error"} (${errorCode ?? "n/a"})`;
      if (isMainFrame) {
        setIsLoading(false);
        setLoadError(message);
      }
      onAddSystemLog(
        `Webview load failed: ${message}${url ? ` - ${url}` : ""}`,
        "ERROR",
      );
    };
    const handleConsole = (event: Event) => {
      const { level, message, sourceId, line } = event as WebviewEvent;
      if ((level ?? 0) < 2 || !message) return;

      const source = sourceId ? ` (${sourceId}${line ? `:${line}` : ""})` : "";
      onAddSystemLog(
        `Webview console: ${message}${source}`,
        level === 2 ? "WARNING" : "ERROR",
      );
    };
    const handleProcessGone = (event: Event) => {
      const { reason, exitCode } = event as WebviewEvent;
      setIsLoading(false);
      setLoadError(
        `Renderer process gone: ${reason || "unknown"} (${exitCode ?? "n/a"})`,
      );
      onAddSystemLog(
        `Webview renderer gone: ${reason || "unknown"} (${exitCode ?? "n/a"})`,
        "ERROR",
      );
    };

    webview.addEventListener("did-start-loading", handleStart);
    webview.addEventListener("did-stop-loading", handleStop);
    webview.addEventListener("did-navigate", handleNavigate);
    webview.addEventListener("did-navigate-in-page", handleNavigate);
    webview.addEventListener("page-title-updated", handleTitle);
    webview.addEventListener("did-fail-load", handleFailLoad);
    webview.addEventListener("console-message", handleConsole);
    webview.addEventListener("render-process-gone", handleProcessGone);

    syncNavState();
    onAddSystemLog("第三方网页已打开", "INFO");

    return () => {
      webview.removeEventListener("did-start-loading", handleStart);
      webview.removeEventListener("did-stop-loading", handleStop);
      webview.removeEventListener("did-navigate", handleNavigate);
      webview.removeEventListener("did-navigate-in-page", handleNavigate);
      webview.removeEventListener("page-title-updated", handleTitle);
      webview.removeEventListener("did-fail-load", handleFailLoad);
      webview.removeEventListener("console-message", handleConsole);
      webview.removeEventListener("render-process-gone", handleProcessGone);
    };
  }, [isRawMode, onAddSystemLog, syncNavState, webviewKey]);

  const goHome = useCallback(() => {
    webviewRef.current?.loadURL(DEFAULT_WEB_URL);
  }, []);

  const toggleRawMode = useCallback(() => {
    const webview = webviewRef.current;
    const nextRawMode = !isRawMode;

    try {
      setCurrentUrl(webview?.getURL() || currentUrl || DEFAULT_WEB_URL);
    } catch {
      setCurrentUrl(currentUrl || DEFAULT_WEB_URL);
    }

    setLoadError(null);
    setIsLoading(true);
    setCanGoBack(false);
    setCanGoForward(false);
    setIsRawMode(nextRawMode);
    setWebviewKey((key) => key + 1);
    onAddSystemLog(
      nextRawMode
        ? "Raw webview mode enabled"
        : "Managed webview mode enabled",
      "INFO",
    );
  }, [currentUrl, isRawMode, onAddSystemLog]);

  const openWebviewDevTools = useCallback(() => {
    const webview = webviewRef.current;
    if (!webview) {
      onAddSystemLog("Webview is not ready yet", "WARNING");
      return;
    }

    try {
      webview.openDevTools();
      onAddSystemLog("Webview DevTools opened", "INFO");
    } catch (error) {
      onAddSystemLog(
        `Failed to open Webview DevTools: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "ERROR",
      );
    }
  }, [onAddSystemLog]);

  const controls = useMemo(
    () => [
      {
        label: "返回",
        icon: ChevronLeft,
        disabled: !canGoBack,
        onClick: () => webviewRef.current?.goBack(),
      },
      {
        label: "前进",
        icon: ChevronRight,
        disabled: !canGoForward,
        onClick: () => webviewRef.current?.goForward(),
      },
      {
        label: "刷新",
        icon: RefreshCw,
        disabled: false,
        onClick: () => webviewRef.current?.reload(),
      },
      {
        label: "首页",
        icon: Home,
        disabled: false,
        onClick: goHome,
      },
      {
        label: "Webview DevTools",
        icon: Bug,
        disabled: false,
        onClick: openWebviewDevTools,
      },
      {
        label: isRawMode ? "Managed mode" : "Raw mode",
        icon: ShieldOff,
        disabled: false,
        onClick: toggleRawMode,
      },
    ],
    [
      canGoBack,
      canGoForward,
      goHome,
      isRawMode,
      openWebviewDevTools,
      toggleRawMode,
    ],
  );

  return (
    <div className="relative h-full flex flex-col bg-[#0b0f14] text-slate-200">
      <PageLoader active={isLoading} label="加载页面" />
      <div className="h-11 shrink-0 border-b border-slate-800/80 bg-slate-950/80 flex items-center px-3 gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="w-7 h-7 rounded-md bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
            <Globe className="w-4 h-4 text-amber-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-bold text-slate-100 truncate">
              MissAV
            </div>
            <div className="text-[10px] text-slate-400 truncate font-mono select-text">
              {currentUrl}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {controls.map(({ label, icon: Icon, disabled, onClick }) => (
            <button
              key={label}
              type="button"
              title={label}
              disabled={disabled}
              onClick={onClick}
              className="w-8 h-8 rounded-md flex items-center justify-center border border-slate-800 bg-slate-900 text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              <Icon className="w-3.5 h-3.5" />
            </button>
          ))}
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        <webview
          key={webviewKey}
          ref={(element) => {
            webviewRef.current = element as unknown as ElectronWebview | null;
          }}
          src={currentUrl || DEFAULT_WEB_URL}
          partition={isRawMode ? RAW_WEBVIEW_PARTITION : WEBVIEW_PARTITION}
          className="absolute inset-0 w-full h-full bg-black"
        />
        {isLoading && (
          <div className="absolute top-3 right-3 z-10 rounded-md bg-slate-950/80 border border-slate-700 px-3 py-1.5 text-[10px] text-slate-200 flex items-center gap-2 shadow-lg">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            页面载入中
          </div>
        )}
        {loadError && (
          <div className="absolute left-1/2 top-1/2 z-10 w-[min(520px,calc(100%-32px))] -translate-x-1/2 -translate-y-1/2 rounded-md border border-red-500/40 bg-slate-950/90 p-4 text-sm text-slate-100 shadow-2xl">
            <div className="mb-1 font-semibold text-red-300">
              Webview load failed
            </div>
            <div className="break-words text-xs text-slate-300">
              {loadError}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
