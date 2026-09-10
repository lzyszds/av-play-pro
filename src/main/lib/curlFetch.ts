import { spawn } from "child_process";

/**
 * 终端实验确认：curl（干净 UA + 系统 TLS/HTTP 指纹）可以直接通过
 * Cloudflare 拿到 r.jina.ai / missav 内容，而应用内的 session/axios
 * 请求会因 Electron 指纹被挑战（403「Just a moment」）或 DNS 污染卡死。
 * 这里封装系统 curl 子进程作为抓取兜底通道。Windows 上经 cmd.exe /c
 * 执行（与用户手工验证成功的环境一致），macOS/linux 直接调用 curl；
 * --max-time 控制超时，末尾用 -w 附加真实 HTTP 状态码。
 */

export interface CurlResult {
  status: number;
  body: string;
}

const STATUS_MARKER = "__AVPLAY__HTTP_STATUS__";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function curlFetchText(
  url: string,
  opts: {
    referer?: string;
    timeoutSec?: number;
    /** 额外请求头（如 ["x-return-format: html"]）；不要传 UA 类头（见上方注释） */
    headers?: string[];
  } = {},
): Promise<CurlResult> {
  const timeoutSec = opts.timeoutSec ?? 60;
  return new Promise((resolve, reject) => {
    // 关键：不要显式设置 UA！curl 的默认 UA（curl/8.x）与其自身 TLS/HTTP2
    // 指纹一致，r.jina.ai 前面的 Cloudflare 校验「UA 与指纹一致性」时会放行；
    // 反而我们之前伪装 Chrome UA + curl 指纹 = 假冒浏览器，直接被 403 挑战。
    // （手工终端 curl 成功正是因为没带 -A 参数）
    const args: string[] = ["-sL", "--compressed", "--max-time", String(timeoutSec)];
    for (const h of opts.headers ?? []) args.push("-H", h);
    if (opts.referer) args.push("-e", opts.referer);
    args.push("-w", `${STATUS_MARKER}%{http_code}`, url);

    // Windows 经 cmd.exe /c 执行（与手工验证成功的终端一致）：
    // 整条命令拼成单字符串后整体用引号包住传给 cmd（/s /c + verbatim），
    // URL 里的 & 与引用头里的空格都不会被拆；cmd.exe 命令行上下文里
    // 「%{http_code}」不是 %var% 模式，% 原样传给 curl，不能按批处理规则写 %%。
    let child: ReturnType<typeof spawn>;
    if (process.platform === "win32") {
      const cmdLine = ["curl", ...args]
        .map((a) => `"${String(a)}"`)
        .join(" ");
      child = spawn(
        "cmd.exe",
        ["/d", "/s", "/c", `"${cmdLine}"`],
        { windowsHide: true, windowsVerbatimArguments: true },
      );
    } else {
      child = spawn("curl", args, { windowsHide: true });
    }
    let out = "";
    let err = "";
    let settled = false;

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      out += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      err += chunk;
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      const m = out.lastIndexOf(STATUS_MARKER);
      if (m === -1) {
        reject(
          new Error(
            `curl 未返回状态码（exit=${code}）: ${(err || "").trim().slice(0, 120)}`,
          ),
        );
        return;
      }
      const statusStr = out
        .slice(m + STATUS_MARKER.length)
        .replace(/^[\r\n\s]+/, "")
        .slice(0, 3);
      if (!/^\d{3}$/.test(statusStr)) {
        reject(
          new Error(
            `curl 状态码解析失败（exit=${code}, got="${statusStr}"）: ${(err || "").trim().slice(0, 160)}`,
          ),
        );
        return;
      }
      const status = parseInt(statusStr, 10);
      const body = out.slice(0, m);
      if (status === 0) {
        reject(
          new Error(
            `curl 连接失败（exit=${code}）: ${(err || "").trim().slice(0, 120)}`,
          ),
        );
        return;
      }
      resolve({ status, body });
    });

    // 双保险：超过 max-time+5s 直接结束（--max-time 本身也生效）
    void sleep((timeoutSec + 5) * 1000).then(() => {
      if (!settled) {
        settled = true;
        try {
          child.kill();
        } catch {
          /* ignore */
        }
        reject(new Error(`curl 超时（${timeoutSec}s）`));
      }
    });
  });
}
