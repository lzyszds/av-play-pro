import type { DownloadTask } from "./types";

export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (
    parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + " " + sizes[i]
  );
}

export function extractVideoCode(text?: string): string | null {
  const match = text?.match(/[A-Z]{2,6}-\d{3,5}/i);
  return match ? match[0].toUpperCase() : null;
}

const CDN_PROXY_BASE = "http://127.0.0.1:39528/m";

export function getCoverUrlFromName(name: string): string | undefined {
  const code = extractVideoCode(name)?.toLowerCase();
  if (!code) return undefined;
  // cover-t.jpg 是 missav 缩略图，几乎一定存在；代理服务器 404 时会自动尝试 cover-n/cover
  const target = `https://fourhoi.com/${code}-uncensored-leak/cover-t.jpg`;
  const proxy = new URL(CDN_PROXY_BASE);
  proxy.searchParams.set("u", target);
  proxy.searchParams.set("r", `https://missav.ai/cn/${code}-uncensored-leak`);
  return proxy.toString();
}

export function toProxiedAssetUrl(url?: string): string | undefined {
  if (!url) return undefined;
  if (
    url.startsWith("http://127.0.0.1:39528/") ||
    url.startsWith("local-media://") ||
    url.startsWith("file://")
  ) {
    return url;
  }

  try {
    // 兼容旧的 cdn:// 协议地址，先转回 https://
    let normalized = url;
    if (normalized.startsWith("cdn://")) {
      normalized = "https://" + normalized.slice(6);
    }
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    const shouldProxy =
      host === "fourhoi.com" ||
      host.endsWith(".fourhoi.com") ||
      host === "surrit.com" ||
      host.endsWith(".surrit.com") ||
      host === "surrit.org" ||
      host.endsWith(".surrit.org");

    if (!shouldProxy) return url;

    const proxy = new URL(CDN_PROXY_BASE);
    proxy.searchParams.set("u", normalized);
    // 从路径推导 referer
    const match = parsed.pathname.match(/\/([a-z0-9]+-\d+)(?:-([a-z0-9-]+))?\//i);
    if (match) {
      const full = match[2] ? `${match[1]}-${match[2]}` : match[1];
      proxy.searchParams.set("r", `https://missav.ai/cn/${full}`);
    }
    return proxy.toString();
  } catch {
    return url;
  }
}

/** 任务封面：优先用任务自带地址；为空时从任务名推导 CDN 封面兜底 */
export function resolveTaskCoverUrl(
  task: { coverUrl?: string; name?: string },
  options?: { allowRemote?: boolean },
): string | undefined {
  const allowRemote = options?.allowRemote !== false;
  // 1. 优先用任务自带的 coverUrl
  let proxied = toProxiedAssetUrl(task.coverUrl);
  // 2. 为空时从任务名推导 fourhoi 封面（cover-n.jpg）
  if (!proxied && task.name) {
    proxied = getCoverUrlFromName(task.name);
  }
  if (!proxied) return undefined;
  const isRemote =
    proxied.startsWith("http://127.0.0.1:39528/") ||
    proxied.startsWith("https://") ||
    proxied.startsWith("http://");
  if (isRemote && !allowRemote) return undefined;
  return proxied;
}
export function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec === 0) return "0 KB/s";
  const mbs = bytesPerSec / (1024 * 1024);
  if (mbs >= 1) return `${mbs.toFixed(2)} MB/s`;
  return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
}

export function parseHeadersText(text: string): string {
  if (!text.trim()) return "{}";
  const obj: Record<string, string> = {};
  text.split("\n").forEach((line) => {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.substring(0, idx).trim();
      const value = line.substring(idx + 1).trim();
      if (key && value) obj[key] = value;
    }
  });
  return JSON.stringify(obj);
}

export function generateN3u8DLCommand(task: DownloadTask): string {
  const parts: string[] = [];
  parts.push('"N_m3u8DL-RE.exe"');
  parts.push(`"${task.url}"`);
  if (task.savePath) parts.push(`--save-dir "${task.savePath}"`);
  if (task.name)
    parts.push(`--save-name "${task.name.replace(/[\\/:*?"<>|]/g, "_")}"`);
  if (task.format === "MP4") {
    parts.push("--auto-select");
    parts.push("--mp4-real-time-decryption");
  } else if (task.format === "MKV") {
    parts.push("--auto-select");
    parts.push("--mkv-real-time-decryption");
  } else {
    parts.push("--auto-select");
  }
  if (task.threads) parts.push(`--thread-count ${task.threads}`);
  if (task.headers) {
    try {
      const h = JSON.parse(task.headers);
      Object.entries(h).forEach(([k, v]) => {
        if (k && v) parts.push(`--headers "${k}: ${v}"`);
      });
    } catch {
      task.headers.split("\n").forEach((l) => {
        const t = l.trim();
        if (t && t.includes(":")) parts.push(`--headers "${t}"`);
      });
    }
  }
  parts.push("--check-segments-count true");
  parts.push("--log-level info");
  return parts.join(" ");
}
