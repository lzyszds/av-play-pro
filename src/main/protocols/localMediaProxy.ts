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
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
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

/** 根据 CDN 路径生成 referer 候选列表 */
function getRefererCandidates(parsed: URL): string[] {
  const roots = [
    "https://missav.ai/",
    "https://missav.ws/",
    "https://missav.com/",
  ];
  const match = parsed.pathname.match(
    /\/([a-z0-9]+-\d+)(?:-([a-z0-9-]+))?\//i,
  );
  if (match) {
    const code = match[1];
    const full = match[2] ? `${code}-${match[2]}` : code;
    return [
      `https://missav.ai/cn/${code}`,
      `https://missav.ai/cn/${full}`,
      `https://missav.ws/cn/${code}`,
      `https://missav.ws/cn/${full}`,
      `https://missav.com/cn/${code}`,
      `https://missav.com/cn/${full}`,
      ...roots,
    ];
  }
  return roots;
}

function fetchUpstream(
  parsed: URL,
  referer: string,
  rangeHeader: string | undefined,
  sess: Electron.Session,
): Promise<{
  status: number;
  contentType: string;
  headers: Record<string, string | string[] | undefined>;
  stream: any;
}> {
  return new Promise((resolve, reject) => {
    const upstream = net.request({
      method: "GET",
      url: parsed.href,
      redirect: "follow",
      session: sess,
      useSessionCookies: true,
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
    if (rangeHeader) upstream.setHeader("Range", rangeHeader);

    const timer = setTimeout(() => {
      try {
        upstream.abort();
      } catch {
        /* ignore */
      }
      reject(new Error("timeout"));
    }, UPSTREAM_TIMEOUT);

    upstream.on("response", (up) => {
      clearTimeout(timer);
      resolve({
        status: up.statusCode || 200,
        contentType:
          (up.headers["content-type"] as string) || "application/octet-stream",
        headers: up.headers as Record<string, string | string[] | undefined>,
        stream: up,
      });
    });
    upstream.on("error", (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
    upstream.on("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    });
    upstream.end();
  });
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
  const refererParam = reqUrl.searchParams.get("r");
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

  const rangeHeader = req.headers["range"]
    ? String(req.headers["range"])
    : undefined;
  const refererCandidates = refererParam
    ? [refererParam, ...getRefererCandidates(parsed)]
    : getRefererCandidates(parsed);

  fetchWithCandidates(parsed, refererCandidates, 0, 0, res, req);
}

// 会话顺序：默认会话（纯净 Chromium 栈，无广告拦截器）→ missav 分区会话（含 cf_clearance）
const CDN_SESSIONS = () => [
  session.defaultSession,
  session.fromPartition(MISSAV_WEB_PARTITION),
];

function fetchWithCandidates(
  parsed: URL,
  refererCandidates: string[],
  refererIdx: number,
  sessIdx: number,
  res: http.ServerResponse,
  req: http.IncomingMessage,
): void {
  const rangeHeader = req.headers["range"]
    ? String(req.headers["range"])
    : undefined;
  const sessions = CDN_SESSIONS();

  if (refererIdx >= refererCandidates.length) {
    if (!res.headersSent) res.writeHead(502);
    res.end("all upstream attempts failed");
    return;
  }
  if (sessIdx >= sessions.length) {
    fetchWithCandidates(parsed, refererCandidates, refererIdx + 1, 0, res, req);
    return;
  }

  const referer = refererCandidates[refererIdx];
  const sess = sessions[sessIdx];

  fetchUpstream(parsed, referer, rangeHeader, sess)
    .then(({ status, contentType, headers, stream }) => {
      // 403/502：换下一个会话或 referer
      if (status === 403 || status === 502) {
        console.warn(
          `[本地代理] ${status} ${parsed.pathname} (referer=${new URL(referer).host}, sess=${sessIdx === 0 ? "default" : "missav"})`,
        );
        stream.resume();
        fetchWithCandidates(parsed, refererCandidates, refererIdx, sessIdx + 1, res, req);
        return;
      }

      // 封面 404：自动尝试同目录下的其他封面变体（cover-t → cover-n → cover → cover-l）
      if (status === 404 && /\/cover-[a-z]+\.jpe?g$/i.test(parsed.pathname)) {
        const coverVariants = ["cover-t.jpg", "cover-n.jpg", "cover.jpg", "cover-l.jpg"];
        const currentName = parsed.pathname.split("/").pop() || "";
        const nextVariant = coverVariants.find((v) => v !== currentName);
        if (nextVariant) {
          const altUrl = new URL(parsed.href);
          altUrl.pathname = parsed.pathname.replace(/[^/]+$/, nextVariant);
          console.warn(
            `[本地代理] 封面 404，尝试变体: ${currentName} → ${nextVariant}`,
          );
          stream.resume();
          const altParsed = new URL(altUrl.href);
          const altCandidates = getRefererCandidates(altParsed);
          fetchWithCandidates(altParsed, altCandidates, 0, 0, res, req);
          return;
        }
      }

      const isM3u8 =
        /mpegurl|m3u8/i.test(contentType) ||
        parsed.pathname.toLowerCase().endsWith(".m3u8");

      if (isM3u8 && status < 400) {
        const chunks: Buffer[] = [];
        stream.on("data", (c: Buffer) => chunks.push(c));
        stream.on("end", () => {
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
        stream.on("error", () => {
          if (!res.headersSent) res.writeHead(502);
          res.end();
        });
        return;
      }

      // 二进制（图片/分段/密钥）流式直通
      const respHeaders: Record<string, string> = {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
      };
      const cl = headers["content-length"];
      if (cl) respHeaders["Content-Length"] = String(cl);
      const ar = headers["accept-ranges"];
      if (ar) respHeaders["Accept-Ranges"] = String(ar);
      const cr = headers["content-range"];
      if (cr) respHeaders["Content-Range"] = String(cr);
      res.writeHead(status, respHeaders);
      stream.on("data", (c: Buffer) => res.write(c));
      stream.on("end", () => res.end());
      stream.on("error", () => res.end());
    })
    .catch((err: Error) => {
      console.warn(
        `[本地代理] 失败 ${parsed.pathname}: ${err?.message || err} (sess=${sessIdx === 0 ? "default" : "missav"})`,
      );
      fetchWithCandidates(parsed, refererCandidates, refererIdx, sessIdx + 1, res, req);
    });
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
