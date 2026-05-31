import { app, shell, BrowserWindow, protocol } from 'electron'
import { join, extname } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import * as https from 'https'
import * as http from 'http'
import * as fs from 'fs'
import { createIPCHandler } from 'electron-trpc-experimental/main'
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

const MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.flv': 'video/x-flv',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
}

function setupLocalMediaProtocol(): void {
  protocol.handle('local-media', async (request) => {
    try {
      const requestUrl = new URL(request.url)
      let filePath = decodeURIComponent(requestUrl.pathname || '')

      if (process.platform === 'win32' && /^\/[a-zA-Z]:\//.test(filePath)) {
        filePath = filePath.slice(1)
      }

      if (!filePath || !fs.existsSync(filePath)) {
        return new Response('File not found', { status: 404 })
      }

      const ext = extname(filePath).toLowerCase()
      if (!MIME_BY_EXT[ext]) {
        return new Response('Unsupported media type', { status: 415 })
      }

      const content = await fs.promises.readFile(filePath)
      return new Response(content, {
        status: 200,
        headers: {
          'Content-Type': MIME_BY_EXT[ext],
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
        },
      })
    } catch (err: any) {
      return new Response(`Local media error: ${err?.message || 'unknown error'}`, { status: 500 })
    }
  })
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
