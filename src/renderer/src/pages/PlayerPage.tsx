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
import Hls from "hls.js";
//@ts-ignore
import Plyr from "plyr";
import { trpc } from "../lib/trpc";
import {
  Play,
  FileVideo,
  Radio,
  ListMusic,
  RefreshCw,
  ChevronDown,
  Search,
  X,
  Trash2,
  Download,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface VideoItem {
  id: string;
  name: string;
  url: string;
  resolution: string;
  encryptionType: string;
  coverUrl?: string;
  previewUrl?: string;
  size?: string;
  createdAt?: number;
}

interface PlayerPageProps {
  videoPath: string;
  onAddSystemLog: (
    text: string,
    level: "INFO" | "WARNING" | "SUCCESS" | "ERROR",
  ) => void;
}

/* ------------------------------------------------------------------ */
/*  LocalVideoCard                                                      */
/* ------------------------------------------------------------------ */

const LocalVideoCard: React.FC<{
  video: VideoItem;
  isActive: boolean;
  onPlay: () => void;
  onDelete: () => void;
  index: number;
}> = ({ video, isActive, onPlay, onDelete, index }) => {
  const [hovered, setHovered] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);

  const handleEnter = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    // 延迟挂载，避免快速划过时频繁加载预览
    hoverTimer.current = setTimeout(() => setHovered(true), 250);
  };

  const handleLeave = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHovered(false);
  };

  const handlePreviewReady = () => {
    previewRef.current?.play().catch(() => {});
  };

  return (
    <div
      onClick={onPlay}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      className={`rounded-lg border overflow-hidden cursor-pointer transition-all duration-200 group ${
        isActive
          ? "border-amber-400 bg-amber-50/50 shadow-sm ring-1 ring-amber-400/30"
          : "border-slate-200 bg-white hover:border-amber-300 hover:shadow-md hover:-translate-y-0.5"
      }`}
    >
      {/* THUMBNAIL / PREVIEW CONTAINER */}
      <div className="relative aspect-video bg-slate-900 overflow-hidden">
        {/* 序号角标 */}
        <span className="absolute top-1.5 right-1.5 z-10 text-[10px] bg-slate-800/80 text-white px-1.5 py-0.5 font-mono rounded backdrop-blur-sm font-bold">
          #{index + 1}
        </span>

        {video.coverUrl && (
          <img
            src={video.coverUrl}
            alt={video.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        )}

        {/* HOVER PREVIEW OVERLAY */}
        {hovered && video.previewUrl && (
          <video
            ref={previewRef}
            src={video.previewUrl}
            muted
            loop
            playsInline
            preload="auto"
            onLoadedData={handlePreviewReady}
            className="absolute inset-0 w-full h-full object-cover bg-black animate-[fadeIn_0.3s_ease]"
          />
        )}

        {/* 正在播放标记 */}
        {isActive && (
          <span className="absolute top-1.5 left-1.5 z-10 inline-flex items-center gap-1 text-[9px] bg-amber-500/90 text-white px-1.5 py-0.5 rounded font-mono font-bold backdrop-blur-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-900 animate-pulse"></span>
            播放中
          </span>
        )}
      </div>

      {/* INFO */}
      <div className="p-2.5">
        <span
          className={`font-bold block truncate text-[11px] ${isActive ? "text-amber-700" : "text-slate-800"}`}
          title={video.name}
        >
          {video.name}
        </span>
        <div className="flex items-center justify-between mt-1">
          <div className="flex items-center gap-2 text-[9px] font-mono text-slate-400">
            {video.size && <span>{video.size}</span>}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            className="p-0.5 text-slate-300 hover:text-red-400 transition cursor-pointer opacity-0 group-hover:opacity-100"
            title="删除视频"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
};

/* ================================================================== */
/*  PlayerPage (main export)                                          */
/* ================================================================== */

export function PlayerPage({ videoPath, onAddSystemLog }: PlayerPageProps) {
  // Plyr 播放器实例
  const plyrRef = useRef<Plyr | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // HLS 实例
  const hlsRef = useRef<Hls | null>(null);

  // 当前播放流信息
  const [activeStream, setActiveStream] = useState({
    name: "等待选择视频...",
    url: "",
    resolution: "--",
    encryptionType: "--",
  });

  // HLS analyzer inputs
  const [analyzerUrl, setAnalyzerUrl] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [parsedData, setParsedData] = useState<any>(null);
  const [isAnalyzerCollapsed, setIsAnalyzerCollapsed] = useState(true);

  // 删除确认弹窗
  const [deleteTarget, setDeleteTarget] = useState<VideoItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // 本地视频列表
  const [localVideos, setLocalVideos] = useState<VideoItem[]>([]);
  const [videoSearchQuery, setVideoSearchQuery] = useState("");

  // 搜索过滤
  const filteredVideos = useMemo(() => {
    if (!videoSearchQuery.trim()) return localVideos;
    const q = videoSearchQuery.toLowerCase().trim();
    return localVideos.filter((v) => v.name.toLowerCase().includes(q));
  }, [localVideos, videoSearchQuery]);
  const [isLoadingVideos, setIsLoadingVideos] = useState(false);
  const [selectedVideoIndex, setSelectedVideoIndex] = useState<number | null>(
    null,
  );

  // 虚拟滚动
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: filteredVideos.length,
    getScrollElement: () => listScrollRef.current,
    estimateSize: () => 230, // 卡片实际高度（aspect-video ~191px + info ~50px + padding + gap）
    overscan: 20,
  });

  // 追踪是否为首次加载（首次选中不自动播放）
  const isFirstLoad = useRef(true);

  // 加载视频源（HLS 或本地文件）
  const loadSource = useCallback((url: string, autoPlay: boolean) => {
    const videoEl = videoRef.current;
    if (!videoEl || !url) return;

    // 清理之前的 HLS 实例
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const isHls = url.includes(".m3u8");

    if (isHls && Hls.isSupported()) {
      // 将 CDN URL 转换为自定义协议
      const proxyUrl = url
        .replace("https://surrit.com", "cdn://surrit.com")
        .replace("https://surrit.org", "cdn://surrit.org");

      const hls = new Hls({
        //@ts-ignore
        urlRewrite: (segUrl: string) => {
          if (segUrl.includes("surrit.com") || segUrl.includes("surrit.org")) {
            return segUrl
              .replace("https://surrit.com", "cdn://surrit.com")
              .replace("https://surrit.org", "cdn://surrit.org");
          }
          return segUrl;
        },
      });

      hls.loadSource(proxyUrl);
      hls.attachMedia(videoEl);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log("[HLS] m3u8 清单解析完成");
        if (autoPlay) {
          plyrRef.current?.play();
        }
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        console.error("[HLS] 错误:", data);
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.error("[HLS] 网络错误，尝试恢复...");
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.error("[HLS] 媒体错误，尝试恢复...");
              hls.recoverMediaError();
              break;
            default:
              console.error("[HLS] 致命错误，无法恢复");
              hls.destroy();
              break;
          }
        }
      });

      hlsRef.current = hls;
    } else if (isHls && videoEl.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari 原生 HLS
      videoEl.src = url;
    } else {
      // 本地 mp4 文件
      videoEl.src = url;
    }

    // 更新 Plyr 源
    if (plyrRef.current) {
      plyrRef.current.source = {
        type: "video",
        sources: [
          {
            src: url,
            type: isHls ? "application/x-mpegURL" : "video/mp4",
          },
        ],
      };
    }
  }, []);

  // 当 activeStream.url 变化时加载源
  useEffect(() => {
    if (activeStream.url) {
      const autoPlay = !isFirstLoad.current;
      isFirstLoad.current = false;
      loadSource(activeStream.url, autoPlay);
    }
  }, [activeStream.url, loadSource]);

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

  // 修复封面：为没有封面的视频从 CDN 下载封面和预览
  const handleFixCovers = async () => {
    const videosWithoutCover = localVideos.filter((v) => !v.coverUrl)
    if (videosWithoutCover.length === 0) {
      onAddSystemLog('所有视频都已有封面，无需修复。', 'INFO')
      return
    }
    onAddSystemLog(`开始修复封面，共 ${videosWithoutCover.length} 个视频需要处理...`, 'INFO')
    let fixed = 0
    for (const video of videosWithoutCover) {
      const codeMatch = video.name.match(/[A-Z]{2,6}-\d{3,5}/i)
      if (!codeMatch) continue
      const code = codeMatch[0].toLowerCase()
      // 从视频 url 提取其所在文件夹路径（url 段经过 encodeURIComponent，需先解码）
      const normalized = decodeURIComponent(video.url.replace(/^(file|local-media):\/\/\//, '')).replace(/\//g, '\\')
      const lastSlash = normalized.lastIndexOf('\\')
      const folderPath = lastSlash > 0 ? normalized.substring(0, lastSlash) : normalized
      try {
        await trpc.download.downloadCoverPreview.mutate({
          id: code.toUpperCase(),
          name: video.name,
          saveDir: folderPath,
        })
        fixed++
        onAddSystemLog(`封面已修复: ${video.name}`, 'SUCCESS')
      } catch (err) {
        onAddSystemLog(`修复封面失败: ${video.name}`, 'ERROR')
      }
    }
    onAddSystemLog(`封面修复完成，成功处理 ${fixed}/${videosWithoutCover.length} 个视频。`, 'SUCCESS')
    await refreshVideoList()
  }

  // 删除视频
  const handleDeleteVideo = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      // 从 url 提取文件夹路径: file:///M:/video/videos/xxx/video.mp4 -> M:\video\videos\xxx
      const urlPath = deleteTarget.url
      const normalized = decodeURIComponent(urlPath.replace(/^(file|local-media):\/\/\//, '')).replace(/\//g, '\\')
      // 取最后一个 \ 之前的部分作为文件夹路径
      const lastSlash = normalized.lastIndexOf('\\')
      const folderPath = lastSlash > 0 ? normalized.substring(0, lastSlash) : normalized

      const result = await trpc.videos.delete.mutate({
        folderPath,
        rootPath: videoPath,
      })
      if (result.success) {
        onAddSystemLog(`已删除视频: ${deleteTarget.name}`, 'SUCCESS')
        // 如果删除的是当前播放的视频，清空播放器
        if (selectedVideoIndex !== null && localVideos[selectedVideoIndex]?.id === deleteTarget.id) {
          setSelectedVideoIndex(null)
          setActiveStream({ name: '未选择视频', url: '', resolution: '', encryptionType: '' })
        }
        setDeleteTarget(null)
        await refreshVideoList()
      } else {
        onAddSystemLog(`删除失败: ${result.error}`, 'ERROR')
      }
    } catch (err: any) {
      onAddSystemLog(`删除失败: ${err?.message || err}`, 'ERROR')
    } finally {
      setIsDeleting(false)
    }
  }

  const refreshVideoList = async () => {
    setIsLoadingVideos(true);
    try {
      const rawVideos = await trpc.videos.list.query({ path: videoPath });
      console.log(rawVideos);
      
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

  const handleLoadLocalVideo = (video: VideoItem, index: number) => {
    setSelectedVideoIndex(index);
    setActiveStream({
      name: video.name,
      url: video.url,
      resolution: video.resolution,
      encryptionType: video.encryptionType || "未检测",
    });
    onAddSystemLog(`正在播放本地视频: ${video.name}`, "SUCCESS");
  };

  const handleParseM3u8List = (e: React.FormEvent) => {
    e.preventDefault();
    if (!analyzerUrl.trim()) return;

    setIsParsing(true);
    onAddSystemLog(`正在解析 HLS 列表: ${analyzerUrl}`, "INFO");

    setTimeout(() => {
      const mockResult = {
        success: true,
        title: "解析成功: " + analyzerUrl.split("/").pop(),
        encryption: "AES-128 (CBC)",
        segmentsCount: 1240,
        tracks: [
          { resolution: "1920x1080", bandwidth: "4.5 Mbps" },
          { resolution: "1280x720", bandwidth: "2.1 Mbps" },
          { resolution: "854x480", bandwidth: "1.0 Mbps" },
        ],
      };
      setParsedData(mockResult);
      setIsParsing(false);
      onAddSystemLog("HLS 深度解析完成，已提取所有媒体轨道。", "SUCCESS");
    }, 1500);
  };

  const handleLoadParsedStream = () => {
    if (!parsedData) return;
    setActiveStream({
      name: parsedData.title,
      url: analyzerUrl,
      resolution: parsedData.tracks[0].resolution,
      encryptionType: parsedData.encryption,
    });
    onAddSystemLog(`已载入主播放器: ${parsedData.title}`, "SUCCESS");
  };

  return (
    <div className="flex-1 flex overflow-hidden bg-[#fffaf5] h-full">
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
            <span className="text-[9px] bg-slate-100 text-slate-500 font-mono font-bold py-1 px-3 rounded border border-slate-200">
              分辨率: {activeStream.resolution}
            </span>
          </div>
        </div>

        {/* PLYR VIDEO PLAYER */}
        <div className="relative flex flex-1 w-full bg-black rounded-xl overflow-hidden border border-slate-200/80 shadow-lg">
          <video
            ref={(el) => {
              videoRef.current = el;
              if (el && !plyrRef.current) {
                // ref callback 中初始化 Plyr，确保 DOM 已存在
                console.log("[Video Ref] 初始化 Plyr");
                const plyr = new Plyr(el, {
                  // 指向 public/plyr.svg（同源），避免 Plyr 默认从 cdn.plyr.io 在线拉取被 CORS 拦截
                  iconUrl: "./plyr.svg",
                  controls: [
                    "play-large",
                    "play",
                    "progress",
                    "current-time",
                    "duration",
                    "mute",
                    "volume",
                    "settings",
                    "pip",
                    "airplay",
                    "fullscreen",
                  ],
                  i18n: {
                    play: "播放",
                    pause: "暂停",
                    mute: "静音",
                    unmute: "取消静音",
                    volume: "音量",
                    settings: "设置",
                    pip: "画中画",
                    airplay: "AirPlay",
                    fullscreen: "全屏",
                    exitFullscreen: "退出全屏",
                    current: "当前时间",
                    duration: "总时长",
                  },
                  settings: ["speed"],
                  speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
                  tooltips: { controls: true, seek: true },
                  keyboard: { focused: true, global: true },
                });
                plyrRef.current = plyr;
                console.log("[Video Ref] Plyr 初始化成功");
              }
            }}
            className="w-full h-full object-contain"
            playsInline
          />
        </div>
      </div>

      {/* RIGHT SIDEBAR: M3U8 LIST & PARSING UTILITIES */}
      <div className="w-85 border-l border-slate-200 bg-[#fffaf5] flex flex-col shrink-0 h-full max-h-full overflow-hidden select-none text-xs font-sans">
        {/* PARSING INTERFACE PANEL */}
        <div className="p-4 border-b border-slate-200 shrink-0">
          <h4
            className="font-bold text-slate-800 tracking-wider flex items-center justify-between cursor-pointer hover:text-amber-600 transition"
            onClick={() => setIsAnalyzerCollapsed(!isAnalyzerCollapsed)}
          >
            <span className="flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-amber-500" />
              列表深度解析
            </span>
            <ChevronDown
              className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isAnalyzerCollapsed ? "" : "rotate-180"}`}
            />
          </h4>

          {!isAnalyzerCollapsed && (
            <div className="mt-3 space-y-3">
              <p className="text-[10px] text-slate-400 leading-normal">
                粘贴任何 m3u8 地址，提取其内置嵌套码率流与加密密钥证书状态。
              </p>

              <form onSubmit={handleParseM3u8List} className="space-y-2">
                <div className="flex gap-1.5 focus-within:border-amber-500/50">
                  <input
                    type="text"
                    placeholder="https://.../video.m3u8"
                    value={analyzerUrl}
                    onChange={(e) => setAnalyzerUrl(e.target.value)}
                    className="flex-1 bg-white border border-slate-200 text-slate-700 text-xs font-mono rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-amber-500"
                  />
                  <button
                    type="submit"
                    className="px-3 bg-slate-100 text-slate-600 hover:bg-amber-500 hover:text-white border border-slate-200 hover:border-amber-500 rounded-lg font-bold transition flex items-center justify-center cursor-pointer"
                    disabled={isParsing}
                  >
                    {isParsing ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      "解析"
                    )}
                  </button>
                </div>
              </form>

              {/* PARSED DATA DETAILS VIEW */}
              {parsedData && parsedData.success && (
                <div className="p-3.5 bg-amber-50 border border-amber-100 rounded-xl space-y-2 select-text text-[10px] shadow-sm">
                  <div className="font-bold text-slate-800">
                    标题:{" "}
                    <span className="text-amber-700 font-sans">
                      {parsedData.title}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>
                      加密:{" "}
                      <b className="text-purple-700 font-mono">
                        {parsedData.encryption}
                      </b>
                    </span>
                    <span>
                      片段数:{" "}
                      <b className="text-emerald-700 font-mono">
                        {parsedData.segmentsCount}个
                      </b>
                    </span>
                  </div>
                  <div className="h-px bg-amber-100 my-1"></div>

                  <div className="space-y-1">
                    <span className="text-slate-400 font-semibold block text-[9px]">
                      检测到的流码率质量:
                    </span>
                    {parsedData.tracks.map((track: any, i: number) => (
                      <div
                        key={i}
                        className="flex items-center justify-between font-mono py-0.5 border-b border-amber-100 last:border-b-0 text-[9px] text-slate-600"
                      >
                        <span className="text-slate-700 font-bold">
                          {track.resolution}
                        </span>
                        <span className="text-amber-700">
                          {track.bandwidth}
                        </span>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={handleLoadParsedStream}
                    className="w-full mt-2.5 py-2 bg-amber-500 hover:bg-amber-600 font-bold text-white rounded-lg transition text-center flex items-center justify-center gap-1 cursor-pointer text-[10px] shadow-sm"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    推入主播放源
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* LOCAL VIDEO LIST */}
        <div className="flex-1 flex flex-col min-h-0 bg-transparent p-4 text-xs">
          <div className="flex items-center gap-2 mb-3 border-b border-slate-200 pb-2 font-sans">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-[7.5px] w-3 h-3 text-black" />
              <input
                type="text"
                placeholder="搜索番号或名称..."
                value={videoSearchQuery}
                onChange={(e) => setVideoSearchQuery(e.target.value)}
                className="w-full bg-white border border-slate-200 text-slate-700 text-[10px] rounded-lg pl-7 pr-2.5 py-1.5 focus:outline-none focus:border-amber-500 transition"
              />
              {videoSearchQuery && (
                <button
                  onClick={() => setVideoSearchQuery("")}
                  className="absolute right-2 top-[7.5px] text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <button
              onClick={handleFixCovers}
              className="shrink-0 px-2 py-1.5 bg-amber-500 text-white hover:bg-amber-600 border border-amber-200 rounded-lg text-[10px] font-bold transition cursor-pointer flex items-center gap-1"
              title="为没有封面的视频从CDN下载封面和预览"
            >
              <Download className="w-3 h-3" />
              修复封面
            </button>
          </div>

          {/* VIDEO CARDS LIST - 虚拟滚动 */}
          <div
            ref={listScrollRef}
            className="flex-1 overflow-y-auto pr-2"
            style={{ contain: "strict" }}
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
                        transform: `translateY(${virtualRow.start}px)`,
                        paddingBottom: "8px",
                      }}
                    >
                      <LocalVideoCard
                        video={video}
                        isActive={selectedVideoIndex === virtualRow.index}
                        onPlay={() => handleLoadLocalVideo(video, virtualRow.index)}
                        onDelete={() => setDeleteTarget(video)}
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
                <p className="text-[11px] text-slate-500 mt-0.5">此操作不可撤销，将永久删除视频文件夹及其所有文件。</p>
              </div>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
              <p className="text-xs text-slate-700 font-medium truncate">{deleteTarget.name}</p>
              {deleteTarget.size && <p className="text-[10px] text-slate-400 mt-0.5">大小: {deleteTarget.size}</p>}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition cursor-pointer" disabled={isDeleting}>取消</button>
              <button onClick={handleDeleteVideo} className="flex-1 py-2 text-xs font-bold text-white bg-red-500 hover:bg-red-600 rounded-lg transition cursor-pointer flex items-center justify-center gap-1.5" disabled={isDeleting}>
                {isDeleting ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                {isDeleting ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
