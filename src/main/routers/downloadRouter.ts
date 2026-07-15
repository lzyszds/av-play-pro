import { observable } from "@trpc/server/observable";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import { spawn, exec, ChildProcess } from "child_process";
import { app, session } from "electron";
import { t } from "../trpc";
import { getMainWindow, getDownloadWidgetWindow } from "../windowState";
import { enqueue as enqueuePostProcess } from "../postprocess/queue";
import { MISSAV_WEB_PARTITION } from "../webview/missavWebSession";
import { isCdnUrl, toLocalProxyUrl } from "../protocols/localMediaProxy";

/** 从 headers JSON 里取出 Referer（不区分大小写） */
function getRefererFromHeaders(headers?: string): string {
  if (!headers) return "";
  try {
    const map = JSON.parse(headers) as Record<string, string>;
    const key = Object.keys(map).find((k) => k.toLowerCase() === "referer");
    return key ? map[key] : "";
  } catch {
    return "";
  }
}

/** 与 cdnProxyProtocol 保持一致的完整 UA，截断的 UA 会被 Cloudflare 判定为机器人导致 403 */
const FULL_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

/**
 * 构造传给 N_m3u8DL-RE 的 -H 头：
 * 在用户/推送提供的头基础上，补全 UA、补 Origin、并注入 WebView 会话里
 * 目标域名（surrit.com 等，挂在 Cloudflare 后）的 cf_clearance 等 Cookie，
 * 否则会拿到 403 (Forbidden)。
 */
async function buildHeaderArgs(input: DownloadPayload): Promise<string[]> {
  const map: Record<string, string> = {};
  if (input.headers) {
    try {
      const parsed = JSON.parse(input.headers) as Record<string, string>;
      for (const [k, v] of Object.entries(parsed)) {
        if (v) map[k] = v;
      }
    } catch {}
  }

  const findKey = (name: string): string | undefined =>
    Object.keys(map).find((k) => k.toLowerCase() === name.toLowerCase());

  // 1) UA：缺失或被截断（不含 Chrome/）时替换为完整 UA
  const uaKey = findKey("user-agent");
  const ua = uaKey ? map[uaKey] : "";
  if (!ua || !/chrome\//i.test(ua)) {
    if (uaKey) delete map[uaKey];
    map["User-Agent"] = FULL_UA;
  }

  // 2) Origin：从 Referer 推导
  const refKey = findKey("referer");
  const referer = refKey ? map[refKey] : "";
  if (!findKey("origin") && referer) {
    try {
      map["Origin"] = new URL(referer).origin;
    } catch {}
  }

  // 3) 注入 WebView 会话里目标域名的 Cookie（关键：Cloudflare cf_clearance）
  try {
    const cdnSession = session.fromPartition(MISSAV_WEB_PARTITION);
    const cookies = await cdnSession.cookies.get({ url: input.url });
    if (cookies.length) {
      const cookieKey = findKey("cookie");
      const existing = (cookieKey ? map[cookieKey] : "") || "";
      const existingNames = new Set(
        existing
          .split(";")
          .map((c) => c.split("=")[0].trim().toLowerCase())
          .filter(Boolean),
      );
      const merged = cookies
        .filter((c) => !existingNames.has(c.name.toLowerCase()))
        .map((c) => `${c.name}=${c.value}`);
      const all = [existing.trim(), ...merged].filter(Boolean).join("; ");
      if (cookieKey) delete map[cookieKey];
      if (all) map["Cookie"] = all;
    }
  } catch {}

  const args: string[] = [];
  for (const [k, v] of Object.entries(map)) {
    if (v) args.push("-H", `${k}: ${v}`);
  }
  return args;
}

export interface DownloadPayload {
  taskId?: string;
  url: string;
  saveDir: string;
  saveName: string;
  format: string;
  threads: number;
  headers?: string;
  tmpDir?: string;
  proxyUrl?: string;
  toolPath?: string;
  autoMerge?: boolean;
  /** N_m3u8DL-RE --max-speed, 如 "5M" / "512K"。空则不限速 */
  maxSpeed?: string;
}

export interface ProgressPayload {
  line: string;
  percent: number | null;
  done: boolean;
  success: boolean;
  taskId?: string;
}

