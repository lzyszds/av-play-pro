import type * as React from "react";

export interface ElectronAPI {
  download: {
    onProgress: (
      callback: (
        event: any,
        data: {
          line: string;
          percent: number | null;
          done: boolean;
          success: boolean;
        },
      ) => void,
    ) => () => void;
  };
  extension: {
    onTaskPushed: (
      callback: (
        event: any,
        data: {
          queued: boolean;
          queuedCount: number;
        },
      ) => void,
    ) => () => void;
  };
  app?: {
    onTrayCommand: (
      callback: (data: { type: string; page?: string }) => void,
    ) => () => void;
    setZoom: (factor: number) => Promise<void>;
  };
  sync?: {
    onSyncStatus: (
      callback: (data: {
        reason: string;
        updatedAt: string;
        success: boolean;
        stats?: {
          videoCount: number;
          timelineCount: number;
          actorCount: number;
        };
      }) => void,
    ) => () => void;
  };
  mainLog?: {
    /** 主进程日志实时流（1:1）：{ time, level, text } */
    onEntry: (
      callback: (entry: { time: number; level: string; text: string }) => void,
    ) => () => void;
  };
  library?: {
    /** 下载产物落库后触发（organize 完成即发，不等刮削） */
    onUpdated: (
      callback: (info: { name?: string; at: number }) => void,
    ) => () => void;
  };
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        src?: string;
        partition?: string;
        allowpopups?: boolean;
        preload?: string;
        autosize?: string;
      };
    }
  }

  interface Window {
    electronAPI?: ElectronAPI;
    trpcLink?: any;
  }
}

export {};
