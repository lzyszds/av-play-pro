import React, { useEffect, useRef, useState } from "react";
import { trpc } from "../lib/trpc";
import {
  registerScraperRunner,
  registerChallengeRunner,
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
      // 缩小 webview 内部页面比例：弹窗尺寸不变，页面元素缩小后一屏能显示更多列表。
      // 注意 webview 标签自身没有 setZoomFactor，必须经主进程 webContents.setZoomFactor
      void trpc.scrape.setZoomFactor.mutate({ factor: 0.68 }).catch(() => {});

      const seen = new Set<string>();
      const all: ScrapedItem[] = [];

      try {
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
          const pageItems: ScrapedItem[] = [];
          for (const it of items) {
            const key = it.code || it.url;
            if (!key || seen.has(key)) continue;
            seen.add(key);
            all.push(it);
            pageItems.push(it);
          }
          // 增量入库：每页抓到就立刻落盘，手动停止也不丢已抓内容
          if (pageItems.length > 0) {
            void trpc.scrape.save
              .mutate({ items: pageItems, baseUrl, pages: endPage - startPage + 1 })
              .catch(() => {});
          }
          await sleep(600, signal);
        }

        report(`完成，共 ${all.length} 条`);
        return all;
      } catch (error) {
        // 手动停止（Esc / 停止抓取）也返回已抓取的内容，避免白抓
        if (
          error instanceof DOMException &&
          error.name === "AbortError"
        ) {
          report(`已停止，保留已抓 ${all.length} 条`);
          return all;
        }
        throw error;
      } finally {
        void trpc.scrape.setZoomFactor.mutate({ factor: 1 }).catch(() => {});
        stopWebview(ref.current);
        setActive(false);
        setStatus("");
      }
    });

    return () => registerScraperRunner(null);
  }, []);

  // 注册「手动过盾」实现：弹出可见 webview，让用户手动完成 Cloudflare 人机验证。
  // 验证成功后 cf_clearance cookie 落在 persist:missav-web 会话里，
  // 主进程后续的列表/详情 session.fetch 与 m3u8 解析即可直连成功。
  useEffect(() => {
    registerChallengeRunner(async ({ url, onProgress, signal }) => {
      const webview = ref.current;
      if (!webview) throw new Error("抓取 webview 未挂载");

      setActive(true);
      const report = (msg: string) => {
        setStatus(msg);
        onProgress?.(msg);
      };
      // 与抓取一致：走主进程缩放
      void trpc.scrape.setZoomFactor.mutate({ factor: 0.68 }).catch(() => {});

      try {
        report("加载页面，请完成人机验证…（Esc 停止）");
        await new Promise<void>((resolve, reject) => {
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
            reject(new DOMException("过盾已取消", "AbortError"));
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

        // 轮询判定过盾成功：标题不再是 Just a moment 且页面有实际内容
        const deadline = Date.now() + 180_000;
        let passed = false;
        while (Date.now() < deadline) {
          throwIfScrapeAborted(signal);
          let check = "challenge";
          try {
            check = (await webview.executeJavaScript(
              String.raw`(() => {
                try {
                  const t = document.title || '';
                  if (/just a moment|checking your browser|challenges.cloudflare|请稍候|正在验证/i.test(t)) return 'challenge';
                  if (document.querySelector('#challenge-form, #cf-challenge-running, #turnstile-wrapper')) return 'challenge';
                  if (document.body && document.body.innerText.trim().length > 100) return 'ok';
                  return document.documentElement.outerHTML.includes('Just a moment') ? 'challenge' : 'ok';
                } catch (e) { return 'challenge'; }
              })()`,
            )) as string;
          } catch {
            check = "challenge";
          }
          if (check === "ok") {
            passed = true;
            break;
          }
          report("等待你完成人机验证…（点完验证框会自动继续）");
          await sleep(1500, signal);
        }

        report(passed ? "过盾成功！" : "过盾超时/已取消");
        return passed;
      } finally {
        void trpc.scrape.setZoomFactor.mutate({ factor: 1 }).catch(() => {});
        stopWebview(ref.current);
        setActive(false);
        setStatus("");
      }
    });

    return () => registerChallengeRunner(null);
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
