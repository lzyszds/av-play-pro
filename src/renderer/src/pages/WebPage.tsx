import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Globe, Home, RefreshCw } from "lucide-react";

const DEFAULT_WEB_URL = "https://missav.ai/dm816/cn/uncensored-leak";
const WEBVIEW_PARTITION = "persist:missav-web";

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
};

export function WebPage({ onAddSystemLog }: WebPageProps) {
  const webviewRef = useRef<ElectronWebview | null>(null);
  const [currentUrl, setCurrentUrl] = useState(DEFAULT_WEB_URL);
  const [isLoading, setIsLoading] = useState(true);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

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

    const handleStart = () => setIsLoading(true);
    const handleStop = () => {
      setIsLoading(false);
      syncNavState();
    };
    const handleNavigate = (event: Event) => {
      const url = (event as Event & { url?: string }).url;
      if (url) setCurrentUrl(url);
      syncNavState();
    };
    const handleTitle = (event: Event) => {
      const title = (event as Event & { title?: string }).title;
      if (title) onAddSystemLog(`网页标题已更新: ${title}`, "INFO");
    };

    webview.addEventListener("did-start-loading", handleStart);
    webview.addEventListener("did-stop-loading", handleStop);
    webview.addEventListener("did-navigate", handleNavigate);
    webview.addEventListener("did-navigate-in-page", handleNavigate);
    webview.addEventListener("page-title-updated", handleTitle);

    syncNavState();
    onAddSystemLog("第三方网页已打开", "INFO");

    return () => {
      webview.removeEventListener("did-start-loading", handleStart);
      webview.removeEventListener("did-stop-loading", handleStop);
      webview.removeEventListener("did-navigate", handleNavigate);
      webview.removeEventListener("did-navigate-in-page", handleNavigate);
      webview.removeEventListener("page-title-updated", handleTitle);
    };
  }, [onAddSystemLog, syncNavState]);

  const goHome = useCallback(() => {
    webviewRef.current?.loadURL(DEFAULT_WEB_URL);
  }, []);

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
    ],
    [canGoBack, canGoForward, goHome],
  );

  return (
    <div className="h-full flex flex-col bg-[#0b0f14] text-slate-200">
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
          ref={(element) => {
            webviewRef.current = element as unknown as ElectronWebview | null;
          }}
          src={DEFAULT_WEB_URL}
          partition={WEBVIEW_PARTITION}
          allowpopups={false}
          className="absolute inset-0 w-full h-full bg-black"
        />
        {isLoading && (
          <div className="absolute top-3 right-3 z-10 rounded-md bg-slate-950/80 border border-slate-700 px-3 py-1.5 text-[10px] text-slate-200 flex items-center gap-2 shadow-lg">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            页面载入中
          </div>
        )}
      </div>
    </div>
  );
}
