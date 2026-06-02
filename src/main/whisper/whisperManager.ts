import { app, BrowserWindow } from "electron";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as https from "https";
import { spawn, spawnSync, ChildProcess } from "child_process";

/**
 * 期望的二进制布局：
 *   <userData>/whisper/whisper-cli.exe   ← https://github.com/ggerganov/whisper.cpp releases
 *   <userData>/whisper/ffmpeg.exe        ← https://www.gyan.dev/ffmpeg/builds (essentials)
 *   <userData>/whisper/models/ggml-base.bin   ← 首次使用自动下载
 */

export type WhisperModel = "tiny" | "base" | "small" | "medium" | "large-v3";

type DownloadSource = { name: string; url: string };

function modelSources(fileName: string): DownloadSource[] {
  return [
    {
      name: "Hugging Face",
      url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${fileName}`,
    },
    {
      name: "HF Mirror",
      url: `https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/${fileName}`,
    },
  ];
}

const MODEL_SOURCES: Record<WhisperModel, DownloadSource[]> = {
  tiny: modelSources("ggml-tiny.bin"),
  base: modelSources("ggml-base.bin"),
  small: modelSources("ggml-small.bin"),
  medium: modelSources("ggml-medium.bin"),
  "large-v3": modelSources("ggml-large-v3.bin"),
};

const dir = () => path.join(app.getPath("userData"), "whisper");
const modelsDir = () => path.join(dir(), "models");

export const whisperPaths = {
  root: dir,
  whisperBin: () => path.join(dir(), "whisper-cli.exe"),
  localFfmpeg: () => path.join(dir(), "ffmpeg.exe"),
  modelFile: (m: WhisperModel) => path.join(modelsDir(), `ggml-${m}.bin`),
};

export function ensureDirs(): void {
  fs.mkdirSync(modelsDir(), { recursive: true });
}

/** 检测系统 PATH 里是否存在 ffmpeg；存在则返回 "ffmpeg"，否则 null */
function detectSystemFfmpeg(): string | null {
  try {
    const r = spawnSync(process.platform === "win32" ? "where" : "which", [
      "ffmpeg",
    ]);
    if (r.status === 0 && r.stdout) {
      const first = r.stdout.toString().split(/\r?\n/)[0].trim();
      if (first && fs.existsSync(first)) return first;
    }
  } catch {
    /* ignore */
  }
  // 兜底：直接尝试 spawn 'ffmpeg -version'，能跑就用
  try {
    const r = spawnSync("ffmpeg", ["-version"]);
    if (r.status === 0) return "ffmpeg";
  } catch {
    /* ignore */
  }
  return null;
}

/** 返回当前可用的 ffmpeg 路径：优先系统 PATH，其次本地下载 */
export function resolveFfmpeg(): { path: string; source: "system" | "local" } | null {
  const sys = detectSystemFfmpeg();
  if (sys) return { path: sys, source: "system" };
  const local = whisperPaths.localFfmpeg();
  if (fs.existsSync(local)) return { path: local, source: "local" };
  return null;
}

export interface EnvStatus {
  whisperBin: boolean;
  ffmpeg: boolean;
  ffmpegSource: "system" | "local" | null;
  ffmpegPath: string | null;
  rootDir: string;
  installedModels: WhisperModel[];
}

export function checkEnv(): EnvStatus {
  ensureDirs();
  const installed: WhisperModel[] = [];
  for (const m of Object.keys(MODEL_SOURCES) as WhisperModel[]) {
    if (fs.existsSync(whisperPaths.modelFile(m))) installed.push(m);
  }
  const ff = resolveFfmpeg();
  return {
    whisperBin: fs.existsSync(whisperPaths.whisperBin()),
    ffmpeg: !!ff,
    ffmpegSource: ff?.source ?? null,
    ffmpegPath: ff?.path ?? null,
    rootDir: dir(),
    installedModels: installed,
  };
}

function broadcast(event: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(event, payload);
  }
}

/* ===================== 模型下载 ===================== */

let downloadingModel: WhisperModel | null = null;

export async function downloadModel(model: WhisperModel): Promise<void> {
  if (downloadingModel) throw new Error(`正在下载 ${downloadingModel}，请稍候`);
  ensureDirs();
  const sources = MODEL_SOURCES[model];
  const dest = whisperPaths.modelFile(model);
  const tmp = dest + ".part";
  downloadingModel = model;

  try {
    await downloadFromSources(sources, tmp, (source, downloaded, total) => {
      broadcast("whisper:model-progress", {
        model,
        source: source.name,
        downloaded,
        total,
        percent: total ? (downloaded / total) * 100 : 0,
      });
    });
    fs.renameSync(tmp, dest);
    broadcast("whisper:model-done", { model });
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    broadcast("whisper:model-error", {
      model,
      message: (err as Error).message,
    });
    throw err;
  } finally {
    downloadingModel = null;
  }
}

/* ===================== 二进制下载 / 解压 ===================== */

const WHISPER_BIN_VERSION = "v1.8.4";
const DOWNLOAD_TIMEOUT_MS = 30_000;
const WHISPER_RELEASE_SOURCES = [
  {
    name: "GitHub",
    url: `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_BIN_VERSION}/whisper-bin-x64.zip`,
  },
  {
    name: "SourceForge 镜像",
    url: `https://sourceforge.net/projects/whisper-cpp.mirror/files/${WHISPER_BIN_VERSION}/whisper-bin-x64.zip/download`,
  },
];
// BtbN 提供 essentials zip（小，仅 bin/ 三个 exe）
const FFMPEG_RELEASE_URL =
  "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";

