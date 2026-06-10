// Aico storefront — customer order-history page client controller.
//
// Hydrates templates/customers/orders.liquid: fetches the paginated
// order + preorder feed (cookie-authenticated, same-origin) and renders
// accordion order cards with an inline line-item table, shipping/tracking
// panel, and a per-order documents menu. Filters (type / period / search)
// and infinite scroll re-issue the feed request.
//
// Mirrors the b2b-shop /orders/history UX but reads its data from the
// OrderHistoryOrderDTO the storefront feed returns 1:1, so card content
// matches the legacy shop. There is no separate detail page — cards
// expand in place.

(function () {
  'use strict';

  var rootEl = document.querySelector('[data-aico-orders]');
  if (!rootEl) {
    return;
  }

  var i18n = {};
  var i18nEl = rootEl.querySelector('[data-aico-orders-i18n]');
  if (i18nEl) {
    try {
      i18n = JSON.parse(i18nEl.textContent) || {};
    } catch (e) {
      console.warn('aico-orders: invalid i18n bootstrap', e);
    }
  }

  var FEED_URL = rootEl.getAttribute('data-aico-orders-feed-url') || '';
  var DOC_URL_TEMPLATE = rootEl.getAttribute('data-aico-order-document-url-template') || '';
  var PAGE_SIZE = parseInt(rootEl.getAttribute('data-aico-page-size'), 10) || 10;
  var LOCALE = (i18n.locale === 'de_CH' || i18n.locale === 'de-CH') ? 'de-CH' : 'en-GB';
  var SEARCH_MIN_CHARS = 3;
  var SEARCH_DEBOUNCE_MS = 400;

  // ---- DOM refs ---------------------------------------------------

  var listEl = rootEl.querySelector('[data-aico-orders-list]');
  var emptyEl = rootEl.querySelector('[data-aico-orders-empty]');
  var errorEl = rootEl.querySelector('[data-aico-orders-error]');
  var loaderEl = rootEl.querySelector('[data-aico-orders-loader]');
  var endEl = rootEl.querySelector('[data-aico-orders-end]');
  var sentinelEl = rootEl.querySelector('[data-aico-orders-sentinel]');
  var resetBtn = rootEl.querySelector('[data-aico-orders-reset]');
  var customRangeEl = rootEl.querySelector('[data-aico-custom-range]');

  var typeSelect = rootEl.querySelector('[data-aico-filter="type"]');
  var periodSelect = rootEl.querySelector('[data-aico-filter="period"]');
  var fromInput = rootEl.querySelector('[data-aico-filter="from"]');
  var toInput = rootEl.querySelector('[data-aico-filter="to"]');
  var searchInput = rootEl.querySelector('[data-aico-filter="search"]');

  // ---- State ------------------------------------------------------

  var state = {
    page: 0, // 0-indexed, matches the service
    lastPage: null,
    loading: false,
    done: false,
    requestId: 0, // guards against out-of-order responses on filter change
  };

  // ---- Helpers ----------------------------------------------------

  function t(path, fallback) {
    var segments = path.split('.');
    var cursor = i18n;
    for (var i = 0; i < segments.length; i++) {
      if (cursor && typeof cursor === 'object' && segments[i] in cursor) {
        cursor = cursor[segments[i]];
      } else {
        return fallback != null ? fallback : path;
      }
    }
    return typeof cursor === 'string' ? cursor : (fallback != null ? fallback : path);
  }

  // Money formatting that matches the PHP `money` filter: 2 decimals,
  // apostrophe thousands separator (Swiss style).
  function formatMoney(amount, currency) {
    var value = Number(amount);
    if (!isFinite(value)) {
      value = 0;
    }
    var parts = value.toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, "'");
    var formatted = parts.join('.');
    return currency ? formatted + ' ' + String(currency).toUpperCase() : formatted;
  }

  function formatDate(raw) {
    if (!raw) {
      return '';
    }
    // DTO format: 'Y-m-d H:i:s' — make it ISO so Date parses reliably.
    var iso = String(raw).replace(' ', 'T');
    var date = new Date(iso);
    if (isNaN(date.getTime())) {
      return String(raw);
    }
    try {
      return date.toLocaleDateString(LOCALE, { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (e) {
      return date.toISOString().slice(0, 10);
    }
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text != null) {
      node.textContent = text;
    }
    return node;
  }

  // Inline SVG icons (Lucide-style strokes) — returned as a span so they
  // sit inline with text. innerHTML is safe here: the markup is static.
  var ICONS = {
    chevron: '<path d="m9 18 6-6-6-6"></path>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>',
    check: '<path d="M20 6 9 17l-5-5"></path>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" x2="12" y1="15" y2="3"></line>'
  };

  function icon(name, className) {
    var span = el('span', 'aico-icon' + (className ? ' ' + className : ''));
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>';
    return span;
  }

  // Build an animated collapsible: an outer grid that transitions
  // grid-template-rows 0fr -> 1fr (smooth height animation with no JS
  // measuring), plus an overflow-hidden inner that holds the content.
  function collapsible(innerClassName) {
    var outer = el('div', 'aico-collapsible');
    var inner = el('div', 'aico-collapsible-inner' + (innerClassName ? ' ' + innerClassName : ''));
    outer.appendChild(inner);
    return { outer: outer, inner: inner };
  }

  function setCollapsed(outer, open) {
    outer.classList.toggle('aico-collapsible-open', open);
  }

  function countItems(order) {
    var total = 0;
    var products = order.products || [];
    for (var i = 0; i < products.length; i++) {
      var items = products[i].items || [];
      for (var j = 0; j < items.length; j++) {
        total += Number(items[j].quantity) || 0;
      }
    }
    return total;
  }

  function itemCountLabel(count) {
    var template = count === 1
      ? t('card.item_count_one', '{count} item')
      : t('card.item_count_other', '{count} items');
    return template.replace('{count}', count);
  }

  // ---- Status derivation -----------------------------------------
  // DTO status is 'cancelled' | 'shipped' | 'confirmed'. Refine using the
  // tracking text (canonical English) for the finer b2b-shop states.

  function firstTrackingText(order) {
    var tracking = order.trackingNumbers || [];
    if (!tracking.length) {
      return '';
    }
    var tn = tracking[0].trackingNumber || {};
    return (tn.en || tn.de_CH || '').trim();
  }

  function deriveStatusKey(order) {
    if (order.status === 'cancelled') {
      return 'cancelled';
    }
    var text = firstTrackingText(order).toLowerCase();
    if (text === 'in progress' || text === 'in bearbeitung') {
      return 'in_progress';
    }
    if (text === 'self pickup' || text === 'selbstabholung') {
      return 'self_pickup';
    }
    if (text === 'delivered' || text === 'zugestellt' || text === 'geliefert') {
      return 'delivered';
    }
    if (order.status === 'shipped') {
      return 'shipped';
    }
    return 'confirmed';
  }

  function statusLabel(key) {
    return t('status.' + key, key);
  }

  // ---- Filters ----------------------------------------------------

  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function isoDay(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  // Resolve the active period preset to {from, to} ISO dates (or null).
  function resolvePeriod() {
    var preset = periodSelect ? periodSelect.value : 'all';
    if (preset === 'all') {
      return { from: null, to: null };
    }
    if (preset === 'custom') {
      return {
        from: (fromInput && fromInput.value) ? fromInput.value : null,
        to: (toInput && toInput.value) ? toInput.value : null,
      };
    }
    var now = new Date();
    var to = isoDay(now);
    if (preset === 'last30') {
      var start = new Date(now.getTime());
      start.setDate(start.getDate() - 30);
      return { from: isoDay(start), to: to };
    }
    if (preset === 'ytd') {
      return { from: now.getFullYear() + '-01-01', to: to };
    }
    return { from: null, to: null };
  }

  function buildFeedUrl() {
    var params = [];
    params.push('page[number]=' + state.page);
    params.push('page[size]=' + PAGE_SIZE);

    var type = typeSelect ? typeSelect.value : 'all';
    if (type && type !== 'all') {
      params.push('filter[type]=' + encodeURIComponent(type));
    }

    var period = resolvePeriod();
    if (period.from) {
      params.push('filter[created_at][from]=' + encodeURIComponent(period.from));
    }
    if (period.to) {
      params.push('filter[created_at][to]=' + encodeURIComponent(period.to));
    }

    var search = searchInput ? searchInput.value.trim() : '';
    if (search.length >= SEARCH_MIN_CHARS) {
      params.push('filter[search]=' + encodeURIComponent(search));
    }

    var separator = FEED_URL.indexOf('?') === -1 ? '?' : '&';
    return FEED_URL + separator + params.join('&');
  }

  function hasActiveFilters() {
    if (typeSelect && typeSelect.value !== 'all') {
      return true;
    }
    if (periodSelect && periodSelect.value !== 'all') {
      return true;
    }
    if (searchInput && searchInput.value.trim().length >= SEARCH_MIN_CHARS) {
      return true;
    }
    return false;
  }

  // ---- Rendering --------------------------------------------------

  function documentUrlFor(doc) {
    if (doc.id != null && DOC_URL_TEMPLATE) {
      return DOC_URL_TEMPLATE.replace('__ID__', encodeURIComponent(doc.id));
    }
    // Preorder-group PDFs carry an absolute downloadUrl and no id.
    return doc.downloadUrl || null;
  }

  function collectDocuments(order) {
    var buckets = order.orderDocuments || {};
    var order_keys = ['invoices', 'proformaInvoices', 'exportInvoices', 'preorderDocuments', 'orderConfirmations'];
    var collected = [];
    for (var k = 0; k < order_keys.length; k++) {
      var key = order_keys[k];
      var rows = buckets[key] || [];
      for (var i = 0; i < rows.length; i++) {
        var url = documentUrlFor(rows[i]);
        if (!url) {
          continue;
        }
        collected.push({
          url: url,
          label: t('documents.type_' + key, key),
          number: rows[i].documentNumber || '',
        });
      }
    }
    return collected;
  }

  function buildStatusBadge(order) {
    var key = deriveStatusKey(order);
    var badge = el('span', 'aico-order-status aico-order-status-' + key);
    badge.appendChild(el('span', 'aico-order-status-dot'));
    badge.appendChild(el('span', 'aico-order-status-text', statusLabel(key)));
    return badge;
  }

  function buildSummary(order) {
    var summary = el('div', 'aico-order-summary');

    // Chevron indicator (rotates when the card opens) — left of the row.
    summary.appendChild(icon('chevron', 'aico-order-chevron'));

    var main = el('div', 'aico-order-summary-main');
    main.appendChild(el('span', 'aico-order-date', formatDate(order.createdAt)));

    var numberRow = el('span', 'aico-order-number-row');
    var typeKey = order.type === 'preorder' ? 'preorder' : 'order';
    numberRow.appendChild(el('span', 'aico-order-type-chip aico-order-type-' + typeKey, t('type.' + typeKey, typeKey)));
    numberRow.appendChild(el('span', 'aico-order-number', order.orderNumber || '—'));
    if (order.orderNumber) {
      var copyBtn = el('button', 'aico-order-copy');
      copyBtn.type = 'button';
      copyBtn.title = t('card.copy_order_number', 'Copy order number');
      copyBtn.setAttribute('aria-label', t('card.copy_order_number', 'Copy order number'));
      copyBtn.appendChild(icon('copy'));
      copyBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        copyText(order.orderNumber, copyBtn);
      });
      numberRow.appendChild(copyBtn);
    }
    main.appendChild(numberRow);
    summary.appendChild(main);

    // Fixed-width meta columns so item count / total / status line up
    // across every card regardless of price width.
    summary.appendChild(el('span', 'aico-order-itemcount', itemCountLabel(countItems(order))));
    summary.appendChild(el('span', 'aico-order-total', formatMoney(order.totalPrice, order.currency)));
    summary.appendChild(buildStatusBadge(order));
    summary.appendChild(buildDocumentsControl(order));

    return summary;
  }

  function productTotals(product) {
    var items = product.items || [];
    var qty = 0;
    var sum = 0;
    for (var i = 0; i < items.length; i++) {
      var q = Number(items[i].quantity) || 0;
      qty += q;
      sum += (Number(items[i].price) || 0) * q;
    }
    return { qty: qty, sum: sum };
  }

  // Products list — each product is a collapsible group; its variant
  // (size) rows are hidden until the product header is expanded.
  function buildProductsTable(order) {
    var wrap = el('div', 'aico-order-products');

    var header = el('div', 'aico-order-products-head');
    header.appendChild(el('span', null, t('card.product', 'Product')));
    header.appendChild(el('span', 'aico-order-cell-num', t('card.quantity', 'Qty')));
    header.appendChild(el('span', 'aico-order-cell-num', t('card.subtotal', 'Subtotal')));
    wrap.appendChild(header);

    var products = order.products || [];
    for (var i = 0; i < products.length; i++) {
      wrap.appendChild(buildProductGroup(products[i], order.currency));
    }
    return wrap;
  }

  function buildProductGroup(product, currency) {
    var totals = productTotals(product);
    var group = el('div', 'aico-order-product');

    var head = el('button', 'aico-order-product-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', 'false');
    head.appendChild(icon('chevron', 'aico-order-product-chevron'));
    var name = el('span', 'aico-order-product-name');
    name.appendChild(document.createTextNode(product.name || product.sku || ''));
    if (product.sku) {
      name.appendChild(el('span', 'aico-order-product-sku', product.sku));
    }
    head.appendChild(name);
    head.appendChild(el('span', 'aico-order-cell-num', String(totals.qty)));
    head.appendChild(el('span', 'aico-order-cell-num', formatMoney(totals.sum, currency)));

    var box = collapsible('aico-order-variants');
    var items = product.items || [];
    for (var j = 0; j < items.length; j++) {
      var item = items[j];
      var row = el('div', 'aico-order-variant');
      row.appendChild(el('span', 'aico-order-variant-size', item.size || item.sku || '—'));
      row.appendChild(el('span', 'aico-order-variant-sku', item.sku || ''));
      row.appendChild(el('span', 'aico-order-cell-num', String(item.quantity != null ? item.quantity : '')));
      row.appendChild(el('span', 'aico-order-cell-num', formatMoney(item.price, currency)));
      var subtotal = (Number(item.price) || 0) * (Number(item.quantity) || 0);
      row.appendChild(el('span', 'aico-order-cell-num', formatMoney(subtotal, currency)));
      box.inner.appendChild(row);
    }

    head.addEventListener('click', function () {
      var open = head.getAttribute('aria-expanded') !== 'true';
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
      group.classList.toggle('aico-order-product-open', open);
      setCollapsed(box.outer, open);
    });

    group.appendChild(head);
    group.appendChild(box.outer);
    return group;
  }

  function buildTrackingPanel(order) {
    var panel = el('aside', 'aico-order-tracking');
    panel.appendChild(el('h4', 'aico-order-tracking-title', t('shipping.title', 'Shipping & tracking')));

    var tracking = order.trackingNumbers || [];
    var hasReal = false;
    var listNode = el('ul', 'aico-order-tracking-list');
    for (var i = 0; i < tracking.length; i++) {
      var tn = tracking[i].trackingNumber || {};
      var label = (i18n.locale === 'de_CH' ? tn.de_CH : tn.en) || tn.en || tn.de_CH || '';
      var url = tracking[i].trackingUrl;
      var li = el('li', 'aico-order-tracking-item');
      if (url) {
        hasReal = true;
        var link = el('a', 'aico-order-tracking-link', label || t('shipping.track', 'Track'));
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        li.appendChild(link);
      } else {
        li.appendChild(el('span', null, label));
      }
      listNode.appendChild(li);
    }
    // The default "In Progress" entry counts as no real tracking.
    if (tracking.length && firstTrackingText(order).toLowerCase() !== 'in progress') {
      hasReal = true;
    }
    if (hasReal) {
      panel.appendChild(listNode);
    } else {
      panel.appendChild(el('p', 'aico-order-tracking-none', t('shipping.none', 'No tracking yet.')));
    }

    return panel;
  }

  function triggerDownload(url) {
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  }

  // Summary-cell documents control. With no documents it renders a muted
  // placeholder (keeps the grid column aligned). With one document the
  // button downloads it directly; with several it opens an animated
  // dropdown listing each PDF plus a "download all".
  function buildDocumentsControl(order) {
    var docs = collectDocuments(order);
    var cell = el('div', 'aico-order-docaction');

    if (!docs.length) {
      cell.appendChild(el('span', 'aico-order-docaction-empty', '—'));
      return cell;
    }

    var button = el('button', 'aico-order-docbtn');
    button.type = 'button';
    button.appendChild(icon('download'));
    button.appendChild(el('span', null, t('documents.menu', 'Documents')));

    if (docs.length === 1) {
      button.addEventListener('click', function (event) {
        event.stopPropagation();
        triggerDownload(docs[0].url);
      });
      cell.appendChild(button);
      return cell;
    }

    button.appendChild(icon('chevron', 'aico-order-docbtn-chevron'));
    button.setAttribute('aria-haspopup', 'true');
    button.setAttribute('aria-expanded', 'false');

    var box = collapsible('aico-order-docmenu');
    for (var i = 0; i < docs.length; i++) {
      var link = el('a', 'aico-order-docmenu-link', docs[i].number ? (docs[i].label + ' · ' + docs[i].number) : docs[i].label);
      link.href = docs[i].url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.addEventListener('click', function (event) { event.stopPropagation(); });
      box.inner.appendChild(link);
    }
    var allBtn = el('button', 'aico-order-docmenu-all');
    allBtn.type = 'button';
    allBtn.textContent = t('documents.download_all', 'Download all');
    allBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      downloadAll(docs);
    });
    box.inner.appendChild(allBtn);

    function closeMenu() {
      button.setAttribute('aria-expanded', 'false');
      setCollapsed(box.outer, false);
      document.removeEventListener('click', onDocOutside, true);
    }
    function onDocOutside(event) {
      if (!cell.contains(event.target)) {
        closeMenu();
      }
    }
    button.addEventListener('click', function (event) {
      event.stopPropagation();
      var open = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
      setCollapsed(box.outer, open);
      if (open) {
        document.addEventListener('click', onDocOutside, true);
      } else {
        document.removeEventListener('click', onDocOutside, true);
      }
    });

    cell.appendChild(button);
    cell.appendChild(box.outer);
    return cell;
  }

  function buildDetail(order) {
    var box = collapsible('aico-order-detail');
    var grid = el('div', 'aico-order-detail-grid');
    grid.appendChild(buildProductsTable(order));
    grid.appendChild(buildTrackingPanel(order));
    box.inner.appendChild(grid);
    return box;
  }

  function buildCard(order) {
    var li = el('li', 'aico-order-card');
    li.setAttribute('data-aico-order-id', order.id);
    li.setAttribute('data-aico-order-type', order.type);

    var summary = buildSummary(order);
    summary.setAttribute('role', 'button');
    summary.setAttribute('tabindex', '0');
    summary.setAttribute('aria-expanded', 'false');

    var detail = buildDetail(order);

    function toggle() {
      var open = summary.getAttribute('aria-expanded') !== 'true';
      summary.setAttribute('aria-expanded', open ? 'true' : 'false');
      li.classList.toggle('aico-order-card-open', open);
      setCollapsed(detail.outer, open);
    }

    summary.addEventListener('click', function (event) {
      // Ignore clicks that originate on an interactive child (copy,
      // documents button/menu, links).
      if (event.target.closest('button, a')) {
        return;
      }
      toggle();
    });
    summary.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        if (event.target.closest('button, a')) {
          return;
        }
        event.preventDefault();
        toggle();
      }
    });

    li.appendChild(summary);
    li.appendChild(detail.outer);
    return li;
  }

  // ---- Clipboard + downloads -------------------------------------

  function copyText(text, button) {
    function flash() {
      button.replaceChildren(icon('check'));
      button.classList.add('aico-order-copied');
      setTimeout(function () {
        button.replaceChildren(icon('copy'));
        button.classList.remove('aico-order-copied');
      }, 1200);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(flash).catch(function () {});
    }
  }

  function downloadAll(docs) {
    // Trigger sequential downloads with a small gap so the browser
    // doesn't drop concurrent navigations.
    var index = 0;
    function next() {
      if (index >= docs.length) {
        return;
      }
      var anchor = document.createElement('a');
      anchor.href = docs[index].url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      index++;
      setTimeout(next, 250);
    }
    next();
  }

  // ---- Feed loading ----------------------------------------------

  function setLoading(loading) {
    state.loading = loading;
    if (loaderEl) {
      loaderEl.hidden = !loading;
    }
  }

  function showError() {
    if (errorEl) {
      errorEl.hidden = false;
    }
  }

  function updateChrome(totalRendered) {
    if (resetBtn) {
      resetBtn.hidden = !hasActiveFilters();
    }
    if (emptyEl) {
      if (totalRendered === 0) {
        emptyEl.textContent = hasActiveFilters()
          ? t('empty_filtered', emptyEl.textContent)
          : emptyEl.textContent;
        emptyEl.hidden = false;
      } else {
        emptyEl.hidden = true;
      }
    }
    if (endEl) {
      endEl.hidden = !(state.done && totalRendered > 0);
    }
  }

  function loadNextPage() {
    if (state.loading || state.done || !FEED_URL) {
      return;
    }
    setLoading(true);
    if (errorEl) {
      errorEl.hidden = true;
    }

    var requestId = state.requestId;

    fetch(buildFeedUrl(), {
      method: 'GET',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('feed status ' + response.status);
        }
        return response.json();
      })
      .then(function (payload) {
        if (requestId !== state.requestId) {
          return; // a filter change superseded this request
        }
        var rows = (payload && payload.data) || [];
        var meta = (payload && payload.meta) || {};

        for (var i = 0; i < rows.length; i++) {
          listEl.appendChild(buildCard(rows[i]));
        }

        state.lastPage = (typeof meta.lastPage === 'number') ? meta.lastPage : state.page;
        // currentPage is 1-indexed in the meta; our state.page is 0-indexed.
        if (state.page + 1 >= state.lastPage || rows.length === 0) {
          state.done = true;
        } else {
          state.page += 1;
        }

        setLoading(false);
        updateChrome(listEl.children.length);
        // Keep filling until the sentinel is pushed off-screen. An
        // IntersectionObserver alone won't re-fire while the sentinel
        // stays continuously in view, so drive loading from here too.
        maybeLoadMore();
      })
      .catch(function (err) {
        if (requestId !== state.requestId) {
          return;
        }
        console.warn('aico-orders: feed load failed', err);
        setLoading(false);
        state.done = true;
        showError();
      });
  }

  // True when the sentinel is within the prefetch margin of the viewport.
  function sentinelInView() {
    if (!sentinelEl) {
      return false;
    }
    var viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    return sentinelEl.getBoundingClientRect().top <= viewportHeight + 400;
  }

  function maybeLoadMore() {
    if (sentinelInView()) {
      loadNextPage();
    }
  }

  function resetAndReload() {
    state.requestId += 1;
    state.page = 0;
    state.lastPage = null;
    state.done = false;
    state.loading = false;
    if (listEl) {
      listEl.innerHTML = '';
    }
    if (endEl) {
      endEl.hidden = true;
    }
    if (emptyEl) {
      emptyEl.hidden = true;
    }
    loadNextPage();
  }

  // ---- Wiring -----------------------------------------------------

  function onPeriodChange() {
    if (customRangeEl) {
      customRangeEl.hidden = !(periodSelect && periodSelect.value === 'custom');
    }
    resetAndReload();
  }

  if (typeSelect) {
    typeSelect.addEventListener('change', resetAndReload);
  }
  if (periodSelect) {
    periodSelect.addEventListener('change', onPeriodChange);
  }
  if (fromInput) {
    fromInput.addEventListener('change', resetAndReload);
  }
  if (toInput) {
    toInput.addEventListener('change', resetAndReload);
  }

  if (searchInput) {
    var searchTimer = null;
    var lastSearch = '';
    searchInput.addEventListener('input', function () {
      var value = searchInput.value.trim();
      // Only react when crossing the min-chars threshold or clearing.
      if (value.length > 0 && value.length < SEARCH_MIN_CHARS && lastSearch === '') {
        return;
      }
      if (searchTimer) {
        clearTimeout(searchTimer);
      }
      searchTimer = setTimeout(function () {
        lastSearch = value.length >= SEARCH_MIN_CHARS ? value : '';
        resetAndReload();
      }, SEARCH_DEBOUNCE_MS);
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      if (typeSelect) { typeSelect.value = 'all'; }
      if (periodSelect) { periodSelect.value = 'all'; }
      if (fromInput) { fromInput.value = ''; }
      if (toInput) { toInput.value = ''; }
      if (searchInput) { searchInput.value = ''; }
      if (customRangeEl) { customRangeEl.hidden = true; }
      resetAndReload();
    });
  }

  // Infinite scroll. The IntersectionObserver catches the sentinel
  // entering view; the scroll/resize listeners (and the post-load
  // maybeLoadMore) cover the cases the observer misses — chiefly when the
  // sentinel stays continuously intersecting after a page is appended, so
  // no new intersection event fires. loadNextPage guards re-entry.
  if (sentinelEl && 'IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          loadNextPage();
        }
      }
    }, { rootMargin: '400px 0px' });
    observer.observe(sentinelEl);
  }
  window.addEventListener('scroll', maybeLoadMore, { passive: true });
  window.addEventListener('resize', maybeLoadMore, { passive: true });

  // Initial load
  loadNextPage();
})();
