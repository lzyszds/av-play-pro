import { protocol } from "electron";
import * as fs from "fs";
import { Readable } from "stream";
import { guessMime } from "./mediaMime";

export function setupLocalMediaProtocol(): void {
  protocol.handle("local-media", async (request) => {
    const url = request.url;
    try {
      // 由于 local-media 注册为 standard 协议，Chromium 会用「带 authority」的
      // 语义解析 URL。Windows 盘符 "M:" 会被当成 host:port，结果 host 变成 "m"、
      // 冒号和盘符丢失。因此需要把 host 还原成盘符：
      //   local-media://m/video/...     (host=m)        -> M:\video\...
      //   local-media:///M:/video/...   (host 为空)     -> M:\video\...
      const parsed = new URL(url);
      const host = parsed.hostname;
      let filePath: string;
      if (host && /^[a-z]$/i.test(host)) {
        // 盘符被解析成了 host
        filePath = `${host.toUpperCase()}:${decodeURIComponent(parsed.pathname)}`;
      } else {
        // 盘符保留在 path 中（如 /M:/video/...），去掉开头的斜杠
        filePath = decodeURIComponent(parsed.pathname).replace(/^\//, "");
      }

      if (process.platform === "win32") {
        filePath = filePath.replace(/\//g, "\\");
      }

      if (!filePath || !fs.existsSync(filePath)) {
        return new Response("File not found", { status: 404 });
      }

      const stat = fs.statSync(filePath);
      const total = stat.size;
      const contentType = guessMime(filePath);
      const rangeHeader = request.headers.get("range");

      // 处理 Range 请求（拖动进度条 / seek 需要 206 Partial Content）
      if (rangeHeader) {
        const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
        if (match) {
          const start = match[1] ? parseInt(match[1], 10) : 0;
          const end = match[2] ? parseInt(match[2], 10) : total - 1;
          if (start >= total || end >= total || start > end) {
            return new Response("Range Not Satisfiable", {
              status: 416,
              headers: { "Content-Range": `bytes */${total}` },
            });
          }
          const stream = fs.createReadStream(filePath, { start, end });
          return new Response(Readable.toWeb(stream) as ReadableStream, {
            status: 206,
            headers: {
              "Content-Type": contentType,
              "Content-Length": String(end - start + 1),
              "Content-Range": `bytes ${start}-${end}/${total}`,
              "Accept-Ranges": "bytes",
            },
          });
        }
      }

      // 无 Range：整文件返回，但仍声明支持 Range，让媒体元素可 seek
      const stream = fs.createReadStream(filePath);
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(total),
          "Accept-Ranges": "bytes",
        },
      });
    } catch (err: any) {
      console.error(`[local-media] Error: ${err?.message}`);
      return new Response(`Error: ${err?.message}`, { status: 500 });
    }
  });
  console.log("[本地媒体] 已启用 local-media:// 协议");
}
