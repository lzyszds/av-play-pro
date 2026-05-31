/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "../lib/trpc";
import { Dropdown } from "../components/Dropdown";
import {
  Plus, Play, Pause, Trash2, Eye, FileVideo, CheckCircle2, AlertCircle,
  Copy, Check, Search, Film, Terminal, Code, Settings, Trash2 as TrashIcon,
  Shield, Download, X, Folder, Save, AlertCircle as AlertWarn, Cpu,
  ChevronDown, ChevronRight, Globe, Info,
} from "lucide-react";
import { NewTaskModal } from "../components/download/NewTaskModal";
import { SettingsPanel } from "../components/download/SettingsPanel";
import { TaskCard } from "../components/download/TaskCard";
import type {
  AppSettings,
  DownloadPageProps,
  DownloadTask,
  LogMessage,
} from "./download/types";
import {
  extractVideoCode,
  formatBytes,
  formatSpeed,
  generateN3u8DLCommand,
  getCoverUrlFromName,
  toProxiedAssetUrl,
} from "./download/utils";

interface ExtensionPushedTask {
  id?: string;
  url: string;
  name: string;
  coverUrl?: string;
  previewUrl?: string;
  quality?: string;
  source?: string;
  pageUrl?: string;
  referer: string;
  refererOrigin: string;
  refererSource: string;
  pushedAt: string;
}

const EXTENSION_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

function buildExtensionHeaders(task: ExtensionPushedTask): string {
  return JSON.stringify({
    "User-Agent": EXTENSION_USER_AGENT,
    Referer: task.referer,
    Origin: task.refererOrigin,
  });
}

