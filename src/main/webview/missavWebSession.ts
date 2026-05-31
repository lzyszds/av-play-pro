import { app, session, type Session, type WebContents } from "electron";
import * as fs from "fs";
import * as path from "path";
import { resolveExtensionPath } from "../extensions/extensionPath";
import { emitExtensionTaskPush } from "../extensions/pushServer";
import { getAdBlockScript } from "./adBlockScript";

export const MISSAV_WEB_PARTITION = "persist:missav-web";
const EXTENSION_PUSH_CONSOLE_PREFIX = "__AVPLAY_EXTENSION_PUSH__";

const AD_HOST_KEYWORDS = [
  "doubleclick.net",
  "googlesyndication.com",
  "googletagservices.com",
  "google-analytics.com",
  "googletagmanager.com",
  "adservice.google.",
  "exoclick.com",
  "exosrv.com",
  "juicyads.com",
  "trafficjunky.net",
  "trafficjunky.com",
  "adsterra.com",
  "propellerads.com",
  "propeller-tracking.com",
  "onclickads.net",
  "popads.net",
  "popcash.net",
  "hilltopads.net",
  "smartadserver.com",
  "criteo.com",
  "taboola.com",
  "outbrain.com",
  "mgid.com",
  "revcontent.com",
  "adnxs.com",
  "adsrvr.org",
  "histats.com",
  "ad-score.com",
  "a-ads.com",
  "adform.net",
  "magsrv.com",
  "tsyndicate.com",
  "tsyndicate.net",
  "bebi.com",
  "trafficfactory.biz",
  "trafficfactory.com",
  "ad-maven.com",
  "adkernel.com",
  "ero-advertising.com",
  "adnium.com",
  "adnami.io",
];

const ALLOWED_FRAME_HOST_KEYWORDS = ["missav", "fourhoi", "localhost"];

const AD_URL_PATTERNS = [
  /(^|[./_-])adserver([./_-]|$)/i,
  /(^|[./_-])ads?([./_-]|$)/i,
  /(^|[./_-])banner([./_-]|$)/i,
  /(^|[./_-])popunder([./_-]|$)/i,
  /(^|[./_-])prebid([./_-]|$)/i,
  /(^|[./_-])vast([./_-]|$)/i,
  /\/pagead\//i,
  /\/adserve\//i,
];

let configured = false;
let blockedAdRequests = 0;
let snifferSourceCache: string | null = null;

function isMediaUrl(url: string): boolean {
  return /\.(m3u8|mp4|m4v|webm|ts|m4s)(\?|#|$)/i.test(url);
}

function shouldBlockAdRequest(url: string, resourceType = ""): boolean {
  if (!/^https?:\/\//i.test(url) || isMediaUrl(url)) return false;

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const path = `${parsed.pathname}${parsed.search}`;

    if (AD_HOST_KEYWORDS.some((keyword) => hostname.includes(keyword))) {
      return true;
    }

    if (
      resourceType === "subFrame" &&
      !ALLOWED_FRAME_HOST_KEYWORDS.some((keyword) => hostname.includes(keyword))
    ) {
      return true;
    }

    if (resourceType === "mainFrame" || resourceType === "media") {
      return false;
    }

    return AD_URL_PATTERNS.some((pattern) => pattern.test(path));
  } catch {
    return false;
  }
}

function setupAdBlocker(webSession: Session): void {
  webSession.webRequest.onBeforeRequest((details, callback) => {
    const blocked = shouldBlockAdRequest(details.url, details.resourceType);

    if (blocked) {
      blockedAdRequests += 1;
      if (blockedAdRequests <= 20 || blockedAdRequests % 50 === 0) {
        console.log(
          `[MissAV Web] Blocked ad request #${blockedAdRequests}: ${details.url}`,
        );
      }
    }

    callback({ cancel: blocked });
  });
}

function setupPopupBlocker(webSession: Session): void {
  app.on("web-contents-created", (_event, contents: WebContents) => {
    if (contents.session !== webSession) return;

    contents.setWindowOpenHandler((details) => {
      console.log(`[MissAV Web] Blocked popup: ${details.url}`);
      return { action: "deny" };
    });

    contents.on("dom-ready", () => {
      void ensureAdBlockerInjected(contents);
      void ensureSnifferToolInjected(contents);
    });

    contents.on("console-message", (_event, _level, message) => {
      if (!message.startsWith(EXTENSION_PUSH_CONSOLE_PREFIX)) return;

      try {
        const raw = JSON.parse(
          message.slice(EXTENSION_PUSH_CONSOLE_PREFIX.length),
        ) as Record<string, unknown>;
        emitExtensionTaskPush(raw);
      } catch (error) {
        console.warn("[MissAV Web] Failed to read console push payload:", error);
      }
    });
  });
}

async function ensureAdBlockerInjected(contents: WebContents): Promise<void> {
  if (contents.isDestroyed()) return;

  try {
    await contents.executeJavaScript(getAdBlockScript(), true);
  } catch (error) {
    console.warn("[MissAV Web] Failed to inject ad blocker:", error);
  }
}

function readSnifferSource(): string {
  if (snifferSourceCache) return snifferSourceCache;

  snifferSourceCache = fs.readFileSync(
    path.join(resolveExtensionPath(), "injected.js"),
    "utf8",
  );
  return snifferSourceCache;
}

async function ensureSnifferToolInjected(contents: WebContents): Promise<void> {
  if (contents.isDestroyed()) return;

  try {
    const installed = await contents.executeJavaScript(
      "Boolean(window.__M3U8_SNIFFER_INSTALLED__)",
      true,
    );

    if (installed) return;

    await contents.executeJavaScript(readSnifferSource(), true);
    console.log("[MissAV Web] Sniffer tool injected into webview");
  } catch (error) {
    console.warn("[MissAV Web] Failed to inject sniffer tool:", error);
  }
}

async function loadSnifferExtension(webSession: Session): Promise<void> {
  const extensionPath = resolveExtensionPath();
  const loadedExtension = webSession
    .getAllExtensions()
    .find((extension) => extension.path === extensionPath);

  if (loadedExtension) {
    console.log(`[MissAV Web] Extension already loaded: ${loadedExtension.name}`);
    return;
  }

  const extension = await webSession.loadExtension(extensionPath, {
    allowFileAccess: true,
  });
  console.log(`[MissAV Web] Extension loaded: ${extension.name}`);
}

export async function setupMissavWebSession(): Promise<void> {
  if (configured) return;
  configured = true;

  const webSession = session.fromPartition(MISSAV_WEB_PARTITION);
  setupAdBlocker(webSession);
  setupPopupBlocker(webSession);
  webSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  try {
    await loadSnifferExtension(webSession);
  } catch (error) {
    console.warn("[MissAV Web] Failed to load extension:", error);
  }
}
