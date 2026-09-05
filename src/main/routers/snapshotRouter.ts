import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { z } from "zod";
import { t } from "../trpc";
import { log } from "../logger";
import { recordActivity } from "./activityRouter";

function getUserDataPath(...segments: string[]): string {
  return path.join(app.getPath("userData"), ...segments);
}

function readJsonFile<T = unknown>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch (err) {
    log.warn(`[snapshotRouter] Failed to read ${filePath}:`, err);
    return fallback;
  }
}

function writeJsonFile(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

// 参与快照/云同步的本地数据文件定义（快照会包含 actors 作为本地完整档案）
export const SYNC_FILE_DEFS = [
  { key: "settings", file: "settings.json", label: "系统设置" },
  { key: "stats", file: "stats.json", label: "播放统计" },
  { key: "timeline", file: "timeline.json", label: "打点书签" },
  { key: "actors", file: "actors.json", label: "演员资料" },
  { key: "tagModel", file: "tag-model.json", label: "标签模型" },
  { key: "activities", file: "activity-history.json", label: "操作历史" },
  { key: "annualReport", file: "annual-report.json", label: "年度报告" },
  { key: "achievements", file: "achievements.json", label: "成就殿堂" },
  { key: "scrape", file: "missav-scrape.json", label: "发现页抓取缓存" },
];

export interface SnapshotMeta {
  id: string;
  name: string;
  createdAt: string;
  encrypted: boolean;
  source: string; // "manual" | "pre-push" | "pre-pull"
  note?: string;
  size: number;
  fileCount: number;
  files: { key: string; label: string; file: string; bytes: number }[];
}

const SNAPSHOT_ROOT = "snapshots";
const INDEX_FILE = "index.json";

function snapshotsRoot(): string {
  return getUserDataPath(SNAPSHOT_ROOT);
}
function indexPath(): string {
  return path.join(snapshotsRoot(), INDEX_FILE);
}
function snapshotDir(id: string): string {
  return path.join(snapshotsRoot(), id);
}
function snapshotPayloadPath(id: string): string {
  return path.join(snapshotDir(id), "payload.json");
}

function readIndex(): SnapshotMeta[] {
  const idx = readJsonFile<{ snapshots?: SnapshotMeta[] }>(indexPath(), {});
  return Array.isArray(idx?.snapshots) ? idx.snapshots : [];
}

function writeIndex(items: SnapshotMeta[]): void {
  fs.mkdirSync(snapshotsRoot(), { recursive: true });
  writeJsonFile(indexPath(), { snapshots: items });
}

// 读取当前本地全部核心数据文件
export function readLocalSyncData(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const def of SYNC_FILE_DEFS) {
    const fallback = def.key === "actors" ? [] : {};
    out[def.key] = readJsonFile(getUserDataPath(def.file), fallback);
  }
  return out;
}

