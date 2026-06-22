// MV3 service worker: 代页面在扩展 origin 下发请求到 localhost，绕开 page context 的 LNA 限制
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'AVPLAY_PUSH') return false;

  fetch(msg.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(msg.payload)
  })
    .then((res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json().catch(() => ({}));
    })
    .then(() => sendResponse({ ok: true }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));

  return true; // 保持 sendResponse 异步可用
});
