import { protocol, net } from "electron";
import * as https from "https";

export function setupCdnProxyProtocol(): void {
  const CDN_DOMAINS = ["surrit.com", "surrit.org", "fourhoi.com"];
  const UPSTREAM_TIMEOUT = 15000;
  const M3U8_CACHE_MS = 5 * 60_000;
  const m3u8Cache = new Map<string, { body: string; type: string; t: number }>();

  const httpsAgent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 30_000,
    maxSockets: 16,
    maxFreeSockets: 16,
  });

  // 用 Node https 拿全量 Buffer（适合封面/m3u8/密钥这些小文件）
  const fetchWithNode = (
    target: URL,
    referer: string,
    rangeHeader?: string,
  ): Promise<{
    status: number;
    contentType: string;
    body: Buffer;
    headers: Record<string, string | string[] | undefined>;
  }> =>
    new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
        Referer: referer,
        Accept:
          "image/avif,image/webp,image/apng,image/svg+xml,image/*,video/*,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      };
      if (rangeHeader) headers["Range"] = rangeHeader;
      const req = https.request(
        {
          hostname: target.hostname,
          port: target.port || 443,
          path: target.pathname + target.search,
          method: "GET",
          headers,
          timeout: UPSTREAM_TIMEOUT,
          agent: httpsAgent,
        },
        (res) => {
          // 跟随重定向
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            res.resume();
            const next = new URL(res.headers.location, target);
            fetchWithNode(next, referer, rangeHeader).then(resolve, reject);
            return;
          }
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () =>
            resolve({
              status: res.statusCode || 200,
              contentType:
                (res.headers["content-type"] as string) ||
                "application/octet-stream",
              body: Buffer.concat(chunks),
              headers: res.headers,
            }),
          );
          res.on("error", reject);
        },
      );
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", reject);
      req.end();
    });

  const getReferer = (hostname: string, pathname: string): string => {
    if (hostname.includes("fourhoi")) {
      const match = pathname.match(/\/([a-z0-9]+-\d+-uncensored-leak)\//i);
      if (match) return `https://missav.ai/cn/${match[1]}`;
      return "https://missav.ai/";
    }
    return "https://missav.ai/";
  };

  protocol.handle("cdn", async (request) => {
    const cdnUrl = request.url.replace("cdn://", "https://");
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(cdnUrl);
    } catch {
      return new Response("Bad URL", { status: 400 });
    }

    if (
      !CDN_DOMAINS.some(
        (d) =>
          parsedUrl.hostname === d || parsedUrl.hostname.endsWith(`.${d}`),
      )
    ) {
      return new Response("Not a CDN domain", { status: 403 });
    }

    const referer = getReferer(parsedUrl.hostname, parsedUrl.pathname);
    const rangeHeader = request.headers.get("range") || undefined;
    const t0 = Date.now();
    const path = parsedUrl.pathname.toLowerCase();
    const isM3u8Path = path.endsWith(".m3u8");
    const isVideoSegment =
      /\.(ts|m4s|mp4|aac)$/.test(path) || /\/\d+p\/.*\.jpeg$/i.test(path);

    // m3u8 命中缓存（VOD manifest 不变）
    if (isM3u8Path && !rangeHeader) {
      const hit = m3u8Cache.get(parsedUrl.href);
      if (hit && Date.now() - hit.t < M3U8_CACHE_MS) {
        console.log(`[CDN] 缓存命中 ${parsedUrl.pathname}`);
        return new Response(hit.body, {
          status: 200,
          headers: {
            "Content-Type": hit.type,
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
    }

    // —— 小文件（封面/m3u8/密钥）直接用 Node https，最稳，避免 net.request 兼容问题 ——
    if (!isVideoSegment) {
      try {
        const r = await fetchWithNode(parsedUrl, referer, rangeHeader);
        console.log(
          `[CDN-https] ${r.status} ${parsedUrl.pathname} (${Date.now() - t0}ms, ${r.contentType})`,
        );
        if (r.status >= 400) {
          console.error(
            `[CDN-https] 上游错误体: ${r.body.toString("utf8").slice(0, 300)}`,
          );
          return new Response(r.body, {
            status: r.status,
            headers: {
              "Content-Type": r.contentType,
              "Access-Control-Allow-Origin": "*",
            },
          });
        }
        if (isM3u8Path) {
          let text = r.body.toString("utf8");
          for (const d of CDN_DOMAINS) {
            const re = new RegExp(
              `https?://([\\w-]+\\.)*${d.replace(/\./g, "\\.")}`,
              "gi",
            );
            text = text.replace(re, (m) =>
              m.replace(/^https?:\/\//i, "cdn://"),
            );
          }
          if (r.status === 200) {
            m3u8Cache.set(parsedUrl.href, {
              body: text,
              type: r.contentType,
              t: Date.now(),
            });
          }
          return new Response(text, {
            status: 200,
            headers: {
              "Content-Type": r.contentType,
              "Access-Control-Allow-Origin": "*",
            },
          });
        }
        return new Response(r.body, {
          status: r.status,
          headers: {
            "Content-Type": r.contentType,
            "Access-Control-Allow-Origin": "*",
            "Content-Length": String(r.body.length),
          },
        });
      } catch (err: any) {
        console.error(
          `[CDN-https] 失败 ${parsedUrl.href}: ${err?.message || err}`,
        );
        return new Response(`Upstream error: ${err?.message || err}`, {
          status: 502,
        });
      }
    }

    // 用 Electron net.request：Chromium 网络栈，自带 HTTP/2 / QUIC / 连接池
    return new Promise<Response>((resolve) => {
      const upstream = net.request({
        method: "GET",
        url: parsedUrl.href,
        redirect: "follow",
        useSessionCookies: false,
      });

      upstream.setHeader(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
      );
      upstream.setHeader("Referer", referer);
      upstream.setHeader(
        "Accept",
        "image/avif,image/webp,image/apng,image/svg+xml,image/*,video/*,*/*;q=0.8",
      );
      upstream.setHeader("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8");
      if (rangeHeader) upstream.setHeader("Range", rangeHeader);

      const timer = setTimeout(() => {
        console.error(`[CDN] 上游超时 ${UPSTREAM_TIMEOUT}ms: ${parsedUrl.href}`);
        try {
          upstream.abort();
        } catch {
          /* ignore */
        }
      }, UPSTREAM_TIMEOUT);

      upstream.on("response", (res) => {
        clearTimeout(timer);
        const status = res.statusCode || 200;
        const contentType =
          (res.headers["content-type"] as string) || "application/octet-stream";
        const isM3u8 =
          /mpegurl|m3u8/i.test(contentType) ||
          parsedUrl.pathname.toLowerCase().endsWith(".m3u8");

        console.log(
          `[CDN] ${status} ${parsedUrl.pathname} (${Date.now() - t0}ms, ${contentType})`,
        );

        if (status >= 400) {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8").slice(0, 300);
            console.error(`[CDN] 上游错误体: ${body}`);
            resolve(new Response(body || `Upstream ${status}`, { status }));
          });
          return;
        }

        // 走到这里 = 视频分段，流式直通
        const earlyChunks: Buffer[] = [];
        let earlyEnded = false;
        let earlyError: Error | null = null;
        let drained = false;

        res.on("data", (chunk: Buffer) => {
          if (!drained) earlyChunks.push(chunk);
        });
        res.on("end", () => {
          if (!drained) earlyEnded = true;
        });
        res.on("error", (err: Error) => {
          if (!drained) earlyError = err;
        });

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            for (const c of earlyChunks) controller.enqueue(new Uint8Array(c));
            if (earlyError) {
              controller.error(earlyError);
              return;
            }
            if (earlyEnded) {
              controller.close();
              return;
            }
            drained = true;
            res.on("data", (chunk: Buffer) =>
              controller.enqueue(new Uint8Array(chunk)),
            );
            res.on("end", () => controller.close());
            res.on("error", (err: Error) => controller.error(err));
          },
          cancel() {
            try {
              upstream.abort();
            } catch {
              /* ignore */
            }
          },
        });

        const respHeaders: Record<string, string> = {
          "Content-Type": /\.jpeg$/i.test(path) ? "video/mp2t" : contentType,
          "Access-Control-Allow-Origin": "*",
        };
        const cl = res.headers["content-length"];
        if (cl) respHeaders["Content-Length"] = String(cl);
        const ar = res.headers["accept-ranges"];
        if (ar) respHeaders["Accept-Ranges"] = String(ar);
        const cr = res.headers["content-range"];
        if (cr) respHeaders["Content-Range"] = String(cr);

        resolve(new Response(stream, { status, headers: respHeaders }));
      });

      upstream.on("error", (err: Error) => {
        clearTimeout(timer);
        console.error(`[CDN] 上游错误 ${parsedUrl.href}: ${err.message}`);
        resolve(new Response(`Upstream error: ${err.message}`, { status: 502 }));
      });

      upstream.on("abort", () => {
        clearTimeout(timer);
      });

      upstream.end();
    });
  });

  console.log("[CDN代理] 已启用 cdn:// 协议 (Electron net)");
}
