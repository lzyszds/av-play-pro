// 场景切换检测：调 ffmpeg scene filter
// 输出每个切换点的秒数 + 总时长，存到 {folder}/scenes.json
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { resolveFfmpeg } from "../whisper/whisperManager";
import { log } from "../logger";
import { EventEmitter } from "events";

export interface ScenesData {
  /** 场景切换点（秒） */
  scenes: number[];
  /** 总时长（秒） */
  duration: number;
  /** 检测阈值 */
  threshold: number;
  /** 检测时间（ISO） */
  detectedAt: string;
}

export function scenesPath(folder: string): string {
  return path.join(folder, "scenes.json");
}

export function readScenes(folder: string): ScenesData | null {
  const p = scenesPath(folder);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function findVideoFile(folder: string): string | null {
  if (!fs.existsSync(folder)) return null;
  let names: string[] = [];
  try {
    names = fs.readdirSync(folder);
  } catch {
    return null;
  }
  // 偏好 video.* > 其他 .mp4/.mkv
  const preferred = names.find((n) =>
    /^video\.(mp4|mkv|ts|m4v|mov|webm)$/i.test(n),
  );
  if (preferred) return path.join(folder, preferred);
  const fallback = names.find((n) =>
    /\.(mp4|mkv|ts|m4v|mov|webm)$/i.test(n),
  );
  return fallback ? path.join(folder, fallback) : null;
}

export const sceneEvents = new EventEmitter();

interface Job {
  folder: string;
  threshold: number;
  resolve: (data: ScenesData) => void;
  reject: (e: Error) => void;
  abortController: AbortController;
}

const queue: Job[] = [];
let running = false;
const inflight = new Map<string, Job>();

export function cancelDetect(folder: string) {
  const idx = queue.findIndex((j) => j.folder === folder);
  if (idx >= 0) queue.splice(idx, 1);
  const cur = inflight.get(folder);
  if (cur) {
    cur.abortController.abort();
    inflight.delete(folder);
  }
}

export async function detectScenes(
  folder: string,
  threshold = 0.3,
): Promise<ScenesData> {
  return new Promise<ScenesData>((resolve, reject) => {
    const job: Job = {
      folder,
      threshold,
      resolve,
      reject,
      abortController: new AbortController(),
    };
    queue.push(job);
    void run();
  });
}

async function run() {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  running = true;
  inflight.set(job.folder, job);
  try {
    const ff = resolveFfmpeg();
    if (!ff) throw new Error("未找到 ffmpeg");
    const videoFile = findVideoFile(job.folder);
    if (!videoFile) throw new Error("未找到视频文件");
    log.info(`[scenes] detect ${videoFile} threshold=${job.threshold}`);

    const args = [
      "-i",
      videoFile,
      "-filter:v",
      `select='gt(scene,${job.threshold})',showinfo`,
      "-an",
      "-f",
      "null",
      "-",
    ];

    const child = spawn(ff.path, args, {
      windowsHide: true,
    });

    let stderr = "";
    let duration = 0;
    const scenes: number[] = [];

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      // 抽时长
      if (!duration) {
        const m = text.match(/Duration: (\d+):(\d+):([\d.]+)/);
        if (m) {
          duration = +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]);
        }
      }
      // 抽场景点：showinfo 输出 pts_time:xx.xx
      const re = /pts_time:([\d.]+)/g;
      let mm: RegExpExecArray | null;
      while ((mm = re.exec(text))) {
        scenes.push(parseFloat(mm[1]));
      }
      // 进度事件（按已扫描时间）
      const tm = text.match(/time=(\d+):(\d+):([\d.]+)/);
      if (tm) {
        const cur = +tm[1] * 3600 + +tm[2] * 60 + parseFloat(tm[3]);
        sceneEvents.emit("progress", {
          folder: job.folder,
          current: cur,
          duration,
        });
      }
    });

    job.abortController.signal.addEventListener("abort", () => {
      try {
        child.kill("SIGTERM");
      } catch {}
    });

    const exitCode: number = await new Promise((res) => {
      child.on("close", (code) => res(code ?? -1));
      child.on("error", () => res(-1));
    });

    if (job.abortController.signal.aborted) {
      throw new Error("已取消");
    }
    if (exitCode !== 0) {
      log.warn(`[scenes] ffmpeg exit=${exitCode}\n${stderr.slice(-500)}`);
      throw new Error(`ffmpeg 退出码 ${exitCode}`);
    }

    // 去重 + 排序
    const uniq = Array.from(new Set(scenes.map((s) => Math.round(s * 100) / 100))).sort(
      (a, b) => a - b,
    );

    const data: ScenesData = {
      scenes: uniq,
      duration,
      threshold: job.threshold,
      detectedAt: new Date().toISOString(),
    };
    fs.writeFileSync(scenesPath(job.folder), JSON.stringify(data), "utf8");
    log.info(
      `[scenes] done ${job.folder}: ${uniq.length} scenes / ${duration.toFixed(1)}s`,
    );
    job.resolve(data);
    sceneEvents.emit("done", { folder: job.folder, data });
  } catch (e: any) {
    job.reject(e instanceof Error ? e : new Error(String(e)));
    sceneEvents.emit("error", { folder: job.folder, error: e?.message });
  } finally {
    inflight.delete(job.folder);
    running = false;
    setImmediate(() => void run());
  }
}
