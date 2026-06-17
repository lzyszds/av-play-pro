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
  // 来自 meta.json 的丰富字段（可选；存在即在卡片展示）
  code?: string;
  title?: string;
  actors?: string[];
  releaseDate?: string;
  duration?: string;
  studio?: string;
  label?: string;
  studioSeries?: string;
  director?: string;
  genres?: string[];
  rating?: number;
  plot?: string;
  sourceSite?: string;
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
  /** 通知 App 当前选中/播放的视频名（用于私密计时记录关联） */
  onActiveVideoChange?: (name: string | null) => void;
}
