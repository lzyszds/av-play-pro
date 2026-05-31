"use strict";
const electron = require("electron");
const utils = require("@electron-toolkit/utils");
const path = require("path");
const fs = require("fs");
const main = require("electron-trpc-experimental/main");
const server$1 = require("@trpc/server");
const observable = require("@trpc/server/observable");
const https = require("https");
const http = require("http");
const child_process = require("child_process");
const log = require("electron-log/main");
const stream = require("stream");
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
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs);
const https__namespace = /* @__PURE__ */ _interopNamespaceDefault(https);
const http__namespace = /* @__PURE__ */ _interopNamespaceDefault(http);
const t = server$1.initTRPC.create();
let mainWindow = null;
function setMainWindow(win) {
  mainWindow = win;
}
function getMainWindow() {
  return mainWindow;
}
let downloadProcess = null;
let downloadPid = null;
let stopping = false;
let progressCallbacks = [];
let coverChain = Promise.resolve();
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
    child_process.exec(`taskkill /PID ${pid} /T /F`, (err, stdout, stderr) => {
      if (err) {
        console.error(
          `[killProcessTree] taskkill 失败 PID=${pid}: ${err.message} ${stderr}`
        );
      } else {
        console.log(`[killProcessTree] 已终止 PID=${pid}: ${stdout.trim()}`);
      }
    });
  } catch (err) {
    console.error("终止进程失败:", err);
  }
}
function sendProgress(payload) {
  progressCallbacks.forEach((cb) => cb(payload));
  getMainWindow()?.webContents.send("download-progress", payload);
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
  sendProgress({
    line: `[封面/预览] ${text}`,
    percent: null,
    done: false,
    success: level === "SUCCESS"
  });
}
function formatSize$1(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}
const downloadRouter = t.router({
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
          line: `[系统] 检测到已有下载进程 (PID: ${oldPid})锛屾鍦ㄧ粓姝?..`,
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
        line: `[系统] 宸插垱寤轰繚瀛樼洰褰? ${input.saveDir}`,
        percent: null,
        done: false,
        success: false
      });
    }
    if (!fs__namespace.existsSync(tmpDir)) {
      fs__namespace.mkdirSync(tmpDir, { recursive: true });
      sendProgress({
        line: `[系统] 宸插垱寤轰复鏃剁洰褰? ${tmpDir}`,
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
      line: `[系统] N_m3u8DL-RE 宸插惎鍔?(PID: ${pid})`,
      percent: 0,
      done: false,
      success: false
    });
    downloadProcess.on("spawn", () => {
      sendProgress({
        line: "[系统] 杩涚▼宸叉垚鍔?spawn",
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
        console.log(`[下载] 进程关闭: code=${code}, signal=${signal}`);
        const wasStopping = stopping;
        stopping = false;
        downloadProcess = null;
        downloadPid = null;
        if (wasStopping) {
          sendProgress({
            line: `[系统] 下载已停止`,
            percent: null,
            done: false,
            success: false
          });
          return;
        }
        if (code === 0) {
          sendProgress({
            line: `[系统] 下载已完成 (code: 0)`,
            percent: 100,
            done: true,
            success: true
          });
        } else {
          sendProgress({
            line: `[系统] 下载进程异常退出 (code: ${code})`,
            percent: null,
            done: true,
            success: false
          });
        }
      }
    );
    downloadProcess.on("error", (err) => {
      console.error(`[下载] 启动失败: ${err.message}`);
      sendProgress({
        line: `[错误] 启动失败: ${err.message}`,
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
      stopping = true;
      sendProgress({
        line: `[系统] 正在停止下载进程 (PID: ${pid})`,
        percent: null,
        done: false,
        success: false
      });
      killProcessTree(pid);
      try {
        downloadProcess?.kill();
      } catch {
      }
      downloadProcess = null;
      downloadPid = null;
      return { success: true };
    }
    sendProgress({
      line: "[系统] 当前没有正在运行的下载进程",
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
  // 鍒犻櫎浠诲姟鏃舵竻鐞?temp 临时文件
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
              line: `[SYSTEM] Deleted temp file: ${file} (${formatSize$1(stat.size)})`,
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
  // 下载完成后自动下载封面和预览视频
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
      clog("INFO", `开始下载封面和预览: ${name}`);
      if (name.toLowerCase().startsWith("desktop")) {
        clog("WARNING", `跳过封面和预览下载: ${name}`);
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
            clog("SUCCESS", `${label} downloaded (${formatSize$1(size)})`);
            return;
          } catch (err) {
            lastError = err;
          }
        }
        throw lastError || new Error(`${label} download failed`);
      };
      await tryCandidates(coverUrls, coverLocalPath, "cover");
      await tryCandidates(previewUrls, previewLocalPath, "preview");
      clog("SUCCESS", `封面和预览下载完成: ${name}`);
      return { success: true };
    } catch (err) {
      clog("ERROR", `封面和预览下载失败: ${err?.message || err}`);
      return { success: false, error: err?.message || String(err) };
    } finally {
      release();
    }
  }),
  // 读取封面/预览日志文件
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
  // 清空封面/预览日志文件
  clearCoverLogs: t.procedure.mutation(() => {
    try {
      fs__namespace.writeFileSync(getCoverLogFilePath(), "");
      return { success: true };
    } catch {
      return { success: false };
    }
  })
});
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
const videosRouter = t.router({
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
    videos.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    return videos;
  }),
  // Delete local video folder
  delete: t.procedure.input(
    (input) => input
  ).mutation(({ input }) => {
    const { folderPath, rootPath } = input;
    try {
      if (!fs__namespace.existsSync(folderPath)) {
        return { success: false, error: "文件夹不存在" };
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
      console.error(`[删除视频] 失败: ${err.message}`);
      return { success: false, error: err.message };
    }
  })
});
const mainWindowProxy = {
  minimize: () => getMainWindow()?.minimize(),
  isMaximized: () => getMainWindow()?.isMaximized(),
  unmaximize: () => getMainWindow()?.unmaximize(),
  maximize: () => getMainWindow()?.maximize(),
  focus: () => {
    const window = getMainWindow();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  },
  close: () => getMainWindow()?.close()
};
const windowRouter = t.router({
  minimize: t.procedure.mutation(() => {
    mainWindowProxy.minimize();
    return { success: true };
  }),
  maximize: t.procedure.mutation(() => {
    if (mainWindowProxy.isMaximized()) {
      mainWindowProxy.unmaximize();
    } else {
      mainWindowProxy.maximize();
    }
    return { success: true };
  }),
  close: t.procedure.mutation(() => {
    mainWindowProxy.close();
    return { success: true };
  }),
  focus: t.procedure.mutation(() => {
    mainWindowProxy.focus();
    return { success: true };
  })
});
const dialogRouter = t.router({
  selectFolder: t.procedure.input((input) => input || {}).query(async ({ input }) => {
    const result = await electron.dialog.showOpenDialog(getMainWindow(), {
      properties: ["openDirectory"],
      defaultPath: input.currentPath || void 0
    });
    return result.canceled ? null : result.filePaths[0];
  })
});
const fileRouter = t.router({
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
});
const EXTENSION_DIR_NAME = "m3u8-sniffer-extension";
function resolveExtensionPath() {
  const extensionPath = electron.app.isPackaged ? path__namespace.join(process.resourcesPath, "extension", EXTENSION_DIR_NAME) : path__namespace.resolve(process.cwd(), "extension", EXTENSION_DIR_NAME);
  if (!fs__namespace.existsSync(path__namespace.join(extensionPath, "manifest.json"))) {
    throw new Error(`Extension manifest not found: ${extensionPath}`);
  }
  return extensionPath;
}
const PUSH_PORT = 39527;
const MAX_BODY_SIZE = 1024 * 1024;
let server = null;
function getQueueFilePath() {
  return path__namespace.join(electron.app.getPath("userData"), "extension-push-queue.json");
}
function readQueue() {
  try {
    const file = getQueueFilePath();
    if (!fs__namespace.existsSync(file)) return [];
    const data = JSON.parse(fs__namespace.readFileSync(file, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
function writeQueue(queue) {
  const file = getQueueFilePath();
  fs__namespace.mkdirSync(path__namespace.dirname(file), { recursive: true });
  fs__namespace.writeFileSync(file, JSON.stringify(queue, null, 2), "utf8");
}
function appendToQueue(payload) {
  const queue = readQueue();
  const nextQueue = [...queue, payload].slice(-200);
  writeQueue(nextQueue);
  return nextQueue.length;
}
function consumeQueuedExtensionTaskPushes() {
  const queue = readQueue();
  writeQueue([]);
  return queue;
}
function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true"
  });
  response.end(JSON.stringify(payload));
}
function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
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
function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}
function getUrlParts(value) {
  try {
    const parsed = new URL(value);
    return {
      href: parsed.href,
      origin: parsed.origin,
      host: parsed.hostname.replace(/^www\./i, "").toLowerCase()
    };
  } catch {
    return null;
  }
}
function detectRefererSource(host) {
  if (host.includes("missav")) return "missav";
  if (host.includes("supjav")) return "supjav";
  if (host.includes("jav")) return "jav";
  return host || "unknown";
}
function normalizePushPayload(input) {
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
    coverUrl: asString(input.cover) || asString(input.coverUrl) || void 0,
    previewUrl: asString(input.preview) || asString(input.previewUrl) || void 0,
    quality: asString(input.quality) || void 0,
    source: asString(input.source) || void 0,
    pageUrl: pageParts?.href,
    referer,
    refererOrigin,
    refererSource,
    pushedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function emitExtensionTaskPush(input) {
  const payload = normalizePushPayload(input);
  const queuedCount = appendToQueue(payload);
  getMainWindow()?.webContents.send("extension-task-pushed", {
    queued: true,
    queuedCount
  });
  console.log(
    `[Extension Push] Queued ${payload.refererSource} task: ${payload.name} | ${payload.url}`
  );
  return payload;
}
async function handleDownloadPush(request, response) {
  try {
    const body = await readRequestBody(request);
    const raw = JSON.parse(body || "{}");
    const payload = emitExtensionTaskPush(raw);
    sendJson(response, 200, { success: true, task: payload });
  } catch (error) {
    sendJson(response, 400, {
      success: false,
      error: error?.message || String(error)
    });
  }
}
function startExtensionPushServer() {
  if (server) return;
  server = http__namespace.createServer((request, response) => {
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
function findChromeExecutable() {
  const candidates = process.platform === "win32" ? [
    process.env.LOCALAPPDATA && path__namespace.join(
      process.env.LOCALAPPDATA,
      "Google",
      "Chrome",
      "Application",
      "chrome.exe"
    ),
    process.env.PROGRAMFILES && path__namespace.join(
      process.env.PROGRAMFILES,
      "Google",
      "Chrome",
      "Application",
      "chrome.exe"
    ),
    process.env["PROGRAMFILES(X86)"] && path__namespace.join(
      process.env["PROGRAMFILES(X86)"],
      "Google",
      "Chrome",
      "Application",
      "chrome.exe"
    )
  ] : process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"] : [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/snap/bin/chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ];
  const chromePath = candidates.find(
    (candidate) => Boolean(candidate && fs__namespace.existsSync(candidate))
  );
  if (!chromePath) {
    throw new Error("Google Chrome executable was not found.");
  }
  return chromePath;
}
function isChromeRunning() {
  if (process.platform !== "win32") return Promise.resolve(false);
  return new Promise((resolve) => {
    child_process.execFile(
      "tasklist",
      ["/FI", "IMAGENAME eq chrome.exe", "/NH"],
      { windowsHide: true },
      (_error, stdout) => {
        resolve(stdout.toLowerCase().includes("chrome.exe"));
      }
    );
  });
}
function navigateChromeToExtensionsPage() {
  if (process.platform !== "win32") return Promise.resolve();
  const script = [
    "$ws = New-Object -ComObject WScript.Shell",
    "Start-Sleep -Milliseconds 900",
    "$activated = $ws.AppActivate('Google Chrome')",
    "if (-not $activated) { $activated = $ws.AppActivate('Chrome') }",
    "if ($activated) {",
    "  Start-Sleep -Milliseconds 200",
    "  $ws.SendKeys('^l')",
    "  Start-Sleep -Milliseconds 100",
    "  $ws.SendKeys('^v')",
    "  Start-Sleep -Milliseconds 100",
    "  $ws.SendKeys('{ENTER}')",
    "}"
  ].join("; ");
  return new Promise((resolve) => {
    child_process.execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true },
      () => resolve()
    );
  });
}
const extensionRouter = t.router({
  consumePushedTasks: t.procedure.mutation(() => {
    return consumeQueuedExtensionTaskPushes();
  }),
  installToChrome: t.procedure.input((input) => input || {}).mutation(async () => {
    const extensionPath = resolveExtensionPath();
    const chromePath = findChromeExecutable();
    const chromeRunning = await isChromeRunning();
    electron.clipboard.writeText("chrome://extensions");
    const child = child_process.spawn(chromePath, [], {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    await navigateChromeToExtensionsPage();
    electron.clipboard.writeText(extensionPath);
    return {
      success: true,
      chromePath,
      extensionPath,
      chromeRunning,
      clipboardWritten: true
    };
  })
});
function getDownloadStatePath() {
  return path__namespace.join(electron.app.getPath("userData"), "download-state.json");
}
function getSettingsPath$1() {
  return path__namespace.join(electron.app.getPath("userData"), "settings.json");
}
function readDownloadState() {
  try {
    const file = getDownloadStatePath();
    if (!fs__namespace.existsSync(file)) return { tasks: [], logs: [] };
    const data = JSON.parse(fs__namespace.readFileSync(file, "utf8"));
    return {
      tasks: Array.isArray(data.tasks) ? data.tasks : [],
      logs: Array.isArray(data.logs) ? data.logs : []
    };
  } catch {
    return { tasks: [], logs: [] };
  }
}
function writeDownloadState(state) {
  const file = getDownloadStatePath();
  fs__namespace.mkdirSync(path__namespace.dirname(file), { recursive: true });
  fs__namespace.writeFileSync(file, JSON.stringify(state, null, 2), "utf8");
}
const storageRouter = t.router({
  getSettings: t.procedure.query(() => {
    try {
      const file = getSettingsPath$1();
      if (!fs__namespace.existsSync(file)) return {};
      return JSON.parse(fs__namespace.readFileSync(file, "utf8"));
    } catch {
      return {};
    }
  }),
  saveSettings: t.procedure.input((input) => input).mutation(({ input }) => {
    const file = getSettingsPath$1();
    fs__namespace.mkdirSync(path__namespace.dirname(file), { recursive: true });
    fs__namespace.writeFileSync(file, JSON.stringify(input || {}, null, 2), "utf8");
    return { success: true };
  }),
  getDownloadState: t.procedure.query(() => {
    return readDownloadState();
  }),
  saveDownloadState: t.procedure.input((input) => input).mutation(({ input }) => {
    writeDownloadState({
      tasks: Array.isArray(input.tasks) ? input.tasks : [],
      logs: Array.isArray(input.logs) ? input.logs : []
    });
    return { success: true };
  })
});
let initialized = false;
function initLogger() {
  if (initialized) return log;
  initialized = true;
  log.transports.file.resolvePathFn = (variables) => {
    return path__namespace.join(
      electron.app.getPath("userData"),
      "logs",
      variables.fileName || "main.log"
    );
  };
  log.transports.file.maxSize = 5 * 1024 * 1024;
  log.transports.file.level = "info";
  log.transports.console.level = electron.app.isPackaged ? "warn" : "debug";
  log.transports.console.format = "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}";
  log.initialize();
  log.info(`[logger] initialized | userData=${electron.app.getPath("userData")}`);
  return log;
}
function installGlobalErrorHandlers() {
  process.on("uncaughtException", (err) => {
    log.error("[uncaughtException]", err);
  });
  process.on("unhandledRejection", (reason) => {
    log.error("[unhandledRejection]", reason);
  });
  electron.app.on("render-process-gone", (_event, _wc, details) => {
    log.error("[render-process-gone]", details);
  });
  electron.app.on("child-process-gone", (_event, details) => {
    log.error("[child-process-gone]", details);
  });
}
const loggerRouter = t.router({
  write: t.procedure.input(
    (input) => input
  ).mutation(({ input }) => {
    const tag = input.scope ? `[renderer:${input.scope}]` : "[renderer]";
    const fn = log[input.level] || log.info;
    fn(tag, input.message);
    return { success: true };
  })
});
const systemRouter = t.router({
  // 用户未设置时的默认媒体路径（跨平台兜底）
  getDefaultPaths: t.procedure.query(() => {
    const videos = electron.app.getPath("videos");
    return {
      video_path: path__namespace.join(videos, "AVPlayPro") + path__namespace.sep,
      temp_path: path__namespace.join(electron.app.getPath("temp"), "AVPlayPro") + path__namespace.sep
    };
  }),
  // 主进程系统通知（绕过浏览器弹通知，能命中 Windows 行动中心）
  notify: t.procedure.input(
    (input) => input
  ).mutation(({ input }) => {
    if (!electron.Notification.isSupported()) return { success: false };
    const n = new electron.Notification({
      title: input.title,
      body: input.body,
      silent: input.silent ?? true
      // 系统声音由前端 tips.mp3 接管
    });
    n.on("click", () => {
      const win = getMainWindow();
      if (!win) return;
      if (win.isMinimized()) win.restore();
      if (!win.isVisible()) win.show();
      win.focus();
    });
    n.show();
    return { success: true };
  }),
  // 目标盘剩余空间（字节）。失败返回 -1
  getDiskFree: t.procedure.input((input) => input).query(async ({ input }) => {
    try {
      let probe = input.path;
      while (probe && !fs__namespace.existsSync(probe)) {
        const parent = path__namespace.dirname(probe);
        if (!parent || parent === probe) break;
        probe = parent;
      }
      if (!probe || !fs__namespace.existsSync(probe)) return { free: -1, total: -1 };
      const s = await fs__namespace.promises.statfs(probe);
      return { free: s.bsize * s.bavail, total: s.bsize * s.blocks };
    } catch {
      return { free: -1, total: -1 };
    }
  }),
  // 任务栏进度条（Win/Mac dock）
  setTaskbarProgress: t.procedure.input((input) => input).mutation(({ input }) => {
    const win = getMainWindow();
    if (!win) return { success: false };
    win.setProgressBar(input.progress);
    return { success: true };
  })
});
const appRouter = t.router({
  download: downloadRouter,
  videos: videosRouter,
  window: windowRouter,
  dialog: dialogRouter,
  file: fileRouter,
  extension: extensionRouter,
  storage: storageRouter,
  logger: loggerRouter,
  system: systemRouter
});
let tray = null;
let isQuitting = false;
function getIsQuitting() {
  return isQuitting;
}
function markQuitting() {
  isQuitting = true;
}
function resolveTrayIcon() {
  const candidates = [
    path.join(__dirname, "../../resources/icon.png"),
    path.join(process.resourcesPath || "", "resources", "icon.png"),
    path.join(process.resourcesPath || "", "icon.png")
  ];
  return candidates.find((p) => fs.existsSync(p));
}
function setupTray(window) {
  if (tray) return tray;
  const iconPath = resolveTrayIcon();
  const image = iconPath ? electron.nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }) : electron.nativeImage.createEmpty();
  tray = new electron.Tray(image);
  tray.setToolTip("AVPlayPro");
  const showWindow = () => {
    if (window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  };
  const buildMenu = () => electron.Menu.buildFromTemplate([
    {
      label: window.isVisible() ? "隐藏主窗口" : "显示主窗口",
      click: () => window.isVisible() ? window.hide() : showWindow()
    },
    { type: "separator" },
    {
      label: "退出 AVPlayPro",
      click: () => {
        isQuitting = true;
        electron.app.quit();
      }
    }
  ]);
  tray.setContextMenu(buildMenu());
  tray.on("double-click", showWindow);
  tray.on("click", showWindow);
  window.on("show", () => tray?.setContextMenu(buildMenu()));
  window.on("hide", () => tray?.setContextMenu(buildMenu()));
  log.info("[tray] initialized");
  return tray;
}
function resolveAppIcon() {
  const candidates = [
    path.join(__dirname, "../../resources/icon.png"),
    path.join(process.resourcesPath || "", "resources", "icon.png"),
    path.join(process.resourcesPath || "", "icon.png")
  ];
  return candidates.find((p) => fs.existsSync(p));
}
function getSettingsPath() {
  return path.join(electron.app.getPath("userData"), "settings.json");
}
function readCloseAction() {
  try {
    const file = getSettingsPath();
    if (!fs.existsSync(file)) return "ask";
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return data.closeAction ?? "ask";
  } catch {
    return "ask";
  }
}
function writeCloseAction(action) {
  try {
    const file = getSettingsPath();
    fs.mkdirSync(path.join(file, ".."), { recursive: true });
    const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    fs.writeFileSync(
      file,
      JSON.stringify({ ...prev, closeAction: action }, null, 2),
      "utf8"
    );
  } catch (err) {
    log.error("[createMainWindow] writeCloseAction failed", err);
  }
}
function createMainWindow() {
  const appIcon = resolveAppIcon();
  const window = new electron.BrowserWindow({
    width: 1280,
    height: 760,
    show: false,
    frame: false,
    titleBarStyle: "hidden",
    ...appIcon ? { icon: appIcon } : {},
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      webSecurity: true
    }
  });
  setMainWindow(window);
  main.createIPCHandler({ router: appRouter, windows: [window] });
  setupTray(window);
  window.on("close", (event) => {
    if (getIsQuitting()) return;
    let action = readCloseAction();
    if (action === "ask") {
      event.preventDefault();
      const result = electron.dialog.showMessageBoxSync(window, {
        type: "question",
        buttons: ["最小化到托盘", "彻底退出", "取消"],
        defaultId: 0,
        cancelId: 2,
        title: "关闭确认",
        message: "关闭主窗口时希望执行哪种操作？",
        detail: "选择后会被记住，可在「设置 → 关闭主窗口时」修改。"
      });
      if (result === 2) return;
      action = result === 0 ? "tray" : "quit";
      writeCloseAction(action);
    }
    if (action === "tray") {
      event.preventDefault();
      window.hide();
      return;
    }
    markQuitting();
    electron.app.quit();
  });
  window.on("ready-to-show", () => {
    window?.show();
  });
  window.webContents.setWindowOpenHandler((details) => {
    electron.shell.openExternal(details.url);
    return { action: "deny" };
  });
  log.info(
    `[主进程] ELECTRON_RENDERER_URL=${process.env["ELECTRON_RENDERER_URL"]}`
  );
  if (process.env["ELECTRON_RENDERER_URL"]) {
    window.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    window.webContents.openDevTools();
  } else {
    window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
function setupCdnProxyProtocol() {
  const CDN_DOMAINS = ["surrit.com", "surrit.org", "fourhoi.com"];
  const getReferer = (hostname, pathname) => {
    if (hostname.includes("fourhoi")) {
      const match = pathname.match(/\/([a-z0-9]+-\d+-uncensored-leak)\//i);
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
            Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,video/*,*/*;q=0.8",
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
        resolve(
          new Response(`CDN Proxy Error: ${err.message}`, { status: 502 })
        );
      });
      req.end();
    });
  });
  console.log("[CDN代理] 已启用 cdn:// 协议");
}
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
function registerAppProtocolSchemes() {
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
}
const AD_HOST_KEYWORDS$1 = [
  "doubleclick",
  "googlesyndication",
  "googletagmanager",
  "googletagservices",
  "adservice.google",
  "exoclick",
  "exosrv",
  "juicyads",
  "trafficjunky",
  "trafficfactory",
  "adsterra",
  "propeller",
  "onclick",
  "popads",
  "popcash",
  "hilltopads",
  "smartadserver",
  "criteo",
  "taboola",
  "outbrain",
  "mgid",
  "revcontent",
  "adnxs",
  "adsrvr",
  "histats",
  "ad-score",
  "adform",
  "magsrv",
  "tsyndicate",
  "bebi",
  "adnium",
  "ero-advertising",
  "ad-maven",
  "adkernel",
  "adnami",
  "adxxx"
];
const ALLOWED_FRAME_HOST_KEYWORDS$1 = ["missav", "fourhoi", "localhost"];
function getAdBlockScript() {
  return `
;(function () {
  if (window.__AVPLAY_AD_BLOCKER_INSTALLED__) return;
  window.__AVPLAY_AD_BLOCKER_INSTALLED__ = true;

  var AD_HOST_KEYWORDS = ${JSON.stringify(AD_HOST_KEYWORDS$1)};
  var ALLOWED_FRAME_HOST_KEYWORDS = ${JSON.stringify(ALLOWED_FRAME_HOST_KEYWORDS$1)};
  var SELECTORS = [
    'iframe:not([src])',
    'iframe[src=""]',
    'iframe[src="about:blank"]',
    'iframe[srcdoc]',
    'iframe[src*="ads"]',
    'iframe[src*="adserver"]',
    'iframe[src*="doubleclick"]',
    'iframe[src*="googlesyndication"]',
    'iframe[src*="exoclick"]',
    'iframe[src*="exosrv"]',
    'iframe[src*="juicyads"]',
    'iframe[src*="trafficjunky"]',
    'iframe[src*="magsrv"]',
    'iframe[src*="tsyndicate"]',
    '[id*="ad-"]',
    '[id^="ad_"]',
    '[id$="-ad"]',
    '[id*="ads"]',
    '[class*=" ad-"]',
    '[class^="ad-"]',
    '[class*="-ad "]',
    '[class*=" ads"]',
    '[class*="ads-"]',
    '[class*="advert"]',
    '[class*="banner"]',
    '[class*="sponsor"]',
    '[class*="popup"]',
    '[class*="popunder"]',
    '[data-ad]',
    '[data-ads]',
    '[data-ad-slot]',
    '[data-ad-client]',
    'ins.adsbygoogle'
  ];

  function hostOf(value) {
    try { return new URL(value, location.href).hostname.toLowerCase(); }
    catch (_) { return ''; }
  }

  function isAdUrl(value) {
    var host = hostOf(value);
    if (!host) return false;
    return AD_HOST_KEYWORDS.some(function (keyword) { return host.indexOf(keyword) !== -1; });
  }

  function isAllowedFrameUrl(value) {
    var host = hostOf(value);
    if (!host) return false;
    return ALLOWED_FRAME_HOST_KEYWORDS.some(function (keyword) {
      return host.indexOf(keyword) !== -1;
    });
  }

  function removeNode(node) {
    if (!node || node.id === 'm3u8-sniffer-root') return;
    if (node.closest && node.closest('#m3u8-sniffer-root')) return;
    node.remove();
  }

  function removeWithEmptyWrapper(node) {
    var parent = node && node.parentElement;
    removeNode(node);
    if (!parent || parent.id === 'm3u8-sniffer-root') return;
    if (parent.closest && parent.closest('#m3u8-sniffer-root')) return;

    var text = ((parent.id || '') + ' ' + (parent.className || '')).toLowerCase();
    var looksLikeAdWrapper = /ad|ads|advert|banner|sponsor|popup|modal|overlay|iframe|float/.test(text);
    var meaningfulChildren = Array.prototype.slice.call(parent.children || []).filter(function (child) {
      return child.id !== 'm3u8-sniffer-root';
    });

    if (looksLikeAdWrapper || meaningfulChildren.length === 0) {
      removeNode(parent);
    }
  }

  function cleanBySelector() {
    SELECTORS.forEach(function (selector) {
      document.querySelectorAll(selector).forEach(removeNode);
    });
  }

  function cleanLinksAndFrames() {
    document.querySelectorAll('a[href], iframe[src], script[src], img[src]').forEach(function (node) {
      var url = node.getAttribute('href') || node.getAttribute('src') || '';
      if (isAdUrl(url)) removeNode(node);
    });
  }

  function cleanIframes() {
    document.querySelectorAll('iframe').forEach(function (frame) {
      var src = frame.getAttribute('src') || '';
      var srcdoc = frame.getAttribute('srcdoc');
      if (!src || src === 'about:blank' || srcdoc != null) {
        removeWithEmptyWrapper(frame);
        return;
      }

      if (!isAllowedFrameUrl(src)) {
        removeWithEmptyWrapper(frame);
      }
    });
  }

  function cleanFixedOverlays() {
    Array.prototype.slice.call(document.body ? document.body.children : []).forEach(function (node) {
      if (!node || node.id === 'm3u8-sniffer-root') return;
      var style = window.getComputedStyle(node);
      if (style.position !== 'fixed' && style.position !== 'sticky') return;

      var rect = node.getBoundingClientRect();
      var area = rect.width * rect.height;
      var viewport = window.innerWidth * window.innerHeight;
      var zIndex = parseInt(style.zIndex || '0', 10) || 0;
      var text = ((node.id || '') + ' ' + (node.className || '')).toLowerCase();
      var looksLikeAd = /ad|ads|advert|banner|sponsor|popup|modal|overlay|float/.test(text);
      var blocksScreen = viewport > 0 && area / viewport > 0.18 && zIndex >= 10;

      if (looksLikeAd || blocksScreen) removeNode(node);
    });
  }

  function clean() {
    cleanBySelector();
    cleanLinksAndFrames();
    cleanIframes();
    cleanFixedOverlays();
  }

  var nativeOpen = window.open;
  window.open = function (url) {
    if (!url || isAdUrl(url)) return null;
    return nativeOpen.apply(window, arguments);
  };

  document.addEventListener('click', function (event) {
    var target = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (target && isAdUrl(target.href)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
  }, true);

  var style = document.createElement('style');
  style.textContent = SELECTORS.join(',') + ',iframe:not([src*="missav"]):not([src*="fourhoi"]):not([src*="localhost"]){display:none!important;visibility:hidden!important;pointer-events:none!important;}';
  (document.head || document.documentElement).appendChild(style);

  clean();
  new MutationObserver(clean).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(clean, 1200);
})();
`;
}
const MISSAV_WEB_PARTITION = "persist:missav-web";
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
  "adnami.io"
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
  /\/adserve\//i
];
let configured = false;
let blockedAdRequests = 0;
let snifferSourceCache = null;
function isMediaUrl(url) {
  return /\.(m3u8|mp4|m4v|webm|ts|m4s)(\?|#|$)/i.test(url);
}
function shouldBlockAdRequest(url, resourceType = "") {
  if (!/^https?:\/\//i.test(url) || isMediaUrl(url)) return false;
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const path2 = `${parsed.pathname}${parsed.search}`;
    if (AD_HOST_KEYWORDS.some((keyword) => hostname.includes(keyword))) {
      return true;
    }
    if (resourceType === "subFrame" && !ALLOWED_FRAME_HOST_KEYWORDS.some((keyword) => hostname.includes(keyword))) {
      return true;
    }
    if (resourceType === "mainFrame" || resourceType === "media") {
      return false;
    }
    return AD_URL_PATTERNS.some((pattern) => pattern.test(path2));
  } catch {
    return false;
  }
}
function setupAdBlocker(webSession) {
  webSession.webRequest.onBeforeRequest((details, callback) => {
    const blocked = shouldBlockAdRequest(details.url, details.resourceType);
    if (blocked) {
      blockedAdRequests += 1;
      if (blockedAdRequests <= 20 || blockedAdRequests % 50 === 0) {
        console.log(
          `[MissAV Web] Blocked ad request #${blockedAdRequests}: ${details.url}`
        );
      }
    }
    callback({ cancel: blocked });
  });
}
function setupPopupBlocker(webSession) {
  electron.app.on("web-contents-created", (_event, contents) => {
    if (contents.session !== webSession) return;
    contents.setWindowOpenHandler((details) => {
      console.log(`[MissAV Web] Blocked popup: ${details.url}`);
      return { action: "deny" };
    });
    contents.on("dom-ready", () => {
      void ensureAdBlockerInjected(contents);
      void ensureSnifferToolInjected(contents);
    });
    contents.on("console-message", (_event2, _level, message) => {
      if (!message.startsWith(EXTENSION_PUSH_CONSOLE_PREFIX)) return;
      try {
        const raw = JSON.parse(
          message.slice(EXTENSION_PUSH_CONSOLE_PREFIX.length)
        );
        emitExtensionTaskPush(raw);
      } catch (error) {
        console.warn("[MissAV Web] Failed to read console push payload:", error);
      }
    });
  });
}
async function ensureAdBlockerInjected(contents) {
  if (contents.isDestroyed()) return;
  try {
    await contents.executeJavaScript(getAdBlockScript(), true);
  } catch (error) {
    console.warn("[MissAV Web] Failed to inject ad blocker:", error);
  }
}
function readSnifferSource() {
  if (snifferSourceCache) return snifferSourceCache;
  snifferSourceCache = fs__namespace.readFileSync(
    path__namespace.join(resolveExtensionPath(), "injected.js"),
    "utf8"
  );
  return snifferSourceCache;
}
async function ensureSnifferToolInjected(contents) {
  if (contents.isDestroyed()) return;
  try {
    const installed = await contents.executeJavaScript(
      "Boolean(window.__M3U8_SNIFFER_INSTALLED__)",
      true
    );
    if (installed) return;
    await contents.executeJavaScript(readSnifferSource(), true);
    console.log("[MissAV Web] Sniffer tool injected into webview");
  } catch (error) {
    console.warn("[MissAV Web] Failed to inject sniffer tool:", error);
  }
}
async function loadSnifferExtension(webSession) {
  const extensionPath = resolveExtensionPath();
  const loadedExtension = webSession.getAllExtensions().find((extension2) => extension2.path === extensionPath);
  if (loadedExtension) {
    console.log(`[MissAV Web] Extension already loaded: ${loadedExtension.name}`);
    return;
  }
  const extension = await webSession.loadExtension(extensionPath, {
    allowFileAccess: true
  });
  console.log(`[MissAV Web] Extension loaded: ${extension.name}`);
}
async function setupMissavWebSession() {
  if (configured) return;
  configured = true;
  const webSession = electron.session.fromPartition(MISSAV_WEB_PARTITION);
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
registerAppProtocolSchemes();
electron.app.whenReady().then(async () => {
  initLogger();
  installGlobalErrorHandlers();
  utils.electronApp.setAppUserModelId("com.avplaypro.app");
  electron.app.on("browser-window-created", (_, window) => {
    utils.optimizer.watchWindowShortcuts(window);
  });
  setupCdnProxyProtocol();
  setupLocalMediaProtocol();
  startExtensionPushServer();
  await setupMissavWebSession();
  createMainWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
  log.info("[app] ready");
});
electron.app.on("before-quit", () => {
  markQuitting();
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
