import React, { useEffect, useMemo, useState, useCallback } from "react";
import { trpc } from "../lib/trpc";
import { ActorAvatar, clearActorAvatarCache } from "../components/player/ActorAvatar";
import {
  ArrowLeft,
  Calendar,
  Clock,
  Film,
  Heart,
  Play,
  RefreshCcw,
  Search,
  Star,
} from "lucide-react";

interface Props {
  videoPath: string;
  onAddSystemLog: (
    text: string,
    level?: "INFO" | "WARNING" | "SUCCESS" | "ERROR",
  ) => void;
  /** 点击某部本地视频时切到播放器 */
  onPlayVideo?: (folderName: string) => void;
  /** 来自卡片演员点击：进入时直接打开该演员详情 */
  initialActorName?: string | null;
  onConsumeInitialActor?: () => void;
}

interface ActorAgg {
  name: string;
  count: number;
  totalSize: number;
  lastCreated: number;
  videos: any[];
}

function parseSizeStrToBytes(s?: string): number {
  if (!s) return 0;
  const m = String(s).trim().match(/([\d.]+)\s*(B|KB|MB|GB|TB)/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const u = m[2].toUpperCase();
  const mult: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
  };
  return n * (mult[u] || 1);
}

function encodeMediaUrl(absPath?: string): string | undefined {
  if (!absPath) return undefined;
  const normalized = String(absPath).replace(/\\/g, "/");
  const parts = normalized.split("/");
  const head = parts.shift() || "";
  return `local-media:///${[head, ...parts.map((p) => encodeURIComponent(p))].join("/")}`;
}

