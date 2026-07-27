// Card quick-add modal — the b2b-shop "buy from the product card" feature.
// A cart button on each listing/brand card (snippets/product-card) opens a
// modal with the SAME size matrix as the PDP (region tabs, size-guide link,
// per-size quantity inputs clamped to warehouse stock + PIM max-order
// caps, running total) and submits through the shared Alpine cart store.
//
// Same no-framework IIFE style as products-page.js; the modal DOM is built
// on first open (production-cockpit modal pattern) and reused. Variants +
// stock are NOT in the listing payload — the modal fetches the LEAN quick-add
// endpoint (`routes.aico_quick_add_url`,
// /aico-storefront-api/quick-add/<handle>) on each open so stock is always
// fresh. That endpoint returns only what the matrix needs (variants, warehouse
// stock, order caps); the Shopify-shaped /products/<handle>.js builds the whole
// PDP drop — prices, colour siblings, specs — and cost ~460 ms for it.
// Everything the lean payload drops is sourced locally instead: the shipping
// block from `customer.aico_shipping_block` (it is a property of the SHOPPER,
// not of the product) and the EU → UK/US/MM size labels from the chart the
// theme bundles (assets/size-charts.js).
//
// Semantics: ABSOLUTE quantities, like the PDP matrix (`bulkUpdate()` →
// POST /cart/update.js). Inputs are PRE-FILLED from the current cart, so
// the matrix mirrors the cart for this product; submitting posts the whole
// matrix (zeros included, so a cleared size removes its line). A matrix
// that still matches the cart is a silent no-op — the button sits in the
// PDP's inactive/ghost state with the reason on hover.
(function () {
  'use strict';

  var configNode = document.getElementById('aico-quick-add-config');
  if (!configNode) {
    return;
  }
  var config;
  try {
    config = JSON.parse(configNode.textContent || '{}');
  } catch (error) {
    return;
  }
  var i18n = config.i18n || {};
  var cartT = (window.__AICO_T__ && window.__AICO_T__.cart) || {};

  var REGIONS = ['EU', 'UK', 'US', 'MM'];
  var regionLabelAttr = {
    EU: 'data-aico-label-eu',
    UK: 'data-aico-label-uk',
    US: 'data-aico-label-us',
    MM: 'data-aico-label-mm'
  };

  function t(key, fallback) {
    return (typeof i18n[key] === 'string' && i18n[key] !== '') ? i18n[key] : fallback;
  }

  function cartStore() {
    return (window.Alpine && typeof window.Alpine.store === 'function')
      ? window.Alpine.store('cart')
      : null;
  }

  // ---- Size region labels (client-side) ---------------------------------
  //
  // Port of the backend's ProductSizeRegionLabelService: the canonical EU
  // option value is a key into the gender block's per-region map. Charts come
  // from the product's own override when it has one, else the static bundle
  // (assets/size-charts.js). Anything unresolvable falls back to the EU value
  // itself — the same thing the server does.

  var REGION_CHART_KEY = { EU: 'EU', UK: 'UK', US: 'US', MM: 'Millimeters' };

  function chartsFor(product) {
    var own = product && product.aico_size_charts;
    if (own && own.data && typeof own.data === 'object') {
      return own.data;
    }
    return (window.AICO_SIZE_CHARTS && typeof window.AICO_SIZE_CHARTS === 'object')
      ? window.AICO_SIZE_CHARTS
      : null;
  }

  // Chart keys are strings like "40 2/3"; an option may differ in spacing or
  // be numerically equal ("40" vs "40.0"). Mirrors normalizeChartKey().
  function chartLookup(sizes, option) {
    if (!sizes || typeof sizes !== 'object') {
      return null;
    }
    if (Object.prototype.hasOwnProperty.call(sizes, option)) {
      return String(sizes[option]);
    }
    var trimmed = String(option).trim();
    var keys = Object.keys(sizes);
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i]).trim() === trimmed) {
        return String(sizes[keys[i]]);
      }
    }
    var num = trimmed !== '' && !isNaN(Number(trimmed)) ? Number(trimmed) : null;
    if (num !== null) {
      for (var j = 0; j < keys.length; j++) {
        var keyNum = keys[j] !== '' && !isNaN(Number(keys[j])) ? Number(keys[j]) : null;
        if (keyNum !== null && Math.abs(keyNum - num) < 0.0001) {
          return String(sizes[keys[j]]);
        }
      }
    }
    return null;
  }

  // Gender block first (case-insensitive), then the server's fallback order.
  function genderBlocks(charts, gender) {
    var order = [];
    if (gender) {
      var needle = String(gender).trim().toLowerCase();
      Object.keys(charts).forEach(function (key) {
        if (String(key).toLowerCase() === needle) {
          order.push(key);
        }
      });
    }
    ['women', 'men', 'unisex'].forEach(function (key) {
      if (order.indexOf(key) === -1) {
        order.push(key);
      }
    });
    return order;
  }

  function sizeLabels(sizeValue, charts, gender) {
    var value = String(sizeValue == null ? '' : sizeValue).trim();
    var labels = { EU: value, UK: value, US: value, MM: value };
    if (value === '' || !charts) {
      return labels;
    }
    var blocks = genderBlocks(charts, gender);
    REGIONS.forEach(function (region) {
      for (var i = 0; i < blocks.length; i++) {
        var block = charts[blocks[i]];
        if (!block || typeof block !== 'object') {
          continue;
        }
        var found = chartLookup(block[REGION_CHART_KEY[region]], value);
        if (found !== null && found !== '') {
          labels[region] = found;
          return;
        }
      }
    });
    return labels;
  }

  // ---- Skeleton sizing --------------------------------------------------
  //
  // How many size cells to draw while loading. First choice is the real count
  // the card carries (`data-aico-variant-count`, from the search index). That
  // field is absent until the index is rebuilt, so remember what each handle
  // actually turned out to have and reuse it on the next open; a handle seen
  // for the first time gets a middle-of-the-road guess.
  var VARIANT_COUNT_KEY = 'aico:quick-add:variant-count';
  var DEFAULT_SKELETON_CELLS = 10;

  function rememberedCounts() {
    try {
      var raw = window.sessionStorage.getItem(VARIANT_COUNT_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function rememberCount(handle, count) {
    if (!handle || !count || count <= 0) {
      return;
    }
    try {
      var map = rememberedCounts();
      if (map[handle] === count) {
        return;
      }
      map[handle] = count;
      window.sessionStorage.setItem(VARIANT_COUNT_KEY, JSON.stringify(map));
    } catch (error) {
      // Private mode / quota — the default guess still applies.
    }
  }

  function skeletonCellCount(trigger) {
    var attr = parseInt(trigger.getAttribute('data-aico-variant-count'), 10);
    if (!isNaN(attr) && attr > 0) {
      return attr;
    }
    var handle = trigger.getAttribute('data-aico-handle') || '';
    var remembered = rememberedCounts()[handle];
    if (typeof remembered === 'number' && remembered > 0) {
      return remembered;
    }
    return DEFAULT_SKELETON_CELLS;
  }

  // ---- Modal shell (built once, reused per open) ------------------------

  var modal = null;
  var refs = null;
  var lastTrigger = null;
  var openToken = 0; // invalidates in-flight fetches once superseded

  function buildModal() {
    modal = document.createElement('div');
    modal.className = 'aico-quick-add-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', t('matrix_aria', 'Choose sizes and quantities'));
    modal.hidden = true;

    var backdrop = document.createElement('div');
    backdrop.className = 'aico-quick-add-modal-backdrop';
    backdrop.setAttribute('data-aico-quick-add-close', '');
    modal.appendChild(backdrop);

    var panel = document.createElement('div');
    panel.className = 'aico-quick-add-modal-panel';
    panel.setAttribute('role', 'document');
    modal.appendChild(panel);

    var head = document.createElement('div');
    head.className = 'aico-quick-add-modal-head';
    panel.appendChild(head);

    var title = document.createElement('a');
    title.className = 'aico-quick-add-modal-title';
    head.appendChild(title);

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'aico-quick-add-modal-x';
    close.setAttribute('data-aico-quick-add-close', '');
    close.setAttribute('aria-label', t('close', 'Close'));
    close.innerHTML = '&times;';
    head.appendChild(close);

    var body = document.createElement('div');
    body.className = 'aico-quick-add-modal-body';
    panel.appendChild(body);

    modal.addEventListener('click', function (event) {
      var target = event.target;
      if (target && target.closest && target.closest('[data-aico-quick-add-close]')) {
        closeModal();
      }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && modal && !modal.hidden) {
        closeModal();
      }
    });

    document.body.appendChild(modal);
    refs = { panel: panel, title: title, body: body, close: close };
  }

  function openModal(trigger) {
    if (!modal) {
      buildModal();
    }
    lastTrigger = trigger;
    modal.hidden = false;
    document.documentElement.classList.add('aico-no-scroll');
    document.body.classList.add('aico-no-scroll');
    refs.close.focus();
  }

  function closeModal() {
    if (!modal || modal.hidden) {
      return;
    }
    openToken++;
    modal.hidden = true;
    document.documentElement.classList.remove('aico-no-scroll');
    document.body.classList.remove('aico-no-scroll');
    if (lastTrigger && typeof lastTrigger.focus === 'function') {
      lastTrigger.focus();
    }
    lastTrigger = null;
  }

  // ---- States -----------------------------------------------------------

  // Loading state — a STRUCTURAL placeholder for the matrix, not a generic
  // shimmer. The modal sits in an `align-items: center` overlay, so any
  // difference between the loading height and the loaded height makes the
  // panel jump AND re-centre when the payload lands. The old skeleton was one
  // flat row of eight blocks (~3.5rem) in front of a ~22.7rem matrix.
  //
  // So this mirrors the final DOM piece for piece — toolbar, the real
  // .aico-pdp-size-grid (same columns, same 3.25rem cell height), total row,
  // submit button — with the cell count taken from the product's real variant
  // count. The body also keeps a min-height of whatever the skeleton measured,
  // so a wrong guess can only make the panel grow, never shrink.
  function renderLoading(trigger) {
    refs.body.style.minHeight = '';
    refs.body.innerHTML = '';

    // Toolbar and total row are built from the SAME functions the loaded state
    // uses — they depend on the page config and the cart, not on the payload,
    // so they can be final already and contribute zero height difference.
    var toolbar = buildToolbar();
    Array.prototype.forEach.call(toolbar.tabs.querySelectorAll('button'), function (tab) {
      tab.disabled = true;
    });
    toolbar.toolbar.setAttribute('aria-hidden', 'true');
    refs.body.appendChild(toolbar.toolbar);

    // The grid is the real .aico-pdp-size-grid (same column counts at the same
    // breakpoints) filled with real-metric cells, so N skeleton cells occupy
    // exactly the rows N real cells will.
    var grid = document.createElement('div');
    grid.className = 'aico-pdp-size-grid';
    var cells = skeletonCellCount(trigger);
    for (var i = 0; i < cells; i++) {
      var cell = document.createElement('span');
      cell.className = 'aico-pdp-size-cell aico-quick-add-skeleton-cell';
      cell.setAttribute('aria-hidden', 'true');
      var label = document.createElement('span');
      label.className = 'aico-quick-add-skeleton-label skeleton-block';
      cell.appendChild(label);
      var qty = document.createElement('span');
      qty.className = 'aico-quick-add-skeleton-qty skeleton-block';
      cell.appendChild(qty);
      grid.appendChild(cell);
    }
    refs.body.appendChild(grid);

    refs.body.appendChild(buildTotalRow().total);

    var submit = document.createElement('span');
    submit.className = 'aico-quick-add-skeleton-submit skeleton-block';
    submit.setAttribute('aria-hidden', 'true');
    refs.body.appendChild(submit);

    var srText = document.createElement('span');
    srText.className = 'aico-sr-only';
    srText.setAttribute('role', 'status');
    srText.textContent = t('loading', 'Loading…');
    refs.body.appendChild(srText);

    // Lock the measured skeleton height in as a FLOOR for the loaded body: if
    // the guessed cell count was low, the panel grows; it can never shrink,
    // which is the jump shoppers actually notice (the modal is centred in the
    // overlay, so a height change moves the whole panel).
    refs.body.style.minHeight = refs.body.offsetHeight + 'px';
  }

  // ---- Shared pieces (identical in the loading and loaded states) --------

  // Region tabs + size-guide link. Both come from the page config, so the
  // toolbar is final before the payload arrives.
  function buildToolbar() {
    var toolbar = document.createElement('div');
    toolbar.className = 'aico-quick-add-modal-toolbar';

    var tabs = document.createElement('div');
    tabs.className = 'aico-pdp-size-region-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', t('region_aria', 'Size system'));
    var startRegion = REGIONS.indexOf(config.sizeRegion) !== -1 ? config.sizeRegion : 'EU';
    REGIONS.forEach(function (region) {
      var tab = document.createElement('button');
      tab.type = 'button';
      tab.setAttribute('role', 'tab');
      tab.className = 'aico-pdp-size-region-tab' + (region === startRegion ? ' aico-pdp-size-region-tab-active' : '');
      tab.setAttribute('aria-selected', region === startRegion ? 'true' : 'false');
      tab.setAttribute('data-region', region);
      tab.textContent = t('tab_' + region.toLowerCase(), region);
      tabs.appendChild(tab);
    });
    toolbar.appendChild(tabs);

    // Size-chart link only when the theme setting points at a gallery file
    // (PDF / image / video) — nothing is rendered when it is unset.
    var guideUrl = String(config.sizeGuideUrl || '');
    if (guideUrl !== '') {
      var guideWrap = document.createElement('span');
      guideWrap.className = 'aico-pdp-size-guide-wrap';
      var guideLink = document.createElement('a');
      guideLink.className = 'aico-pdp-size-guide-link';
      guideLink.href = guideUrl;
      guideLink.target = '_blank';
      guideLink.rel = 'noopener noreferrer';
      guideLink.textContent = t('size_guide', 'Size guide');
      guideWrap.appendChild(guideLink);
      var guidePop = document.createElement('span');
      guidePop.className = 'aico-pdp-size-guide-pop';
      guidePop.setAttribute('role', 'tooltip');
      guidePop.textContent = t('size_guide_tooltip', '');
      guideWrap.appendChild(guidePop);
      toolbar.appendChild(guideWrap);
    }

    return { toolbar: toolbar, tabs: tabs, startRegion: startRegion };
  }

  function buildTotalRow() {
    var total = document.createElement('p');
    total.className = 'aico-pdp-size-total';
    total.appendChild(document.createTextNode(t('total', 'Total') + ' '));
    var totalValue = document.createElement('strong');
    totalValue.textContent = '0';
    total.appendChild(totalValue);
    return { total: total, totalValue: totalValue };
  }

  function renderNotice(message, productUrl) {
    // A notice is a different state, not a shorter matrix — drop the
    // skeleton's height floor rather than leave a mostly-empty tall panel.
    refs.body.style.minHeight = '';
    refs.body.innerHTML = '';
    var note = document.createElement('p');
    note.className = 'aico-quick-add-modal-notice';
    note.setAttribute('role', 'status');
    note.textContent = message;
    refs.body.appendChild(note);
    if (productUrl) {
      var link = document.createElement('a');
      link.className = 'aico-quick-add-view-link';
      link.href = productUrl;
      link.textContent = t('view_product', 'View product');
      refs.body.appendChild(link);
    }
  }

  // ---- Fetch ------------------------------------------------------------

  // The LEAN endpoint. No `locale` param — nothing in the payload is
  // translated (the size labels are mapped client-side, the title comes off
  // the card). Falls back to the Shopify product JSON only when the theme is
  // rendered by a backend that predates the quick-add route, in which case the
  // response is a superset and every field read below still resolves.
  function quickAddUrl(handle) {
    var template = String(config.quickAddUrlTemplate || '');
    if (template !== '') {
      return template.replace('__HANDLE__', encodeURIComponent(handle));
    }
    var legacy = String(config.productJsonUrlTemplate || '/products/__HANDLE__.js')
      .replace('__HANDLE__', encodeURIComponent(handle));
    return legacy + (legacy.indexOf('?') === -1 ? '?' : '&')
      + 'locale=' + encodeURIComponent(String(config.locale || ''));
  }

  // ---- Matrix -----------------------------------------------------------

  // In-cart quantity per variant id — the prefill FALLBACK, read from the
  // shared store's items when a full cart happens to be loaded (cart page).
  // The normal path passes a fresh per-product map fetched from
  // /cart/aico_product_status.js into renderMatrix instead: the store no
  // longer carries the full items array on catalog pages.
  function cartQuantities() {
    var store = cartStore();
    var items = store && store.data && Array.isArray(store.data.items) ? store.data.items : [];
    var map = {};
    items.forEach(function (line) {
      if (line.variant_id == null) {
        return;
      }
      var key = String(line.variant_id);
      map[key] = (map[key] || 0) + Number(line.quantity || 0);
    });
    return map;
  }

  function sizeVariants(product) {
    var variants = Array.isArray(product.variants) ? product.variants : [];
    return variants.filter(function (variant) {
      return variant && variant.aico_size_value != null && variant.aico_size_value !== '';
    });
  }

  function renderMatrix(product, trigger, inCartMap) {
    var productUrl = trigger.getAttribute('data-aico-url') || '';
    var variants = sizeVariants(product);

    // Products the matrix cannot represent (no size axis, or a second
    // option axis the modal has no picker for) fall back to the PDP.
    var optionCount = Array.isArray(product.options) ? product.options.length : 0;
    if (!product.aico_has_size_matrix || optionCount > 1 || variants.length === 0) {
      renderNotice(t('not_quick_addable', 'Choose the options on the product page.'), productUrl);
      return;
    }
    var anyAvailable = variants.some(function (variant) { return !!variant.available; });
    if (!anyAvailable) {
      renderNotice(t('sold_out', 'This product is currently sold out.'), productUrl);
      return;
    }

    // The shipping block belongs to the SHOPPER (customer.aico_shipping_block,
    // sourced from the debtor's crm_conditions), not to the product — so it
    // comes from the page's config blob and costs the payload nothing.
    var shippingBlocked = !!config.shippingBlocked;
    // Product-wide cap on the SUM across all variants — coexists with each
    // variant's own aico_max_quantity_per_order cap.
    var productMaxQty = Number(product.aico_max_quantity_per_order);
    if (isNaN(productMaxQty) || productMaxQty <= 0) {
      productMaxQty = null;
    }

    var inCart = inCartMap || cartQuantities();
    var charts = chartsFor(product);
    var gender = product.aico_production_gender || null;

    refs.body.innerHTML = '';

    // Toolbar: region tabs + size-guide link (same classes as the PDP) —
    // the SAME builder the loading skeleton already rendered.
    var toolbarParts = buildToolbar();
    var tabs = toolbarParts.tabs;
    var startRegion = toolbarParts.startRegion;
    refs.body.appendChild(toolbarParts.toolbar);

    // Size grid — mirrors the PDP cell markup so the theme.css matrix
    // styles apply unchanged.
    var grid = document.createElement('div');
    grid.className = 'aico-pdp-size-grid';
    var inputs = [];
    var initialByVariant = {};

    variants.forEach(function (variant) {
      var variantId = String(variant.id);
      var stock = Number(variant.aico_stock_amount);
      if (isNaN(stock) || stock < 0) {
        stock = 0;
      }
      var available = !!variant.available;
      var initial = Number(inCart[variantId] || 0);
      initialByVariant[variantId] = initial;

      // Cell markup mirrors templates/product.liquid's size cell exactly —
      // same classes, same qty-box + spinner column — so the modal and the
      // PDP matrix are visually identical and share theme.css.
      var cell = document.createElement('label');
      cell.className = 'aico-pdp-size-cell'
        + (available && stock > 0 ? ' aico-pdp-size-cell-in-stock' : (available ? ' aico-pdp-size-cell-available' : ' aico-pdp-size-cell-out'))
        + (initial > 0 ? ' aico-pdp-size-cell-in-cart' : '');
      cell.setAttribute('data-aico-size-cell', '');

      var label = document.createElement('span');
      label.className = 'aico-pdp-size-cell-label';
      label.setAttribute('data-aico-size-label', '');
      // EU → UK/US/MM mapped here from the bundled chart (or the product's own
      // override) instead of four label strings per variant in the payload.
      var labels = sizeLabels(variant.aico_size_value, charts, gender);
      REGIONS.forEach(function (region) {
        label.setAttribute(regionLabelAttr[region], labels[region]);
      });
      label.textContent = label.getAttribute(regionLabelAttr[startRegion]);
      cell.appendChild(label);

      var variantMax = Number(variant.aico_max_quantity_per_order);
      if (isNaN(variantMax) || variantMax <= 0) {
        variantMax = null;
      }
      var cellMax = (variantMax !== null && variantMax < stock) ? variantMax : stock;

      var qtyBox = document.createElement('span');
      qtyBox.className = 'aico-pdp-qty-box';
      qtyBox.setAttribute('data-aico-stepper', '');

      var input = document.createElement('input');
      input.type = 'number';
      input.className = 'aico-pdp-size-cell-input';
      input.min = '0';
      input.max = String(cellMax);
      input.step = '1';
      input.value = String(initial);
      input.inputMode = 'numeric';
      input.setAttribute('aria-label', t('qty_aria', 'Quantity'));
      input.setAttribute('data-aico-size-qty', '');
      input.setAttribute('data-aico-variant-id', variantId);
      input.setAttribute('data-aico-variant-stock', String(stock));
      if (variantMax !== null) {
        input.setAttribute('data-aico-variant-max', String(variantMax));
      }
      // Baseline for the "anything changed?" pre-flight — a zeroed cell that
      // started above 0 is a REMOVE, not a no-op (absolute semantics).
      input.setAttribute('data-aico-initial', String(initial));
      if (!available) {
        input.disabled = true;
      }
      qtyBox.appendChild(input);

      var spinners = document.createElement('span');
      spinners.className = 'aico-pdp-qty-box__spinners';
      spinners.setAttribute('aria-hidden', 'true');
      [
        { step: '1', label: t('increase', 'Increase quantity'), path: 'M1 4 L4 1 L7 4' },
        { step: '-1', label: t('decrease', 'Decrease quantity'), path: 'M1 1 L4 4 L7 1' }
      ].forEach(function (spec) {
        var stepButton = document.createElement('button');
        stepButton.type = 'button';
        stepButton.className = 'aico-pdp-qty-box__step';
        stepButton.setAttribute('data-aico-step', spec.step);
        stepButton.setAttribute('tabindex', '-1');
        stepButton.setAttribute('aria-label', spec.label);
        if (!available) {
          stepButton.disabled = true;
        }
        stepButton.innerHTML = '<svg viewBox="0 0 8 5" width="8" height="5" aria-hidden="true">'
          + '<path d="' + spec.path + '" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
          + '</svg>';
        spinners.appendChild(stepButton);
      });
      qtyBox.appendChild(spinners);
      cell.appendChild(qtyBox);

      var srStock = document.createElement('span');
      srStock.className = 'aico-pdp-size-cell-stock aico-sr-only';
      srStock.textContent = stock > 0 ? String(stock) : '—';
      cell.appendChild(srStock);

      grid.appendChild(cell);
      inputs.push(input);
    });
    refs.body.appendChild(grid);

    // Total row + max-qty note + footer (submit + hints).
    var totalParts = buildTotalRow();
    var total = totalParts.total;
    var totalValue = totalParts.totalValue;
    refs.body.appendChild(total);

    // Cap notice beside the total — same markup/classes as the PDP's
    // (templates/product.liquid), so theme.css styles both.
    var maxNote = document.createElement('span');
    maxNote.className = 'aico-pdp-max-note';
    maxNote.hidden = true;
    maxNote.setAttribute('role', 'status');
    var maxNoteText = document.createElement('span');
    maxNoteText.className = 'aico-pdp-max-note-text';
    maxNoteText.textContent = t('max_note_label', 'Max. order quantity reached');
    maxNote.appendChild(maxNoteText);
    var maxNoteInfo = document.createElement('span');
    maxNoteInfo.className = 'aico-pdp-max-note-info';
    var maxNoteToggle = document.createElement('button');
    maxNoteToggle.type = 'button';
    maxNoteToggle.className = 'aico-pdp-max-note-btn';
    maxNoteToggle.setAttribute('aria-expanded', 'false');
    maxNoteToggle.setAttribute('aria-label', t('max_note_label', 'Max. order quantity reached'));
    maxNoteToggle.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">'
      + '<circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/>'
      + '<line x1="8" y1="7.4" x2="8" y2="11.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'
      + '<circle cx="8" cy="4.7" r="0.9" fill="currentColor" stroke="none"/>'
      + '</svg>';
    maxNoteInfo.appendChild(maxNoteToggle);
    var maxNotePop = document.createElement('span');
    maxNotePop.className = 'aico-pdp-max-note-pop';
    maxNotePop.setAttribute('role', 'tooltip');
    maxNoteInfo.appendChild(maxNotePop);
    maxNote.appendChild(maxNoteInfo);
    total.appendChild(maxNote);
    maxNoteToggle.addEventListener('click', function (event) {
      event.preventDefault();
      var open = maxNoteToggle.getAttribute('aria-expanded') === 'true';
      maxNoteToggle.setAttribute('aria-expanded', open ? 'false' : 'true');
      maxNotePop.classList.toggle('is-open', !open);
    });
    document.addEventListener('click', function (event) {
      if (!maxNote.contains(event.target)) {
        maxNoteToggle.setAttribute('aria-expanded', 'false');
        maxNotePop.classList.remove('is-open');
      }
    });

    // Buy button — same markup/classes as the PDP's (icon + label span with
    // the add/update label pair). It is NEVER hard-`disabled` for "nothing
    // selected": that state is the inactive/ghost variant with the reason on
    // hover, exactly like product-detail.js's syncButtonState.
    var submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'aico-pdp-buy-button aico-quick-add-submit';
    submit.setAttribute('data-aico-buy-button', '');
    submit.innerHTML = '<svg class="aico-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path>'
      + '<path d="M3 6h18"></path>'
      + '<path d="M16 10a4 4 0 0 1-8 0"></path>'
      + '</svg>';
    var submitLabel = document.createElement('span');
    submitLabel.setAttribute('data-aico-buy-label', '');
    var hasInitial = Object.keys(initialByVariant).some(function (key) { return initialByVariant[key] > 0; });
    submitLabel.textContent = shippingBlocked
      ? t('restricted', 'Restricted')
      : (hasInitial ? t('update_cart', 'Update cart') : t('add_to_cart', 'Add to cart'));
    submit.appendChild(submitLabel);
    if (shippingBlocked) {
      submit.disabled = true;
    }
    refs.body.appendChild(submit);

    if (shippingBlocked) {
      var blockedHint = document.createElement('p');
      blockedHint.className = 'aico-pdp-buy-hint aico-pdp-buy-hint-danger';
      blockedHint.textContent = t('shipping_blocked_hint', '');
      refs.body.appendChild(blockedHint);
    }

    // ---- Guard rails (ports of product-detail.js's matrix refresh) ----

    function maxQtyMessage(kind, count) {
      var template = kind === 'product'
        ? (cartT.max_quantity_product_reached || 'Maximum order quantity of {count} for this product reached.')
        : (cartT.max_quantity_reached || 'Maximum order quantity of {count} reached.');
      return template.replace('{count}', String(count));
    }

    function ceilingOf(input) {
      var stock = parseInt(input.getAttribute('data-aico-variant-stock'), 10);
      var variantMax = parseInt(input.getAttribute('data-aico-variant-max'), 10);
      var ceiling = isNaN(stock) ? 0 : stock;
      if (!isNaN(variantMax) && variantMax > 0 && variantMax < ceiling) {
        return { ceiling: variantMax, kind: 'variant', count: variantMax };
      }
      return { ceiling: ceiling, kind: null, count: null };
    }

    function clampInput(input) {
      var raw = parseInt(input.value, 10);
      if (isNaN(raw) || raw < 0) {
        raw = 0;
      }
      var limit = ceilingOf(input);
      var clampedByMax = null;
      if (raw > limit.ceiling) {
        raw = limit.ceiling;
        if (limit.kind === 'variant') {
          clampedByMax = limit.count;
        }
      }
      input.value = String(raw);
      return { value: raw, clampedByMax: clampedByMax };
    }

    // Reflect a computed ceiling on one input: the HTML max stops the
    // stepper, the "+" half goes inert (aria-disabled, not disabled — a
    // disabled button swallows the hover that explains why), and the reason
    // rides along as a title. Port of product-detail.js's applyQtyCeiling.
    function applyQtyCeiling(input, ceiling, kind, count) {
      var hasCeiling = typeof ceiling === 'number' && !isNaN(ceiling);
      if (hasCeiling && ceiling >= 0) {
        input.max = String(ceiling);
      }
      var value = parseInt(input.value, 10);
      if (isNaN(value)) {
        value = 0;
      }
      var reason = (hasCeiling && value >= ceiling && kind) ? maxQtyMessage(kind, count) : '';
      if (reason) {
        input.setAttribute('title', reason);
      } else {
        input.removeAttribute('title');
      }
      var box = input.closest ? input.closest('[data-aico-stepper]') : null;
      if (!box) {
        return;
      }
      if (reason) {
        box.setAttribute('title', reason);
      } else {
        box.removeAttribute('title');
      }
      // Soft orange wash while a CAP (not plain stock) binds — same class the
      // PDP matrix uses (product-detail.js).
      box.classList.toggle('aico-pdp-qty-box--at-max', !!reason && !input.disabled);
      var plus = box.querySelector('[data-aico-step="1"]');
      if (!plus || input.disabled) {
        return;
      }
      if (hasCeiling && value >= ceiling) {
        plus.setAttribute('aria-disabled', 'true');
      } else {
        plus.removeAttribute('aria-disabled');
      }
    }

    function isDirty() {
      return inputs.some(function (input) {
        var variantId = input.getAttribute('data-aico-variant-id');
        return Number(input.value || 0) !== Number(initialByVariant[variantId] || 0);
      });
    }

    // Inactive (ghost) button + hover reason, matching the PDP: the real
    // guard is the submit handler; this is the visual cue.
    function syncButtonState() {
      if (submit.hasAttribute('disabled')) {
        return;
      }
      var actionable = isDirty();
      submit.classList.toggle('aico-pdp-buy-button--inactive', !actionable);
      submit.setAttribute('aria-disabled', actionable ? 'false' : 'true');
      if (actionable) {
        submit.removeAttribute('title');
        return;
      }
      submit.setAttribute('title', hasInitial
        ? t('button_update_hint', 'No changes — adjust a quantity to update your cart.')
        : t('button_add_hint', 'Select a size to add it to your cart.'));
    }

    function refresh(event) {
      var sum = 0;
      inputs.forEach(function (input) {
        sum += clampInput(input).value;
      });

      // Product-wide cap (coexists with the per-variant caps): absolute
      // quantities, so the cap is the sum of the inputs — pull the edited
      // cell back.
      var productClamped = false;
      if (productMaxQty !== null && sum > productMaxQty) {
        var target = event && event.target && inputs.indexOf(event.target) !== -1 ? event.target : null;
        if (target) {
          var current = parseInt(target.value, 10) || 0;
          var next = Math.max(0, current - (sum - productMaxQty));
          target.value = String(next);
          sum -= (current - next);
        } else {
          for (var i = inputs.length - 1; i >= 0 && sum > productMaxQty; i--) {
            var value = parseInt(inputs[i].value, 10) || 0;
            var reduce = Math.min(value, sum - productMaxQty);
            inputs[i].value = String(value - reduce);
            sum -= reduce;
          }
        }
        productClamped = true;
      }

      totalValue.textContent = String(sum);

      var atProductCap = productMaxQty !== null && sum >= productMaxQty;
      var cappedSizes = [];
      inputs.forEach(function (input) {
        var value = parseInt(input.value, 10) || 0;
        var limit = ceilingOf(input);
        var ceiling = limit.ceiling;
        var kind = limit.kind;
        var count = limit.count;
        if (productMaxQty !== null) {
          var room = Math.max(0, productMaxQty - (sum - value));
          if (room <= ceiling) {
            ceiling = room;
            kind = 'product';
            count = productMaxQty;
          }
        }
        applyQtyCeiling(input, ceiling, kind, count);
        var cell = input.closest ? input.closest('.aico-pdp-size-cell') : null;
        if (cell) {
          // Cart-mirror accent follows the live value, like the PDP.
          cell.classList.toggle('aico-pdp-size-cell-in-cart', value > 0);
        }
        // A size feeds the note only when its OWN per-variant cap binds —
        // the product-wide cap gets a single summary line instead.
        var variantMax = parseInt(input.getAttribute('data-aico-variant-max'), 10);
        if (!isNaN(variantMax) && variantMax > 0 && !input.disabled && value >= variantMax) {
          var labelNode = cell ? cell.querySelector('.aico-pdp-size-cell-label') : null;
          cappedSizes.push({
            size: labelNode ? labelNode.textContent.trim() : '',
            max: variantMax
          });
        }
      });

      var lines = [];
      if (atProductCap || productClamped) {
        lines.push(t('max_note_product', 'This shoe has a max order quantity of {count}.')
          .replace('{count}', String(productMaxQty)));
      }
      cappedSizes.forEach(function (entry) {
        lines.push(t('max_note_variant', 'This shoe has a max order quantity of {count} for size {size}.')
          .replace('{count}', String(entry.max))
          .replace('{size}', entry.size));
      });
      maxNotePop.textContent = '';
      lines.forEach(function (line) {
        var row = document.createElement('span');
        row.className = 'aico-pdp-max-note-pop-line';
        row.textContent = line;
        maxNotePop.appendChild(row);
      });
      maxNote.hidden = lines.length === 0;
      if (lines.length === 0) {
        maxNoteToggle.setAttribute('aria-expanded', 'false');
        maxNotePop.classList.remove('is-open');
      }

      syncButtonState();
    }

    inputs.forEach(function (input) {
      input.addEventListener('input', refresh);
      input.addEventListener('change', refresh);
      input.addEventListener('blur', refresh);
    });

    // Stepper halves — clamp to the input's own min/max and re-dispatch so
    // refresh() recomputes. Port of product-detail.js's setupSteppers.
    Array.prototype.forEach.call(grid.querySelectorAll('[data-aico-stepper]'), function (box) {
      var input = box.querySelector('input[type="number"]');
      if (!input) {
        return;
      }
      Array.prototype.forEach.call(box.querySelectorAll('[data-aico-step]'), function (button) {
        button.addEventListener('click', function (event) {
          event.preventDefault();
          if (input.disabled || button.getAttribute('aria-disabled') === 'true') {
            return;
          }
          var step = parseInt(button.getAttribute('data-aico-step'), 10);
          if (isNaN(step)) {
            return;
          }
          var min = parseInt(input.getAttribute('min'), 10);
          var max = parseInt(input.getAttribute('max'), 10);
          var current = parseInt(input.value, 10);
          if (isNaN(current)) {
            current = isNaN(min) ? 0 : min;
          }
          var next = current + step;
          if (!isNaN(min) && next < min) {
            next = min;
          }
          if (!isNaN(max) && next > max) {
            next = max;
          }
          if (next === current) {
            return;
          }
          input.value = String(next);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        });
      });
    });

    // Region tab switching — swap every cell label from its data attrs.
    Array.prototype.forEach.call(tabs.querySelectorAll('[data-region]'), function (tab) {
      tab.addEventListener('click', function () {
        var region = tab.getAttribute('data-region');
        var attr = regionLabelAttr[region];
        if (!attr) {
          return;
        }
        Array.prototype.forEach.call(tabs.querySelectorAll('[data-region]'), function (other) {
          var on = other === tab;
          other.classList.toggle('aico-pdp-size-region-tab-active', on);
          other.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        Array.prototype.forEach.call(grid.querySelectorAll('[data-aico-size-label]'), function (span) {
          var next = span.getAttribute(attr);
          if (next != null && next !== '') {
            span.textContent = next;
          }
        });
      });
    });

    // Submit — the FULL matrix as absolute quantities (zeros included, so a
    // cleared size removes its line), exactly like the PDP's
    // buildMatrixUpdates → store.bulkUpdate → POST /cart/update.js. An
    // unchanged matrix is a silent no-op; the inactive button already
    // carries the reason on hover.
    submit.addEventListener('click', function () {
      if (!isDirty()) {
        return;
      }

      var store = cartStore();
      if (!store || typeof store.bulkUpdate !== 'function') {
        if (productUrl) {
          window.location.href = productUrl;
        }
        return;
      }

      var updates = {};
      inputs.forEach(function (input) {
        var variantId = input.getAttribute('data-aico-variant-id');
        if (!variantId) {
          return;
        }
        var qty = parseInt(input.value, 10);
        if (isNaN(qty) || qty < 0) {
          qty = 0;
        }
        updates[variantId] = qty;
      });

      submit.disabled = true;
      Promise.resolve(store.bulkUpdate(updates)).then(function (ok) {
        if (ok === false) {
          // The store already flashed cart.update_error; keep the modal
          // open so the shopper can retry.
          submit.removeAttribute('disabled');
          syncButtonState();
          return;
        }
        if (typeof store.flash === 'function') {
          store.flash(cartT.updated || 'Cart updated.', 'success');
        }
        closeModal();
      }).catch(function () {
        submit.removeAttribute('disabled');
        syncButtonState();
      });
    });

    refresh();
  }

  // ---- Open flow --------------------------------------------------------

  function openFor(trigger) {
    var handle = trigger.getAttribute('data-aico-handle');
    if (!handle) {
      return;
    }
    openModal(trigger);

    var title = trigger.getAttribute('data-aico-title') || '';
    var url = trigger.getAttribute('data-aico-url') || '';
    refs.title.textContent = title;
    if (url) {
      refs.title.setAttribute('href', url);
    } else {
      refs.title.removeAttribute('href');
    }

    renderLoading(trigger);
    var token = ++openToken;

    fetch(quickAddUrl(handle), { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('quick-add fetch failed: ' + response.status);
        }
        return response.json();
      })
      .then(function (product) {
        // Remember the real matrix size for this handle even if the modal was
        // closed meanwhile — the next open gets an exact skeleton. Only the
        // SIZED variants count: those are the cells the matrix draws.
        rememberCount(handle, sizeVariants(product).length);
        if (token !== openToken || modal.hidden) {
          return; // closed or superseded while loading
        }
        // Fresh per-product in-cart quantities for the prefill — the store
        // no longer holds the full items array on catalog pages.
        var store = cartStore();
        var statusPromise = store && typeof store.fetchProductStatus === 'function'
          ? store.fetchProductStatus(product.id)
          : Promise.resolve(null);
        return statusPromise.then(function (status) {
          if (token !== openToken || modal.hidden) {
            return;
          }
          renderMatrix(product, trigger, status && status.variants ? status.variants : null);
        });
      })
      .catch(function () {
        if (token !== openToken || modal.hidden) {
          return;
        }
        renderNotice(t('error', 'Could not load this product.'), url);
      });
  }

  // Delegated — covers both the server-rendered cards and the ones
  // products-page.js appends on infinite scroll.
  document.addEventListener('click', function (event) {
    var trigger = event.target && event.target.closest ? event.target.closest('[data-aico-quick-add]') : null;
    if (!trigger) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    openFor(trigger);
  });
})();
