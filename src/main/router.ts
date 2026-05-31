/**
 * tRPC Router - 涓昏繘绋嬫湇鍔＄
 * 鎵€鏈変笟鍔￠€昏緫閫氳繃 tRPC procedures 鏆撮湶缁欐覆鏌撹繘绋? */

import { initTRPC } from '@trpc/server'
import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import * as http from 'http'
import { spawn, ChildProcess } from 'child_process'
import { app, dialog, BrowserWindow } from 'electron'

const t = initTRPC.create()

// ============ 绫诲瀷瀹氫箟 ============

export interface DownloadPayload {
  url: string
  saveDir: string
  saveName: string
  format: string
  threads: number
  headers?: string
  tmpDir?: string
  proxyUrl?: string
  toolPath?: string
  autoMerge?: boolean
}

export interface ProgressPayload {
  line: string
  percent: number | null
  done: boolean
  success: boolean
}

export interface VideoItem {
  id: string
  name: string
  url: string
  resolution: string
  encryptionType: string
  coverUrl?: string
  previewUrl?: string
  size?: string
}

// ============ 鍏ㄥ眬鐘舵€?============

let downloadProcess: ChildProcess | null = null
let downloadPid: number | null = null  // 璁板綍瀹為檯 PID锛屽嵆浣?process 瀵硅薄琚竻绌?let mainWindow: BrowserWindow | null = null
let progressCallbacks: Array<(data: ProgressPayload) => void> = []
// 灏侀潰/棰勮涓嬭浇涓茶闃熷垪锛氫繚璇佷换鎰忔椂鍒诲彧鏈変竴涓换鍔″湪璺戯紝閬垮厤骞跺彂浜х敓鐨勫兊灏歌秴鏃舵棩蹇?let coverChain: Promise<unknown> = Promise.resolve()

export function setMainWindow(win: BrowserWindow) {
  mainWindow = win
}

// ============ 宸ュ叿鍑芥暟 ============

function resolveToolPath(customPath?: string): string | null {
  const candidates: string[] = []
  if (customPath) {
    const p = customPath.trim()
    if (p) {
      if (path.isAbsolute(p)) {
        candidates.push(p)
      } else {
        candidates.push(path.resolve(process.cwd(), p))
        const exeDir = path.dirname(app.getPath('exe'))
        candidates.push(path.join(exeDir, p))
        candidates.push(path.join(exeDir, 'bin', p))
      }
    }
  }
  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, 'bin', 'N_m3u8DL-RE.exe'))
  }
  candidates.push(path.join(__dirname, '../../bin/N_m3u8DL-RE.exe'))
  const exeDir = path.dirname(app.getPath('exe'))
  candidates.push(path.join(exeDir, 'bin', 'N_m3u8DL-RE.exe'))
  candidates.push(path.join(exeDir, 'N_m3u8DL-RE.exe'))
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return null
}

function sanitizeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_')
}

function parsePercent(line: string): number | null {
  const match = line.match(/(\d+\.?\d*)%/)
  return match ? parseFloat(match[1]) : null
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim()
}

function killProcessTree(pid: number): void {
  if (!pid) return
  try {
    // /T 鏉€鎺夋暣涓繘绋嬫爲锛堝寘鎷瓙杩涚▼锛?    spawn('taskkill', ['/F', '/T', '/PID', pid.toString()], { windowsHide: true, detached: true })
    console.log(`[killProcessTree] 宸插彂閫?taskkill /F /T /PID ${pid}`)
  } catch (err) {
    console.error('缁堟杩涚▼澶辫触:', err)
  }
}

function sendProgress(payload: ProgressPayload): void {
  progressCallbacks.forEach(cb => cb(payload))
  mainWindow?.webContents.send('download-progress', payload)
}

// ============ 灏侀潰/棰勮鏃ュ織锛氬啓鍏ユ枃浠?+ 瀹炴椂鎺ㄩ€?============
export interface CoverLogEntry {
  timestamp: string
  level: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR'
  text: string
}

function getCoverLogFilePath(): string {
  return path.join(app.getPath('userData'), 'cover-preview-logs.jsonl')
}

