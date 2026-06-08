import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open } from "@tauri-apps/plugin-dialog";
import logo from "./assets/logo.png";
import { motion, AnimatePresence } from "framer-motion";

const appWindow = getCurrentWebviewWindow();

interface AppCfg {
  app_name: string;
  app_display_name: string;
  app_publisher: string;
  app_version: string;
  exe_name: string;
  app_description: string;
}

// 安装阶段文案
const textFrames = [
  { limit: 25, text: "正在唤醒 8K 极清视频解码器..." },
  { limit: 55, text: "正在打通多线程极速网络下载链路..." },
  { limit: 80, text: "正在校准硬件级 GPU 视频渲染核心..." },
  { limit: 100, text: "正在配置动态色彩通道与帧率矩阵..." },
];

// 15根频谱的交错延迟
const delays = [
  -0.2, -0.5, -0.1, -0.7, -0.3, -0.6, -0.2, -0.8, -0.4, -0.1, -0.5, -0.3, -0.7,
  -0.2, -0.6,
];

export default function App() {
  const [step, setStep] = useState(1);
  const [progress, setProgress] = useState(0);
  const [cfg, setCfg] = useState<AppCfg | null>(null);
  const [installPath, setInstallPath] = useState("");
  const PROJECT_FOLDER = cfg?.app_name ?? "App";

  useEffect(() => {
    (async () => {
      const c = await invoke<AppCfg>("get_app_config");
      setCfg(c);
      const dir = await invoke<string>("default_install_dir");
      setInstallPath(dir);
    })();

    const unlisten = listen<number>("install-progress", (event) => {
      setProgress(event.payload);
      if (event.payload === 100) {
        setTimeout(() => setStep(3), 600);
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const handleSelectPath = async () => {
    if (step !== 1) return;
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: installPath,
      });
      if (!selected) return;
      let chosen = selected as string;
      const sep = chosen.includes("\\") ? "\\" : "/";
      const segs = chosen.split(/[\\/]/).filter(Boolean);
      const last = segs[segs.length - 1] ?? "";
      if (last.toLowerCase() === PROJECT_FOLDER.toLowerCase()) {
        setInstallPath(chosen);
        return;
      }
      try {
        const [exists, isEmpty] = await invoke<[boolean, boolean]>(
          "check_dir_status",
          { path: chosen },
        );
        if (exists && isEmpty) {
          setInstallPath(chosen);
        } else {
          setInstallPath(
            chosen.replace(/[\\/]+$/, "") + sep + PROJECT_FOLDER,
          );
        }
      } catch {
        setInstallPath(
          chosen.replace(/[\\/]+$/, "") + sep + PROJECT_FOLDER,
        );
      }
    } catch (err) {
      console.error("对话框启动失败", err);
    }
  };

  const startInstall = async () => {
    setStep(2);
    await invoke("run_installation", { path: installPath }).catch(
      console.error,
    );
  };

  const handleLaunch = async () => {
    invoke("launch_app");
    setTimeout(async () => {
      await appWindow.close();
    }, 400);
  };

  // 获取当前安装阶段文案
  const getStatusText = () => {
    for (let i = textFrames.length - 1; i >= 0; i--) {
      if (progress <= textFrames[i].limit) return textFrames[i].text;
    }
    return textFrames[textFrames.length - 1].text;
  };

  return (
    <div className="w-screen h-screen bg-transparent flex justify-center items-center overflow-hidden">
      {/* 360x480 外框 - 曜石蓝黑 */}
      <div
        className="relative w-[360px] h-[480px] rounded-[20px] p-[3px] flex items-center justify-center overflow-hidden z-10"
        style={{
          backgroundColor: "#faf8f6",
          border: "1px solid rgba(0, 0, 0, 0.06)",
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
        }}
      >
        {/* 系统极光背景 */}
        <div
          className="absolute w-[240px] h-[240px] rounded-full pointer-events-none opacity-75 z-[1]"
          style={{
            filter: "blur(65px)",
            mixBlendMode: "screen",
            background:
              step === 3
                ? "radial-gradient(circle, rgba(16, 185, 129, 0.25) 0%, rgba(0,0,0,0) 70%)"
                : "radial-gradient(circle, rgba(244, 63, 94, 0.35) 0%, rgba(0,0,0,0) 70%)",
            bottom: "-30px",
            right: "-30px",
            animation: "float-glow 8s infinite alternate ease-in-out",
            transform:
              step === 2 ? "scale(1.25) translate(-15px, -15px)" : undefined,
            transition: "transform 0.6s var(--cubic), background 0.6s",
          }}
        />
        <div
          className="absolute w-[240px] h-[240px] rounded-full pointer-events-none opacity-75 z-[1]"
          style={{
            filter: "blur(65px)",
            mixBlendMode: "screen",
            background:
              step === 3
                ? "radial-gradient(circle, rgba(6, 182, 212, 0.2) 0%, rgba(0,0,0,0) 70%)"
                : "radial-gradient(circle, rgba(99, 102, 241, 0.3) 0%, rgba(0,0,0,0) 70%)",
            top: "-30px",
            left: "-30px",
            animation: "float-glow 10s infinite alternate-reverse ease-in-out",
            transform:
              step === 2 ? "scale(1.25) translate(15px, 15px)" : undefined,
            transition: "transform 0.6s var(--cubic), background 0.6s",
          }}
        />

        {/* 水晶磨砂悬浮卡片 */}
        <div className="relative w-full h-full z-10">
          <div
            className="absolute inset-0 rounded-2xl overflow-hidden"
            style={{
              backgroundColor: "#0F172B",
            }}
          >
            {/* 动态极光光效 */}
            <div
              className="absolute w-[280px] h-[280px] rounded-full"
              style={{
                background:
                  "radial-gradient(circle, rgba(244, 63, 94, 0.6) 0%, rgba(0,0,0,0) 70%)",
                bottom: "-60px",
                right: "-40px",
                filter: "blur(60px)",
                animation: "aurora-drift-1 6s infinite ease-in-out",
              }}
            />
            <div
              className="absolute w-[250px] h-[250px] rounded-full"
              style={{
                background:
                  "radial-gradient(circle, rgba(99, 102, 241, 0.5) 0%, rgba(0,0,0,0) 70%)",
                top: "-50px",
                left: "-40px",
                filter: "blur(60px)",
                animation: "aurora-drift-2 7s infinite ease-in-out",
              }}
            />
            <div
              className="absolute w-[180px] h-[180px] rounded-full"
              style={{
                background:
                  "radial-gradient(circle, rgba(6, 182, 212, 0.45) 0%, rgba(0,0,0,0) 70%)",
                top: "50%",
                left: "50%",
                filter: "blur(50px)",
                animation: "aurora-drift-3 8s infinite ease-in-out",
              }}
            />
          </div>
          <div
            className="glass-draggable relative w-full h-full rounded-2xl px-6 pt-8 pb-6 flex flex-col justify-between z-10 installer-card"
            style={{
              background: "rgba(255, 255, 255, 0.03)",
              backdropFilter: "blur(28px) saturate(140%)",
              WebkitBackdropFilter: "blur(28px) saturate(140%)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              boxShadow: "0 15px 35px rgba(0, 0, 0, 0.4)",
            }}
          >
            {/* 头部 */}
            <div
              className="flex justify-between items-center z-[25]"
              data-tauri-drag-region
            >
              <div className="flex items-center gap-2" data-tauri-drag-region>
                <img src={logo} alt="Logo" className="w-6 h-6" />
                <div
                  className="text-[13px] font-bold text-white"
                  data-tauri-drag-region
                >
                  {cfg?.app_display_name ?? cfg?.app_name ?? ""}
                </div>
              </div>
              <button
                onClick={() => appWindow.close()}
                className="w-[18px] h-[18px] rounded-full flex justify-center items-center cursor-pointer border-none text-[11px] -mt-[1px] transition-colors duration-200"
                style={{
                  background: "rgba(255, 255, 255, 0.08)",
                  color: "var(--text-muted)",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "rgba(244, 63, 94, 0.2)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background =
                    "rgba(255, 255, 255, 0.08)")
                }
              >
                x
              </button>
            </div>

            {/* 主交互视窗 */}
            <div className="relative flex-grow my-5 flex items-center justify-center">
              <AnimatePresence mode="wait">
                {/* 步骤 1：主界面 */}
                {step === 1 && (
                  <motion.div
                    key="s1"
                    initial={{ opacity: 0, scale: 0.95, filter: "blur(10px)" }}
                    animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                    exit={{
                      opacity: 0,
                      scale: 0.82,
                      y: 36,
                      filter: "blur(20px)",
                    }}
                    transition={{ duration: 0.45, ease: [0.7, 0, 0.84, 0] }}
                    className="w-full flex flex-col items-center text-center"
                  >
                    {/* 镜像声谱 */}
                    <div className="flex flex-col gap-1 items-center mb-6">
                      <div className="flex gap-[3px] items-end h-[30px]">
                        {[
                          { h: 28, c: "#ff0055", d: 0.1 },
                          { h: 22, c: "#ff0055", d: 0.3 },
                          { h: 14, c: "#7b00ff", d: 0.5 },
                          { h: 14, c: "#7b00ff", d: 0.2 },
                          { h: 22, c: "#ff0055", d: 0.4 },
                          { h: 28, c: "#ff0055", d: 0.6 },
                        ].map((b, i) => (
                          <div
                            key={i}
                            className="w-[5px] rounded-[2px]"
                            style={
                              {
                                height: b.h + "px",
                                background: b.c,
                                animation:
                                  "w6Jump 1.2s ease-in-out infinite alternate",
                                animationDelay: b.d + "s",
                                "--max-h": b.h + "px",
                              } as React.CSSProperties
                            }
                          />
                        ))}
                      </div>
                      <div className="flex gap-[3px] items-end h-[30px] -scale-y-100 opacity-60">
                        {[
                          { h: 28, c: "#ff0055", d: 0.1 },
                          { h: 22, c: "#ff0055", d: 0.3 },
                          { h: 14, c: "#7b00ff", d: 0.5 },
                          { h: 14, c: "#7b00ff", d: 0.2 },
                          { h: 22, c: "#ff0055", d: 0.4 },
                          { h: 28, c: "#ff0055", d: 0.6 },
                        ].map((b, i) => (
                          <div
                            key={i}
                            className="w-[5px] rounded-[2px]"
                            style={
                              {
                                height: b.h + "px",
                                background: b.c,
                                animation:
                                  "w6Jump 1.2s ease-in-out infinite alternate",
                                animationDelay: b.d + "s",
                                "--max-h": b.h + "px",
                              } as React.CSSProperties
                            }
                          />
                        ))}
                      </div>
                    </div>
                    <motion.h1
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.15, duration: 0.5, ease: [0.16,1,0.3,1] }}
                      className="text-[20px] font-bold mb-2"
                      style={{
                        color: "var(--text-primary)",
                      }}
                    >
                      部署极清系统
                    </motion.h1>
                    <motion.p
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.25, duration: 0.5, ease: [0.16,1,0.3,1] }}
                      className="text-[11px] leading-[1.6] mb-6"
                      style={{
                        color: "var(--text-muted)",
                      }}
                    >
                      次世代 8K
                      极速渲染通道及多轨并发下载管理器即将配置于您的电脑。
                    </motion.p>
                    {/* 配置插槽 */}
                    <motion.div
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.35, duration: 0.5, ease: [0.16,1,0.3,1] }}
                      whileHover={{ scale: 1.015 }}
                      className="path-slot w-full rounded-xl px-[14px] py-[10px] flex justify-between items-center cursor-pointer"
                      style={{
                        background: "rgba(255, 255, 255, 0.02)",
                        border: "1px solid rgba(255, 255, 255, 0.05)",
                        transition: "border-color 0.3s, background 0.3s, box-shadow 0.3s",
                      }}
                      onClick={handleSelectPath}
                    >
                      <span
                        className="font-mono text-[11px] truncate text-left"
                        style={{
                          color: "var(--text-primary)",
                        }}
                        title={installPath}
                      >
                        {installPath}
                      </span>
                      <button
                        className="bg-transparent border-none text-[10px] cursor-pointer whitespace-nowrap ml-2 transition-colors duration-200"
                        style={{
                          color: "var(--text-muted)",
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.color = "var(--app-coral)")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.color = "var(--text-muted)")
                        }
                      >
                        更换
                      </button>
                    </motion.div>
                  </motion.div>
                )}

                {/* 步骤 2：安装中 */}
                {step === 2 && (
                  <motion.div
                    key="s2"
                    initial={{
                      opacity: 0,
                      scale: 1.12,
                      y: -18,
                      filter: "blur(18px)",
                    }}
                    animate={{
                      opacity: 1,
                      scale: 1,
                      y: 0,
                      filter: "blur(0px)",
                    }}
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                    exit={{ opacity: 0, scale: 0.92, filter: "blur(14px)" }}
                    className="w-full flex flex-col items-center text-center relative h-full justify-center py-2"
                  >
                    {/* 环境光效 */}
                    <>
                        <div
                          className="absolute w-[3px] h-[3px] rounded-full pointer-events-none"
                          style={{
                            background: "#f43f5e",
                            boxShadow: "0 0 8px #f43f5e",
                            bottom: "10%",
                            left: "15%",
                            animation: "floatUp1 4s infinite ease-in-out",
                            animationDelay: "0s",
                          }}
                        />
                        <div
                          className="absolute w-[3px] h-[3px] rounded-full pointer-events-none"
                          style={{
                            background: "#f43f5e",
                            boxShadow: "0 0 8px #f43f5e",
                            bottom: "10%",
                            left: "35%",
                            animation: "floatUp2 5s infinite ease-in-out",
                            animationDelay: "1s",
                          }}
                        />
                        <div
                          className="absolute w-[3px] h-[3px] rounded-full pointer-events-none"
                          style={{
                            background: "#f43f5e",
                            boxShadow: "0 0 8px #f43f5e",
                            bottom: "10%",
                            right: "30%",
                            animation: "floatUp1 4.5s infinite ease-in-out",
                            animationDelay: "2s",
                          }}
                        />
                        <div
                          className="absolute w-[3px] h-[3px] rounded-full pointer-events-none"
                          style={{
                            background: "#f43f5e",
                            boxShadow: "0 0 8px #f43f5e",
                            bottom: "10%",
                            right: "15%",
                            animation: "floatUp2 3.5s infinite ease-in-out",
                            animationDelay: "0.5s",
                          }}
                        />
                      </>

                    {/* 声波涟漪播放徽章 */}
                    <motion.div
                      initial={{ opacity: 0, scale: 0.6, y: 10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      transition={{ delay: 0.2, duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                      className="relative w-[76px] h-[76px] flex items-center justify-center mb-8"
                    >
                      <div
                        className="absolute inset-0 rounded-full"
                        style={{
                          border: "1px solid rgba(244, 63, 94, 0.4)",
                          animation: "ripple 2s infinite ease-out",
                        }}
                      />
                      <div
                        className="absolute inset-0 rounded-full"
                        style={{
                          border: "1px solid rgba(244, 63, 94, 0.3)",
                          animation: "ripple 2s infinite ease-out 0.7s",
                        }}
                      />
                      <div
                        className="absolute inset-0 rounded-full"
                        style={{
                          border: "1px solid rgba(244, 63, 94, 0.2)",
                          animation: "ripple 2s infinite ease-out 1.4s",
                        }}
                      />
                      {/* 中心反应堆核心 */}
                      <div
                        className="w-[76px] h-[76px] rounded-full flex items-center justify-center relative z-[2]"
                        style={{
                          border: "1px solid rgba(244,63,94,0.25)",
                          background:
                            "radial-gradient(circle at 50% 50%, rgba(244,63,94,0.18) 0%, rgba(244,63,94,0.04) 60%, transparent 100%)",
                          boxShadow:
                            "inset 0 0 18px rgba(244,63,94,0.18), 0 0 24px rgba(244,63,94,0.15)",
                        }}
                      >
                        {/* 外弧 顺时针 */}
                        <svg
                          width="60"
                          height="60"
                          viewBox="0 0 60 60"
                          className="absolute"
                          style={{ animation: "spinSlow 3.2s linear infinite" }}
                        >
                          <path
                            d="M30 4 A26 26 0 0 1 56 30"
                            fill="none"
                            stroke="#f43f5e"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            style={{
                              filter: "drop-shadow(0 0 4px #f43f5e)",
                            }}
                          />
                          <path
                            d="M30 56 A26 26 0 0 1 4 30"
                            fill="none"
                            stroke="rgba(244,63,94,0.4)"
                            strokeWidth="1.2"
                            strokeLinecap="round"
                          />
                        </svg>
                        {/* 内弧 逆时针 */}
                        <svg
                          width="44"
                          height="44"
                          viewBox="0 0 44 44"
                          className="absolute"
                          style={{
                            animation: "spinReverse 2.2s linear infinite",
                          }}
                        >
                          <path
                            d="M22 4 A18 18 0 0 0 4 22"
                            fill="none"
                            stroke="#ff6b8a"
                            strokeWidth="1.4"
                            strokeLinecap="round"
                            style={{
                              filter: "drop-shadow(0 0 3px #ff6b8a)",
                            }}
                          />
                          <path
                            d="M22 40 A18 18 0 0 0 40 22"
                            fill="none"
                            stroke="rgba(255,107,138,0.35)"
                            strokeWidth="1"
                            strokeLinecap="round"
                          />
                        </svg>
                        {/* 中心呼吸核心 */}
                        <div
                          className="w-[12px] h-[12px] rounded-full"
                          style={{
                            background:
                              "radial-gradient(circle, #fff 0%, #f43f5e 70%)",
                            boxShadow:
                              "0 0 10px #f43f5e, 0 0 22px rgba(244,63,94,0.7)",
                            animation: "corePulse 1.4s ease-in-out infinite",
                          }}
                        />
                      </div>
                    </motion.div>

                    {/* 超大百分比数字 */}
                    <motion.div
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.32, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                      className="mb-4"
                    >
                      <motion.div
                        key={Math.floor(progress / 5)}
                        initial={{ opacity: 0.4, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3 }}
                        className="text-[48px] font-extralight leading-none"
                        style={{
                          color: "var(--text-primary)",
                          textShadow: `0 0 ${8 + progress * 0.3}px rgba(244,63,94,${0.2 + progress * 0.004})`,
                        }}
                      >
                        {progress}%
                      </motion.div>
                    </motion.div>

                    {/* 状态文案 */}
                    <motion.div
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.42, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                      className="mb-8"
                    >
                      <AnimatePresence mode="wait">
                        <motion.div
                          key={getStatusText()}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          transition={{ duration: 0.35 }}
                          className="text-[11px]"
                          style={{ color: "#7a8195" }}
                        >
                          {getStatusText()}
                        </motion.div>
                      </AnimatePresence>
                    </motion.div>

                    {/* 15根频谱 */}
                    <motion.div
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.5, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                      className="flex gap-[3px] items-end h-[36px] mb-4"
                    >
                      {delays.map((d, i) => (
                        <div
                          key={i}
                          className="w-[3px] h-[36px] rounded-[1.5px]"
                          style={{
                            background:
                              "linear-gradient(to top, rgba(244,63,94,0.15), #f43f5e)",
                            transformOrigin: "bottom",
                            animation:
                              "bounceSpectrum 0.6s ease-in-out infinite",
                            animationDelay: d + "s",
                          }}
                        />
                      ))}
                    </motion.div>
                  </motion.div>
                )}

                {/* 步骤 3：完毕就绪 — 全新成功页 */}
                {step === 3 && (
                  <motion.div
                    key="s3"
                    initial={{ opacity: 0, scale: 0.94 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                    className="w-full flex flex-col items-center text-center relative h-full justify-between py-3"
                  >
                    {/* 顶部：成功徽章 */}
                    <div className="relative flex flex-col items-center pt-4">
                      {/* 粒子爆发 */}
                      {Array.from({ length: 12 }).map((_, i) => {
                        const angle = (i / 12) * Math.PI * 2;
                        const dx = Math.cos(angle) * 70;
                        const dy = Math.sin(angle) * 70;
                        return (
                          <motion.span
                            key={i}
                            initial={{ x: 0, y: 0, opacity: 0, scale: 0 }}
                            animate={{
                              x: dx,
                              y: dy,
                              opacity: [0, 1, 0],
                              scale: [0, 1, 0.4],
                            }}
                            transition={{
                              duration: 1.4,
                              delay: 0.15 + i * 0.02,
                              ease: "easeOut",
                            }}
                            className="absolute left-1/2 w-[4px] h-[4px] rounded-full pointer-events-none"
                            style={{
                              // 父级 pt-4 (16px) + 徽章容器 110×110 的中心 55 = 71px；粒子 4×4 → 减 2 = 69
                              top: "69px",
                              marginLeft: "-2px",
                              background:
                                i % 3 === 0
                                  ? "#10b981"
                                  : i % 3 === 1
                                    ? "#06b6d4"
                                    : "#a3e635",
                              boxShadow: `0 0 8px ${i % 2 === 0 ? "#10b981" : "#06b6d4"}`,
                            }}
                          />
                        );
                      })}

                      {/* 徽章 + 光环 包裹容器 */}
                      <div className="relative w-[110px] h-[110px] flex items-center justify-center">
                        {/* 旋转 conic 光环 */}
                        <div
                          className="absolute inset-0 rounded-full opacity-70 pointer-events-none"
                          style={{
                            background:
                              "conic-gradient(from 0deg, transparent 0deg, #10b981 90deg, transparent 180deg, #06b6d4 270deg, transparent 360deg)",
                            animation: "spinSlow 6s linear infinite",
                            filter: "blur(8px)",
                            maskImage:
                              "radial-gradient(circle, transparent 38%, black 42%, black 58%, transparent 62%)",
                            WebkitMaskImage:
                              "radial-gradient(circle, transparent 38%, black 42%, black 58%, transparent 62%)",
                          }}
                        />

                      {/* 中心圆盘 */}
                      <motion.div
                        initial={{ scale: 0.4, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{
                          delay: 0.1,
                          duration: 0.6,
                          ease: [0.16, 1, 0.3, 1],
                        }}
                        className="relative w-[84px] h-[84px] rounded-full flex items-center justify-center"
                        style={{
                          background:
                            "radial-gradient(circle at 30% 30%, rgba(16,185,129,0.35), rgba(6,182,212,0.15) 60%, rgba(15,23,43,0.4))",
                          border: "1px solid rgba(16,185,129,0.45)",
                          boxShadow:
                            "0 0 30px rgba(16,185,129,0.35), inset 0 0 20px rgba(16,185,129,0.15)",
                        }}
                      >
                        <svg width="38" height="38" viewBox="0 0 52 52">
                          <motion.circle
                            cx="26"
                            cy="26"
                            r="22"
                            fill="none"
                            stroke="rgba(16,185,129,0.5)"
                            strokeWidth="1.5"
                            initial={{ pathLength: 0 }}
                            animate={{ pathLength: 1 }}
                            transition={{
                              duration: 0.7,
                              delay: 0.2,
                              ease: "easeOut",
                            }}
                          />
                          <motion.path
                            d="M14 27 L23 36 L39 18"
                            fill="none"
                            stroke="#10b981"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            initial={{ pathLength: 0 }}
                            animate={{ pathLength: 1 }}
                            transition={{
                              duration: 0.5,
                              delay: 0.55,
                              ease: [0.16, 1, 0.3, 1],
                            }}
                            style={{
                              filter:
                                "drop-shadow(0 0 6px rgba(16,185,129,0.8))",
                            }}
                          />
                        </svg>
                      </motion.div>
                      </div>

                      {/* 标题 */}
                      <motion.h2
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.65, duration: 0.5 }}
                        className="text-[19px] font-bold mt-8"
                        style={{
                          background:
                            "linear-gradient(135deg, #ffffff, #a7f3d0)",
                          WebkitBackgroundClip: "text",
                          WebkitTextFillColor: "transparent",
                          backgroundClip: "text",
                          letterSpacing: "2px",
                        }}
                      >
                        影音盛宴已就绪
                      </motion.h2>
                      <motion.p
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.78, duration: 0.5 }}
                        className="text-[11px] mt-3"
                        style={{ color: "rgba(255,255,255,0.45)" }}
                      >
                        8K 解码核心已校准，多轨通道已激活
                      </motion.p>

                      {/* 特性胶囊 */}
                      <div className="flex gap-2 mt-7 flex-wrap justify-center">
                        {[
                          { t: "8K 极清", c: "#10b981" },
                          { t: "多轨并发", c: "#06b6d4" },
                          { t: "GPU 渲染", c: "#a78bfa" },
                        ].map((p, i) => (
                          <motion.span
                            key={p.t}
                            initial={{ opacity: 0, y: 10, scale: 0.8 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            transition={{
                              delay: 0.9 + i * 0.1,
                              duration: 0.45,
                              ease: [0.16, 1, 0.3, 1],
                            }}
                            className="text-[10px] px-2.5 py-1 rounded-full"
                            style={{
                              background: `${p.c}1f`,
                              border: `1px solid ${p.c}55`,
                              color: "rgba(255,255,255,0.85)",
                              letterSpacing: "1px",
                            }}
                          >
                            {p.t}
                          </motion.span>
                        ))}
                      </div>
                    </div>

                    {/* 启动按钮 */}
                    <motion.div
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 1.25, duration: 0.55 }}
                      className="w-full mt-4"
                    >
                      <button
                        onClick={handleLaunch}
                        className="shimmer-btn relative w-full h-[42px] border-none rounded-[21px] text-white text-[12px] font-bold tracking-[3px] cursor-pointer overflow-hidden"
                        style={{
                          background:
                            "linear-gradient(135deg, #10b981 0%, #06b6d4 100%)",
                          boxShadow:
                            "0 6px 20px rgba(16,185,129,0.35), inset 0 1px 0 rgba(255,255,255,0.2)",
                          transition: "transform 0.25s var(--cubic), box-shadow 0.25s var(--cubic)",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = "translateY(-2px)";
                          e.currentTarget.style.boxShadow =
                            "0 10px 28px rgba(16,185,129,0.5), inset 0 1px 0 rgba(255,255,255,0.25)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = "translateY(0)";
                          e.currentTarget.style.boxShadow =
                            "0 6px 20px rgba(16,185,129,0.35), inset 0 1px 0 rgba(255,255,255,0.2)";
                        }}
                      >
                        <span className="relative z-10">开启影音盛宴</span>
                      </button>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* 底部操作区 - 步骤1显示，步骤2/3隐藏 */}
            <div
              className={`w-full flex flex-col gap-4 z-[25] transition-all ${step === 1 ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 translate-y-[10px] pointer-events-none"}`}
              style={{
                transition:
                  "opacity 0.4s var(--cubic), transform 0.4s var(--cubic)",
              }}
            >
              <button
                onClick={startInstall}
                className="shimmer-btn relative overflow-hidden w-full h-[40px] border-none rounded-[20px] text-white text-[12px] font-bold tracking-[2px] cursor-pointer transition-all duration-[250ms]"
                style={{
                  backgroundColor: "var(--app-coral)",
                  boxShadow: "0 2px 6px rgba(244, 63, 94, 0.15)",
                  transitionTimingFunction: "var(--cubic)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor =
                    "var(--app-coral-hover)";
                  e.currentTarget.style.transform = "translateY(-1px)";
                  e.currentTarget.style.boxShadow =
                    "0 2px 6px rgba(244, 63, 94, 0.2)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--app-coral)";
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow =
                    "0 2px 6px rgba(244, 63, 94, 0.15)";
                }}
              >
                开始部署
              </button>
              <div
                className="text-[10px] text-center"
                style={{
                  color: "var(--text-muted)",
                }}
              >
                我已同意并接受{" "}
                <a
                  href="#"
                  className="border-b border-white/10"
                  style={{
                    color: "var(--text-primary)",
                    textDecoration: "none",
                  }}
                >
                  《许可协议及隐私条款》
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
