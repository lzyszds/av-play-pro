import React, { useEffect, useState } from "react";
import {
  X,
  History,
  Play,
  Download,
  FolderArchive,
  Cloud,
  Heart,
  Search,
  Trash2,
  RefreshCw,
  Clock,
  Filter,
} from "lucide-react";
import { trpc } from "../../lib/trpc";

export interface ActivityHistoryModalProps {
  onClose: () => void;
  onAddSystemLog?: (
    text: string,
    level: "INFO" | "WARNING" | "SUCCESS" | "ERROR",
  ) => void;
}

interface ActivityRecord {
  id: string;
  timestamp: string;
  type: "PLAY" | "DOWNLOAD" | "SCRAPE" | "ORGANIZE" | "SYNC" | "AROUSAL";
  title: string;
  detail: string;
  metadata?: Record<string, unknown>;
}

const TYPE_CONFIG = {
  ALL: { label: "全部记录", icon: History, color: "text-slate-400" },
  PLAY: { label: "播放观看", icon: Play, color: "text-amber-500 bg-amber-500/10 border-amber-500/20" },
  DOWNLOAD: { label: "下载活动", icon: Download, color: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" },
  ORGANIZE: { label: "归档整理", icon: FolderArchive, color: "text-blue-500 bg-blue-500/10 border-blue-500/20" },
  SYNC: { label: "云端同步", icon: Cloud, color: "text-sky-500 bg-sky-500/10 border-sky-500/20" },
  AROUSAL: { label: "私密计时", icon: Heart, color: "text-rose-500 bg-rose-500/10 border-rose-500/20" },
};

export function ActivityHistoryModal({
  onClose,
  onAddSystemLog,
}: ActivityHistoryModalProps) {
  const [items, setItems] = useState<ActivityRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedType, setSelectedType] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [stats, setStats] = useState<any>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [listRes, statsRes] = await Promise.all([
        trpc.activity.list.query({
          limit: 100,
          offset: 0,
          type: selectedType === "ALL" ? undefined : selectedType,
          search: search.trim() || undefined,
        }),
        trpc.activity.getStats.query(),
      ]);
      setItems(listRes.items as ActivityRecord[]);
      setTotal(listRes.total);
      setStats(statsRes);
    } catch (err: any) {
      onAddSystemLog?.(`读取操作历史失败: ${err?.message || err}`, "ERROR");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedType, search]);

  const handleClear = async () => {
    if (!confirm("确定要清空全部本地操作历史记录吗？")) return;
    try {
      await trpc.activity.clear.mutate();
      setItems([]);
      setTotal(0);
      onAddSystemLog?.("已清空本地操作历史", "SUCCESS");
    } catch (err: any) {
      onAddSystemLog?.(`清空失败: ${err?.message || err}`, "ERROR");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 anim-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col h-[650px] anim-scale-in">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400">
              <History className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  操作与行为历史时间线
                </h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-mono">
                  {total} 条记录
                </span>
              </div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                记录播放观看、下载归档、私密体验及云端同步等全流程事件
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClear}
              disabled={items.length === 0}
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition cursor-pointer disabled:opacity-40"
              title="清空记录"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={loadData}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              title="刷新"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-amber-500" : ""}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="p-3 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-1 overflow-x-auto py-0.5">
            {Object.entries(TYPE_CONFIG).map(([key, cfg]) => {
              const Icon = cfg.icon;
              const isSelected = selectedType === key;
              const count =
                key === "ALL" ? stats?.total : stats?.byType?.[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedType(key)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer whitespace-nowrap ${
                    isSelected
                      ? "bg-amber-500 text-white font-bold shadow-sm shadow-amber-500/20"
                      : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{cfg.label}</span>
                  {count !== undefined && (
                    <span
                      className={`text-[10px] px-1 rounded-full ${
                        isSelected
                          ? "bg-white/20 text-white"
                          : "bg-slate-200 dark:bg-slate-800 text-slate-500"
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="relative w-48 shrink-0">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索操作记录..."
              className="w-full pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>

        {/* Timeline List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3 bg-slate-50/30 dark:bg-slate-950/40">
          {items.length === 0 && !loading && (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-600 gap-2">
              <Clock className="w-8 h-8 stroke-[1.5]" />
              <div className="text-xs">暂无符合条件的历史记录</div>
            </div>
          )}

          {items.map((item) => {
            const config =
              TYPE_CONFIG[item.type as keyof typeof TYPE_CONFIG] ||
              TYPE_CONFIG.ALL;
            const Icon = config.icon;
            const dateObj = new Date(item.timestamp);
            const timeStr = dateObj.toLocaleTimeString();
            const dateStr = dateObj.toLocaleDateString();

            return (
              <div
                key={item.id}
                className="flex items-start gap-3.5 p-3 rounded-xl border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm hover:border-amber-400/40 transition"
              >
                <div
                  className={`p-2 rounded-xl border shrink-0 mt-0.5 ${config.color}`}
                >
                  <Icon className="w-4 h-4" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                      {item.title}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono shrink-0">
                      {dateStr} {timeStr}
                    </span>
                  </div>

                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 break-all leading-relaxed">
                    {item.detail}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
