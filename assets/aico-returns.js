/*
 * aico-returns.js — storefront returns / complaints page.
 *
 * Ports the legacy b2b-shop "Return Center" native forms to the Liquid
 * storefront. Order-agnostic B2B support-request intake with two variants:
 *
 *   - Complaint (default tab): single item, photo uploads, hierarchical
 *     defect taxonomy switched by Type (shoe / mat_or_pillow), Used/Unused
 *     date-of-sale rule, brand-conditional numbers (Joya → production +
 *     factory; kybun/Kandahar → charging/batch), two base64 photos.
 *   - Return: contact/email + N repeatable rows {brand, reason, product,
 *     size, amount} with a live total-amount counter.
 *
 * Config (reasons, defect taxonomy, brands, endpoints, i18n, prefill) is
 * seeded SSR into window.__AICO_RETURNS__ by layout/theme.liquid. Both the
 * product typeahead and the submission hit same-origin `.js` endpoints that
 * delegate in-process to the existing Tasks SupportRequestService.
 */
(function () {
  'use strict';

  var CONFIG = window.__AICO_RETURNS__ || {};
  var I18N = CONFIG.i18n || {};
  var ROUTES = CONFIG.routes || {};
  var BRANDS = Array.isArray(CONFIG.brands) ? CONFIG.brands : [];

  // Brands (by label) that require extra number fields — matches the legacy
  // brandFieldConfig in b2b-shop's ComplaintForm/useFormValidation.js.
  var BRAND_FIELD_CONFIG = {
    Joya: ['productionNumber', 'factoryNumber'],
    kybun: ['batchNumber'],
    Kandahar: ['batchNumber']
  };

  function t(path, fallback) {
    var parts = String(path).split('.');
    var cursor = I18N;
    for (var i = 0; i < parts.length; i++) {
      if (cursor && typeof cursor === 'object' && parts[i] in cursor) {
        cursor = cursor[parts[i]];
      } else {
        return fallback != null ? fallback : path;
      }
    }
    return typeof cursor === 'string' ? cursor : (fallback != null ? fallback : path);
  }

  function csrfToken() {
    return (typeof CONFIG.csrf === 'string' && CONFIG.csrf) ||
      (document.querySelector('[data-aico-returns] input[name="_token"]') || {}).value ||
      '';
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var ctx = this;
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  }

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    }
    if (text != null) { node.textContent = text; }
    return node;
  }

  // ── Reason dropdowns ─────────────────────────────────────────────────────

  function fillReturnReasons(select) {
    if (!select) { return; }
    var reasons = Array.isArray(I18N.return_reasons) ? I18N.return_reasons : [];
    reasons.forEach(function (reason) {
      select.appendChild(el('option', { value: reason }, reason));
    });
  }

  function fillComplaintReasons(select, type) {
    if (!select) { return; }
    // Reset to just the placeholder.
    var placeholder = select.querySelector('option[value=""]');
    select.innerHTML = '';
    if (placeholder) { select.appendChild(placeholder); }
    var taxonomy = (I18N.defect_taxonomy || {})[type] || [];
    taxonomy.forEach(function (group) {
      var optgroup = el('optgroup', { label: group.label || '' });
      (group.options || []).forEach(function (opt) {
        optgroup.appendChild(el('option', { value: opt }, opt));
      });
      select.appendChild(optgroup);
    });
    select.value = '';
  }

  // ── Product autocomplete ─────────────────────────────────────────────────

  function fetchProducts(term) {
    var url = ROUTES.productsUrl;
    if (!url) { return Promise.resolve({ data: [] }); }
    var sep = url.indexOf('?') === -1 ? '?' : '&';
    var full = url + sep +
      'filter[searchTerm]=' + encodeURIComponent(term) +
      '&page[number]=0&page[size]=10';
    return fetch(full, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
    }).then(function (res) {
      if (!res.ok) { throw new Error('products_fetch_failed'); }
      return res.json();
    });
  }

  function populateVariants(sizeSelect, variants) {
    if (!sizeSelect) { return; }
    sizeSelect.innerHTML = '';
    var list = Array.isArray(variants) ? variants : [];
    if (!list.length) {
      sizeSelect.appendChild(el('option', { value: '' }, t('aico_returns.common.size_disabled', '')));
      sizeSelect.disabled = true;
      return;
    }
    sizeSelect.appendChild(el('option', { value: '' }, t('aico_returns.common.select_option', 'Select')));
    list.forEach(function (variant) {
      var label = variant.size != null && variant.size !== '' ? String(variant.size) : String(variant.variantId);
      sizeSelect.appendChild(el('option', { value: variant.variantId }, label));
    });
    sizeSelect.disabled = false;
  }

  function wireAutocomplete(scope) {
    var box = scope.querySelector('[data-aico-returns-autocomplete]');
    if (!box) { return; }
    var input = box.querySelector('[data-aico-returns-field="productSearch"]');
    var hiddenId = box.querySelector('[data-aico-returns-field="productId"]');
    var listEl = box.querySelector('[data-aico-returns-autocomplete-list]');
    var sizeSelect = scope.querySelector('[data-aico-returns-field="variantId"]');

    function closeList() {
      listEl.innerHTML = '';
      listEl.hidden = true;
    }

    function chooseProduct(product) {
      input.value = (product.name || '') + ' (' + (product.sku || '') + ')';
      if (hiddenId) { hiddenId.value = product.productId != null ? product.productId : ''; }
      input.setAttribute('data-selected-sku', product.sku || '');
      populateVariants(sizeSelect, product.variants);
      closeList();
    }

    var runSearch = debounce(function () {
      var term = input.value.trim();
      // Clear any prior selection when the text changes.
      if (hiddenId) { hiddenId.value = ''; }
      if (term.length < 2) { closeList(); return; }
      fetchProducts(term).then(function (body) {
        var rows = (body && body.data) || [];
        listEl.innerHTML = '';
        if (!rows.length) {
          listEl.appendChild(el('li', { class: 'aico-returns-autocomplete-empty' }, t('aico_returns.common.search_no_results', 'No results')));
          listEl.hidden = false;
          return;
        }
        rows.forEach(function (product) {
          var li = el('li', { class: 'aico-returns-autocomplete-option', tabindex: '0' },
            (product.name || '') + ' (' + (product.sku || '') + ')');
          li.addEventListener('mousedown', function (e) { e.preventDefault(); chooseProduct(product); });
          li.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chooseProduct(product); }
          });
          listEl.appendChild(li);
        });
        listEl.hidden = false;
      }).catch(function () { closeList(); });
    }, 500);

    input.addEventListener('input', runSearch);
    input.addEventListener('blur', function () { setTimeout(closeList, 150); });
  }

  // ── Dropzone → base64 ────────────────────────────────────────────────────

  function wireDropzone(zone) {
    var fileInput = zone.querySelector('input[type="file"]');
    var area = zone.querySelector('[data-aico-returns-dropzone-area]');
    var preview = zone.querySelector('[data-aico-returns-dropzone-preview]');
    if (!fileInput || !area) { return; }

    function readFile(file) {
      if (!file) { return; }
      var reader = new FileReader();
      reader.onload = function () {
        var dataUrl = String(reader.result || '');
        fileInput.setAttribute('data-base64', dataUrl);
        fileInput.setAttribute('data-filename', file.name || '');
        if (preview) {
          preview.src = dataUrl;
          preview.hidden = false;
        }
        zone.classList.add('aico-returns-dropzone--filled');
      };
      reader.readAsDataURL(file);
    }

    fileInput.addEventListener('change', function () { readFile(fileInput.files && fileInput.files[0]); });
    ['dragover', 'dragenter'].forEach(function (evt) {
      area.addEventListener(evt, function (e) { e.preventDefault(); area.classList.add('aico-returns-dropzone--over'); });
    });
    ['dragleave', 'drop'].forEach(function (evt) {
      area.addEventListener(evt, function (e) { e.preventDefault(); area.classList.remove('aico-returns-dropzone--over'); });
    });
    area.addEventListener('drop', function (e) {
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      readFile(file);
    });
  }

  // ── Status banner ────────────────────────────────────────────────────────

  function showStatus(root, kind, message) {
    var banner = root.querySelector('[data-aico-returns-status]');
    if (!banner) { return; }
    banner.textContent = message;
    banner.hidden = false;
    banner.className = 'aico-returns-status aico-returns-status--' + kind;
  }

  function clearStatus(root) {
    var banner = root.querySelector('[data-aico-returns-status]');
    if (banner) { banner.hidden = true; banner.textContent = ''; }
  }

  // ── Submit ───────────────────────────────────────────────────────────────

  function submit(root, payload, submitBtn) {
    var url = ROUTES.submitUrl;
    if (!url) { return Promise.reject(new Error('no_submit_url')); }
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.dataset.label = submitBtn.textContent;
      submitBtn.textContent = t('aico_returns.common.submitting', 'Sending…');
    }
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-TOKEN': csrfToken()
      },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) { throw new Error((body && body.error) || 'submit_failed'); }
        return body;
      });
    }).finally(function () {
      if (submitBtn) {
        submitBtn.disabled = false;
        if (submitBtn.dataset.label) { submitBtn.textContent = submitBtn.dataset.label; }
      }
    });
  }

  // ── Complaint panel ──────────────────────────────────────────────────────

  function initComplaint(panel, root) {
    var get = function (name) { return panel.querySelector('[data-aico-returns-field="' + name + '"]'); };
    var typeSelect = get('type');
    var conditionSelect = get('condition');
    var brandSelect = get('brand');
    var reasonSelect = get('returnReason');

    fillComplaintReasons(reasonSelect, typeSelect ? typeSelect.value : 'shoe');
    wireAutocomplete(panel);
    panel.querySelectorAll('[data-aico-returns-dropzone]').forEach(wireDropzone);

    if (typeSelect) {
      typeSelect.addEventListener('change', function () { fillComplaintReasons(reasonSelect, typeSelect.value); });
    }

    function toggleDateOfSale() {
      var unused = t('aico_returns.conditions.unused', 'Unused');
      var show = conditionSelect && conditionSelect.value === unused;
      var field = panel.querySelector('[data-aico-returns-conditional="dateOfSale"]');
      if (field) { field.hidden = !show; }
    }
    if (conditionSelect) { conditionSelect.addEventListener('change', toggleDateOfSale); }
    toggleDateOfSale();

    function toggleBrandFields() {
      var brand = brandSelect ? brandSelect.value : '';
      var active = BRAND_FIELD_CONFIG[brand] || [];
      ['productionNumber', 'factoryNumber', 'batchNumber'].forEach(function (name) {
        var field = panel.querySelector('[data-aico-returns-conditional="' + name + '"]');
        if (field) { field.hidden = active.indexOf(name) === -1; }
      });
    }
    if (brandSelect) { brandSelect.addEventListener('change', toggleBrandFields); }
    toggleBrandFields();

    panel.addEventListener('submit', function (e) {
      e.preventDefault();
      clearStatus(root);
      var errors = validateComplaint(panel, get, conditionSelect, brandSelect);
      if (errors.length) { showStatus(root, 'error', errors[0]); return; }

      var defectInput = get('defectUploadedFile');
      var sideInput = get('sideViewUploadedFile');
      var line = {
        productId: (get('productId') || {}).value || null,
        variantId: (get('variantId') || {}).value || null,
        condition: (conditionSelect || {}).value || null,
        dateOfSale: (get('dateOfSale') || {}).value || null,
        returnReason: (reasonSelect || {}).value || null,
        productionNumber: (get('productionNumber') || {}).value || null,
        factoryNumber: (get('factoryNumber') || {}).value || null,
        batchNumber: (get('batchNumber') || {}).value || null,
        defectUploadedFile: {
          title: defectInput ? defectInput.getAttribute('data-filename') || 'defect' : 'defect',
          imageContent: defectInput ? defectInput.getAttribute('data-base64') || '' : ''
        }
      };
      if (sideInput && sideInput.getAttribute('data-base64')) {
        line.sideViewUploadedFile = {
          title: sideInput.getAttribute('data-filename') || 'side-view',
          imageContent: sideInput.getAttribute('data-base64')
        };
      }

      var payload = {
        supportRequestType: 'Complaint',
        contact: (get('contact') || {}).value || '',
        email: (get('email') || {}).value || '',
        content: [line]
      };

      submit(root, payload, panel.querySelector('[data-aico-returns-submit]')).then(function () {
        showStatus(root, 'success', t('aico_returns.common.success', 'Submitted.'));
        panel.reset();
        fillComplaintReasons(reasonSelect, typeSelect ? typeSelect.value : 'shoe');
        panel.querySelectorAll('[data-aico-returns-dropzone]').forEach(function (z) {
          z.classList.remove('aico-returns-dropzone--filled');
          var p = z.querySelector('[data-aico-returns-dropzone-preview]');
          if (p) { p.hidden = true; p.removeAttribute('src'); }
          var fi = z.querySelector('input[type="file"]');
          if (fi) { fi.removeAttribute('data-base64'); fi.removeAttribute('data-filename'); }
        });
        toggleDateOfSale();
        toggleBrandFields();
      }).catch(function () {
        showStatus(root, 'error', t('aico_returns.common.error', 'Something went wrong.'));
      });
    });
  }

  function validateComplaint(panel, get, conditionSelect, brandSelect) {
    var errors = [];
    var V = I18N.validation || {};
    if (!((get('contact') || {}).value || '').trim()) { errors.push(V.contact || 'Contact required'); }
    if (!((get('email') || {}).value || '').trim()) { errors.push(V.email || 'Email required'); }
    if (!((get('productId') || {}).value || '')) { errors.push(V.product || 'Product required'); }
    if (!((get('variantId') || {}).value || '')) { errors.push(V.size || 'Size required'); }
    if (!((get('returnReason') || {}).value || '')) { errors.push(V.return_reason || 'Reason required'); }
    var unused = t('aico_returns.conditions.unused', 'Unused');
    if (conditionSelect && conditionSelect.value === unused && !((get('dateOfSale') || {}).value || '')) {
      errors.push(V.date_of_sale || 'Sale date required');
    }
    var defectInput = get('defectUploadedFile');
    if (!defectInput || !defectInput.getAttribute('data-base64')) { errors.push(V.defect_image || 'Defect image required'); }
    var sideInput = get('sideViewUploadedFile');
    if (!sideInput || !sideInput.getAttribute('data-base64')) { errors.push(V.side_view_image || 'Side view image required'); }
    var brand = brandSelect ? brandSelect.value : '';
    (BRAND_FIELD_CONFIG[brand] || []).forEach(function (name) {
      if (!((get(name) || {}).value || '').trim()) {
        var key = name === 'productionNumber' ? 'production_number'
          : name === 'factoryNumber' ? 'factory_number' : 'batch_number';
        errors.push(V[key] || (name + ' required'));
      }
    });
    return errors;
  }

  // ── Return panel ─────────────────────────────────────────────────────────

  function initReturn(panel, root) {
    var tpl = panel.querySelector('[data-aico-returns-row-template]');
    var rowsContainer = panel.querySelector('[data-aico-returns-rows]');
    var totalEl = panel.querySelector('[data-aico-returns-total]');
    var addBtn = panel.querySelector('[data-aico-returns-add]');

    function recomputeTotal() {
      var rows = rowsContainer.querySelectorAll('[data-aico-returns-row]');
      var total = 0;
      rows.forEach(function (row) {
        var amount = row.querySelector('[data-aico-returns-field="amount"]');
        total += amount ? (parseInt(amount.value, 10) || 0) : 0;
      });
      if (totalEl) { totalEl.textContent = String(total); }
    }

    function updateDeleteButtons() {
      var rows = rowsContainer.querySelectorAll('[data-aico-returns-row]');
      rows.forEach(function (row) {
        var del = row.querySelector('[data-aico-returns-row-delete]');
        if (del) { del.hidden = rows.length <= 1; }
      });
    }

    function addRow() {
      var clone = tpl.content ? tpl.content.firstElementChild.cloneNode(true)
        : tpl.firstElementChild.cloneNode(true);
      rowsContainer.appendChild(clone);
      fillReturnReasons(clone.querySelector('[data-aico-returns-field="returnReason"]'));
      wireAutocomplete(clone);
      var amount = clone.querySelector('[data-aico-returns-field="amount"]');
      if (amount) { amount.addEventListener('input', recomputeTotal); }
      var del = clone.querySelector('[data-aico-returns-row-delete]');
      if (del) {
        del.addEventListener('click', function () {
          clone.remove();
          updateDeleteButtons();
          recomputeTotal();
        });
      }
      updateDeleteButtons();
      recomputeTotal();
    }

    if (addBtn) { addBtn.addEventListener('click', addRow); }
    addRow(); // start with one row

    panel.addEventListener('submit', function (e) {
      e.preventDefault();
      clearStatus(root);
      var V = I18N.validation || {};
      var contact = (panel.querySelector('[data-aico-returns-field="contact"]') || {}).value || '';
      var email = (panel.querySelector('[data-aico-returns-field="email"]') || {}).value || '';
      var errors = [];
      if (!contact.trim()) { errors.push(V.contact || 'Contact required'); }
      if (!email.trim()) { errors.push(V.email || 'Email required'); }

      var content = [];
      rowsContainer.querySelectorAll('[data-aico-returns-row]').forEach(function (row) {
        var rget = function (name) { return row.querySelector('[data-aico-returns-field="' + name + '"]'); };
        var productId = (rget('productId') || {}).value || '';
        var variantId = (rget('variantId') || {}).value || '';
        var reason = (rget('returnReason') || {}).value || '';
        if (!productId) { errors.push(V.product || 'Product required'); }
        if (!variantId) { errors.push(V.size || 'Size required'); }
        if (!reason) { errors.push(V.return_reason || 'Reason required'); }
        content.push({
          productId: productId || null,
          variantId: variantId || null,
          returnReason: reason || null,
          amount: Math.max(1, parseInt((rget('amount') || {}).value, 10) || 1)
        });
      });

      if (errors.length) { showStatus(root, 'error', errors[0]); return; }

      var payload = {
        supportRequestType: 'Return',
        contact: contact,
        email: email,
        content: content
      };

      submit(root, payload, panel.querySelector('[data-aico-returns-submit]')).then(function () {
        showStatus(root, 'success', t('aico_returns.common.success', 'Submitted.'));
        rowsContainer.innerHTML = '';
        addRow();
      }).catch(function () {
        showStatus(root, 'error', t('aico_returns.common.error', 'Something went wrong.'));
      });
    });
  }

  // ── Tabs ─────────────────────────────────────────────────────────────────

  function initTabs(root) {
    var tabs = root.querySelectorAll('[data-aico-returns-tab]');
    var panels = root.querySelectorAll('[data-aico-returns-panel]');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var name = tab.getAttribute('data-aico-returns-tab');
        tabs.forEach(function (t2) {
          var active = t2 === tab;
          t2.classList.toggle('aico-returns-tab--active', active);
          t2.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        panels.forEach(function (p) {
          p.hidden = p.getAttribute('data-aico-returns-panel') !== name;
        });
        clearStatus(root);
      });
    });
  }

  function init() {
    var root = document.querySelector('[data-aico-returns]');
    if (!root) { return; }
    initTabs(root);
    var complaintPanel = root.querySelector('[data-aico-returns-panel="complaint"]');
    var returnPanel = root.querySelector('[data-aico-returns-panel="return"]');
    if (complaintPanel) { initComplaint(complaintPanel, root); }
    if (returnPanel) { initReturn(returnPanel, root); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
