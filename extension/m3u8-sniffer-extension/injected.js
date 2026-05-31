// ==UserScript==
// @name         M3U8 Sniffer - v4.2 终极兼容版 (优化滚动条)
// @namespace    https://github.com/you/m3u8-sniffer
// @version      4.2.4
// @description  保持 v4.2 原样样式，增加 XHR/Fetch 劫持及跨域 iframe 聚合，优化滚动条样式
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

;(function () {
  'use strict'

  if (window.__M3U8_SNIFFER_INSTALLED__) return
  window.__M3U8_SNIFFER_INSTALLED__ = true

  const isTop = window.self === window.top
  const MSG_NAME = 'M3U8_RELAY_MSG'

  const storage = {
    get: (_k, d) => d
  }
  const CONFIG = {
    pushApi: storage.get('pushApi', 'http://localhost:39527/api/download'),
    maxRecords: 200,
    autoPush: storage.get('autoPush', false)
  }

  const sniffedUrls = new Set()
  const records = []
  let uiReady = false
  const pendingBeforeUI = []
  const origFetch = window.fetch.bind(window)

  function isM3u8Url(url) {
    if (typeof url !== 'string') return false
    const lower = url.toLowerCase()
    return lower.includes('.m3u8') || lower.includes('m3u8')
  }

  function toAbsUrl(url) {
    try {
      return new URL(url, location.href).href
    } catch {
      return url
    }
  }

  // ============ 封面 / preview ============
  function parseBgImage(bg) {
    if (!bg || bg === 'none') return ''
    const m = bg.match(/url\((['"]?)(.*?)\1\)/i)
    return m ? m[2] : ''
  }
  function extractCover() {
    try {
      // 1. 尝试 Plyr 播放器封面
      const plyrPoster = document.querySelector('.plyr__video-wrapper .plyr__poster, .plyr__poster')
      if (plyrPoster) {
        const url =
          parseBgImage(plyrPoster.style.backgroundImage) ||
          parseBgImage(getComputedStyle(plyrPoster).backgroundImage)
        if (url) return toAbsUrl(url)
      }

      // 2. 尝试原生 video 标签封面
      const video = document.querySelector('video[poster]')
      if (video && video.getAttribute('poster')) return toAbsUrl(video.getAttribute('poster'))

      // 3. 尝试 Open Graph 协议元标签
      const og = document.querySelector('meta[property="og:image"], meta[name="og:image"]')
      if (og && og.content) return toAbsUrl(og.content)

      // 4. 尝试查询 .post-meta.clearfix 下的图片
      const postMetaImg = document.querySelector('.post-meta.clearfix img')
      if (postMetaImg && postMetaImg.src) return toAbsUrl(postMetaImg.src)
    } catch (e) {
      console.warn('[m3u8-sniffer] extractCover error', e)
    }
    return ''
  }
  function coverToPreview(coverUrl) {
    if (!coverUrl || typeof coverUrl !== 'string') return ''

    // ✨ 新增：针对 supjav 的特殊逻辑
    if (coverUrl.includes('supjav')) {
      // 1. 获取当前视频标题（去掉干扰字符）
      const title = (document.title || '').replace('- MissAV | 免费高清', '').trim()

      // 2. 正则匹配番号：支持 ABC-123, ABCD-1234, 1ABC-123 等常见格式
      // [a-z0-9]{2,10} 匹配前缀字母/数字, - 匹配连字符, \d{3,8} 匹配后缀数字
      const codeMatch = title.match(/[a-z0-9]{2,10}-\d{3,8}/i)

      if (codeMatch) {
        const videoCode = codeMatch[0].toLowerCase() // 转为小写以匹配 URL
        return `https://fourhoi.com/${videoCode}/preview.mp4`
      }
    }

    // --- 原有逻辑 ---
    try {
      const url = new URL(coverUrl)
      const pathname = url.pathname
      // 匹配包含 cover/thumb/poster 的路径并替换为 preview.mp4
      if (/(cover|thumb|poster)[-_]?\d*\.(jpg|jpeg|png|gif|webp)/i.test(pathname)) {
        const newPath = pathname.replace(
          /\/(cover|thumb|poster)[-_]?\d*\.(jpg|jpeg|png|gif|webp)/i,
          '/preview.mp4'
        )
        return url.origin + newPath + (url.search || '')
      }
      // 兜底：直接在最后一个斜杠后换成 preview.mp4
      const lastSlash = pathname.lastIndexOf('/')
      if (lastSlash !== -1) {
        const dir = pathname.slice(0, lastSlash + 1)
        return url.origin + dir + 'preview.mp4' + (url.search || '')
      }
      return ''
    } catch {
      return ''
    }
  }

  function extractQualityLabel(url) {
    if (/playlist\.m3u8/i.test(url)) return 'master'
    const m = url.match(/(\d{3,4})p\/video\.m3u8/i) || url.match(/(\d{3,4})p\.m3u8/i)
    return m ? m[1] + 'p' : ''
  }

  // ============ 数据处理 ============
  function addRecord(url, source = '?') {
    if (!isM3u8Url(url)) return
    const abs = toAbsUrl(url)
    if (!isTop) {
      window.top.postMessage(
        {
          type: MSG_NAME,
          url: abs,
          source: source,
          title: (document.title || '')
            .replace('- MissAV | 免费高清', '')
            .replace('[无码破解]', '')
            .trim()
        },
        '*'
      )
      return
    }
    _internalAdd(abs, source)
  }

  function _internalAdd(abs, source, iframeTitle) {
    if (sniffedUrls.has(abs)) return
    sniffedUrls.add(abs)
    const cover = extractCover()
    const record = {
      url: abs,
      name:
        (document.title || '').replace('- MissAV | 免费高清', '').trim() ||
        iframeTitle ||
        '未知视频',
      cover: cover,
      preview: coverToPreview(cover) || undefined,
      quality: extractQualityLabel(abs),
      isPreview: /\.mp4$/i.test(abs),
      time: new Date().toLocaleTimeString(),
      pageUrl: location.href,
      referer: location.href,
      pageHost: location.hostname,
      source
    }
    records.unshift(record)
    if (records.length > CONFIG.maxRecords) records.pop()
    if (uiReady) {
      updateUI()
      if (CONFIG.autoPush) pushToLocal(record)
    } else pendingBeforeUI.push(record)
  }

  if (isTop) {
    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === MSG_NAME) {
        _internalAdd(e.data.url, e.data.source, e.data.title)
      }
    })
  }

  // ============ 网络劫持 ============
  window.fetch = function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0] && args[0].url
    if (isM3u8Url(url)) addRecord(url, 'Network.Fetch')
    return origFetch.apply(this, args)
  }
  const origOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (method, url) {
    if (isM3u8Url(url)) addRecord(url, 'Network.XHR')
    return origOpen.apply(this, arguments)
  }

  // ============ Hls 劫持 ============
  function expandHlsLevels(hlsInstance) {
    if (!hlsInstance || !Array.isArray(hlsInstance.levels)) return
    hlsInstance.levels.slice(0, 2).forEach((lv) => {
      const urls = Array.isArray(lv.url) ? lv.url : [lv.url]
      urls.forEach((u) => {
        if (isM3u8Url(u)) addRecord(u, `Hls.level-${lv.height || '?'}p`)
      })
    })
  }
  function hookHlsClass(HlsCtor) {
    if (!HlsCtor || !HlsCtor.prototype || HlsCtor.prototype.__m3u8_hooked__) return false
    const origLoadSource = HlsCtor.prototype.loadSource
    HlsCtor.prototype.loadSource = function (url) {
      this.on('hlsManifestParsed', () => {
        try {
          expandHlsLevels(this)
        } catch (e) {}
      })
      return origLoadSource.apply(this, arguments)
    }
    HlsCtor.prototype.__m3u8_hooked__ = true
    return true
  }
  if (window.Hls) hookHlsClass(window.Hls)
  let _Hls = window.Hls
  try {
    Object.defineProperty(window, 'Hls', {
      configurable: true,
      get() {
        return _Hls
      },
      set(v) {
        _Hls = v
        try {
          hookHlsClass(v)
        } catch (e) {}
      }
    })
  } catch (e) {}

  // ============ UI & 滚动条样式 ============
  function addStyle(css) {
    const s = document.createElement('style')
    s.textContent = css
    ;(document.head || document.documentElement).appendChild(s)
  }
  let panelOpen = false,
    root,
    panel,
    listEl,
    badgeEl

  function createUI() {
    if (!isTop) return
    addStyle(`
      #m3u8-sniffer-root * { font-family: 'JetBrains Mono', monospace; box-sizing: border-box; }
      
      /* ✨ 自定义滚动条样式 */
      .m3u8-list::-webkit-scrollbar { width: 6px; }
      .m3u8-list::-webkit-scrollbar-track { background: transparent; }
      .m3u8-list::-webkit-scrollbar-thumb { background: rgba(245, 166, 35, 0.3); border-radius: 10px; }
      .m3u8-list::-webkit-scrollbar-thumb:hover { background: rgba(245, 166, 35, 0.8); }
      /* 火狐浏览器兼容 */
      .m3u8-list { scrollbar-width: thin; scrollbar-color: rgba(245, 166, 35, 0.3) transparent; }

      #m3u8-sniffer-fab { position: fixed; bottom: 24px; right: 24px; z-index: 2147483646;
        width: 52px; height: 52px; border-radius: 16px; border: 1.5px solid rgba(245,166,35,0.25);
        background: linear-gradient(145deg, #1a1d24, #12141a); box-shadow: 0 8px 32px rgba(0,0,0,0.6);
        cursor: pointer; display: flex; align-items: center; justify-content: center; }
      #m3u8-sniffer-fab .fab-badge { position: absolute; top: -4px; right: -4px;
        min-width: 20px; height: 20px; padding: 0 5px; border-radius: 10px;
        background: #f5a623; color: #000; font-size: 11px; font-weight: 700;
        display: flex; align-items: center; justify-content: center; border: 2px solid #12141a; }
      #m3u8-sniffer-panel { position: fixed; bottom: 88px; right: 24px; z-index: 2147483647;
        width: 420px; max-height: 70vh; border-radius: 20px;
        border: 1px solid rgba(255,255,255,0.08); background: #12141a;
        box-shadow: 0 24px 80px rgba(0,0,0,0.8); display: flex; flex-direction: column;
        overflow: hidden; opacity: 0; transform: scale(0.9); pointer-events: none; transition: all 0.3s; }
      #m3u8-sniffer-panel.open { opacity: 1; transform: scale(1); pointer-events: all; }
      .m3u8-panel-header { padding: 18px 20px; border-bottom: 1px solid rgba(255,255,255,0.05);
        display: flex; align-items: center; justify-content: space-between; }
      .m3u8-panel-title { font-size: 14px; font-weight: 700; color: #f5a623; }
      .m3u8-list { flex: 1; overflow-y: auto; padding: 8px; }
      .m3u8-item { padding: 14px; border-radius: 14px; background: rgba(255,255,255,0.02);
        margin-bottom: 6px; border: 1px solid rgba(255,255,255,0.04); display: flex; gap: 10px; }
      .m3u8-item-cover { width: 150px; height: 90px; flex-shrink: 0; border-radius: 8px;
        background: #000 center/cover no-repeat; border: 1px solid rgba(255,255,255,0.06); }
      .m3u8-item-cover.empty { display: flex; align-items: center; justify-content: center; font-size: 9px; color: rgba(255,255,255,0.2); }
      .m3u8-item-body { flex: 1; min-width: 0; }
      .m3u8-item-quality { display: inline-block; padding: 2px 6px; border-radius: 4px; background: rgba(245,166,35,0.15); color: #f5a623; font-size: 10px; font-weight: 700; margin-right: 6px; }
      .m3u8-item-quality.master { background: rgba(100,200,255,0.15); color: #64c8ff; }
      .m3u8-item-url { font-size: 10px; color: rgba(255,255,255,0.3); word-break: break-all; margin: 8px 0; }
      .m3u8-action-btn { height: 28px; padding: 0 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06); background: rgba(255,255,255,0.04); color: rgba(255,255,255,0.5); font-size: 10px; cursor: pointer; margin-right: 4px; }
      .m3u8-action-btn:hover { background: #f5a623; color: #000; }
      .m3u8-toast { position: fixed; top: 20px; right: 24px; z-index: 2147483647; padding: 12px 20px; border-radius: 12px; background: #1a1d24; border: 1px solid rgba(245,166,35,0.2); color: #f5a623; font-size: 12px; }
    `)

    root = document.createElement('div')
    root.id = 'm3u8-sniffer-root'
    root.innerHTML = `
      <div id="m3u8-sniffer-fab"><svg viewBox="0 0 24 24" fill="none" stroke="#f5a623" stroke-width="2" style="width:24px;height:24px"><circle cx="12" cy="12" r="1"/><path d="M20.3 18.3A9 9 0 0 0 21 12a9 9 0 0 0-9-9 9 9 0 0 0-9 9 9 9 0 0 0 .7 6.3"/></svg><span class="fab-badge" style="display:none">0</span></div>
      <div id="m3u8-sniffer-panel">
        <div class="m3u8-panel-header">
          <span class="m3u8-panel-title">M3U8 SNIFFER</span>
          <div><button class="m3u8-action-btn" id="m3u8-clear">清空</button><button class="m3u8-action-btn" id="m3u8-close">关闭</button></div>
        </div>
        <div class="m3u8-list" id="m3u8-list"></div>
      </div>`
    document.body.appendChild(root)
    panel = root.querySelector('#m3u8-sniffer-panel')
    listEl = root.querySelector('#m3u8-list')
    badgeEl = root.querySelector('.fab-badge')
    root.querySelector('#m3u8-sniffer-fab').onclick = () => {
      panelOpen = !panelOpen
      panel.classList.toggle('open', panelOpen)
    }
    root.querySelector('#m3u8-clear').onclick = () => {
      records.length = 0
      sniffedUrls.clear()
      updateUI()
    }
    root.querySelector('#m3u8-close').onclick = () => {
      panelOpen = false
      panel.classList.remove('open')
    }
    uiReady = true
    pendingBeforeUI.forEach((r) => _internalAdd(r.url, r.source, r.name))
    pendingBeforeUI.length = 0
    updateUI()
  }

  function updateUI() {
    if (!listEl) return
    badgeEl.textContent = records.length
    badgeEl.style.display = records.length ? 'flex' : 'none'
    if (!records.length) {
      listEl.innerHTML = '<div style="text-align:center;padding:20px;color:#666">暂无数据</div>'
      return
    }
    listEl.innerHTML = records
      .map((r, i) => {
        const coverHtml = r.cover
          ? `<div class="m3u8-item-cover" style="background-image:url('${r.cover.replace(/'/g, "\\'")}')"></div>`
          : `<div class="m3u8-item-cover empty">无封面</div>`
        const qualityHtml = r.quality
          ? `<span class="m3u8-item-quality ${r.quality === 'master' ? 'master' : ''}">${r.quality}</span>`
          : ''
        return `<div class="m3u8-item">${coverHtml}<div class="m3u8-item-body"><div style="color:#eee;font-size:12px">${qualityHtml}${r.name.slice(0, 30)}</div><div class="m3u8-item-url">${r.url}</div><button class="m3u8-action-btn" id="copy-${i}">复制</button><button class="m3u8-action-btn" id="push-${i}">推送</button></div></div>`
      })
      .join('')
    records.forEach((r, i) => {
      document.getElementById(`push-${i}`).onclick = () => pushToLocal(r)
      document.getElementById(`copy-${i}`).onclick = () => {
        navigator.clipboard.writeText(r.url).then(() => showToast('✓ 已复制'))
      }
    })
  }

  function pushToLocal(record) {
    const payload = Object.assign({}, record, {
      referer: record.pageUrl || location.href,
      pageUrl: record.pageUrl || location.href,
      pageHost: location.hostname,
      pageTitle: document.title || record.name || ''
    })
    const consoleFallback = () => {
      try {
        console.log('__AVPLAY_EXTENSION_PUSH__' + JSON.stringify(payload))
      } catch (e) {}
    }

    origFetch(CONFIG.pushApi, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then((res) => {
        if (!res.ok) throw new Error('HTTP ' + res.status)
        return res.json().catch(() => ({}))
      })
      .then(() => showToast('已推送到任务列表'))
      .catch(() => {
        consoleFallback()
        showToast('已尝试备用推送')
      })
  }
  function showToast(msg) {
    const el = document.createElement('div')
    el.className = 'm3u8-toast'
    el.textContent = msg
    document.body.appendChild(el)
    setTimeout(() => el.remove(), 2000)
  }

  if (document.body) createUI()
  else document.addEventListener('DOMContentLoaded', createUI, { once: true })
})()
