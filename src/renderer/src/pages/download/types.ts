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
}

export interface DownloadPageProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  onAddSystemLog: (
    text: string,
    level: "INFO" | "WARNING" | "SUCCESS" | "ERROR",
  ) => void;
  onPlayCompletedTask: (task: DownloadTask) => void;
}
