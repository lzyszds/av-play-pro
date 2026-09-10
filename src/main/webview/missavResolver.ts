import { session, type WebContents } from "electron";
import * as vm from "vm";
import { log } from "../logger";
import { curlFetchText } from "../lib/curlFetch";
import { MISSAV_WEB_PARTITION } from "./missavWebSession";

export interface ResolveResult {
  m3u8: string | null;
  /** "html" = 会话直取并解包，"webview" = 隐藏 webview 自动播放嗅探 */
  method: string;
  /** 从页面解出的分辨率变体（WxH 字符串），如 ["1280x720", "1920x1080"] */
  resolutions?: string[];
  /** 最高画质标签，如 "720P" */
  quality?: string | null;
}

/** 从解包后的播放器源文本里提取分辨率变体并给出最高档标签 */
function extractResolutions(material: string): {
  resolutions: string[];
  quality: string | null;
} {
  const seen = new Set<string>();
  let bestHeight = 0;
  const re = /(\d{3,4})x(\d{3,4})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(material))) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    // 只认像视频变体的 WxH（过滤 16x9 之类的噪声；竖屏两者取较小者做高）
    if (a < 400 || a > 4320 || b < 240 || b > 4320) continue;
    const h = Math.min(a, b);
    const key = `${Math.max(a, b)}x${h}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (h > bestHeight) bestHeight = h;
  }
  return {
    resolutions: Array.from(seen),
    quality: bestHeight ? `${bestHeight}P` : null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickM3u8(urls: string[]): string | null {
  const unique = Array.from(new Set(urls.filter(Boolean)));
  if (unique.length === 0) return null;
  // 优先 playlist.m3u8（母带，N_m3u8DL-RE --auto-select 会挑最高码率）
  const playlist = unique.find((u) => /playlist\.m3u8/i.test(u));
  if (playlist) return playlist;
  return unique.find((u) => !/preview/i.test(u)) || unique[0];
}

function extractM3u8FromText(text: string): string[] {
  const out: string[] = [];
  const re = /(https?:\/\/[^"'\\\s<>)]+\.m3u8[^"'\\\s<>)]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

/**
 * 从页面（HTML + 解包后的播放器源）提取 m3u8 与分辨率材料。
 */
function extractPlayableMaterial(html: string): {
  urls: string[];
  material: string;
} {
  const unpacked = unpackPackedCalls(html);
  const material = `${html}\n${unpacked}`;
  return { urls: extractM3u8FromText(material), material };
}

/** 定位所有 "eval(function(p,a,c,k,e,d){...}('payload'...))" 调用的全文 */
function findPackedCalls(html: string): string[] {
  const results: string[] = [];
  const marker = "eval(function(p,a,c,k,e,";
  let idx = html.indexOf(marker);
  while (idx !== -1 && results.length < 40) {
    const call = extractBalancedCall(html, idx);
    if (call) {
      results.push(call);
      idx = html.indexOf(marker, idx + call.length);
    } else {
      idx = html.indexOf(marker, idx + 1);
    }
  }
  return results;
}

/** 从 start（指向 eval 关键字）开始做括号深度扫描，考虑字符串引号，取完整调用 */
function extractBalancedCall(html: string, start: number): string | null {
  let i = start;
  while (i < html.length && html[i] !== "(") i++;
  if (i >= html.length) return null;

  let depth = 0;
  let inQuote: string | null = null;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (inQuote) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inQuote = ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  return null;
}

/** 在隔离 context 里求值 packed 调用（分段执行，单段失败不影响其他） */
function unpackPackedCalls(html: string): string {
  const calls = findPackedCalls(html);
  if (calls.length === 0) return "";
  const parts: string[] = [];
  for (const call of calls) {
    try {
      // call = "eval(fragment)" → 直接求值 fragment，返回解包后的明文
      const expr = call.slice(4);
      const result = vm.runInNewContext(expr, {}, { timeout: 2000 });
      if (typeof result === "string") parts.push(result);
    } catch (error) {
      void error;
    }
  }
  return parts.join("\n");
}

/** 有挑战页特征时才追加更重的通道 */
function looksLikeChallenge(html: string): boolean {
  return /just a moment|challenge-platform/i.test(html);
}

/** Jina 页面通道（r.jina.ai）：目标站直连被挑战时最稳的乡土取页面路径 */
async function fetchDetailHtmlJina(url: string): Promise<string> {
  const jinaUrl = `https://r.jina.ai/${url}`;
  const result = await curlFetchText(jinaUrl, {
    timeoutSec: 90,
    headers: ["x-return-format: html"],
  });
  if (result.status >= 400 || result.body.length < 500) {
    throw new Error(`jina fetch ${result.status}, len=${result.body.length}`);
  }
  return result.body;
}

