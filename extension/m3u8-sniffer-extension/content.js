// 1) 注入 injected.js 到页面 MAIN world（原有逻辑）
try {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  script.onload = function () {
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);
} catch (e) {
  console.error('M3U8 Sniffer injection failed:', e);
}

// 2) 桥：page (MAIN world) 通过 window.postMessage 把推送转给扩展 isolated world，再转给 background
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.type !== 'AVPLAY_PUSH_REQUEST') return;

  chrome.runtime.sendMessage(
    { type: 'AVPLAY_PUSH', url: data.url, payload: data.payload },
    (resp) => {
      window.postMessage(
        {
          type: 'AVPLAY_PUSH_RESPONSE',
          reqId: data.reqId,
          ok: !!(resp && resp.ok),
          error: resp && resp.error
        },
        '*'
      );
    }
  );
});
