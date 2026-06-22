/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { trpc } from "../lib/trpc";
import { thumbnailQueue } from "../lib/thumbnailQueue";
import {
  Plus,
  FileVideo,
  Copy,
  Check,
  Search,
  Settings,
  EyeOff,
  X,
} from "lucide-react";
import { NewTaskModal } from "../components/download/NewTaskModal";
import { SettingsPanel } from "../components/download/SettingsPanel";
import { TaskCard } from "../components/download/TaskCard";
import { DownloadFloatingBall } from "../components/download/DownloadFloatingBall";
import { PageLoader } from "../components/PageLoader";
import type {
  AppSettings,
  DownloadBackground,
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

const PRIVACY_BACKGROUNDS: DownloadBackground[] = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
];

const PRIVACY_PARTICLES = [
  [-42, -34],
  [-26, -52],
  [4, -58],
  [32, -44],
  [52, -18],
  [58, 12],
  [38, 42],
  [8, 58],
  [-24, 50],
  [-52, 26],
  [-62, -4],
  [-54, -30],
  [-16, -22],
  [18, -24],
  [28, 4],
  [12, 28],
  [-22, 22],
  [-32, 0],
] as const;

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
  logs,
  setLogs,
  addLog,
}: DownloadPageProps) {
  /* ---- state ---- */
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [storageLoaded, setStorageLoaded] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showNewTaskModal, setShowNewTaskModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [copiedTaskId, setCopiedTaskId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [copiedTaskCmd, setCopiedTaskCmd] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [flashTaskId, setFlashTaskId] = useState<string | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  const [privacyScreenActive, setPrivacyScreenActive] = useState(false);
  const [privacyScreenLeaving, setPrivacyScreenLeaving] = useState(false);
  const [privacyBackground, setPrivacyBackground] =
    useState<DownloadBackground>(settings.downloadBackground ?? "1");

  const tasksRef = useRef(tasks);
  const startTaskRef = useRef<((id: string) => void) | null>(null);
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
  // 队列调度器引用（供进度回调在 useEffect 内调用最新版本）
  const startNextRef = useRef<() => void>(() => {});
  const privacyIdleTimerRef = useRef<number | null>(null);
  const privacyExitTimerRef = useRef<number | null>(null);

  const hidePrivacyScreen = useCallback(() => {
    if (!privacyScreenActive || privacyScreenLeaving) return;
    setPrivacyScreenLeaving(true);
    if (privacyExitTimerRef.current) {
      window.clearTimeout(privacyExitTimerRef.current);
    }
    privacyExitTimerRef.current = window.setTimeout(() => {
      setPrivacyScreenActive(false);
      setPrivacyScreenLeaving(false);
      privacyExitTimerRef.current = null;
    }, 620);
  }, [privacyScreenActive, privacyScreenLeaving]);

  useEffect(() => {
    return () => {
      if (privacyExitTimerRef.current) {
        window.clearTimeout(privacyExitTimerRef.current);
      }
    };
  }, []);

  const showPrivacyScreen = useCallback(() => {
    if (!settingsRef.current.privacyScreenEnabled) return;
    if (privacyExitTimerRef.current) {
      window.clearTimeout(privacyExitTimerRef.current);
      privacyExitTimerRef.current = null;
    }
    setPrivacyBackground(settingsRef.current.downloadBackground ?? "1");
    setPrivacyScreenLeaving(false);
    setPrivacyScreenActive(true);
  }, []);

  useEffect(() => {
    if (privacyIdleTimerRef.current) {
      window.clearTimeout(privacyIdleTimerRef.current);
      privacyIdleTimerRef.current = null;
    }

    if (!settings.privacyScreenEnabled) {
      hidePrivacyScreen();
      return;
    }

    const resetIdleTimer = () => {
      if (privacyIdleTimerRef.current) {
        window.clearTimeout(privacyIdleTimerRef.current);
      }
      if (showSettingsModal) return;
      const delay = Math.max(
        5,
        settingsRef.current.privacyScreenIdleSeconds ?? 60,
      );
      privacyIdleTimerRef.current = window.setTimeout(
        showPrivacyScreen,
        delay * 1000,
      );
    };

    const handleActivity = () => {
      hidePrivacyScreen();
      resetIdleTimer();
    };

    const handleWindowBlur = () => {
      if (showSettingsModal) return;
      if (settingsRef.current.privacyScreenOnBlur) {
        showPrivacyScreen();
      }
    };

    const events: Array<keyof WindowEventMap> = [
      "mousedown",
      "mousemove",
      "keydown",
      "touchstart",
      "wheel",
    ];

    events.forEach((eventName) =>
      window.addEventListener(eventName, handleActivity, { passive: true }),
    );
    window.addEventListener("blur", handleWindowBlur);
    resetIdleTimer();

    return () => {
      if (privacyIdleTimerRef.current) {
        window.clearTimeout(privacyIdleTimerRef.current);
        privacyIdleTimerRef.current = null;
      }
      events.forEach((eventName) =>
        window.removeEventListener(eventName, handleActivity),
      );
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [
    settings.privacyScreenEnabled,
    settings.privacyScreenIdleSeconds,
    settings.privacyScreenOnBlur,
    showPrivacyScreen,
    hidePrivacyScreen,
    showSettingsModal,
  ]);

  useEffect(() => {
    if (!privacyScreenActive) return;

    const intervalSeconds = Math.max(
      3,
      settings.privacyScreenChangeSeconds ?? 10,
    );
    const timer = window.setInterval(() => {
      setPrivacyBackground((current) => {
        const currentIndex = PRIVACY_BACKGROUNDS.indexOf(current);
        const nextIndex =
          currentIndex >= 0
            ? (currentIndex + 1) % PRIVACY_BACKGROUNDS.length
            : 0;
        return PRIVACY_BACKGROUNDS[nextIndex];
      });
    }, intervalSeconds * 1000);

    return () => window.clearInterval(timer);
  }, [privacyScreenActive, settings.privacyScreenChangeSeconds]);

  const generateThumbsForCompletedTask = useCallback(
    async (taskDir: string, taskName: string) => {
      const cached = await trpc.videos.hasThumbs.query({ folder: taskDir });
      if (cached.exists) {
        addLog(`进度条片段图已存在，跳过生成: ${taskName}`, "INFO");
        return;
      }
      addLog(`已入刻度图后台队列: ${taskName}`, "INFO");
      thumbnailQueue.enqueue({ name: taskName, folderPath: taskDir });
    },
    [addLog],
  );

  // 队列下载开关：开启后完成一个会自动下一个；关闭则需手动点单个任务
  const [queueEnabled, setQueueEnabled] = useState(false);
  const queueEnabledRef = useRef(queueEnabled);
  queueEnabledRef.current = queueEnabled;

  // 应用启动时，上次会话遗留的“下载中/解析中”进程其实已不存在，重置为暂停，避免假象
  useEffect(() => {
    setTasks((prev) =>
      prev.some((t) => t.status === "DOWNLOADING" || t.status === "PARSING")
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
        setTasks(
          Array.isArray(state.tasks) ? (state.tasks as DownloadTask[]) : [],
        );
        if (Array.isArray(state.logs)) {
          setLogs(state.logs as LogMessage[]);
        }
      })
      .catch((err: any) => {
        if (disposed) return;
        addLog(`Electron 存储读取失败: ${err?.message || err}`, "ERROR");
      })
      .finally(() => {
        if (!disposed) setStorageLoaded(true);
      });

    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 防抖落盘
  useEffect(() => {
    if (!storageLoaded) return;
    const timer = window.setTimeout(() => {
      void trpc.storage.saveDownloadState.mutate({ tasks, logs });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [logs, storageLoaded, tasks]);

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

    // ===== 进度合并器：把高频 IPC 事件批处理成 ~5fps 的一次 setTasks =====
    // 不是 done 的事件全部进 pending；done 事件立刻 flush。
    // 这样 100 个任务 + 每秒几十条日志也不会触发 100 次全表 re-render。
    type Pending = {
      progress?: number;
      speed?: number;
      totalSize?: number;
      downloadedSize?: number;
      downloadedSegments?: number;
      totalSegments?: number;
      logLines: string[];
    };
    const pendingByTask = new Map<string, Pending>();
    let flushTimer: number | null = null;

    const flushPending = () => {
      if (pendingByTask.size === 0) {
        flushTimer = null;
        return;
      }
      // 把所有 pending 一次性 apply 到 tasks 上
      const snapshot = new Map(pendingByTask);
      pendingByTask.clear();
      flushTimer = null;
      setTasks((prev) =>
        prev.map((t) => {
          const p = snapshot.get(t.id);
          if (!p) return t;
          const next: typeof t = { ...t };
          if (p.progress != null) next.progress = p.progress;
          if (p.speed != null) next.speed = p.speed;
          if (p.totalSize != null) next.totalSize = p.totalSize;
          if (p.downloadedSize != null) next.downloadedSize = p.downloadedSize;
          if (p.downloadedSegments != null)
            next.downloadedSegments = p.downloadedSegments;
          if (p.totalSegments != null) next.totalSegments = p.totalSegments;
          if (p.logLines.length > 0) {
            // 一次合并多行日志，且只保留尾部 200 条
            next.logs = [...t.logs, ...p.logLines].slice(-200);
          }
          return next;
        }),
      );
    };

    const scheduleFlush = () => {
      if (flushTimer != null) return;
      flushTimer = window.setTimeout(flushPending, 200);
    };

    const handleProgress = (
      _event: any,
      data: {
        line: string;
        percent: number | null;
        done: boolean;
        success: boolean;
        taskId?: string;
      },
    ) => {
      if (disposed) return;
      const { line, percent, done, success } = data;
      const id = data.taskId || null;

      const info = parseProgressInfo(line);

      // 任务栏进度条：节流 250ms
      if (id && !done && info.percent != null) {
        const now = Date.now();
        if (now - lastTaskbarPushRef.current >= 250) {
          lastTaskbarPushRef.current = now;
          void trpc.system.setTaskbarProgress
            .mutate({ progress: Math.max(0, Math.min(1, info.percent / 100)) })
            .catch(() => {});
        }
      }

      // 非 done 事件 → 进 pending；done 事件 → 立即 flush 再处理完成
      if (id && !done) {
        let p = pendingByTask.get(id);
        if (!p) {
          p = { logLines: [] };
          pendingByTask.set(id, p);
        }
        const effPercent =
          info.percent != null ? info.percent : percent != null ? percent : null;
        if (effPercent != null) p.progress = effPercent;
        if (info.speed != null) p.speed = info.speed;
        if (info.totalSize != null) p.totalSize = info.totalSize;
        if (info.downloadedSize != null) p.downloadedSize = info.downloadedSize;
        if (info.downloadedSegments != null)
          p.downloadedSegments = info.downloadedSegments;
        if (info.totalSegments != null) p.totalSegments = info.totalSegments;
        if (line) {
          // 限制单批日志缓存上限，避免极端情况下 pending 自己也变巨大
          if (p.logLines.length < 40) p.logLines.push(line);
        }
        scheduleFlush();
      }

      // done 事件 → 先把 pending 落地，再单独更新该任务为完成态
      if (id && done) {
        // 把当前任务的 pending 也并入
        const p = pendingByTask.get(id);
        pendingByTask.delete(id);
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== id) return t;
            const merged: typeof t = { ...t };
            if (p) {
              if (p.totalSize != null) merged.totalSize = p.totalSize;
              if (p.downloadedSize != null) merged.downloadedSize = p.downloadedSize;
              if (p.downloadedSegments != null)
                merged.downloadedSegments = p.downloadedSegments;
              if (p.totalSegments != null) merged.totalSegments = p.totalSegments;
            }
            merged.status = success ? "COMPLETED" : "FAILED";
            merged.progress = success ? 100 : merged.progress;
            merged.speed = 0;
            const extraLines = [...(p?.logLines ?? []), line].filter(Boolean);
            if (extraLines.length > 0) {
              merged.logs = [...t.logs, ...extraLines].slice(-200);
            }
            return merged;
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
        const finished = id;
        // 仅在没有其他下载中任务时清任务栏进度
        const stillRunning = tasksRef.current.some(
          (t) => t.id !== finished && t.status === "DOWNLOADING",
        );
        addLog(
          success
            ? "下载任务已完成并合并。"
            : `下载任务结束（任务 ${finished ?? ""}）。`,
          success ? "SUCCESS" : "WARNING",
        );

        // 清除任务栏进度（仅最后一个收尾的任务）
        if (!stillRunning) {
          void trpc.system.setTaskbarProgress
            .mutate({ progress: -1 })
            .catch(() => {});
        }

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
            const completedBytes =
              task.totalSize || task.fileSize || task.downloadedSize || 0;
            void trpc.stats.recordDownload
              .mutate({ bytes: completedBytes })
              .catch(() => {});

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
            void generateThumbsForCompletedTask(taskDir, task.name).catch(
              (err: any) => {
                addLog(
                  `进度条片段图生成失败: ${task.name} - ${err?.message || err}`,
                  "ERROR",
                );
              },
            );
            trpc.download.downloadCoverPreview.mutate({
              id: videoCode, // 使用番号而非 task.id
              name: task.name,
              saveDir: taskDir,
              customCoverUrl: task.coverUrl || undefined,
              skipPreview: true,
            });
            // 写 meta.json（离线层：番号 + 文件信息 + 来源 URL）
            void trpc.meta.writeForTask
              .mutate({
                saveDir: taskDir,
                rawName: task.name,
                sourceUrl: task.url,
                referer: task.referer,
                refererSource: task.refererSource,
                resolution: task.resolution,
                encryptionType: task.encryptionType,
                format: task.format,
              })
              .then((r: any) => {
                if (r.success && r.meta) {
                  addLog(
                    `meta.json 已写入${r.meta.code ? `（番号: ${r.meta.code}）` : "（未识别番号）"}`,
                    r.meta.code ? "SUCCESS" : "WARNING",
                  );
                }
              })
              .catch((err: any) => {
                addLog(`meta.json 写入失败: ${err?.message || err}`, "ERROR");
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
      if (flushTimer != null) {
        window.clearTimeout(flushTimer);
        flushTimer = null;
      }
      pendingByTask.clear();
      unlisten();
    };
  }, [addLog, generateThumbsForCompletedTask]);

  /* ---- add new task ---- */
  const handleAddNewTask = useCallback(
    async (data: any): Promise<boolean> => {
      const code = extractVideoCode(data.name) || extractVideoCode(data.url);

      if (code) {
        const duplicateTasks = tasksRef.current.filter((task) => {
          const taskCode =
            extractVideoCode(task.name) || extractVideoCode(task.url);
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
            "\u68c0\u67e5\u672c\u5730\u89c6\u9891\u5e93\u91cd\u590d\u5931\u8d25: " +
              (err?.message || err),
            "WARNING",
          );
        }

        if (duplicateTasks.length > 0 || duplicateVideos.length > 0) {
          const details = [
            duplicateTasks.length > 0
              ? "\u5df2\u6709\u4e0b\u8f7d\u4efb\u52a1: " +
                duplicateTasks.map((task) => task.name).join(", ")
              : "",
            duplicateVideos.length > 0
              ? "\u672c\u5730\u89c6\u9891\u5e93\u5df2\u6709\u89c6\u9891: " +
                duplicateVideos
                  .map((video) => video.name || video.id || code)
                  .join(", ")
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
            addLog(
              "\u5df2\u53d6\u6d88\u6dfb\u52a0\u91cd\u590d\u756a\u53f7\u4efb\u52a1: " +
                code,
              "WARNING",
            );
            return false;
          }

          addLog(
            "\u7528\u6237\u786e\u8ba4\u6dfb\u52a0\u91cd\u590d\u756a\u53f7\u4efb\u52a1: " +
              code,
            "WARNING",
          );
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
        scheduledAt:
          data.taskTag === "SCHEDULED" ||
          (!!data.scheduledAt && data.scheduledEnabled !== false)
            ? data.scheduledAt
            : undefined,
        scheduledEnabled:
          data.taskTag === "SCHEDULED" ||
          (!!data.scheduledAt && data.scheduledEnabled !== false)
            ? true
            : undefined,
        taskTag:
          data.taskTag === "SCHEDULED" ||
          (!!data.scheduledAt && data.scheduledEnabled !== false)
            ? "SCHEDULED"
            : "NORMAL",
        logs: [
          "[\u7cfb\u7edf] \u4efb\u52a1\u5df2\u521b\u5efa\u3002\u76ee\u6807\u5730\u5740: " +
            data.url,
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
        (newTask.taskTag === "SCHEDULED" ? "\u5df2\u6dfb\u52a0\u5b9a\u65f6\u4efb\u52a1" : "\u5df2\u6dfb\u52a0\u65b0\u4e0b\u8f7d\u4efb\u52a1") +
          ": " +
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
            : "") +
          (newTask.taskTag === "SCHEDULED" && newTask.scheduledAt
            ? " | \u23f0 " + new Date(newTask.scheduledAt).toLocaleString()
            : ""),
        "SUCCESS",
      );

      return true;
    },
    [addLog, settings.video_path],
  );

  // ---- 定时任务调度器：每 30 秒检查一次，到期的 PENDING 任务自动启动 ----
  useEffect(() => {
    if (!storageLoaded) return;
    const tick = () => {
      const now = Date.now();
      const dueTasks = tasksRef.current.filter(
        (t) =>
          t.status === "PENDING" &&
          t.taskTag === "SCHEDULED" &&
          t.scheduledEnabled !== false &&
          t.scheduledAt &&
          new Date(t.scheduledAt).getTime() <= now,
      );
      if (dueTasks.length === 0) return;

      const dueIds = dueTasks.map((t) => t.id);
      // 先把到期任务的状态改成 SCHEDULED_STARTED（避免下一轮 tick 重复触发）
      setTasks((prev) =>
        prev.map((t) =>
          dueIds.includes(t.id)
            ? {
                ...t,
                scheduledEnabled: false,
                logs: [
                  ...t.logs,
                  `[\u23f0 \u8c03\u5ea6] \u5df2\u5230\u8fbe\u542f\u52a8\u65f6\u95f4 (${new Date().toLocaleString()})\uff0c\u81ea\u52a8\u5f00\u59cb\u4e0b\u8f7d`,
                ],
              }
            : t,
        ),
      );
      setTimeout(() => {
        dueIds.forEach((id, idx) => {
          setTimeout(() => {
            // 通过 ref 拿到最新的 startTask（即使此 useEffect 在 startTask 声明之前写）
            startTaskRef.current?.(id);
          }, idx * 800);
        });
      }, 120);
    };

    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, [storageLoaded]);

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
      if (t.status === "DOWNLOADING") return;

      // \u542f\u52a8\u524d\u68c0\u67e5\u76ee\u6807\u76d8\u5269\u4f59\u7a7a\u95f4\uff08<5GB \u7ed9\u8b66\u544a\uff09
      void (async () => {
        try {
          const disk = await trpc.system.getDiskFree.query({
            path: t.savePath,
          });
          if (disk.free > 0 && disk.free < 5 * 1024 * 1024 * 1024) {
            const gb = (disk.free / 1024 / 1024 / 1024).toFixed(2);
            addLog(
              `\u26a0\ufe0f \u76ee\u6807\u76d8\u5269\u4f59\u7a7a\u95f4\u4ec5 ${gb} GB\uff0c\u5efa\u8bae\u6e05\u7406\u540e\u518d\u4e0b\u8f7d (${t.savePath})`,
              "WARNING",
            );
          }
        } catch {}
      })();

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

      // 异步触发后端 spawn，不阻塞 UI（即使任务很多也只是排进 tRPC 队列即可）
      void trpc.download.start
        .mutate({
          taskId: t.id,
          url: t.url,
          saveDir: taskDir,
          saveName: "video",
          format: t.format,
          threads: t.threads,
          headers: t.headers,
          tmpDir: settings.temp_path,
          maxSpeed: settings.globalSpeedLimit,
        })
        .catch((err: any) => {
          addLog(`下载启动失败: ${err?.message || err}`, "ERROR");
          setTasks((cur) =>
            cur.map((x) => (x.id === id ? { ...x, status: "FAILED" } : x)),
          );
          // 失败也继续推进队列
          setTimeout(() => startNextRef.current(), 400);
        });
    },
    [addLog, settings.temp_path, settings.globalSpeedLimit],
  );
  // 把 startTask 存入 ref，供调度器（写在更早的 useEffect 里）使用
  startTaskRef.current = startTask;

  /* ---- 并发上限解析：Infinity = 不限制 ---- */
  const resolveConcurrencyLimit = useCallback((): number => {
    const limit = settingsRef.current.maxConcurrentTasks;
    if (limit == null || Number.isNaN(limit) || limit <= 0) return Infinity;
    return limit;
  }, []);

  /* ---- 调度器：根据队列开关与并发上限启动等待中的任务 ---- */
  const startNextInQueue = useCallback(() => {
    const downloadingCount = tasksRef.current.filter(
      (t) => t.status === "DOWNLOADING",
    ).length;
    // 队列开启 → 串行（最多 1 个）；关闭 → 并发上限 = maxConcurrentTasks（Infinity 表示不限制）
    const limit = queueEnabledRef.current
      ? 1
      : resolveConcurrencyLimit();
    const toStart = limit === Infinity ? Infinity : limit - downloadingCount;
    if (toStart <= 0) return;
    const pending = tasksRef.current
      .filter((t) => t.status === "PENDING")
      .sort((a, b) => a.creationTime.localeCompare(b.creationTime));
    const actualStart =
      limit === Infinity ? pending.length : Math.min(toStart, pending.length);
    if (actualStart === 0) return;
    for (let i = 0; i < actualStart; i++) {
      const next = pending[i];
      addLog(
        queueEnabledRef.current
          ? `队列：开始下载 ${next.name}`
          : `并发启动: ${next.name}`,
        "INFO",
      );
      // 用 setTimeout 0 把每个 start 推到下一个 tick，避免一次性 setTasks 太多
      const id = next.id;
      setTimeout(() => startTask(id), 0);
    }
  }, [addLog, startTask, resolveConcurrencyLimit]);

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
        void trpc.download.stop.mutate({ taskId: id });
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
        const downloadingCount = tasksRef.current.filter(
          (x) => x.status === "DOWNLOADING",
        ).length;
        const limit = queueEnabledRef.current
          ? 1
          : resolveConcurrencyLimit();
        if (limit !== Infinity && downloadingCount >= limit) {
          // 已达并发上限 → 进队列等待
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
    // 把所有暂停的任务标记为 PENDING，由调度器按当前队列开关+并发上限分批启动
    setTasks((prev) =>
      prev.map((t) =>
        t.status === "PAUSED" ? { ...t, status: "PENDING" } : t,
      ),
    );
    const limit = resolveConcurrencyLimit();
    const limitLabel = limit === Infinity ? "无上限" : String(limit);
    addLog(
      queueEnabledRef.current
        ? "▶️ 操作: 全部加入队列下载，逐个开始"
        : `▶️ 操作: 全部加入并发下载（并发上限 ${limitLabel}）`,
      "INFO",
    );
    setTimeout(() => startNextRef.current(), 100);
  }, [addLog, resolveConcurrencyLimit]);

  const handlePauseAll = useCallback(() => {
    // 关闭队列下载，停掉后端所有进程，活动任务与排队任务一并暂停
    queueEnabledRef.current = false;
    setQueueEnabled(false);
    void trpc.download.stop.mutate({});
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

  /* ---- 选中卡片：打开下方详情抽屉 ---- */
  const handleSelectTask = useCallback((id: string) => {
    setSelectedTaskId(id);
    setDetailOpen(true);
  }, []);

  /* ---- 跳转并高亮指定任务卡片 ---- */
  const handleJumpToTask = useCallback((id: string) => {
    setSelectedTaskId(id);
    const el = document.getElementById(`task-card-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    setFlashTaskId(id);
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => {
      setFlashTaskId(null);
      flashTimerRef.current = null;
    }, 1800);
  }, []);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    };
  }, []);

  /* ---- 立即查看（已完成任务跳到播放器） ---- */
  const handlePlayCompleted = useCallback(
    (task: DownloadTask) => {
      if (task.status !== "COMPLETED") return;
      onPlayCompletedTask(task);
    },
    [onPlayCompletedTask],
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
  const selectedTask: DownloadTask | null = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId],
  );
  const filteredTasks = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter(
      (t) =>
        t.name.toLowerCase().includes(q) || t.url.toLowerCase().includes(q),
    );
  }, [tasks, searchTerm]);
  const downloadBackgroundUrl = `./${settings.downloadBackground ?? "1"}.webp`;
  const privacyBackgroundUrl = `./${privacyBackground}.webp`;
  const legacyPrivacySettings = settings as AppSettings & {
    privacyScreenDim?: number;
  };
  const privacyBlur = Math.max(
    0,
    Math.min(32, settings.privacyScreenBlur ?? 0),
  );
  const privacyImageOpacity =
    Math.max(
      0,
      Math.min(
        100,
        settings.privacyScreenImageOpacity ??
          legacyPrivacySettings.privacyScreenDim ??
          42,
      ),
    ) / 100;

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
  /* ---- render ---- */
  return (
    <div className="relative h-full flex flex-col min-h-0 overflow-hidden">
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          key={`blur-${downloadBackgroundUrl}`}
          className="download-bg-layer absolute -inset-10 bg-cover bg-center blur-2xl"
          style={{
            ["--bg-opacity" as string]: 0.7,
            ["--bg-scale" as string]: 1.1,
            backgroundImage: `url("${downloadBackgroundUrl}")`,
          }}
        />
        <div
          key={`main-${downloadBackgroundUrl}`}
          className="download-bg-layer absolute inset-0 bg-cover bg-center"
          style={{
            ["--bg-opacity" as string]: 0.42,
            ["--bg-scale" as string]: 1.03,
            backgroundImage: `url("${downloadBackgroundUrl}")`,
          }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_16%,rgba(255,255,255,0.20),transparent_34%),radial-gradient(circle_at_82%_18%,rgba(255,255,255,0.12),transparent_30%),linear-gradient(135deg,rgba(255,250,245,0.38),rgba(248,250,252,0.22)_52%,rgba(255,241,242,0.24))] dark:bg-[radial-gradient(circle_at_18%_16%,rgba(244,63,94,0.08),transparent_34%),radial-gradient(circle_at_82%_18%,rgba(14,165,233,0.08),transparent_30%),linear-gradient(135deg,rgba(2,6,23,0.58),rgba(15,23,42,0.42)_52%,rgba(25,7,17,0.38))]" />
      </div>
      <PageLoader active={!storageLoaded} label="加载任务列表" />

      {/* ====== Task List (scrollable) ====== */}
      <div className="relative z-10 flex-1 overflow-y-scroll pt-0 min-h-50 bg-white/4 dark:bg-slate-950/10">
        {/* ====== Sticky Toolbar ====== */}
        <div className="shrink-0 mb-4 p-3 pt-4 sticky top-0 bg-white/4 dark:bg-slate-950/10 backdrop-blur-sm z-99">
          {/* Queue Control Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-slate-500 dark:text-white bg-slate-200/50 rounded-full px-2.5 py-0.5">
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
                  className="w-40 sm:w-48 bg-white border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:w-56 focus:border-amber-500 transition-all shadow-sm"
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

              <button
                onClick={showPrivacyScreen}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-[11px] text-slate-600 font-semibold rounded-lg transition cursor-pointer"
                title="立即开启隐私屏保，遮住下载内容"
              >
                <EyeOff className="w-3.5 h-3.5" />
                隐私屏保
              </button>

              {/* 队列下载开关 */}
              <button
                onClick={handleToggleQueue}
                title={
                  queueEnabled
                    ? "点击关闭队列下载"
                    : "点击开启队列下载（完成自动下一个）"
                }
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

        </div>
        {/* Task Grid */}
        {filteredTasks.length === 0 ? (
          <div className="bg-white h-[calc(100%-50px)] p-3 pt-0 rounded-xl border border-slate-200 flex items-center justify-center shadow-sm text-center text-black text-xs">
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
          <div className="grid gap-4 p-3 pt-0 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
            {filteredTasks.map((task, index) => (
              <TaskCard
                key={task.id}
                task={task}
                index={index}
                isSelected={selectedTaskId === task.id}
                isFlashing={flashTaskId === task.id}
                copiedTaskId={copiedTaskId}
                onSelectTask={handleSelectTask}
                onTriggerPauseResume={handleTriggerPauseResume}
                onDeleteTask={handleDeleteTask}
                onCopyCommand={handleCopyCommand}
                onPlayCompleted={handlePlayCompleted}
              />
            ))}
          </div>
        )}
      </div>

      {/* ====== 选中详情抽屉（可关闭） ====== */}
      {detailOpen &&
        selectedTask &&
        (() => {
          const sizeText =
            selectedTask.totalSize > 0
              ? `${formatBytes(selectedTask.downloadedSize)} / ${formatBytes(selectedTask.totalSize)}`
              : selectedTask.fileSize > 0
                ? formatBytes(selectedTask.fileSize)
                : "—";
          const segText =
            selectedTask.downloadedSegments > 0 &&
            selectedTask.totalSegments > 0
              ? `${selectedTask.downloadedSegments} / ${selectedTask.totalSegments}`
              : `${selectedTask.progress.toFixed(1)}%`;
          const encText =
            selectedTask.encryptionType === "NONE"
              ? "未加密"
              : selectedTask.encryptionType || "AES-128";

          const Stat = ({
            label,
            value,
          }: {
            label: string;
            value: React.ReactNode;
          }) => (
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 font-sans">
                {label}
              </span>
              <span className="text-[12px] font-semibold text-slate-800 dark:text-slate-100 font-mono truncate">
                {value}
              </span>
            </div>
          );

          return (
            <div className="relative z-10 h-58 bg-white/86 dark:bg-slate-900/86 backdrop-blur-xl flex flex-col shrink-0 select-text border-t border-white/60 dark:border-slate-800/80 text-slate-600 dark:text-slate-300 anim-fade-in">
              {/* 头部 */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 dark:border-slate-800 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                    {selectedTask.name}
                  </span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono shrink-0">
                    #{selectedTask.id.slice(0, 8)}
                  </span>
                </div>
                <button
                  onClick={() => setDetailOpen(false)}
                  className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                  title="关闭"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* 内容 */}
              <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-4">
                {/* 左：元信息 */}
                <div className="flex flex-col gap-3 min-w-0">
                  {/* 统计行 */}
                  <div className="grid grid-cols-3 gap-3 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                    <Stat label="格式" value={selectedTask.format} />
                    <Stat
                      label="质量"
                      value={selectedTask.resolution || "1080p"}
                    />
                    <Stat label="加密" value={encText} />
                    <Stat label="大小" value={sizeText} />
                    <Stat label="片段" value={segText} />
                    <Stat
                      label="速度"
                      value={formatSpeed(selectedTask.speed)}
                    />
                  </div>

                  {/* 链接 / 路径 */}
                  <div className="space-y-1.5">
                    <div className="flex items-start gap-2 text-[11px]">
                      <span className="shrink-0 text-[9px] uppercase tracking-wider text-slate-400 mt-0.5 w-10">
                        HLS
                      </span>
                      <span className="font-mono text-slate-700 dark:text-slate-300 break-all select-all leading-snug">
                        {selectedTask.url}
                      </span>
                    </div>
                    <div className="flex items-start gap-2 text-[11px]">
                      <span className="shrink-0 text-[9px] uppercase tracking-wider text-slate-400 mt-0.5 w-10">
                        DIR
                      </span>
                      <span className="font-mono text-slate-700 dark:text-slate-300 break-all select-all leading-snug">
                        {selectedTask.savePath}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 右：终端命令 */}
                <div className="flex flex-col min-w-0 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-[#0d1117]">
                  <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800/70 bg-[#161b22]">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-[#ff5f56]" />
                      <span className="w-2 h-2 rounded-full bg-[#ffbd2e]" />
                      <span className="w-2 h-2 rounded-full bg-[#27c93f]" />
                      <span className="ml-2 text-[10px] font-mono text-slate-400">
                        N_m3u8DL-RE
                      </span>
                    </div>
                    <button
                      onClick={handleCopySelectedCommand}
                      className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-slate-300 hover:text-white hover:bg-white/10 rounded transition cursor-pointer"
                      title="复制终端命令"
                    >
                      {copiedTaskCmd ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          已复制
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          复制
                        </>
                      )}
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto px-3 py-2 text-[11px] font-mono text-slate-200 leading-relaxed select-all break-all">
                    <span className="text-emerald-400">$</span>{" "}
                    {generateN3u8DLCommand(selectedTask)}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

      {privacyScreenActive && (
        <button
          type="button"
          onClick={hidePrivacyScreen}
          className={`privacy-screen fixed inset-0 z-40 cursor-pointer overflow-hidden bg-[#050507] text-white ${
            privacyScreenLeaving ? "is-leaving" : "is-entering"
          }`}
          title="点击返回"
        >
          <div className="privacy-particles absolute inset-0 z-20 pointer-events-none">
            {PRIVACY_PARTICLES.map(([x, y], index) => (
              <span
                key={`${x}-${y}-${index}`}
                style={{
                  ["--px" as string]: `${x}vw`,
                  ["--py" as string]: `${y}vh`,
                  ["--pd" as string]: `${index * 18}ms`,
                }}
              />
            ))}
          </div>
          <div
            key={privacyBackgroundUrl}
            className="privacy-screen-image absolute -inset-16 bg-cover bg-center"
            style={{
              ["--privacy-opacity" as string]: privacyImageOpacity,
              backgroundImage: `url("${privacyBackgroundUrl}")`,
              filter: `blur(${privacyBlur}px)`,
            }}
          />
          <div className="privacy-screen-vignette absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(255,255,255,0.10),transparent_34%),linear-gradient(180deg,rgba(0,0,0,0.08),rgba(0,0,0,0.24))]" />
          <div className="privacy-screen-copy relative z-10 flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <EyeOff className="h-8 w-8 text-white/70" />
            <div className="text-sm font-bold tracking-[0.28em] text-white/85">
              PRIVACY SCREEN
            </div>
            <div className="max-w-sm text-xs leading-relaxed text-white/56">
              下载内容已遮挡。点击或按任意键返回。
            </div>
          </div>
        </button>
      )}

      {/* ====== 下载悬浮球（在刻度图浮球左侧 80px 处）====== */}
      <DownloadFloatingBall
        tasks={tasks}
        onJumpToTask={handleJumpToTask}
        bottomOffset={16}
        rightOffset={88}
      />

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
