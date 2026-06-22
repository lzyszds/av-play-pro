// AI 评分训练面板（小卡片，放在 PlayerPage 右侧栏）
import React, { useEffect, useState } from "react";
import { Brain, RefreshCcw, CheckCircle2 } from "lucide-react";
import { trpc } from "../../lib/trpc";
import type { VideoItem } from "../../pages/player/types";

interface Props {
  localVideos: VideoItem[];
  favorites: Set<string>;
  folderResolver: (v: VideoItem) => string | null;
  onAddSystemLog: (
    text: string,
    level?: "INFO" | "WARNING" | "SUCCESS" | "ERROR",
  ) => void;
  onTrained?: () => void;
}

export const AiScorePanel: React.FC<Props> = ({
  localVideos,
  favorites,
  folderResolver,
  onAddSystemLog,
  onTrained,
}) => {
  const [status, setStatus] = useState<{
    trained: boolean;
    trainedAt?: string;
    samples?: number;
    mu?: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const s = await trpc.intel.status.query();
      setStatus(s);
    } catch {}
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleTrain = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const s = await trpc.stats.get.query();
      const stats: Record<string, { playCount?: number; watchSec?: number }> = {};
      if (s?.videos) {
        for (const folder of Object.keys(s.videos)) {
          stats[folder] = {
            playCount: s.videos[folder].playCount,
            watchSec: s.videos[folder].watchSec,
          };
        }
      }
      const videos = localVideos
        .map((v) => {
          const folder = folderResolver(v);
          if (!folder) return null;
          return {
            folder,
            meta: {
              actors: v.actors,
              genres: v.genres,
              studio: v.studio,
              studioSeries: v.studioSeries,
              label: v.label,
              director: v.director,
            },
          };
        })
        .filter((x): x is { folder: string; meta: any } => !!x);
      const favFolders: string[] = [];
      for (const v of localVideos) {
        if (favorites.has(v.id)) {
          const folder = folderResolver(v);
          if (folder) favFolders.push(folder);
        }
      }
      const r = await trpc.intel.train.mutate({
        videos,
        stats,
        favorites: favFolders,
      });
      onAddSystemLog(
        `AI 模型训练完成：${r.samples} 个有效样本，先验喜欢度 ${r.mu.toFixed(2)}`,
        "SUCCESS",
      );
      await refresh();
      onTrained?.();
    } catch (e: any) {
      onAddSystemLog(`训练失败：${e?.message || e}`, "ERROR");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-3 bg-white border border-slate-200/80 rounded-xl shadow-sm">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-violet-600">
          <Brain className="w-3.5 h-3.5" />
          AI 私人评分
        </div>
        <button
          onClick={handleTrain}
          disabled={busy}
          className="text-[10px] text-slate-500 hover:text-violet-600 cursor-pointer inline-flex items-center gap-0.5 disabled:opacity-50"
          title="基于你的观看历史训练专属模型"
        >
          <RefreshCcw className={`w-3 h-3 ${busy ? "animate-spin" : ""}`} />
          {busy ? "训练中" : status?.trained ? "重训" : "训练"}
        </button>
      </div>
      <div className="text-[10.5px] text-slate-500 leading-relaxed">
        {status?.trained ? (
          <div className="flex items-start gap-1.5">
            <CheckCircle2 className="w-3 h-3 text-emerald-500 mt-0.5 shrink-0" />
            <div>
              已训练 · {status.samples} 样本 ·{" "}
              {status.trainedAt &&
                new Date(status.trainedAt).toLocaleString("zh-CN", {
                  hour12: false,
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              <div className="text-[9.5px] text-slate-400 mt-0.5">
                卡片右上将显示 AI 评分
              </div>
            </div>
          </div>
        ) : (
          <div className="italic text-slate-400">
            尚未训练。点右上按钮基于你的观看记录建立专属模型。
          </div>
        )}
      </div>
    </div>
  );
};
