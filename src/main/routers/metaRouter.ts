import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import * as cheerio from "cheerio";
import { t } from "../trpc";
import { log } from "../logger";

// =================== 番号正则提取 ===================

interface CodeInfo {
  code: string; // 规范化番号，如 SSIS-001
  series: string | null;
  number: string | null;
  kind:
    | "standard" // XXX-001
    | "compact" // XXXNNN（无横线，重写为 XXX-NNN）
    | "fc2"
    | "heyzo"
    | "1pondo"
    | "caribbean"
    | "unknown";
}

const STRIP_SUFFIXES = [
  /-uncensored-leak$/i,
  /-uncensored$/i,
  /-leak$/i,
  /-hd$/i,
  /-c$/i,
  /-ch$/i,
];

function stripCommonSuffix(name: string): string {
  let s = name;
  for (const r of STRIP_SUFFIXES) s = s.replace(r, "");
  return s;
}

const RULES: Array<{ kind: CodeInfo["kind"]; re: RegExp; normalize: (m: RegExpMatchArray) => CodeInfo }> = [
  // FC2-PPV-1234567 / FC2PPV-1234567 / FC2PPV1234567
  {
    kind: "fc2",
    re: /\bFC2[\s\-_]?PPV[\s\-_]?(\d{6,8})\b/i,
    normalize: (m) => ({
      code: `FC2-PPV-${m[1]}`,
      series: "FC2-PPV",
      number: m[1],
      kind: "fc2",
    }),
  },
  // HEYZO-1234 / HEYZO 1234
  {
    kind: "heyzo",
    re: /\bHEYZO[\s\-_]?(\d{3,5})\b/i,
    normalize: (m) => ({
      code: `HEYZO-${m[1]}`,
      series: "HEYZO",
      number: m[1],
      kind: "heyzo",
    }),
  },
  // 1pondo-010122_001 / 1pondo_010122_001
  {
    kind: "1pondo",
    re: /\b1pondo[\s\-_]?(\d{6}[_-]\d{3})\b/i,
    normalize: (m) => ({
      code: `1pondo-${m[1].replace("-", "_")}`,
      series: "1pondo",
      number: m[1],
      kind: "1pondo",
    }),
  },
  // caribbean-012422-001 / caribbeancom 同款
  {
    kind: "caribbean",
    re: /\bcaribbean(?:com)?[\s\-_]?(\d{6}[\-_]\d{3})\b/i,
    normalize: (m) => ({
      code: `caribbean-${m[1].replace("_", "-")}`,
      series: "caribbean",
      number: m[1],
      kind: "caribbean",
    }),
  },
  // 标准 XXX-NNN(NN)
  {
    kind: "standard",
    re: /\b([A-Z]{2,6})-(\d{3,5})\b/i,
    normalize: (m) => ({
      code: `${m[1].toUpperCase()}-${m[2]}`,
      series: m[1].toUpperCase(),
      number: m[2],
      kind: "standard",
    }),
  },
  // 紧凑 XXXNNN(NN)（无横线），如 ABP123 → ABP-123
  {
    kind: "compact",
    re: /\b([A-Z]{2,6})(\d{3,5})\b/i,
    normalize: (m) => ({
      code: `${m[1].toUpperCase()}-${m[2]}`,
      series: m[1].toUpperCase(),
      number: m[2],
      kind: "compact",
    }),
  },
];

export function parseCode(rawName: string): CodeInfo | null {
  const cleaned = stripCommonSuffix(rawName.trim());
  for (const rule of RULES) {
    const m = cleaned.match(rule.re);
    if (m) return rule.normalize(m);
  }
  return null;
}

// =================== meta.json 读写 ===================

