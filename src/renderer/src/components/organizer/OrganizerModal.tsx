import React, { useEffect, useState } from "react";
import {
  X,
  FolderArchive,
  FolderOpen,
  Link,
  Copy,
  FileText,
  Image,
  CheckCircle2,
  AlertTriangle,
  Play,
  ArrowRight,
  RefreshCw,
  Info,
} from "lucide-react";
import { trpc } from "../../lib/trpc";

export interface OrganizerModalProps {
  sourcePath: string;
  onClose: () => void;
  onAddSystemLog?: (
    text: string,
    level: "INFO" | "WARNING" | "SUCCESS" | "ERROR",
  ) => void;
}

export function OrganizerModal({
  sourcePath,
  onClose,
  onAddSystemLog,
}: OrganizerModalProps) {
  const [targetPath, setTargetPath] = useState("");
  const [mode, setMode] = useState<"symlink" | "hardlink" | "copy">("symlink");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [organizing, setOrganizing] = useState(false);
  const [result, setResult] = useState<any>(null);

  const scan = async () => {
    if (!sourcePath) return;
    setLoading(true);
    try {
      const res = await trpc.organizer.scanLibrary.query({ sourcePath });
      setItems(res.items);
    } catch (err: any) {
      onAddSystemLog?.(`扫描媒体库失败: ${err?.message || err}`, "ERROR");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    scan();
  }, [sourcePath]);

  const handlePickTarget = async () => {
    try {
      const selected = await trpc.dialog.selectFolder.query({
        currentPath: targetPath || sourcePath,
      });
      if (selected) {
        setTargetPath(selected);
      }
    } catch (err: any) {
      onAddSystemLog?.(`选择目标目录失败: ${err?.message || err}`, "ERROR");
    }
  };

  const handleRunOrganize = async () => {
    if (!targetPath.trim()) {
      onAddSystemLog?.("请先指定整理输出的目标目录", "WARNING");
      return;
    }
    setOrganizing(true);
    setResult(null);
    try {
      const res = await trpc.organizer.createSymlinkLibrary.mutate({
        sourcePath,
        targetPath: targetPath.trim(),
        mode,
        items: items.map((i) => ({
          folderPath: i.folderPath,
          suggestedName: i.suggestedName,
          code: i.code,
        })),
      });

      setResult(res);
      if (res.success) {
        onAddSystemLog?.(
          `媒体库整理完成！已成功为 ${res.count} 部影片生成 Emby 软链接与 NFO`,
          "SUCCESS",
        );
      }
    } catch (err: any) {
      onAddSystemLog?.(`整理执行异常: ${err?.message || err}`, "ERROR");
    } finally {
      setOrganizing(false);
    }
  };

  const handleOpenTarget = async () => {
    if (!targetPath) return;
    try {
      await trpc.system.openPath.mutate({ path: targetPath });
    } catch (err: any) {
      onAddSystemLog?.(`打开目录失败: ${err?.message || err}`, "ERROR");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 anim-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col h-[650px] anim-scale-in">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400">
              <FolderArchive className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  Emby / Plex 媒体库规范化归档与软链接整理
                </h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 font-bold">
                  0 磁盘空间占用
                </span>
              </div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                自动提取番号与演员生成标准目录结构，生成海报与 movie.nfo 元数据
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Path and Options Form */}
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 space-y-3.5 bg-slate-50/30 dark:bg-slate-950/20 shrink-0">
          {/* 源目录 & 目标目录 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400 block">
                原始下载片库路径 (只读读取)
              </label>
              <div className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-600 dark:text-slate-300 truncate">
                {sourcePath || "未配置视频路径"}
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400 block">
                整理输出目标路径 (Emby / Plex 读取目录)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={targetPath}
                  onChange={(e) => setTargetPath(e.target.value)}
                  placeholder="选择或输入 Emby 媒体库目录..."
                  className="flex-1 px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-500 font-mono"
                />
                <button
                  type="button"
                  onClick={handlePickTarget}
                  className="px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-500/20 text-xs font-bold hover:bg-blue-100 dark:hover:bg-blue-500/20 transition cursor-pointer flex items-center gap-1 shrink-0"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  选择
                </button>
              </div>
            </div>
          </div>

          {/* 整理模式与特性开关 */}
          <div className="flex items-center justify-between gap-4 pt-1">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-bold text-slate-700 dark:text-slate-300">
                归档模式:
              </span>
              <button
                type="button"
                onClick={() => setMode("symlink")}
                className={`px-2.5 py-1 rounded-lg font-bold text-xs border transition cursor-pointer flex items-center gap-1 ${
                  mode === "symlink"
                    ? "bg-blue-500 text-white border-blue-500"
                    : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700"
                }`}
              >
                <Link className="w-3 h-3" />
                软链接 (推荐 · 0空间占用)
              </button>
              <button
                type="button"
                onClick={() => setMode("copy")}
                className={`px-2.5 py-1 rounded-lg font-bold text-xs border transition cursor-pointer flex items-center gap-1 ${
                  mode === "copy"
                    ? "bg-blue-500 text-white border-blue-500"
                    : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700"
                }`}
              >
                <Copy className="w-3 h-3" />
                物理复制
              </button>
            </div>

            <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400 text-xs">
              <span className="flex items-center gap-1">
                <FileText className="w-3.5 h-3.5 text-blue-500" />
                生成 movie.nfo
              </span>
              <span className="flex items-center gap-1">
                <Image className="w-3.5 h-3.5 text-amber-500" />
                自动提取 poster.jpg
              </span>
            </div>
          </div>
        </div>

        {/* List of Scanned Videos */}
        <div className="flex-1 overflow-y-auto p-5 space-y-2.5 bg-slate-50/40 dark:bg-slate-950/40">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400 pb-1">
            <span>待整理影片列表 ({items.length} 部)</span>
            <button
              type="button"
              onClick={scan}
              className="flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
              重新扫描
            </button>
          </div>

          {items.map((item) => (
            <div
              key={item.folderPath}
              className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-3 text-xs"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  {item.code ? (
                    <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-mono font-bold text-[10px]">
                      {item.code}
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-500 font-mono text-[10px]">
                      未识别番号
                    </span>
                  )}
                  <span className="font-bold text-slate-700 dark:text-slate-200 truncate">
                    {item.suggestedName}
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 truncate flex items-center gap-1">
                  <span>原目录: {item.folderName}</span>
                  {item.hasMeta && (
                    <span className="text-emerald-500">· 已刮削元数据</span>
                  )}
                </div>
              </div>

              <div className="shrink-0 text-right text-[11px] text-slate-400">
                {item.actors?.length > 0 ? (
                  <span className="text-slate-600 dark:text-slate-300 font-medium">
                    {item.actors.slice(0, 2).join(", ")}
                  </span>
                ) : (
                  <span>未知演员</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Result Message */}
        {result && (
          <div
            className={`px-6 py-2.5 text-xs flex items-center justify-between border-t ${
              result.success
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20"
            }`}
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              <span>{result.message}</span>
            </div>
            {result.success && targetPath && (
              <button
                type="button"
                onClick={handleOpenTarget}
                className="underline hover:opacity-80 font-bold cursor-pointer"
              >
                在访达/文件管理器中打开
              </button>
            )}
          </div>
        )}

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1.5 text-slate-400 dark:text-slate-500 text-[11px]">
            <Info className="w-3.5 h-3.5 text-blue-500" />
            <span>软链接不占用额外硬盘空间，可安全挂载到任何流媒体服务端</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition rounded-lg text-xs font-semibold cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleRunOrganize}
              disabled={organizing || items.length === 0 || !targetPath.trim()}
              className="flex items-center gap-1.5 px-5 py-2 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-xs text-white font-bold rounded-lg shadow-sm shadow-blue-500/10 transition cursor-pointer disabled:opacity-50"
            >
              <FolderArchive
                className={`w-3.5 h-3.5 ${organizing ? "animate-spin" : ""}`}
              />
              {organizing ? "正在生成软链接与 NFO..." : "一键开始归档整理"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
