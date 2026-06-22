// 下载完成后处理队列
// 串行执行：整理目录 → 刮削元数据 + 封面 → 完成通知
// 持久化到 userData/postprocess-queue.json，重启可恢复

import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as path from "path";
import { app, Notification } from "electron";
import { EventEmitter } from "events";
import { log } from "../logger";
import { getMainWindow } from "../windowState";

export type PPStatus =
  | "pending"
  | "organizing"
  | "scraping"
  | "completed"
  | "failed"
  | "cancelled";

export interface PostProcessTask {
  id: string;
  /** 下载落地目录（saveDir） */
  saveDir: string;
  /** 不含扩展名的文件名（saveName） */
  saveName: string;
  /** 完整视频文件绝对路径（可推断） */
  videoPath?: string;
  /** 处理完成后的最终文件夹（一般是 saveDir/saveName） */
  folderPath?: string;
  status: PPStatus;
  step: string;
  retries: number;
  maxRetries: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

const QUEUE_FILE = () =>
  path.join(app.getPath("userData"), "postprocess-queue.json");

let tasks: PostProcessTask[] = [];
let running = false;
let scrapeImpl:
  | ((folderPath: string) => Promise<{ success: boolean; error?: string }>)
  | null = null;

export const events = new EventEmitter();

export function setScrapeImpl(
  fn: (folderPath: string) => Promise<{ success: boolean; error?: string }>,
) {
  scrapeImpl = fn;
}

function load() {
  try {
    if (fs.existsSync(QUEUE_FILE())) {
      tasks = JSON.parse(fs.readFileSync(QUEUE_FILE(), "utf8"));
      // 重启时把"进行中"的任务重置为 pending
      for (const t of tasks) {
        if (t.status === "organizing" || t.status === "scraping") {
          t.status = "pending";
          t.step = "等待中（重启后恢复）";
        }
      }
    }
  } catch (e: any) {
    log.warn(`[postprocess] load queue failed: ${e?.message}`);
    tasks = [];
  }
}

function save() {
  try {
    fs.writeFileSync(QUEUE_FILE(), JSON.stringify(tasks, null, 2), "utf8");
  } catch (e: any) {
    log.warn(`[postprocess] save queue failed: ${e?.message}`);
  }
}

function emitChange() {
  events.emit("change", tasks);
  // 同步推到渲染进程
  try {
    getMainWindow()?.webContents.send("postprocess:change", tasks);
  } catch {}
}

function updateTask(id: string, patch: Partial<PostProcessTask>) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return;
  Object.assign(t, patch, { updatedAt: Date.now() });
  save();
  emitChange();
}

