import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { LibraryWidget } from './components/LibraryWidget'
import { DownloadWidget } from './widgets/DownloadWidget'
import './styles/globals.css'

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
