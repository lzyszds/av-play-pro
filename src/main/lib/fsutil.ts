// 原子写文件工具（B194）
// 先写入同目录临时文件，再 rename 覆盖目标：
// 进程在写入中途崩溃时只会留下 .tmp，绝不会产生「半截目标文件被后续误用」的问题。

import * as fs from "fs";
import * as path from "path";

function tempPathFor(target: string): string {
  const dir = path.dirname(target);
  const base = path.basename(target);
  return path.join(
    dir,
    `.${base}.${process.pid}.${Date.now().toString(36)}.${Math.random()
      .toString(36)
      .slice(2, 8)}.tmp`,
  );
}

/** 同步原子写（string 或 Buffer），自动创建父目录 */
export function atomicWriteFileSync(target: string, data: string | Buffer): void {
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = tempPathFor(target);
  fs.writeFileSync(tmp, data);
  try {
    fs.renameSync(tmp, target);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/** 异步原子写（string 或 Buffer），自动创建父目录 */
export async function atomicWriteFile(
  target: string,
  data: string | Buffer,
): Promise<void> {
  const dir = path.dirname(target);
  await fs.promises.mkdir(dir, { recursive: true });
  const tmp = tempPathFor(target);
  await fs.promises.writeFile(tmp, data);
  try {
    await fs.promises.rename(tmp, target);
  } catch (err) {
    try {
      await fs.promises.unlink(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/** 移除某目标旁的遗留 .tmp（可选，用于崩溃残留清理） */
export function cleanTempAround(target: string): void {
  try {
    const dir = path.dirname(target);
    const base = path.basename(target);
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(`.${base}.`) && name.endsWith(".tmp")) {
        try {
          fs.unlinkSync(path.join(dir, name));
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
}
