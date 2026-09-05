// 演员头像爬取（JavDB）
// 流程：搜索演员名 → 取第一个匹配 → 抽 avatar URL → 下载 → base64
import axios from "axios";
import * as cheerio from "cheerio";
import * as net from "net";
import { log } from "../logger";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const BASE_HEADERS = {
  "User-Agent": UA,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7",
  "Upgrade-Insecure-Requests": "1",
  Cookie: "over18=1; locale=zh",
};

async function probeLocalProxy(): Promise<string | null> {
  const candidates = [7890, 10809, 1080];
  for (const port of candidates) {
    const ok = await new Promise<boolean>((resolve) => {
      const sock = new net.Socket();
      let settled = false;
      const done = (v: boolean) => {
        if (settled) return;
        settled = true;
        sock.destroy();
        resolve(v);
      };
      sock.setTimeout(300);
      sock.once("connect", () => done(true));
      sock.once("timeout", () => done(false));
      sock.once("error", () => done(false));
      sock.connect(port, "127.0.0.1");
    });
    if (ok) return `http://127.0.0.1:${port}`;
  }
  return null;
}

async function getHttpsAgent(proxyUrl?: string): Promise<any | undefined> {
  let raw =
    proxyUrl?.trim() ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    "";
  if (!raw) {
    const probed = await probeLocalProxy();
    if (probed) raw = probed;
  }
  if (!raw) return undefined;
  try {
    const { HttpsProxyAgent } = require("https-proxy-agent");
    return new HttpsProxyAgent(raw);
  } catch {
    return undefined;
  }
}

export interface ScrapedActor {
  javdbUrl?: string;
  avatarBase64?: string;
}

export async function scrapeActorFromJavDB(
  name: string,
  proxyUrl?: string,
): Promise<ScrapedActor> {
  const httpsAgent = await getHttpsAgent(proxyUrl);
  const searchUrl = `https://javdb.com/search?q=${encodeURIComponent(name)}&f=actor`;
  log.info(`[actors] search ${name} -> ${searchUrl}`);

  let html: string;
  try {
    const res = await axios.get(searchUrl, {
      timeout: 15000,
      httpsAgent,
      proxy: httpsAgent ? false : undefined,
      headers: BASE_HEADERS,
      responseType: "text",
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 400,
    });
    html = String(res.data);
  } catch (e: any) {
    throw new Error(`JavDB search failed: ${e?.message || e}`);
  }

  const $ = cheerio.load(html);

  // JavDB 演员搜索结果：.actor-box > a.box 内含 .avatar(背景图) 和 strong（演员名）
  // 或 .grid .item .actor-box 等变体
  let avatarUrl: string | null = null;
  let actorHref: string | null = null;

  const boxes = $(".actor-box, .actor-section .box, .actors .box").toArray();
  for (const el of boxes) {
    const $a = $(el).find("a").first();
    const href = $a.attr("href");
    const strong = $a.find("strong").first().text().trim();
    const $avatar = $a.find(".avatar, .actor-avatar, figure").first();
    let style = $avatar.attr("style") || "";
    let url = "";
    const m = style.match(/url\((['"]?)([^'")]+)\1\)/);
    if (m) url = m[2];
    if (!url) {
      const img = $avatar.find("img").first().attr("src");
      if (img) url = img;
    }
    if (url && (strong === name || strong.includes(name) || name.includes(strong))) {
      avatarUrl = url;
      actorHref = href || null;
      break;
    }
  }

  // 兜底：取第一个有头像的 box（即使名字不严格相等）
  if (!avatarUrl) {
    for (const el of boxes) {
      const $a = $(el).find("a").first();
      const href = $a.attr("href");
      const $avatar = $a.find(".avatar, .actor-avatar, figure").first();
      const style = $avatar.attr("style") || "";
      const m = style.match(/url\((['"]?)([^'")]+)\1\)/);
      let url = m ? m[2] : "";
      if (!url) {
        const img = $avatar.find("img").first().attr("src");
        if (img) url = img;
      }
      if (url) {
        avatarUrl = url;
        actorHref = href || null;
        break;
      }
    }
  }

  if (!avatarUrl) {
    throw new Error("未找到演员匹配项");
  }

  // 规范化为绝对 URL
  if (avatarUrl.startsWith("//")) avatarUrl = "https:" + avatarUrl;
  else if (avatarUrl.startsWith("/")) avatarUrl = "https://javdb.com" + avatarUrl;

  log.info(`[actors] ${name} avatar=${avatarUrl}`);

  // 下载图片
  let imgBuf: Buffer;
  try {
    const r = await axios.get(avatarUrl, {
      timeout: 15000,
      httpsAgent,
      proxy: httpsAgent ? false : undefined,
      headers: { ...BASE_HEADERS, Referer: "https://javdb.com/" },
      responseType: "arraybuffer",
      validateStatus: (s) => s >= 200 && s < 400,
    });
    imgBuf = Buffer.from(r.data);
  } catch (e: any) {
    throw new Error(`下载头像失败: ${e?.message || e}`);
  }

  // 嗅探格式
  let mime = "image/jpeg";
  if (imgBuf[0] === 0x89 && imgBuf[1] === 0x50) mime = "image/png";
  else if (imgBuf[0] === 0x47 && imgBuf[1] === 0x49) mime = "image/gif";
  else if (
    imgBuf[0] === 0x52 &&
    imgBuf[1] === 0x49 &&
    imgBuf[8] === 0x57 &&
    imgBuf[9] === 0x45
  )
    mime = "image/webp";

  const base64 = `data:${mime};base64,${imgBuf.toString("base64")}`;

  return {
    avatarBase64: base64,
    javdbUrl: actorHref
      ? new URL(actorHref, "https://javdb.com/").toString()
      : undefined,
  };
}
