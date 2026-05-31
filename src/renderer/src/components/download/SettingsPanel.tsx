import React, { useState } from "react";
import {
  Plus, Play, Pause, Trash2, Eye, FileVideo, CheckCircle2, AlertCircle,
  Copy, Check, Search, Film, Terminal, Code, Settings, Trash2 as TrashIcon,
  Shield, Download, X, Folder, Save, AlertCircle as AlertWarn, Cpu,
  ChevronDown, ChevronRight, Globe, Info,
} from "lucide-react";
import { trpc } from "../../lib/trpc";
import type { AppSettings } from "../../pages/download/types";

export interface SettingsPanelProps {
  settings: AppSettings;
  onSaveSettings: (settings: AppSettings) => void;
  onAddSystemLog: (
    text: string,
    level: "INFO" | "WARNING" | "SUCCESS" | "ERROR",
  ) => void;
  onClose: () => void;
}

export function SettingsPanel({
  settings,
  onSaveSettings,
  onAddSystemLog,
  onClose,
}: SettingsPanelProps) {
  const [videoPath, setVideoPath] = useState(settings.video_path);
  const [tempPath, setTempPath] = useState(settings.temp_path);
  const [proxyUrl, setProxyUrl] = useState(settings.proxyUrl);
  const [showProxy, setShowProxy] = useState(false);
  const [isInstallingExtension, setIsInstallingExtension] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSettings({
      ...settings,
      video_path: videoPath,
      temp_path: tempPath,
      proxyUrl,
    });
    onAddSystemLog("Electron 核心: 系统配置已更新。", "SUCCESS");
  };

  const handleSelectFolder = async (
    setter: (val: string) => void,
    label: string,
    currentPath: string,
  ) => {
    try {
      const selected = await trpc.dialog.selectFolder.query({
        currentPath,
      });
      if (selected) {
        setter(selected);
        onAddSystemLog(`已将 [${label}] 路径设置为 ${selected}`, "SUCCESS");
      }
    } catch (err) {
      onAddSystemLog(`选择文件夹失败: ${err}`, "ERROR");
    }
  };

  const handleInstallChromeExtension = async () => {
    setIsInstallingExtension(true);
    try {
      const result = await trpc.extension.installToChrome.mutate({});

      if (!result.success) {
        throw new Error("Chrome extension import failed");
      }

      onAddSystemLog(
        `已打开 Chrome 扩展页，并复制插件路径: ${result.extensionPath}`,
        "SUCCESS",
      );
      onAddSystemLog(
        "插件路径已复制，进入扩展页后打开开发者模式并加载已解压的扩展程序。",
        "INFO",
      );
      await trpc.window.focus.mutate();
      await new Promise((resolve) => setTimeout(resolve, 150));
      window.alert(
        "已进入 Chrome 扩展页面。\n\n请点击左上角的“加载已解压的扩展程序”按钮。\n\n插件目录路径已经复制到剪贴板，选择文件夹时直接粘贴即可。",
      );
    } catch (err: any) {
      onAddSystemLog(`导入 Chrome 插件失败: ${err?.message || err}`, "ERROR");
    } finally {
      setIsInstallingExtension(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/20 flex items-center justify-center p-4 text-slate-600 font-sans anim-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh] anim-scale-in">
        {/* Title */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200 bg-white">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-50 p-2 rounded-lg border border-indigo-100">
              <Cpu className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h2 className="text-sm font-sans font-extrabold text-slate-800 tracking-wider">
                系统核心配置
              </h2>
              <p className="text-[10px] text-black mt-0.5">
                配置 N_m3u8DL-RE 运行环境及本地媒体库路径
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-black hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="p-6 overflow-y-auto space-y-6 bg-white"
        >
          {/* Paths */}
          <div className="space-y-5">
            <h3 className="text-xs font-bold text-slate-700 border-l-2 border-amber-500 pl-2 tracking-wide">
              媒体存储路径
            </h3>

            <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg text-[11px] text-slate-500">
              <span className="font-bold text-amber-700">目录结构说明:</span>{" "}
              每个视频存放在独立子文件夹中，包含：
              <code className="ml-1 text-[10px] bg-white border border-amber-100 px-1.5 py-0.5 text-amber-700 font-mono rounded">
                video.mp4
              </code>
              <code className="ml-1 text-[10px] bg-white border border-amber-100 px-1.5 py-0.5 text-amber-700 font-mono rounded">
                cover.jpg
              </code>
              <code className="ml-1 text-[10px] bg-white border border-amber-100 px-1.5 py-0.5 text-amber-700 font-mono rounded">
                preview.mp4
              </code>
            </div>

            {/* Video Path */}
            <div>
              <label className="text-xs font-semibold text-black block mb-1.5">
                视频存放目录（子文件夹结构）
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={videoPath}
                  onChange={(e) => setVideoPath(e.target.value)}
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-slate-700 focus:outline-none focus:border-amber-500 transition"
                  placeholder="M:\video\videos\"
                />
                <button
                  type="button"
                  onClick={() =>
                    handleSelectFolder(setVideoPath, "视频目录", videoPath)
                  }
                  className="p-2 bg-white hover:bg-slate-50 rounded-lg border border-slate-200 transition cursor-pointer"
                >
                  <Folder className="w-3.5 h-3.5 text-amber-400" />
                </button>
              </div>
            </div>

            {/* Temp Path */}
            <div>
              <label className="text-xs font-semibold text-black block mb-1.5">
                下载临时目录
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={tempPath}
                  onChange={(e) => setTempPath(e.target.value)}
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-slate-700 focus:outline-none focus:border-amber-500 transition"
                  placeholder="M:\video\temp\"
                />
                <button
                  type="button"
                  onClick={() =>
                    handleSelectFolder(setTempPath, "临时目录", tempPath)
                  }
                  className="p-2 bg-white hover:bg-slate-50 rounded-lg border border-slate-200 transition cursor-pointer"
                >
                  <Folder className="w-3.5 h-3.5 text-amber-400" />
                </button>
              </div>
            </div>
          </div>

          {/* Proxy */}
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => setShowProxy(!showProxy)}
              className="flex items-center gap-2 text-xs font-bold text-slate-700 border-l-2 border-amber-500 pl-2 tracking-wide w-full text-left cursor-pointer"
            >
              {showProxy ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
              网络与代理
              <span className="text-[10px] text-black font-normal">
                （可选）
              </span>
            </button>

            {showProxy && (
              <div className="pl-4 pt-2">
                <div>
                  <label className="text-xs font-semibold text-black block mb-1.5 flex items-center justify-between">
                    <span>代理服务器地址</span>
                    <span className="text-[10px] text-amber-400 font-semibold">
                      支持 HTTP/SOCKS5
                    </span>
                  </label>
                  <input
                    type="text"
                    value={proxyUrl}
                    onChange={(e) => setProxyUrl(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-slate-700 focus:outline-none focus:border-amber-500 transition placeholder-slate-400"
                    placeholder="https://127.0.0.1:7890"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Chrome Extension */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-slate-700 border-l-2 border-amber-500 pl-2 tracking-wide">
              浏览器插件
            </h3>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-700 flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5 text-amber-500" />
                  M3U8 嗅探插件
                </div>
                <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                  打开 Chrome 扩展页并复制 extension 插件目录。
                </p>
              </div>
              <button
                type="button"
                onClick={handleInstallChromeExtension}
                disabled={isInstallingExtension}
                className="shrink-0 flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-amber-50 disabled:opacity-60 disabled:cursor-not-allowed text-xs text-amber-700 border border-amber-200 font-bold rounded-lg transition cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                {isInstallingExtension ? "打开中..." : "打开导入向导"}
              </button>
            </div>
          </div>

          {/* Warning */}
          <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl flex items-start gap-3">
            <AlertWarn className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-[11px] text-slate-500 leading-normal font-sans">
              <span className="font-extrabold text-amber-700">
                核心运行说明:
              </span>{" "}
              本系统通过封装{" "}
              <code className="text-[10px] bg-white border border-amber-100 px-1.5 py-0.5 text-amber-700 font-mono rounded font-bold mx-1">
                N_m3u8DL-RE
              </code>{" "}
              实现自动化流媒体处理。所有合并操作由工具原生完成，确保最高质量与稳定性。
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-500 border border-slate-200 transition rounded-lg text-xs font-semibold cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-6 py-2 bg-amber-500 hover:bg-amber-600 text-xs text-white font-bold rounded-lg shadow-sm transition cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              保存配置
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
