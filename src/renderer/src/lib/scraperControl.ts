// 渲染端「一键抓取」的控制总线：
// ScraperWebview（常驻隐藏 webview）注册真正的抓取实现，
// DiscoverPage 通过 runScraper() 调用它，抓取时 webview 会临时弹出可见以便过盾。

export interface ScrapedItem {
  code: string | null;
  title: string;
  url: string;
  cover: string | null;
  preview: string | null;
  duration: string | null;
}

export interface ScrapeRunOpts {
  baseUrl: string;
  startPage: number;
  endPage: number;
  onProgress?: (message: string) => void;
}

export type ScrapeRunner = (opts: ScrapeRunOpts) => Promise<ScrapedItem[]>;

let runner: ScrapeRunner | null = null;

export function registerScraperRunner(fn: ScrapeRunner | null): void {
  runner = fn;
}

export function isScraperReady(): boolean {
  return runner != null;
}

export async function runScraper(opts: ScrapeRunOpts): Promise<ScrapedItem[]> {
  if (!runner) throw new Error("抓取组件尚未就绪，请稍候再试");
  return runner(opts);
}

/** 把带 {page} 占位或 page=N 的地址替换成第 p 页 */
export function pageUrl(baseUrl: string, p: number): string {
  return baseUrl.includes("{page}")
    ? baseUrl.replace("{page}", String(p))
    : baseUrl.replace(/([?&]page=)\d+/, `$1${p}`);
}

// 在真实页面 DOM 里提取列表（等价于 scrape_missav.js 的 extractInPage）。
// String.raw 保留正则反斜杠。
export const EXTRACT_ITEMS_JS = String.raw`(() => {
  try {
    const items = [];
    document.querySelectorAll('.thumbnail.group').forEach((el) => {
      const link = el.querySelector('a[href*="/cn/"]') || el.querySelector('a[href]');
      const url = link ? link.href : null;
      if (!url) return;
      const img = el.querySelector('img[data-src*="cover"], img[src*="cover"]');
      const cover = img ? (img.getAttribute('data-src') || img.getAttribute('src')) : null;
      // 预览视频：<video id="preview-xxx"> 可能把地址放在 data-src / src / 子 <source>
      const video = el.querySelector('video[id^="preview"], video[data-src], video[src], video');
      let preview = null;
      if (video) {
        preview = video.getAttribute('data-src') || video.getAttribute('src');
        if (!preview) {
          const s = video.querySelector('source');
          if (s) preview = s.getAttribute('src') || s.getAttribute('data-src');
        }
      }
      // 兜底：预览与封面同目录，cover-*.jpg → preview.mp4
      if (!preview && cover) preview = cover.replace(/cover-[a-z]+\.jpg.*$/i, 'preview.mp4');
      const titleEl = el.querySelector('a.text-secondary, a[class*="text-secondary"]');
      let duration = null;
      el.querySelectorAll('span').forEach((s) => {
        const t = (s.textContent || '').trim();
        if (!duration && /^\d+:\d+/.test(t)) duration = t;
      });
      items.push({
        code: url.replace(/\/+$/, '').split('/').pop() || null,
        title: titleEl ? titleEl.textContent.trim() : '',
        url,
        cover,
        preview,
        duration,
      });
    });
    return JSON.stringify(items);
  } catch (e) { return '[]'; }
})()`;
