import axios from "axios";
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import { app, session, webContents } from "electron";
import type { WebContents } from "electron";
import { t } from "../trpc";
import { log } from "../logger";
import {
  getActiveMissavWebContents,
  MISSAV_WEB_PARTITION,
} from "../webview/missavWebSession";

/** 默认抓取配置 */
export const DEFAULT_SCRAPE_BASE_URL =
  "https://missav.ai/dm817/cn/uncensored-leak?page={page}";
const DEFAULT_START_PAGE = 1;
const DEFAULT_END_PAGE = 3;
const DEFAULT_AUTO_ON_STARTUP = false;

export interface ScrapedItem {
  code: string | null;
  title: string;
  url: string;
  cover: string | null;
  preview: string | null;
  duration: string | null;
}

export interface ScrapeConfig {
  baseUrl: string;
  startPage: number;
  endPage: number;
  /** 启动时是否自动抓取一次 */
  autoOnStartup: boolean;
}

export interface ScrapeStore {
  updatedAt: number;
  baseUrl: string;
  pages: number;
  items: ScrapedItem[];
}

function storeFile(): string {
  return path.join(app.getPath("userData"), "missav-scrape.json");
}

function configFile(): string {
  return path.join(app.getPath("userData"), "missav-scrape-config.json");
}

export function readScrapeConfig(): ScrapeConfig {
  const defaults: ScrapeConfig = {
    baseUrl: DEFAULT_SCRAPE_BASE_URL,
    startPage: DEFAULT_START_PAGE,
    endPage: DEFAULT_END_PAGE,
    autoOnStartup: DEFAULT_AUTO_ON_STARTUP,
  };
  try {
    const file = configFile();
    if (fs.existsSync(file)) {
      const saved = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<ScrapeConfig>;
      return { ...defaults, ...saved };
    }
  } catch (error) {
    log.warn(`[scrape] 读取配置失败: ${(error as Error)?.message}`);
  }
  return defaults;
}

function writeScrapeConfig(config: ScrapeConfig): void {
  try {
    fs.writeFileSync(configFile(), JSON.stringify(config, null, 2), "utf8");
  } catch (error) {
    log.warn(`[scrape] 写入配置失败: ${(error as Error)?.message}`);
  }
}

/** 渲染端抓好的 items 直接落库（一键抓取走这个），返回最终缓存。
 *  策略：与旧缓存合并（按 code/url 去重），新内容追加，不覆盖已有内容。 */
export function saveScrapedItems(
  items: ScrapedItem[],
  meta: { baseUrl: string; pages: number },
): ScrapeStore {
  const oldStore = readScrapeStore();
  const seen = new Map<string, ScrapedItem>();

  // 先放入旧缓存，保留已有内容
  for (const it of oldStore.items) {
    if (!it || !it.url) continue;
    seen.set(it.code || it.url, it);
  }

  // 再追加新抓取的（同 key 跳过，不覆盖旧的）
  let addedCount = 0;
  for (const it of items) {
    if (!it || !it.url) continue;
    const key = it.code || it.url;
    if (!seen.has(key)) {
      seen.set(key, it);
      addedCount++;
    }
  }

  const deduped = Array.from(seen.values());

  if (deduped.length === 0) {
    log.warn("[scrape] 渲染端抓取 0 条，保留旧缓存");
    return oldStore;
  }

  const store: ScrapeStore = {
    updatedAt: Date.now(),
    baseUrl: meta.baseUrl,
    pages: meta.pages,
    items: deduped,
  };
  writeScrapeStore(store);
  log.info(`[scrape] 渲染端已缓存 ${deduped.length} 条（本次新增 ${addedCount} 条）`);
  return store;
}

export function readScrapeStore(): ScrapeStore {
  try {
    const file = storeFile();
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf8")) as ScrapeStore;
    }
  } catch (error) {
    log.warn(`[scrape] 读取缓存失败: ${(error as Error)?.message}`);
  }
  return { updatedAt: 0, baseUrl: "", pages: 0, items: [] };
}

