/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import Hls from "hls.js";
import type { VideoItem } from "../../pages/player/types";
import {
  Sparkles,
  Film,
  Scissors,
  BookmarkPlus,
  Layers,
} from "lucide-react";

interface AeroCapsulePlayerProps {
  activeVideo: {
    name: string;
    url: string;
    resolution?: string;
    encryptionType?: string;
    referer?: string;
  };
  videos: VideoItem[];
  selectedVideoId?: string | null;
  onSelectVideo: (video: VideoItem, index: number) => void;
  filterStyle?: string;
  onVideoEl?: (el: HTMLVideoElement | null) => void;
  onMeta?: (meta: { width: number; height: number }) => void;
  onOpenShader?: () => void;
  onOpenChapters?: () => void;
  onOpenCut?: () => void;
  onAddBookmark?: () => void;
}

const CDN_PROXY_BASE = "http://127.0.0.1:39528/m";

function toProxied(url: string, referer?: string) {
  const isCdn = /^https?:\/\/(([\w-]+\.)*)(fourhoi\.com|surrit\.com|surrit\.org)/i.test(url);
  if (!isCdn) return url;
  try {
    const proxy = new URL(CDN_PROXY_BASE);
    proxy.searchParams.set("u", url);
    if (referer?.trim()) {
      proxy.searchParams.set("r", referer.trim());
    }
    return proxy.toString();
  } catch {
    return url;
  }
}

