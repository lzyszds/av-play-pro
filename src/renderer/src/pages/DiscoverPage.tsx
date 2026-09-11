import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PageLoader } from "../components/PageLoader";
import { Tooltip } from "../components/common/Tooltip";
import { trpc } from "../lib/trpc";
import {
  runScraper,
  cancelScrape,
  isScrapeAbortError,
  runChallengePass,
  type ScrapedItem,
} from "../lib/scraperControl";
import { toCdnImg } from "../lib/cdn";
import { useDiscoverStore } from "../stores/discoverStore";
import {
  Compass,
  Zap,
  ExternalLink,
  Clock,
  Copy,
  Trash2,
  Layers,
  Download,
  DownloadCloud,
  Check,
  Loader2,
  AlertCircle,
  Square,
  Play,
  ShieldCheck,
} from "lucide-react";

/** 单卡一键下载状态：idle 未开始 / resolving 解析中 / queued 已入队 / error 失败 */
export type DiscoverDlState = "idle" | "resolving" | "queued" | "error";

interface Props {
  onAddSystemLog: (
    text: string,
    level: "INFO" | "WARNING" | "SUCCESS" | "ERROR",
  ) => void;
  /** 一键播放：解析出 m3u8 后由 App 跳转播放页在线播放 */
  onPlayStream?: (stream: { url: string; name?: string; referer?: string }) => void;
}

interface ScrapeStore {
  updatedAt: number;
  baseUrl: string;
  pages: number;
  items: ScrapedItem[];
}

interface ScrapeConfig {
  baseUrl: string;
  startPage: number;
  endPage: number;
  autoOnStartup: boolean;
  /** 抓取方式：webview=过盾抓取（慢但稳），jina=r.jina.ai 第三方代理（快） */
  method?: "webview" | "jina";
}

