// Featured-news popup — port of b2b-shop's `FeaturedNewsDialog`
// (src/pages/index/HomePage/FeaturedNewsDialog). Shows the shopper's unread
// `is_special_article` news one at a time and writes the read receipts back.
//
// Ported behaviour, 1:1 with the React dialog:
//   • fetch the unread featured articles (page size 5, newest first)
//   • "mark as read" queues the current article and advances to the next one;
//     on the last one it flushes the queue and closes
//   • closing (X / backdrop / Esc) flushes whatever was already marked — an
//     article the shopper never marked stays unread and returns next visit
//   • `?hideFeatured` in the URL suppresses the popup (b2b's router guard)
//
// Changed on purpose:
//   • the body arrives as HTML rendered by the server (NewsContentRenderer),
//     so there is no client-side content-builder walk
//   • the read-receipt control sits on its own footer row, never beside the
//     article's own call-to-action button (which lives inside the body)
//   • the snippet renders from layout/theme.liquid, i.e. on EVERY shop page
//     rather than only the home page. b2b-shop was a single-page app, so
//     "close" naturally held until the next full load; here every navigation
//     is a full load, so the dismissal has to be remembered explicitly —
//     see the sessionStorage state below. Without it the popup would reopen
//     on every click through the catalogue.
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

  // How long a "nothing unread" answer is trusted before asking again. The
  // unread query costs ~0.7s and now runs on every page, so re-asking on each
  // navigation is the one thing this feature must not do; 15 minutes still
  // surfaces an article published mid-visit soon enough.
  var EMPTY_TTL_MS = 15 * 60 * 1000;

  // Keyed per shopper: sessionStorage survives a logout/login in the same tab,
  // and one shopper's dismissal must not silence the next one's articles.
  var stateKey = 'aico-news-popup:' + (config.customerId == null ? 'anon' : config.customerId);

  function readState() {
    try {
      return JSON.parse(window.sessionStorage.getItem(stateKey) || '{}') || {};
    } catch (error) {
      return {};
    }
  }

  function writeState(patch) {
    var next = readState();
    Object.keys(patch).forEach(function (key) { next[key] = patch[key]; });
    try {
      window.sessionStorage.setItem(stateKey, JSON.stringify(next));
    } catch (error) { /* private mode / quota — the popup just repeats */ }
  }

  var refs = {
    panel: root.querySelector('.aico-news-popup-panel'),
    title: root.querySelector('[data-aico-news-popup-title]'),
    counter: root.querySelector('[data-aico-news-popup-counter]'),
    progress: root.querySelector('[data-aico-news-popup-progress]'),
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

  // Dots up to a handful of queued articles, a "3 / 12" counter beyond that.
  var MAX_DOTS = 6;

  function renderProgress() {
    if (articles.length < 2) {
      refs.progress.hidden = true;
      refs.counter.hidden = true;
      return;
    }

    if (articles.length <= MAX_DOTS) {
      refs.counter.hidden = true;
      refs.progress.innerHTML = '';
      for (var position = 0; position < articles.length; position += 1) {
        var dot = document.createElement('span');
        dot.className = 'aico-news-popup-dot';
        if (position === index) {
          dot.setAttribute('data-current', '');
        } else if (position < index) {
          dot.setAttribute('data-done', '');
        }
        refs.progress.appendChild(dot);
      }
      refs.progress.hidden = false;
      return;
    }

    refs.progress.hidden = true;
    refs.counter.textContent = t('counter', '{{ current }} / {{ total }}')
      .replace('{{ current }}', String(index + 1))
      .replace('{{ total }}', String(articles.length));
    refs.counter.hidden = false;
  }

  function renderCurrent() {
    var article = articles[index];
    if (!article) {
      close();
      return;
    }

    refs.title.textContent = article.title || '';
    renderProgress();

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
    // Whatever the shopper left unread stays unread server-side, but they
    // have answered this popup for now — don't re-open it on the next page.
    writeState({ dismissed: true });
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
          writeState({ emptyUntil: Date.now() + EMPTY_TTL_MS });
          return;
        }
        index = 0;
        renderCurrent();
        open();
      })['catch'](function () { /* no popup is the correct failure mode */ });
  }

  var state = readState();
  if (state.dismissed || (typeof state.emptyUntil === 'number' && Date.now() < state.emptyUntil)) {
    return;
  }

  // After paint — the unread query is the slowest thing on the page and the
  // content must not wait for it.
  if (window.requestIdleCallback) {
    window.requestIdleCallback(load, { timeout: 2000 });
  } else {
    window.setTimeout(load, 300);
  }
})();
