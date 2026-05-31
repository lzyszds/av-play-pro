export interface VideoItem {
  id: string;
  name: string;
  url: string;
  resolution: string;
  encryptionType: string;
  coverUrl?: string;
  previewUrl?: string;
  size?: string;
  createdAt?: number;
}

export interface PlayerPageProps {
  videoPath: string;
  onAddSystemLog: (
    text: string,
    level: "INFO" | "WARNING" | "SUCCESS" | "ERROR",
  ) => void;
  /** 由 DownloadPage「立即查看」触发：跳转后用任务名匹配本地视频自动选中并播放 */
  pendingPlayName?: string | null;
  onConsumePendingPlay?: () => void;
}
