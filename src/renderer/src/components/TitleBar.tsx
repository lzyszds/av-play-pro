import React from 'react'
import { Minus, Square, X, AppWindow, Download, Play, Terminal } from 'lucide-react'
import { trpc } from '../lib/trpc'

interface TitleBarProps {
  currentPage: string
  onPageChange: (page: 'download' | 'player') => void
  systemLogs: Array<{ text: string; level: string; time: string }>
}

const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties
const drag = { WebkitAppRegion: 'drag' } as React.CSSProperties

export const TitleBar: React.FC<TitleBarProps> = ({ currentPage, onPageChange, systemLogs }) => {
  return (
    <div
      className="h-9 bg-slate-900 flex items-center justify-between select-none shrink-0"
      style={drag}
    >
      {/* 左侧：应用标识 + 页面切换 */}
      <div className="flex items-center h-full">
        <div className="flex items-center gap-2 px-3">
          <AppWindow className="w-4 h-4 text-amber-500" />
          <span className="text-xs text-slate-300 font-medium truncate">AVPlayPro</span>
        </div>
        <div className="flex items-center gap-1 pl-2" style={noDrag}>
          <button
            onClick={() => onPageChange('download')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-bold transition cursor-pointer ${
              currentPage === 'download'
                ? 'bg-amber-500 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            下载管理
          </button>
          <button
            onClick={() => onPageChange('player')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-bold transition cursor-pointer ${
              currentPage === 'player'
                ? 'bg-amber-500 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Play className="w-3.5 h-3.5" />
            播放器
          </button>
        </div>
      </div>

      {/* 中间：最近日志（可拖拽区） */}
      <div className="flex-1 h-full flex items-center justify-end min-w-0 px-4" style={drag}>
        {systemLogs.length > 0 && (
          <div className="flex items-center gap-2 text-[10px] font-mono text-slate-500 max-w-md truncate">
            <Terminal className="w-3 h-3 text-emerald-500 shrink-0" />
            <span className="truncate">{systemLogs[systemLogs.length - 1].text}</span>
          </div>
        )}
      </div>

      {/* 右侧：窗口控制 */}
      <div className="flex items-center h-full" style={noDrag}>
        <button onClick={() => trpc.window.minimize.mutate()} className="w-10 h-full flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition cursor-pointer"><Minus className="w-3.5 h-3.5" /></button>
        <button onClick={() => trpc.window.maximize.mutate()} className="w-10 h-full flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition cursor-pointer"><Square className="w-3 h-3" /></button>
        <button onClick={() => trpc.window.close.mutate()} className="w-10 h-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-rose-600 transition cursor-pointer"><X className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  )
}
