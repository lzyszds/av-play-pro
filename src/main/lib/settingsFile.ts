// settings.json 的单一读写通道（B195）
// 主进程内对 settings.json 的所有读写都收敛到这里：
// - 路径唯一来源（storageRouter / createMainWindow / 后续写点共用）
// - 统一原子落盘，损坏/不存在时返回 null 而不是抛错
// 说明：所有调用都是主线程上的同步 read-modify-write，事件循环不会让两段
// 同步逻辑交错，因此不会出现 torn write；云端 pull 的“有意覆盖”由调用方自行合并后传入。

import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import { atomicWriteFileSync } from "./fsutil";

export function settingsFilePath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

export function readSettingsJson<
  T extends Record<string, unknown> = Record<string, unknown>,
>(): T | null {
  try {
    const file = settingsFilePath();
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
}

export function writeSettingsJson(data: Record<string, unknown>): void {
  atomicWriteFileSync(settingsFilePath(), JSON.stringify(data, null, 2));
}
