import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { LibraryWidget } from './components/LibraryWidget'
import { DownloadWidget } from './widgets/DownloadWidget'
import { uiStorage } from './stores/uiStorage'
import './styles/globals.css'

// 挂载前先把 UI 状态镜像（主进程 ui-state.json）载入内存：
// 各处的同步读取（useState 初始化器、useMemo）因此可以像 localStorage 一样
// 首帧就拿到真实值，主题/布局/页码不会闪变。2s 超时兜底，主进程无响应时
// 以默认值启动。widget 窗口不依赖这些状态，多等几毫秒无碍。
await uiStorage.whenReady()

const params = new URLSearchParams(window.location.search)
const widget = params.get('widget')
const rootPath = params.get('rootPath') || ''
const root = ReactDOM.createRoot(document.getElementById('root')!)

function renderWidget() {
  if (widget === 'library') return <LibraryWidget videoPath={rootPath} />
  if (widget === 'download') return <DownloadWidget />
  return <App />
}

// 原生 webview 不适合被 StrictMode 的开发期“挂载→卸载→再挂载”检查包裹：
// 每次重挂载都会重新发起一次真实网页请求，看起来像进入页面时自动刷新。
// 页面自身仍通过事件清理和稳定的 sourceUrl 管理生命周期。
root.render(renderWidget())
