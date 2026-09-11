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
import { Dropdown } from "../Dropdown";
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
  /** 本地视频的刻度图 WebVTT（雪碧图）；在线流无此数据，悬停仍显示当前帧 */
  previewVttUrl?: string | null;
  /** 播放页是否激活（常驻挂载时用于屏蔽后台快捷键） */
  active?: boolean;
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
  previewVttUrl,
  active = true,
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

  // 缓冲冻结帧：seek/缓冲期间把最后一帧画到遮罩上（底衬环境色而非黑），避免黑屏闪变

  // 刻度图（雪碧图）解析：vtt 里按时间区间给出 thumbs.webp 的 xywh 裁剪框
  const spriteRef = useRef<HTMLImageElement | null>(null);
  const spriteCuesRef = useRef<
    Array<{ start: number; end: number; x: number; y: number; w: number; h: number }>
  >([]);
  useEffect(() => {
    let alive = true;
    spriteCuesRef.current = [];
    spriteRef.current = null;
    if (!previewVttUrl) return;
    void (async () => {
      try {
        const text = await (await fetch(previewVttUrl)).text();
        if (!alive) return;
        const cues: Array<{ start: number; end: number; x: number; y: number; w: number; h: number }> = [];
        const toSeconds = (stamp: string) => {
          const [h, m, s] = stamp.trim().split(":");
          return Number(h) * 3600 + Number(m) * 60 + Number(s);
        };
        const blocks = text.replace(/^WEBVTT.*$/im, "").split(/\n\s*\n/);
        for (const block of blocks) {
          const range = block.match(
            /^([\d:.]+)\s+-->\s+([\d:.]+)/m,
          );
          const xy = block.match(/#xywh=(\d+),(\d+),(\d+),(\d+)/);
          if (!range || !xy) continue;
          cues.push({
            start: toSeconds(range[1]),
            end: toSeconds(range[2]),
            x: Number(xy[1]),
            y: Number(xy[2]),
            w: Number(xy[3]),
            h: Number(xy[4]),
          });
        }
        // 雪碧图与 vtt 同目录（thumbs.vtt / thumbs.webp）
        const base = previewVttUrl.replace(/[^/]+$/, "");
        const img = new Image();
        img.decoding = "async";
        img.src = `${base}thumbs.webp`;
        await img.decode().catch(() => undefined);
        if (!alive) return;
        spriteCuesRef.current = cues;
        spriteRef.current = img.complete && img.naturalWidth > 0 ? img : null;
      } catch {
        spriteCuesRef.current = [];
        spriteRef.current = null;
      }
    })();
    return () => {
      alive = false;
    };
  }, [previewVttUrl]);

  // 播放状态
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // 乐观跳转：点击刻度/进度条后立即把游标指到目标位置，缓冲完成前显示「加载中」
  // （走 ref 直写，不进 React 状态，避免 timeupdate/拖拽高频重渲染）
  const pendingSeekRef = useRef<number | null>(null);
  const isTimelineDraggingRef = useRef(false);
  const lastDragSeekRef = useRef(0);
  // 最近一次涟漪闪现时刻：长按快进时按键重复高频触发，节流避免两侧提示常亮遮挡
  const lastRippleAtRef = useRef(0);
  // 进度轴 rect 缓存：move 中「读 rect + 写样式」交替会触发强制同步重排（卡顿根源）
  const timelineRectRef = useRef<DOMRect | null>(null);
  // 在线流可选画质：hls.js 母带解析出的档位（降序展示，默认当前自动档）
  const [hlsLevels, setHlsLevels] = useState<
    Array<{ i: number; h: number }>
  >([]);
  const [hlsCurrent, setHlsCurrent] = useState(-1);

  // 交互状态
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isPlaylistOpen, setIsPlaylistOpen] = useState(false);
  const [autoNext, setAutoNext] = useState(true);
  const [isHoveringTimeline, setIsHoveringTimeline] = useState(false);
  const [isSpeedIslandActive, setIsSpeedIslandActive] = useState(false);

  // 进度/时间/悬停/音量热路径的 DOM 直写 ref：
  // timeupdate 与拖拽逐帧更新，绕过 setState 全树重渲染（否则高频拖拽必卡）
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const progressThumbRef = useRef<HTMLDivElement | null>(null);
  const bufferBarRef = useRef<HTMLDivElement | null>(null);
  const currentTimeTextRef = useRef<HTMLSpanElement | null>(null);
  const hoverTimeRef = useRef<HTMLSpanElement | null>(null);
  const volumeSliderRef = useRef<HTMLInputElement | null>(null);
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
      // 在线可选画质：从母带解析分辨率档位，默认最高级（N/A 时 hls 自动规则）
      // 在线可选画质：解析母带档位；默认直接钉住最高档（不用 ABR 自适应，避免弱网自动降画质）
      hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
        // 兼容母带无 RESOLUTION 属性（只有 BANDWIDTH）的清单：画质钉最高按双键取优
        const parsed: Array<{ i: number; h: number; bw: number }> = (
          (data as any)?.levels || []
        ).map((l: any, i: number) => ({
          i,
          h: Number(l?.height) || 0,
          bw: Number(l?.bitrate) || 0,
        }));
        const heightLevels: Array<{ i: number; h: number }> = parsed
          .filter((x: { h: number }) => x.h > 0)
          .map((x) => ({ i: x.i, h: x.h }));
        setHlsLevels(heightLevels);
        if (parsed.length > 0) {
          const usable: Array<{ i: number; h: number; bw: number }> =
            heightLevels.length > 0
              ? heightLevels.map((x: { i: number; h: number }) => ({
                  ...x,
                  bw: parsed[x.i] ? parsed[x.i].bw : 0,
                }))
              : parsed.filter(
                  (x: { bw: number }) => x.bw > 0,
                );
          if (usable.length > 0) {
            const best = usable.reduce(
              (a: { i: number; h: number; bw: number }, b: { i: number; h: number; bw: number }) => {
                if (b.h !== a.h) return b.h > a.h ? b : a;
                return b.bw > a.bw ? b : a;
              },
            );
            hls.currentLevel = best.i;
            setHlsCurrent(best.i);
          }
        }
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, d: any) => {
        setHlsCurrent(Number(d?.level ?? -1));
      });
      // 进入应用默认暂停，不自动起播
    } else {
      video.src = finalUrl;
      // 进入应用默认暂停，不自动起播
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
    const t = video.currentTime || 0;
    const dur = video.duration || 0;
    // 乐观跳转冻结：video 追到目标位附近前不改写 UI（游标保持在目标位）
    const pending = pendingSeekRef.current;
    if (pending != null) {
      if (Math.abs(t - pending) <= 2) {
        pendingSeekRef.current = null;
      } else {
        return;
      }
    }
    // 热路径 DOM 直写：进度条/游标/时间文本，不触发 React 重渲染
    const pct = dur > 0 ? (t / dur) * 100 : 0;
    if (progressBarRef.current) progressBarRef.current.style.width = `${pct}%`;
    if (progressThumbRef.current) progressThumbRef.current.style.left = `${pct}%`;
    if (currentTimeTextRef.current) {
      currentTimeTextRef.current.textContent = formatTime(t);
    }
    if (bufferBarRef.current) {
      if (video.buffered.length > 0 && dur > 0) {
        const bufEnd = video.buffered.end(video.buffered.length - 1);
        bufferBarRef.current.style.width = `${Math.min(100, (bufEnd / dur) * 100)}%`;
      } else {
        bufferBarRef.current.style.width = "0%";
      }
    }
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setDuration(video.duration || 0);
    onMeta?.({ width: video.videoWidth, height: video.videoHeight });
    // 换片后进度 UI 归零（热路径为 DOM 直写，需手动复位）
    pendingSeekRef.current = null;
    if (progressBarRef.current) progressBarRef.current.style.width = "0%";
    if (progressThumbRef.current) progressThumbRef.current.style.left = "0%";
    if (bufferBarRef.current) bufferBarRef.current.style.width = "0%";
    if (currentTimeTextRef.current) {
      currentTimeTextRef.current.textContent = formatTime(0);
    }
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

  // 4. 控制栏优雅闲置隐藏与移出隐藏 (5秒静止隐藏；悬停胶囊时钉住不隐藏)
  const controlsPinnedRef = useRef(false);
  const resetIdleTimer = useCallback(() => {
    setControlsVisible(true);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    const video = videoRef.current;
    if (video && !video.paused && !isPlaylistOpen && !controlsPinnedRef.current) {
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
  /** 统一 seek 入口：记录跳转前播放位置，供冻结帧遮罩按跳转距离决定是否显示 */
  const seekVideoTo = (t: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = t;
  };

  const flashRipple = (type: "left" | "right") => {
    // 节流：长按/连点快进时按键重复高频触发，不重复闪现（单次快进仍正常提示）
    const now = performance.now();
    if (now - lastRippleAtRef.current < 600) return;
    lastRippleAtRef.current = now;
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
          seekVideoTo(Math.max(0, video.currentTime - 10));
          flashRipple("left");
        } else {
          seekVideoTo(Math.min(video.duration || 0, video.currentTime + 10));
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
  // 在线流（m3u8/CDN）：没有本地刻度雪碧图，悬停预览小窗整个隐藏
  const isOnlineStream =
    activeVideo.url.includes(".m3u8") || /^https?:\/\//i.test(activeVideo.url);
  const handleTimelineMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const box = timelineBoxRef.current;
    const video = videoRef.current;
    const hoverCard = hoverCardRef.current;
    const previewCanvas = previewCanvasRef.current;
    if (!box || !video || !duration) return;

    if (!timelineRectRef.current) {
      timelineRectRef.current = box.getBoundingClientRect();
    }
    const rect = timelineRectRef.current;
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (hoverCard && !isOnlineStream) {
      hoverCard.style.left = `${pos * 100}%`;
    }
    const targetTime = pos * duration;
    if (hoverTimeRef.current) {
      hoverTimeRef.current.textContent = formatTime(targetTime);
    }
    if (isOnlineStream) return;

    if (previewCanvas) {
      // 尺寸只设一次：每次 move 重设 width/height 会清空画布并重新分配
      if (previewCanvas.width !== 96) {
        previewCanvas.width = 96;
        previewCanvas.height = 56;
      }
      const ctx = previewCanvas.getContext("2d");
      if (ctx) {
        // 有刻度雪碧图：按目标时间对应的格子裁剪绘制（这才是真实画面的预览）
        const sprite = spriteRef.current;
        const cues = spriteCuesRef.current;
        if (sprite && cues.length > 0) {
          const cue =
            cues.find((c) => targetTime >= c.start && targetTime < c.end) ??
            (targetTime >= duration ? cues[cues.length - 1] : undefined);
          if (cue) {
            try {
              ctx.drawImage(sprite, cue.x, cue.y, cue.w, cue.h, 0, 0, 96, 56);
            } catch {
              /* ignore */
            }
          }
        } else {
          // 无雪碧图（在线流）：退回绘制当前帧
          try {
            ctx.drawImage(video, 0, 0, 96, 56);
          } catch {
            /* ignore */
          }
        }
      }
    }
  };

  /** 拖拽/点击进度轴共用：UI 游标实时跟手（DOM 直写），seek 节流下发防卡顿 */
  const seekTimelineTo = (
    clientX: number,
    box: HTMLDivElement,
    immediate: boolean,
  ) => {
    const video = videoRef.current;
    if (!video || !duration) return;
    if (!timelineRectRef.current) {
      timelineRectRef.current = box.getBoundingClientRect();
    }
    const rect = timelineRectRef.current;
    const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const target = pos * duration;
    // 乐观跳转：游标直写到目标位，缓冲完成后由 timeupdate 自然接管
    pendingSeekRef.current = target;
    const pct = (target / duration) * 100;
    if (progressBarRef.current) progressBarRef.current.style.width = `${pct}%`;
    if (progressThumbRef.current) progressThumbRef.current.style.left = `${pct}%`;
    if (currentTimeTextRef.current) {
      currentTimeTextRef.current.textContent = formatTime(target);
    }
    // seek 节流：拖拽中每 200ms 下发一次真实跳转，松手/单击立即精确跳转
    const now = performance.now();
    if (immediate || now - lastDragSeekRef.current > 200) {
      lastDragSeekRef.current = now;
      seekVideoTo(target);
    }
    resetIdleTimer();
  };

  const handleTimelinePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // pointer capture：按住拖到轴外也持续跟手
    e.currentTarget.setPointerCapture(e.pointerId);
    isTimelineDraggingRef.current = true;
    timelineRectRef.current = e.currentTarget.getBoundingClientRect();
    seekTimelineTo(e.clientX, e.currentTarget, true);
  };

  const handleTimelinePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isTimelineDraggingRef.current) return;
    seekTimelineTo(e.clientX, e.currentTarget, false);
  };

  const handleTimelinePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isTimelineDraggingRef.current) return;
    isTimelineDraggingRef.current = false;
    seekTimelineTo(e.clientX, e.currentTarget, true);
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

  /** 音量滑杆渐变填充直写（不经 React 状态，拖拽零重渲染） */
  const syncVolumeSlider = useCallback((v: number) => {
    const el = volumeSliderRef.current;
    if (el) {
      el.value = String(v);
      el.style.background = `linear-gradient(to right, #FF466B ${v * 100}%, rgba(255, 255, 255, 0.22) ${v * 100}%)`;
    }
  }, []);

  // 初始渐变填充（音量默认 1）
  useEffect(() => {
    syncVolumeSlider(videoRef.current?.volume ?? 1);
  }, [syncVolumeSlider]);

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
    // 滑杆填充同步：静音显示空槽，取消静音恢复实际音量
    syncVolumeSlider(video.muted ? 0 : video.volume);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    const video = videoRef.current;
    if (video) {
      video.volume = val;
      video.muted = val === 0;
    }
    // 渐变直写；setIsMuted 同值时 React 会 bail-out，仅在跨越静音边界时重渲染
    syncVolumeSlider(val);
    setIsMuted(val === 0);
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

  // 10. 全局快捷键映射（仅播放页激活时生效）
  useEffect(() => {
    if (!active) return;
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
            seekVideoTo(Math.min(video.duration || 0, video.currentTime + 10));
            flashRipple("right");
          }
          break;
        case "ArrowLeft":
          if (video) {
            seekVideoTo(Math.max(0, video.currentTime - 10));
            flashRipple("left");
          }
          break;
        case "ArrowUp":
          if (video) {
            const nextVol = Math.min(1, video.volume + 0.1);
            video.volume = nextVol;
            syncVolumeSlider(nextVol);
            setIsMuted(false);
          }
          break;
        case "ArrowDown":
          if (video) {
            const nextVol = Math.max(0, video.volume - 0.1);
            video.volume = nextVol;
            syncVolumeSlider(nextVol);
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
  }, [togglePlay, resetIdleTimer, active]);

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

        {/* 真实视频渲染层（缓冲冻结帧遮罩：只盖 video 区域，永远在视频之上但低于控制条） */}
        <video
          ref={videoRef}
          id="main-video"
          crossOrigin="anonymous"
          playsInline
          style={{ filter: filterStyle !== "none" ? filterStyle : undefined }}
          className="relative z-0 w-full h-full object-contain cursor-pointer bg-transparent"
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={handleEnded}
        />


        {/* 无激活媒体时的沉浸式就绪引导层 */}
        {!activeVideo.url && (
          <div className="absolute inset-0 isolate flex items-center justify-center overflow-hidden bg-[#2a2d33]/95 text-white z-10 pointer-events-auto">
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
            {hlsLevels.length > 0 ? (
              // 在线流：画质选择器（组件库 Dropdown，按分辨率降序；默认自动=母带最高档）
              (() => {
                const sorted = [...hlsLevels].sort((a, b) => b.h - a.h);
                const currentValue = hlsCurrent === -1 ? "auto" : String(hlsCurrent);
                return (
                  <div onClick={(ev) => ev.stopPropagation()}>
                    <Dropdown<string>
                      value={currentValue}
                      options={[
                        { value: "auto", label: "自动（最高）" },
                        ...sorted.map((l) => ({
                          value: String(l.i),
                          label: `${l.h}P`,
                          dot: "bg-[#FF466B]",
                        })),
                      ]}
                      onChange={(v) => {
                        if (hlsRef.current) {
                          hlsRef.current.currentLevel =
                            v === "auto" ? -1 : Number(v);
                        }
                      }}
                      minWidth={120}
                      prefix="画质"
                      customTriggerStyle="flex items-center justify-between gap-2 px-3 py-1 rounded-full text-xs font-semibold tracking-wide bg-[#FF466B]/15 text-neutral-200 border border-[#FF466B]/30 shadow-[0_0_10px_rgba(255,70,107,0.25)] transition cursor-pointer hover:bg-[#FF466B]/25 shrink-0 [&_.text-accent-500]:text-[#FF466B]"
                    />
                  </div>
                );
              })()
            ) : (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold tracking-wide bg-[#FF466B]/15 text-[#FF466B] border border-[#FF466B]/30 shadow-[0_0_10px_rgba(255,70,107,0.25)] shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-[#FF466B] mr-1.5 animate-pulse" />
                {activeVideo.resolution || "4K UHD"}
              </span>
            )}
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

        {/* 4. 底部核心悬浮胶囊（悬停时锁定控制栏不被闲置隐藏，保证可达速度/音量选择器） */}
        <div
          id="capsule"
          onMouseEnter={() => {
            controlsPinnedRef.current = true;
            if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
            setControlsVisible(true);
          }}
          onMouseLeave={() => {
            controlsPinnedRef.current = false;
            resetIdleTimer();
          }}
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
              className="flex-shrink-0 w-10 h-10 rounded-full bg-[#FF466B] hover:bg-[#ff5d7e] text-white flex items-center justify-center hover:scale-105 active:scale-95 transition-transform duration-150 neon-rose cursor-pointer"
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
                  seekVideoTo(Math.max(0, videoRef.current.currentTime - 10));
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
                  seekVideoTo(
                    Math.min(
                      videoRef.current.duration || 0,
                      videoRef.current.currentTime + 10,
                    ),
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
              onPointerDown={handleTimelinePointerDown}
              onPointerMove={handleTimelinePointerMove}
              onPointerUp={handleTimelinePointerUp}
              onPointerCancel={handleTimelinePointerUp}
              onMouseMove={handleTimelineMouseMove}
              onMouseEnter={() => {
                timelineRectRef.current =
                  timelineBoxRef.current?.getBoundingClientRect() ?? null;
                setIsHoveringTimeline(true);
              }}
              onMouseLeave={() => setIsHoveringTimeline(false)}
              className="relative flex-1 group/progress cursor-pointer py-2 touch-none"
            >
              {/* 刻度画面预览小窗口（在线流没有本地雪碧图 → 整窗隐藏） */}
              <div
                ref={hoverCardRef}
                id="hover-card"
                className={`absolute -top-24 -translate-x-1/2 flex-col items-center pointer-events-none z-40 ${
                  isOnlineStream || !isHoveringTimeline ? "hidden" : "flex"
                }`}
              >
                <div className="glass-pill p-1 rounded-xl border border-white/10 shadow-2xl flex flex-col items-center">
                  <div className="w-36 h-20 rounded-lg bg-neutral-900 overflow-hidden relative border border-white/10">
                    <canvas
                      ref={previewCanvasRef}
                      id="preview-canvas"
                      className="w-full h-full object-cover"
                    />
                    <span
                      ref={hoverTimeRef}
                      id="hover-time"
                      className="absolute bottom-1 right-1 text-[9px] font-mono bg-black/80 px-1 py-0.2 rounded text-[#FF466B] font-bold"
                    >
                      00:00
                    </span>
                  </div>
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
                  ref={bufferBarRef}
                  id="buffer-bar"
                  className="absolute h-full bg-white/20 rounded-full"
                />
                <div
                  ref={progressBarRef}
                  id="progress-bar"
                  className="absolute h-full bg-gradient-to-r from-[#FF466B] via-[#FF6584] to-[#FFA07A] rounded-full"
                />
              </div>

              {/* 磁吸阻尼游标 */}
              <div
                ref={progressThumbRef}
                id="progress-thumb"
                className="absolute top-1/2 -mt-2 -ml-2 w-4 h-4 rounded-full bg-white shadow-md border-2 border-[#FF466B] scale-0 group-hover/progress:scale-100 transition-transform duration-150 pointer-events-none shadow-[0_0_10px_rgba(255,70,107,0.8)]"
              />
            </div>

            {/* 精准时间戳 */}
            <div className="text-xs font-mono text-neutral-400 flex-shrink-0 tracking-tight select-none">
              <span
                ref={currentTimeTextRef}
                id="current-time"
                className="text-white font-medium"
              >
                00:00
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
                {isMuted ? (
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
                  ref={volumeSliderRef}
                  id="volume-slider"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  defaultValue={1}
                  onChange={handleVolumeChange}
                  onClick={(e) => e.stopPropagation()}
                  className="w-14 h-1.5 ml-1 rounded-lg cursor-pointer"
                />
              </div>
            </div>
          </div>
        </div>

        {/* 5. 右侧独立垂直浮岛（悬停时同样钉住控制栏——倍速/画中画/全屏可达） */}
        <div
          id="side-dock"
          onMouseEnter={() => {
            controlsPinnedRef.current = true;
            if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
            setControlsVisible(true);
          }}
          onMouseLeave={() => {
            controlsPinnedRef.current = false;
            resetIdleTimer();
          }}
          className={`absolute right-5 bottom-6 z-20 flex flex-col items-center space-y-2.5 transition-all duration-500 ${
            !controlsVisible
              ? "opacity-0 pointer-events-none"
              : "opacity-100"
          }`}
        >
          {/* 倍速选择（面板紧贴按钮，无悬停空隙断连） */}
          <div className="relative group/speed">
            <button
              id="speed-label"
              type="button"
              className="glass-pill w-9 h-9 rounded-full text-xs font-semibold tracking-tighter hover:text-[#FF466B] hover:border-[#FF466B]/50 transition flex items-center justify-center cursor-pointer"
            >
              {playbackRate.toFixed(playbackRate % 1 === 0 ? 1 : 2)}x
            </button>
            <div className="absolute bottom-full right-0 hidden group-hover/speed:flex flex-col space-y-1 p-1.5 rounded-2xl glass-pill shadow-xl text-xs font-medium z-30">
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
