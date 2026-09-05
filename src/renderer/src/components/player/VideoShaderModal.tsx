import React, { useState, useEffect } from "react";
import {
  Sparkles,
  Sliders,
  RotateCcw,
  X,
  Sun,
  Contrast,
  Palette,
  Eye,
  Check,
} from "lucide-react";
import { Tooltip } from "../common/Tooltip";

export type FilterPresetKey =
  | "native"
  | "cas"
  | "warm"
  | "night"
  | "vivid"
  | "cool";

export interface VideoFilterSettings {
  preset: FilterPresetKey;
  brightness: number; // 70 ~ 150, default 100
  contrast: number; // 70 ~ 150, default 100
  saturation: number; // 50 ~ 180, default 100
  sharpen: boolean; // 是否叠加 CAS 卷积锐化
}

export const DEFAULT_FILTER_SETTINGS: VideoFilterSettings = {
  preset: "native",
  brightness: 100,
  contrast: 100,
  saturation: 100,
  sharpen: false,
};

const PRESET_CONFIGS: Record<
  FilterPresetKey,
  {
    name: string;
    desc: string;
    badge: string;
    brightness: number;
    contrast: number;
    saturation: number;
    sharpen: boolean;
    extraCss?: string;
  }
> = {
  native: {
    name: "原生画质",
    desc: "原始片源色彩，不添加任何后处理",
    badge: "原画",
    brightness: 100,
    contrast: 100,
    saturation: 100,
    sharpen: false,
  },
  cas: {
    name: "CAS 超清锐化",
    desc: "强化轮廓发丝边缘，模拟 2K/4K 晶体级解析度",
    badge: "推荐",
    brightness: 104,
    contrast: 114,
    saturation: 108,
    sharpen: true,
  },
  warm: {
    name: "温暖电影胶片",
    desc: "柔和高光，提升肤色白皙红润感与电影氛围",
    badge: "美肤",
    brightness: 103,
    contrast: 108,
    saturation: 118,
    sharpen: false,
    extraCss: "sepia(0.08) hue-rotate(-4deg)",
  },
  night: {
    name: "夜景暗部增强",
    desc: "智能提亮暗部阴影与微光场景，夜晚车内轮廓尽显",
    badge: "HDR",
    brightness: 118,
    contrast: 118,
    saturation: 110,
    sharpen: true,
  },
  vivid: {
    name: "赛博高饱和",
    desc: "高动态色彩冲击力，画面极具张力与层次感",
    badge: "艳丽",
    brightness: 102,
    contrast: 116,
    saturation: 145,
    sharpen: false,
  },
  cool: {
    name: "冷冽纯净感",
    desc: "微冷色调，强化通透度与高贵冷色氛围",
    badge: "通透",
    brightness: 104,
    contrast: 108,
    saturation: 106,
    sharpen: true,
    extraCss: "hue-rotate(8deg)",
  },
};

const FILTER_STORAGE_KEY = "avplay:video_filter_settings";

export function loadSavedFilterSettings(): VideoFilterSettings {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return DEFAULT_FILTER_SETTINGS;
    return { ...DEFAULT_FILTER_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_FILTER_SETTINGS;
  }
}

