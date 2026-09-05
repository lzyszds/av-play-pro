import { ChevronDown, ChevronUp, Clapperboard, Play, Trash2, X } from "lucide-react";

export interface DirectorCutClip {
  id: string;
  videoName: string;
  videoUrl: string;
  currentTime: number;
  note?: string;
  createdAt?: string;
  clipDuration?: number;
}

interface Props {
  clips: DirectorCutClip[];
  coverByVideoUrl: Record<string, string | undefined>;
  activeIndex: number | null;
  onClose: () => void;
  onPlay: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
}

function formatTime(value: number): string {
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function DirectorCutDrawer({
  clips,
  coverByVideoUrl,
  activeIndex,
  onClose,
  onPlay,
  onMove,
  onRemove,
  onClear,
}: Props) {
  return (
    <div
      className="absolute inset-y-3 right-3 z-50 flex w-[340px] flex-col overflow-hidden rounded-xl border border-violet-400/30 bg-slate-950/95 shadow-2xl backdrop-blur-xl pointer-events-auto"
      onMouseMove={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-bold text-violet-100">
            <Clapperboard className="h-4 w-4 text-violet-300" />
            导演剪辑台
          </div>
          <p className="mt-0.5 text-[10px] text-slate-400">按顺序连播，每段约 20 秒</p>
        </div>
        <div className="flex items-center gap-2">
          {clips.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="text-[10px] text-slate-500 transition hover:text-rose-300"
            >
              清空
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭导演剪辑台"
            className="rounded p-1 text-slate-400 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {clips.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-10 text-center">
          <Clapperboard className="mb-3 h-9 w-9 text-violet-400/50" />
          <p className="text-xs font-medium text-slate-300">剪辑轨道还是空的</p>
          <p className="mt-2 text-[11px] leading-5 text-slate-500">
            在“跳转书签”中点 ✦，把任意影片的高光时间点加入这里。
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {clips.map((clip, index) => {
            const cover = coverByVideoUrl[clip.videoUrl];
            const isActive = activeIndex === index;
            return (
              <div
                key={clip.id}
                className={`group flex gap-2 rounded-lg border p-2 transition ${
                  isActive
                    ? "border-violet-400/70 bg-violet-500/15"
                    : "border-white/5 bg-white/[0.035] hover:border-white/15"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onPlay(index)}
                  aria-label={`播放第 ${index + 1} 段`}
                  className="relative h-12 w-16 shrink-0 overflow-hidden rounded-md bg-violet-950/70"
                >
                  {cover ? (
                    <img src={cover} alt="" className="h-full w-full object-cover opacity-75" />
                  ) : (
                    <Clapperboard className="m-auto h-full w-5 text-violet-300/60" />
                  )}
                  <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white opacity-0 transition group-hover:opacity-100">
                    <Play className="h-4 w-4 fill-current" />
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onPlay(index)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono text-violet-300">{String(index + 1).padStart(2, "0")}</span>
                    <span className="text-[11px] font-bold text-amber-300">{formatTime(clip.currentTime)}</span>
                    {isActive && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-300" />}
                  </div>
                  <p className="mt-1 truncate text-[11px] text-slate-200">{clip.videoName}</p>
                  {clip.note && <p className="truncate text-[10px] text-slate-500">{clip.note}</p>}
                </button>
                <div className="flex flex-col justify-center">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => onMove(index, -1)}
                    aria-label="上移片段"
                    className="rounded p-0.5 text-slate-500 hover:text-white disabled:opacity-20"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={index === clips.length - 1}
                    onClick={() => onMove(index, 1)}
                    aria-label="下移片段"
                    className="rounded p-0.5 text-slate-500 hover:text-white disabled:opacity-20"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(index)}
                    aria-label="移除片段"
                    className="mt-1 rounded p-0.5 text-slate-500 hover:text-rose-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {clips.length > 0 && (
        <div className="border-t border-white/10 p-3">
          <button
            type="button"
            onClick={() => onPlay(activeIndex == null ? 0 : activeIndex)}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-violet-500 py-2 text-xs font-bold text-white transition hover:bg-violet-400"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            {activeIndex == null ? "从头放映剪辑" : "继续放映剪辑"}
          </button>
        </div>
      )}
    </div>
  );
}
