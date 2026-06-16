// Aico storefront — production-cockpit page + PDP restock-reminder controller.
//
// Recreates the b2b-shop Production Cockpit against the storefront cookie
// session. Two entry points share one reminder modal:
//
//   1. The cockpit page (templates/customers/aico_production_cockpit.liquid):
//      a brand filter + a sortable restock table. Each row opens the reminder
//      modal listing the product's sizes/variants; toggling + saving POSTs to
//      the reminders endpoints.
//   2. The PDP block (templates/product.liquid, [data-aico-cockpit-restock]):
//      hydrates a single SKU; if a restock date exists it shows the date + a
//      "Set / Update reminder" button that opens the SAME modal.
//
// All data comes from the same-origin .js proxies (StorefrontProductionCockpit
// Controller), cookie-authorized — no JWT touches the browser.

(function () {
  'use strict';

  // ---- shared helpers ---------------------------------------------

  function parseI18n(el) {
    if (!el) {
      return {};
    }
    try {
      return JSON.parse(el.textContent) || {};
    } catch (e) {
      console.warn('aico-cockpit: invalid i18n bootstrap', e);
      return {};
    }
  }

  function makeT(i18n) {
    return function t(path, fallback) {
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
    };
  }

  // dd.MM.yyyy from an ISO-ish yyyy-MM-dd (or full ISO) date string.
  function formatDate(raw) {
    if (!raw) {
      return '';
    }
    var match = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) {
      return String(raw);
    }
    return match[3] + '.' + match[2] + '.' + match[1];
  }

  // Chronological sort key (YYYYMMDD) from either "dd.MM.yyyy" (the restock feed
  // format) or an ISO "yyyy-MM-dd" string — string-comparing the raw dd.MM.yyyy
  // sorts by day-of-month, which is wrong.
  function dateSortKey(raw) {
    if (!raw) { return ''; }
    var dmy = String(raw).match(/^(\d{2})\.(\d{2})\.(\d{4})/);
    if (dmy) { return dmy[3] + dmy[2] + dmy[1]; }
    var iso = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) { return iso[1] + iso[2] + iso[3]; }
    return String(raw);
  }

  function getJson(url) {
    return fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
    }).then(function (response) {
      if (!response.ok) {
        throw new Error('GET ' + url + ' -> ' + response.status);
      }
      return response.json();
    });
  }

  function postJson(url, payload, token) {
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-TOKEN': token || ''
      },
      body: JSON.stringify(payload)
    }).then(function (response) {
      if (!response.ok) {
        throw new Error('POST ' + url + ' -> ' + response.status);
      }
      return response.json().catch(function () {
        return {};
      });
    });
  }

  function unwrap(envelope) {
    if (!envelope) {
      return [];
    }
    var data = envelope.data != null ? envelope.data : envelope;
    return Array.isArray(data) ? data : [];
  }

  // A reminder matches a row variant either by real variant id (shop
  // variants) or by sku+size (new-release / manual entries).
  function reminderKeyForVariant(product, variant) {
    if (variant && variant.variantId != null) {
      return 'v:' + variant.variantId;
    }
    return 'n:' + String(product.sku) + '|' + String(variant ? variant.variantValue : '');
  }

  function reminderKey(reminder) {
    if (reminder && reminder.product_variant_id != null) {
      return 'v:' + reminder.product_variant_id;
    }
    return 'n:' + String(reminder ? reminder.sku : '') + '|' + String(reminder ? reminder.size : '');
  }

  // Build a lookup of active reminders keyed the same way as row variants,
  // so the modal can show which sizes already have a reminder (and its id).
  function indexReminders(reminders) {
    var byKey = {};
    reminders.forEach(function (reminder) {
      byKey[reminderKey(reminder)] = reminder;
    });
    return byKey;
  }

  // ---- shared reminder modal --------------------------------------
  //
  // One modal instance serves both the cockpit page and the PDP. It is built
  // lazily and appended to <body>. open(product, ctx) renders the size cells;
  // saving calls back into the page controller so the table/PDP can refresh.

  // Inline corner icons for the size-cell states (check / plus / minus).
  var CELL_ICON = {
    active: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
    add: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    remove: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/></svg>'
  };
  var INFO_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';

  // Sortable-column header icons: distinct glyphs per state (unfold / up / down),
  // matching the legacy shop rather than one rotating triangle.
  var SORT_ICON = {
    none: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="8 9 12 5 16 9"/><polyline points="8 15 12 19 16 15"/></svg>',
    asc:  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 14 12 8 18 14"/></svg>',
    desc: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 10 12 16 18 10"/></svg>'
  };

  // Group a product's variants into "available from <date>" buckets, ascending
  // (undated last), each sorted by size — matches the legacy reminder modal.
  function groupVariantsByDate(variants) {
    var groups = {};
    var order = [];
    (variants || []).forEach(function (variant) {
      var date = variant.date || '';
      if (!(date in groups)) {
        groups[date] = [];
        order.push(date);
      }
      groups[date].push(variant);
    });
    order.sort(function (a, b) {
      if (!a) { return 1; }
      if (!b) { return -1; }
      var ak = dateSortKey(a);
      var bk = dateSortKey(b);
      return ak < bk ? -1 : (ak > bk ? 1 : 0);
    });
    return order.map(function (date) {
      var list = groups[date].slice().sort(function (x, y) {
        return String(x.variantValue || '').localeCompare(String(y.variantValue || ''), undefined, { numeric: true });
      });
      return { date: date, variants: list };
    });
  }

  function createReminderModal(opts) {
    var t = opts.t;
    var token = opts.token;
    var remindersUrl = opts.remindersUrl;
    var newReleaseUrl = opts.newReleaseUrl;
    var onToast = opts.onToast || function () {};
    var onSaved = opts.onSaved || function () {};

    var root = document.createElement('div');
    root.className = 'aico-cockpit-modal';
    root.setAttribute('hidden', '');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.innerHTML =
      '<div class="aico-cockpit-modal-backdrop" data-aico-cockpit-modal-close></div>' +
      '<div class="aico-cockpit-modal-panel" role="document">' +
        '<header class="aico-cockpit-modal-head">' +
          '<p class="aico-cockpit-modal-eyebrow">' + escapeHtml(t('reminder_modal.manage_for', 'Manage reminders for:')) + '</p>' +
          '<button type="button" class="aico-cockpit-modal-x" data-aico-cockpit-modal-close aria-label="' + escapeAttr(t('reminder_modal.cancel', 'Cancel')) + '">&times;</button>' +
        '</header>' +
        '<div class="aico-cockpit-modal-product">' +
          '<div class="aico-cockpit-modal-thumb" data-aico-cockpit-modal-thumb></div>' +
          '<div class="aico-cockpit-modal-product-info">' +
            '<h2 class="aico-cockpit-modal-title" data-aico-cockpit-modal-title></h2>' +
            '<p class="aico-cockpit-modal-note">' + escapeHtml(t('product_note', '')) + '</p>' +
          '</div>' +
        '</div>' +
        '<p class="aico-cockpit-modal-hint">' + escapeHtml(t('reminder_modal.choose_size', 'Choose your size')) + '</p>' +
        '<div class="aico-cockpit-modal-grid" data-aico-cockpit-modal-grid></div>' +
        '<footer class="aico-cockpit-modal-foot">' +
          '<span class="aico-cockpit-howto" data-aico-cockpit-howto>' +
            '<button type="button" class="aico-cockpit-howto-btn" data-aico-cockpit-howto-toggle>' +
              escapeHtml(t('reminder_modal.how_to_use', 'How to use')) + ' ' + INFO_SVG +
            '</button>' +
            '<div class="aico-cockpit-howto-pop" data-aico-cockpit-howto-pop hidden>' +
              '<p>' + escapeHtml(t('reminder_modal.help_intro1', 'Select the sizes you want to be reminded about.')) + '</p>' +
              '<p>' + escapeHtml(t('reminder_modal.help_intro2', 'For the changes to take effect you have to save the selected changes.')) + '</p>' +
              '<p class="aico-cockpit-legend-title">' + escapeHtml(t('reminder_modal.legend_title', 'Legend')) + '</p>' +
              '<div class="aico-cockpit-legend-rows">' +
                '<div class="aico-cockpit-legend-row"><span class="aico-cockpit-legend-box"></span>' + escapeHtml(t('reminder_modal.legend_none', 'No reminder set')) + '</div>' +
                '<div class="aico-cockpit-legend-row"><span class="aico-cockpit-legend-box aico-cockpit-legend-box--active">' + CELL_ICON.active + '</span>' + escapeHtml(t('reminder_modal.legend_active', 'Reminder is set')) + '</div>' +
                '<div class="aico-cockpit-legend-row"><span class="aico-cockpit-legend-box aico-cockpit-legend-box--add">' + CELL_ICON.add + '</span>' + escapeHtml(t('reminder_modal.legend_add', 'Will be added after save')) + '</div>' +
                '<div class="aico-cockpit-legend-row"><span class="aico-cockpit-legend-box aico-cockpit-legend-box--remove">' + CELL_ICON.remove + '</span>' + escapeHtml(t('reminder_modal.legend_remove', 'Will be removed after save')) + '</div>' +
              '</div>' +
            '</div>' +
          '</span>' +
          '<div class="aico-cockpit-modal-actions">' +
            '<button type="button" class="aico-cockpit-btn aico-cockpit-btn--ghost" data-aico-cockpit-modal-close>' + escapeHtml(t('reminder_modal.cancel', 'Cancel')) + '</button>' +
            '<button type="button" class="aico-cockpit-btn aico-cockpit-btn--primary" data-aico-cockpit-modal-save disabled>' + escapeHtml(t('reminder_modal.select_default', 'Select reminders')) + '</button>' +
          '</div>' +
        '</footer>' +
      '</div>';
    document.body.appendChild(root);

    var titleEl = root.querySelector('[data-aico-cockpit-modal-title]');
    var thumbEl = root.querySelector('[data-aico-cockpit-modal-thumb]');
    var gridEl = root.querySelector('[data-aico-cockpit-modal-grid]');
    var saveBtn = root.querySelector('[data-aico-cockpit-modal-save]');
    var howtoPop = root.querySelector('[data-aico-cockpit-howto-pop]');

    var current = null; // { product, reminderIndex }

    function close() {
      root.setAttribute('hidden', '');
      if (howtoPop) { howtoPop.hidden = true; }
      current = null;
    }

    root.addEventListener('click', function (event) {
      if (event.target.closest('[data-aico-cockpit-modal-close]')) {
        close();
      }
    });
    var howtoToggle = root.querySelector('[data-aico-cockpit-howto-toggle]');
    if (howtoToggle && howtoPop) {
      howtoToggle.addEventListener('click', function (event) {
        event.stopPropagation();
        howtoPop.hidden = !howtoPop.hidden;
      });
      root.querySelector('.aico-cockpit-modal-panel').addEventListener('click', function (event) {
        if (!event.target.closest('[data-aico-cockpit-howto]')) { howtoPop.hidden = true; }
      });
    }
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !root.hasAttribute('hidden')) {
        close();
      }
    });

    // cell.state: 'idle' | 'active' | 'add' | 'remove'. Rendered as date-grouped
    // "available from" panels; each cell carries a corner state icon and a
    // staggered open animation.
    function renderGrid(product, reminderIndex) {
      gridEl.innerHTML = '';
      var cellIndex = 0;
      groupVariantsByDate(product.variants || []).forEach(function (group) {
        var panel = document.createElement('div');
        panel.className = 'aico-cockpit-date-group';

        var heading = document.createElement('p');
        heading.className = 'aico-cockpit-date-title';
        heading.textContent = group.date
          ? (t('reminder_modal.available_from', 'Available from') + ' ' + formatDate(group.date))
          : t('reminder_modal.no_date', 'No date');
        panel.appendChild(heading);

        var row = document.createElement('div');
        row.className = 'aico-cockpit-size-row';
        group.variants.forEach(function (variant) {
          var key = reminderKeyForVariant(product, variant);
          var existing = reminderIndex[key] || null;
          var cell = document.createElement('button');
          cell.type = 'button';
          cell.className = 'aico-cockpit-size-cell';
          cell.setAttribute('data-aico-cockpit-size', '');
          cell.dataset.state = existing ? 'active' : 'idle';
          cell.dataset.variantId = variant.variantId != null ? String(variant.variantId) : '';
          cell.dataset.size = variant.variantValue != null ? String(variant.variantValue) : '';
          cell.dataset.reminderId = existing && existing.id != null ? String(existing.id) : '';
          cell.dataset.manual = (product.isManualEntry || variant.variantId == null) ? '1' : '0';
          cell.style.animationDelay = (cellIndex * 35) + 'ms';
          cellIndex += 1;
          cell.innerHTML = '<span class="aico-cockpit-size-label">' +
            escapeHtml(variant.variantValue != null ? variant.variantValue : '—') +
            '</span><span class="aico-cockpit-size-icon" aria-hidden="true"></span>';
          applyCellClass(cell);
          cell.addEventListener('click', function () { toggleCell(cell); });
          row.appendChild(cell);
        });
        panel.appendChild(row);
        gridEl.appendChild(panel);
      });
      // Retrigger the open animation.
      gridEl.classList.remove('is-opening');
      void gridEl.offsetWidth;
      gridEl.classList.add('is-opening');
    }

    function applyCellClass(cell) {
      cell.classList.remove(
        'aico-cockpit-size-cell--active',
        'aico-cockpit-size-cell--add',
        'aico-cockpit-size-cell--remove'
      );
      var state = cell.dataset.state;
      var iconEl = cell.querySelector('.aico-cockpit-size-icon');
      if (state === 'active') {
        cell.classList.add('aico-cockpit-size-cell--active');
        if (iconEl) { iconEl.innerHTML = CELL_ICON.active; }
      } else if (state === 'add') {
        cell.classList.add('aico-cockpit-size-cell--add');
        if (iconEl) { iconEl.innerHTML = CELL_ICON.add; }
      } else if (state === 'remove') {
        cell.classList.add('aico-cockpit-size-cell--remove');
        if (iconEl) { iconEl.innerHTML = CELL_ICON.remove; }
      } else if (iconEl) {
        iconEl.innerHTML = '';
      }
    }

    // idle -> add -> idle ; active -> remove -> active
    function toggleCell(cell) {
      var state = cell.dataset.state;
      if (state === 'idle') {
        cell.dataset.state = 'add';
      } else if (state === 'add') {
        cell.dataset.state = 'idle';
      } else if (state === 'active') {
        cell.dataset.state = 'remove';
      } else if (state === 'remove') {
        cell.dataset.state = 'active';
      }
      applyCellClass(cell);
      updateSaveButton();
    }

    function collectChanges() {
      var variantIdsToSetRemindersFor = [];
      var reminderIdsToCancel = [];
      var newReleases = []; // { sku, size }
      var cells = gridEl.querySelectorAll('[data-aico-cockpit-size]');
      Array.prototype.forEach.call(cells, function (cell) {
        var state = cell.dataset.state;
        if (state === 'add') {
          if (cell.dataset.manual === '1' || !cell.dataset.variantId) {
            newReleases.push({ sku: current.product.sku, size: cell.dataset.size });
          } else {
            variantIdsToSetRemindersFor.push(cell.dataset.variantId);
          }
        } else if (state === 'remove' && cell.dataset.reminderId) {
          reminderIdsToCancel.push(cell.dataset.reminderId);
        }
      });
      return {
        variantIdsToSetRemindersFor: variantIdsToSetRemindersFor,
        reminderIdsToCancel: reminderIdsToCancel,
        newReleases: newReleases
      };
    }

    // Reflect pending changes on the primary button: disabled with the neutral
    // "Select reminders" label until there's a change, then Set/Remove/Update.
    function updateSaveButton() {
      var changes = collectChanges();
      var adds = changes.variantIdsToSetRemindersFor.length + changes.newReleases.length;
      var removes = changes.reminderIdsToCancel.length;
      var label;
      if (adds && removes) {
        label = t('reminder_modal.update_changes', 'Update reminders');
      } else if (adds) {
        label = t('reminder_modal.set', 'Set reminders');
      } else if (removes) {
        label = t('reminder_modal.remove', 'Remove reminders');
      } else {
        label = t('reminder_modal.select_default', 'Select reminders');
      }
      saveBtn.textContent = label;
      saveBtn.disabled = !(adds || removes);
    }

    function save() {
      if (!current) {
        return;
      }
      var changes = collectChanges();
      var tasks = [];

      if (changes.variantIdsToSetRemindersFor.length || changes.reminderIdsToCancel.length) {
        tasks.push(postJson(remindersUrl, {
          data: {
            variantIdsToSetRemindersFor: changes.variantIdsToSetRemindersFor,
            reminderIdsToCancel: changes.reminderIdsToCancel
          }
        }, token));
      }
      changes.newReleases.forEach(function (entry) {
        tasks.push(postJson(newReleaseUrl, entry, token));
      });

      if (!tasks.length) {
        close();
        return;
      }

      saveBtn.disabled = true;
      Promise.all(tasks).then(function () {
        onToast('updated');
        close();
        onSaved();
      }).catch(function (error) {
        console.warn('aico-cockpit: reminder save failed', error);
        saveBtn.disabled = false;
        onToast('error');
      });
    }

    saveBtn.addEventListener('click', save);

    return {
      open: function (product, reminderIndex) {
        current = { product: product };
        titleEl.textContent = product.productionName || product.name || product.sku || '';
        if (thumbEl) {
          thumbEl.innerHTML = product.image
            ? '<img src="' + escapeAttr(product.image) + '" alt="" loading="lazy">'
            : '';
          thumbEl.classList.toggle('is-empty', !product.image);
        }
        renderGrid(product, reminderIndex || {});
        updateSaveButton();
        if (howtoPop) { howtoPop.hidden = true; }
        root.removeAttribute('hidden');
      },
      close: close
    };
  }

  // ---- cockpit page controller ------------------------------------

  function initCockpitPage() {
    var root = document.querySelector('[data-aico-cockpit]');
    if (!root) {
      return;
    }

    var i18n = parseI18n(root.querySelector('[data-aico-cockpit-i18n]'));
    var t = makeT(i18n);
    var token = root.getAttribute('data-aico-cockpit-token') || '';
    var productsUrl = root.getAttribute('data-aico-cockpit-products-url') || '';
    var remindersUrl = root.getAttribute('data-aico-cockpit-reminders-url') || '';
    var newReleaseUrl = root.getAttribute('data-aico-cockpit-new-release-url') || '';
    var productPageUrl = root.getAttribute('data-aico-cockpit-product-page-url') || '';

    // PDP link for a row: only catalogue products (have a url handle, not a
    // manual "coming soon" entry) link to /products/<handle>.
    function productHref(product) {
      if (!productPageUrl || product.isManualEntry || !product.urlHandle) {
        return '';
      }
      return productPageUrl.replace('__HANDLE__', encodeURIComponent(product.urlHandle));
    }

    var brandFilterEl = root.querySelector('[data-aico-cockpit-brand-filter]');
    var tbodyEl = root.querySelector('[data-aico-cockpit-tbody]');
    var emptyEl = root.querySelector('[data-aico-cockpit-empty]');
    var errorEl = root.querySelector('[data-aico-cockpit-error]');
    var loaderEl = root.querySelector('[data-aico-cockpit-loader]');
    var toastEl = root.querySelector('[data-aico-cockpit-toast]');
    var sortButtons = root.querySelectorAll('[data-aico-cockpit-sort]');

    var state = {
      products: [],
      reminderIndex: {},
      brands: [],          // [{ id, label }]
      selectedBrandIds: {}, // map id->true (string keys); '' = unknown bucket
      sortKey: 'date',
      sortDir: 'asc'
    };

    var toastTimer = null;
    function toast(kind) {
      if (!toastEl) {
        return;
      }
      toastEl.textContent = kind === 'error'
        ? t('reminder_modal.toast_error', 'Failed to update reminders. Please try again.')
        : t('reminder_modal.toast_updated', 'Reminders updated');
      toastEl.classList.toggle('aico-cockpit-toast--error', kind === 'error');
      toastEl.classList.add('is-visible');
      if (toastTimer) {
        window.clearTimeout(toastTimer);
      }
      toastTimer = window.setTimeout(function () {
        toastEl.classList.remove('is-visible');
      }, 2600);
    }

    var modal = createReminderModal({
      t: t,
      token: token,
      remindersUrl: remindersUrl,
      newReleaseUrl: newReleaseUrl,
      onToast: toast,
      onSaved: refreshReminders
    });

    function brandLabel(product) {
      // Prefer the brand name carried on the product itself; fall back to the
      // template's id->label map, then the raw id.
      if (product.brandName) {
        return product.brandName;
      }
      var override = root.getAttribute('data-aico-cockpit-brand-' + product.brandId);
      if (override) {
        return override;
      }
      if (product.brandId == null) {
        return t('brand_filter.unknown', 'Unknown Brand');
      }
      return String(product.brandId);
    }

    function buildBrands() {
      var seen = {};
      var brands = [];
      state.products.forEach(function (product) {
        var id = product.brandId == null ? '' : String(product.brandId);
        if (!(id in seen)) {
          seen[id] = true;
          brands.push({ id: id, label: brandLabel(product) });
        }
      });
      state.brands = brands;
      // Default: all brands selected (b2b-shop requires >=1 selected).
      state.selectedBrandIds = {};
      brands.forEach(function (brand) {
        state.selectedBrandIds[brand.id] = true;
      });
    }

    function renderBrandFilter() {
      if (!brandFilterEl) {
        return;
      }
      brandFilterEl.innerHTML = '';
      state.brands.forEach(function (brand) {
        var label = document.createElement('label');
        label.className = 'aico-cockpit-brand-chip';
        var input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!state.selectedBrandIds[brand.id];
        input.value = brand.id;
        input.setAttribute('data-aico-cockpit-brand-checkbox', '');
        input.addEventListener('change', function () {
          // Keep at least one brand selected (matches legacy rule).
          var next = {};
          Object.keys(state.selectedBrandIds).forEach(function (k) {
            next[k] = state.selectedBrandIds[k];
          });
          next[brand.id] = input.checked;
          var anySelected = Object.keys(next).some(function (k) {
            return next[k];
          });
          if (!anySelected) {
            input.checked = true;
            return;
          }
          state.selectedBrandIds = next;
          renderRows();
        });
        var span = document.createElement('span');
        span.textContent = brand.label;
        label.appendChild(input);
        label.appendChild(span);
        brandFilterEl.appendChild(label);
      });
    }

    function visibleProducts() {
      return state.products.filter(function (product) {
        var id = product.brandId == null ? '' : String(product.brandId);
        return !!state.selectedBrandIds[id];
      });
    }

    function sortedProducts(products) {
      var dir = state.sortDir === 'desc' ? -1 : 1;
      var key = state.sortKey;
      return products.slice().sort(function (a, b) {
        var av;
        var bv;
        if (key === 'brand') {
          av = brandLabel(a).toLowerCase();
          bv = brandLabel(b).toLowerCase();
        } else {
          av = dateSortKey(a.date);
          bv = dateSortKey(b.date);
        }
        if (av < bv) {
          return -1 * dir;
        }
        if (av > bv) {
          return 1 * dir;
        }
        return 0;
      });
    }

    function rowHasReminder(product) {
      return (product.variants || []).some(function (variant) {
        return !!state.reminderIndex[reminderKeyForVariant(product, variant)];
      });
    }

    function renderRows() {
      if (!tbodyEl) {
        return;
      }
      var products = sortedProducts(visibleProducts());
      tbodyEl.innerHTML = '';

      if (!state.products.length) {
        showEmpty(t('table.no_data', 'No restock data available'));
        return;
      }
      if (!products.length) {
        showEmpty(t('table.no_data_for_brands', 'No products found for selected brands'));
        return;
      }
      hideEmpty();

      products.forEach(function (product) {
        var tr = document.createElement('tr');
        tr.className = 'aico-cockpit-row';
        tr.setAttribute('data-aico-cockpit-row', '');

        var hasReminder = rowHasReminder(product);
        var actionLabel = hasReminder
          ? t('reminder_modal.update', 'Update reminders')
          : t('set_reminder', 'Set reminder');

        var href = productHref(product);
        var displayName = product.productionName || product.name || '';
        var imageInner = product.image
          ? '<img class="aico-cockpit-thumb" src="' + escapeAttr(product.image) + '" alt="" loading="lazy">'
          : '<span class="aico-cockpit-thumb aico-cockpit-thumb--empty" aria-hidden="true"></span>';
        var nameInner = href
          ? '<a class="aico-cockpit-model-link" href="' + escapeAttr(href) + '">' + escapeHtml(displayName) + '</a>'
          : escapeHtml(displayName);

        tr.innerHTML =
          '<td class="aico-cockpit-cell aico-cockpit-cell--brand">' + escapeHtml(brandLabel(product)) + '</td>' +
          '<td class="aico-cockpit-cell aico-cockpit-cell--image">' +
            (href ? '<a class="aico-cockpit-thumb-link" href="' + escapeAttr(href) + '">' + imageInner + '</a>' : imageInner) +
          '</td>' +
          '<td class="aico-cockpit-cell aico-cockpit-cell--model">' + nameInner +
            (product.isManualEntry ? ' <span class="aico-cockpit-badge">' + escapeHtml(t('coming_soon', 'Coming soon')) + '</span>' : '') +
          '</td>' +
          '<td class="aico-cockpit-cell aico-cockpit-cell--sku">' + escapeHtml(product.sku || '') + '</td>' +
          '<td class="aico-cockpit-cell aico-cockpit-cell--date">' + escapeHtml(formatDate(product.date)) + '</td>' +
          '<td class="aico-cockpit-cell aico-cockpit-cell--action">' +
            '<button type="button" class="aico-cockpit-btn aico-cockpit-btn--primary aico-cockpit-action-btn" data-aico-cockpit-open>' + escapeHtml(actionLabel) + '</button>' +
          '</td>';

        tr.querySelector('[data-aico-cockpit-open]').addEventListener('click', function () {
          modal.open(product, state.reminderIndex);
        });
        tbodyEl.appendChild(tr);
      });
    }

    function showEmpty(message) {
      if (emptyEl) {
        emptyEl.textContent = message;
        emptyEl.hidden = false;
      }
    }
    function hideEmpty() {
      if (emptyEl) {
        emptyEl.hidden = true;
      }
    }

    // Reflect the active sort column + direction in each header's icon.
    function updateSortIcons() {
      Array.prototype.forEach.call(sortButtons, function (btn) {
        var key = btn.getAttribute('data-aico-cockpit-sort');
        var icon = btn.querySelector('.aico-cockpit-sort-icon');
        if (!icon) { return; }
        if (state.sortKey === key) {
          icon.innerHTML = state.sortDir === 'asc' ? SORT_ICON.asc : SORT_ICON.desc;
          btn.classList.add('is-active');
        } else {
          icon.innerHTML = SORT_ICON.none;
          btn.classList.remove('is-active');
        }
      });
    }

    Array.prototype.forEach.call(sortButtons, function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-aico-cockpit-sort');
        if (state.sortKey === key) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortKey = key;
          state.sortDir = 'asc';
        }
        Array.prototype.forEach.call(sortButtons, function (other) {
          other.setAttribute('aria-sort', 'none');
        });
        btn.setAttribute('aria-sort', state.sortDir === 'asc' ? 'ascending' : 'descending');
        updateSortIcons();
        renderRows();
      });
    });
    updateSortIcons();

    function refreshReminders() {
      return getJson(remindersUrl).then(function (envelope) {
        state.reminderIndex = indexReminders(unwrap(envelope));
        renderRows();
      }).catch(function (error) {
        console.warn('aico-cockpit: reminders refresh failed', error);
      });
    }

    // Brand-filter info tooltip (click-to-toggle; closes on outside click).
    var infoToggle = root.querySelector('[data-aico-cockpit-info-toggle]');
    var infoPop = root.querySelector('[data-aico-cockpit-info-pop]');
    if (infoToggle && infoPop) {
      infoToggle.addEventListener('click', function (event) {
        event.stopPropagation();
        infoPop.hidden = !infoPop.hidden;
      });
      document.addEventListener('click', function (event) {
        if (!infoPop.hidden && !event.target.closest('[data-aico-cockpit-info]')) {
          infoPop.hidden = true;
        }
      });
    }

    function load() {
      if (loaderEl) {
        loaderEl.hidden = false;
      }
      Promise.all([getJson(productsUrl), getJson(remindersUrl)])
        .then(function (results) {
          state.products = unwrap(results[0]);
          state.reminderIndex = indexReminders(unwrap(results[1]));
          buildBrands();
          renderBrandFilter();
          renderRows();
        })
        .catch(function (error) {
          console.warn('aico-cockpit: load failed', error);
          if (errorEl) {
            errorEl.hidden = false;
          }
        })
        .then(function () {
          if (loaderEl) {
            loaderEl.hidden = true;
          }
        });
    }

    load();
  }

  // ---- PDP integration --------------------------------------------

  function initPdpRestock() {
    var block = document.querySelector('[data-aico-cockpit-restock]');
    if (!block) {
      return;
    }

    var i18n = parseI18n(block.querySelector('[data-aico-cockpit-i18n]'));
    var t = makeT(i18n);
    var token = block.getAttribute('data-aico-cockpit-token') || '';
    var sku = block.getAttribute('data-aico-cockpit-sku') || '';
    var productUrl = block.getAttribute('data-aico-cockpit-product-url') || '';
    var remindersUrl = block.getAttribute('data-aico-cockpit-reminders-url') || '';
    var newReleaseUrl = block.getAttribute('data-aico-cockpit-new-release-url') || '';

    if (!sku || !productUrl) {
      return;
    }
    // Placeholder carries `__SKU__`; substitute the real, encoded SKU.
    var singleUrl = productUrl.replace('__SKU__', encodeURIComponent(sku));

    var toastTimer = null;
    function toast(kind) {
      var toastEl = block.querySelector('[data-aico-cockpit-toast]');
      if (!toastEl) {
        return;
      }
      toastEl.textContent = kind === 'error'
        ? t('reminder_modal.toast_error', 'Failed to update reminders. Please try again.')
        : t('reminder_modal.toast_updated', 'Reminders updated');
      toastEl.classList.toggle('aico-cockpit-toast--error', kind === 'error');
      toastEl.classList.add('is-visible');
      if (toastTimer) {
        window.clearTimeout(toastTimer);
      }
      toastTimer = window.setTimeout(function () {
        toastEl.classList.remove('is-visible');
      }, 2600);
    }

    var modal = createReminderModal({
      t: t,
      token: token,
      remindersUrl: remindersUrl,
      newReleaseUrl: newReleaseUrl,
      onToast: toast,
      onSaved: hydrate
    });

    var product = null;
    var reminderIndex = {};

    function hydrate() {
      Promise.all([getJson(singleUrl), getJson(remindersUrl)])
        .then(function (results) {
          var products = unwrap(results[0]);
          reminderIndex = indexReminders(unwrap(results[1]));
          product = products.length ? products[0] : null;

          if (!product || !product.date) {
            block.hidden = true;
            block.innerHTML = '';
            return;
          }
          render();
        })
        .catch(function (error) {
          console.warn('aico-cockpit: PDP hydrate failed', error);
          block.hidden = true;
        });
    }

    function hasReminder() {
      return (product.variants || []).some(function (variant) {
        return !!reminderIndex[reminderKeyForVariant(product, variant)];
      });
    }

    function render() {
      var label = hasReminder()
        ? t('reminder_modal.update', 'Update reminders')
        : t('set_reminder', 'Set reminder');
      block.hidden = false;
      block.innerHTML =
        '<div class="aico-cockpit-pdp-card">' +
          '<p class="aico-cockpit-pdp-line">' +
            '<span class="aico-cockpit-pdp-label">' + escapeHtml(t('table.restock_date', 'Available from')) + '</span> ' +
            '<strong class="aico-cockpit-pdp-date">' + escapeHtml(formatDate(product.date)) + '</strong>' +
          '</p>' +
          '<button type="button" class="aico-cockpit-btn aico-cockpit-btn--outline" data-aico-cockpit-pdp-open>' + escapeHtml(label) + '</button>' +
          '<div class="aico-cockpit-toast" aria-live="polite" data-aico-cockpit-toast></div>' +
        '</div>';
      block.querySelector('[data-aico-cockpit-pdp-open]').addEventListener('click', function () {
        modal.open(product, reminderIndex);
      });
    }

    hydrate();
  }

  // ---- escaping ---------------------------------------------------

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  function escapeAttr(value) {
    return escapeHtml(value).replace(/"/g, '&quot;');
  }

  // ---- boot -------------------------------------------------------

  function boot() {
    initCockpitPage();
    initPdpRestock();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
