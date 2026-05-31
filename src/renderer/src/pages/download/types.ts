import type * as React from "react";

export type TaskStatus =
  | "PENDING"
  | "PARSING"
  | "DOWNLOADING"
  | "PAUSED"
  | "COMPLETED"
  | "FAILED";

export interface DownloadTask {
  id: string;
  name: string;
  url: string;
  status: TaskStatus;
  totalSize: number;
  progress: number;
  speed: number;
  fileSize: number;
  downloadedSize: number;
  totalSegments: number;
  downloadedSegments: number;
  format: "MP4" | "MKV" | "TS";
  headers: string;
  savePath: string;
  threads: number;
  creationTime: string;
  logs: string[];
  encryptionType?: string;
  resolution?: string;
  coverUrl?: string;
  previewUrl?: string;
  sourcePageUrl?: string;
  referer?: string;
  refererSource?: string;
}

export interface LogMessage {
  id: string;
  timestamp: string;
  level: "INFO" | "SUCCESS" | "WARNING" | "ERROR" | "DEBUG";
  text: string;
}

export type ThemeMode = "system" | "light" | "dark";
export type CloseAction = "ask" | "tray" | "quit";

export interface AppSettings {
  video_path: string;
  temp_path: string;
  defaultFormat: "MP4" | "MKV" | "TS";
  defaultThreads: number;
  maxConcurrentTasks: number;
  autoMerge: boolean;
  proxyUrl: string;
  nm3u8dlPath: string;
  theme: ThemeMode;
  closeAction: CloseAction;
  notifyOnComplete: boolean;
  notifySound: boolean;
  consoleOpen: boolean;
  consoleHeight: number;
  /** N_m3u8DL-RE --max-speed 值，例 "5M" / "512K" / "" 为不限速 */
  globalSpeedLimit: string;
}

export interface DownloadPageProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  onAddSystemLog: (
    text: string,
    level: "INFO" | "WARNING" | "SUCCESS" | "ERROR",
  ) => void;
  onPlayCompletedTask: (task: DownloadTask) => void;
  /** 全局日志（由 App 持有），DownloadPage 读取/写入 */
  logs: LogMessage[];
  setLogs: React.Dispatch<React.SetStateAction<LogMessage[]>>;
  addLog: (
    text: string,
    level?: "INFO" | "WARNING" | "SUCCESS" | "ERROR",
  ) => void;
}
