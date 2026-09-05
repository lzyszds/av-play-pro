import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles,
  Play,
  RotateCw,
  X,
  FileVideo,
  Flame,
  Heart,
  Clock,
  Dices,
  Shuffle,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { VideoItem } from "../../pages/player/types";

type Phase = "idle" | "spinning" | "revealed";

type PoolMode = "all" | "favorites" | "unplayed" | "short";

interface Props {
  videos: VideoItem[];
  favorites?: Set<string>;
  onClose: () => void;
  onPlay: (video: VideoItem, seekTime?: number) => void;
}

const COLORS = [
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#8b5cf6",
  "#3b82f6",
  "#10b981",
  "#f97316",
  "#eab308",
];

interface ConfettiPiece {
  side: "left" | "right";
  color: string;
  top: number;
  cx: number;
  cy: number;
  cr: number;
  cd: number;
  ck: number;
}

function genConfetti(count: number): ConfettiPiece[] {
  const arr: ConfettiPiece[] = [];
  for (let i = 0; i < count; i++) {
    const side: "left" | "right" = i % 2 === 0 ? "left" : "right";
    const dirX = side === "left" ? -1 : 1;
    arr.push({
      side,
      color: COLORS[i % COLORS.length],
      top: 40 + Math.random() * 30,
      cx: dirX * (120 + Math.random() * 260),
      cy: -(180 + Math.random() * 260),
      cr: Math.random() * 720 - 360,
      cd: 1.4 + Math.random() * 1.4,
      ck: -Math.random() * 2,
    });
  }
  return arr;
}

function pickRandom<T>(list: T[], exclude?: T): T {
  if (list.length <= 1) return list[0];
  while (true) {
    const v = list[Math.floor(Math.random() * list.length)];
    if (v !== exclude) return v;
  }
}

