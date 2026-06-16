/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useVirtualizer } from "@tanstack/react-virtual";
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { trpc } from "../lib/trpc";
import { LocalVideoCard } from "../components/player/LocalVideoCard";
import { LuckyDraw } from "../components/player/LuckyDraw";
import { HlsVideoPlayer } from "../components/player/HlsVideoPlayer";
import { WhisperPanel } from "../components/whisper/WhisperPanel";
import type { PlayerPageProps, VideoItem } from "./player/types";
import { PageLoader } from "../components/PageLoader";
import { ResumePrompt } from "../components/player/ResumePrompt";
import { RepairModal, type RepairTarget } from "../components/player/RepairModal";

const LAST_PLAYED_KEY = "av-play-pro:lastPlayed";
const FAVORITES_KEY = "av-play-pro:favorites";

function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function saveFavorites(set: Set<string>): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(set)));
  } catch {
    /* ignore */
  }
}
interface LastPlayedRecord {
  name: string;
  url: string;
  currentTime: number;
  savedAt: number;
}
import {
  Play,
  FileVideo,
  Radio,
  RefreshCw,
  ChevronDown,
  Search,
  X,
  Trash2,
  Gift,
  Captions,
  Wrench,
  Heart,
} from "lucide-react";
import {
  deriveFolderFromUrl,
  pathToLocalMediaUrl,
  generateAndSaveThumbnails,
} from "../lib/thumbnails";

function inferSeriesName(name: string): string {
  const code = name.match(/[A-Z]{2,8}-?\d{2,6}/i)?.[0];
  if (!code) return "未分类";
  return code.replace("-", "").replace(/\d+$/, "").toUpperCase() || "未分类";
}

function toSubtitleMediaUrl(srtPath: string): string {
  return `${pathToLocalMediaUrl(srtPath)}?t=${Date.now()}`;
}

