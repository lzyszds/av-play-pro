import { extname } from "path";

const MEDIA_MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".ts": "video/mp2t",
  ".flv": "video/x-flv",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
  ".vtt": "text/vtt; charset=utf-8",
};
export const guessMime = (p: string): string =>
  MEDIA_MIME[extname(p).toLowerCase()] || "application/octet-stream";