/** 标注/解析用的详情页 HTML：直连 curl → 会话 → Jina 页面通道（三者覆写不触发播放） */
async function fetchDetailHtml(url: string): Promise<string> {
  // 1. curl 直连（原生指纹）
  try {
    const result = await curlFetchText(url, { timeoutSec: 60 });
    log.info(
      `[resolve] curl detail 状态=${result.status} len=${result.body.length}`,
    );
    if (
      result.status >= 200 &&
      result.status < 400 &&
      result.body.length > 500
    ) {
      if (looksLikeChallenge(result.body)) {
        log.info("[resolve] curl拿到挑战页，转 Jina 页面通道");
      } else {
        return result.body;
      }
    }
  } catch (error) {
    log.warn(`[resolve] curl detail 失败: ${(error as Error)?.message}`);
  }
  // 2. 应用内会话直连
  try {
    return await fetchDetailHtmlSession(url);
  } catch (error) {
    log.warn(
      `[resolve] session detail 失败: ${(error as Error)?.message}，转 Jina 页面通道`,
    );
  }
  // 3. Jina 页面通道（与列表抓取同一条验证过的路径）
  return fetchDetailHtmlJina(url);
}

/** 应用内会话直连兜底（不覆盖 UA，cf_clearance 绑定原 UA） */
async function fetchDetailHtmlSession(url: string): Promise<string> {
  const headers = {
    Accept: "text/html,application/xhtml+xml,*/*",
    Referer: new URL(url).origin + "/",
  };
  const webSession = session.fromPartition(MISSAV_WEB_PARTITION);
  const response = await webSession.fetch(url, { headers });
  const html = await response.text();
  log.info(
    `[resolve] session.fetch detail ${response.status} len=${html.length} (${url})`,
  );
  if (response.status >= 200 && response.status < 400 && html.length > 500) {
    return html;
  }
  throw new Error(`fetch ${response.status}, len=${html.length}`);
}

const RESOLVE_PREFIX = "__AVPLAY_RESOLVE_M3U8__";

/** 页内注入的嗅探钩子：hook fetch/XHR/Hls.loadSource，并自动触发播放 */
const PLAY_HOOK_JS = String.raw`(() => {
  if (window.__AVPLAY_RESOLVE_HOOKED__) return;
  window.__AVPLAY_RESOLVE_HOOKED__ = true;
  var seen = new Set();
  var report = function (u) {
    try {
      if (u && /\.m3u8/i.test(String(u)) && !seen.has(String(u))) {
        seen.add(String(u));
        console.log("__AVPLAY_RESOLVE_M3U8__" + String(u));
      }
    } catch (e) {}
  };
  var of = window.fetch;
  if (of) {
    window.fetch = function () {
      try {
        var input = arguments[0];
        report(typeof input === "string" ? input : input && input.url);
      } catch (e) {}
      return of.apply(this, arguments);
    };
  }
  var oo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function () {
    try { report(String(arguments[1])); } catch (e) {}
    return oo.apply(this, arguments);
  };
  var hookHls = function () {
    try {
      if (window.Hls && window.Hls.prototype && !window.Hls.__avplayHooked) {
        var ls = window.Hls.prototype.loadSource;
        window.Hls.prototype.loadSource = function (u) {
          try { report(u); } catch (e) {}
          return ls.apply(this, arguments);
        };
        window.Hls.__avplayHooked = true;
      }
    } catch (e) {}
  };
  hookHls();
  var hl = window.Hls;
  try {
    Object.defineProperty(window, "Hls", {
      get: function () { return hl; },
      set: function (v) { hl = v; hookHls(); },
      configurable: true,
    });
  } catch (e) {}
  var play = function () {
    try {
      var vv = document.querySelector("video");
      if (vv) vv.muted = true;
    } catch (e) {}
    try { document.querySelector('.plyr__control--overlaid') && document.querySelector('.plyr__control--overlaid').click(); } catch (e) {}
    try { document.querySelector('button[data-plyr="play"]') && document.querySelector('button[data-plyr="play"]').click(); } catch (e) {}
    try {
      var v = document.querySelector("video");
      if (v && v.paused && v.play) v.play();
    } catch (e) {}
  };
  setTimeout(play, 200);
  setTimeout(play, 1200);
  setTimeout(play, 3000);
})();`;