export interface VideoMeta {
  // 离线层
  code: string | null;
  series: string | null;
  number: string | null;
  kind: CodeInfo["kind"];
  rawName: string;
  format: string | null;
  fileSize: number | null;
  fileMtime: string | null;
  downloadedAt: string;
  savePath: string;
  sourceUrl?: string;
  referer?: string;
  refererSource?: string;
  resolution?: string;
  encryptionType?: string;
  actors?: string[]; // 演员列表
  title?: string; // 标题（已翻译，若是日文）
  originalTitle?: string; // 原始标题（翻译前）
  releaseDate?: string; // 发行日期 YYYY-MM-DD
  duration?: string; // 时长（如 "120分钟"）
  studio?: string; // 制作商 / 厂牌
  label?: string; // 发行商
  studioSeries?: string; // 厂商系列名（区别于代号系列 series）
  director?: string; // 导演
  genres?: string[]; // 类别/标签
  rating?: number; // 评分 0-10
  plot?: string; // 剧情简介
  sampleImages?: string[]; // 样图 URL 列表
  sourceSite?: string; // 刮削来源（JavBus / JavDB ...）
  scrapedAt?: string; // 刮削时间 ISO
  // 版本号便于未来迁移
  schemaVersion: 1;
}

function metaPath(folder: string): string {
  return path.join(folder, "meta.json");
}

function statVideoFile(folder: string): {
  fileName: string | null;
  size: number | null;
  mtime: string | null;
  format: string | null;
} {
  try {
    const files = fs.readdirSync(folder);
    const videoExt = [".mp4", ".mkv", ".ts", ".m4v"];
    const video = files.find((f) => videoExt.includes(path.extname(f).toLowerCase()));
    if (!video) return { fileName: null, size: null, mtime: null, format: null };
    const full = path.join(folder, video);
    const s = fs.statSync(full);
    return {
      fileName: video,
      size: s.size,
      mtime: s.mtime.toISOString(),
      format: path.extname(video).slice(1).toUpperCase(),
    };
  } catch {
    return { fileName: null, size: null, mtime: null, format: null };
  }
}

function buildMeta(input: {
  saveDir: string;
  rawName: string;
  sourceUrl?: string;
  referer?: string;
  refererSource?: string;
  resolution?: string;
  encryptionType?: string;
  format?: string;
  actors?: string[];
  title?: string;
}): VideoMeta {
  const parsed = parseCode(input.rawName) || parseCode(path.basename(input.saveDir)) || null;
  const stat = statVideoFile(input.saveDir);
  return {
    code: parsed?.code ?? null,
    series: parsed?.series ?? null,
    number: parsed?.number ?? null,
    kind: parsed?.kind ?? "unknown",
    rawName: input.rawName,
    format: input.format || stat.format,
    fileSize: stat.size,
    fileMtime: stat.mtime,
    downloadedAt: new Date().toISOString(),
    savePath: input.saveDir,
    sourceUrl: input.sourceUrl,
    referer: input.referer,
    refererSource: input.refererSource,
    resolution: input.resolution,
    encryptionType: input.encryptionType,
    actors: input.actors || [],
    title: input.title,
    schemaVersion: 1,
  };
}

function writeMetaFile(folder: string, meta: VideoMeta): void {
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(metaPath(folder), JSON.stringify(meta, null, 2), "utf8");
}

// =================== Router ===================

