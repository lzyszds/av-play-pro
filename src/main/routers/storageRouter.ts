import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import { t } from "../trpc";

interface DownloadState {
  tasks: unknown[];
  logs: unknown[];
}

function getDownloadStatePath(): string {
  return path.join(app.getPath("userData"), "download-state.json");
}

function getSettingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
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
  fs.writeFileSync(file, JSON.stringify(state, null, 2), "utf8");
}

export const storageRouter = t.router({
  getSettings: t.procedure.query(() => {
    try {
      const file = getSettingsPath();
      if (!fs.existsSync(file)) return {};
      return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch {
      return {};
    }
  }),

  saveSettings: t.procedure
    .input((input: unknown) => input as Record<string, unknown>)
    .mutation(({ input }) => {
      const file = getSettingsPath();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(input || {}, null, 2), "utf8");
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