/** 嗅探结束后的静音清理：暂停所有 video 并清空源，杜绝后台播放残留声音 */
const TEARDOWN_JS = String.raw`(() => {
  try {
    document.querySelectorAll("video").forEach(function (v) {
      try { v.pause(); } catch (e) {}
      try { v.muted = true; v.volume = 0; } catch (e) {}
      try { v.removeAttribute("src"); v.load(); } catch (e) {}
    });
  } catch (e) {}
})()`;

/**
 * 在抓取 webview 里加载详情页并等页面就绪（轮询含过盾，最多 60s）。
 * 成功返回 true；调用方负责后续 teardown / release。
 */
async function loadDetailReady(url: string, contents: WebContents): Promise<boolean> {
  if (contents.isDestroyed()) return false;
  if (contents.getURL().split("#")[0] !== url.split("#")[0]) {
    await contents.loadURL(url).catch(() => void 0);
  }
  if (contents.isDestroyed()) return false;

  const readyDeadline = Date.now() + 60_000;
  while (!contents.isDestroyed()) {
    try {
      if (await contents.executeJavaScript("Boolean(document.body)", true)) {
        return true;
      }
    } catch {
      /* 未就绪继续轮询 */
    }
    if (Date.now() + 1000 > readyDeadline) break;
    await sleep(1000);
  }
  return false;
}

/**
 * 中间层兜底：无需播放！在已过盾的抓取 webview 里加载详情页，
 * 拉回整体 outerHTML 后在主进程照常解包提取（能命中 CF 通过后的真实源码）。
 */
async function resolveViaPageSource(
  url: string,
  opts: {
    getWebContents: () => WebContents | null;
    canRelease?: (contents: WebContents) => boolean;
    onRelease?: () => Promise<void>;
  },
): Promise<ResolveResult> {
  const contents = opts.getWebContents();
  if (!contents) {
    return { m3u8: null, method: "webviewSource" };
  }
  try {
    const ready = await loadDetailReady(url, contents);
    if (!ready || contents.isDestroyed()) {
      return { m3u8: null, method: "webviewSource" };
    }
    const html = (await contents.executeJavaScript(
      "document.documentElement.outerHTML",
      true,
    )) as string;
    if (!html || html.length < 500) {
      return { m3u8: null, method: "webviewSource" };
    }
    const { urls, material } = extractPlayableMaterial(html);
    const m3u8 = pickM3u8(urls);
    const res = extractResolutions(material);
    if (m3u8) {
      log.info(
        `[resolve] 页面源解析成功: ${m3u8}${res.quality ? ` (${res.resolutions.join(",")} -> ${res.quality})` : ""}`,
      );
    } else {
      log.info(`[resolve] 页面源未命中 m3u8 (${url})`);
    }
    return {
      m3u8,
      method: "webviewSource",
      resolutions: res.resolutions,
      quality: res.quality,
    };
  } catch (error) {
    log.warn(`[resolve] 页面源解析失败: ${(error as Error)?.message}`);
    return { m3u8: null, method: "webviewSource" };
  } finally {
    await releaseIfAllowed(contents, opts);
  }
}

/**
 * 末级兜底：在已过盾的抓取 webview 里加载详情页，自动点播放（静音），
 * 等 Hls/fetch 发出 m3u8 请求后捕获。
 */