export const metaRouter = t.router({
  parseCode: t.procedure
    .input((input: unknown) => input as { name: string })
    .query(({ input }) => parseCode(input.name)),

  // 单个写入（下载完成时由前端调用）
  writeForTask: t.procedure
    .input(
      (input: unknown) =>
        input as {
          saveDir: string;
          rawName: string;
          sourceUrl?: string;
          referer?: string;
          refererSource?: string;
          resolution?: string;
          encryptionType?: string;
          format?: string;
          actors?: string[];
          title?: string;
        },
    )
    .mutation(({ input }) => {
      try {
        const meta = buildMeta(input);
        writeMetaFile(input.saveDir, meta);
        log.info(`[meta] write ${input.saveDir} code=${meta.code}`);
        return { success: true, meta };
      } catch (err: any) {
        log.error(`[meta] write failed: ${err?.message}`);
        return { success: false, error: err?.message || String(err) };
      }
    }),

  // 基于番号智能重命名文件夹
  renameFolderByCode: t.procedure
    .input(
      (input: unknown) =>
        input as { folderPath: string; rootPath: string },
    )
    .mutation(({ input }) => {
      try {
        const { folderPath, rootPath } = input;
        const currentName = path.basename(folderPath);
        const parsed = parseCode(currentName);
        if (!parsed || !parsed.code) {
          return { success: false, error: "无法识别番号" };
        }

        // 读取现有 meta 获取标题和演员（如果有）
        let meta: VideoMeta | null = null;
        const mPath = metaPath(folderPath);
        if (fs.existsSync(mPath)) {
          meta = JSON.parse(fs.readFileSync(mPath, "utf8"));
        }

        let newName = parsed.code;
        // 如果 meta 中有 actors 和 title 就用
        if (meta?.actors && meta.actors.length > 0) {
          newName += ` [${meta.actors.join(", ")}]`;
        }
        if (meta?.title) {
          newName += ` ${meta.title}`;
        }
        // 如果没有，尝试从现有的文件夹名称里提取（例如现有的名称已经包含了名字）
        // 这里提供一个后备方案，如果名称里有中文字符，可能就是标题或演员
        if (!meta?.actors?.length && !meta?.title) {
           const suffix = currentName.replace(parsed.code, "").trim();
           if (suffix && suffix.length > 0) {
              newName = `${parsed.code} ${suffix}`;
           }
        }
        
        // 移除非法字符
        newName = newName.replace(/[\\/:*?"<>|]/g, "_").trim();
        
        if (newName === currentName) {
          return { success: true, renamed: false, newPath: folderPath };
        }

        const newPath = path.join(rootPath, newName);
        if (fs.existsSync(newPath)) {
          return { success: false, error: `目标文件夹已存在: ${newName}` };
        }

        fs.renameSync(folderPath, newPath);
        
        // 更新 meta.json 中的 savePath
        if (meta) {
          meta.savePath = newPath;
          writeMetaFile(newPath, meta);
        }

        return { success: true, renamed: true, newPath };
      } catch (err: any) {
        return { success: false, error: err?.message || String(err) };
      }
    }),

  // 从网络获取元数据（超级刮削器：多源 Fallback）
  scrapeMetadata: t.procedure
    .input((input: unknown) => input as { folderPath: string; proxyUrl?: string })
    .mutation(async ({ input }) => {
      try {
        const { folderPath } = input;
        const currentName = path.basename(folderPath);
        
        let meta: VideoMeta | null = null;
        const mPath = metaPath(folderPath);
        if (fs.existsSync(mPath)) {
          meta = JSON.parse(fs.readFileSync(mPath, "utf8"));
        }

        const parsed = meta?.code ? parseCode(meta.code) : parseCode(currentName);
        if (!parsed || !parsed.code) {
          return { success: false, error: "无法从文件名中提取规范番号" };
        }

        const code = parsed.code.toUpperCase();
        log.info(`[scraper] ============ 开始刮削 ${code} ============`);

        let title: string | undefined;
        let actors: string[] = [];
        let coverUrl: string | undefined;
        let sourceSite = "";
        const sourceErrors: string[] = [];

        // 扩展字段
        let releaseDate: string | undefined;
        let duration: string | undefined;
        let studio: string | undefined;
        let label: string | undefined;
        let studioSeries: string | undefined;
        let director: string | undefined;
        let genres: string[] = [];
        let rating: number | undefined;
        let plot: string | undefined;
        let sampleImages: string[] = [];

        // 通用：把 JavBus 风格的"标签:值"信息行解析进局部变量
        const parseJavBusInfoBlock = ($: cheerio.CheerioAPI) => {
          $(".info p").each((_, el) => {
            const headerText = $(el).find(".header").first().text().trim();
            const text = $(el).text().replace(headerText, "").trim();
            if (!headerText) return;
            if (/識別碼|识别码/.test(headerText)) return;
            if (/發行日期|发行日期|日期/.test(headerText)) {
              const m = text.match(/(\d{4}-\d{1,2}-\d{1,2})/);
              if (m) releaseDate ||= m[1];
            } else if (/長度|长度|时长/.test(headerText)) {
              duration ||= text;
            } else if (/導演|导演/.test(headerText)) {
              director ||= $(el).find("a").text().trim() || text;
            } else if (/製作商|制作商|片商/.test(headerText)) {
              studio ||= $(el).find("a").text().trim() || text;
            } else if (/發行商|发行商|廠牌|厂牌/.test(headerText)) {
              label ||= $(el).find("a").text().trim() || text;
            } else if (/系列/.test(headerText)) {
              studioSeries ||= $(el).find("a").text().trim() || text;
            }
          });
          // 类别 / 标签：紧跟 <p class="header">類別:</p> 后的 .genre
          $(".genre a, .genre label a").each((_, el) => {
            const g = $(el).text().trim();
            if (g && !genres.includes(g)) genres.push(g);
          });
          // 样图：JavBus 用 .sample-box 的 href 指向高清原图
          $(".sample-box").each((_, el) => {
            const href = $(el).attr("href");
            if (href && !sampleImages.includes(href)) sampleImages.push(href);
          });
        };

        const UA =
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
        const baseHeaders = {
          "User-Agent": UA,
          "Accept":
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7",
          "Accept-Encoding": "gzip, deflate, br",
          "Cache-Control": "no-cache",
          "Pragma": "no-cache",
          "Upgrade-Insecure-Requests": "1",
          "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Sec-Fetch-User": "?1",
          "DNT": "1",
        };

        // 代理选取顺序：
        //   1. input.proxyUrl（前端显式传入）
        //   2. 环境变量 HTTPS_PROXY / HTTP_PROXY
        //   3. 探测本地常见代理端口（Clash 7890 / V2Ray 10809）作为兜底
        const probeLocalProxy = async (): Promise<string | null> => {
          const net = require("net");
          const candidates = [
            ["127.0.0.1", 7890], // Clash 默认
            ["127.0.0.1", 10809], // V2Ray 默认
            ["127.0.0.1", 1080], // 通用 SOCKS/HTTP
          ];
          for (const [host, port] of candidates) {
            const ok = await new Promise<boolean>((resolve) => {
              const sock = new net.Socket();
              const done = (v: boolean) => {
                sock.destroy();
                resolve(v);
              };
              sock.setTimeout(500);
              sock.once("connect", () => done(true));
              sock.once("timeout", () => done(false));
              sock.once("error", () => done(false));
              sock.connect(port as number, host as string);
            });
            if (ok) return `http://${host}:${port}`;
          }
          return null;
        };

        let proxyUrlRaw =
          input.proxyUrl?.trim() ||
          process.env.HTTPS_PROXY ||
          process.env.https_proxy ||
          process.env.HTTP_PROXY ||
          process.env.http_proxy ||
          "";
        let proxySource = proxyUrlRaw
          ? input.proxyUrl?.trim()
            ? "input.proxyUrl"
            : "环境变量"
          : "";

        if (!proxyUrlRaw) {
          const probed = await probeLocalProxy();
          if (probed) {
            proxyUrlRaw = probed;
            proxySource = "本地端口探测";
          }
        }

        let httpsAgent: any = undefined;
        if (proxyUrlRaw) {
          try {
            const { HttpsProxyAgent } = require("https-proxy-agent");
            httpsAgent = new HttpsProxyAgent(proxyUrlRaw);
            log.info(`[scraper] 使用代理: ${proxyUrlRaw} (来源: ${proxySource})`);
          } catch (e: any) {
            log.warn(`[scraper] 代理初始化失败 (${proxyUrlRaw}): ${e?.message}`);
          }
        } else {
          log.info(`[scraper] 未配置代理，且本地 7890/10809/1080 均未监听`);
        }

        const fetchHtml = async (
          siteName: string,
          url: string,
          extraHeaders: Record<string, string> = {},
          timeout = 15000,
        ): Promise<cheerio.CheerioAPI | null> => {
          const started = Date.now();
          log.info(`[scraper][${siteName}] GET ${url}`);
          try {
            const res = await axios.get(url, {
              timeout,
              maxRedirects: 5,
              httpsAgent,
              proxy: httpsAgent ? false : undefined, // 用 agent 时禁用 axios 自带 proxy 逻辑
              headers: { ...baseHeaders, ...extraHeaders },
              validateStatus: (s) => s >= 200 && s < 400,
              responseType: "text",
            });
            const ms = Date.now() - started;
            const finalUrl = res.request?.res?.responseUrl || url;
            const bytes = typeof res.data === "string" ? res.data.length : 0;
            log.info(
              `[scraper][${siteName}] ← ${res.status} ${ms}ms ${bytes}B  final=${finalUrl}`,
            );
            return cheerio.load(res.data);
          } catch (e: any) {
            const ms = Date.now() - started;
            const status = e?.response?.status;
            const code = e?.code; // ETIMEDOUT / ECONNRESET / ENOTFOUND ...
            const msg = status ? `HTTP ${status}` : code || e?.message || String(e);
            sourceErrors.push(`${siteName}: ${msg}`);
            log.warn(`[scraper][${siteName}] ✗ ${ms}ms ${msg}`);
            return null;
          }
        };

        // --- 策略 1: JavBus（多镜像兜底）---
        {
          const javbusDomains = ["www.javbus.com", "www.javbus.org", "javbus.org"];
          let $: cheerio.CheerioAPI | null = null;
          for (const domain of javbusDomains) {
            $ = await fetchHtml(
              "JavBus",
              `https://${domain}/${code}`,
              { Cookie: "existmag=all; age=verified" },
              10000,
            );
            if ($) break;
            log.info(`[scraper][JavBus] ${domain} 失败，尝试下一个镜像`);
          }
          if ($) {
            const h3 = $("h3").first().text().trim();
            const actorEls = $(".avatar-box .star-name a, .star-name a").length;
            log.info(`[scraper][JavBus] 解析: h3="${h3.slice(0, 60)}" 演员节点=${actorEls}`);
            if (h3) {
              title = h3.replace(new RegExp(`^${code}\\s*`, "i"), "").trim();
              $(".avatar-box .star-name a, .star-name a").each((_, el) => {
                const name = $(el).text().trim();
                if (name && !actors.includes(name)) actors.push(name);
              });
              coverUrl = $(".bigImage img").attr("src") || $(".bigImage").attr("href");
              parseJavBusInfoBlock($);
              log.info(
                `[scraper][JavBus] 扩展: date=${releaseDate || "-"} dur=${duration || "-"} studio=${studio || "-"} genres=${genres.length} samples=${sampleImages.length}`,
              );
              if (title || actors.length > 0) sourceSite = "JavBus";
            } else {
              sourceErrors.push("JavBus: 详情页未找到 h3");
            }
          }
        }

        // --- 策略 2: JavLibrary ---
        if (!title && !actors.length) {
          const $ = await fetchHtml(
            "JavLibrary",
            `https://www.javlibrary.com/cn/vl_searchbyid.php?keyword=${encodeURIComponent(code)}`,
            { Cookie: "over18=18" },
            15000,
          );
          if ($) {
            log.info(
              `[scraper][JavLibrary] 解析: #video_title=${$("#video_title").length} .video=${$(".video").length}`,
            );
            if ($("#video_title").length) {
              title = $("#video_title a").text().replace(new RegExp(`^${code}\\s*`, "i"), "").trim();
              $("#video_cast .star a, span.star a").each((_, el) => {
                const name = $(el).text().trim();
                if (name && !actors.includes(name)) actors.push(name);
              });
              coverUrl = $("#video_jacket_img").attr("src");
              if (title || actors.length > 0) sourceSite = "JavLibrary";
            } else {
              const firstHref = $(".video a").first().attr("href");
              if (firstHref) {
                const detailUrl = new URL(firstHref, "https://www.javlibrary.com/cn/").toString();
                const $$ = await fetchHtml("JavLibrary", detailUrl, { Cookie: "over18=18" }, 15000);
                if ($$) {
                  title = $$("#video_title a").text().replace(new RegExp(`^${code}\\s*`, "i"), "").trim();
                  $$("#video_cast .star a, span.star a").each((_, el) => {
                    const name = $$(el).text().trim();
                    if (name && !actors.includes(name)) actors.push(name);
                  });
                  coverUrl = $$("#video_jacket_img").attr("src");
                  if (title || actors.length > 0) sourceSite = "JavLibrary";
                }
              } else {
                sourceErrors.push("JavLibrary: 无匹配结果");
              }
            }
          }
        }

        // --- 策略 3: MissAV ---
        if (!title && !actors.length) {
          const $ = await fetchHtml("MissAV", `https://missav.ai/cn/${code.toLowerCase()}`, {}, 12000);
          if ($) {
            const h1 = $("h1").first().text().trim();
            log.info(`[scraper][MissAV] 解析: h1="${h1.slice(0, 60)}"`);
            if (h1) {
              title = h1.replace(new RegExp(`^${code}\\s*`, "i"), "").trim();
              $('a[href*="/actresses/"], a[href*="/actors/"]').each((_, el) => {
                const name = $(el).text().trim();
                if (name && !actors.includes(name)) actors.push(name);
              });
              coverUrl =
                $('meta[property="og:image"]').attr("content") ||
                $("video").attr("poster") ||
                $("video").attr("data-poster");
              if (title || actors.length > 0) sourceSite = "MissAV";
            } else {
              sourceErrors.push("MissAV: 未找到 h1");
            }
          }
        }

        // --- 策略 4: JavDB（CN 友好，反爬较轻）---
        if (!title && !actors.length) {
          const $search = await fetchHtml(
            "JavDB",
            `https://javdb.com/search?q=${encodeURIComponent(code)}&f=all`,
            { Cookie: "over18=1; locale=zh" },
            12000,
          );
          if ($search) {
            const firstHref = $search(".movie-list .item a").first().attr("href");
            log.info(`[scraper][JavDB] 搜索结果首条 href=${firstHref || "无"}`);
            if (firstHref) {
              const detailUrl = new URL(firstHref, "https://javdb.com/").toString();
              const $$ = await fetchHtml("JavDB", detailUrl, { Cookie: "over18=1; locale=zh" }, 12000);
              if ($$) {
                title = $$(".title.is-4 .current-title").text().trim() ||
                        $$("h2.title").text().replace(new RegExp(`^${code}\\s*`, "i"), "").trim();
                $$('.panel-block a[href*="/actors/"]').each((_, el) => {
                  const name = $$(el).text().trim();
                  if (name && !actors.includes(name)) actors.push(name);
                });
                coverUrl = $$(".video-cover").attr("src") ||
                           $$('img.video-cover, .column-video-cover img').first().attr("src");

                // JavDB 信息面板：每个 .panel-block 有 <strong>标签:</strong><span>值</span>
                $$(".movie-panel-info .panel-block").each((_, el) => {
                  const k = $$(el).find("strong").text().trim();
                  const vRaw = $$(el).find(".value").text().trim() || $$(el).text().replace(k, "").trim();
                  if (!k) return;
                  if (/日期|Date/i.test(k)) {
                    const m = vRaw.match(/(\d{4}-\d{1,2}-\d{1,2})/);
                    if (m) releaseDate ||= m[1];
                  } else if (/時長|时长|Duration/i.test(k)) {
                    duration ||= vRaw;
                  } else if (/導演|导演|Director/i.test(k)) {
                    director ||= $$(el).find("a").text().trim() || vRaw;
                  } else if (/片商|製作|制作|Maker/i.test(k)) {
                    studio ||= $$(el).find("a").text().trim() || vRaw;
                  } else if (/發行|发行|Publisher/i.test(k)) {
                    label ||= $$(el).find("a").text().trim() || vRaw;
                  } else if (/系列|Series/i.test(k)) {
                    studioSeries ||= $$(el).find("a").text().trim() || vRaw;
                  } else if (/評分|评分|Rating/i.test(k)) {
                    const m = vRaw.match(/([\d.]+)/);
                    if (m) rating ||= parseFloat(m[1]);
                  } else if (/類別|类别|Tag/i.test(k)) {
                    $$(el).find("a").each((__, a) => {
                      const g = $$(a).text().trim();
                      if (g && !genres.includes(g)) genres.push(g);
                    });
                  }
                });
                // 样图
                $$(".preview-images a, .tile-images a, .tile-images img").each((_, el) => {
                  const src = $$(el).attr("href") || $$(el).attr("data-src") || $$(el).attr("src");
                  if (src && !sampleImages.includes(src)) sampleImages.push(src);
                });
                log.info(
                  `[scraper][JavDB] 扩展: date=${releaseDate || "-"} dur=${duration || "-"} studio=${studio || "-"} rating=${rating ?? "-"} genres=${genres.length} samples=${sampleImages.length}`,
                );
                if (title || actors.length > 0) sourceSite = "JavDB";
              }
            } else {
              sourceErrors.push("JavDB: 无搜索结果");
            }
          }
        }

        // --- 翻译：标题若含日文假名/纯日文，调 Google Translate 翻成中文 ---
        // 通过同一个代理走，免 key
        const hasJapanese = (s: string) => /[぀-ゟ゠-ヿ]/.test(s);
        const translateToZh = async (text: string): Promise<string | null> => {
          if (!text) return null;
          const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`;
          try {
            const started = Date.now();
            const res = await axios.get(url, {
              timeout: 10000,
              httpsAgent,
              proxy: httpsAgent ? false : undefined,
              headers: { "User-Agent": UA },
            });
            const ms = Date.now() - started;
            // 响应是嵌套数组：[[[ "译文", "原文", ...], ...], ...]
            const segs = res.data?.[0];
            if (Array.isArray(segs)) {
              const translated = segs.map((s: any[]) => s?.[0] || "").join("").trim();
              log.info(`[scraper][translate] ${ms}ms "${text.slice(0, 30)}" → "${translated.slice(0, 30)}"`);
              return translated || null;
            }
            return null;
          } catch (e: any) {
            log.warn(`[scraper][translate] 失败: ${e?.message || e}`);
            return null;
          }
        };

        if (title && hasJapanese(title)) {
          const zh = await translateToZh(title);
          if (zh) title = zh;
        }

        log.info(
          `[scraper] ============ 结束 ${code}: 命中=${sourceSite || "无"} 标题="${(title || "").slice(0, 40)}" 演员=${actors.length} ============`,
        );

        if (!title && !actors.length) {
          return {
            success: false,
            error: `所有源均未命中 ${code}：${sourceErrors.join(" | ") || "未知原因"}`,
          };
        }

        // 数据清洗：移除标题中常见的冗余前缀后缀
        title = title?.replace(/[\[\(\{].*?[\]\)\}]/g, "").trim();

        // 翻译剧情简介（若有）
        if (plot && hasJapanese(plot)) {
          const zhPlot = await translateToZh(plot);
          if (zhPlot) plot = zhPlot;
        }

        const enrich = {
          releaseDate,
          duration,
          studio,
          label,
          studioSeries,
          director,
          genres: genres.length ? genres : undefined,
          rating,
          plot,
          sampleImages: sampleImages.length ? sampleImages : undefined,
          sourceSite: sourceSite || undefined,
          scrapedAt: new Date().toISOString(),
        };

        // 更新 Meta（已有字段优先保留旧值，避免回写空覆盖）
        const mergeNonEmpty = <T extends Record<string, any>>(base: T, add: Partial<T>): T => {
          const out: any = { ...base };
          for (const k of Object.keys(add)) {
            const v = (add as any)[k];
            if (v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0)) {
              if (out[k] === undefined || out[k] === null || out[k] === "") out[k] = v;
            }
          }
          return out;
        };

        let updatedMeta: VideoMeta;
        if (meta) {
          updatedMeta = mergeNonEmpty(
            {
              ...meta,
              code: meta.code || code,
              title: title || meta.title,
              originalTitle: meta.originalTitle,
              actors: actors.length ? actors : (meta.actors || []),
            } as VideoMeta,
            enrich as Partial<VideoMeta>,
          );
        } else {
          const stat = statVideoFile(folderPath);
          updatedMeta = mergeNonEmpty(
            {
              code,
              series: parsed.series,
              number: parsed.number,
              kind: parsed.kind,
              rawName: currentName,
              format: stat.format,
              fileSize: stat.size,
              fileMtime: stat.mtime,
              downloadedAt: new Date().toISOString(),
              savePath: folderPath,
              title,
              actors,
              schemaVersion: 1,
            } as VideoMeta,
            enrich as Partial<VideoMeta>,
          );
        }

        writeMetaFile(folderPath, updatedMeta);
        
        // 封面图补全
        let downloadedCover = false;
        if (coverUrl && !fs.existsSync(path.join(folderPath, "cover.jpg"))) {
           try {
              let fullCoverUrl = coverUrl;
              if (coverUrl.startsWith("//")) fullCoverUrl = "https:" + coverUrl;
              else if (!coverUrl.startsWith("http")) {
                 if (sourceSite === "JavBus") fullCoverUrl = `https://www.javbus.com${coverUrl}`;
              }
              const refererMap: Record<string, string> = {
                JavBus: "https://www.javbus.com/",
                JavLibrary: "https://www.javlibrary.com/",
                MissAV: "https://missav.ai/",
                JavDB: "https://javdb.com/",
              };
              const imgRes = await axios.get(fullCoverUrl, {
                responseType: "arraybuffer",
                timeout: 15000,
                headers: {
                  "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                  Referer: refererMap[sourceSite] || "",
                },
              });
              fs.writeFileSync(path.join(folderPath, "cover.jpg"), imgRes.data);
              downloadedCover = true;
           } catch (e) {}
        }

        const bits: string[] = [];
        if (actors.length) bits.push(`${actors.length} 位演员`);
        if (genres.length) bits.push(`${genres.length} 个标签`);
        if (releaseDate) bits.push(releaseDate);
        if (duration) bits.push(duration);
        if (studio) bits.push(studio);
        if (rating) bits.push(`★ ${rating.toFixed(1)}`);
        return {
          success: true,
          meta: updatedMeta,
          downloadedCover,
          message: `来自 ${sourceSite}：${bits.join(" · ") || "标题已写入"}`,
        };
      } catch (err: any) {
        log.error(`[scraper] 严重失败: ${err?.message}`);
        return { success: false, error: `刮削异常: ${err?.message || String(err)}` };
      }
    }),

  // 批量回填：扫描 rootPath 下所有子文件夹，缺 meta.json 的写入
  backfill: t.procedure
    .input(
      (input: unknown) =>
        input as { rootPath: string; overwrite?: boolean },
    )
    .mutation(({ input }) => {
      const result = {
        scanned: 0,
        skipped: 0, // 已存在 meta.json 且 overwrite=false
        written: 0,
        failed: 0,
        unmatched: 0, // 没识别到番号
        details: [] as Array<{
          folder: string;
          status: "written" | "skipped" | "failed" | "unmatched";
          code?: string | null;
          error?: string;
        }>,
      };
      try {
        if (!fs.existsSync(input.rootPath)) {
          return { ...result, error: "rootPath not found" };
        }
        const entries = fs.readdirSync(input.rootPath, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const folder = path.join(input.rootPath, entry.name);
          result.scanned++;
          const meta = metaPath(folder);
          if (fs.existsSync(meta) && !input.overwrite) {
            result.skipped++;
            result.details.push({ folder: entry.name, status: "skipped" });
            continue;
          }
          try {
            const built = buildMeta({ saveDir: folder, rawName: entry.name });
            writeMetaFile(folder, built);
            if (built.code) {
              result.written++;
              result.details.push({
                folder: entry.name,
                status: "written",
                code: built.code,
              });
            } else {
              result.unmatched++;
              result.details.push({
                folder: entry.name,
                status: "unmatched",
                code: null,
              });
            }
          } catch (err: any) {
            result.failed++;
            result.details.push({
              folder: entry.name,
              status: "failed",
              error: err?.message,
            });
          }
        }
        log.info(
          `[meta] backfill done: scanned=${result.scanned} written=${result.written} skipped=${result.skipped} unmatched=${result.unmatched} failed=${result.failed}`,
        );
        return result;
      } catch (err: any) {
        log.error(`[meta] backfill failed: ${err?.message}`);
        return { ...result, error: err?.message };
      }
    }),
});
