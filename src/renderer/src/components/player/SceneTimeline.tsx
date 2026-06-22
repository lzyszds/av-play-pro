// 场景切换可视化：进度条下方的密度直方图（色块）
// - 把视频时长分 N 段（例如 120 段），每段统计落入的场景切换点数
// - 用色深表示密度：浅色=静、深色=切换频繁
// - 点击某段 → 跳到对应时间
import React, { useMemo, useRef, useEffect, useState } from "react";
import { trpc } from "../../lib/trpc";
import { Activity, RefreshCcw } from "lucide-react";

interface Props {
  folder: string | null;
  duration: number;
  /** 当前播放秒数，绘制 indicator */
  currentTime?: number;
  onSeek?: (sec: number) => void;
  /** 段数 */
  bins?: number;
}

interface ScenesData {
  scenes: number[];
  duration: number;
  threshold: number;
  detectedAt: string;
}

export const SceneTimeline: React.FC<Props> = ({
  folder,
  duration,
  currentTime,
  onSeek,
  bins = 120,
}) => {
  const [data, setData] = useState<ScenesData | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 加载
  useEffect(() => {
    if (!folder) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    trpc.scenes.get
      .query({ folder })
      .then((d) => {
        if (cancelled) return;
        setData(d);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [folder]);

  // 订阅进度
  useEffect(() => {
    if (!folder || !generating) return;
    const sub = (trpc as any).scenes.progress.subscribe(undefined, {
      onData: (p: { folder: string; current: number; duration: number }) => {
        if (p.folder === folder && p.duration > 0) {
          setProgress(p.current / p.duration);
        }
      },
    });
    return () => sub.unsubscribe();
  }, [folder, generating]);

  const handleGenerate = async () => {
    if (!folder || generating) return;
    setGenerating(true);
    setProgress(0);
    try {
      const r = await trpc.scenes.generate.mutate({ folder, force: true });
      setData(r.data);
    } catch (e) {
      console.warn(e);
    } finally {
      setGenerating(false);
      setProgress(null);
    }
  };

  const totalDur = data?.duration || duration || 0;

  // 把场景切换点分桶
  const buckets = useMemo(() => {
    if (!data || totalDur <= 0) return new Array(bins).fill(0);
    const out = new Array(bins).fill(0);
    for (const s of data.scenes) {
      const idx = Math.min(bins - 1, Math.max(0, Math.floor((s / totalDur) * bins)));
      out[idx] += 1;
    }
    return out;
  }, [data, totalDur, bins]);

  const maxBucket = useMemo(
    () => Math.max(1, ...buckets),
    [buckets],
  );

  const cursorRatio =
    currentTime != null && totalDur > 0 ? currentTime / totalDur : null;

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!totalDur || !onSeek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const t = Math.max(0, Math.min(totalDur, ratio * totalDur));
    onSeek(t);
  };

  if (!folder) return null;

  return (
    <div className="mt-2 px-3 py-2 bg-white border border-slate-200/80 rounded-lg shadow-sm">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          <Activity className="w-3 h-3 text-amber-500" />
          场景切换密度
          {data && (
            <span className="text-slate-400 font-normal normal-case tracking-normal">
              {data.scenes.length} 个 · 阈值 {data.threshold}
            </span>
          )}
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating || loading}
          className="text-[10px] text-slate-500 hover:text-amber-600 cursor-pointer inline-flex items-center gap-0.5 disabled:opacity-50"
          title="重新扫描（ffmpeg）"
        >
          <RefreshCcw className={`w-3 h-3 ${generating ? "animate-spin" : ""}`} />
          {generating
            ? `扫描中 ${progress != null ? Math.round(progress * 100) + "%" : ""}`
            : data
              ? "重扫"
              : "扫描"}
        </button>
      </div>
      <div
        ref={containerRef}
        onClick={handleClick}
        className="relative h-6 rounded-sm overflow-hidden bg-slate-100 cursor-pointer"
      >
        <div className="absolute inset-0 flex">
          {buckets.map((n, i) => {
            const intensity = n / maxBucket; // 0..1
            const alpha = 0.08 + intensity * 0.92;
            return (
              <div
                key={i}
                style={{
                  width: `${100 / bins}%`,
                  background: n
                    ? `rgba(245, 158, 11, ${alpha.toFixed(2)})`
                    : "transparent",
                }}
              />
            );
          })}
        </div>
        {cursorRatio != null && (
          <div
            className="absolute top-0 bottom-0 w-px bg-rose-500 pointer-events-none"
            style={{ left: `${(cursorRatio * 100).toFixed(2)}%` }}
          />
        )}
        {!data && !generating && (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] text-slate-400 italic">
            点击右上「扫描」生成场景密度图
          </div>
        )}
      </div>
    </div>
  );
};
