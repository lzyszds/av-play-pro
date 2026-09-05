import React from "react";
import { Keyboard, X } from "lucide-react";

interface Props {
  showHelp: boolean;
  onCloseHelp: () => void;
}

export const ProHotkeyHud: React.FC<Props> = ({ showHelp, onCloseHelp }) => {
  if (!showHelp) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 select-none animate-in fade-in duration-200"
      onClick={onCloseHelp}
    >
      <div
        className="w-full max-w-lg bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <Keyboard className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100">
                极客全键盘盲操视控指南 (Pro Hotkeys)
              </h3>
              <p className="text-[10px] text-slate-400">
                脱离鼠标，使用 Vim / Arc 风格纯键盘流高效穿梭
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCloseHelp}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
          <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800 space-y-2">
            <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">
              影片穿梭与播放
            </div>
            <div className="space-y-1.5 text-slate-300">
              <div className="flex items-center justify-between">
                <span>下一个影片</span>
                <kbd className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-[11px] text-amber-300 font-bold">
                  J
                </kbd>
              </div>
              <div className="flex items-center justify-between">
                <span>上一个影片</span>
                <kbd className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-[11px] text-amber-300 font-bold">
                  K
                </kbd>
              </div>
              <div className="flex items-center justify-between">
                <span>播放 / 暂停</span>
                <kbd className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-[11px] text-amber-300 font-bold">
                  Space
                </kbd>
              </div>
              <div className="flex items-center justify-between">
                <span>快退 / 快进 10 秒</span>
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-[11px] text-amber-300 font-bold">
                    H
                  </kbd>
                  <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-[11px] text-amber-300 font-bold">
                    L
                  </kbd>
                </span>
              </div>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800 space-y-2">
            <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">
              关键帧与调色
            </div>
            <div className="space-y-1.5 text-slate-300">
              <div className="flex items-center justify-between">
                <span>关键帧跃迁 (10%~90%)</span>
                <kbd className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-[11px] text-amber-300 font-bold">
                  1 ~ 9
                </kbd>
              </div>
              <div className="flex items-center justify-between">
                <span>画质着色器循环切换</span>
                <kbd className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-[11px] text-amber-300 font-bold">
                  S
                </kbd>
              </div>
              <div className="flex items-center justify-between">
                <span>高能打点 / 书签标记</span>
                <kbd className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-[11px] text-amber-300 font-bold">
                  F
                </kbd>
              </div>
              <div className="flex items-center justify-between">
                <span>零界面放映层切换</span>
                <kbd className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-[11px] text-amber-300 font-bold">
                  Z
                </kbd>
              </div>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800 space-y-2 col-span-1 sm:col-span-2">
            <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">
              声效与辅助
            </div>
            <div className="grid grid-cols-2 gap-2 text-slate-300">
              <div className="flex items-center justify-between">
                <span>静音 / 开启声音</span>
                <kbd className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-[11px] text-amber-300 font-bold">
                  M
                </kbd>
              </div>
              <div className="flex items-center justify-between">
                <span>打开本快捷键指南</span>
                <kbd className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-[11px] text-amber-300 font-bold">
                  ?
                </kbd>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-2 flex items-center justify-end">
          <button
            type="button"
            onClick={onCloseHelp}
            className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs transition cursor-pointer"
          >
            我知道了 (Esc)
          </button>
        </div>
      </div>
    </div>
  );
};
