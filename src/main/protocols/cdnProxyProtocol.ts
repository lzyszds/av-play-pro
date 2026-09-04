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
  const FULL_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

  const httpsAgent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 30_000,
    maxSockets: 16,
    maxFreeSockets: 16,
  });

  type UpstreamResult = {
    status: number;
    contentType: string;
    body: Buffer;
    headers: Record<string, string | string[] | undefined>;
  };

  const getOriginFromReferer = (referer: string): string | null => {
    try {
      return new URL(referer).origin;
    } catch {
      return null;
    }
  };

  // Electron net + WebView 会话：Chromium TLS 指纹 + cf_clearance，封面/小文件主力通道
  const fetchWithSession = (
    target: URL,
    referer: string,
    rangeHeader?: string,
  ): Promise<UpstreamResult> =>
    new Promise((resolve, reject) => {
      const origin = getOriginFromReferer(referer);
      const upstream = net.request({
        method: "GET",
        url: target.href,
        redirect: "follow",
        session: cdnSession,
        useSessionCookies: true,
      });
      upstream.setHeader("User-Agent", FULL_UA);
      upstream.setHeader("Referer", referer);
      if (origin) upstream.setHeader("Origin", origin);
      upstream.setHeader(
        "Accept",
        "image/avif,image/webp,image/apng,image/svg+xml,image/*,video/*,application/vnd.apple.mpegurl,application/x-mpegURL,*/*;q=0.8",
      );
      upstream.setHeader("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8");
      upstream.setHeader("Sec-Fetch-Site", "cross-site");
      upstream.setHeader("Sec-Fetch-Mode", "cors");
      upstream.setHeader(
        "Sec-Fetch-Dest",
        /\.(jpe?g|png|webp|gif|avif|bmp|svg)(\?|$)/i.test(target.pathname)
          ? "image"
          : "empty",
      );
      if (rangeHeader) upstream.setHeader("Range", rangeHeader);

      const timer = setTimeout(() => {
        try {
          upstream.abort();
        } catch {
          /* ignore */
        }
        reject(new Error("timeout"));
      }, UPSTREAM_TIMEOUT);

      upstream.on("response", (res) => {
        clearTimeout(timer);
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode || 200,
            contentType:
              (res.headers["content-type"] as string) ||
              "application/octet-stream",
            body: Buffer.concat(chunks),
            headers: res.headers as Record<
              string,
              string | string[] | undefined
            >,
          }),
        );
        res.on("error", reject);
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

  // Node https 兜底（无 CF 会话时偶发仍可用；主力已改为 fetchWithSession）
  const fetchWithNode = (
    target: URL,
    referer: string,
    rangeHeader?: string,
  ): Promise<UpstreamResult> =>
    new Promise((resolve, reject) => {
      const origin = getOriginFromReferer(referer);
      const headers: Record<string, string> = {
        "User-Agent": FULL_UA,
        Referer: referer,
        Accept:
          "image/avif,image/webp,image/apng,image/svg+xml,image/*,video/*,application/vnd.apple.mpegurl,application/x-mpegURL,*/*;q=0.8",
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
    if (hostname.includes("fourhoi") || hostname.includes("surrit")) {
      // /miab-678-uncensored-leak/cover-t.jpg → code=miab-678, full=miab-678-uncensored-leak
      const match = pathname.match(
        /\/([a-z0-9]+-\d+)(?:-([a-z0-9-]+))?\//i,
      );
      if (match) {
        const code = match[1];
        const full = match[2] ? `${code}-${match[2]}` : code;
        return unique([
          ...(explicit ? [explicit] : []),
          `https://missav.ai/cn/${code}`,
          `https://missav.ai/cn/${full}`,
          `https://missav.ws/cn/${code}`,
          `https://missav.ws/cn/${full}`,
          `https://missav.com/cn/${code}`,
          `https://missav.com/cn/${full}`,
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

  /** 小文件：先 Electron 会话，再 Node 兜底；403/502 时轮换 Referer */
  const fetchSmallAsset = async (
    target: URL,
    refererCandidates: string[],
    rangeHeader?: string,
  ): Promise<{ result: UpstreamResult; usedReferer: string }> => {
    let lastErr: unknown = null;
    for (const candidate of refererCandidates) {
      try {
        const viaSession = await fetchWithSession(
          target,
          candidate,
          rangeHeader,
        );
        if (viaSession.status === 403 || viaSession.status === 502) {
          console.warn(
            `[CDN-session] ${viaSession.status}，切换 Referer: ${new URL(candidate).host}`,
          );
          lastErr = new Error(`upstream ${viaSession.status}`);
          continue;
        }
        return { result: viaSession, usedReferer: candidate };
      } catch (err) {
        lastErr = err;
        console.warn(
          `[CDN-session] 失败(${new URL(candidate).host}): ${(err as Error)?.message || err}`,
        );
      }
    }

    // Node 兜底（通常会被 CF 拦，但部分镜像仍可用）
    for (const candidate of refererCandidates) {
      try {
        const viaNode = await fetchWithNode(target, candidate, rangeHeader);
        if (viaNode.status === 403 || viaNode.status === 502) {
          console.warn(
            `[CDN-https] ${viaNode.status}，切换 Referer: ${new URL(candidate).host}`,
          );
          lastErr = new Error(`upstream ${viaNode.status}`);
          continue;
        }
        return { result: viaNode, usedReferer: candidate };
      } catch (err) {
        lastErr = err;
      }
    }

    throw lastErr instanceof Error
      ? lastErr
      : new Error(String(lastErr || "No upstream response"));
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
    // 预览短视频体积小，走缓冲通道；分段大文件走下面的流式 net
    const isPreview = /\/preview\.mp4$/i.test(path);
    const isImage =
      /\.(jpe?g|png|webp|gif|avif|bmp|svg)$/i.test(path) ||
      /\/cover[-_]?[a-z]?\.(jpe?g|png|webp)$/i.test(path);
    const isVideoSegment =
      !isPreview &&
      !isImage &&
      (/\.(ts|m4s|mp4|aac)$/.test(path) || /\/\d+p\/.*\.jpeg$/i.test(path));

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

    // —— 封面 / 预览 / 密钥等小文件：Electron 会话优先（绕过 CF 对 Node TLS 指纹的 502）——
    if (!isVideoSegment && !isM3u8Path) {
      try {
        const effectiveRange = isPreview ? undefined : rangeHeader;
        const { result: r, usedReferer } = await fetchSmallAsset(
          parsedUrl,
          refererCandidates,
          effectiveRange,
        );
        console.log(
          `[CDN-small] ${r.status} ${parsedUrl.pathname} (${Date.now() - t0}ms, ${r.contentType}, referer=${new URL(usedReferer).host}, ${r.body.length}B)`,
        );
        if (r.status >= 400) {
          console.error(
            `[CDN-small] 上游错误体: ${r.body.toString("utf8").slice(0, 300)}`,
          );
          return new Response(new Uint8Array(r.body) as any, {
            status: r.status,
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
          `[CDN-small] 失败 ${parsedUrl.href}: ${err?.message || err}`,
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

      upstream.setHeader("User-Agent", FULL_UA);
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
            if (
              (status === 403 || status === 502) &&
              refererIndex + 1 < refererCandidates.length
            ) {
              console.warn(
                `[CDN] ${status}，尝试切换 Referer: ${new URL(refererCandidates[refererIndex + 1]).host}`,
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

  console.log("[CDN代理] 已启用 cdn:// 协议 (Electron net + session)");
}