export interface VideoItem {
  id: string;
  name: string;
  url: string;
  resolution: string;
  encryptionType: string;
  coverUrl?: string;
  previewUrl?: string;
  size?: string;
  createdAt?: number;
}

// ============ 鍏ㄥ眬鐘舵€?============

interface ActiveDownload {
  proc: ChildProcess;
  pid: number;
  stopping: boolean;
}
const activeDownloads = new Map<string, ActiveDownload>();
let progressCallbacks: Array<(data: ProgressPayload) => void> = [];
let coverChain: Promise<unknown> = Promise.resolve();

function resolveToolPath(customPath?: string): string | null {
  const candidates: string[] = [];
  if (customPath) {
    const p = customPath.trim();
    if (p) {
      if (path.isAbsolute(p)) {
        candidates.push(p);
      } else {
        candidates.push(path.resolve(process.cwd(), p));
        const exeDir = path.dirname(app.getPath("exe"));
        candidates.push(path.join(exeDir, p));
        candidates.push(path.join(exeDir, "bin", p));
      }
    }
  }
  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, "bin", "N_m3u8DL-RE.exe"));
  }
  candidates.push(path.join(__dirname, "../../bin/N_m3u8DL-RE.exe"));
  const exeDir = path.dirname(app.getPath("exe"));
  candidates.push(path.join(exeDir, "bin", "N_m3u8DL-RE.exe"));
  candidates.push(path.join(exeDir, "N_m3u8DL-RE.exe"));
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function sanitizeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_");
}

/** 从标题里提取番号（如 "MIDA-405 [七沢みあ]…" → "MIDA-405"），取不到返回空串 */
function extractCode(name: string): string {
  const m = name.match(/^([A-Za-z]+-?\d+)/);
  return m ? m[1].toUpperCase() : "";
}

function parsePercent(line: string): number | null {
  const match = line.match(/(\d+\.?\d*)%/);
  return match ? parseFloat(match[1]) : null;
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim();
}

function killProcessTree(pid: number): void {
  if (!pid) return;
  try {
    // /T 杀掉整个进程树（含子进程），/F 强制
    exec(`taskkill /PID ${pid} /T /F`, (err, stdout, stderr) => {
      if (err) {
        console.error(
          `[killProcessTree] taskkill 失败 PID=${pid}: ${err.message} ${stderr}`,
        );
      } else {
        console.log(`[killProcessTree] 已终止 PID=${pid}: ${stdout.trim()}`);
      }
    });
  } catch (err) {
    console.error("终止进程失败:", err);
  }
}

function sendProgress(payload: ProgressPayload): void {
  progressCallbacks.forEach((cb) => cb(payload));
  getMainWindow()?.webContents.send("download-progress", payload);
  const widget = getDownloadWidgetWindow();
  if (widget && !widget.isDestroyed()) {
    widget.webContents.send("download-progress", payload);
  }
}

function sendTaskProgress(taskId: string | undefined, payload: Omit<ProgressPayload, "taskId">): void {
  sendProgress({ ...payload, taskId });
}

// ============ 封面/棰勮鏃ュ織锛氬啓鍏ユ枃浠?+ 瀹炴椂鎺ㄩ€?============
export interface CoverLogEntry {
  timestamp: string;
  level: "INFO" | "SUCCESS" | "WARNING" | "ERROR";
  text: string;
}

function getCoverLogFilePath(): string {
  return path.join(app.getPath("userData"), "cover-preview-logs.jsonl");
}

// 缁熶竴鐨勫皝闈?预览日志：追加到文件，同时通过 IPC 实时推送到面板

function clog(level: CoverLogEntry["level"], text: string): void {
  const timestamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  const entry: CoverLogEntry = { timestamp, level, text };
  try {
    fs.appendFileSync(getCoverLogFilePath(), JSON.stringify(entry) + "\n");
  } catch {
    // file write failure should not block the main flow
  }
  sendProgress({
    line: `[\u5c01\u9762/\u9884\u89c8] ${text}`,
    percent: null,
    done: false,
    success: level === "SUCCESS",
  });
}

