const AD_HOST_KEYWORDS = [
  "doubleclick",
  "googlesyndication",
  "googletagmanager",
  "googletagservices",
  "adservice.google",
  "exoclick",
  "exosrv",
  "juicyads",
  "trafficjunky",
  "trafficfactory",
  "adsterra",
  "propeller",
  "onclick",
  "popads",
  "popcash",
  "hilltopads",
  "smartadserver",
  "criteo",
  "taboola",
  "outbrain",
  "mgid",
  "revcontent",
  "adnxs",
  "adsrvr",
  "histats",
  "ad-score",
  "adform",
  "magsrv",
  "tsyndicate",
  "bebi",
  "adnium",
  "ero-advertising",
  "ad-maven",
  "adkernel",
  "adnami",
  "adxxx",
];

const ALLOWED_FRAME_HOST_KEYWORDS = ["missav", "fourhoi", "localhost"];

export function getAdBlockScript(): string {
  return `
;(function () {
  if (window.__AVPLAY_AD_BLOCKER_INSTALLED__) return;
  window.__AVPLAY_AD_BLOCKER_INSTALLED__ = true;

  var AD_HOST_KEYWORDS = ${JSON.stringify(AD_HOST_KEYWORDS)};
  var ALLOWED_FRAME_HOST_KEYWORDS = ${JSON.stringify(ALLOWED_FRAME_HOST_KEYWORDS)};
  var SELECTORS = [
    'iframe:not([src])',
    'iframe[src=""]',
    'iframe[src="about:blank"]',
    'iframe[srcdoc]',
    'iframe[src*="ads"]',
    'iframe[src*="adserver"]',
    'iframe[src*="doubleclick"]',
    'iframe[src*="googlesyndication"]',
    'iframe[src*="exoclick"]',
    'iframe[src*="exosrv"]',
    'iframe[src*="juicyads"]',
    'iframe[src*="trafficjunky"]',
    'iframe[src*="magsrv"]',
    'iframe[src*="tsyndicate"]',
    '[id*="ad-"]',
    '[id^="ad_"]',
    '[id$="-ad"]',
    '[id*="ads"]',
    '[class*=" ad-"]',
    '[class^="ad-"]',
    '[class*="-ad "]',
    '[class*=" ads"]',
    '[class*="ads-"]',
    '[class*="advert"]',
    '[class*="banner"]',
    '[class*="sponsor"]',
    '[class*="popup"]',
    '[class*="popunder"]',
    '[data-ad]',
    '[data-ads]',
    '[data-ad-slot]',
    '[data-ad-client]',
    'ins.adsbygoogle'
  ];

  function hostOf(value) {
    try { return new URL(value, location.href).hostname.toLowerCase(); }
    catch (_) { return ''; }
  }

  function isAdUrl(value) {
    var host = hostOf(value);
    if (!host) return false;
    return AD_HOST_KEYWORDS.some(function (keyword) { return host.indexOf(keyword) !== -1; });
  }

  function isAllowedFrameUrl(value) {
    var host = hostOf(value);
    if (!host) return false;
    return ALLOWED_FRAME_HOST_KEYWORDS.some(function (keyword) {
      return host.indexOf(keyword) !== -1;
    });
  }

  function removeNode(node) {
    if (!node || node.id === 'm3u8-sniffer-root') return;
    if (node.closest && node.closest('#m3u8-sniffer-root')) return;
    node.remove();
  }

  function removeWithEmptyWrapper(node) {
    var parent = node && node.parentElement;
    removeNode(node);
    if (!parent || parent.id === 'm3u8-sniffer-root') return;
    if (parent.closest && parent.closest('#m3u8-sniffer-root')) return;

    var text = ((parent.id || '') + ' ' + (parent.className || '')).toLowerCase();
    var looksLikeAdWrapper = /ad|ads|advert|banner|sponsor|popup|modal|overlay|iframe|float/.test(text);
    var meaningfulChildren = Array.prototype.slice.call(parent.children || []).filter(function (child) {
      return child.id !== 'm3u8-sniffer-root';
    });

    if (looksLikeAdWrapper || meaningfulChildren.length === 0) {
      removeNode(parent);
    }
  }

  function cleanBySelector() {
    SELECTORS.forEach(function (selector) {
      document.querySelectorAll(selector).forEach(removeNode);
    });
  }

  function cleanLinksAndFrames() {
    document.querySelectorAll('a[href], iframe[src], script[src], img[src]').forEach(function (node) {
      var url = node.getAttribute('href') || node.getAttribute('src') || '';
      if (isAdUrl(url)) removeNode(node);
    });
  }

  function cleanIframes() {
    document.querySelectorAll('iframe').forEach(function (frame) {
      var src = frame.getAttribute('src') || '';
      var srcdoc = frame.getAttribute('srcdoc');
      if (!src || src === 'about:blank' || srcdoc != null) {
        removeWithEmptyWrapper(frame);
        return;
      }

      if (!isAllowedFrameUrl(src)) {
        removeWithEmptyWrapper(frame);
      }
    });
  }

  function cleanFixedOverlays() {
    Array.prototype.slice.call(document.body ? document.body.children : []).forEach(function (node) {
      if (!node || node.id === 'm3u8-sniffer-root') return;
      var style = window.getComputedStyle(node);
      if (style.position !== 'fixed' && style.position !== 'sticky') return;

      var rect = node.getBoundingClientRect();
      var area = rect.width * rect.height;
      var viewport = window.innerWidth * window.innerHeight;
      var zIndex = parseInt(style.zIndex || '0', 10) || 0;
      var text = ((node.id || '') + ' ' + (node.className || '')).toLowerCase();
      var looksLikeAd = /ad|ads|advert|banner|sponsor|popup|modal|overlay|float/.test(text);
      var blocksScreen = viewport > 0 && area / viewport > 0.18 && zIndex >= 10;

      if (looksLikeAd || blocksScreen) removeNode(node);
    });
  }

  function clean() {
    cleanBySelector();
    cleanLinksAndFrames();
    cleanIframes();
    cleanFixedOverlays();
  }

  var nativeOpen = window.open;
  window.open = function (url) {
    if (!url || isAdUrl(url)) return null;
    return nativeOpen.apply(window, arguments);
  };

  document.addEventListener('click', function (event) {
    var target = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (target && isAdUrl(target.href)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
  }, true);

  var style = document.createElement('style');
  style.textContent = SELECTORS.join(',') + ',iframe:not([src*="missav"]):not([src*="fourhoi"]):not([src*="localhost"]){display:none!important;visibility:hidden!important;pointer-events:none!important;}';
  (document.head || document.documentElement).appendChild(style);

  clean();
  new MutationObserver(clean).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(clean, 1200);
})();
`;
}
