import log from "electron-log/main";
import { app } from "electron";
import * as path from "path";

let initialized = false;

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
  log.transports.console.level = app.isPackaged ? "warn" : "debug";
  log.transports.console.format =
    "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}";

  // 接收渲染进程通过 electron-log/renderer 转发的日志
  log.initialize();

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
