const { spawn } = require("child_process");
// 最简形态：和你手工执行的 `curl -L <url>` 一致（默认 UA、无任何附加头）
const url = 'https://r.jina.ai/https://missav.ai/dm628/cn/uncensored-leak?page=1';
const child = spawn("cmd.exe", ["/d", "/s", "/c", `curl -L "${url}"`], {
  windowsHide: true,
  windowsVerbatimArguments: true,
});
let out = "";
child.stdout.on("data", (c) => (out += c));
child.stderr.on("data", (c) => (out += ""));
child.on("close", (code) => {
  console.log("exit:", code, "len:", out.length);
  console.log("head:", out.slice(0, 400).replace(/\s+/g, " "));
});
