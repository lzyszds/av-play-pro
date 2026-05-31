import { app, shell, BrowserWindow, protocol } from 'electron'
import { join, extname } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import * as https from 'https'
import * as http from 'http'
import * as fs from 'fs'
import { Readable } from 'stream'
import { createIPCHandler } from 'electron-trpc-experimental/main'

// 根据扩展名推断 Content-Type，供本地媒体流使用
const MEDIA_MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.ts': 'video/mp2t',
  '.flv': 'video/x-flv',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif'
}
const guessMime = (p: string): string =>
  MEDIA_MIME[extname(p).toLowerCase()] || 'application/octet-stream'
import { appRouter, setMainWindow } from './router'

let mainWindow: BrowserWindow | null = null

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'cdn',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
  {
    scheme: 'local-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

// CDN 代理协议
function setupCdnProxyProtocol(): void {
  const CDN_DOMAINS = ['surrit.com', 'surrit.org', 'fourhoi.com']

  // 根据请求路径生成 Referer
  const getReferer = (hostname: string, pathname: string): string => {
    if (hostname.includes('fourhoi')) {
      // 从路径提取番号: /tenn-046-uncensored-leak/cover-n.jpg -> tenn-046-uncensored-leak
      const match = pathname.match(/\/([a-z]+-\d+-uncensored-leak)\//i)
      if (match) return `https://missav.ai/cn/${match[1]}`
      return 'https://missav.ai/'
    }
    return 'https://missav.ai/'
  }

  protocol.handle('cdn', (request) => {
    const cdnUrl = request.url.replace('cdn://', 'https://')
    const parsedUrl = new URL(cdnUrl)
    const isCdnDomain = CDN_DOMAINS.some(
      (d) => parsedUrl.hostname === d || parsedUrl.hostname.endsWith(`.${d}`)
    )
    if (!isCdnDomain) return new Response('Not a CDN domain', { status: 403 })

    const referer = getReferer(parsedUrl.hostname, parsedUrl.pathname)

    return new Promise<Response>((resolve) => {
      const mod = parsedUrl.protocol === 'https:' ? https : http
      const req = mod.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
          path: parsedUrl.pathname + parsedUrl.search,
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
            Referer: referer,
            Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
          },
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk: Buffer) => chunks.push(chunk))
          res.on('end', () => {
            resolve(
              new Response(Buffer.concat(chunks), {
                status: res.statusCode || 200,
                headers: {
                  'Content-Type': res.headers['content-type'] || 'application/octet-stream',
                  'Access-Control-Allow-Origin': '*',
                },
              })
            )
          })
        }
      )
      req.on('error', (err: Error) => {
        resolve(new Response(`CDN Proxy Error: ${err.message}`, { status: 502 }))
      })
      req.end()
    })
  })
  console.log('[CDN代理] 已启用 cdn:// 协议')
}

function setupLocalMediaProtocol(): void {
  protocol.handle('local-media', async (request) => {
    const url = request.url
    try {
      // 由于 local-media 注册为 standard 协议，Chromium 会用「带 authority」的
      // 语义解析 URL。Windows 盘符 "M:" 会被当成 host:port，结果 host 变成 "m"、
      // 冒号和盘符丢失。因此需要把 host 还原成盘符：
      //   local-media://m/video/...     (host=m)        -> M:\video\...
      //   local-media:///M:/video/...   (host 为空)     -> M:\video\...
      const parsed = new URL(url)
      const host = parsed.hostname
      let filePath: string
      if (host && /^[a-z]$/i.test(host)) {
        // 盘符被解析成了 host
        filePath = `${host.toUpperCase()}:${decodeURIComponent(parsed.pathname)}`
      } else {
        // 盘符保留在 path 中（如 /M:/video/...），去掉开头的斜杠
        filePath = decodeURIComponent(parsed.pathname).replace(/^\//, '')
      }

      if (process.platform === 'win32') {
        filePath = filePath.replace(/\//g, '\\')
      }


      if (!filePath || !fs.existsSync(filePath)) {
        return new Response('File not found', { status: 404 })
      }

      const stat = fs.statSync(filePath)
      const total = stat.size
      const contentType = guessMime(filePath)
      const rangeHeader = request.headers.get('range')

      // 处理 Range 请求（拖动进度条 / seek 需要 206 Partial Content）
      if (rangeHeader) {
        const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader)
        if (match) {
          const start = match[1] ? parseInt(match[1], 10) : 0
          const end = match[2] ? parseInt(match[2], 10) : total - 1
          if (start >= total || end >= total || start > end) {
            return new Response('Range Not Satisfiable', {
              status: 416,
              headers: { 'Content-Range': `bytes */${total}` }
            })
          }
          const stream = fs.createReadStream(filePath, { start, end })
          return new Response(Readable.toWeb(stream) as ReadableStream, {
            status: 206,
            headers: {
              'Content-Type': contentType,
              'Content-Length': String(end - start + 1),
              'Content-Range': `bytes ${start}-${end}/${total}`,
              'Accept-Ranges': 'bytes'
            }
          })
        }
      }

      // 无 Range：整文件返回，但仍声明支持 Range，让媒体元素可 seek
      const stream = fs.createReadStream(filePath)
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(total),
          'Accept-Ranges': 'bytes'
        }
      })
    } catch (err: any) {
      console.error(`[local-media] Error: ${err?.message}`)
      return new Response(`Error: ${err?.message}`, { status: 500 })
    }
  })
  console.log('[本地媒体] 已启用 local-media:// 协议')
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 760,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })

  // 设置主窗口引用给 router
  setMainWindow(mainWindow)

  // 创建 tRPC IPC Handler
  createIPCHandler({ router: appRouter, windows: [mainWindow] })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    // 注入 CSS 禁用 Chromium 默认 focus ring
    mainWindow?.webContents.insertCSS(`
      * { outline: none !important; }
      *:focus { outline: none !important; box-shadow: none !important; border-color: transparent !important; }
      *:focus-visible { outline: none !important; box-shadow: none !important; border-color: transparent !important; }
    `)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  console.log('[主进程] ELECTRON_RENDERER_URL:', process.env['ELECTRON_RENDERER_URL'])

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.avplaypro.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  setupCdnProxyProtocol()
  setupLocalMediaProtocol()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
