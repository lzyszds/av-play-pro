import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Hls from "hls.js";
//@ts-ignore
import Plyr from "plyr";
import { Sun, Shield } from "lucide-react";
import { PlayerHeatmap, recordUserSeekHeat } from "./PlayerHeatmap";

interface Props {
  url: string;
  autoPlay?: boolean;
  referer?: string;
  previewVttUrl?: string | null;
  /** 字幕文件的 local-media://... URL（srt 或 vtt） */
  subtitleUrl?: string | null;
  bookmarks?: Array<{ currentTime: number; note?: string }>;
  filterStyle?: string;
  /** 智能自适应黑场暗部补偿 (B125) */
  autoShadowLift?: boolean;
  /** 夜间防眩柔光保护 (B125) */
  antiGlare?: boolean;
  onMeta?: (info: { width: number; height: number }) => void;
  /** 透传到 <video> 上的事件，外层挂播放/暂停统计 */
  onVideoEl?: (el: HTMLVideoElement) => void;
  onLog?: (
    msg: string,
    level: "INFO" | "WARNING" | "SUCCESS" | "ERROR",
  ) => void;
}

// 把 SRT 文本转 WebVTT：替换 "," → "."，前面加 "WEBVTT\n\n"
function srtToVtt(srt: string): string {
  const body = srt
    .replace(/\r+/g, "")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, (_m, t, ms) => `${t}.${ms}`);
  return "WEBVTT\n\n" + body;
}

const CDN_PROXY_BASE = "http://127.0.0.1:39528/m";

