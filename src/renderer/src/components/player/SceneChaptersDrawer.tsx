import React, { useState, useMemo } from "react";
import {
  Film,
  LayoutGrid,
  Play,
  X,
  Bookmark,
  Sparkles,
  Flame,
  CheckCircle2,
  FastForward,
} from "lucide-react";

export interface SceneChapter {
  id: string;
  actNumber: number;
  title: string;
  desc: string;
  startTime: number;
  endTime: number;
  isPeak?: boolean;
  isCustomBookmark?: boolean;
}

interface Props {
  duration: number;
  currentTime: number;
  bookmarks?: Array<{ id?: string; currentTime: number; note?: string }>;
  previewVttUrl?: string | null;
  onSeek: (seconds: number) => void;
  onClose: () => void;
}

function formatSec(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}

const DEFAULT_ACT_TEMPLATES = [
  {
    ratioStart: 0,
    ratioEnd: 0.15,
    title: "序幕与剧情背景导入",
    desc: "故事背景铺陈、人物初登场与身份设定引入",
    badge: "开篇",
    isPeak: false,
  },
  {
    ratioStart: 0.15,
    ratioEnd: 0.35,
    title: "首次接触与情绪升温",
    desc: "试探交流、关系破冰与初步互动升温阶段",
    badge: "渐入",
    isPeak: false,
  },
  {
    ratioStart: 0.35,
    ratioEnd: 0.6,
    title: "剧情转折与渐入佳境",
    desc: "情境升华、关键转折与主要互动深入展开",
    badge: "转折",
    isPeak: false,
  },
  {
    ratioStart: 0.6,
    ratioEnd: 0.8,
    title: "核心高能与情绪激荡",
    desc: "全片重点对白与第一轮高能情绪爆发",
    badge: "高能",
    isPeak: true,
  },
  {
    ratioStart: 0.8,
    ratioEnd: 0.95,
    title: "终极对决与全片巅峰",
    desc: "极致焦点呈现、全片节奏巅峰与终局高潮",
    badge: "巅峰",
    isPeak: true,
  },
  {
    ratioStart: 0.95,
    ratioEnd: 1.0,
    title: "余韵收束与尾声结算",
    desc: "高潮落幕、情绪舒缓与片尾回顾余韵",
    badge: "尾声",
    isPeak: false,
  },
];

