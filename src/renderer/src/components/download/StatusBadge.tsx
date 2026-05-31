import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { TaskStatus } from "../../pages/download/types";

export function getStatusBadge(status: TaskStatus) {
  switch (status) {
    case "DOWNLOADING":
      return (
        <span className="inline-flex items-center gap-1 text-[10px] bg-amber-500/90 text-white px-2 py-0.5 rounded font-mono font-bold backdrop-blur-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-900 animate-pulse" />
          下载中
        </span>
      );
    case "PAUSED":
      return (
        <span className="inline-flex items-center gap-1 text-[10px] bg-slate-900/80 text-slate-200 px-2 py-0.5 rounded font-mono font-bold backdrop-blur-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
          已暂停
        </span>
      );
    case "COMPLETED":
      return (
        <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-500/90 text-white px-2 py-0.5 rounded font-mono font-bold backdrop-blur-sm">
          <CheckCircle2 className="w-3 h-3" />
          已完成
        </span>
      );
    case "PARSING":
      return (
        <span className="inline-flex items-center gap-1 text-[10px] bg-sky-500/90 text-white px-2 py-0.5 rounded font-mono font-bold backdrop-blur-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          解析中
        </span>
      );
    case "FAILED":
      return (
        <span className="inline-flex items-center gap-1 text-[10px] bg-rose-500/90 text-white px-2 py-0.5 rounded font-mono font-bold backdrop-blur-sm">
          <AlertCircle className="w-3 h-3" />
          失败
        </span>
      );
    case "PENDING":
      return (
        <span className="inline-flex items-center gap-1 text-[10px] bg-slate-900/70 text-slate-200 px-2 py-0.5 rounded font-mono font-bold backdrop-blur-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          排队中
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 text-[10px] bg-slate-900/70 text-slate-200 px-2 py-0.5 rounded font-mono font-bold backdrop-blur-sm">
          等待中
        </span>
      );
  }
}
