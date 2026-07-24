// Card quick-add modal — the b2b-shop "buy from the product card" feature.
// A cart button on each listing/brand card (snippets/product-card) opens a
// modal with the SAME size matrix as the PDP (region tabs, size-guide link,
// per-size quantity inputs clamped to warehouse stock + PIM max-order
// caps, running total) and submits through the shared Alpine cart store.
//
// Same no-framework IIFE style as products-page.js; the modal DOM is built
// on first open (production-cockpit modal pattern) and reused. Variants +
// stock are NOT in the listing payload — the modal fetches the per-product
// JSON endpoint (`routes.aico_product_json_url`, /products/<handle>.js) on
// each open so stock is always fresh.
//
// Semantics: ABSOLUTE quantities, like the PDP matrix (`bulkUpdate()` →
// POST /cart/update.js). Inputs are PRE-FILLED from the current cart, so
// the matrix state mirrors the cart state for this product and submitting
// updates it; only variants the shopper actually changed are posted, so an
// untouched line is never rewritten (e.g. a line already above today's
// stock is left for the cart page's fix-quantities flow).
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

  function renderLoading() {
    refs.body.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'aico-quick-add-modal-loading';
    for (var i = 0; i < 8; i++) {
      var block = document.createElement('span');
      block.className = 'aico-quick-add-skeleton-cell skeleton-block';
      block.setAttribute('aria-hidden', 'true');
      wrap.appendChild(block);
    }
    var srText = document.createElement('span');
    srText.className = 'aico-sr-only';
    srText.textContent = t('loading', 'Loading…');
    wrap.appendChild(srText);
    refs.body.appendChild(wrap);
  }

  function renderNotice(message, productUrl) {
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

  function productJsonUrl(handle) {
    var template = String(config.productJsonUrlTemplate || '/products/__HANDLE__.js');
    var url = template.replace('__HANDLE__', encodeURIComponent(handle));
    var localeParam = 'locale=' + encodeURIComponent(String(config.locale || ''));
    return url + (url.indexOf('?') === -1 ? '?' : '&') + localeParam;
  }

  // ---- Matrix -----------------------------------------------------------

  // In-cart quantity per variant id — the prefill source. Reading the
  // shared store (not a fresh /cart.js fetch) keeps open instant; the
  // store is refreshed on every mutation and drawer open.
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

  function renderMatrix(product, trigger) {
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

    var shippingBlocked = !!product.aico_shipping_blocked;
    var productMaxAllVariants = !!product.aico_max_quantity_for_all_variants;
    var productMaxQty = Number(product.aico_max_quantity_per_order);
    if (isNaN(productMaxQty) || productMaxQty <= 0) {
      productMaxQty = null;
    }

    var inCart = cartQuantities();

    refs.body.innerHTML = '';

    // Toolbar: region tabs + size-guide link (same classes as the PDP).
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

    var guideWrap = document.createElement('span');
    guideWrap.className = 'aico-pdp-size-guide-wrap';
    var guideUrl = String(config.sizeGuideUrl || '');
    if (guideUrl !== '') {
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
    } else {
      var guideSoon = document.createElement('span');
      guideSoon.className = 'aico-pdp-size-guide-link aico-pdp-size-guide-link--disabled';
      guideSoon.setAttribute('tabindex', '0');
      guideSoon.setAttribute('aria-disabled', 'true');
      guideSoon.textContent = t('size_guide_soon', 'Size guide');
      guideWrap.appendChild(guideSoon);
      var guideSoonPop = document.createElement('span');
      guideSoonPop.className = 'aico-pdp-size-guide-pop';
      guideSoonPop.setAttribute('role', 'tooltip');
      guideSoonPop.textContent = t('size_guide_soon_tooltip', '');
      guideWrap.appendChild(guideSoonPop);
    }
    toolbar.appendChild(guideWrap);
    refs.body.appendChild(toolbar);

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

      var cell = document.createElement('label');
      cell.className = 'aico-pdp-size-cell'
        + (available && stock > 0 ? ' aico-pdp-size-cell-in-stock' : (available ? ' aico-pdp-size-cell-available' : ' aico-pdp-size-cell-out'));

      var label = document.createElement('span');
      label.className = 'aico-pdp-size-cell-label';
      label.setAttribute('data-aico-size-label', '');
      REGIONS.forEach(function (region) {
        var value = variant['aico_size_label_' + region.toLowerCase()];
        label.setAttribute(regionLabelAttr[region], (value != null && value !== '') ? String(value) : String(variant.aico_size_value));
      });
      label.textContent = label.getAttribute(regionLabelAttr[startRegion]);
      cell.appendChild(label);

      var variantMax = Number(variant.aico_max_quantity_per_order);
      if (isNaN(variantMax) || variantMax <= 0) {
        variantMax = null;
      }

      var input = document.createElement('input');
      input.type = 'number';
      input.className = 'aico-pdp-size-cell-input';
      input.min = '0';
      // A line already above today's stock keeps its cart value visible;
      // any edit clamps back to the real ceiling (see clampInput).
      input.max = String(Math.max(variantMax !== null ? Math.min(stock, variantMax) : stock, initial));
      input.step = '1';
      input.value = String(initial);
      input.inputMode = 'numeric';
      input.setAttribute('aria-label', t('qty_aria', 'Quantity'));
      input.setAttribute('data-aico-variant-id', variantId);
      input.setAttribute('data-aico-variant-stock', String(stock));
      if (variantMax !== null) {
        input.setAttribute('data-aico-variant-max', String(variantMax));
      }
      if (!available) {
        input.disabled = true;
      }
      cell.appendChild(input);
      grid.appendChild(cell);
      inputs.push(input);
    });
    refs.body.appendChild(grid);

    // Total row + max-qty note + footer (submit + hints).
    var total = document.createElement('p');
    total.className = 'aico-pdp-size-total';
    total.appendChild(document.createTextNode(t('total', 'Total') + ' '));
    var totalValue = document.createElement('strong');
    totalValue.textContent = '0';
    total.appendChild(totalValue);
    refs.body.appendChild(total);

    var maxNote = document.createElement('p');
    maxNote.className = 'aico-pdp-buy-hint aico-pdp-buy-hint-danger';
    maxNote.hidden = true;
    maxNote.setAttribute('role', 'status');
    refs.body.appendChild(maxNote);

    var submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'aico-pdp-buy-button aico-quick-add-submit';
    var hasInitial = Object.keys(initialByVariant).some(function (key) { return initialByVariant[key] > 0; });
    submit.textContent = shippingBlocked
      ? t('restricted', 'Restricted')
      : (hasInitial ? t('update_cart', 'Update cart') : t('add_to_cart', 'Add to cart'));
    submit.disabled = true;
    refs.body.appendChild(submit);

    if (shippingBlocked) {
      var blockedHint = document.createElement('p');
      blockedHint.className = 'aico-pdp-buy-hint aico-pdp-buy-hint-danger';
      blockedHint.textContent = t('shipping_blocked_hint', '');
      refs.body.appendChild(blockedHint);
    }

    var message = document.createElement('p');
    message.className = 'aico-pdp-buy-hint aico-pdp-buy-hint-danger';
    message.hidden = true;
    message.setAttribute('role', 'status');
    refs.body.appendChild(message);

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
        // The prefill may legitimately sit above today's stock — only an
        // EDIT is pulled back to the real ceiling.
        raw = limit.ceiling;
        if (limit.kind === 'variant') {
          clampedByMax = limit.count;
        }
      }
      input.value = String(raw);
      return { value: raw, clampedByMax: clampedByMax };
    }

    function isDirty() {
      return inputs.some(function (input) {
        var variantId = input.getAttribute('data-aico-variant-id');
        return Number(input.value || 0) !== Number(initialByVariant[variantId] || 0);
      });
    }

    function refresh(event) {
      var sum = 0;
      var variantClampMax = null;
      inputs.forEach(function (input) {
        var result = clampInput(input);
        sum += result.value;
        if (result.clampedByMax !== null) {
          variantClampMax = result.clampedByMax;
        }
      });

      // Product-wide cap ("for all variants"): absolute quantities, so the
      // cap is the sum of the inputs — pull the edited cell back.
      var productClamped = false;
      if (productMaxAllVariants && productMaxQty !== null && sum > productMaxQty) {
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

      var atProductCap = productMaxAllVariants && productMaxQty !== null && sum >= productMaxQty;
      inputs.forEach(function (input) {
        var value = parseInt(input.value, 10) || 0;
        var limit = ceilingOf(input);
        var ceiling = limit.ceiling;
        var kind = limit.kind;
        if (productMaxAllVariants && productMaxQty !== null) {
          var room = Math.max(0, productMaxQty - (sum - value));
          if (room <= ceiling) {
            ceiling = room;
            kind = 'product';
          }
        }
        var cell = input.closest ? input.closest('.aico-pdp-size-cell') : null;
        if (cell) {
          cell.classList.toggle('aico-pdp-size-cell-at-max', kind !== null && value >= ceiling);
        }
      });

      if (productClamped || atProductCap) {
        maxNote.textContent = maxQtyMessage('product', productMaxQty);
        maxNote.hidden = false;
      } else if (variantClampMax !== null) {
        maxNote.textContent = maxQtyMessage('variant', variantClampMax);
        maxNote.hidden = false;
      } else {
        maxNote.hidden = true;
      }

      if (!shippingBlocked) {
        submit.disabled = !isDirty();
      }
      message.hidden = true;
    }

    inputs.forEach(function (input) {
      input.addEventListener('input', refresh);
      input.addEventListener('change', refresh);
      input.addEventListener('blur', refresh);
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

    // Submit — only the CHANGED variants, absolute quantities (a zeroed
    // size removes its line; untouched lines are never posted).
    submit.addEventListener('click', function () {
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
        var qty = parseInt(input.value, 10);
        if (isNaN(qty) || qty < 0) {
          qty = 0;
        }
        if (qty !== Number(initialByVariant[variantId] || 0)) {
          updates[variantId] = qty;
        }
      });
      if (Object.keys(updates).length === 0) {
        message.textContent = t('select_quantity', 'Select at least one size first.');
        message.hidden = false;
        return;
      }

      submit.disabled = true;
      Promise.resolve(store.bulkUpdate(updates)).then(function (ok) {
        if (ok === false) {
          // The store already flashed cart.update_error; keep the modal
          // open so the shopper can retry.
          submit.disabled = false;
          return;
        }
        if (typeof store.flash === 'function') {
          store.flash(cartT.updated || 'Cart updated.', 'success');
        }
        closeModal();
      }).catch(function () {
        submit.disabled = false;
      });
    });

    refresh();

    var firstInput = inputs.filter(function (input) { return !input.disabled; })[0];
    if (firstInput) {
      firstInput.focus();
    }
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

    renderLoading();
    var token = ++openToken;

    fetch(productJsonUrl(handle), { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('quick-add fetch failed: ' + response.status);
        }
        return response.json();
      })
      .then(function (product) {
        if (token !== openToken || modal.hidden) {
          return; // closed or superseded while loading
        }
        renderMatrix(product, trigger);
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
