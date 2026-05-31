import * as http from "http";
import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import { getMainWindow } from "../windowState";

const PUSH_PORT = 39527;
const MAX_BODY_SIZE = 1024 * 1024;

export interface ExtensionTaskPushPayload {
  id: string;
  url: string;
  name: string;
  coverUrl?: string;
  previewUrl?: string;
  quality?: string;
  source?: string;
  pageUrl?: string;
  referer: string;
  refererOrigin: string;
  refererSource: string;
  pushedAt: string;
}

let server: http.Server | null = null;

function getQueueFilePath(): string {
  return path.join(app.getPath("userData"), "extension-push-queue.json");
}

function readQueue(): ExtensionTaskPushPayload[] {
  try {
    const file = getQueueFilePath();
    if (!fs.existsSync(file)) return [];
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: ExtensionTaskPushPayload[]): void {
  const file = getQueueFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(queue, null, 2), "utf8");
}

function appendToQueue(payload: ExtensionTaskPushPayload): number {
  const queue = readQueue();
  const nextQueue = [...queue, payload].slice(-200);
  writeQueue(nextQueue);
  return nextQueue.length;
}

export function consumeQueuedExtensionTaskPushes(): ExtensionTaskPushPayload[] {
  const queue = readQueue();
  writeQueue([]);
  return queue;
}

function sendJson(
  response: http.ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true",
  });
  response.end(JSON.stringify(payload));
}

function readRequestBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
      if (body.length > MAX_BODY_SIZE) {
        reject(new Error("Request body is too large"));
        request.destroy();
      }
    });

    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getUrlParts(value: string): { href: string; origin: string; host: string } | null {
  try {
    const parsed = new URL(value);
    return {
      href: parsed.href,
      origin: parsed.origin,
      host: parsed.hostname.replace(/^www\./i, "").toLowerCase(),
    };
  } catch {
    return null;
  }
}

function detectRefererSource(host: string): string {
  if (host.includes("missav")) return "missav";
  if (host.includes("supjav")) return "supjav";
  if (host.includes("jav")) return "jav";
  return host || "unknown";
}

function normalizePushPayload(input: Record<string, unknown>): ExtensionTaskPushPayload {
  const url = asString(input.url);
  if (!url) throw new Error("Missing m3u8 url");

  const pageUrl = asString(input.pageUrl) || asString(input.referer);
  const pageParts = getUrlParts(pageUrl);
  const urlParts = getUrlParts(url);
  const refererParts = pageParts || urlParts;

  if (!refererParts) throw new Error("Missing valid referer source");

  const referer = pageParts?.href || refererParts.origin + "/";
  const refererOrigin = refererParts.origin;
  const refererSource = detectRefererSource(refererParts.host);

  return {
    id: `push-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    url,
    name: asString(input.name) || asString(input.title) || "M3U8 Task",
    coverUrl: asString(input.cover) || asString(input.coverUrl) || undefined,
    previewUrl: asString(input.preview) || asString(input.previewUrl) || undefined,
    quality: asString(input.quality) || undefined,
    source: asString(input.source) || undefined,
    pageUrl: pageParts?.href,
    referer,
    refererOrigin,
    refererSource,
    pushedAt: new Date().toISOString(),
  };
}

export function emitExtensionTaskPush(
  input: Record<string, unknown>,
): ExtensionTaskPushPayload {
  const payload = normalizePushPayload(input);
  const queuedCount = appendToQueue(payload);

  getMainWindow()?.webContents.send("extension-task-pushed", {
    queued: true,
    queuedCount,
  });
  console.log(
    `[Extension Push] Queued ${payload.refererSource} task: ${payload.name} | ${payload.url}`,
  );

  return payload;
}

async function handleDownloadPush(
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<void> {
  try {
    const body = await readRequestBody(request);
    const raw = JSON.parse(body || "{}") as Record<string, unknown>;
    const payload = emitExtensionTaskPush(raw);

    sendJson(response, 200, { success: true, task: payload });
  } catch (error: any) {
    sendJson(response, 400, {
      success: false,
      error: error?.message || String(error),
    });
  }
}

export function startExtensionPushServer(): void {
  if (server) return;

  server = http.createServer((request, response) => {
    if (request.method === "OPTIONS") {
      sendJson(response, 204, {});
      return;
    }

    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, { success: true });
      return;
    }

    if (request.method === "POST" && request.url === "/api/download") {
      void handleDownloadPush(request, response);
      return;
    }

    sendJson(response, 404, { success: false, error: "Not found" });
  });

  server.on("error", (error) => {
    console.warn("[Extension Push] Server failed:", error);
  });

  server.listen(PUSH_PORT, () => {
    console.log(`[Extension Push] Listening on http://localhost:${PUSH_PORT}`);
  });
}
