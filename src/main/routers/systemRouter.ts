import { app, Notification } from "electron";
import * as path from "path";
import * as fs from "fs";
import { t } from "../trpc";
import { getMainWindow } from "../windowState";

export const systemRouter = t.router({
  // 用户未设置时的默认媒体路径（跨平台兜底）
  getDefaultPaths: t.procedure.query(() => {
    const videos = app.getPath("videos");
    return {
      video_path: path.join(videos, "AVPlayPro") + path.sep,
      temp_path: path.join(app.getPath("temp"), "AVPlayPro") + path.sep,
    };
  }),

  // 主进程系统通知（绕过浏览器弹通知，能命中 Windows 行动中心）
  notify: t.procedure
    .input(
      (input: unknown) =>
        input as { title: string; body: string; silent?: boolean },
    )
    .mutation(({ input }) => {
      if (!Notification.isSupported()) return { success: false };
      const n = new Notification({
        title: input.title,
        body: input.body,
        silent: input.silent ?? true, // 系统声音由前端 tips.mp3 接管
      });
      n.on("click", () => {
        const win = getMainWindow();
        if (!win) return;
        if (win.isMinimized()) win.restore();
        if (!win.isVisible()) win.show();
        win.focus();
      });
      n.show();
      return { success: true };
    }),

  // 目标盘剩余空间（字节）。失败返回 -1
  getDiskFree: t.procedure
    .input((input: unknown) => input as { path: string })
    .query(async ({ input }) => {
      try {
        // 路径不存在时回退到其上级，直到找到一个存在的目录
        let probe = input.path;
        while (probe && !fs.existsSync(probe)) {
          const parent = path.dirname(probe);
          if (!parent || parent === probe) break;
          probe = parent;
        }
        if (!probe || !fs.existsSync(probe)) return { free: -1, total: -1 };
        const s = await fs.promises.statfs(probe);
        return { free: s.bsize * s.bavail, total: s.bsize * s.blocks };
      } catch {
        return { free: -1, total: -1 };
      }
    }),

  // 任务栏进度条（Win/Mac dock）
  setTaskbarProgress: t.procedure
    .input((input: unknown) => input as { progress: number })
    .mutation(({ input }) => {
      const win = getMainWindow();
      if (!win) return { success: false };
      // -1 清除, 0~1 正常, >1 不确定
      win.setProgressBar(input.progress);
      return { success: true };
    }),
});
