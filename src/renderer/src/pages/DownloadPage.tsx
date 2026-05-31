import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Folder,
  Pause,
  Play,
  Plus,
  Save,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { trpc } from "../lib/trpc";

type TaskStatus = "PENDING" | "DOWNLOADING" | "PAUSED" | "COMPLETED" | "FAILED";

interface DownloadTask {
  id: string;
  seq: number;
  name: string;
  url: string;
  format: "MP4" | "MKV" | "TS";
  headers: string;
  threads: number;
  savePath: string;
  status: TaskStatus;
  progress: number;
  speed: number;
  logs: string[];
}

interface AppSettings {
  video_path: string;
  temp_path: string;
  defaultFormat: "MP4" | "MKV" | "TS";
  defaultThreads: number;
  maxConcurrentTasks: number;
  autoMerge: boolean;
  proxyUrl: string;
  nm3u8dlPath: string;
}

interface DownloadPageProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  onAddSystemLog: (
    text: string,
    level: "INFO" | "WARNING" | "SUCCESS" | "ERROR",
  ) => void;
}

interface NewTaskForm {
  url: string;
  name: string;
  format: "MP4" | "MKV" | "TS";
  headersText: string;
  threads: number;
  savePath: string;
}

interface SettingsDraft {
  video_path: string;
  temp_path: string;
  proxyUrl: string;
  nm3u8dlPath: string;
  autoMerge: boolean;
}

function sanitizeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_");
}

function parseHeadersText(text: string): string {
  if (!text.trim()) return "{}";
  const obj: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && value) obj[key] = value;
  }
  return JSON.stringify(obj);
}

