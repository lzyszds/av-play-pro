/**
 * Electron API 类型声明
 * 用于 IPC 事件监听（下载进度推送）
 */

export interface ElectronAPI {
  download: {
    onProgress: (callback: (event: any, data: {
      line: string
      percent: number | null
      done: boolean
      success: boolean
    }) => void) => () => void
  }
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
    trpcLink?: any
  }
}

export {}