export function DownloadPage({
  settings,
  onSettingsChange,
  onAddSystemLog,
  onPlayCompletedTask,
}: DownloadPageProps) {
  /* ---- state ---- */
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [storageLoaded, setStorageLoaded] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showNewTaskModal, setShowNewTaskModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [copiedTaskId, setCopiedTaskId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeSubTab, setActiveSubTab] = useState<"console" | "metadata">(
    "console",
  );
  const [logFilter, setLogFilter] = useState<
    "ALL" | "INFO" | "SUCCESS" | "WARNING" | "ERROR"
  >("ALL");
  const [autoScroll, setAutoScroll] = useState(true);
  const [copiedTaskCmd, setCopiedTaskCmd] = useState(false);

  const activeDownloadId = useRef<string | null>(null);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  // 让 IPC 回调访问最新设置（避免 effect 因 settings 变化而重订阅）
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // 任务栏进度 IPC 节流（最少 200ms 一次）
  const lastTaskbarPushRef = useRef(0);
  // 提示音预加载
  const tipsAudioRef = useRef<HTMLAudioElement | null>(null);
  if (!tipsAudioRef.current && typeof Audio !== "undefined") {
    tipsAudioRef.current = new Audio("./tips.mp3");
    tipsAudioRef.current.preload = "auto";
  }
  const consumingExtensionPushesRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 队列调度器引用（供进度回调在 useEffect 内调用最新版本）
  const startNextRef = useRef<() => void>(() => {});

  // 队列下载开关：开启后完成一个会自动下一个；关闭则需手动点单个任务
  const [queueEnabled, setQueueEnabled] = useState(false);
  const queueEnabledRef = useRef(queueEnabled);
  queueEnabledRef.current = queueEnabled;

  // 应用启动时，上次会话遗留的“下载中/解析中”进程其实已不存在，重置为暂停，避免假象
  useEffect(() => {
    setTasks((prev) =>
      prev.some(
        (t) => t.status === "DOWNLOADING" || t.status === "PARSING",
      )
        ? prev.map((t) =>
            t.status === "DOWNLOADING" || t.status === "PARSING"
              ? { ...t, status: "PAUSED", speed: 0 }
              : t,
          )
        : prev,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- persist ---- */
  useEffect(() => {
    let disposed = false;

    trpc.storage.getDownloadState
      .query()
      .then((state) => {
        if (disposed) return;
        setTasks(Array.isArray(state.tasks) ? (state.tasks as DownloadTask[]) : []);
        setLogs(Array.isArray(state.logs) ? (state.logs as LogMessage[]) : []);
      })
      .catch((err: any) => {
        if (disposed) return;
        setLogs((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            timestamp: new Date().toLocaleTimeString([], {
              hour12: false,
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }),
            level: "ERROR",
            text: `Electron 存储读取失败: ${err?.message || err}`,
          },
        ]);
      })
      .finally(() => {
        if (!disposed) setStorageLoaded(true);
      });

    return () => {
      disposed = true;
    };
  }, []);

  // 防抖落盘：避免每次 setTasks 都写 JSON 文件
  useEffect(() => {
    if (!storageLoaded) return;
    const timer = window.setTimeout(() => {
      void trpc.storage.saveDownloadState.mutate({ tasks, logs });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [logs, storageLoaded, tasks]);

  /* ---- auto-scroll ---- */
  useEffect(() => {
    if (autoScroll && scrollRef.current && activeSubTab === "console") {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, activeSubTab, autoScroll]);

  /* ---- helpers ---- */
  const addLog = useCallback(
    (
      text: string,
      level: "INFO" | "WARNING" | "SUCCESS" | "ERROR" = "INFO",
    ) => {
      const newLog: LogMessage = {
        id: Date.now().toString(),
        timestamp: new Date().toLocaleTimeString([], {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        level,
        text,
      };
      setLogs((prev) => [...prev, newLog]);
    },
    [],
  );

  /* ---- download progress listener (IPC 事件推送) ---- */
  useEffect(() => {
    let disposed = false;

    // 监听主进程推送的下载进度事件
    // 解析 N_m3u8DL-RE 输出中的速度和大小信息
    // 格式: "58/1591 3.65% 121.64MB/3.26GB 12.85MBps 00:04:41"
    const parseProgressInfo = (
      line: string,
    ): {
      percent: number | null;
      speed: number | null;
      downloadedSize: number | null;
      totalSize: number | null;
      downloadedSegments: number | null;
      totalSegments: number | null;
    } => {
      const result: {
        percent: number | null;
        speed: number | null;
        downloadedSize: number | null;
        totalSize: number | null;
        downloadedSegments: number | null;
        totalSegments: number | null;
      } = {
        percent: null,
        speed: null,
        downloadedSize: null,
        totalSize: null,
        downloadedSegments: null,
        totalSegments: null,
      };

      // 解析片段: "58/1591"
      const segMatch = line.match(/(\d+)\/(\d+)/);
      if (segMatch) {
        result.downloadedSegments = parseInt(segMatch[1]);
        result.totalSegments = parseInt(segMatch[2]);
      }

      // 解析百分比: "3.65%"
      const pctMatch = line.match(/(\d+\.?\d*)%/);
      if (pctMatch) {
        result.percent = parseFloat(pctMatch[1]);
      }

      // 解析大小: "121.64MB/3.26GB"
      const sizeMatch = line.match(
        /([\d.]+)\s*(B|KB|MB|GB|TB)\/([\d.]+)\s*(B|KB|MB|GB|TB)/,
      );
      if (sizeMatch) {
        result.downloadedSize = parseSizeToBytes(
          parseFloat(sizeMatch[1]),
          sizeMatch[2],
        );
        result.totalSize = parseSizeToBytes(
          parseFloat(sizeMatch[3]),
          sizeMatch[4],
        );
      }

      // 解析速度: "12.85MBps"
      const speedMatch = line.match(/([\d.]+)\s*(B|KB|MB|GB|TB)ps/);
      if (speedMatch) {
        result.speed = parseSizeToBytes(
          parseFloat(speedMatch[1]),
          speedMatch[2],
        );
      }

      return result;
    };

    const parseSizeToBytes = (value: number, unit: string): number => {
      const units: Record<string, number> = {
        B: 1,
        KB: 1024,
        MB: 1048576,
        GB: 1073741824,
        TB: 1099511627776,
      };
      return value * (units[unit] || 1);
    };

    const handleProgress = (
      _event: any,
      data: {
        line: string;
        percent: number | null;
        done: boolean;
        success: boolean;
      },
    ) => {
      if (disposed) return;
      const { line, percent, done, success } = data;
      const id = activeDownloadId.current;

      // 解析速度和大小
      const info = parseProgressInfo(line);

      // 更新任务栏进度条（节流 200ms,N_m3u8DL-RE 输出极频繁）
      if (id && !done && info.percent != null) {
        const now = Date.now();
        if (now - lastTaskbarPushRef.current >= 200) {
          lastTaskbarPushRef.current = now;
          void trpc.system.setTaskbarProgress
            .mutate({ progress: Math.max(0, Math.min(1, info.percent / 100)) })
            .catch(() => {});
        }
      }

      // 如果有活动下载任务，更新任务日志
      if (id) {
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== id) return t;
            const taskLogs = line ? [...t.logs, line].slice(-200) : t.logs;
            if (done) {
              return {
                ...t,
                status: success ? "COMPLETED" : "FAILED",
                progress: success ? 100 : t.progress,
                speed: 0,
                logs: taskLogs,
              };
            }
            return {
              ...t,
              progress:
                info.percent != null
                  ? info.percent
                  : percent != null
                    ? percent
                    : t.progress,
              speed: info.speed != null ? info.speed : t.speed,
              downloadedSize:
                info.downloadedSize != null
                  ? info.downloadedSize
                  : t.downloadedSize,
              totalSize: info.totalSize != null ? info.totalSize : t.totalSize,
              downloadedSegments:
                info.downloadedSegments != null
                  ? info.downloadedSegments
                  : t.downloadedSegments,
              totalSegments:
                info.totalSegments != null
                  ? info.totalSegments
                  : t.totalSegments,
              logs: taskLogs,
            };
          }),
        );
      }

      // Cover/preview logs are surfaced in the bottom console.
      if (!id && line.includes("\u5c01\u9762/\u9884\u89c8")) {
        addLog(
          line,
          success
            ? "SUCCESS"
            : line.includes("\u5931\u8d25")
              ? "ERROR"
              : line.includes("\u8df3\u8fc7")
                ? "WARNING"
                : "INFO",
        );
      }

      // 下载完成处理
      if (done && id) {
        const finished = activeDownloadId.current;
        activeDownloadId.current = null;
        addLog(
          success
            ? "下载任务已完成并合并。"
            : `下载任务结束（任务 ${finished ?? ""}）。`,
          success ? "SUCCESS" : "WARNING",
        );

        // 清除任务栏进度
        void trpc.system.setTaskbarProgress.mutate({ progress: -1 }).catch(() => {});

        // 系统通知 + 提示音
        const finishedTask = tasksRef.current.find((t) => t.id === finished);
        const taskName = finishedTask?.name || "下载任务";
        const s = settingsRef.current;
        if (s.notifyOnComplete) {
          void trpc.system.notify
            .mutate({
              title: success ? "下载完成" : "下载失败",
              body: success ? `${taskName} 已完成` : `${taskName} 异常退出`,
              silent: true,
            })
            .catch(() => {});
        }
        if (s.notifySound && tipsAudioRef.current) {
          try {
            tipsAudioRef.current.currentTime = 0;
            void tipsAudioRef.current.play().catch(() => {});
          } catch {}
        }

        // 当前任务结束 → 自动启动队列中的下一个（串行下载）
        setTimeout(() => startNextRef.current(), 400);

        // 下载完成后自动下载封面和预览
        if (success && finished) {
          const task = tasksRef.current.find((t) => t.id === finished);
          if (task) {
            // 从任务名提取番号（如 "TENN-046" 或 "SSIS-001"）
            const codeMatch = task.name.match(/[A-Z]{2,6}-\d{3,5}/i);
            const videoCode = codeMatch
              ? codeMatch[0].toUpperCase()
              : task.name.split(" ")[0];

            addLog(
              `正在下载封面和预览视频: ${task.name} (番号: ${videoCode})...`,
              "INFO",
            );
            const taskDir =
              task.savePath.replace(/[\/\\]$/, "") +
              "\\" +
              task.name.replace(/[\\/:*?"<>|]/g, "_");
            trpc.download.downloadCoverPreview.mutate({
              id: videoCode, // 使用番号而非 task.id
              name: task.name,
              saveDir: taskDir,
            });
          }
        }
      }
    };

    // 使用 IPC 事件监听（tRPC subscription 在 electron-trpc 中支持有限）
    const unlisten =
      window.electronAPI?.download?.onProgress?.(handleProgress) || (() => {});

    return () => {
      disposed = true;
      unlisten();
    };
  }, [addLog]);

  /* ---- add new task ---- */
  const handleAddNewTask = useCallback(
    async (data: any): Promise<boolean> => {
      const code = extractVideoCode(data.name) || extractVideoCode(data.url);

      if (code) {
        const duplicateTasks = tasksRef.current.filter((task) => {
          const taskCode = extractVideoCode(task.name) || extractVideoCode(task.url);
          return taskCode === code;
        });

        let duplicateVideos: Array<{ name?: string; id?: string }> = [];
        try {
          const libraryVideos = await trpc.videos.list.query({
            path: settings.video_path,
          });
          duplicateVideos = libraryVideos.filter((video: any) => {
            const videoCode =
              extractVideoCode(video.name) ||
              extractVideoCode(video.id) ||
              extractVideoCode(video.url);
            return videoCode === code;
          });
        } catch (err: any) {
          addLog(
            "\u68c0\u67e5\u672c\u5730\u89c6\u9891\u5e93\u91cd\u590d\u5931\u8d25: " + (err?.message || err),
            "WARNING",
          );
        }

        if (duplicateTasks.length > 0 || duplicateVideos.length > 0) {
          const details = [
            duplicateTasks.length > 0
              ? "\u5df2\u6709\u4e0b\u8f7d\u4efb\u52a1: " + duplicateTasks.map((task) => task.name).join(", ")
              : "",
            duplicateVideos.length > 0
              ? "\u672c\u5730\u89c6\u9891\u5e93\u5df2\u6709\u89c6\u9891: " +
                duplicateVideos.map((video) => video.name || video.id || code).join(", ")
              : "",
          ].filter(Boolean);

          const confirmed = window.confirm(
            "\u68c0\u6d4b\u5230\u756a\u53f7 " +
              code +
              " \u5df2\u5b58\u5728\u3002\n" +
              details.join("\n") +
              "\n\n\u662f\u5426\u4ecd\u7136\u6dfb\u52a0\u5f53\u524d\u4efb\u52a1\uff1f",
          );

          if (!confirmed) {
            addLog("\u5df2\u53d6\u6d88\u6dfb\u52a0\u91cd\u590d\u756a\u53f7\u4efb\u52a1: " + code, "WARNING");
            return false;
          }

          addLog("\u7528\u6237\u786e\u8ba4\u6dfb\u52a0\u91cd\u590d\u756a\u53f7\u4efb\u52a1: " + code, "WARNING");
        }
      }

      const newTask: DownloadTask = {
        id: "task-" + Date.now(),
        name: data.name,
        url: data.url,
        status: "PENDING",
        progress: 0,
        speed: 0,
        totalSize: 0,
        downloadedSegments: 0,
        downloadedSize: 0,
        totalSegments: data.totalSegments || 100,
        fileSize: data.fileSize || 0,
        format: data.format,
        threads: data.threads,
        savePath: data.savePath,
        headers: data.headers,
        creationTime: new Date().toISOString(),
        encryptionType: data.encryptionType,
        resolution: data.resolution,
        coverUrl: toProxiedAssetUrl(data.coverUrl) || undefined,
        previewUrl: toProxiedAssetUrl(data.previewUrl) || undefined,
        sourcePageUrl: data.sourcePageUrl || data.pageUrl || undefined,
        referer: data.referer || undefined,
        refererSource: data.refererSource || undefined,
        logs: [
          "[\u7cfb\u7edf] \u4efb\u52a1\u5df2\u521b\u5efa\u3002\u76ee\u6807\u5730\u5740: " + data.url,
          ...(data.referer
            ? [
                `[插件] Referer source: ${data.refererSource || "unknown"} | ${data.referer}`,
              ]
            : []),
        ],
      };

      setTasks((prev) => [newTask, ...prev]);
      setSelectedTaskId(newTask.id);
      addLog(
        "\u5df2\u6dfb\u52a0\u65b0\u4e0b\u8f7d\u4efb\u52a1: " +
          newTask.name +
          " | URL: " +
          newTask.url +
          " | \u683c\u5f0f: " +
          newTask.format +
          " | \u4fdd\u5b58: " +
          newTask.savePath +
          (newTask.referer
            ? " | Referer: " +
              (newTask.refererSource || "unknown") +
              " -> " +
              newTask.referer
            : ""),
        "SUCCESS",
      );

      return true;
    },
    [addLog, settings.video_path],
  );

  useEffect(() => {
    if (!storageLoaded) return;

    const consumePushedTasks = async () => {
      if (consumingExtensionPushesRef.current) return;
      consumingExtensionPushesRef.current = true;

      try {
        const pushedTasks = await trpc.extension.consumePushedTasks.mutate();
        for (const task of pushedTasks as ExtensionPushedTask[]) {
          if (!task?.url) continue;

          addLog(
            `[插件] 收到推送: ${task.name || task.url} | Referer: ${task.refererSource} -> ${task.referer}`,
            "INFO",
          );

          await handleAddNewTask({
            name: task.name || "M3U8 Task",
            url: task.url,
            format: settings.defaultFormat,
            headers: buildExtensionHeaders(task),
            threads: settings.defaultThreads,
            savePath: settings.video_path,
            resolution: task.quality,
            coverUrl: task.coverUrl,
            previewUrl: task.previewUrl,
            sourcePageUrl: task.pageUrl,
            referer: task.referer,
            refererSource: task.refererSource,
          });
        }
      } catch (err: any) {
        addLog(`插件推送队列读取失败: ${err?.message || err}`, "ERROR");
      } finally {
        consumingExtensionPushesRef.current = false;
      }
    };

    void consumePushedTasks();

    const unlisten = window.electronAPI?.extension?.onTaskPushed?.(() => {
      void consumePushedTasks();
    });
    const timer = window.setInterval(() => {
      void consumePushedTasks();
    }, 3000);

    return () => {
      unlisten?.();
      window.clearInterval(timer);
    };
  }, [
    addLog,
    handleAddNewTask,
    settings.defaultFormat,
    settings.defaultThreads,
    settings.video_path,
    storageLoaded,
  ]);

  /* ---- actual task start ---- */
  const startTask = useCallback(
    (id: string) => {
      const t = tasksRef.current.find((x) => x.id === id);
      if (!t) return;
      // 已在下载中则忽略
      if (t.status === "DOWNLOADING" && activeDownloadId.current === t.id)
        return;

      // \u542f\u52a8\u524d\u68c0\u67e5\u76ee\u6807\u76d8\u5269\u4f59\u7a7a\u95f4\uff08<5GB \u7ed9\u8b66\u544a\uff09
      void (async () => {
        try {
          const disk = await trpc.system.getDiskFree.query({ path: t.savePath });
          if (disk.free > 0 && disk.free < 5 * 1024 * 1024 * 1024) {
            const gb = (disk.free / 1024 / 1024 / 1024).toFixed(2);
            addLog(
              `\u26a0\ufe0f \u76ee\u6807\u76d8\u5269\u4f59\u7a7a\u95f4\u4ec5 ${gb} GB\uff0c\u5efa\u8bae\u6e05\u7406\u540e\u518d\u4e0b\u8f7d (${t.savePath})`,
              "WARNING",
            );
          }
        } catch {}
      })();

      activeDownloadId.current = t.id;
      addLog(`\u5f00\u59cb\u4e0b\u8f7d\u4efb\u52a1: ${t.name}`, "INFO");

      // 每个任务创建独立文件夹: {savePath}/{任务名}/
      const taskDir =
        t.savePath.replace(/[\/\\]$/, "") +
        "\\" +
        t.name.replace(/[\\/:*?"<>|]/g, "_");

      setTasks((prev) =>
        prev.map((x) =>
          x.id === id
            ? {
                ...x,
                status: "DOWNLOADING",
                speed: 0,
                logs: [...x.logs, "[操作] 任务已开始/恢复。"],
              }
            : x,
        ),
      );

      trpc.download.start
        .mutate({
          url: t.url,
          saveDir: taskDir,
          saveName: "video",
          format: t.format,
          threads: t.threads,
          headers: t.headers,
          tmpDir: settings.temp_path,
        })
        .catch((err: any) => {
          addLog(`下载启动失败: ${err?.message || err}`, "ERROR");
          if (activeDownloadId.current === t.id) activeDownloadId.current = null;
          setTasks((cur) =>
            cur.map((x) => (x.id === id ? { ...x, status: "FAILED" } : x)),
          );
          // 失败也继续推进队列
          setTimeout(() => startNextRef.current(), 400);
        });
    },
    [addLog, settings.temp_path],
  );

  /* ---- 队列调度：仅在“队列下载”开启时，空闲则启动最早加入的等待任务 ---- */
  const startNextInQueue = useCallback(() => {
    if (!queueEnabledRef.current) return; // 队列下载未开启，不自动推进
    if (activeDownloadId.current) return; // 有任务正在下载，保持串行
    const next = tasksRef.current
      .filter((t) => t.status === "PENDING")
      .sort((a, b) => a.creationTime.localeCompare(b.creationTime))[0];
    if (next) {
      addLog(`队列：开始下载 ${next.name}`, "INFO");
      startTask(next.id);
    }
  }, [addLog, startTask]);

  // 同步最新调度器到 ref，供进度回调使用
  useEffect(() => {
    startNextRef.current = startNextInQueue;
  }, [startNextInQueue]);

  /* ---- pause / resume（队列感知） ---- */
  const handleTriggerPauseResume = useCallback(
    (id: string) => {
      const t = tasksRef.current.find((x) => x.id === id);
      if (!t) return;

      // 暂停正在下载的任务
      if (t.status === "DOWNLOADING") {
        trpc.download.stop.mutate();
        activeDownloadId.current = null;
        setTasks((prev) =>
          prev.map((x) =>
            x.id === id
              ? {
                  ...x,
                  status: "PAUSED",
                  speed: 0,
                  logs: [...x.logs, "[操作] 任务已手动暂停。"],
                }
              : x,
          ),
        );
        return;
      }

      // 开始 / 恢复
      if (t.status === "PAUSED" || t.status === "PENDING") {
        // 已有任务在下载 → 排队等待（串行下载，单进程）
        if (activeDownloadId.current && activeDownloadId.current !== id) {
          setTasks((prev) =>
            prev.map((x) =>
              x.id === id
                ? {
                    ...x,
                    status: "PENDING",
                    logs: [...x.logs, "[队列] 已加入下载队列，等待中…"],
                  }
                : x,
            ),
          );
          addLog(`已加入下载队列：${t.name}`, "INFO");
          return;
        }
        // 空闲 → 立即开始
        startTask(id);
      }
    },
    [addLog, startTask],
  );

  /* ---- delete task ---- */
  const handleDeleteTask = useCallback(
    (id: string) => {
      const task = tasks.find((t) => t.id === id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
      if (selectedTaskId === id) setSelectedTaskId(null);
      addLog(`🗑️ 任务已删除: ${task?.name || id}，临时文件已清理`, "WARNING");

      // 清理 temp 临时文件
      if (task) {
        trpc.download.cleanupTemp.mutate({
          saveDir: task.savePath,
          saveName: task.name,
          tmpDir: settings.temp_path,
        });
      }
    },
    [selectedTaskId, addLog, tasks, settings.temp_path],
  );

  /* ---- 队列下载开关 ---- */
  const handleToggleQueue = useCallback(() => {
    const next = !queueEnabledRef.current;
    queueEnabledRef.current = next; // 立即生效，供下面 startNext 使用
    setQueueEnabled(next);
    if (next) {
      addLog("⚡ 队列下载已开启：将自动逐个下载排队任务", "SUCCESS");
      setTimeout(() => startNextRef.current(), 200);
    } else {
      addLog("⏹️ 队列下载已关闭：不再自动开始下一个任务", "INFO");
    }
  }, [addLog]);

  /* ---- bulk actions ---- */
  const handleStartAll = useCallback(() => {
    // 把所有暂停的任务加入队列，开启队列下载并串行启动（单进程，逐个下载）
    setTasks((prev) =>
      prev.map((t) =>
        t.status === "PAUSED" ? { ...t, status: "PENDING" } : t,
      ),
    );
    queueEnabledRef.current = true;
    setQueueEnabled(true);
    addLog("▶️ 操作: 已开启队列下载并加入全部待下载任务", "INFO");
    setTimeout(() => startNextRef.current(), 300);
  }, [addLog]);

  const handlePauseAll = useCallback(() => {
    // 关闭队列下载，停掉后端当前进程，活动任务与排队任务一并暂停
    queueEnabledRef.current = false;
    setQueueEnabled(false);
    if (activeDownloadId.current) {
      trpc.download.stop.mutate();
      activeDownloadId.current = null;
    }
    setTasks((prev) =>
      prev.map((t) =>
        t.status === "DOWNLOADING" || t.status === "PENDING"
          ? { ...t, status: "PAUSED", speed: 0 }
          : t,
      ),
    );
    addLog("⏸️ 操作: 已暂停全部下载与排队任务", "WARNING");
  }, [addLog]);

  const handleClearCompleted = useCallback(() => {
    setTasks((prev) => {
      const completedCount = prev.filter(
        (t) => t.status === "COMPLETED",
      ).length;
      addLog(
        `🧹 操作: 已清理全部已完成的历史记录 (共 ${completedCount} 条)`,
        "INFO",
      );
      return prev.filter((t) => t.status !== "COMPLETED");
    });
  }, [addLog]);

  /* ---- 选中卡片：自动切到「选中详情」 ---- */
  const handleSelectTask = useCallback((id: string) => {
    setSelectedTaskId(id);
    setActiveSubTab("metadata");
  }, []);

  /* ---- 立即查看（已完成任务跳到播放器） ---- */
  const handlePlayCompleted = useCallback(
    (task: DownloadTask) => {
      if (task.status !== "COMPLETED") return;
      onPlayCompletedTask(task);
    },
    [onPlayCompletedTask],
  );

  /* ---- 重抓封面/预览 ---- */
  const handleRefetchCover = useCallback(
    async (task: DownloadTask) => {
      const codeMatch = task.name.match(/[A-Z]{2,6}-\d{3,5}/i);
      const videoCode = codeMatch
        ? codeMatch[0].toUpperCase()
        : task.name.split(" ")[0];
      const taskDir =
        task.savePath.replace(/[\/\\]$/, "") +
        "\\" +
        task.name.replace(/[\\/:*?"<>|]/g, "_");
      addLog(`正在重新抓取封面和预览: ${task.name} (番号: ${videoCode})...`, "INFO");
      try {
        const r = await trpc.download.downloadCoverPreview.mutate({
          id: videoCode,
          name: task.name,
          saveDir: taskDir,
        });
        addLog(
          r.success ? `封面已重抓: ${task.name}` : `封面重抓失败: ${r.error || ""}`,
          r.success ? "SUCCESS" : "ERROR",
        );
      } catch (err: any) {
        addLog(`封面重抓失败: ${err?.message || err}`, "ERROR");
      }
    },
    [addLog],
  );

  /* ---- copy command ---- */
  const handleCopyCommand = useCallback(
    (e: React.MouseEvent, task: DownloadTask) => {
      e.stopPropagation();
      const command = generateN3u8DLCommand(task);
      navigator.clipboard.writeText(command);
      setCopiedTaskId(task.id);
      addLog(`任务 [${task.name}] 的命令已复制到剪贴板。`, "SUCCESS");
      setTimeout(() => setCopiedTaskId(null), 2000);
    },
    [addLog],
  );

  /* ---- derived (必须在所有回调之前定义) ---- */
  const selectedTask: DownloadTask | null =
    tasks.find((t) => t.id === selectedTaskId) ?? null;
  const filteredTasks = tasks.filter(
    (t) =>
      t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.url.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const handleCopySelectedCommand = useCallback(() => {
    if (!selectedTask) return;
    const command = generateN3u8DLCommand(selectedTask);
    navigator.clipboard.writeText(command);
    setCopiedTaskCmd(true);
    addLog(`任务 [${selectedTask.name}] 的命令行参数已复制。`, "SUCCESS");
    setTimeout(() => setCopiedTaskCmd(false), 2000);
  }, [selectedTask, addLog]);

  /* ---- save settings ---- */
  const handleSaveSettings = useCallback(
    (newSettings: AppSettings) => {
      onSettingsChange(newSettings);
      setShowSettingsModal(false);
    },
    [onSettingsChange],
  );
  const filteredLogs = logs.filter((log) =>
    logFilter === "ALL" ? true : log.level === logFilter,
  );

  // 日志正文颜色：整体压暗到 700 档，柔和不刺眼（警告用 orange 避免与 ERROR 撞色）
  const getLogLevelColor = (level: string) => {
    switch (level) {
      case "SUCCESS":
        return "text-emerald-600";
      case "WARNING":
        return "text-orange-600 font-medium";
      case "ERROR":
        return "text-red-600 font-medium";
      case "DEBUG":
        return "text-sky-600";
      default:
        return "text-slate-600";
    }
  };

  // 级别标签徽章：彩色底+边框，方便快速扫读
  const getLogLevelBadge = (level: string) => {
    switch (level) {
      case "SUCCESS":
        return "bg-emerald-50/70 text-emerald-600 border-emerald-100";
      case "WARNING":
        return "bg-orange-50/70 text-orange-600 border-orange-100";
      case "ERROR":
        return "bg-red-50/70 text-red-600 border-red-100";
      case "DEBUG":
        return "bg-sky-50/70 text-sky-600 border-sky-100";
      default:
        return "bg-slate-100 text-slate-500 border-slate-200";
    }
  };

  const getLogLevelLabel = (level: string) => {
    switch (level) {
      case "SUCCESS":
        return "成功";
      case "WARNING":
        return "警告";
      case "ERROR":
        return "错误";
      case "DEBUG":
        return "调试";
      default:
        return "消息";
    }
  };

  /* ---- render ---- */
  return (
    <div className="h-full flex flex-col min-h-0">
      {/* ====== LEFT: Task List ====== */}
      <div className="flex-1 overflow-y-auto p-6 min-h-50 bg-[#fffaf5] dark:bg-slate-950">
        {/* Queue Control Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-slate-500">
              当前任务队列 ({tasks.length})
            </span>
            {tasks.filter((t) => t.status === "DOWNLOADING").length > 0 && (
              <span className="text-[10px] bg-amber-100 text-amber-700 rounded-full px-2.5 py-0.5 font-mono font-bold">
                {tasks.filter((t) => t.status === "DOWNLOADING").length}{" "}
                任务下载中
              </span>
            )}
            {tasks.filter((t) => t.status === "PENDING").length > 0 && (
              <span className="text-[10px] bg-slate-200 text-slate-600 rounded-full px-2.5 py-0.5 font-mono font-bold">
                {tasks.filter((t) => t.status === "PENDING").length} 个排队中
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative mr-2">
              <input
                type="text"
                placeholder="搜索任务/链接..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-40 sm:w-48 bg-white border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:w-56 focus:border-amber-500 transition-all font-sans shadow-sm"
              />
              <Search className="w-3.5 h-3.5 text-black absolute left-2.5 top-2.5" />
            </div>

            <button
              onClick={() => setShowNewTaskModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 active:scale-95 text-xs text-white font-bold rounded-lg transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              新建任务
            </button>

            {/* 队列下载开关 */}
            <button
              onClick={handleToggleQueue}
              title={queueEnabled ? "点击关闭队列下载" : "点击开启队列下载（完成自动下一个）"}
              className={`flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] w-28 font-bold rounded-lg border transition cursor-pointer ${
                queueEnabled
                  ? "bg-amber-500 border-amber-500 text-white shadow-sm"
                  : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  queueEnabled ? "bg-white animate-pulse" : "bg-slate-300"
                }`}
              />
              队列下载 {queueEnabled ? "ON" : "OFF"}
            </button>

            <button
              onClick={handleStartAll}
              className="px-2.5 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-[11px] text-slate-600 font-semibold rounded-lg transition cursor-pointer"
            >
              全部开始
            </button>

            <button
              onClick={handlePauseAll}
              className="px-2.5 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-[11px] text-slate-600 font-semibold rounded-lg transition cursor-pointer"
            >
              全部暂停
            </button>

            {tasks.some((t) => t.status === "COMPLETED") && (
              <button
                onClick={handleClearCompleted}
                className="px-2.5 py-1.5 bg-white hover:bg-rose-50 border border-rose-200 text-[11px] text-rose-600 font-semibold rounded-lg transition cursor-pointer"
                title="从列表中清空已完成任务"
              >
                清空已完成
              </button>
            )}

            <button
              onClick={() => setShowSettingsModal(true)}
              className="px-2.5 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-[11px] text-slate-600 font-semibold rounded-lg transition cursor-pointer"
              title="系统设置"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Task Grid */}
        {filteredTasks.length === 0 ? (
          <div className="bg-white h-[calc(100%-50px)] rounded-xl border border-slate-200 flex items-center justify-center shadow-sm text-center text-black text-xs">
            <div className="flex flex-col items-center justify-center gap-3">
              <FileVideo className="w-8 h-8 text-slate-300" />
              <div>
                <p className="font-semibold text-slate-600">
                  {searchTerm ? "未找到符合搜索条件的项目" : "当前暂无活动任务"}
                </p>
                <p className="text-[10px] text-black mt-1">
                  {searchTerm
                    ? "试着更改关键字"
                    : '点击右上方 "+ 新建任务" 派发你的第一个 M3U8 下载流'}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
            {filteredTasks.map((task, index) => (
              <TaskCard
                key={task.id}
                task={task}
                index={index}
                isSelected={selectedTaskId === task.id}
                copiedTaskId={copiedTaskId}
                onSelectTask={handleSelectTask}
                onTriggerPauseResume={handleTriggerPauseResume}
                onDeleteTask={handleDeleteTask}
                onCopyCommand={handleCopyCommand}
                onPlayCompleted={handlePlayCompleted}
                onRefetchCover={handleRefetchCover}
              />
            ))}
          </div>
        )}
      </div>

      {/* ====== RIGHT: Diagnostics / Detail Panel ====== */}
      <div className="h-58 bg-[#fffaf5] dark:bg-slate-950 flex flex-col shrink-0 select-text border-t border-slate-200 text-slate-600 font-mono">
        {/* Sub-tabs header */}
        <div className="flex items-center justify-between gap-2 px-3 bg-[#fffaf5] dark:bg-slate-950 border-b border-slate-100 text-xs overflow-x-auto">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setActiveSubTab("console")}
              className={`flex items-center gap-1.5 px-4 py-2 border-b-2 text-black transition cursor-pointer whitespace-nowrap ${
                activeSubTab === "console"
                  ? "border-amber-500 bg-white"
                  : "border-transparent  hover:text-amber-500"
              }`}
            >
              <Terminal className="w-3.5 h-3.5 text-amber-500" />
              控制台日志
            </button>

            <button
              onClick={() => setActiveSubTab("metadata")}
              className={`flex items-center gap-1.5 px-4 py-2 border-b-2 text-black transition cursor-pointer whitespace-nowrap ${
                activeSubTab === "metadata"
                  ? "border-sky-500 bg-[#fffaf5] dark:bg-slate-950"
                  : "border-transparent  hover:text-sky-500"
              }`}
            >
              <Code className="w-3.5 h-3.5 text-sky-500" />
              选中详情
            </button>
          </div>

          <div className="flex items-center gap-2.5 text-[10px] shrink-0">
            {activeSubTab === "console" ? (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="text-black">过滤:</span>
                  <Dropdown
                    value={logFilter}
                    onChange={(v) => setLogFilter(v)}
                    options={[
                      { value: "ALL", label: "全部", dot: "bg-slate-400" },
                      { value: "INFO", label: "消息", dot: "bg-slate-400" },
                      {
                        value: "SUCCESS",
                        label: "成功",
                        dot: "bg-emerald-500",
                      },
                      { value: "WARNING", label: "警告", dot: "bg-orange-500" },
                      { value: "ERROR", label: "错误", dot: "bg-red-500" },
                    ]}
                  />
                </div>

                <label className="flex items-center gap-1.5 text-black cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                    className="rounded border-slate-300 text-amber-500"
                  />
                  自动滚动
                </label>

                <button
                  onClick={() => setLogs([])}
                  className="p-1.5 rounded-lg text-black hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                  title="清空当前日志显示"
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              selectedTask && (
                <span className="text-[10px] bg-[#fffaf5] dark:bg-slate-950 text-slate-500 px-2.5 py-0.5 rounded-full select-none border border-slate-200 font-mono">
                  当前任务 ID: {selectedTask.id}
                </span>
              )
            )}
          </div>
        </div>

        {/* Panel body */}
        <div className="flex flex-1 overflow-y-auto bg-[#fffaf5] dark:bg-slate-950 relative">
          {/* Console logs */}
          {activeSubTab === "console" && (
            <div
              ref={scrollRef}
              className="h-full flex-1 overflow-y-auto space-y-1 text-[10.5px] leading-relaxed select-text bg-[#fffaf5] dark:bg-slate-950 p-4"
            >
              {filteredLogs.length === 0 ? (
                <div className="text-black text-center py-6">
                  暂无诊断消息。执行下载操作时，日志数据将在此实时刷新。
                </div>
              ) : (
                filteredLogs.map((log, index) => (
                  <div
                    key={log.id + index}
                    className="flex gap-2.5 items-start font-mono"
                  >
                    <span className="text-slate-400 font-extralight shrink-0">
                      [{log.timestamp}]
                    </span>
                    <span
                      className={`text-[10px] border px-1.5 rounded select-none shrink-0 font-semibold ${getLogLevelBadge(log.level)}`}
                    >
                      {getLogLevelLabel(log.level)}
                    </span>
                    <span
                      className={`${getLogLevelColor(log.level)} break-all`}
                    >
                      {log.text}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Metadata detail */}
          {activeSubTab === "metadata" && (
            <div className="h-full overflow-y-auto space-y-3 text-xs p-4">
              {selectedTask ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2 text-slate-600">
                    <div>
                      <span className="text-black">视频名称:</span>{" "}
                      <span className="text-slate-600 font-bold">
                        {selectedTask.name}
                      </span>
                    </div>
                    <div className="break-all">
                      <span className="text-black">HLS 请求地址:</span>{" "}
                      <span className="text-amber-700 text-[11px] focus:select-all font-mono">
                        {selectedTask.url}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div>
                        <span className="text-black">合并文件格式:</span>{" "}
                        <span className="text-emerald-700 font-bold ml-1">
                          {selectedTask.format}
                        </span>
                      </div>
                      <div>
                        <span className="text-black">下载速度:</span>{" "}
                        <span className="text-amber-700 font-bold ml-1">
                          {formatSpeed(selectedTask.speed)}
                        </span>
                      </div>
                      <div>
                        <span className="text-black">文件大小:</span>{" "}
                        <span className="text-amber-700 font-bold ml-1">
                          {selectedTask.totalSize > 0
                            ? `${formatBytes(selectedTask.downloadedSize)} / ${formatBytes(selectedTask.totalSize)}`
                            : selectedTask.fileSize > 0
                              ? formatBytes(selectedTask.fileSize)
                              : "计算中..."}
                        </span>
                      </div>
                      <div>
                        <span className="text-black">片段进度:</span>{" "}
                        <span className="text-emerald-700 font-bold ml-1">
                          {selectedTask.downloadedSegments > 0 &&
                          selectedTask.totalSegments > 0
                            ? `${selectedTask.downloadedSegments} / ${selectedTask.totalSegments}`
                            : `${selectedTask.progress.toFixed(1)}%`}
                        </span>
                      </div>
                      <div>
                        <span className="text-black">流加密类型:</span>{" "}
                        <span className="text-purple-700 font-bold ml-1">
                          {selectedTask.encryptionType === "NONE"
                            ? "未加密"
                            : selectedTask.encryptionType || "AES-128"}
                        </span>
                      </div>
                      <div>
                        <span className="text-black">视频流质量:</span>{" "}
                        <span className="text-sky-700 font-bold ml-1">
                          {selectedTask.resolution || "1080p 自适应"}
                        </span>
                      </div>
                    </div>
                    <div>
                      <span className="text-black">持久保存目录:</span>{" "}
                      <span className="text-slate-600 text-[11px] font-mono select-all bg-slate-50 p-1 px-2 rounded-lg inline-block mt-1 border border-slate-200">
                        {selectedTask.savePath}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2 bg-slate-50 border border-slate-200 p-4 rounded-xl flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-slate-600 font-sans font-bold text-[10px] flex items-center gap-1.5">
                          <Shield className="w-3.5 h-3.5 text-amber-600" />
                          N_m3u8DL-RE 运行命令封装
                        </span>
                        <button
                          onClick={handleCopySelectedCommand}
                          className="flex items-center gap-1 px-2.5 py-1 bg-white text-amber-700 hover:text-amber-800 rounded-md border border-slate-200 hover:bg-amber-50 transition font-sans text-[10px] cursor-pointer"
                          title="复制终端命令"
                        >
                          {copiedTaskCmd ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              已复制!
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              复制
                            </>
                          )}
                        </button>
                      </div>
                      <p className="text-[10px] leading-relaxed text-black font-sans">
                        可以拷贝此参数字符串在本地桌面安装了 N_m3u8DL-RE &
                        FFmpeg 的终端中执行，效果等同：
                      </p>
                    </div>
                    <div className="bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 text-[10px] font-mono text-amber-700 select-all break-all overflow-y-auto max-h-[70px]">
                      {generateN3u8DLCommand(selectedTask)}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-black text-center p-4">
                  未选中任何下载任务，请在列表轻点一个任务项目以查看其全栈流元数据信息。
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ====== Modals ====== */}
      {showNewTaskModal && (
        <NewTaskModal
          onClose={() => setShowNewTaskModal(false)}
          onAddTask={handleAddNewTask}
          defaultSavePath={settings.video_path}
          defaultFormat={settings.defaultFormat}
          defaultThreads={settings.defaultThreads}
        />
      )}

      {showSettingsModal && (
        <SettingsPanel
          settings={settings}
          onSaveSettings={handleSaveSettings}
          onAddSystemLog={onAddSystemLog}
          onClose={() => setShowSettingsModal(false)}
        />
      )}
    </div>
  );
}
