import React, { useEffect, useRef } from "react";
import Hls from "hls.js";
//@ts-ignore
import Plyr from "plyr";

interface Props {
  url: string;
  autoPlay?: boolean;
  referer?: string;
  previewVttUrl?: string | null;
  /** 字幕文件的 local-media://... URL（srt 或 vtt） */
  subtitleUrl?: string | null;
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

function toProxied(url: string, referer?: string) {
  const proxied = url
    .replace(/^https?:\/\/(([\w-]+\.)*surrit\.com)/i, "cdn://$1")
    .replace(/^https?:\/\/(([\w-]+\.)*surrit\.org)/i, "cdn://$1")
    .replace(/^https?:\/\/(([\w-]+\.)*fourhoi\.com)/i, "cdn://$1");
  if (!referer?.trim() || !proxied.startsWith("cdn://")) return proxied;
  try {
    const parsed = new URL(proxied.replace(/^cdn:\/\//i, "https://"));
    parsed.searchParams.set("__avp_referer", referer.trim());
    return `cdn://${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return proxied;
  }
}

export const HlsVideoPlayer: React.FC<Props> = ({
  url,
  autoPlay = true,
  referer,
  previewVttUrl,
  subtitleUrl,
  onMeta,
  onVideoEl,
  onLog,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const plyrRef = useRef<Plyr | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const subtitleBlobRef = useRef<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !url) return;

    // 命令式创建 video 元素，挂到 container 下。Plyr 包它、React 不直接拥有它，卸载时不会冲突
    const video = document.createElement("video");
    video.className = "w-full h-full object-contain";
    video.playsInline = true;

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
      keyboard: { focused: true, global: true },
      previewThumbnails: previewVttUrl
        ? { enabled: true, src: previewVttUrl }
        : { enabled: false },
    };
    console.log("Plyr options:", plyrOption);
    // 初始化 Plyr（每次挂载都新建）
    const plyr = new Plyr(video, plyrOption);
    plyrRef.current = plyr;

    const onLoadedMeta = () => {
      onMeta?.({ width: video.videoWidth, height: video.videoHeight });
    };
    video.addEventListener("loadedmetadata", onLoadedMeta);

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
      try {
        video.pause();
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

  return <div ref={containerRef} className="w-full h-full flex bg-black" />;
};
