import React, { useEffect, useState } from "react";
import {
  X,
  Archive,
  Plus,
  KeyRound,
  Eye,
  EyeOff,
  RefreshCw,
  Trash2,
  RotateCcw,
  FileDiff,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Database,
  AlertTriangle,
  FolderArchive,
} from "lucide-react";
import { trpc } from "../../lib/trpc";
import { Tooltip } from "../common/Tooltip";

interface SnapshotFileInfo {
  key: string;
  label: string;
  file: string;
  bytes: number;
}

interface SnapshotMeta {
  id: string;
  name: string;
  createdAt: string;
  encrypted: boolean;
  source: string;
  note?: string;
  size: number;
  fileCount: number;
  files: SnapshotFileInfo[];
}

interface DiffItem {
  key: string;
  label: string;
  file: string;
  status: "equal" | "added" | "updated" | "removed";
  localBytes: number;
  snapshotBytes: number;
  localCount?: number;
  snapshotCount?: number;
  keySummary?: { added: number; removed: number; changed: number };
  addedKeys: string[];
  removedKeys: string[];
  changedKeys: string[];
}

const SOURCE_CONFIG: Record<string, { label: string; cls: string }> = {
  manual: {
    label: "手动创建",
    cls: "bg-sky-500/15 text-sky-600 dark:text-sky-300 border-sky-500/20",
  },
  "pre-push": {
    label: "推送前·云端",
    cls: "bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/20",
  },
  "pre-pull": {
    label: "恢复前·本地",
    cls: "bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/20",
  },
};

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  equal: {
    label: "一致",
    cls: "text-slate-400 bg-slate-500/10 border-slate-500/20",
  },
  added: {
    label: "新增",
    cls: "text-emerald-600 dark:text-emerald-300 bg-emerald-500/15 border-emerald-500/20",
  },
  updated: {
    label: "有差异",
    cls: "text-amber-600 dark:text-amber-300 bg-amber-500/15 border-amber-500/20",
  },
  removed: {
    label: "已删除",
    cls: "text-rose-600 dark:text-rose-300 bg-rose-500/15 border-rose-500/20",
  },
};

