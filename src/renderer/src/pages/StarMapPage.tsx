import React, { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "../lib/trpc";
import { PageLoader } from "../components/PageLoader";
import { Tooltip } from "../components/common/Tooltip";
import { Network, ZoomIn, ZoomOut, RotateCcw, Search } from "lucide-react";

interface Props {
  videoPath: string;
  onAddSystemLog: (text: string, level: "INFO" | "WARNING" | "SUCCESS" | "ERROR") => void;
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
  series: "#3b82f6",
  studio: "#10b981",
  genre: "#f59e0b",
  video: "#8b5cf6",
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
  const svgRef = useRef<SVGSVGElement>(null);

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
            r: 6,
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
              r: Math.min(8 + data.count * 2, 40),
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
        const angleStep = (2 * Math.PI) / typeKeys.length;

        typeKeys.forEach((type, ti) => {
          const group = typeGroups[type];
          const baseAngle = ti * angleStep;
          const groupRadius = 200 + ti * 30;
          const gcx = cx + Math.cos(baseAngle) * groupRadius;
          const gcy = cy + Math.sin(baseAngle) * groupRadius;
          group.forEach((node, ni) => {
            const spreadRadius = 40 + group.length * 1.5;
            const a = (ni / group.length) * 2 * Math.PI;
            node.x = gcx + Math.cos(a) * spreadRadius + (Math.random() - 0.5) * 20;
            node.y = gcy + Math.sin(a) * spreadRadius + (Math.random() - 0.5) * 20;
          });
        });

        setNodes(allNodes);
        setEdges(allEdges);
        onAddSystemLog(`星图加载完成：${allNodes.length} 节点，${allEdges.length} 连线`, "SUCCESS");
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
  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  return (
    <div className="h-full flex flex-col bg-[#0f172a] select-none">
      <PageLoader active={loading} label="构建星图" />
      <div className="flex items-center justify-between px-6 py-3 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          <Network className="w-5 h-5 text-rose-400" />
          <h2 className="text-sm font-bold text-slate-200">片库星图</h2>
          <span className="text-[10px] text-slate-500">{nodes.length} 节点 · {edges.length} 连线</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input type="text" placeholder="搜索节点..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="h-7 w-40 pl-8 pr-3 rounded-md bg-slate-800 border border-slate-700 text-[11px] text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-rose-500" />
          </div>
          <select value={selectedType} onChange={(e) => setSelectedType(e.target.value)} className="h-7 px-2 rounded-md bg-slate-800 border border-slate-700 text-[11px] text-slate-300 focus:outline-none focus:border-rose-500">
            <option value="all">全部类型</option>
            {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
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
      <div className="flex-1 overflow-hidden relative" onWheel={handleWheel} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp} style={{ cursor: dragging ? "grabbing" : "grab" }}>
        <svg ref={svgRef} width="100%" height="100%" viewBox="0 0 1200 900" preserveAspectRatio="xMidYMid meet">
          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {filteredEdges.map((edge, i) => {
              const sn = nodes.find((n) => n.id === edge.source);
              const tn = nodes.find((n) => n.id === edge.target);
              if (!sn || !tn) return null;
              const hl = hoveredNode === edge.source || hoveredNode === edge.target;
              return <line key={`e${i}`} x1={sn.x} y1={sn.y} x2={tn.x} y2={tn.y} stroke={hl ? sn.color : sn.color} strokeWidth={hl ? 1.5 : 0.5} opacity={hl ? 0.7 : 0.2} />;
            })}
            {filteredNodes.map((node) => {
              const isHovered = hoveredNode === node.id;
              return (
                <g key={node.id} onMouseEnter={() => setHoveredNode(node.id)} onMouseLeave={() => setHoveredNode(null)} style={{ cursor: "pointer" }}>
                  <circle cx={node.x} cy={node.y} r={isHovered ? node.r * 1.3 : node.r} fill={node.color} fillOpacity={isHovered ? 0.9 : 0.6} stroke={node.color} strokeWidth={isHovered ? 2 : 0.5} strokeOpacity={isHovered ? 1 : 0.5} style={{ transition: "all 0.2s ease" }} />
                  {isHovered && (
                    <g>
                      <rect x={node.x + node.r + 6} y={node.y - 12} width={Math.min(node.label.length * 8, 150) + 60} height={40} rx={6} fill="rgba(15,23,42,0.95)" stroke={node.color} strokeWidth={1} />
                      <text x={node.x + node.r + 14} y={node.y + 2} fill="white" fontSize="11" fontWeight="bold">{node.label.length > 18 ? node.label.slice(0, 18) + "…" : node.label}</text>
                      <text x={node.x + node.r + 14} y={node.y + 16} fill={node.color} fontSize="9">{TYPE_LABELS[node.type]} · {node.count} 部</text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      <div className="flex items-center gap-4 px-6 py-2 border-t border-slate-800 shrink-0">
        {Object.entries(TYPE_COLORS).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-[10px] text-slate-500">{TYPE_LABELS[type]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}