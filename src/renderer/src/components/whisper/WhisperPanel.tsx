import React, { useEffect, useMemo, useState } from "react";
import {
  X,
  Download,
  FolderOpen,
  Check,
  AlertTriangle,
  Loader2,
  Trash2,
  Captions,
  Zap,
} from "lucide-react";
import { trpc } from "../../lib/trpc";
import { Tooltip } from "../common/Tooltip";

type Model = "tiny" | "base" | "small" | "medium" | "large-v3";

interface Props {
  /** 当前选中视频的真实路径（file://... 解开后），用于"为当前视频生成字幕" */
  currentVideoPath?: string | null;
  currentVideoName?: string | null;
  onClose: () => void;
}

const MODEL_INFO: { id: Model; size: string; quality: string }[] = [
  { id: "tiny", size: "75MB", quality: "极速 · 一般" },
  { id: "base", size: "142MB", quality: "推荐 · 速度质量均衡" },
  { id: "small", size: "466MB", quality: "更好" },
  { id: "medium", size: "1.5GB", quality: "高质量" },
  { id: "large-v3", size: "3GB", quality: "顶配" },
];

const LANG_OPTIONS = [
  { id: "auto", name: "自动检测" },
  { id: "ja", name: "日语" },
  { id: "zh", name: "中文" },
  { id: "en", name: "英语" },
  { id: "ko", name: "韩语" },
];

