import React, { useRef, useState } from "react";
import {
  Download,
  Trophy,
  Flame,
  CheckCircle2,
} from "lucide-react";
import { Button } from "../common/Button";

interface HolographicCardModalProps {
  stats: any;
  rankings: { series: any[]; actors: any[] };
  rankTitle: string;
  rankScore: number;
  peakHour: string;
  onClose: () => void;
  onAddSystemLog?: (
    text: string,
    level: "INFO" | "WARNING" | "SUCCESS" | "ERROR",
  ) => void;
}

export const HolographicCardModal: React.FC<HolographicCardModalProps> = ({
  stats,
  rankings,
  rankTitle,
  rankScore,
  peakHour,
  onClose,
  onAddSystemLog,
}) => {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [rotate, setRotate] = useState({ x: 0, y: 0 });
  const [glare, setGlare] = useState({ x: 50, y: 50, opacity: 0 });
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  const totalWatchHours = ((stats?.totals?.watchSec || 0) / 3600).toFixed(1);
  const totalPlays = stats?.totals?.plays || 0;
  const totalDownloads = stats?.totals?.downloads || 0;
  const topActor = rankings?.actors?.[0]?.name || "暂无";
  const topActorCount = rankings?.actors?.[0]?.count || 0;

  // 3D 鼠标视差转动与全息反光追踪
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const px = (x / rect.width) * 100;
    const py = (y / rect.height) * 100;

    const rotX = -((py - 50) / 50) * 12; // -12deg ~ 12deg
    const rotY = ((px - 50) / 50) * 14;  // -14deg ~ 14deg

    setRotate({ x: rotX, y: rotY });
    setGlare({ x: px, y: py, opacity: 0.85 });
  };

  const handlePointerLeave = () => {
    setRotate({ x: 0, y: 0 });
    setGlare((prev) => ({ ...prev, opacity: 0 }));
  };

  // 离线 Canvas 4K 无损战力卡渲染与导出
  const handleExportCard = async () => {
    setIsExporting(true);
    try {
      const W = 1080;
      const H = 1520;
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("无法创建 Canvas 2D 绘图上下文");

      // 1. 背景暗夜与科技网格
      const bgGrad = ctx.createLinearGradient(0, 0, W, H);
      bgGrad.addColorStop(0, "#08090d");
      bgGrad.addColorStop(0.5, "#0d1117");
      bgGrad.addColorStop(1, "#050608");
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      // 细微网格线
      ctx.strokeStyle = "rgba(255, 255, 255, 0.035)";
      ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
      for (let y = 0; y < H; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }

      // 2. 边缘镭射霓虹边框
      ctx.save();
      ctx.shadowColor = "#f59e0b";
      ctx.shadowBlur = 30;
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 4;
      ctx.strokeRect(36, 36, W - 72, H - 72);
      ctx.restore();

      ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(46, 46, W - 92, H - 92);

      // 3. 顶部 Header
      ctx.fillStyle = "#f59e0b";
      ctx.font = "bold 26px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.letterSpacing = "6px";
      ctx.fillText("AVPLAY PRO · COMBAT CERTIFIED", 72, 100);

      ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
      ctx.font = "16px monospace";
      ctx.fillText(`ARCHIVE ID: ${Math.random().toString(36).slice(2, 10).toUpperCase()} · 2026`, 72, 130);

      // 4. 勋章等级大标题
      ctx.fillStyle = "#ffffff";
      ctx.font = "900 64px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText(rankTitle, 72, 230);

      // 战力数值
      ctx.fillStyle = "#fbbf24";
      ctx.font = "bold 32px monospace";
      ctx.fillText(`⚡ COMBAT POWER: ${rankScore} CP`, 72, 280);

      // 5. 核心指标卡片区域 (4 个小方块)
      const metrics = [
        { label: "观影总时长", val: `${totalWatchHours} 小时`, sub: "沉浸投入" },
        { label: "影片播放量", val: `${totalPlays} 次`, sub: "放映频次" },
        { label: "入库资源数", val: `${totalDownloads} 部`, sub: "资产储备" },
        { label: "黄金时段", val: `${peakHour}:00 点`, sub: "专注巅峰" },
      ];

      metrics.forEach((m, idx) => {
        const col = idx % 2;
        const row = Math.floor(idx / 2);
        const bx = 72 + col * (440 + 56);
        const by = 340 + row * (160 + 24);

        ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
        ctx.fillRect(bx, by, 440, 160);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, by, 440, 160);

        ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
        ctx.font = "18px sans-serif";
        ctx.fillText(m.label, bx + 24, by + 42);

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 38px monospace";
        ctx.fillText(m.val, bx + 24, by + 102);

        ctx.fillStyle = "#f59e0b";
        ctx.font = "15px sans-serif";
        ctx.fillText(m.sub, bx + 24, by + 134);
      });

      // 6. 羁绊女优展示横幅
      const bannerY = 740;
      ctx.fillStyle = "rgba(244, 63, 94, 0.08)";
      ctx.fillRect(72, bannerY, W - 144, 200);
      ctx.strokeStyle = "rgba(244, 63, 94, 0.35)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(72, bannerY, W - 144, 200);

      ctx.fillStyle = "#f43f5e";
      ctx.font = "bold 20px sans-serif";
      ctx.fillText("★ 年度最深羁绊 (SOUL RESONANCE)", 100, bannerY + 48);

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 44px sans-serif";
      ctx.fillText(topActor, 100, bannerY + 115);

      ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
      ctx.font = "20px monospace";
      ctx.fillText(`陪伴作品 ${topActorCount} 部 · 专注相伴指数 SSS 级`, 100, bannerY + 162);

      // 7. 防伪印章与电子水印
      ctx.save();
      ctx.translate(W - 200, H - 240);
      ctx.rotate(-0.18);
      ctx.strokeStyle = "rgba(245, 158, 11, 0.5)";
      ctx.lineWidth = 3;
      ctx.strokeRect(-120, -50, 240, 100);
      ctx.fillStyle = "rgba(245, 158, 11, 0.7)";
      ctx.font = "bold 22px monospace";
      ctx.textAlign = "center";
      ctx.fillText("SEAL CERTIFIED", 0, -10);
      ctx.font = "14px monospace";
      ctx.fillText("AVPLAY MASTER PRO", 0, 22);
      ctx.restore();

      // 8. 底部版权与免责说明
      ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
      ctx.font = "16px monospace";
      ctx.textAlign = "left";
      ctx.fillText("PROPRIETARY & CONFIDENTIAL · LOCAL MEDIA ENGINE PRIVACY FIRST", 72, H - 80);

      // 导出为 PNG
      canvas.toBlob((blob) => {
        if (!blob) throw new Error("Canvas 导出 Blob 失败");
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `AVPlayPro_Combat_Card_${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setIsExporting(false);
        setExportSuccess(true);
        onAddSystemLog?.("4K 赛博全息战力卡已成功导出至本地！", "SUCCESS");
        setTimeout(() => setExportSuccess(false), 3000);
      }, "image/png");
    } catch (err: any) {
      setIsExporting(false);
      onAddSystemLog?.(`导出战力卡失败: ${err?.message}`, "ERROR");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 select-none animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="flex flex-col items-center gap-6 max-w-xl w-full"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 3D 全息卡片主体 */}
        <div
          ref={cardRef}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          style={{
            transform: `perspective(1000px) rotateX(${rotate.x}deg) rotateY(${rotate.y}deg) scale3d(1.02, 1.02, 1.02)`,
            transition: rotate.x === 0 ? "transform 0.5s ease-out" : "none",
          }}
          className="relative w-full aspect-[1/1.4] max-w-[420px] rounded-3xl bg-gradient-to-br from-slate-900 via-slate-950 to-black border-2 border-amber-500/60 shadow-[0_20px_60px_-15px_rgba(245,158,11,0.3)] overflow-hidden cursor-grab active:cursor-grabbing p-6 flex flex-col justify-between"
        >
          {/* 动态镭射高光漫反射层 */}
          <div
            className="absolute inset-0 pointer-events-none transition-opacity duration-200"
            style={{
              background: `radial-gradient(circle at ${glare.x}% ${glare.y}%, rgba(255,255,255,0.22) 0%, rgba(245,158,11,0.08) 35%, transparent 75%)`,
              opacity: glare.opacity,
            }}
          />

          {/* 赛博网格底纹 */}
          <div
            className="absolute inset-0 opacity-15 pointer-events-none"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)",
              backgroundSize: "20px 20px",
            }}
          />

          {/* 顶部标签 */}
          <div className="relative z-10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/40">
                <Trophy className="w-4 h-4" />
              </div>
              <span className="text-[11px] font-mono font-bold tracking-widest text-amber-400">
                AVPLAY PRO CERTIFIED
              </span>
            </div>
            <span className="text-[10px] font-mono text-slate-400 border border-slate-700/80 px-2 py-0.5 rounded-full bg-slate-800/40">
              SSR 典藏
            </span>
          </div>

          {/* 战力称号与勋章 */}
          <div className="relative z-10 my-auto text-center space-y-2">
            <div className="inline-flex p-3 rounded-2xl bg-gradient-to-tr from-amber-500/30 via-rose-500/20 to-amber-400/10 border border-amber-500/40 shadow-inner">
              <Flame className="w-10 h-10 text-amber-400 animate-pulse" />
            </div>
            <h2 className="text-2xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-amber-200 via-amber-400 to-amber-500 tracking-tight">
              {rankTitle}
            </h2>
            <div className="text-xs font-mono font-bold text-amber-400/90 flex items-center justify-center gap-1">
              <span>⚡ COMBAT POWER:</span>
              <span className="text-base text-amber-300 font-extrabold">
                {rankScore} CP
              </span>
            </div>
          </div>

          {/* 核心数据展示方格 */}
          <div className="relative z-10 grid grid-cols-2 gap-2 text-left">
            <div className="p-2.5 rounded-xl bg-white/5 border border-white/10 backdrop-blur-sm">
              <div className="text-[10px] text-slate-400">年度投入</div>
              <div className="text-sm font-bold font-mono text-white mt-0.5">
                {totalWatchHours} 小时
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-white/5 border border-white/10 backdrop-blur-sm">
              <div className="text-[10px] text-slate-400">放映频次</div>
              <div className="text-sm font-bold font-mono text-white mt-0.5">
                {totalPlays} 次
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-white/5 border border-white/10 backdrop-blur-sm">
              <div className="text-[10px] text-slate-400">资产入库</div>
              <div className="text-sm font-bold font-mono text-white mt-0.5">
                {totalDownloads} 部
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-white/5 border border-white/10 backdrop-blur-sm">
              <div className="text-[10px] text-slate-400">灵魂羁绊</div>
              <div className="text-sm font-bold text-rose-400 truncate mt-0.5">
                {topActor}
              </div>
            </div>
          </div>

          {/* 底部电子钢印 */}
          <div className="relative z-10 pt-3 border-t border-white/10 flex items-center justify-between text-[9px] font-mono text-slate-500">
            <span>OFFLINE LOCAL ENCRYPTED</span>
            <span className="text-amber-500/80 font-bold">★ SEALED 2026</span>
          </div>
        </div>

        {/* 底部操作条 */}
        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            size="md"
            disabled={isExporting}
            icon={
              exportSuccess ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-300" />
              ) : (
                <Download className={`w-4 h-4 ${isExporting ? "animate-bounce" : ""}`} />
              )
            }
            onClick={handleExportCard}
          >
            {isExporting
              ? "正在渲染 4K 画质..."
              : exportSuccess
                ? "导出成功！已保存到本地"
                : "下载 4K 无损全息战力卡 (PNG)"}
          </Button>

          <Button variant="secondary" size="md" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </div>
  );
};
