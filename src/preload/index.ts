import { contextBridge, ipcRenderer } from 'electron'
import { exposeElectronTRPC } from 'electron-trpc-experimental/preload'

// 暴露 tRPC IPC Bridge
exposeElectronTRPC()

// 同时暴露 IPC 事件监听（用于下载进度推送）
contextBridge.exposeInMainWorld('electronAPI', {
  download: {
    onProgress: (callback: (event: any, data: any) => void) => {
      const handler = (_event: any, data: any) => callback(_event, data)
      ipcRenderer.on('download-progress', handler)
      return () => ipcRenderer.removeListener('download-progress', handler)
    },
  },
})