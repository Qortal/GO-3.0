/*
 * GO background player: watches audio and video in this frame and reports
 * them to GO's native player (GoMediaHub.java), which shows them in the
 * notification and on the lock screen and sends Play / Pause / seek back.
 *
 * Injected at document start into every frame (Q-Apps, websites, GO's own
 * page) with WebViewCompat.addDocumentStartJavaScript. The channel object
 * (window.goMediaWatch, WebViewCompat.addWebMessageListener) is taken and
 * removed from the page before any of the page's own scripts run.
 *
 * What counts as media (like Chrome's media notification): not muted, volume
 * above 0, and 5 s or longer (or a live stream). Short sounds and muted
 * autoplay videos never reach the notification.
 *
 * Nothing here talks to the network except to load this frame's own cover
 * picture (navigator.mediaSession artwork, a video poster, the Q-App's
 * avatar), which the page could load anyway.
 */
(function () {
  'use strict';
  var CHANNEL = 'goMediaWatch';
  var bridge = null;
  try {
    bridge = window[CHANNEL];
  } catch (e) {
    bridge = null;
  }
  if (!bridge || typeof bridge.postMessage !== 'function') return;
  try {
    delete window[CHANNEL];
  } catch (e) {
    /* not configurable: it stays, harmless */
  }
  if (typeof HTMLMediaElement === 'undefined') return;

  var MIN_MEDIA_SEC = 5;
  var SYNC_MS = 15000;
  var GONE_CHECK_MS = 20000;
  var ART_MAX_PX = 512;
  var MAX_PLAYERS = 16;
  var EVENTS = [
    'play',
    'playing',
    'pause',
    'ended',
    'seeked',
    'seeking',
    'ratechange',
    'durationchange',
    'loadedmetadata',
    'volumechange',
    'emptied',
    'waiting',
    'timeupdate',
  ];
  var DISCOVERY = ['play', 'playing', 'loadedmetadata', 'volumechange'];

  var fid = randomId();
  var seq = 0;
  var players = new Map();
  var byElement = new WeakMap();
  var handlers = Object.create(null);
  var metadata = null;
  var positionState = null;
  var activeId = null;
  var announced = false;
  var goneTimer = 0;
  var origPlay = HTMLMediaElement.prototype.play;

  function randomId() {
    try {
      var a = new Uint32Array(2);
      crypto.getRandomValues(a);
      return a[0].toString(36) + a[1].toString(36);
    } catch (e) {
      return Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
  }

  function send(msg) {
    msg.v = 1;
    msg.f = fid;
    try {
      bridge.postMessage(JSON.stringify(msg));
    } catch (e) {
      /* channel gone (frame closing) */
    }
  }

  // Lets GO's page find the tab this frame belongs to (notification tap).
  function announce() {
    if (announced) return;
    announced = true;
    try {
      if (window.top && window.top !== window) {
        window.top.postMessage({ goMediaFrame: fid }, '*');
      }
    } catch (e) {
      /* no top (detached) */
    }
  }

  // ── Players ──────────────────────────────────────────────────────────

  function track(el) {
    if (!(el instanceof HTMLMediaElement)) return null;
    var rec = byElement.get(el);
    if (rec) return rec;
    if (players.size >= MAX_PLAYERS) pruneOne();
    rec = {
      id: fid + '.' + ++seq,
      el: el,
      shape: '',
      sentAt: 0,
      wasConnected: el.isConnected,
      gone: false,
      art: { key: '', sent: '', pendingFrame: null },
      frameShotAt: 0,
    };
    byElement.set(el, rec);
    players.set(rec.id, rec);
    for (var i = 0; i < EVENTS.length; i++) {
      el.addEventListener(EVENTS[i], onElementEvent, false);
    }
    scheduleGoneCheck();
    return rec;
  }

  function pruneOne() {
    var victim = null;
    players.forEach(function (rec) {
      if (victim) return;
      if (rec.el.paused) victim = rec;
    });
    if (!victim) victim = players.values().next().value;
    if (victim) forget(victim, true);
  }

  function forget(rec, tell) {
    if (!players.has(rec.id)) return;
    players.delete(rec.id);
    rec.gone = true;
    for (var i = 0; i < EVENTS.length; i++) {
      rec.el.removeEventListener(EVENTS[i], onElementEvent, false);
    }
    byElement.delete(rec.el);
    if (activeId === rec.id) activeId = null;
    if (tell) send({ t: 'g', id: rec.id });
  }

  // Players taken out of the page while paused never fire another event.
  function scheduleGoneCheck() {
    if (goneTimer || players.size === 0) return;
    goneTimer = setTimeout(function () {
      goneTimer = 0;
      players.forEach(function (rec) {
        if (rec.wasConnected && !rec.el.isConnected && rec.el.paused) {
          forget(rec, true);
        }
      });
      scheduleGoneCheck();
    }, GONE_CHECK_MS);
  }

  function onDiscovery(event) {
    var el = event.target;
    if (!(el instanceof HTMLMediaElement) || byElement.has(el)) return;
    var rec = track(el);
    if (rec) handle(rec, event.type);
  }

  function onElementEvent(event) {
    var rec = byElement.get(event.currentTarget);
    if (rec) handle(rec, event.type);
  }

  function handle(rec, type) {
    var el = rec.el;
    if (el.isConnected) rec.wasConnected = true;
    if (type === 'timeupdate') {
      maybeShootFrame(rec);
      if (!el.paused && Date.now() - rec.sentAt > SYNC_MS) report(rec, true);
      return;
    }
    if (type === 'play' || type === 'playing') {
      activeId = rec.id;
    }
    if (type === 'pause') {
      // Removing a playing element pauses it; it is gone, not paused.
      setTimeout(function () {
        if (rec.wasConnected && !el.isConnected) forget(rec, true);
        else report(rec, false);
      }, 0);
      return;
    }
    if (type === 'emptied') {
      rec.art = { key: '', sent: '', pendingFrame: null };
      rec.frameShotAt = 0;
    }
    var force =
      type === 'seeked' || type === 'ratechange' || type === 'playing';
    report(rec, force);
  }

  function kindOf(el) {
    if (el.tagName !== 'VIDEO') return 'audio';
    // A <video> playing an audio file has no picture once its metadata is in.
    if (el.readyState >= 1 && el.videoWidth === 0) return 'audio';
    return 'video';
  }

  function durationOf(rec) {
    var el = rec.el;
    if (rec.id === activeId && positionState && positionState.duration > 0) {
      return positionState.duration;
    }
    var d = el.duration;
    if (d === Infinity) return -2;
    return isFinite(d) ? d : -1;
  }

  function positionOf(rec) {
    if (
      rec.id === activeId &&
      positionState &&
      isFinite(positionState.position)
    ) {
      return positionState.position;
    }
    var p = rec.el.currentTime;
    return isFinite(p) ? p : 0;
  }

  function eligible(rec, duration) {
    var el = rec.el;
    if (rec.gone || el.muted || !(el.volume > 0)) return false;
    // Calls and screen shares (a live MediaStream) are not media to
    // control, and GO's own sound effects opt out with this attribute.
    try {
      if (el.srcObject) return false;
    } catch (e) {
      /* no srcObject */
    }
    if (el.hasAttribute('data-go-no-media-session')) return false;
    return duration === -2 || duration >= MIN_MEDIA_SEC;
  }

  function stateOf(el) {
    if (el.ended) return 'ended';
    if (el.paused) return 'paused';
    if (el.seeking || el.readyState < 3) return 'buffering';
    return 'playing';
  }

  function attr(el, name) {
    try {
      var v = el.getAttribute(name);
      return v ? String(v) : '';
    } catch (e) {
      return '';
    }
  }

  function fileTitle(src) {
    if (!src || /^(blob|data|mediastream):/i.test(src)) return '';
    try {
      var path = new URL(src, location.href).pathname;
      var last = decodeURIComponent(path.split('/').pop() || '');
      var dot = last.lastIndexOf('.');
      if (dot <= 0 || last.length - dot > 6) return '';
      return last.slice(0, dot).replace(/[_]+/g, ' ').trim();
    } catch (e) {
      return '';
    }
  }

  function metaFor(rec) {
    var m = rec.id === activeId || players.size === 1 ? metadata : null;
    var el = rec.el;
    var out = {
      ti: '',
      ar: '',
      al: '',
    };
    if (m) {
      out.ti = String(m.title || '');
      out.ar = String(m.artist || '');
      out.al = String(m.album || '');
    }
    if (!out.ti) {
      out.ti =
        attr(el, 'title') ||
        attr(el, 'aria-label') ||
        attr(el, 'data-title') ||
        fileTitle(el.currentSrc || el.src);
    }
    return out;
  }

  function clip(text, max) {
    var t = String(text || '');
    return t.length > max ? t.slice(0, max) : t;
  }

  function report(rec, force) {
    if (rec.gone) return;
    var el = rec.el;
    var d = durationOf(rec);
    var ok = eligible(rec, d);
    var meta = metaFor(rec);
    var msg = {
      t: 'p',
      id: rec.id,
      st: stateOf(el),
      k: kindOf(el),
      ok: ok,
      ti: clip(meta.ti, 300),
      ar: clip(meta.ar, 200),
      al: clip(meta.al, 200),
      dt: clip(document.title, 300),
      href: clip(location.href, 2048),
      d: d,
      p: positionOf(rec),
      r: el.playbackRate || 1,
      nx: rec.id === activeId && typeof handlers.nexttrack === 'function',
      pv: rec.id === activeId && typeof handlers.previoustrack === 'function',
      sk: d > 0 && isFinite(d),
      ak: rec.art.sent,
    };
    // Same picture as last time: only send when something but the clock moved.
    var shape = [
      msg.st,
      msg.k,
      msg.ok,
      msg.ti,
      msg.ar,
      msg.al,
      msg.dt,
      msg.d,
      msg.r,
      msg.nx,
      msg.pv,
      msg.ak,
    ].join('\u0001');
    if (!force && shape === rec.shape) return;
    rec.shape = shape;
    rec.sentAt = Date.now();
    if (ok) announce();
    send(msg);
    if (ok && msg.st !== 'paused' && msg.st !== 'ended') loadArt(rec);
  }

  function reportAll() {
    players.forEach(function (rec) {
      report(rec, true);
    });
  }

  // ── Cover picture ────────────────────────────────────────────────────

  function qdnApp() {
    var m = /^\/(?:render\/)?(APP|WEBSITE)\/([^/?#]+)/i.exec(location.pathname);
    if (!m) return null;
    try {
      return { service: m[1].toUpperCase(), name: decodeURIComponent(m[2]) };
    } catch (e) {
      return null;
    }
  }

  // Cover keys stay short (a data: URL can be 100 KB): FNV-1a of the URL.
  function keyOf(prefix, url) {
    var h = 0x811c9dc5;
    var text = String(url || '');
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return prefix + h.toString(36) + '.' + text.length.toString(36);
  }

  function sizeOf(sizes) {
    var best = 0;
    String(sizes || '')
      .split(/\s+/)
      .forEach(function (s) {
        var m = /^(\d+)x(\d+)$/i.exec(s);
        if (m) best = Math.max(best, Math.min(+m[1], +m[2]));
      });
    return best;
  }

  function artCandidates(rec) {
    var list = [];
    var m = rec.id === activeId || players.size === 1 ? metadata : null;
    if (m && m.artwork && m.artwork.length) {
      var art = Array.prototype.slice.call(m.artwork).filter(function (a) {
        return a && a.src;
      });
      art.sort(function (a, b) {
        var sa = sizeOf(a.sizes) || 256;
        var sb = sizeOf(b.sizes) || 256;
        // Closest to 512 px, bigger first when tied.
        var da = Math.abs(sa - ART_MAX_PX) + (sa < 256 ? 1000 : 0);
        var db = Math.abs(sb - ART_MAX_PX) + (sb < 256 ? 1000 : 0);
        return da - db;
      });
      art.forEach(function (a) {
        list.push({ key: keyOf('ms:', a.src), url: a.src });
      });
    }
    var poster = rec.el.tagName === 'VIDEO' ? attr(rec.el, 'poster') : '';
    if (poster) list.push({ key: keyOf('poster:', poster), url: poster });
    if (kindOf(rec.el) === 'video') {
      list.push({ key: keyOf('frame:', rec.el.currentSrc), frame: true });
    }
    var app = qdnApp();
    if (app && app.service === 'APP') {
      list.push({
        key: keyOf('avatar:', app.name),
        url:
          '/arbitrary/THUMBNAIL/' +
          encodeURIComponent(app.name) +
          '/qortal_avatar',
      });
    }
    return list;
  }

  function loadArt(rec) {
    var list = artCandidates(rec);
    if (!list.length) return;
    var first = list[0].key;
    // Already loaded, loading or given up for this set of pictures.
    if (rec.art.key === first) return;
    rec.art = { key: first, sent: '', pendingFrame: null };
    tryArt(rec, list, 0, first);
  }

  function tryArt(rec, list, index, setKey) {
    // A newer set of pictures (next track) took over.
    if (rec.gone || rec.art.key !== setKey || index >= list.length) return;
    var c = list[index];
    if (c.frame) {
      // A frame of the video, a few seconds in (maybeShootFrame).
      rec.art.pendingFrame = { list: list, index: index, setKey: setKey };
      maybeShootFrame(rec);
      return;
    }
    var url;
    try {
      url = new URL(c.url, location.href).href;
    } catch (e) {
      tryArt(rec, list, index + 1, setKey);
      return;
    }
    if (!/^(https?|data|blob):/i.test(url)) {
      tryArt(rec, list, index + 1, setKey);
      return;
    }
    fetch(url, { credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) throw new Error('status ' + res.status);
        return res.blob();
      })
      .then(function (blob) {
        // QDN serves pictures as application/octet-stream: the decoder
        // decides what is a picture. Only text and HTML are refused early.
        if (/^(text|application\/(json|xhtml|xml))/i.test(blob.type || '')) {
          throw new Error('not an image');
        }
        if (blob.size > 8 * 1024 * 1024) throw new Error('too big');
        return createImageBitmap(blob);
      })
      .then(function (bitmap) {
        var data = toJpeg(bitmap, bitmap.width, bitmap.height);
        if (bitmap.close) bitmap.close();
        if (!data) throw new Error('no picture');
        if (rec.art.key === setKey) sendArt(rec, c.key, data);
      })
      .catch(function () {
        tryArt(rec, list, index + 1, setKey);
      });
  }

  function toJpeg(source, w, h) {
    if (!(w > 0 && h > 0)) return '';
    var scale = Math.min(1, ART_MAX_PX / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * scale));
    var ch = Math.max(1, Math.round(h * scale));
    try {
      var canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(source, 0, 0, cw, ch);
      return canvas.toDataURL('image/jpeg', 0.86);
    } catch (e) {
      // Tainted (another site's picture without CORS) or no canvas.
      return '';
    }
  }

  function tooDark(dataSource) {
    try {
      var c = document.createElement('canvas');
      c.width = 16;
      c.height = 16;
      var ctx = c.getContext('2d');
      ctx.drawImage(dataSource, 0, 0, 16, 16);
      var px = ctx.getImageData(0, 0, 16, 16).data;
      var sum = 0;
      for (var i = 0; i < px.length; i += 4) {
        sum += px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
      }
      return sum / (px.length / 4) < 14;
    } catch (e) {
      return false;
    }
  }

  function maybeShootFrame(rec) {
    var pending = rec.art && rec.art.pendingFrame;
    if (!pending || rec.gone) return;
    if (rec.art.key !== pending.setKey) {
      rec.art.pendingFrame = null;
      return;
    }
    var el = rec.el;
    if (el.paused || el.readyState < 2 || !(el.videoWidth > 0)) return;
    var at = el.currentTime;
    var wantAt = rec.frameShotAt ? rec.frameShotAt + 5 : 2.5;
    if (at < wantAt) return;
    rec.frameShotAt = at;
    // Fade-ins start black: look again 5 s later, until 20 s in.
    if (at < 20 && tooDark(el)) return;
    var data = toJpeg(el, el.videoWidth, el.videoHeight);
    rec.art.pendingFrame = null;
    if (data) sendArt(rec, pending.list[pending.index].key, data);
    else tryArt(rec, pending.list, pending.index + 1, pending.setKey);
  }

  function sendArt(rec, key, data) {
    rec.art.sent = key;
    send({ t: 'a', id: rec.id, ak: key, img: data });
    report(rec, true);
  }

  // ── navigator.mediaSession ───────────────────────────────────────────

  function onSessionChanged() {
    if (!activeId) return;
    var rec = players.get(activeId);
    if (rec) report(rec, false);
  }

  function hookSession() {
    var ms = null;
    try {
      ms = navigator.mediaSession;
    } catch (e) {
      ms = null;
    }
    if (!ms) {
      polyfillSession();
      return;
    }
    var proto = Object.getPrototypeOf(ms);
    try {
      var desc = Object.getOwnPropertyDescriptor(proto, 'metadata');
      if (desc && desc.set && desc.get) {
        Object.defineProperty(proto, 'metadata', {
          configurable: true,
          enumerable: desc.enumerable,
          get: function () {
            return desc.get.call(this);
          },
          set: function (value) {
            desc.set.call(this, value);
            metadata = value || null;
            onSessionChanged();
          },
        });
      }
    } catch (e) {
      /* leave metadata alone */
    }
    try {
      var origSet = proto.setActionHandler;
      if (typeof origSet === 'function') {
        proto.setActionHandler = function (action, handler) {
          var result = origSet.call(this, action, handler);
          handlers[String(action)] =
            typeof handler === 'function' ? handler : null;
          onSessionChanged();
          return result;
        };
      }
    } catch (e) {
      /* leave handlers alone */
    }
    try {
      var origPos = proto.setPositionState;
      if (typeof origPos === 'function') {
        proto.setPositionState = function (state) {
          var result = origPos.call(this, state);
          positionState =
            state && state.duration > 0
              ? {
                  duration: +state.duration,
                  position: +state.position || 0,
                }
              : null;
          return result;
        };
      }
    } catch (e) {
      /* leave position alone */
    }
  }

  // WebViews without navigator.mediaSession: Q-Apps that use it still give
  // GO a title, artist, cover and Next / Previous.
  function polyfillSession() {
    try {
      if (typeof window.MediaMetadata !== 'function') {
        var Meta = function MediaMetadata(init) {
          init = init || {};
          this.title = String(init.title || '');
          this.artist = String(init.artist || '');
          this.album = String(init.album || '');
          this.artwork = (init.artwork || []).map(function (a) {
            var src = '';
            try {
              src = new URL(a.src, location.href).href;
            } catch (e) {
              src = String(a.src || '');
            }
            return { src: src, sizes: a.sizes || '', type: a.type || '' };
          });
        };
        Object.defineProperty(window, 'MediaMetadata', {
          configurable: true,
          writable: true,
          value: Meta,
        });
      }
      var session = {
        playbackState: 'none',
        setActionHandler: function (action, handler) {
          handlers[String(action)] =
            typeof handler === 'function' ? handler : null;
          onSessionChanged();
        },
        setPositionState: function (state) {
          positionState =
            state && state.duration > 0
              ? {
                  duration: +state.duration,
                  position: +state.position || 0,
                }
              : null;
        },
      };
      Object.defineProperty(session, 'metadata', {
        enumerable: true,
        get: function () {
          return metadata;
        },
        set: function (value) {
          metadata = value || null;
          onSessionChanged();
        },
      });
      Object.defineProperty(Navigator.prototype, 'mediaSession', {
        configurable: true,
        get: function () {
          return session;
        },
      });
    } catch (e) {
      /* no polyfill */
    }
  }

  // ── Commands from GO ─────────────────────────────────────────────────

  function callHandler(action, details) {
    var h = handlers[action];
    if (typeof h !== 'function') return false;
    try {
      details = details || {};
      details.action = action;
      h(details);
    } catch (e) {
      /* the page's handler threw */
    }
    return true;
  }

  function clampTime(el, t) {
    if (!(t >= 0)) t = 0;
    var d = el.duration;
    if (isFinite(d) && d > 0 && t > d) t = Math.max(0, d - 0.25);
    return t;
  }

  function onCommand(event) {
    var msg = null;
    try {
      msg = JSON.parse(event && event.data);
    } catch (e) {
      return;
    }
    if (!msg || typeof msg.c !== 'string') return;
    if (msg.c === 'sync') {
      reportAll();
      return;
    }
    var rec = players.get(msg.id);
    if (!rec || rec.gone) return;
    var el = rec.el;
    var own = rec.id === activeId;
    try {
      switch (msg.c) {
        case 'play':
          if (own && callHandler('play')) break;
          var p = origPlay.call(el);
          if (p && typeof p.catch === 'function') p.catch(function () {});
          break;
        case 'pause':
          if (own && callHandler('pause')) break;
          el.pause();
          break;
        case 'stop':
          if (own && callHandler('stop')) break;
          el.pause();
          break;
        case 'seek':
          var to = clampTime(el, +msg.to);
          if (own && callHandler('seekto', { seekTime: to, fastSeek: false }))
            break;
          el.currentTime = to;
          break;
        case 'skip':
          var by = +msg.by || 0;
          if (own && by < 0 && callHandler('seekbackward', { seekOffset: -by }))
            break;
          if (own && by > 0 && callHandler('seekforward', { seekOffset: by }))
            break;
          el.currentTime = clampTime(el, el.currentTime + by);
          break;
        case 'next':
          if (own) callHandler('nexttrack');
          break;
        case 'prev':
          if (own) callHandler('previoustrack');
          break;
        default:
          break;
      }
    } catch (e) {
      /* the element refused */
    }
  }

  // ── Wiring ───────────────────────────────────────────────────────────

  try {
    if (typeof bridge.addEventListener === 'function') {
      bridge.addEventListener('message', onCommand);
    } else {
      bridge.onmessage = onCommand;
    }
  } catch (e) {
    return;
  }

  HTMLMediaElement.prototype.play = function play() {
    try {
      track(this);
    } catch (e) {
      /* still play */
    }
    return origPlay.apply(this, arguments);
  };

  for (var i = 0; i < DISCOVERY.length; i++) {
    window.addEventListener(DISCOVERY[i], onDiscovery, true);
  }
  hookSession();

  window.addEventListener('pagehide', function () {
    if (players.size) send({ t: 'u' });
  });
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) reportAll();
  });
})();
