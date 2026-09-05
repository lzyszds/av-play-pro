import React, { useEffect, useRef, useState } from "react";
import { trpc } from "../lib/trpc";
import {
  registerScraperRunner,
  EXTRACT_ITEMS_JS,
  pageUrl,
  cancelScrape,
  sleep,
  throwIfScrapeAborted,
  type ScrapedItem,
} from "../lib/scraperControl";
import { Loader2, X } from "lucide-react";

// 常驻抓取 webview：平时隐藏（用于启动时后台抓取 + 注册给主进程）；
// 「一键抓取」时临时弹出可见，让 Cloudflare 能过盾（必要时用户可直接点验证）。
// 注意：不要在挂载时自动打开 missav——会拖一堆 CDN 封面，本地播放也被网络拖慢。
const SCRAPER_PARTITION = "persist:missav-web";
const PER_PAGE_TIMEOUT = 90000; // 每页最多等 90s 过盾/渲染

type ElectronWebview = HTMLElement & {
  getWebContentsId: () => number;
  getURL: () => string;
  loadURL: (url: string) => void;
  stop: () => void;
  executeJavaScript: (code: string) => Promise<unknown>;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

function stopWebview(webview: ElectronWebview | null): void {
  if (!webview) return;
  try {
    webview.stop();
  } catch {
    /* ignore */
  }
  try {
    webview.loadURL("about:blank");
  } catch {
    /* ignore */
  }
}

export function ScraperWebview() {
  const ref = useRef<ElectronWebview | null>(null);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelScrape();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);

  // 注册 webContentsId，供主进程后台抓取用
  useEffect(() => {
    const webview = ref.current;
    if (!webview) return;
    const register = () => {
      try {
        const id = webview.getWebContentsId();
        void trpc.scrape.registerWebview.mutate({ id }).catch(() => {});
      } catch {
        /* dom-ready 时会再触发 */
      }
    };
    webview.addEventListener("dom-ready", register);
    return () => webview.removeEventListener("dom-ready", register);
  }, []);

  // 注册「一键抓取」实现
  useEffect(() => {
    registerScraperRunner(async ({ baseUrl, startPage, endPage, onProgress, signal }) => {
      const webview = ref.current;
      if (!webview) throw new Error("抓取 webview 未挂载");

      setActive(true);
      const report = (msg: string) => {
        setStatus(msg);
        onProgress?.(msg);
      };

      try {
        const seen = new Set<string>();
        const all: ScrapedItem[] = [];

        for (let p = startPage; p <= endPage; p++) {
          throwIfScrapeAborted(signal);
          const url = pageUrl(baseUrl, p);
          report(`第 ${p}/${endPage} 页：加载中…`);

          await new Promise<void>((resolve, reject) => {
            throwIfScrapeAborted(signal);
            let done = false;
            const finish = () => {
              if (done) return;
              done = true;
              webview.removeEventListener("did-stop-loading", finish);
              signal?.removeEventListener("abort", onAbort);
              resolve();
            };
            const onAbort = () => {
              stopWebview(webview);
              if (done) return;
              done = true;
              webview.removeEventListener("did-stop-loading", finish);
              signal?.removeEventListener("abort", onAbort);
              reject(new DOMException("抓取已取消", "AbortError"));
            };
            signal?.addEventListener("abort", onAbort);
            webview.addEventListener("did-stop-loading", finish);
            try {
              webview.loadURL(url);
            } catch {
              finish();
            }
            setTimeout(finish, 15000);
          });

          let items: ScrapedItem[] = [];
          const deadline = Date.now() + PER_PAGE_TIMEOUT;
          while (Date.now() < deadline) {
            throwIfScrapeAborted(signal);
            let raw = "[]";
            try {
              raw = (await webview.executeJavaScript(EXTRACT_ITEMS_JS)) as string;
            } catch {
              raw = "[]";
            }
            try {
              items = JSON.parse(raw) as ScrapedItem[];
            } catch {
              items = [];
            }
            if (items.length > 0) break;
            report(`第 ${p}/${endPage} 页：过盾中…（如出现人机验证请直接点击）`);
            await sleep(1200, signal);
          }

          report(`第 ${p}/${endPage} 页：${items.length} 条`);
          for (const it of items) {
            const key = it.code || it.url;
            if (!key || seen.has(key)) continue;
            seen.add(key);
            all.push(it);
          }
          await sleep(600, signal);
        }

        report(`完成，共 ${all.length} 条`);
        return all;
      } finally {
        stopWebview(ref.current);
        setActive(false);
        setStatus("");
      }
    });

    return () => registerScraperRunner(null);
  }, []);

  return (
    <>
      {active && (
        <div className="fixed inset-0 z-[80] pointer-events-none">
          <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" />
          <div className="absolute top-0 inset-x-0 z-[82] flex flex-col items-center gap-2 pt-5 pointer-events-auto">
            <div className="flex w-full max-w-3xl items-start justify-between gap-3 px-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-white text-sm font-semibold">
                  <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                  正在抓取 missav（过盾中，请稍候）
                </div>
                <div className="mt-1 text-xs text-slate-300">{status}</div>
                <div className="mt-1 text-[11px] text-slate-400">
                  下方可完成人机验证；可随时停止抓取（Esc）
                </div>
              </div>
              <button
                type="button"
                onClick={() => cancelScrape()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/25 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
                停止抓取
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        aria-hidden={!active}
        style={
          active
            ? {
                position: "fixed",
                left: "50%",
                top: "52%",
                transform: "translate(-50%, -50%)",
                width: "min(1000px, 90vw)",
                height: "min(680px, 70vh)",
                zIndex: 81,
                borderRadius: 12,
                overflow: "hidden",
                boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
              }
            : {
                position: "fixed",
                left: 0,
                top: 0,
                width: 1024,
                height: 768,
                pointerEvents: "none",
                opacity: 0,
                zIndex: -1,
              }
        }
      >
        <webview
          ref={(el) => {
            ref.current = el as unknown as ElectronWebview | null;
          }}
          src="about:blank"
          partition={SCRAPER_PARTITION}
          style={{ width: "100%", height: "100%" }}
        />
      </div>
    </>
  );
};
