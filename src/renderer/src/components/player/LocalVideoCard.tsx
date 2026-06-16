import React, { useRef, useState, memo } from "react";
import { Trash2, Wrench, Heart } from "lucide-react";
import type { VideoItem } from "../../pages/player/types";
import { CoverImage } from "../CoverImage";

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
}) => {
  const [hovered, setHovered] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);

  const handleEnter = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    // 延迟挂载，避免快速划过时频繁加载预览
    hoverTimer.current = setTimeout(() => setHovered(true), 250);
  };

  const handleLeave = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHovered(false);
  };

  const handlePreviewReady = () => {
    previewRef.current?.play().catch(() => {});
  };

  return (
    <div
      onClick={() => onPlay(video, index)}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      className={`rounded-lg border overflow-hidden cursor-pointer transition-all duration-200 group ${
        isActive
          ? "border-amber-400 bg-amber-50/50 shadow-sm ring-1 ring-amber-400/30"
          : "border-slate-200 bg-white hover:border-amber-300 hover:shadow-md hover:-translate-y-0.5"
      }`}
    >
      {/* THUMBNAIL / PREVIEW CONTAINER */}
      <div
        className="relative aspect-video bg-slate-900 overflow-hidden"
        style={{ transform: "translateZ(0)" }}
      >
        {/* 序号角标 */}
        <span className="absolute top-1.5 right-1.5 z-10 text-[10px] bg-slate-800/80 text-white px-1.5 py-0.5 font-mono rounded backdrop-blur-sm font-bold">
          #{index + 1}
        </span>

        <CoverImage src={video.coverUrl} alt={video.name} logoSize={48} />

        {/* HOVER PREVIEW OVERLAY */}
        {hovered && video.previewUrl && (
          <video
            ref={previewRef}
            src={video.previewUrl}
            muted
            loop
            playsInline
            preload="auto"
            onLoadedData={handlePreviewReady}
            className="absolute inset-0 w-full h-full object-cover bg-black animate-[fadeIn_0.3s_ease]"
          />
        )}

        {/* 收藏标记（已收藏时常驻显示在缩略图左上角） */}
        {isFavorite && !isActive && (
          <span
            className="absolute top-1.5 left-1.5 z-10 inline-flex items-center justify-center w-5 h-5 rounded-full bg-rose-500/90 text-white backdrop-blur-sm shadow"
            title="已加入心爱"
          >
            <Heart className="w-3 h-3 fill-current" />
          </span>
        )}

        {/* 正在播放标记 */}
        {isActive && (
          <span className="absolute top-1.5 left-1.5 z-10 inline-flex items-center gap-1 text-[9px] bg-amber-500/90 text-white px-1.5 py-0.5 rounded font-mono font-bold backdrop-blur-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-900 animate-pulse"></span>
            播放中
          </span>
        )}
      </div>

      {/* INFO */}
      <div className="p-2.5">
        <span
          className={`font-bold block truncate text-[11px] ${isActive ? "text-amber-700" : "text-slate-800"}`}
          title={video.name}
        >
          {video.name}
        </span>
        <div className="flex items-center justify-between mt-1">
          <div className="flex items-center gap-2 text-[9px] font-mono text-slate-400">
            {video.size && <span>{video.size}</span>}
          </div>
          <div className="flex items-center gap-1 transition">
            {onToggleFavorite && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavorite(video);
                }}
                className={`p-0.5 transition cursor-pointer ${
                  isFavorite
                    ? "text-rose-500 hover:text-rose-600"
                    : "text-slate-300 hover:text-rose-400 opacity-0 group-hover:opacity-100"
                }`}
                title={isFavorite ? "取消心爱" : "加入心爱"}
              >
                <Heart
                  className={`w-3 h-3 ${isFavorite ? "fill-current" : ""}`}
                />
              </button>
            )}
            {onRepair && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRepair(video);
                }}
                className="p-0.5 text-slate-300 hover:text-amber-500 transition cursor-pointer opacity-0 group-hover:opacity-100"
                title="修复此视频（封面/预览/字幕/刻度图）"
              >
                <Wrench className="w-3 h-3" />
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(video);
              }}
              className="p-0.5 text-slate-300 hover:text-red-400 transition cursor-pointer opacity-0 group-hover:opacity-100"
              title="删除视频"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// 用 memo 包一层：滚动时父组件高频重渲染，未变化的卡片直接 skip，避免 CoverImage 等子树反复 reconcile
export const LocalVideoCard = memo(LocalVideoCardImpl);
