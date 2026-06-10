// Aico storefront — customer order-history page client controller.
//
// Recreates the b2b-shop /orders/history UX against the storefront cookie
// session: a full-width search with Type / Period / Created-by dropdowns,
// accordion order cards (date+time, copyable order number, product count,
// total, status badge, documents control), and an inline expanded view with
// a products table whose rows expand to size/variant sub-tables plus a
// shipping & tracking panel. Data comes from the OrderHistoryOrderDTO feed
// 1:1, so card content matches the legacy shop.

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
  var USER_COUNTS_URL = rootEl.getAttribute('data-aico-order-user-counts-url') || '';
  var DOC_URL_TEMPLATE = rootEl.getAttribute('data-aico-order-document-url-template') || '';
  var PAGE_SIZE = parseInt(rootEl.getAttribute('data-aico-page-size'), 10) || 10;
  var IS_DE = i18n.locale === 'de_CH' || i18n.locale === 'de-CH';
  var LOCALE = IS_DE ? 'de-CH' : 'en-GB';
  var SEARCH_MIN_CHARS = 3;
  var SEARCH_DEBOUNCE_MS = 400;

  // ---- DOM refs ---------------------------------------------------

  var listEl = rootEl.querySelector('[data-aico-orders-list]');
  var emptyEl = rootEl.querySelector('[data-aico-orders-empty]');
  var errorEl = rootEl.querySelector('[data-aico-orders-error]');
  var loaderEl = rootEl.querySelector('[data-aico-orders-loader]');
  var endEl = rootEl.querySelector('[data-aico-orders-end]');
  var sentinelEl = rootEl.querySelector('[data-aico-orders-sentinel]');
  var searchInput = rootEl.querySelector('[data-aico-filter="search"]');
  var filtersEl = rootEl.querySelector('[data-aico-orders-filters]');

  // ---- State ------------------------------------------------------

  var state = {
    page: 0,
    lastPage: null,
    loading: false,
    done: false,
    requestId: 0,
    filters: { type: 'all', period: 'all', from: null, to: null, search: '', createdBy: [] },
    userCounts: [],
  };

  // ---- i18n + formatting helpers ----------------------------------

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

  // Swiss-style money: 2 decimals, apostrophe thousands separator.
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

  function parseDate(raw) {
    if (!raw) {
      return null;
    }
    var d = new Date(String(raw).replace(' ', 'T'));
    return isNaN(d.getTime()) ? null : d;
  }

  function formatDate(raw) {
    var d = parseDate(raw);
    if (!d) {
      return raw ? String(raw) : '';
    }
    try {
      return d.toLocaleDateString(LOCALE, { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (e) {
      return d.toISOString().slice(0, 10);
    }
  }

  function formatTime(raw) {
    var d = parseDate(raw);
    if (!d) {
      return '';
    }
    try {
      return d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
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

  var ICONS = {
    chevronDown: '<path d="m6 9 6 6 6-6"></path>',
    chevronRight: '<path d="m9 18 6-6-6-6"></path>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>',
    check: '<path d="M20 6 9 17l-5-5"></path>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" x2="12" y1="15" y2="3"></line>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect>',
    search: '<circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path>',
    reset: '<path d="M3 2v6h6"></path><path d="M3 8a9 9 0 1 0 2.5-5"></path>'
  };

  function icon(name, className) {
    var span = el('span', 'aico-icon' + (className ? ' ' + className : ''));
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>';
    return span;
  }

  function collapsible(innerClassName) {
    var outer = el('div', 'aico-collapsible');
    var inner = el('div', 'aico-collapsible-inner' + (innerClassName ? ' ' + innerClassName : ''));
    outer.appendChild(inner);
    return { outer: outer, inner: inner };
  }

  function setCollapsed(outer, open) {
    outer.classList.toggle('aico-collapsible-open', open);
  }

  function copyText(text, button, iconName) {
    function flash() {
      button.replaceChildren(icon('check'));
      button.classList.add('aico-order-copied');
      setTimeout(function () {
        button.replaceChildren(icon(iconName || 'copy'));
        button.classList.remove('aico-order-copied');
      }, 1200);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(flash).catch(function () {});
    }
  }

  function copyButton(text, label, iconName) {
    var btn = el('button', 'aico-order-copy');
    btn.type = 'button';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.appendChild(icon(iconName || 'copy'));
    btn.addEventListener('click', function (event) {
      event.stopPropagation();
      copyText(text, btn, iconName);
    });
    return btn;
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

  // ---- Status -----------------------------------------------------

  function firstTrackingText(order) {
    var tracking = order.trackingNumbers || [];
    if (!tracking.length) {
      return '';
    }
    var tn = tracking[0].trackingNumber || {};
    return ((IS_DE ? tn.de_CH : tn.en) || tn.en || tn.de_CH || '').trim();
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

  function buildStatusBadge(order) {
    var key = deriveStatusKey(order);
    var badge = el('span', 'aico-order-status aico-order-status-' + key);
    badge.appendChild(el('span', 'aico-order-status-text', t('status.' + key, key)));
    badge.appendChild(el('span', 'aico-order-status-dot'));
    return badge;
  }

  // ---- Product helpers --------------------------------------------

  function countProducts(order) {
    return (order.products || []).length;
  }

  function productTotals(product) {
    var items = product.items || [];
    var qty = 0;
    var sum = 0;
    var unit = null;
    for (var i = 0; i < items.length; i++) {
      var q = Number(items[i].quantity) || 0;
      var p = Number(items[i].price) || 0;
      qty += q;
      sum += p * q;
      if (unit === null) {
        unit = p;
      }
    }
    return { qty: qty, sum: sum, unit: unit == null ? 0 : unit };
  }

  // ---- Filters ----------------------------------------------------

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isoDay(date) { return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()); }

  function resolvePeriodRange() {
    var f = state.filters;
    if (f.period === 'all') {
      return { from: null, to: null };
    }
    if (f.period === 'custom') {
      return { from: f.from || null, to: f.to || null };
    }
    var now = new Date();
    var to = isoDay(now);
    if (f.period === 'last30') {
      var start = new Date(now.getTime());
      start.setDate(start.getDate() - 30);
      return { from: isoDay(start), to: to };
    }
    if (f.period === 'ytd') {
      return { from: now.getFullYear() + '-01-01', to: to };
    }
    return { from: null, to: null };
  }

  function buildFeedUrl() {
    var f = state.filters;
    var params = [];
    params.push('page[number]=' + state.page);
    params.push('page[size]=' + PAGE_SIZE);

    if (f.type && f.type !== 'all') {
      params.push('filter[type]=' + encodeURIComponent(f.type));
    }
    var range = resolvePeriodRange();
    if (range.from) {
      params.push('filter[created_at][from]=' + encodeURIComponent(range.from));
    }
    if (range.to) {
      params.push('filter[created_at][to]=' + encodeURIComponent(range.to));
    }
    if (f.search && f.search.length >= SEARCH_MIN_CHARS) {
      params.push('filter[search]=' + encodeURIComponent(f.search));
    }
    for (var i = 0; i < f.createdBy.length; i++) {
      params.push('filter[created_by][]=' + encodeURIComponent(f.createdBy[i]));
    }

    var separator = FEED_URL.indexOf('?') === -1 ? '?' : '&';
    return FEED_URL + separator + params.join('&');
  }

  function hasActiveFilters() {
    var f = state.filters;
    return f.type !== 'all'
      || f.period !== 'all'
      || f.createdBy.length > 0
      || (f.search && f.search.length >= SEARCH_MIN_CHARS);
  }

  // ---- Toolbar dropdowns ------------------------------------------

  var openDropdown = null;

  function closeOpenDropdown() {
    if (openDropdown) {
      openDropdown.close();
      openDropdown = null;
    }
  }

  document.addEventListener('click', function (event) {
    if (openDropdown && !openDropdown.root.contains(event.target)) {
      closeOpenDropdown();
    }
  }, true);
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      closeOpenDropdown();
    }
  });

  // A labelled dropdown button with an absolutely-positioned animated panel.
  function createDropdown(initialLabel) {
    var root = el('div', 'aico-orders-dropdown');
    var button = el('button', 'aico-orders-dropdown-btn');
    button.type = 'button';
    button.setAttribute('aria-haspopup', 'true');
    button.setAttribute('aria-expanded', 'false');
    var labelEl = el('span', 'aico-orders-dropdown-label', initialLabel);
    button.appendChild(labelEl);
    button.appendChild(icon('chevronDown', 'aico-orders-dropdown-chevron'));

    var box = collapsible('aico-orders-panel');

    function close() {
      button.setAttribute('aria-expanded', 'false');
      setCollapsed(box.outer, false);
    }
    function open() {
      closeOpenDropdown();
      button.setAttribute('aria-expanded', 'true');
      setCollapsed(box.outer, true);
      openDropdown = api;
    }
    button.addEventListener('click', function (event) {
      event.stopPropagation();
      if (button.getAttribute('aria-expanded') === 'true') {
        close();
        openDropdown = null;
      } else {
        open();
      }
    });

    root.appendChild(button);
    root.appendChild(box.outer);

    var api = {
      root: root,
      panel: box.inner,
      close: close,
      setLabel: function (text) { labelEl.textContent = text; },
      setActive: function (active) { root.classList.toggle('aico-orders-dropdown-active', !!active); }
    };
    return api;
  }

  function typeLabel(value) {
    return t('type.' + value, t('type.all', 'All orders'));
  }

  function buildTypeDropdown() {
    var dd = createDropdown(typeLabel('all'));
    var options = [
      { value: 'all', label: typeLabel('all') },
      { value: 'order', label: typeLabel('order') },
      { value: 'preorder', label: typeLabel('preorder') }
    ];
    options.forEach(function (opt) {
      var row = el('button', 'aico-orders-option');
      row.type = 'button';
      row.textContent = opt.label;
      if (state.filters.type === opt.value) {
        row.classList.add('aico-orders-option-selected');
      }
      row.addEventListener('click', function () {
        state.filters.type = opt.value;
        dd.setLabel(opt.label);
        dd.setActive(opt.value !== 'all');
        Array.prototype.forEach.call(dd.panel.children, function (c) { c.classList.remove('aico-orders-option-selected'); });
        row.classList.add('aico-orders-option-selected');
        closeOpenDropdown();
        resetAndReload();
      });
      dd.panel.appendChild(row);
    });
    return dd;
  }

  function periodButtonLabel() {
    var f = state.filters;
    if (f.period === 'all') { return t('filters.period_all', 'All time'); }
    if (f.period === 'last30') { return t('filters.period_30', 'Last 30 days'); }
    if (f.period === 'ytd') { return t('filters.period_ytd', 'Year to date'); }
    if (f.period === 'custom') {
      var fmt = function (iso) { if (!iso) { return '…'; } var p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; };
      return fmt(f.from) + ' – ' + fmt(f.to);
    }
    return t('filters.period_all', 'All time');
  }

  function buildPeriodDropdown() {
    var dd = createDropdown(periodButtonLabel());
    dd.panel.classList.add('aico-orders-period-panel');

    var presetButtons = [];
    function refresh() {
      dd.setLabel(periodButtonLabel());
      dd.setActive(state.filters.period !== 'all');
      presetButtons.forEach(function (b) {
        b.el.classList.toggle('aico-orders-chip-active', state.filters.period === b.value);
      });
      if (fromInput) { fromInput.classList.toggle('aico-orders-date-active', state.filters.period === 'custom'); }
      if (toInput) { toInput.classList.toggle('aico-orders-date-active', state.filters.period === 'custom'); }
    }

    function selectPreset(value) {
      state.filters.period = value;
      state.filters.from = null;
      state.filters.to = null;
      if (fromInput) { fromInput.value = ''; }
      if (toInput) { toInput.value = ''; }
      refresh();
      closeOpenDropdown();
      resetAndReload();
    }

    // "All time" full-width chip
    var allChip = el('button', 'aico-orders-chip aico-orders-chip-block');
    allChip.type = 'button';
    allChip.textContent = t('filters.period_all', 'All time');
    allChip.addEventListener('click', function () { selectPreset('all'); });
    presetButtons.push({ el: allChip, value: 'all' });
    dd.panel.appendChild(allChip);

    // Preset row: last 30 / year to date
    var presetRow = el('div', 'aico-orders-chip-row');
    [['last30', t('filters.period_30', 'Last 30 days')], ['ytd', t('filters.period_ytd', 'Year to date')]].forEach(function (p) {
      var b = el('button', 'aico-orders-chip');
      b.type = 'button';
      b.textContent = p[1];
      b.addEventListener('click', function () { selectPreset(p[0]); });
      presetButtons.push({ el: b, value: p[0] });
      presetRow.appendChild(b);
    });
    dd.panel.appendChild(presetRow);

    // Custom section
    dd.panel.appendChild(el('p', 'aico-orders-section-label', t('filters.period_custom_label', 'Custom')));
    var range = el('div', 'aico-orders-date-row');
    var fromInput = el('input', 'aico-orders-date');
    fromInput.type = 'date';
    fromInput.setAttribute('aria-label', t('filters.from', 'From'));
    var toInput = el('input', 'aico-orders-date');
    toInput.type = 'date';
    toInput.setAttribute('aria-label', t('filters.to', 'To'));

    function onDateChange() {
      state.filters.from = fromInput.value || null;
      state.filters.to = toInput.value || null;
      if (state.filters.from || state.filters.to) {
        state.filters.period = 'custom';
      } else {
        state.filters.period = 'all';
      }
      refresh();
      resetAndReload();
    }
    fromInput.addEventListener('change', onDateChange);
    toInput.addEventListener('change', onDateChange);
    range.appendChild(fromInput);
    range.appendChild(el('span', 'aico-orders-date-sep', '–'));
    range.appendChild(toInput);
    dd.panel.appendChild(range);

    refresh();
    dd._refresh = refresh;
    return dd;
  }

  function createdByLabel() {
    var sel = state.filters.createdBy;
    if (!sel.length) {
      return t('filters.created_by_all', 'All users');
    }
    if (sel.length === 1) {
      var id = sel[0];
      if (id === 'unassigned') { return t('filters.unassigned', 'Unassigned'); }
      var match = state.userCounts.filter(function (u) { return String(u.id) === String(id); })[0];
      return match ? (match.name + ' (' + match.count + ')') : String(id);
    }
    return t('filters.created_by_count', '{count} users').replace('{count}', sel.length);
  }

  function buildCreatedByDropdown() {
    var dd = createDropdown(createdByLabel());
    dd.panel.classList.add('aico-orders-createdby-panel');

    var searchWrap = el('div', 'aico-orders-createdby-search');
    searchWrap.appendChild(icon('search', 'aico-orders-createdby-search-icon'));
    var userSearch = el('input', 'aico-orders-createdby-search-input');
    userSearch.type = 'search';
    userSearch.placeholder = t('filters.search_users', 'Search users');
    searchWrap.appendChild(userSearch);
    dd.panel.appendChild(searchWrap);

    var listWrap = el('div', 'aico-orders-createdby-list');
    dd.panel.appendChild(listWrap);

    function tokenFor(u) { return u.id == null ? 'unassigned' : String(u.id); }

    function render() {
      listWrap.replaceChildren();
      var query = userSearch.value.trim().toLowerCase();

      // "All users" row
      var allRow = el('button', 'aico-orders-createdby-row');
      allRow.type = 'button';
      if (!state.filters.createdBy.length) { allRow.classList.add('aico-orders-createdby-selected'); }
      var allCheck = el('span', 'aico-orders-checkbox' + (!state.filters.createdBy.length ? ' aico-orders-checkbox-on' : ''));
      allRow.appendChild(allCheck);
      allRow.appendChild(el('span', 'aico-orders-createdby-name', t('filters.created_by_all', 'All users')));
      allRow.addEventListener('click', function () {
        state.filters.createdBy = [];
        dd.setLabel(createdByLabel());
        dd.setActive(false);
        render();
        resetAndReload();
      });
      listWrap.appendChild(allRow);

      var sorted = state.userCounts.slice().sort(function (a, b) {
        if (a.id == null) { return 1; }
        if (b.id == null) { return -1; }
        return (b.count || 0) - (a.count || 0);
      });
      sorted.forEach(function (u) {
        var name = u.id == null ? t('filters.unassigned', 'Unassigned') : (u.name || String(u.id));
        if (query && name.toLowerCase().indexOf(query) === -1) {
          return;
        }
        var token = tokenFor(u);
        var selected = state.filters.createdBy.indexOf(token) !== -1;
        var row = el('button', 'aico-orders-createdby-row');
        row.type = 'button';
        if (selected) { row.classList.add('aico-orders-createdby-selected'); }
        var check = el('span', 'aico-orders-checkbox' + (selected ? ' aico-orders-checkbox-on' : ''));
        row.appendChild(check);
        row.appendChild(el('span', 'aico-orders-createdby-name', name));
        row.appendChild(el('span', 'aico-orders-createdby-count', String(u.count != null ? u.count : 0)));
        row.addEventListener('click', function () {
          var idx = state.filters.createdBy.indexOf(token);
          if (idx === -1) {
            state.filters.createdBy.push(token);
          } else {
            state.filters.createdBy.splice(idx, 1);
          }
          dd.setLabel(createdByLabel());
          dd.setActive(state.filters.createdBy.length > 0);
          render();
          resetAndReload();
        });
        listWrap.appendChild(row);
      });
    }

    userSearch.addEventListener('input', render);
    userSearch.addEventListener('click', function (e) { e.stopPropagation(); });
    render();
    dd._render = render;
    return dd;
  }

  // ---- Toolbar assembly -------------------------------------------

  var typeDropdown, periodDropdown, createdByDropdown, resetBtnEl;

  function buildToolbar() {
    typeDropdown = buildTypeDropdown();
    periodDropdown = buildPeriodDropdown();
    createdByDropdown = buildCreatedByDropdown();
    filtersEl.appendChild(typeDropdown.root);
    filtersEl.appendChild(periodDropdown.root);
    filtersEl.appendChild(createdByDropdown.root);

    resetBtnEl = el('button', 'aico-orders-reset');
    resetBtnEl.type = 'button';
    resetBtnEl.title = t('filters.reset', 'Reset filters');
    resetBtnEl.setAttribute('aria-label', t('filters.reset', 'Reset filters'));
    resetBtnEl.appendChild(icon('reset'));
    resetBtnEl.hidden = true;
    resetBtnEl.addEventListener('click', resetFilters);
    filtersEl.appendChild(resetBtnEl);
  }

  function updateResetVisibility() {
    if (resetBtnEl) {
      resetBtnEl.hidden = !hasActiveFilters();
    }
  }

  function resetFilters() {
    state.filters = { type: 'all', period: 'all', from: null, to: null, search: '', createdBy: [] };
    if (searchInput) { searchInput.value = ''; }
    if (typeDropdown) { typeDropdown.setLabel(typeLabel('all')); typeDropdown.setActive(false); Array.prototype.forEach.call(typeDropdown.panel.children, function (c, i) { c.classList.toggle('aico-orders-option-selected', i === 0); }); }
    if (periodDropdown && periodDropdown._refresh) { periodDropdown._refresh(); }
    if (createdByDropdown) { createdByDropdown.setLabel(createdByLabel()); createdByDropdown.setActive(false); if (createdByDropdown._render) { createdByDropdown._render(); } }
    closeOpenDropdown();
    resetAndReload();
  }

  function loadUserCounts() {
    if (!USER_COUNTS_URL) { return; }
    fetch(USER_COUNTS_URL, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (payload) {
        if (payload && Array.isArray(payload.data)) {
          state.userCounts = payload.data;
          if (createdByDropdown && createdByDropdown._render) { createdByDropdown._render(); }
        }
      })
      .catch(function () {});
  }

  // ---- Card: summary ----------------------------------------------

  function buildSummary(order, chevron) {
    var summary = el('div', 'aico-order-summary');
    var isCancelled = order.status === 'cancelled';

    // Left: square chevron toggle + date/time + divider + copy/number
    var left = el('div', 'aico-order-summary-left');

    var toggle = el('span', 'aico-order-toggle');
    toggle.appendChild(chevron);
    left.appendChild(toggle);

    var dateBlock = el('div', 'aico-order-dateblock');
    dateBlock.appendChild(el('span', 'aico-order-date', formatDate(order.createdAt)));
    var time = formatTime(order.createdAt);
    if (time) { dateBlock.appendChild(el('span', 'aico-order-time', time)); }
    left.appendChild(dateBlock);

    left.appendChild(el('span', 'aico-order-divider'));

    var numberRow = el('div', 'aico-order-number-row');
    if (order.orderNumber) {
      numberRow.appendChild(copyButton(order.orderNumber, t('card.copy_order_number', 'Copy order number'), 'copy'));
    }
    numberRow.appendChild(el('span', 'aico-order-number', order.orderNumber || '—'));
    left.appendChild(numberRow);

    summary.appendChild(left);

    // Right: count • total • status, with documents button below
    var right = el('div', 'aico-order-summary-right');
    var metaRow = el('div', 'aico-order-meta-row');
    metaRow.appendChild(el('span', 'aico-order-itemcount', t('card.item_count', '{count} products').replace('{count}', countProducts(order))));
    metaRow.appendChild(el('span', 'aico-order-meta-dot'));
    var total = el('span', 'aico-order-total' + (isCancelled ? ' aico-order-total-cancelled' : ''), formatMoney(order.totalPrice, order.currency));
    metaRow.appendChild(total);
    metaRow.appendChild(buildStatusBadge(order));
    right.appendChild(metaRow);

    if (!isCancelled) {
      var docs = buildDocumentsButton(order);
      if (docs) { right.appendChild(docs); }
    }
    summary.appendChild(right);

    return summary;
  }

  // ---- Card: documents button (below status) ----------------------

  function documentUrlFor(doc) {
    if (doc.id != null && DOC_URL_TEMPLATE) {
      return DOC_URL_TEMPLATE.replace('__ID__', encodeURIComponent(doc.id));
    }
    return doc.downloadUrl || null;
  }

  function collectDocuments(order) {
    var buckets = order.orderDocuments || {};
    var keys = ['invoices', 'proformaInvoices', 'exportInvoices', 'preorderDocuments', 'orderConfirmations'];
    var collected = [];
    for (var k = 0; k < keys.length; k++) {
      var rows = buckets[keys[k]] || [];
      for (var i = 0; i < rows.length; i++) {
        var url = documentUrlFor(rows[i]);
        if (!url) { continue; }
        collected.push({ url: url, label: t('documents.type_' + keys[k], keys[k]), number: rows[i].documentNumber || '' });
      }
    }
    return collected;
  }

  function downloadAll(docs) {
    var index = 0;
    (function next() {
      if (index >= docs.length) { return; }
      triggerDownload(docs[index].url);
      index++;
      setTimeout(next, 250);
    })();
  }

  function buildDocumentsButton(order) {
    var docs = collectDocuments(order);
    if (!docs.length) { return null; }

    var wrap = el('div', 'aico-order-docaction');
    var button = el('button', 'aico-order-docbtn');
    button.type = 'button';
    button.appendChild(el('span', null, t('documents.menu', 'Documents')));

    if (docs.length === 1) {
      button.addEventListener('click', function (event) {
        event.stopPropagation();
        triggerDownload(docs[0].url);
      });
      wrap.appendChild(button);
      return wrap;
    }

    button.appendChild(icon('chevronDown', 'aico-order-docbtn-chevron'));
    button.setAttribute('aria-expanded', 'false');
    var box = collapsible('aico-order-docmenu');
    docs.forEach(function (d) {
      var link = el('a', 'aico-order-docmenu-link', d.number ? (d.label + ' · ' + d.number) : d.label);
      link.href = d.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.addEventListener('click', function (e) { e.stopPropagation(); });
      box.inner.appendChild(link);
    });
    var allBtn = el('button', 'aico-order-docmenu-all');
    allBtn.type = 'button';
    allBtn.textContent = t('documents.download_all', 'Download all');
    allBtn.addEventListener('click', function (event) { event.stopPropagation(); downloadAll(docs); });
    box.inner.appendChild(allBtn);

    var docOutside;
    function closeMenu() {
      button.setAttribute('aria-expanded', 'false');
      setCollapsed(box.outer, false);
      document.removeEventListener('click', docOutside, true);
    }
    docOutside = function (event) { if (!wrap.contains(event.target)) { closeMenu(); } };
    button.addEventListener('click', function (event) {
      event.stopPropagation();
      var open = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
      setCollapsed(box.outer, open);
      if (open) { document.addEventListener('click', docOutside, true); }
      else { document.removeEventListener('click', docOutside, true); }
    });

    wrap.appendChild(button);
    wrap.appendChild(box.outer);
    return wrap;
  }

  // ---- Card: expanded products table ------------------------------

  function buildProductsTable(order) {
    var wrap = el('div', 'aico-order-products');

    var head = el('div', 'aico-order-prow aico-order-products-head');
    head.appendChild(el('span', 'aico-order-pcell-toggle'));
    head.appendChild(el('span', null, t('card.product', 'Product')));
    head.appendChild(el('span', null, t('card.sku', 'SKU')));
    head.appendChild(el('span', 'aico-order-cell-num', t('card.quantity', 'Qty')));
    head.appendChild(el('span', 'aico-order-cell-num', t('card.price', 'Price')));
    head.appendChild(el('span', 'aico-order-cell-num', t('card.subtotal', 'Subtotal')));
    wrap.appendChild(head);

    (order.products || []).forEach(function (product) {
      wrap.appendChild(buildProductRow(product, order.currency));
    });
    return wrap;
  }

  function buildProductRow(product, currency) {
    var totals = productTotals(product);
    var group = el('div', 'aico-order-product');

    var row = el('button', 'aico-order-prow aico-order-product-head');
    row.type = 'button';
    row.setAttribute('aria-expanded', 'false');

    var toggle = el('span', 'aico-order-pcell-toggle');
    toggle.appendChild(icon('chevronDown', 'aico-order-product-chevron'));
    row.appendChild(toggle);

    row.appendChild(el('span', 'aico-order-product-name', product.name || product.sku || ''));

    var skuCell = el('span', 'aico-order-sku-cell');
    if (product.sku) {
      skuCell.appendChild(copyButton(product.sku, t('card.copy_sku', 'Copy SKU'), 'copy'));
    }
    skuCell.appendChild(el('span', 'aico-order-sku-text', product.sku || '—'));
    row.appendChild(skuCell);

    row.appendChild(el('span', 'aico-order-cell-num aico-order-qty', String(totals.qty)));
    row.appendChild(el('span', 'aico-order-cell-num', formatMoney(totals.unit, currency)));
    row.appendChild(el('span', 'aico-order-cell-num aico-order-subtotal', formatMoney(totals.sum, currency)));

    var box = collapsible('aico-order-variants');
    box.inner.appendChild(buildVariantTable(product));

    row.addEventListener('click', function () {
      var open = row.getAttribute('aria-expanded') !== 'true';
      row.setAttribute('aria-expanded', open ? 'true' : 'false');
      group.classList.toggle('aico-order-product-open', open);
      setCollapsed(box.outer, open);
    });

    group.appendChild(row);
    group.appendChild(box.outer);
    return group;
  }

  function buildVariantTable(product) {
    var table = el('div', 'aico-order-vtable');

    // Same 6-column grid as the product rows so Size / SKU / Qty line up
    // under PRODUKT / SKU / MENGE; the price + subtotal columns stay empty.
    var head = el('div', 'aico-order-prow aico-order-vhead');
    head.appendChild(el('span', 'aico-order-pcell-toggle'));
    head.appendChild(el('span', null, t('card.size', 'Size')));
    head.appendChild(el('span', null, t('card.sku', 'SKU')));
    head.appendChild(el('span', 'aico-order-cell-num', t('card.quantity', 'Qty')));
    head.appendChild(el('span'));
    head.appendChild(el('span'));
    table.appendChild(head);

    (product.items || []).forEach(function (item) {
      var row = el('div', 'aico-order-prow aico-order-vrow');
      row.appendChild(el('span', 'aico-order-pcell-toggle'));

      var sizeCell = el('span', 'aico-order-vsize');
      if (item.size) {
        sizeCell.appendChild(el('span', 'aico-order-size-chip', item.size));
      } else {
        sizeCell.appendChild(el('span', null, '—'));
      }
      row.appendChild(sizeCell);

      var skuCell = el('span', 'aico-order-sku-cell');
      if (item.sku) {
        skuCell.appendChild(copyButton(item.sku, t('card.copy_sku', 'Copy SKU'), 'copy'));
      }
      skuCell.appendChild(el('span', 'aico-order-sku-text', item.sku || '—'));
      row.appendChild(skuCell);

      row.appendChild(el('span', 'aico-order-cell-num', String(item.quantity != null ? item.quantity : '')));
      row.appendChild(el('span'));
      row.appendChild(el('span'));
      table.appendChild(row);
    });
    return table;
  }

  // ---- Card: shipping / tracking panel ----------------------------

  function buildTrackingPanel(order) {
    var panel = el('aside', 'aico-order-tracking');
    panel.appendChild(el('h4', 'aico-order-tracking-title', t('shipping.title', 'Shipping & tracking')));

    var tracking = order.trackingNumbers || [];
    var statusKey = deriveStatusKey(order);

    if (!tracking.length || statusKey === 'in_progress') {
      var na = el('div', 'aico-order-tracking-item aico-order-tracking-na');
      na.appendChild(icon('grid', 'aico-order-tracking-icon'));
      na.appendChild(el('span', null, t('shipping.link_unavailable', 'Link not available')));
      panel.appendChild(na);
      return panel;
    }

    tracking.forEach(function (entry) {
      var tn = entry.trackingNumber || {};
      var label = ((IS_DE ? tn.de_CH : tn.en) || tn.en || tn.de_CH || '').trim();
      var url = entry.trackingUrl;
      var item = el('div', 'aico-order-tracking-item');
      if (url) {
        var link = el('a', 'aico-order-tracking-link', label || t('shipping.track', 'Track'));
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.prepend(icon('grid', 'aico-order-tracking-icon'));
        link.appendChild(icon('chevronRight', 'aico-order-tracking-chevron'));
        item.appendChild(link);
      } else {
        item.appendChild(icon('grid', 'aico-order-tracking-icon'));
        item.appendChild(el('span', null, label || '—'));
      }
      panel.appendChild(item);
    });
    return panel;
  }

  // ---- Card assembly ----------------------------------------------

  function buildDetail(order) {
    var box = collapsible('aico-order-detail');
    var grid = el('div', 'aico-order-detail-grid');
    var left = el('div', 'aico-order-detail-left');
    left.appendChild(el('span', 'aico-order-detail-strip'));
    var products = el('div', 'aico-order-detail-products');
    products.appendChild(buildProductsTable(order));
    left.appendChild(products);
    grid.appendChild(left);
    grid.appendChild(buildTrackingPanel(order));
    box.inner.appendChild(grid);
    return box;
  }

  function buildCard(order) {
    var li = el('li', 'aico-order-card');
    li.setAttribute('data-aico-order-id', order.id);
    li.setAttribute('data-aico-order-type', order.type);
    if (order.status === 'cancelled') { li.classList.add('aico-order-card-cancelled'); }

    var chevron = icon('chevronDown', 'aico-order-chevron');
    var summary = buildSummary(order, chevron);
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
      if (event.target.closest('button, a')) { return; }
      toggle();
    });
    summary.addEventListener('keydown', function (event) {
      if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('button, a')) {
        event.preventDefault();
        toggle();
      }
    });

    li.appendChild(summary);
    li.appendChild(detail.outer);
    return li;
  }

  // ---- Feed loading -----------------------------------------------

  function setLoading(loading) {
    state.loading = loading;
    if (loaderEl) { loaderEl.hidden = !loading; }
  }

  function updateChrome(totalRendered) {
    updateResetVisibility();
    if (emptyEl) {
      if (totalRendered === 0 && state.done) {
        emptyEl.textContent = hasActiveFilters() ? t('empty_filtered', emptyEl.textContent) : emptyEl.textContent;
        emptyEl.hidden = false;
      } else {
        emptyEl.hidden = true;
      }
    }
    if (endEl) {
      endEl.hidden = !(state.done && totalRendered > 0);
    }
  }

  function sentinelInView() {
    if (!sentinelEl) { return false; }
    var vh = window.innerHeight || document.documentElement.clientHeight;
    return sentinelEl.getBoundingClientRect().top <= vh + 400;
  }

  function maybeLoadMore() {
    if (sentinelInView()) { loadNextPage(); }
  }

  function loadNextPage() {
    if (state.loading || state.done || !FEED_URL) { return; }
    setLoading(true);
    if (errorEl) { errorEl.hidden = true; }
    var requestId = state.requestId;

    fetch(buildFeedUrl(), {
      method: 'GET',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    })
      .then(function (response) {
        if (!response.ok) { throw new Error('feed status ' + response.status); }
        return response.json();
      })
      .then(function (payload) {
        if (requestId !== state.requestId) { return; }
        var rows = (payload && payload.data) || [];
        var meta = (payload && payload.meta) || {};
        for (var i = 0; i < rows.length; i++) {
          listEl.appendChild(buildCard(rows[i]));
        }
        state.lastPage = (typeof meta.lastPage === 'number') ? meta.lastPage : state.page;
        if (state.page + 1 >= state.lastPage || rows.length === 0) {
          state.done = true;
        } else {
          state.page += 1;
        }
        setLoading(false);
        updateChrome(listEl.children.length);
        maybeLoadMore();
      })
      .catch(function (err) {
        if (requestId !== state.requestId) { return; }
        console.warn('aico-orders: feed load failed', err);
        setLoading(false);
        state.done = true;
        if (errorEl) { errorEl.hidden = false; }
      });
  }

  function resetAndReload() {
    state.requestId += 1;
    state.page = 0;
    state.lastPage = null;
    state.done = false;
    state.loading = false;
    if (listEl) { listEl.innerHTML = ''; }
    if (endEl) { endEl.hidden = true; }
    if (emptyEl) { emptyEl.hidden = true; }
    updateResetVisibility();
    loadNextPage();
  }

  // ---- Wiring -----------------------------------------------------

  if (searchInput) {
    var searchTimer = null;
    searchInput.addEventListener('input', function () {
      var value = searchInput.value.trim();
      if (searchTimer) { clearTimeout(searchTimer); }
      searchTimer = setTimeout(function () {
        state.filters.search = value;
        resetAndReload();
      }, SEARCH_DEBOUNCE_MS);
    });
  }

  window.addEventListener('scroll', maybeLoadMore, { passive: true });
  window.addEventListener('resize', maybeLoadMore, { passive: true });

  if (sentinelEl && 'IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) { loadNextPage(); }
      }
    }, { rootMargin: '400px 0px' });
    observer.observe(sentinelEl);
  }

  // ---- Init -------------------------------------------------------

  if (filtersEl) { buildToolbar(); }
  loadUserCounts();
  loadNextPage();
})();
