// 把 fourhoi/surrit 等 CDN 图片地址改写成走本地 HTTP 代理（127.0.0.1:39528），
// 由主进程代理带上正确的 Referer(missav.ai)，绕过 Cloudflare 403。
// 不再使用 cdn:// 自定义协议——Chromium 网络栈对自定义协议的 Referer 校验有坑。
const CDN_DOMAINS = ["surrit.com", "surrit.org", "fourhoi.com"];
const PROXY_BASE = "http://127.0.0.1:39528/m";

function isCdnHost(hostname: string): boolean {
  return CDN_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`));
}

/** 从 CDN 路径推导出合适的 missav 详情页 referer */
function deriveReferer(pathname: string): string {
  const match = pathname.match(/\/([a-z0-9]+-\d+)(?:-([a-z0-9-]+))?\//i);
  if (match) {
    const code = match[1];
    const full = match[2] ? `${code}-${match[2]}` : code;
    return `https://missav.ai/cn/${full}`;
  }
  return "https://missav.ai/";
}

/** 若是受支持的 CDN 图片则改写为本地代理地址，否则原样返回 */
export function toCdnImg(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if ((u.protocol === "https:" || u.protocol === "http:") && isCdnHost(u.hostname)) {
      const referer = deriveReferer(u.pathname);
      const proxy = new URL(PROXY_BASE);
      proxy.searchParams.set("u", u.href);
      proxy.searchParams.set("r", referer);
      return proxy.toString();
    }
  } catch {
    /* 非法 URL，原样返回 */
  }
  return url;
}
