import React from "react";
import { Moon, Play, RefreshCcw, Star } from "lucide-react";
import type { VideoItem } from "../../pages/player/types";

interface Props {
  items: VideoItem[];
  onPlay: (v: VideoItem) => void;
  onReshuffle?: () => void;
}

function encodeMediaUrl(absPath?: string): string | undefined {
  if (!absPath) return undefined;
  const normalized = absPath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const head = parts.shift() || "";
  return `local-media:///${[head, ...parts.map((p) => encodeURIComponent(p))].join("/")}`;
}

export const TonightPanel: React.FC<Props> = ({ items, onPlay, onReshuffle }) => {
  if (items.length === 0) return null;
  return (
    <div className="p-3 bg-gradient-to-br from-indigo-50 via-white to-amber-50 border border-amber-200/60 rounded-xl shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-indigo-600">
          <Moon className="w-3.5 h-3.5" />
          今晚推荐 · {items.length} 部
        </div>
        {onReshuffle && (
          <button
            onClick={onReshuffle}
            title="重新生成"
            className="text-[10px] text-slate-500 hover:text-amber-600 cursor-pointer inline-flex items-center gap-0.5"
          >
            <RefreshCcw className="w-3 h-3" />
            换一批
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {items.map((v) => (
          <button
            key={v.id}
            onClick={() => onPlay(v)}
            className="group text-left rounded-lg overflow-hidden border border-slate-200 bg-white hover:border-amber-400 hover:shadow-md transition cursor-pointer"
            title={v.title || v.name}
          >
            <div className="relative aspect-video bg-slate-900">
              {v.coverUrl ? (
                <img
                  src={encodeMediaUrl(v.coverUrl)}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : null}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition" />
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                <div className="w-8 h-8 rounded-full bg-white/15 backdrop-blur-md ring-1 ring-white/30 flex items-center justify-center">
                  <Play className="w-3 h-3 text-white fill-white ml-0.5" />
                </div>
              </div>
              {typeof v.rating === "number" && v.rating > 0 && (
                <span className="absolute top-1 right-1 inline-flex items-center gap-0.5 text-[9px] bg-amber-400/95 text-slate-900 px-1.5 py-0.5 rounded font-extrabold">
                  <Star className="w-2 h-2 fill-current" />
                  {v.rating.toFixed(1)}
                </span>
              )}
              {v.code && (
                <span className="absolute bottom-1 left-1 text-[9px] font-mono bg-black/55 text-white px-1.5 py-0.5 rounded">
                  {v.code}
                </span>
              )}
            </div>
            <div className="px-1.5 py-1">
              <div className="text-[10.5px] font-semibold text-slate-800 truncate">
                {v.title || v.name}
              </div>
              {v.actors && v.actors.length > 0 && (
                <div className="text-[9.5px] text-slate-500 truncate">
                  {v.actors.join(" · ")}
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
