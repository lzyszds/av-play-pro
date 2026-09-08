import React, { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  FolderOpen,
  Folder,
  Cpu,
  Shield,
  Cloud,
  Sparkles,
} from "lucide-react";
import { trpc } from "../../lib/trpc";
import { Button } from "../common/Button";
import type { AppSettings } from "../../pages/download/types";

interface Props {
  settings: AppSettings;
  onSettingsChange: (patch: Partial<AppSettings>) => void;
  onDone: () => void;
  onClose: () => void;
}

interface CheckState {
  ffmpeg: "ok" | "warn" | "none";
  videoDir: "ok" | "warn";
  tempDir: "ok" | "warn";
  cloud: "ok" | "info";
}

function Row({
  icon,
  title,
  desc,
  state,
  extra,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  state: CheckState[keyof CheckState];
  extra?: React.ReactNode;
}) {
  const tone =
    state === "ok"
      ? { icon: <CheckCircle2 className="w-4 h-4 text-emerald-500" />, ring: "border-emerald-500/40 bg-emerald-500/5" }
      : state === "warn"
        ? { icon: <AlertCircle className="w-4 h-4 text-amber-500" />, ring: "border-amber-500/40 bg-amber-500/5" }
        : state === "info"
          ? { icon: <Cloud className="w-4 h-4 text-sky-400" />, ring: "border-sky-500/40 bg-sky-500/5" }
          : { icon: <XCircle className="w-4 h-4 text-rose-500" />, ring: "border-rose-500/40 bg-rose-500/5" };
  return (
    <div className={`rounded-xl border p-3 flex items-start gap-3 ${tone.ring}`}>
      <div className="shrink-0 w-7 h-7 rounded-lg bg-white/70 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-700 flex items-center justify-center">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-100">
          {title}
          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{state}</span>
        </div>
        <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{desc}</p>
        {extra}
      </div>
      <span className="shrink-0 mt-0.5">{tone.icon}</span>
    </div>
  );
}

