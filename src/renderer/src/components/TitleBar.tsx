import React from 'react'
import { Minus, Square, X, AppWindow } from 'lucide-react'
import { trpc } from '../lib/trpc'

export const TitleBar: React.FC = () => {
  return (
    <div
      className="h-9 bg-slate-900 flex items-center justify-between select-none shrink-0"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex items-center gap-2 px-3">
        <AppWindow className="w-4 h-4 text-amber-500" />
        <span className="text-xs text-slate-300 font-medium truncate">AVPlayPro</span>
      </div>
      <div className="flex-1 h-full" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
      <div className="flex items-center h-full" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button onClick={() => trpc.window.minimize.mutate()} className="w-10 h-full flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition cursor-pointer"><Minus className="w-3.5 h-3.5" /></button>
        <button onClick={() => trpc.window.maximize.mutate()} className="w-10 h-full flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition cursor-pointer"><Square className="w-3 h-3" /></button>
        <button onClick={() => trpc.window.close.mutate()} className="w-10 h-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-rose-600 transition cursor-pointer"><X className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  )
}