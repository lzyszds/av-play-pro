import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import { z } from "zod";
import { t } from "../trpc";

export type AchievementTier = "bronze" | "silver" | "gold" | "platinum";

export interface AchievementDef {
  id: string;
  title: string;
  desc: string;
  tier: AchievementTier;
  icon: string;
  target: number;
  unit?: string;
}

export const ACHIEVEMENT_DEFS: AchievementDef[] = [
  {
    id: "night_owl",
    title: "暗夜行者",
    desc: "在深夜 (01:00 - 05:00) 沉浸潜行观影 3 次以上",
    tier: "bronze",
    icon: "Moon",
    target: 3,
    unit: "次",
  },
  {
    id: "scene_hunter",
    title: "名场面猎人",
    desc: "在时间轴上打卡标记 5 个高能精彩书签",
    tier: "bronze",
    icon: "Bookmark",
    target: 5,
    unit: "个",
  },
  {
    id: "speed_demon",
    title: "极速先锋",
    desc: "累计完成 10 个视频下载任务",
    tier: "bronze",
    icon: "Zap",
    target: 10,
    unit: "部",
  },
  {
    id: "destiny_pick",
    title: "听天由命",
    desc: "通过「今晚看啥」或「命运轮盘」成功开播 3 次",
    tier: "bronze",
    icon: "Dices",
    target: 3,
    unit: "次",
  },
  {
    id: "cinema_veteran",
    title: "资深老饕",
    desc: "累计观影播放次数突破 30 次",
    tier: "silver",
    icon: "Film",
    target: 30,
    unit: "次",
  },
  {
    id: "perfectionist",
    title: "强迫症管家",
    desc: "指挥中心片库体检健康度达到 100 分满分",
    tier: "silver",
    icon: "ShieldCheck",
    target: 100,
    unit: "分",
  },
  {
    id: "cloud_explorer",
    title: "云端漫游者",
    desc: "使用 Cloudflare Workers 成功同步片库与战报 5 次",
    tier: "silver",
    icon: "Cloud",
    target: 5,
    unit: "次",
  },
  {
    id: "centurion",
    title: "百人斩",
    desc: "片库收集女优/演员总人数突破 100 位",
    tier: "gold",
    icon: "Crown",
    target: 100,
    unit: "人",
  },
  {
    id: "iron_will",
    title: "铁人耐力",
    desc: "单次私密计时达标突破 40 分钟",
    tier: "gold",
    icon: "Flame",
    target: 40,
    unit: "分钟",
  },
  {
    id: "grand_archivist",
    title: "藏经阁主",
    desc: "本地片库收录影片总数突破 30 部",
    tier: "gold",
    icon: "Package",
    target: 30,
    unit: "部",
  },
  {
    id: "platinum_god",
    title: "登峰造极",
    desc: "解锁全部常规成就，成为无可争议的终极鉴赏家！",
    tier: "platinum",
    icon: "Trophy",
    target: 10,
    unit: "项",
  },
];

function getAchievementsFile(): string {
  return path.join(app.getPath("userData"), "achievements.json");
}