// 缁熶竴鐨勫皝闈?棰勮鏃ュ織锛氳拷鍔犲埌鏂囦欢锛屽悓鏃堕€氳繃 IPC 瀹炴椂鎺ㄩ€佸埌闈㈡澘
function clog(level: CoverLogEntry['level'], text: string): void {
  const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  const entry: CoverLogEntry = { timestamp, level, text }
  try {
    fs.appendFileSync(getCoverLogFilePath(), JSON.stringify(entry) + '\n')
  } catch {
    // 鏂囦欢鍐欏叆澶辫触涓嶅奖鍝嶄富娴佺▼
  }
  // 瀹炴椂鎺ㄩ€侊紙甯?[灏侀潰/棰勮] 鍓嶇紑锛屼緵鏈埛鏂扮殑闈㈡澘鍗虫椂鏄剧ず锛?  sendProgress({ line: `[灏侀潰/棰勮] ${text}`, percent: null, done: false, success: false })
}

// 鍏煎鏃ц皟鐢細rlog -> clog
function rlog(level: 'log' | 'warn' | 'error', ...args: unknown[]): void {
  const message = args
    .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.stack || a.message : JSON.stringify(a)))
    .join(' ')
  const mapped = level === 'error' ? 'ERROR' : level === 'warn' ? 'WARNING' : 'INFO'
  clog(mapped, message)
}

function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = bytes
  let i = 0
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++ }
  return `${size.toFixed(1)} ${units[i]}`
}

// ============ Router Procedures ============

