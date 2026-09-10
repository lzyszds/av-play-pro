const { spawn } = require("child_process");
// 默认 UA + 仅加 x-return-format 头（保持 curl 原生 UA 指纹）
const url = 'https://r.jina.ai/https://missav.ai/dm628/cn/uncensored-leak?page=1';
const child = spawn("cmd.exe", ["/d", "/s", "/c", `curl -sL --compressed "${url}" -H "x-return-format: html" -w "__ST__%{http_code}"`], {
  windowsHide: true,
  windowsVerbatimArguments: true,
});
let out = "";
child.stdout.on("data", (c) => (out += c));
child.on("close", (code) => {
  const m = out.lastIndexOf("__ST__");
  console.log("exit:", code, "bodyLen:", m !== -1 ? m : out.length);
  console.log("status:", m !== -1 ? out.slice(m + 6, m + 9) : "?");
  console.log("head:", out.slice(0, 300).replace(/\s+/g, " "));
});
