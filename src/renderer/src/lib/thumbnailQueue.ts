import {
  generateAndSaveThumbnails,
  pathToLocalMediaUrl,
  CancelledError,
} from "./thumbnails";
import { trpc } from "./trpc";

export interface ThumbJob {
  id: string;
  name: string;
  folderPath: string;
  status: "pending" | "running" | "done" | "failed" | "cancelled" | "skipped";
  doneFrames: number;
  totalFrames: number;
  error?: string;
  /** 为 true 时即使已有刻度图也会强制重生成 */
  force?: boolean;
}

type LogFn = (
  text: string,
  level: "INFO" | "WARNING" | "SUCCESS" | "ERROR",
) => void;

type Listener = (jobs: ThumbJob[]) => void;

const jobs = new Map<string, ThumbJob>();
const controllers = new Map<string, AbortController>();
const listeners = new Set<Listener>();
let log: LogFn = () => {};
let running = 0;
let maxConcurrent = 2;

function emit(): void {
  const list = Array.from(jobs.values());
  for (const l of listeners) l(list);
}

function notifyLog(text: string, level: Parameters<LogFn>[1]): void {
  try {
    log(text, level);
  } catch {
    /* ignore */
  }
}

async function runJob(job: ThumbJob): Promise<void> {
  running++;
  job.status = "running";
  emit();

  const ctrl = new AbortController();
  controllers.set(job.id, ctrl);

  try {
    // 已有刻度图 + 没有强制标志 → 直接跳过
    if (!job.force) {
      const existing = (await trpc.videos.hasThumbs.query({
        folder: job.folderPath,
      })) as { exists: boolean };
      if (existing.exists) {
        job.status = "skipped";
        notifyLog(`刻度图已存在，跳过: ${job.name}`, "INFO");
        return;
      }
    }

    await trpc.videos.deleteThumbs.mutate({ folder: job.folderPath });
    const found = (await trpc.videos.findVideoFile.query({
      folder: job.folderPath,
    })) as { success: boolean; path?: string; error?: string };
    if (!found.success || !found.path) {
      throw new Error("未找到视频文件");
    }
    await generateAndSaveThumbnails({
      videoUrl: pathToLocalMediaUrl(found.path),
      folder: job.folderPath,
      signal: ctrl.signal,
      onProgress: (d, t) => {
        job.doneFrames = d;
        job.totalFrames = t;
        if (d === t || d % 5 === 0) emit();
      },
    });
    job.status = "done";
    notifyLog(`刻度图已生成: ${job.name}`, "SUCCESS");
  } catch (err: any) {
    if (err instanceof CancelledError || ctrl.signal.aborted) {
      job.status = "cancelled";
      notifyLog(`刻度图任务已取消: ${job.name}`, "WARNING");
    } else {
      job.status = "failed";
      job.error = err?.message || String(err);
      notifyLog(`刻度图失败: ${job.name} - ${job.error}`, "ERROR");
    }
  } finally {
    controllers.delete(job.id);
    running--;
    emit();
    pump();
  }
}

function pump(): void {
  while (running < maxConcurrent) {
    const next = Array.from(jobs.values()).find((j) => j.status === "pending");
    if (!next) break;
    void runJob(next);
  }
}

export const thumbnailQueue = {
  setLogger(fn: LogFn): void {
    log = fn;
  },

  /** 设置同时跑的修复任务数（1–8）。调低不会取消已在跑的任务；调高会立刻补满。 */
  setConcurrency(n: number): void {
    const next = Math.max(1, Math.min(8, Math.floor(n) || 1));
    if (next === maxConcurrent) return;
    maxConcurrent = next;
    pump();
  },

  getConcurrency(): number {
    return maxConcurrent;
  },

  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    fn(Array.from(jobs.values()));
    return () => {
      listeners.delete(fn);
    };
  },

  list(): ThumbJob[] {
    return Array.from(jobs.values());
  },

  enqueue(input: { name: string; folderPath: string; force?: boolean }): string {
    // 同一文件夹已有任务时避免重复入队：存在 + 非强制 → 复用；存在 + 新任务强制 → 先删旧的再起
    let existingId: string | null = null;
    for (const [jid, j] of jobs) {
      if (j.folderPath === input.folderPath) {
        existingId = jid;
        break;
      }
    }
    if (existingId && !input.force) {
      const existing = jobs.get(existingId)!;
      if (existing.status !== "failed") {
        notifyLog(`刻度图任务已在队列中，跳过重复入队: ${input.name}`, "INFO");
        return existingId;
      }
      // 之前失败了：清理残留，允许重新生成
      jobs.delete(existingId);
    }
    if (existingId && input.force) {
      // 强制重新生成：取消旧任务后移除
      const oldJob = jobs.get(existingId);
      if (oldJob && (oldJob.status === "pending" || oldJob.status === "running")) {
        const ctrl = controllers.get(existingId);
        if (ctrl) ctrl.abort();
      }
      jobs.delete(existingId);
    }

    const id = `thumb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    jobs.set(id, {
      id,
      name: input.name,
      folderPath: input.folderPath,
      status: "pending",
      doneFrames: 0,
      totalFrames: 0,
      force: input.force,
    });
    emit();
    pump();
    return id;
  },

  cancel(id: string): void {
    const job = jobs.get(id);
    if (!job) return;
    const ctrl = controllers.get(id);
    if (ctrl) {
      ctrl.abort();
      return;
    }
    // pending / skipped / done / failed / cancelled 都在本地直接改状态
    if (job.status === "pending") {
      job.status = "cancelled";
      notifyLog(`刻度图任务已取消(未开始): ${job.name}`, "WARNING");
      emit();
      return;
    }
    // 已结束的任务（skipped/done/failed/cancelled）cancel 视为 noop
  },

  remove(id: string): void {
    const job = jobs.get(id);
    if (!job) return;
    if (job.status === "running" || job.status === "pending") {
      const ctrl = controllers.get(id);
      if (ctrl) ctrl.abort();
      // 稍等 AbortController 回调把状态刷掉，再删除；否则 pump 可能误判
      setTimeout(() => {
        jobs.delete(id);
        emit();
      }, 150);
      return;
    }
    jobs.delete(id);
    emit();
  },

  clearFinished(): void {
    for (const [id, j] of jobs) {
      if (
        j.status === "done" ||
        j.status === "failed" ||
        j.status === "cancelled" ||
        j.status === "skipped"
      ) {
        jobs.delete(id);
      }
    }
    emit();
  },
};
