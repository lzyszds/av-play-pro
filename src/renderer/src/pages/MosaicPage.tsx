import React, { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "../lib/trpc";
import { PageLoader } from "../components/PageLoader";
import { Tooltip } from "../components/common/Tooltip";
import { Grid3X3, Play, Pause, X, Plus } from "lucide-react";

interface Props {
  videoPath: string;
  onAddSystemLog: (text: string, level: "INFO" | "WARNING" | "SUCCESS" | "ERROR") => void;
}

interface VideoSlot {
  id: string;
  name: string;
  url: string;
  coverUrl?: string;
}

function encodeMediaUrl(filePath: string): string {
  if (!filePath || filePath.includes("://")) return filePath;
  const normalized = filePath.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const encoded = segments.map((s, i) =>
    i === 0 && /^[a-zA-Z]:$/.test(s) ? s : encodeURIComponent(s),
  );
  return `local-media:///${encoded.join("/")}`;
}

const GRID_LAYOUTS = [
  { cols: 2, rows: 2, label: "2×2" },
  { cols: 3, rows: 2, label: "3×2" },
  { cols: 3, rows: 3, label: "3×3" },
  { cols: 4, rows: 3, label: "4×3" },
];

export function MosaicPage({ videoPath, onAddSystemLog }: Props) {
  const [videos, setVideos] = useState<VideoSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [slots, setSlots] = useState<(VideoSlot | null)[]>(Array(4).fill(null));
  const [layout, setLayout] = useState(GRID_LAYOUTS[0]);
  const [playing, setPlaying] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [pickingSlot, setPickingSlot] = useState<number | null>(null);
  const videoRefs = useRef<Map<number, HTMLVideoElement>>(new Map());

  useEffect(() => {
    if (!videoPath) return;
    setLoading(true);
    (async () => {
      try {
        const raw: any[] = await trpc.videos.list.query({ path: videoPath });
        const slots: VideoSlot[] = raw.map((v: any) => ({
          id: v.id,
          name: v.name,
          url: encodeMediaUrl(v.url),
          coverUrl: v.coverUrl ? encodeMediaUrl(v.coverUrl) : undefined,
        }));
        setVideos(slots);
        onAddSystemLog(`马赛克墙加载完成：${slots.length} 部可用`, "SUCCESS");
      } catch (err: any) {
        onAddSystemLog(`加载失败: ${err?.message}`, "ERROR");
      } finally {
        setLoading(false);
      }
    })();
  }, [videoPath]);

  useEffect(() => {
    const totalSlots = layout.cols * layout.rows;
    setSlots((prev) => {
      const next = [...prev];
      while (next.length < totalSlots) next.push(null);
      return next.slice(0, totalSlots);
    });
  }, [layout]);

  const assignVideo = (slotIndex: number, video: VideoSlot) => {
    setSlots((prev) => {
      const next = [...prev];
      next[slotIndex] = video;
      return next;
    });
    setShowPicker(false);
    setPickingSlot(null);
  };

  const removeVideo = (slotIndex: number) => {
    setSlots((prev) => {
      const next = [...prev];
      next[slotIndex] = null;
      return next;
    });
  };

  const togglePlayAll = () => {
    if (playing) {
      videoRefs.current.forEach((el) => { try { el.pause(); } catch {} });
      setPlaying(false);
    } else {
      videoRefs.current.forEach((el) => { try { el.play(); } catch {} });
      setPlaying(true);
    }
  };

  const setVideoRef = (index: number, el: HTMLVideoElement | null) => {
    if (el) videoRefs.current.set(index, el);
    else videoRefs.current.delete(index);
  };

  const usedVideoIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of slots) if (s) ids.add(s.id);
    return ids;
  }, [slots]);

  const availableVideos = useMemo(() => videos.filter((v) => !usedVideoIds.has(v.id)), [videos, usedVideoIds]);

  return (
    <div className="relative h-full flex flex-col bg-[#0f172a] select-none">
      <PageLoader active={loading} label="加载视频库" />
      <div className="flex items-center justify-between px-6 py-3 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          <Grid3X3 className="w-5 h-5 text-cyan-400" />
          <h2 className="text-sm font-bold text-slate-200">多片同放马赛克墙</h2>
          <span className="text-[10px] text-slate-500">{slots.filter(Boolean).length}/{slots.length} 槽位</span>
        </div>
        <div className="flex items-center gap-2">
          {GRID_LAYOUTS.map((l) => (
            <button key={l.label} onClick={() => setLayout(l)} className={`px-2.5 py-1 rounded text-[10px] font-semibold transition cursor-pointer ${layout.label === l.label ? "bg-cyan-500 text-white" : "bg-slate-800 text-slate-400 hover:text-slate-200"}`}>{l.label}</button>
          ))}
          <div className="w-px h-5 bg-slate-700 mx-1" />
          <button onClick={togglePlayAll} disabled={slots.every((s) => !s)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold transition cursor-pointer ${playing ? "bg-amber-500 text-white" : "bg-cyan-500 text-white hover:bg-cyan-600"} disabled:opacity-40 disabled:cursor-not-allowed`}>
            {playing ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            {playing ? "全部暂停" : "全部播放"}
          </button>
        </div>
      </div>
      <div className="flex-1 p-2 overflow-hidden">
        <div className="grid gap-1 h-full" style={{ gridTemplateColumns: `repeat(${layout.cols}, 1fr)`, gridTemplateRows: `repeat(${layout.rows}, 1fr)` }}>
          {slots.map((slot, i) => (
            <div key={i} className="relative bg-slate-900 rounded-lg overflow-hidden border border-slate-800 group">
              {slot ? (
                <>
                  <video ref={(el) => setVideoRef(i, el)} src={slot.url} muted loop playsInline className="w-full h-full object-contain" />
                  <div className="absolute top-2 left-2 right-2 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="text-[9px] font-bold text-white bg-black/60 px-2 py-0.5 rounded truncate max-w-[80%]">{slot.name}</span>
                    <Tooltip content="从九宫格拼接墙中移除该视频" placement="top">
                      <button
                        type="button"
                        onClick={() => removeVideo(i)}
                        aria-label="移除视频"
                        className="w-5 h-5 flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-rose-500 transition cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </Tooltip>
                  </div>
                </>
              ) : (
                <button onClick={() => { setPickingSlot(i); setShowPicker(true); }} className="w-full h-full flex flex-col items-center justify-center gap-2 text-slate-600 hover:text-cyan-400 hover:bg-slate-800/50 transition cursor-pointer">
                  <Plus className="w-8 h-8" />
                  <span className="text-[10px]">选择视频</span>
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
      {showPicker && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center" onClick={(e) => { if (e.target === e.currentTarget) { setShowPicker(false); setPickingSlot(null); } }}>
          <div className="bg-slate-900 rounded-2xl border border-slate-800 w-[500px] max-h-[70vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-slate-200">选择视频到槽位 #{pickingSlot != null ? pickingSlot + 1 : "?"}</h3>
              <Tooltip content="关闭视频选择器 (Esc)" placement="bottom">
                <button
                  type="button"
                  onClick={() => { setShowPicker(false); setPickingSlot(null); }}
                  aria-label="关闭视频选择器"
                  className="w-6 h-6 flex items-center justify-center rounded text-slate-500 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </Tooltip>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {availableVideos.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-xs">没有更多可用视频</div>
              ) : (
                availableVideos.map((v) => (
                  <button key={v.id} onClick={() => pickingSlot != null && assignVideo(pickingSlot, v)} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left hover:bg-slate-800 transition cursor-pointer">
                    <span className="text-[11px] text-slate-300 truncate">{v.name}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
