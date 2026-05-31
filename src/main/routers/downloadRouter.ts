import { observable } from "@trpc/server/observable";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import { spawn, exec, ChildProcess } from "child_process";
import { app } from "electron";
import { t } from "../trpc";
import { getMainWindow } from "../windowState";

export interface DownloadPayload {
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

let downloadProcess: ChildProcess | null = null;
let downloadPid: number | null = null;
let stopping = false;
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
        const toolPath = resolveToolPath(input.toolPath);
        if (!toolPath) {
          sendProgress({
            line: "[ERROR] N_m3u8DL-RE.exe not found. Please check your bin directory and tool path.",
            percent: null,
            done: true,
            success: false,
          });
          throw new Error("N_m3u8DL-RE.exe not found");
        }

        const tmpDir = input.tmpDir || path.join(input.saveDir, "temp");
        const args: string[] = [
          input.url,
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

        if (input.headers) {
          try {
            const headersMap = JSON.parse(input.headers) as Record<
              string,
              string
            >;
            for (const [key, value] of Object.entries(headersMap)) {
              if (value) args.push("-H", `${key}: ${value}`);
            }
          } catch {}
        }

        if (downloadProcess?.pid || downloadPid) {
          const oldPid = downloadProcess?.pid || downloadPid;
          if (oldPid) {
            sendProgress({
              line: `[系统] 检测到已有下载进程 (PID: ${oldPid})锛屾鍦ㄧ粓姝?..`,
              percent: null,
              done: false,
              success: false,
            });
            killProcessTree(oldPid);
            downloadProcess = null;
            downloadPid = null;
          }
        }

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
        if (input.headers) {
          sendProgress({
            line: `[SYSTEM] Custom headers: ${input.headers}`,
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

        // Use direct spawn to avoid shell path parsing issues.
        downloadProcess = spawn(toolPath, args, {
          windowsHide: true,
          detached: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
        const pid = downloadProcess.pid || 0;
        downloadPid = pid; // 持久保存 PID
        sendProgress({
          line: `[系统] N_m3u8DL-RE 宸插惎鍔?(PID: ${pid})`,
          percent: 0,
          done: false,
          success: false,
        });

        downloadProcess.on("spawn", () => {
          sendProgress({
            line: "[系统] 杩涚▼宸叉垚鍔?spawn",
            percent: 0,
            done: false,
            success: false,
          });
        });

        downloadProcess.stdout?.on("data", (data: Buffer) => {
          const text = data.toString();
          process.stdout.write(text);
          for (const line of text.split(/\r?\n/)) {
            const cleaned = stripAnsi(line);
            if (!cleaned) continue;
            // 注意：完成判定只依赖进程 close 事件，不再根据日志文本提前判定，
            // 否则会把仍在运行的进程误标记为“已完成”，导致无法暂停/终止。
            sendProgress({
              line: cleaned,
              percent: parsePercent(cleaned),
              done: false,
              success: false,
            });
          }
        });

        downloadProcess.stderr?.on("data", (data: Buffer) => {
          const text = data.toString();
          process.stderr.write(text);
          for (const line of text.split(/\r?\n/)) {
            const cleaned = stripAnsi(line);
            if (!cleaned) continue;
            sendProgress({
              line: cleaned,
              percent: parsePercent(cleaned),
              done: false,
              success: false,
            });
          }
        });

        downloadProcess.on(
          "close",
          (code: number | null, signal: string | null) => {
            console.log(`[下载] 进程关闭: code=${code}, signal=${signal}`);
            const wasStopping = stopping;
            stopping = false;
            downloadProcess = null;
            downloadPid = null;

            if (wasStopping) {
              // 用户手动暂停/停止：前端已置为“已暂停”，这里只发非完成状态
              sendProgress({
                line: `[系统] 下载已停止`,
                percent: null,
                done: false,
                success: false,
              });
              return;
            }

            if (code === 0) {
              sendProgress({
                line: `[系统] 下载已完成 (code: 0)`,
                percent: 100,
                done: true,
                success: true,
              });
            } else {
              sendProgress({
                line: `[系统] 下载进程异常退出 (code: ${code})`,
                percent: null,
                done: true,
                success: false,
              });
            }
          },
        );

        downloadProcess.on("error", (err: Error) => {
          console.error(`[下载] 启动失败: ${err.message}`);
          sendProgress({
            line: `[错误] 启动失败: ${err.message}`,
            percent: null,
            done: true,
            success: false,
          });
          downloadProcess = null;
        });

        return { success: true, pid };
      }),

    stop: t.procedure.mutation(() => {
      const pid = downloadProcess?.pid || downloadPid;
      if (pid) {
        stopping = true; // 标记为手动停止，close 事件不会发“完成”
        sendProgress({
          line: `[系统] 正在停止下载进程 (PID: ${pid})`,
          percent: null,
          done: false,
          success: false,
        });
        // 双保险：既杀进程树，也直接 kill 句柄
        killProcessTree(pid);
        try {
          downloadProcess?.kill();
        } catch {}
        downloadProcess = null;
        downloadPid = null;
        return { success: true };
      }
      sendProgress({
        line: "[系统] 当前没有正在运行的下载进程",
        percent: null,
        done: false,
        success: false,
      });
      return { success: false, message: "No running download process" };
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
          input as { saveDir: string; saveName: string; tmpDir?: string },
      )
      .mutation(({ input }) => {
        const tmpDir = input.tmpDir || path.join(input.saveDir, "temp");
        const sanitized = sanitizeName(input.saveName);
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
          input as { id: string; name: string; saveDir: string },
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
          const { id, name, saveDir } = input;
          clog("INFO", `开始下载封面和预览: ${name}`);

          if (name.toLowerCase().startsWith("desktop")) {
            clog("WARNING", `跳过封面和预览下载: ${name}`);
            return { success: false, message: "skip desktop task" };
          }

          await fs.promises.mkdir(saveDir, { recursive: true });
          const videoId = id.toLowerCase();
          const referer = `https://missav.ai/cn/${videoId}-uncensored-leak`;
          const coverLocalPath = path.join(saveDir, "cover.jpg");
          const previewLocalPath = path.join(saveDir, "preview.mp4");
          const coverUrls = [
            `https://fourhoi.com/${videoId}-uncensored-leak/cover-n.jpg`,
            `https://fourhoi.com/${videoId}-uncensored-leak/cover-t.jpg`,
            `https://fourhoi.com/${videoId}/cover-n.jpg`,
            `https://fourhoi.com/${videoId}/cover-t.jpg`,
          ];
          const previewUrls = [
            `https://fourhoi.com/${videoId}-uncensored-leak/preview.mp4`,
            `https://fourhoi.com/${videoId}/preview.mp4`,
          ];

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

          await tryCandidates(coverUrls, coverLocalPath, "cover");
          await tryCandidates(previewUrls, previewLocalPath, "preview");
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
