const { spawn } = require("child_process");
const url = "https://missav.ai/cn/start-631-uncensored-leak";
const child = spawn("cmd.exe", ["/d","/s","/c", `curl -sL --compressed --max-time 60 "${url}" -w "__ST__%{http_code}"`], {
  windowsHide: true,
  windowsVerbatimArguments: true,
});
let out = "";
child.stdout.on("data", (c) => (out += c));
child.on("close", () => {
  const m = out.lastIndexOf("__ST__");
  const status = m !== -1 ? out.slice(m + 6, m + 9) : "?";
  const body = m !== -1 ? out.slice(0, m) : out;
  console.log("status:", status, "len:", body.length);
  const challenge = /just a moment|challenge-platform/i.test(body);
  console.log("challenge:", challenge);
  // 粗查 packed eval 与 m3u8
  console.log("has packed eval:", /eval\(function\(p,a,c,k,e,.{1,3}\)/.test(body));
  const wxh = [...body.matchAll(/(\d{3,4})x(\d{3,4})/g)].slice(0, 8).map(x => x[0]);
  console.log("raw WxH matches:", [...new Set(wxh)].join(",") || "-");
  console.log("tail:", body.slice(-400).replace(/\s+/g," ").trim());
});
