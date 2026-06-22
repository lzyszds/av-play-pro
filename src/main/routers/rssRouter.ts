import axios from "axios";
import * as cheerio from "cheerio";
import { session } from "electron";
import { t } from "../trpc";
import { log } from "../logger";
import {
  getActiveMissavWebContents,
  MISSAV_WEB_PARTITION,
} from "../webview/missavWebSession";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface RssFetchItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
  coverUrl?: string;
}

function normalizeUrl(value: string, baseUrl: string): string {
  if (!value) return "";
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function textOf($el: cheerio.Cheerio<unknown>, selector: string): string {
  return $el.find(selector).first().text().trim();
}

function attrOf(
  $el: cheerio.Cheerio<unknown>,
  selector: string,
  attr: string,
): string {
  return $el.find(selector).first().attr(attr)?.trim() || "";
}

function parseXmlFeed(text: string, feedUrl: string): RssFetchItem[] {
  const $ = cheerio.load(text, { xmlMode: true });
  const items: RssFetchItem[] = [];

  $("item").each((_, el) => {
    const $el = $(el);
    const title = textOf($el, "title");
    const link =
      textOf($el, "link") ||
      attrOf($el, "guid[isPermaLink='true']", "text") ||
      textOf($el, "guid");
    const pubDate = textOf($el, "pubDate") || textOf($el, "dc\\:date");
    const description =
      textOf($el, "description") || textOf($el, "content\\:encoded");
    const coverUrl =
      attrOf($el, "enclosure[type^='image']", "url") ||
      attrOf($el, "media\\:thumbnail", "url") ||
      attrOf($el, "media\\:content[medium='image']", "url");

    if (title && link) {
      items.push({
        title,
        link: normalizeUrl(link, feedUrl),
        pubDate,
        description,
        coverUrl: normalizeUrl(coverUrl, feedUrl),
      });
    }
  });

  $("entry").each((_, el) => {
    const $el = $(el);
    const title = textOf($el, "title");
    const link =
      attrOf($el, "link[rel='alternate']", "href") ||
      attrOf($el, "link", "href") ||
      textOf($el, "link");
    const pubDate = textOf($el, "updated") || textOf($el, "published");
    const description = textOf($el, "summary") || textOf($el, "content");

    if (title && link) {
      items.push({
        title,
        link: normalizeUrl(link, feedUrl),
        pubDate,
        description,
      });
    }
  });

  return items;
}

function parseHtmlList(text: string, pageUrl: string): RssFetchItem[] {
  const $ = cheerio.load(text);
  const pageOrigin = new URL(pageUrl).origin;
  const items: RssFetchItem[] = [];
  const seen = new Set<string>();

  $("a[href]").each((_, el) => {
    const $link = $(el);
    const href = $link.attr("href") || "";
    if (!/\/(?:dm\d+\/)?(?:cn|dm|en)\/[^/?#]+/i.test(href)) return;

    const link = normalizeUrl(href, pageOrigin);
    if (seen.has(link)) return;

    const $root = $link.closest("div, article, li, section").first();
    const title =
      $link.attr("title")?.trim() ||
      $link.find("[title]").first().attr("title")?.trim() ||
      $link.find(".text-secondary, .text-nord6, h3, h4, span").first().text().trim() ||
      $root.find(".text-secondary, .text-nord6, h3, h4, span").first().text().trim() ||
      $link.text().trim();
    if (!title) return;

    const coverUrl = normalizeUrl(
      $link.find("img").first().attr("data-src") ||
        $link.find("img").first().attr("src") ||
        $root.find("img").first().attr("data-src") ||
        $root.find("img").first().attr("src") ||
        "",
      pageUrl,
    );
    const description = $root.text().replace(/\s+/g, " ").trim();

    seen.add(link);
    items.push({
      title,
      link,
      pubDate: "",
      description,
      coverUrl,
    });
  });

  return items.slice(0, 80);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadFromActiveWebview(url: string, timeout = 35000): Promise<string | null> {
  if (!/https:\/\/missav\./i.test(url)) return null;

  const contents = getActiveMissavWebContents();
  if (!contents) return null;

  try {
    if (!contents.getURL().startsWith("https://missav.")) return null;

    if (contents.getURL().split("#")[0] !== url.split("#")[0]) {
      await contents.loadURL(url);
    }

    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (contents.isDestroyed()) return null;
      const html = await contents.executeJavaScript(
        "document.documentElement ? document.documentElement.outerHTML : ''",
        true,
      );

      if (
        typeof html === "string" &&
        html.length > 1000 &&
        !/challenges\.cloudflare|cf-turnstile|Just a moment/i.test(html)
      ) {
        return html;
      }

      await sleep(800);
    }
  } catch (error: any) {
    log.warn(`[rss] active webview load failed (${url}): ${error?.message}`);
  }

  return null;
}

async function fetchText(url: string): Promise<{
  text: string;
  status: number;
  contentType: string;
  finalUrl: string;
}> {
  const headers = {
    "User-Agent": UA,
    Accept:
      "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, */*",
    Referer: new URL(url).origin + "/",
  };

  const liveHtml = await loadFromActiveWebview(url);
  if (liveHtml) {
    return {
      text: liveHtml,
      status: 200,
      contentType: "text/html",
      finalUrl: url,
    };
  }

  let sessionStatus = 0;

  try {
    const webSession = session.fromPartition(MISSAV_WEB_PARTITION);
    const response = await webSession.fetch(url, { headers });
    const text = await response.text();
    sessionStatus = response.status;
    return {
      text,
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      finalUrl: response.url || url,
    };
  } catch (sessionError) {
    log.warn(`[rss] electron session fetch failed: ${(sessionError as Error)?.message}`);
  }

  if (sessionStatus === 403) {
    return {
      text: "",
      status: 403,
      contentType: "",
      finalUrl: url,
    };
  }

  const response = await axios.get<string>(url, {
    headers,
    maxRedirects: 5,
    responseType: "text",
    timeout: 20000,
    validateStatus: () => true,
  });

  return {
    text: response.data,
    status: response.status,
    contentType: String(response.headers["content-type"] || ""),
    finalUrl: response.request?.res?.responseUrl || url,
  };
}

export const rssRouter = t.router({
  fetch: t.procedure
    .input((input: unknown) => input as { url: string })
    .query(async ({ input }) => {
      const url = input.url?.trim();
      const started = Date.now();
      if (!url) return { items: [], error: "URL 不能为空", sourceType: "unknown" as const };

      try {
        const fetched = await fetchText(url);
        if (fetched.status < 200 || fetched.status >= 300) {
          return {
            items: [],
            error: `HTTP ${fetched.status}: 站点拒绝了本次请求。请先在内置网页打开一次该站点，或换用真正的 RSS/XML 地址。`,
            sourceType: "blocked" as const,
          };
        }

        const looksXml =
          /(?:rss|atom|xml)/i.test(fetched.contentType) ||
          /^\s*<\?xml/i.test(fetched.text) ||
          /^\s*<(rss|feed)\b/i.test(fetched.text);
        const items = looksXml
          ? parseXmlFeed(fetched.text, fetched.finalUrl)
          : parseHtmlList(fetched.text, fetched.finalUrl);

        log.info(
          `[rss] fetched ${url} -> ${items.length} items (${Date.now() - started}ms)`,
        );
        return {
          items,
          error: items.length
            ? null
            : looksXml
              ? "已获取 XML，但没有找到 item/entry 条目"
              : "已获取 HTML，但没有找到可识别的视频条目",
          sourceType: looksXml ? ("xml" as const) : ("html" as const),
        };
      } catch (err: any) {
        log.error(`[rss] fetch failed: ${err?.message}`);
        return {
          items: [],
          error: err?.message || "抓取失败",
          sourceType: "unknown" as const,
        };
      }
    }),
});
