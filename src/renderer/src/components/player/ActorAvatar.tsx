import React, { useEffect, useState, useRef } from "react";
import { trpc } from "../../lib/trpc";
import { Users } from "lucide-react";

interface Props {
  name: string;
  size?: number;
  onClick?: (e: React.MouseEvent) => void;
  /** 是否在缺失时主动触发爬取（默认 true）。列表场景设为 false，由父组件统一批量补全 */
  autoFetch?: boolean;
}

// 进程级缓存：同一次会话避免重复请求
const cache = new Map<string, string | null>();

/** 清空头像缓存（在批量补全完成后调用，强制下次拉取） */
export function clearActorAvatarCache(names?: string[]) {
  if (!names) {
    cache.clear();
    return;
  }
  for (const n of names) cache.delete(n);
}

export const ActorAvatar: React.FC<Props> = ({
  name,
  size = 48,
  onClick,
  autoFetch = true,
}) => {
  const initial = cache.has(name) ? cache.get(name) : undefined;
  const [imgUrl, setImgUrl] = useState<string | null | undefined>(initial);
  const [loading, setLoading] = useState(initial === undefined);
  const [error, setError] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (cache.has(name)) {
      const v = cache.get(name)!;
      setImgUrl(v);
      setError(!v);
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const existing = await trpc.actor.get.query({ name });
        if (cancelled || !mountedRef.current) return;
        if (existing?.avatarBase64) {
          cache.set(name, existing.avatarBase64);
          setImgUrl(existing.avatarBase64);
          setLoading(false);
          return;
        }
        if (!autoFetch) {
          setLoading(false);
          setError(true);
          return;
        }
        const r = await trpc.actor.ensure.mutate({ name });
        if (cancelled || !mountedRef.current) return;
        if (r?.avatarBase64) {
          cache.set(name, r.avatarBase64);
          setImgUrl(r.avatarBase64);
        } else {
          cache.set(name, null);
          setError(true);
        }
      } catch {
        if (cancelled || !mountedRef.current) return;
        cache.set(name, null);
        setError(true);
      } finally {
        if (!cancelled && mountedRef.current) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [name, autoFetch]);

  const sizeStyle = { width: size, height: size };
  const clickable = onClick ? "cursor-pointer hover:ring-2 hover:ring-amber-400 transition" : "";

  if (loading) {
    return (
      <div
        className={`rounded-full bg-slate-200 dark:bg-slate-700 animate-pulse flex items-center justify-center shrink-0 ${clickable}`}
        style={sizeStyle}
        onClick={onClick}
      >
        <Users
          className="text-slate-400"
          style={{ width: size * 0.4, height: size * 0.4 }}
        />
      </div>
    );
  }

  if (error || !imgUrl) {
    return (
      <div
        className={`rounded-full bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center shrink-0 ${clickable}`}
        style={sizeStyle}
        onClick={onClick}
        title={name}
      >
        <Users
          className="text-rose-400"
          style={{ width: size * 0.4, height: size * 0.4 }}
        />
      </div>
    );
  }

  return (
    <img
      src={imgUrl}
      alt={name}
      title={name}
      onClick={onClick}
      className={`rounded-full object-cover shrink-0 bg-slate-200 dark:bg-slate-700 ${clickable}`}
      style={sizeStyle}
      onError={() => {
        cache.set(name, null);
        setError(true);
      }}
    />
  );
};