export function PlayerPage({
  videoPath,
  onAddSystemLog,
  pendingPlayName,
  onConsumePendingPlay,
  onActiveVideoChange,
}: PlayerPageProps) {
  // 当前激活的 <video> 元素（由 HlsVideoPlayer 通过 onVideoEl 回调暴露给统计逻辑）
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  // 当前缩略图 VTT 路径（异步解析后再传给播放器）
  const [previewVttUrl, setPreviewVttUrl] = useState<string | null>(null);
  // 当前字幕 URL（whisper 生成的 video.srt 自动加载）
  const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null);

  // 当前播放流信息
  const [activeStream, setActiveStream] = useState({
    name: "等待选择视频...",
    url: "",
    resolution: "--",
    encryptionType: "--",
    referer: "",
  });

  // HLS analyzer inputs
  const [analyzerUrl, setAnalyzerUrl] = useState("");
  const [analyzerReferer, setAnalyzerReferer] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [parsedData, setParsedData] = useState<any>(null);
  const [isAnalyzerCollapsed, setIsAnalyzerCollapsed] = useState(true);

  // 删除确认弹窗
  const [deleteTarget, setDeleteTarget] = useState<VideoItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // 抽奖弹窗
  const [luckyOpen, setLuckyOpen] = useState(false);
  // Whisper 字幕面板
  const [whisperOpen, setWhisperOpen] = useState(false);
  // 修复面板（单个 / 全部）
  const [repairTargets, setRepairTargets] = useState<RepairTarget[] | null>(null);
  const [repairMode, setRepairMode] = useState<"single" | "all">("all");

  // 本地视频列表
  const [localVideos, setLocalVideos] = useState<VideoItem[]>([]);
  const [videoSearchQuery, setVideoSearchQuery] = useState("");

  // 心爱（收藏）：用 id 集合管理；持久化到 localStorage
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites());
  const [showOnlyFavorites, setShowOnlyFavorites] = useState(false);

  const toggleFavorite = useCallback(
    (video: VideoItem) => {
      setFavorites((prev) => {
        const next = new Set(prev);
        if (next.has(video.id)) {
          next.delete(video.id);
          onAddSystemLog(`已取消心爱: ${video.name}`, "INFO");
        } else {
          next.add(video.id);
          onAddSystemLog(`已加入心爱: ${video.name}`, "SUCCESS");
        }
        saveFavorites(next);
        return next;
      });
    },
    [onAddSystemLog],
  );

  // 搜索 + 心爱过滤
  const filteredVideos = useMemo(() => {
    let list = localVideos;
    if (showOnlyFavorites) list = list.filter((v) => favorites.has(v.id));
    const q = videoSearchQuery.toLowerCase().trim();
    if (q) list = list.filter((v) => v.name.toLowerCase().includes(q));
    return list;
  }, [localVideos, videoSearchQuery, showOnlyFavorites, favorites]);
  const [isLoadingVideos, setIsLoadingVideos] = useState(false);
  const [selectedVideoIndex, setSelectedVideoIndex] = useState<number | null>(
    null,
  );

  // 当前选中视频的本地文件真实路径（解开 local-media:///）— 供 Whisper 等模块用
  const currentVideoPath = useMemo(() => {
    if (selectedVideoIndex == null) return null;
    const v = filteredVideos[selectedVideoIndex];
    if (!v?.url) return null;
    try {
      const decoded = decodeURIComponent(
        v.url.replace(/^(file|local-media):\/\/\//, ""),
      );
      return decoded.replace(/\//g, "\\");
    } catch {
      return null;
    }
  }, [filteredVideos, selectedVideoIndex]);
  const currentVideoName = useMemo(
    () =>
      selectedVideoIndex != null
        ? (filteredVideos[selectedVideoIndex]?.name ?? null)
        : null,
    [filteredVideos, selectedVideoIndex],
  );

  // 虚拟滚动
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: filteredVideos.length,
    getScrollElement: () => listScrollRef.current,
    estimateSize: () => 230, // 卡片实际高度（aspect-video ~191px + info ~50px + padding + gap）
    overscan: 4,
  });

  // 是否由用户显式触发了播放（点击列表 / 续播 / 跨页跳转 / 推入解析流）。
  // 仅在用户主动播放时才允许自动播放 + 生成缩略图，避免进入页面就卡住或自动开播。
  const [userInitiated, setUserInitiated] = useState(false);
  // 上次播放记录提示
  const [resumePrompt, setResumePrompt] = useState<LastPlayedRecord | null>(
    null,
  );
  // 待 seek 的恢复时间（在新视频 loadedmetadata 后跳转）
  const pendingResumeSeekRef = useRef<number | null>(null);
  // 是否已尝试过续播提示（避免重复弹）
  const resumeChecked = useRef(false);
  const statsPlayedUrlRef = useRef("");
  const pendingWatchSecRef = useRef(0);
  const lastWatchTickRef = useRef<number | null>(null);
  const handledSubtitleJobIdsRef = useRef<Set<string>>(new Set());

  const recordPlayStats = useCallback(
    (folder: string, url: string) => {
      if (!folder || !url || statsPlayedUrlRef.current === url) return;
      statsPlayedUrlRef.current = url;
      void trpc.stats.recordPlay
        .mutate({ folder, series: inferSeriesName(folder) })
        .catch((err: any) => {
          onAddSystemLog(`播放统计写入失败: ${err?.message || err}`, "WARNING");
        });
    },
    [onAddSystemLog],
  );

  const refreshSubtitleForActiveStream = useCallback(async () => {
    if (!activeStream.url) {
      setSubtitleUrl(null);
      return;
    }
    const folder = deriveFolderFromUrl(activeStream.url);
    if (!folder) {
      setSubtitleUrl(null);
      return;
    }
    try {
      const sr = await trpc.whisper.hasSubtitle.query({ folder });
      if (sr.exists && sr.srtPath) {
        setSubtitleUrl(toSubtitleMediaUrl(sr.srtPath));
      } else {
        setSubtitleUrl(null);
      }
    } catch (err: any) {
      onAddSystemLog(`字幕检测失败: ${err?.message || err}`, "WARNING");
    }
  }, [activeStream.url, onAddSystemLog]);

  // 当 activeStream.url 变化时:解析缩略图（VTT 路径），HlsVideoPlayer 会基于 key 重挂载并自行加载源
  useEffect(() => {
    if (!activeStream.url) {
      setPreviewVttUrl(null);
      setSubtitleUrl(null);
      return;
    }
    let cancelled = false;
    setPreviewVttUrl(null);
    setSubtitleUrl(null);

    (async () => {
      const folder = deriveFolderFromUrl(activeStream.url);
      let vtt: string | null = null;
      if (folder) {
        try {
          const r = await trpc.videos.hasThumbs.query({ folder });
          if (cancelled) return;
          if (r.exists) vtt = pathToLocalMediaUrl(r.vttPath);
        } catch {
          /* ignore */
        }
        // 字幕检测
        try {
          const sr = await trpc.whisper.hasSubtitle.query({ folder });
          if (!cancelled && sr.exists && sr.srtPath) {
            setSubtitleUrl(toSubtitleMediaUrl(sr.srtPath));
          }
        } catch {
          /* ignore */
        }
      }

      if (!cancelled) setPreviewVttUrl(vtt);

      // 没有缓存:后台异步生成,完成下次播放生效
      // 仅在用户主动播放当前视频时才生成（默认进入页面、自动选中第一个视频时不生成，避免卡顿）
      if (userInitiated && !vtt && folder && !activeStream.url.includes(".m3u8")) {
        const name = activeStream.name;
        onAddSystemLog(`开始生成缩略图: ${name}`, "INFO");
        generateAndSaveThumbnails({
          videoUrl: activeStream.url,
          folder,
          onProgress: (done, total) => {
            if (done === total || done % 20 === 0) {
              onAddSystemLog(
                `缩略图生成中 [${done}/${total}]: ${name}`,
                "INFO",
              );
            }
          },
        })
          .then((r) => {
            onAddSystemLog(
              `缩略图已生成: ${name} (${r.count} 帧, ${r.spriteSizeKB} KB)`,
              "SUCCESS",
            );
            if (!cancelled) {
              setPreviewVttUrl(pathToLocalMediaUrl(`${folder}\\thumbs.vtt`));
            }
          })
          .catch((err) =>
            onAddSystemLog(
              `缩略图生成失败: ${name} - ${err?.message || err}`,
              "ERROR",
            ),
          );
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStream.url]);

  useEffect(() => {
    const off = (window as any).electronAPI?.whisper?.onJobUpdate?.(
      (jobs: any[]) => {
        const hasNewFinishedSubtitle = jobs.some((job) => {
          if (job.status !== "done" || !job.srtPath || !job.id) return false;
          if (handledSubtitleJobIdsRef.current.has(job.id)) return false;
          handledSubtitleJobIdsRef.current.add(job.id);
          return true;
        });
        if (hasNewFinishedSubtitle) {
          void refreshSubtitleForActiveStream();
        }
      },
    );
    return () => off?.();
  }, [refreshSubtitleForActiveStream]);

  useEffect(() => {
    const el = videoEl;
    if (!el || !activeStream.url) return;

    const folder = activeStream.name || "未知视频";
    const series = inferSeriesName(folder);
    pendingWatchSecRef.current = 0;
    lastWatchTickRef.current = null;

    const flushWatch = () => {
      const sec = pendingWatchSecRef.current;
      if (sec <= 0) return;
      pendingWatchSecRef.current = 0;
      void trpc.stats.recordWatch
        .mutate({ folder, series, sec })
        .then((r: any) => {
          onAddSystemLog(
            `观看 +${sec}s 已记录 [${folder}] 累计 ${r?.totalSec ?? "?"}s`,
            "INFO",
          );
        })
        .catch((err: any) => {
          onAddSystemLog(
            `观看时长统计写入失败: ${err?.message || err}`,
            "WARNING",
          );
        });
      // 同步保存"上次播放"记录
      try {
        const record: LastPlayedRecord = {
          name: folder,
          url: activeStream.url,
          currentTime: el.currentTime || 0,
          savedAt: Date.now(),
        };
        localStorage.setItem(LAST_PLAYED_KEY, JSON.stringify(record));
      } catch {
        /* ignore */
      }
    };

    // 用 video.currentTime 增量作为权威来源，回避 paused 状态判断误差
    let lastCurrentTime = -1;
    const addElapsedWatch = () => {
      if (el.ended) {
        lastWatchTickRef.current = null;
        lastCurrentTime = -1;
        return;
      }
      if (el.paused) {
        lastWatchTickRef.current = null;
        lastCurrentTime = -1;
        return;
      }

      const ct = el.currentTime;
      if (lastCurrentTime >= 0) {
        const delta = ct - lastCurrentTime;
        // 0.3s < delta < 5s 视为正常自然播放；seek 跳跃或卡顿过滤掉
        if (delta > 0.3 && delta < 5) {
          pendingWatchSecRef.current += delta;
        }
      }
      lastCurrentTime = ct;
      lastWatchTickRef.current = Date.now();

      if (pendingWatchSecRef.current >= 5) {
        flushWatch();
      }
    };

    const recordPlayOnce = () => {
      recordPlayStats(folder, activeStream.url);
    };

    const onPlay = () => {
      recordPlayOnce();
      lastWatchTickRef.current = Date.now();
    };

    const onStop = () => {
      addElapsedWatch();
      flushWatch();
      lastWatchTickRef.current = null;
    };

    el.addEventListener("play", onPlay);
    el.addEventListener("playing", onPlay);
    el.addEventListener("pause", onStop);
    el.addEventListener("ended", onStop);
    // 500ms 高频采样，更精确捕获 currentTime 变化
    const timer = window.setInterval(addElapsedWatch, 500);

    return () => {
      addElapsedWatch();
      flushWatch();
      window.clearInterval(timer);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("playing", onPlay);
      el.removeEventListener("pause", onStop);
      el.removeEventListener("ended", onStop);
    };
  }, [
    videoEl,
    activeStream.name,
    activeStream.url,
    onAddSystemLog,
    recordPlayStats,
  ]);

  // 上次播放：localVideos 加载完成后弹一次提示
  useEffect(() => {
    if (resumeChecked.current) return;
    if (!localVideos.length) return;
    resumeChecked.current = true;
    try {
      const raw = localStorage.getItem(LAST_PLAYED_KEY);
      if (!raw) return;
      const r = JSON.parse(raw) as LastPlayedRecord;
      if (!r?.url || !r?.name) return;
      // 7 天内才提示
      if (Date.now() - r.savedAt > 7 * 24 * 3600 * 1000) return;
      // 必须能在当前视频列表里找到
      if (!localVideos.some((v) => v.url === r.url || v.name === r.name))
        return;
      // 进度 < 5s 没必要续播
      if ((r.currentTime || 0) < 5) return;
      setResumePrompt(r);
    } catch {
      /* ignore */
    }
  }, [localVideos]);

  // 续播 seek：videoEl 就绪后跳转到保存的时间并播放
  useEffect(() => {
    if (!videoEl) return;
    if (pendingResumeSeekRef.current == null) return;
    const target = pendingResumeSeekRef.current;
    const doSeek = () => {
      try {
        videoEl.currentTime = target;
        const p = videoEl.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      } catch {
        /* ignore */
      }
      pendingResumeSeekRef.current = null;
    };
    if (videoEl.readyState >= 1) {
      doSeek();
    } else {
      videoEl.addEventListener("loadedmetadata", doSeek, { once: true });
    }
  }, [videoEl]);

  const handleResume = useCallback(() => {
    if (!resumePrompt) return;
    const target = filteredVideos.findIndex(
      (v) => v.url === resumePrompt.url || v.name === resumePrompt.name,
    );
    const fallback = localVideos.find(
      (v) => v.url === resumePrompt.url || v.name === resumePrompt.name,
    );
    const video = target >= 0 ? filteredVideos[target] : fallback || null;
    if (!video) {
      setResumePrompt(null);
      return;
    }
    pendingResumeSeekRef.current = resumePrompt.currentTime || 0;
    if (target >= 0) {
      setSelectedVideoIndex(target);
      // 右侧列表滚动到该视频位置
      requestAnimationFrame(() => {
        try {
          rowVirtualizer.scrollToIndex(target, { align: "center" });
        } catch {
          /* ignore */
        }
      });
    }
    recordPlayStats(video.name, video.url);
    setActiveStream({
      name: video.name,
      url: video.url,
      resolution: video.resolution,
      encryptionType: video.encryptionType || "未检测",
      referer: "",
    });
    setUserInitiated(true); // 允许 HlsVideoPlayer autoPlay
    setResumePrompt(null);
    onAddSystemLog(
      `从 ${resumePrompt.currentTime.toFixed(0)}s 续播: ${video.name}`,
      "INFO",
    );
  }, [
    resumePrompt,
    filteredVideos,
    localVideos,
    recordPlayStats,
    onAddSystemLog,
  ]);

  // 通知上层当前播放的视频名（私密计时关联用）
  useEffect(() => {
    onActiveVideoChange?.(activeStream.url ? activeStream.name : null);
  }, [activeStream.name, activeStream.url, onActiveVideoChange]);

  // HlsVideoPlayer 通过 onMeta 上报真实像素
  const handleMeta = useCallback((info: { width: number; height: number }) => {
    if (info.width > 0 && info.height > 0) {
      setActiveStream((s) => ({
        ...s,
        resolution: `${info.width}×${info.height}`,
      }));
    }
  }, []);

  // 「立即查看」：等本地视频列表加载完毕后,按 name 匹配并自动播放
  useEffect(() => {
    if (!pendingPlayName || localVideos.length === 0) return;
    const target = localVideos.findIndex((v) => v.name === pendingPlayName);
    if (target >= 0) {
      setUserInitiated(true); // 跳转过来直接自动播放
      handleLoadLocalVideo(localVideos[target], target);
      onConsumePendingPlay?.();
    }
    // 找不到时不消费，等下次 refreshVideoList 后再试
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPlayName, localVideos]);

  // 本地路径转 file:// 协议（直接在前端转换，不需要走 IPC）
  const convertLocalPath = (filePath: string): string => {
    if (
      !filePath ||
      filePath.startsWith("http") ||
      filePath.startsWith("local-media://") ||
      filePath.startsWith("cdn://")
    )
      return filePath;
    const normalized = filePath.replace(/\\/g, "/");
    const segments = normalized.split("/");
    const encodedSegments = segments.map((seg, index) => {
      // 如果是 Windows 盘符 (如 "M:")，不进行编码，避免变成 M%3A
      if (index === 0 && /^[a-zA-Z]:$/.test(seg)) {
        return seg;
      }
      return encodeURIComponent(seg);
    });
    return `local-media:///${encodedSegments.join("/")}`;
  };

  // Fetch local videos on mount
  useEffect(() => {
    refreshVideoList();
  }, [videoPath]);

  // 列表数据变化时把滚动条归位
  useEffect(() => {
    if (listScrollRef.current) listScrollRef.current.scrollTop = 0;
    rowVirtualizer.scrollToIndex(0);
  }, [localVideos, videoSearchQuery]);

  const videoToRepairTarget = useCallback(
    (v: VideoItem): RepairTarget => {
      const normalized = decodeURIComponent(
        v.url.replace(/^(file|local-media):\/\/\//, ""),
      ).replace(/\//g, "\\");
      const lastSlash = normalized.lastIndexOf("\\");
      const folderPath =
        lastSlash > 0 ? normalized.substring(0, lastSlash) : normalized;
      return { name: v.name, folderPath, videoFilePath: normalized };
    },
    [],
  );

  const openRepairForVideo = useCallback(
    (v: VideoItem) => {
      setRepairMode("single");
      setRepairTargets([videoToRepairTarget(v)]);
    },
    [videoToRepairTarget],
  );

  const openRepairForAll = useCallback(() => {
    if (localVideos.length === 0) {
      onAddSystemLog("本地库为空，无可修复内容", "WARNING");
      return;
    }
    setRepairMode("all");
    setRepairTargets(localVideos.map(videoToRepairTarget));
  }, [localVideos, onAddSystemLog, videoToRepairTarget]);

  // 修复封面：为没有封面的视频从 CDN 下载封面和预览
  const handleFixCovers = async () => {
    const videosWithoutCover = localVideos.filter((v) => !v.coverUrl);
    if (videosWithoutCover.length === 0) {
      onAddSystemLog("所有视频都已有封面，无需修复。", "INFO");
      return;
    }
    onAddSystemLog(
      `开始修复封面，共 ${videosWithoutCover.length} 个视频需要处理...`,
      "INFO",
    );
    let fixed = 0;
    for (const video of videosWithoutCover) {
      const codeMatch = video.name.match(/[A-Z]{2,6}-\d{3,5}/i);
      if (!codeMatch) continue;
      const code = codeMatch[0].toLowerCase();
      // 从视频 url 提取其所在文件夹路径（url 段经过 encodeURIComponent，需先解码）
      const normalized = decodeURIComponent(
        video.url.replace(/^(file|local-media):\/\/\//, ""),
      ).replace(/\//g, "\\");
      const lastSlash = normalized.lastIndexOf("\\");
      const folderPath =
        lastSlash > 0 ? normalized.substring(0, lastSlash) : normalized;
      try {
        await trpc.download.downloadCoverPreview.mutate({
          id: code.toUpperCase(),
          name: video.name,
          saveDir: folderPath,
        });
        fixed++;
        onAddSystemLog(`封面已修复: ${video.name}`, "SUCCESS");
      } catch (err) {
        onAddSystemLog(`修复封面失败: ${video.name}`, "ERROR");
      }
    }
    onAddSystemLog(
      `封面修复完成，成功处理 ${fixed}/${videosWithoutCover.length} 个视频。`,
      "SUCCESS",
    );
    await refreshVideoList();
  };

  // 回填 meta.json（旧视频）。按住 Shift 点击 = 强制覆盖重写
  const [isBackfilling, setIsBackfilling] = useState(false);
  const handleBackfillMeta = async (e: React.MouseEvent) => {
    if (isBackfilling) return;
    if (!videoPath) {
      onAddSystemLog("未配置视频路径", "ERROR");
      return;
    }
    const overwrite = e.shiftKey;
    setIsBackfilling(true);
    onAddSystemLog(
      `开始扫描${overwrite ? "并强制覆盖" : ""}元数据: ${videoPath}`,
      "INFO",
    );
    try {
      const r = await trpc.meta.backfill.mutate({
        rootPath: videoPath,
        overwrite,
      });
      if ((r as any).error) {
        onAddSystemLog(`回填失败: ${(r as any).error}`, "ERROR");
      } else {
        onAddSystemLog(
          `回填完成: 扫描 ${r.scanned} | 新增 ${r.written} | 跳过 ${r.skipped} | 未识别番号 ${r.unmatched} | 失败 ${r.failed}`,
          r.failed > 0 ? "WARNING" : "SUCCESS",
        );
        if (!overwrite && r.skipped === r.scanned && r.scanned > 0) {
          onAddSystemLog(
            "所有文件夹都已存在 meta.json,未做改动。如需重新生成请按住 Shift 再点击「刷新」。",
            "WARNING",
          );
        }
        if (r.unmatched > 0) {
          const samples = r.details
            .filter((d) => d.status === "unmatched")
            .slice(0, 5)
            .map((d) => d.folder)
            .join(", ");
          onAddSystemLog(`未识别番号样例: ${samples}`, "WARNING");
        }
      }
    } catch (err: any) {
      onAddSystemLog(`回填异常: ${err?.message || err}`, "ERROR");
    } finally {
      await refreshVideoList();
      setIsBackfilling(false);
    }
  };

  // 删除视频
  const handleDeleteVideo = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      // 从 url 提取文件夹路径: file:///M:/video/videos/xxx/video.mp4 -> M:\video\videos\xxx
      const urlPath = deleteTarget.url;
      const normalized = decodeURIComponent(
        urlPath.replace(/^(file|local-media):\/\/\//, ""),
      ).replace(/\//g, "\\");
      // 取最后一个 \ 之前的部分作为文件夹路径
      const lastSlash = normalized.lastIndexOf("\\");
      const folderPath =
        lastSlash > 0 ? normalized.substring(0, lastSlash) : normalized;

      const result = await trpc.videos.delete.mutate({
        folderPath,
        rootPath: videoPath,
      });
      if (result.success) {
        onAddSystemLog(`已删除视频: ${deleteTarget.name}`, "SUCCESS");
        // 如果删除的是当前播放的视频，清空播放器
        if (
          selectedVideoIndex !== null &&
          localVideos[selectedVideoIndex]?.id === deleteTarget.id
        ) {
          setSelectedVideoIndex(null);
          setActiveStream({
            name: "未选择视频",
            url: "",
            resolution: "",
            encryptionType: "",
            referer: "",
          });
        }
        setDeleteTarget(null);
        await refreshVideoList();
      } else {
        onAddSystemLog(`删除失败: ${result.error}`, "ERROR");
      }
    } catch (err: any) {
      onAddSystemLog(`删除失败: ${err?.message || err}`, "ERROR");
    } finally {
      setIsDeleting(false);
    }
  };

  const refreshVideoList = async () => {
    setIsLoadingVideos(true);
    try {
      const rawVideos = await trpc.videos.list.query({ path: videoPath });

      // 转换所有本地路径为 file:// 协议
      const videos: VideoItem[] = rawVideos.map((v: any) => ({
        ...v,
        url: convertLocalPath(v.url),
        coverUrl: v.coverUrl ? convertLocalPath(v.coverUrl) : undefined,
        previewUrl: v.previewUrl ? convertLocalPath(v.previewUrl) : undefined,
      }));

      setLocalVideos(videos);

      // 默认选中第一个视频，但不自动播放
      if (videos.length > 0) {
        setSelectedVideoIndex(0);
        setActiveStream({
          name: videos[0].name,
          url: videos[0].url,
          resolution: videos[0].resolution,
          encryptionType: videos[0].encryptionType || "未检测",
          referer: "",
        });

        onAddSystemLog(
          `已从本地目录 加载 ${videos.length} 个视频文件`,
          "SUCCESS",
        );
      } else {
        onAddSystemLog(`本地目录 [${videoPath}] 中未检测到视频文件`, "WARNING");
      }
    } catch (err) {
      onAddSystemLog(`加载本地视频列表失败: ${err}`, "ERROR");
    } finally {
      setIsLoadingVideos(false);
    }
  };

  const handleLoadLocalVideo = useCallback(
    (video: VideoItem, index: number) => {
      setSelectedVideoIndex(index);
      setUserInitiated(true);
      recordPlayStats(video.name, video.url);
      setActiveStream({
        name: video.name,
        url: video.url,
        resolution: video.resolution,
        encryptionType: video.encryptionType || "未检测",
        referer: "",
      });
      onAddSystemLog(`正在播放本地视频: ${video.name}`, "SUCCESS");
    },
    [onAddSystemLog, recordPlayStats],
  );

  const handleParseM3u8List = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = analyzerUrl.trim();
    if (!raw) return;

    setIsParsing(true);
    setParsedData(null);
    onAddSystemLog(`正在解析 HLS 列表: ${raw}`, "INFO");

    // 走 cdn:// 代理（surrit/fourhoi 等域名需要 Referer，否则直接 fetch 会 403）
    const toProxied = (u: string) => {
      const proxied = u
        .replace(/^https?:\/\/(([\w-]+\.)*surrit\.com)/i, "cdn://$1")
        .replace(/^https?:\/\/(([\w-]+\.)*surrit\.org)/i, "cdn://$1")
        .replace(/^https?:\/\/(([\w-]+\.)*fourhoi\.com)/i, "cdn://$1");
      const referer = analyzerReferer.trim();
      if (!referer || !proxied.startsWith("cdn://")) return proxied;
      try {
        const parsed = new URL(proxied.replace(/^cdn:\/\//i, "https://"));
        parsed.searchParams.set("__avp_referer", referer);
        return `cdn://${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
      } catch {
        return proxied;
      }
    };

    const formatBps = (bps: number) => {
      if (!bps || !isFinite(bps)) return "—";
      if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`;
      if (bps >= 1_000) return `${(bps / 1_000).toFixed(1)} Kbps`;
      return `${bps} bps`;
    };

    try {
      const fetchUrl = toProxied(raw);
      const headers = analyzerReferer.trim()
        ? { "x-avp-referer": analyzerReferer.trim() }
        : undefined;
      const resp = await fetch(fetchUrl, { headers });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      if (!text.includes("#EXTM3U")) throw new Error("响应不是有效的 m3u8");

      const lines = text.split(/\r?\n/);
      const isMaster = lines.some((l) => l.startsWith("#EXT-X-STREAM-INF"));

      const title = raw.split("/").slice(-2).join("/");
      let encryption = "未加密";
      const keyLine = lines.find((l) => l.startsWith("#EXT-X-KEY"));
      if (keyLine) {
        const method = keyLine.match(/METHOD=([A-Z0-9-]+)/i)?.[1];
        if (method && method !== "NONE") encryption = method;
      }

      let tracks: { resolution: string; bandwidth: string }[] = [];
      let segmentsCount = 0;

      if (isMaster) {
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          if (l.startsWith("#EXT-X-STREAM-INF")) {
            const bw = parseInt(l.match(/BANDWIDTH=(\d+)/)?.[1] || "0", 10);
            const res = l.match(/RESOLUTION=([\dx]+)/)?.[1] || "—";
            tracks.push({ resolution: res, bandwidth: formatBps(bw) });
          }
        }
        tracks.sort((a, b) => {
          const ay = parseInt(a.resolution.split("x")[1] || "0", 10);
          const by = parseInt(b.resolution.split("x")[1] || "0", 10);
          return by - ay;
        });
      } else {
        segmentsCount = lines.filter((l) => l.startsWith("#EXTINF")).length;
        // 媒体清单本身只代表一条轨道，尝试从路径推分辨率
        const resHint = raw.match(/(\d{3,4})p/i)?.[1];
        tracks = [
          {
            resolution: resHint ? `${resHint}p` : "—",
            bandwidth: `${segmentsCount} 段`,
          },
        ];
      }

      setParsedData({
        success: true,
        title,
        encryption,
        segmentsCount,
        tracks,
        isMaster,
      });
      onAddSystemLog(
        `HLS 解析完成: ${isMaster ? "主清单" : "媒体清单"} · ${tracks.length} 轨道${segmentsCount ? ` · ${segmentsCount} 段` : ""}`,
        "SUCCESS",
      );
    } catch (err: any) {
      onAddSystemLog(`HLS 解析失败: ${err?.message || err}`, "ERROR");
      setParsedData(null);
    } finally {
      setIsParsing(false);
    }
  };

  const handleLoadParsedStream = () => {
    if (!parsedData) return;
    setUserInitiated(true);
    setActiveStream({
      name: parsedData.title,
      url: analyzerUrl,
      resolution: parsedData.tracks[0].resolution,
      encryptionType: parsedData.encryption,
      referer: analyzerReferer.trim(),
    });
    onAddSystemLog(`已载入主播放器: ${parsedData.title}`, "SUCCESS");
  };

  return (
    <div className="relative flex-1 flex overflow-hidden bg-[#fffaf5] h-full">
      <PageLoader
        active={isLoadingVideos && localVideos.length === 0}
        label="加载视频库"
      />
      {resumePrompt && (
        <ResumePrompt
          videoName={resumePrompt.name}
          currentTime={resumePrompt.currentTime}
          savedAt={resumePrompt.savedAt}
          onResume={handleResume}
          onClose={() => setResumePrompt(null)}
        />
      )}
      {/* LEFT SECTION: MAIN VIDEO PLAYER (Plyr) */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0 p-6 bg-transparent">
        {/* TITLE HEADER */}
        <div className="mb-4 flex items-center justify-between select-none shrink-0">
          <div className="overflow-hidden mr-4">
            <h3 className="text-sm font-bold text-slate-800 truncate flex items-center gap-2 select-text">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              {activeStream.name}
            </h3>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[9px] bg-white text-amber-500 font-mono font-bold py-1 px-3 rounded border border-slate-200">
              分辨率: {activeStream.resolution}
            </span>
          </div>
        </div>

        {/* PLYR VIDEO PLAYER */}
        <div className="relative flex flex-1 w-full bg-black rounded-xl overflow-hidden border border-slate-200/80 shadow-lg">
          {activeStream.url ? (
            <div
              key={`${activeStream.url}|${activeStream.referer}`}
              className="anim-player-mount absolute inset-0 flex"
            >
              <HlsVideoPlayer
                url={activeStream.url}
                autoPlay={userInitiated}
                referer={activeStream.referer}
                previewVttUrl={previewVttUrl}
                subtitleUrl={subtitleUrl}
                onMeta={handleMeta}
                onVideoEl={setVideoEl}
                onLog={onAddSystemLog}
              />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-600 text-xs"></div>
          )}
        </div>
      </div>

      {/* RIGHT SIDEBAR: M3U8 LIST & PARSING UTILITIES */}
      <div className="w-85 border-l border-slate-200 bg-[#fffaf5] flex flex-col shrink-0 h-full max-h-full overflow-hidden select-none text-xs font-sans">
        {/* ========== 顶部固定区：折叠头 + 两行可切换槽位 ========== */}
        <div className="shrink-0 border-b border-slate-200">
          {/* 折叠头（常驻） */}
          <button
            onClick={() => setIsAnalyzerCollapsed(!isAnalyzerCollapsed)}
            className="w-full px-4 py-2.5 flex items-center justify-between text-left hover:bg-amber-50/40 transition cursor-pointer"
          >
            <span
              className={`flex items-center gap-2 text-[11px] font-bold transition-colors ${isAnalyzerCollapsed ? "text-slate-400" : "text-amber-500"}`}
            >
              <Radio className={`w-3.5 h-3.5`} />
              HLS 深度解析
              {!isAnalyzerCollapsed && (
                <span className="text-[9px] font-normal text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full">
                  ON
                </span>
              )}
            </span>
            <ChevronDown
              className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-300 ${isAnalyzerCollapsed ? "" : "rotate-180"}`}
            />
          </button>

          {/* 槽位容器：两行（输入栏 + 副行），根据状态切换内容 */}
          <div
            key={isAnalyzerCollapsed ? "search" : "analyze"}
            className="px-4 pb-3 anim-mode-swap"
          >
            {isAnalyzerCollapsed ? (
              <>
                {/* —— 搜索模式 —— */}
                <div className="relative mb-2">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
                  <input
                    type="text"
                    placeholder={`搜索 ${localVideos.length} 个视频...`}
                    value={videoSearchQuery}
                    onChange={(e) => setVideoSearchQuery(e.target.value)}
                    className="w-full bg-white border border-slate-200 text-slate-700 text-[11px] rounded-lg pl-7 pr-7 py-1.5 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition"
                  />
                  {videoSearchQuery && (
                    <button
                      onClick={() => setVideoSearchQuery("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      if (localVideos.length === 0) {
                        onAddSystemLog("本地库为空，无法抽奖", "WARNING");
                        return;
                      }
                      setLuckyOpen(true);
                    }}
                    className="flex-1 h-7 flex items-center justify-center gap-1 px-2 rounded-md bg-gradient-to-br from-pink-500 to-amber-500 text-white text-[10px] font-bold cursor-pointer hover:opacity-90 transition shadow-sm"
                    title="随机抽奖"
                  >
                    <Gift className="w-3 h-3" />
                    抽奖
                  </button>
                  <button
                    onClick={() => setShowOnlyFavorites((v) => !v)}
                    className={`flex-1 h-7 flex items-center justify-center gap-1 px-2 rounded-md text-[10px] font-bold cursor-pointer transition border ${
                      showOnlyFavorites
                        ? "bg-rose-500 border-rose-500 text-white hover:bg-rose-600"
                        : "bg-white border-slate-200 text-slate-600 hover:border-rose-300 hover:text-rose-500 hover:bg-rose-50"
                    }`}
                    title={
                      showOnlyFavorites
                        ? `仅显示心爱（${favorites.size}）— 点击显示全部`
                        : `仅看心爱（已收藏 ${favorites.size}）`
                    }
                  >
                    <Heart
                      className={`w-3 h-3 ${showOnlyFavorites ? "fill-current" : ""}`}
                    />
                    心爱
                  </button>
                  <button
                    onClick={openRepairForAll}
                    className="flex-1 h-7 flex items-center justify-center gap-1 px-2 rounded-md bg-white border border-slate-200 text-slate-600 hover:border-amber-300 hover:text-amber-600 hover:bg-amber-50 text-[10px] font-bold cursor-pointer transition"
                    title="批量修复封面/预览/字幕/刻度图"
                  >
                    <Wrench className="w-3 h-3" />
                    修复
                  </button>
                  <button
                    onClick={handleBackfillMeta}
                    disabled={isBackfilling || isLoadingVideos}
                    className="flex-1 h-7 flex items-center justify-center gap-1 px-2 rounded-md bg-white border border-slate-200 text-slate-600 hover:border-amber-300 hover:text-amber-600 hover:bg-amber-50 text-[10px] font-bold cursor-pointer transition disabled:opacity-60 disabled:cursor-not-allowed"
                    title="刷新视频列表并回填元数据 (Shift+点击 强制覆盖)"
                  >
                    <RefreshCw
                      className={`w-3 h-3 ${
                        isBackfilling || isLoadingVideos ? "animate-spin" : ""
                      }`}
                    />
                    刷新
                  </button>
                  <button
                    onClick={() => setWhisperOpen(true)}
                    className="flex-1 h-7 flex items-center justify-center gap-1 px-2 rounded-md bg-white border border-slate-200 text-slate-600 hover:border-amber-300 hover:text-amber-600 hover:bg-amber-50 text-[10px] font-bold cursor-pointer transition"
                    title="AI 字幕（Whisper 离线转写）"
                  >
                    <Captions className="w-3 h-3" />
                    字幕
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* —— 解析模式 —— */}
                <form
                  onSubmit={handleParseM3u8List}
                  className="space-y-1.5 mb-2"
                >
                  <div className="flex gap-1.5">
                    <div className="relative flex-1 min-w-0">
                      <Radio className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-amber-500" />
                      <input
                        type="text"
                        placeholder="粘贴 m3u8 地址..."
                        value={analyzerUrl}
                        onChange={(e) => setAnalyzerUrl(e.target.value)}
                        autoFocus
                        className="w-full bg-white border border-amber-200 text-slate-700 text-[11px] font-mono rounded-lg pl-7 pr-7 py-1.5 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition"
                      />
                      {analyzerUrl && (
                        <button
                          type="button"
                          onClick={() => setAnalyzerUrl("")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <button
                      type="submit"
                      disabled={isParsing}
                      className="px-3 bg-slate-800 hover:bg-amber-500 text-white rounded-lg text-[10px] font-bold transition flex items-center justify-center cursor-pointer disabled:opacity-60"
                    >
                      {isParsing ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        "解析"
                      )}
                    </button>
                  </div>
                  <input
                    type="text"
                    placeholder="Referer 页面 URL（403 时填影片页）"
                    value={analyzerReferer}
                    onChange={(e) => setAnalyzerReferer(e.target.value)}
                    className="w-full bg-white border border-slate-200 text-slate-600 text-[10px] font-mono rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-100 transition"
                  />
                </form>

                {/* 副行：未解析时显示提示；已解析时显示精简结果摘要 */}
                {!parsedData ? (
                  <div className="h-7 px-2.5 rounded-md bg-amber-50/60 border border-dashed border-amber-200 flex items-center gap-1.5 text-[10px] text-amber-700/80">
                    <Radio className="w-3 h-3 shrink-0" />
                    <span className="truncate">等待解析 · 回车提交</span>
                  </div>
                ) : (
                  <div className="h-7 px-2.5 rounded-md bg-white border border-slate-200 flex items-center justify-between text-[10px] anim-fade-in">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                      <span className="font-bold text-slate-700 truncate">
                        {parsedData.title}
                      </span>
                      <span className="text-slate-500">
                        {parsedData.segmentsCount} 片段
                      </span>
                    </span>
                    <button
                      onClick={handleLoadParsedStream}
                      className="shrink-0 ml-2 flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500 hover:bg-amber-600 text-white font-bold cursor-pointer transition"
                    >
                      <Play className="w-2.5 h-2.5 fill-current" />
                      推入
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ========== 本地视频列表 ========== */}
        <div className="flex-1 flex flex-col min-h-0 bg-transparent px-4 pt-3 pb-4 text-xs">
          {/* VIDEO CARDS LIST - 虚拟滚动 */}
          <div
            ref={listScrollRef}
            className="flex-1 overflow-y-auto pr-2 overscroll-contain"
            style={{
              contain: "strict",
              willChange: "scroll-position",
            }}
          >
            {filteredVideos.length > 0 ? (
              <div
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  width: "100%",
                  position: "relative",
                }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const video = filteredVideos[virtualRow.index];
                  return (
                    <div
                      key={virtualRow.key}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        // translate3d 强制独立合成层；contain 阻止子树的布局/样式/绘制影响外部
                        transform: `translate3d(0, ${virtualRow.start}px, 0)`,
                        paddingBottom: "8px",
                        contain: "layout style paint",
                      }}
                    >
                      <LocalVideoCard
                        video={video}
                        isActive={selectedVideoIndex === virtualRow.index}
                        onPlay={handleLoadLocalVideo}
                        onDelete={setDeleteTarget}
                        onRepair={openRepairForVideo}
                        isFavorite={favorites.has(video.id)}
                        onToggleFavorite={toggleFavorite}
                        index={virtualRow.index}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-40 text-slate-300 space-y-2">
                <FileVideo className="w-8 h-8 opacity-20" />
                <p className="text-[10px]">
                  {videoSearchQuery ? "没有匹配的视频" : "未检测到本地视频"}
                </p>
                <button
                  onClick={refreshVideoList}
                  className="text-[10px] text-amber-500/60 hover:text-amber-500 underline"
                >
                  点击刷新
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 抽奖弹窗 */}
      {luckyOpen && (
        <LuckyDraw
          videos={localVideos}
          onClose={() => setLuckyOpen(false)}
          onPlay={(v) => {
            const idx = localVideos.findIndex((x) => x.id === v.id);
            if (idx >= 0) handleLoadLocalVideo(v, idx);
          }}
        />
      )}

      {/* 修复面板（单个 / 全部） */}
      {repairTargets && (
        <RepairModal
          mode={repairMode}
          targets={repairTargets}
          onLog={onAddSystemLog}
          onClose={() => setRepairTargets(null)}
          onDone={() => {
            void refreshVideoList();
          }}
        />
      )}

      {/* Whisper 字幕面板 */}
      {whisperOpen && (
        <WhisperPanel
          currentVideoPath={currentVideoPath}
          currentVideoName={currentVideoName}
          onClose={() => setWhisperOpen(false)}
        />
      )}

      {/* 删除确认弹窗 */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm anim-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDeleteTarget(null);
          }}
        >
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-80 space-y-4 anim-pop-in">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800 text-sm">确认删除</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  此操作不可撤销，将永久删除视频文件夹及其所有文件。
                </p>
              </div>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
              <p className="text-xs text-slate-700 font-medium truncate">
                {deleteTarget.name}
              </p>
              {deleteTarget.size && (
                <p className="text-[10px] text-slate-400 mt-0.5">
                  大小: {deleteTarget.size}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition cursor-pointer"
                disabled={isDeleting}
              >
                取消
              </button>
              <button
                onClick={handleDeleteVideo}
                className="flex-1 py-2 text-xs font-bold text-white bg-red-500 hover:bg-red-600 rounded-lg transition cursor-pointer flex items-center justify-center gap-1.5"
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <Trash2 className="w-3 h-3" />
                )}
                {isDeleting ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
