import React, { useEffect, useRef, useState } from "react";
import { trpc } from "../lib/trpc";
import {
  registerScraperRunner,
  EXTRACT_ITEMS_JS,
  pageUrl,
  type ScrapedItem,
} from "../lib/scraperControl";
import { Loader2 } from "lucide-react";

// 常驻抓取 webview：平时隐藏（用于启动时后台抓取 + 注册给主进程）；
// 「一键抓取」时临时弹出可见，让 Cloudflare 能过盾（必要时用户可直接点验证）。
const SCRAPER_PARTITION = "persist:missav-web";
const BASE_FOR_WARMUP = "https://missav.ai/dm817/cn/uncensored-leak?page=1";
const PER_PAGE_TIMEOUT = 90000; // 每页最多等 90s 过盾/渲染

type ElectronWebview = HTMLElement & {
  getWebContentsId: () => number;
  getURL: () => string;
  loadURL: (url: string) => void;
  executeJavaScript: (code: string) => Promise<unknown>;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function ScraperWebview() {
  const ref = useRef<ElectronWebview | null>(null);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState("");

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
    registerScraperRunner(async ({ baseUrl, startPage, endPage, onProgress }) => {
      const webview = ref.current;
      if (!webview) throw new Error("抓取 webview 未挂载");

      setActive(true); // 弹出可见，保证过盾
      const report = (msg: string) => {
        setStatus(msg);
        onProgress?.(msg);
      };

      try {
        const seen = new Set<string>();
        const all: ScrapedItem[] = [];

        for (let p = startPage; p <= endPage; p++) {
          const url = pageUrl(baseUrl, p);
          report(`第 ${p}/${endPage} 页：加载中…`);

          // 加载并等待 did-stop-loading（带兜底超时）
          await new Promise<void>((resolve) => {
            let done = false;
            const finish = () => {
              if (done) return;
              done = true;
              webview.removeEventListener("did-stop-loading", finish);
              resolve();
            };
            webview.addEventListener("did-stop-loading", finish);
            try {
              webview.loadURL(url);
            } catch {
              finish();
            }
            setTimeout(finish, 15000);
          });

          // 轮询提取，直到出现卡片或超时（期间页面在跑过盾 JS）
          let items: ScrapedItem[] = [];
          const deadline = Date.now() + PER_PAGE_TIMEOUT;
          while (Date.now() < deadline) {
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
            await sleep(1200);
          }

          report(`第 ${p}/${endPage} 页：${items.length} 条`);
          for (const it of items) {
            const key = it.code || it.url;
            if (!key || seen.has(key)) continue;
            seen.add(key);
            all.push(it);
          }
          await sleep(600);
        }

        report(`完成，共 ${all.length} 条`);
        return all;
      } finally {
        setActive(false);
        setStatus("");
      }
    });

    return () => registerScraperRunner(null);
  }, []);

  return (
    <>
      {/* 抓取进行中的顶层遮罩 */}
      {active && (
        <div className="fixed inset-0 z-[80] bg-slate-950/70 backdrop-blur-sm">
          {/* 状态条固定在顶部，避免被下方 webview 遮住 */}
          <div className="absolute top-0 inset-x-0 flex flex-col items-center gap-1 pt-6 pointer-events-none">
            <div className="flex items-center gap-2 text-white text-sm font-semibold">
              <Loader2 className="w-4 h-4 animate-spin" />
              正在抓取 missav（过盾中，请稍候）
            </div>
            <div className="text-xs text-slate-300">{status}</div>
            <div className="text-[11px] text-slate-400">
              如果下方出现人机验证，请直接点击完成；抓取结束会自动关闭。
            </div>
          </div>
        </div>
      )}

      {/* 同一个 webview：抓取时占据大半屏可见并置于遮罩之上；平时隐藏在背景后 */}
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
          src={BASE_FOR_WARMUP}
          partition={SCRAPER_PARTITION}
          style={{ width: "100%", height: "100%" }}
        />
      </div>
    </>
  );
}