function writeScrapeStore(store: ScrapeStore): void {
  try {
    fs.writeFileSync(storeFile(), JSON.stringify(store, null, 2), "utf8");
  } catch (error) {
    log.warn(`[scrape] 写入缓存失败: ${(error as Error)?.message}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 优先复用已过 Cloudflare 的 missav webview 抓取 HTML，
 * 拿不到再退回 electron 会话 / axios。逻辑与 rssRouter 保持一致。
 */
// 渲染进程注册的「专用抓取 webview」的 webContents id。
// 它是渲染进程里常驻的隐藏 <webview>，与「网页」页 webview 完全一致，能过 Cloudflare。
let scraperContentsId: number | null = null;

export function registerScraperWebview(id: number): void {
  scraperContentsId = id;
  log.info(`[scrape] 已注册抓取 webview: id=${id}`);
}

/** 拿到可用于抓取的 webContents：优先专用抓取 webview，其次用户打开的 missav 页面 */
function getScrapeContents(): WebContents | null {
  if (scraperContentsId != null) {
    const wc = webContents.fromId(scraperContentsId);
    if (wc && !wc.isDestroyed()) return wc;
    scraperContentsId = null;
  }
  return getActiveMissavWebContents();
}

// 在真实渲染的页面 DOM 里直接提取列表（等价于 scrape_missav.js 的 extractInPage）。
// 用 String.raw 保留正则里的反斜杠。过盾后 missav 会渲染出 .thumbnail.group 卡片。
const EXTRACT_ITEMS_JS = String.raw`(() => {
  try {
    const items = [];
    document.querySelectorAll('.thumbnail.group').forEach((el) => {
      const link = el.querySelector('a[href*="/cn/"]') || el.querySelector('a[href]');
      const url = link ? link.href : null;
      if (!url) return;
      const img = el.querySelector('img[data-src*="cover"], img[src*="cover"]');
      const cover = img ? (img.getAttribute('data-src') || img.getAttribute('src')) : null;
      const video = el.querySelector('video[id^="preview"], video[data-src], video[src], video');
      let preview = null;
      if (video) {
        preview = video.getAttribute('data-src') || video.getAttribute('src');
        if (!preview) {
          const s = video.querySelector('source');
          if (s) preview = s.getAttribute('src') || s.getAttribute('data-src');
        }
      }
      if (!preview && cover) preview = cover.replace(/cover-[a-z]+\.jpg.*$/i, 'preview.mp4');
      const titleEl = el.querySelector('a.text-secondary, a[class*="text-secondary"]');
      let duration = null;
      el.querySelectorAll('span').forEach((s) => {
        const t = (s.textContent || '').trim();
        if (!duration && /^\d+:\d+/.test(t)) duration = t;
      });
      items.push({
        code: url.replace(/\/+$/, '').split('/').pop() || null,
        title: titleEl ? titleEl.textContent.trim() : '',
        url,
        cover,
        preview,
        duration,
      });
    });
    return JSON.stringify(items);
  } catch (e) { return '[]'; }
})()`;

const DIAG_JS = String.raw`(() => {
  const html = document.documentElement ? document.documentElement.outerHTML : '';
  return JSON.stringify({
    len: html.length,
    title: (document.title || '').slice(0, 60),
    cards: document.querySelectorAll('.thumbnail.group').length,
    hasCover: /cover-[tn]\.jpg/.test(html),
    challenge: /just a moment|checking your browser|challenge-running|请稍候|正在验证|稍候/i.test(html) || /请稍候|moment/i.test(document.title),
  });
})()`;

/** 在 webContents 的真实 DOM 里轮询提取列表，直到出现卡片。像 zendriver 一样等页面自己过盾。 */
async function extractViaWebContents(
  contents: WebContents,
  url: string,
  timeout = 45000,
): Promise<ScrapedItem[] | null> {
  try {
    if (contents.getURL().split("#")[0] !== url.split("#")[0]) {
      await contents.loadURL(url).catch(() => {});
    }

    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (contents.isDestroyed()) return null;

      const raw = (await contents
        .executeJavaScript(EXTRACT_ITEMS_JS, true)
        .catch(() => "[]")) as string;

      let items: ScrapedItem[] = [];
      try {
        items = JSON.parse(raw) as ScrapedItem[];
      } catch {
        items = [];
      }
      if (items.length > 0) return items;

      await sleep(1000);
    }

    // 超时：打印诊断，看页面到底卡在哪
    const diag = (await contents
      .executeJavaScript(DIAG_JS, true)
      .catch(() => "?")) as string;
    log.warn(`[scrape] webview 渲染超时 (${url}) 诊断=${diag}`);
  } catch (error: any) {
    log.warn(`[scrape] webview 提取失败 (${url}): ${error?.message}`);
  }

  return null;
}

async function extractFromWebview(url: string): Promise<ScrapedItem[] | null> {
  if (!/https:\/\/missav\./i.test(url)) return null;
  const contents = getScrapeContents();
  if (!contents) {
    log.warn("[scrape] 未找到抓取 webview（渲染进程未注册）");
    return null;
  }
  return extractViaWebContents(contents, url);
}

/** 兜底：webview 拿不到时，用会话（复用 cf_clearance cookie）取 HTML 交给 cheerio 解析 */
async function fetchHtmlFallback(url: string): Promise<string> {
  // 关键：不覆盖 User-Agent。cf_clearance cookie 与获取它时的 UA 绑定，
  // 用 webview 默认 UA（session 自带）才能带着已有 cookie 直接过盾。
  const headers = {
    Accept: "text/html,application/xhtml+xml,*/*",
    Referer: new URL(url).origin + "/",
  };

  try {
    const webSession = session.fromPartition(MISSAV_WEB_PARTITION);
    const response = await webSession.fetch(url, { headers });
    const html = await response.text();
    log.info(
      `[scrape] session.fetch ${response.status} len=${html.length} hasCards=${html.includes("thumbnail group")} (${url})`,
    );
    if (
      response.status >= 200 &&
      response.status < 300 &&
      html.includes("thumbnail group")
    ) {
      return html;
    }
  } catch (error) {
    log.warn(`[scrape] session fetch failed: ${(error as Error)?.message}`);
  }

  // 不再用隐藏窗口重复加载同一 URL——那只会加重 Cloudflare 风控。
  return "";
}

/** 抓取单页：优先在 webview 真实 DOM 里提取，失败再用 HTML 兜底 + cheerio 解析 */
async function scrapePage(url: string): Promise<ScrapedItem[]> {
  const viaWebview = await extractFromWebview(url);
  if (viaWebview && viaWebview.length > 0) return viaWebview;

  const html = await fetchHtmlFallback(url);
  if (html) return parseListPage(html);

  return [];
}

/** 复刻 scrape_missav.js 里的 extractInPage，用 cheerio 在 Node 侧解析列表页 */
function parseListPage(html: string): ScrapedItem[] {
  const $ = cheerio.load(html);
  const items: ScrapedItem[] = [];

  $(".thumbnail.group").each((_, el) => {
    const $el = $(el);
    const link = $el.find('a[href*="/cn/"]').first();
    const url = link.attr("href") || "";
    if (!url) return;

    const img = $el
      .find('img[data-src*="cover"], img[src*="cover"]')
      .first();
    const cover = img.attr("data-src") || img.attr("src") || null;

    const video = $el
      .find('video[id^="preview"], video[data-src], video[src], video')
      .first();
    let preview: string | null =
      video.attr("data-src") ||
      video.attr("src") ||
      video.find("source").first().attr("src") ||
      video.find("source").first().attr("data-src") ||
      null;
    if (!preview && cover) {
      preview = cover.replace(/cover-[a-z]+\.jpg.*$/i, "preview.mp4");
    }

    const titleEl = $el
      .find("a.text-secondary, a.group-hover\\:text-primary")
      .first();

    let duration: string | null = null;
    $el.find("span").each((_i, s) => {
      const text = $(s).text().trim();
      if (!duration && /^\d+:\d+/.test(text)) duration = text;
    });

    items.push({
      code: url.replace(/\/+$/, "").split("/").pop() || null,
      title: titleEl.text().trim(),
      url,
      cover,
      preview,
      duration,
    });
  });

  return items;
}

/**
 * 抓取 missav 列表页。baseUrl 用 {page} 占位，例如：
 * https://missav.ai/dm817/cn/uncensored-leak?page={page}
 */
export async function scrapeList(opts: {
  baseUrl: string;
  startPage?: number;
  endPage?: number;
}): Promise<{ items: ScrapedItem[]; pages: number; error: string | null }> {
  const baseUrl = opts.baseUrl?.trim();
  if (!baseUrl) return { items: [], pages: 0, error: "baseUrl 不能为空" };

  const startPage = Math.max(1, opts.startPage ?? 1);
  const endPage = Math.max(startPage, opts.endPage ?? startPage);

  const seen = new Set<string>();
  const all: ScrapedItem[] = [];
  let scannedPages = 0;
  let lastError: string | null = null;

  for (let p = startPage; p <= endPage; p++) {
    const url = baseUrl.includes("{page}")
      ? baseUrl.replace("{page}", String(p))
      : baseUrl.replace(/([?&]page=)\d+/, `$1${p}`);

    try {
      const items = await scrapePage(url);
      scannedPages++;
      if (items.length === 0) {
        lastError = `第 ${p} 页无数据（可能未过盾）`;
        log.warn(`[scrape] ${lastError} (${url})`);
        continue;
      }

      log.info(`[scrape] 第 ${p} 页 -> ${items.length} 条 (${url})`);
      for (const it of items) {
        const key = it.code || it.url;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(it);
      }
    } catch (error: any) {
      lastError = error?.message || String(error);
      log.warn(`[scrape] 第 ${p} 页失败: ${lastError}`);
    }

    await sleep(800);
  }

  return { items: all, pages: scannedPages, error: all.length === 0 ? lastError : null };
}

let startupScrapeRan = false;

/**
 * 抓取并写入缓存。返回最终缓存内容。
 * 策略：与旧缓存合并（按 code/url 去重），新内容追加，不覆盖已有内容。
 * 抓取失败（0 条）时保留旧缓存，避免清空。
 */
export async function scrapeAndStore(opts?: {
  baseUrl?: string;
  startPage?: number;
  endPage?: number;
}): Promise<ScrapeStore> {
  const cfg = readScrapeConfig();
  const baseUrl = opts?.baseUrl?.trim() || cfg.baseUrl || DEFAULT_SCRAPE_BASE_URL;
  const result = await scrapeList({
    baseUrl,
    startPage: opts?.startPage ?? cfg.startPage,
    endPage: opts?.endPage ?? cfg.endPage,
  });

  if (result.items.length === 0) {
    log.warn(`[scrape] 抓取 0 条，保留旧缓存 (${result.error ?? "无错误"})`);
    return readScrapeStore();
  }

  // 合并到旧缓存：已有内容保留，新内容追加
  const oldStore = readScrapeStore();
  const seen = new Map<string, ScrapedItem>();
  for (const it of oldStore.items) {
    if (!it || !it.url) continue;
    seen.set(it.code || it.url, it);
  }
  let addedCount = 0;
  for (const it of result.items) {
    const key = it.code || it.url;
    if (!seen.has(key)) {
      seen.set(key, it);
      addedCount++;
    }
  }

  const store: ScrapeStore = {
    updatedAt: Date.now(),
    baseUrl,
    pages: result.pages,
    items: Array.from(seen.values()),
  };
  writeScrapeStore(store);
  log.info(`[scrape] 已缓存 ${store.items.length} 条（本次新增 ${addedCount} 条）`);
  return store;
}

/**
 * 应用启动时调用一次：延迟等待 missav webview 过盾后抓取。
 * 幂等，重复调用只执行一次。
 */
export function runStartupScrape(delayMs = 20000): void {
  if (startupScrapeRan) return;
  startupScrapeRan = true;
  if (!readScrapeConfig().autoOnStartup) {
    log.info("[scrape] 启动自动抓取已关闭（可在「发现」页开启）");
    return;
  }
  setTimeout(() => {
    void scrapeAndStore().catch((error) =>
      log.warn(`[scrape] 启动抓取失败: ${(error as Error)?.message}`),
    );
  }, delayMs);
}

export const scrapeRouter = t.router({
  /** 渲染进程里的隐藏抓取 webview 启动后调用，注册其 webContents id */
  registerWebview: t.procedure
    .input((input: unknown) => input as { id: number })
    .mutation(({ input }) => {
      if (typeof input?.id === "number") registerScraperWebview(input.id);
      return { ok: true };
    }),

  /** 读取抓取配置 */
  getConfig: t.procedure.query((): ScrapeConfig => readScrapeConfig()),

  /** 保存抓取配置 */
  setConfig: t.procedure
    .input((input: unknown) => input as Partial<ScrapeConfig>)
    .mutation(({ input }): ScrapeConfig => {
      const merged: ScrapeConfig = { ...readScrapeConfig(), ...input };
      merged.startPage = Math.max(1, Math.floor(merged.startPage || 1));
      merged.endPage = Math.max(
        merged.startPage,
        Math.floor(merged.endPage || merged.startPage),
      );
      writeScrapeConfig(merged);
      return merged;
    }),

  /** 渲染端一键抓取完成后，把 items 落库 */
  save: t.procedure
    .input(
      (input: unknown) =>
        input as { items: ScrapedItem[]; baseUrl: string; pages: number },
    )
    .mutation(({ input }): ScrapeStore =>
      saveScrapedItems(input.items || [], {
        baseUrl: input.baseUrl || "",
        pages: input.pages || 0,
      }),
    ),

  /** 读取已缓存的抓取结果（渲染进程启动时用它渲染列表） */
  getCached: t.procedure.query((): ScrapeStore => readScrapeStore()),

  /** 清空抓取缓存 */
  clear: t.procedure.mutation((): ScrapeStore => {
    const store: ScrapeStore = { updatedAt: 0, baseUrl: "", pages: 0, items: [] };
    writeScrapeStore(store);
    log.info("[scrape] 缓存已清空");
    return store;
  }),

  /** 按番号去重：同一番号只保留最先出现的那条 */
  dedupe: t.procedure.mutation((): ScrapeStore => {
    const oldStore = readScrapeStore();
    const seen = new Set<string>();
    const deduped: ScrapedItem[] = [];
    let removed = 0;
    for (const it of oldStore.items) {
      if (!it.code) {
        // 无番号的保留，无法去重
        deduped.push(it);
        continue;
      }
      const key = it.code.trim().toUpperCase();
      if (seen.has(key)) {
        removed++;
      } else {
        seen.add(key);
        deduped.push(it);
      }
    }
    const store: ScrapeStore = {
      ...oldStore,
      updatedAt: Date.now(),
      items: deduped,
    };
    writeScrapeStore(store);
    log.info(`[scrape] 去重完成：移除 ${removed} 条重复番号，剩余 ${deduped.length} 条`);
    return store;
  }),

  /** 手动触发一次抓取并更新缓存 */
  refresh: t.procedure
    .input(
      (input: unknown) =>
        (input as
          | { baseUrl?: string; startPage?: number; endPage?: number }
          | undefined) || {},
    )
    .mutation(async ({ input }): Promise<ScrapeStore> => scrapeAndStore(input)),

  /** 一次性抓取（不写缓存），供自定义 baseUrl 临时抓取 */
  list: t.procedure
    .input(
      (input: unknown) =>
        input as { baseUrl: string; startPage?: number; endPage?: number },
    )
    .mutation(async ({ input }) => scrapeList(input)),
});
