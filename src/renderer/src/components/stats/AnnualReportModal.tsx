import React, { useState } from "react";
import {
  X,
  Sparkles,
  Trophy,
  Flame,
  Shield,
  Clock,
  Heart,
  Cloud,
  Share2,
  CheckCircle2,
  Users,
  Compass,
  Zap,
} from "lucide-react";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from "recharts";
import { trpc } from "../../lib/trpc";
import { Tooltip } from "../common/Tooltip";

export interface AnnualReportModalProps {
  stats: any;
  rankings: { series: any[]; actors: any[] };
  onClose: () => void;
  onAddSystemLog?: (
    text: string,
    level: "INFO" | "WARNING" | "SUCCESS" | "ERROR",
  ) => void;
}

export function AnnualReportModal({
  stats,
  rankings,
  onClose,
  onAddSystemLog,
}: AnnualReportModalProps) {
  const [syncingCloud, setSyncingCloud] = useState(false);
  const [cloudSynced, setCloudSynced] = useState(false);
  const [copied, setCopied] = useState(false);

  // 1. 数据统计推算
  const totalWatchSec = stats?.totals?.watchSec || 0;
  const totalHours = (totalWatchSec / 3600).toFixed(1);
  const totalPlays = stats?.totals?.plays || 0;
  const totalDownloads = stats?.totals?.downloads || 0;

  // 私密计时统计
  const arousalTotals = stats?.arousal?.totals || { count: 0, totalSec: 0 };
  const arousalCount = arousalTotals.count || 0;
  const arousalAvgSec =
    arousalCount > 0 ? Math.floor(arousalTotals.totalSec / arousalCount) : 0;
  const arousalMaxSec = Array.isArray(stats?.arousal?.sessions)
    ? Math.max(0, ...stats.arousal.sessions.map((s: any) => s.durationSec || 0))
    : 0;

  // 黄金观影时段 (0-23点中播放时长最高的)
  let peakHour = "00";
  let peakHourSec = 0;
  if (stats?.hourly) {
    for (const [hour, b] of Object.entries(stats.hourly as Record<string, any>)) {
      if ((b?.watchSec || 0) > peakHourSec) {
        peakHourSec = b.watchSec;
        peakHour = hour;
      }
    }
  }

  // 战力段位评定
  let tierTitle = "青铜探索者";
  let tierBadge = "Bronze Explorer";
  let tierColor = "from-amber-700 to-amber-900";
  let tierDesc = "初入秘境，正在建立属于自己的观影世界观。";

  if (Number(totalHours) >= 200 || totalPlays >= 300) {
    tierTitle = "钛合金战神 · 宇宙领航员";
    tierBadge = "Titanium Overlord";
    tierColor = "from-amber-400 via-rose-500 to-purple-600";
    tierDesc = "阅片万卷，深谙各派艺术神髓，耐力与专注力已臻化境。";
  } else if (Number(totalHours) >= 100 || totalPlays >= 150) {
    tierTitle = "钻石深潜大师";
    tierBadge = "Diamond Diver";
    tierColor = "from-cyan-400 to-blue-600";
    tierDesc = "高频探索，拥有独到的审美鉴赏力与坚定的观影定力。";
  } else if (Number(totalHours) >= 40 || totalPlays >= 50) {
    tierTitle = "黄金先锋达人";
    tierBadge = "Golden Pioneer";
    tierColor = "from-yellow-400 to-amber-600";
    tierDesc = "渐入佳境，对经典作品与喜好演员有极高忠诚度。";
  }

  // 五维雷达图计算 (0-100 标准化分值)
  const radarData = [
    {
      subject: "毅力 (时长)",
      value: Math.min(100, Math.round((Number(totalHours) / 150) * 100) || 35),
    },
    {
      subject: "广度 (体量)",
      value: Math.min(100, Math.round((totalPlays / 120) * 100) || 40),
    },
    {
      subject: "狂热 (计时)",
      value: Math.min(100, Math.round((arousalCount / 30) * 100) || 25),
    },
    {
      subject: "专注 (沉浸)",
      value: Math.min(
        100,
        Math.round((arousalMaxSec > 0 ? (arousalMaxSec / 1800) * 100 : 50)),
      ),
    },
    {
      subject: "探索 (新片)",
      value: Math.min(100, Math.round((totalDownloads / 60) * 100) || 45),
    },
  ];

  // 最佳拍档演员 TOP 3
  const topActors = (rankings?.actors || []).slice(0, 3);

  // 保存战力报告到云端
  const handlePushToCloud = async () => {
    setSyncingCloud(true);
    try {
      const settings: any = await trpc.storage.getSettings.query();
      const endpoint = settings?.cloudSyncEndpoint || "https://avplay-sync.1024327189.workers.dev";
      const secretKey = settings?.cloudSyncSecret || "";

      if (!secretKey) {
        onAddSystemLog?.("云端同步密钥未配置，请先在【设置 -> 云端同步】中输入 SYNC_SECRET", "WARNING");
        return;
      }

      const reportPayload = {
        generatedAt: new Date().toISOString(),
        tierTitle,
        tierBadge,
        totalHours,
        totalPlays,
        arousalCount,
        arousalAvgSec,
        radarData,
        topActors,
      };

      const res = await trpc.sync.pushAnnualReport.mutate({
        endpoint,
        secretKey,
        report: reportPayload,
      });

      if (res.success) {
        setCloudSynced(true);
        onAddSystemLog?.("年度观影战斗力报告已成功同步到 Cloudflare KV！", "SUCCESS");
      } else {
        onAddSystemLog?.(`同步报告失败: ${res.error}`, "ERROR");
      }
    } catch (err: any) {
      onAddSystemLog?.(`同步异常: ${err?.message || err}`, "ERROR");
    } finally {
      setSyncingCloud(false);
    }
  };

  const handleCopySummary = () => {
    const text = `🏆【AVPlayPro 观影战斗力全景报告】\n⭐ 战力段位: ${tierTitle} (${tierBadge})\n⏳ 累计修炼时长: ${totalHours} 小时 (${totalPlays} 次播放)\n🔥 私密计时达标: ${arousalCount} 次 (最高单次 ${Math.floor(arousalMaxSec / 60)} 分钟)\n🌙 黄金时段: ${peakHour}:00 深夜潜行\n💖 最强羁绊演员: ${topActors.map((a: any) => a.name).join("、") || "全能探索"}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    onAddSystemLog?.("战力总结已复制到剪贴板", "SUCCESS");
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/75 backdrop-blur-md flex items-center justify-center p-4 anim-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative bg-slate-950 border border-amber-500/30 rounded-3xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh] anim-scale-in text-slate-100">
        {/* Cyberpunk Top Neon Line */}
        <div className="h-1 bg-gradient-to-r from-amber-500 via-rose-500 to-cyan-500 w-full" />

        {/* Header */}
        <div className="px-8 py-5 flex items-center justify-between border-b border-slate-800/80 bg-slate-900/40">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-gradient-to-br from-amber-500/20 to-rose-500/20 border border-amber-500/30 text-amber-400">
              <Sparkles className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-extrabold tracking-wider bg-gradient-to-r from-amber-200 via-amber-400 to-rose-400 bg-clip-text text-transparent">
                  观影战斗力年度报告
                </h2>
                <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 font-mono font-bold">
                  2026 EXCLUSIVE
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                基于高保真本地观影行为与专注时长综合测算的巅峰全景
              </p>
            </div>
          </div>

          <Tooltip content="关闭作战战报 (Esc)" placement="left">
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭作战战报"
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </Tooltip>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-8 space-y-6">
          {/* Section 1: 战力等级评定大卡片 */}
          <div
            className={`rounded-2xl p-6 bg-gradient-to-r ${tierColor} relative overflow-hidden shadow-xl border border-white/20`}
          >
            <div className="relative z-10 flex items-center justify-between gap-6">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/30 backdrop-blur-md text-[11px] font-mono tracking-widest text-amber-200 border border-white/10 uppercase">
                  <Trophy className="w-3.5 h-3.5 text-amber-300" />
                  战力荣誉段位 · {tierBadge}
                </div>
                <h3 className="text-2xl font-black text-white tracking-wide drop-shadow-md">
                  {tierTitle}
                </h3>
                <p className="text-xs text-white/90 max-w-xl leading-relaxed">
                  {tierDesc}
                </p>
              </div>

              <div className="hidden sm:flex flex-col items-center justify-center p-4 rounded-2xl bg-black/30 backdrop-blur-md border border-white/10 shrink-0 text-center min-w-[130px]">
                <span className="text-[10px] font-bold text-white/70 uppercase">
                  累计修炼时长
                </span>
                <span className="text-2xl font-black text-amber-300 stats-number">
                  {totalHours}
                  <span className="text-xs font-normal text-white/80 ml-0.5">小时</span>
                </span>
                <span className="text-[10px] text-white/60 mt-0.5">
                  共 {totalPlays} 次播放
                </span>
              </div>
            </div>
          </div>

          {/* Section 2: 雷达图与核心战力四宫格 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* 五维战力雷达图 */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 flex flex-col items-center justify-center">
              <div className="w-full flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-300">
                  <Compass className="w-4 h-4 text-cyan-400" />
                  <span>战力五维雷达天平</span>
                </div>
                <span className="text-[10px] text-slate-500 font-mono">满分 100</span>
              </div>

              <div className="w-full h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="#334155" />
                    <PolarAngleAxis
                      dataKey="subject"
                      tick={{ fill: "#94a3b8", fontSize: 11 }}
                    />
                    <PolarRadiusAxis
                      angle={30}
                      domain={[0, 100]}
                      tick={{ fill: "#475569", fontSize: 9 }}
                    />
                    <Radar
                      name="战力指数"
                      dataKey="value"
                      stroke="#f59e0b"
                      fill="#f59e0b"
                      fillOpacity={0.4}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 四维硬核指标 */}
            <div className="grid grid-cols-2 gap-4">
              {/* 黄金观影时段 */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 flex flex-col justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-amber-400">
                  <Clock className="w-4 h-4" />
                  <span>黄金专注时段</span>
                </div>
                <div className="my-2">
                  <div className="text-xl font-extrabold text-white">
                    {peakHour}:00
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {Number(peakHour) >= 0 && Number(peakHour) <= 5
                      ? "🌙 暗夜修仙者"
                      : Number(peakHour) >= 12 && Number(peakHour) <= 14
                        ? "☀️ 午间偷闲"
                        : "🌆 晚间静享"}
                  </div>
                </div>
                <div className="text-[10px] text-slate-500">
                  此时段累计观看 {(peakHourSec / 3600).toFixed(1)} 小时
                </div>
              </div>

              {/* 私密计时深度 */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 flex flex-col justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-rose-400">
                  <Heart className="w-4 h-4" />
                  <span>私密计时记录</span>
                </div>
                <div className="my-2">
                  <div className="text-xl font-extrabold text-white">
                    {arousalCount}
                    <span className="text-xs font-normal text-slate-400 ml-1">次</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    平均 {Math.floor(arousalAvgSec / 60)} 分钟 / 次
                  </div>
                </div>
                <div className="text-[10px] text-slate-500">
                  巅峰单次达 {Math.floor(arousalMaxSec / 60)} 分钟
                </div>
              </div>

              {/* 探索下载量 */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 flex flex-col justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
                  <Zap className="w-4 h-4" />
                  <span>片库吞吐体量</span>
                </div>
                <div className="my-2">
                  <div className="text-xl font-extrabold text-white">
                    {totalDownloads}
                    <span className="text-xs font-normal text-slate-400 ml-1">部</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    累计完成高速下载
                  </div>
                </div>
                <div className="text-[10px] text-slate-500">
                  平均下载吞吐良好
                </div>
              </div>

              {/* 战力综合评级 */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 flex flex-col justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-cyan-400">
                  <Shield className="w-4 h-4" />
                  <span>定力自控指数</span>
                </div>
                <div className="my-2">
                  <div className="text-xl font-extrabold text-white">
                    {Math.min(99, 60 + arousalCount * 2)}
                    <span className="text-xs font-normal text-slate-400 ml-1">分</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    心率与节奏平衡良好
                  </div>
                </div>
                <div className="text-[10px] text-slate-500">
                  健康状态：极佳
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: 最强羁绊演员排行榜 */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-300">
                <Users className="w-4 h-4 text-purple-400" />
                <span>最强心灵羁绊 (TOP 演员榜单)</span>
              </div>
              <span className="text-[10px] text-slate-500">
                陪伴你度过最长观影时光的艺术大师
              </span>
            </div>

            {topActors.length === 0 && (
              <div className="text-center py-6 text-xs text-slate-500">
                暂无足够演员统计，多看几部影片即可解锁你的羁绊榜！
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {topActors.map((actor: any, idx: number) => (
                <div
                  key={actor.name}
                  className="rounded-xl border border-slate-800/80 bg-slate-900/80 p-3.5 flex items-center gap-3"
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                      idx === 0
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                        : idx === 1
                          ? "bg-slate-300/20 text-slate-200 border border-slate-400/40"
                          : "bg-amber-700/20 text-amber-600 border border-amber-700/40"
                    }`}
                  >
                    #{idx + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-slate-200 truncate">
                      {actor.name}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {actor.count} 部作品 · {(actor.watchSec / 60).toFixed(0)} 分钟
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-8 py-4 bg-slate-900/80 border-t border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePushToCloud}
              disabled={syncingCloud}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-xs font-bold text-white transition shadow-sm shadow-amber-500/20 cursor-pointer disabled:opacity-50"
            >
              <Cloud className={`w-3.5 h-3.5 ${syncingCloud ? "animate-spin" : ""}`} />
              {syncingCloud
                ? "正在存入 Cloudflare KV..."
                : cloudSynced
                  ? "已成功存入云端 KV"
                  : "一键保存到 Cloudflare 云端"}
            </button>

            <button
              type="button"
              onClick={handleCopySummary}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition cursor-pointer border border-slate-700"
            >
              {copied ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  已复制战力卡片
                </>
              ) : (
                <>
                  <Share2 className="w-3.5 h-3.5" />
                  复制战力总结
                </>
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 transition cursor-pointer"
          >
            完成查看
          </button>
        </div>
      </div>
    </div>
  );
}
