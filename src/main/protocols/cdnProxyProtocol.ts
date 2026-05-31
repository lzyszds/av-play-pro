import { protocol } from "electron";
import * as https from "https";
import * as http from "http";

export function setupCdnProxyProtocol(): void {
  const CDN_DOMAINS = ["surrit.com", "surrit.org", "fourhoi.com"];

  // 根据请求路径生成 Referer
  const getReferer = (hostname: string, pathname: string): string => {
    if (hostname.includes("fourhoi")) {
      // 从路径提取番号: /tenn-046-uncensored-leak/cover-n.jpg -> tenn-046-uncensored-leak
      const match = pathname.match(/\/([a-z0-9]+-\d+-uncensored-leak)\//i);
      if (match) return `https://missav.ai/cn/${match[1]}`;
      return "https://missav.ai/";
    }
    return "https://missav.ai/";
  };

  protocol.handle("cdn", (request) => {
    const cdnUrl = request.url.replace("cdn://", "https://");
    const parsedUrl = new URL(cdnUrl);
    const isCdnDomain = CDN_DOMAINS.some(
      (d) => parsedUrl.hostname === d || parsedUrl.hostname.endsWith(`.${d}`),
    );
    if (!isCdnDomain) return new Response("Not a CDN domain", { status: 403 });

    const referer = getReferer(parsedUrl.hostname, parsedUrl.pathname);

    return new Promise<Response>((resolve) => {
      const mod = parsedUrl.protocol === "https:" ? https : http;
      const req = mod.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
          path: parsedUrl.pathname + parsedUrl.search,
          method: "GET",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
            Referer: referer,
            Accept:
              "image/avif,image/webp,image/apng,image/svg+xml,image/*,video/*,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "sec-ch-ua":
              '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            resolve(
              new Response(Buffer.concat(chunks), {
                status: res.statusCode || 200,
                headers: {
                  "Content-Type":
                    res.headers["content-type"] || "application/octet-stream",
                  "Access-Control-Allow-Origin": "*",
                },
              }),
            );
          });
        },
      );
      req.on("error", (err: Error) => {
        resolve(
          new Response(`CDN Proxy Error: ${err.message}`, { status: 502 }),
        );
      });
      req.end();
    });
  });
  console.log("[CDN代理] 已启用 cdn:// 协议");
}