async function resolveViaPlayback(
  url: string,
  opts: {
    getWebContents: () => WebContents | null;
    /** 是否允许在结束后清空该 webview 页面（仅专用抓取 webview） */
    canRelease?: (contents: WebContents) => boolean;
    onRelease?: () => Promise<void>;
  },
): Promise<ResolveResult> {
  const contents = opts.getWebContents();
  if (!contents) {
    log.warn("[resolve] webview 兜底：未找到可用抓取 webview");
    return { m3u8: null, method: "webview" };
  }

  let captured: string | null = null;
  const onConsole = (
    _event: unknown,
    _level: number,
    message: string,
  ): void => {
    if (
      captured ||
      typeof message !== "string" ||
      !message.startsWith(RESOLVE_PREFIX)
    ) {
      return;
    }
    captured = message.slice(RESOLVE_PREFIX.length).trim();
  };

  // 解析期间的播放只允许静音进行；结束后立刻停掉视频，绝不让声音残留
  const wasAudioMuted = contents.audioMuted;
  try {
    contents.setAudioMuted(true);
  } catch {
    void 0;
  }

  const stopPage = async (): Promise<void> => {
    if (contents.isDestroyed()) return;
    await contents.executeJavaScript(TEARDOWN_JS, true).catch(() => void 0);
    try {
      contents.setAudioMuted(wasAudioMuted);
    } catch {
      void 0;
    }
  };

  try {
    contents.on("console-message", onConsole);

    const ready = await loadDetailReady(url, contents);
    if (!ready || contents.isDestroyed()) {
      return { m3u8: null, method: "webview" };
    }

    // 清掉上次嗅探残留的播放状态，再注入钩子触发播放
    await contents.executeJavaScript(TEARDOWN_JS, true).catch(() => void 0);
    await contents.executeJavaScript(PLAY_HOOK_JS, true).catch(() => void 0);

    const deadline = Date.now() + 25_000;
    while (!captured && Date.now() < deadline && !contents.isDestroyed()) {
      await sleep(500);
    }

    await stopPage();
    // 嗅探用完直接释放页面（仅专用抓取 webview；防止后台播放/加载驻留）
    await releaseIfAllowed(contents, opts);
    const m3u8 = captured ? pickM3u8([captured]) : null;
    const res = extractResolutions(m3u8 || "");
    return {
      m3u8,
      method: "webview",
      resolutions: res.resolutions,
      quality: res.quality,
    };
  } catch (error) {
    log.warn(`[resolve] webview 播放嗅探失败: ${(error as Error)?.message}`);
    await stopPage().catch(() => void 0);
    await releaseIfAllowed(contents, opts);
    return { m3u8: null, method: "webview" };
  } finally {
    if (!contents.isDestroyed()) {
      contents.removeListener("console-message", onConsole as never);
    }
  }
}

/** 条件释放：仅当该 webview 是专用抓取 webview 时清空为 about:blank */
async function releaseIfAllowed(
  contents: WebContents,
  opts: {
    canRelease?: (contents: WebContents) => boolean;
    onRelease?: () => Promise<void>;
  },
): Promise<void> {
  if (contents.isDestroyed()) return;
  if (opts.canRelease?.(contents) !== true) return;
  await opts.onRelease?.().catch(() => void 0);
}

/**
 * 拉母带 playlist.m3u8，解析全部 #EXT-X-STREAM-INF 的 RESOLUTION，
 * 返回最高档（如 "1920x1080" -> "1080P"）。curURL 可能是变体直链，
 * 这里照常解析（拿不到就返回空）。
 */
export async function resolveMasterMaxRes(m3u8Url: string): Promise<{
  resolutions: string[];
  quality: string | null;
}> {
  const url = m3u8Url?.trim();
  if (!/^https?:\/\//i.test(url || "")) {
    return { resolutions: [], quality: null };
  }
  try {
    const result = await curlFetchText(url, { timeoutSec: 30 });
    if (result.status >= 400 || !result.body) {
      return { resolutions: [], quality: null };
    }
    // 母带清单：#EXT-X-RESOLUTION / RESOLUTION=WxH；变体直链则兜底从文本全文提
    const { resolutions, quality } = extractResolutions(result.body);
    if (quality) {
      log.info(
        `[resolve] 母带画质: ${result.body.length}B -> ${resolutions.join(",")} (最高 ${quality})`,
      );
      return { resolutions, quality };
    }
    return { resolutions: [], quality: null };
  } catch (error) {
    log.warn(`[resolve] 母带画质解析失败: ${(error as Error)?.message}`);
    return { resolutions: [], quality: null };
  }
}

