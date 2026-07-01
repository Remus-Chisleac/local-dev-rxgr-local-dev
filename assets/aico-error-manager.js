/*
 * aico-error-manager.js — surfaces failures of the actions the shopper triggers
 * (add-to-cart, preorder add/change/submit, checkout submit) as clear, actionable
 * messages. A new error first pops up as a toast, then collapses into a small
 * bubble that keeps a running list the shopper can reopen or clear.
 *
 * Deliberately NOT a catch-all: it only looks at a whitelist of action endpoints,
 * so missing images / background reads never raise noise. Each failure is mapped
 * from its error code (or HTTP status) to a message the shopper can act on — if
 * it's their input, the message says how to fix it; if it's a server/technical
 * fault, it tells them to contact support and offers a prefilled email.
 *
 * Styling matches the theme tokens (light card, --aico-border, 0.5rem radius).
 * Copy ships in de + en and is picked from <html lang>. The support recipient is
 * window.__AICO_SUPPORT_EMAIL__ (set in the layout from the customer's contact).
 */
(function () {
  'use strict';

  if (window.__aicoErrorManager) return;
  window.__aicoErrorManager = true;

  var STORAGE_KEY = 'aico_error_log';
  var MAX_ENTRIES = 30;
  var TOAST_MS = 7000;

  var lang = (document.documentElement.getAttribute('lang') || 'de').slice(0, 2).toLowerCase();
  var isDe = lang !== 'en';
  var SUPPORT_EMAIL = String(window.__AICO_SUPPORT_EMAIL__ || '').trim();

  /* --------------------------------------------------------- what we watch */
  // Only failures of user-triggered actions are surfaced — nothing else.
  var ACTION_PATTERNS = [
    /\/cart\/add/, /\/cart\/change/, /\/cart\/update/, /\/cart\/clear/, /\/cart\/discount/,
    /\/preorder\/cart\/add/, /\/preorder\/cart\/change/, /\/preorder\/cart\/clear/, /\/preorder\/cart\/submit/,
    /\/checkout\/submit/
  ];
  function isActionUrl(url) {
    if (!url) return false;
    for (var i = 0; i < ACTION_PATTERNS.length; i++) if (ACTION_PATTERNS[i].test(url)) return true;
    return false;
  }

  /* -------------------------------------------------- code → message catalog */
  // severity: 'user' = the shopper can fix it; 'server' = tell them to contact support.
  var CATALOG = {
    no_delivery_address:  { s: 'user', de: 'Bitte wählen Sie eine Lieferadresse aus.', en: 'Please select a delivery address.' },
    no_debtor:            { s: 'user', de: 'Bitte wählen Sie ein Kundenkonto (B2B) aus.', en: 'Please select a customer account.' },
    no_preorder_date:     { s: 'user', de: 'Bitte wählen Sie für diesen Artikel ein Lieferdatum.', en: 'Please choose a delivery date for this item.' },
    invalid_product:      { s: 'user', de: 'Dieser Artikel konnte nicht hinzugefügt werden. Bitte laden Sie die Seite neu und versuchen Sie es erneut.', en: 'This item could not be added. Please reload the page and try again.' },
    invalid_line:         { s: 'user', de: 'Diese Position konnte nicht aktualisiert werden. Bitte laden Sie die Seite neu.', en: 'This line could not be updated. Please reload the page.' },
    out_of_stock:         { s: 'user', de: 'Dieser Artikel ist nicht mehr an Lager.', en: 'This item is out of stock.' },
    committed_quantity:   { s: 'user', de: 'Die Menge kann nicht unter die bereits bestätigte Menge gesenkt werden.', en: 'The quantity can’t be reduced below the already-confirmed amount.' },
    version_conflict:     { s: 'user', de: 'Der Warenkorb wurde zwischenzeitlich geändert. Wir haben ihn aktualisiert – bitte versuchen Sie es erneut.', en: 'The cart changed in the meantime. We’ve refreshed it — please try again.' },
    cart_modified:        { s: 'user', de: 'Der Warenkorb wurde zwischenzeitlich geändert. Bitte prüfen Sie ihn und versuchen Sie es erneut.', en: 'The cart changed in the meantime. Please review it and try again.' },
    missing_fields:       { s: 'user', de: 'Bitte füllen Sie alle Pflichtfelder aus.', en: 'Please fill in all required fields.' },
    ineligible:           { s: 'user', de: 'Diese Vorbestellung kann nicht abgeschickt werden. Bitte prüfen Sie die markierten Artikel.', en: 'This preorder can’t be submitted. Please review the flagged items.' },
    no_cart:              { s: 'user', de: 'Ihr Warenkorb wurde nicht gefunden. Bitte laden Sie die Seite neu.', en: 'Your cart could not be found. Please reload the page.' },
    unauthorized:         { s: 'user', de: 'Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.', en: 'Your session has expired. Please log in again.' },
    login_required:       { s: 'user', de: 'Bitte melden Sie sich an, um fortzufahren.', en: 'Please log in to continue.' },
    // Server / technical — the shopper can’t fix these; point them at support.
    no_active_preorder_session: { s: 'server', de: 'Es besteht ein technisches Problem mit Ihrer Vorbestellung. Bitte kontaktieren Sie den Support.', en: 'A technical problem occurred with your preorder. Please contact support.' },
    no_shop:              { s: 'server', de: 'Ihr Shop konnte nicht ermittelt werden. Bitte kontaktieren Sie den Support.', en: 'Your shop could not be determined. Please contact support.' },
    add_failed:           { s: 'server', de: 'Der Artikel konnte aus technischen Gründen nicht hinzugefügt werden. Bitte kontaktieren Sie den Support.', en: 'The item could not be added due to a technical problem. Please contact support.' },
    submit_failed:        { s: 'server', de: 'Das Absenden ist aus technischen Gründen fehlgeschlagen. Bitte kontaktieren Sie den Support.', en: 'Submitting failed due to a technical problem. Please contact support.' }
  };
  var GENERIC = {
    user:    { de: 'Etwas ist schiefgelaufen. Bitte prüfen Sie Ihre Eingaben und versuchen Sie es erneut.', en: 'Something went wrong. Please check your entries and try again.' },
    server:  { de: 'Ein technisches Problem ist aufgetreten. Bitte kontaktieren Sie unseren Support.', en: 'A technical problem occurred. Please contact our support team.' },
    network: { de: 'Der Server ist nicht erreichbar. Bitte prüfen Sie Ihre Verbindung und versuchen Sie es erneut.', en: 'We couldn’t reach the server. Please check your connection and try again.' }
  };
  var UI = {
    title:   { de: 'Fehler', en: 'Errors' },
    email:   { de: 'Support per E-Mail kontaktieren', en: 'Email support' },
    clear:   { de: 'Alle löschen', en: 'Clear all' },
    close:   { de: 'Schliessen', en: 'Close' },
    dismiss: { de: 'Ausblenden', en: 'Dismiss' },
    empty:   { de: 'Keine Fehler.', en: 'No errors.' },
    subject: { de: 'Fehler im Shop', en: 'Shop error report' }
  };
  function t(pack) { return pack ? (isDe ? pack.de : pack.en) : ''; }

  function classify(code, status) {
    var known = code && CATALOG[code];
    if (known) return { severity: known.s, message: t(known), code: code };
    if (status === 0) return { severity: 'server', message: t(GENERIC.network), code: 'network' };
    if (status >= 500) return { severity: 'server', message: t(GENERIC.server), code: code || ('http_' + status) };
    if (status === 401) return { severity: 'user', message: t(CATALOG.unauthorized), code: 'unauthorized' };
    if (status >= 400) return { severity: 'user', message: t(GENERIC.user), code: code || ('http_' + status) };
    return { severity: 'server', message: t(GENERIC.server), code: code || 'unknown' };
  }

  /* -------------------------------------------------------------- the store */
  var entries = readStore();
  function readStore() {
    try { var l = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); return Array.isArray(l) ? l : []; }
    catch (e) { return []; }
  }
  function writeStore() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES))); } catch (e) {}
  }
  function uid() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }

  function push(info, meta) {
    var entry = {
      id: uid(),
      time: new Date().toISOString(),
      severity: info.severity,
      code: info.code,
      message: info.message,
      status: meta.status,
      url: meta.url
    };
    entries.unshift(entry);
    if (entries.length > MAX_ENTRIES) entries = entries.slice(0, MAX_ENTRIES);
    writeStore();
    render();
    toast(entry);
  }
  function clearAll() { entries = []; writeStore(); render(); }
  function dismiss(id) { entries = entries.filter(function (e) { return e.id !== id; }); writeStore(); render(); }

  /* ---------------------------------------------------------- request hooks */
  function handleFailure(url, status, bodyText) {
    if (!isActionUrl(url)) return;
    var code = '';
    if (bodyText) {
      try { var j = JSON.parse(bodyText); if (j && typeof j.error === 'string') code = j.error; } catch (e) {}
    }
    push(classify(code, status), { status: status, url: url });
  }

  if (typeof window.fetch === 'function') {
    var nativeFetch = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      return nativeFetch.apply(this, arguments).then(function (response) {
        if (!response.ok && isActionUrl(url)) {
          var clone; try { clone = response.clone(); } catch (e) { clone = null; }
          if (clone) clone.text().then(function (b) { handleFailure(url, response.status, b); }, function () { handleFailure(url, response.status, ''); });
          else handleFailure(url, response.status, '');
        }
        return response;
      }, function (error) {
        if (isActionUrl(url)) handleFailure(url, 0, '');
        throw error;
      });
    };
  }

  if (window.XMLHttpRequest) {
    var xproto = window.XMLHttpRequest.prototype;
    var nativeOpen = xproto.open, nativeSend = xproto.send;
    xproto.open = function (method, url) { this.__aicoUrl = url || ''; return nativeOpen.apply(this, arguments); };
    xproto.send = function () {
      var xhr = this;
      this.addEventListener('loadend', function () {
        var url = xhr.__aicoUrl || '';
        if (!isActionUrl(url)) return;
        if (xhr.status === 0) handleFailure(url, 0, '');
        else if (xhr.status >= 400) {
          var body = ''; try { body = String(xhr.responseText || ''); } catch (e) {}
          handleFailure(url, xhr.status, body);
        }
      });
      return nativeSend.apply(this, arguments);
    };
  }

  /* --------------------------------------------------------------------- UI */
  var els = {};
  var panelOpen = false;

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function ago(iso) {
    var ms = Date.now() - new Date(iso).getTime();
    if (isNaN(ms)) return '';
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return isDe ? 'gerade eben' : 'just now';
    if (s < 3600) return Math.round(s / 60) + (isDe ? ' Min.' : 'm');
    return Math.round(s / 3600) + (isDe ? ' Std.' : 'h');
  }
  function mailtoHref(entry) {
    var subject = t(UI.subject) + (entry.code ? ' [' + entry.code + ']' : '');
    var lines = [
      entry.message, '',
      (isDe ? 'Technische Angaben (bitte belassen):' : 'Technical details (please keep):'),
      'Code: ' + (entry.code || '-'),
      'Status: ' + (entry.status != null ? entry.status : '-'),
      'URL: ' + (entry.url || '-'),
      'Seite: ' + location.href,
      'Zeit: ' + entry.time
    ];
    return 'mailto:' + encodeURIComponent(SUPPORT_EMAIL) +
      '?subject=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(lines.join('\n'));
  }

  function injectStyles() {
    if (document.getElementById('aico-errmgr-styles')) return;
    var css = [
      '.aico-errmgr{position:fixed;left:16px;bottom:16px;z-index:2147483000;font-family:inherit;display:flex;flex-direction:column;align-items:flex-start;gap:10px;}',
      '.aico-errmgr[hidden]{display:none;}',
      '.aico-errmgr-bubble{display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 12px;border-radius:.5rem;border:1px solid var(--aico-border,#e5e7eb);background:var(--aico-card,#fff);color:var(--aico-fg,#1a1a1a);font-size:.8125rem;font-weight:600;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.12);}',
      '.aico-errmgr-bubble:hover{background:var(--aico-muted,#f4f4f5);}',
      '.aico-errmgr-ic{width:16px;height:16px;flex:none;color:#b91c1c;}',
      '.aico-errmgr-ic.user{color:#b45309;}',
      '.aico-errmgr-count{background:#b91c1c;color:#fff;border-radius:999px;min-width:18px;height:18px;padding:0 5px;display:inline-flex;align-items:center;justify-content:center;font-size:.6875rem;font-weight:700;}',
      '.aico-errmgr-count.user{background:#b45309;}',
      '.aico-errmgr-panel{width:min(400px,calc(100vw - 32px));max-height:min(60vh,520px);display:flex;flex-direction:column;background:var(--aico-card,#fff);color:var(--aico-fg,#1a1a1a);border:1px solid var(--aico-border,#e5e7eb);border-radius:.5rem;box-shadow:0 14px 40px rgba(0,0,0,.18);overflow:hidden;}',
      '.aico-errmgr-panel[hidden]{display:none;}',
      '.aico-errmgr-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--aico-border,#e5e7eb);}',
      '.aico-errmgr-h-title{font-size:.8125rem;font-weight:700;flex:1;}',
      '.aico-errmgr-btn{appearance:none;border:1px solid var(--aico-border,#e5e7eb);background:var(--aico-card,#fff);color:var(--aico-fg,#1a1a1a);border-radius:.375rem;padding:4px 9px;font-size:.75rem;font-family:inherit;cursor:pointer;}',
      '.aico-errmgr-btn:hover{background:var(--aico-muted,#f4f4f5);}',
      '.aico-errmgr-list{overflow:auto;padding:6px;}',
      '.aico-errmgr-empty{padding:20px 12px;text-align:center;color:var(--aico-muted-fg,#6b7280);font-size:.8125rem;}',
      '.aico-errmgr-item{border:1px solid var(--aico-border,#e5e7eb);border-left:3px solid #b91c1c;border-radius:.375rem;margin:6px 4px;padding:9px 10px;}',
      '.aico-errmgr-item.user{border-left-color:#b45309;}',
      '.aico-errmgr-item-top{display:flex;align-items:flex-start;gap:8px;}',
      '.aico-errmgr-msg{flex:1;min-width:0;font-size:.8125rem;line-height:1.45;word-break:break-word;}',
      '.aico-errmgr-when{display:block;margin-top:3px;font-size:.6875rem;color:var(--aico-muted-fg,#6b7280);}',
      '.aico-errmgr-x{flex:none;color:var(--aico-muted-fg,#6b7280);background:none;border:none;cursor:pointer;font-size:15px;line-height:1;padding:0 2px;}',
      '.aico-errmgr-x:hover{color:var(--aico-fg,#1a1a1a);}',
      '.aico-errmgr-mail{display:inline-block;margin-top:8px;font-size:.75rem;font-weight:600;color:var(--color-accent,#2563eb);text-decoration:none;}',
      '.aico-errmgr-mail:hover{text-decoration:underline;}',
      // Toast: pops up above the bubble, then collapses down into it.
      '.aico-errmgr-toast{width:min(360px,calc(100vw - 32px));background:var(--aico-card,#fff);color:var(--aico-fg,#1a1a1a);border:1px solid var(--aico-border,#e5e7eb);border-left:3px solid #b91c1c;border-radius:.5rem;box-shadow:0 10px 30px rgba(0,0,0,.18);padding:11px 12px;transform:translateY(12px) scale(.96);opacity:0;transform-origin:left bottom;transition:transform .28s cubic-bezier(.2,.7,.3,1),opacity .28s;}',
      '.aico-errmgr-toast.user{border-left-color:#b45309;}',
      '.aico-errmgr-toast.in{transform:none;opacity:1;}',
      '.aico-errmgr-toast.collapsing{transform:translateY(26px) scale(.35);opacity:0;}',
      '.aico-errmgr-toast-msg{font-size:.8125rem;line-height:1.45;}'
    ].join('');
    var style = document.createElement('style');
    style.id = 'aico-errmgr-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  var WARN_SVG = '<svg class="aico-errmgr-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';

  function worstSeverity() {
    for (var i = 0; i < entries.length; i++) if (entries[i].severity === 'server') return 'server';
    return entries.length ? 'user' : 'user';
  }

  function build() {
    injectStyles();
    var root = document.createElement('div');
    root.className = 'aico-errmgr';
    root.innerHTML =
      '<div class="aico-errmgr-panel" hidden role="dialog" aria-label="' + esc(t(UI.title)) + '">' +
        '<div class="aico-errmgr-head">' +
          '<span class="aico-errmgr-h-title">' + esc(t(UI.title)) + '</span>' +
          '<button type="button" class="aico-errmgr-btn" data-err-clear>' + esc(t(UI.clear)) + '</button>' +
          '<button type="button" class="aico-errmgr-btn" data-err-close>' + esc(t(UI.close)) + '</button>' +
        '</div>' +
        '<div class="aico-errmgr-list" data-err-list></div>' +
      '</div>' +
      '<div class="aico-errmgr-toasts" data-err-toasts></div>' +
      '<button type="button" class="aico-errmgr-bubble" data-err-toggle aria-haspopup="dialog">' +
        WARN_SVG + '<span>' + esc(t(UI.title)) + '</span>' +
        '<span class="aico-errmgr-count" data-err-count>0</span>' +
      '</button>';
    document.body.appendChild(root);
    els.root = root;
    els.panel = root.querySelector('.aico-errmgr-panel');
    els.list = root.querySelector('[data-err-list]');
    els.count = root.querySelector('[data-err-count]');
    els.icon = root.querySelector('.aico-errmgr-bubble .aico-errmgr-ic');
    els.toasts = root.querySelector('[data-err-toasts]');

    root.querySelector('[data-err-toggle]').addEventListener('click', function () { setPanel(!panelOpen); });
    root.querySelector('[data-err-close]').addEventListener('click', function () { setPanel(false); });
    root.querySelector('[data-err-clear]').addEventListener('click', clearAll);
    els.list.addEventListener('click', function (e) {
      var d = e.target.closest ? e.target.closest('[data-err-dismiss]') : null;
      if (d) dismiss(d.getAttribute('data-err-dismiss'));
    });
  }

  function setPanel(next) { panelOpen = next; if (els.panel) els.panel.hidden = !panelOpen; }

  function itemHtml(e) {
    var mail = e.severity === 'server'
      ? '<a class="aico-errmgr-mail" href="' + esc(mailtoHref(e)) + '">' + esc(t(UI.email)) + '</a>'
      : '';
    return '' +
      '<div class="aico-errmgr-item ' + esc(e.severity) + '">' +
        '<div class="aico-errmgr-item-top">' +
          '<span class="aico-errmgr-msg">' + esc(e.message) +
            '<span class="aico-errmgr-when">' + esc(ago(e.time)) + '</span>' +
          '</span>' +
          '<button type="button" class="aico-errmgr-x" title="' + esc(t(UI.dismiss)) + '" data-err-dismiss="' + esc(e.id) + '">&times;</button>' +
        '</div>' + mail +
      '</div>';
  }

  function render() {
    if (!els.root) {
      if (!document.body) { document.addEventListener('DOMContentLoaded', render); return; }
      build();
    }
    var n = entries.length;
    els.root.hidden = n === 0;
    els.count.textContent = n > 99 ? '99+' : String(n);
    var sev = worstSeverity();
    els.count.className = 'aico-errmgr-count' + (sev === 'user' ? ' user' : '');
    els.icon.className = 'aico-errmgr-ic' + (sev === 'user' ? ' user' : '');
    if (n === 0) { setPanel(false); els.list.innerHTML = ''; return; }
    els.list.innerHTML = entries.map(itemHtml).join('');
  }

  // Pop a toast, then collapse it into the bubble.
  function toast(entry) {
    if (!els.toasts) return;
    var el = document.createElement('div');
    el.className = 'aico-errmgr-toast ' + entry.severity;
    var mail = entry.severity === 'server'
      ? '<a class="aico-errmgr-mail" href="' + esc(mailtoHref(entry)) + '">' + esc(t(UI.email)) + '</a>'
      : '';
    el.innerHTML = '<div class="aico-errmgr-toast-msg">' + esc(entry.message) + '</div>' + mail;
    els.toasts.appendChild(el);
    // force reflow so the transition runs
    void el.offsetWidth;
    el.classList.add('in');
    var collapsed = false;
    var collapse = function () {
      if (collapsed) return; collapsed = true;
      el.classList.remove('in');
      el.classList.add('collapsing');
      var done = function () { if (el.parentNode) el.parentNode.removeChild(el); };
      el.addEventListener('transitionend', done, { once: true });
      setTimeout(done, 400);
    };
    // don't collapse while the pointer is hovering the toast
    var timer = setTimeout(collapse, TOAST_MS);
    el.addEventListener('mouseenter', function () { clearTimeout(timer); });
    el.addEventListener('mouseleave', function () { timer = setTimeout(collapse, 1500); });
    el.addEventListener('click', function (e) { if (e.target.tagName !== 'A') { clearTimeout(timer); collapse(); } });
  }

  if (document.body) render();
  else document.addEventListener('DOMContentLoaded', render);
})();
