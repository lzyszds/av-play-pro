import React, { useRef, useState, memo } from "react";
import { createPortal } from "react-dom";
import {
  Trash2,
  Wrench,
  Heart,
  Edit3,
  Globe,
  Star,
  Calendar,
  Clock,
  Building2,
  User2,
  Film,
  Tag,
  Play,
  MoreHorizontal,
} from "lucide-react";
import type { VideoItem } from "../../pages/player/types";
import { CoverImage } from "../CoverImage";
import { Tooltip } from "../common/Tooltip";

interface LocalVideoCardProps {
  video: VideoItem;
  isActive: boolean;
  // 稳定的回调签名：在父组件中用 useCallback 包装一次即可，避免每次滚动新建闭包导致 memo 失效
  onPlay: (video: VideoItem, index: number) => void;
  onDelete: (video: VideoItem) => void;
  onRepair?: (video: VideoItem) => void;
  isFavorite?: boolean;
  onToggleFavorite?: (video: VideoItem) => void;
  index: number;
  /** 封面变形虫：hot=发光（近 30 天 ≥3 次）/ cold=褪色（>60 天未看或从未） */
  heat?: "hot" | "cold" | "normal";
  /** 点击演员名跳转到「演员」页详情 */
  onOpenActor?: (name: string) => void;
}