/** 用母带清单细化 ResolveResult 的分辨率/画质（比解包文本更准） */
async function enrichWithMaster(result: ResolveResult): Promise<ResolveResult> {
  if (!result.m3u8 || (result.method === "none")) return result;
  try {
    const master = await resolveMasterMaxRes(result.m3u8);
    if (master.quality) {
      return {
        ...result,
        resolutions: master.resolutions,
        quality: master.quality,
      };
    }
  } catch {
    /* keep original */
  }
  return result;
}
/**
 * 从 missav 详情页 URL 解析 m3u8 播放地址（无需打开浏览器/插件）。
 * 三级回退：会话直取 HTML → 过盾 webview 页面源码解包（不触发播放）→ 自动播放嗅探。
 * 命中后追加拉母带清单解析最高分辨率。
 */
export async function resolveMissavM3u8(
  detailUrl: string,
  opts: {
    getWebContents: () => WebContents | null;
    /** 是否允许在结束后清空该 webview 页面（仅专用抓取 webview） */
    canRelease?: (contents: WebContents) => boolean;
    onRelease?: () => Promise<void>;
  },
): Promise<ResolveResult> {
  const url = detailUrl?.trim();
  if (!/^https?:\/\//i.test(url || "")) {
    return { m3u8: null, method: "none" };
  }

  // 1. 快路径：会话直取
  try {
    const html = await fetchDetailHtml(url);
    const { urls, material } = extractPlayableMaterial(html);
    const fromHtml = pickM3u8(urls);
    const res = extractResolutions(material);
    if (fromHtml) {
      log.info(
        `[resolve] HTML 解析成功: ${fromHtml}${res.quality ? ` (${res.resolutions.join(",")} -> ${res.quality})` : ""}`,
      );
      return enrichWithMaster({
        m3u8: fromHtml,
        method: "html",
        resolutions: res.resolutions,
        quality: res.quality,
      });
    }
  } catch (error) {
    log.info(
      `[resolve] session.fetch 详情页失败（将走过盾 webview）: ${(error as Error)?.message}`,
    );
  }

  // 2. 过盾 webview 页面源码解包（不开播放）
  const viaPageSource = await resolveViaPageSource(url, opts);
  if (viaPageSource.m3u8) return enrichWithMaster(viaPageSource);

  // 3. 自动播放嗅探
  return resolveViaPlayback(url, opts);
}

/**
 * 分辨率标注：快路径（会话直取）→ 过盾 webview 页面源码解包；全程不触发播放。
 */
export async function resolveMissavQuality(
  detailUrl: string,
  opts: {
    getWebContents: () => WebContents | null;
    canRelease?: (contents: WebContents) => boolean;
    onRelease?: () => Promise<void>;
  },
): Promise<{
  quality: string | null;
  resolutions: string[];
  method: string;
}> {
  const url = detailUrl?.trim();
  if (!/^https?:\/\//i.test(url || "")) {
    return { quality: null, resolutions: [], method: "none" };
  }
  try {
    const html = await fetchDetailHtml(url);
    const { material } = extractPlayableMaterial(html);
    const res = extractResolutions(material);
    if (res.quality) return { ...res, method: "html" };
  } catch {
    /* 转过盾 webview 页面源路径 */
  }
  const viaPageSource = await resolveViaPageSource(url, opts);
  const masterOfPageSource = await enrichWithMaster({
    m3u8: viaPageSource.m3u8,
    method: viaPageSource.method,
    resolutions: viaPageSource.resolutions ?? [],
    quality: viaPageSource.quality ?? null,
  });
  return {
    quality: masterOfPageSource.quality ?? null,
    resolutions: masterOfPageSource.resolutions ?? [],
    method: masterOfPageSource.method,
  };
}