// ---------- 加密（AES-256-GCM，密码由 scrypt 派生） ----------
interface EncryptedContainer {
  v: number;
  algo: string;
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

function encryptPayload(plain: string, password: string): string {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(password, salt, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const container: EncryptedContainer = {
    v: 1,
    algo: "aes-256-gcm",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: enc.toString("base64"),
  };
  return JSON.stringify(container);
}

function decryptPayload(payload: string, password: string): string {
  const container = JSON.parse(payload) as EncryptedContainer;
  const key = crypto.scryptSync(
    password,
    Buffer.from(container.salt, "base64"),
    32,
  );
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(container.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(container.tag, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(container.data, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

// 生成快照并写入磁盘（manual / 同步前自动记录共用）
export async function createSnapshotRecord(opts: {
  name: string;
  password?: string;
  note?: string;
  source?: string;
  data?: Record<string, unknown>;
}): Promise<{ success: boolean; snapshot?: SnapshotMeta; error?: string }> {
  try {
    const data = opts.data ?? readLocalSyncData();
    const files: SnapshotMeta["files"] = [];
    let dataBytes = 0;
    for (const def of SYNC_FILE_DEFS) {
      const val = data[def.key];
      if (val === undefined) continue;
      const bytes = Buffer.byteLength(JSON.stringify(val), "utf8");
      dataBytes += bytes;
      files.push({ key: def.key, label: def.label, file: def.file, bytes });
    }

    const payload = {
      version: 1,
      createdAt: new Date().toISOString(),
      data,
    };
    const serialized = JSON.stringify(payload);
    const encrypted = Boolean(opts.password);
    const stored = encrypted
      ? encryptPayload(serialized, opts.password!)
      : serialized;

    const id = `snap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const dir = snapshotDir(id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(snapshotPayloadPath(id), stored, "utf8");

    const meta: SnapshotMeta = {
      id,
      name: opts.name,
      createdAt: payload.createdAt,
      encrypted,
      source: opts.source || "manual",
      note: opts.note,
      size: Buffer.byteLength(stored, "utf8"),
      fileCount: files.length,
      files,
    };
    const index = readIndex();
    index.unshift(meta);
    writeIndex(index);
    return { success: true, snapshot: meta };
  } catch (err: any) {
    log.error("[snapshotRouter] Failed to create snapshot:", err);
    return { success: false, error: err?.message || String(err) };
  }
}

function loadSnapshotPayload(
  id: string,
  password?: string,
):
  | { ok: true; data: Record<string, unknown>; createdAt: string }
  | { ok: false; error: string } {
  const file = snapshotPayloadPath(id);
  if (!fs.existsSync(file)) return { ok: false, error: "快照文件不存在" };
  const raw = fs.readFileSync(file, "utf8");
  const meta = readIndex().find((m) => m.id === id);
  try {
    let parsed: any;
    if (meta?.encrypted) {
      parsed = JSON.parse(decryptPayload(raw, password || ""));
    } else {
      parsed = JSON.parse(raw);
    }
    return {
      ok: true,
      data: parsed?.data || {},
      createdAt: parsed?.createdAt || meta?.createdAt || "",
    };
  } catch (err) {
    return { ok: false, error: "密码错误或快照数据已损坏" };
  }
}

// 两个 JSON 值之间的差异概览（对象→键级，数组→数量级，否则→字节级）
export function computeValueDiff(
  local: unknown,
  remote: unknown,
): {
  equal: boolean;
  localBytes: number;
  remoteBytes: number;
  localCount?: number;
  remoteCount?: number;
  keySummary?: { added: number; removed: number; changed: number };
  addedKeys: string[];
  removedKeys: string[];
  changedKeys: string[];
} {
  const localStr = local === undefined ? "" : JSON.stringify(local);
  const remoteStr = remote === undefined ? "" : JSON.stringify(remote);
  const equal = localStr === remoteStr;
  const addedKeys: string[] = [];
  const removedKeys: string[] = [];
  const changedKeys: string[] = [];
  let localCount: number | undefined;
  let remoteCount: number | undefined;

  if (!equal) {
    const bothObjects =
      !!local &&
      !!remote &&
      typeof local === "object" &&
      typeof remote === "object" &&
      !Array.isArray(local) &&
      !Array.isArray(remote);
    if (bothObjects) {
      const lk = new Set(Object.keys(local as object));
      const ck = new Set(Object.keys(remote as object));
      for (const k of ck) if (!lk.has(k)) addedKeys.push(k);
      for (const k of lk) if (!ck.has(k)) removedKeys.push(k);
      for (const k of lk) {
        if (
          ck.has(k) &&
          JSON.stringify((local as any)[k]) !== JSON.stringify((remote as any)[k])
        ) {
          changedKeys.push(k);
        }
      }
    } else if (Array.isArray(local) || Array.isArray(remote)) {
      if (Array.isArray(local)) localCount = local.length;
      if (Array.isArray(remote)) remoteCount = remote.length;
    }
  }

  return {
    equal,
    localBytes: Buffer.byteLength(localStr, "utf8"),
    remoteBytes: Buffer.byteLength(remoteStr, "utf8"),
    localCount,
    remoteCount,
    keySummary:
      addedKeys.length || removedKeys.length || changedKeys.length
        ? {
            added: addedKeys.length,
            removed: removedKeys.length,
            changed: changedKeys.length,
          }
        : undefined,
    addedKeys: addedKeys.slice(0, 8),
    removedKeys: removedKeys.slice(0, 8),
    changedKeys: changedKeys.slice(0, 12),
  };
}

// 恢复/拉取时合并设置：保留本地路径与云端连接参数，偏好类优先采用来源数据
export function mergeSettingsPreservingLocal(
  localSettings: Record<string, any>,
  sourceSettings: Record<string, any> | undefined,
  opts?: { endpoint?: string; secret?: string; lastSync?: string },
): Record<string, any> {
  const src = sourceSettings || {};
  const merged: Record<string, any> = {
    ...src,
    ...localSettings,
    theme: src.theme ?? localSettings.theme,
    notifySound: src.notifySound ?? localSettings.notifySound,
    notifyOnComplete: src.notifyOnComplete ?? localSettings.notifyOnComplete,
    loaderStyle: src.loaderStyle ?? localSettings.loaderStyle,
    downloadBackground:
      src.downloadBackground ?? localSettings.downloadBackground,
    playerLayout: src.playerLayout ?? localSettings.playerLayout,
    privacyScreenEnabled:
      src.privacyScreenEnabled ?? localSettings.privacyScreenEnabled,
  };
  if (opts?.endpoint) merged.cloudSyncEndpoint = opts.endpoint;
  if (opts?.secret) merged.cloudSyncSecret = opts.secret;
  if (opts?.lastSync) merged.cloudSyncLastSync = opts.lastSync;
  return merged;
}

export const snapshotRouter = t.router({
  // 快照库列表（仅元信息，不含数据）
  list: t.procedure.query(() => {
    return { success: true as const, snapshots: readIndex() };
  }),

  // 创建快照（可命名、可选密码加密）
  create: t.procedure
    .input(
      z.object({
        name: z.string().optional(),
        password: z.string().optional(),
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const now = new Date();
      const defaultName = `快照-${now.toLocaleString()}`;
      const res = await createSnapshotRecord({
        name: input.name?.trim() || defaultName,
        password: input.password?.trim() || undefined,
        note: input.note?.trim() || undefined,
      });
      if (res.success && res.snapshot) {
        recordActivity(
          "SYNC",
          "创建档案快照",
          `已创建${res.snapshot.encrypted ? "加密" : ""}快照「${res.snapshot.name}」，共 ${res.snapshot.fileCount} 项数据`,
        );
      }
      return res;
    }),

  // 预览快照与当前本地数据的差异（加密快照需要密码）
  previewDiff: t.procedure
    .input(
      z.object({
        id: z.string(),
        password: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      const meta = readIndex().find((m) => m.id === input.id);
      if (!meta) return { success: false as const, error: "快照不存在" };
      if (meta.encrypted && !input.password) {
        return {
          success: true as const,
          needsPassword: true as const,
          meta,
        };
      }
      const loaded = loadSnapshotPayload(input.id, input.password);
      if (!loaded.ok) return { success: false as const, error: loaded.error };

      const current = readLocalSyncData();
      const items = SYNC_FILE_DEFS.map((def) => {
        const snapshotVal = loaded.data[def.key];
        const currentVal = current[def.key];
        const diff = computeValueDiff(snapshotVal, currentVal);
        let status: "equal" | "added" | "updated" | "removed" = "equal";
        if (!diff.equal) {
          const hasCurrent =
            currentVal !== undefined &&
            currentVal !== null &&
            JSON.stringify(currentVal) !== "{}" &&
            JSON.stringify(currentVal) !== "[]";
          const hasSnapshot =
            snapshotVal !== undefined &&
            snapshotVal !== null &&
            JSON.stringify(snapshotVal) !== "{}" &&
            JSON.stringify(snapshotVal) !== "[]";
          if (!hasSnapshot && hasCurrent) status = "added";
          else if (hasSnapshot && !hasCurrent) status = "removed";
          else status = "updated";
        }
        return {
          key: def.key,
          label: def.label,
          file: def.file,
          status,
          localBytes: diff.localBytes,
          snapshotBytes: diff.remoteBytes,
          localCount: diff.localCount,
          snapshotCount: diff.remoteCount,
          keySummary: diff.keySummary,
          addedKeys: diff.addedKeys,
          removedKeys: diff.removedKeys,
          changedKeys: diff.changedKeys,
        };
      });
      return { success: true as const, meta, createdAt: loaded.createdAt, items };
    }),

  // 一键回滚：将快照数据恢复回本地（恢复前自动镜像备份）
  restore: t.procedure
    .input(
      z.object({
        id: z.string(),
        password: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const meta = readIndex().find((m) => m.id === input.id);
      if (!meta) return { success: false as const, error: "快照不存在" };
      if (meta.encrypted && !input.password) {
        return { success: false as const, needsPassword: true as const };
      }
      const loaded = loadSnapshotPayload(input.id, input.password);
      if (!loaded.ok) return { success: false as const, error: loaded.error };

      try {
        const timestamp = new Date()
          .toISOString()
          .replace(/[:.]/g, "-")
          .slice(0, 19);
        const backupDir = getUserDataPath("backups", `pre-restore-${timestamp}`);
        fs.mkdirSync(backupDir, { recursive: true });
        for (const def of SYNC_FILE_DEFS) {
          const src = getUserDataPath(def.file);
          if (fs.existsSync(src)) {
            try {
              fs.copyFileSync(src, path.join(backupDir, def.file));
            } catch (copyErr) {
              log.warn(`[snapshotRouter] Failed to backup ${def.file}:`, copyErr);
            }
          }
        }

        const data = loaded.data;
        for (const def of SYNC_FILE_DEFS) {
          const val = data[def.key];
          if (val === undefined) continue;
          if (def.key === "settings") {
            const local = readJsonFile<Record<string, any>>(
              getUserDataPath(def.file),
              {},
            );
            writeJsonFile(
              getUserDataPath(def.file),
              mergeSettingsPreservingLocal(local, val as Record<string, any>),
            );
          } else {
            writeJsonFile(getUserDataPath(def.file), val);
          }
        }

        recordActivity(
          "SYNC",
          "回滚档案快照",
          `已从快照「${meta.name}」恢复本地数据，旧数据镜像备份至 backups`,
        );
        log.info(
          `[snapshotRouter] Restored snapshot ${meta.id} -> ${backupDir}`,
        );
        return {
          success: true as const,
          backupDir,
          message: `已从快照「${meta.name}」恢复本地数据！`,
        };
      } catch (err: any) {
        log.error("[snapshotRouter] Failed to restore snapshot:", err);
        return {
          success: false as const,
          error: `恢复异常: ${err?.message || String(err)}`,
        };
      }
    }),

  // 删除快照
  delete: t.procedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const index = readIndex();
      const idx = index.findIndex((m) => m.id === input.id);
      if (idx === -1) {
        return { success: false as const, error: "快照不存在" };
      }
      const [meta] = index.splice(idx, 1);
      writeIndex(index);
      try {
        fs.rmSync(snapshotDir(input.id), { recursive: true, force: true });
      } catch (err) {
        log.warn(`[snapshotRouter] Failed to remove snapshot dir:`, err);
      }
      recordActivity("SYNC", "删除档案快照", `已删除快照「${meta.name}」`);
      return { success: true as const };
    }),
});
