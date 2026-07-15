import { net, session } from "electron";
import * as http from "http";
import { MISSAV_WEB_PARTITION } from "../webview/missavWebSession";

/**
 * 本地媒体反代：给外部下载器（N_m3u8DL-RE）用。
 *
 * 背景：surrit.com 等 CDN 挂在 Cloudflare 后，按客户端 TLS/HTTP 指纹拦截。
 * Electron 的 net.request 走 Chromium 网络栈（浏览器级指纹）能拿到 200，
 * 但 N_m3u8DL-RE 基于 .NET HttpClient，指纹被判定为机器人 → 403。
 *
 * 解决：在 127.0.0.1 起一个明文 HTTP 服务，上游用 net.request（复用 WebView
 * 的 Cloudflare 会话）去拉 CDN，并把 m3u8 里的分段/密钥地址改写成指向本服务。
 * N_m3u8DL-RE 只跟 localhost 打交道，过墙的活儿交给 Chromium 网络栈。
 */

const PROXY_PORT = 39528;
const CDN_DOMAINS = ["surrit.com", "surrit.org", "fourhoi.com"];
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";
const UPSTREAM_TIMEOUT = 20000;

let server: http.Server | null = null;

const isAllowedCdnHost = (hostname: string): boolean =>
  CDN_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`));

export function isCdnUrl(rawUrl: string): boolean {
  try {
    return isAllowedCdnHost(new URL(rawUrl).hostname);
  } catch {
    return false;
  }
}

function localProxyBase(): string {
  return `http://127.0.0.1:${PROXY_PORT}`;
}

/** 把一个 CDN 直链转成走本地代理的地址 */
export function toLocalProxyUrl(targetUrl: string, referer: string): string {
  const u = new URL(`${localProxyBase()}/m`);
  u.searchParams.set("u", targetUrl);
  if (referer) u.searchParams.set("r", referer);
  return u.toString();
}

/** 把 m3u8 里所有 CDN 分段/子列表/密钥地址改写成本地代理地址 */
function rewriteM3u8(body: string, baseUrl: URL, referer: string): string {
  const rewriteOne = (raw: string): string | null => {
    try {
      const target = new URL(raw, baseUrl);
      if (!isAllowedCdnHost(target.hostname)) return null;
      return toLocalProxyUrl(target.href, referer);
    } catch {
      return null;
    }
  };

  return body
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      // 标签行：改写 URI="..."（#EXT-X-KEY / #EXT-X-MAP / #EXT-X-MEDIA 等）
      if (trimmed.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/i, (m, uri: string) => {
          const r = rewriteOne(uri);
          return r ? `URI="${r}"` : m;
        });
      }
      // 普通分段/子列表行（相对地址按 baseUrl 解析）
      const r = rewriteOne(trimmed);
      return r ?? line;
    })
    .join("\n");
}

function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  let reqUrl: URL;
  try {
    reqUrl = new URL(req.url || "/", localProxyBase());
  } catch {
    res.writeHead(400).end("bad request");
    return;
  }

  if (reqUrl.pathname === "/health") {
    res.writeHead(200).end("ok");
    return;
  }
  if (reqUrl.pathname !== "/m") {
    res.writeHead(404).end("not found");
    return;
  }

  const target = reqUrl.searchParams.get("u");
  const referer = reqUrl.searchParams.get("r") || "https://missav.ai/";
  if (!target) {
    res.writeHead(400).end("missing u");
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    res.writeHead(400).end("bad u");
    return;
  }
  if (!isAllowedCdnHost(parsed.hostname)) {
    res.writeHead(403).end("not a cdn domain");
    return;
  }

  const cdnSession = session.fromPartition(MISSAV_WEB_PARTITION);
  const upstream = net.request({
    method: "GET",
    url: parsed.href,
    redirect: "follow",
    session: cdnSession,
    useSessionCookies: true,
    // 默认策略会把跨域 Referer 降级到 origin 甚至判定违规取消请求，
    // 这里强制原样发送我们设的 Referer
    referrerPolicy: "unsafe-url",
  });
  upstream.setHeader("User-Agent", UA);
  upstream.setHeader("Referer", referer);
  try {
    upstream.setHeader("Origin", new URL(referer).origin);
  } catch {
    /* ignore */
  }
  upstream.setHeader("Accept", "*/*");
  upstream.setHeader("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8");
  upstream.setHeader("Sec-Fetch-Site", "cross-site");
  if (req.headers["range"]) {
    upstream.setHeader("Range", String(req.headers["range"]));
  }

  const timer = setTimeout(() => {
    try {
      upstream.abort();
    } catch {
      /* ignore */
    }
  }, UPSTREAM_TIMEOUT);

  upstream.on("response", (up) => {
    clearTimeout(timer);
    const status = up.statusCode || 200;
    const contentType =
      (up.headers["content-type"] as string) || "application/octet-stream";
    const isM3u8 =
      /mpegurl|m3u8/i.test(contentType) ||
      parsed.pathname.toLowerCase().endsWith(".m3u8");

    if (status >= 400) {
      console.warn(`[本地代理] ${status} ${parsed.pathname}`);
    }

    if (isM3u8 && status < 400) {
      const chunks: Buffer[] = [];
      up.on("data", (c: Buffer) => chunks.push(c));
      up.on("end", () => {
        const text = rewriteM3u8(
          Buffer.concat(chunks).toString("utf8"),
          parsed,
          referer,
        );
        const buf = Buffer.from(text, "utf8");
        res.writeHead(status, {
          "Content-Type": contentType,
          "Content-Length": String(buf.length),
        });
        res.end(buf);
      });
      up.on("error", () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      return;
    }

    // 二进制（分段/密钥）流式直通
    const respHeaders: Record<string, string> = { "Content-Type": contentType };
    const cl = up.headers["content-length"];
    if (cl) respHeaders["Content-Length"] = String(cl);
    const ar = up.headers["accept-ranges"];
    if (ar) respHeaders["Accept-Ranges"] = String(ar);
    const cr = up.headers["content-range"];
    if (cr) respHeaders["Content-Range"] = String(cr);
    res.writeHead(status, respHeaders);
    up.on("data", (c: Buffer) => res.write(c));
    up.on("end", () => res.end());
    up.on("error", () => res.end());
  });

  upstream.on("error", (err: Error) => {
    clearTimeout(timer);
    if (!res.headersSent) res.writeHead(502);
    res.end(`upstream error: ${err.message}`);
  });

  // 客户端断开就掐掉上游
  req.on("close", () => {
    try {
      upstream.abort();
    } catch {
      /* ignore */
    }
  });

  upstream.end();
}

export function startLocalMediaProxyServer(): void {
  if (server) return;
  server = http.createServer(handleRequest);
  server.on("error", (error) => {
    console.warn("[本地代理] 启动失败:", error);
  });
  // 仅绑定回环地址，不对外暴露
  server.listen(PROXY_PORT, "127.0.0.1", () => {
    console.log(`[本地代理] 已启用 http://127.0.0.1:${PROXY_PORT} (绕过 Cloudflare 指纹拦截)`);
  });
}