function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec) return "0 KB/s";
  const mb = bytesPerSec / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(2)} MB/s`;
  return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
}

function statusBadgeClass(status: TaskStatus): string {
  if (status === "DOWNLOADING") return "bg-amber-100 text-amber-700 border-amber-200";
  if (status === "COMPLETED") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (status === "FAILED") return "bg-rose-100 text-rose-700 border-rose-200";
  if (status === "PAUSED") return "bg-slate-100 text-slate-700 border-slate-200";
  return "bg-slate-50 text-slate-500 border-slate-200";
}

export function DownloadPage({
  settings,
  onSettingsChange,
  onAddSystemLog,
}: DownloadPageProps) {
  const [tasks, setTasks] = useState<DownloadTask[]>(() => {
    try {
      const raw = localStorage.getItem("avplaypro_tasks_v5");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [logs, setLogs] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("avplaypro_logs_v5");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [showNewTask, setShowNewTask] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [queueRunning, setQueueRunning] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [form, setForm] = useState<NewTaskForm>({
    url: "",
    name: "",
    format: settings.defaultFormat,
    headersText:
      "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36\nReferer: https://missav.ai\nCookie: ",
    threads: settings.defaultThreads,
    savePath: settings.video_path,
  });
  const [draft, setDraft] = useState<SettingsDraft>({
    video_path: settings.video_path,
    temp_path: settings.temp_path,
    proxyUrl: settings.proxyUrl,
    nm3u8dlPath: settings.nm3u8dlPath,
    autoMerge: settings.autoMerge,
  });

  const activeTaskId = useRef<string | null>(null);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  useEffect(() => {
    localStorage.setItem("avplaypro_tasks_v5", JSON.stringify(tasks));
  }, [tasks]);

  useEffect(() => {
    localStorage.setItem("avplaypro_logs_v5", JSON.stringify(logs));
  }, [logs]);

  const appendLog = useCallback(
    (text: string) => {
      const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
      setLogs((prev) => [...prev.slice(-300), `[${time}] ${text}`]);
    },
    [setLogs],
  );

  const startTaskById = useCallback(
    (id: string) => {
      if (activeTaskId.current) return;
      const task = tasksRef.current.find((t) => t.id === id);
      if (!task) return;

      activeTaskId.current = task.id;
      const taskDir =
        task.savePath.replace(/[\\/]+$/, "") + "\\" + sanitizeName(task.name);
      setTasks((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, status: "DOWNLOADING", progress: t.progress || 0 } : t,
        ),
      );

      trpc.download.start
        .mutate({
          url: task.url,
          saveDir: taskDir,
          saveName: "video",
          format: task.format,
          threads: task.threads,
          headers: task.headers,
          tmpDir: settings.temp_path,
          proxyUrl: settings.proxyUrl,
          toolPath: settings.nm3u8dlPath,
          autoMerge: settings.autoMerge,
        })
        .catch((err: any) => {
          appendLog(`Start failed: ${err?.message || err}`);
          setTasks((prev) =>
            prev.map((t) => (t.id === id ? { ...t, status: "FAILED" } : t)),
          );
          activeTaskId.current = null;
        });
    },
    [
      appendLog,
      settings.autoMerge,
      settings.nm3u8dlPath,
      settings.proxyUrl,
      settings.temp_path,
    ],
  );

  const startNextPendingTask = useCallback(() => {
    if (activeTaskId.current) return;
    const next = tasksRef.current
      .filter((t) => t.status === "PENDING" || t.status === "PAUSED")
      .sort((a, b) => a.seq - b.seq)[0];
    if (next) startTaskById(next.id);
    else setQueueRunning(false);
  }, [startTaskById]);

  useEffect(() => {
    const unlisten =
      window.electronAPI?.download?.onProgress?.((_event, data) => {
        const id = activeTaskId.current;
        if (!id) return;
        if (data.line) appendLog(data.line);

        const speedMatch = String(data.line || "").match(/([\d.]+)\s*(B|KB|MB|GB)ps/i);
        const toBytes = (v: number, u: string): number => {
          if (u.toUpperCase() === "GB") return v * 1024 * 1024 * 1024;
          if (u.toUpperCase() === "MB") return v * 1024 * 1024;
          if (u.toUpperCase() === "KB") return v * 1024;
          return v;
        };

        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== id) return t;
            const speed =
              speedMatch && speedMatch[1] && speedMatch[2]
                ? toBytes(parseFloat(speedMatch[1]), speedMatch[2])
                : t.speed;
            return {
              ...t,
              progress:
                typeof data.percent === "number" && Number.isFinite(data.percent)
                  ? data.percent
                  : t.progress,
              speed,
              logs: data.line ? [...t.logs.slice(-199), data.line] : t.logs,
            };
          }),
        );

        if (data.done) {
          const doneId = activeTaskId.current;
          activeTaskId.current = null;
          setTasks((prev) =>
            prev.map((t) =>
              t.id === doneId
                ? { ...t, status: data.success ? "COMPLETED" : "FAILED", speed: 0, progress: data.success ? 100 : t.progress }
                : t,
            ),
          );
          if (queueRunning) {
            setTimeout(() => startNextPendingTask(), 250);
          }
        }
      }) || (() => {});

    return () => unlisten();
  }, [appendLog, queueRunning, startNextPendingTask]);

  const filteredTasks = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return [...tasks].sort((a, b) => a.seq - b.seq);
    return tasks
      .filter((t) => t.name.toLowerCase().includes(q) || t.url.toLowerCase().includes(q))
      .sort((a, b) => a.seq - b.seq);
  }, [searchTerm, tasks]);

  const createTask = useCallback(() => {
    if (!form.url.trim()) return;
    const seq = tasksRef.current.reduce((max, t) => Math.max(max, t.seq), 0) + 1;
    const name = form.name.trim() || `task-${Date.now().toString().slice(-6)}`;
    const task: DownloadTask = {
      id: `task-${Date.now()}`,
      seq,
      name,
      url: form.url.trim(),
      format: form.format,
      headers: parseHeadersText(form.headersText),
      threads: form.threads,
      savePath: form.savePath,
      status: "PENDING",
      progress: 0,
      speed: 0,
      logs: [],
    };
    setTasks((prev) => [...prev, task]);
    setShowNewTask(false);
    appendLog(`Task added: #${task.seq} ${task.name}`);
  }, [appendLog, form]);

  const toggleTask = useCallback(
    (task: DownloadTask) => {
      if (task.status === "DOWNLOADING") {
        trpc.download.stop.mutate().catch(() => {});
        activeTaskId.current = null;
        setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: "PAUSED", speed: 0 } : t)));
        return;
      }
      if (activeTaskId.current) return;
      startTaskById(task.id);
    },
    [startTaskById],
  );

  const removeTask = useCallback(
    (task: DownloadTask) => {
      if (activeTaskId.current === task.id) {
        trpc.download.stop.mutate().catch(() => {});
        activeTaskId.current = null;
      }
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
      trpc.download.cleanupTemp
        .mutate({
          saveDir: task.savePath,
          saveName: task.name,
          tmpDir: settings.temp_path,
        })
        .catch(() => {});
    },
    [settings.temp_path],
  );

  const saveSettings = useCallback(() => {
    onSettingsChange({
      ...settings,
      video_path: draft.video_path,
      temp_path: draft.temp_path,
      proxyUrl: draft.proxyUrl,
      nm3u8dlPath: draft.nm3u8dlPath,
      autoMerge: draft.autoMerge,
    });
    setShowSettings(false);
    onAddSystemLog("Settings updated", "SUCCESS");
  }, [draft, onAddSystemLog, onSettingsChange, settings]);

  const pickFolder = useCallback(
    async (field: "video_path" | "temp_path") => {
      const selected = await trpc.dialog.selectFolder.query({
        currentPath: draft[field],
      });
      if (selected) {
        setDraft((prev) => ({ ...prev, [field]: selected }));
      }
    },
    [draft],
  );

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="p-4 border-b border-slate-200 bg-white flex items-center justify-between gap-3">
        <div className="relative w-60">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
          <input
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus:border-amber-500"
            placeholder="Search tasks"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowNewTask(true)} className="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 text-xs font-bold flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> New
          </button>
          <button onClick={() => setQueueRunning((v) => { const next = !v; if (next) startNextPendingTask(); return next; })} className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold flex items-center gap-1.5 border border-slate-200">
            <Download className="w-3.5 h-3.5" /> {queueRunning ? "Queue On" : "Queue Off"}
          </button>
          <button onClick={() => setShowSettings(true)} className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600">
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-[1fr_380px]">
        <div className="overflow-y-auto p-4 bg-[#f4f6f9]">
          {filteredTasks.length === 0 ? (
            <div className="h-40 rounded-xl border border-slate-200 bg-white flex items-center justify-center text-xs text-slate-400">
              No tasks
            </div>
          ) : (
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]">
              {filteredTasks.map((task) => (
                <div key={task.id} className="rounded-xl bg-white border border-slate-200 p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold text-slate-800 truncate">#{task.seq} {task.name}</div>
                      <div className="text-[10px] text-slate-400 truncate">{task.url}</div>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${statusBadgeClass(task.status)}`}>
                      {task.status}
                    </span>
                  </div>
                  <div className="mt-2 h-2 rounded bg-slate-100 overflow-hidden">
                    <div className="h-full bg-amber-500" style={{ width: `${Math.max(0, Math.min(100, task.progress))}%` }} />
                  </div>
                  <div className="mt-2 text-[10px] text-slate-500 flex items-center justify-between">
                    <span>{task.progress.toFixed(1)}%</span>
                    <span>{formatSpeed(task.speed)}</span>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <button onClick={() => toggleTask(task)} className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 border border-slate-200 text-slate-700">
                      {task.status === "DOWNLOADING" ? <span className="inline-flex items-center gap-1"><Pause className="w-3 h-3" /> Pause</span> : <span className="inline-flex items-center gap-1"><Play className="w-3 h-3" /> Start</span>}
                    </button>
                    <button onClick={() => removeTask(task)} className="p-1.5 rounded-lg border border-rose-200 text-rose-600 bg-rose-50">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-l border-slate-200 bg-white min-h-0 flex flex-col">
          <div className="px-3 py-2 border-b border-slate-200 text-xs font-semibold text-slate-700">Logs</div>
          <div className="flex-1 overflow-y-auto p-3 text-[10px] font-mono text-slate-600 space-y-1 bg-[#f8fafc]">
            {logs.length === 0 ? <div className="text-slate-400">No logs yet</div> : logs.map((line, i) => <div key={`${line}-${i}`}>{line}</div>)}
          </div>
        </div>
      </div>

      {showNewTask && (
        <div className="fixed inset-0 bg-black/25 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-white rounded-xl border border-slate-200 shadow-2xl">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <div className="text-sm font-bold text-slate-800">New Download Task</div>
              <button onClick={() => setShowNewTask(false)} className="p-1 rounded text-slate-500 hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-3 text-xs">
              <input className="w-full border border-slate-200 rounded-lg px-3 py-2" placeholder="M3U8 URL" value={form.url} onChange={(e) => setForm((v) => ({ ...v, url: e.target.value }))} />
              <input className="w-full border border-slate-200 rounded-lg px-3 py-2" placeholder="Task name (optional)" value={form.name} onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))} />
              <div className="grid grid-cols-3 gap-2">
                <select className="border border-slate-200 rounded-lg px-2 py-2" value={form.format} onChange={(e) => setForm((v) => ({ ...v, format: e.target.value as "MP4" | "MKV" | "TS" }))}>
                  <option value="MP4">MP4</option>
                  <option value="MKV">MKV</option>
                  <option value="TS">TS</option>
                </select>
                <input type="number" min={1} className="border border-slate-200 rounded-lg px-2 py-2" value={form.threads} onChange={(e) => setForm((v) => ({ ...v, threads: Number(e.target.value || 1) }))} />
                <input className="border border-slate-200 rounded-lg px-2 py-2" value={form.savePath} onChange={(e) => setForm((v) => ({ ...v, savePath: e.target.value }))} />
              </div>
              <textarea rows={4} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[10px]" value={form.headersText} onChange={(e) => setForm((v) => ({ ...v, headersText: e.target.value }))} />
            </div>
            <div className="px-4 py-3 border-t border-slate-200 flex justify-end gap-2">
              <button onClick={() => setShowNewTask(false)} className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs">Cancel</button>
              <button onClick={createTask} className="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 text-xs font-bold">Create</button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="fixed inset-0 bg-black/25 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white rounded-xl border border-slate-200 shadow-2xl">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <div className="text-sm font-bold text-slate-800">Settings</div>
              <button onClick={() => setShowSettings(false)} className="p-1 rounded text-slate-500 hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-3 text-xs">
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <input className="border border-slate-200 rounded-lg px-3 py-2 font-mono" value={draft.video_path} onChange={(e) => setDraft((v) => ({ ...v, video_path: e.target.value }))} />
                <button onClick={() => pickFolder("video_path")} className="px-3 rounded-lg border border-slate-200 bg-white"><Folder className="w-3.5 h-3.5" /></button>
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <input className="border border-slate-200 rounded-lg px-3 py-2 font-mono" value={draft.temp_path} onChange={(e) => setDraft((v) => ({ ...v, temp_path: e.target.value }))} />
                <button onClick={() => pickFolder("temp_path")} className="px-3 rounded-lg border border-slate-200 bg-white"><Folder className="w-3.5 h-3.5" /></button>
              </div>
              <input className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono" placeholder="Proxy URL (optional)" value={draft.proxyUrl} onChange={(e) => setDraft((v) => ({ ...v, proxyUrl: e.target.value }))} />
              <input className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono" placeholder="N_m3u8DL-RE path" value={draft.nm3u8dlPath} onChange={(e) => setDraft((v) => ({ ...v, nm3u8dlPath: e.target.value }))} />
              <label className="inline-flex items-center gap-2 text-slate-700 select-none">
                <input type="checkbox" checked={draft.autoMerge} onChange={(e) => setDraft((v) => ({ ...v, autoMerge: e.target.checked }))} />
                Auto merge segments
              </label>
            </div>
            <div className="px-4 py-3 border-t border-slate-200 flex justify-end gap-2">
              <button onClick={() => setShowSettings(false)} className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs">Cancel</button>
              <button onClick={saveSettings} className="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 text-xs font-bold inline-flex items-center gap-1.5"><Save className="w-3.5 h-3.5" /> Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
