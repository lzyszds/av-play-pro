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
  extension: {
    onTaskPushed: (callback: (event: any, data: any) => void) => {
      const handler = (_event: any, data: any) => callback(_event, data)
      ipcRenderer.on('extension-task-pushed', handler)
      return () => ipcRenderer.removeListener('extension-task-pushed', handler)
    },
  },
  whisper: {
    onJobUpdate: (cb: (jobs: any) => void) => {
      const h = (_e: any, d: any) => cb(d)
      ipcRenderer.on('whisper:job-update', h)
      return () => ipcRenderer.removeListener('whisper:job-update', h)
    },
    onModelProgress: (cb: (p: any) => void) => {
      const h = (_e: any, d: any) => cb(d)
      ipcRenderer.on('whisper:model-progress', h)
      return () => ipcRenderer.removeListener('whisper:model-progress', h)
    },
    onModelDone: (cb: (p: any) => void) => {
      const h = (_e: any, d: any) => cb(d)
      ipcRenderer.on('whisper:model-done', h)
      return () => ipcRenderer.removeListener('whisper:model-done', h)
    },
    onModelError: (cb: (p: any) => void) => {
      const h = (_e: any, d: any) => cb(d)
      ipcRenderer.on('whisper:model-error', h)
      return () => ipcRenderer.removeListener('whisper:model-error', h)
    },
    onInstallProgress: (cb: (p: any) => void) => {
      const h = (_e: any, d: any) => cb(d)
      ipcRenderer.on('whisper:install-progress', h)
      return () => ipcRenderer.removeListener('whisper:install-progress', h)
    },
    onInstallDone: (cb: (p: any) => void) => {
      const h = (_e: any, d: any) => cb(d)
      ipcRenderer.on('whisper:install-done', h)
      return () => ipcRenderer.removeListener('whisper:install-done', h)
    },
    onInstallError: (cb: (p: any) => void) => {
      const h = (_e: any, d: any) => cb(d)
      ipcRenderer.on('whisper:install-error', h)
      return () => ipcRenderer.removeListener('whisper:install-error', h)
    },
  },
})
