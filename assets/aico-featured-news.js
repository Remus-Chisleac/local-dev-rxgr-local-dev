// Featured-news popup — port of b2b-shop's `FeaturedNewsDialog`
// (src/pages/index/HomePage/FeaturedNewsDialog). Shows the shopper's unread
// `is_special_article` news one at a time on the home page and writes the
// read receipts back.
//
// Ported behaviour, 1:1 with the React dialog:
//   • fetch the unread featured articles (page size 5, newest first)
//   • "mark as read" queues the current article and advances to the next one;
//     on the last one it flushes the queue and closes
//   • closing (X / backdrop / Esc) flushes whatever was already marked — an
//     article the shopper never marked stays unread and returns next visit
//   • `?hideFeatured` in the URL suppresses the popup (b2b's router guard)
//
// Changed on purpose: the body arrives as HTML rendered by the server
// (NewsContentRenderer), so there is no client-side content-builder walk; and
// the read-receipt control sits on its own footer row, never beside the
// article's own call-to-action button (which lives inside the body).
//
// Same no-framework IIFE style as quick-add.js; the dialog markup ships in
// snippets/aico-featured-news-popup.liquid and is filled in here.
(function () {
  'use strict';

  var configNode = document.getElementById('aico-featured-news-config');
  var root = document.querySelector('[data-aico-news-popup]');
  if (!configNode || !root) {
    return;
  }

  var config;
  try {
    config = JSON.parse(configNode.textContent || '{}');
  } catch (error) {
    return;
  }

  var i18n = config.i18n || {};
  if (!config.featuredUrl || !config.readUrl) {
    return;
  }

  // b2b-shop suppressed the dialog with `?hideFeatured` (used by links that
  // deep-link into the home page without wanting the popup).
  if (/[?&]hideFeatured\b/.test(window.location.search)) {
    return;
  }

  var refs = {
    panel: root.querySelector('.aico-news-popup-panel'),
    title: root.querySelector('[data-aico-news-popup-title]'),
    counter: root.querySelector('[data-aico-news-popup-counter]'),
    media: root.querySelector('[data-aico-news-popup-media]'),
    image: root.querySelector('[data-aico-news-popup-image]'),
    body: root.querySelector('[data-aico-news-popup-body]'),
    more: root.querySelector('[data-aico-news-popup-more]'),
    read: root.querySelector('[data-aico-news-popup-read]')
  };

  var articles = [];
  var index = 0;
  var pendingIds = [];
  var isOpen = false;
  var lastFocused = null;

  function t(key, fallback) {
    return (typeof i18n[key] === 'string' && i18n[key] !== '') ? i18n[key] : fallback;
  }

  function withQuery(url, params) {
    var separator = url.indexOf('?') === -1 ? '?' : '&';
    var pairs = [];
    Object.keys(params).forEach(function (key) {
      if (params[key] === null || params[key] === undefined || params[key] === '') {
        return;
      }
      pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]));
    });
    return pairs.length ? url + separator + pairs.join('&') : url;
  }

  // ---- Rendering --------------------------------------------------------

  function renderCurrent() {
    var article = articles[index];
    if (!article) {
      close();
      return;
    }

    refs.title.textContent = article.title || '';

    if (articles.length > 1) {
      refs.counter.textContent = t('counter', '{{ current }} / {{ total }}')
        .replace('{{ current }}', String(index + 1))
        .replace('{{ total }}', String(articles.length));
      refs.counter.hidden = false;
    } else {
      refs.counter.hidden = true;
    }

    if (article.image) {
      refs.image.src = article.image;
      refs.image.alt = article.title || '';
      refs.media.hidden = false;
    } else {
      refs.image.removeAttribute('src');
      refs.media.hidden = true;
    }

    // `content_html` is rendered by our own backend from the article's
    // content builder (same renderer as the article page). Articles the
    // server renderer can't cover come back empty — then show the excerpt /
    // description and lean on the "read the full article" link.
    var html = article.content_html || '';
    if (!html) {
      html = '';
      if (article.excerpt) {
        html += '<p class="aico-news-popup-excerpt">' + escapeHtml(article.excerpt) + '</p>';
      }
      if (article.description) {
        html += article.description;
      }
    }
    refs.body.innerHTML = html;
    refs.body.scrollTop = 0;

    if (article.url) {
      refs.more.href = article.url;
      refs.more.hidden = false;
    } else {
      refs.more.hidden = true;
    }

    var isLast = index >= articles.length - 1;
    refs.read.textContent = isLast
      ? t('mark_as_read', 'Mark as read')
      : t('mark_as_read_next', 'Mark as read and continue');
    refs.read.removeAttribute('aria-busy');
  }

  function escapeHtml(value) {
    var node = document.createElement('div');
    node.textContent = value;
    return node.innerHTML;
  }

  // ---- Open / close -----------------------------------------------------

  function open() {
    if (isOpen) {
      return;
    }
    isOpen = true;
    lastFocused = document.activeElement;
    root.hidden = false;
    document.documentElement.classList.add('aico-no-scroll');
    document.body.classList.add('aico-no-scroll');
    document.addEventListener('keydown', onKeydown);
    if (refs.read && typeof refs.read.focus === 'function') {
      refs.read.focus();
    }
  }

  function close() {
    if (!isOpen) {
      return;
    }
    isOpen = false;
    root.hidden = true;
    document.documentElement.classList.remove('aico-no-scroll');
    document.body.classList.remove('aico-no-scroll');
    document.removeEventListener('keydown', onKeydown);
    if (lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus();
    }
    flushPending();
  }

  function onKeydown(event) {
    if (event.key === 'Escape' || event.key === 'Esc') {
      close();
    }
  }

  // ---- Read receipts ----------------------------------------------------

  // Fire-and-forget: the popup's job is done once the shopper has seen the
  // article, so a failed receipt must not block the UI (the article simply
  // shows again next visit).
  function flushPending() {
    if (!pendingIds.length) {
      return;
    }
    var ids = pendingIds.slice();
    pendingIds = [];

    var headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (window.__AICO_CSRF__) {
      headers['X-CSRF-TOKEN'] = window.__AICO_CSRF__;
    }

    fetch(config.readUrl, {
      method: 'POST',
      credentials: 'same-origin',
      headers: headers,
      body: JSON.stringify({ news_ids: ids })
    })['catch'](function () { /* receipt is best-effort */ });
  }

  function markCurrentRead() {
    var article = articles[index];
    if (!article) {
      close();
      return;
    }

    if (pendingIds.indexOf(article.id) === -1) {
      pendingIds.push(article.id);
    }

    if (index >= articles.length - 1) {
      close();
      return;
    }

    index += 1;
    renderCurrent();
  }

  // ---- Wiring -----------------------------------------------------------

  root.addEventListener('click', function (event) {
    var closer = event.target.closest('[data-aico-news-popup-close]');
    if (closer) {
      event.preventDefault();
      close();
    }
  });

  refs.read.addEventListener('click', function () {
    refs.read.setAttribute('aria-busy', 'true');
    markCurrentRead();
  });

  // Receipts queued but not yet sent when the shopper navigates away.
  window.addEventListener('pagehide', flushPending);

  // ---- Load -------------------------------------------------------------

  function load() {
    fetch(withQuery(config.featuredUrl, { locale: config.locale, size: 5 }), {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    })
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (payload) {
        var rows = (payload && payload.data) || [];
        articles = rows.filter(function (row) { return row && row.id; });
        if (!articles.length) {
          return;
        }
        index = 0;
        renderCurrent();
        open();
      })['catch'](function () { /* no popup is the correct failure mode */ });
  }

  // After paint — the unread query is the slowest thing on this page and the
  // brand grid must not wait for it.
  if (window.requestIdleCallback) {
    window.requestIdleCallback(load, { timeout: 2000 });
  } else {
    window.setTimeout(load, 300);
  }
})();
