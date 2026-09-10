import log from "electron-log/main";
import { app } from "electron";
import * as path from "path";
import * as util from "util";
import { getMainWindow } from "./windowState";

let initialized = false;

const MAIN_LOG_CHANNEL = "avplay:main-log";
/** 去重：electron-log 的 console transport 会再走一遍被劫持的 console.*，
 *  出于 1:1 显示要求，同一条目在极短窗口内只推一次 */
const dedupe = new Map<string, number>();

function levelToRenderer(level: string): string {
  switch (level) {
    case "warn":
      return "WARNING";
    case "error":
      return "ERROR";
    case "debug":
      return "DEBUG";
    case "success":
      return "SUCCESS";
    default:
      return "INFO";
  }
}

/** 主进程日志 → 渲染端控制台（1:1） */
export function emitMainLog(level: string, text: string): void {
  try {
    const key = `${level}|${text}`;
    const now = Date.now();
    const prev = dedupe.get(key);
    if (prev != null && now - prev < 1500) return;
    dedupe.set(key, now);
    if (dedupe.size > 200) {
      const oldest = dedupe.keys().next().value;
      if (oldest != null) dedupe.delete(oldest);
    }
    getMainWindow()?.webContents.send("avplay:main-log", {
      time: now,
      level,
      text,
    });
  } catch {
    /* 渲染端未就绪时忽略 */
  }
}

/** 挂接 electron-log 与 console.*，把主进程全部日志实时转发到渲染端 */
export function attachMainLogBridge(): void {
  // electron-log 全量截获（hook 在 transports 前触发）
  log.hooks.push((message) => {
    try {
      const text = (message.data || [])
        .map((d) => (typeof d === "string" ? d : util.format(d)))
        .join(" ");
      emitMainLog(levelToRenderer(message.level), text);
    } catch {
      /* ignore */
    }
    return message;
  });

  // electron-log 之外的 console.* 输出（各模块直接 console.log 的）也 1:1 转发
  const patch = (
    key: "log" | "info" | "warn" | "error",
    level: string,
  ): void => {
    const orig = console[key].bind(console);
    console[key] = (...args: unknown[]) => {
      try {
        emitMainLog(level, util.format(...args));
      } catch {
        /* ignore */
      }
      orig(...args);
    };
  };
  patch("log", "INFO");
  patch("info", "INFO");
  patch("warn", "WARNING");
  patch("error", "ERROR");
}

export function initLogger(): typeof log {
  if (initialized) return log;
  initialized = true;

  // 日志文件落到 userData/logs/{main,renderer}.log
  log.transports.file.resolvePathFn = (variables) => {
    return path.join(
      app.getPath("userData"),
      "logs",
      variables.fileName || "main.log",
    );
  };
  log.transports.file.maxSize = 5 * 1024 * 1024; // 5MB 滚动
  log.transports.file.level = "info";
  // 走 GlobalConsole 显示（不再直接打到终端；console.* 劫持负责 stdout 转发）
  log.transports.console.level = false;
  log.transports.console.format =
    "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}";

  // 接收渲染进程通过 electron-log/renderer 转发的日志
  log.initialize();

  // 主进程日志实时桥接到渲染端（GlobalConsole 1:1 显示）
  attachMainLogBridge();

  log.info(`[logger] initialized | userData=${app.getPath("userData")}`);
  return log;
}

export function installGlobalErrorHandlers(): void {
  process.on("uncaughtException", (err) => {
    log.error("[uncaughtException]", err);
  });
  process.on("unhandledRejection", (reason) => {
    log.error("[unhandledRejection]", reason);
  });
  app.on("render-process-gone", (_event, _wc, details) => {
    log.error("[render-process-gone]", details);
  });
  app.on("child-process-gone", (_event, details) => {
    log.error("[child-process-gone]", details);
  });
}

export { log };
