const { spawn } = require("child_process");

const STATUS_MARKER = "__AVPLAY__HTTP_STATUS__";
const url = 'https://r.jina.ai/https://missav.ai/dm628/cn/uncensored-leak?page=1';
const args = [
  "-sL",
  "--compressed",
  "--max-time",
  "60",
  "-A",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
  "-H",
  "Accept: text/html,application/xhtml+xml,*/*",
  "-H",
  "x-return-format: html",
  "-w",
  STATUS_MARKER + "%{http_code}",
  url,
];
const cmdLine = ["curl", ...args].map((a) => `"${String(a)}"`).join(" ");
console.log("CMD:", "cmd.exe /d /s /c " + `"${cmdLine}"\n`);
const child = spawn("cmd.exe", ["/d", "/s", "/c", `"${cmdLine}"`], {
  windowsHide: true,
  windowsVerbatimArguments: true,
});
let out = "";
let err = "";
child.stdout.on("data", (c) => (out += c));
child.stderr.on("data", (c) => (err += c));
child.on("close", (code) => {
  console.log("exit:", code, "stderr:", err.trim().slice(0, 300));
  const m = out.lastIndexOf(STATUS_MARKER);
  console.log("marker found:", m !== -1);
  if (m !== -1) {
    console.log("status raw:", JSON.stringify(out.slice(m + STATUS_MARKER.length, m + STATUS_MARKER.length + 12)));
    console.log("body head:", out.slice(0, 500).replace(/\s+/g, " "));
    console.log("body len:", m);
  }
});
