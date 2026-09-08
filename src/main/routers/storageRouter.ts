import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import { atomicWriteFileSync } from "../lib/fsutil";
import { readSettingsJson, writeSettingsJson } from "../lib/settingsFile";
import { t } from "../trpc";

interface DownloadState {
  tasks: unknown[];
  logs: unknown[];
}

function getDownloadStatePath(): string {
  return path.join(app.getPath("userData"), "download-state.json");
}

function readDownloadState(): DownloadState {
  try {
    const file = getDownloadStatePath();
    if (!fs.existsSync(file)) return { tasks: [], logs: [] };
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<DownloadState>;
    return {
      tasks: Array.isArray(data.tasks) ? data.tasks : [],
      logs: Array.isArray(data.logs) ? data.logs : [],
    };
  } catch {
    return { tasks: [], logs: [] };
  }
}

function writeDownloadState(state: DownloadState): void {
  const file = getDownloadStatePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomicWriteFileSync(file, JSON.stringify(state, null, 2));
}

export const storageRouter = t.router({
  // B195：settings.json 统一走 settingsFile 单一读写通道（原子 + 路径唯一）
  getSettings: t.procedure.query(() => {
    return readSettingsJson() ?? {};
  }),

  saveSettings: t.procedure
    .input((input: unknown) => input as Record<string, unknown>)
    .mutation(({ input }) => {
      writeSettingsJson(input || {});
      return { success: true };
    }),

  getDownloadState: t.procedure.query(() => {
    return readDownloadState();
  }),

  saveDownloadState: t.procedure
    .input((input: unknown) => input as DownloadState)
    .mutation(({ input }) => {
      writeDownloadState({
        tasks: Array.isArray(input.tasks) ? input.tasks : [],
        logs: Array.isArray(input.logs) ? input.logs : [],
      });
      return { success: true };
    }),
});