type BinJob = "whisper-bin" | "ffmpeg-bin";
let installingBin: BinJob | null = null;

function reportBin(job: BinJob, percent: number, stage: string): void {
  broadcast("whisper:install-progress", { job, percent, stage });
}

async function downloadToFile(
  url: string,
  destFile: string,
  onProgress: (downloaded: number, total: number) => void,
  redirectsLeft = 5,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let fileStream: fs.WriteStream | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      fileStream?.destroy();
      reject(err);
    };

    const req = https.get(url, { timeout: DOWNLOAD_TIMEOUT_MS }, (res) => {
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        if (redirectsLeft <= 0) {
          fail(new Error("too many redirects"));
          return;
        }
        res.resume();
        downloadToFile(
          new URL(res.headers.location, url).href,
          destFile,
          onProgress,
          redirectsLeft - 1,
        ).then(finish, fail);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        fail(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const total = Number(res.headers["content-length"] || 0);
      let downloaded = 0;
      const f = fs.createWriteStream(destFile);
      fileStream = f;
      res.on("data", (c: Buffer) => {
        downloaded += c.length;
        onProgress(downloaded, total);
      });
      res.on("error", fail);
      res.pipe(f);
      f.on("finish", () => f.close((e) => (e ? fail(e) : finish())));
      f.on("error", fail);
    });
    req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
      req.destroy(new Error(`连接超时 (${DOWNLOAD_TIMEOUT_MS / 1000}s)`));
    });
    req.on("error", fail);
  });
}

async function downloadFromSources(
  sources: DownloadSource[],
  destFile: string,
  onProgress: (source: DownloadSource, downloaded: number, total: number) => void,
): Promise<void> {
  const errors: string[] = [];
  for (const source of sources) {
    try {
      try {
        fs.unlinkSync(destFile);
      } catch {
        /* ignore */
      }
      await downloadToFile(source.url, destFile, (downloaded, total) =>
        onProgress(source, downloaded, total),
      );
      return;
    } catch (err) {
      errors.push(`${source.name}: ${(err as Error).message}`);
    }
  }
  throw new Error(`下载失败，已尝试 ${errors.join("；")}`);
}

