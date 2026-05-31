import * as fs from "fs";
import * as path from "path";
import { t } from "../trpc";

export interface VideoItem {
  id: string;
  name: string;
  url: string;
  resolution: string;
  encryptionType: string;
  coverUrl?: string;
  previewUrl?: string;
  size?: string;
  createdAt?: number;
}

function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}

export const videosRouter = t.router({
    list: t.procedure
      .input((input: unknown) => (input as { path?: string }) || {})
      .query(({ input }) => {
        const videoDir = input.path || "M:\\video\\videos\\";
        const videos: VideoItem[] = [];

        try {
          if (!fs.existsSync(videoDir)) return videos;

          const folders = fs.readdirSync(videoDir, { withFileTypes: true });
          for (const folder of folders) {
            if (!folder.isDirectory()) continue;

            const folderPath = path.join(videoDir, folder.name);
            let videoFile = path.join(folderPath, "video.mp4");

            if (!fs.existsSync(videoFile)) {
              const files = fs.readdirSync(folderPath, { withFileTypes: true });
              const exts = [
                "mp4",
                "mkv",
                "ts",
                "mov",
                "avi",
                "webm",
                "flv",
                "m4v",
              ];
              for (const f of files) {
                if (f.isFile()) {
                  const ext = path.extname(f.name).toLowerCase().slice(1);
                  if (
                    exts.includes(ext) &&
                    f.name.toLowerCase() !== "preview.mp4"
                  ) {
                    videoFile = path.join(folderPath, f.name);
                    break;
                  }
                }
              }
            }

            if (!fs.existsSync(videoFile)) continue;

            let videoSize = 0;
            let videoMtime = 0;
            try {
              const st = fs.statSync(videoFile);
              videoSize = st.size;
              // 用视频文件的修改时间作为「下载完成时间」，比文件夹 birthtime 更可靠
              videoMtime = st.mtimeMs;
            } catch {}

            let coverFile: string | undefined = undefined;
            for (const ext of [
              "jpg",
              "jpeg",
              "png",
              "webp",
              "gif",
              "bmp",
              "avif",
            ]) {
              const c = path.join(folderPath, `cover.${ext}`);
              if (fs.existsSync(c)) {
                coverFile = c;
                break;
              }
            }

            let previewFile: string | undefined = undefined;
            for (const ext of ["mp4", "webm", "gif", "mov", "m4v"]) {
              const p = path.join(folderPath, `preview.${ext}`);
              if (fs.existsSync(p)) {
                previewFile = p;
                break;
              }
            }

            videos.push({
              id: folder.name,
              name: folder.name,
              url: videoFile,
              resolution: "local",
              encryptionType: "decrypted",
              coverUrl: coverFile,
              previewUrl: previewFile,
              size: formatSize(videoSize),
              createdAt:
                videoMtime || fs.statSync(folderPath).birthtime.getTime(),
            });
          }
        } catch {}

        videos.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
        return videos;
      }),

    // Delete local video folder
    delete: t.procedure
      .input(
        (input: unknown) => input as { folderPath: string; rootPath?: string },
      )
      .mutation(({ input }) => {
        const { folderPath, rootPath } = input;
        try {
          if (!fs.existsSync(folderPath)) {
            return { success: false, error: "文件夹不存在" };
          }
          const resolvedFolderPath = path.resolve(folderPath);
          const resolvedRoot = path.resolve(rootPath || "M:\\video\\videos\\");
          const relative = path.relative(resolvedRoot, resolvedFolderPath);
          const isUnderRoot =
            relative !== "" &&
            !relative.startsWith("..") &&
            !path.isAbsolute(relative);

          if (!isUnderRoot) {
            return {
              success: false,
              error: "Delete path is outside video root directory",
            };
          }

          if (path.dirname(resolvedFolderPath) !== resolvedRoot) {
            return {
              success: false,
              error: "Only first-level child folders can be deleted",
            };
          }

          fs.rmSync(resolvedFolderPath, { recursive: true, force: true });
          console.log(`[videos.delete] deleted ${resolvedFolderPath}`);
          return { success: true, error: undefined as string | undefined };
        } catch (err: any) {
          console.error(`[删除视频] 失败: ${err.message}`);
          return { success: false, error: err.message };
        }
      }),
  });
