import * as cheerio from "cheerio";
import * as fs from "fs";
import { atomicWriteFileSync } from "../lib/fsutil";
import * as path from "path";
import { app, session, webContents } from "electron";
import type { WebContents } from "electron";
import { t } from "../trpc";
import { log } from "../logger";
import { emitExtensionTaskPush } from "../extensions/pushServer";
import {
  resolveMissavM3u8,
  resolveMissavQuality,
} from "../webview/missavResolver";
import { curlFetchText } from "../lib/curlFetch";
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
  /** 最高档画质标签，如 "720P"（一键下载/播放解析详情页后回填） */
  quality?: string | null;
}

export type ScrapeMethod = "webview" | "jina";

export interface ScrapeConfig {
  baseUrl: string;
  startPage: number;
  endPage: number;
  /** 启动时是否自动抓取一次 */
  autoOnStartup: boolean;
  /** 抓取方式：webview=过盾抓取（慢但稳），jina=r.jina.ai 第三方代理（快） */
  method?: ScrapeMethod;
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
    method: "webview",
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
    atomicWriteFileSync(configFile(), JSON.stringify(config, null, 2));
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
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<ScrapeStore>;
      // 防御脏数据（如被云同步/外部写坏成 {} ）：字段不合法时回退为空缓存，不再原样返回
      return {
        updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
        baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
        pages: typeof parsed.pages === "number" ? parsed.pages : 0,
        items: Array.isArray(parsed.items) ? parsed.items : [],
      };
    }
  } catch (error) {
    log.warn(`[scrape] 读取缓存失败: ${(error as Error)?.message}`);
  }
  return { updatedAt: 0, baseUrl: "", pages: 0, items: [] };
}

