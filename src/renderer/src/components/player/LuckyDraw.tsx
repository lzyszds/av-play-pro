import React, { useEffect, useMemo, useRef, useState } from "react";
import { Gift, Play, RotateCw, X, FileVideo } from "lucide-react";
import type { VideoItem } from "../../pages/player/types";

type Phase = "shaking" | "rolling" | "revealed";

interface Props {
  videos: VideoItem[];
  onClose: () => void;
  onPlay: (video: VideoItem) => void;
}

const COLORS = [
  "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6",
  "#3b82f6", "#10b981", "#f97316", "#eab308",
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
      cr: (Math.random() * 720 - 360),
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

export function LuckyDraw({ videos, onClose, onPlay }: Props) {
  const [phase, setPhase] = useState<Phase>("shaking");
  const [rollIdx, setRollIdx] = useState(0);
  const [winner, setWinner] = useState<VideoItem | null>(null);
  const timersRef = useRef<number[]>([]);

  const confettiLeft = useMemo(() => genConfetti(18), []);
  const confettiRight = useMemo(() => genConfetti(18), []);

  const start = () => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current.forEach((t) => window.clearInterval(t));
    timersRef.current = [];
    setPhase("shaking");
    setWinner(null);

    // 阶段 1: 礼盒摇晃 800ms
    const t1 = window.setTimeout(() => {
      setPhase("rolling");
      // 阶段 2: 快速翻牌 ~1.4s
      const roll = window.setInterval(() => {
        setRollIdx((i) => (i + 1) % Math.max(videos.length, 1));
      }, 80);
      timersRef.current.push(roll);

      const t2 = window.setTimeout(() => {
        window.clearInterval(roll);
        const w = pickRandom(videos);
        setWinner(w);
        setPhase("revealed");
      }, 1400);
      timersRef.current.push(t2);
    }, 800);
    timersRef.current.push(t1);
  };

  useEffect(() => {
    if (videos.length === 0) return;
    start();
    return () => {
      timersRef.current.forEach((t) => {
        window.clearTimeout(t);
        window.clearInterval(t);
      });
      timersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rollingVideo = videos[rollIdx % Math.max(videos.length, 1)];
  const displayVideo = winner ?? rollingVideo;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md anim-fade-in overflow-hidden"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* 关闭 */}
      <button
        onClick={onClose}
        className="absolute top-5 right-5 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer transition"
      >
        <X className="w-4 h-4" />
      </button>

      {/* 礼花 - 左 */}
      <div className="absolute left-[18%] top-1/2 pointer-events-none">
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
      {/* 礼花 - 右 */}
      <div className="absolute right-[18%] top-1/2 pointer-events-none">
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

      {/* 主体 */}
      <div className="relative w-[480px] max-w-[92vw] flex flex-col items-center select-none">
        {/* 标题 */}
        <div className="mb-6 text-center">
          <div className="text-amber-300 text-[11px] tracking-[0.3em] font-bold uppercase opacity-80">
            Lucky Draw
          </div>
          <div className="mt-1 text-white text-xl font-bold drop-shadow-lg">
            {phase === "revealed" ? "🎉 恭喜抽中" : "今晚看什么？"}
          </div>
        </div>

        {/* 舞台 */}
        <div className="relative w-[320px] h-[380px] flex items-center justify-center">
          {/* 礼盒（摇晃 → 翻盖飞出） */}
          {phase !== "revealed" && (
            <div
              className={`relative ${phase === "shaking" ? "lucky-shake" : "lucky-box-fall"}`}
              style={{ width: 220, height: 220 }}
            >
              {/* 盒身 */}
              <div
                className="absolute left-0 right-0 bottom-0 rounded-b-xl rounded-t-md"
                style={{
                  height: 150,
                  background:
                    "linear-gradient(180deg,#dc2626 0%,#b91c1c 60%,#7f1d1d 100%)",
                  boxShadow:
                    "inset 0 -6px 0 rgba(0,0,0,0.25), 0 14px 30px -10px rgba(220,38,38,0.6)",
                }}
              />
              {/* 盒身纵向丝带 */}
              <div
                className="absolute bottom-0"
                style={{
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: 30,
                  height: 150,
                  background:
                    "linear-gradient(180deg,#fde047,#facc15 50%,#ca8a04)",
                  boxShadow: "0 0 8px rgba(250,204,21,0.6)",
                }}
              />
              {/* 盖子 */}
              <div
                className={`absolute left-[-10px] right-[-10px] ${phase === "rolling" ? "lucky-lid-fly" : ""}`}
                style={{ top: 40, height: 56 }}
              >
                <div
                  className="w-full h-full rounded-md relative"
                  style={{
                    background:
                      "linear-gradient(180deg,#ef4444 0%,#dc2626 100%)",
                    boxShadow:
                      "0 6px 14px -4px rgba(0,0,0,0.4), inset 0 -4px 0 rgba(0,0,0,0.18)",
                  }}
                >
                  {/* 蝴蝶结 */}
                  <div
                    className="absolute left-1/2 -translate-x-1/2 -top-7 w-16 h-10"
                    style={{
                      background:
                        "radial-gradient(circle at 30% 50%, #fde047 0 22%, transparent 23%), radial-gradient(circle at 70% 50%, #fde047 0 22%, transparent 23%), linear-gradient(180deg,#facc15,#ca8a04)",
                      borderRadius: "50% 50% 50% 50% / 60% 60% 40% 40%",
                      boxShadow: "0 4px 10px -4px rgba(0,0,0,0.4)",
                    }}
                  />
                  {/* 盖子横向丝带 */}
                  <div
                    className="absolute top-0 bottom-0"
                    style={{
                      left: "50%",
                      transform: "translateX(-50%)",
                      width: 30,
                      background:
                        "linear-gradient(180deg,#fde047,#facc15,#ca8a04)",
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* 揭晓后的封面 */}
          {phase === "revealed" && displayVideo && (
            <div className="lucky-reveal relative">
              <div className="lucky-glow rounded-2xl">
                <div className="w-[260px] h-[360px] rounded-2xl overflow-hidden bg-slate-900 border-2 border-amber-300/70 relative">
                  {displayVideo.coverUrl ? (
                    <img
                      src={displayVideo.coverUrl}
                      alt={displayVideo.name}
                      className="w-full h-full object-cover"
                      draggable={false}
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 gap-2">
                      <FileVideo className="w-12 h-12 opacity-40" />
                      <span className="text-[11px]">无封面</span>
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-3 pt-10">
                    <div className="text-white text-[12px] font-bold leading-snug line-clamp-2">
                      {displayVideo.name}
                    </div>
                    <div className="text-amber-300/80 text-[10px] mt-1 font-mono">
                      {displayVideo.resolution || "--"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* rolling 阶段的小预览缩略图（盒子下方） */}
          {phase === "rolling" && displayVideo?.coverUrl && (
            <div className="absolute bottom-[-30px] left-1/2 -translate-x-1/2 w-14 h-20 rounded overflow-hidden border border-amber-400/60 shadow-lg opacity-90">
              <img
                src={displayVideo.coverUrl}
                alt=""
                className="w-full h-full object-cover"
              />
            </div>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="mt-8 flex items-center gap-3">
          {phase === "revealed" && winner ? (
            <>
              <button
                onClick={start}
                className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer border border-white/20 transition"
              >
                <RotateCw className="w-3.5 h-3.5" />
                再抽一次
              </button>
              <button
                onClick={() => {
                  onPlay(winner);
                  onClose();
                }}
                className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-lg shadow-amber-500/40 transition"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                立即播放
              </button>
            </>
          ) : (
            <div className="text-amber-200/70 text-[11px] flex items-center gap-2">
              <Gift className="w-3.5 h-3.5" />
              {phase === "shaking" ? "礼盒躁动中..." : "命运正在翻牌..."}
            </div>
          )}
        </div>

        {videos.length === 0 && (
          <div className="mt-4 text-white/70 text-xs">本地视频库为空</div>
        )}
      </div>
    </div>
  );
}
