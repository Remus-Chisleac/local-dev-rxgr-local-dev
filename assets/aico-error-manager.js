/*
 * aico-error-manager.js — a self-contained, devtools-style error collector for the
 * storefront. Captures uncaught JS errors, unhandled promise rejections and failed
 * network requests (fetch + XHR, any non-2xx incl. the preorder `{error:...}` 422s),
 * persists them in localStorage and surfaces them in a floating bubble the user can
 * open and clear — think the Vercel/Vite error bubble, but ours.
 *
 * Self-contained on purpose: it injects its own <style>, reads/writes only its own
 * localStorage key, and installs global handlers WITHOUT swallowing anything (every
 * wrapper re-throws / passes the original result through untouched).
 */
(function () {
  'use strict';

  if (window.__aicoErrorManager) return; // guard against double-injection
  window.__aicoErrorManager = true;

  var STORAGE_KEY = 'aico_error_log';
  var MAX_ENTRIES = 50;
  var BODY_SNIPPET = 400; // max chars of a failed response body we keep

  /* ---------------------------------------------------------------- store */

  var entries = readStore();

  function readStore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function writeStore() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
    } catch (e) {
      /* quota / disabled storage — keep the in-memory copy only */
    }
  }

  function uid() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function record(entry) {
    entry.id = uid();
    entry.time = new Date().toISOString();
    entries.unshift(entry);
    if (entries.length > MAX_ENTRIES) entries = entries.slice(0, MAX_ENTRIES);
    writeStore();
    render();
  }

  function clearAll() {
    entries = [];
    writeStore();
    render();
  }

  function dismiss(id) {
    entries = entries.filter(function (e) { return e.id !== id; });
    writeStore();
    render();
  }

  /* ------------------------------------------------------------- capturing */

  // Uncaught JS errors (and, for resource errors, the failing element's src).
  window.addEventListener('error', function (event) {
    if (event && event.target && event.target !== window && (event.target.src || event.target.href)) {
      record({
        type: 'resource',
        message: 'Failed to load ' + (event.target.tagName || 'resource').toLowerCase(),
        source: event.target.src || event.target.href
      });
      return;
    }
    record({
      type: 'js',
      message: (event && event.message) || 'Uncaught error',
      source: event && event.filename ? (event.filename + ':' + event.lineno + ':' + event.colno) : '',
      stack: event && event.error && event.error.stack ? String(event.error.stack) : ''
    });
  }, true);

  // Unhandled promise rejections.
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event ? event.reason : null;
    record({
      type: 'promise',
      message: reason && reason.message ? String(reason.message) : String(reason),
      stack: reason && reason.stack ? String(reason.stack) : ''
    });
  });

  // fetch() — record any non-2xx response and any network failure.
  if (typeof window.fetch === 'function') {
    var nativeFetch = window.fetch;
    window.fetch = function (input, init) {
      var method = (init && init.method) || (input && input.method) || 'GET';
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      return nativeFetch.apply(this, arguments).then(function (response) {
        if (!response.ok) {
          var clone;
          try { clone = response.clone(); } catch (e) { clone = null; }
          var push = function (body) {
            record({
              type: 'http',
              message: method.toUpperCase() + ' ' + response.status + ' ' + (response.statusText || ''),
              source: url,
              status: response.status,
              body: body ? String(body).slice(0, BODY_SNIPPET) : ''
            });
          };
          if (clone) { clone.text().then(push, function () { push(''); }); }
          else { push(''); }
        }
        return response;
      }, function (error) {
        record({
          type: 'network',
          message: method.toUpperCase() + ' request failed: ' + (error && error.message ? error.message : 'network error'),
          source: url
        });
        throw error;
      });
    };
  }

  // XMLHttpRequest — jQuery and the preorder `.js` endpoints go through this.
  if (window.XMLHttpRequest) {
    var proto = window.XMLHttpRequest.prototype;
    var nativeOpen = proto.open;
    var nativeSend = proto.send;
    proto.open = function (method, url) {
      this.__aicoReq = { method: method || 'GET', url: url || '' };
      return nativeOpen.apply(this, arguments);
    };
    proto.send = function () {
      var xhr = this;
      this.addEventListener('loadend', function () {
        var req = xhr.__aicoReq || { method: 'GET', url: '' };
        if (xhr.status === 0) {
          record({
            type: 'network',
            message: req.method.toUpperCase() + ' request failed (aborted or network error)',
            source: req.url
          });
        } else if (xhr.status >= 400) {
          var body = '';
          try { body = String(xhr.responseText || '').slice(0, BODY_SNIPPET); } catch (e) {}
          record({
            type: 'http',
            message: req.method.toUpperCase() + ' ' + xhr.status + ' ' + (xhr.statusText || ''),
            source: req.url,
            status: xhr.status,
            body: body
          });
        }
      });
      return nativeSend.apply(this, arguments);
    };
  }

  /* ------------------------------------------------------------------- UI */

  var els = {};
  var open = false;

  function injectStyles() {
    if (document.getElementById('aico-error-manager-styles')) return;
    var style = document.createElement('style');
    style.id = 'aico-error-manager-styles';
    style.textContent = [
      '.aico-errmgr{position:fixed;left:16px;bottom:16px;z-index:2147483000;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}',
      '.aico-errmgr[hidden]{display:none;}',
      '.aico-errmgr-bubble{display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 14px;border-radius:999px;border:1px solid #3a1c1c;background:#1c1010;color:#ffb4b4;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.35);}',
      '.aico-errmgr-bubble:hover{background:#271414;}',
      '.aico-errmgr-dot{width:8px;height:8px;border-radius:50%;background:#ff5b5b;box-shadow:0 0 0 3px rgba(255,91,91,.2);}',
      '.aico-errmgr-count{background:#ff5b5b;color:#1c1010;border-radius:999px;min-width:18px;height:18px;padding:0 5px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;}',
      '.aico-errmgr-panel{position:absolute;left:0;bottom:52px;width:min(440px,calc(100vw - 32px));max-height:min(60vh,540px);display:flex;flex-direction:column;background:#141414;color:#e6e6e6;border:1px solid #2a2a2a;border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.5);overflow:hidden;}',
      '.aico-errmgr-panel[hidden]{display:none;}',
      '.aico-errmgr-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid #2a2a2a;background:#1a1a1a;}',
      '.aico-errmgr-title{font-size:13px;font-weight:700;color:#fff;flex:1;}',
      '.aico-errmgr-btn{appearance:none;border:1px solid #333;background:#222;color:#ddd;border-radius:6px;padding:4px 9px;font-size:12px;font-family:inherit;cursor:pointer;}',
      '.aico-errmgr-btn:hover{background:#2c2c2c;}',
      '.aico-errmgr-btn-clear{color:#ffb4b4;border-color:#3a1c1c;}',
      '.aico-errmgr-list{overflow:auto;padding:6px;}',
      '.aico-errmgr-empty{padding:22px 14px;text-align:center;color:#888;font-size:12px;}',
      '.aico-errmgr-item{border:1px solid #262626;border-radius:8px;margin:6px 4px;background:#181818;}',
      '.aico-errmgr-item-head{display:flex;align-items:flex-start;gap:8px;padding:9px 10px;cursor:pointer;}',
      '.aico-errmgr-tag{flex:none;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:2px 6px;border-radius:4px;background:#3a1c1c;color:#ff9b9b;}',
      '.aico-errmgr-tag.http,.aico-errmgr-tag.network{background:#3a2a12;color:#ffcf8f;}',
      '.aico-errmgr-msg{flex:1;min-width:0;font-size:12px;line-height:1.4;color:#eee;word-break:break-word;}',
      '.aico-errmgr-src{display:block;margin-top:3px;font-size:11px;color:#8a8a8a;word-break:break-all;}',
      '.aico-errmgr-x{flex:none;color:#777;background:none;border:none;cursor:pointer;font-size:14px;line-height:1;padding:0 2px;}',
      '.aico-errmgr-x:hover{color:#fff;}',
      '.aico-errmgr-body{display:none;padding:0 10px 10px 10px;}',
      '.aico-errmgr-item.open .aico-errmgr-body{display:block;}',
      '.aico-errmgr-pre{margin:0;padding:8px;background:#0e0e0e;border:1px solid #262626;border-radius:6px;font-size:11px;color:#bdbdbd;white-space:pre-wrap;word-break:break-word;max-height:160px;overflow:auto;}',
      '.aico-errmgr-meta{font-size:10px;color:#777;margin-top:6px;}'
    ].join('');
    document.head.appendChild(style);
  }

  function esc(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function ago(iso) {
    var t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    return Math.round(s / 3600) + 'h ago';
  }

  function build() {
    injectStyles();
    var root = document.createElement('div');
    root.className = 'aico-errmgr';
    root.setAttribute('aria-live', 'polite');
    root.innerHTML =
      '<div class="aico-errmgr-panel" hidden role="dialog" aria-label="Page errors">' +
        '<div class="aico-errmgr-head">' +
          '<span class="aico-errmgr-title">Errors</span>' +
          '<button type="button" class="aico-errmgr-btn aico-errmgr-btn-clear" data-aico-err-clear>Clear all</button>' +
          '<button type="button" class="aico-errmgr-btn" data-aico-err-close>Close</button>' +
        '</div>' +
        '<div class="aico-errmgr-list" data-aico-err-list></div>' +
      '</div>' +
      '<button type="button" class="aico-errmgr-bubble" data-aico-err-toggle aria-haspopup="dialog">' +
        '<span class="aico-errmgr-dot"></span>' +
        '<span>Errors</span>' +
        '<span class="aico-errmgr-count" data-aico-err-count>0</span>' +
      '</button>';
    document.body.appendChild(root);

    els.root = root;
    els.panel = root.querySelector('.aico-errmgr-panel');
    els.list = root.querySelector('[data-aico-err-list]');
    els.count = root.querySelector('[data-aico-err-count]');

    root.querySelector('[data-aico-err-toggle]').addEventListener('click', toggle);
    root.querySelector('[data-aico-err-close]').addEventListener('click', function () { setOpen(false); });
    root.querySelector('[data-aico-err-clear]').addEventListener('click', clearAll);

    // Event delegation for per-item expand / dismiss.
    els.list.addEventListener('click', function (e) {
      var dismissBtn = e.target.closest ? e.target.closest('[data-aico-err-dismiss]') : null;
      if (dismissBtn) { e.stopPropagation(); dismiss(dismissBtn.getAttribute('data-aico-err-dismiss')); return; }
      var head = e.target.closest ? e.target.closest('.aico-errmgr-item-head') : null;
      if (head && head.parentNode) head.parentNode.classList.toggle('open');
    });
  }

  function toggle() { setOpen(!open); }
  function setOpen(next) {
    open = next;
    if (els.panel) els.panel.hidden = !open;
  }

  function render() {
    if (!els.root) {
      if (!document.body) { document.addEventListener('DOMContentLoaded', render); return; }
      build();
    }
    var n = entries.length;
    els.count.textContent = n > 99 ? '99+' : String(n);
    els.root.hidden = n === 0;
    if (n === 0) { setOpen(false); els.list.innerHTML = ''; return; }

    var html = entries.map(function (e) {
      var detail = '';
      if (e.body) detail += '<pre class="aico-errmgr-pre">' + esc(e.body) + '</pre>';
      if (e.stack) detail += '<pre class="aico-errmgr-pre">' + esc(e.stack) + '</pre>';
      detail += '<div class="aico-errmgr-meta">' + esc(e.time) + '</div>';
      return '' +
        '<div class="aico-errmgr-item">' +
          '<div class="aico-errmgr-item-head">' +
            '<span class="aico-errmgr-tag ' + esc(e.type) + '">' + esc(e.type) + '</span>' +
            '<span class="aico-errmgr-msg">' + esc(e.message) +
              (e.source ? '<span class="aico-errmgr-src">' + esc(e.source) + '</span>' : '') +
              '<span class="aico-errmgr-src">' + esc(ago(e.time)) + '</span>' +
            '</span>' +
            '<button type="button" class="aico-errmgr-x" title="Dismiss" data-aico-err-dismiss="' + esc(e.id) + '">&times;</button>' +
          '</div>' +
          '<div class="aico-errmgr-body">' + detail + '</div>' +
        '</div>';
    }).join('');
    els.list.innerHTML = html;
  }

  if (document.body) render();
  else document.addEventListener('DOMContentLoaded', render);
})();
