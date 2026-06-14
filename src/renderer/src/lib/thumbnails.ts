import { trpc } from "./trpc";

const THUMB_W = 120;
const THUMB_H = 68;
const COLS = 10;
const WEBP_QUALITY = 0.75;

export class CancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "CancelledError";
  }
}

// 由本地 mp4 url 推导文件夹绝对路径（Windows）
export function deriveFolderFromUrl(url: string): string | null {
  if (!/^(local-media|file):\/\/\//.test(url)) return null;
  const rest = url.replace(/^(local-media|file):\/\/\//, "");
  const decoded = decodeURIComponent(rest);
  const lastSlash = Math.max(
    decoded.lastIndexOf("/"),
    decoded.lastIndexOf("\\"),
  );
  if (lastSlash < 0) return null;
  return decoded.substring(0, lastSlash).replace(/\//g, "\\");
}

// 把绝对路径转回 local-media:// URL（保留盘符大写不编码）
export function pathToLocalMediaUrl(absPath: string): string {
  const normalized = absPath.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const encoded = segments.map((seg, i) =>
    i === 0 && /^[a-zA-Z]:$/.test(seg) ? seg : encodeURIComponent(seg),
  );
  return `local-media:///${encoded.join("/")}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatVttTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const sStr = s.toFixed(3).padStart(6, "0");
  return `${pad(h)}:${pad(m)}:${sStr}`;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  // 分块避免栈溢出（apply 上限 ~125k 参数）
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + CHUNK) as unknown as number[],
    );
  }
  return btoa(s);
}

export interface GenerateOptions {
  videoUrl: string;
  folder: string;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CancelledError();
}

/**
 * 生成视频的雪碧图缩略图 + WebVTT，落盘到 folder 下:
 *   thumbs.jpg, thumbs.vtt
 * 自动按视频时长选择密度: max(20, min(120, duration/5)) 张
 */
export async function generateAndSaveThumbnails(
  opts: GenerateOptions,
): Promise<{ count: number; spriteSizeKB: number }> {
  const { videoUrl, folder, onProgress, signal } = opts;
  checkCancelled(signal);

  const video = document.createElement("video");
  video.src = videoUrl;
  video.muted = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  video.playsInline = true;

  // 等待元数据加载
  await new Promise<void>((resolve, reject) => {
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error("video load error"));
    };
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onErr);
    };
    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("error", onErr);
    video.load();
  });

  const duration = video.duration;
  if (!isFinite(duration) || duration <= 0) {
    throw new Error("invalid video duration");
  }

  const N = Math.max(20, Math.min(300, Math.floor(duration / 5)));
  const rows = Math.ceil(N / COLS);
  const interval = duration / N;

  const sprite = document.createElement("canvas");
  sprite.width = COLS * THUMB_W;
  sprite.height = rows * THUMB_H;
  const ctx = sprite.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context not available");

  const vttLines: string[] = ["WEBVTT", ""];

  for (let i = 0; i < N; i++) {
    checkCancelled(signal);
    const t = i * interval;
    await new Promise<void>((resolve, reject) => {
      const onSeek = () => {
        cleanup();
        resolve();
      };
      const onErr = () => {
        cleanup();
        reject(new Error("seek error"));
      };
      const onAbort = () => {
        cleanup();
        reject(new CancelledError());
      };
      const cleanup = () => {
        video.removeEventListener("seeked", onSeek);
        video.removeEventListener("error", onErr);
        signal?.removeEventListener("abort", onAbort);
      };
      video.addEventListener("seeked", onSeek);
      video.addEventListener("error", onErr);
      signal?.addEventListener("abort", onAbort);
      video.currentTime = t;
    });

    const x = (i % COLS) * THUMB_W;
    const y = Math.floor(i / COLS) * THUMB_H;
    ctx.drawImage(video, x, y, THUMB_W, THUMB_H);

    const endT = Math.min((i + 1) * interval, duration);
    vttLines.push(`${formatVttTime(t)} --> ${formatVttTime(endT)}`);
    vttLines.push(`thumbs.webp#xywh=${x},${y},${THUMB_W},${THUMB_H}`);
    vttLines.push("");

    onProgress?.(i + 1, N);
  }

  checkCancelled(signal);
  const blob = await new Promise<Blob | null>((resolve) =>
    sprite.toBlob(resolve, "image/webp", WEBP_QUALITY),
  );
  if (!blob) throw new Error("toBlob failed");

  const buf = await blob.arrayBuffer();
  const base64 = arrayBufferToBase64(buf);

  const res = (await trpc.videos.writeThumbs.mutate({
    folder,
    webpBase64: base64,
    vttText: vttLines.join("\n"),
  })) as { success: boolean; error?: string };
  if (!res.success) throw new Error(res.error || "write failed");

  // 清理
  video.removeAttribute("src");
  video.load();

  return { count: N, spriteSizeKB: Math.round(buf.byteLength / 1024) };
}