export const FirstRunGuide: React.FC<Props> = ({ settings, onSettingsChange, onDone, onClose }) => {
  const [checks, setChecks] = useState<CheckState>({
    ffmpeg: "none",
    videoDir: "warn",
    tempDir: "warn",
    cloud: "info",
  });

  const pickDir = async (field: "video_path" | "temp_path") => {
    try {
      const r = await trpc.dialog.selectFolder.query({
        currentPath: settings[field] || undefined,
      });
      const next = (r as any)?.path || (r as any)?.selectedPath || (r as any)?.folder;
      if (typeof next === "string" && next) {
        onSettingsChange({ [field]: next });
      }
    } catch {
      /* 用户取消或失败则忽略 */
    }
  };

  const probe = useCallback(async () => {
    let ff: CheckState["ffmpeg"] = "none";
    try {
      const env: any = await trpc.whisper.checkEnv.query();
      if (env?.ffmpeg) ff = "ok";
      else if (env?.ffmpegPath) ff = "ok";
      else ff = "warn";
    } catch {
      ff = "warn";
    }

    let videoDir: CheckState["videoDir"] = "warn";
    let tempDir: CheckState["tempDir"] = "warn";
    const probeDir = async (p?: string): Promise<boolean> => {
      if (!p?.trim()) return false;
      try {
        const disk: any = await trpc.system.getDiskFree.query({ path: p });
        return !!disk && typeof disk.free === "number";
      } catch {
        return false;
      }
    };
    const [vd, td] = await Promise.all([
      probeDir(settings.video_path),
      probeDir(settings.temp_path),
    ]);
    if (settings.video_path?.trim()) videoDir = vd ? "ok" : "warn";
    if (settings.temp_path?.trim()) tempDir = td ? "ok" : "warn";

    setChecks((prev) => ({ ...prev, ffmpeg: ff, videoDir, tempDir }));
  }, [settings.video_path, settings.temp_path]);

  useEffect(() => {
    void probe();
  }, [probe]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm select-none">
      <div className="w-[min(92vw,640px)] max-h-[88vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="shrink-0 w-11 h-11 rounded-2xl bg-gradient-to-tr from-amber-500 to-rose-500 text-white flex items-center justify-center shadow-lg shadow-amber-500/20">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-extrabold text-slate-900 dark:text-white">首次运行 · 环境体检</h2>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              逐项确认后即可开始使用；所有项都能在「设置」里随时再改。
            </p>
          </div>
        </div>

        <div className="space-y-2.5">
          {/* 视频目录 */}
          <Row
            icon={<Folder className="w-4 h-4 text-amber-500" />}
            title="本地视频目录"
            desc={settings.video_path?.trim() || "尚未设置——成片会归档到这里。选择后立即体检可写性。"}
            state={settings.video_path?.trim() ? checks.videoDir : "none"}
            extra={
              <button
                type="button"
                onClick={() => pickDir("video_path")}
                className="mt-2 inline-flex items-center gap-1.5 px-2.5 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200 text-[11px] font-bold cursor-pointer transition"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                选择目录
              </button>
            }
          />

          {/* 临时目录 */}
          <Row
            icon={<Folder className="w-4 h-4 text-sky-500" />}
            title="下载临时目录"
            desc={settings.temp_path?.trim() || "尚未设置——分片缓存会先写到这里。"}
            state={settings.temp_path?.trim() ? checks.tempDir : "none"}
            extra={
              <button
                type="button"
                onClick={() => pickDir("temp_path")}
                className="mt-2 inline-flex items-center gap-1.5 px-2.5 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200 text-[11px] font-bold cursor-pointer transition"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                选择目录
              </button>
            }
          />

          {/* ffmpeg */}
          <Row
            icon={<Cpu className="w-4 h-4 text-violet-500" />}
            title="ffmpeg 环境"
            desc={
              checks.ffmpeg === "ok"
                ? "已检测到可用的 ffmpeg（字幕、缩略图、镜头检测、本机取帧封面都会用到）。"
                : "未检测到 ffmpeg——建议到「字幕」工具里一键安装；不影响纯播放/下载。"
            }
            state={checks.ffmpeg}
            extra={
              checks.ffmpeg !== "ok" ? (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await trpc.whisper.installFfmpegBin.mutate();
                      await probe();
                    } catch { /* 安装过程以通知为准 */ }
                  }}
                  className="mt-2 inline-flex items-center gap-1.5 px-2.5 h-7 rounded-lg bg-violet-500 hover:bg-violet-600 text-white text-[11px] font-bold cursor-pointer transition"
                >
                  一键安装 ffmpeg
                </button>
              ) : undefined
            }
          />

          {/* 隐私 & 云 */}
          <Row
            icon={<Shield className="w-4 h-4 text-rose-500" />}
            title="隐私与后台"
            desc="自动开启隐私屏保；关闭窗口可选收进托盘，后台自动备份与下载照常。"
            state="info"
            extra={
              <div className="mt-2 flex flex-wrap gap-2">
                <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-rose-500"
                    checked={settings.privacyScreenEnabled !== false}
                    onChange={(e) => onSettingsChange({ privacyScreenEnabled: e.target.checked })}
                  />
                  隐私屏保
                </label>
                <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-amber-500"
                    checked={settings.cloudSyncAutoSync !== false}
                    onChange={(e) => onSettingsChange({ cloudSyncAutoSync: e.target.checked })}
                  />
                  自动云备份
                </label>
              </div>
            }
          />

          <Row
            icon={<Cloud className="w-4 h-4 text-sky-500" />}
            title="云端接入"
            desc={
              settings.cloudSyncEndpoint?.trim() && settings.newsEndpoint?.trim()
                ? "已配置云同步与资讯服务端点（可在设置里改）。"
                : "未配置云端端点——相关能力会跳过，不影响本地使用。"
            }
            state={settings.cloudSyncEndpoint?.trim() && settings.newsEndpoint?.trim() ? "ok" : "info"}
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="subtle" size="sm" onClick={onClose}>
            稍后再说
          </Button>
          <Button variant="primary" size="sm" onClick={onDone}>
            完成并开始使用
          </Button>
        </div>
      </div>
    </div>
  );
};
