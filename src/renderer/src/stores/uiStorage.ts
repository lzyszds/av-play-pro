/**
 * 渲染端通用 UI 状态存储：主进程 userData/ui-state.json 的内存镜像。
 *
 * localStorage 在打包后不可靠，全部 UI 状态改存主进程文件（uiStateRouter）。
 * 但文件存取是异步 IPC，而大量调用点是同步的（useState 初始化器、useMemo），
 * 因此这里在模块加载时就把整个映射一次性拉进内存镜像：
 *  - 读取同步走镜像（main.tsx 挂载 React 前 await whenReady() 保证已填充）；
 *  - 写入同步更新镜像，防抖 150ms 后经 setMany 批量落盘（合并突发写入）。
 *
 * zustand persist 存储经 createUiStateStorage() 复用同一份镜像，
 * 全渲染端只有这一条到 ui-state.json 的读写通路。
 */

import { trpc } from "../lib/trpc";
import type { StateStorage } from "zustand/middleware";

type UiStateMap = Record<string, string>;

const mirror = new Map<string, string>();
/** 待落盘条目；value 为 null 表示删除 */
const dirty = new Map<string, string | null>();

let readyPromise: Promise<void> | null = null;

/**
 * 镜像就绪（初次全量拉取完成）。单次 IPC，所有消费方共享同一趟往返。
 * 超时兜底：主进程无响应时以空镜像继续启动，仅丢失跨启动记忆。
 */
function whenReady(timeoutMs = 2000): Promise<void> {
  if (!readyPromise) {
    readyPromise = Promise.race([
      (async () => {
        try {
          const map = (await trpc.uiState.get.query()) as UiStateMap;
          for (const [k, v] of Object.entries(map)) {
            // 就绪前若有本地写入（理论上不会发生），不回灌覆盖
            if (!dirty.has(k)) mirror.set(k, v);
          }
        } catch {
          /* 拉取失败仅丢失跨启动记忆，不阻塞启动 */
        }
      })(),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }
  return readyPromise;
}

let flushTimer: number | null = null;

function flushNow(): void {
  if (flushTimer != null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (dirty.size === 0) return;
  const entries = Array.from(dirty, ([name, value]) => ({ name, value }));
  dirty.clear();
  void trpc.uiState.setMany
    .mutate({ entries })
    .catch(() => {
      /* 落盘失败仅影响跨启动记忆 */
    });
}

function scheduleFlush(): void {
  if (flushTimer != null) return;
  flushTimer = window.setTimeout(flushNow, 150);
}

// 关窗兜底：防抖窗口内的待写条目尽力发出（invoke 消息在卸载前已进 IPC 通道）
window.addEventListener("beforeunload", flushNow);

export const uiStorage = {
  /** 同步读取镜像（main.tsx 已在挂载前 await whenReady()） */
  get(name: string): string | null {
    return mirror.get(name) ?? null;
  },

  /** 同步写镜像并调度防抖落盘；value 传 null 表示删除 */
  set(name: string, value: string | null): void {
    if (mirror.get(name) === value) return;
    if (value == null) {
      mirror.delete(name);
      dirty.set(name, null);
    } else {
      mirror.set(name, value);
      dirty.set(name, value);
    }
    scheduleFlush();
  },

  remove(name: string): void {
    uiStorage.set(name, null);
  },

  whenReady,
};

/** zustand persist 的 StateStorage 适配器：与镜像同源，杜绝两份真相 */
export function createUiStateStorage(): StateStorage {
  return {
    getItem: async (name) => {
      await whenReady();
      return mirror.get(name) ?? null;
    },
    setItem: async (name, value) => {
      uiStorage.set(name, value);
    },
    removeItem: async (name) => {
      uiStorage.set(name, null);
    },
  };
}
