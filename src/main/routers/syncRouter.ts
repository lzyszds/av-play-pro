import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import { t } from "../trpc";
import { log } from "../logger";
import { recordActivity } from "./activityRouter";

function getUserDataPath(...segments: string[]): string {
  return path.join(app.getPath("userData"), ...segments);
}

function readJsonFile<T = unknown>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch (err) {
    log.warn(`[syncRouter] Failed to read ${filePath}:`, err);
    return fallback;
  }
}

function writeJsonFile(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function normalizeUrl(urlStr: string): string {
  let cleaned = (urlStr || "").trim();
  if (!cleaned) return "";
  if (!cleaned.startsWith("http://") && !cleaned.startsWith("https://")) {
    cleaned = "https://" + cleaned;
  }
  return cleaned.replace(/\/+$/, "");
}

import { getMainWindow } from "../windowState";

let isExecutingCloudPush = false;

// 执行上传/推送本地数据至云端 KV 核心逻辑
export async function executePushToCloud(
  rawEndpoint: string,
  secretKey: string,
  reason: "startup" | "exit" | "tray_hide" | "interval" | "manual" = "manual",
) {
  if (isExecutingCloudPush) {
    if (reason === "exit") {
      log.info("[syncRouter] Push already in progress, waiting for it to finish for exit...");
      const start = Date.now();
      while (isExecutingCloudPush && Date.now() - start < 4000) {
        await new Promise((r) => setTimeout(r, 100));
      }
      return {
        success: true as const,
        updatedAt: new Date().toISOString(),
        stats: { videoCount: 0, timelineCount: 0, actorCount: 0 },
        message: "已等待正在进行的备份完成",
      };
    }
    log.warn("[syncRouter] Another cloud backup is already in progress, skipping");
    return { success: false as const, error: "已有正在进行的云端同步任务" };
  }

  isExecutingCloudPush = true;

  try {
    const endpoint = normalizeUrl(rawEndpoint);
    if (!endpoint) return { success: false as const, error: "云同步端点不能为空" };

    // 读取本地核心文件
    const settingsPath = getUserDataPath("settings.json");
    const statsPath = getUserDataPath("stats.json");
    const timelinePath = getUserDataPath("timeline.json");
    const actorsPath = getUserDataPath("actors.json");
    const tagModelPath = getUserDataPath("tag-model.json");
    const activityPath = getUserDataPath("activity-history.json");
    const reportPath = getUserDataPath("annual-report.json");
    const achievementsPath = getUserDataPath("achievements.json");

    const localSettings = readJsonFile<Record<string, unknown>>(
      settingsPath,
      {},
    );
    const localStats = readJsonFile<Record<string, unknown>>(statsPath, {});
    const localTimeline = readJsonFile<Record<string, unknown>>(
      timelinePath,
      {},
    );
    const localActors = readJsonFile<unknown[] | Record<string, unknown>>(
      actorsPath,
      [],
    );
    const localTagModel = readJsonFile<Record<string, unknown>>(
      tagModelPath,
      {},
    );
    const localActivities = readJsonFile<unknown[]>(activityPath, []);
    const localReport = readJsonFile<Record<string, unknown> | null>(
      reportPath,
      null,
    );
    const localAchievements = readJsonFile<Record<string, unknown>>(
      achievementsPath,
      {},
    );

    // 计算统计概况
    const videoCount = localStats?.videos
      ? Object.keys(localStats.videos as object).length
      : 0;
    const timelineCount = Array.isArray((localTimeline as any)?.bookmarks)
      ? (localTimeline as any).bookmarks.length
      : 0;
    const actorCount = Array.isArray(localActors)
      ? localActors.length
      : Object.keys(localActors || {}).length;

    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      clientVersion: app.getVersion(),
      data: {
        settings: localSettings,
        stats: localStats,
        timeline: localTimeline,
        actors: localActors,
        tagModel: localTagModel,
        activities: localActivities,
        annualReport: localReport,
        achievements: localAchievements,
      },
    };

    const res = await fetch(`${endpoint}/api/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sync-Key": secretKey.trim(),
        "User-Agent": "AVPlayPro-Electron",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    if (res.status === 401) {
      return { success: false as const, error: "未授权：密钥错误" };
    }
    if (!res.ok) {
      const text = await res.text();
      return {
        success: false as const,
        error: `上传失败 (HTTP ${res.status}): ${text}`,
      };
    }

    // 将最新同步时间保存到本地 settings.json
    localSettings.cloudSyncLastSync = payload.exportedAt;
    writeJsonFile(settingsPath, localSettings);

    const reasonTitle =
      reason === "startup"
        ? "进入应用自动备份"
        : reason === "exit"
        ? "退出应用自动备份"
        : reason === "tray_hide"
        ? "最小化托盘自动备份"
        : reason === "interval"
        ? "定时自动备份"
        : "云端备份";

    recordActivity(
      "SYNC",
      reasonTitle,
      `成功将 ${videoCount} 部影片数据与 ${localActivities.length} 条操作历史备份至 Cloudflare KV`,
    );

    log.info(
      `[syncRouter] Successfully pushed data to cloud (${reason}): ${payload.exportedAt}`,
    );

    // 通知渲染进程主窗口（若存在且未销毁）
    try {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send("cloud-sync:status", {
          reason,
          updatedAt: payload.exportedAt,
          success: true,
          stats: {
            videoCount,
            timelineCount,
            actorCount,
          },
        });
      }
    } catch (sendErr) {
      log.warn("[syncRouter] Failed to send cloud-sync:status to window:", sendErr);
    }

    return {
      success: true as const,
      updatedAt: payload.exportedAt,
      stats: {
        videoCount,
        timelineCount,
        actorCount,
      },
      message: "数据已成功备份到 Cloudflare KV！",
    };
  } catch (err: any) {
    log.error(`[syncRouter] Failed to push to cloud (${reason}):`, err);
    return {
      success: false as const,
      error: `上传异常: ${err?.message || String(err)}`,
    };
  } finally {
    isExecutingCloudPush = false;
  }
}

// 供主进程在启动、退出、托盘最小化或定时调用的自动化备份函数
export async function triggerAutoCloudBackup(
  reason: "startup" | "exit" | "tray_hide" | "interval" = "startup",
): Promise<boolean> {
  try {
    const settingsPath = getUserDataPath("settings.json");
    const settings = readJsonFile<Record<string, any>>(settingsPath, {});

    // 如果用户显式关闭了自动同步（默认开启），则跳过
    if (settings.cloudSyncAutoSync === false) {
      log.info(
        `[syncRouter] Auto cloud backup skipped (${reason}): cloudSyncAutoSync is false`,
      );
      return false;
    }

    const endpoint =
      (settings.cloudSyncEndpoint as string)?.trim() ||
      "https://avplay-sync.1024327189.workers.dev";
    const secretKey =
      (settings.cloudSyncSecret as string)?.trim() || "MySecretToken_2026";

    if (!endpoint || !secretKey) {
      log.info(
        `[syncRouter] Auto cloud backup skipped (${reason}): endpoint or secret is missing`,
      );
      return false;
    }

    log.info(
      `[syncRouter] Auto cloud backup triggering (${reason}) -> ${endpoint}...`,
    );
    const res = await executePushToCloud(endpoint, secretKey, reason);
    if (res.success) {
      log.info(
        `[syncRouter] Auto cloud backup (${reason}) succeeded: ${res.updatedAt}`,
      );
      return true;
    } else {
      log.warn(
        `[syncRouter] Auto cloud backup (${reason}) failed: ${res.error}`,
      );
      return false;
    }
  } catch (err: any) {
    log.error(`[syncRouter] Auto cloud backup (${reason}) exception:`, err);
    return false;
  }
}

export const syncRouter = t.router({
  // 测试与 Cloudflare Worker 连通性及密钥正确性
  testConnection: t.procedure
    .input(
      z.object({
        endpoint: z.string(),
        secretKey: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const endpoint = normalizeUrl(input.endpoint);
      if (!endpoint) {
        return { success: false as const, error: "云同步端点地址不能为空" };
      }

      const startTime = Date.now();
      try {
        const pingUrl = `${endpoint}/api/ping`;
        const res = await fetch(pingUrl, {
          method: "GET",
          headers: {
            "X-Sync-Key": input.secretKey.trim(),
            "User-Agent": "AVPlayPro-Electron",
          },
          signal: AbortSignal.timeout(8000),
        });

        const latency = Date.now() - startTime;

        if (res.status === 401) {
          return {
            success: false as const,
            latency,
            latencyMs: latency,
            error: "认证失败：密钥 (Secret Key) 不正确",
          };
        }

        if (!res.ok) {
          const text = await res.text();
          return {
            success: false as const,
            latency,
            latencyMs: latency,
            error: `服务响应异常 (${res.status}): ${text}`,
          };
        }

        const data: any = await res.json().catch(() => ({}));
        return {
          success: true as const,
          latency,
          latencyMs: latency,
          message: data.message || "连接成功！",
          timestamp: data.timestamp,
        };
      } catch (err: any) {
        return {
          success: false as const,
          latency: Date.now() - startTime,
          latencyMs: Date.now() - startTime,
          error: `网络连接失败: ${err?.message || String(err)}。请检查 Worker 网址或梯子设置。`,
        };
      }
    }),

  // 获取云端元信息（最新同步时间、数据体积、版本）
  getCloudMetadata: t.procedure
    .input(
      z.object({
        endpoint: z.string(),
        secretKey: z.string(),
      }),
    )
    .query(async ({ input }) => {
      const endpoint = normalizeUrl(input.endpoint);
      if (!endpoint) return { success: false, error: "云同步端点不能为空" };

      try {
        const res = await fetch(`${endpoint}/api/sync/metadata`, {
          headers: {
            "X-Sync-Key": input.secretKey.trim(),
            "User-Agent": "AVPlayPro-Electron",
          },
          signal: AbortSignal.timeout(8000),
        });

        if (res.status === 401) {
          return { success: false, error: "未授权：密钥错误" };
        }
        if (!res.ok) {
          return { success: false, error: `请求失败: HTTP ${res.status}` };
        }

        const json: any = await res.json();
        const hasData = Boolean(json.exists && json.updatedAt);
        return {
          success: true,
          hasData,
          updatedAt: json.updatedAt || null,
          version: json.version || null,
        };
      } catch (err: any) {
        return { success: false, error: err?.message || String(err) };
      }
    }),

  // 上传/推送本地数据至云端 KV
  pushToCloud: t.procedure
    .input(
      z.object({
        endpoint: z.string(),
        secretKey: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      return executePushToCloud(input.endpoint, input.secretKey);
    }),

  // 专门将年度战力报告保存到本地并上传至云端
  pushAnnualReport: t.procedure
    .input(
      z.object({
        endpoint: z.string(),
        secretKey: z.string(),
        report: z.record(z.string(), z.unknown()),
      }),
    )
    .mutation(async ({ input }) => {
      const endpoint = normalizeUrl(input.endpoint);
      if (!endpoint) return { success: false, error: "云同步端点不能为空" };

      // 1. 保存到本地
      const reportPath = getUserDataPath("annual-report.json");
      writeJsonFile(reportPath, input.report);

      // 2. 触发一次全量推送（带 report）
      const pushRes = await executePushToCloud(input.endpoint, input.secretKey);

      if (pushRes.success) {
        recordActivity(
          "SYNC",
          "战力报告上云",
          "成功将年度观影战斗力报告同步到 Cloudflare KV",
        );
      }

      return pushRes;
    }),

  // 获取本地缓存的战力报告
  getAnnualReport: t.procedure.query(() => {
    const reportPath = getUserDataPath("annual-report.json");
    return readJsonFile<Record<string, unknown> | null>(reportPath, null);
  }),

  // 从云端拉取数据并恢复到本地
  pullFromCloud: t.procedure
    .input(
      z.object({
        endpoint: z.string(),
        secretKey: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const endpoint = normalizeUrl(input.endpoint);
      if (!endpoint) return { success: false as const, error: "云同步端点不能为空" };

      try {
        const res = await fetch(`${endpoint}/api/sync`, {
          method: "GET",
          headers: {
            "X-Sync-Key": input.secretKey.trim(),
            "User-Agent": "AVPlayPro-Electron",
          },
          signal: AbortSignal.timeout(15000),
        });

        if (res.status === 401) {
          return { success: false as const, error: "未授权：密钥错误" };
        }
        if (!res.ok) {
          return { success: false as const, error: `拉取失败 HTTP ${res.status}` };
        }

        const remotePayload: any = await res.json();
        const remoteData = remotePayload?.data;

        if (!remoteData || Object.keys(remoteData).length === 0) {
          return {
            success: false as const,
            error: "云端尚无备份数据，请先点击【立即备份到云端】上传一次数据。",
          };
        }

        // 1. 本地安全镜像备份（防止覆盖后数据找不回）
        const timestamp = new Date()
          .toISOString()
          .replace(/[:.]/g, "-")
          .slice(0, 19);
        const backupDir = getUserDataPath("backups", `pre-sync-${timestamp}`);
        fs.mkdirSync(backupDir, { recursive: true });

        const filesToSync = [
          "settings.json",
          "stats.json",
          "timeline.json",
          "actors.json",
          "tag-model.json",
          "activity-history.json",
          "annual-report.json",
          "achievements.json",
        ];

        for (const f of filesToSync) {
          const src = getUserDataPath(f);
          if (fs.existsSync(src)) {
            try {
              fs.copyFileSync(src, path.join(backupDir, f));
            } catch (copyErr) {
              log.warn(`[syncRouter] Failed to backup ${f}:`, copyErr);
            }
          }
        }

        // 2. 写入云端数据到本地
        if (remoteData.stats) {
          writeJsonFile(getUserDataPath("stats.json"), remoteData.stats);
        }
        if (remoteData.timeline) {
          writeJsonFile(getUserDataPath("timeline.json"), remoteData.timeline);
        }
        if (remoteData.actors) {
          writeJsonFile(getUserDataPath("actors.json"), remoteData.actors);
        }
        if (remoteData.tagModel) {
          writeJsonFile(getUserDataPath("tag-model.json"), remoteData.tagModel);
        }
        if (remoteData.activities) {
          writeJsonFile(
            getUserDataPath("activity-history.json"),
            remoteData.activities,
          );
        }
        if (remoteData.annualReport) {
          writeJsonFile(
            getUserDataPath("annual-report.json"),
            remoteData.annualReport,
          );
        }
        if (remoteData.achievements) {
          writeJsonFile(
            getUserDataPath("achievements.json"),
            remoteData.achievements,
          );
        }

        // 3. 合并设置（保留本地设备专属路径，如 video_path / temp_path / nm3u8dlPath，以及当前云端配置参数）
        const localSettings = readJsonFile<Record<string, any>>(
          getUserDataPath("settings.json"),
          {},
        );
        const remoteSettings = (remoteData.settings as Record<string, any>) || {};

        const mergedSettings = {
          ...remoteSettings,
          ...localSettings,
          // 偏好类设置优先采用云端
          theme: remoteSettings.theme ?? localSettings.theme,
          notifySound: remoteSettings.notifySound ?? localSettings.notifySound,
          notifyOnComplete:
            remoteSettings.notifyOnComplete ?? localSettings.notifyOnComplete,
          loaderStyle: remoteSettings.loaderStyle ?? localSettings.loaderStyle,
          downloadBackground:
            remoteSettings.downloadBackground ??
            localSettings.downloadBackground,
          playerLayout:
            remoteSettings.playerLayout ?? localSettings.playerLayout,
          privacyScreenEnabled:
            remoteSettings.privacyScreenEnabled ??
            localSettings.privacyScreenEnabled,
          // 保留当前本机的连接参数与同步时间
          cloudSyncEndpoint: input.endpoint,
          cloudSyncSecret: input.secretKey,
          cloudSyncLastSync: remotePayload.updatedAt || new Date().toISOString(),
        };

        writeJsonFile(getUserDataPath("settings.json"), mergedSettings);

        log.info(
          `[syncRouter] Successfully restored from cloud. Local backup saved to ${backupDir}`,
        );

        recordActivity(
          "SYNC",
          "云端恢复",
          "成功从 Cloudflare KV 同步最新记录并完成本地镜像备份",
        );

        return {
          success: true as const,
          updatedAt: (remotePayload.updatedAt as string) || new Date().toISOString(),
          backupDir,
          message: "数据已成功从云端恢复！本地旧数据已自动安全备份。",
        };
      } catch (err: any) {
        log.error("[syncRouter] Failed to pull from cloud:", err);
        return {
          success: false as const,
          error: `拉取异常: ${err?.message || String(err)}`,
        };
      }
    }),
});