export function enqueue(opts: {
  saveDir: string;
  saveName: string;
  /** 可选：直接给定视频文件绝对路径 */
  videoPath?: string;
}): PostProcessTask {
  const id = `pp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const task: PostProcessTask = {
    id,
    saveDir: opts.saveDir,
    saveName: opts.saveName,
    videoPath: opts.videoPath,
    status: "pending",
    step: "等待中",
    retries: 0,
    maxRetries: 3,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  tasks.push(task);
  save();
  emitChange();
  log.info(`[postprocess] enqueued ${id} ${opts.saveDir}\\${opts.saveName}`);
  void runNext();
  return task;
}

export function list(): PostProcessTask[] {
  return [...tasks];
}

export function cancel(id: string) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return;
  if (t.status === "completed") return;
  t.status = "cancelled";
  t.step = "已取消";
  t.updatedAt = Date.now();
  save();
  emitChange();
}

export function retry(id: string) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return;
  if (t.status === "completed") return;
  t.status = "pending";
  t.step = "等待中";
  t.error = undefined;
  t.retries = 0;
  t.updatedAt = Date.now();
  save();
  emitChange();
  void runNext();
}

export function clearCompleted() {
  tasks = tasks.filter((x) => x.status !== "completed");
  save();
  emitChange();
}

// =================== 流水线 ===================

async function organizeFolder(t: PostProcessTask): Promise<string> {
  updateTask(t.id, { status: "organizing", step: "整理目录结构" });

  // 期望结构：saveDir/saveName/video.{ext}
  const finalFolder = path.join(t.saveDir, t.saveName);

  // 1. 如果 saveDir/saveName 本身就是文件夹，直接用
  if (fs.existsSync(finalFolder) && fs.statSync(finalFolder).isDirectory()) {
    // 检查文件夹内是否已有视频文件
    const entries = await fsPromises.readdir(finalFolder);
    const hasVideo = entries.some((n) => /\.(mp4|mkv|ts|m4v|mov|webm)$/i.test(n));
    if (hasVideo) {
      return finalFolder;
    }
  }

  await fsPromises.mkdir(finalFolder, { recursive: true });

  // 2. 在 saveDir 直接找 saveName.{mp4,mkv,...}
  const exts = ["mp4", "mkv", "ts", "m4v", "mov", "webm"];
  for (const ext of exts) {
    const candidate = path.join(t.saveDir, `${t.saveName}.${ext}`);
    if (fs.existsSync(candidate)) {
      const target = path.join(finalFolder, `video.${ext}`);
      try {
        await fsPromises.rename(candidate, target);
        log.info(`[postprocess] moved ${candidate} -> ${target}`);
      } catch (e: any) {
        // 跨盘 rename 失败时降级为 copy + unlink
        await fsPromises.copyFile(candidate, target);
        await fsPromises.unlink(candidate);
      }
      return finalFolder;
    }
  }

  // 3. 显式 videoPath
  if (t.videoPath && fs.existsSync(t.videoPath)) {
    const ext = path.extname(t.videoPath).slice(1) || "mp4";
    const target = path.join(finalFolder, `video.${ext}`);
    if (path.resolve(t.videoPath) !== path.resolve(target)) {
      try {
        await fsPromises.rename(t.videoPath, target);
      } catch {
        await fsPromises.copyFile(t.videoPath, target);
        await fsPromises.unlink(t.videoPath);
      }
    }
    return finalFolder;
  }

  throw new Error("未找到下载产物（视频文件）");
}

async function scrape(t: PostProcessTask, folderPath: string): Promise<void> {
  updateTask(t.id, { status: "scraping", step: "联网刮削元数据与封面" });
  if (!scrapeImpl) {
    throw new Error("scrapeImpl 未注册");
  }
  const r = await scrapeImpl(folderPath);
  if (!r.success) throw new Error(r.error || "刮削失败");
}

function notifyDone(t: PostProcessTask, ok: boolean) {
  try {
    if (Notification.isSupported()) {
      new Notification({
        title: ok ? "下载已处理完成" : "下载处理失败",
        body: ok
          ? `${t.saveName} 已入库`
          : `${t.saveName}：${t.error || "未知错误"}`,
        silent: false,
      }).show();
    }
  } catch (e: any) {
    log.warn(`[postprocess] notify failed: ${e?.message}`);
  }
}

async function runNext() {
  if (running) return;
  const next = tasks.find((x) => x.status === "pending");
  if (!next) return;
  running = true;
  try {
    log.info(`[postprocess] running ${next.id}`);
    const folder = await organizeFolder(next);
    updateTask(next.id, { folderPath: folder });
    if ((tasks.find((x) => x.id === next.id)?.status as PPStatus) === "cancelled")
      return;
    await scrape(next, folder);
    updateTask(next.id, { status: "completed", step: "完成" });
    notifyDone(next, true);
  } catch (e: any) {
    const msg = e?.message || String(e);
    log.warn(`[postprocess] ${next.id} failed: ${msg}`);
    const t = tasks.find((x) => x.id === next.id);
    if (t) {
      t.retries += 1;
      if (t.retries < t.maxRetries && t.status !== "cancelled") {
        t.status = "pending";
        t.step = `等待重试（${t.retries}/${t.maxRetries}）`;
        t.error = msg;
        save();
        emitChange();
        // 退避一会再继续
        setTimeout(() => {
          running = false;
          void runNext();
        }, 5000 * t.retries);
        return;
      }
      t.status = "failed";
      t.step = "失败";
      t.error = msg;
      save();
      emitChange();
      notifyDone(t, false);
    }
  } finally {
    running = false;
    // 继续下一个
    setImmediate(() => void runNext());
  }
}

let loaded = false;
function ensureLoaded() {
  if (loaded) return;
  if (!app.isReady()) {
    app.whenReady().then(() => {
      load();
      loaded = true;
      emitChange();
    });
    return;
  }
  load();
  loaded = true;
}
ensureLoaded();
