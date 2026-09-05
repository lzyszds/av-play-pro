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
        return { success: false, error: "云同步端点地址不能为空" };
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
          signal: AbortSignal.timeout(10000),
        });

        const latencyMs = Date.now() - startTime;

        if (res.status === 401) {
          return {
            success: false,
            error: "未授权：密码错误（与 Cloudflare Worker 的 SYNC_SECRET 不匹配）",
          };
        }

        if (!res.ok) {
          return {
            success: false,
            error: `服务器返回异常状态码: ${res.status} ${res.statusText}`,
          };
        }

        return {
          success: true,
          latencyMs,
          message: "连接成功，密钥验证通过！",
        };
      } catch (err: any) {
        const errorMsg =
          err?.name === "TimeoutError"
            ? "连接超时（10秒无响应），请检查网络或代理"
            : err?.message || String(err);
        return {
          success: false,
          error: `无法连接到 Worker: ${errorMsg}`,
        };
      }
    }),

  // 获取云端备份状态（版本、更新时间等）
  getCloudStatus: t.procedure
    .input(
      z.object({
        endpoint: z.string(),
        secretKey: z.string(),
      }),
    )
    .query(async ({ input }) => {
      const endpoint = normalizeUrl(input.endpoint);
      if (!endpoint) return { success: false, error: "端点未配置" };

      try {
        const res = await fetch(`${endpoint}/api/sync`, {
          method: "GET",
          headers: {
            "X-Sync-Key": input.secretKey.trim(),
            "User-Agent": "AVPlayPro-Electron",
          },
          signal: AbortSignal.timeout(10000),
        });

        if (res.status === 401) {
          return { success: false, error: "密码错误，无法获取云端状态" };
        }
        if (!res.ok) {
          return { success: false, error: `请求失败 HTTP ${res.status}` };
        }

        const json: any = await res.json();
        const hasData = !!json.data && Object.keys(json.data).length > 0;
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
      const endpoint = normalizeUrl(input.endpoint);
      if (!endpoint) return { success: false, error: "云同步端点不能为空" };

      // 读取本地核心文件
      const settingsPath = getUserDataPath("settings.json");
      const statsPath = getUserDataPath("stats.json");
      const timelinePath = getUserDataPath("timeline.json");
      const actorsPath = getUserDataPath("actors.json");
      const tagModelPath = getUserDataPath("tag-model.json");
      const activityPath = getUserDataPath("activity-history.json");
      const reportPath = getUserDataPath("annual-report.json");

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
        },
      };

      try {
        const res = await fetch(`${endpoint}/api/sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Sync-Key": input.secretKey.trim(),
            "User-Agent": "AVPlayPro-Electron",
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15000),
        });

        if (res.status === 401) {
          return { success: false, error: "未授权：密钥错误" };
        }
        if (!res.ok) {
          const text = await res.text();
          return {
            success: false,
            error: `上传失败 (HTTP ${res.status}): ${text}`,
          };
        }

        const resData: any = await res.json();

        // 将最新同步时间保存到本地 settings.json
        localSettings.cloudSyncLastSync = payload.exportedAt;
        writeJsonFile(settingsPath, localSettings);

        recordActivity(
          "SYNC",
          "云端备份",
          `成功将 ${videoCount} 部影片数据与 ${localActivities.length} 条操作历史备份至 Cloudflare KV`,
        );

        log.info(
          `[syncRouter] Successfully pushed data to cloud: ${payload.exportedAt}`,
        );

        return {
          success: true,
          updatedAt: payload.exportedAt,
          stats: {
            videoCount,
            timelineCount,
            actorCount,
          },
          message: "数据已成功备份到 Cloudflare KV！",
        };
      } catch (err: any) {
        log.error("[syncRouter] Failed to push to cloud:", err);
        return {
          success: false,
          error: `上传异常: ${err?.message || String(err)}`,
        };
      }
    }),

  // 专门将年度战力报告保存到本地并上传至云端
  pushAnnualReport: t.procedure
    .input(
      z.object({
        endpoint: z.string(),
        secretKey: z.string(),
        report: z.record(z.unknown()),
      }),
    )
    .mutation(async ({ input }) => {
      const endpoint = normalizeUrl(input.endpoint);
      if (!endpoint) return { success: false, error: "云同步端点不能为空" };

      // 1. 保存到本地
      const reportPath = getUserDataPath("annual-report.json");
      writeJsonFile(reportPath, input.report);

      // 2. 触发一次全量推送（带 report）
      const pushRes = await syncRouter.createCaller({} as any).pushToCloud({
        endpoint: input.endpoint,
        secretKey: input.secretKey,
      });

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
      if (!endpoint) return { success: false, error: "云同步端点不能为空" };

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
          return { success: false, error: "未授权：密钥错误" };
        }
        if (!res.ok) {
          return { success: false, error: `拉取失败 HTTP ${res.status}` };
        }

        const remotePayload: any = await res.json();
        const remoteData = remotePayload?.data;

        if (!remoteData || Object.keys(remoteData).length === 0) {
          return {
            success: false,
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
          success: true,
          updatedAt: remotePayload.updatedAt,
          backupDir,
          message: "数据已成功从云端恢复！本地旧数据已自动安全备份。",
        };
      } catch (err: any) {
        log.error("[syncRouter] Failed to pull from cloud:", err);
        return {
          success: false,
          error: `拉取异常: ${err?.message || String(err)}`,
        };
      }
    }),
});