function loadUnlocked(): Record<string, string> {
  try {
    const p = getAchievementsFile();
    if (!fs.existsSync(p)) return {};
    const raw = fs.readFileSync(p, "utf-8");
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function saveUnlocked(data: Record<string, string>): void {
  try {
    const p = getAchievementsFile();
    fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to save achievements:", err);
  }
}

export const achievementsRouter = t.router({
  getAll: t.procedure.query(() => {
    const unlockedMap = loadUnlocked();
    const list = ACHIEVEMENT_DEFS.map((def) => ({
      ...def,
      unlocked: !!unlockedMap[def.id],
      unlockedAt: unlockedMap[def.id] || null,
    }));
    const totalUnlocked = list.filter((a) => a.unlocked).length;
    return {
      achievements: list,
      totalUnlocked,
      totalCount: list.length,
      completionRate: Math.round((totalUnlocked / list.length) * 100),
    };
  }),

  checkAndUnlock: t.procedure
    .input(
      z
        .object({
          nightOwlCount: z.number().optional(),
          bookmarkCount: z.number().optional(),
          downloadCount: z.number().optional(),
          destinyPickCount: z.number().optional(),
          totalPlays: z.number().optional(),
          healthScore: z.number().optional(),
          cloudSyncCount: z.number().optional(),
          actorCount: z.number().optional(),
          maxArousalMinutes: z.number().optional(),
          totalVideos: z.number().optional(),
        })
        .optional(),
    )
    .mutation(({ input = {} }) => {
      const unlockedMap = loadUnlocked();
      const newlyUnlocked: AchievementDef[] = [];
      const now = new Date().toISOString();

      // 从 stats.json / activity-history.json 读取兜底数值
      let autoNightOwl = input.nightOwlCount ?? 0;
      let autoPlays = input.totalPlays ?? 0;
      let autoArousalMin = input.maxArousalMinutes ?? 0;
      let autoActors = input.actorCount ?? 0;

      try {
        const statsFile = path.join(app.getPath("userData"), "stats.json");
        if (fs.existsSync(statsFile)) {
          const stats = JSON.parse(fs.readFileSync(statsFile, "utf-8"));
          if (stats.playHistory && Array.isArray(stats.playHistory)) {
            autoPlays = Math.max(autoPlays, stats.playHistory.length);
            // 统计 01:00 到 05:00 的夜猫子播放
            let nightCount = 0;
            for (const item of stats.playHistory) {
              const h = new Date(item.playedAt || 0).getHours();
              if (h >= 1 && h <= 5) nightCount++;
            }
            autoNightOwl = Math.max(autoNightOwl, nightCount);
          }
          if (stats.arousalStats && Array.isArray(stats.arousalStats)) {
            for (const a of stats.arousalStats) {
              const min = Math.floor((a.durationSec || 0) / 60);
              if (min > autoArousalMin) autoArousalMin = min;
            }
          }
          if (stats.actorCounts && typeof stats.actorCounts === "object") {
            autoActors = Math.max(autoActors, Object.keys(stats.actorCounts).length);
          }
        }
      } catch {
        /* ignore */
      }

      const metrics: Record<string, number> = {
        night_owl: autoNightOwl,
        scene_hunter: input.bookmarkCount ?? 0,
        speed_demon: input.downloadCount ?? 0,
        destiny_pick: input.destinyPickCount ?? 0,
        cinema_veteran: autoPlays,
        perfectionist: input.healthScore ?? 0,
        cloud_explorer: input.cloudSyncCount ?? 0,
        centurion: autoActors,
        iron_will: autoArousalMin,
        grand_archivist: input.totalVideos ?? 0,
      };

      // 检查前 10 项基础成就
      let standardUnlockedCount = 0;
      for (const def of ACHIEVEMENT_DEFS) {
        if (def.id === "platinum_god") continue;
        const currentVal = metrics[def.id] ?? 0;
        const isAlreadyUnlocked = !!unlockedMap[def.id];
        if (!isAlreadyUnlocked && currentVal >= def.target) {
          unlockedMap[def.id] = now;
          newlyUnlocked.push(def);
        }
        if (unlockedMap[def.id]) {
          standardUnlockedCount++;
        }
      }

      // 检查第 11 项白金全成就 (platinum_god)
      if (
        !unlockedMap["platinum_god"] &&
        standardUnlockedCount >= 10
      ) {
        unlockedMap["platinum_god"] = now;
        const platDef = ACHIEVEMENT_DEFS.find((d) => d.id === "platinum_god");
        if (platDef) newlyUnlocked.push(platDef);
      }

      if (newlyUnlocked.length > 0) {
        saveUnlocked(unlockedMap);
      }

      const list = ACHIEVEMENT_DEFS.map((def) => ({
        ...def,
        current: def.id === "platinum_god" ? standardUnlockedCount : (metrics[def.id] ?? 0),
        unlocked: !!unlockedMap[def.id],
        unlockedAt: unlockedMap[def.id] || null,
      }));

      const totalUnlocked = list.filter((a) => a.unlocked).length;

      return {
        success: true as const,
        newlyUnlocked,
        achievements: list,
        totalUnlocked,
        totalCount: list.length,
        completionRate: Math.round((totalUnlocked / list.length) * 100),
      };
    }),

  reset: t.procedure.mutation(() => {
    saveUnlocked({});
    return { success: true as const };
  }),
});
