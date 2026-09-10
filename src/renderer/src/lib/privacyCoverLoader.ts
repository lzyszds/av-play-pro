import type { LoaderStyle } from "../pages/download/types";

/**
 * 隐私模式图片占位桥：
 * 开启后隐藏全应用所有 <img>，并在旁边注入与 CoverLoader 一致的
 * .cover-placeholder 封面加载动画占位层（跟随「封面加载动画」设置样式）。
 * 视频与内联 background-image 由 globals.css 的 .privacy-image-mode 规则处理。
 */

const VALID_LOADERS: LoaderStyle[] = [
  "eq",
  "vinyl",
  "wave",
  "radar",
  "prism",
  "matrix",
  "orbit",
  "pulse",
  "scan",
];

// 与 CoverLoader.tsx 各 variant markup 保持一致
function loaderMarkup(variant: LoaderStyle): string {
  switch (variant) {
    case "wave":
      return '<div class="cover-wave"><span /><span /><span /><span /><span /></div>';
    case "radar":
      return '<div class="cover-radar"><span /></div>';
    case "prism":
      return '<div class="cover-prism"><span /><span /><span /></div>';
    case "vinyl":
      return '<div class="cover-vinyl"><div class="cover-vinyl-disc"><div class="cover-vinyl-label" /></div></div>';
    case "matrix":
      return '<div class="cover-matrix"><span /><span /><span /><span /><span /><span /><span /><span /><span /></div>';
    case "orbit":
      return '<div class="cover-orbit"><span /><span /><span /></div>';
    case "pulse":
      return '<div class="cover-pulse"><span /><span /></div>';
    case "scan":
      return '<div class="cover-scope"><span /><span /><span /><span /></div>';
    case "eq":
    default:
      return '<div class="cover-eq"><span /><span /><span /><span /><span /></div><div class="cover-scanline" />';
  }
}

function normalizeVariant(value?: unknown): LoaderStyle {
  const el: Record<string, unknown> =
    typeof document === "object" && document.documentElement
      ? (document.documentElement.dataset as Record<string, unknown>)
      : {};
  const cur = value ?? el.loader;
  return VALID_LOADERS.includes(cur as LoaderStyle)
    ? (cur as LoaderStyle)
    : "eq";
}

function buildPlaceholder(): HTMLElement {
  const wrap = document.createElement("div");
  // cover-placeholder 复用封面加载动画的渐变底色与光效（globals.css 已定义）
  wrap.className = "privacy-cover-loader cover-placeholder";
  wrap.setAttribute("aria-hidden", "true");
  wrap.innerHTML = loaderMarkup(normalizeVariant());
  return wrap;
}

/** 应用 logo、favicon 等不需要隐藏的图片直接跳过 */
function isLogoImg(img: HTMLImageElement): boolean {
  const src =
    img.getAttribute("src") ||
    img.getAttribute("data-src") ||
    img.currentSrc ||
    "";
  return /logo\b|logo\.|favicon/i.test(src);
}

function hideImg(img: HTMLImageElement): void {
  // logo 不隐藏
  if (isLogoImg(img)) return;
  img.dataset.privacyHidden = "1";
  img.style.setProperty("visibility", "hidden", "important");

  const parent = img.parentElement;
  if (parent) {
    // 占位层 absolute inset-0 需要父级有定位；仅对 static 父级补 relative 并标记以便还原
    const pos = getComputedStyle(parent).position;
    if (pos === "static") {
      parent.dataset.privacyPosFixed = "1";
      parent.style.position = "relative";
    }
  }

  if (!img.nextElementSibling?.classList.contains("privacy-cover-loader")) {
    img.insertAdjacentElement("afterend", buildPlaceholder());
  }
}

function restoreImg(img: HTMLImageElement): void {
  img.style.removeProperty("visibility");
  delete img.dataset.privacyHidden;

  const next = img.nextElementSibling;
  if (next?.classList.contains("privacy-cover-loader")) next.remove();

  const parent = img.parentElement;
  if (parent && parent.dataset.privacyPosFixed) {
    parent.style.removeProperty("position");
    delete parent.dataset.privacyPosFixed;
  }
}

function scanAll(hide: boolean): void {
  const imgs = document.querySelectorAll<HTMLImageElement>("img");
  imgs.forEach((img) => (hide ? hideImg(img) : restoreImg(img)));
}

let observer: MutationObserver | null = null;
let sweepTimer: number | null = null;

function observeTarget(target: Node): void {
  if (!(target instanceof HTMLElement)) return;
  const scope = target instanceof HTMLImageElement ? target.parentElement : target;
  if (!scope) return;
  scope.querySelectorAll<HTMLImageElement>("img").forEach(hideImg);
  if (scope === target.parentElement && target instanceof HTMLImageElement) {
    hideImg(target);
  }
}

function disconnectAll(): void {
  observer?.disconnect();
  observer = null;
  if (sweepTimer) {
    window.clearInterval(sweepTimer);
    sweepTimer = null;
  }
  document.querySelectorAll<HTMLImageElement>("img").forEach(restoreImg);
  document
    .querySelectorAll<HTMLElement>(".privacy-cover-loader")
    .forEach((el) => el.remove());
  document
    .querySelectorAll<HTMLElement>("[data-privacy-pos-fixed]")
    .forEach((el) => {
      el.style.removeProperty("position");
      delete el.dataset.privacyPosFixed;
    });
}

function connect(): void {
  scanAll(true);

  observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "childList") {
        r.addedNodes.forEach(observeTarget);
        // 图片被 React 移除但占位层残留时清理
        r.removedNodes.forEach((n) => {
          if (n instanceof HTMLImageElement) {
            const next = n.nextElementSibling;
            if (next?.classList.contains("privacy-cover-loader")) next.remove();
          }
        });
      }
      // 未判断 / lazy-load 场景：禁止 src 变化是主途，而 style/class 高频变化不重复叠处理
      else if (r.target instanceof HTMLImageElement) {
        hideImg(r.target);
      }
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    // style/class 高频变化（驱动动画/肆色）不进观察，避免 observer 大量回调
    attributeFilter: ["src", "data-src"],
  });

  // 定期兜底重扫（个别组件可能在 observer 建立前已挂载/改属性）
  sweepTimer = window.setInterval(() => scanAll(true), 10000);
}

/** 开关入口：由 App 在设置变化时调用 */
export function setPrivacyCoverLoaderMode(on: boolean): void {
  if (on) {
    connect();
  } else {
    disconnectAll();
  }
}

/** 「封面加载动画」样式变化时，刷新已注入占位层的动画（无需重置开关） */
export function refreshPrivacyLoaderStyle(): void {
  const markup = loaderMarkup(normalizeVariant());
  document
    .querySelectorAll<HTMLElement>(".privacy-cover-loader")
    .forEach((el) => {
      el.innerHTML = markup;
    });
}
