/**
 * 发现页 UI 状态：页面字号之外的可见偏好（如上次浏览页码）。
 * 通过 zustand 的 persist 插件落盘，storage 复用 uiStorage 的文件镜像
 * （主进程 userData/ui-state.json；localStorage 在打包后不可靠，故弃用）。
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createUiStateStorage } from "./uiStorage";

interface DiscoverUiState {
  /** 上次浏览到的页码（1 表示未记录/回到顶部） */
  lastPage: number;
  setLastPage: (page: number) => void;
}

export const useDiscoverStore = create<DiscoverUiState>()(
  persist(
    (set) => ({
      lastPage: 1,
      setLastPage: (page) => set({ lastPage: Math.max(1, Math.floor(page)) }),
    }),
    {
      name: "discover",
      storage: createJSONStorage(createUiStateStorage),
      partialize: (state) => ({ lastPage: state.lastPage }),
      version: 1,
    },
  ),
);
