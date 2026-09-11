/** 将 "1920x1080" 形式的分辨率转为友好标签（4K / 2K / 1080P / 720P / 480P）；无法解析返回空串 */
export function resolutionLabel(res?: string): string {
  if (!res) return "";
  const m = /^(\d{2,5})x(\d{2,5})$/i.exec(res.trim());
  if (!m) return "";
  const w = Number(m[1]);
  const h = Number(m[2]);
  const short = Math.min(w, h); // 竖屏按短边判断
  if (short >= 2160) return "4K";
  if (short >= 1440) return "2K";
  if (short >= 1080) return "1080P";
  if (short >= 720) return "720P";
  if (short >= 480) return "480P";
  return `${w}x${h}`;
}
