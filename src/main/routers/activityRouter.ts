import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import { t } from "../trpc";
import { log } from "../logger";

export type ActivityType =
  | "PLAY"
  | "DOWNLOAD"
  | "SCRAPE"
  | "ORGANIZE"
  | "SYNC"
  | "AROUSAL";

export interface ActivityRecord {
  id: string;
  timestamp: string; // ISO 8601
  type: ActivityType;
  title: string;
  detail: string;
  metadata?: Record<string, unknown>;
}

const MAX_RECORDS = 1000;

function getActivityFilePath(): string {
  return path.join(app.getPath("userData"), "activity-history.json");
}

export function readActivities(): ActivityRecord[] {
  try {
    const file = getActivityFilePath();
    if (!fs.existsSync(file)) return [];
    const content = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    log.warn("[activity] Failed to read activity-history.json:", err);
    return [];
  }
}

export function writeActivities(items: ActivityRecord[]): void {
  try {
    const file = getActivityFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(items.slice(0, MAX_RECORDS), null, 2), "utf8");
  } catch (err) {
    log.error("[activity] Failed to write activity-history.json:", err);
  }
}

// 主进程内部直接调用的记录辅助函数
export function recordActivity(
  type: ActivityType,
  title: string,
  detail: string,
  metadata?: Record<string, unknown>,
): ActivityRecord {
  const record: ActivityRecord = {
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    type,
    title,
    detail,
    metadata,
  };
  const list = readActivities();
  list.unshift(record);
  writeActivities(list);
  log.info(`[activity] [${type}] ${title} - ${detail}`);
  return record;
}

export const activityRouter = t.router({
  // 获取操作历史列表
  list: t.procedure
    .input(
      z.object({
        limit: z.number().optional().default(50),
        offset: z.number().optional().default(0),
        type: z.string().optional(),
        search: z.string().optional(),
      }),
    )
    .query(({ input }) => {
      let items = readActivities();

      if (input.type && input.type !== "ALL") {
        items = items.filter((item) => item.type === input.type);
      }

      if (input.search?.trim()) {
        const q = input.search.trim().toLowerCase();
        items = items.filter(
          (item) =>
            item.title.toLowerCase().includes(q) ||
            item.detail.toLowerCase().includes(q),
        );
      }

      const total = items.length;
      const paged = items.slice(input.offset, input.offset + input.limit);
      return { items: paged, total };
    }),

  // 手动记录一条操作
  log: t.procedure
    .input(
      z.object({
        type: z.enum([
          "PLAY",
          "DOWNLOAD",
          "SCRAPE",
          "ORGANIZE",
          "SYNC",
          "AROUSAL",
        ]),
        title: z.string(),
        detail: z.string(),
        metadata: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(({ input }) => {
      const record = recordActivity(
        input.type as ActivityType,
        input.title,
        input.detail,
        input.metadata,
      );
      return { success: true, record };
    }),

  // 获取统计简报
  getStats: t.procedure.query(() => {
    const items = readActivities();
    const today = new Date().toISOString().slice(0, 10);
    const byType: Record<string, number> = {
      PLAY: 0,
      DOWNLOAD: 0,
      SCRAPE: 0,
      ORGANIZE: 0,
      SYNC: 0,
      AROUSAL: 0,
    };
    let todayCount = 0;

    for (const item of items) {
      byType[item.type] = (byType[item.type] || 0) + 1;
      if (item.timestamp.startsWith(today)) {
        todayCount++;
      }
    }

    return {
      total: items.length,
      todayCount,
      byType,
    };
  }),

  // 清空历史
  clear: t.procedure.mutation(() => {
    writeActivities([]);
    return { success: true };
  }),
});
