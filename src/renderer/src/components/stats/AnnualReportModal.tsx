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
  Film,
  Award,
  TrendingUp,
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
import { Button, IconButton } from "../common/Button";
import { HolographicCardModal } from "./HolographicCardModal";

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
  const [showHolographic, setShowHolographic] = useState(false);

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
  let tierDesc = "初入秘境，正在建立属于自己的观影世界观与审美偏好。";
  let rankLevel = 1;
  let nextRankNeed = "40 小时或 50 次播放";
  let rankProgress = Math.min(100, Math.round((Number(totalHours) / 40) * 100));

  if (Number(totalHours) >= 200 || totalPlays >= 300) {
    tierTitle = "钛合金战神 · 宇宙领航员";
    tierBadge = "Titanium Overlord";
    tierDesc = "阅片万卷，深谙各派艺术神髓，耐力与专注力已臻化境。";
    rankLevel = 4;
    nextRankNeed = "已登顶最高段位";
    rankProgress = 100;
  } else if (Number(totalHours) >= 100 || totalPlays >= 150) {
    tierTitle = "钻石深潜大师";
    tierBadge = "Diamond Diver";
    tierDesc = "高频探索，拥有独到的审美鉴赏力与坚定的观影定力。";
    rankLevel = 3;
    nextRankNeed = "200 小时晋级战神";
    rankProgress = Math.min(100, Math.round(((Number(totalHours) - 100) / 100) * 100));
  } else if (Number(totalHours) >= 40 || totalPlays >= 50) {
    tierTitle = "黄金先锋达人";
    tierBadge = "Golden Pioneer";
    tierDesc = "渐入佳境，对经典作品与喜好演员有极高忠诚度。";
    rankLevel = 2;
    nextRankNeed = "100 小时晋级钻石";
    rankProgress = Math.min(100, Math.round(((Number(totalHours) - 40) / 60) * 100));
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
        Math.round(arousalMaxSec > 0 ? (arousalMaxSec / 1800) * 100 : 50),
      ),
    },
    {
      subject: "探索 (新片)",
      value: Math.min(100, Math.round((totalDownloads / 60) * 100) || 45),
    },
  ];

  // 最佳拍档演员 TOP 3
  const topActors = (rankings?.actors || []).slice(0, 3);
  const controlScore = Math.min(99, 60 + arousalCount * 2);

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

      const res = await fetch(`${endpoint}/api/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secretKey}`,
        },
        body: JSON.stringify({
          action: "backup_report",
          timestamp: Date.now(),
          data: reportPayload,
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      setCloudSynced(true);
      onAddSystemLog?.("战力档案已成功备份到 Cloudflare KV 云端！", "SUCCESS");
    } catch (err: any) {
      onAddSystemLog?.(`云端上传失败: ${err.message}`, "ERROR");
    } finally {
      setSyncingCloud(false);
    }
  };

  // 复制文本战力总结
  const handleCopySummary = () => {
    const text = `🏆【AVPlayPro 2026 观影战斗力年度报告】
段位评定: ${tierTitle} (${tierBadge})
累计修炼: ${totalHours} 小时 / ${totalPlays} 次播放
黄金时段: ${peakHour}:00 (${
      Number(peakHour) <= 5 ? "暗夜修仙者" : Number(peakHour) <= 14 ? "午间偷闲" : "晚间静享"
    })
私密记录: ${arousalCount} 次 (均长 ${(arousalAvgSec / 60).toFixed(0)} 分钟)
定力指数: ${controlScore} 分 (身心平衡优秀)
最强羁绊: ${topActors.map((a: any) => a.name).join("、") || "全领域无差别探索"}`;

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 anim-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative bg-slate-950 border border-amber-500/30 rounded-3xl w-full max-w-4xl overflow-hidden shadow-[0_0_60px_rgba(244,63,94,0.18)] flex flex-col max-h-[92vh] anim-scale-in text-slate-100 ring-1 ring-white/10">
        {/* Header */}
        <div className="px-7 py-4.5 flex items-center justify-between border-b border-slate-800/80 bg-slate-900/50 backdrop-blur-md shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-amber-500/20 via-rose-500/20 to-cyan-500/10 border border-amber-500/30 text-amber-400 shadow-sm shadow-amber-500/15">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-extrabold tracking-wider bg-gradient-to-r from-amber-200 via-rose-200 to-amber-300 bg-clip-text text-transparent">
                  观影战斗力年度档案
                </h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 font-mono font-bold tracking-wider">
                  2026 EXCLUSIVE
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                基于高保真本地观影行为与专注时长综合测算的巅峰全景
              </p>
            </div>
          </div>

          <Tooltip content="关闭战报 (Esc)" placement="left">
            <IconButton
              variant="ghost"
              size="sm"
              icon={<X className="w-4 h-4 text-slate-400 hover:text-white" />}
              onClick={onClose}
              aria-label="关闭"
            />
          </Tooltip>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 sm:p-7 space-y-6">
          {/* Section 1: 战力等级评定大卡片 (赛博勋章插画 + 全景全息底纹) */}
          <div className="relative overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-br from-slate-900/95 via-slate-900/80 to-slate-950 p-5 sm:p-6 shadow-xl backdrop-blur-md">
            {/* 背景氛围渐变与科技微光 */}
            <div className="absolute top-0 right-1/4 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none -translate-y-1/2" />
            <div className="absolute bottom-0 right-0 w-72 h-72 bg-rose-500/10 rounded-full blur-3xl pointer-events-none translate-y-1/3" />
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b12_1px,transparent_1px),linear-gradient(to_bottom,#1e293b12_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />

            <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
              {/* 左侧：3D赛博勋章插画 + 段位信息 */}
              <div className="flex items-center gap-5">
                {/* 勋章插画容器 */}
                <div className="relative shrink-0 group">
                  <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-amber-500 via-rose-500 to-amber-300 opacity-60 blur-md group-hover:opacity-100 transition duration-500" />
                  <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden border-2 border-amber-400/50 bg-slate-950 shadow-inner">
                    <img
                      src="./cyber_rank_emblem.jpg"
                      alt="Cyber Rank Emblem"
                      className="w-full h-full object-cover object-center transform group-hover:scale-105 transition duration-300"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-transparent pointer-events-none" />
                    <div className="absolute bottom-1 left-1 right-1 text-center">
                      <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-amber-300/90 px-1 py-0.2 rounded bg-black/60 backdrop-blur">
                        LV.{rankLevel}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 标题与描述 */}
                <div className="space-y-1.5">
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/10 text-[10px] font-mono tracking-widest text-amber-300 border border-amber-500/25 uppercase font-bold">
                    <Trophy className="w-3 h-3 text-amber-400" />
                    荣誉段位 · {tierBadge}
                  </div>
                  <h3 className="text-2xl sm:text-3xl font-black tracking-wide text-transparent bg-clip-text bg-gradient-to-r from-amber-200 via-rose-100 to-amber-400 drop-shadow-md">
                    {tierTitle}
                  </h3>
                  <p className="text-xs text-slate-300 max-w-lg leading-relaxed">
                    {tierDesc}
                  </p>
                  {/* 段位晋级进度条 */}
                  <div className="pt-1.5 flex items-center gap-3">
                    <div className="w-36 sm:w-48 h-1.5 rounded-full bg-slate-800/80 overflow-hidden border border-slate-700/50">
                      <div
                        className="h-full bg-gradient-to-r from-amber-500 via-rose-500 to-amber-300 rounded-full transition-all duration-500"
                        style={{ width: `${Math.max(5, rankProgress)}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-mono text-slate-400">
                      {rankProgress}% · {nextRankNeed}
                    </span>
                  </div>
                </div>
              </div>

              {/* 右侧：高科技时长数据框 */}
              <div className="flex md:flex-col items-center justify-between md:justify-center p-4 rounded-2xl bg-slate-900/80 backdrop-blur-md border border-slate-800 shrink-0 text-center min-w-[140px] shadow-sm">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    累计修炼时长
                  </span>
                  <div className="text-2xl sm:text-3xl font-black text-amber-300 font-mono tracking-tight my-0.5">
                    {totalHours}
                    <span className="text-xs font-normal text-slate-400 ml-1">小时</span>
                  </div>
                </div>
                <div className="text-[11px] font-mono text-slate-400 flex items-center gap-1">
                  <Film className="w-3 h-3 text-rose-400" />
                  <span>共 {totalPlays} 次播放</span>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: 雷达图与核心战力四宫格 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* 五维战力雷达图 */}
            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-5 flex flex-col justify-between backdrop-blur-sm relative overflow-hidden">
              <div className="w-full flex items-center justify-between mb-1">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
                  <Compass className="w-4 h-4 text-cyan-400" />
                  <span>战力五维雷达天平</span>
                </div>
                <span className="text-[10px] text-amber-400 font-mono font-semibold px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20">
                  满分 100
                </span>
              </div>

              <div className="w-full h-56 my-1">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="#334155" strokeDasharray="3 3" />
                    <PolarAngleAxis
                      dataKey="subject"
                      tick={{ fill: "#cbd5e1", fontSize: 11, fontWeight: 600 }}
                    />
                    <PolarRadiusAxis
                      angle={30}
                      domain={[0, 100]}
                      tick={{ fill: "#64748b", fontSize: 9 }}
                    />
                    <Radar
                      name="战力指数"
                      dataKey="value"
                      stroke="#f43f5e"
                      strokeWidth={2}
                      fill="#f43f5e"
                      fillOpacity={0.4}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>

              {/* 雷达底部 5 维数据胶囊 */}
              <div className="grid grid-cols-5 gap-1.5 pt-2 border-t border-slate-800/80">
                {radarData.map((d, i) => (
                  <div
                    key={i}
                    className="text-center p-1 rounded-lg bg-slate-800/40 border border-slate-800"
                  >
                    <div className="text-[9px] text-slate-400 truncate">
                      {d.subject.split(" ")[0]}
                    </div>
                    <div className="text-xs font-mono font-bold text-amber-300">
                      {d.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 四维硬核指标 */}
            <div className="grid grid-cols-2 gap-3.5">
              {/* 黄金观影时段 */}
              <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/5 to-slate-900/70 p-4 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400">
                    <Clock className="w-4 h-4" />
                    <span>黄金专注时段</span>
                  </div>
                  <span className="text-[10px] font-mono text-amber-300/80">
                    PEAK
                  </span>
                </div>
                <div className="my-2">
                  <div className="text-2xl font-black font-mono text-white tracking-tight">
                    {peakHour}:00
                  </div>
                  <div className="text-[11px] font-semibold text-amber-300 mt-0.5">
                    {Number(peakHour) >= 0 && Number(peakHour) <= 5
                      ? "🌙 暗夜修仙者"
                      : Number(peakHour) >= 12 && Number(peakHour) <= 14
                        ? "☀️ 午间偷闲"
                        : "🌆 晚间静享"}
                  </div>
                </div>
                <div className="text-[10px] text-slate-400 pt-1.5 border-t border-slate-800">
                  此时段累计观看 {(peakHourSec / 3600).toFixed(1)} 小时
                </div>
              </div>

              {/* 私密计时深度 */}
              <div className="rounded-2xl border border-rose-500/20 bg-gradient-to-br from-rose-500/5 to-slate-900/70 p-4 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-rose-400">
                    <Heart className="w-4 h-4" />
                    <span>私密计时记录</span>
                  </div>
                  <span className="text-[10px] font-mono text-rose-300/80">
                    SYNC
                  </span>
                </div>
                <div className="my-2">
                  <div className="text-2xl font-black font-mono text-white tracking-tight">
                    {arousalCount}
                    <span className="text-xs font-normal text-slate-400 ml-1">次</span>
                  </div>
                  <div className="text-[11px] font-semibold text-rose-300 mt-0.5">
                    平均 {Math.floor(arousalAvgSec / 60)} 分钟 / 次
                  </div>
                </div>
                <div className="text-[10px] text-slate-400 pt-1.5 border-t border-slate-800">
                  巅峰单次达 {Math.floor(arousalMaxSec / 60)} 分钟
                </div>
              </div>

              {/* 探索下载量 */}
              <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 to-slate-900/70 p-4 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                    <Zap className="w-4 h-4" />
                    <span>片库吞吐体量</span>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-300/80">
                    FLOW
                  </span>
                </div>
                <div className="my-2">
                  <div className="text-2xl font-black font-mono text-white tracking-tight">
                    {totalDownloads}
                    <span className="text-xs font-normal text-slate-400 ml-1">部</span>
                  </div>
                  <div className="text-[11px] font-semibold text-emerald-300 mt-0.5">
                    {totalDownloads > 0 ? "高速入库运转中" : "暂未发起下载"}
                  </div>
                </div>
                <div className="text-[10px] text-slate-400 pt-1.5 border-t border-slate-800">
                  多线程分片吞吐稳定
                </div>
              </div>

              {/* 战力综合评级 */}
              <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/5 to-slate-900/70 p-4 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-cyan-400">
                    <Shield className="w-4 h-4" />
                    <span>定力自控指数</span>
                  </div>
                  <span className="text-[10px] font-mono text-cyan-300/80">
                    SCORE
                  </span>
                </div>
                <div className="my-2">
                  <div className="text-2xl font-black font-mono text-white tracking-tight">
                    {controlScore}
                    <span className="text-xs font-normal text-slate-400 ml-1">分</span>
                  </div>
                  <div className="text-[11px] font-semibold text-cyan-300 mt-0.5">
                    心率与节奏平衡良好
                  </div>
                </div>
                <div className="text-[10px] text-slate-400 pt-1.5 border-t border-slate-800">
                  健康自律状态：极佳
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: 最强心灵羁绊 (TOP 演员榜单 / 全息星图插画底卡) */}
          <div className="relative overflow-hidden rounded-2xl border border-slate-800/90 bg-slate-900/50 p-5 space-y-3">
            <div className="flex items-center justify-between relative z-10">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
                <Users className="w-4 h-4 text-purple-400" />
                <span>最强心灵羁绊 (TOP 演员榜单)</span>
              </div>
              <span className="text-[10px] text-slate-400">
                陪伴你度过最长观影时光的艺术大师
              </span>
            </div>

            {topActors.length === 0 ? (
              /* 空状态：全息星图插画横幅卡片 */
              <div className="relative rounded-xl overflow-hidden border border-slate-800 p-6 flex flex-col sm:flex-row items-center justify-between gap-5 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950">
                <div className="absolute inset-0 opacity-20 bg-cover bg-center pointer-events-none" style={{ backgroundImage: "url('./cyber_cinema_hologram.jpg')" }} />
                <div className="absolute inset-0 bg-gradient-to-r from-slate-950/90 via-slate-950/60 to-slate-950/90 pointer-events-none" />

                <div className="relative z-10 flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0 shadow-lg shadow-amber-500/10">
                    <Film className="w-7 h-7 animate-pulse" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-100 flex items-center gap-2">
                      <span>专属羁绊星图静待开启</span>
                      <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                        HOLOGRAM
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1 max-w-md">
                      暂无足够演员专注时长；在片库多看几部不同作品，系统将自动基于观影热力绘制共演羁绊网络！
                    </p>
                  </div>
                </div>

                <div className="relative z-10 shrink-0">
                  <span className="text-[11px] font-mono font-bold text-amber-400 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/25">
                    探索片库即刻点亮
                  </span>
                </div>
              </div>
            ) : (
              /* 已有演员数据展示 */
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 relative z-10">
                {topActors.map((actor: any, idx: number) => (
                  <div
                    key={actor.name}
                    className="rounded-xl border border-slate-800 bg-slate-900/80 p-3.5 flex items-center gap-3 hover:border-amber-500/40 transition group"
                  >
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-xs shrink-0 shadow-sm ${
                        idx === 0
                          ? "bg-gradient-to-br from-amber-400 to-amber-600 text-slate-950 shadow-amber-500/30"
                          : idx === 1
                            ? "bg-gradient-to-br from-slate-200 to-slate-400 text-slate-950"
                            : "bg-gradient-to-br from-amber-600 to-amber-800 text-amber-100"
                      }`}
                    >
                      #{idx + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-slate-200 truncate group-hover:text-amber-400 transition">
                        {actor.name}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {actor.count} 部作品 · {(actor.watchSec / 60).toFixed(0)} 分钟
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-7 py-4 bg-slate-900/70 border-t border-slate-800/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <Button
              variant="primary"
              size="md"
              icon={<Cloud className={`w-3.5 h-3.5 ${syncingCloud ? "animate-spin" : ""}`} />}
              disabled={syncingCloud}
              onClick={handlePushToCloud}
            >
              {syncingCloud
                ? "正在存入 Cloudflare KV..."
                : cloudSynced
                  ? "已成功存入云端 KV"
                  : "一键保存到 Cloudflare 云端"}
            </Button>

            <Button
              variant="secondary"
              size="md"
              icon={
                copied ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Share2 className="w-3.5 h-3.5" />
                )
              }
              onClick={handleCopySummary}
            >
              {copied ? "已复制战力卡片" : "复制战力总结"}
            </Button>

            <Button
              variant="accent"
              size="md"
              icon={<Sparkles className="w-3.5 h-3.5" />}
              onClick={() => setShowHolographic(true)}
            >
              4K 全息战力卡
            </Button>
          </div>

          <Button
            variant="ghost"
            size="md"
            onClick={onClose}
          >
            完成查看
          </Button>
        </div>
      </div>

      {showHolographic && (
        <HolographicCardModal
          stats={stats}
          rankings={rankings}
          rankTitle={tierTitle}
          rankScore={controlScore}
          peakHour={peakHour}
          onClose={() => setShowHolographic(false)}
          onAddSystemLog={onAddSystemLog}
        />
      )}
    </div>
  );
}
