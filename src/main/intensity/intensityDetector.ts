import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { resolveFfmpeg } from "../whisper/whisperManager";

const VIDEO_EXTS = new Set([".mp4", ".mkv", ".ts", ".m4v", ".mov", ".webm", ".avi"]);

export interface IntensityCandidate {
  id: string;
  time: number;
  score: number;
  label: string;
}

export interface IntensityData {
  duration: number;
  candidates: IntensityCandidate[];
  detectedAt: string;
  method: "visual-motion";
}

export function intensityPath(folder: string) {
  return path.join(folder, "intensity.json");
}

function findVideo(folder: string): string | null {
  const names = fs.existsSync(folder) ? fs.readdirSync(folder) : [];
  const preferred = names.find((name) => /^video\./i.test(name) && VIDEO_EXTS.has(path.extname(name).toLowerCase()));
  const file = preferred || names.find((name) => VIDEO_EXTS.has(path.extname(name).toLowerCase()));
  return file ? path.join(folder, file) : null;
}

export function readIntensity(folder: string): IntensityData | null {
  try {
    return JSON.parse(fs.readFileSync(intensityPath(folder), "utf8")) as IntensityData;
  } catch {
    return null;
  }
}

function runFfmpeg(ffmpeg: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { windowsHide: true });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stderr }));
  });
}

function percentile(values: number[], ratio: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))] || 0;
}

/**
 * 每秒采样一次相邻帧亮度差，找出视觉节奏显著上升的位置。
 * 这是“候选片段”而不是对具体行为的语义识别，结果始终由用户复核。
 */
export async function detectIntensity(folder: string): Promise<IntensityData> {
  const ff = resolveFfmpeg();
  if (!ff) throw new Error("未找到 ffmpeg，请先在字幕工具中安装或配置 ffmpeg");
  const video = findVideo(folder);
  if (!video) throw new Error("未找到本地视频文件");

  const result = await runFfmpeg(ff.path, [
    "-hide_banner", "-i", video,
    "-vf", "fps=1,tblend=all_mode=difference,signalstats,metadata=print",
    "-an", "-f", "null", "-",
  ]);
  if (result.code !== 0) throw new Error(`ffmpeg 分析失败（${result.code}）`);

  let duration = 0;
  const durationMatch = result.stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);
  if (durationMatch) duration = +durationMatch[1] * 3600 + +durationMatch[2] * 60 + +durationMatch[3];

  let currentTime = 0;
  const samples: Array<{ time: number; value: number }> = [];
  for (const line of result.stderr.split(/\r?\n/)) {
    const time = line.match(/pts_time:([\d.]+)/);
    if (time) currentTime = Number(time[1]);
    const diff = line.match(/lavfi\.signalstats\.YDIF=([\d.]+)/);
    if (diff && Number.isFinite(currentTime)) samples.push({ time: currentTime, value: Number(diff[1]) });
  }
  if (!samples.length) throw new Error("没有读到可分析的画面节奏数据");

  const baseline = Math.max(0.01, percentile(samples.map((sample) => sample.value), 0.55));
  const eligible = samples
    .filter((sample) => sample.time >= 8 && (!duration || sample.time <= duration - 8))
    .filter((sample) => sample.value >= baseline * 1.25)
    .sort((a, b) => b.value - a.value);
  const chosen: Array<{ time: number; value: number }> = [];
  for (const sample of eligible) {
    if (chosen.some((item) => Math.abs(item.time - sample.time) < 35)) continue;
    chosen.push(sample);
    if (chosen.length >= 14) break;
  }
  const top = Math.max(...chosen.map((item) => item.value), baseline);
  const data: IntensityData = {
    duration,
    candidates: chosen.sort((a, b) => a.time - b.time).map((item, index) => ({
      id: `motion-${Math.round(item.time * 10)}`,
      time: Math.round(item.time * 10) / 10,
      score: Math.round(Math.min(100, (item.value / top) * 100)),
      label: `高强度候选 ${index + 1}`,
    })),
    detectedAt: new Date().toISOString(),
    method: "visual-motion",
  };
  fs.writeFileSync(intensityPath(folder), JSON.stringify(data, null, 2), "utf8");
  return data;
}

function quoteConcatPath(value: string): string {
  return value.replace(/'/g, "'\\''");
}

export async function exportIntensityCut(input: { folder: string; points: number[]; clipSeconds: number }): Promise<{ outputPath: string }> {
  const ff = resolveFfmpeg();
  if (!ff) throw new Error("未找到 ffmpeg");
  const video = findVideo(input.folder);
  if (!video) throw new Error("未找到本地视频文件");
  const points = [...new Set(input.points.map(Number).filter(Number.isFinite))].sort((a, b) => a - b).slice(0, 30);
  if (!points.length) throw new Error("请至少选择一个候选片段");
  const clipSeconds = Math.max(5, Math.min(90, Math.floor(input.clipSeconds || 18)));
  const temp = path.join(input.folder, `.avplay-cut-${Date.now()}`);
  fs.mkdirSync(temp, { recursive: true });
  try {
    const chunks: string[] = [];
    for (let index = 0; index < points.length; index += 1) {
      const start = Math.max(0, points[index] - Math.floor(clipSeconds / 2));
      const part = path.join(temp, `${String(index).padStart(2, "0")}.mp4`);
      const rendered = await runFfmpeg(ff.path, ["-y", "-ss", String(start), "-i", video, "-t", String(clipSeconds), "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-c:a", "aac", "-movflags", "+faststart", part]);
      if (rendered.code !== 0) throw new Error(`第 ${index + 1} 段导出失败`);
      chunks.push(part);
    }
    const list = path.join(temp, "concat.txt");
    fs.writeFileSync(list, chunks.map((file) => `file '${quoteConcatPath(file)}'`).join("\n"), "utf8");
    const outputPath = path.join(input.folder, `${path.basename(input.folder)}-高能合辑-${Date.now()}.mp4`);
    const joined = await runFfmpeg(ff.path, ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", outputPath]);
    if (joined.code !== 0) throw new Error("合辑拼接失败");
    return { outputPath };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
