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

  function csrfToken() {
    var input = root.querySelector('input[name="_token"]');
    return input ? input.value : '';
  }

  // ---- DOM refs ---------------------------------------------------

  var formEl = root.querySelector('[data-aico-exchange-form]');
  var brandSelect = root.querySelector('[data-aico-exchange-brand]');
  var productField = root.querySelector('[data-aico-exchange-product-field]');
  var productInput = root.querySelector('[data-aico-exchange-product-input]');
  var optionsEl = root.querySelector('[data-aico-exchange-options]');
  var customColorEl = root.querySelector('[data-aico-exchange-custom-color]');
  var genderField = root.querySelector('[data-aico-exchange-gender-field]');
  var genderSelect = root.querySelector('[data-aico-exchange-gender]');
  var sizeField = root.querySelector('[data-aico-exchange-size-field]');
  var sizeSelect = root.querySelector('[data-aico-exchange-size]');
  var submitBtn = root.querySelector('[data-aico-exchange-submit]');

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

        var names = data.map(function (d) { return d.web_name; }).filter(Boolean);
        if (reset || ac.page === 0) {
          ac.options = names;
        } else {
          ac.options = dedupe(ac.options.concat(names));
        }
        renderOptions();
      })
      .catch(function (e) { console.warn('aico-exchange: products load failed', e); })
      .then(function () { ac.fetching = false; });
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
    sizeSelect.innerHTML = '<option value="">—</option>';
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

      tr.appendChild(cell(row.brand || ''));
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
      btn.textContent = t('table.accepted', 'Accepted');
      btn.disabled = true;
    } else if (row.can_be_accepted) {
      btn.classList.add('aico-exchange-action--accept');
      btn.setAttribute('data-aico-exchange-action', 'accept');
      btn.textContent = t('table.accept', 'Accept request');
      btn.addEventListener('click', function () { acceptRow(row.id, btn); });
    } else {
      btn.classList.add('aico-exchange-action--delete');
      btn.setAttribute('data-aico-exchange-action', 'delete');
      btn.textContent = t('table.delete', 'Delete');
      btn.addEventListener('click', function () { deleteRow(row.id, btn); });
    }

    td.appendChild(btn);
    return td;
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

  // ---- init -------------------------------------------------------

  loadBrands();
  loadRequests();
})();