function formatTime(sec: number): string {
  if (isNaN(sec) || sec < 0) return "00:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export const AeroCapsulePlayer: React.FC<AeroCapsulePlayerProps> = ({
  activeVideo,
  videos,
  selectedVideoId,
  onSelectVideo,
  filterStyle = "none",
  onVideoEl,
  onMeta,
  onOpenShader,
  onOpenChapters,
  onOpenCut,
  onAddBookmark,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ambientCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const timelineBoxRef = useRef<HTMLDivElement | null>(null);
  const hoverCardRef = useRef<HTMLDivElement | null>(null);
  const rippleLeftRef = useRef<HTMLDivElement | null>(null);
  const rippleRightRef = useRef<HTMLDivElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  // 播放状态
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedPct, setBufferedPct] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // 交互状态
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isPlaylistOpen, setIsPlaylistOpen] = useState(false);
  const [autoNext, setAutoNext] = useState(true);
  const [hoverTimeText, setHoverTimeText] = useState("00:00");
  const [isHoveringTimeline, setIsHoveringTimeline] = useState(false);
  const [isSpeedIslandActive, setIsSpeedIslandActive] = useState(false);

  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);
  const normalRateRef = useRef(1.0);
  const lastClickTimeRef = useRef(0);

  // 1. 初始化并挂载视频播放引擎
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeVideo.url) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const finalUrl = toProxied(activeVideo.url, activeVideo.referer);
    const isHls = finalUrl.includes(".m3u8");

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
      });
      hlsRef.current = hls;
      hls.loadSource(finalUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
    } else {
      video.src = finalUrl;
      video.play().catch(() => {});
    }

    onVideoEl?.(video);

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [activeVideo.url, activeVideo.referer, onVideoEl]);

  // 2. 视频事件监听
  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(video.currentTime || 0);

    // 计算已缓冲范围
    if (video.buffered.length > 0 && video.duration > 0) {
      const bufEnd = video.buffered.end(video.buffered.length - 1);
      setBufferedPct(Math.min(100, (bufEnd / video.duration) * 100));
    }
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setDuration(video.duration || 0);
    onMeta?.({ width: video.videoWidth, height: video.videoHeight });
  }, [onMeta]);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    if (autoNext && videos.length > 0) {
      const currentIndex = videos.findIndex(
        (v) => v.id === selectedVideoId || v.name === activeVideo.name,
      );
      const nextIndex = (currentIndex + 1) % videos.length;
      if (videos[nextIndex]) {
        onSelectVideo(videos[nextIndex], nextIndex);
      }
    }
  }, [autoNext, videos, selectedVideoId, activeVideo.name, onSelectVideo]);

  // 3. 静谧电影感流光背景渲染 (采样 16x9 到 Canvas 并 100px 柔光模糊)
  useEffect(() => {
    let animId: number;
    const renderAmbient = () => {
      const video = videoRef.current;
      const canvas = ambientCanvasRef.current;
      if (video && canvas && !video.paused && !video.ended) {
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          canvas.width = 16;
          canvas.height = 9;
          try {
            ctx.drawImage(video, 0, 0, 16, 9);
          } catch {
            /* 忽略跨域 canvas draw 异常 */
          }
        }
      }
      animId = requestAnimationFrame(renderAmbient);
    };

    animId = requestAnimationFrame(renderAmbient);
    return () => cancelAnimationFrame(animId);
  }, []);

  // 4. 控制栏优雅闲置隐藏与移出隐藏 (5秒静止隐藏)
  const resetIdleTimer = useCallback(() => {
    setControlsVisible(true);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    const video = videoRef.current;
    if (video && !video.paused && !isPlaylistOpen) {
      idleTimerRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 5000);
    }
  }, [isPlaylistOpen]);

  const handleContainerMouseLeave = useCallback(() => {
    const video = videoRef.current;
    if (video && !video.paused && !isPlaylistOpen) {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      setControlsVisible(false);
    }
  }, [isPlaylistOpen]);

  // 5. 播放/暂停控制
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
    resetIdleTimer();
  }, [resetIdleTimer]);

  // 6. 涟漪微光反馈与双击手势
  const flashRipple = (type: "left" | "right") => {
    const el = type === "left" ? rippleLeftRef.current : rippleRightRef.current;
    if (!el) return;
    el.classList.remove("opacity-0");
    setTimeout(() => {
      el.classList.add("opacity-0");
    }, 350);
  };

  const handleVideoAreaClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // 排除交互浮层自身
    if (
      (e.target as HTMLElement).closest(".glass-pill") ||
      (e.target as HTMLElement).closest("#capsule") ||
      (e.target as HTMLElement).closest("#side-dock") ||
      (e.target as HTMLElement).closest("#playlist-drawer") ||
      (e.target as HTMLElement).closest("#top-bar")
    ) {
      return;
    }

    const now = Date.now();
    const container = containerRef.current;
    if (now - lastClickTimeRef.current < 260 && container) {
      const rect = container.getBoundingClientRect();
      const isLeft = e.clientX - rect.left < rect.width / 2;
      const video = videoRef.current;
      if (video) {
        if (isLeft) {
          video.currentTime = Math.max(0, video.currentTime - 10);
          flashRipple("left");
        } else {
          video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
          flashRipple("right");
        }
      }
    } else {
      // 单击：若选集抽屉开启则关闭，否则开关播放
      if (isPlaylistOpen) {
        setIsPlaylistOpen(false);
      } else {
        togglePlay();
      }
    }
    lastClickTimeRef.current = now;
  };

  // 7. 长按 2.0x 极速冲刺微型灵动岛
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (
      (e.target as HTMLElement).closest(".glass-pill") ||
      (e.target as HTMLElement).closest("#capsule") ||
      (e.target as HTMLElement).closest("#side-dock") ||
      (e.target as HTMLElement).closest("#playlist-drawer") ||
      (e.target as HTMLElement).closest("#top-bar")
    ) {
      return;
    }

    holdTimerRef.current = setTimeout(() => {
      const video = videoRef.current;
      if (video) {
        normalRateRef.current = video.playbackRate;
        video.playbackRate = 2.0;
        setIsSpeedIslandActive(true);
      }
    }, 220);
  };

  const handlePointerUp = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    const video = videoRef.current;
    if (video && isSpeedIslandActive) {
      video.playbackRate = normalRateRef.current;
      setIsSpeedIslandActive(false);
    }
  };

  // 8. 进度轴交互与实时微缩帧预览
  const handleTimelineMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const box = timelineBoxRef.current;
    const video = videoRef.current;
    const hoverCard = hoverCardRef.current;
    const previewCanvas = previewCanvasRef.current;
    if (!box || !video || !duration) return;

    const rect = box.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (hoverCard) {
      hoverCard.style.left = `${pos * 100}%`;
    }
    const targetTime = pos * duration;
    setHoverTimeText(formatTime(targetTime));

    if (previewCanvas) {
      previewCanvas.width = 96;
      previewCanvas.height = 56;
      const ctx = previewCanvas.getContext("2d");
      if (ctx) {
        try {
          ctx.drawImage(video, 0, 0, 96, 56);
        } catch {
          /* ignore */
        }
      }
    }
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const box = timelineBoxRef.current;
    const video = videoRef.current;
    if (!box || !video || !duration) return;
    const rect = box.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    video.currentTime = pos * duration;
    resetIdleTimer();
  };

  // 9. 倍速、音量、全屏、画中画操作
  const changeSpeed = (rate: number) => {
    const video = videoRef.current;
    if (video) {
      video.playbackRate = rate;
      setPlaybackRate(rate);
      normalRateRef.current = rate;
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    const video = videoRef.current;
    if (video) {
      video.volume = val;
      video.muted = val === 0;
      setVolume(val);
      setIsMuted(val === 0);
    }
  };

  const togglePip = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch {
      /* ignore */
    }
  };

  const toggleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen?.().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // 10. 全局快捷键映射
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (
        ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
          e.code,
        )
      ) {
        e.preventDefault();
      }

      const video = videoRef.current;
      switch (e.code) {
        case "Space":
          togglePlay();
          break;
        case "ArrowRight":
          if (video) {
            video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
            flashRipple("right");
          }
          break;
        case "ArrowLeft":
          if (video) {
            video.currentTime = Math.max(0, video.currentTime - 10);
            flashRipple("left");
          }
          break;
        case "ArrowUp":
          if (video) {
            const nextVol = Math.min(1, video.volume + 0.1);
            video.volume = nextVol;
            setVolume(nextVol);
            setIsMuted(false);
          }
          break;
        case "ArrowDown":
          if (video) {
            const nextVol = Math.max(0, video.volume - 0.1);
            video.volume = nextVol;
            setVolume(nextVol);
            setIsMuted(nextVol === 0);
          }
          break;
        case "KeyF":
          toggleFullscreen();
          break;
        case "KeyM":
          toggleMute();
          break;
      }
      resetIdleTimer();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [togglePlay, resetIdleTimer]);

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="relative w-full h-full flex items-center justify-center p-0 font-sans text-neutral-200 select-none overflow-hidden bg-neutral-950">
      {/* 播放器主视窗系统 */}
      <div
        ref={containerRef}
        id="player-container"
        onMouseMove={resetIdleTimer}
        onMouseLeave={handleContainerMouseLeave}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleVideoAreaClick}
        className={`group relative w-full h-full overflow-hidden bg-black select-none ${
          !controlsVisible ? "cursor-none" : "cursor-default"
        }`}
      >
        {/* 静谧电影感流光背景 (采样当前画面，100px 柔光漫反射) */}
        <canvas
          ref={ambientCanvasRef}
          id="ambient-canvas"
          className="absolute inset-0 -inset-x-8 -inset-y-6 w-full h-full filter blur-[100px] opacity-35 pointer-events-none transition-opacity duration-1000 -z-10"
        />

        {/* 真实视频渲染层 */}
        <video
          ref={videoRef}
          id="main-video"
          crossOrigin="anonymous"
          playsInline
          style={{ filter: filterStyle !== "none" ? filterStyle : undefined }}
          className="w-full h-full object-contain cursor-pointer"
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={handleEnded}
        />

        {/* 无激活媒体时的沉浸式就绪引导层 */}
        {!activeVideo.url && (
          <div className="absolute inset-0 isolate flex items-center justify-center overflow-hidden bg-[#050506]/95 text-white z-10 pointer-events-auto">
            <div
              aria-hidden="true"
              className="absolute inset-0 opacity-70 [background-image:linear-gradient(rgba(255,255,255,0.028)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.028)_1px,transparent_1px)] [background-size:32px_32px]"
            />
            <div
              aria-hidden="true"
              className="absolute h-[28rem] w-[28rem] rounded-full bg-[#FF466B]/15 blur-[110px]"
            />
            <div className="relative flex max-w-sm flex-col items-center px-7 text-center">
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#FF466B]/30 bg-[#FF466B]/10 shadow-[0_0_25px_rgba(255,70,107,0.35)]">
                <svg
                  className="w-6 h-6 text-[#FF466B] fill-current translate-x-0.5"
                  viewBox="0 0 24 24"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
              <span className="text-[10px] font-bold tracking-[0.28em] text-[#FF466B]">
                AERO CAPSULE PRO · ROSE NOIR
              </span>
              <h2 className="mt-3 text-xl font-semibold tracking-tight text-white/90">
                选一部片，开始放映
              </h2>
              <p className="mt-2 text-xs leading-5 text-neutral-400">
                点击右上角「选集」挑选片源，或直接把本地媒体拖入窗口
              </p>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsPlaylistOpen(true);
                }}
                className="mt-6 rounded-full border border-[#FF466B]/40 bg-[#FF466B]/20 hover:bg-[#FF466B] px-6 py-2.5 text-xs font-semibold text-white transition-all duration-200 hover:shadow-[0_0_25px_rgba(255,70,107,0.5)] active:scale-95 cursor-pointer"
              >
                打开选集 · {videos.length} 部片库
              </button>
            </div>
          </div>
        )}

        {/* 1. 顶部控制栏 (标题 + 选集入口 + 画质辅助) */}
        <div
          id="top-bar"
          className={`absolute top-0 inset-x-0 p-6 flex justify-between items-center bg-gradient-to-b from-black/80 via-black/20 to-transparent transition-all duration-300 pointer-events-none z-20 ${
            !controlsVisible ? "opacity-0 -translate-y-2" : "opacity-100 translate-y-0"
          }`}
        >
          <div className="flex items-center space-x-3 pointer-events-auto max-w-[65%]">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold tracking-wide bg-[#FF466B]/15 text-[#FF466B] border border-[#FF466B]/30 shadow-[0_0_10px_rgba(255,70,107,0.25)] shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-[#FF466B] mr-1.5 animate-pulse" />
              {activeVideo.resolution || "4K UHD"}
            </span>
            <h2
              id="video-title"
              className="text-sm font-medium tracking-wide text-neutral-200 drop-shadow truncate"
              title={activeVideo.name}
            >
              {activeVideo.name}
            </h2>
          </div>

          <div className="flex items-center space-x-2 pointer-events-auto">
            {/* 画质微控 */}
            {onOpenShader && (
              <button
                type="button"
                onClick={onOpenShader}
                className="glass-pill px-3 py-1.5 rounded-full text-xs font-semibold hover:border-[#FF466B]/50 hover:text-[#FF466B] transition flex items-center space-x-1 cursor-pointer"
                title="画质增强滤镜"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#FF466B]" />
                <span className="hidden sm:inline">画质</span>
              </button>
            )}

            {/* 分幕微控 */}
            {onOpenChapters && (
              <button
                type="button"
                onClick={onOpenChapters}
                className="glass-pill px-3 py-1.5 rounded-full text-xs font-semibold hover:border-[#FF466B]/50 hover:text-[#FF466B] transition flex items-center space-x-1 cursor-pointer"
                title="剧情分幕"
              >
                <Film className="w-3.5 h-3.5 text-[#FF466B]" />
                <span className="hidden sm:inline">分幕</span>
              </button>
            )}

            {/* 剪辑微控 */}
            {onOpenCut && (
              <button
                type="button"
                onClick={onOpenCut}
                className="glass-pill px-3 py-1.5 rounded-full text-xs font-semibold hover:border-[#FF466B]/50 hover:text-[#FF466B] transition flex items-center space-x-1 cursor-pointer"
                title="片段剪辑"
              >
                <Scissors className="w-3.5 h-3.5 text-[#FF466B]" />
                <span className="hidden sm:inline">剪辑</span>
              </button>
            )}

            {/* 加时间点 */}
            {onAddBookmark && (
              <button
                type="button"
                onClick={onAddBookmark}
                className="glass-pill px-3 py-1.5 rounded-full text-xs font-semibold hover:border-[#FF466B]/50 hover:text-[#FF466B] transition flex items-center space-x-1 cursor-pointer"
                title="添加高能书签"
              >
                <BookmarkPlus className="w-3.5 h-3.5 text-[#FF466B]" />
                <span className="hidden sm:inline">标记</span>
              </button>
            )}

            {/* 选集触发按钮 */}
            <button
              id="btn-toggle-playlist"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsPlaylistOpen((v) => !v);
              }}
              className="glass-pill px-4 py-1.5 rounded-full text-xs font-semibold hover:border-[#FF466B]/50 hover:text-[#FF466B] transition flex items-center space-x-1.5 cursor-pointer"
            >
              <Layers className="w-3.5 h-3.5 text-[#FF466B]" />
              <span>选集</span>
            </button>
          </div>
        </div>

        {/* 2. 长按 2.0x 极简微型灵动岛 */}
        <div
          id="speed-indicator"
          className={`absolute top-6 inset-x-0 mx-auto w-fit glass-pill px-3.5 py-1 rounded-full text-xs font-semibold text-[#FF466B] flex items-center space-x-1.5 transition-all duration-200 pointer-events-none z-30 border-[#FF466B]/40 ${
            isSpeedIslandActive
              ? "opacity-100 translate-y-0"
              : "opacity-0 -translate-y-3"
          }`}
        >
          <svg
            className="w-3.5 h-3.5 animate-pulse"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z"
              clipRule="evenodd"
            />
          </svg>
          <span className="tracking-wider">2.0X 极速播放</span>
        </div>

        {/* 3. 双击手势微光涟漪反馈 */}
        <div
          ref={rippleLeftRef}
          id="ripple-left"
          className="absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-[#FF466B]/20 to-transparent opacity-0 pointer-events-none transition-opacity duration-300 flex items-center pl-8 text-[#FF466B] font-mono text-xs font-bold"
        >
          -10s
        </div>
        <div
          ref={rippleRightRef}
          id="ripple-right"
          className="absolute inset-y-0 right-0 w-1/4 bg-gradient-to-l from-[#FF466B]/20 to-transparent opacity-0 pointer-events-none transition-opacity duration-300 flex items-center justify-end pr-8 text-[#FF466B] font-mono text-xs font-bold"
        >
          +10s
        </div>

        {/* 4. 底部核心悬浮胶囊 */}
        <div
          id="capsule"
          className={`absolute bottom-6 inset-x-0 mx-auto w-[92%] sm:w-[86%] max-w-2xl transition-all duration-500 z-20 ${
            !controlsVisible
              ? "opacity-0 translate-y-4 pointer-events-none"
              : "opacity-100 translate-y-0"
          }`}
        >
          <div className="glass-pill rounded-full px-5 py-3 flex items-center space-x-3 sm:space-x-4">
            {/* 播放/暂停 核心高光按键 (#FF466B 霓虹) */}
            <button
              id="btn-play"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                togglePlay();
              }}
              className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-tr from-[#FF466B] to-[#FF758C] text-white flex items-center justify-center hover:scale-105 active:scale-95 transition-transform duration-150 neon-rose cursor-pointer"
            >
              {isPlaying ? (
                <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
              ) : (
                <svg
                  className="w-4 h-4 fill-current translate-x-0.5"
                  viewBox="0 0 24 24"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            {/* 快退 10s */}
            <button
              id="btn-rewind"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (videoRef.current) {
                  videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10);
                  flashRipple("left");
                }
              }}
              className="text-neutral-400 hover:text-white transition p-1 hidden sm:block cursor-pointer"
              title="快退 10 秒"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.334 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z"
                />
              </svg>
            </button>

            {/* 快进 10s */}
            <button
              id="btn-forward"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (videoRef.current) {
                  videoRef.current.currentTime = Math.min(
                    videoRef.current.duration || 0,
                    videoRef.current.currentTime + 10,
                  );
                  flashRipple("right");
                }
              }}
              className="text-neutral-400 hover:text-white transition p-1 hidden sm:block cursor-pointer"
              title="快进 10 秒"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M11.934 12.8a1 1 0 000-1.6l-5.334-4A1 1 0 005 8v8a1 1 0 001.6.8l5.334-4zM19.934 12.8a1 1 0 000-1.6l-5.334-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.334-4z"
                />
              </svg>
            </button>

            {/* 精致波形进度轴 */}
            <div
              ref={timelineBoxRef}
              id="timeline-box"
              onClick={handleTimelineClick}
              onMouseMove={handleTimelineMouseMove}
              onMouseEnter={() => setIsHoveringTimeline(true)}
              onMouseLeave={() => setIsHoveringTimeline(false)}
              className="relative flex-1 group/progress cursor-pointer py-2"
            >
              {/* 刻度画面预览小窗口 */}
              <div
                ref={hoverCardRef}
                id="hover-card"
                className={`absolute -top-24 -translate-x-1/2 flex-col items-center pointer-events-none transition-all duration-75 z-40 ${
                  isHoveringTimeline ? "flex" : "hidden"
                }`}
              >
                <div className="glass-pill p-1.5 rounded-xl border border-white/20 shadow-2xl flex flex-col items-center">
                  <div className="w-24 h-14 rounded-lg bg-neutral-900 overflow-hidden relative border border-white/10">
                    <canvas
                      ref={previewCanvasRef}
                      id="preview-canvas"
                      className="w-full h-full object-cover"
                    />
                    <span
                      id="hover-time"
                      className="absolute bottom-1 right-1 text-[9px] font-mono bg-black/80 px-1 py-0.2 rounded text-[#FF466B] font-bold"
                    >
                      {hoverTimeText}
                    </span>
                  </div>
                  <span className="text-[9px] text-neutral-300 mt-1 font-medium tracking-tight">
                    章节实时刻度
                  </span>
                </div>
                <div className="w-1.5 h-1.5 bg-neutral-900 rotate-45 -mt-1 border-r border-b border-white/20" />
              </div>

              {/* 背景能量轨道 */}
              <div className="relative w-full h-2 rounded-full overflow-hidden bg-white/10 flex items-center">
                <svg
                  className="absolute inset-0 w-full h-full opacity-20"
                  preserveAspectRatio="none"
                  viewBox="0 0 100 20"
                >
                  <path
                    d="M0 10 Q 10 5, 20 12 T 40 8 T 60 14 T 80 6 T 100 10 L 100 20 L 0 20 Z"
                    fill="white"
                  />
                </svg>
                <div
                  id="buffer-bar"
                  className="absolute h-full bg-white/20 rounded-full"
                  style={{ width: `${bufferedPct}%` }}
                />
                <div
                  id="progress-bar"
                  className="absolute h-full bg-gradient-to-r from-[#FF466B] via-[#FF6584] to-[#FFA07A] rounded-full"
                  style={{ width: `${progressPct}%` }}
                />
              </div>

              {/* 磁吸阻尼游标 */}
              <div
                id="progress-thumb"
                className="absolute top-1/2 -mt-2 -ml-2 w-4 h-4 rounded-full bg-white shadow-md border-2 border-[#FF466B] scale-0 group-hover/progress:scale-100 transition-transform duration-150 pointer-events-none shadow-[0_0_10px_rgba(255,70,107,0.8)]"
                style={{ left: `${progressPct}%` }}
              />
            </div>

            {/* 精准时间戳 */}
            <div className="text-xs font-mono text-neutral-400 flex-shrink-0 tracking-tight select-none">
              <span id="current-time" className="text-white font-medium">
                {formatTime(currentTime)}
              </span>
              <span className="opacity-30 mx-0.5">/</span>
              <span id="duration-time">{formatTime(duration)}</span>
            </div>

            {/* 抽屉式阻尼音量 */}
            <div className="relative group/vol flex items-center">
              <button
                id="btn-volume"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleMute();
                }}
                className="text-neutral-400 hover:text-white transition p-1 cursor-pointer"
              >
                {isMuted || volume === 0 ? (
                  <svg
                    id="icon-muted"
                    className="w-5 h-5 text-[#FF466B]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
                    />
                  </svg>
                ) : (
                  <svg
                    id="icon-vol"
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                    />
                  </svg>
                )}
              </button>
              <div className="w-0 group-hover/vol:w-16 transition-all duration-200 overflow-hidden flex items-center">
                <input
                  id="volume-slider"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  onClick={(e) => e.stopPropagation()}
                  className="w-14 h-1.5 ml-1 accent-[#FF466B] bg-white/20 rounded-lg cursor-pointer"
                />
              </div>
            </div>
          </div>
        </div>

        {/* 5. 右侧独立垂直浮岛 */}
        <div
          id="side-dock"
          className={`absolute right-5 bottom-6 z-20 flex flex-col items-center space-y-2.5 transition-all duration-500 ${
            !controlsVisible
              ? "opacity-0 pointer-events-none"
              : "opacity-100"
          }`}
        >
          {/* 倍速选择 */}
          <div className="relative group/speed">
            <button
              id="speed-label"
              type="button"
              className="glass-pill w-9 h-9 rounded-full text-xs font-semibold tracking-tighter hover:text-[#FF466B] hover:border-[#FF466B]/50 transition flex items-center justify-center cursor-pointer"
            >
              {playbackRate.toFixed(playbackRate % 1 === 0 ? 1 : 2)}x
            </button>
            <div className="absolute bottom-11 right-0 hidden group-hover/speed:flex flex-col space-y-1 p-1.5 rounded-2xl glass-pill shadow-xl text-xs font-medium z-30">
              {[2.0, 1.5, 1.25, 1.0, 0.75].map((rate) => (
                <button
                  key={rate}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    changeSpeed(rate);
                  }}
                  className={`px-2.5 py-1 rounded-xl transition cursor-pointer ${
                    playbackRate === rate
                      ? "bg-white/10 text-[#FF466B] font-bold"
                      : "hover:bg-white/10 hover:text-[#FF466B]"
                  }`}
                >
                  {rate}x
                </button>
              ))}
            </div>
          </div>

          {/* 画中画 */}
          <button
            id="btn-pip"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              togglePip();
            }}
            className="glass-pill w-9 h-9 rounded-full text-neutral-400 hover:text-white hover:border-[#FF466B]/50 transition flex items-center justify-center cursor-pointer"
            title="画中画 (P)"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M19 11V6a2 2 0 00-2-2H4a2 2 0 00-2 2v10a2 2 0 002 2h6m5-5h6a1 1 0 011 1v4a1 1 0 01-1 1h-6a1 1 0 01-1-1v-4a1 1 0 011-1z"
              />
            </svg>
          </button>

          {/* 全屏 */}
          <button
            id="btn-fullscreen"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleFullscreen();
            }}
            className="glass-pill w-9 h-9 rounded-full text-neutral-400 hover:text-white hover:border-[#FF466B]/50 transition flex items-center justify-center cursor-pointer"
            title="全屏 (F)"
          >
            {isFullscreen ? (
              <svg
                id="icon-fs-exit"
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 4l5 5m0 0V5m0 4H5m15-5l-5 5m0 0V5m0 4h4M4 20l5-5m0 0v4m0-4H5m15 5l-5-5m0 0v4m0-4h4"
                />
              </svg>
            ) : (
              <svg
                id="icon-fs-enter"
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
                />
              </svg>
            )}
          </button>
        </div>

        {/* 6. 影院级「选集抽屉」滑层 (Drawer) */}
        <div
          id="playlist-drawer"
          onClick={(e) => e.stopPropagation()}
          className={`absolute inset-y-0 right-0 w-80 sm:w-88 glass-pill rounded-r-none rounded-l-3xl border-r-0 p-6 flex flex-col transition-transform duration-300 ease-out z-40 ${
            isPlaylistOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
          {/* 抽屉头部 */}
          <div className="flex items-center justify-between pb-4 border-b border-white/10">
            <div className="flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-[#FF466B] animate-ping" />
              <h3 className="text-sm font-semibold tracking-wide text-white">
                剧集与片源选集
              </h3>
              <span
                id="playlist-count"
                className="text-[10px] bg-white/10 text-neutral-400 px-1.5 py-0.5 rounded-full font-mono"
              >
                {videos.length} 集
              </span>
            </div>
            <button
              id="btn-close-playlist"
              type="button"
              onClick={() => setIsPlaylistOpen(false)}
              className="p-1 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* 剧集卡片列表 (支持滚轮滑动) */}
          <div
            id="playlist-items-container"
            className="flex-1 overflow-y-auto space-y-2.5 py-4 pr-1 custom-scroll"
          >
            {videos.length === 0 ? (
              <div className="py-12 text-center text-xs text-neutral-500">
                本地片库暂无视频
              </div>
            ) : (
              videos.map((item, index) => {
                const isItemPlaying =
                  item.id === selectedVideoId || item.name === activeVideo.name;
                return (
                  <div
                    key={item.id || item.name}
                    onClick={() => {
                      onSelectVideo(item, index);
                      setIsPlaylistOpen(false);
                    }}
                    className={`group/card relative p-3 rounded-2xl cursor-pointer border transition-all duration-200 ${
                      isItemPlaying
                        ? "bg-[#FF466B]/15 border-[#FF466B]/50 shadow-[0_0_15px_rgba(255,70,107,0.2)]"
                        : "bg-white/5 border-white/5 hover:border-white/20 hover:bg-white/10"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-xs font-semibold truncate max-w-[70%] ${
                          isItemPlaying
                            ? "text-[#FF466B]"
                            : "text-neutral-200 group-hover/card:text-white"
                        }`}
                        title={item.name}
                      >
                        {item.title || item.code || item.name}
                      </span>
                      {isItemPlaying ? (
                        <div className="flex items-end space-x-0.5 h-3">
                          <span className="w-0.5 h-full bg-[#FF466B] animate-pulse" />
                          <span className="w-0.5 h-2/3 bg-[#FF466B] animate-ping" />
                          <span className="w-0.5 h-4/5 bg-[#FF466B] animate-pulse" />
                        </div>
                      ) : (
                        <span className="text-[10px] font-mono text-neutral-400">
                          {item.duration || item.resolution || "本地"}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-neutral-400 line-clamp-1 mt-1">
                      {item.actors?.length
                        ? item.actors.join(", ")
                        : item.plot || item.name}
                    </p>
                  </div>
                );
              })
            )}
          </div>

          <div className="pt-3 border-t border-white/10 text-[11px] text-neutral-400 flex items-center justify-between">
            <span>自动连播下一集</span>
            <div
              onClick={() => setAutoNext((v) => !v)}
              className={`w-8 h-4 rounded-full flex items-center px-0.5 cursor-pointer transition-colors duration-200 ${
                autoNext ? "bg-[#FF466B] justify-end" : "bg-white/20 justify-start"
              }`}
            >
              <div className="w-3 h-3 rounded-full bg-white shadow-sm" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