const LocalVideoCardImpl: React.FC<LocalVideoCardProps> = ({
  video,
  isActive,
  onPlay,
  onDelete,
  onRepair,
  isFavorite,
  onToggleFavorite,
  index,
  heat = "normal",
  onOpenActor,
}) => {
  const [hovered, setHovered] = useState(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [previewProgress, setPreviewProgress] = useState(0);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const previewStartRef = useRef<number>(0);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuTokenRef = useRef(
    `${video.id || video.name}-${Math.random().toString(36).slice(2)}`,
  );

  const previewSrc = video.previewUrl || video.url;

  const handleEnter = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    // 延迟 220ms 挂载，避免列表快速划过时频繁解码
    hoverTimer.current = setTimeout(() => {
      setHovered(true);
    }, 220);
  };

  const handleLeave = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHovered(false);
    setIsPreviewPlaying(false);
    setPreviewProgress(0);
    if (previewRef.current) {
      try {
        previewRef.current.pause();
      } catch {
        /* ignore */
      }
    }
  };

  const handlePreviewReady = () => {
    const el = previewRef.current;
    if (!el) return;
    if (!video.previewUrl && el.duration > 30) {
      // 本地无专属 preview 文件的视频，截取正片 22% 处（黄金剧情段）
      const start = Math.min(Math.floor(el.duration * 0.22), 300);
      previewStartRef.current = start;
      el.currentTime = start;
    }
    el.play()
      .then(() => setIsPreviewPlaying(true))
      .catch(() => setIsPreviewPlaying(false));
  };

  const handlePreviewTimeUpdate = () => {
    const el = previewRef.current;
    if (!el) return;
    if (video.previewUrl) {
      if (el.duration > 0) {
        setPreviewProgress((el.currentTime / el.duration) * 100);
      }
    } else {
      const start = previewStartRef.current;
      const elapsed = el.currentTime - start;
      const loopDuration = 5.0; // 5 秒精彩循环切片
      if (elapsed >= loopDuration || el.currentTime < start) {
        el.currentTime = start;
        setPreviewProgress(0);
      } else {
        setPreviewProgress(Math.max(0, Math.min(100, (elapsed / loopDuration) * 100)));
      }
    }
  };

  React.useEffect(() => {
    if (!menu) return;
    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      if (menuRef.current?.contains(event.target as Node)) return;
      setMenu(null);
    };
    const onScroll = () => {
      setMenu(null);
    };
    const closeFromOtherCard = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (detail !== menuTokenRef.current) setMenu(null);
    };
    window.addEventListener("local-video-card-menu-open", closeFromOtherCard);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("mousedown", onMouseDown);
    window.dispatchEvent(
      new CustomEvent("local-video-card-menu-open", {
        detail: menuTokenRef.current,
      }),
    );
    return () => {
      window.removeEventListener("local-video-card-menu-open", closeFromOtherCard);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [menu]);

  const copyText = (text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => {});
    setMenu(null);
  };

  const openMenu = (x: number, y: number) => {
    setMenu({
      x: Math.max(8, Math.min(x, window.innerWidth - 176)),
      y: Math.max(8, Math.min(y, window.innerHeight - 220)),
    });
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    openMenu(e.clientX, e.clientY);
  };

  return (
    <div
      onClick={() => {
        if (menu) return;
        onPlay(video, index);
      }}
      onContextMenuCapture={handleContextMenu}
      onContextMenu={handleContextMenu}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      className={`relative rounded-xl overflow-hidden cursor-pointer transition-all duration-300 group bg-white border ${
        isActive
          ? "border-amber-400 shadow-[0_0_0_2px_rgba(251,191,36,0.15),0_10px_30px_-12px_rgba(245,158,11,0.35)]"
          : "border-slate-200 hover:border-slate-300 hover:shadow-[0_10px_30px_-14px_rgba(15,23,42,0.35)] hover:-translate-y-0.5"
      } ${heat === "hot" && !isActive ? "cover-hot" : ""} ${heat === "cold" ? "cover-cold" : ""}`}
    >
      {/* ===== 封面（承担主要视觉信息） ===== */}
      <div
        className="relative aspect-video bg-slate-900 overflow-hidden cover-media cover-media-hover"
        style={{ transform: "translateZ(0)" }}
      >
        <CoverImage src={video.coverUrl} alt={video.name} logoSize={48} />

        {hovered && previewSrc && (
          <video
            ref={previewRef}
            src={previewSrc}
            muted
            loop={!!video.previewUrl}
            playsInline
            preload="auto"
            onLoadedData={handlePreviewReady}
            onTimeUpdate={handlePreviewTimeUpdate}
            onError={() => setIsPreviewPlaying(false)}
            className={`absolute inset-0 w-full h-full object-cover bg-black transition-opacity duration-300 ${
              isPreviewPlaying ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
          />
        )}

        {/* 微动视频播放状态条与徽标 */}
        {isPreviewPlaying && (
          <>
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/60 z-20 overflow-hidden pointer-events-none">
              <div
                className="h-full bg-gradient-to-r from-amber-400 via-rose-500 to-amber-300 transition-all duration-100 ease-linear shadow-[0_0_8px_rgba(245,158,11,0.8)]"
                style={{ width: `${previewProgress}%` }}
              />
            </div>
            <div className="absolute top-9 left-2 z-20 pointer-events-none animate-in fade-in zoom-in-95">
              <span className="inline-flex items-center gap-1 text-[9px] bg-black/80 text-amber-300 px-1.5 py-0.5 rounded font-mono font-bold tracking-wider backdrop-blur-md ring-1 ring-amber-400/40 shadow-lg">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                PREVIEW
              </span>
            </div>
          </>
        )}

        {/* 顶部渐变 */}
        <div className="absolute top-0 left-0 right-0 h-14 bg-gradient-to-b from-black/55 to-transparent pointer-events-none z-0" />

        {/* —— 顶部行：左 状态/番号 / 右 评分+序号 —— */}
        <div className="absolute top-2 left-2 right-2 z-10 flex items-start justify-between gap-1 pointer-events-none">
          <div className="flex items-center gap-1 min-w-0">
            {isActive ? (
              <span className="inline-flex items-center gap-1 text-[9px] bg-amber-400/95 text-slate-900 px-2 py-0.5 rounded-full font-bold backdrop-blur-md shadow-md shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-900 animate-pulse"></span>
                正在播放
              </span>
            ) : isFavorite ? (
              <span
                className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-white/90 text-amber-500 backdrop-blur-md shadow shrink-0"
                title="已加入心爱"
              >
                <Heart className="w-3 h-3 fill-current" />
              </span>
            ) : null}
            {video.code && (
              <span className="text-[10.5px] bg-white/15 text-white px-2 py-0.5 font-mono rounded backdrop-blur-md font-bold tracking-wider ring-1 ring-white/20 truncate">
                {video.code}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {typeof video.rating === "number" && video.rating > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[11px] bg-amber-400/95 text-slate-900 px-1.5 py-0.5 rounded backdrop-blur-md font-extrabold shadow">
                <Star className="w-2.5 h-2.5 fill-current" />
                {video.rating.toFixed(1)}
              </span>
            )}
            <span className="text-[9px] text-white/70 px-1 font-mono">
              #{index + 1}
            </span>
          </div>
        </div>

        {/* —— 底部信息条 (图片内仅保留发行商和大小，时间移至最下方) —— */}
        {(video.studio || video.size) && (
          <>
            <div className="absolute bottom-0 left-0 right-0 h-14 bg-gradient-to-t from-black/70 to-transparent pointer-events-none" />
            <div className="absolute bottom-2 left-2 right-2 z-10 flex items-end justify-between gap-2 text-white/95 text-[10px] pointer-events-none">
              <div className="flex items-center gap-2 min-w-0">
                {video.studio && (
                  <span
                    className="inline-flex items-center gap-0.5 truncate opacity-80"
                    title={video.studio}
                  >
                    <Building2 className="w-2.5 h-2.5 shrink-0" />
                    <span className="truncate">{video.studio}</span>
                  </span>
                )}
              </div>
              {video.size && (
                <span className="font-mono opacity-70 shrink-0">
                  {video.size}
                </span>
              )}
            </div>
          </>
        )}

        {/* 中央播放按钮（hover 渐显） */}
        {!hovered && !isActive && (
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-[5]">
            <div className="w-11 h-11 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center ring-1 ring-white/30">
              <Play className="w-4 h-4 text-white fill-white ml-0.5" />
            </div>
          </div>
        )}
      </div>

      {/* ===== 信息区（克制配色：冷灰主色 + 单一暖金强调） ===== */}
      <div className="px-3 pt-2.5 pb-3 space-y-1.5">
        {/* 标题 */}
        <div
          className={`font-semibold text-xs leading-snug line-clamp-2 tracking-tight truncate ${
            isActive ? "text-amber-700" : "text-slate-900"
          }`}
          title={video.title || video.name}
        >
          {video.title || video.name}
        </div>

        {/* 演员（克制：单色） */}
        {video.actors && video.actors.length > 0 && (
          <div className="flex items-center gap-1.5 pt-0.5 min-w-0">
            <User2 className="w-3 h-3 text-slate-400 shrink-0" />
            <div
              className="text-[10.5px] text-slate-700 truncate flex items-center gap-1"
              title={video.actors.join(" / ")}
            >
              {video.actors.map((a, i) => (
                <React.Fragment key={a}>
                  {i > 0 && <span className="text-slate-300">·</span>}
                  <span
                    onClick={(e) => {
                      if (!onOpenActor) return;
                      e.stopPropagation();
                      onOpenActor(a);
                    }}
                    className={
                      onOpenActor
                        ? "cursor-pointer hover:text-amber-600 hover:underline"
                        : ""
                    }
                  >
                    {a}
                  </span>
                </React.Fragment>
              ))}
            </div>
          </div>
        )}

        {/* 分类：单行 + hover 时自动滚动；可手动滑 */}
        {video.genres && video.genres.length > 0 && (
          <GenreMarquee genres={video.genres} hovered={hovered} />
        )}

        {/* 底栏：时间 + 操作按钮 */}
        <div className="pt-1.5 mt-0.5 border-t border-slate-100 flex items-center justify-between gap-2 text-[9.5px] text-slate-500">
          <span className="flex items-center gap-0.5 shrink-0">
            {video.duration ? (
              <>
                <Clock className="w-2.5 h-2.5 -mt-0.25" />
                <span className="text-[10px] font-mono text-slate-400" title={video.duration}>
                  {((): string => {
                    const m = parseInt(
                      (video.duration || "").replace(/[^\d]/g, ""),
                      10,
                    );
                    if (!Number.isFinite(m) || m <= 0) return "—";
                    const hours = Math.floor(m / 60);
                    const mins = m % 60;
                    if (hours > 0) {
                      return `${hours}小时${mins}分钟`;
                    }
                    return `${m}分钟`;
                  })()}
                </span>
              </>
            ) : (
              <span className="text-slate-300">—</span>
            )}
          </span>
          <div className="flex items-center gap-0.5 shrink-0">
            {onToggleFavorite && (
              <CardIconBtn
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavorite(video);
                }}
                title={isFavorite ? "取消心爱" : "加入心爱"}
              >
                <Heart
                  className={`w-3.5 h-3.5 ${isFavorite ? "fill-amber-500 text-amber-500" : ""}`}
                />
              </CardIconBtn>
            )}
            {onRepair && (
              <CardIconBtn
                onClick={(e) => {
                  e.stopPropagation();
                  onRepair(video);
                }}
                title="修复（联网刮削/重命名/封面/字幕在此）"
              >
                <Wrench className="w-3.5 h-3.5" />
              </CardIconBtn>
            )}
            <CardIconBtn
              onClick={(e) => {
                e.stopPropagation();
                onDelete(video);
              }}
              title="删除"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </CardIconBtn>
            <CardIconBtn
              onClick={(e) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                openMenu(rect.right - 4, rect.bottom + 6);
              }}
              title="更多操作"
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </CardIconBtn>
          </div>
        </div>
      </div>
      {menu &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[9999] w-40 rounded-lg border border-slate-200 bg-white shadow-xl shadow-slate-900/15 py-1 text-[11px] text-slate-600"
            style={{ left: menu.x, top: menu.y }}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <ContextItem label="播放" onClick={() => { setMenu(null); onPlay(video, index); }} />
            {onToggleFavorite && (
              <ContextItem label={isFavorite ? "取消心爱" : "加入心爱"} onClick={() => { setMenu(null); onToggleFavorite(video); }} />
            )}
            {onRepair && <ContextItem label="修复/补资料" onClick={() => { setMenu(null); onRepair(video); }} />}
            <ContextItem label="复制名称" onClick={() => copyText(video.name)} />
            {video.code && <ContextItem label="复制番号" onClick={() => copyText(video.code!)} />}
            <div className="my-1 h-px bg-slate-100" />
            <ContextItem label="删除" danger onClick={() => { setMenu(null); onDelete(video); }} />
          </div>,
          document.body,
        )}
    </div>
  );
};

const ContextItem: React.FC<{
  label: string;
  onClick: () => void;
  danger?: boolean;
}> = ({ label, onClick, danger }) => (
  <button
    type="button"
    onMouseDown={(e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    }}
    onClick={(e) => {
      e.preventDefault();
      e.stopPropagation();
    }}
    className={`w-full text-left px-3 py-1.5 hover:bg-slate-50 transition cursor-pointer ${
      danger ? "text-rose-500 hover:bg-rose-50" : ""
    }`}
  >
    {label}
  </button>
);

const CardIconBtn: React.FC<{
  onClick: (e: React.MouseEvent) => void;
  title: string;
  children: React.ReactNode;
}> = ({ onClick, title, children }) => (
  <Tooltip content={title} placement="top" delay={150}>
    <button
      onClick={onClick}
      className="p-1.5 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition cursor-pointer"
    >
      {children}
    </button>
  </Tooltip>
);

/**
 * 分类标签单行展示。
 * - 内容超出容器时可横向手动滑动（隐藏滚动条）
 * - 鼠标进入卡片后，自动 rAF 滚到末尾；离开回到起点
 * - 拖拽滑动时，自动暂停自动滚动
 */
const GenreMarquee: React.FC<{ genres: string[]; hovered: boolean }> = ({
  genres,
  hovered,
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartX = useRef(0);
  const dragStartScroll = useRef(0);
  const [cursor, setCursor] = useState<"default" | "grabbing">("default");

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const max = el.scrollWidth - el.clientWidth;
    if (max <= 0) return;

    if (hovered && !isDraggingRef.current) {
      // 先停留 50ms 再滚
      const startDelay = 50;
      const speed = 60;
      const duration = (max / speed) * 1000;
      const startTs = performance.now() + startDelay;

      const tick = (now: number) => {
        if (isDraggingRef.current) return;
        if (now < startTs) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        const elapsed = now - startTs;
        const ratio = Math.min(1, elapsed / duration);
        el.scrollLeft = max * ratio;
        if (ratio < 1) rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } else if (!isDraggingRef.current) {
      // 平滑回到起点
      const from = el.scrollLeft;
      const startTs = performance.now();
      const backDur = 300;
      const tick = (now: number) => {
        if (isDraggingRef.current) return;
        const t = Math.min(1, (now - startTs) / backDur);
        const eased = 1 - Math.pow(1 - t, 3);
        el.scrollLeft = from * (1 - eased);
        if (t < 1) rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [hovered, genres]);

  const onMouseDown = (e: React.MouseEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    isDraggingRef.current = true;
    dragStartX.current = e.clientX;
    dragStartScroll.current = el.scrollLeft;
    setCursor("grabbing");
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  React.useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const el = scrollRef.current;
      if (!el) return;
      const dx = e.clientX - dragStartX.current;
      el.scrollLeft = dragStartScroll.current - dx;
    };
    const onUp = () => {
      isDraggingRef.current = false;
      setCursor("default");
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  return (
    <div
      ref={scrollRef}
      className="overflow-x-auto scrollbar-hide whitespace-nowrap select-none px-1"
      style={{
        cursor: cursor === "grabbing" ? "grabbing" : "grab",
        maskImage:
          "linear-gradient(to right, transparent 0, black 8px, black calc(100% - 16px), transparent 100%)",
        WebkitMaskImage:
          "linear-gradient(to right, transparent 0, black 8px, black calc(100% - 16px), transparent 100%)",
      }}
      onMouseDown={onMouseDown}
      onWheel={(e) => {
        // 让滚轮可以横向滚（按 shift 自动横向；裸滚轮拦截后转横向）
        if (e.deltaY !== 0 && scrollRef.current) {
          scrollRef.current.scrollLeft += e.deltaY;
        }
      }}
    >
      <div className="inline-flex items-center gap-1.5">
        {genres.map((g) => (
          <span
            key={g}
            className="inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] bg-slate-100 text-slate-700 border border-slate-200 font-medium shrink-0"
          >
            {g}
          </span>
        ))}
      </div>
    </div>
  );
};

// 用 memo 包一层：滚动时父组件高频重渲染，未变化的卡片直接 skip，避免 CoverImage 等子树反复 reconcile
export const LocalVideoCard = memo(LocalVideoCardImpl);
