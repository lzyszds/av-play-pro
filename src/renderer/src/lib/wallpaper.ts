import type { DownloadBackground } from "../pages/download/types";

/**
 * 壁纸按“实际摆放尺寸”分级解码，而不是无谓地把 3840~6000px 的整幅原图全量解出来。
 *
 * 原图（public/1.webp~7.webp，宽 3840~6000）：仅供超大屏 / 高 DPI 需要时才解码。
 * HD（public/wallpaper-hd，宽 2560）：全屏背景、加载遮罩、隐私屏保等装饰性场景的默认档——
 *   它们大多被压暗 / 渐变叠加 / 平移，2560 宽与源图观感基本一致，解码像素量却少一半以上。
 * THUMB（public/wallpaper-thumbs，宽 1280）：设置页选择卡片与实时预览这类百级像素小图。
 *
 * 同一张壁纸在不同场景取不同档，杜绝设置页 8 张大图全量解码造成的主线程卡顿。
 */
export const WALLPAPER_HD_WIDTH = 2560;

/** 全屏 / 装饰性场景：按当前窗口物理像素需要选择 HD 或原图 */
export function wallpaperScreenUrl(id: DownloadBackground): string {
  const dpr = window.devicePixelRatio || 1;
  const needed = Math.max(window.innerWidth, window.innerHeight) * dpr;
  return needed > WALLPAPER_HD_WIDTH
    ? `./${id}.webp`
    : `./wallpaper-hd/${id}.webp`;
}

/** 设置页缩略卡片 / 实时预览：统一走 1280px 压缩图 */
export function wallpaperThumbUrl(id: DownloadBackground): string {
  return `./wallpaper-thumbs/${id}.webp`;
}