function writeScrapeStore(store: ScrapeStore): void {
  try {
    atomicWriteFileSync(storeFile(), JSON.stringify(store, null, 2));
  } catch (error) {
    log.warn(`[scrape] 写入缓存失败: ${(error as Error)?.message}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 优先复用已过 Cloudflare 的 missav webview 抓取 HTML，
 * 拿不到再退回 electron 会话 / axios。逻辑与站内抓取保持一致。
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

/** 判定给定 webContents 是否为渲染进程注册的「专用抓取 webview」（可自由清空导航） */
export function isScraperWebview(
  contents: WebContents | null,
): boolean {
  if (!contents || contents.isDestroyed() || scraperContentsId == null) {
    return false;
  }
  const wc = webContents.fromId(scraperContentsId);
  return wc === contents && !wc.isDestroyed();
}

/** 嗅探完成后释放页面：仅清空专用抓取 webview（只加载空白最小页，session 与过盾 cookie 不受影响） */
export async function releaseScrapePage(): Promise<void> {
  if (scraperContentsId == null) return;
  const wc = webContents.fromId(scraperContentsId);
  if (!wc || wc.isDestroyed()) return;
  try {
    await wc.loadURL("about:blank");
    log.info("[scrape] 专用抓取 webview 已释放（about:blank）");
  } catch (error) {
    log.warn(
      `[scrape] 释放抓取 webview 失败: ${(error as Error)?.message}`,
    );
  }
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

/** 取正文前 n 行（去空行、压日志长度），用于打印对方到底返回了什么 */
function firstLines(text: string, count: number): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, count)
    .map((l) => (l.length > 200 ? `${l.slice(0, 200)}…` : l));
  return lines.join(" ⏎ ") || "(空)";
}

/** Jina 通道兜底：应用内会话直连（UA 指纹被 Cloudflare 挑战时的原实现） */
async function fetchViaJinaSession(url: string): Promise<string> {
  const jinaUrl = `https://r.jina.ai/${url}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    // 关键：走 persist:missav-web 会话（与抓取 webview 共用 cookie 域）。
    // r.jina.ai 自己也在 Cloudflare 后面，家里等换了出口 IP 的环境可能对
    // 应用直接甩「Just a moment」挑战页——用 webview 过一次盾后，
    // cf_clearance 会落在这个分区里，普通 fetch 即可复用直连通过。
    // （之前用 axios/Node 直连还有第二个问题：DNS 污染导致 ETIMEDOUT）
    const webSession = session.fromPartition(MISSAV_WEB_PARTITION);
    const response = await webSession.fetch(jinaUrl, {
      headers: { "x-return-format": "html", Accept: "text/html,*/*" },
      signal: controller.signal,
    });
    const html = await response.text();
    if (response.status >= 400) {
      const isChallenge = /just a moment|challenge-platform/i.test(html);
      log.warn(
        `[scrape][jina] 状态=${response.status} len=${html.length} server=${response.headers?.get?.("server") ?? "?"} content-type=${response.headers?.get?.("content-type") ?? "?"} cf-ray=${response.headers?.get?.("cf-ray") ?? "-"} challenge=${isChallenge} (${url})`,
      );
      log.warn(`[scrape][jina] 返回正文前 5 行: ${firstLines(html, 5)}`);
      const err = new Error(
        isChallenge
          ? "jina 前置域被 Cloudflare 挑战（需过一次盾）"
          : `目标站拦截了 Jina 代理（${response.status}）`,
      ) as Error & {
        response?: { status: number };
        jinaChallenge?: boolean;
      };
      err.response = { status: response.status };
      if (isChallenge) err.jinaChallenge = true;
      throw err;
    }
    if (response.status >= 200 && response.status < 400 && html.length > 0) {
      return html;
    }
    log.warn(`[scrape][jina] status=${response.status} len=${html.length} (${url})`);
    return "";
  } finally {
    clearTimeout(timer);
  }
}

/** Jina 通道抓取单页：HTML 直接复用现有 cheerio 解析（页面结构与站内一致） */
async function scrapePageViaJina(url: string): Promise<ScrapedItem[]> {
  const html = await fetchViaJina(url);
  if (!html) return [];
  const items = parseListPage(html);
  log.info(`[scrape][jina] ${url} -> ${items.length} 条 (len=${html.length})`);
  return items;
}

/**
 * Jina 通道（首选）：走系统 curl 子进程。
 * 用户终端验证：curl 干净 UA + 系统 TLS 指纹能直接通过 Cloudflare
 * 拿到 r.jina.ai -> missav 内容，应用内请求则会被挑战或 DNS 污染卡死。
 * curl 不可用时降级到应用内会话直连。
 */
async function fetchViaJina(url: string): Promise<string> {
  const jinaUrl = `https://r.jina.ai/${url}`;
  try {
    const result = await curlFetchText(jinaUrl, {
      timeoutSec: 90,
      headers: ["x-return-format: html"],
    });
    log.info(
      `[scrape][jina] curl 状态=${result.status} len=${result.body.length} (${url})`,
    );
    if (result.status >= 400) {
      const isChallenge = /just a moment|challenge-platform/i.test(
        result.body,
      );
      // Jina 免费额度 429 仍按限流语义抛出，供上层退避重试
      const err = new Error(
        isChallenge
          ? "jina 前置域被 Cloudflare 挑战"
          : `jina 代理返回 ${result.status}`,
      ) as Error & { response?: { status: number } };
      err.response = { status: result.status };
      throw err;
    }
    if (result.body.length > 0) return result.body;
    log.warn(`[scrape][jina] curl 返回空内容，降级会话直连 (${url})`);
  } catch (error) {
    log.warn(
      `[scrape][jina] curl 通道失败: ${(error as Error)?.message}，降级会话直连 (${url})`,
    );
  }
  return fetchViaJinaSession(url);
}

/**
 * Jina 快速抓取列表页：baseUrl 与 webview 通道一致（{page} 占位）。
 * 不开 webview、不战 Cloudflare，逐页直接发请求。
 * 注意：Jina 免费额度约 20 req/min，超速直接 429 —— 这里用
 * 全局节流闸（请求间最小间隔）+ 429 退避重试 + 连续限流提前收场。
 */
export async function scrapeListViaJina(opts: {
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

  // 全局共享节流闸：所有并发 worker 排队经过，保证两次请求至少间隔 RATE_LIMIT_MS
  const RATE_LIMIT_MS = 3200; // ≈ 18 req/min，在 Jina 免费额度内
  const pages: number[] = [];
  for (let p = startPage; p <= endPage; p++) pages.push(p);
  beginProgress(pages.length);

  const CONCURRENCY = 2; // 节流闸已限速，两个 worker 足够
  let index = 0;
  let nextSlot = 0;
  let consecutiveRateLimited = 0;
  let blockedCount = 0; // 403 等被目标站拦截的次数（连续 2 次即判定 Jina 通道整体失效）

  /** 从节流闸排队领取本 worker 的请求时段 */
  async function takeSlot(): Promise<void> {
    const now = Date.now();
    const slot = Math.max(nextSlot, now);
    nextSlot = slot + RATE_LIMIT_MS;
    const wait = slot - now;
    if (wait > 0) await sleep(wait);
  }

  const worker = async () => {
    while (
      index < pages.length &&
      consecutiveRateLimited < 3 &&
      blockedCount < 2 &&
      !isCancelRequested()
    ) {
      const p = pages[index++];
      const url = baseUrl.includes("{page}")
        ? baseUrl.replace("{page}", String(p))
        : baseUrl.replace(/([?&]page=)\d*/, `$1${p}`);

      // 每页最多重试 2 次（429 退避 5s / 10s）
      let success = false;
      let gaveUp = false;
      for (
        let attempt = 0;
        attempt <= 2 && !success && !gaveUp;
        attempt++
      ) {
        if (isCancelRequested()) break;
        if (attempt > 0) await sleep(5000 * attempt);
        await takeSlot();
        if (isCancelRequested()) break;
        try {
          const items = await scrapePageViaJina(url);
          if (isCancelRequested()) break;
          scannedPages++;
          consecutiveRateLimited = 0;
          if (items.length === 0) {
            // Jina 偶发拿到挑战页（len≈5800），属瞬时风控；属于定时重试，最多 3 次
            lastError = `第 ${p} 页无数据（疑似挑战页，将退避重试）`;
            log.warn(
              `[scrape][jina] 第 ${p} 页疑似挑战页，退避后重试（第 ${attempt + 2}/3 次）`,
            );
            continue;
          }
          lastError = null;
          success = true;
          const pageItems: ScrapedItem[] = [];
          for (const it of items) {
            const key = it.code || it.url;
            if (!seen.has(key)) {
              seen.add(key);
              all.push(it);
              pageItems.push(it);
            }
          }
          // 增量入库：每抓到一页立刻合并落盘（失败页重试成功也能看到）
          if (pageItems.length > 0) {
            saveScrapedItems(pageItems, { baseUrl, pages: endPage - startPage + 1 });
          }
          setProgress({ page: p, lastPageItems: pageItems.length });
        } catch (error: any) {
          if (error?.response?.status === 429) {
            lastError = `第 ${p} 页被 Jina 限流（429），正在退避重试`;
            log.warn(`[scrape][jina] ${lastError}`);
            consecutiveRateLimited++;
            if (consecutiveRateLimited >= 3) gaveUp = true;
            continue;
          }
          if (error?.response?.status >= 400) {
            blockedCount++;
            lastError = `Jina 通道被目标站拦截（${error.response.status}），快速通道当前不可用`;
            log.warn(`[scrape][jina] ${lastError}`);
            if (blockedCount >= 2) {
              lastError = "目标站把 Jina 代理拦在盾外（403），快速通道暂时失效";
              log.warn(`[scrape][jina] ${lastError}`);
            }
            break;
          }
          lastError = error?.message || String(error);
          log.warn(`[scrape][jina] 第 ${p} 页失败: ${lastError}`);
          break;
        }
      }
    }

    if (isCancelRequested() && index < pages.length) {
      lastError = `已手动停止，保留本次已抓的 ${all.length} 条`;
      log.info(`[scrape][jina] ${lastError}`);
    }
    if (consecutiveRateLimited >= 3 && index < pages.length) {
      lastError = `Jina 持续限流，已提前结束（本次已抓 ${all.length} 条）`;
      log.warn(`[scrape][jina] ${lastError}`);
    }
    if (blockedCount >= 2) {
      lastError = "Jina 已被目标站拦截，建议改用「过盾抓取」方式";
      log.warn(`[scrape][jina] ${lastError}`);
      // 自动把默认抓取方式切回过盾（下次点「一键抓取」不再先撞 Jina；可在弹窗里改回）
      const cfg = readScrapeConfig();
      if (cfg.method !== "webview") {
        writeScrapeConfig({ ...cfg, method: "webview" });
        log.warn("[scrape][jina] 已自动把抓取方式切换为「过盾抓取」（可在启动弹窗里改回）");
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, pages.length) }, () => worker()),
  );

  endProgress();
  return { items: all, pages: scannedPages, error: all.length === 0 ? lastError : null };
}

let startupScrapeRan = false;

/** 主进程抓取取消旗标：jina/主进程 webview 通道的逐页循环都会检查 */
let cancelRequested = false;

export function requestCancelScrape(): void {
  cancelRequested = true;
}

function isCancelRequested(): boolean {
  return cancelRequested;
}

/** 抓取实时进度（供控制台状态条显示第 X/Y 页） */
export interface ScrapeProgress {
  active: boolean;
  page: number;
  totalPages: number;
  lastPageItems: number;
}
let progressState: ScrapeProgress = {
  active: false,
  page: 0,
  totalPages: 0,
  lastPageItems: 0,
};

function setProgress(patch: Partial<ScrapeProgress>): void {
  progressState = { ...progressState, ...patch };
}

/** 抓取实时进度状态，开始时调用 */
function beginProgress(totalPages: number): void {
  cancelRequested = false;
  progressState = { active: true, page: 0, totalPages, lastPageItems: 0 };
}
function endProgress(): void {
  progressState = { active: false, page: 0, totalPages: 0, lastPageItems: 0 };
}

/**
 * 抓取并写入缓存。返回最终缓存内容。
 * 策略：与旧缓存合并（按 code/url 去重），新内容追加，不覆盖已有内容。
 * 抓取失败（0 条）时保留旧缓存，避免清空。
 */
export async function scrapeAndStore(opts?: {
  baseUrl?: string;
  startPage?: number;
  endPage?: number;
  method?: ScrapeMethod;
}): Promise<ScrapeStore> {
  const cfg = readScrapeConfig();
  const baseUrl = opts?.baseUrl?.trim() || cfg.baseUrl || DEFAULT_SCRAPE_BASE_URL;
  const method = opts?.method || cfg.method || "webview";
  const result =
    method === "jina"
      ? await scrapeListViaJina({
          baseUrl,
          startPage: opts?.startPage ?? cfg.startPage,
          endPage: opts?.endPage ?? cfg.endPage,
        })
      : await scrapeList({
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

  /** 设置抓取 webview 的内部页面缩放（webview 标签自身的 setZoomFactor 不生效，必须走主进程 webContents） */
  setZoomFactor: t.procedure
    .input((input: unknown) => input as { factor: number })
    .mutation(({ input }): { ok: boolean } => {
      const factor = Math.min(2, Math.max(0.2, input?.factor || 1));
      if (scraperContentsId == null) return { ok: false };
      const wc = webContents.fromId(scraperContentsId);
      if (!wc || wc.isDestroyed()) return { ok: false };
      wc.setZoomFactor(factor);
      return { ok: true };
    }),

  /** 抓取实时进度（第 X/Y 页控制台状态条用） */
  getProgress: t.procedure.query((): ScrapeProgress => progressState),

  /** 取消进行中的主进程抓取（jina/主进程 webview 通道逐页生效，已抓内容保留） */
  cancelRun: t.procedure.mutation((): { ok: boolean } => {
    requestCancelScrape();
    log.info("[scrape] 收到取消请求：当前主进程抓取将在当前页请求后停止");
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
          | { baseUrl?: string; startPage?: number; endPage?: number; method?: ScrapeMethod }
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

  /** 发现页一键下载：从详情页 URL 解析 m3u8（会话直取解包，失败转 webview 自动播放嗅探） */
  resolveM3u8: t.procedure
    .input((input: unknown) => input as { url: string })
    .mutation(
      async ({ input }): Promise<{ m3u8: string | null; method: string }> => {
        log.info(`[scrape] 一键下载：开始解析 m3u8 (${input?.url})`);
        const result = await resolveMissavM3u8(input?.url || "", {
          getWebContents: getScrapeContents,
          canRelease: isScraperWebview,
          onRelease: releaseScrapePage,
        });
        if (!result.m3u8) {
          log.warn(`[scrape] 一键下载：解析 m3u8 失败 (${input?.url})`);
        }
        return result;
      },
    ),

  /** 发现页一键下载：把解析出的流按「插件推送」管线入队（DownloadPage 自动建任务并启动） */
  queueDiscoverDownload: t.procedure
    .input(
      (input: unknown) =>
        input as {
          m3u8Url: string;
          name?: string;
          coverUrl?: string;
          previewUrl?: string;
          pageUrl?: string;
          quality?: string | null;
        },
    )
    .mutation(({ input }) => {
      const payload = emitExtensionTaskPush({
        url: input?.m3u8Url,
        name: input?.name || "M3U8 Task",
        cover: input?.coverUrl,
        preview: input?.previewUrl,
        pageUrl: input?.pageUrl,
        quality: input?.quality || undefined,
        source: "discover",
      });
      log.info(
        `[scrape] 一键下载：已入队 ${payload.name} | ${payload.url}`,
      );
      return payload;
    }),

  /** 分辨率标注：解析详情页回填最高档画质（快路径 → 过盾 webview 页源，不触发播放；解析出 m3u8 时顺带回填） */
  annotate: t.procedure
    .input(
      (input: unknown) => input as { url: string; code?: string | null },
    )
    .mutation(async ({ input }): Promise<{ quality: string | null }> => {
      const url = input?.url || "";
      const result = await resolveMissavQuality(url, {
        getWebContents: getScrapeContents,
        canRelease: isScraperWebview,
        onRelease: releaseScrapePage,
      });
      if (result.quality) {
        // 回填到缓存（按 url 定位；code 仅作辅助匹配，可能为 null）
        const store = readScrapeStore();
        const target = store.items.find(
          (it) => it.url === url || (input?.code && it.code === input.code),
        );
        if (target) {
          target.quality = result.quality;
          writeScrapeStore(store);
          log.info(`[scrape] 分辨率标注 ${input?.code || ""} -> ${result.quality}`);
        }
      }
      return { quality: result.quality };
    }),
});