/** 用 Windows 自带 tar.exe 解压 zip (Win10 1803+ 自带) */
async function extractZip(zipPath: string, destDir: string): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });
  return new Promise((resolve, reject) => {
    const proc = spawn("tar", ["-xf", zipPath, "-C", destDir], {
      windowsHide: true,
    });
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar 解压失败 (${code}): ${stderr.slice(-300)}`));
    });
    proc.on("error", reject);
  });
}

/** 递归查找文件名（first match） */
function findFile(root: string, name: string): string | null {
  if (!fs.existsSync(root)) return null;
  const stack: string[] = [root];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.name.toLowerCase() === name.toLowerCase()) return full;
    }
  }
  return null;
}

/** 把目录 A 的所有文件拷到目录 B（扁平/递归都行） */
function copyAll(srcDir: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  for (const e of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, e.name);
    const dst = path.join(destDir, e.name);
    if (e.isDirectory()) copyAll(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

export async function installWhisperBin(): Promise<void> {
  if (installingBin) throw new Error(`正在安装 ${installingBin}`);
  installingBin = "whisper-bin";
  ensureDirs();
  const tmpDir = path.join(os.tmpdir(), `whisper-dl-${Date.now()}`);
  const zipPath = path.join(tmpDir, "whisper.zip");
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    reportBin("whisper-bin", 0, "下载 whisper-cli...");
    await downloadFromSources(WHISPER_RELEASE_SOURCES, zipPath, (source, d, t) =>
      reportBin(
        "whisper-bin",
        t ? (d / t) * 80 : 0,
        `下载 whisper-cli (${source.name})...`,
      ),
    );
    reportBin("whisper-bin", 85, "解压...");
    const extractDir = path.join(tmpDir, "ex");
    await extractZip(zipPath, extractDir);
    const cli = findFile(extractDir, "whisper-cli.exe");
    if (!cli) throw new Error("解压后未找到 whisper-cli.exe");
    // 把 cli 所在目录的所有 dll/exe 一起拷到 whisper 根目录（whisper.cpp 依赖一堆 dll）
    copyAll(path.dirname(cli), dir());
    reportBin("whisper-bin", 100, "完成");
    broadcast("whisper:install-done", { job: "whisper-bin" });
  } catch (err) {
    broadcast("whisper:install-error", {
      job: "whisper-bin",
      message: (err as Error).message,
    });
    throw err;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    installingBin = null;
  }
}

export async function installFfmpegBin(): Promise<void> {
  // 已经能找到系统 ffmpeg 就直接跳过
  if (detectSystemFfmpeg()) {
    broadcast("whisper:install-done", { job: "ffmpeg-bin", skipped: true });
    return;
  }
  if (installingBin) throw new Error(`正在安装 ${installingBin}`);
  installingBin = "ffmpeg-bin";
  ensureDirs();
  const tmpDir = path.join(os.tmpdir(), `ffmpeg-dl-${Date.now()}`);
  const zipPath = path.join(tmpDir, "ffmpeg.zip");
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    reportBin("ffmpeg-bin", 0, "下载 ffmpeg...");
    await downloadToFile(FFMPEG_RELEASE_URL, zipPath, (d, t) =>
      reportBin("ffmpeg-bin", t ? (d / t) * 85 : 0, "下载 ffmpeg..."),
    );
    reportBin("ffmpeg-bin", 88, "解压...");
    const extractDir = path.join(tmpDir, "ex");
    await extractZip(zipPath, extractDir);
    const exe = findFile(extractDir, "ffmpeg.exe");
    if (!exe) throw new Error("解压后未找到 ffmpeg.exe");
    fs.copyFileSync(exe, whisperPaths.localFfmpeg());
    reportBin("ffmpeg-bin", 100, "完成");
    broadcast("whisper:install-done", { job: "ffmpeg-bin" });
  } catch (err) {
    broadcast("whisper:install-error", {
      job: "ffmpeg-bin",
      message: (err as Error).message,
    });
    throw err;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    installingBin = null;
  }
}

/** 一键：检测系统 ffmpeg → 必要时下载 → 下载 whisper-cli → 下载指定模型 */
export async function oneClickInstall(model: WhisperModel = "base"): Promise<void> {
  const env = checkEnv();

  if (!env.ffmpeg) {
    await installFfmpegBin();
  } else {
    broadcast("whisper:install-progress", {
      job: "ffmpeg-bin",
      percent: 100,
      stage: env.ffmpegSource === "system" ? "已使用系统 ffmpeg" : "本地已存在",
    });
    broadcast("whisper:install-done", { job: "ffmpeg-bin", skipped: true });
  }

  if (!env.whisperBin) {
    await installWhisperBin();
  } else {
    broadcast("whisper:install-progress", {
      job: "whisper-bin",
      percent: 100,
      stage: "已存在",
    });
    broadcast("whisper:install-done", { job: "whisper-bin", skipped: true });
  }

  const after = checkEnv();
  if (!after.installedModels.includes(model)) {
    await downloadModel(model);
  } else {
    broadcast("whisper:model-progress", {
      model,
      downloaded: 1,
      total: 1,
      percent: 100,
    });
    broadcast("whisper:model-done", { model, skipped: true });
  }
}

/* ===================== 转写任务队列 ===================== */

export interface TranscribeJob {
  id: string;
  videoPath: string;
  videoName: string;
  model: WhisperModel;
  language: string; // "auto" | "ja" | "zh" | "en" ...
  status: "queued" | "extracting" | "transcribing" | "done" | "error" | "canceled";
  progress: number; // 0..100
  message: string;
  startedAt?: number;
  finishedAt?: number;
  srtPath?: string;
  proc?: ChildProcess;
}

const jobs: TranscribeJob[] = [];
let active: TranscribeJob | null = null;

export function listJobs(): Omit<TranscribeJob, "proc">[] {
  return jobs.map(({ proc: _, ...rest }) => rest);
}

export function enqueueTranscribe(
  videoPath: string,
  model: WhisperModel,
  language: string,
): TranscribeJob {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job: TranscribeJob = {
    id,
    videoPath,
    videoName: path.basename(videoPath),
    model,
    language,
    status: "queued",
    progress: 0,
    message: "排队中",
  };
  jobs.push(job);
  broadcast("whisper:job-update", listJobs());
  void runQueue();
  return job;
}

export function cancelJob(id: string): boolean {
  const job = jobs.find((j) => j.id === id);
  if (!job) return false;
  if (job.status === "done" || job.status === "error" || job.status === "canceled")
    return false;
  if (job.proc) {
    try {
      job.proc.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  job.status = "canceled";
  job.message = "已取消";
  broadcast("whisper:job-update", listJobs());
  if (active?.id === id) active = null;
  void runQueue();
  return true;
}

async function runQueue(): Promise<void> {
  if (active) return;
  const next = jobs.find((j) => j.status === "queued");
  if (!next) return;
  active = next;
  try {
    await runJob(next);
  } catch (err) {
    next.status = "error";
    next.message = (err as Error).message || String(err);
  } finally {
    next.finishedAt = Date.now();
    active = null;
    broadcast("whisper:job-update", listJobs());
    void runQueue();
  }
}

function parseTimestamp(s: string): number {
  // "00:01:23.456" -> seconds
  const m = s.match(/(\d+):(\d+):(\d+)\.(\d+)/);
  if (!m) return 0;
  return (
    parseInt(m[1]) * 3600 +
    parseInt(m[2]) * 60 +
    parseInt(m[3]) +
    parseInt(m[4]) / 1000
  );
}

async function getDuration(
  ffmpeg: string,
  videoPath: string,
): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(ffmpeg, ["-i", videoPath], { windowsHide: true });
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("close", () => {
      const m = stderr.match(/Duration:\s+(\d+):(\d+):(\d+\.\d+)/);
      if (!m) return resolve(0);
      resolve(parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]));
    });
    proc.on("error", () => resolve(0));
  });
}

async function runJob(job: TranscribeJob): Promise<void> {
  const env = checkEnv();
  if (!env.whisperBin) throw new Error(`未找到 whisper-cli.exe`);
  if (!env.ffmpeg || !env.ffmpegPath) throw new Error(`未找到 ffmpeg`);
  if (!env.installedModels.includes(job.model))
    throw new Error(`模型 ggml-${job.model}.bin 未下载`);
  const ffmpegPath = env.ffmpegPath;

  job.startedAt = Date.now();
  job.status = "extracting";
  job.progress = 0;
  job.message = "提取音频...";
  broadcast("whisper:job-update", listJobs());

  const folder = path.dirname(job.videoPath);
  const wavPath = path.join(folder, ".whisper-tmp.wav");
  const srtPathFinal = path.join(folder, "video.srt");

  // 1) 提取 16kHz 单声道 wav
  const duration = await getDuration(ffmpegPath, job.videoPath);
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      ffmpegPath,
      [
        "-y",
        "-i",
        job.videoPath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "wav",
        wavPath,
      ],
      { windowsHide: true },
    );
    job.proc = proc;
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      // ffmpeg 进度: time=00:00:12.34
      const t = stderr.match(/time=(\d+:\d+:\d+\.\d+)/g);
      if (t && duration > 0) {
        const last = t[t.length - 1].slice(5);
        const sec = parseTimestamp(last);
        job.progress = Math.min(20, (sec / duration) * 20); // 提取阶段占 0-20%
        broadcast("whisper:job-update", listJobs());
      }
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg 退出码 ${code}\n${stderr.slice(-500)}`));
    });
    proc.on("error", reject);
  });

  if ((job.status as TranscribeJob["status"]) === "canceled") {
    fs.unlinkSync(wavPath);
    return;
  }

  // 2) 跑 whisper-cli
  job.status = "transcribing";
  job.message = "转写中...";
  job.progress = 20;
  broadcast("whisper:job-update", listJobs());

  await new Promise<void>((resolve, reject) => {
    const args = [
      "-m",
      whisperPaths.modelFile(job.model),
      "-f",
      wavPath,
      "-osrt",
      "-of",
      wavPath.replace(/\.wav$/, ""),
      "-pp", // print progress
    ];
    if (job.language !== "auto") args.push("-l", job.language);

    const proc = spawn(whisperPaths.whisperBin(), args, {
      windowsHide: true,
      cwd: whisperPaths.root(),
    });
    job.proc = proc;

    let buf = "";
    const handleLine = (line: string) => {
      // 进度: "progress = 42%"
      const pm = line.match(/progress\s*=\s*(\d+)\s*%/i);
      if (pm) {
        const p = parseInt(pm[1]);
        job.progress = 20 + (p / 100) * 78; // 转写阶段占 20-98%
        broadcast("whisper:job-update", listJobs());
        return;
      }
      // 时间戳: "[00:01:23.456 --> 00:01:25.789]"
      const tm = line.match(/\[(\d+:\d+:\d+\.\d+)\s*-->/);
      if (tm && duration > 0) {
        const sec = parseTimestamp(tm[1]);
        const p = Math.min(100, (sec / duration) * 100);
        job.progress = Math.max(job.progress, 20 + (p / 100) * 78);
        broadcast("whisper:job-update", listJobs());
      }
    };

    proc.stderr.on("data", (d: Buffer) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() || "";
      for (const l of lines) handleLine(l);
    });
    proc.stdout.on("data", (d: Buffer) => {
      const lines = d.toString().split(/\r?\n/);
      for (const l of lines) handleLine(l);
    });

    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`whisper-cli 退出码 ${code}`));
    });
    proc.on("error", reject);
  });

  // 3) 移动 srt 到最终位置
  const generatedSrt = wavPath.replace(/\.wav$/, ".srt");
  if (fs.existsSync(generatedSrt)) {
    fs.renameSync(generatedSrt, srtPathFinal);
  }
  try {
    fs.unlinkSync(wavPath);
  } catch {
    /* ignore */
  }

  job.srtPath = srtPathFinal;
  job.status = "done";
  job.progress = 100;
  job.message = "完成";
  broadcast("whisper:job-update", listJobs());
}
