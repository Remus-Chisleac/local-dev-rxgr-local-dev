/**
 * Preorder landing: countdown timer, filter persistence, custom selects.
 */
(function () {
  'use strict';

  function readStored(storageKey) {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || '{}');
    } catch (_) {
      return {};
    }
  }

  function writeStored(storageKey, patch) {
    try {
      var current = readStored(storageKey);
      Object.keys(patch).forEach(function (key) {
        if (patch[key] === null || patch[key] === '') {
          delete current[key];
        } else {
          current[key] = patch[key];
        }
      });
      localStorage.setItem(storageKey, JSON.stringify(current));
    } catch (_) {}
  }

  function persist(contextUrl, tokenInput, storageKey, patch) {
    writeStored(storageKey, patch);
    if (!contextUrl || !tokenInput || !tokenInput.value) return;
    var body = new FormData();
    body.append('_token', tokenInput.value);
    Object.keys(patch).forEach(function (key) {
      if (payloadHasValue(patch[key])) {
        body.append(key, patch[key]);
      }
    });
    try {
      fetch(contextUrl, {
        method: 'POST',
        body: body,
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      }).catch(function () {});
    } catch (_) {}
  }

  function payloadHasValue(value) {
    return value !== null && value !== undefined && value !== '';
  }

  function padTwo(value) {
    return value < 10 ? '0' + value : '' + value;
  }

  function countdownText(unit, value) {
    if (unit === 'days') {
      return '' + value;
    }
    return padTwo(value);
  }

  function syncCustomSelect(wrapper) {
    var native = wrapper.querySelector('select.aico-preorder-select-native');
    var labelEl = wrapper.querySelector('[data-aico-custom-select-label]');
    var trigger = wrapper.querySelector('[data-aico-custom-select-trigger]');
    if (!native || !labelEl || !trigger) return;
    var option = native.options[native.selectedIndex];
    labelEl.textContent = option ? option.textContent.trim() : '';
    trigger.disabled = native.disabled;
    trigger.setAttribute(
      'aria-invalid',
      native.required && !native.value ? 'true' : 'false',
    );
  }

  function closeDropdown(wrapper) {
    var panel = wrapper.querySelector('[data-aico-custom-select-dropdown]');
    var trigger = wrapper.querySelector('[data-aico-custom-select-trigger]');
    if (panel) panel.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    wrapper.classList.remove('aico-preorder-custom-select-open');
  }

  function populateList(wrapper, native) {
    var list = wrapper.querySelector('[data-aico-custom-select-list]');
    if (!list) return;
    list.innerHTML = '';
    Array.prototype.forEach.call(native.options, function (opt, index) {
      var row = document.createElement('button');
      row.type = 'button';
      row.setAttribute('role', 'option');
      row.dataset.value = opt.value;
      row.className = 'aico-preorder-custom-select-option';
      row.textContent = opt.textContent;
      row.disabled = opt.disabled;
      row.setAttribute(
        'aria-selected',
        native.selectedIndex === index ? 'true' : 'false',
      );
      row.addEventListener('click', function (event) {
        event.preventDefault();
        if (opt.value !== native.value) {
          native.value = opt.value;
          native.dispatchEvent(new Event('change', { bubbles: true }));
        }
        closeDropdown(wrapper);
        syncCustomSelect(wrapper);
      });
      list.appendChild(row);
    });
  }

  function openDropdown(wrapper) {
    var native = wrapper.querySelector('select.aico-preorder-select-native');
    var trigger = wrapper.querySelector('[data-aico-custom-select-trigger]');
    var panel = wrapper.querySelector('[data-aico-custom-select-dropdown]');
    if (!native || !trigger || !panel) return;
    document
      .querySelectorAll('[data-aico-custom-select].aico-preorder-custom-select-open')
      .forEach(function (other) {
        if (other !== wrapper) closeDropdown(other);
      });
    populateList(wrapper, native);
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    wrapper.classList.add('aico-preorder-custom-select-open');
  }

  function initCustomSelect(root) {
    var wrappers = root.querySelectorAll('[data-aico-custom-select]');
    wrappers.forEach(function (wrapper) {
      if (wrapper.dataset.aicoPreorderCustomSelectInit === '1') return;
      wrapper.dataset.aicoPreorderCustomSelectInit = '1';
      var native = wrapper.querySelector('select.aico-preorder-select-native');
      var trigger = wrapper.querySelector('[data-aico-custom-select-trigger]');
      if (!native || !trigger) return;

      syncCustomSelect(wrapper);

      native.addEventListener('change', function () {
        syncCustomSelect(wrapper);
      });

      trigger.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (native.disabled) return;
        var isOpen = wrapper.classList.contains('aico-preorder-custom-select-open');
        if (isOpen) {
          closeDropdown(wrapper);
        } else {
          openDropdown(wrapper);
        }
      });
    });

    if (!document.documentElement.dataset.aicoPreorderGlobalCloseBound) {
      document.documentElement.dataset.aicoPreorderGlobalCloseBound = '1';
      document.addEventListener(
        'click',
        function () {
          document
            .querySelectorAll('[data-aico-custom-select].aico-preorder-custom-select-open')
            .forEach(closeDropdown);
        },
        false,
      );
      document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape') return;
        document
          .querySelectorAll('[data-aico-custom-select].aico-preorder-custom-select-open')
          .forEach(closeDropdown);
      });
    }
  }

  function refreshCustomSelectLabels(root) {
    root.querySelectorAll('[data-aico-custom-select]').forEach(syncCustomSelect);
  }

  function initPreorderPage() {
    var root = document.querySelector('[data-aico-preorder]');
    if (!root) return;

    function intAttr(element, name) {
      var raw = parseInt(element.getAttribute(name) || '0', 10);
      return isFinite(raw) ? raw : 0;
    }

    var serverDeadline = root.getAttribute('data-aico-preorder-deadline');
    var deadlineMs;
    if (serverDeadline) {
      deadlineMs = Date.parse(serverDeadline);
    } else {
      var sessionKey = 'aico_preorder_mock_deadline';
      var storedDeadline = NaN;
      try {
        var rawDeadline = sessionStorage.getItem(sessionKey);
        storedDeadline = rawDeadline ? parseInt(rawDeadline, 10) : NaN;
      } catch (_) {}

      if (!isFinite(storedDeadline) || storedDeadline <= Date.now()) {
        var offsetMs =
          intAttr(root, 'data-aico-preorder-mock-weeks') * 7 * 86400000 +
          intAttr(root, 'data-aico-preorder-mock-days') * 86400000 +
          intAttr(root, 'data-aico-preorder-mock-hours') * 3600000 +
          intAttr(root, 'data-aico-preorder-mock-minutes') * 60000 +
          intAttr(root, 'data-aico-preorder-mock-seconds') * 1000;
        deadlineMs = Date.now() + offsetMs;
        try {
          sessionStorage.setItem(sessionKey, String(deadlineMs));
        } catch (_) {}
      } else {
        deadlineMs = storedDeadline;
      }
    }

    var slots = {
      days: root.querySelector('[data-aico-countdown-days]'),
      hours: root.querySelector('[data-aico-countdown-hours]'),
      minutes: root.querySelector('[data-aico-countdown-minutes]'),
      seconds: root.querySelector('[data-aico-countdown-seconds]'),
    };

    function tick() {
      if (!slots.days || !slots.hours || !slots.minutes || !slots.seconds) return;
      if (!isFinite(deadlineMs)) {
        slots.days.textContent = '--';
        slots.hours.textContent = '--';
        slots.minutes.textContent = '--';
        slots.seconds.textContent = '--';
        return;
      }
      var remaining = Math.max(0, deadlineMs - Date.now());
      var totalSeconds = Math.floor(remaining / 1000);
      var days = Math.floor(totalSeconds / 86400);
      var hours = Math.floor((totalSeconds % 86400) / 3600);
      var minutes = Math.floor((totalSeconds % 3600) / 60);
      var seconds = totalSeconds % 60;
      slots.days.textContent = countdownText('days', days);
      slots.hours.textContent = countdownText('hours', hours);
      slots.minutes.textContent = countdownText('minutes', minutes);
      slots.seconds.textContent = countdownText('seconds', seconds);
    }

    tick();
    if (isFinite(deadlineMs)) {
      setInterval(tick, 1000);
    }

    var userId = root.getAttribute('data-aico-preorder-user-id') || 'anon';
    var contextUrl = root.getAttribute('data-aico-preorder-context-url');
    var storageKey = 'aico_preorder_context:' + userId;
    var SKIP_STORED_KEYS = {
      debtor_id: true,
      billing_address_id: true,
      delivery_address_id: true,
    };

    function applyStoredSelections() {
      var stored = readStored(storageKey);
      Object.keys(stored).forEach(function (key) {
        if (SKIP_STORED_KEYS[key]) return;
        var select = root.querySelector('[data-aico-preorder-select="' + key + '"]');
        if (select && stored[key] !== null && stored[key] !== undefined) {
          var matched = Array.prototype.some.call(select.options, function (opt) {
            return String(opt.value) === String(stored[key]);
          });
          if (matched) {
            select.value = String(stored[key]);
          }
        }
      });
      ['billing_address_id', 'delivery_address_id'].forEach(function (key) {
        var select = root.querySelector('[data-aico-preorder-select="' + key + '"]');
        if (select) select.value = '';
      });
      refreshCustomSelectLabels(root);
    }

    function applyDefaultAddresses() {
      ['billing_address_id', 'delivery_address_id'].forEach(function (key) {
        var select = root.querySelector('[data-aico-preorder-select="' + key + '"]');
        if (!select || select.value || select.disabled) return;
        if (select.options.length > 1) {
          select.value = select.options[1].value;
        }
      });
      refreshCustomSelectLabels(root);
    }

    applyStoredSelections();
    applyDefaultAddresses();
    initCustomSelect(root);

    var form = root.querySelector('[data-aico-preorder-filters]');
    var tokenInput = form ? form.querySelector('input[name="_token"]') : null;

    var selects = root.querySelectorAll('[data-aico-preorder-select]');
    selects.forEach(function (select) {
      select.addEventListener('change', function () {
        var attributeKey = select.getAttribute('data-aico-preorder-select');
        if (!attributeKey) return;
        var delta = {};
        delta[attributeKey] = select.value;
        persist(contextUrl, tokenInput, storageKey, delta);
      });
    });

    if (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
      });
    }

    var viewStorageKey = 'aico_preorder_view:' + userId;
    var viewButtons = root.querySelectorAll('[data-aico-preorder-view]');
    function applyViewMode(value) {
      viewButtons.forEach(function (button) {
        var pressed = button.getAttribute('data-aico-preorder-view') === value;
        button.classList.toggle('aico-preorder-view-button-active', pressed);
        button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      });
      root.setAttribute('data-aico-preorder-view-mode', value);
    }

    var initialView = 'grid';
    try {
      initialView = localStorage.getItem(viewStorageKey) || 'grid';
    } catch (_) {}

    applyViewMode(initialView);

    viewButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        var next = button.getAttribute('data-aico-preorder-view');
        if (!next) return;
        try {
          localStorage.setItem(viewStorageKey, next);
        } catch (_) {}
        applyViewMode(next);
      });
    });

    setupPreorderWorkflow(root, {
      storageKey: storageKey,
      contextUrl: contextUrl,
      tokenInput: tokenInput,
      applyViewMode: applyViewMode,
    });
  }

  function getSelectValue(root, name) {
    var select = root.querySelector('[data-aico-preorder-select="' + name + '"]');
    return select && select.value ? select.value : '';
  }

  function getSelectLabel(root, name) {
    var select = root.querySelector('[data-aico-preorder-select="' + name + '"]');
    if (!select || !select.value) return '';
    var opt = select.options[select.selectedIndex];
    return opt ? opt.textContent.trim() : '';
  }

  function sameDateLabel(a, b) {
    try {
      return new Date(a).toDateString() === new Date(b).toDateString();
    } catch (_) {
      return String(a).indexOf(String(b)) >= 0 || String(b).indexOf(String(a)) >= 0;
    }
  }

  function formatMoney(amount, currency, exclVat) {
    var cur = currency || 'CHF';
    var value = (amount || 0).toFixed(2) + ' ' + cur;
    return exclVat ? value + ' ' + exclVat : value;
  }

  function setupPreorderWorkflow(root, opts) {
    if (!window.AicoPreorderCatalog) return;

    var sessionData = null;
    var selectedDates = [];
    var catalog = null;
    var cartCtrl = null;
    var isManager = root.getAttribute('data-aico-preorder-is-manager') === '1';
    var cartEnabled = root.getAttribute('data-aico-preorder-enable-cart') === '1';
    var defaultDebtorId =
      root.getAttribute('data-aico-preorder-selected-debtor-id') || '';
    var mainEl = root.querySelector('[data-aico-preorder-main]');
    var checkoutEl = root.querySelector('[data-aico-preorder-checkout]');
    var catalogToolsEl = root.querySelector('[data-aico-preorder-catalog-tools]');
    var promptEl = root.querySelector('[data-aico-preorder-prompt]');
    var promptTitleEl = promptEl ? promptEl.querySelector('.aico-preorder-prompt-title') : null;
    var addressesUrl = root.getAttribute('data-aico-preorder-addresses-url');
    var contextUrl = opts.contextUrl;
    var tokenInput = opts.tokenInput;
    var storageKey = opts.storageKey;
    var loadingEl = root.querySelector('[data-aico-preorder-loading]');
    var errorEl = root.querySelector('[data-aico-preorder-error]');
    var loadMoreEl = root.querySelector('[data-aico-preorder-load-more]');
    var catalogEl = root.querySelector('[data-aico-preorder-catalog]');
    var dateFilterEl = root.querySelector('[data-aico-preorder-date-filter]');
    var dateChipsEl = root.querySelector('[data-aico-preorder-date-chips]');
    var saveBtn = root.querySelector('[data-aico-preorder-save]');
    var submitBtn = root.querySelector('[data-aico-preorder-submit]');
    var summaryLines = root.querySelector('[data-aico-preorder-summary-lines]');
    var summaryTotal = root.querySelector('[data-aico-preorder-summary-total]');
    var summarySubtotalRow = root.querySelector('[data-aico-preorder-summary-subtotal-row]');
    var summaryDiscountRow = root.querySelector('[data-aico-preorder-summary-discount-row]');
    var summaryBilling = root.querySelector('[data-aico-preorder-summary-billing]');
    var summaryDelivery = root.querySelector('[data-aico-preorder-summary-delivery]');
    var summaryStatus = root.querySelector('[data-aico-preorder-summary-status]');
    var searchInput = root.querySelector('[data-aico-preorder-search]');
    var termsCheckbox = root.querySelector('[data-aico-preorder-terms]');
    var notesEl = root.querySelector('[data-aico-preorder-notes]');
    var hasDirty = false;
    var catalogReloadTimer = null;

    function scheduleCatalogReload() {
      if (!catalog) return;
      clearTimeout(catalogReloadTimer);
      catalogReloadTimer = setTimeout(function () {
        catalog.reload();
      }, 0);
    }

    function buyerId() {
      return getSelectValue(root, 'delivery_address_id') || null;
    }
    function billingId() {
      return getSelectValue(root, 'billing_address_id') || null;
    }
    function sizeRegion() {
      return getSelectValue(root, 'size_region') || 'EU';
    }

    function debtorId() {
      return defaultDebtorId || null;
    }

    function shouldSkipProducts() {
      if (isManager && (!debtorId() || !buyerId())) {
        return true;
      }
      return false;
    }

    function addressesReady() {
      return !!billingId() && !!buyerId();
    }

    function getTotalCartQty() {
      var total = 0;
      if (window.AicoPreorderStock && catalog && catalog.products) {
        catalog.products.forEach(function (group) {
          group.items.forEach(function (p) {
            total += window.AicoPreorderStock.getTotalPerProduct(p.id) || 0;
          });
        });
        if (total > 0) return total;
      }
      if (!cartCtrl || !cartCtrl.localCart) return 0;
      cartCtrl.localCart.preorderItemLists.forEach(function (list) {
        list.preorderItems.forEach(function (it) {
          total += it.quantity || 0;
        });
      });
      return total;
    }

    function updatePrompt() {
      if (!promptEl || !promptTitleEl) return;
      var msg =
        root.getAttribute('data-aico-preorder-copy-select-addresses') ||
        'Select billing and delivery addresses';
      promptTitleEl.textContent = msg;
      promptEl.hidden = addressesReady();
    }

    function updateCheckoutVisibility() {
      if (!checkoutEl) return;
      checkoutEl.hidden =
        !cartEnabled || !addressesReady() || getTotalCartQty() <= 0;
    }

    function clearCatalog() {
      if (catalog) {
        catalog.products = [];
        catalog.preorderDates = [];
        if (catalog.catalogEl) catalog.catalogEl.innerHTML = '';
        catalog.showError(false);
        catalog.showLoading(false);
      }
      if (errorEl) errorEl.hidden = true;
      if (loadingEl) loadingEl.hidden = true;
    }

    function updateFlowState() {
      var addressesOk = addressesReady();
      var productsOk = !shouldSkipProducts();
      updatePrompt();
      if (catalogToolsEl) catalogToolsEl.hidden = !addressesOk;
      if (mainEl) mainEl.hidden = !addressesOk;
      updateCheckoutVisibility();
      if (!productsOk) {
        clearCatalog();
      } else {
        scheduleCatalogReload();
      }
      if (addressesOk && cartEnabled && cartCtrl) {
        cartCtrl.fetchCart().catch(function () {});
      }
    }

    function repopulateAddressSelect(name, rows) {
      var select = root.querySelector('[data-aico-preorder-select="' + name + '"]');
      if (!select) return;
      var placeholder =
        select.getAttribute('data-placeholder') || select.dataset.placeholder || '';
      select.innerHTML = '';
      var empty = document.createElement('option');
      empty.value = '';
      empty.textContent = placeholder;
      select.appendChild(empty);
      (rows || []).forEach(function (row) {
        var opt = document.createElement('option');
        opt.value = String(row.id);
        opt.textContent = row.label || '';
        select.appendChild(opt);
      });
      select.value = '';
      select.disabled = !rows || !rows.length;
      var wrapper = select.closest('[data-aico-custom-select]');
      if (wrapper) {
        var trigger = wrapper.querySelector('[data-aico-custom-select-trigger]');
        if (trigger) trigger.disabled = select.disabled;
        populateList(wrapper, select);
        syncCustomSelect(wrapper);
      }
    }

    function reloadAddresses(debtorIdValue) {
      if (!addressesUrl) return Promise.resolve();
      var url = new URL(addressesUrl, window.location.origin);
      if (debtorIdValue) url.searchParams.set('debtor_id', String(debtorIdValue));
      return fetch(url.toString(), {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
        .then(function (res) {
          return res.json();
        })
        .then(function (json) {
          var data = json.data || {};
          repopulateAddressSelect('billing_address_id', data.billingAddresses);
          repopulateAddressSelect('delivery_address_id', data.deliveryAddresses);
          updateFlowState();
        })
        .catch(function () {});
    }

    function renderDateChips(dates) {
      if (!dateChipsEl || !dateFilterEl) return;
      if (!dates || !dates.length) {
        dateFilterEl.hidden = true;
        return;
      }
      dateFilterEl.hidden = false;
      if (!selectedDates.length) selectedDates = dates.slice();
      dateChipsEl.innerHTML = '';
      dates.forEach(function (date) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'aico-preorder-date-chip';
        btn.textContent = date;
        var active = selectedDates.indexOf(date) >= 0;
        if (active) btn.classList.add('aico-preorder-date-chip-active');
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        btn.addEventListener('click', function () {
          var idx = selectedDates.indexOf(date);
          if (idx >= 0) {
            if (selectedDates.length > 1) selectedDates.splice(idx, 1);
          } else {
            selectedDates.push(date);
          }
          renderDateChips(dates);
          if (catalog) catalog.render();
        });
        dateChipsEl.appendChild(btn);
      });
    }

    function getQtyForDate(dateLabel) {
      var total = 0;
      if (window.AicoPreorderStock && catalog && catalog.products) {
        catalog.products.forEach(function (group) {
          group.items.forEach(function (p) {
            total += window.AicoPreorderStock.getRowTotal(p.id, dateLabel) || 0;
          });
        });
        if (total > 0) return total;
      }
      if (!cartCtrl || !cartCtrl.localCart) return 0;
      cartCtrl.localCart.preorderItemLists.forEach(function (list) {
        if (!sameDateLabel(list.preorderDate, dateLabel)) return;
        list.preorderItems.forEach(function (it) {
          total += it.quantity || 0;
        });
      });
      return total;
    }

    function getPriceForDate(dateLabel) {
      var total = 0;
      if (!cartCtrl || !cartCtrl.localCart) return 0;
      cartCtrl.localCart.preorderItemLists.forEach(function (list) {
        if (!sameDateLabel(list.preorderDate, dateLabel)) return;
        list.preorderItems.forEach(function (it) {
          total += (it.itemPrice || 0) * (it.quantity || 0);
        });
      });
      return total;
    }

    function getCurrency() {
      if (cartCtrl && cartCtrl.serverCart && cartCtrl.serverCart.currency) {
        return cartCtrl.serverCart.currency;
      }
      if (sessionData && sessionData.currency) return sessionData.currency;
      return 'CHF';
    }

    function updateSummary() {
      if (summaryBilling) {
        summaryBilling.textContent =
          getSelectLabel(root, 'billing_address_id') || '—';
      }
      if (summaryDelivery) {
        summaryDelivery.textContent =
          getSelectLabel(root, 'delivery_address_id') || '—';
      }

      var exclVat =
        root.getAttribute('data-aico-preorder-copy-excl-vat') || 'excl. VAT';
      var pcsLabel = root.getAttribute('data-aico-preorder-copy-pcs') || 'STK';
      var currency = getCurrency();
      var dates = selectedDates.length ? selectedDates : catalog ? catalog.preorderDates : [];
      var subtotal = 0;
      var totalQty = 0;

      if (summaryLines && dates.length) {
        summaryLines.innerHTML = dates
          .map(function (dateLabel) {
            var qty = getQtyForDate(dateLabel);
            var price = getPriceForDate(dateLabel);
            subtotal += price;
            totalQty += qty;
            var disabled = qty <= 0;
            return (
              '<div class="aico-preorder-summary-date-row' +
              (disabled ? ' is-disabled' : '') +
              '">' +
              '<p class="aico-preorder-summary-date-title">' +
              dateLabel +
              '</p>' +
              '<div class="aico-preorder-summary-date-body">' +
              '<span>' +
              (qty > 0
                ? '<strong>' + qty + '</strong> ' + pcsLabel
                : '—') +
              '</span>' +
              '<span>' +
              formatMoney(price, currency, exclVat) +
              '</span>' +
              '</div></div>'
            );
          })
          .join('');
      } else if (summaryLines) {
        summaryLines.innerHTML = '';
      }

      if (!cartCtrl || !cartCtrl.localCart) {
        if (summarySubtotalRow) summarySubtotalRow.innerHTML = '';
        if (summaryDiscountRow) summaryDiscountRow.hidden = true;
        if (summaryTotal) summaryTotal.innerHTML = '';
        return;
      }

      if (subtotal === 0) {
        cartCtrl.localCart.preorderItemLists.forEach(function (list) {
          list.preorderItems.forEach(function (it) {
            subtotal += (it.itemPrice || 0) * (it.quantity || 0);
            totalQty += it.quantity || 0;
          });
        });
      }

      var discounts =
        (sessionData && sessionData.preorderDiscounts) || [];
      var discPct = cartCtrl.getDiscount(discounts, totalQty);
      var discAmount = discPct ? (discPct * subtotal) / 100 : 0;
      var grandTotal = subtotal - discAmount;
      var productsLabel =
        root.getAttribute('data-aico-preorder-copy-subtotal') || 'Subtotal';

      if (summarySubtotalRow) {
        summarySubtotalRow.innerHTML =
          '<span class="aico-preorder-summary-label">' +
          productsLabel +
          '</span>' +
          '<span><span class="aico-preorder-badge">' +
          totalQty +
          '</span>' +
          formatMoney(subtotal, currency, exclVat) +
          '</span>';
      }

      if (summaryDiscountRow) {
        if (discPct > 0) {
          summaryDiscountRow.hidden = false;
          summaryDiscountRow.innerHTML =
            '<span class="aico-preorder-summary-label">' +
            (root.getAttribute('data-aico-preorder-copy-discount') || 'Discount') +
            '</span>' +
            '<span><span class="aico-preorder-badge">' +
            discPct +
            '%</span>' +
            formatMoney(discAmount, currency, exclVat) +
            '</span>';
        } else {
          summaryDiscountRow.hidden = false;
          summaryDiscountRow.innerHTML =
            '<span class="aico-preorder-summary-label">' +
            (root.getAttribute('data-aico-preorder-copy-discount') || 'Discount') +
            '</span>' +
            '<span><span class="aico-preorder-badge">0%</span>' +
            formatMoney(0, currency, exclVat) +
            '</span>';
        }
      }

      if (summaryTotal) {
        summaryTotal.innerHTML =
          '<span>' +
          (root.getAttribute('data-aico-preorder-copy-total') || 'TOTAL AMOUNT') +
          '</span>' +
          '<span><span class="aico-preorder-grand-amount">' +
          formatMoney(grandTotal, currency, '') +
          '</span>' +
          '<span class="aico-preorder-grand-vat">' +
          exclVat +
          '</span></span>';
      }

      var termsOk = !termsCheckbox || termsCheckbox.checked;
      if (saveBtn) saveBtn.disabled = !hasDirty || cartCtrl.saving;
      if (submitBtn) {
        submitBtn.disabled =
          !termsOk || hasDirty || cartCtrl.saving || totalQty <= 0;
      }
      updateCheckoutVisibility();
    }

    function fetchSession() {
      var url = root.getAttribute('data-aico-preorder-session-url');
      if (!url) return Promise.resolve();
      var u = new URL(url, window.location.origin);
      var debtor = debtorId();
      if (debtor) u.searchParams.set('debtor_id', String(debtor));
      var b = buyerId();
      if (b) u.searchParams.set('buyer_address_id', b);
      return fetch(u.toString(), {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
        .then(function (res) {
          return res.json();
        })
        .then(function (json) {
          sessionData = json.data || null;
          renderFlyers(sessionData && sessionData.flyers);
        })
        .catch(function () {});
    }

    function renderFlyers(flyers) {
      var section = root.querySelector('[data-aico-preorder-flyers]');
      var grid = root.querySelector('[data-aico-preorder-flyers-grid]');
      if (!section || !grid || !flyers || !flyers.length) {
        if (section) section.hidden = true;
        return;
      }
      section.hidden = false;
      grid.innerHTML = flyers
        .map(function (f) {
          var title = f.name || f.webName || f.sku || '';
          return (
            '<div class="aico-preorder-flyer-card"><span>' +
            title +
            '</span></div>'
          );
        })
        .join('');
    }

    catalog = new window.AicoPreorderCatalog.CatalogController({
      root: root,
      productsUrl: root.getAttribute('data-aico-preorder-products-url'),
      catalogEl: catalogEl,
      loadingEl: loadingEl,
      errorEl: errorEl,
      loadMoreEl: loadMoreEl,
      getCopy: function () {
        return {
          empty: root.getAttribute('data-aico-preorder-copy-empty'),
          productsHeading: root.getAttribute('data-aico-preorder-copy-products-heading'),
          rowTotal: root.getAttribute('data-aico-preorder-copy-row-total'),
          productTotal: root.getAttribute('data-aico-preorder-copy-product-total'),
          pcs: root.getAttribute('data-aico-preorder-copy-pcs'),
        };
      },
      getBuyerAddressId: buyerId,
      getDebtorId: debtorId,
      shouldSkipProducts: shouldSkipProducts,
      getSelectedDates: function () {
        return selectedDates;
      },
      getSizeRegion: sizeRegion,
      getSession: function () {
        return sessionData || {};
      },
      getCartState: function () {
        return cartEnabled && cartCtrl ? cartCtrl.localCart : null;
      },
      onProductsLoaded: function (products, dates) {
        if (window.AicoPreorderStock) {
          window.AicoPreorderStock.setSizeStockFromProducts(products);
        }
        renderDateChips(dates);
        if (sessionData && cartCtrl && cartCtrl.serverCart) {
          var payloads = [];
          (cartCtrl.serverCart.preorderItemLists || []).forEach(function (list) {
            (list.preorderItems || []).forEach(function (it) {
              payloads.push({
                productId: it.product && it.product.id,
                variantId: it.productVariant && it.productVariant.id,
                quantity: it.quantity,
                date: list.preorderDate,
              });
            });
          });
          payloads.forEach(function (p) {
            if (p.productId && p.variantId) {
              window.AicoPreorderStock.adjustStock(
                p.productId,
                p.variantId,
                p.date,
                p.quantity,
              );
            }
          });
        }
      },
      onQuantityChange: function (productId, variantId, dateLabel, qty, product) {
        if (window.AicoPreorderStock) {
          window.AicoPreorderStock.adjustStock(
            productId,
            variantId,
            dateLabel,
            qty,
          );
        }
        if (cartEnabled && cartCtrl) {
          cartCtrl.updateQuantity(productId, variantId, dateLabel, qty, product);
          updateSummary();
          updateCheckoutVisibility();
        }
      },
    });

    if (searchInput) {
      var searchTimer;
      searchInput.addEventListener('input', function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
          if (catalog) catalog.setSearchQuery(searchInput.value);
        }, 200);
      });
    }

    if (cartEnabled) {
      cartCtrl = new window.AicoPreorderCart.CartController({
        cartUrl: root.getAttribute('data-aico-preorder-cart-url'),
        statusUrl: root.getAttribute('data-aico-preorder-cart-status-url'),
        itemsUrl: root.getAttribute('data-aico-preorder-cart-items-url'),
        submitUrl: root.getAttribute('data-aico-preorder-submit-url'),
        getBuyerAddressId: buyerId,
        getBillingAddressId: billingId,
        getDeliveryAddressId: buyerId,
        getDebtorId: function () {
          return debtorId();
        },
        getPreorderSessionId: function () {
          return (
            (sessionData && sessionData.id) ||
            (cartCtrl.serverCart && cartCtrl.serverCart.preorderSessionId)
          );
        },
        onCartUpdated: function () {
          if (catalog) catalog.render();
          updateSummary();
        },
        onDirtyChange: function (dirty) {
          hasDirty = dirty;
          updateSummary();
        },
      });
    }

    root.querySelectorAll('[data-aico-preorder-select]').forEach(function (select) {
      select.addEventListener('change', function () {
        var key = select.getAttribute('data-aico-preorder-select');
        if (key === 'billing_address_id' || key === 'delivery_address_id') {
          updateFlowState();
          if (addressesReady()) {
            fetchSession().then(function () {
              updateFlowState();
            });
          }
          return;
        }
        if (addressesReady()) {
          fetchSession().catch(function () {});
          if (catalog) catalog.render();
        }
      });
    });

    if (cartEnabled && saveBtn) {
      saveBtn.addEventListener('click', function () {
        summaryStatus.hidden = false;
        summaryStatus.textContent =
          root.getAttribute('data-aico-preorder-copy-saving') || 'Saving…';
        cartCtrl
          .saveCart()
          .then(function () {
            summaryStatus.textContent =
              root.getAttribute('data-aico-preorder-copy-saved') || 'Saved';
            hasDirty = false;
            updateSummary();
          })
          .catch(function () {
            summaryStatus.textContent =
              root.getAttribute('data-aico-preorder-copy-error') || 'Error';
          });
      });
    }

    if (cartEnabled && submitBtn) {
      submitBtn.addEventListener('click', function () {
        cartCtrl
          .submitPreorder(notesEl ? notesEl.value : '')
          .then(function () {
            var thankYou = root.getAttribute('data-aico-preorder-thank-you-url');
            if (thankYou) window.location.href = thankYou;
          })
          .catch(function () {
            summaryStatus.hidden = false;
            summaryStatus.textContent =
              root.getAttribute('data-aico-preorder-copy-error') || 'Error';
          });
      });
    }

    if (termsCheckbox) {
      termsCheckbox.addEventListener('change', updateSummary);
    }

    window.addEventListener('beforeunload', function (event) {
      if (!hasDirty) return;
      event.preventDefault();
      event.returnValue = '';
    });

    fetchSession().then(function () {
      updateFlowState();
    });
    updateFlowState();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPreorderPage);
  } else {
    initPreorderPage();
  }
})();
