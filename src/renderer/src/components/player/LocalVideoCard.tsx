import React, { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import type { VideoItem } from "../../pages/player/types";

export const LocalVideoCard: React.FC<{
  video: VideoItem;
  isActive: boolean;
  onPlay: () => void;
  onDelete: () => void;
  index: number;
}> = ({ video, isActive, onPlay, onDelete, index }) => {
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
      onClick={onPlay}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      className={`rounded-lg border overflow-hidden cursor-pointer transition-all duration-200 group ${
        isActive
          ? "border-amber-400 bg-amber-50/50 shadow-sm ring-1 ring-amber-400/30"
          : "border-slate-200 bg-white hover:border-amber-300 hover:shadow-md hover:-translate-y-0.5"
      }`}
    >
      {/* THUMBNAIL / PREVIEW CONTAINER */}
      <div className="relative aspect-video bg-slate-900 overflow-hidden">
        {/* 序号角标 */}
        <span className="absolute top-1.5 right-1.5 z-10 text-[10px] bg-slate-800/80 text-white px-1.5 py-0.5 font-mono rounded backdrop-blur-sm font-bold">
          #{index + 1}
        </span>

        {video.coverUrl && (
          <img
            src={video.coverUrl}
            alt={video.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        )}

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
          <button
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            className="p-0.5 text-slate-300 hover:text-red-400 transition cursor-pointer opacity-0 group-hover:opacity-100"
            title="删除视频"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
};
