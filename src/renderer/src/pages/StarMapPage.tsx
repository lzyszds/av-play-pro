import React, { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "../lib/trpc";
import { PageLoader } from "../components/PageLoader";
import { Tooltip } from "../components/common/Tooltip";
import {
  Network,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Search,
  Sparkles,
  Layers,
} from "lucide-react";

interface Props {
  videoPath: string;
  onAddSystemLog: (
    text: string,
    level: "INFO" | "WARNING" | "SUCCESS" | "ERROR",
  ) => void;
}

interface GraphNode {
  id: string;
  label: string;
  type: "actor" | "series" | "studio" | "genre" | "video";
  count: number;
  x: number;
  y: number;
  r: number;
  color: string;
}

interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

const TYPE_COLORS: Record<string, string> = {
  actor: "#f43f5e",
  series: "#38bdf8",
  studio: "#10b981",
  genre: "#fbbf24",
  video: "#a855f7",
};

const TYPE_LABELS: Record<string, string> = {
  actor: "演员",
  series: "系列",
  studio: "厂商",
  genre: "分类",
  video: "影片",
};

export function StarMapPage({ videoPath, onAddSystemLog }: Props) {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isNebulaMode, setIsNebulaMode] = useState(true);

  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // B127: 深空星尘粒子动画背景
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    const stars: Array<{
      x: number;
      y: number;
      r: number;
      alpha: number;
      speedAlpha: number;
      vx: number;
      vy: number;
    }> = [];

    const resize = () => {
      canvas.width = canvas.parentElement?.clientWidth || 1200;
      canvas.height = canvas.parentElement?.clientHeight || 900;
    };
    resize();
    window.addEventListener("resize", resize);

    for (let i = 0; i < 110; i++) {
      stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.5 + 0.5,
        alpha: Math.random() * 0.7 + 0.2,
        speedAlpha: (Math.random() * 0.02 + 0.005) * (Math.random() > 0.5 ? 1 : -1),
        vx: (Math.random() - 0.5) * 0.15,
        vy: (Math.random() - 0.5) * 0.15,
      });
    }

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const s of stars) {
        s.alpha += s.speedAlpha;
        if (s.alpha > 0.85 || s.alpha < 0.15) s.speedAlpha = -s.speedAlpha;
        s.x += s.vx;
        s.y += s.vy;
        if (s.x < 0) s.x = canvas.width;
        if (s.x > canvas.width) s.x = 0;
        if (s.y < 0) s.y = canvas.height;
        if (s.y > canvas.height) s.y = 0;

        ctx.fillStyle = `rgba(255, 255, 255, ${s.alpha})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      animId = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  // B127: 力导向物理迭代仿真算法
  const runForceSimulation = (initialNodes: GraphNode[], initialEdges: GraphEdge[]) => {
    const W = 1200;
    const H = 900;
    const cx = W / 2;
    const cy = H / 2;
    const nodeMap = new Map(initialNodes.map((n) => [n.id, { ...n, vx: 0, vy: 0 }]));
    const simulatedNodes = Array.from(nodeMap.values());

    for (let iter = 0; iter < 42; iter++) {
      // 1. 节点间库仑斥力
      for (let i = 0; i < simulatedNodes.length; i++) {
        const n1 = simulatedNodes[i];
        for (let j = i + 1; j < simulatedNodes.length; j++) {
          const n2 = simulatedNodes[j];
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const distSq = dx * dx + dy * dy + 64;
          const dist = Math.sqrt(distSq);
          if (dist < 320) {
            const force = 1600 / distSq;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            n1.vx -= fx;
            n1.vy -= fy;
            n2.vx += fx;
            n2.vy += fy;
          }
        }
      }

      // 2. 连线弹性引力
      for (const edge of initialEdges) {
        const n1 = nodeMap.get(edge.source);
        const n2 = nodeMap.get(edge.target);
        if (n1 && n2) {
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const springForce = (dist - 80) * 0.035;
          const fx = (dx / dist) * springForce;
          const fy = (dy / dist) * springForce;
          n1.vx += fx;
          n1.vy += fy;
          n2.vx -= fx;
          n2.vy -= fy;
        }
      }

      // 3. 施加中心吸引与阻尼更新
      for (const n of simulatedNodes) {
        n.vx += (cx - n.x) * 0.007;
        n.vy += (cy - n.y) * 0.007;
        n.x += n.vx * 0.65;
        n.y += n.vy * 0.65;
        n.vx *= 0.58;
        n.vy *= 0.58;
      }
    }

    return simulatedNodes.map(({ vx, vy, ...rest }) => rest);
  };

  useEffect(() => {
    if (!videoPath) return;
    setLoading(true);
    (async () => {
      try {
        const raw: any[] = await trpc.videos.list.query({ path: videoPath });
        const actorMap = new Map<string, { count: number; videos: Set<string> }>();
        const seriesMap = new Map<string, { count: number; videos: Set<string> }>();
        const studioMap = new Map<string, { count: number; videos: Set<string> }>();
        const genreMap = new Map<string, { count: number; videos: Set<string> }>();
        const videoNodes: GraphNode[] = [];

        for (const v of raw) {
          videoNodes.push({
            id: `video:${v.id}`,
            label: v.name,
            type: "video",
            count: 1,
            x: 0,
            y: 0,
            r: 5,
            color: TYPE_COLORS.video,
          });
          if (v.actors) {
            for (const a of v.actors) {
              const entry = actorMap.get(a) || { count: 0, videos: new Set() };
              entry.count++;
              entry.videos.add(v.id);
              actorMap.set(a, entry);
            }
          }
          if (v.studioSeries || v.code) {
            const s = v.studioSeries || v.code?.replace(/\d+$/, "") || "未知";
            const entry = seriesMap.get(s) || { count: 0, videos: new Set() };
            entry.count++;
            entry.videos.add(v.id);
            seriesMap.set(s, entry);
          }
          if (v.studio) {
            const entry = studioMap.get(v.studio) || { count: 0, videos: new Set() };
            entry.count++;
            entry.videos.add(v.id);
            studioMap.set(v.studio, entry);
          }
          if (v.genres) {
            for (const g of v.genres) {
              const entry = genreMap.get(g) || { count: 0, videos: new Set() };
              entry.count++;
              entry.videos.add(v.id);
              genreMap.set(g, entry);
            }
          }
        }

        const allNodes: GraphNode[] = [...videoNodes];
        const allEdges: GraphEdge[] = [];

        const addEntityNodes = (
          map: Map<string, { count: number; videos: Set<string> }>,
          type: GraphNode["type"],
        ) => {
          const sorted = [...map.entries()]
            .filter(([, v]) => v.count >= 2)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 30);
          for (const [name, data] of sorted) {
            allNodes.push({
              id: `${type}:${name}`,
              label: name,
              type,
              count: data.count,
              x: 0,
              y: 0,
              r: Math.min(8 + data.count * 2.2, 36),
              color: TYPE_COLORS[type],
            });
            for (const vid of data.videos) {
              allEdges.push({ source: `${type}:${name}`, target: `video:${vid}`, weight: 1 });
            }
          }
        };

        addEntityNodes(actorMap, "actor");
        addEntityNodes(seriesMap, "series");
        addEntityNodes(studioMap, "studio");
        addEntityNodes(genreMap, "genre");

        const W = 1200, H = 900, cx = W / 2, cy = H / 2;
        const typeGroups: Record<string, GraphNode[]> = {};
        for (const n of allNodes) {
          if (!typeGroups[n.type]) typeGroups[n.type] = [];
          typeGroups[n.type].push(n);
        }
        const typeKeys = Object.keys(typeGroups);
        const angleStep = (2 * Math.PI) / (typeKeys.length || 1);

        typeKeys.forEach((type, ti) => {
          const group = typeGroups[type];
          const baseAngle = ti * angleStep;
          const groupRadius = 220 + ti * 25;
          const gcx = cx + Math.cos(baseAngle) * groupRadius;
          const gcy = cy + Math.sin(baseAngle) * groupRadius;
          group.forEach((node, ni) => {
            const spreadRadius = 35 + group.length * 1.6;
            const a = (ni / group.length) * 2 * Math.PI;
            node.x = gcx + Math.cos(a) * spreadRadius + (Math.random() - 0.5) * 25;
            node.y = gcy + Math.sin(a) * spreadRadius + (Math.random() - 0.5) * 25;
          });
        });

        // 运行力导向松弛仿真
        const relaxedNodes = runForceSimulation(allNodes, allEdges);

        setNodes(relaxedNodes);
        setEdges(allEdges);
        onAddSystemLog(
          `星图加载完成：${relaxedNodes.length} 节点，${allEdges.length} 条引力连线`,
          "SUCCESS",
        );
      } catch (err: any) {
        onAddSystemLog(`星图加载失败: ${err?.message}`, "ERROR");
      } finally {
        setLoading(false);
      }
    })();
  }, [videoPath]);

  const filteredNodes = useMemo(() => {
    let list = nodes;
    if (selectedType !== "all") list = list.filter((n) => n.type === selectedType);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((n) => n.label.toLowerCase().includes(q));
    }
    return list;
  }, [nodes, selectedType, searchQuery]);

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map((n) => n.id)), [filteredNodes]);
  const filteredEdges = useMemo(
    () => edges.filter((e) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target)),
    [edges, filteredNodeIds],
  );

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.min(5, Math.max(0.2, z * delta)));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target === svgRef.current || (e.target as SVGElement).tagName === "svg") {
      setDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (dragging) setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => setDragging(false);
  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  return (
    <div className="relative h-full flex flex-col bg-[#080a10] select-none overflow-hidden">
      <PageLoader active={loading} label="正在构筑力导向星系图谱…" />

      {/* 顶部控制栏 */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md shrink-0 z-10">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-rose-500/20 text-rose-400 border border-rose-500/30 shadow-xs">
            <Network className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <span>全景 StarMap 流光星系图谱</span>
              {isNebulaMode && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/30">
                  星尘引力仿真
                </span>
              )}
            </h2>
            <p className="text-[11px] text-slate-400">
              {nodes.length} 个天体恒星 · {edges.length} 条共演羁绊光索
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 星系模式切换 */}
          <button
            type="button"
            onClick={() => setIsNebulaMode(!isNebulaMode)}
            className={`h-7 px-2.5 rounded-md text-[11px] font-medium border flex items-center gap-1.5 transition cursor-pointer ${
              isNebulaMode
                ? "bg-rose-500/20 text-rose-300 border-rose-500/40 shadow-xs"
                : "bg-slate-800 text-slate-400 border-slate-700 hover:text-white"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{isNebulaMode ? "深空流光星系" : "经典网格"}</span>
          </button>

          <div className="relative">
            <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="搜索女优/系列/影片..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-7 w-44 pl-8 pr-3 rounded-md bg-slate-800/80 border border-slate-700 text-[11px] text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-rose-500"
            />
          </div>

          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="h-7 px-2.5 rounded-md bg-slate-800/80 border border-slate-700 text-[11px] text-slate-200 focus:outline-none focus:border-rose-500 cursor-pointer"
          >
            <option value="all">全部天体类型</option>
            {Object.entries(TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>

          <Tooltip content="放大星图 (Zoom In)" placement="bottom">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(5, z * 1.2))}
              aria-label="放大星图"
              className="w-7 h-7 flex items-center justify-center rounded bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition cursor-pointer"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </Tooltip>

          <Tooltip content="缩小星图 (Zoom Out)" placement="bottom">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.2, z * 0.8))}
              aria-label="缩小星图"
              className="w-7 h-7 flex items-center justify-center rounded bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition cursor-pointer"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
          </Tooltip>

          <Tooltip content="重置视角 (居中还原)" placement="bottom">
            <button
              type="button"
              onClick={resetView}
              aria-label="重置视角"
              className="w-7 h-7 flex items-center justify-center rounded bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* 星系画布区域 */}
      <div
        className="flex-1 overflow-hidden relative"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: dragging ? "grabbing" : "grab" }}
      >
        {/* 背景 Canvas 星尘层 */}
        {isNebulaMode && (
          <canvas
            ref={canvasRef}
            className="absolute inset-0 pointer-events-none opacity-80"
          />
        )}

        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox="0 0 1200 900"
          preserveAspectRatio="xMidYMid meet"
          className="relative z-1"
        >
          <defs>
            {/* 各天体类型的放射状辉光滤镜 */}
            {Object.entries(TYPE_COLORS).map(([type, color]) => (
              <radialGradient
                key={`grad-${type}`}
                id={`starmap-halo-${type}`}
                cx="50%"
                cy="50%"
                r="50%"
              >
                <stop offset="0%" stopColor={color} stopOpacity="0.8" />
                <stop offset="40%" stopColor={color} stopOpacity="0.25" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </radialGradient>
            ))}
          </defs>

          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {/* 引力光索连线 */}
            {filteredEdges.map((edge, i) => {
              const sn = nodes.find((n) => n.id === edge.source);
              const tn = nodes.find((n) => n.id === edge.target);
              if (!sn || !tn) return null;
              const hl = hoveredNode === edge.source || hoveredNode === edge.target;
              return (
                <line
                  key={`e${i}`}
                  x1={sn.x}
                  y1={sn.y}
                  x2={tn.x}
                  y2={tn.y}
                  stroke={hl ? "#fbbf24" : sn.color}
                  strokeWidth={hl ? 2 : isNebulaMode ? 0.8 : 0.5}
                  strokeOpacity={hl ? 0.85 : isNebulaMode ? 0.25 : 0.15}
                  strokeDasharray={hl ? "5 3" : undefined}
                />
              );
            })}

            {/* 天体节点与辐射光环 */}
            {filteredNodes.map((node) => {
              const isHovered = hoveredNode === node.id;
              const haloRadius = isHovered ? node.r * 2.8 : node.r * 2.1;
              return (
                <g
                  key={node.id}
                  onMouseEnter={() => setHoveredNode(node.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  style={{ cursor: "pointer" }}
                >
                  {/* 星体外围引力发光晕圈 */}
                  {isNebulaMode && (
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={haloRadius}
                      fill={`url(#starmap-halo-${node.type})`}
                      pointerEvents="none"
                    />
                  )}

                  {/* 核心天体 */}
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={isHovered ? node.r * 1.35 : node.r}
                    fill={node.color}
                    fillOpacity={isHovered ? 1 : 0.8}
                    stroke="#ffffff"
                    strokeWidth={isHovered ? 2 : 0.6}
                    strokeOpacity={isHovered ? 0.9 : 0.4}
                    style={{ transition: "all 0.2s ease" }}
                  />

                  {/* 悬停信息浮窗 */}
                  {isHovered && (
                    <g>
                      <rect
                        x={node.x + node.r + 8}
                        y={node.y - 18}
                        width={Math.min(node.label.length * 8.5, 180) + 65}
                        height={46}
                        rx={8}
                        fill="rgba(10, 15, 29, 0.95)"
                        stroke={node.color}
                        strokeWidth={1.5}
                        className="shadow-xl backdrop-blur-md"
                      />
                      <text
                        x={node.x + node.r + 16}
                        y={node.y}
                        fill="white"
                        fontSize="12"
                        fontWeight="bold"
                      >
                        {node.label.length > 20
                          ? node.label.slice(0, 20) + "…"
                          : node.label}
                      </text>
                      <text
                        x={node.x + node.r + 16}
                        y={node.y + 18}
                        fill={node.color}
                        fontSize="10"
                        fontWeight="600"
                      >
                        ★ {TYPE_LABELS[node.type]} · 关联作品 {node.count} 部
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* 底部图例 */}
      <div className="flex items-center justify-between px-6 py-2 border-t border-slate-800/80 bg-slate-900/70 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-5">
          {Object.entries(TYPE_COLORS).map(([type, color]) => (
            <div key={type} className="flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full shadow-xs"
                style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
              />
              <span className="text-[10.5px] font-medium text-slate-300">
                {TYPE_LABELS[type]}
              </span>
            </div>
          ))}
        </div>
        <div className="text-[10px] text-slate-500 font-mono">
          滚轮缩放 · 拖拽平移 · 鼠标悬停聚焦引力弦
        </div>
      </div>
    </div>
  );
}