// rlog remains for compatibility with older call sites.
function rlog(level: "log" | "warn" | "error", ...args: unknown[]): void {
  const message = args
    .map((a) =>
      typeof a === "string"
        ? a
        : a instanceof Error
          ? a.stack || a.message
          : JSON.stringify(a),
    )
    .join(" ");
  const mapped =
    level === "error" ? "ERROR" : level === "warn" ? "WARNING" : "INFO";
  clog(mapped, message);
}

function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}

export const downloadRouter = t.router({
    start: t.procedure
      .input((input: unknown) => input as DownloadPayload)
      .mutation(async ({ input }) => {
        const taskId = input.taskId;
        const toolPath = resolveToolPath(input.toolPath);
        if (!toolPath) {
          sendTaskProgress(taskId, {
            line: "[ERROR] N_m3u8DL-RE.exe not found. Please check your bin directory and tool path.",
            percent: null,
            done: true,
            success: false,
          });
          throw new Error("N_m3u8DL-RE.exe not found");
        }

        // 同一任务再次 start：先杀掉旧进程；不同任务允许并发，不互相影响
        if (taskId && activeDownloads.has(taskId)) {
          const old = activeDownloads.get(taskId)!;
          sendTaskProgress(taskId, {
            line: `[系统] 同一任务的旧进程仍在运行 (PID: ${old.pid})，重启中…`,
            percent: null,
            done: false,
            success: false,
          });
          old.stopping = true;
          killProcessTree(old.pid);
          activeDownloads.delete(taskId);
        }

        // 每个任务的临时目录按番号隔离，避免并发任务都挤在 {temp}\video\ 里互相串。
        // 番号取不到时退回 taskId（短且唯一），再退回任务文件夹名。
        const baseTmp = input.tmpDir || path.join(input.saveDir, "temp");
        const folderName = path.basename(input.saveDir.replace(/[\\/]+$/, ""));
        const taskKey = sanitizeName(
          extractCode(folderName) || input.taskId || folderName,
        );
        const tmpDir = path.join(baseTmp, taskKey);

        // CDN（surrit 等）走本地代理，绕过 Cloudflare 对 N_m3u8DL-RE 的指纹拦截
        let effectiveUrl = input.url;
        if (isCdnUrl(input.url)) {
          const referer =
            getRefererFromHeaders(input.headers) || "https://missav.ai/";
          effectiveUrl = toLocalProxyUrl(input.url, referer);
          sendProgress({
            line: `[SYSTEM] CDN detected, routing via local proxy to bypass Cloudflare`,
            percent: 0,
            done: false,
            success: false,
          });
        }

        const args: string[] = [
          effectiveUrl,
          "--save-name",
          sanitizeName(input.saveName),
          "--save-dir",
          input.saveDir,
          "--tmp-dir",
          tmpDir,
          "--thread-count",
          input.threads.toString(),
          "--auto-select",
        ];

        if (input.format === "MP4") {
          args.push("--mp4-real-time-decryption");
        }

        if (input.autoMerge === false) {
          args.push("--skip-merge");
        }

        if (input.proxyUrl?.trim()) {
          args.push("--custom-proxy", input.proxyUrl.trim());
        }

        if (input.maxSpeed?.trim()) {
          args.push("--max-speed", input.maxSpeed.trim());
        }

        // 补全 UA / Origin / 注入 Cloudflare Cookie，避免 surrit.com 等 CDN 返回 403
        const headerArgs = await buildHeaderArgs(input);
        args.push(...headerArgs);

        if (!fs.existsSync(input.saveDir)) {
          fs.mkdirSync(input.saveDir, { recursive: true });
          sendProgress({
            line: `[系统] 宸插垱寤轰繚瀛樼洰褰? ${input.saveDir}`,
            percent: null,
            done: false,
            success: false,
          });
        }
        if (!fs.existsSync(tmpDir)) {
          fs.mkdirSync(tmpDir, { recursive: true });
          sendProgress({
            line: `[系统] 宸插垱寤轰复鏃剁洰褰? ${tmpDir}`,
            percent: null,
            done: false,
            success: false,
          });
        }

        sendProgress({
          line: `[SYSTEM] --------------------`,
          percent: 0,
          done: false,
          success: false,
        });
        sendProgress({
          line: `[SYSTEM] Start download task: ${input.saveName}`,
          percent: 0,
          done: false,
          success: false,
        });
        sendProgress({
          line: `[SYSTEM] Source URL: ${input.url}`,
          percent: 0,
          done: false,
          success: false,
        });
        sendProgress({
          line: `[SYSTEM] Save directory: ${input.saveDir}`,
          percent: 0,
          done: false,
          success: false,
        });
        sendProgress({
          line: `[SYSTEM] Temp directory: ${tmpDir}`,
          percent: 0,
          done: false,
          success: false,
        });
        sendProgress({
          line: `[SYSTEM] Tool path: ${toolPath}`,
          percent: 0,
          done: false,
          success: false,
        });
        sendProgress({
          line: `[SYSTEM] Threads: ${input.threads} | Format: ${input.format}`,
          percent: 0,
          done: false,
          success: false,
        });
        if (headerArgs.length) {
          // 仅展示头部名，避免把 cf_clearance/Cookie 明文打到日志
          const headerNames = headerArgs
            .filter((_, i) => i % 2 === 1)
            .map((h) => h.split(":")[0]);
          sendProgress({
            line: `[SYSTEM] Request headers: ${headerNames.join(", ")}`,
            percent: 0,
            done: false,
            success: false,
          });
        }
        sendProgress({
          line: `[SYSTEM] Full command: ${toolPath} ${args.join(" ")}`,
          percent: 0,
          done: false,
          success: false,
        });
        sendProgress({
          line: `[SYSTEM] Launching N_m3u8DL-RE...`,
          percent: 0,
          done: false,
          success: false,
        });

        // Use direct spawn to avoid shell path parsing issues. 进程跑在子进程，主线程不阻塞。
        const proc = spawn(toolPath, args, {
          windowsHide: true,
          detached: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
        const pid = proc.pid || 0;
        const slot: ActiveDownload = { proc, pid, stopping: false };
        if (taskId) activeDownloads.set(taskId, slot);

        sendTaskProgress(taskId, {
          line: `[系统] N_m3u8DL-RE 已启动 (PID: ${pid})`,
          percent: 0,
          done: false,
          success: false,
        });

        proc.on("spawn", () => {
          sendTaskProgress(taskId, {
            line: "[系统] 进程已成功 spawn",
            percent: 0,
            done: false,
            success: false,
          });
        });

        proc.stdout?.on("data", (data: Buffer) => {
          const text = data.toString();
          process.stdout.write(text);
          for (const line of text.split(/\r?\n/)) {
            const cleaned = stripAnsi(line);
            if (!cleaned) continue;
            sendTaskProgress(taskId, {
              line: cleaned,
              percent: parsePercent(cleaned),
              done: false,
              success: false,
            });
          }
        });

        proc.stderr?.on("data", (data: Buffer) => {
          const text = data.toString();
          process.stderr.write(text);
          for (const line of text.split(/\r?\n/)) {
            const cleaned = stripAnsi(line);
            if (!cleaned) continue;
            sendTaskProgress(taskId, {
              line: cleaned,
              percent: parsePercent(cleaned),
              done: false,
              success: false,
            });
          }
        });

        proc.on(
          "close",
          (code: number | null, signal: string | null) => {
            console.log(`[下载 ${taskId ?? ""}] 进程关闭: code=${code}, signal=${signal}`);
            const wasStopping = slot.stopping;
            if (taskId) activeDownloads.delete(taskId);

            if (wasStopping) {
              sendTaskProgress(taskId, {
                line: `[系统] 下载已停止`,
                percent: null,
                done: false,
                success: false,
              });
              return;
            }

            if (code === 0) {
              sendTaskProgress(taskId, {
                line: `[系统] 下载已完成 (code: 0)`,
                percent: 100,
                done: true,
                success: true,
              });
              // 自动入队后处理：整理目录 → 刮削 → 通知
              // input.saveDir 已是 {videos}\{番号标题} 目录，产物 video.mp4 就在其中。
              // organizeFolder 按 saveDir/saveName 拼最终目录，这里拆成 父目录 + 目录名，
              // 让最终目录正好等于 input.saveDir 本身，避免多套一层 video\。
              try {
                const cleanSaveDir = input.saveDir.replace(/[\\/]+$/, "");
                enqueuePostProcess({
                  saveDir: path.dirname(cleanSaveDir),
                  saveName: path.basename(cleanSaveDir),
                });
              } catch (e: any) {
                console.warn(`[postprocess] enqueue failed: ${e?.message}`);
              }
            } else {
              sendTaskProgress(taskId, {
                line: `[系统] 下载进程异常退出 (code: ${code})`,
                percent: null,
                done: true,
                success: false,
              });
            }
          },
        );

        proc.on("error", (err: Error) => {
          console.error(`[下载 ${taskId ?? ""}] 启动失败: ${err.message}`);
          sendTaskProgress(taskId, {
            line: `[错误] 启动失败: ${err.message}`,
            percent: null,
            done: true,
            success: false,
          });
          if (taskId) activeDownloads.delete(taskId);
        });

        return { success: true, pid, taskId };
      }),

    stop: t.procedure
      .input((input: unknown) => (input as { taskId?: string } | undefined) || {})
      .mutation(({ input }) => {
        const taskId = input?.taskId;
        if (taskId) {
          const slot = activeDownloads.get(taskId);
          if (!slot) {
            return { success: false, message: "No active download for task" };
          }
          slot.stopping = true;
          sendTaskProgress(taskId, {
            line: `[系统] 正在停止下载进程 (PID: ${slot.pid})`,
            percent: null,
            done: false,
            success: false,
          });
          killProcessTree(slot.pid);
          try {
            slot.proc.kill();
          } catch {}
          activeDownloads.delete(taskId);
          return { success: true };
        }
        // 不带 taskId：停止所有
        if (activeDownloads.size === 0) {
          return { success: false, message: "No running download" };
        }
        for (const [id, slot] of activeDownloads) {
          slot.stopping = true;
          sendTaskProgress(id, {
            line: `[系统] 正在停止下载进程 (PID: ${slot.pid})`,
            percent: null,
            done: false,
            success: false,
          });
          killProcessTree(slot.pid);
          try {
            slot.proc.kill();
          } catch {}
        }
        activeDownloads.clear();
        return { success: true };
      }),

    onProgress: t.procedure.subscription(() => {
      return observable<ProgressPayload>((emit) => {
        const callback = (data: ProgressPayload) => emit.next(data);
        progressCallbacks.push(callback);
        return () => {
          progressCallbacks = progressCallbacks.filter((cb) => cb !== callback);
        };
      });
    }),

    // 鍒犻櫎浠诲姟鏃舵竻鐞?temp 临时文件
    cleanupTemp: t.procedure
      .input(
        (input: unknown) =>
          input as {
            taskId?: string;
            saveDir: string;
            saveName: string;
            tmpDir?: string;
          },
      )
      .mutation(({ input }) => {
        const tmpDir = input.tmpDir || path.join(input.saveDir, "temp");
        const sanitized = sanitizeName(input.saveName);

        // 与 download.start 一致的番号临时目录：{tmpDir}\{番号|taskId|文件夹名}
        const taskKey = sanitizeName(
          extractCode(sanitized) || input.taskId || sanitized,
        );
        const taskTmpFolder = path.join(tmpDir, taskKey);
        if (fs.existsSync(taskTmpFolder)) {
          try {
            fs.rmSync(taskTmpFolder, { recursive: true, force: true });
            sendProgress({
              line: `[SYSTEM] Removed temp folder: ${taskTmpFolder}`,
              percent: null,
              done: false,
              success: false,
            });
          } catch (e: any) {
            sendProgress({
              line: `[SYSTEM] Failed to remove temp folder: ${e?.message}`,
              percent: null,
              done: false,
              success: false,
            });
          }
        }

        sendProgress({
          line: `[SYSTEM] Cleaning temp files: ${sanitized}*`,
          percent: null,
          done: false,
          success: false,
        });
        sendProgress({
          line: `[SYSTEM] Temp directory: ${tmpDir}`,
          percent: null,
          done: false,
          success: false,
        });
        try {
          if (fs.existsSync(tmpDir)) {
            const files = fs.readdirSync(tmpDir);
            let deleted = 0;
            for (const file of files) {
              if (file.startsWith(sanitized)) {
                const filePath = path.join(tmpDir, file);
                const stat = fs.statSync(filePath);
                fs.unlinkSync(filePath);
                sendProgress({
                  line: `[SYSTEM] Deleted temp file: ${file} (${formatSize(stat.size)})`,
                  percent: null,
                  done: false,
                  success: false,
                });
                deleted++;
              }
            }
            sendProgress({
              line: `[SYSTEM] Temp cleanup completed: ${deleted} file(s) deleted`,
              percent: null,
              done: false,
              success: false,
            });
            return { success: true, deleted };
          }
          sendProgress({
            line: `[SYSTEM] Temp directory not found: ${tmpDir}`,
            percent: null,
            done: false,
            success: false,
          });
          return { success: true, deleted: 0 };
        } catch (err: any) {
          sendProgress({
            line: `[SYSTEM] Temp cleanup failed: ${err.message}`,
            percent: null,
            done: false,
            success: false,
          });
          return { success: false, error: err.message };
        }
      }),

    // 下载完成后自动下载封面和预览视频
    downloadCoverPreview: t.procedure
      .input(
        (input: unknown) =>
          input as {
            id: string;
            name: string;
            saveDir: string;
            customCoverUrl?: string;
            customPreviewUrl?: string;
            skipCover?: boolean;
            skipPreview?: boolean;
          },
      )
      .mutation(async ({ input }) => {
        const previous = coverChain;
        let release: () => void = () => {};
        coverChain = new Promise<void>((resolve) => {
          release = resolve;
        });
        try {
          await previous;
        } catch {
          // ignore previous task failure
        }

        try {
          const { id, name, saveDir, customCoverUrl, customPreviewUrl, skipCover, skipPreview } = input;
          clog("INFO", `开始下载封面和预览: ${name}`);

          if (name.toLowerCase().startsWith("desktop")) {
            clog("WARNING", `跳过封面和预览下载: ${name}`);
            return { success: false, message: "skip desktop task" };
          }

          await fs.promises.mkdir(saveDir, { recursive: true });
          const videoId = id.toLowerCase();
          const referer = `https://missav.ai/cn/${videoId}-uncensored-leak`;
          const coverLocalPath = path.join(saveDir, "cover.jpg");
          const coverAltPath = path.join(saveDir, "cover.jpeg");
          const coverPngPath = path.join(saveDir, "cover.png");
          const previewLocalPath = path.join(saveDir, "preview.mp4");

          // 缺少相应文件时才修复；已存在则直接跳过
          const coverExists =
            fs.existsSync(coverLocalPath) ||
            fs.existsSync(coverAltPath) ||
            fs.existsSync(coverPngPath);
          const previewExists = fs.existsSync(previewLocalPath);
          const effectiveSkipCover = !!skipCover || coverExists;
          const effectiveSkipPreview = !!skipPreview || previewExists;

          if (coverExists && !skipCover) {
            clog("INFO", `封面已存在，跳过: ${name} (${coverLocalPath})`);
          }
          if (previewExists && !skipPreview) {
            clog("INFO", `预览已存在，跳过: ${name} (${previewLocalPath})`);
          }
          if (effectiveSkipCover && effectiveSkipPreview) {
            clog("SUCCESS", `封面和预览均已存在，无需修复: ${name}`);
            return { success: true, skipped: true, message: "all files exist" };
          }
          const coverUrls = customCoverUrl
            ? [customCoverUrl]
            : [
                `https://fourhoi.com/${videoId}-uncensored-leak/cover-n.jpg`,
                `https://fourhoi.com/${videoId}-uncensored-leak/cover-t.jpg`,
                `https://fourhoi.com/${videoId}/cover-n.jpg`,
                `https://fourhoi.com/${videoId}/cover-t.jpg`,
              ];
          const previewUrls = customPreviewUrl
            ? [customPreviewUrl]
            : [
                `https://fourhoi.com/${videoId}-uncensored-leak/preview.mp4`,
                `https://fourhoi.com/${videoId}/preview.mp4`,
              ];

          // 如果用户显式传入了自定义 URL，视为强制重新下载（覆盖已有）
          if (customCoverUrl) {
            if (fs.existsSync(coverLocalPath)) fs.unlinkSync(coverLocalPath);
            if (fs.existsSync(coverAltPath)) fs.unlinkSync(coverAltPath);
            if (fs.existsSync(coverPngPath)) fs.unlinkSync(coverPngPath);
          }
          if (customPreviewUrl) {
            if (fs.existsSync(previewLocalPath)) fs.unlinkSync(previewLocalPath);
          }

          const downloadFile = (
            url: string,
            localPath: string,
            retries = 3,
          ): Promise<void> => {
            return new Promise<void>((resolve, reject) => {
              const parsed = new URL(url);
              const mod = parsed.protocol === "https:" ? https : http;
              const req = mod.request(
                {
                  hostname: parsed.hostname,
                  port:
                    parsed.port || (parsed.protocol === "https:" ? 443 : 80),
                  path: parsed.pathname + parsed.search,
                  method: "GET",
                  timeout: 15000,
                  headers: {
                    "User-Agent":
                      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
                    Referer: referer,
                    Accept:
                      "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                  },
                },
                (res) => {
                  if (
                    res.statusCode &&
                    res.statusCode >= 300 &&
                    res.statusCode < 400 &&
                    res.headers.location
                  ) {
                    downloadFile(res.headers.location, localPath, retries)
                      .then(resolve)
                      .catch(reject);
                    return;
                  }
                  if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                  }
                  const writer = fs.createWriteStream(localPath);
                  res.pipe(writer);
                  writer.on("finish", () => {
                    writer.close();
                    resolve();
                  });
                  writer.on("error", reject);
                },
              );
              req.on("timeout", () => {
                req.destroy();
                reject(new Error("Request timeout"));
              });
              req.on("error", reject);
              req.end();
            }).catch((err) => {
              if (retries > 0) {
                return downloadFile(url, localPath, retries - 1);
              }
              return Promise.reject(err);
            });
          };

          const tryCandidates = async (
            candidates: string[],
            localPath: string,
            label: string,
          ) => {
            let lastError: Error | null = null;
            for (const url of candidates) {
              try {
                clog("INFO", `Try ${label}: ${url}`);
                await downloadFile(url, localPath);
                const size = fs.existsSync(localPath)
                  ? fs.statSync(localPath).size
                  : 0;
                clog("SUCCESS", `${label} downloaded (${formatSize(size)})`);
                return;
              } catch (err: any) {
                lastError = err;
              }
            }
            throw lastError || new Error(`${label} download failed`);
          };

          if (!effectiveSkipCover) {
            await tryCandidates(coverUrls, coverLocalPath, "cover");
          }
          if (!effectiveSkipPreview) {
            await tryCandidates(previewUrls, previewLocalPath, "preview");
          }
          clog("SUCCESS", `封面和预览下载完成: ${name}`);
          return { success: true };
        } catch (err: any) {
          clog("ERROR", `封面和预览下载失败: ${err?.message || err}`);
          return { success: false, error: err?.message || String(err) };
        } finally {
          release();
        }
      }),

    // 读取封面/预览日志文件
    readCoverLogs: t.procedure.query((): CoverLogEntry[] => {
      try {
        const file = getCoverLogFilePath();
        if (!fs.existsSync(file)) return [];
        const lines = fs
          .readFileSync(file, "utf-8")
          .split("\n")
          .filter(Boolean);
        // keep only the last 1000 entries
        return lines
          .slice(-1000)
          .map((l) => {
            try {
              return JSON.parse(l) as CoverLogEntry;
            } catch {
              return null;
            }
          })
          .filter((e): e is CoverLogEntry => e !== null);
      } catch {
        return [];
      }
    }),

    // 清空封面/预览日志文件
    clearCoverLogs: t.procedure.mutation((): { success: boolean } => {
      try {
        fs.writeFileSync(getCoverLogFilePath(), "");
        return { success: true };
      } catch {
        return { success: false };
      }
    }),
  });