export function LuckyDraw({ videos, favorites, onClose, onPlay }: Props) {
  const [poolMode, setPoolMode] = useState<PoolMode>("all");
  const [phase, setPhase] = useState<Phase>("idle");
  const [spinIdx, setSpinIdx] = useState(0);
  const [winner, setWinner] = useState<VideoItem | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const timersRef = useRef<number[]>([]);

  const confettiLeft = useMemo(() => genConfetti(22), []);
  const confettiRight = useMemo(() => genConfetti(22), []);

  // 根据选定盲盒模式过滤视频池
  const candidateVideos = useMemo(() => {
    if (poolMode === "favorites") {
      const favList = videos.filter((v) => favorites?.has(v.id || v.name));
      return favList.length > 0 ? favList : videos;
    }
    if (poolMode === "unplayed") {
      const unpList = videos.filter((v) => (v.playCount || 0) === 0);
      return unpList.length > 0 ? unpList : videos;
    }
    if (poolMode === "short") {
      const shortList = videos.filter((v) => {
        if (!v.duration) return false;
        // 小于 60 分钟 (3600s)
        const parts = v.duration.split(":").map(Number);
        const sec =
          parts.length === 3
            ? parts[0] * 3600 + parts[1] * 60 + parts[2]
            : parts[0] * 60 + parts[1];
        return sec > 0 && sec <= 3600;
      });
      return shortList.length > 0 ? shortList : videos;
    }
    return videos;
  }, [videos, favorites, poolMode]);

  // 音效合成播放（无需外部静态资源）
  const playBeep = (freq = 600, dur = 0.05) => {
    if (!soundEnabled) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + dur);
    } catch {}
  };

  const playVictoryChime = () => {
    if (!soundEnabled) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.1);
        gain.gain.setValueAtTime(0.12, ctx.currentTime + i * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.1 + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.1);
        osc.stop(ctx.currentTime + i * 0.1 + 0.4);
      });
    } catch {}
  };

  const spin = () => {
    if (candidateVideos.length === 0) return;

    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current.forEach((t) => window.clearInterval(t));
    timersRef.current = [];

    setPhase("spinning");
    setWinner(null);

    // 阶梯式减速音画飞轮 (Rapid Reel Spin)
    let speed = 60;
    let stepCount = 0;
    const maxSteps = 28;

    const tick = () => {
      setSpinIdx((prev) => (prev + 1) % candidateVideos.length);
      playBeep(400 + (stepCount % 8) * 60, 0.04);
      stepCount++;

      if (stepCount < maxSteps) {
        if (stepCount > 18) speed += 25; // 减速悬念
        const t = window.setTimeout(tick, speed);
        timersRef.current.push(t);
      } else {
        // 定格大奖
        const chosen = pickRandom(candidateVideos);
        setWinner(chosen);
        setPhase("revealed");
        playVictoryChime();
      }
    };

    tick();
  };

  useEffect(() => {
    if (candidateVideos.length > 0) {
      spin();
    }
    return () => {
      timersRef.current.forEach((t) => {
        window.clearTimeout(t);
        window.clearInterval(t);
      });
      timersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const displayVideo =
    winner || candidateVideos[spinIdx % Math.max(candidateVideos.length, 1)];

  // 计算高潮切入时间（若有时长，默认切到约 70% 黄金高潮段）
  const getPeakHighlightSec = (v: VideoItem): number => {
    if (!v.duration) return 1800;
    const parts = v.duration.split(":").map(Number);
    const totalSec =
      parts.length === 3
        ? parts[0] * 3600 + parts[1] * 60 + parts[2]
        : parts[0] * 60 + parts[1];
    return Math.floor(totalSec * 0.7);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md anim-fade-in overflow-hidden select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* 顶部控制栏 */}
      <div className="absolute top-5 right-5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setSoundEnabled(!soundEnabled)}
          className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer transition"
          title={soundEnabled ? "静音音效" : "开启音效"}
        >
          {soundEnabled ? (
            <Volume2 className="w-4 h-4 text-amber-400" />
          ) : (
            <VolumeX className="w-4 h-4 text-slate-400" />
          )}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 礼花粒子动效 */}
      {phase === "revealed" && (
        <>
          <div className="absolute left-[15%] top-1/2 pointer-events-none">
            {confettiLeft.map((c, i) => (
              <span
                key={`L${i}`}
                className="confetti-piece left"
                style={
                  {
                    background: c.color,
                    top: `${c.top}px`,
                    left: 0,
                    ["--cx" as any]: `${c.cx}px`,
                    ["--cy" as any]: `${c.cy}px`,
                    ["--cr" as any]: `${c.cr}deg`,
                    ["--cd" as any]: `${c.cd}s`,
                    ["--ck" as any]: `${c.ck}s`,
                  } as React.CSSProperties
                }
              />
            ))}
          </div>
          <div className="absolute right-[15%] top-1/2 pointer-events-none">
            {confettiRight.map((c, i) => (
              <span
                key={`R${i}`}
                className="confetti-piece right"
                style={
                  {
                    background: c.color,
                    top: `${c.top}px`,
                    right: 0,
                    ["--cx" as any]: `${c.cx}px`,
                    ["--cy" as any]: `${c.cy}px`,
                    ["--cr" as any]: `${c.cr}deg`,
                    ["--cd" as any]: `${c.cd}s`,
                    ["--ck" as any]: `${c.ck}s`,
                  } as React.CSSProperties
                }
              />
            ))}
          </div>
        </>
      )}

      {/* 轮盘主体容器 */}
      <div className="relative w-[520px] max-w-[94vw] flex flex-col items-center">
        {/* 标题 */}
        <div className="mb-4 text-center">
          <div className="text-amber-400 text-[11px] tracking-[0.3em] font-extrabold uppercase flex items-center justify-center gap-1.5 opacity-90">
            <Sparkles className="w-3.5 h-3.5" />
            Cyber Roulette · 智能盲盒挑片机
          </div>
          <h2 className="mt-1 text-white text-2xl font-black drop-shadow-md">
            {phase === "revealed" ? "🎉 命运天选神作" : "今晚观影盲盒摇奖"}
          </h2>
        </div>

        {/* 盲盒奖池模式选择器 */}
        <div className="mb-4 flex items-center p-1 bg-white/10 backdrop-blur-md rounded-xl border border-white/15 gap-1">
          <button
            type="button"
            onClick={() => {
              setPoolMode("all");
              if (phase !== "spinning") spin();
            }}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1 ${
              poolMode === "all"
                ? "bg-amber-500 text-white shadow-sm"
                : "text-slate-300 hover:text-white"
            }`}
          >
            <Shuffle className="w-3 h-3" />
            全库盲盒 ({videos.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setPoolMode("favorites");
              if (phase !== "spinning") spin();
            }}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1 ${
              poolMode === "favorites"
                ? "bg-rose-500 text-white shadow-sm"
                : "text-slate-300 hover:text-white"
            }`}
          >
            <Heart className="w-3 h-3" />
            心动收藏 ({favorites?.size || 0})
          </button>
          <button
            type="button"
            onClick={() => {
              setPoolMode("unplayed");
              if (phase !== "spinning") spin();
            }}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1 ${
              poolMode === "unplayed"
                ? "bg-emerald-500 text-white shadow-sm"
                : "text-slate-300 hover:text-white"
            }`}
          >
            <Sparkles className="w-3 h-3" />
            未尝禁果 (0播放)
          </button>
          <button
            type="button"
            onClick={() => {
              setPoolMode("short");
              if (phase !== "spinning") spin();
            }}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1 ${
              poolMode === "short"
                ? "bg-sky-500 text-white shadow-sm"
                : "text-slate-300 hover:text-white"
            }`}
          >
            <Clock className="w-3 h-3" />
            短平快 (&lt;60m)
          </button>
        </div>

        {/* 轮盘展示舞台 */}
        <div className="relative w-[300px] h-[390px] flex items-center justify-center">
          {displayVideo ? (
            <div
              className={`relative rounded-2xl overflow-hidden border-2 transition-all duration-300 ${
                phase === "revealed"
                  ? "w-[280px] h-[380px] border-amber-400 shadow-[0_0_35px_rgba(245,158,11,0.5)] scale-100"
                  : "w-[260px] h-[350px] border-amber-500/50 opacity-90 scale-95 animate-pulse"
              }`}
            >
              {displayVideo.coverUrl ? (
                <img
                  src={displayVideo.coverUrl}
                  alt={displayVideo.name}
                  className="w-full h-full object-cover"
                  draggable={false}
                />
              ) : (
                <div className="w-full h-full bg-slate-900 flex flex-col items-center justify-center text-slate-500 gap-2">
                  <FileVideo className="w-12 h-12 opacity-40" />
                  <span className="text-[11px]">暂无海报</span>
                </div>
              )}

              {/* 顶部标签 */}
              <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between">
                <span className="text-[10px] font-mono font-bold bg-black/60 text-amber-400 px-2 py-0.5 rounded-md backdrop-blur-xs border border-amber-500/30">
                  {displayVideo.resolution || "1080P"}
                </span>
                {displayVideo.duration && (
                  <span className="text-[10px] font-mono font-bold bg-black/60 text-white px-2 py-0.5 rounded-md backdrop-blur-xs">
                    {displayVideo.duration}
                  </span>
                )}
              </div>

              {/* 底部信息遮罩 */}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/75 to-transparent p-3.5 pt-12">
                <div className="text-white text-xs font-bold leading-snug line-clamp-2">
                  {displayVideo.name}
                </div>
                <div className="flex items-center justify-between text-[10px] text-amber-300/80 mt-1.5 font-medium">
                  <span>{displayVideo.size || "--"}</span>
                  <span>播放 {displayVideo.playCount || 0} 次</span>
                </div>
              </div>

              {/* 滚动中特效遮罩 */}
              {phase === "spinning" && (
                <div className="absolute inset-0 bg-gradient-to-b from-amber-500/20 via-transparent to-amber-500/30 pointer-events-none flex items-center justify-center">
                  <Dices className="w-10 h-10 text-amber-400 animate-spin opacity-80" />
                </div>
              )}
            </div>
          ) : (
            <div className="text-slate-400 text-xs">暂无可抽取视频</div>
          )}
        </div>

        {/* 底部操作区 */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {phase === "revealed" && winner ? (
            <>
              {/* 重抽 */}
              <button
                type="button"
                onClick={spin}
                className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer border border-white/20 transition"
              >
                <RotateCw className="w-3.5 h-3.5" />
                再摇一次
              </button>

              {/* 正常从头播放 */}
              <button
                type="button"
                onClick={() => {
                  onPlay(winner, 0);
                  onClose();
                }}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer border border-slate-600 transition shadow-sm"
              >
                <Play className="w-3.5 h-3.5" />
                从头播放
              </button>

              {/* 直达高潮播放 */}
              <button
                type="button"
                onClick={() => {
                  const peakTime = getPeakHighlightSec(winner);
                  onPlay(winner, peakTime);
                  onClose();
                }}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-rose-500 to-amber-500 hover:from-rose-600 hover:to-amber-600 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-lg shadow-rose-500/30 transition hover:scale-105"
              >
                <Flame className="w-3.5 h-3.5 fill-current" />
                直达高潮播放
              </button>
            </>
          ) : (
            <div className="text-amber-300 text-xs font-bold flex items-center gap-2 bg-black/40 px-4 py-2 rounded-full border border-amber-500/30">
              <Dices className="w-4 h-4 animate-spin text-amber-400" />
              <span>命运飞轮极速翻牌中...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