export const WhisperPanel: React.FC<Props> = ({
  currentVideoPath,
  currentVideoName,
  onClose,
}) => {
  const [env, setEnv] = useState<{
    whisperBin: boolean;
    ffmpeg: boolean;
    ffmpegSource: "system" | "local" | null;
    ffmpegPath: string | null;
    rootDir: string;
    installedModels: Model[];
  } | null>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [modelChoice, setModelChoice] = useState<Model>("base");
  const [lang, setLang] = useState("auto");
  const [modelDownload, setModelDownload] = useState<{
    model: Model;
    percent: number;
  } | null>(null);
  const [install, setInstall] = useState<{
    running: boolean;
    job?: string;
    percent: number;
    stage: string;
    error?: string;
  }>({ running: false, percent: 0, stage: "" });

  const refreshEnv = async () => {
    const r = await trpc.whisper.checkEnv.query();
    setEnv(r as any);
  };

  const refreshJobs = async () => {
    const r = await trpc.whisper.listJobs.query();
    setJobs(r as any[]);
  };

  useEffect(() => {
    refreshEnv();
    refreshJobs();
    const off1 = (window as any).electronAPI?.whisper?.onJobUpdate(
      (list: any[]) => setJobs(list),
    );
    const off2 = (window as any).electronAPI?.whisper?.onModelProgress(
      (p: { model: Model; percent: number }) =>
        setModelDownload({ model: p.model, percent: p.percent }),
    );
    const off3 = (window as any).electronAPI?.whisper?.onModelDone(() => {
      setModelDownload(null);
      refreshEnv();
    });
    const off4 = (window as any).electronAPI?.whisper?.onModelError(() => {
      setModelDownload(null);
      refreshEnv();
    });
    const off5 = (window as any).electronAPI?.whisper?.onInstallProgress(
      (p: { job: string; percent: number; stage: string }) =>
        setInstall((s) => ({
          ...s,
          running: true,
          job: p.job,
          percent: p.percent,
          stage: p.stage,
        })),
    );
    const off6 = (window as any).electronAPI?.whisper?.onInstallDone(() => {
      refreshEnv();
    });
    const off7 = (window as any).electronAPI?.whisper?.onInstallError(
      (p: { message: string }) => {
        setInstall((s) => ({ ...s, running: false, error: p.message }));
        refreshEnv();
      },
    );
    return () => {
      off1?.();
      off2?.();
      off3?.();
      off4?.();
      off5?.();
      off6?.();
      off7?.();
    };
  }, []);

  const handleDownload = async (model: Model) => {
    setModelDownload({ model, percent: 0 });
    try {
      await trpc.whisper.downloadModel.mutate({ model });
    } catch (err: any) {
      alert(`下载失败: ${err?.message || err}`);
    }
  };

  const handleTranscribe = async () => {
    if (!currentVideoPath) {
      alert("没有选中视频");
      return;
    }
    if (!env?.installedModels.includes(modelChoice)) {
      alert(`请先下载 ggml-${modelChoice}.bin 模型`);
      return;
    }
    try {
      await trpc.whisper.transcribe.mutate({
        videoPath: currentVideoPath,
        model: modelChoice,
        language: lang,
      });
    } catch (err: any) {
      alert(`提交失败: ${err?.message || err}`);
    }
  };

  const handleCancel = async (id: string) => {
    await trpc.whisper.cancelJob.mutate({ id });
  };

  const handleOneClick = async () => {
    setInstall({ running: true, percent: 0, stage: "准备..." });
    try {
      await trpc.whisper.oneClickInstall.mutate({ model: modelChoice });
      setInstall({ running: false, percent: 100, stage: "完成" });
      await refreshEnv();
    } catch (err: any) {
      setInstall({
        running: false,
        percent: 0,
        stage: "",
        error: err?.message || String(err),
      });
    }
  };

  const envReady = env?.whisperBin && env?.ffmpeg;

  const activeJobs = useMemo(
    () =>
      jobs.filter(
        (j) =>
          j.status !== "done" && j.status !== "canceled" && j.status !== "error",
      ),
    [jobs],
  );
  const finishedJobs = useMemo(
    () =>
      jobs.filter(
        (j) =>
          j.status === "done" || j.status === "canceled" || j.status === "error",
      ),
    [jobs],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm anim-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-[640px] max-w-[95vw] max-h-[90vh] flex flex-col anim-pop-in overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Captions className="w-4 h-4 text-amber-500" />
            <span className="font-bold text-slate-800 text-sm">AI 字幕（Whisper）</span>
          </div>
          <Tooltip content="关闭语音识别 (Esc)" placement="left">
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭语音识别"
              className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </Tooltip>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
          {/* 环境检测 */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] font-bold text-slate-700">运行环境</div>
              {!envReady && (
                <button
                  onClick={handleOneClick}
                  disabled={install.running}
                  className="px-2.5 py-1 rounded-md bg-gradient-to-br from-pink-500 to-amber-500 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed hover:opacity-90 transition shadow-sm"
                  title="自动检测系统 ffmpeg，自动下载 whisper-cli 与默认模型"
                >
                  {install.running ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Zap className="w-3 h-3" />
                  )}
                  一键安装
                </button>
              )}
            </div>
            <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
              <EnvRow
                label="whisper-cli.exe"
                ok={!!env?.whisperBin}
                action={
                  !env?.whisperBin ? (
                    <button
                      onClick={async () => {
                        try {
                          await trpc.whisper.installWhisperBin.mutate();
                          refreshEnv();
                        } catch (err: any) {
                          alert(err?.message || err);
                        }
                      }}
                      disabled={install.running}
                      className="px-2 py-0.5 rounded text-[10px] font-bold text-amber-700 hover:bg-amber-50 cursor-pointer disabled:opacity-60"
                    >
                      下载
                    </button>
                  ) : null
                }
              />
              <EnvRow
                label={
                  env?.ffmpegSource === "system"
                    ? `ffmpeg (系统)`
                    : env?.ffmpegSource === "local"
                      ? `ffmpeg (本地)`
                      : "ffmpeg"
                }
                ok={!!env?.ffmpeg}
                sub={env?.ffmpegPath || undefined}
                action={
                  !env?.ffmpeg ? (
                    <button
                      onClick={async () => {
                        try {
                          await trpc.whisper.installFfmpegBin.mutate();
                          refreshEnv();
                        } catch (err: any) {
                          alert(err?.message || err);
                        }
                      }}
                      disabled={install.running}
                      className="px-2 py-0.5 rounded text-[10px] font-bold text-amber-700 hover:bg-amber-50 cursor-pointer disabled:opacity-60"
                    >
                      下载
                    </button>
                  ) : null
                }
              />
            </div>

            {install.running && (
              <div className="mt-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-[10px] text-amber-800">
                <div className="flex items-center justify-between mb-1">
                  <span className="flex items-center gap-1.5 font-bold">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {install.stage || "安装中..."}
                  </span>
                  <span className="font-mono">{install.percent.toFixed(0)}%</span>
                </div>
                <div className="h-1 bg-white rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500 transition-all"
                    style={{ width: `${install.percent}%` }}
                  />
                </div>
              </div>
            )}

            {install.error && (
              <div className="mt-2 p-2 rounded-lg bg-red-50 border border-red-200 text-[11px] text-red-700">
                <div className="font-bold flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3" /> 安装失败
                </div>
                <div className="mt-0.5 break-all">{install.error}</div>
              </div>
            )}

            {!envReady && env && !install.running && !install.error && (
              <div className="mt-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[10px] text-slate-600 space-y-1">
                <div className="text-slate-500">
                  · ffmpeg 已检测系统 PATH，未找到将自动下载（~80MB）
                  <br />· whisper-cli 自动从 GitHub 下载，超时后切换镜像（~30MB）
                  <br />· 模型按需下载，Hugging Face 超时后切换镜像，base 推荐（142MB）
                </div>
                <div className="text-slate-400 font-mono break-all">
                  目标目录: {env.rootDir}
                </div>
              </div>
            )}
          </section>

          {/* 模型管理 */}
          <section>
            <div className="text-[11px] font-bold text-slate-700 mb-2">模型</div>
            <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
              {MODEL_INFO.map((m) => {
                const installed = env?.installedModels.includes(m.id);
                const downloading = modelDownload?.model === m.id;
                return (
                  <div
                    key={m.id}
                    className="flex items-center justify-between px-3 py-2 gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-slate-800">
                          ggml-{m.id}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {m.size}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500">{m.quality}</div>
                    </div>
                    <div className="shrink-0">
                      {installed ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 text-[10px] font-bold">
                          <Check className="w-3 h-3" />
                          已安装
                        </span>
                      ) : downloading ? (
                        <div className="flex items-center gap-2 w-32">
                          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-amber-400"
                              style={{ width: `${modelDownload?.percent || 0}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-mono text-slate-500 w-9 text-right">
                            {(modelDownload?.percent || 0).toFixed(0)}%
                          </span>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleDownload(m.id)}
                          disabled={!!modelDownload}
                          className="px-2 py-1 rounded bg-white border border-slate-200 text-slate-600 hover:border-amber-300 hover:text-amber-600 text-[10px] font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition"
                        >
                          <Download className="w-3 h-3" />
                          下载
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 为当前视频生成 */}
          <section>
            <div className="text-[11px] font-bold text-slate-700 mb-2">
              为当前视频生成
            </div>
            {!currentVideoPath ? (
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-500">
                请先在左侧列表选中一个本地视频
              </div>
            ) : (
              <div className="rounded-lg border border-slate-200 p-3 space-y-2.5">
                <div className="text-[11px] text-slate-600 truncate">
                  {currentVideoName}
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[10px] text-slate-500 w-12 shrink-0">模型</label>
                  <select
                    value={modelChoice}
                    onChange={(e) => setModelChoice(e.target.value as Model)}
                    className="flex-1 bg-white border border-slate-200 rounded text-[11px] px-2 py-1 focus:outline-none focus:border-amber-400 cursor-pointer"
                  >
                    {MODEL_INFO.map((m) => (
                      <option key={m.id} value={m.id}>
                        ggml-{m.id} ({m.size})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[10px] text-slate-500 w-12 shrink-0">语言</label>
                  <select
                    value={lang}
                    onChange={(e) => setLang(e.target.value)}
                    className="flex-1 bg-white border border-slate-200 rounded text-[11px] px-2 py-1 focus:outline-none focus:border-amber-400 cursor-pointer"
                  >
                    {LANG_OPTIONS.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={handleTranscribe}
                  disabled={!envReady}
                  className="w-full py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold cursor-pointer transition disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                >
                  <Captions className="w-3.5 h-3.5" />
                  生成字幕（加入队列）
                </button>
              </div>
            )}
          </section>

          {/* 任务队列 */}
          {(activeJobs.length > 0 || finishedJobs.length > 0) && (
            <section>
              <div className="text-[11px] font-bold text-slate-700 mb-2">
                任务队列
              </div>
              <div className="space-y-1.5">
                {activeJobs.map((j) => (
                  <JobRow key={j.id} job={j} onCancel={handleCancel} />
                ))}
                {finishedJobs.slice(-5).map((j) => (
                  <JobRow key={j.id} job={j} />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="px-5 py-2.5 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
          <button
            onClick={async () => {
              const r = await trpc.whisper.paths.query();
              await trpc.system.openPath?.mutate?.({ path: r.root }).catch(() => {
                navigator.clipboard.writeText(r.root);
                alert("路径已复制到剪贴板");
              });
            }}
            className="flex items-center gap-1 hover:text-amber-600 cursor-pointer"
          >
            <FolderOpen className="w-3 h-3" />
            打开 whisper 目录
          </button>
          <span>转写完成后，srt 会写入视频同目录 video.srt</span>
        </div>
      </div>
    </div>
  );
};

const EnvRow: React.FC<{
  label: string;
  ok: boolean;
  sub?: string;
  action?: React.ReactNode;
}> = ({ label, ok, sub, action }) => (
  <div className="flex items-center justify-between px-3 py-2 gap-2">
    <div className="min-w-0">
      <div className="font-mono text-[11px] text-slate-700">{label}</div>
      {sub && (
        <div className="font-mono text-[9px] text-slate-400 truncate">{sub}</div>
      )}
    </div>
    <div className="flex items-center gap-1.5 shrink-0">
      {ok ? (
        <span className="inline-flex items-center gap-1 text-emerald-600 text-[10px] font-bold">
          <Check className="w-3 h-3" /> 已就绪
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-red-500 text-[10px] font-bold">
          <X className="w-3 h-3" /> 未找到
        </span>
      )}
      {action}
    </div>
  </div>
);

const JobRow: React.FC<{ job: any; onCancel?: (id: string) => void }> = ({
  job,
  onCancel,
}) => {
  const inFlight =
    job.status === "extracting" ||
    job.status === "transcribing" ||
    job.status === "queued";
  const color =
    job.status === "done"
      ? "bg-emerald-500"
      : job.status === "error"
        ? "bg-red-500"
        : job.status === "canceled"
          ? "bg-slate-400"
          : "bg-amber-500";
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2 bg-white">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold text-slate-800 truncate flex-1">
          {job.videoName}
        </span>
        {inFlight ? (
          <Loader2 className="w-3 h-3 text-amber-500 animate-spin shrink-0" />
        ) : null}
        {inFlight && onCancel && (
          <button
            onClick={() => onCancel(job.id)}
            className="text-slate-400 hover:text-red-500 cursor-pointer shrink-0"
            title="取消"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
      <div className="mt-1.5 h-1 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all ${color}`}
          style={{ width: `${job.progress || 0}%` }}
        />
      </div>
      <div className="mt-0.5 text-[10px] text-slate-500 flex items-center justify-between">
        <span>{job.message}</span>
        <span className="font-mono">{(job.progress || 0).toFixed(0)}%</span>
      </div>
    </div>
  );
};