function toProxied(url: string, referer?: string) {
  // 只代理 fourhoi/surrit 等 CDN 域名
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

export const HlsVideoPlayer: React.FC<Props> = ({
  url,
  autoPlay = true,
  referer,
  previewVttUrl,
  subtitleUrl,
  bookmarks = [],
  filterStyle = "none",
  autoShadowLift = true,
  antiGlare = true,
  onMeta,
  onVideoEl,
  onLog,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const plyrRef = useRef<Plyr | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const subtitleBlobRef = useRef<string | null>(null);

  const [progressEl, setProgressEl] = useState<HTMLElement | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [videoCurrentTime, setVideoCurrentTime] = useState<number>(0);

  // APL 自适应黑场补偿与防眩目状态 (B125)
  const [aplComfort, setAplComfort] = useState<{
    mode: "shadow" | "glare" | "normal";
    boost: number;
  }>({ mode: "normal", boost: 1 });

  // 定期采样画面平均亮度 (APL)
  useEffect(() => {
    if (!autoShadowLift && !antiGlare) {
      setAplComfort({ mode: "normal", boost: 1 });
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    let prevApl = 0.5;
    const timer = setInterval(() => {
      const video = containerRef.current?.querySelector("video");
      if (!video || video.paused || video.ended || video.readyState < 2) return;
      try {
        ctx.drawImage(video, 0, 0, 16, 16);
        const imgData = ctx.getImageData(0, 0, 16, 16);
        const d = imgData.data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) {
          sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        }
        const currentApl = sum / (256 * 255);

        // 1. 防眩目：从极暗突然切到高亮刺眼场景
        if (antiGlare && currentApl > 0.72 && prevApl < 0.35) {
          setAplComfort({ mode: "glare", boost: 0.86 });
        }
        // 2. 黑场暗部补偿：微光极暗场景智能提亮阴影
        else if (autoShadowLift && currentApl < 0.18) {
          const factor = Math.max(1.12, Math.min(1.26, 1 + (0.18 - currentApl) * 1.2));
          setAplComfort({ mode: "shadow", boost: factor });
        } else {
          setAplComfort({ mode: "normal", boost: 1 });
        }
        prevApl = currentApl;
      } catch {
        /* ignore sampling errors */
      }
    }, 450);

    return () => clearInterval(timer);
  }, [autoShadowLift, antiGlare]);

  // 响应式应用画质滤镜与自适应舒适度
  useEffect(() => {
    const video = containerRef.current?.querySelector("video");
    if (video) {
      let f = filterStyle && filterStyle !== "none" ? filterStyle : "";
      if (aplComfort.mode === "shadow" && aplComfort.boost > 1) {
        f = `${f} brightness(${aplComfort.boost.toFixed(2)}) contrast(1.04)`.trim();
      } else if (aplComfort.mode === "glare" && aplComfort.boost < 1) {
        f = `${f} brightness(0.88) contrast(0.96)`.trim();
      }
      video.style.transition = "filter 0.4s ease";
      video.style.filter = f || "none";
    }
  }, [filterStyle, aplComfort]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !url) return;

    // 命令式创建 video 元素，挂到 container 下。Plyr 包它、React 不直接拥有它，卸载时不会冲突
    const video = document.createElement("video");
    video.className = "w-full h-full object-contain";
    video.playsInline = true;
    if (filterStyle) {
      video.style.filter = filterStyle;
    }

    container.appendChild(video);

    onVideoEl?.(video);
    const plyrOption = {
      iconUrl: "./plyr.svg",
      controls: [
        "play-large",
        "play",
        "progress",
        "current-time",
        "duration",
        "mute",
        "volume",
        "captions",
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
        captions: "字幕",
        enableCaptions: "开启字幕",
        disableCaptions: "关闭字幕",
        pip: "画中画",
        airplay: "AirPlay",
        fullscreen: "全屏",
        exitFullscreen: "退出全屏",
        current: "当前时间",
        duration: "总时长",
      },
      settings: ["captions", "speed"],
      captions: { active: true, language: "auto", update: true },
      speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
      tooltips: { controls: true, seek: true },
      // 键盘交给 PlayerPage 统一处理（含空格），避免 Plyr 全局键盘与全局 keydown 双重切换互相抵消
      keyboard: { focused: false, global: false },
      previewThumbnails: previewVttUrl
        ? { enabled: true, src: previewVttUrl }
        : { enabled: false },
    };
    console.log("Plyr options:", plyrOption);
    // 初始化 Plyr（每次挂载都新建）
    const plyr = new Plyr(video, plyrOption);
    plyrRef.current = plyr;

    plyr.on("ready", () => {
      const pEl = container.querySelector(".plyr__progress") as HTMLElement | null;
      if (pEl) setProgressEl(pEl);
    });

    const onLoadedMeta = () => {
      setVideoDuration(video.duration || 0);
      onMeta?.({ width: video.videoWidth, height: video.videoHeight });
    };
    video.addEventListener("loadedmetadata", onLoadedMeta);

    const onTimeUpdate = () => {
      setVideoCurrentTime(video.currentTime || 0);
    };
    video.addEventListener("timeupdate", onTimeUpdate);

    const onSeeking = () => {
      if (video.duration > 0) {
        recordUserSeekHeat(url, video.currentTime, video.duration);
      }
    };
    video.addEventListener("seeking", onSeeking);

    const onPlayEvent = () => {
      window.dispatchEvent(
        new CustomEvent("avplay:video-playing", {
          detail: { url, currentTime: video.currentTime || 0 },
        }),
      );
    };
    video.addEventListener("play", onPlayEvent);

    const tryPlay = () => {
      if (!autoPlay) return;
      const p = video.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    };

    const isHls = url.includes(".m3u8");

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        // 性能
        enableWorker: true, // demux 放 worker，不阻塞主线程
        lowLatencyMode: false, // 关 LL，普通 VOD 用不到
        backBufferLength: 30, // 播过的最多保留 30s，释放内存
        maxBufferLength: 60, // 前向最多缓 60s，扛网络抖动
        maxMaxBufferLength: 120,
        maxBufferSize: 120 * 1024 * 1024, // 120MB 缓冲
        // 超时
        manifestLoadingTimeOut: 20000,
        manifestLoadingMaxRetry: 2,
        levelLoadingTimeOut: 20000,
        fragLoadingTimeOut: 30000,
        fragLoadingMaxRetry: 4,
      });
      hlsRef.current = hls;

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        onLog?.("[HLS] manifest 解析完成", "INFO");
        tryPlay();
      });

      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        onLog?.(`[HLS] 致命错误: ${data.type} / ${data.details}`, "ERROR");
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          hls.destroy();
        }
      });

      hls.loadSource(toProxied(url, referer));
      hls.attachMedia(video);
    } else if (isHls && video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari 原生 HLS
      video.src = toProxied(url, referer);
      video.addEventListener("loadedmetadata", tryPlay, { once: true });
    } else {
      // 本地 mp4
      video.src = url;
      video.addEventListener("loadedmetadata", tryPlay, { once: true });
    }

    return () => {
      video.removeEventListener("loadedmetadata", onLoadedMeta);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("seeking", onSeeking);
      video.removeEventListener("play", onPlayEvent);
      setProgressEl(null);
      try {
        video.pause();
        // 显式卸掉 src，否则 Windows 上 local-media 文件句柄可能一直占着，导致删不掉
        video.removeAttribute("src");
        video.load();
      } catch {
        /* ignore */
      }
      if (hlsRef.current) {
        try {
          hlsRef.current.destroy();
        } catch {
          /* ignore */
        }
        hlsRef.current = null;
      }
      if (plyrRef.current) {
        try {
          plyrRef.current.destroy();
        } catch {
          /* ignore */
        }
        plyrRef.current = null;
      }
      // 兜底：把 container 内的所有节点全部清掉（Plyr / 我们自己加的 video / wrapper）
      try {
        container.innerHTML = "";
      } catch {
        /* ignore */
      }
      if (subtitleBlobRef.current) {
        try {
          URL.revokeObjectURL(subtitleBlobRef.current);
        } catch {
          /* ignore */
        }
        subtitleBlobRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewVttUrl]);

  useEffect(() => {
    const container = containerRef.current;
    const video = container?.querySelector("video");
    if (!video) return;

    for (const track of Array.from(
      video.querySelectorAll("track[data-ai-subtitle='true']"),
    )) {
      track.remove();
    }
    if (subtitleBlobRef.current) {
      try {
        URL.revokeObjectURL(subtitleBlobRef.current);
      } catch {
        /* ignore */
      }
      subtitleBlobRef.current = null;
    }
    if (!subtitleUrl) return;

    let cancelled = false;
    let track: HTMLTrackElement | null = null;
    let objectUrl: string | null = null;

    (async () => {
      try {
        let trackSrc = subtitleUrl;
        if (/\.srt(\?|$)/i.test(subtitleUrl)) {
          const resp = await fetch(subtitleUrl);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const srt = await resp.text();
          const vtt = srtToVtt(srt);
          const blob = new Blob([vtt], { type: "text/vtt" });
          objectUrl = URL.createObjectURL(blob);
          trackSrc = objectUrl;
        }
        if (cancelled) {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          return;
        }

        track = document.createElement("track");
        track.dataset.aiSubtitle = "true";
        track.kind = "subtitles";
        track.label = "AI 字幕";
        track.srclang = "auto";
        track.src = trackSrc;
        track.default = true;
        video.appendChild(track);
        if (objectUrl) subtitleBlobRef.current = objectUrl;

        const showTrack = () => {
          const textTrack = track?.track;
          if (textTrack) textTrack.mode = "showing";
        };
        track.addEventListener("load", showTrack, { once: true });
        setTimeout(showTrack, 100);
      } catch (err) {
        onLog?.(
          `[Subtitle] 字幕加载失败: ${(err as Error).message}`,
          "WARNING",
        );
      }
    })();

    return () => {
      cancelled = true;
      track?.remove();
      if (objectUrl) {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {
          /* ignore */
        }
      }
      if (subtitleBlobRef.current === objectUrl) subtitleBlobRef.current = null;
    };
  }, [subtitleUrl, onLog]);

  return (
    <div ref={containerRef} className="w-full h-full flex bg-black relative group/plyr">
      {/* 隐藏的 CAS 超清卷积锐化、Anime4K 微超分、动态 HDR SVG 滤镜定义 */}
      <svg className="hidden absolute" width="0" height="0" aria-hidden="true">
        <defs>
          {/* 1. CAS 超清锐化 */}
          <filter id="avplay-cas-sharpen" x="0%" y="0%" width="100%" height="100%">
            <feConvolveMatrix
              order="3"
              preserveAlpha="true"
              kernelMatrix="0 -1 0 -1 5 -1 0 -1 0"
            />
          </filter>
          {/* 2. Anime4K 极清超分：发丝级微轮廓重建 */}
          <filter id="avplay-anime4k-sr" x="0%" y="0%" width="100%" height="100%">
            <feConvolveMatrix
              order="3"
              preserveAlpha="true"
              kernelMatrix="-0.25 -0.5 -0.25 -0.5 4.0 -0.5 -0.25 -0.5 -0.25"
            />
          </filter>
          {/* 3. 动态 HDR 映射：色调曲线与宽容度扩展 */}
          <filter id="avplay-dynamic-hdr" x="0%" y="0%" width="100%" height="100%">
            <feComponentTransfer>
              <feFuncR type="gamma" amplitude="1.08" exponent="0.92" offset="0.02" />
              <feFuncG type="gamma" amplitude="1.08" exponent="0.92" offset="0.02" />
              <feFuncB type="gamma" amplitude="1.08" exponent="0.92" offset="0.02" />
            </feComponentTransfer>
            <feColorMatrix
              type="matrix"
              values="1.06 0 0 0 0  0 1.06 0 0 0  0 0 1.06 0 0  0 0 0 1 0"
            />
          </filter>
        </defs>
      </svg>

      {/* APL 舒适度状态指示胶囊 */}
      {aplComfort.mode === "shadow" && (
        <div className="absolute top-4 right-4 z-20 pointer-events-none px-2.5 py-1 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[11px] font-medium backdrop-blur-md flex items-center gap-1.5 shadow-lg animate-in fade-in duration-300">
          <Sun className="w-3.5 h-3.5 text-amber-400" />
          <span>黑场提亮 +{Math.round((aplComfort.boost - 1) * 100)}%</span>
        </div>
      )}
      {aplComfort.mode === "glare" && (
        <div className="absolute top-4 right-4 z-20 pointer-events-none px-2.5 py-1 rounded-full bg-blue-500/20 border border-blue-500/30 text-blue-300 text-[11px] font-medium backdrop-blur-md flex items-center gap-1.5 shadow-lg animate-in fade-in duration-300">
          <Shield className="w-3.5 h-3.5 text-blue-400" />
          <span>柔光防眩目</span>
        </div>
      )}

      {progressEl && videoDuration > 0 && createPortal(
        <PlayerHeatmap
          videoKey={url}
          duration={videoDuration}
          currentTime={videoCurrentTime}
          bookmarks={bookmarks}
        />,
        progressEl
      )}
    </div>
  );
};