export function saveFilterSettings(settings: VideoFilterSettings): void {
  try {
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

export function buildCssFilter(settings: VideoFilterSettings): string {
  if (
    settings.preset === "native" &&
    settings.brightness === 100 &&
    settings.contrast === 100 &&
    settings.saturation === 100 &&
    !settings.sharpen
  ) {
    return "none";
  }

  const parts: string[] = [];

  if (settings.brightness !== 100) {
    parts.push(`brightness(${settings.brightness / 100})`);
  }
  if (settings.contrast !== 100) {
    parts.push(`contrast(${settings.contrast / 100})`);
  }
  if (settings.saturation !== 100) {
    parts.push(`saturate(${settings.saturation / 100})`);
  }

  const presetExtra = PRESET_CONFIGS[settings.preset]?.extraCss;
  if (presetExtra) {
    parts.push(presetExtra);
  }

  if (settings.sharpen) {
    // 叠加 SVG 卷积锐化滤镜
    parts.push("url(#avplay-cas-sharpen)");
  }

  return parts.length > 0 ? parts.join(" ") : "none";
}

interface Props {
  settings: VideoFilterSettings;
  onChange: (settings: VideoFilterSettings) => void;
  onClose: () => void;
}

export const VideoShaderModal: React.FC<Props> = ({
  settings,
  onChange,
  onClose,
}) => {
  const [localSettings, setLocalSettings] =
    useState<VideoFilterSettings>(settings);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const handleSelectPreset = (key: FilterPresetKey) => {
    const config = PRESET_CONFIGS[key];
    const next: VideoFilterSettings = {
      preset: key,
      brightness: config.brightness,
      contrast: config.contrast,
      saturation: config.saturation,
      sharpen: config.sharpen,
    };
    setLocalSettings(next);
    onChange(next);
    saveFilterSettings(next);
  };

  const handleSliderChange = (
    field: "brightness" | "contrast" | "saturation",
    value: number,
  ) => {
    const next: VideoFilterSettings = {
      ...localSettings,
      [field]: value,
    };
    setLocalSettings(next);
    onChange(next);
    saveFilterSettings(next);
  };

  const handleToggleSharpen = () => {
    const next: VideoFilterSettings = {
      ...localSettings,
      sharpen: !localSettings.sharpen,
    };
    setLocalSettings(next);
    onChange(next);
    saveFilterSettings(next);
  };

  const handleReset = () => {
    setLocalSettings(DEFAULT_FILTER_SETTINGS);
    onChange(DEFAULT_FILTER_SETTINGS);
    saveFilterSettings(DEFAULT_FILTER_SETTINGS);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-amber-500 to-amber-600 text-white shadow-sm shadow-amber-500/20">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <span>画质着色器与视觉增强</span>
                {localSettings.preset !== "native" && (
                  <span className="text-[10px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-full border border-amber-500/20">
                    已启用: {PRESET_CONFIGS[localSettings.preset].name}
                  </span>
                )}
              </h3>
              <p className="text-[11px] text-slate-400">
                GPU 实时着色后处理，瞬间提升片源解析度与色彩氛围
              </p>
            </div>
          </div>
          <Tooltip content="关闭画质增强 (Esc)" placement="left">
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭画质增强"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition"
            >
              <X className="w-4 h-4" />
            </button>
          </Tooltip>
        </div>

        <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* 预设选择网格 */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5 text-amber-500" />
                风格预设方案
              </span>
              <button
                type="button"
                onClick={handleReset}
                className="text-[11px] text-slate-400 hover:text-amber-500 flex items-center gap-1 cursor-pointer transition"
              >
                <RotateCcw className="w-3 h-3" />
                重置为原生
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {(Object.keys(PRESET_CONFIGS) as FilterPresetKey[]).map((key) => {
                const config = PRESET_CONFIGS[key];
                const active = localSettings.preset === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleSelectPreset(key)}
                    className={`p-3 rounded-xl border text-left transition relative cursor-pointer ${
                      active
                        ? "bg-amber-500/10 dark:bg-amber-500/15 border-amber-500 ring-2 ring-amber-500/20 shadow-xs"
                        : "bg-slate-50/60 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                        {config.name}
                      </span>
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                          active
                            ? "bg-amber-500 text-white"
                            : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                        }`}
                      >
                        {config.badge}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-relaxed line-clamp-2">
                      {config.desc}
                    </p>
                    {active && (
                      <div className="absolute top-2 right-2 flex items-center justify-center">
                        <Check className="w-3.5 h-3.5 text-amber-500" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 高级精细调谐滑块 */}
          <div className="p-4 bg-slate-50/80 dark:bg-slate-800/30 border border-slate-200/80 dark:border-slate-800 rounded-xl space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-amber-500" />
                高级画质参数微调
              </span>
              <button
                type="button"
                onClick={handleToggleSharpen}
                title="切换 CAS 对比度自适应锐化状态"
                aria-label="切换 CAS 锐化"
                className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border transition cursor-pointer flex items-center gap-1 ${
                  localSettings.sharpen
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
                    : "bg-slate-200/50 dark:bg-slate-800 text-slate-400 border-transparent"
                }`}
              >
                <Eye className="w-3 h-3" />
                {localSettings.sharpen
                  ? "CAS 锐化增强：已开启"
                  : "CAS 锐化增强：已关闭"}
              </button>
            </div>

            {/* 亮度 */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
                <span className="flex items-center gap-1.5">
                  <Sun className="w-3.5 h-3.5 text-amber-500" />
                  画面亮度 (Brightness)
                </span>
                <span className="font-mono text-xs font-bold text-amber-600 dark:text-amber-400">
                  {localSettings.brightness}%
                </span>
              </div>
              <input
                type="range"
                min="70"
                max="140"
                value={localSettings.brightness}
                onChange={(e) =>
                  handleSliderChange("brightness", Number(e.target.value))
                }
                className="w-full accent-amber-500 cursor-pointer"
              />
            </div>

            {/* 对比度 */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
                <span className="flex items-center gap-1.5">
                  <Contrast className="w-3.5 h-3.5 text-amber-500" />
                  对比度 (Contrast)
                </span>
                <span className="font-mono text-xs font-bold text-amber-600 dark:text-amber-400">
                  {localSettings.contrast}%
                </span>
              </div>
              <input
                type="range"
                min="70"
                max="140"
                value={localSettings.contrast}
                onChange={(e) =>
                  handleSliderChange("contrast", Number(e.target.value))
                }
                className="w-full accent-amber-500 cursor-pointer"
              />
            </div>

            {/* 饱和度 */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
                <span className="flex items-center gap-1.5">
                  <Palette className="w-3.5 h-3.5 text-amber-500" />
                  色彩饱和度 (Saturation)
                </span>
                <span className="font-mono text-xs font-bold text-amber-600 dark:text-amber-400">
                  {localSettings.saturation}%
                </span>
              </div>
              <input
                type="range"
                min="50"
                max="180"
                value={localSettings.saturation}
                onChange={(e) =>
                  handleSliderChange("saturation", Number(e.target.value))
                }
                className="w-full accent-amber-500 cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-slate-50/80 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="text-[10px] text-slate-400 flex items-center gap-1">
            <span>💡 设置会自动保存并在播放所有视频时生效</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white text-xs font-bold shadow-xs cursor-pointer transition"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
};
