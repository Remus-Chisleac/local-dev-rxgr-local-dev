/**
 * Preorder landing: countdown timer, filter persistence, custom selects.
 */
(function () {
  'use strict';

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

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
    // "Managed" wrappers (e.g. the multi-select date filter) render their own
    // list; don't overwrite it with the single-select option buttons.
    if (!wrapper.hasAttribute('data-aico-custom-select-managed')) {
      populateList(wrapper, native);
    }
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

    // Real countdown only: the deadline is the active preorder session end
    // date. It's server-rendered into data-aico-preorder-deadline when known,
    // and otherwise filled in on page load from preorder/session.js
    // (updateDeadline). When there is no active preorder session the countdown
    // shows "--" placeholders — there is no hardcoded/mock fallback.
    var serverDeadline = root.getAttribute('data-aico-preorder-deadline');
    var deadlineMs = serverDeadline ? Date.parse(serverDeadline) : NaN;

    var slots = {
      days: root.querySelector('[data-aico-countdown-days]'),
      hours: root.querySelector('[data-aico-countdown-hours]'),
      minutes: root.querySelector('[data-aico-countdown-minutes]'),
      seconds: root.querySelector('[data-aico-countdown-seconds]'),
    };

    function tick() {
      if (!slots.days || !slots.hours || !slots.minutes || !slots.seconds) return;
      // No active session (deadline unknown) → show placeholders.
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

    // Fill in the real countdown once the live session is fetched
    // (preorder/session.js → endDate). Until then the countdown shows "--".
    function updateDeadline(iso) {
      if (!iso) return;
      var ms = Date.parse(iso);
      if (!isFinite(ms)) return;
      deadlineMs = ms;
      tick();
    }

    tick();
    setInterval(tick, 1000);

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
      updateDeadline: updateDeadline,
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
    var currentDebtorId = defaultDebtorId;
    var b2bsUrl = root.getAttribute('data-aico-preorder-b2bs-url');
    var b2bData = [];
    var mainEl = root.querySelector('[data-aico-preorder-main]');
    var checkoutEl = root.querySelector('[data-aico-preorder-checkout]');
    var catalogToolsEl = root.querySelector('[data-aico-preorder-catalog-tools]');
    var promptEl = root.querySelector('[data-aico-preorder-prompt]');
    var promptTitleEl = promptEl ? promptEl.querySelector('.aico-preorder-prompt-title') : null;
    var reopenNoticeEl = root.querySelector('[data-aico-preorder-reopen-notice]');
    var reopenAckBtn = root.querySelector('[data-aico-preorder-reopen-ack]');
    // Already-placed preorder gate: when a submitted preorder exists for the
    // current (debtor, billing, delivery) context, show the notice panel and
    // keep the catalog hidden until the user acknowledges. Reset per context.
    var reopenAcked = false;
    var lastCartContextKey = null;
    var addressesUrl = root.getAttribute('data-aico-preorder-addresses-url');
    var contextUrl = opts.contextUrl;
    var tokenInput = opts.tokenInput;
    var storageKey = opts.storageKey;
    var loadingEl = root.querySelector('[data-aico-preorder-loading]');
    var errorEl = root.querySelector('[data-aico-preorder-error]');
    var loadMoreEl = root.querySelector('[data-aico-preorder-load-more]');
    var catalogEl = root.querySelector('[data-aico-preorder-catalog]');
    var dateSelectEl = root.querySelector('[data-aico-preorder-date-select]');
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
      }, 150);
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
      return currentDebtorId || null;
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
      // Show the checkout/summary as soon as the cart is enabled and both
      // addresses are selected — don't wait for a non-empty cart. The summary
      // just shows zeros until items are added, and the Submit button stays
      // disabled until there's a quantity + accepted terms (see updateSummary).
      // Gating on quantity made the whole bottom section look "missing" before
      // anything was added. Hidden while the reopen notice is pending.
      checkoutEl.hidden = !cartEnabled || !addressesReady() || reopenPending();
    }

    function cartContextKey() {
      return [billingId(), buyerId(), debtorId()].join('|');
    }

    // True when the loaded cart represents an already-placed preorder: the
    // server marked it SUBMITTED, or any line carries a committed quantity
    // (the add-only floor set when a preorder was submitted).
    function cartHasPlacedPreorder() {
      if (!cartCtrl) return false;
      if (cartCtrl.status === 'SUBMITTED') return true;
      var lc = cartCtrl.localCart;
      if (!lc || !lc.preorderItemLists) return false;
      return lc.preorderItemLists.some(function (list) {
        return (list.preorderItems || []).some(function (it) {
          return (it.committedQuantity || 0) > 0;
        });
      });
    }

    function reopenPending() {
      return addressesReady() && !reopenAcked && cartHasPlacedPreorder();
    }

    // Decide catalog vs reopen-notice visibility. While addresses are ready but
    // the cart hasn't resolved yet (cartResolved=false), keep the catalog hidden
    // so we never flash it before discovering a placed preorder.
    function applyReopenVisibility(cartResolved) {
      var addressesOk = addressesReady();
      var pending = reopenPending();
      if (reopenNoticeEl) reopenNoticeEl.hidden = !pending;
      if (mainEl) {
        mainEl.hidden = !addressesOk || pending || (addressesOk && cartEnabled && !cartResolved);
      }
      updateCheckoutVisibility();
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
      // Filter dropdowns (search / dates / size) stay visible from the start;
      // only the product grid waits for addresses.
      if (catalogToolsEl) catalogToolsEl.hidden = false;
      if (!productsOk) {
        clearCatalog();
      } else {
        // Always (pre)load products — even while the reopen notice is up — so
        // the catalog is ready to reveal the instant the user acknowledges.
        scheduleCatalogReload();
      }
      if (addressesOk && cartEnabled && cartCtrl) {
        var key = cartContextKey();
        if (key !== lastCartContextKey) {
          reopenAcked = false;
          lastCartContextKey = key;
        }
        // Hide the catalog until the cart resolves, then re-evaluate the gate.
        applyReopenVisibility(false);
        cartCtrl
          .fetchCart()
          .then(function () { applyReopenVisibility(true); })
          .catch(function () { applyReopenVisibility(true); });
      } else {
        applyReopenVisibility(true);
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

    function setDebtor(value) {
      currentDebtorId = value ? String(value) : '';
      reloadAddresses(currentDebtorId);
    }

    function applyB2bSelection() {
      var b2bId = getSelectValue(root, 'b2b_id');
      var debtorField = root.querySelector('[data-aico-preorder-debtor-field]');
      var match = null;
      for (var i = 0; i < b2bData.length; i++) {
        if (String(b2bData[i].id) === String(b2bId)) {
          match = b2bData[i];
          break;
        }
      }
      var debtors = (match && match.debtors) || [];
      if (debtors.length === 1) {
        if (debtorField) debtorField.hidden = true;
        repopulateAddressSelect('debtor_id', []);
        setDebtor(debtors[0].id);
        return;
      }
      if (debtors.length > 1) {
        repopulateAddressSelect(
          'debtor_id',
          debtors.map(function (d) {
            return { id: d.id, label: d.name };
          }),
        );
        if (debtorField) debtorField.hidden = false;
      } else {
        if (debtorField) debtorField.hidden = true;
        repopulateAddressSelect('debtor_id', []);
      }
      currentDebtorId = '';
      repopulateAddressSelect('billing_address_id', []);
      repopulateAddressSelect('delivery_address_id', []);
      clearCatalog();
      updateFlowState();
    }

    // Mirrors b2b-shop's SortFilterControl: the B2B list comes from the
    // active preorder session and is filtered SERVER-SIDE via
    // `filter[searchTerm]` (same endpoint/service the old shop calls).
    function loadB2bs(searchTerm, keepOpen) {
      if (!isManager || !b2bsUrl) return;
      var url = new URL(b2bsUrl, window.location.origin);
      // Pagination is 0-based (matches b2b-shop's currentPage default of 0):
      // page 0 is the first page; sending 1 skips the first 100 B2Bs and
      // drops single search hits that live on page 0.
      url.searchParams.set('page[number]', '0');
      url.searchParams.set('page[size]', '100');
      if (searchTerm) url.searchParams.set('filter[searchTerm]', searchTerm);
      fetch(url.toString(), {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
        .then(function (res) {
          return res.json();
        })
        .then(function (json) {
          b2bData = (json && json.data) || [];
          repopulateAddressSelect(
            'b2b_id',
            b2bData.map(function (b) {
              return { id: b.id, label: b.company };
            }),
          );
          if (keepOpen) {
            var wrapper = root.querySelector('[data-aico-preorder-b2b-field] [data-aico-custom-select]');
            if (wrapper) {
              wrapper.classList.add('aico-preorder-custom-select-open');
              var panel = wrapper.querySelector('[data-aico-custom-select-dropdown]');
              if (panel) panel.hidden = false;
            }
            var input = root.querySelector('[data-aico-preorder-b2b-search]');
            if (input) input.focus();
          }
        })
        .catch(function () {});
    }

    // Multi-select date filter: "All" + each delivery date as toggleable rows
    // inside the managed dropdown. selectedDates drives the grid + summary.
    function dateAllLabel() {
      return (dateSelectEl && dateSelectEl.options[0] && dateSelectEl.options[0].textContent) || 'All';
    }

    function updateDateLabel(dates) {
      var wrapper = dateSelectEl ? dateSelectEl.closest('[data-aico-custom-select]') : null;
      var label = wrapper ? wrapper.querySelector('[data-aico-custom-select-label]') : null;
      if (!label) return;
      var all = dates || [];
      if (!selectedDates.length || (all.length && selectedDates.length === all.length)) {
        label.textContent = dateAllLabel();
      } else {
        label.textContent = selectedDates.join(', ');
      }
    }

    function renderDateSelect(dates) {
      if (!dateSelectEl) return;
      dates = dates || [];
      // Default: every date selected ("All").
      if (!selectedDates.length && dates.length) selectedDates = dates.slice();
      var wrapper = dateSelectEl.closest('[data-aico-custom-select]');
      var list = wrapper ? wrapper.querySelector('[data-aico-custom-select-list]') : null;
      if (!list) {
        updateDateLabel(dates);
        return;
      }
      var allSelected = dates.length > 0 && selectedDates.length === dates.length;
      function row(value, text, checked) {
        return (
          '<button type="button" role="option" class="aico-preorder-custom-select-option aico-preorder-date-option' +
          (checked ? ' is-checked' : '') +
          '" data-date-value="' + escapeHtml(value) + '" aria-selected="' + (checked ? 'true' : 'false') + '">' +
          '<span class="aico-preorder-date-check" aria-hidden="true"></span>' +
          '<span>' + escapeHtml(text) + '</span></button>'
        );
      }
      var html = row('__all__', dateAllLabel(), allSelected);
      dates.forEach(function (d) {
        html += row(d, d, selectedDates.indexOf(d) >= 0);
      });
      list.innerHTML = html;
      list.querySelectorAll('[data-date-value]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          var val = btn.getAttribute('data-date-value');
          if (val === '__all__') {
            selectedDates = dates.slice();
          } else {
            var idx = selectedDates.indexOf(val);
            if (idx >= 0) {
              if (selectedDates.length > 1) selectedDates.splice(idx, 1);
            } else {
              // Re-add in chronological order: `dates` is already sorted by
              // timestamp, so rederive selectedDates as its selected subset
              // instead of appending (which would drop the date at the end).
              selectedDates.push(val);
              selectedDates = dates.filter(function (d) {
                return selectedDates.indexOf(d) >= 0;
              });
            }
          }
          renderDateSelect(dates);
          if (catalog) catalog.render();
          updateSummary();
        });
      });
      updateDateLabel(dates);
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

    // The cart snapshot carries no prices — compute the per-date total from the
    // catalog's product price × the quantity tracked in the stock module.
    function getPriceForDate(dateLabel) {
      var total = 0;
      var priceOf = window.AicoPreorderCatalog && window.AicoPreorderCatalog.productPrice;
      if (!catalog || !catalog.products || !window.AicoPreorderStock || !priceOf) {
        return 0;
      }
      catalog.products.forEach(function (group) {
        (group.items || []).forEach(function (p) {
          var qty = window.AicoPreorderStock.getRowTotal(p.id, dateLabel) || 0;
          if (qty <= 0) return;
          var price = priceOf(p);
          if (price != null && price >= 0) total += price * qty;
        });
      });
      return total;
    }

    // Seed the stock module from the persisted cart so reopened/edited carts (and
    // writes the server rejected, e.g. the committed-quantity floor) show the
    // authoritative quantities on the product grid. The server returns ISO dates
    // ("2026-08-10") while the grid keys cells by the catalog's human label
    // ("Aug 10, 2026"); normalizeDateKey parses those two forms to different UTC
    // days in timezones ahead of UTC, so map each server date to its catalog label.
    function seedStockFromCart() {
      if (!cartCtrl || !cartCtrl.localCart || !window.AicoPreorderStock) return;
      var catalogDates = (catalog && catalog.preorderDates) || [];
      (cartCtrl.localCart.preorderItemLists || []).forEach(function (list) {
        var label = catalogDates.find(function (d) {
          return sameDateLabel(d, list.preorderDate);
        }) || list.preorderDate;
        (list.preorderItems || []).forEach(function (it) {
          if (it.productId && it.productVariantId) {
            window.AicoPreorderStock.adjustStock(
              it.productId,
              it.productVariantId,
              label,
              it.quantity,
            );
            // Seed the committed floor (the already-confirmed quantity for a
            // reopened/submitted cart) so the cell's decrement is disabled at it,
            // `min` is set to it, and it renders in the committed (gray, no-border)
            // style until the user raises it (6.2 / 2.2).
            if (window.AicoPreorderStock.setCommitted) {
              window.AicoPreorderStock.setCommitted(
                it.productId,
                it.productVariantId,
                label,
                it.committedQuantity,
              );
            }
          }
        });
      });
    }

    function getCurrency() {
      var currencyOf = window.AicoPreorderCatalog && window.AicoPreorderCatalog.productCurrency;
      if (currencyOf && catalog && catalog.products) {
        for (var g = 0; g < catalog.products.length; g++) {
          var items = catalog.products[g].items || [];
          if (items.length) return currencyOf(items[0]);
        }
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

      var discounts =
        (sessionData && sessionData.preorderDiscounts) || [];
      var discPct = cartCtrl ? cartCtrl.getDiscount(discounts, totalQty) : 0;
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

      var saving = cartCtrl && cartCtrl.saving;
      if (submitBtn && !submitBtn.classList.contains('aico-preorder-btn--saving')) {
        // Terms are NOT gated here: the button stays clickable so we can flag the
        // unchecked checkbox on click (see the submit handler) instead of leaving
        // a silently-disabled button. Only an empty cart / in-flight save disable.
        submitBtn.disabled = saving || totalQty <= 0;
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
          if (sessionData && opts.updateDeadline) {
            opts.updateDeadline(sessionData.endDate || sessionData.deadlineAt);
          }
          renderFlyers(sessionData && sessionData.flyers);
        })
        .catch(function () {});
    }

    var PCS_PER_FLYER = 25;
    var flyerQtyLocal = {};
    var flyerDebounceTimers = {};

    function getFlyerCopy() {
      return {
        total:
          root.getAttribute('data-aico-preorder-copy-flyer-total') || 'Total',
        pcs: root.getAttribute('data-aico-preorder-copy-pcs') || 'STK',
      };
    }

    function getFlyerQuantity(flyerId) {
      if (cartEnabled && cartCtrl) {
        return cartCtrl.getFlyerQuantity(flyerId);
      }
      return flyerQtyLocal[flyerId] || 0;
    }

    function setFlyerQuantity(flyerId, quantity) {
      if (cartEnabled && cartCtrl) {
        cartCtrl.updateFlyerQuantity(flyerId, quantity);
        return;
      }
      flyerQtyLocal[flyerId] = quantity;
      renderFlyers(sessionData && sessionData.flyers);
    }

    function updateFlyerCardTotals(card, quantity) {
      var totalEl = card.querySelector('[data-aico-preorder-flyer-total]');
      if (totalEl) {
        var copy = getFlyerCopy();
        totalEl.textContent =
          copy.total + ': ' + PCS_PER_FLYER * quantity + ' ' + copy.pcs;
      }
    }

    function bindFlyerSliders() {
      var grid = root.querySelector('[data-aico-preorder-flyers-grid]');
      if (!grid) return;
      grid.querySelectorAll('[data-aico-preorder-flyer-range]').forEach(function (range) {
        function syncTrack() {
          range.style.setProperty('--flyer-value', String(range.value));
        }
        syncTrack();
        range.addEventListener('input', function () {
          syncTrack();
          var card = range.closest('[data-aico-preorder-flyer-card]');
          var qty = parseInt(range.value, 10) || 0;
          if (card) updateFlyerCardTotals(card, qty);
        });
        range.addEventListener('change', function () {
          var flyerId = parseInt(range.getAttribute('data-flyer-id'), 10);
          var qty = parseInt(range.value, 10) || 0;
          if (flyerDebounceTimers[flyerId]) {
            clearTimeout(flyerDebounceTimers[flyerId]);
          }
          flyerDebounceTimers[flyerId] = setTimeout(function () {
            setFlyerQuantity(flyerId, qty);
          }, 300);
        });
      });
    }

    function renderFlyers(flyers) {
      var section = root.querySelector('[data-aico-preorder-flyers]');
      var grid = root.querySelector('[data-aico-preorder-flyers-grid]');
      if (!section || !grid || !flyers || !flyers.length) {
        if (section) section.hidden = true;
        return;
      }
      var copy = getFlyerCopy();
      section.hidden = false;
      grid.innerHTML = flyers
        .map(function (f) {
          var flyerId = f.id;
          var title = f.title || f.name || f.webName || f.sku || '';
          var sku = f.sku || '';
          var qty = getFlyerQuantity(flyerId);
          var totalPcs = PCS_PER_FLYER * qty;
          var marks = '';
          for (var i = 0; i <= 3; i++) {
            marks += '<span>' + i + '</span>';
          }
          return (
            '<article class="aico-preorder-flyer-card" data-aico-preorder-flyer-card data-flyer-id="' +
            flyerId +
            '">' +
            '<header class="aico-preorder-flyer-card__head">' +
            '<h4 class="aico-preorder-flyer-card__title">' +
            escapeHtml(title) +
            '</h4>' +
            '<p class="aico-preorder-flyer-card__total" data-aico-preorder-flyer-total>' +
            escapeHtml(copy.total + ': ' + totalPcs + ' ' + copy.pcs) +
            '</p>' +
            '</header>' +
            (sku
              ? '<p class="aico-preorder-flyer-card__sku">' + escapeHtml(sku) + '</p>'
              : '') +
            '<div class="aico-preorder-flyer-slider">' +
            '<input type="range" class="aico-preorder-flyer-range" data-aico-preorder-flyer-range data-flyer-id="' +
            flyerId +
            '" min="0" max="3" step="1" value="' +
            qty +
            '" style="--flyer-value:' +
            qty +
            '" aria-label="' +
            escapeHtml(title) +
            '">' +
            '<div class="aico-preorder-flyer-marks">' +
            marks +
            '</div>' +
            '</div></article>'
          );
        })
        .join('');
      bindFlyerSliders();
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
        renderDateSelect(dates);
        seedStockFromCart();
        // Recompute the checkout summary now that this batch's products (and
        // their prices) are in catalog.products — the cart fetch that first ran
        // updateSummary may have fired before the catalog finished loading.
        updateSummary();
      },
      onQuantityChange: function (productId, variantId, dateLabel, qty, product) {
        var session = sessionData || {};
        if (window.AicoPreorderStock) {
          window.AicoPreorderStock.adjustStock(
            productId,
            variantId,
            dateLabel,
            qty,
          );
          if (
            session.isStockRelevant &&
            window.AicoPreorderStock.getQuantity
          ) {
            qty = window.AicoPreorderStock.getQuantity(
              productId,
              variantId,
              dateLabel,
            );
          }
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
        addUrl: root.getAttribute('data-aico-preorder-cart-add-url'),
        changeUrl: root.getAttribute('data-aico-preorder-cart-change-url'),
        clearUrl: root.getAttribute('data-aico-preorder-cart-clear-url'),
        submitUrl: root.getAttribute('data-aico-preorder-cart-submit-url'),
        getDeliveryAddressId: buyerId,
        getDebtorId: function () {
          return debtorId();
        },
        getPreorderSessionId: function () {
          return sessionData && sessionData.id;
        },
        slimWrites: function () {
          // Optimistic (stock-relevant) flow only: ask the server for a slim
          // write response and pull the full cart lazily on idle (see below).
          return !!(sessionData && sessionData.isStockRelevant);
        },
        onCartUpdated: function () {
          // Stock-relevant sessions track quantities client-side and update the
          // grid optimistically, so a routine save echo must NOT rebuild the grid
          // (that is the "waiting for the backend" jank). The grid is reconciled
          // in place once the user goes idle (onDirtyChange). Non-stock sessions
          // have no client-side source of truth, so they still render from cart.
          if (!(sessionData && sessionData.isStockRelevant)) {
            if (catalog) catalog.render();
          }
          renderFlyers(sessionData && sessionData.flyers);
          updateSummary();
        },
        onDirtyChange: function (dirty) {
          hasDirty = dirty;
          // No idle full-cart reconcile. Stock-relevant grids stay optimistic and
          // are corrected per-cell from each write's echoed quantity (see
          // onProductCellSaved below); cart.js now runs only at initial load and
          // during the submit poll.
          updateSummary();
        },
        onProductCellSaved: function (cell, quantity) {
          // The write settled with the server's authoritative quantity for this
          // cell. If it differs from our optimistic value (a stock cap / committed
          // floor clamp), adopt it and recompute the cross-cell caps in place —
          // no full cart fetch needed.
          if (!cell || !(sessionData && sessionData.isStockRelevant)) return;
          if (!window.AicoPreorderStock || !window.AicoPreorderStock.getQuantity) return;
          var current = window.AicoPreorderStock.getQuantity(
            cell.productId,
            cell.variantId,
            cell.dateLabel,
          );
          if (current === quantity) return;
          window.AicoPreorderStock.adjustStock(
            cell.productId,
            cell.variantId,
            cell.dateLabel,
            quantity,
          );
          if (catalog && catalog.refreshAll) catalog.refreshAll();
          updateSummary();
        },
        onError: function (code, payload) {
          // A rejected write (e.g. dropping a line below its committed floor) was
          // rolled back server-side. The optimistic stock change still happened
          // locally; snap the grid back to the authoritative cart snapshot.
          // Stock-relevant grids reconcile in place once writes settle
          // (onDirtyChange); non-stock grids re-render from the cart here.
          if (code === 'committed_quantity' && !(sessionData && sessionData.isStockRelevant)) {
            seedStockFromCart();
            if (catalog) catalog.render();
            updateSummary();
          }
          if (!summaryStatus) return;
          summaryStatus.hidden = false;
          if (code === 'committed_quantity') {
            summaryStatus.textContent =
              root.getAttribute('data-aico-preorder-copy-committed') ||
              'Some lines are already confirmed and cannot be lowered.';
          } else {
            summaryStatus.textContent =
              root.getAttribute('data-aico-preorder-copy-error') || 'Error';
          }
        },
      });
    }

    root.querySelectorAll('[data-aico-preorder-select]').forEach(function (select) {
      select.addEventListener('change', function () {
        var key = select.getAttribute('data-aico-preorder-select');
        if (key === 'b2b_id') {
          applyB2bSelection();
          return;
        }
        if (key === 'debtor_id') {
          setDebtor(select.value);
          return;
        }
        if (key === 'billing_address_id' || key === 'delivery_address_id') {
          if (addressesReady()) {
            fetchSession().then(function () {
              updateFlowState();
            });
          } else {
            updateFlowState();
          }
          return;
        }
        if (key === 'size_region') {
          if (catalog && addressesReady()) catalog.render();
          return;
        }
        if (addressesReady()) {
          fetchSession().catch(function () {});
          if (catalog) catalog.render();
        }
      });
    });

    var submitDefaultHtml = submitBtn ? submitBtn.innerHTML : '';

    // Swap the submit button for a spinner + "Saving cart…" while the preorder
    // is being placed; restore the label afterwards.
    function setSubmitSaving(isSaving) {
      if (!submitBtn) return;
      if (isSaving) {
        submitBtn.disabled = true;
        submitBtn.classList.add('aico-preorder-btn--saving');
        submitBtn.setAttribute('aria-busy', 'true');
        var savingCopy =
          root.getAttribute('data-aico-preorder-copy-saving') || 'Saving cart…';
        submitBtn.innerHTML =
          '<span class="aico-preorder-btn-spinner" aria-hidden="true"></span>' +
          '<span>' + escapeHtml(savingCopy) + '</span>';
      } else {
        submitBtn.classList.remove('aico-preorder-btn--saving');
        submitBtn.removeAttribute('aria-busy');
        submitBtn.innerHTML = submitDefaultHtml;
        updateSummary();
      }
    }

    // Draw attention to the (unchecked) terms checkbox instead of leaving the
    // submit button silently disabled.
    function flagTermsRequired() {
      var wrap = termsCheckbox
        ? termsCheckbox.closest('.aico-preorder-terms')
        : null;
      if (wrap) {
        wrap.classList.add('aico-preorder-terms--required');
        // restart the shake animation on each click
        wrap.classList.remove('aico-preorder-terms--shake');
        void wrap.offsetWidth;
        wrap.classList.add('aico-preorder-terms--shake');
        wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      if (termsCheckbox) {
        try {
          termsCheckbox.focus({ preventScroll: true });
        } catch (_) {
          termsCheckbox.focus();
        }
      }
    }

    if (cartEnabled && submitBtn) {
      submitBtn.addEventListener('click', function () {
        // Terms gate: let the click through, but if the AGB box isn't ticked,
        // flag it and stop — don't submit.
        if (termsCheckbox && !termsCheckbox.checked) {
          flagTermsRequired();
          return;
        }
        if (submitBtn.disabled) return;
        if (summaryStatus) summaryStatus.hidden = true;
        setSubmitSaving(true);
        cartCtrl
          .submitPreorder(notesEl ? notesEl.value : '')
          .then(function () {
            var thankYou = root.getAttribute('data-aico-preorder-thank-you-url');
            if (thankYou) {
              window.location.href = thankYou;
            } else {
              setSubmitSaving(false);
              if (summaryStatus) {
                summaryStatus.hidden = false;
                summaryStatus.textContent =
                  root.getAttribute('data-aico-preorder-copy-submitted') || 'Preorder placed';
              }
            }
          })
          .catch(function () {
            setSubmitSaving(false);
            if (summaryStatus) {
              summaryStatus.hidden = false;
              summaryStatus.textContent =
                root.getAttribute('data-aico-preorder-copy-error') || 'Error';
            }
          });
      });
    }

    if (termsCheckbox) {
      termsCheckbox.addEventListener('change', function () {
        if (termsCheckbox.checked) {
          var wrap = termsCheckbox.closest('.aico-preorder-terms');
          if (wrap) {
            wrap.classList.remove(
              'aico-preorder-terms--required',
              'aico-preorder-terms--shake',
            );
          }
        }
        updateSummary();
      });
    }

    if (reopenAckBtn) {
      reopenAckBtn.addEventListener('click', function () {
        reopenAcked = true;
        applyReopenVisibility(true);
      });
    }

    // ───── Product image gallery (preview modal) ─────
    // Click a product image to open a modal gallery (main image + thumbnails).
    // Images are fetched on demand from product-images.js (the grid stays slim).
    var galleryEl = root.querySelector('[data-aico-preorder-gallery]');
    if (galleryEl && catalogEl) {
      var productImagesUrl = root.getAttribute('data-aico-preorder-product-images-url');
      var galMainImg = galleryEl.querySelector('[data-aico-preorder-gallery-main]');
      var galTitle = galleryEl.querySelector('[data-aico-preorder-gallery-title]');
      var galThumbs = galleryEl.querySelector('[data-aico-preorder-gallery-thumbs]');
      var galEmpty = galleryEl.querySelector('[data-aico-preorder-gallery-empty]');
      var galPrev = galleryEl.querySelector('[data-aico-preorder-gallery-prev]');
      var galNext = galleryEl.querySelector('[data-aico-preorder-gallery-next]');
      var galImages = [];
      var galIndex = 0;
      var galReqId = 0;

      function galShow(i) {
        if (!galImages.length) return;
        galIndex = (i + galImages.length) % galImages.length;
        var img = galImages[galIndex];
        galMainImg.src = img.url;
        galMainImg.alt = img.alt || '';
        var multi = galImages.length > 1;
        galPrev.hidden = !multi;
        galNext.hidden = !multi;
        galThumbs
          .querySelectorAll('.aico-preorder-gallery-thumb')
          .forEach(function (t, idx) {
            t.classList.toggle('is-active', idx === galIndex);
            t.setAttribute('aria-selected', idx === galIndex ? 'true' : 'false');
          });
      }

      function galRender(data, fallbackImg, fallbackTitle) {
        galImages = (data && data.images) || [];
        // Keep showing the grid's main image if the gallery came back empty.
        if (!galImages.length && fallbackImg) {
          galImages = [{ url: fallbackImg, alt: fallbackTitle || '' }];
        }
        galTitle.textContent = (data && data.title) || fallbackTitle || '';
        galThumbs.innerHTML = '';
        if (!galImages.length) {
          galMainImg.hidden = true;
          galEmpty.hidden = false;
          galPrev.hidden = true;
          galNext.hidden = true;
          galThumbs.hidden = true;
          return;
        }
        galMainImg.hidden = false;
        galEmpty.hidden = true;
        galImages.forEach(function (img, idx) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'aico-preorder-gallery-thumb';
          b.setAttribute('role', 'option');
          b.innerHTML =
            '<img src="' + escapeHtml(img.url) + '" alt="" loading="lazy">';
          b.addEventListener('click', function () {
            galShow(idx);
          });
          galThumbs.appendChild(b);
        });
        galThumbs.hidden = galImages.length < 2;
        galShow(0);
      }

      function galOpen(productId, placeholderImg, placeholderTitle) {
        if (!productImagesUrl) return;
        galleryEl.hidden = false;
        document.documentElement.classList.add('aico-preorder-gallery-open');
        galImages = [];
        galEmpty.hidden = true;
        galPrev.hidden = true;
        galNext.hidden = true;
        // Show the grid's main image + title immediately (already loaded), with
        // skeleton thumbnails, while the full gallery is fetched.
        galTitle.textContent = placeholderTitle || '';
        if (placeholderImg) {
          galMainImg.hidden = false;
          galMainImg.src = placeholderImg;
          galMainImg.alt = placeholderTitle || '';
        } else {
          galMainImg.hidden = true;
          galMainImg.removeAttribute('src');
        }
        galThumbs.hidden = false;
        galThumbs.innerHTML = '';
        for (var s = 0; s < 5; s++) {
          var skeleton = document.createElement('span');
          skeleton.className =
            'aico-preorder-gallery-thumb aico-preorder-gallery-thumb--skeleton';
          galThumbs.appendChild(skeleton);
        }
        var reqId = ++galReqId;
        var url = new URL(productImagesUrl, window.location.origin);
        url.searchParams.set('product_id', String(productId));
        fetch(url.toString(), {
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        })
          .then(function (res) {
            return res.json();
          })
          .then(function (json) {
            if (reqId !== galReqId) return;
            galRender(json.data || json, placeholderImg, placeholderTitle);
          })
          .catch(function () {
            if (reqId !== galReqId) return;
            galRender({ images: [] }, placeholderImg, placeholderTitle);
          });
      }

      function galClose() {
        galleryEl.hidden = true;
        document.documentElement.classList.remove('aico-preorder-gallery-open');
      }

      catalogEl.addEventListener('click', function (event) {
        var media = event.target.closest
          ? event.target.closest('.aico-preorder-product-media')
          : null;
        if (!media || !catalogEl.contains(media)) return;
        var card = media.closest('[data-aico-preorder-product-id]');
        if (!card) return;
        event.preventDefault();
        var mediaImg = media.querySelector('img');
        var titleEl = card.querySelector('.aico-preorder-product-title');
        galOpen(
          card.getAttribute('data-aico-preorder-product-id'),
          mediaImg ? mediaImg.getAttribute('src') : '',
          titleEl ? titleEl.textContent.trim() : '',
        );
      });

      galleryEl
        .querySelectorAll('[data-aico-preorder-gallery-close]')
        .forEach(function (el) {
          el.addEventListener('click', galClose);
        });
      galPrev.addEventListener('click', function () {
        galShow(galIndex - 1);
      });
      galNext.addEventListener('click', function () {
        galShow(galIndex + 1);
      });
      document.addEventListener('keydown', function (event) {
        if (galleryEl.hidden) return;
        if (event.key === 'Escape') galClose();
        else if (event.key === 'ArrowLeft') galShow(galIndex - 1);
        else if (event.key === 'ArrowRight') galShow(galIndex + 1);
      });
    }

    window.addEventListener('beforeunload', function (event) {
      if (!hasDirty) return;
      event.preventDefault();
      event.returnValue = '';
    });

    var b2bSearchInput = root.querySelector('[data-aico-preorder-b2b-search]');
    if (b2bSearchInput) {
      var b2bSearchTimer;
      b2bSearchInput.addEventListener('input', function () {
        clearTimeout(b2bSearchTimer);
        var term = b2bSearchInput.value;
        b2bSearchTimer = setTimeout(function () {
          loadB2bs(term, true);
        }, 300);
      });
      // Keep the dropdown open while interacting with the search box
      // (the global document-click handler closes open custom-selects).
      b2bSearchInput.addEventListener('mousedown', function (e) {
        e.stopPropagation();
      });
      b2bSearchInput.addEventListener('click', function (e) {
        e.stopPropagation();
      });
      b2bSearchInput.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') e.stopPropagation();
      });
    }

    renderDateSelect([]);
    loadB2bs();
    fetchSession().then(function () {
      updateFlowState();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPreorderPage);
  } else {
    initPreorderPage();
  }
})();
