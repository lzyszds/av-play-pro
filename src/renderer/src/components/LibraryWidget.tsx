import React, { useEffect, useState } from "react";
import { Bell, Film, Gauge, Play, X, RefreshCw } from "lucide-react";
import { trpc } from "../lib/trpc";

interface Props {
  videoPath: string;
}

export function LibraryWidget({ videoPath }: Props) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!videoPath) return;
    setLoading(true);
    try {
      const overview = await trpc.library.overview.query({ rootPath: videoPath });
      setData(overview);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let disposed = false;
    const wrappedLoad = async () => {
      try {
        const overview = await trpc.library.overview.query({ rootPath: videoPath });
        if (!disposed) setData(overview);
      } catch {
        if (!disposed) setData(null);
      }
    };
    void wrappedLoad();
    const id = window.setInterval(wrappedLoad, 60000);
    return () => {
      disposed = true;
      window.clearInterval(id);
    };
  }, [videoPath]);

  const close = () => {
    void trpc.window.closeLibraryWidget.mutate();
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 select-none">
      <div className="h-8 flex items-center justify-between px-3 bg-slate-900 border-b border-slate-800" style={{ WebkitAppRegion: "drag" } as React.CSSProperties}>
        <div className="flex items-center gap-1.5 text-[11px] font-bold">
          <Gauge className="w-3.5 h-3.5 text-amber-400" />
          片库桌面小组件
        </div>
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <button type="button" onClick={load} className="w-6 h-6 rounded hover:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-amber-400 cursor-pointer" title="刷新">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button type="button" onClick={close} className="w-6 h-6 rounded hover:bg-rose-500/20 flex items-center justify-center text-slate-400 hover:text-rose-300 cursor-pointer" title="关闭">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="p-3">
        {!data?.totals ? (
          <div className="h-32 flex items-center justify-center text-[11px] text-slate-500">
            {videoPath ? "读取片库中..." : "未设置视频目录"}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-2 text-center">
              <Metric icon={Film} value={data.totals.videos} label="影片" />
              <Metric icon={Play} value={data.totals.unseen} label="未看" />
              <Metric icon={Bell} value={data.notifications?.length || 0} label="提醒" />
              <Metric icon={Gauge} value={data.totals.bookmarks} label="书签" />
            </div>
            <div className="mt-3 rounded-md bg-slate-900 border border-slate-800 px-3 py-2">
              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span>总占用</span>
                <span className="font-mono text-amber-300">{data.totals.totalSize}</span>
              </div>
              <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                <span>缺封面 / 缺资料</span>
                <span className="font-mono">{data.totals.missingCover} / {data.totals.missingMeta}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Metric({ icon: Icon, value, label }: { icon: typeof Film; value: number; label: string }) {
  return (
    <div className="rounded-md bg-slate-900 border border-slate-800 py-1.5">
      <Icon className="w-3 h-3 mx-auto text-amber-500" />
      <div className="text-[12px] font-bold text-slate-100">{value}</div>
      <div className="text-[9px] text-slate-400">{label}</div>
    </div>
  );
}