function formatBytes(n: number): string {
  if (n <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

export const ActorsPage: React.FC<Props> = ({
  videoPath,
  onAddSystemLog,
  onPlayVideo,
  initialActorName,
  onConsumeInitialActor,
}) => {
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [batching, setBatching] = useState(false);

  useEffect(() => {
    if (!videoPath) return;
    let cancelled = false;
    setLoading(true);
    trpc.videos.list
      .query({ path: videoPath })
      .then((r) => {
        if (cancelled) return;
        setVideos(r as any[]);
      })
      .catch((e: any) => onAddSystemLog(`加载演员列表失败：${e?.message || e}`, "ERROR"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [videoPath]);

  useEffect(() => {
    if (initialActorName) {
      setSelected(initialActorName);
      onConsumeInitialActor?.();
    }
  }, [initialActorName, onConsumeInitialActor]);

  const [autoFetched, setAutoFetched] = useState(false);
  const [avatarVersion, setAvatarVersion] = useState(0);

  const actors = useMemo<ActorAgg[]>(() => {
    const map = new Map<string, ActorAgg>();
    for (const v of videos) {
      const actorList: string[] = Array.isArray(v.actors) ? v.actors : [];
      for (const name of actorList) {
        const trimmed = String(name || "").trim();
        if (!trimmed) continue;
        const cur = map.get(trimmed) || {
          name: trimmed,
          count: 0,
          totalSize: 0,
          lastCreated: 0,
          videos: [],
        };
        cur.count += 1;
        cur.totalSize += parseSizeStrToBytes(v.size);
        cur.lastCreated = Math.max(cur.lastCreated, v.createdAt || 0);
        cur.videos.push(v);
        map.set(trimmed, cur);
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [videos]);

  // 当聚合演员表就绪后，自动后台批量补全头像，完成后用 version key 强制 ActorAvatar 重新查询
  useEffect(() => {
    if (autoFetched) return;
    if (actors.length === 0) return;
    setAutoFetched(true);
    (async () => {
      try {
        await trpc.actor.ensureBatch.mutate({
          names: actors.map((a) => a.name),
        });
        clearActorAvatarCache(actors.map((a) => a.name));
        setAvatarVersion((n) => n + 1);
        onAddSystemLog(`已自动补全 ${actors.length} 位演员的头像`, "INFO");
      } catch {}
    })();
  }, [actors, autoFetched, onAddSystemLog]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actors;
    return actors.filter((a) => a.name.toLowerCase().includes(q));
  }, [actors, query]);

  const selectedActor = useMemo(
    () => actors.find((a) => a.name === selected) || null,
    [actors, selected],
  );

  const handleBatchEnsure = useCallback(async () => {
    if (batching) return;
    setBatching(true);
    onAddSystemLog(`开始为 ${filtered.length} 位演员补全头像（并发 2）…`, "INFO");
    try {
      const r = await trpc.actor.ensureBatch.mutate({
        names: filtered.map((a) => a.name),
      });
      clearActorAvatarCache(filtered.map((a) => a.name));
      setAvatarVersion((n) => n + 1);
      onAddSystemLog(`头像补全完成：${r.count} 位`, "SUCCESS");
    } catch (e: any) {
      onAddSystemLog(`头像补全失败：${e?.message || e}`, "ERROR");
    } finally {
      setBatching(false);
    }
  }, [batching, filtered, onAddSystemLog]);

  // ===================== 详情视图 =====================
  if (selectedActor) {
    const a = selectedActor;
    const sortedVideos = [...a.videos].sort(
      (x, y) => (y.createdAt || 0) - (x.createdAt || 0),
    );
    return (
      <div className="h-full flex flex-col bg-[#f4f6f9] dark:bg-slate-950 overflow-hidden">
        {/* 顶部演员卡 */}
        <div className="px-6 pt-5 pb-4 shrink-0">
          <button
            onClick={() => setSelected(null)}
            className="text-[11px] text-slate-500 hover:text-slate-800 flex items-center gap-1 mb-3 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            返回演员列表
          </button>
          <div className="flex items-center gap-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
            <ActorAvatar name={a.name} size={96} />
            <div className="flex-1 min-w-0">
              <div className="text-xl font-bold text-slate-900 dark:text-slate-100 truncate">
                {a.name}
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-slate-500 dark:text-slate-400">
                <span className="inline-flex items-center gap-1">
                  <Film className="w-3.5 h-3.5" />
                  本地 {a.count} 部
                </span>
                <span className="inline-flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  最近收录：{a.lastCreated ? new Date(a.lastCreated).toLocaleDateString() : "—"}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Star className="w-3.5 h-3.5" />
                  累计 {formatBytes(a.totalSize)}
                </span>
              </div>
            </div>
            <button
              onClick={async () => {
                try {
                  await trpc.actor.remove.mutate({ name: a.name });
                  await trpc.actor.ensure.mutate({ name: a.name });
                  onAddSystemLog(`重新爬取 ${a.name} 头像`, "INFO");
                  // 强制刷新视图：通过 setSelected(null) -> 再 setSelected(a.name)
                  setSelected(null);
                  setTimeout(() => setSelected(a.name), 50);
                } catch (e: any) {
                  onAddSystemLog(`刷新失败：${e?.message || e}`, "ERROR");
                }
              }}
              className="text-[11px] px-2.5 py-1.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 hover:bg-slate-200 cursor-pointer inline-flex items-center gap-1"
            >
              <RefreshCcw className="w-3 h-3" />
              重新抓头像
            </button>
          </div>
        </div>

        {/* 本地作品列表 */}
        <div className="flex-1 min-h-0 px-6 pb-6 overflow-y-auto">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
            本地作品 · {sortedVideos.length}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {sortedVideos.map((v) => (
              <button
                key={v.id || v.name}
                onClick={() => onPlayVideo?.(v.name)}
                className="text-left rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-amber-400 transition cursor-pointer p-2.5 flex gap-2.5"
              >
                <div className="w-24 aspect-video bg-slate-100 dark:bg-slate-800 rounded overflow-hidden shrink-0">
                  {v.coverUrl ? (
                    <img
                      src={encodeMediaUrl(v.coverUrl)}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : null}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold text-slate-800 dark:text-slate-100 line-clamp-2">
                    {v.title || v.name}
                  </div>
                  {v.code && (
                    <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                      {v.code}
                    </div>
                  )}
                  <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-2">
                    {v.duration && (
                      <span className="inline-flex items-center gap-0.5">
                        <Clock className="w-2.5 h-2.5" />
                        {v.duration}
                      </span>
                    )}
                    {v.size && <span>{v.size}</span>}
                  </div>
                </div>
                <Play className="w-4 h-4 text-slate-300 self-center shrink-0" />
              </button>
            ))}
          </div>
          {sortedVideos.length === 0 && (
            <div className="text-center text-slate-300 text-xs py-12">无本地作品</div>
          )}
        </div>
      </div>
    );
  }

  // ===================== 列表视图 =====================
  return (
    <div className="h-full flex flex-col bg-[#f4f6f9] dark:bg-slate-950 overflow-hidden">
      <div className="px-6 pt-5 pb-3 shrink-0 flex items-center gap-3">
        <div className="flex-1 flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-3 h-9">
          <Search className="w-3.5 h-3.5 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`搜索演员（${actors.length} 位）`}
            className="flex-1 bg-transparent text-[12px] outline-none text-slate-700 dark:text-slate-200"
          />
        </div>
        <button
          onClick={handleBatchEnsure}
          disabled={batching}
          className="text-[11px] px-3 h-9 rounded-lg bg-amber-500 text-white font-semibold hover:bg-amber-600 disabled:opacity-50 cursor-pointer inline-flex items-center gap-1"
        >
          <RefreshCcw className={`w-3 h-3 ${batching ? "animate-spin" : ""}`} />
          {batching ? "补全中…" : "批量补全头像"}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
        {loading ? (
          <div className="text-center text-slate-300 text-xs py-12">加载中…</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 gap-3">
            {filtered.map((a) => (
              <button
                key={a.name}
                onClick={() => setSelected(a.name)}
                className="flex flex-col items-center gap-1.5 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-amber-400 hover:shadow-md transition cursor-pointer"
              >
                <ActorAvatar key={`${a.name}-${avatarVersion}`} name={a.name} size={72} autoFetch={false} />
                <div
                  className="text-[12px] font-semibold text-slate-800 dark:text-slate-100 truncate w-full text-center"
                  title={a.name}
                >
                  {a.name}
                </div>
                <div className="text-[10px] text-slate-400 flex items-center gap-1">
                  <Film className="w-2.5 h-2.5" />
                  {a.count} 部
                </div>
              </button>
            ))}
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="text-center text-slate-300 text-xs py-12">无演员</div>
        )}
      </div>
    </div>
  );
};
