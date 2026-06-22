// 演员资料持久化：userData/actors.json
// 数据结构：{ [name]: ActorRecord }
import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import { log } from "../logger";

export interface ActorRecord {
  name: string;
  /** JavDB 演员页 URL */
  javdbUrl?: string;
  /** 头像 data URL（base64） */
  avatarBase64?: string;
  /** 备用别名 */
  aliases?: string[];
  /** 上次刮削时间（ISO） */
  scrapedAt?: string;
  /** 刮削是否失败（最后一次） */
  failed?: boolean;
  /** 失败原因 */
  error?: string;
}

const FILE = () => path.join(app.getPath("userData"), "actors.json");

let store: Record<string, ActorRecord> = {};
let loaded = false;

function ensureLoaded() {
  if (loaded) return;
  try {
    if (fs.existsSync(FILE())) {
      store = JSON.parse(fs.readFileSync(FILE(), "utf8"));
    }
  } catch (e: any) {
    log.warn(`[actors] load failed: ${e?.message}`);
    store = {};
  }
  loaded = true;
}

function save() {
  try {
    fs.writeFileSync(FILE(), JSON.stringify(store, null, 2), "utf8");
  } catch (e: any) {
    log.warn(`[actors] save failed: ${e?.message}`);
  }
}

export function getActor(name: string): ActorRecord | undefined {
  ensureLoaded();
  return store[name];
}

export function listActors(): ActorRecord[] {
  ensureLoaded();
  return Object.values(store);
}

export function upsertActor(rec: ActorRecord) {
  ensureLoaded();
  store[rec.name] = { ...store[rec.name], ...rec };
  save();
}

export function removeActor(name: string) {
  ensureLoaded();
  delete store[name];
  save();
}
