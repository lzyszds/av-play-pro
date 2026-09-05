/**
 * 为 electron-builder 注入国内镜像，避免打包时直连 GitHub 超时 (ETIMEDOUT)。
 * 用法: node scripts/run-electron-builder.mjs --win
 */
import { spawnSync } from "node:child_process";

const MIRROR = "https://npmmirror.com/mirrors/electron/";
const BUILDER_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/";

process.env.ELECTRON_MIRROR ??= MIRROR;
process.env.ELECTRON_BUILDER_BINARIES_MIRROR ??= BUILDER_MIRROR;
// @electron/get 也会读 npm 风格配置
process.env.npm_config_electron_mirror ??= MIRROR;
process.env.npm_config_electron_builder_binaries_mirror ??= BUILDER_MIRROR;

const args = process.argv.slice(2);
if (args.length === 0) args.push("--win");

console.log("[build] ELECTRON_MIRROR =", process.env.ELECTRON_MIRROR);
console.log("[build] ELECTRON_BUILDER_BINARIES_MIRROR =", process.env.ELECTRON_BUILDER_BINARIES_MIRROR);

const result = spawnSync("electron-builder", args, {
  stdio: "inherit",
  env: process.env,
  shell: true,
});

process.exit(result.status ?? 1);
