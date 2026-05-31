"use strict";
const electron = require("electron");
const path = require("path");
const utils = require("@electron-toolkit/utils");
const https = require("https");
const http = require("http");
const fs = require("fs");
const stream = require("stream");
const main = require("electron-trpc-experimental/main");
const server = require("@trpc/server");
const observable = require("@trpc/server/observable");
const child_process = require("child_process");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const path__namespace = /* @__PURE__ */ _interopNamespaceDefault(path);
const https__namespace = /* @__PURE__ */ _interopNamespaceDefault(https);
const http__namespace = /* @__PURE__ */ _interopNamespaceDefault(http);
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs);
const t = server.initTRPC.create();
let downloadProcess = null;
let downloadPid = null;
let mainWindow$1 = null;
let progressCallbacks = [];
let coverChain = Promise.resolve();
function setMainWindow(win) {
  mainWindow$1 = win;
}
function resolveToolPath(customPath) {
  const candidates = [];
  if (customPath) {
    const p = customPath.trim();
    if (p) {
      if (path__namespace.isAbsolute(p)) {
        candidates.push(p);
      } else {
        candidates.push(path__namespace.resolve(process.cwd(), p));
        const exeDir2 = path__namespace.dirname(electron.app.getPath("exe"));
        candidates.push(path__namespace.join(exeDir2, p));
        candidates.push(path__namespace.join(exeDir2, "bin", p));
      }
    }
  }
  if (electron.app.isPackaged) {
    candidates.push(path__namespace.join(process.resourcesPath, "bin", "N_m3u8DL-RE.exe"));
  }
  candidates.push(path__namespace.join(__dirname, "../../bin/N_m3u8DL-RE.exe"));
  const exeDir = path__namespace.dirname(electron.app.getPath("exe"));
  candidates.push(path__namespace.join(exeDir, "bin", "N_m3u8DL-RE.exe"));
  candidates.push(path__namespace.join(exeDir, "N_m3u8DL-RE.exe"));
  for (const c of candidates) {
    if (fs__namespace.existsSync(c)) return c;
  }
  return null;
}
function sanitizeName(name) {
  return name.replace(/[\\/:*?"<>|]/g, "_");
}
function parsePercent(line) {
  const match = line.match(/(\d+\.?\d*)%/);
  return match ? parseFloat(match[1]) : null;
}
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim();
}
function killProcessTree(pid) {
  if (!pid) return;
  try {
    console.log(`[killProcessTree] 宸插彂閫?taskkill /F /T /PID ${pid}`);
  } catch (err) {
    console.error("缁堟杩涚▼澶辫触:", err);
  }
}
function sendProgress(payload) {
  progressCallbacks.forEach((cb) => cb(payload));
  mainWindow$1?.webContents.send("download-progress", payload);
}
function getCoverLogFilePath() {
  return path__namespace.join(electron.app.getPath("userData"), "cover-preview-logs.jsonl");
}
function clog(level, text) {
  const timestamp = (/* @__PURE__ */ new Date()).toLocaleTimeString("zh-CN", { hour12: false });
  const entry = { timestamp, level, text };
  try {
    fs__namespace.appendFileSync(getCoverLogFilePath(), JSON.stringify(entry) + "\n");
  } catch {
  }
}
function formatSize(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}
const appRouter = t.router({
  // 涓嬭浇绠＄悊
  download: t.router({
    start: t.procedure.input((input) => input).mutation(async ({ input }) => {
      const toolPath = resolveToolPath(input.toolPath);
      if (!toolPath) {
        sendProgress({
          line: "[ERROR] N_m3u8DL-RE.exe not found. Please check your bin directory and tool path.",
          percent: null,
          done: true,
          success: false
        });
        throw new Error("N_m3u8DL-RE.exe not found");
      }
      const tmpDir = input.tmpDir || path__namespace.join(input.saveDir, "temp");
      const args = [
        input.url,
        "--save-name",
        sanitizeName(input.saveName),
        "--save-dir",
        input.saveDir,
        "--tmp-dir",
        tmpDir,
        "--thread-count",
        input.threads.toString(),
        "--auto-select"
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
      if (input.headers) {
        try {
          const headersMap = JSON.parse(input.headers);
          for (const [key, value] of Object.entries(headersMap)) {
            if (value) args.push("-H", `${key}: ${value}`);
          }
        } catch {
        }
      }
      if (downloadProcess?.pid || downloadPid) {
        const oldPid = downloadProcess?.pid || downloadPid;
        if (oldPid) {
          sendProgress({
            line: `[绯荤粺] 妫€娴嬪埌宸叉湁涓嬭浇杩涚▼ (PID: ${oldPid})锛屾鍦ㄧ粓姝?..`,
            percent: null,
            done: false,
            success: false
          });
          killProcessTree(oldPid);
          downloadProcess = null;
          downloadPid = null;
        }
      }
      if (!fs__namespace.existsSync(input.saveDir)) {
        fs__namespace.mkdirSync(input.saveDir, { recursive: true });
        sendProgress({
          line: `[绯荤粺] 宸插垱寤轰繚瀛樼洰褰? ${input.saveDir}`,
          percent: null,
          done: false,
          success: false
        });
      }
      if (!fs__namespace.existsSync(tmpDir)) {
        fs__namespace.mkdirSync(tmpDir, { recursive: true });
        sendProgress({
          line: `[绯荤粺] 宸插垱寤轰复鏃剁洰褰? ${tmpDir}`,
          percent: null,
          done: false,
          success: false
        });
      }
      sendProgress({
        line: `[SYSTEM] --------------------`,
        percent: 0,
        done: false,
        success: false
      });
      sendProgress({
        line: `[SYSTEM] Start download task: ${input.saveName}`,
        percent: 0,
        done: false,
        success: false
      });
      sendProgress({
        line: `[SYSTEM] Source URL: ${input.url}`,
        percent: 0,
        done: false,
        success: false
      });
      sendProgress({
        line: `[SYSTEM] Save directory: ${input.saveDir}`,
        percent: 0,
        done: false,
        success: false
      });
      sendProgress({
        line: `[SYSTEM] Temp directory: ${tmpDir}`,
        percent: 0,
        done: false,
        success: false
      });
      sendProgress({
        line: `[SYSTEM] Tool path: ${toolPath}`,
        percent: 0,
        done: false,
        success: false
      });
      sendProgress({
        line: `[SYSTEM] Threads: ${input.threads} | Format: ${input.format}`,
        percent: 0,
        done: false,
        success: false
      });
      if (input.headers) {
        sendProgress({
          line: `[SYSTEM] Custom headers: ${input.headers}`,
          percent: 0,
          done: false,
          success: false
        });
      }
      sendProgress({
        line: `[SYSTEM] Full command: ${toolPath} ${args.join(" ")}`,
        percent: 0,
        done: false,
        success: false
      });
      sendProgress({
        line: `[SYSTEM] Launching N_m3u8DL-RE...`,
        percent: 0,
        done: false,
        success: false
      });
      downloadProcess = child_process.spawn(toolPath, args, {
        windowsHide: true,
        detached: false,
        stdio: ["ignore", "pipe", "pipe"]
      });
      const pid = downloadProcess.pid || 0;
      downloadPid = pid;
      sendProgress({
        line: `[绯荤粺] N_m3u8DL-RE 宸插惎鍔?(PID: ${pid})`,
        percent: 0,
        done: false,
        success: false
      });
      downloadProcess.on("spawn", () => {
        sendProgress({
          line: "[绯荤粺] 杩涚▼宸叉垚鍔?spawn",
          percent: 0,
          done: false,
          success: false
        });
      });
      downloadProcess.stdout?.on("data", (data) => {
        const text = data.toString();
        process.stdout.write(text);
        for (const line of text.split(/\r?\n/)) {
          const cleaned = stripAnsi(line);
          if (!cleaned) continue;
          sendProgress({
            line: cleaned,
            percent: parsePercent(cleaned),
            done: false,
            success: false
          });
          if (cleaned.includes("All") && cleaned.includes("downloaded") || cleaned.includes("Download complete") || cleaned.includes("finished")) {
            sendProgress({
              line: "[SYSTEM] Download completed",
              percent: 100,
              done: true,
              success: true
            });
            downloadProcess = null;
          }
        }
      });
      downloadProcess.stderr?.on("data", (data) => {
        const text = data.toString();
        process.stderr.write(text);
        for (const line of text.split(/\r?\n/)) {
          const cleaned = stripAnsi(line);
          if (!cleaned) continue;
          sendProgress({
            line: cleaned,
            percent: parsePercent(cleaned),
            done: false,
            success: false
          });
        }
      });
      downloadProcess.on(
        "close",
        (code, signal) => {
          console.log(`[涓嬭浇] 杩涚▼鍏抽棴: code=${code}, signal=${signal}`);
          if (code === 0) {
            sendProgress({
              line: `[绯荤粺] 涓嬭浇宸插畬鎴?(code: 0)`,
              percent: 100,
              done: true,
              success: true
            });
            downloadPid = null;
          }
          downloadProcess = null;
        }
      );
      downloadProcess.on("error", (err) => {
        console.error(`[涓嬭浇] 鍚姩澶辫触: ${err.message}`);
        sendProgress({
          line: `[閿欒] 鍚姩澶辫触: ${err.message}`,
          percent: null,
          done: true,
          success: false
        });
        downloadProcess = null;
      });
      return { success: true, pid };
    }),
    stop: t.procedure.mutation(() => {
      const pid = downloadProcess?.pid || downloadPid;
      if (pid) {
        sendProgress({
          line: `[SYSTEM] Stopping download process (PID: ${pid})`,
          percent: null,
          done: false,
          success: false
        });
        killProcessTree(pid);
        downloadProcess = null;
        downloadPid = null;
        sendProgress({
          line: `[SYSTEM] Sent taskkill /F /T /PID ${pid}`,
          percent: null,
          done: false,
          success: false
        });
        sendProgress({
          line: "[SYSTEM] Download stopped",
          percent: null,
          done: true,
          success: false
        });
        return { success: true };
      }
      sendProgress({
        line: "[SYSTEM] No running download process",
        percent: null,
        done: false,
        success: false
      });
      return { success: false, message: "No running download process" };
    }),
    onProgress: t.procedure.subscription(() => {
      return observable.observable((emit) => {
        const callback = (data) => emit.next(data);
        progressCallbacks.push(callback);
        return () => {
          progressCallbacks = progressCallbacks.filter((cb) => cb !== callback);
        };
      });
    }),
    // 鍒犻櫎浠诲姟鏃舵竻鐞?temp 涓存椂鏂囦欢
    cleanupTemp: t.procedure.input(
      (input) => input
    ).mutation(({ input }) => {
      const tmpDir = input.tmpDir || path__namespace.join(input.saveDir, "temp");
      const sanitized = sanitizeName(input.saveName);
      sendProgress({
        line: `[SYSTEM] Cleaning temp files: ${sanitized}*`,
        percent: null,
        done: false,
        success: false
      });
      sendProgress({
        line: `[SYSTEM] Temp directory: ${tmpDir}`,
        percent: null,
        done: false,
        success: false
      });
      try {
        if (fs__namespace.existsSync(tmpDir)) {
          const files = fs__namespace.readdirSync(tmpDir);
          let deleted = 0;
          for (const file of files) {
            if (file.startsWith(sanitized)) {
              const filePath = path__namespace.join(tmpDir, file);
              const stat = fs__namespace.statSync(filePath);
              fs__namespace.unlinkSync(filePath);
              sendProgress({
                line: `[SYSTEM] Deleted temp file: ${file} (${formatSize(stat.size)})`,
                percent: null,
                done: false,
                success: false
              });
              deleted++;
            }
          }
          sendProgress({
            line: `[SYSTEM] Temp cleanup completed: ${deleted} file(s) deleted`,
            percent: null,
            done: false,
            success: false
          });
          return { success: true, deleted };
        }
        sendProgress({
          line: `[SYSTEM] Temp directory not found: ${tmpDir}`,
          percent: null,
          done: false,
          success: false
        });
        return { success: true, deleted: 0 };
      } catch (err) {
        sendProgress({
          line: `[SYSTEM] Temp cleanup failed: ${err.message}`,
          percent: null,
          done: false,
          success: false
        });
        return { success: false, error: err.message };
      }
    }),
    // 涓嬭浇瀹屾垚鍚庤嚜鍔ㄤ笅杞藉皝闈㈠拰棰勮瑙嗛
    downloadCoverPreview: t.procedure.input(
      (input) => input
    ).mutation(async ({ input }) => {
      const previous = coverChain;
      let release = () => {
      };
      coverChain = new Promise((resolve) => {
        release = resolve;
      });
      try {
        await previous;
      } catch {
      }
      try {
        const { id, name, saveDir } = input;
        clog("INFO", `Start cover/preview download: ${name}`);
        if (name.toLowerCase().startsWith("desktop")) {
          clog("WARNING", "Skip desktop task");
          return { success: false, message: "skip desktop task" };
        }
        await fs__namespace.promises.mkdir(saveDir, { recursive: true });
        const videoId = id.toLowerCase();
        const referer = `https://missav.ai/cn/${videoId}-uncensored-leak`;
        const coverLocalPath = path__namespace.join(saveDir, "cover.jpg");
        const previewLocalPath = path__namespace.join(saveDir, "preview.mp4");
        const coverUrls = [
          `https://fourhoi.com/${videoId}-uncensored-leak/cover-n.jpg`,
          `https://fourhoi.com/${videoId}-uncensored-leak/cover-t.jpg`,
          `https://fourhoi.com/${videoId}/cover-n.jpg`,
          `https://fourhoi.com/${videoId}/cover-t.jpg`
        ];
        const previewUrls = [
          `https://fourhoi.com/${videoId}-uncensored-leak/preview.mp4`,
          `https://fourhoi.com/${videoId}/preview.mp4`
        ];
        const downloadFile = (url, localPath, retries = 3) => {
          return new Promise((resolve, reject) => {
            const parsed = new URL(url);
            const mod = parsed.protocol === "https:" ? https__namespace : http__namespace;
            const req = mod.request(
              {
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
                path: parsed.pathname + parsed.search,
                method: "GET",
                timeout: 15e3,
                headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
                  Referer: referer,
                  Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
                }
              },
              (res) => {
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                  downloadFile(res.headers.location, localPath, retries).then(resolve).catch(reject);
                  return;
                }
                if (res.statusCode !== 200) {
                  reject(new Error(`HTTP ${res.statusCode}`));
                  return;
                }
                const writer = fs__namespace.createWriteStream(localPath);
                res.pipe(writer);
                writer.on("finish", () => {
                  writer.close();
                  resolve();
                });
                writer.on("error", reject);
              }
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
        const tryCandidates = async (candidates, localPath, label) => {
          let lastError = null;
          for (const url of candidates) {
            try {
              clog("INFO", `Try ${label}: ${url}`);
              await downloadFile(url, localPath);
              const size = fs__namespace.existsSync(localPath) ? fs__namespace.statSync(localPath).size : 0;
              clog("SUCCESS", `${label} downloaded (${formatSize(size)})`);
              return;
            } catch (err) {
              lastError = err;
            }
          }
          throw lastError || new Error(`${label} download failed`);
        };
        await tryCandidates(coverUrls, coverLocalPath, "cover");
        await tryCandidates(previewUrls, previewLocalPath, "preview");
        clog("SUCCESS", `Cover/preview completed: ${name}`);
        return { success: true };
      } catch (err) {
        clog("ERROR", `Cover/preview failed: ${err?.message || err}`);
        return { success: false, error: err?.message || String(err) };
      } finally {
        release();
      }
    }),
    // 璇诲彇灏侀潰/棰勮鏃ュ織鏂囦欢
    readCoverLogs: t.procedure.query(() => {
      try {
        const file = getCoverLogFilePath();
        if (!fs__namespace.existsSync(file)) return [];
        const lines = fs__namespace.readFileSync(file, "utf-8").split("\n").filter(Boolean);
        return lines.slice(-1e3).map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        }).filter((e) => e !== null);
      } catch {
        return [];
      }
    }),
    // 娓呯┖灏侀潰/棰勮鏃ュ織鏂囦欢
    clearCoverLogs: t.procedure.mutation(() => {
      try {
        fs__namespace.writeFileSync(getCoverLogFilePath(), "");
        return { success: true };
      } catch {
        return { success: false };
      }
    })
  }),
  // 瑙嗛鍒楄〃
  videos: t.router({
    list: t.procedure.input((input) => input || {}).query(({ input }) => {
      const videoDir = input.path || "M:\\video\\videos\\";
      const videos = [];
      try {
        if (!fs__namespace.existsSync(videoDir)) return videos;
        const folders = fs__namespace.readdirSync(videoDir, { withFileTypes: true });
        for (const folder of folders) {
          if (!folder.isDirectory()) continue;
          const folderPath = path__namespace.join(videoDir, folder.name);
          let videoFile = path__namespace.join(folderPath, "video.mp4");
          if (!fs__namespace.existsSync(videoFile)) {
            const files = fs__namespace.readdirSync(folderPath, { withFileTypes: true });
            const exts = [
              "mp4",
              "mkv",
              "ts",
              "mov",
              "avi",
              "webm",
              "flv",
              "m4v"
            ];
            for (const f of files) {
              if (f.isFile()) {
                const ext = path__namespace.extname(f.name).toLowerCase().slice(1);
                if (exts.includes(ext) && f.name.toLowerCase() !== "preview.mp4") {
                  videoFile = path__namespace.join(folderPath, f.name);
                  break;
                }
              }
            }
          }
          if (!fs__namespace.existsSync(videoFile)) continue;
          let videoSize = 0;
          let videoMtime = 0;
          try {
            const st = fs__namespace.statSync(videoFile);
            videoSize = st.size;
            videoMtime = st.mtimeMs;
          } catch {
          }
          let coverFile = void 0;
          for (const ext of [
            "jpg",
            "jpeg",
            "png",
            "webp",
            "gif",
            "bmp",
            "avif"
          ]) {
            const c = path__namespace.join(folderPath, `cover.${ext}`);
            if (fs__namespace.existsSync(c)) {
              coverFile = c;
              break;
            }
          }
          let previewFile = void 0;
          for (const ext of ["mp4", "webm", "gif", "mov", "m4v"]) {
            const p = path__namespace.join(folderPath, `preview.${ext}`);
            if (fs__namespace.existsSync(p)) {
              previewFile = p;
              break;
            }
          }
          videos.push({
            id: folder.name,
            name: folder.name,
            url: videoFile,
            resolution: "local",
            encryptionType: "decrypted",
            coverUrl: coverFile,
            previewUrl: previewFile,
            size: formatSize(videoSize),
            createdAt: videoMtime || fs__namespace.statSync(folderPath).birthtime.getTime()
          });
        }
      } catch {
      }
      const logRow = (v) => console.log(
        `  ${v.name.slice(0, 20)} createdAt=${v.createdAt} (${new Date(v.createdAt ?? 0).toLocaleString()})`
      );
      videos.slice(0, 5).forEach(logRow);
      videos.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      videos.slice(0, 5).forEach(logRow);
      return videos;
    }),
    // Delete local video folder
    delete: t.procedure.input(
      (input) => input
    ).mutation(({ input }) => {
      const { folderPath, rootPath } = input;
      try {
        if (!fs__namespace.existsSync(folderPath)) {
          return { success: false, error: "鏂囦欢澶逛笉瀛樺湪" };
        }
        const resolvedFolderPath = path__namespace.resolve(folderPath);
        const resolvedRoot = path__namespace.resolve(rootPath || "M:\\video\\videos\\");
        const relative = path__namespace.relative(resolvedRoot, resolvedFolderPath);
        const isUnderRoot = relative !== "" && !relative.startsWith("..") && !path__namespace.isAbsolute(relative);
        if (!isUnderRoot) {
          return {
            success: false,
            error: "Delete path is outside video root directory"
          };
        }
        if (path__namespace.dirname(resolvedFolderPath) !== resolvedRoot) {
          return {
            success: false,
            error: "Only first-level child folders can be deleted"
          };
        }
        fs__namespace.rmSync(resolvedFolderPath, { recursive: true, force: true });
        console.log(`[videos.delete] deleted ${resolvedFolderPath}`);
        return { success: true, error: void 0 };
      } catch (err) {
        console.error(`[鍒犻櫎瑙嗛] 澶辫触: ${err.message}`);
        return { success: false, error: err.message };
      }
    })
  }),
  // 绐楀彛鎺у埗
  window: t.router({
    minimize: t.procedure.mutation(() => {
      mainWindow$1?.minimize();
      return { success: true };
    }),
    maximize: t.procedure.mutation(() => {
      if (mainWindow$1?.isMaximized()) {
        mainWindow$1.unmaximize();
      } else {
        mainWindow$1?.maximize();
      }
      return { success: true };
    }),
    close: t.procedure.mutation(() => {
      mainWindow$1?.close();
      return { success: true };
    })
  }),
  // Folder dialog
  dialog: t.router({
    selectFolder: t.procedure.input((input) => input || {}).query(async ({ input }) => {
      const result = await electron.dialog.showOpenDialog(mainWindow$1, {
        properties: ["openDirectory"],
        defaultPath: input.currentPath || void 0
      });
      return result.canceled ? null : result.filePaths[0];
    })
  }),
  // 鏂囦欢璺緞杞崲
  file: t.router({
    convertSrc: t.procedure.input((input) => input).query(({ input }) => {
      if (!input || input.startsWith("http") || input.startsWith("local-media://"))
        return input;
      const normalized = input.replace(/\\/g, "/");
      const segments = normalized.split("/");
      const encodedSegments = segments.map((seg, index) => {
        if (index === 0 && /^[a-zA-Z]:$/.test(seg)) {
          return seg;
        }
        return encodeURIComponent(seg);
      });
      return `local-media:///${encodedSegments.join("/")}`;
    })
  })
});
const MEDIA_MIME = {
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
  ".avif": "image/avif"
};
const guessMime = (p) => MEDIA_MIME[path.extname(p).toLowerCase()] || "application/octet-stream";
let mainWindow = null;
electron.protocol.registerSchemesAsPrivileged([
  {
    scheme: "cdn",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  },
  {
    scheme: "local-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);
function setupCdnProxyProtocol() {
  const CDN_DOMAINS = ["surrit.com", "surrit.org", "fourhoi.com"];
  const getReferer = (hostname, pathname) => {
    if (hostname.includes("fourhoi")) {
      const match = pathname.match(/\/([a-z]+-\d+-uncensored-leak)\//i);
      if (match) return `https://missav.ai/cn/${match[1]}`;
      return "https://missav.ai/";
    }
    return "https://missav.ai/";
  };
  electron.protocol.handle("cdn", (request) => {
    const cdnUrl = request.url.replace("cdn://", "https://");
    const parsedUrl = new URL(cdnUrl);
    const isCdnDomain = CDN_DOMAINS.some(
      (d) => parsedUrl.hostname === d || parsedUrl.hostname.endsWith(`.${d}`)
    );
    if (!isCdnDomain) return new Response("Not a CDN domain", { status: 403 });
    const referer = getReferer(parsedUrl.hostname, parsedUrl.pathname);
    return new Promise((resolve) => {
      const mod = parsedUrl.protocol === "https:" ? https__namespace : http__namespace;
      const req = mod.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
          path: parsedUrl.pathname + parsedUrl.search,
          method: "GET",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
            Referer: referer,
            Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "sec-ch-ua": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"'
          }
        },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            resolve(
              new Response(Buffer.concat(chunks), {
                status: res.statusCode || 200,
                headers: {
                  "Content-Type": res.headers["content-type"] || "application/octet-stream",
                  "Access-Control-Allow-Origin": "*"
                }
              })
            );
          });
        }
      );
      req.on("error", (err) => {
        resolve(new Response(`CDN Proxy Error: ${err.message}`, { status: 502 }));
      });
      req.end();
    });
  });
  console.log("[CDN代理] 已启用 cdn:// 协议");
}
function setupLocalMediaProtocol() {
  electron.protocol.handle("local-media", async (request) => {
    const url = request.url;
    try {
      const parsed = new URL(url);
      const host = parsed.hostname;
      let filePath;
      if (host && /^[a-z]$/i.test(host)) {
        filePath = `${host.toUpperCase()}:${decodeURIComponent(parsed.pathname)}`;
      } else {
        filePath = decodeURIComponent(parsed.pathname).replace(/^\//, "");
      }
      if (process.platform === "win32") {
        filePath = filePath.replace(/\//g, "\\");
      }
      if (!filePath || !fs__namespace.existsSync(filePath)) {
        return new Response("File not found", { status: 404 });
      }
      const stat = fs__namespace.statSync(filePath);
      const total = stat.size;
      const contentType = guessMime(filePath);
      const rangeHeader = request.headers.get("range");
      if (rangeHeader) {
        const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
        if (match) {
          const start = match[1] ? parseInt(match[1], 10) : 0;
          const end = match[2] ? parseInt(match[2], 10) : total - 1;
          if (start >= total || end >= total || start > end) {
            return new Response("Range Not Satisfiable", {
              status: 416,
              headers: { "Content-Range": `bytes */${total}` }
            });
          }
          const stream2 = fs__namespace.createReadStream(filePath, { start, end });
          return new Response(stream.Readable.toWeb(stream2), {
            status: 206,
            headers: {
              "Content-Type": contentType,
              "Content-Length": String(end - start + 1),
              "Content-Range": `bytes ${start}-${end}/${total}`,
              "Accept-Ranges": "bytes"
            }
          });
        }
      }
      const stream$1 = fs__namespace.createReadStream(filePath);
      return new Response(stream.Readable.toWeb(stream$1), {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(total),
          "Accept-Ranges": "bytes"
        }
      });
    } catch (err) {
      console.error(`[local-media] Error: ${err?.message}`);
      return new Response(`Error: ${err?.message}`, { status: 500 });
    }
  });
  console.log("[本地媒体] 已启用 local-media:// 协议");
}
function createWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 1280,
    height: 760,
    show: false,
    frame: false,
    titleBarStyle: "hidden",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });
  setMainWindow(mainWindow);
  main.createIPCHandler({ router: appRouter, windows: [mainWindow] });
  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
    mainWindow?.webContents.insertCSS(`
      * { outline: none !important; }
      *:focus { outline: none !important; box-shadow: none !important; border-color: transparent !important; }
      *:focus-visible { outline: none !important; box-shadow: none !important; border-color: transparent !important; }
    `);
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    electron.shell.openExternal(details.url);
    return { action: "deny" };
  });
  console.log("[主进程] ELECTRON_RENDERER_URL:", process.env["ELECTRON_RENDERER_URL"]);
  if (process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
electron.app.whenReady().then(() => {
  utils.electronApp.setAppUserModelId("com.avplaypro.app");
  electron.app.on("browser-window-created", (_, window) => {
    utils.optimizer.watchWindowShortcuts(window);
  });
  setupCdnProxyProtocol();
  setupLocalMediaProtocol();
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
