import React from 'react'
import { Download, Play, Terminal } from 'lucide-react'

interface HeaderProps {
  currentPage: string
  onPageChange: (page: 'download' | 'player') => void
  systemLogs: Array<{ text: string; level: string; time: string }>
}

export const Header: React.FC<HeaderProps> = ({ currentPage, onPageChange, systemLogs }) => {
  return (
    <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange('download')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
            currentPage === 'download' ? 'bg-amber-500 text-slate-950 shadow-sm' : 'text-slate-500 hover:bg-slate-100'
          }`}
        >
          <Download className="w-3.5 h-3.5" />
          下载管理
        </button>
        <button
          onClick={() => onPageChange('player')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
            currentPage === 'player' ? 'bg-amber-500 text-slate-950 shadow-sm' : 'text-slate-500 hover:bg-slate-100'
          }`}
        >
          <Play className="w-3.5 h-3.5" />
          播放器
        </button>
      </div>
      <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400 max-w-md truncate">
        <Terminal className="w-3 h-3 text-emerald-500 shrink-0" />
        {systemLogs.length > 0 && (
          <span className="truncate">{systemLogs[systemLogs.length - 1].text}</span>
        )}
      </div>
    </div>
  )
}