function formatBytes(n: number): string {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export interface SnapshotLibraryModalProps {
  onClose: () => void;
  onAddSystemLog: (
    text: string,
    level: "INFO" | "WARNING" | "SUCCESS" | "ERROR",
  ) => void;
}

export function SnapshotLibraryModal({
  onClose,
  onAddSystemLog,
}: SnapshotLibraryModalProps) {
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newNote, setNewNote] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [creatingSubmit, setCreatingSubmit] = useState(false);

  const [view, setView] = useState<"detail" | "diff">("detail");
  const [diffItems, setDiffItems] = useState<DiffItem[]>([]);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffPassword, setDiffPassword] = useState("");
  const [diffNeedPassword, setDiffNeedPassword] = useState(false);
  const [diffError, setDiffError] = useState("");

  const [restoring, setRestoring] = useState(false);

  const loadSnapshots = async (keepSelection?: string) => {
    setLoading(true);
    try {
      const res = await trpc.snapshot.list.query();
      setSnapshots(res.snapshots as SnapshotMeta[]);
      const target = keepSelection || res.snapshots[0]?.id || null;
      setSelectedId((prev) => {
        if (res.snapshots.some((s) => s.id === target)) return target;
        if (res.snapshots.some((s) => s.id === prev)) return prev;
        return res.snapshots[0]?.id || null;
      });
    } catch (err: any) {
      onAddSystemLog(`读取快照库失败: ${err?.message || err}`, "ERROR");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSnapshots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected =
    snapshots.find((s) => s.id === selectedId) || null;

  const openCreate = () => {
    setCreating(true);
    setNewName("");
    setNewPassword("");
    setNewNote("");
  };

  const handleCreate = async () => {
    setCreatingSubmit(true);
    try {
      const res = await trpc.snapshot.create.mutate({
        name: newName.trim() || undefined,
        password: newPassword.trim() || undefined,
        note: newNote.trim() || undefined,
      });
      if (res.success) {
        onAddSystemLog(
          `已创建${res.snapshot?.encrypted ? "加密" : ""}档案快照「${res.snapshot?.name}」`,
          "SUCCESS",
        );
        setCreating(false);
        await loadSnapshots(res.snapshot?.id);
      } else {
        onAddSystemLog(`创建快照失败: ${res.error}`, "ERROR");
      }
    } catch (err: any) {
      onAddSystemLog(`创建快照异常: ${err?.message || err}`, "ERROR");
    } finally {
      setCreatingSubmit(false);
    }
  };

  const handlePreviewDiff = async (id: string, password?: string) => {
    setDiffLoading(true);
    setDiffError("");
    setDiffNeedPassword(false);
    try {
      const res = await trpc.snapshot.previewDiff.query({
        id,
        password: password || undefined,
      });
      if (!res.success) {
        setDiffError(res.error || "预览失败");
        return;
      }
      if ("needsPassword" in res) {
        setDiffNeedPassword(true);
        return;
      }
      setDiffItems((res.items || []) as DiffItem[]);
      setView("diff");
    } catch (err: any) {
      setDiffError(err?.message || String(err));
    } finally {
      setDiffLoading(false);
    }
  };

  const handleRestore = async (id: string, password?: string) => {
    if (!confirm("确定要从此快照一键回滚当前本地数据吗？回滚前系统会自动镜像备份当前数据。")) {
      return;
    }
    setRestoring(true);
    try {
      const res = await trpc.snapshot.restore.mutate({
        id,
        password: password || undefined,
      });
      if (!res.success) {
        if ("needsPassword" in res) {
          setDiffNeedPassword(true);
        } else {
          onAddSystemLog(`回滚失败: ${res.error}`, "ERROR");
        }
        return;
      }
      onAddSystemLog(`已从快照回滚本地数据: ${res.message || "完成"}`, "SUCCESS");
      if (res.backupDir) {
        onAddSystemLog(`回滚前旧数据已镜像备份至 ${res.backupDir}`, "INFO");
      }
    } catch (err: any) {
      onAddSystemLog(`回滚异常: ${err?.message || err}`, "ERROR");
    } finally {
      setRestoring(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`确定要删除快照「${name}」吗？此操作不可恢复。`)) return;
    try {
      const res = await trpc.snapshot.delete.mutate({ id });
      if (res.success) {
        onAddSystemLog(`已删除快照「${name}」`, "SUCCESS");
        setView("detail");
        await loadSnapshots();
      } else {
        onAddSystemLog(`删除快照失败: ${res.error}`, "ERROR");
      }
    } catch (err: any) {
      onAddSystemLog(`删除快照异常: ${err?.message || err}`, "ERROR");
    }
  };

  const sourceCfg = SOURCE_CONFIG[selected?.source || "manual"] || SOURCE_CONFIG.manual;

  return (
    <div
      className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 anim-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-5xl overflow-hidden shadow-2xl flex flex-col h-[680px] anim-scale-in">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-600 dark:text-violet-400">
              <Archive className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  私有档案快照库
                </h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-mono">
                  {snapshots.length} 份快照
                </span>
              </div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                可命名、可加密、可预览差异的本地快照，随时一键回滚
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Tooltip content="刷新快照列表" placement="bottom">
              <button
                type="button"
                onClick={() => loadSnapshots()}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-violet-500" : ""}`} />
              </button>
            </Tooltip>
            <Tooltip content="关闭 (Esc)" placement="left">
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭快照库"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: snapshot list */}
          <div className="w-72 border-r border-slate-100 dark:border-slate-800 flex flex-col shrink-0">
            <div className="p-3 border-b border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={openCreate}
                className="w-full py-2 bg-gradient-to-r from-violet-500 to-violet-600 hover:from-violet-600 hover:to-violet-700 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm shadow-violet-500/10"
              >
                <Plus className="w-3.5 h-3.5" />
                新建档案快照
              </button>

              {creating && (
                <div className="mt-3 space-y-2 p-3 bg-violet-500/5 dark:bg-violet-500/10 border border-violet-500/20 rounded-xl">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-600 dark:text-slate-300 block">
                      快照名称
                    </label>
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="如：折腾前的安全存档"
                      className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:border-violet-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-600 dark:text-slate-300 block">
                      加密密码（可选，留空则明文保存）
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="AES-256 加密"
                        className="w-full pl-2.5 pr-8 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:border-violet-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                      >
                        {showPassword ? (
                          <EyeOff className="w-3.5 h-3.5" />
                        ) : (
                          <Eye className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-600 dark:text-slate-300 block">
                      备注
                    </label>
                    <input
                      type="text"
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      placeholder="记录这个快照的用途"
                      className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:border-violet-500"
                    />
                  </div>
                  <div className="flex gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => setCreating(false)}
                      className="flex-1 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg text-[11px] font-semibold cursor-pointer"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={handleCreate}
                      disabled={creatingSubmit}
                      className="flex-1 py-1.5 bg-violet-500 hover:bg-violet-600 text-white rounded-lg text-[11px] font-bold cursor-pointer disabled:opacity-50"
                    >
                      {creatingSubmit ? "保存中..." : "保存快照"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1.5 bg-slate-50/30 dark:bg-slate-950/40">
              {snapshots.length === 0 && !loading && (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-600 gap-2 p-4 text-center">
                  <FolderArchive className="w-8 h-8 stroke-[1.5]" />
                  <div className="text-xs">还没有任何快照</div>
                  <div className="text-[10px]">
                    手动推送或云端恢复时也会自动生成快照
                  </div>
                </div>
              )}

              {snapshots.map((s) => {
                const cfg = SOURCE_CONFIG[s.source] || SOURCE_CONFIG.manual;
                const active = selectedId === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(s.id);
                      setView("detail");
                    }}
                    className={`w-full text-left p-3 rounded-xl border transition cursor-pointer ${
                      active
                        ? "border-violet-500/40 bg-violet-500/5 dark:bg-violet-500/10"
                        : "border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-violet-400/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                        {s.name}
                      </span>
                      {s.encrypted && (
                        <KeyRound className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-semibold ${cfg.cls}`}>
                        {cfg.label}
                      </span>
                      {s.encrypted && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full border bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 font-semibold">
                          已加密
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-slate-400 dark:text-slate-500">
                      <Clock className="w-3 h-3" />
                      {new Date(s.createdAt).toLocaleString()}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: detail / diff */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {view === "detail" && (
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {!selected ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-600 gap-2">
                    <Archive className="w-8 h-8 stroke-[1.5]" />
                    <div className="text-xs">选择左侧一份快照查看详情</div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="p-2.5 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-600 dark:text-violet-400">
                          <Database className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                              {selected.name}
                            </h3>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${sourceCfg.cls}`}>
                              {sourceCfg.label}
                            </span>
                            {selected.encrypted && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full border bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 font-semibold flex items-center gap-1">
                                <KeyRound className="w-2.5 h-2.5" />
                                已加密
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                            {new Date(selected.createdAt).toLocaleString()} · 共{" "}
                            {selected.fileCount} 项数据 · {formatBytes(selected.size)}
                          </p>
                          {selected.note && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-800 rounded-lg px-3 py-2">
                              {selected.note}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 包含的数据文件 */}
                    <div>
                      <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
                        包含的数据
                      </h4>
                      <div className="grid grid-cols-2 gap-2">
                        {selected.files.map((f) => (
                          <div
                            key={f.key}
                            className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200/70 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                              <div className="min-w-0">
                                <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300 truncate">
                                  {f.label}
                                </div>
                                <div className="text-[9px] text-slate-400 font-mono truncate">
                                  {f.file}
                                </div>
                              </div>
                            </div>
                            <span className="text-[10px] text-slate-400 font-mono shrink-0">
                              {formatBytes(f.bytes)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex items-center gap-2.5 pt-1">
                      <button
                        type="button"
                        onClick={() => handlePreviewDiff(selected.id, selected.encrypted ? diffPassword || undefined : undefined)}
                        disabled={diffLoading}
                        className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <FileDiff className="w-4 h-4 text-violet-500" />
                        {diffLoading ? "计算差异中..." : "预览与当前差异"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRestore(selected.id, selected.encrypted ? diffPassword || undefined : undefined)}
                        disabled={restoring}
                        className="flex-1 py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-sm shadow-emerald-500/10"
                      >
                        <RotateCcw className={`w-4 h-4 ${restoring ? "animate-spin" : ""}`} />
                        {restoring ? "回滚中..." : "一键回滚到快照"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(selected.id, selected.name)}
                        className="py-2.5 px-3 bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 dark:hover:bg-rose-500/20 text-rose-500 rounded-lg transition cursor-pointer"
                        title="删除快照"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {/* 加密快照密码输入 */}
                    {selected.encrypted && (
                      <div className="flex items-center gap-2 p-3 bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/20 rounded-xl">
                        <KeyRound className="w-4 h-4 text-amber-500 shrink-0" />
                        <input
                          type="password"
                          value={diffPassword}
                          onChange={(e) => setDiffPassword(e.target.value)}
                          placeholder="输入此快照的加密密码后执行预览/回滚"
                          className="flex-1 px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:border-amber-500"
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {view === "diff" && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="px-6 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0 bg-slate-50/50 dark:bg-slate-900/50">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setView("detail");
                        setDiffPassword("");
                      }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                      title="返回详情"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    <FileDiff className="w-4 h-4 text-violet-500" />
                    <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      快照「{selected?.name}」与当前本地数据差异
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => selected && handleRestore(selected.id, selected.encrypted ? diffPassword || undefined : undefined)}
                    disabled={restoring}
                    className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-[11px] font-bold cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <RotateCcw className={`w-3.5 h-3.5 ${restoring ? "animate-spin" : ""}`} />
                    {restoring ? "回滚中..." : "一键回滚"}
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-2.5 bg-slate-50/30 dark:bg-slate-950/40">
                  {diffItems.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-600 gap-2">
                      <CheckCircle2 className="w-8 h-8 stroke-[1.5]" />
                      <div className="text-xs">所有数据与当前本地完全一致</div>
                    </div>
                  )}

                  {diffItems.map((item) => {
                    const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.equal;
                    return (
                      <div
                        key={item.key}
                        className="p-3.5 rounded-xl border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold shrink-0 ${cfg.cls}`}>
                              {cfg.label}
                            </span>
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                              {item.label}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-400 font-mono shrink-0">
                            {formatBytes(item.snapshotBytes)} → {formatBytes(item.localBytes)}
                          </span>
                        </div>

                        {item.status === "updated" && item.keySummary && (
                          <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                            {item.keySummary.changed > 0 && (
                              <span className="bg-amber-500/10 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded font-mono">
                                变化 {item.keySummary.changed}
                              </span>
                            )}
                            {item.keySummary.added > 0 && (
                              <span className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded font-mono">
                                +新增 {item.keySummary.added}
                              </span>
                            )}
                            {item.keySummary.removed > 0 && (
                              <span className="bg-rose-500/10 text-rose-600 dark:text-rose-400 px-1.5 py-0.5 rounded font-mono">
                                -删除 {item.keySummary.removed}
                              </span>
                            )}
                            {(item.localCount !== undefined || item.snapshotCount !== undefined) && (
                              <span className="bg-slate-500/10 text-slate-500 px-1.5 py-0.5 rounded font-mono">
                                数量 {item.snapshotCount ?? "?"} → {item.localCount ?? "?"}
                              </span>
                            )}
                          </div>
                        )}

                        {(item.addedKeys.length > 0 ||
                          item.removedKeys.length > 0 ||
                          item.changedKeys.length > 0) && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {item.changedKeys.map((k) => (
                              <span
                                key={`c-${k}`}
                                className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                              >
                                {k} ~
                              </span>
                            ))}
                            {item.addedKeys.map((k) => (
                              <span
                                key={`a-${k}`}
                                className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                              >
                                {k} +
                              </span>
                            ))}
                            {item.removedKeys.map((k) => (
                              <span
                                key={`r-${k}`}
                                className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20"
                              >
                                {k} -
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 加密密码缺失提示 */}
            {diffNeedPassword && view === "detail" && selected?.encrypted && (
              <div className="px-6 pb-4 shrink-0">
                <div className="flex items-center gap-2 p-3 bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/20 rounded-xl">
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                  <input
                    type="password"
                    value={diffPassword}
                    onChange={(e) => setDiffPassword(e.target.value)}
                    placeholder="输入此快照的加密密码后重试"
                    className="flex-1 px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:border-amber-500"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setDiffNeedPassword(false);
                      handlePreviewDiff(selected.id, diffPassword);
                    }}
                    className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[11px] font-bold cursor-pointer"
                  >
                    解锁预览
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
