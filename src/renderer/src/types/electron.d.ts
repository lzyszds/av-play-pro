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
