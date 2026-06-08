# Custom Installer (Tauri) for Electron apps

带自定义 UI 的安装器模板。把目标 Electron 项目的 `win-unpacked` 包进来，输出一个带漂亮安装界面 + 开始菜单 / 桌面快捷方式 / 卸载注册表的 `.exe`。

## 在 av-play-pro 中的用法

在 **av-play-pro 根目录** 一条命令出安装包：

```bash
npm run build:installer
```

它做的事：

1. `npm run build:unpack` — electron-builder 生成 `release/win-unpacked/`
2. `npm --prefix installer install` — 首次需要装 installer 的依赖
3. `npm --prefix installer run pack` — 运行 `scripts/pack.js`：
   - 读 `package.json` 的 `productName` / `version` / `author` / `build.appId`
   - 写入 `installer.config.json` + 同步 `src-tauri/tauri.conf.json`
   - 用 `resources/logo.png` 重新生成 Tauri 全套图标
   - 把 `win-unpacked` 压成 `src-tauri/payload/payload.zip`
   - 调 `tauri build`

最终产物在：

```
installer/src-tauri/target/release/bundle/nsis/*.exe
```

## 给其他 Electron 项目复用

把 `installer/` 整个拷贝到目标 Electron 项目根目录，目标项目 `package.json` 里加：

```json
"scripts": {
  "build:installer": "npm run build:unpack && npm --prefix installer install && npm --prefix installer run pack"
}
```

要求目标项目：

- 用 `electron-builder` 输出 `release/win-unpacked/`（默认 `directories.output = "release"`）
- 在 `package.json` 里有 `name` / `productName` / `version` / `build.appId`
- 提供一个 PNG 图标（`build.win.icon` / `resources/logo.png` / `build/logo.png` / `logo.png` 任一处）

## 命令参考

`scripts/pack.js` 支持：

- `--electron <path>` — 指定 electron 项目根目录（默认 `..`）
- `--skip-build` — 只刷新 payload + 配置，不调 `tauri build`（调试用）

## 安装器本身做了什么

- 选择安装路径 / 进度条 UI（React + framer-motion）
- 解压 payload → 安装目录
- 创建桌面 + 开始菜单快捷方式（带完整元数据，Win+S 搜得到）
- 调 `SHChangeNotify` 通知 Shell 立刻刷新
- 写入"应用和功能"卸载注册表项（含 `InstallLocation` / `EstimatedSize` / `NoModify` / `NoRepair` / `UninstallString`）
- 启动按钮调起新装好的 exe

## 改 UI 文案 / 视觉

UI 在 `src/App.tsx`。应用名、Publisher、版本等已经从 `installer.config.json` 动态读取（`get_app_config` Tauri 命令），不用改源码。如果想换品牌色、动画文案，直接改 `App.tsx` 即可。
