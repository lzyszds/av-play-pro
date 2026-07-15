// 把 fourhoi/surrit 等 CDN 图片地址改写成 app 的 cdn:// 协议，
// 由主进程代理带上正确的 Referer(missav.ai)，绕过 403。
const CDN_DOMAINS = ["surrit.com", "surrit.org", "fourhoi.com"];

function isCdnHost(hostname: string): boolean {
  return CDN_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`));
}

/** 若是受支持的 CDN 图片则改写为 cdn://，否则原样返回 */
export function toCdnImg(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if ((u.protocol === "https:" || u.protocol === "http:") && isCdnHost(u.hostname)) {
      return `cdn://${u.host}${u.pathname}${u.search}${u.hash}`;
    }
  } catch {
    /* 非法 URL，原样返回 */
  }
  return url;
}
