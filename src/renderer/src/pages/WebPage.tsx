import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bug,
  ClipboardCopy,
  ChevronLeft,
  ChevronRight,
  Download,
  Globe,
  Home,
  RefreshCw,
  ScanSearch,
  ShieldOff,
  X,
} from "lucide-react";
import { PageLoader } from "../components/PageLoader";

const DEFAULT_WEB_URL = "https://missav.ai/dm816/cn/uncensored-leak?page=1";
const WEBVIEW_PARTITION = "persist:missav-web";
const RAW_WEBVIEW_PARTITION = "persist:missav-web-raw";

export interface WebCandidate {
  title: string;
  code: string;
  coverUrl: string;
  previewUrl: string;
  mediaUrl: string;
  description: string;
  actors: string[];
  pageUrl: string;
}

interface WebPageProps {
  onAddSystemLog: (
    text: string,
    level: "INFO" | "WARNING" | "SUCCESS" | "ERROR",
  ) => void;
  onCreateDownload: (candidate: WebCandidate) => void;
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
  executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown>;
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

export function WebPage({ onAddSystemLog, onCreateDownload }: WebPageProps) {
  const webviewRef = useRef<ElectronWebview | null>(null);
  // `src` 只用于 webview 创建/重建时的首跳地址。页面内部跳转（尤其是
  // Cloudflare challenge）只更新地址栏，不能再反写 src，否则会中止正在进行的导航。
  const [sourceUrl, setSourceUrl] = useState(DEFAULT_WEB_URL);
  const [currentUrl, setCurrentUrl] = useState(DEFAULT_WEB_URL);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isRawMode, setIsRawMode] = useState(false);
  const [webviewKey, setWebviewKey] = useState(0);
  const [candidate, setCandidate] = useState<WebCandidate | null>(null);
  const [capturing, setCapturing] = useState(false);

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
    let nextUrl = currentUrl || DEFAULT_WEB_URL;

    try {
      nextUrl = webview?.getURL() || nextUrl;
    } catch {
      // 销毁中的 webview 读取 URL 可能抛错，保留上次稳定地址即可。
    }

    setCurrentUrl(nextUrl);
    setSourceUrl(nextUrl);
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

  const captureCurrentPage = useCallback(async () => {
    const webview = webviewRef.current;
    if (!webview) {
      onAddSystemLog("网页尚未就绪，暂时无法摘取", "WARNING");
      return;
    }

    setCapturing(true);
    try {
      const extracted = (await webview.executeJavaScript(`(() => {
        const absolute = (value) => {
          if (!value) return "";
          try { return new URL(value, location.href).href; } catch { return ""; }
        };
        const meta = (...names) => {
          for (const name of names) {
            const node = document.querySelector('meta[property="' + name + '"], meta[name="' + name + '"]');
            const value = node?.getAttribute("content")?.trim();
            if (value) return value;
          }
          return "";
        };
        const title = meta("og:title", "twitter:title") || document.querySelector("h1")?.textContent?.trim() || document.title || "未命名网页资源";
        const description = meta("og:description", "description", "twitter:description") || "";
        const coverUrl = absolute(meta("og:image", "twitter:image"));
        const urls = Array.from(document.querySelectorAll("video, source, a[href], [data-src], [data-url]"))
          .flatMap((node) => [node.getAttribute("src"), node.getAttribute("href"), node.getAttribute("data-src"), node.getAttribute("data-url")])
          .map(absolute)
          .filter(Boolean);
        const mediaUrl = urls.find((url) => /\\.(m3u8|mp4|webm)(?:[?#]|$)|\\/video(?:[/?#]|$)/i.test(url)) || "";
        const previewUrl = absolute(document.querySelector("video")?.getAttribute("poster")) || mediaUrl;
        const text = [title, document.body?.innerText?.slice(0, 3000) || ""].join(" ");
        const code = text.match(/\\b([A-Z]{2,10}[-_ ]?\\d{2,7})\\b/i)?.[1]?.replace(/[ _]/g, "-").toUpperCase() || "";
        const actors = Array.from(document.querySelectorAll('[rel="tag"], .actor a, [class*="actor"] a, [class*="performer"] a'))
          .map((node) => node.textContent?.trim() || "")
          .filter((value, index, values) => value && values.indexOf(value) === index)
          .slice(0, 12);
        return { title, code, coverUrl, previewUrl, mediaUrl, description, actors, pageUrl: location.href };
      })()`)) as WebCandidate;

      setCandidate(extracted);
      onAddSystemLog(
        extracted.mediaUrl
          ? `已摘取网页资源：${extracted.title}`
          : `已保存网页线索：${extracted.title}（未发现直连媒体）`,
        "SUCCESS",
      );
    } catch (error) {
      onAddSystemLog(
        `网页摘取失败：${error instanceof Error ? error.message : String(error)}`,
        "ERROR",
      );
    } finally {
      setCapturing(false);
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
        label: capturing ? "正在摘取" : "摘取当前网页",
        icon: ScanSearch,
        disabled: capturing || isLoading,
        onClick: () => void captureCurrentPage(),
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
      captureCurrentPage,
      capturing,
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
          src={sourceUrl}
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

      {candidate && (
        <div
          className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-5"
          onClick={(event) => {
            if (event.target === event.currentTarget) setCandidate(null);
          }}
        >
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-amber-400/25 bg-slate-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
              <div>
                <div className="text-sm font-bold text-white">网页摘取候选卡</div>
                <div className="mt-1 text-[11px] text-slate-400">确认信息后再创建下载任务</div>
              </div>
              <button type="button" onClick={() => setCandidate(null)} className="rounded-md p-2 text-slate-400 hover:bg-slate-800 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-5 p-5 sm:grid-cols-[140px_minmax(0,1fr)]">
              <div className="aspect-[2/3] overflow-hidden rounded-xl bg-slate-900">
                {candidate.coverUrl ? <img src={candidate.coverUrl} alt="候选封面" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-xs text-slate-600">未找到封面</div>}
              </div>
              <div className="min-w-0 space-y-3">
                <div>
                  <div className="text-[10px] font-bold tracking-wider text-amber-400">标题</div>
                  <div className="mt-1 break-words text-sm font-semibold text-slate-100">{candidate.title}</div>
                </div>
                {candidate.code && <div className="inline-flex rounded bg-amber-400/10 px-2 py-1 font-mono text-xs text-amber-300">{candidate.code}</div>}
                {candidate.actors.length > 0 && <div className="text-xs text-slate-300">演员：{candidate.actors.join(" · ")}</div>}
                {candidate.description && <p className="line-clamp-3 text-xs leading-5 text-slate-400">{candidate.description}</p>}
                <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
                  <div className="text-[10px] font-bold text-slate-500">媒体链接</div>
                  <div className="mt-1 break-all font-mono text-[10px] text-slate-300">{candidate.mediaUrl || "未从当前页面发现可下载的媒体直链"}</div>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-800 px-5 py-4">
              <button type="button" onClick={() => void navigator.clipboard.writeText(candidate.pageUrl)} className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800">
                <ClipboardCopy className="h-3.5 w-3.5" />复制页面链接
              </button>
              <button type="button" disabled={!candidate.mediaUrl} onClick={() => { onCreateDownload(candidate); setCandidate(null); }} className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-2 text-xs font-bold text-white hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40">
                <Download className="h-3.5 w-3.5" />创建下载任务
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
