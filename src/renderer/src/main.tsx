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

root.render(<React.StrictMode>{renderWidget()}</React.StrictMode>)