function formatTime(ts: number): string {
  if (!ts) return "尚未抓取";
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

// 单张卡片：悬停时加载并自动播放预览视频，离开则卸载回封面
const DiscoverCard = React.memo(function DiscoverCard({
  item,
  onCopy,
  onDownload,
  downloadState = "idle",
  onPlay,
  playState = "idle",
  coverH,
  cardH,
}: {
  item: ScrapedItem;
  onCopy: (text: string) => void;
  onDownload?: (item: ScrapedItem) => void;
  downloadState?: DiscoverDlState;
  onPlay?: (item: ScrapedItem) => void;
  playState?: "idle" | "resolving" | "loaded" | "error";
  coverH: number;
  cardH: number;
}) {
  const [playing, setPlaying] = useState(false);
  const hoverTimer = useRef<number | null>(null);
  const cover = toCdnImg(item.cover);
  const preview = toCdnImg(item.preview);

  const onEnter = () => {
    if (!preview) return;
    // 延迟 180ms 再加载，避免快速划过时疯狂请求视频
    hoverTimer.current = window.setTimeout(() => setPlaying(true), 180);
  };
  const onLeave = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    setPlaying(false);
  };

  useEffect(() => {
    return () => {
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    };
  }, []);

  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{ height: cardH }}
      className="discover-card group cyber-shimmer flex flex-col"
    >
      {/* 封面区 */}
      <div
        style={{ height: coverH }}
        className="relative shrink-0 bg-slate-900/80 overflow-hidden"
      >
        {cover ? (
          <img
            src={cover}
            alt={item.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-600">
            <Compass className="w-8 h-8 opacity-40" />
          </div>
        )}
        {playing && preview && (
          <video
            src={preview}
            className="absolute inset-0 w-full h-full object-cover bg-black"
            muted
            loop
            autoPlay
            playsInline
            preload="none"
          />
        )}
        {/* 底部遮罩渐变 + 标题 overlay */}
        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/80 via-black/40 to-transparent pointer-events-none" />
        <h3
          className="absolute inset-x-0 bottom-2 px-2.5 text-[11px] font-semibold text-white line-clamp-2 leading-snug z-10 drop-shadow"
          title={item.title}
        >
          {item.title || item.code}
        </h3>
        {item.duration && (
          <span className="absolute bottom-1.5 right-1.5 z-20 text-[9px] px-1.5 py-0.5 rounded-md bg-black/70 text-white/90 font-mono backdrop-blur-sm">
            {item.duration}
          </span>
        )}
        {preview && (
          <span className="absolute top-1.5 right-1.5 z-20 text-[8px] px-1.5 py-0.5 rounded-md cyber-badge-cyan font-semibold tracking-wide opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            ▶ 预览
          </span>
        )}
        {item.quality && (
          <span className="absolute top-1.5 left-1.5 z-20 text-[8px] px-1.5 py-0.5 rounded-md bg-emerald-500/85 text-white font-bold tracking-wide backdrop-blur-sm">
            {item.quality}
          </span>
        )}
      </div>

      {/* 底部信息区：番号 + 操作按钮 */}
      <div className="shrink-0 px-2.5 py-1.5 flex items-center gap-1.5 bg-slate-900/60">
        {item.code && (
          <span className="cyber-badge cyber-badge-blue font-mono truncate max-w-4xl">
            {item.code}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {onDownload && (
            <Tooltip
              content={
                downloadState === "resolving"
                  ? "正在解析视频流…"
                  : downloadState === "queued"
                    ? "已加入下载队列"
                    : downloadState === "error"
                      ? "解析失败，点击重试"
                      : "一键下载（自动解析 m3u8）"
              }
              placement="top"
            >
              <button
                type="button"
                onClick={() => onDownload(item)}
                disabled={downloadState === "resolving"}
                className={`w-6 h-6 flex items-center justify-center rounded-md bg-white/5 border transition-all cursor-pointer disabled:cursor-not-allowed ${
                  downloadState === "queued"
                    ? "border-emerald-500/40 text-emerald-400"
                    : downloadState === "error"
                      ? "border-rose-500/40 text-rose-400"
                      : downloadState === "resolving"
                        ? "border-amber-500/40 text-amber-400"
                        : "border-white/10 text-slate-400 hover:text-emerald-400 hover:border-emerald-500/40"
                }`}
              >
                {downloadState === "resolving" ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : downloadState === "queued" ? (
                  <Check className="w-3 h-3" />
                ) : downloadState === "error" ? (
                  <AlertCircle className="w-3 h-3" />
                ) : (
                  <Download className="w-3 h-3" />
                )}
              </button>
            </Tooltip>
          )}
          {item.code && (
            <Tooltip content="复制番号" placement="top">
              <button
                type="button"
                onClick={() => onCopy(item.code!)}
                className="w-6 h-6 flex items-center justify-center rounded-md bg-white/5 border border-white/10 text-slate-400 hover:text-cyan-400 hover:border-cyan-500/40 transition-all cursor-pointer"
              >
                <Copy className="w-3 h-3" />
              </button>
            </Tooltip>
          )}
          {onPlay && (
            <Tooltip
              content={
                playState === "resolving"
                  ? "正在解析视频流…"
                  : playState === "loaded"
                    ? "已跳转播放页"
                    : playState === "error"
                      ? "解析失败，点击重试"
                      : "一键播放（在线流）"
              }
              placement="top"
            >
              <button
                type="button"
                onClick={() => onPlay(item)}
                disabled={playState === "resolving"}
                className={`w-6 h-6 flex items-center justify-center rounded-md bg-white/5 border transition-all cursor-pointer disabled:cursor-not-allowed ${
                  playState === "loaded"
                    ? "border-cyan-500/40 text-cyan-400"
                    : playState === "error"
                      ? "border-rose-500/40 text-rose-400"
                      : "border-white/10 text-slate-400 hover:text-cyan-400 hover:border-cyan-500/40"
                }`}
              >
                {playState === "resolving" ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : playState === "error" ? (
                  <AlertCircle className="w-3 h-3" />
                ) : (
                  <Play className="w-3 h-3" />
                )}
              </button>
            </Tooltip>
          )}
          <Tooltip content="在浏览器中打开页面" placement="top">
            <button
              type="button"
              onClick={() => window.open(item.url, "_blank")}
              className="w-6 h-6 flex items-center justify-center rounded-md bg-white/5 border border-white/10 text-slate-400 hover:text-blue-400 hover:border-blue-500/40 transition-all cursor-pointer"
            >
              <ExternalLink className="w-3 h-3" />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
});

export function DiscoverPage({ onAddSystemLog, onPlayStream }: Props) {
  const [store, setStore] = useState<ScrapeStore | null>(null);
  const [config, setConfig] = useState<ScrapeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [keyword, setKeywordState] = useState("");
  const setKeyword = (v: string): void => {
    setKeywordState(v);
  };
  // 抓取进行中轮询增量缓存与页进度：jina/webview 通道每抓到一页就落盘，这里 2s 拉一次让卡片实时出现
  useEffect(() => {
    if (!running) return;
    const tick = async () => {
      try {
        const cached = (await trpc.scrape.getCached.query()) as ScrapeStore;
        setStore((prev) =>
          cached.items.length >= (prev?.items.length ?? 0) ? cached : prev,
        );
        const prog = (await trpc.scrape.getProgress.query()) as {
          active: boolean;
          page: number;
          totalPages: number;
          lastPageItems: number;
        };
        if (prog?.active && prog.totalPages > 0 && prog.page > 0) {
          setProgress(
            `第 ${prog.page}/${prog.totalPages} 页 · 本页 ${prog.lastPageItems} 条`,
          );
        }
      } catch {
        /* ignore */
      }
    };
    const timer = window.setInterval(() => void tick(), 2000);
    void tick();
    return () => window.clearInterval(timer);
  }, [running]);
  // 抓取启动弹窗：点「一键抓取」时让用户选方式与页码范围
  const [showScrapeDialog, setShowScrapeDialog] = useState(false);
  const [dlgMethod, setDlgMethod] = useState<"webview" | "jina">("webview");
  const [dlgStart, setDlgStart] = useState(1);
  const [dlgEnd, setDlgEnd] = useState(3);
  const [dlgBaseUrl, setDlgBaseUrl] = useState("");
  const [dlgAutoOnStartup, setDlgAutoOnStartup] = useState(false);

  // —— 页码记忆（双保险一）：loadAll 拉到数据后立即恢复上次页码 ——
  // 状态在主进程 JSON 文件里（zustand persist），localStorage 在打包后不可靠，已弃用
  const restorePage = useCallback((totalPages: number): void => {
    const saved = useDiscoverStore.getState().lastPage;
    if (saved > 1) {
      setPage(Math.min(saved, Math.max(1, totalPages)));
    }
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [cached, cfg] = await Promise.all([
        trpc.scrape.getCached.query() as Promise<ScrapeStore>,
        trpc.scrape.getConfig.query() as Promise<ScrapeConfig>,
      ]);
      setStore(cached);
      setConfig(cfg);
      if (cached.items.length > 0) {
        const cfgEstimated = Math.max(
          1,
          Math.ceil(cached.items.length / 20),
        );
        restorePage(cfgEstimated);
      }
    } catch (error) {
      onAddSystemLog(`读取抓取数据失败: ${(error as Error)?.message}`, "ERROR");
    } finally {
      setLoading(false);
    }
  }, [onAddSystemLog]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const saveConfig = useCallback(
    async (patch: Partial<ScrapeConfig>) => {
      const next = { ...(config as ScrapeConfig), ...patch };
      setConfig(next);
      try {
        const saved = (await trpc.scrape.setConfig.mutate(patch)) as ScrapeConfig;
        setConfig(saved);
      } catch (error) {
        onAddSystemLog(`保存配置失败: ${(error as Error)?.message}`, "WARNING");
      }
    },
    [config, onAddSystemLog],
  );

  const scraperStoppedRef = useRef(false);
  const handleStopScrape = useCallback(() => {
    // 渲染端过盾抓取取消 + 主进程 jina 抓取取消（双通道都覆盖）
    void trpc.scrape.cancelRun.mutate().catch(() => {});
    scraperStoppedRef.current = true;
    cancelScrape();
    setProgress("正在停止…");
    onAddSystemLog("正在停止抓取…", "INFO");
  }, [onAddSystemLog]);

  // 一键抓取：Jina 走主进程快速通道，webview 走渲染端过盾流程
  const runScrape = useCallback(
    async (
      method: "webview" | "jina",
      startPage: number,
      endPage: number,
      baseUrlOverride?: string,
    ) => {
      const baseUrl = baseUrlOverride?.trim() || config?.baseUrl || "";
      if (!baseUrl) return;
      const useJina = method === "jina";
      setRunning(true);
      setProgress(useJina ? "Jina 快速抓取中…" : "准备中…");
      onAddSystemLog(useJina ? "开始 Jina 快速抓取 missav…" : "开始一键抓取 missav…", "INFO");
      if (useJina) {
        let saved = (await trpc.scrape.refresh.mutate({
          method: "jina",
          baseUrl,
          startPage,
          endPage,
        })) as ScrapeStore;
        setStore(saved);
        if (saved.items.length > 0) {
          setRunning(false);
          setProgress("");
          onAddSystemLog(
            `Jina 抓取完成，已保存 ${saved.items.length} 条`,
            "SUCCESS",
          );
          return;
        }
        // Jina 通道拿不到数据：r.jina.ai 自己也在 Cloudflare 后面，家里等换了
        // 出口 IP 的环境会对应用甩「Just a moment」挑战页。先弹 webview，
        // 让用户为 r.jina.ai 过一次盾，然后立刻重试 Jina 通道。
        const jinaFirstPage = `https://r.jina.ai/${pageUrlOf(baseUrl, startPage)}`;
        onAddSystemLog(
          "Jina 通道被 Cloudflare 挑战，弹出页面为你过一次盾（出现验证请点击，完成后自动继续）…",
          "WARNING",
        );
        setProgress("为 Jina 过盾中…（弹出窗口完成验证）");
        let passed = false;
        try {
          passed = await runChallengePass({
            url: jinaFirstPage,
            onProgress: (m) => setProgress(m === "" ? "" : `Jina 过盾：${m}`),
          });
        } catch (error) {
          if (isScrapeAbortError(error)) {
            onAddSystemLog("抓取已取消", "INFO");
            return;
          }
          onAddSystemLog(`Jina 过盾失败: ${(error as Error)?.message}`, "WARNING");
        }
        if (passed) {
          try {
            saved = (await trpc.scrape.refresh.mutate({
              method: "jina",
              baseUrl,
              startPage,
              endPage,
            })) as ScrapeStore;
            setStore(saved);
          } catch (error) {
            onAddSystemLog(`Jina 重试失败: ${(error as Error)?.message}`, "ERROR");
          }
          if (saved.items.length > 0) {
            setRunning(false);
            setProgress("");
            onAddSystemLog(
              `Jina 抓取完成（过盾后恢复），已保存 ${saved.items.length} 条`,
              "SUCCESS",
            );
            return;
          }
        }
        // Jina 重试仍 0 条（可能是 Jina 出口被 missav 拦）：自动降级为过盾抓取
        onAddSystemLog(
          "Jina 快速通道仍拿不到数据（可能被目标站拦截），自动转「过盾抓取」…",
          "WARNING",
        );
        setProgress("Jina 不可用，转过盾抓取…");
      }
      try {
        scraperStoppedRef.current = false;
        const items = await runScraper({
          baseUrl,
          startPage,
          endPage,
          onProgress: (msg) => setProgress(msg),
        });

        if (items.length === 0) {
          onAddSystemLog("抓取到 0 条（可能未过盾或被风控）", "WARNING");
          return;
        }

        const saved = (await trpc.scrape.save.mutate({
          items,
          baseUrl,
          pages: endPage - startPage + 1,
        })) as ScrapeStore;
        setStore(saved);
        onAddSystemLog(
          scraperStoppedRef.current
            ? `已手动停止，保留本次已抓取的 ${saved.items.length} 条`
            : `抓取完成，已保存 ${saved.items.length} 条`,
          "SUCCESS",
        );
      } catch (error) {
        if (isScrapeAbortError(error)) {
          onAddSystemLog("抓取已取消", "INFO");
          return;
        }
        onAddSystemLog(`抓取失败: ${(error as Error)?.message}`, "ERROR");
      } finally {
        setRunning(false);
        setProgress("");
      }
    },
    [config, onAddSystemLog],
  );

  /** 把带 {page} 占位或 page=N 的地址替换成第 p 页（与后端规则一致） */
  const pageUrlOf = (baseUrl: string, p: number): string => {
    return baseUrl.includes("{page}")
      ? baseUrl.replace("{page}", String(p))
      : baseUrl.replace(/([?&]page=)\d+/, `$1${p}`);
  };

  // 手动过盾：弹出可见 webview 完成一次 Cloudflare 人机验证，
  // 之后主进程的列表/详情直连请求即可复用 cf_clearance
  const [challengeRunning, setChallengeRunning] = useState(false);
  const handlePassChallenge = useCallback(async () => {
    if (challengeRunning || running) return;
    const baseUrl = config?.baseUrl || "";
    if (!baseUrl) return;
    setChallengeRunning(true);
    setRunning(true);
    try {
      const ok = await runChallengePass({
        url: pageUrlOf(baseUrl, 1),
        onProgress: (m) => setProgress(m),
      });
      onAddSystemLog(
        ok
          ? "过盾成功：后续解析/直连抓取将复用本次验证"
          : "过盾未完成（超时或取消）",
        ok ? "SUCCESS" : "WARNING",
      );
    } catch (error) {
      if (isScrapeAbortError(error)) {
        onAddSystemLog("过盾已取消", "INFO");
      } else {
        onAddSystemLog(`过盾失败: ${(error as Error)?.message}`, "ERROR");
      }
    } finally {
      setChallengeRunning(false);
      setRunning(false);
      setProgress("");
    }
  }, [challengeRunning, running, config, onAddSystemLog]);

  // 打开抓取弹窗：默认带出已保存配置
  const openScrapeDialog = useCallback(() => {
    if (!config) return;
    setDlgMethod(config.method === "jina" ? "jina" : "webview");
    setDlgStart(config.startPage);
    setDlgEnd(config.endPage);
    setDlgBaseUrl(config.baseUrl);
    setDlgAutoOnStartup(config.autoOnStartup);
    setShowScrapeDialog(true);
  }, [config]);

  // 确认抓取：选择持久化，并按本次选择启动（页码不做相互限制，随便输）
  const confirmScrape = useCallback(() => {
    setShowScrapeDialog(false);
    const toPage = (v: number) =>
      Number.isFinite(v) && !Number.isNaN(v) ? Math.floor(v) : 1;
    const start = toPage(dlgStart);
    // 起始大于结束时自然写成一键段：end ≥ start，交换即可
    const [lo, hi] = start <= dlgEnd ? [start, toPage(dlgEnd)] : [toPage(dlgEnd), start];
    void saveConfig({
      method: dlgMethod,
      startPage: lo,
      endPage: hi,
      baseUrl: dlgBaseUrl.trim(),
      autoOnStartup: dlgAutoOnStartup,
    });
    void runScrape(dlgMethod, lo, hi, dlgBaseUrl);
  }, [dlgMethod, dlgStart, dlgEnd, dlgBaseUrl, dlgAutoOnStartup, saveConfig, runScrape]);

  const items = store?.items ?? [];

  // 清空缓存
  const handleClearCache = useCallback(async () => {
    try {
      const cleared = (await trpc.scrape.clear.mutate()) as ScrapeStore;
      setStore(cleared);
      onAddSystemLog("已清空抓取缓存", "INFO");
    } catch (error) {
      onAddSystemLog(`清空缓存失败: ${(error as Error)?.message}`, "WARNING");
    }
  }, [onAddSystemLog]);

  // 一键去重：同一番号只保留最先出现的那条
  const handleDedupe = useCallback(async () => {
    try {
      const before = items.length;
      const deduped = (await trpc.scrape.dedupe.mutate()) as ScrapeStore;
      setStore(deduped);
      const removed = before - deduped.items.length;
      onAddSystemLog(
        removed > 0
          ? `去重完成：移除 ${removed} 条重复番号，剩余 ${deduped.items.length} 条`
          : "未发现重复番号",
        removed > 0 ? "SUCCESS" : "INFO",
      );
    } catch (error) {
      onAddSystemLog(`去重失败: ${(error as Error)?.message}`, "WARNING");
    }
  }, [items.length, onAddSystemLog]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return items;
    return items.filter(
      (it) =>
        it.title.toLowerCase().includes(kw) ||
        (it.code || "").toLowerCase().includes(kw),
    );
  }, [items, keyword]);

  // 分页：每页数量 = 屏幕可容纳的 列数×行数（随窗口自适应，见下方测量）
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  // 上次浏览页码持久化：进入发现页恢复；切页即保存。
  // 恢复走双保险（loadAll 后 + 这里）；storage 是异步 IPC，需等 persist hydration 完成再读
  const pageRestoreDoneRef = useRef(false);
  const restorePageRef = useRef(restorePage);
  restorePageRef.current = restorePage;
  useEffect(() => {
    if (items.length === 0 || pageRestoreDoneRef.current) return;
    const run = (): void => {
      if (pageRestoreDoneRef.current) return;
      pageRestoreDoneRef.current = true;
      restorePageRef.current(totalPages);
    };
    if (useDiscoverStore.persist.hasHydrated()) {
      run();
      return;
    }
    // 数据先到、hydration 未完成：注册 hydration 完成回调再恢复
    const off = useDiscoverStore.persist.onFinishHydration(run);
    return () => off();
  }, [items.length, totalPages]);
  // 闸门：恢复完成（pageRestoreDoneRef 置位）之前绝不写入，
  // 否则挂载初期 lastPage 初始值 1 会把上次浏览页码覆盖掉
  useEffect(() => {
    if (pageRestoreDoneRef.current && currentPage > 0) {
      useDiscoverStore.getState().setLastPage(currentPage);
    }
  }, [currentPage]);
  // 关键词变化时回到第 1 页（跳过首次挂载，避免覆盖恢复的页码）
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    setPage(1);
  }, [keyword]);
  const pagedItems = useMemo(
    () =>
      filtered.slice(
        (currentPage - 1) * pageSize,
        currentPage * pageSize,
      ),
    [filtered, currentPage, pageSize],
  );

  const copy = useCallback(
    (text: string) => {
      void navigator.clipboard?.writeText(text);
      onAddSystemLog(`已复制: ${text}`, "INFO");
    },
    [onAddSystemLog],
  );

  // —— 一键下载：解析详情页 m3u8 → 走插件推送管线自动建任务 ——
  const [dlStates, setDlStates] = useState<Record<string, DiscoverDlState>>({});
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchInfo, setBatchInfo] = useState("");
  const batchStopRef = useRef(false);

  const setDlState = useCallback((key: string, state: DiscoverDlState) => {
    setDlStates((prev) => ({ ...prev, [key]: state }));
  }, []);

  const resolveAndQueue = useCallback(
    async (item: ScrapedItem): Promise<boolean> => {
      const key = item.code || item.url;
      try {
        const res = (await trpc.scrape.resolveM3u8.mutate({
          url: item.url,
        })) as { m3u8: string | null; method: string; quality?: string | null };
        if (!res?.m3u8) throw new Error("未解析到 m3u8 播放地址");
        await trpc.scrape.queueDiscoverDownload.mutate({
          m3u8Url: res.m3u8,
          name: item.title || item.code || "M3U8 Task",
          coverUrl: item.cover || undefined,
          previewUrl: item.preview || undefined,
          pageUrl: item.url,
          quality: res.quality || undefined,
        });
        setDlState(key, "queued");
        onAddSystemLog(
          `已加入下载队列: ${item.code || ""} (${item.title})`,
          "SUCCESS",
        );
        return true;
      } catch (error) {
        setDlState(key, "error");
        onAddSystemLog(
          `一键下载失败 ${item.code || item.title}: ${(error as Error)?.message}`,
          "ERROR",
        );
        return false;
      }
    },
    [onAddSystemLog, setDlState],
  );

  const handleDownloadOne = useCallback(
    async (item: ScrapedItem) => {
      const key = item.code || item.url;
      const state = dlStates[key];
      if (state === "resolving" || state === "queued") return;
      setDlState(key, "resolving");
      void resolveAndQueue(item);
    },
    [dlStates, resolveAndQueue, setDlState],
  );

  // 本页全部批量导入（顺序解析，间隔小段节流，可随时停止）
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const handleBatchDownload = useCallback(async () => {
    if (batchRunning) {
      batchStopRef.current = true;
      return;
    }
    batchStopRef.current = false;
    setBatchRunning(true);
    let ok = 0;
    let fail = 0;
    let skipped = 0;
    try {
      for (let i = 0; i < pagedItems.length; i++) {
        if (batchStopRef.current) break;
        const it = pagedItems[i];
        const key = it.code || it.url;
        const state = key ? dlStates[key] : undefined;
        if (state === "queued" || state === "resolving") {
          skipped++;
          continue;
        }
        setBatchInfo(`导入中 ${i + 1}/${pagedItems.length}：${it.code || ""}`);
        setDlState(key, "resolving");
        const success = await resolveAndQueue(it);
        if (success) ok++;
        else fail++;
        await sleep(900);
      }
      onAddSystemLog(
        `本页批量导入完成：成功 ${ok}，失败 ${fail}${skipped ? `，跳过已在队列 ${skipped}` : ""}${batchStopRef.current ? "（已提前停止）" : ""}`,
        fail === 0 ? "SUCCESS" : "WARNING",
      );
    } finally {
      setBatchRunning(false);
      setBatchInfo("");
    }
  }, [batchRunning, dlStates, onAddSystemLog, pagedItems, resolveAndQueue, setDlState]);

  // —— 一键播放：解析 m3u8 → 交给 App 跳播放页在线播放 ——
  const [playStates, setPlayStates] = useState<
    Record<string, "idle" | "resolving" | "loaded" | "error">
  >({});
  const handlePlayOne = useCallback(
    async (item: ScrapedItem) => {
      if (!onPlayStream) return;
      const key = item.code || item.url;
      const state = playStates[key];
      if (state === "resolving" || state === "loaded") return;
      setPlayStates((prev) => ({ ...prev, [key]: "resolving" }));
      try {
        const res = (await trpc.scrape.resolveM3u8.mutate({
          url: item.url,
        })) as { m3u8: string | null; method: string; quality?: string | null };
        if (!res?.m3u8) throw new Error("未解析到 m3u8 播放地址");
        setPlayStates((prev) => ({ ...prev, [key]: "loaded" }));
        onPlayStream({
          url: res.m3u8,
          name: item.title || item.code || "在线流",
          referer: item.url,
        });
      } catch (error) {
        setPlayStates((prev) => ({ ...prev, [key]: "error" }));
        onAddSystemLog(
          `一键播放失败 ${item.code || item.title}: ${(error as Error)?.message}`,
          "ERROR",
        );
      }
    },
    [onPlayStream, playStates, onAddSystemLog],
  );

  // —— 分辨率自动标注：对当前页可见卡片静默解析详情页，把最高档画质写回卡片 ——
  // （已标注/无封面页跳过；顺序 + 300ms 节流，翻页/停止时取消陈旧循环）
  const [qualityInfo, setQualityInfo] = useState("");
  const annotateTokenRef = useRef(0);
  useEffect(() => {
    if (!running) {
      const token = ++annotateTokenRef.current;
      const pending = pagedItems.filter((it) => !it.quality);
      if (pending.length === 0) {
        setQualityInfo("");
        return;
      }
      void (async () => {
        let ok = 0;
        let miss = 0;
        for (let i = 0; i < pending.length; i++) {
          if (annotateTokenRef.current !== token) break;
          const it = pending[i];
          setQualityInfo(`标注分辨率 ${i + 1}/${pending.length}`);
          try {
            const res = (await trpc.scrape.annotate.mutate({
              url: it.url,
              code: it.code,
            })) as { quality: string | null };
            if (annotateTokenRef.current !== token) break;
            if (res?.quality) {
              ok++;
              setStore((prev) => {
                if (!prev) return prev;
                const items = prev.items.map((old) =>
                  old.url === it.url || (it.code && old.code === it.code)
                    ? { ...old, quality: res.quality }
                    : old,
                );
                return { ...prev, items };
              });
            } else {
              miss++;
              onAddSystemLog(
                `分辨率标注未命中 ${it.code || it.title}（详情页可能被挑战，稍后重试）`,
                "WARNING",
              );
            }
          } catch (error) {
            miss++;
            onAddSystemLog(
              `分辨率标注失败 ${it.code || it.title}: ${(error as Error)?.message}`,
              "WARNING",
            );
          }
          await new Promise((r) => setTimeout(r, 300));
        }
        if (annotateTokenRef.current === token) {
          setQualityInfo("");
          if (ok > 0) {
            onAddSystemLog(`分辨率标注完成：成功 ${ok}${miss ? `，未命中 ${miss}` : ""}`, "SUCCESS");
          } else if (miss > 0) {
            onAddSystemLog(`分辨率标注全部未命中（${miss} 条）：详情页当前不可达，可稍后重试`, "WARNING");
          }
        }
      })();
    }
    return () => {
      annotateTokenRef.current += 1;
    };
  }, [pagedItems, running]);

  // —— 自适应满屏布局：自动识别窗口宽高 ——
  // 列数 ≤ 6 随宽度自适应；行数按可用高度刚好放下；
  // 卡片拉伸铺满全部空间（高 = 可用高 ÷ 行数），整屏刚好一页，禁止滚动。
  const GAP = 12;
  const FOOTER_H = 38; // 底部信息区高度（番号 + 操作按钮）
  const MIN_CELL_W = 190; // 单卡最小宽度，低于则减列

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [cols, setCols] = useState(6);
  const [cardH, setCardH] = useState(220);

  // —— 自适应满屏布局测量：列数 ≤6 随宽度自适应；行数按可用高度刚好放下（整屏一页，不滚动）——
  const computeGrid = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const availW = el.clientWidth - 32; // p-4 左右各 16
    const availH = el.clientHeight - 32; // p-4 上下各 16
    if (availW < 100 || availH < 100) return;
    // 列数：尽量多列但不超过 6
    const c = Math.max(
      1,
      Math.min(5, Math.floor((availW + GAP) / (MIN_CELL_W + GAP))),
    );
    // 封面固定 16:9：整卡高度由列宽推出，行数按该高度能放几行（floor 取整避免累计舍入把最后一行顶出视口）
    const cellW = Math.floor((availW - GAP * (c - 1)) / c);
    const h16 = Math.floor((cellW * 9) / 16) + FOOTER_H;
    // 预留 2px 安全余量：即使个别浏览器亚像素渲染，也不把最后一行顶出视口
    const rows = Math.max(1, Math.floor((availH + GAP - 2) / (h16 + GAP)));
    setCols((prev) => (prev === c ? prev : c));
    setCardH((prev) => (prev === h16 ? prev : h16));
    setPageSize((prev) => (prev === c * rows ? prev : c * rows));
  }, []);
  const computeGridRef = useRef(computeGrid);
  computeGridRef.current = computeGrid;

  // 内容真正出现在视口后再测量（骨架屏阶段网格容器尚未挂载），并跟随窗口/容器尺寸变化重算
  useEffect(() => {
    if (loading || !config) return;
    let cancelled = false;
    const raf = requestAnimationFrame(() => {
      if (!cancelled) computeGridRef.current();
    });
    const el = scrollRef.current;
    const ro = new ResizeObserver(() => computeGridRef.current());
    if (el) ro.observe(el);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [loading, config]);

  const coverH = Math.max(60, cardH - FOOTER_H);

  if (loading || !config) {
    return (
      <div className="relative h-full flex flex-col cyber-page" aria-busy="true">
        <div className="shrink-0 px-4 py-3 cyber-toolbar flex items-center justify-between">
          <div className="h-7 w-28 rounded-lg bg-slate-700/20 animate-pulse" />
          <div className="h-7 w-36 rounded-lg bg-slate-700/20 animate-pulse" />
        </div>
        <div className="grid flex-1 grid-cols-2 gap-4 p-4 md:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }, (_, index) => (
            <div key={index} className="overflow-hidden rounded-xl border border-slate-700/15 bg-slate-900/10">
              <div className="aspect-[1.55] animate-pulse bg-slate-700/20" />
              <div className="space-y-2 p-3"><div className="h-3 w-4/5 rounded bg-slate-700/20" /><div className="h-2 w-2/5 rounded bg-slate-700/15" /></div>
            </div>
          ))}
        </div>
        <PageLoader active label="加载发现" />
      </div>
    );
  }

  return (
    <div className="relative h-full flex flex-col cyber-page">
      <PageLoader active={loading} label="加载发现" />
      {/* 顶部工具栏 */}
      <div className="shrink-0 px-4 py-3 cyber-toolbar flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="cyber-icon-glow cyber-icon-glow-blue w-7 h-7">
            <Compass className="w-3.5 h-3.5" />
          </div>
          <span className="text-sm font-bold text-slate-200">发现</span>
        </div>
        <span className="text-[11px] text-slate-500 flex items-center gap-1.5">
          <Clock className="w-3 h-3 text-slate-600" />
          {formatTime(store?.updatedAt ?? 0)}
          {items.length > 0 && (
            <span className="cyber-badge cyber-badge-blue ml-1">{items.length} 条</span>
          )}
          {qualityInfo && (
            <span className="cyber-badge ml-1 text-slate-400 animate-pulse">{qualityInfo}</span>
          )}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索标题 / 番号…"
            className="cyber-input w-48 px-3 py-1.5 text-xs"
          />
          <button
            type="button"
            onClick={running ? handleStopScrape : openScrapeDialog}
            disabled={!config}
            className={`flex items-center gap-1.5 text-xs min-w-[150px] justify-center ${running ? "px-4 py-1.5 rounded-lg border border-rose-500/40 bg-rose-500/15 text-rose-100 hover:bg-rose-500/25 transition cursor-pointer min-w-[240px]" : "cyber-btn-primary px-4 py-1.5"}`}
          >
            <Zap className={`w-3.5 h-3.5 shrink-0 ${running ? "animate-pulse" : ""}`} />
            <span className="min-w-0 truncate">
              {running
                ? `${progress || "准备中…"} · 入库 ${items.length}`
                : "一键抓取"}
            </span>
          </button>
          <Tooltip
            content="把本页卡片逐一解析 m3u8 并自动加入下载队列（可点停止）"
            placement="top"
          >
            <button
              type="button"
              onClick={handleBatchDownload}
              disabled={items.length === 0}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                batchRunning
                  ? "border-rose-500/40 bg-rose-500/15 text-rose-100 hover:bg-rose-500/25"
                  : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20"
              }`}
            >
              {batchRunning ? (
                <Square className="w-3.5 h-3.5" />
              ) : (
                <DownloadCloud className="w-3.5 h-3.5" />
              )}
              {batchRunning
                ? batchInfo || "停止导入"
                : `一键下载${pagedItems.length > 0 ? `（本页 ${pagedItems.length}）` : ""}`}
            </button>
          </Tooltip>
          <Tooltip
            content="手动过盾：弹出页面完成一次人机验证，之后解析/直连抓取可直接通过"
            placement="top"
          >
            <button
              type="button"
              onClick={handlePassChallenge}
              disabled={running && !challengeRunning}
              className="w-8 h-8 flex items-center justify-center rounded-lg cyber-btn-ghost transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ShieldCheck
                className={`w-4 h-4 ${challengeRunning ? "animate-pulse text-emerald-400" : ""}`}
              />
            </button>
          </Tooltip>
          <Tooltip content="按番号去重，保留最先出现的那条" placement="top">
            <button
              type="button"
              onClick={handleDedupe}
              disabled={running || items.length === 0}
              className="w-8 h-8 flex items-center justify-center rounded-lg cyber-btn-ghost transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Layers className="w-4 h-4" />
            </button>
          </Tooltip>
          <Tooltip content="清空已缓存的抓取内容" placement="top">
            <button
              type="button"
              onClick={handleClearCache}
              disabled={running || items.length === 0}
              className="w-8 h-8 flex items-center justify-center rounded-lg cyber-btn-ghost transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* 抓取启动弹窗：选方式 + 页码（Portal 挂到 body，脱离任何 transform 祖先的 fixed 陷阱，真悬浮） */}
      {showScrapeDialog &&
        config &&
        !running &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setShowScrapeDialog(false)}
          >
            <div
              className="w-[420px] rounded-2xl border border-slate-700/40 bg-[#0b1220]/95 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* 头部 */}
              <div className="px-5 pt-4 pb-3 flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center">
                  <Zap className="w-3.5 h-3.5 text-cyan-400" />
                </div>
                <span className="text-sm font-bold text-slate-100">开始抓取</span>
              </div>

              <div className="px-5 pb-5 space-y-4">
                {/* 主体 */}
                <div>
                  <span className="text-[11px] font-semibold text-slate-500">抓取方式</span>
                  <div className="mt-1.5 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setDlgMethod("webview")}
                      className={`px-3 py-2.5 text-xs rounded-xl border transition cursor-pointer text-left ${dlgMethod === "webview" ? "border-blue-500/60 bg-blue-500/10 text-blue-200" : "border-slate-700/40 text-slate-400 hover:text-slate-200"}`}
                    >
                      <span className="font-semibold">过盾抓取</span>
                      <span className="mt-0.5 block text-[10px] text-slate-500">弹浏览器过验证 · 慢但稳</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDlgMethod("jina")}
                      className={`px-3 py-2.5 text-xs rounded-xl border transition cursor-pointer text-left ${dlgMethod === "jina" ? "border-cyan-500/60 bg-cyan-500/10 text-cyan-200" : "border-slate-700/40 text-slate-400 hover:text-slate-200"}`}
                    >
                      <span className="font-semibold">Jina 快速</span>
                      <span className="mt-0.5 block text-[10px] text-slate-500">第三方代理 · 快 · 免过盾</span>
                    </button>
                  </div>
                </div>

                {/* 页码范围 */}
                <div>
                  <span className="text-[11px] font-semibold text-slate-500">页码范围</span>
                  <div className="mt-1.5 flex items-center gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={dlgStart}
                      onChange={(e) => setDlgStart(Number(e.target.value.replace(/[^\d]/g, "")))}
                      className="cyber-input flex-1 px-3 py-2 text-center text-xs font-mono"
                      placeholder="起始页"
                    />
                    <span className="text-xs text-slate-600 shrink-0">→</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={dlgEnd}
                      onChange={(e) => setDlgEnd(Number(e.target.value.replace(/[^\d]/g, "")))}
                      className="cyber-input flex-1 px-3 py-2 text-center text-xs font-mono"
                      placeholder="结束页"
                    />
                  </div>
                </div>

                {/* 列表地址 */}
                <div>
                  <span className="text-[11px] font-semibold text-slate-500">
                    列表地址（{"{page}"} 为页码占位）
                  </span>
                  <input
                    value={dlgBaseUrl}
                    onChange={(e) => setDlgBaseUrl(e.target.value)}
                    className="mt-1.5 cyber-input px-3 py-2 text-xs w-full font-mono"
                  />
                </div>

                {/* 底部 */}
                <div className="pt-3 border-t border-slate-700/30 flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={dlgAutoOnStartup}
                      onChange={(e) => setDlgAutoOnStartup(e.target.checked)}
                      className="accent-blue-500"
                    />
                    启动时自动抓取
                  </label>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowScrapeDialog(false)}
                      className="px-3.5 py-1.5 text-xs rounded-lg cyber-btn-ghost cursor-pointer"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={confirmScrape}
                      className="cyber-btn-primary flex items-center gap-1.5 px-4 py-1.5 text-xs cursor-pointer"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      开始抓取
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* 内容网格 */}
      {filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-900/40 to-purple-900/30 border border-blue-500/20 flex items-center justify-center">
            <Compass className="w-9 h-9 text-blue-500/50" />
          </div>
          {items.length === 0 ? (
            <div className="text-center space-y-2 max-w-xs">
              <p className="text-sm font-semibold text-slate-400">暂无内容</p>
              <p className="text-xs text-slate-600 leading-relaxed">
                点击右上角「一键抓取」，会自动打开 missav 过盾并抓取。
                若弹出人机验证，直接点一下即可。
              </p>
              <button
                type="button"
                onClick={running ? handleStopScrape : openScrapeDialog}
                disabled={!config}
                className={`mt-2 px-5 py-2 text-xs inline-flex items-center gap-2 ${running ? "rounded-lg border border-rose-500/40 bg-rose-500/15 text-rose-100 hover:bg-rose-500/25 transition cursor-pointer" : "cyber-btn-primary"}`}
              >
                <Zap className="w-3.5 h-3.5" />
                {running ? "停止抓取" : "立即抓取"}
              </button>
            </div>
          ) : (
            <p className="text-sm text-slate-500">没有匹配的结果</p>
          )}
        </div>
      ) : (
        <>
          <div
            ref={scrollRef}
            className="flex-1 min-h-0 overflow-hidden p-4"
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                gridAutoRows: cardH,
                gap: GAP,
              }}
            >
              {pagedItems.map((it) => (
                <DiscoverCard
                  key={it.code || it.url}
                  item={it}
                  onCopy={copy}
                  onDownload={handleDownloadOne}
                  downloadState={dlStates[it.code || it.url] ?? "idle"}
                  onPlay={handlePlayOne}
                  playState={playStates[it.code || it.url] ?? "idle"}
                  coverH={coverH}
                  cardH={cardH}
                />
              ))}
            </div>
          </div>

          {/* 分页控件 */}
          {totalPages > 1 && (
            <div className="shrink-0 px-4 py-3 cyber-toolbar flex items-center justify-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  setPage((p) => Math.max(1, p - 1));
                  scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
                }}
                disabled={currentPage <= 1}
                className="px-3 py-1.5 text-xs rounded-lg cyber-btn-ghost transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              >
                上一页
              </button>

              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => {
                    // 只显示当前页附近的页码
                    if (p === 1 || p === totalPages) return true;
                    if (Math.abs(p - currentPage) <= 2) return true;
                    return false;
                  })
                  .map((p, idx, arr) => {
                    const showEllipsis = idx > 0 && p - arr[idx - 1] > 1;
                    return (
                      <React.Fragment key={p}>
                        {showEllipsis && (
                          <span className="px-1 text-xs text-slate-600">…</span>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setPage(p);
                            scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
                          }}
                          className={`min-w-[32px] px-2 py-1 text-xs rounded-lg transition-all cursor-pointer ${p === currentPage
                              ? "bg-blue-500/20 text-blue-400 border border-blue-500/40"
                              : "cyber-btn-ghost"
                            }`}
                        >
                          {p}
                        </button>
                      </React.Fragment>
                    );
                  })}
              </div>

              <button
                type="button"
                onClick={() => {
                  setPage((p) => Math.min(totalPages, p + 1));
                  scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
                }}
                disabled={currentPage >= totalPages}
                className="px-3 py-1.5 text-xs rounded-lg cyber-btn-ghost transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              >
                下一页
              </button>

              <span className="ml-2 text-[11px] text-slate-500">
                第 {currentPage} / {totalPages} 页 · 共 {filtered.length} 条
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
