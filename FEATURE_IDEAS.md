# AVPlayPro 功能创意与迭代追踪库 (FEATURE_IDEAS)

> 本文档用于记录所有已提过、已实现、待实现以及明确排除的功能创意，避免未来重复建议。

---

## 一、 已实现功能 (Completed)

| 功能模块 | 功能描述 | 落地版本/组件 |
| :--- | :--- | :--- |
| **云端同步中心** | 基于 Cloudflare Workers + KV 的配置、播放/下载历史云端备份与恢复 | `syncRouter.ts`, `SettingsPanel.tsx` |
| **操作行为追踪** | 记录详细的用户播放、下载、贤者计时等操作轨迹流 | `activityRouter.ts`, `ActivityHistoryModal.tsx` |
| **年度作战报告 (Feature 7)** | 赛博朋克风战报弹窗，五维战斗力雷达图、巅峰时段、羁绊女优榜、一键存云 | `AnnualReportModal.tsx` |
| **媒体库整理器 (Feature 9)** | 0 磁盘占用软链接整理 Emby/Jellyfin/Kodi 标准目录，自动刮削并生成 `movie.nfo` | `organizerRouter.ts`, `OrganizerModal.tsx` |
| **现代化统计看板** | 5 大选项卡仪表盘（总览、排行榜、时段习惯、贤者分析、存储管理）+ GitHub 风入库热力图 | `StatsPage.tsx` |
| **指挥中心与体检** | 片库健康度自动打分、重复资源排查、无效文件清理与修复 | `CommandCenterPage.tsx` |

| **进度条高能热力曲线 (Feature 1)** | 播放器进度条上方呈现用户播放热度高能曲线，红黄渐变高潮精准识别 | `HlsVideoPlayer.tsx`, `PlayerHeatmap.tsx` |
| **视频卡片悬停动态微预览 (Feature 2)** | 本地视频卡片悬停 0.5 秒自动平滑循环播放 5 秒精彩高能切片，带扫描线 | `LocalVideoCard.tsx` |
| **赛博盲盒挑片轮盘 (Feature 3)** | 4 大盲盒奖池、阶梯减速翻牌、双重启动（支持高潮直达播放与从头播放） | `LuckyDraw.tsx`, `PlayerPage.tsx` |
| **播放器画质增强着色器 (Feature 4)** | CAS 超清锐化、温暖电影胶片、夜景暗部增强HDR、赛博高饱和及实时滑块微调 | `VideoShaderModal.tsx`, `HlsVideoPlayer.tsx` |
| **剧情时间轴分幕与 9 宫格速览 (Feature 5)** | 智能划分 6 大剧情推进章节，带时间段进度指示，9 宫格关键帧矩阵秒级跳转 | `SceneChaptersDrawer.tsx`, `PlayerPage.tsx` |
| **成就殿堂与勋章系统 (Feature 6)** | Steam/PS 风格 2 列式奖杯陈列馆，XP 等级进度条与稀有度徽章 | `achievementsRouter.ts`, `AchievementsPanel.tsx` |
| **全自动静默云端备份** | 启动应用时、退出前、最小化托盘自动备份至 Cloudflare KV，带 5s 保护 | `syncRouter.ts`, `main/index.ts`, `SettingsPanel.tsx` |
| **365 天双轨热力天图与节律驾驶舱** | 消除宽屏空旷，自适应双栏，年度连击/活跃周期洞察 + 实时悬停漫游聚焦 | `StatsPage.tsx` |

---

## 二、 明确排除/禁止再次提议的方向 (Blacklist / Discarded)

> ⚠️ **注意**：用户明确要求**不要再提以下任何方向**！

- ❌ **跨设备与多端联动类**（局域网手机遥控器、跨设备秒数同步、多端配对）—— **永久排除**
- ❌ **弹幕与评论类**（网络弹幕、同屏吐槽）—— **用户明确不需要，永久排除**
- ❌ **老板键与伪装类**（VS Code 拟态、Excel 报表伪装）—— **用户明确不需要，永久排除**

---

## 三、 创意储备库 (Backlog - 待未来选做)

| 编号 | 创意名称 | 核心玩法与价值 |
| :---: | :--- | :--- |
| **B1** | **🖼️ 以图搜番 · 截图反向识片入库** | 拖拽截图或网络动图进应用，自动反向检索识别番号、女优并一键发起极速下载。 |
| **B2** | **Whisper AI 日语生肉一键双语字幕** | 针对生肉片源调用本地 Whisper 提取语音并自动翻译挂载中文字幕。 |
| **B3** | **女优羁绊关系网拓扑图增强** | 强化 StarMap 星图，根据影片合作演员自动构建共演关系网络与推荐链。 |


