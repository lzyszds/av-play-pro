import { protocol, net, session } from "electron";
import * as https from "https";
import { MISSAV_WEB_PARTITION } from "../webview/missavWebSession";

export function setupCdnProxyProtocol(): void {
  const CDN_DOMAINS = ["surrit.com", "surrit.org", "fourhoi.com"];
  const UPSTREAM_TIMEOUT = 15000;
  const M3U8_CACHE_MS = 5 * 60_000;
  const REFERER_PARAM = "__avp_referer";
  const m3u8Cache = new Map<string, { body: string; type: string; t: number }>();
  const cdnSession = session.fromPartition(MISSAV_WEB_PARTITION);

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
      const origin = getOriginFromReferer(referer);
      const headers: Record<string, string> = {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
        Referer: referer,
        Accept:
          "application/vnd.apple.mpegurl,application/x-mpegURL,video/*,image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Sec-Fetch-Site": "cross-site",
      };
      if (origin) headers["Origin"] = origin;
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

  const getOriginFromReferer = (referer: string): string | null => {
    try {
      return new URL(referer).origin;
    } catch {
      return null;
    }
  };

  const unique = (items: string[]): string[] => Array.from(new Set(items));

  const getRefererCandidates = (
    hostname: string,
    pathname: string,
    request: Request,
    explicitReferer?: string | null,
  ): string[] => {
    const explicit = explicitReferer || request.headers.get("x-avp-referer");

    const roots = [
      "https://missav.ai/",
      "https://missav.ws/",
      "https://missav.com/",
    ];
    if (hostname.includes("fourhoi")) {
      const match = pathname.match(
        /\/([a-z0-9]+-\d+(?:-uncensored-leak)?)\//i,
      );
      if (match) {
        return unique([
          ...(explicit ? [explicit] : []),
          `https://missav.ai/cn/${match[1]}`,
          `https://missav.ws/cn/${match[1]}`,
          `https://missav.com/cn/${match[1]}`,
          ...roots,
        ]);
      }
    }
    return unique([...(explicit ? [explicit] : []), ...roots]);
  };

  const isAllowedCdnHost = (hostname: string): boolean =>
    CDN_DOMAINS.some(
      (d) => hostname === d || hostname.endsWith(`.${d}`),
    );

  const toCdnUrl = (target: URL, referer: string): string => {
    const cloned = new URL(target.href);
    cloned.searchParams.set(REFERER_PARAM, referer);
    return `cdn://${cloned.host}${cloned.pathname}${cloned.search}${cloned.hash}`;
  };

  const rewriteM3u8Body = (
    body: string,
    baseUrl: URL,
    referer: string,
  ): string => {
    const withAbsoluteUrls = body.replace(
      /https?:\/\/[^\s'",)]+/gi,
      (match) => {
        try {
          const target = new URL(match);
          if (!isAllowedCdnHost(target.hostname)) return match;
          return toCdnUrl(target, referer);
        } catch {
          return match;
        }
      },
    );

    return withAbsoluteUrls
      .split(/\r?\n/)
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return line;
        try {
          const target = new URL(trimmed, baseUrl);
          if (!isAllowedCdnHost(target.hostname)) return line;
          return toCdnUrl(target, referer);
        } catch {
          return line;
        }
      })
      .join("\n");
  };

  protocol.handle("cdn", async (request) => {
    const cdnUrl = request.url.replace("cdn://", "https://");
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(cdnUrl);
    } catch {
      return new Response("Bad URL", { status: 400 });
    }

    const explicitReferer = parsedUrl.searchParams.get(REFERER_PARAM);
    parsedUrl.searchParams.delete(REFERER_PARAM);

    if (!isAllowedCdnHost(parsedUrl.hostname)) {
      return new Response("Not a CDN domain", { status: 403 });
    }

    const refererCandidates = getRefererCandidates(
      parsedUrl.hostname,
      parsedUrl.pathname,
      request,
      explicitReferer,
    );
    const rangeHeader = request.headers.get("range") || undefined;
    const t0 = Date.now();
    const path = parsedUrl.pathname.toLowerCase();
    const isM3u8Path = path.endsWith(".m3u8");
    const m3u8CacheKey = `${parsedUrl.href}::${refererCandidates[0] || ""}`;
    const isVideoSegment =
      /\.(ts|m4s|mp4|aac)$/.test(path) || /\/\d+p\/.*\.jpeg$/i.test(path);

    // m3u8 命中缓存（VOD manifest 不变）
    if (isM3u8Path && !rangeHeader) {
      const hit = m3u8Cache.get(m3u8CacheKey);
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

    // —— 小文件（封面/密钥）可直接用 Node https。m3u8 走 Electron net 复用 WebView 的 CF cookie。 ——
    if (!isVideoSegment && !isM3u8Path) {
      try {
        let r: Awaited<ReturnType<typeof fetchWithNode>> | null = null;
        let usedReferer = refererCandidates[0];
        for (const candidate of refererCandidates) {
          const attempt = await fetchWithNode(parsedUrl, candidate, rangeHeader);
          r = attempt;
          usedReferer = candidate;
          if (attempt.status !== 403) break;
          console.warn(
            `[CDN-https] 403，尝试切换 Referer: ${new URL(candidate).host}`,
          );
        }
        if (!r) throw new Error("No upstream response");
        console.log(
          `[CDN-https] ${r.status} ${parsedUrl.pathname} (${Date.now() - t0}ms, ${r.contentType}, referer=${new URL(usedReferer).host})`,
        );
        if (r.status >= 400) {
          console.error(
            `[CDN-https] 上游错误体: ${r.body.toString("utf8").slice(0, 300)}`,
          );
          return new Response(new Uint8Array(r.body) as any, {
            status: r.status,
            headers: {
              "Content-Type": r.contentType,
              "Access-Control-Allow-Origin": "*",
            },
          });
        }
        if (isM3u8Path) {
          const text = rewriteM3u8Body(
            r.body.toString("utf8"),
            parsedUrl,
            usedReferer,
          );
          if (r.status === 200) {
            m3u8Cache.set(`${parsedUrl.href}::${usedReferer}`, {
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
        return new Response(new Uint8Array(r.body) as any, {
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
      const openUpstream = (refererIndex: number) => {
      const referer = refererCandidates[refererIndex] || refererCandidates[0];
      const upstream = net.request({
        method: "GET",
        url: parsedUrl.href,
        redirect: "follow",
        session: cdnSession,
        useSessionCookies: true,
      });

      upstream.setHeader(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
      );
      upstream.setHeader("Referer", referer);
      const origin = getOriginFromReferer(referer);
      if (origin) upstream.setHeader("Origin", origin);
      upstream.setHeader(
        "Accept",
        "application/vnd.apple.mpegurl,application/x-mpegURL,video/*,image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      );
      upstream.setHeader("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8");
      upstream.setHeader("Sec-Fetch-Site", "cross-site");
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
          `[CDN] ${status} ${parsedUrl.pathname} (${Date.now() - t0}ms, ${contentType}, referer=${new URL(referer).host})`,
        );

        if (status >= 400) {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8").slice(0, 300);
            console.error(`[CDN] 上游错误体: ${body}`);
            if (status === 403 && refererIndex + 1 < refererCandidates.length) {
              console.warn(
                `[CDN] 403，尝试切换 Referer: ${new URL(refererCandidates[refererIndex + 1]).host}`,
              );
              openUpstream(refererIndex + 1);
              return;
            }
            resolve(new Response(body || `Upstream ${status}`, { status }));
          });
          return;
        }

        if (isM3u8) {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const text = rewriteM3u8Body(
              Buffer.concat(chunks).toString("utf8"),
              parsedUrl,
              referer,
            );
            if (status === 200 && !rangeHeader) {
              m3u8Cache.set(`${parsedUrl.href}::${referer}`, {
                body: text,
                type: contentType,
                t: Date.now(),
              });
            }
            resolve(
              new Response(text, {
                status,
                headers: {
                  "Content-Type": contentType,
                  "Access-Control-Allow-Origin": "*",
                },
              }),
            );
          });
          res.on("error", (err: Error) => {
            resolve(new Response(`Upstream error: ${err.message}`, { status: 502 }));
          });
          return;
        }

        // 走到这里 = 视频分段/二进制资源，流式直通
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
      };

      openUpstream(0);
    });
  });

  console.log("[CDN代理] 已启用 cdn:// 协议 (Electron net)");
}
