// Aico storefront — dealer exchange-platform (Tauschplattform) client controller.
//
// Recreates b2b-shop's /exchange-platform marketplace against the storefront
// cookie session. The page shell + region gate are server-rendered; this
// script:
//   - loads the allowed brands into the create-form brand select,
//   - drives the model/colour autocomplete (300ms debounce, paginated scroll,
//     freeSolo so free text is allowed),
//   - fetches region-aware size options per gender,
//   - creates / accepts / deletes requests and re-fetches the list,
//   - renders the table's 3-way row state (Accept / Delete / Accepted),
//   - and highlights the `?er_id=` deep-linked row (or warns if it's gone).
//
// All endpoints are same-origin `.js` routes on StorefrontExchangeController;
// writes carry the hand-rolled `_token` CSRF value (the {% form %} tag isn't
// available yet — same pattern as account-page.js).

(function () {
  'use strict';

  var root = document.querySelector('[data-aico-exchange]');
  if (!root) {
    return;
  }

  // Region-gated render emits no form/table; nothing to wire up.
  if (root.getAttribute('data-aico-exchange-eligible') !== '1') {
    return;
  }

  // ---- config + i18n ----------------------------------------------

  var REQUESTS_URL = root.getAttribute('data-requests-url') || '';
  var ACCEPT_URL_TEMPLATE = root.getAttribute('data-accept-url-template') || '';
  var DELETE_URL_TEMPLATE = root.getAttribute('data-delete-url-template') || '';
  var PRODUCTS_URL = root.getAttribute('data-products-url') || '';
  var BRANDS_URL = root.getAttribute('data-brands-url') || '';
  var SIZE_OPTIONS_URL = root.getAttribute('data-size-options-url') || '';
  var PAGE_SIZE = 10;
  var SEARCH_DEBOUNCE_MS = 300;

  var i18n = {};
  var i18nEl = root.querySelector('[data-aico-exchange-i18n]');
  if (i18nEl) {
    try {
      i18n = JSON.parse(i18nEl.textContent) || {};
    } catch (e) {
      console.warn('aico-exchange: invalid i18n bootstrap', e);
    }
  }

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

  // Brand-name -> small square logo URL (emitted by the template). Used to
  // prefix each requests-table brand cell, matching the legacy b2b-shop.
  var brandLogos = {};
  var brandLogosEl = root.querySelector('[data-aico-exchange-brand-logos]');
  if (brandLogosEl) {
    try {
      brandLogos = JSON.parse(brandLogosEl.textContent) || {};
    } catch (e) {
      console.warn('aico-exchange: invalid brand-logos bootstrap', e);
    }
  }
  function brandLogoFor(name) {
    if (!name) { return ''; }
    var key = String(name).trim().toLowerCase();
    if (brandLogos[key]) { return brandLogos[key]; }
    // Fall back on the first word (e.g. "kybun Arabic Styles" -> "kybun").
    var first = key.split(/\s+/)[0];
    return brandLogos[first] || '';
  }

  // Inline icons (feather/lucide style) for the action buttons.
  var ICON_HANDSHAKE =
    '<svg class="aico-exchange-action-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="m11 17 2 2a1 1 0 1 0 3-3"/>' +
    '<path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/>' +
    '<path d="m21 3 1 11h-2"/>' +
    '<path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"/>' +
    '<path d="M3 4h8"/>' +
    '</svg>';
  var ICON_TRASH =
    '<svg class="aico-exchange-action-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<polyline points="3 6 5 6 21 6"/>' +
    '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' +
    '<line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>' +
    '</svg>';
  var ICON_CHECK =
    '<svg class="aico-exchange-action-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<polyline points="20 6 9 17 4 12"/>' +
    '</svg>';

  function csrfToken() {
    var input = root.querySelector('input[name="_token"]');
    return input ? input.value : '';
  }

  // ---- DOM refs ---------------------------------------------------

  var formEl = root.querySelector('[data-aico-exchange-form]');
  var brandSelect = root.querySelector('[data-aico-exchange-brand]');
  var productField = root.querySelector('[data-aico-exchange-product-field]');
  var productInput = root.querySelector('[data-aico-exchange-product-input]');
  var productSpinner = root.querySelector('[data-aico-exchange-product-spinner]');
  var optionsEl = root.querySelector('[data-aico-exchange-options]');
  var customColorEl = root.querySelector('[data-aico-exchange-custom-color]');
  var genderField = root.querySelector('[data-aico-exchange-gender-field]');
  var genderSelect = root.querySelector('[data-aico-exchange-gender]');
  var sizeField = root.querySelector('[data-aico-exchange-size-field]');
  var sizeSelect = root.querySelector('[data-aico-exchange-size]');
  var submitBtn = root.querySelector('[data-aico-exchange-submit]');

  // Placeholder option markup for the size select (rebuilt on each gender
  // change / form reset). Matches the legacy b2b-shop "Size" placeholder.
  var sizePlaceholderText = (sizeSelect && sizeSelect.getAttribute('data-aico-exchange-size-placeholder')) || '';
  function sizePlaceholderOption() {
    return '<option value="" disabled selected hidden>' +
      sizePlaceholderText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') +
      '</option>';
  }

  var rowsEl = root.querySelector('[data-aico-exchange-rows]');
  var loaderEl = root.querySelector('[data-aico-exchange-loader]');
  var emptyEl = root.querySelector('[data-aico-exchange-empty]');
  var errorEl = root.querySelector('[data-aico-exchange-error]');
  var toastEl = root.querySelector('[data-aico-exchange-toast]');

  // ---- form state -------------------------------------------------

  var formState = {
    brandId: null,
    brandName: '',
    product: null,
    gender: null,
    size: null,
    submitting: false
  };

  // autocomplete pagination state
  var ac = {
    page: 0,
    lastPage: 0,
    hasMore: false,
    search: '',
    options: [],
    fetching: false,
    debounceTimer: null
  };

  var deepLinkHandled = false;

  // ---- small helpers ----------------------------------------------

  function show(el) { if (el) { el.hidden = false; } }
  function hide(el) { if (el) { el.hidden = true; } }

  function toast(message) {
    if (!toastEl) { return; }
    toastEl.textContent = message;
    toastEl.classList.add('is-visible');
    window.clearTimeout(toast._timer);
    toast._timer = window.setTimeout(function () {
      toastEl.classList.remove('is-visible');
    }, 5000);
  }

  function jsonGet(url) {
    return fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
    }).then(function (res) {
      if (!res.ok) { throw new Error('GET failed: ' + res.status); }
      return res.json();
    });
  }

  function jsonSend(url, method, payload) {
    var body = new URLSearchParams();
    var token = csrfToken();
    if (token) { body.append('_token', token); }
    if (payload) {
      Object.keys(payload).forEach(function (key) {
        if (payload[key] != null) { body.append(key, payload[key]); }
      });
    }
    return fetch(url, {
      method: method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    }).then(function (res) {
      if (!res.ok) { throw new Error(method + ' failed: ' + res.status); }
      return res.json().catch(function () { return {}; });
    });
  }

  function substituteId(template, id) {
    return template.replace('__ID__', encodeURIComponent(id));
  }

  // ---- brand select -----------------------------------------------

  function loadBrands() {
    if (!brandSelect || !BRANDS_URL) { return; }
    jsonGet(BRANDS_URL)
      .then(function (res) {
        var brands = (res && res.data) || [];
        brands.forEach(function (brand) {
          var opt = document.createElement('option');
          opt.value = String(brand.id);
          opt.textContent = brand.name;
          brandSelect.appendChild(opt);
        });
        if (!brands.length) {
          var emptyOpt = document.createElement('option');
          emptyOpt.value = '';
          emptyOpt.disabled = true;
          emptyOpt.textContent = t('form.empty_brands', 'There are no brands');
          brandSelect.appendChild(emptyOpt);
        }
      })
      .catch(function (e) { console.warn('aico-exchange: brands load failed', e); });
  }

  // ---- autocomplete (model & colour) ------------------------------

  function resetAutocomplete() {
    ac.page = 0;
    ac.lastPage = 0;
    ac.hasMore = false;
    ac.options = [];
    if (optionsEl) { optionsEl.innerHTML = ''; hide(optionsEl); }
  }

  function fetchProducts(reset) {
    if (!formState.brandId || ac.fetching) { return; }
    ac.fetching = true;
    show(productSpinner);
    if (reset) { ac.page = 0; }

    var url = PRODUCTS_URL +
      '?brand_id=' + encodeURIComponent(formState.brandId) +
      '&page=' + encodeURIComponent(ac.page) +
      '&page_size=' + PAGE_SIZE +
      '&search=' + encodeURIComponent(ac.search);

    jsonGet(url)
      .then(function (res) {
        var data = (res && res.data) || [];
        var meta = (res && res.meta) || {};
        ac.lastPage = meta.last_page || 0;
        ac.hasMore = !!meta.has_more;

        // The service returns the model name as `webName` (camelCase); keep a
        // snake_case fallback in case the envelope shape ever changes.
        var names = data.map(function (d) { return d.webName || d.web_name; }).filter(Boolean);
        if (reset || ac.page === 0) {
          ac.options = names;
        } else {
          ac.options = dedupe(ac.options.concat(names));
        }
        renderOptions();
      })
      .catch(function (e) { console.warn('aico-exchange: products load failed', e); })
      .then(function () { ac.fetching = false; hide(productSpinner); });
  }

  function dedupe(arr) {
    var seen = {};
    var out = [];
    arr.forEach(function (v) {
      if (!seen[v]) { seen[v] = true; out.push(v); }
    });
    return out;
  }

  function renderOptions() {
    if (!optionsEl) { return; }
    optionsEl.innerHTML = '';

    // freeSolo: when nothing matches but the user typed something, offer the
    // raw search term as a selectable option (legacy ExchangePlatformForm).
    var list = ac.options.slice();
    if (!list.length && ac.search) {
      list = [ac.search];
    }
    if (!list.length) {
      hide(optionsEl);
      productInput.setAttribute('aria-expanded', 'false');
      return;
    }

    list.forEach(function (name) {
      var li = document.createElement('li');
      li.className = 'aico-exchange-option';
      li.setAttribute('role', 'option');
      li.textContent = name;
      li.addEventListener('mousedown', function (ev) {
        ev.preventDefault();
        selectProduct(name);
      });
      optionsEl.appendChild(li);
    });
    show(optionsEl);
    productInput.setAttribute('aria-expanded', 'true');
  }

  function selectProduct(name) {
    formState.product = name;
    productInput.value = name;
    hide(optionsEl);
    productInput.setAttribute('aria-expanded', 'false');
    updateCustomColorHint();
    // Reset downstream selections and reveal gender.
    formState.gender = null;
    formState.size = null;
    if (genderSelect) { genderSelect.value = ''; }
    show(genderField);
    hide(sizeField);
    refreshSubmitState();
  }

  function updateCustomColorHint() {
    if (!customColorEl) { return; }
    var noMatches = formState.product && !ac.options.length && ac.search;
    if (noMatches) { show(customColorEl); } else { hide(customColorEl); }
  }

  // ---- size options -----------------------------------------------

  function loadSizeOptions(gender) {
    if (!sizeSelect || !SIZE_OPTIONS_URL || !gender) { return; }
    sizeSelect.innerHTML = sizePlaceholderOption();
    jsonGet(SIZE_OPTIONS_URL + '?gender=' + encodeURIComponent(gender))
      .then(function (res) {
        var options = (res && res.data) || [];
        options.forEach(function (opt) {
          var el = document.createElement('option');
          el.value = opt.value;       // canonical EU key (submitted)
          el.textContent = opt.label; // viewer-region display
          sizeSelect.appendChild(el);
        });
        if (!options.length) {
          var emptyOpt = document.createElement('option');
          emptyOpt.value = '';
          emptyOpt.disabled = true;
          emptyOpt.textContent = t('form.empty_sizes', 'There are no sizes for the selected model');
          sizeSelect.appendChild(emptyOpt);
        }
      })
      .catch(function (e) { console.warn('aico-exchange: size options load failed', e); });
  }

  function refreshSubmitState() {
    var ready = !!(formState.brandId && formState.product && formState.gender && formState.size) && !formState.submitting;
    if (submitBtn) { submitBtn.disabled = !ready; }
  }

  // ---- form wiring ------------------------------------------------

  if (brandSelect) {
    brandSelect.addEventListener('change', function () {
      formState.brandId = brandSelect.value ? parseInt(brandSelect.value, 10) : null;
      formState.brandName = brandSelect.value ? brandSelect.options[brandSelect.selectedIndex].textContent : '';
      // Reset the rest of the cascade.
      formState.product = null;
      formState.gender = null;
      formState.size = null;
      ac.search = '';
      if (productInput) { productInput.value = ''; }
      if (genderSelect) { genderSelect.value = ''; }
      resetAutocomplete();
      updateCustomColorHint();
      if (formState.brandId) { show(productField); } else { hide(productField); }
      hide(genderField);
      hide(sizeField);
      syncCustomDropdowns();
      refreshSubmitState();
    });
  }

  if (productInput) {
    productInput.addEventListener('input', function () {
      var value = productInput.value;
      formState.product = value ? value : null; // freeSolo: typed text is valid
      window.clearTimeout(ac.debounceTimer);
      ac.debounceTimer = window.setTimeout(function () {
        ac.search = value;
        fetchProducts(true);
      }, SEARCH_DEBOUNCE_MS);
      // Reveal gender as soon as there's text (matches legacy onInputChange).
      if (value) { show(genderField); } else { hide(genderField); hide(sizeField); }
      refreshSubmitState();
    });
    productInput.addEventListener('focus', function () {
      if (formState.brandId && !ac.options.length) { fetchProducts(true); }
      else if (ac.options.length) { renderOptions(); }
    });
    productInput.addEventListener('blur', function () {
      // Allow option mousedown to win, then collapse.
      window.setTimeout(function () { hide(optionsEl); }, 150);
    });
  }

  if (optionsEl) {
    // Infinite scroll for paginated options.
    optionsEl.addEventListener('scroll', function () {
      var nearBottom = (optionsEl.scrollHeight - (optionsEl.scrollTop + optionsEl.clientHeight)) < 12;
      if (nearBottom && ac.hasMore && !ac.fetching) {
        ac.page += 1;
        fetchProducts(false);
      }
    });
  }

  if (genderSelect) {
    genderSelect.addEventListener('change', function () {
      formState.gender = genderSelect.value || null;
      formState.size = null;
      if (sizeSelect) { sizeSelect.value = ''; }
      if (formState.gender) {
        loadSizeOptions(formState.gender);
        show(sizeField);
      } else {
        hide(sizeField);
      }
      refreshSubmitState();
    });
  }

  if (sizeSelect) {
    sizeSelect.addEventListener('change', function () {
      formState.size = sizeSelect.value || null;
      refreshSubmitState();
    });
  }

  if (formEl) {
    formEl.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (formState.submitting) { return; }
      if (!(formState.brandId && formState.product && formState.gender && formState.size)) { return; }

      formState.submitting = true;
      refreshSubmitState();

      jsonSend(REQUESTS_URL, 'POST', {
        brand_id: formState.brandId,
        brand_name: formState.brandName,
        product_name: formState.product,
        gender: formState.gender,
        size: formState.size
      })
        .then(function () {
          resetForm();
          loadRequests();
        })
        .catch(function () { toast(t('error', 'Something went wrong. Please try again.')); })
        .then(function () {
          formState.submitting = false;
          refreshSubmitState();
        });
    });
  }

  function resetForm() {
    formState.brandId = null;
    formState.brandName = '';
    formState.product = null;
    formState.gender = null;
    formState.size = null;
    ac.search = '';
    resetAutocomplete();
    if (brandSelect) { brandSelect.value = ''; }
    if (productInput) { productInput.value = ''; }
    if (genderSelect) { genderSelect.value = ''; }
    if (sizeSelect) { sizeSelect.innerHTML = '<option value="">—</option>'; }
    hide(productField);
    hide(genderField);
    hide(sizeField);
    updateCustomColorHint();
    syncCustomDropdowns();
    refreshSubmitState();
  }

  // ---- requests table ---------------------------------------------

  function deepLinkId() {
    try {
      return new URLSearchParams(window.location.search).get('er_id');
    } catch (e) {
      return null;
    }
  }

  function loadRequests() {
    if (!rowsEl || !REQUESTS_URL) { return; }
    show(loaderEl);
    hide(emptyEl);
    hide(errorEl);

    jsonGet(REQUESTS_URL)
      .then(function (res) {
        var data = (res && res.data) || [];
        renderRows(data);
        hide(loaderEl);
        if (!data.length) { show(emptyEl); }
        handleDeepLink(data);
      })
      .catch(function (e) {
        console.warn('aico-exchange: requests load failed', e);
        hide(loaderEl);
        show(errorEl);
      });
  }

  function renderRows(rows) {
    rowsEl.innerHTML = '';
    var prevBrand = null;

    rows.forEach(function (row) {
      var tr = document.createElement('tr');
      tr.className = 'aico-exchange-row';
      tr.setAttribute('data-aico-exchange-row-id', String(row.id));
      if (prevBrand !== null && prevBrand !== row.brand) {
        tr.classList.add('aico-exchange-row--brand-change');
      }
      prevBrand = row.brand;

      tr.appendChild(brandCell(row.brand || ''));
      tr.appendChild(cell(row.product || ''));
      tr.appendChild(cell(t('gender.' + row.gender, row.gender || '')));
      tr.appendChild(cell(row.size || row.size_eu || ''));
      tr.appendChild(flagCell(row.country_code));
      tr.appendChild(actionCell(row));

      rowsEl.appendChild(tr);
    });
  }

  function cell(text) {
    var td = document.createElement('td');
    td.textContent = text;
    return td;
  }

  // Brand cell: small square logo (when known) + brand name.
  function brandCell(name) {
    var td = document.createElement('td');
    var wrap = document.createElement('span');
    wrap.className = 'aico-exchange-brand';
    var logo = brandLogoFor(name);
    if (logo) {
      var img = document.createElement('img');
      img.className = 'aico-exchange-brand-logo';
      img.src = logo;
      img.alt = '';
      img.width = 20;
      img.height = 20;
      img.loading = 'lazy';
      wrap.appendChild(img);
    }
    var label = document.createElement('span');
    label.className = 'aico-exchange-brand-name';
    label.textContent = name;
    wrap.appendChild(label);
    td.appendChild(wrap);
    return td;
  }

  function flagCell(code) {
    var td = document.createElement('td');
    if (code) {
      var img = document.createElement('img');
      img.className = 'aico-exchange-flag';
      img.src = 'https://flagcdn.com/w40/' + String(code).toLowerCase() + '.png';
      img.alt = code;
      img.loading = 'lazy';
      img.width = 32;
      img.height = 24;
      td.appendChild(img);
    }
    return td;
  }

  // 3-way row state machine (b2b-shop ExchangePlatformTable): accepted →
  // non-interactive "Accepted"; else acceptable → "Accept request"; else
  // (yours) → "Delete".
  function actionCell(row) {
    var td = document.createElement('td');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'aico-exchange-action';

    if (row.is_accepted) {
      btn.classList.add('aico-exchange-action--accepted');
      btn.setAttribute('data-aico-exchange-action', 'accepted');
      setActionContent(btn, t('table.accepted', 'Accepted'), ICON_CHECK);
      btn.disabled = true;
    } else if (row.can_be_accepted) {
      btn.classList.add('aico-exchange-action--accept');
      btn.setAttribute('data-aico-exchange-action', 'accept');
      setActionContent(btn, t('table.accept', 'Accept request'), ICON_HANDSHAKE);
      btn.addEventListener('click', function () { acceptRow(row.id, btn); });
    } else {
      btn.classList.add('aico-exchange-action--delete');
      btn.setAttribute('data-aico-exchange-action', 'delete');
      setActionContent(btn, t('table.delete', 'Delete'), ICON_TRASH);
      btn.addEventListener('click', function () { deleteRow(row.id, btn); });
    }

    td.appendChild(btn);
    return td;
  }

  // Action button content: text label on the left, icon on the right (matches
  // the legacy b2b-shop ACCEPT REQUEST / DELETE buttons).
  function setActionContent(btn, label, iconSvg) {
    var span = document.createElement('span');
    span.className = 'aico-exchange-action-label';
    span.textContent = label;
    btn.innerHTML = '';
    btn.appendChild(span);
    btn.insertAdjacentHTML('beforeend', iconSvg);
  }

  function acceptRow(id, btn) {
    if (btn) { btn.disabled = true; }
    jsonSend(substituteId(ACCEPT_URL_TEMPLATE, id), 'POST', {})
      .then(function () { loadRequests(); })
      .catch(function () {
        if (btn) { btn.disabled = false; }
        toast(t('error', 'Something went wrong. Please try again.'));
      });
  }

  function deleteRow(id, btn) {
    if (btn) { btn.disabled = true; }
    jsonSend(substituteId(DELETE_URL_TEMPLATE, id), 'DELETE', {})
      .then(function () { loadRequests(); })
      .catch(function () {
        if (btn) { btn.disabled = false; }
        toast(t('error', 'Something went wrong. Please try again.'));
      });
  }

  function handleDeepLink(rows) {
    var id = deepLinkId();
    if (!id) { return; }

    var rowEl = rowsEl.querySelector('[data-aico-exchange-row-id="' + cssEscape(id) + '"]');
    if (rowEl) {
      window.setTimeout(function () {
        rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
      rowEl.classList.add('aico-exchange-row--highlight');
      window.setTimeout(function () {
        rowEl.classList.remove('aico-exchange-row--highlight');
      }, 8000);
    } else if (!deepLinkHandled) {
      // The deep-linked request is gone (accepted/withdrawn/expired).
      toast(t('table.request_not_found', 'The request you are looking for is no longer available'));
    }
    deepLinkHandled = true;
  }

  function cssEscape(value) {
    if (window.CSS && window.CSS.escape) { return window.CSS.escape(value); }
    return String(value).replace(/["\\]/g, '\\$&');
  }

  // ---- custom dropdowns -------------------------------------------
  //
  // Replace the bare native <select>s (brand / gender / size) with a styled
  // dropdown that has an opening animation, while keeping the native element
  // (visually hidden) as the source of truth so all the existing value/change
  // logic keeps working unchanged. Options are read live from the native
  // select, so async-populated brands/sizes just work.

  function enhanceSelect(select) {
    if (!select || select.dataset.enhanced === '1') { return; }
    select.dataset.enhanced = '1';

    var wrap = document.createElement('div');
    wrap.className = 'aico-exchange-dd';
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);
    select.classList.add('aico-exchange-dd-native');

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'aico-exchange-dd-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    if (select.getAttribute('aria-label')) {
      trigger.setAttribute('aria-label', select.getAttribute('aria-label'));
    }
    var labelEl = document.createElement('span');
    labelEl.className = 'aico-exchange-dd-label';
    trigger.appendChild(labelEl);
    var caret = document.createElement('span');
    caret.className = 'aico-exchange-dd-caret';
    caret.setAttribute('aria-hidden', 'true');
    trigger.appendChild(caret);
    wrap.appendChild(trigger);

    var panel = document.createElement('ul');
    panel.className = 'aico-exchange-dd-panel';
    panel.setAttribute('role', 'listbox');
    wrap.appendChild(panel);

    function syncLabel() {
      var opt = select.options[select.selectedIndex];
      labelEl.textContent = opt ? opt.textContent : '';
      if (select.value) { wrap.classList.remove('is-placeholder'); }
      else { wrap.classList.add('is-placeholder'); }
    }

    function buildPanel() {
      panel.innerHTML = '';
      Array.prototype.forEach.call(select.options, function (opt) {
        if (opt.value === '' || opt.disabled) { return; } // skip the placeholder
        var li = document.createElement('li');
        li.className = 'aico-exchange-dd-option';
        li.setAttribute('role', 'option');
        li.textContent = opt.textContent;
        if (opt.value === select.value) { li.classList.add('is-selected'); }
        li.addEventListener('mousedown', function (ev) {
          ev.preventDefault();
          select.value = opt.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          syncLabel();
          close();
        });
        panel.appendChild(li);
      });
    }

    function open() { buildPanel(); wrap.classList.add('is-open'); trigger.setAttribute('aria-expanded', 'true'); }
    function close() { wrap.classList.remove('is-open'); trigger.setAttribute('aria-expanded', 'false'); }

    trigger.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (wrap.classList.contains('is-open')) { close(); } else { open(); }
    });
    document.addEventListener('click', function (ev) { if (!wrap.contains(ev.target)) { close(); } });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { close(); } });

    // Rebuild the open panel + label when options change (async brand/size load
    // and the size reset that rewrites the option list).
    new MutationObserver(function () {
      syncLabel();
      if (wrap.classList.contains('is-open')) { buildPanel(); }
    }).observe(select, { childList: true });
    select.addEventListener('change', syncLabel);

    // Programmatic value resets (brand change / form reset) don't fire `change`,
    // so expose a manual sync the form logic can call.
    select._aicoSync = syncLabel;
    syncLabel();
  }

  function syncCustomDropdowns() {
    [brandSelect, genderSelect, sizeSelect].forEach(function (s) {
      if (s && typeof s._aicoSync === 'function') { s._aicoSync(); }
    });
  }

  // ---- init -------------------------------------------------------

  enhanceSelect(brandSelect);
  enhanceSelect(genderSelect);
  enhanceSelect(sizeSelect);

  loadBrands();
  loadRequests();
})();