export const appRouter = t.router({
  // 涓嬭浇绠＄悊
  download: t.router({
    start: t.procedure
      .input((input: unknown) => input as DownloadPayload)
      .mutation(async ({ input }) => {
        const toolPath = resolveToolPath(input.toolPath)
        if (!toolPath) {
          sendProgress({ line: '[ERROR] N_m3u8DL-RE.exe not found. Please check your bin directory and tool path.', percent: null, done: true, success: false })
          throw new Error('N_m3u8DL-RE.exe not found')
        }

        const tmpDir = input.tmpDir || path.join(input.saveDir, 'temp')
        const args: string[] = [
          input.url,
          '--save-name', sanitizeName(input.saveName),
          '--save-dir', input.saveDir,
          '--tmp-dir', tmpDir,
          '--thread-count', input.threads.toString(),
          '--auto-select',
        ]

        if (input.format === 'MP4') {
          args.push('--mp4-real-time-decryption')
        }

        if (input.autoMerge === false) {
          args.push('--skip-merge')
        }

        if (input.proxyUrl?.trim()) {
          args.push('--custom-proxy', input.proxyUrl.trim())
        }

        if (input.headers) {
          try {
            const headersMap = JSON.parse(input.headers) as Record<string, string>
            for (const [key, value] of Object.entries(headersMap)) {
              if (value) args.push('-H', `${key}: ${value}`)
            }
          } catch {}
        }

        if (downloadProcess?.pid || downloadPid) {
          const oldPid = downloadProcess?.pid || downloadPid
          if (oldPid) {
            sendProgress({ line: `[绯荤粺] 妫€娴嬪埌宸叉湁涓嬭浇杩涚▼ (PID: ${oldPid})锛屾鍦ㄧ粓姝?..`, percent: null, done: false, success: false })
            killProcessTree(oldPid)
            downloadProcess = null
            downloadPid = null
          }
        }

        if (!fs.existsSync(input.saveDir)) {
          fs.mkdirSync(input.saveDir, { recursive: true })
          sendProgress({ line: `[绯荤粺] 宸插垱寤轰繚瀛樼洰褰? ${input.saveDir}`, percent: null, done: false, success: false })
        }
        if (!fs.existsSync(tmpDir)) {
          fs.mkdirSync(tmpDir, { recursive: true })
          sendProgress({ line: `[绯荤粺] 宸插垱寤轰复鏃剁洰褰? ${tmpDir}`, percent: null, done: false, success: false })
        }

        sendProgress({ line: `[SYSTEM] --------------------`, percent: 0, done: false, success: false })
        sendProgress({ line: `[SYSTEM] Start download task: ${input.saveName}`, percent: 0, done: false, success: false })
        sendProgress({ line: `[SYSTEM] Source URL: ${input.url}`, percent: 0, done: false, success: false })
        sendProgress({ line: `[SYSTEM] Save directory: ${input.saveDir}`, percent: 0, done: false, success: false })
        sendProgress({ line: `[SYSTEM] Temp directory: ${tmpDir}`, percent: 0, done: false, success: false })
        sendProgress({ line: `[SYSTEM] Tool path: ${toolPath}`, percent: 0, done: false, success: false })
        sendProgress({ line: `[SYSTEM] Threads: ${input.threads} | Format: ${input.format}`, percent: 0, done: false, success: false })
        if (input.headers) {
          sendProgress({ line: `[SYSTEM] Custom headers: ${input.headers}`, percent: 0, done: false, success: false })
        }
        sendProgress({ line: `[SYSTEM] Full command: ${toolPath} ${args.join(' ')}`, percent: 0, done: false, success: false })
        sendProgress({ line: `[SYSTEM] Launching N_m3u8DL-RE...`, percent: 0, done: false, success: false })

        // Use direct spawn to avoid shell path parsing issues.
        downloadProcess = spawn(toolPath, args, {
          windowsHide: true,
          detached: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        const pid = downloadProcess.pid || 0
        downloadPid = pid  // 鎸佷箙淇濆瓨 PID
        sendProgress({ line: `[绯荤粺] N_m3u8DL-RE 宸插惎鍔?(PID: ${pid})`, percent: 0, done: false, success: false })

        downloadProcess.on('spawn', () => {
          sendProgress({ line: '[绯荤粺] 杩涚▼宸叉垚鍔?spawn', percent: 0, done: false, success: false })
        })

        downloadProcess.stdout?.on('data', (data: Buffer) => {
          const text = data.toString()
          process.stdout.write(text)
          for (const line of text.split(/\r?\n/)) {
            const cleaned = stripAnsi(line)
            if (!cleaned) continue
            sendProgress({ line: cleaned, percent: parsePercent(cleaned), done: false, success: false })
            if (
              (cleaned.includes('All') && cleaned.includes('downloaded')) ||
              cleaned.includes('Download complete') ||
              cleaned.includes('finished')
            ) {
              sendProgress({ line: '[SYSTEM] Download completed', percent: 100, done: true, success: true })
              downloadProcess = null
            }
          }
        })

        downloadProcess.stderr?.on('data', (data: Buffer) => {
          const text = data.toString()
          process.stderr.write(text)
          for (const line of text.split(/\r?\n/)) {
            const cleaned = stripAnsi(line)
            if (!cleaned) continue
            sendProgress({ line: cleaned, percent: parsePercent(cleaned), done: false, success: false })
          }
        })

        downloadProcess.on('close', (code: number | null, signal: string | null) => {
          console.log(`[涓嬭浇] 杩涚▼鍏抽棴: code=${code}, signal=${signal}`)
          if (code === 0) {
            sendProgress({ line: `[绯荤粺] 涓嬭浇宸插畬鎴?(code: 0)`, percent: 100, done: true, success: true })
            downloadPid = null
          } else {
            // code=1 鏄甯哥殑锛堜富杩涚▼閫€鍑猴紝瀛愯繘绋嬬户缁級锛屼笉娓呯┖ PID锛宻top 浠嶅彲鐢?            sendProgress({ line: `[绯荤粺] N_m3u8DL-RE 涓昏繘绋嬮€€鍑?(code: ${code})锛屽瓙杩涚▼涓嬭浇涓?..`, percent: null, done: false, success: false })
          }
          downloadProcess = null
        })

        downloadProcess.on('error', (err: Error) => {
          console.error(`[涓嬭浇] 鍚姩澶辫触: ${err.message}`)
          sendProgress({ line: `[閿欒] 鍚姩澶辫触: ${err.message}`, percent: null, done: true, success: false })
          downloadProcess = null
        })

        return { success: true, pid }
      }),

    stop: t.procedure.mutation(() => {
      const pid = downloadProcess?.pid || downloadPid
      if (pid) {
        sendProgress({ line: `[SYSTEM] Stopping download process (PID: ${pid})`, percent: null, done: false, success: false })
        killProcessTree(pid)
        downloadProcess = null
        downloadPid = null
        sendProgress({ line: `[SYSTEM] Sent taskkill /F /T /PID ${pid}`, percent: null, done: false, success: false })
        sendProgress({ line: '[SYSTEM] Download stopped', percent: null, done: true, success: false })
        return { success: true }
      }
      sendProgress({ line: '[SYSTEM] No running download process', percent: null, done: false, success: false })
      return { success: false, message: 'No running download process' }
    }),

    onProgress: t.procedure.subscription(() => {
      return {
        subscribe: (callback: (data: ProgressPayload) => void) => {
          progressCallbacks.push(callback)
          return () => {
            progressCallbacks = progressCallbacks.filter(cb => cb !== callback)
          }
        }
      }
    }),

    // 鍒犻櫎浠诲姟鏃舵竻鐞?temp 涓存椂鏂囦欢
    cleanupTemp: t.procedure
      .input((input: unknown) => input as { saveDir: string; saveName: string; tmpDir?: string })
      .mutation(({ input }) => {
        const tmpDir = input.tmpDir || path.join(input.saveDir, 'temp')
        const sanitized = sanitizeName(input.saveName)
        sendProgress({ line: `[SYSTEM] Cleaning temp files: ${sanitized}*`, percent: null, done: false, success: false })
        sendProgress({ line: `[SYSTEM] Temp directory: ${tmpDir}`, percent: null, done: false, success: false })
        try {
          if (fs.existsSync(tmpDir)) {
            const files = fs.readdirSync(tmpDir)
            let deleted = 0
            for (const file of files) {
              if (file.startsWith(sanitized)) {
                const filePath = path.join(tmpDir, file)
                const stat = fs.statSync(filePath)
                fs.unlinkSync(filePath)
                sendProgress({ line: `[SYSTEM] Deleted temp file: ${file} (${formatSize(stat.size)})`, percent: null, done: false, success: false })
                deleted++
              }
            }
            sendProgress({ line: `[SYSTEM] Temp cleanup completed: ${deleted} file(s) deleted`, percent: null, done: false, success: false })
            return { success: true, deleted }
          }
          sendProgress({ line: `[SYSTEM] Temp directory not found: ${tmpDir}`, percent: null, done: false, success: false })
          return { success: true, deleted: 0 }
        } catch (err: any) {
          sendProgress({ line: `[SYSTEM] Temp cleanup failed: ${err.message}`, percent: null, done: false, success: false })
          return { success: false, error: err.message }
        }
      }),

    // 涓嬭浇瀹屾垚鍚庤嚜鍔ㄤ笅杞藉皝闈㈠拰棰勮瑙嗛
    downloadCoverPreview: t.procedure
      .input((input: unknown) => input as { id: string; name: string; saveDir: string })
      .mutation(async ({ input }) => {
        const previous = coverChain
        let release: () => void = () => {}
        coverChain = new Promise<void>((resolve) => { release = resolve })
        try {
          await previous
        } catch {
          // ignore previous task failure
        }

        try {
          const { id, name, saveDir } = input
          clog('INFO', `Start cover/preview download: ${name}`)

          if (name.toLowerCase().startsWith('desktop')) {
            clog('WARNING', 'Skip desktop task')
            return { success: false, message: 'skip desktop task' }
          }

          await fs.promises.mkdir(saveDir, { recursive: true })
          const videoId = id.toLowerCase()
          const referer = `https://missav.ai/cn/${videoId}-uncensored-leak`
          const coverLocalPath = path.join(saveDir, 'cover.jpg')
          const previewLocalPath = path.join(saveDir, 'preview.mp4')
          const coverUrls = [
            `https://fourhoi.com/${videoId}-uncensored-leak/cover-n.jpg`,
            `https://fourhoi.com/${videoId}-uncensored-leak/cover-t.jpg`,
            `https://fourhoi.com/${videoId}/cover-n.jpg`,
            `https://fourhoi.com/${videoId}/cover-t.jpg`,
          ]
          const previewUrls = [
            `https://fourhoi.com/${videoId}-uncensored-leak/preview.mp4`,
            `https://fourhoi.com/${videoId}/preview.mp4`,
          ]

          const downloadFile = (url: string, localPath: string, retries = 3): Promise<void> => {
            return new Promise((resolve, reject) => {
              const parsed = new URL(url)
              const mod = parsed.protocol === 'https:' ? https : http
              const req = mod.request(
                {
                  hostname: parsed.hostname,
                  port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                  path: parsed.pathname + parsed.search,
                  method: 'GET',
                  timeout: 15000,
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
                    Referer: referer,
                    Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                  },
                },
                (res) => {
                  if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    downloadFile(res.headers.location, localPath, retries).then(resolve).catch(reject)
                    return
                  }
                  if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}`))
                    return
                  }
                  const writer = fs.createWriteStream(localPath)
                  res.pipe(writer)
                  writer.on('finish', () => {
                    writer.close()
                    resolve()
                  })
                  writer.on('error', reject)
                }
              )
              req.on('timeout', () => {
                req.destroy()
                reject(new Error('Request timeout'))
              })
              req.on('error', reject)
              req.end()
            }).catch((err) => {
              if (retries > 0) {
                return downloadFile(url, localPath, retries - 1)
              }
              return Promise.reject(err)
            })
          }

          const tryCandidates = async (candidates: string[], localPath: string, label: string) => {
            let lastError: Error | null = null
            for (const url of candidates) {
              try {
                clog('INFO', `Try ${label}: ${url}`)
                await downloadFile(url, localPath)
                const size = fs.existsSync(localPath) ? fs.statSync(localPath).size : 0
                clog('SUCCESS', `${label} downloaded (${formatSize(size)})`)
                return
              } catch (err: any) {
                lastError = err
              }
            }
            throw lastError || new Error(`${label} download failed`)
          }

          await tryCandidates(coverUrls, coverLocalPath, 'cover')
          await tryCandidates(previewUrls, previewLocalPath, 'preview')
          clog('SUCCESS', `Cover/preview completed: ${name}`)
          return { success: true }
        } catch (err: any) {
          clog('ERROR', `Cover/preview failed: ${err?.message || err}`)
          return { success: false, error: err?.message || String(err) }
        } finally {
          release()
        }
      }),

    // 璇诲彇灏侀潰/棰勮鏃ュ織鏂囦欢
    readCoverLogs: t.procedure.query((): CoverLogEntry[] => {
      try {
        const file = getCoverLogFilePath()
        if (!fs.existsSync(file)) return []
        const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean)
        // 鍙繚鐣欐渶杩?1000 鏉?        return lines
          .slice(-1000)
          .map((l) => {
            try {
              return JSON.parse(l) as CoverLogEntry
            } catch {
              return null
            }
          })
          .filter((e): e is CoverLogEntry => e !== null)
      } catch {
        return []
      }
    }),

    // 娓呯┖灏侀潰/棰勮鏃ュ織鏂囦欢
    clearCoverLogs: t.procedure.mutation((): { success: boolean } => {
      try {
        fs.writeFileSync(getCoverLogFilePath(), '')
        return { success: true }
      } catch {
        return { success: false }
      }
    }),
  }),

  // 瑙嗛鍒楄〃
  videos: t.router({
    list: t.procedure
      .input((input: unknown) => (input as { path?: string }) || {})
      .query(({ input }) => {
        const videoDir = input.path || 'M:\\video\\videos\\'
        const videos: VideoItem[] = []

        try {
          if (!fs.existsSync(videoDir)) return videos

          const folders = fs.readdirSync(videoDir, { withFileTypes: true })
          for (const folder of folders) {
            if (!folder.isDirectory()) continue

            const folderPath = path.join(videoDir, folder.name)
            let videoFile = path.join(folderPath, 'video.mp4')

            if (!fs.existsSync(videoFile)) {
              const files = fs.readdirSync(folderPath, { withFileTypes: true })
              const exts = ['mp4', 'mkv', 'ts', 'mov', 'avi', 'webm', 'flv', 'm4v']
              for (const f of files) {
                if (f.isFile()) {
                  const ext = path.extname(f.name).toLowerCase().slice(1)
                  if (exts.includes(ext) && f.name.toLowerCase() !== 'preview.mp4') {
                    videoFile = path.join(folderPath, f.name)
                    break
                  }
                }
              }
            }

            if (!fs.existsSync(videoFile)) continue

            let videoSize = 0
            try { videoSize = fs.statSync(videoFile).size } catch {}

            let coverFile: string | undefined = undefined
            for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif']) {
              const c = path.join(folderPath, `cover.${ext}`)
              if (fs.existsSync(c)) { coverFile = c; break }
            }

            let previewFile: string | undefined = undefined
            for (const ext of ['mp4', 'webm', 'gif', 'mov', 'm4v']) {
              const p = path.join(folderPath, `preview.${ext}`)
              if (fs.existsSync(p)) { previewFile = p; break }
            }

            videos.push({
              id: folder.name,
              name: folder.name,
              url: videoFile,
              resolution: 'local',
              encryptionType: 'decrypted',
              coverUrl: coverFile,
              previewUrl: previewFile,
              size: formatSize(videoSize),
              createdAt: fs.statSync(folderPath).birthtime.getTime(),
            })
          }
        } catch {}

        // 鎸夊垱寤烘椂闂村€掑簭鎺掑垪锛堟渶鏂扮殑鍦ㄥ墠锛?        videos.sort((a, b) => b.createdAt - a.createdAt)
        return videos
      }),

    // Delete local video folder
    delete: t.procedure
      .input((input: unknown) => input as { folderPath: string; rootPath?: string })
      .mutation(({ input }) => {
        const { folderPath, rootPath } = input
        try {
          if (!fs.existsSync(folderPath)) {
            return { success: false, error: '鏂囦欢澶逛笉瀛樺湪' }
          }
          const resolvedFolderPath = path.resolve(folderPath)
          const resolvedRoot = path.resolve(rootPath || 'M:\\video\\videos\\')
          const relative = path.relative(resolvedRoot, resolvedFolderPath)
          const isUnderRoot = relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)

          if (!isUnderRoot) {
            return { success: false, error: 'Delete path is outside video root directory' }
          }

          if (path.dirname(resolvedFolderPath) !== resolvedRoot) {
            return { success: false, error: 'Only first-level child folders can be deleted' }
          }

          fs.rmSync(resolvedFolderPath, { recursive: true, force: true })
          console.log(`[videos.delete] deleted ${resolvedFolderPath}`)
          return { success: true }
        } catch (err: any) {
          console.error(`[鍒犻櫎瑙嗛] 澶辫触: ${err.message}`)
          return { success: false, error: err.message }
        }
      }),
  }),

  // 绐楀彛鎺у埗
  window: t.router({
    minimize: t.procedure.mutation(() => {
      mainWindow?.minimize()
      return { success: true }
    }),
    maximize: t.procedure.mutation(() => {
      if (mainWindow?.isMaximized()) {
        mainWindow.unmaximize()
      } else {
        mainWindow?.maximize()
      }
      return { success: true }
    }),
    close: t.procedure.mutation(() => {
      mainWindow?.close()
      return { success: true }
    }),
  }),

  // Folder dialog
  dialog: t.router({
    selectFolder: t.procedure
      .input((input: unknown) => (input as { currentPath?: string }) || {})
      .query(async ({ input }) => {
        const result = await dialog.showOpenDialog(mainWindow!, {
          properties: ['openDirectory'],
          defaultPath: input.currentPath || undefined,
        })
        return result.canceled ? null : result.filePaths[0]
      }),
  }),

  // 鏂囦欢璺緞杞崲
  file: t.router({
    convertSrc: t.procedure
      .input((input: unknown) => input as string)
      .query(({ input }) => {
        if (!input || input.startsWith('http') || input.startsWith('local-media://')) return input
        const normalized = input.replace(/\\/g, '/')
        const encoded = normalized.split('/').map(p => encodeURIComponent(p)).join('/')
        return `local-media:///${encoded}`
      }),
  }),
})

export type AppRouter = typeof appRouter