export const SceneChaptersDrawer: React.FC<Props> = ({
  duration,
  currentTime,
  bookmarks = [],
  onSeek,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<"chapters" | "grid9">("chapters");

  // 根据总时长动态生成章节分幕
  const chapters: SceneChapter[] = useMemo(() => {
    const dur = Math.max(duration, 60);
    return DEFAULT_ACT_TEMPLATES.map((tpl, idx) => ({
      id: `act-${idx + 1}`,
      actNumber: idx + 1,
      title: tpl.title,
      desc: tpl.desc,
      startTime: Math.floor(dur * tpl.ratioStart),
      endTime: Math.floor(dur * tpl.ratioEnd),
      isPeak: tpl.isPeak,
    }));
  }, [duration]);

  // 计算当前播放进度所在的幕次
  const currentChapterIdx = useMemo(() => {
    return chapters.findIndex(
      (c) => currentTime >= c.startTime && currentTime < c.endTime,
    );
  }, [chapters, currentTime]);

  // 9 宫格均匀采样点 (10% ~ 90%)
  const grid9Points = useMemo(() => {
    const dur = Math.max(duration, 60);
    const ratios = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
    const titles = [
      "10% · 初见端倪",
      "20% · 试探升温",
      "30% · 渐入剧情",
      "40% · 转折深入",
      "50% · 半程核心",
      "60% · 激荡高能",
      "70% · 强力催化",
      "80% · 巅峰时刻",
      "90% · 终局尾声",
    ];
    return ratios.map((r, i) => ({
      index: i + 1,
      ratio: r,
      time: Math.floor(dur * r),
      label: titles[i],
      isNearCurrent: Math.abs(currentTime - dur * r) < dur * 0.05,
    }));
  }, [duration, currentTime]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-end bg-black/60 backdrop-blur-xs select-none"
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-md bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col animate-in slide-in-from-right duration-250"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/30">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-amber-500 to-amber-600 text-white shadow-xs">
              <Film className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <span>剧情分幕 & 关键帧速览</span>
              </h3>
              <p className="text-[11px] text-slate-400">
                总时长 {formatSec(duration)} · 当前进度 {formatSec(currentTime)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab 切换 */}
        <div className="flex p-2 bg-slate-100/60 dark:bg-slate-800/40 border-b border-slate-200/60 dark:border-slate-800 gap-1">
          <button
            type="button"
            onClick={() => setActiveTab("chapters")}
            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === "chapters"
                ? "bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 shadow-xs"
                : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            <span>剧情分幕大纲 ({chapters.length} 幕)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("grid9")}
            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === "grid9"
                ? "bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 shadow-xs"
                : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>9 宫格微速览</span>
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {activeTab === "chapters" ? (
            /* 剧情分幕大纲 */
            <div className="space-y-2.5">
              <div className="text-[11px] text-slate-400 flex items-center justify-between">
                <span>点击任意章节可秒级跳转</span>
                {currentChapterIdx >= 0 && (
                  <span className="text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    正在播放: 第 {currentChapterIdx + 1} 幕
                  </span>
                )}
              </div>

              {chapters.map((chap, idx) => {
                const isPlaying = idx === currentChapterIdx;
                return (
                  <div
                    key={chap.id}
                    onClick={() => onSeek(chap.startTime)}
                    className={`p-3 rounded-xl border transition-all cursor-pointer relative group ${
                      isPlaying
                        ? "bg-amber-500/10 dark:bg-amber-500/15 border-amber-500/60 ring-2 ring-amber-500/20 shadow-xs"
                        : "bg-slate-50/60 dark:bg-slate-800/30 border-slate-200/80 dark:border-slate-800 hover:border-amber-400/60 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-extrabold shrink-0 ${
                            isPlaying
                              ? "bg-amber-500 text-white shadow-xs"
                              : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                          }`}
                        >
                          {chap.actNumber}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                              {chap.title}
                            </span>
                            {chap.isPeak && (
                              <span className="text-[9px] bg-rose-500/10 text-rose-600 dark:text-rose-400 px-1.5 py-0.2 rounded font-semibold flex items-center gap-0.5 border border-rose-500/20">
                                <Flame className="w-2.5 h-2.5 text-rose-500" />
                                高能
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">
                            {chap.desc}
                          </p>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="font-mono text-xs font-bold text-amber-600 dark:text-amber-400">
                          {formatSec(chap.startTime)}
                        </span>
                        <div className="text-[9px] text-slate-400 mt-0.5">
                          持续 {formatSec(chap.endTime - chap.startTime)}
                        </div>
                      </div>
                    </div>

                    {/* 章节内进度条指示 */}
                    {isPlaying && (
                      <div className="w-full bg-slate-200/60 dark:bg-slate-800 h-1 rounded-full mt-2.5 overflow-hidden">
                        <div
                          className="bg-amber-500 h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${Math.max(
                              0,
                              Math.min(
                                100,
                                ((currentTime - chap.startTime) /
                                  (chap.endTime - chap.startTime || 1)) *
                                  100,
                              ),
                            )}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}

              {/* 用户自定义高能书签 */}
              {bookmarks.length > 0 && (
                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
                  <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Bookmark className="w-3.5 h-3.5 text-amber-500" />
                    <span>自定义打点高能书签 ({bookmarks.length})</span>
                  </div>
                  <div className="space-y-1.5">
                    {bookmarks.map((bm, i) => (
                      <div
                        key={bm.id || i}
                        onClick={() => onSeek(bm.currentTime)}
                        className="flex items-center justify-between p-2 rounded-lg bg-amber-500/5 hover:bg-amber-500/15 border border-amber-500/20 text-xs cursor-pointer transition"
                      >
                        <span className="text-slate-700 dark:text-slate-200 flex items-center gap-1.5 truncate">
                          <CheckCircle2 className="w-3 h-3 text-amber-500 shrink-0" />
                          <span className="truncate">
                            {bm.note || `高能标记点 #${i + 1}`}
                          </span>
                        </span>
                        <span className="font-mono text-amber-600 dark:text-amber-400 font-bold shrink-0 ml-2">
                          {formatSec(bm.currentTime)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* 9 宫格微速览矩阵 */
            <div className="space-y-3">
              <div className="text-[11px] text-slate-400">
                均匀采样全片 9 大关键节点，点击任意宫格直达：
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                {grid9Points.map((pt) => (
                  <div
                    key={pt.index}
                    onClick={() => onSeek(pt.time)}
                    className={`group relative aspect-video rounded-xl border p-2 flex flex-col justify-between transition-all cursor-pointer overflow-hidden ${
                      pt.isNearCurrent
                        ? "bg-amber-500/15 border-amber-500 ring-2 ring-amber-500/20 shadow-xs"
                        : "bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 hover:border-amber-400 hover:scale-[1.02]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-mono font-bold bg-black/40 text-white px-1.5 py-0.5 rounded backdrop-blur-xs">
                        #{pt.index}
                      </span>
                      <span className="text-[9px] font-semibold text-amber-600 dark:text-amber-400">
                        {Math.round(pt.ratio * 100)}%
                      </span>
                    </div>

                    <div className="flex items-center justify-center py-1">
                      <div className="w-7 h-7 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center group-hover:scale-115 group-hover:bg-amber-500 group-hover:text-white transition-all shadow-xs">
                        <Play className="w-3 h-3 fill-current ml-0.5" />
                      </div>
                    </div>

                    <div className="text-center">
                      <div className="font-mono text-[11px] font-extrabold text-slate-800 dark:text-slate-200">
                        {formatSec(pt.time)}
                      </div>
                      <div className="text-[9px] text-slate-400 truncate">
                        {pt.label.split("·")[1]?.trim()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3.5 bg-slate-50/80 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <span className="text-[10px] text-slate-400 flex items-center gap-1">
            <FastForward className="w-3 h-3 text-amber-500" />
            支持随时点击分幕或 9 宫格切播
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold transition cursor-pointer"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
