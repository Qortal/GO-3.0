/*
 * Boot guard for the #app-splash overlay in index.html.
 *
 * src/main.tsx hides the splash, but its timers only exist once the whole
 * bundle (several MB) has loaded and run. A bundle that throws while it loads,
 * or never finishes, would leave the logo up until the app is force-closed.
 * This plain script runs before the bundle: if main.tsx has not reported in
 * (window.__goBootDone) after an error or after a long wait, it saves why to
 * the crash log Copy diagnostics reads and puts a Restart button on the splash.
 *
 * It cannot use i18next (that is part of the bundle), so its two strings carry
 * their own copies for the 12 languages.
 */
(function () {
  'use strict';

  /* Same key and record shape as src/common/fatalErrorLog.ts. */
  var FATAL_LOG_KEY = 'qgo:fatal-errors';
  var FATAL_LOG_MAX = 8;
  /*
   * Same keys as src/lib/appLock.ts prepareCrashReload(): a restart must go
   * back through the fingerprint or password unlock, never resume the wallet.
   */
  var SESSION_KEYS_TO_CLEAR = [
    'go_app_unlocked_session_v1',
    'qortal:last-authenticated-wallet-auto-select-attempted',
  ];
  /* Longer than a cold start with WebView JIT off on a slow phone. */
  var SLOW_BOOT_MS = 25000;
  /* After an error, how long main.tsx gets to report in anyway. */
  var AFTER_ERROR_MS = 3000;

  var TEXT = {
    ar: ['يواجه GO مشكلة في بدء التشغيل.', 'إعادة التشغيل'],
    de: ['GO hat Probleme beim Starten.', 'Neu starten'],
    en: ['GO is having trouble starting.', 'Restart'],
    es: ['GO tiene problemas para iniciarse.', 'Reiniciar'],
    et: ['GO käivitamisel on probleeme.', 'Taaskäivita'],
    fi: ['GO:n käynnistyksessä on ongelmia.', 'Käynnistä uudelleen'],
    fr: ['GO a du mal à démarrer.', 'Redémarrer'],
    it: ['GO ha problemi ad avviarsi.', 'Riavvia'],
    ja: ['GOの起動に問題が発生しています。', '再起動'],
    pt: ['O GO está com problemas para iniciar.', 'Reiniciar'],
    ru: ['GO не может запуститься.', 'Перезапустить'],
    zh: ['GO 启动遇到问题。', '重新启动'],
  };

  var startedAt = Date.now();
  var done = false;
  var shown = false;
  var firstError = null;
  var afterErrorTimer = null;

  function language() {
    var raw = '';
    try {
      raw = localStorage.getItem('i18nextLng') || '';
    } catch (e) {
      /* storage blocked */
    }
    var base = String(raw).split('-')[0];
    return TEXT[base] ? base : 'en';
  }

  function record(message, stack) {
    try {
      var list = JSON.parse(localStorage.getItem(FATAL_LOG_KEY) || '[]');
      if (!Array.isArray(list)) list = [];
      var entry = {
        at: new Date().toISOString(),
        kind: 'error',
        message: String(message).slice(0, 300),
      };
      if (stack) entry.stack = String(stack).slice(0, 4000);
      list.unshift(entry);
      localStorage.setItem(
        FATAL_LOG_KEY,
        JSON.stringify(list.slice(0, FATAL_LOG_MAX))
      );
    } catch (e) {
      /* storage full or blocked */
    }
  }

  function restart() {
    try {
      for (var i = 0; i < SESSION_KEYS_TO_CLEAR.length; i += 1) {
        sessionStorage.removeItem(SESSION_KEYS_TO_CLEAR[i]);
      }
    } catch (e) {
      /* a fresh page starts locked anyway when storage is blocked */
    }
    window.location.reload();
  }

  function showRestart(reason) {
    if (done || shown) return;
    var splash = document.getElementById('app-splash');
    if (!splash) return;
    shown = true;
    record(
      (reason === 'timeout'
        ? 'GO still starting after ' + SLOW_BOOT_MS / 1000 + ' s'
        : 'GO did not start') + (firstError ? ': ' + firstError.message : ''),
      firstError && firstError.stack
    );
    var text = TEXT[language()];
    var box = document.createElement('div');
    box.className = 'app-splash__trouble';
    box.setAttribute('role', 'alert');
    var note = document.createElement('div');
    note.textContent = text[0];
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = text[1];
    button.addEventListener('click', restart);
    box.appendChild(note);
    box.appendChild(button);
    splash.appendChild(box);
    /* The splash is decoration until now; the button must be reachable. */
    splash.removeAttribute('aria-hidden');
  }

  function noteError(message, stack) {
    if (done) return;
    if (!firstError) firstError = { message: message, stack: stack };
    if (afterErrorTimer === null) {
      afterErrorTimer = window.setTimeout(function () {
        showRestart('error');
      }, AFTER_ERROR_MS);
    }
  }

  window.addEventListener(
    'error',
    function (event) {
      var target = event && event.target;
      if (target && target !== window && target.tagName) {
        /* A file that did not load. Only the app's own scripts matter. */
        var tag = String(target.tagName).toUpperCase();
        var rel = String(target.rel || '').toLowerCase();
        if (tag === 'SCRIPT' || (tag === 'LINK' && rel === 'modulepreload')) {
          noteError('failed to load ' + (target.src || target.href || tag));
        }
        return;
      }
      var error = event && event.error;
      noteError(
        (error && error.message) || (event && event.message) || 'error',
        error && error.stack
      );
    },
    true
  );

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason;
    noteError(
      (reason && reason.message) || String(reason),
      reason && reason.stack
    );
  });

  window.setTimeout(function () {
    showRestart('timeout');
  }, SLOW_BOOT_MS);

  /* src/main.tsx, once React has been handed the page. */
  window.__goBootDone = function () {
    if (done) return;
    done = true;
    if (afterErrorTimer !== null) window.clearTimeout(afterErrorTimer);
    /* A slow start that still made it: say how slow, next to the note. */
    if (shown) {
      record(
        'GO started after ' + Math.round((Date.now() - startedAt) / 1000) + ' s'
      );
    }
  };
})();
