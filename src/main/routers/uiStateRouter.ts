import * as fs from "fs";
import * as path from "path";
import { atomicWriteFileSync } from "../lib/fsutil";
import { app } from "electron";
import { t } from "../trpc";
import { log } from "../logger";

/**
 * 通用 UI 状态持久化：渲染端 zustand persist 插件经由 tRPC 把状态落到
 * userData 下的 JSON 文件（替代 localStorage，避免打包后 localStorage 不可靠）。
 * 文件形如 { "discover": "{...index.json 字符串...}", ... }，与 persist 的
 * StateStorage（getItem/setItem/removeItem）一一对应。
 */
function uiStateFile(): string {
  return path.join(app.getPath("userData"), "ui-state.json");
}

type UiStateMap = Record<string, string>;

function readUiState(): UiStateMap {
  try {
    const file = uiStateFile();
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const map: UiStateMap = {};
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === "string") map[k] = v;
        }
        return map;
      }
    }
  } catch (error) {
    log.warn(`[ui-state] 读取失败: ${(error as Error)?.message}`);
  }
  return {};
}

function writeUiState(map: UiStateMap): void {
  try {
    atomicWriteFileSync(uiStateFile(), JSON.stringify(map, null, 2));
  } catch (error) {
    log.warn(`[ui-state] 写入失败: ${(error as Error)?.message}`);
  }
}

export const uiStateRouter = t.router({
  /** 读取全部 UI 状态（zustand persist 的 storage 实现） */
  get: t.procedure.query((): UiStateMap => readUiState()),

  /** 写入一个条目（name → persist 序列化字符串）；value 传 null 则删除 */
  set: t.procedure
    .input((input: unknown) =>
      input as { name: string; value: string | null },
    )
    .mutation(({ input }): { ok: boolean } => {
      const map = readUiState();
      if (input.value == null) delete map[input.name];
      else map[input.name] = input.value;
      writeUiState(map);
      return { ok: true };
    }),

  /** 批量写入（渲染端 uiStorage 防抖后的整批条目），一次读改写落盘 */
  setMany: t.procedure
    .input((input: unknown) =>
      input as { entries: { name: string; value: string | null }[] },
    )
    .mutation(({ input }): { ok: boolean } => {
      const map = readUiState();
      for (const entry of input.entries) {
        if (entry.value == null) delete map[entry.name];
        else map[entry.name] = entry.value;
      }
      writeUiState(map);
      return { ok: true };
    }),
});
