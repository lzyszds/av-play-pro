import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { PageLoader } from "../components/PageLoader";
import { Tooltip } from "../components/common/Tooltip";
import { trpc } from "../lib/trpc";
import { runScraper, type ScrapedItem } from "../lib/scraperControl";
import { toCdnImg } from "../lib/cdn";
import {
  Compass,
  Zap,
  ExternalLink,
  Clock,
  Copy,
  Settings2,
} from "lucide-react";

interface Props {
  onAddSystemLog: (
    text: string,
    level: "INFO" | "WARNING" | "SUCCESS" | "ERROR",
  ) => void;
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
}

function formatTime(ts: number): string {
  if (!ts) return "尚未抓取";
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

// 单张卡片：悬停时加载并自动播放预览视频，离开则卸载回封面
const DiscoverCard = React.memo(function DiscoverCard({
  item,
  onCopy,
  coverH,
  cardH,
}: {
  item: ScrapedItem;
  onCopy: (text: string) => void;
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
      className="group bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden hover:shadow-md transition flex flex-col"
    >
      <div
        style={{ height: coverH }}
        className="relative shrink-0 bg-slate-100 dark:bg-slate-800"
      >
        {cover ? (
          <img
            src={cover}
            alt={item.title}
            className="w-full h-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-300">
            <Compass className="w-6 h-6" />
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
        {item.duration && (
          <span className="absolute bottom-1.5 right-1.5 z-10 text-[10px] px-1.5 py-0.5 rounded bg-black/70 text-white">
            {item.duration}
          </span>
        )}
        {preview && (
          <span className="absolute top-1.5 left-1.5 z-10 text-[9px] px-1.5 py-0.5 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition">
            预览
          </span>
        )}
      </div>
      <div className="p-2.5 flex flex-col gap-1.5 flex-1 min-h-0">
        <h3
          className="text-[11px] font-semibold text-slate-800 dark:text-slate-200 line-clamp-2 leading-snug"
          title={item.title}
        >
          {item.title || item.code}
        </h3>
        <div className="mt-auto flex items-center gap-1.5">
          {item.code && (
            <span className="text-[9px] px-1.5 py-0.5 rounded truncate bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-mono">
              {item.code}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            {item.code && (
              <Tooltip content="复制番号" placement="top">
                <button
                  type="button"
                  onClick={() => onCopy(item.code!)}
                  className="w-6 h-6 flex items-center justify-center rounded-md bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-blue-500 transition cursor-pointer"
                >
                  <Copy className="w-3 h-3" />
                </button>
              </Tooltip>
            )}
            <Tooltip content="在浏览器中打开页面" placement="top">
              <button
                type="button"
                onClick={() => window.open(item.url, "_blank")}
                className="w-6 h-6 flex items-center justify-center rounded-md bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-blue-500 transition cursor-pointer"
              >
                <ExternalLink className="w-3 h-3" />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  );
});

export function DiscoverPage({ onAddSystemLog }: Props) {
  const [store, setStore] = useState<ScrapeStore | null>(null);
  const [config, setConfig] = useState<ScrapeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [keyword, setKeyword] = useState("");
  const [showConfig, setShowConfig] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [cached, cfg] = await Promise.all([
        trpc.scrape.getCached.query() as Promise<ScrapeStore>,
        trpc.scrape.getConfig.query() as Promise<ScrapeConfig>,
      ]);
      setStore(cached);
      setConfig(cfg);
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

  // 一键抓取：弹出 webview 过盾 → 逐页抓取 → 落库 → 刷新
  const handleScrape = useCallback(async () => {
    if (!config) return;
    setRunning(true);
    setProgress("准备中…");
    onAddSystemLog("开始一键抓取 missav…", "INFO");
    try {
      const items = await runScraper({
        baseUrl: config.baseUrl,
        startPage: config.startPage,
        endPage: config.endPage,
        onProgress: (msg) => setProgress(msg),
      });

      if (items.length === 0) {
        onAddSystemLog("抓取到 0 条（可能未过盾或被风控）", "WARNING");
        return;
      }

      const saved = (await trpc.scrape.save.mutate({
        items,
        baseUrl: config.baseUrl,
        pages: config.endPage - config.startPage + 1,
      })) as ScrapeStore;
      setStore(saved);
      onAddSystemLog(`抓取完成，已保存 ${saved.items.length} 条`, "SUCCESS");
    } catch (error) {
      onAddSystemLog(`抓取失败: ${(error as Error)?.message}`, "ERROR");
    } finally {
      setRunning(false);
      setProgress("");
    }
  }, [config, onAddSystemLog]);

  const items = store?.items ?? [];

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return items;
    return items.filter(
      (it) =>
        it.title.toLowerCase().includes(kw) ||
        (it.code || "").toLowerCase().includes(kw),
    );
  }, [items, keyword]);

  const copy = useCallback(
    (text: string) => {
      void navigator.clipboard?.writeText(text);
      onAddSystemLog(`已复制: ${text}`, "INFO");
    },
    [onAddSystemLog],
  );

  // —— 固定网格虚拟化：卡片高度完全确定，行高精确匹配 ——
  const GAP = 12;
  const COVER_RATIO = 3 / 2; // 封面宽高比（missav 海报 ≈ 3:2）
  const FOOTER_H = 82; // 文字区固定高度（标题 2 行 + 番号/按钮 + 内边距）

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [colCount, setColCount] = useState(6);
  const [cellW, setCellW] = useState(220);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const MIN = 200; // 单列最小宽度
    const PAD = 32; // p-4 左右各 16
    const compute = () => {
      const w = el.clientWidth - PAD;
      const cols = Math.max(1, Math.floor((w + GAP) / (MIN + GAP)));
      setColCount(cols);
      setCellW(Math.floor((w - GAP * (cols - 1)) / cols));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading]);

  const coverH = Math.round(cellW / COVER_RATIO);
  const cardH = coverH + FOOTER_H;
  const rowHeight = cardH + GAP;
  const rowCount = Math.ceil(filtered.length / colCount);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 4,
  });

  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowHeight, colCount, rowCount, rowVirtualizer]);

  if (loading || !config) return <PageLoader active label="加载发现" />;

  return (
    <div className="h-full flex flex-col">
      {/* 顶部工具栏 */}
      <div className="shrink-0 px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
          <Compass className="w-4 h-4 text-blue-500" />
          <span className="text-sm font-bold">发现</span>
        </div>
        <span className="text-[11px] text-slate-400 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatTime(store?.updatedAt ?? 0)} · 共 {items.length} 条
        </span>

        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索标题 / 番号…"
          className="ml-auto w-48 px-3 py-1.5 text-xs rounded-lg bg-slate-100 dark:bg-slate-800 border border-transparent focus:border-blue-400 outline-none text-slate-700 dark:text-slate-200"
        />
        <Tooltip content="网络抓取配置" placement="top">
          <button
            type="button"
            onClick={() => setShowConfig((v) => !v)}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-blue-500 transition cursor-pointer"
          >
            <Settings2 className="w-4 h-4" />
          </button>
        </Tooltip>
        <button
          type="button"
          onClick={handleScrape}
          disabled={running}
          className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-500 hover:bg-blue-600 text-white transition cursor-pointer disabled:opacity-50"
        >
          <Zap className={`w-3.5 h-3.5 ${running ? "animate-pulse" : ""}`} />
          {running ? progress || "抓取中…" : "一键抓取"}
        </button>
      </div>

      {/* 配置面板 */}
      {showConfig && (
        <div className="shrink-0 px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 flex-1 min-w-[280px]">
            <span className="text-[11px] text-slate-500">列表地址（用 {"{page}"} 作页码占位）</span>
            <input
              value={config.baseUrl}
              onChange={(e) => saveConfig({ baseUrl: e.target.value })}
              className="px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none focus:border-blue-400 text-slate-700 dark:text-slate-200"
            />
          </label>
          <label className="flex flex-col gap-1 w-24">
            <span className="text-[11px] text-slate-500">起始页</span>
            <input
              type="number"
              min={1}
              value={config.startPage}
              onChange={(e) =>
                saveConfig({ startPage: Number(e.target.value) || 1 })
              }
              className="px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none focus:border-blue-400 text-slate-700 dark:text-slate-200"
            />
          </label>
          <label className="flex flex-col gap-1 w-24">
            <span className="text-[11px] text-slate-500">结束页</span>
            <input
              type="number"
              min={config.startPage}
              value={config.endPage}
              onChange={(e) =>
                saveConfig({ endPage: Number(e.target.value) || config.startPage })
              }
              className="px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none focus:border-blue-400 text-slate-700 dark:text-slate-200"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer pb-1.5">
            <input
              type="checkbox"
              checked={config.autoOnStartup}
              onChange={(e) => saveConfig({ autoOnStartup: e.target.checked })}
              className="accent-blue-500"
            />
            启动时自动抓取
          </label>
        </div>
      )}

      {/* 内容网格 */}
      {filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-3">
          <Compass className="w-10 h-10 opacity-40" />
          {items.length === 0 ? (
            <div className="text-center space-y-1.5">
              <p className="text-sm">暂无内容</p>
              <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
                点击右上角「一键抓取」——会自动打开 missav 过盾并抓取。若弹出人机验证，直接点一下即可。
              </p>
            </div>
          ) : (
            <p className="text-sm">没有匹配的结果</p>
          )}
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
          <div
            style={{
              height: rowVirtualizer.getTotalSize(),
              width: "100%",
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((vRow) => {
              const start = vRow.index * colCount;
              const rowItems = filtered.slice(start, start + colCount);
              return (
                <div
                  key={vRow.key}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vRow.start}px)`,
                    display: "grid",
                    gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))`,
                    gap: GAP,
                  }}
                >
                  {rowItems.map((it) => (
                    <DiscoverCard
                      key={it.code || it.url}
                      item={it}
                      onCopy={copy}
                      coverH={coverH}
                      cardH={cardH}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
