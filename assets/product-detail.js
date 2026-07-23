// PDP client-side glue. No frameworks, no build step — same IIFE style
// as `assets/theme.js`. Picks up its DOM targets lazily so a future
// snippet-based refactor doesn't need to change the script.
//
// Responsibilities:
//   1. Gallery — prev/next + thumb click → swap the active slide.
//   2. Option chips/dropdowns → resolve the matching variant id and
//      mirror it into the hidden `id` input (legacy mode only).
//   3. Size matrix — sum the per-size quantity inputs into "Total".
//   4. Add-to-cart / update-cart submit — routes through the shared cart
//      store (`Alpine.store('cart').add()`), which POSTs `/cart/add.js`,
//      updates the header badge + mini-cart contents, and opens the
//      drawer. Single-item adds flash `cart.added`; matrix submits
//      override with `cart.updated` so the toast shows the localised
//      "Warenkorb aktualisiert" copy. Falls back to a native form POST
//      to `routes.cart_add_url` (`/cart/add`) when Alpine is absent.

// Info tabs — specs / description switcher. Self-contained so it runs
// regardless of whether the buy form is present (the main IIFE below
// early-returns when there is no form).
(function setupInfoTabs() {
  'use strict';

  var tablist = document.querySelector('[data-aico-pdp-tabs]');
  if (!tablist) {
    return;
  }
  var tabs = Array.prototype.slice.call(tablist.querySelectorAll('[data-aico-pdp-tab]'));
  var panels = Array.prototype.slice.call(document.querySelectorAll('[data-aico-pdp-panel]'));
  if (tabs.length < 2) {
    // Nothing to switch between — leave the single panel as-is.
    return;
  }

  function activate(name) {
    tabs.forEach(function (tab) {
      var isActive = tab.getAttribute('data-aico-pdp-tab') === name;
      tab.classList.toggle('aico-pdp-tab-active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    panels.forEach(function (panel) {
      var isActive = panel.getAttribute('data-aico-pdp-panel') === name;
      panel.classList.toggle('aico-pdp-tab-panel-active', isActive);
      if (isActive) {
        panel.removeAttribute('hidden');
      } else {
        panel.setAttribute('hidden', '');
      }
    });
  }

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      activate(tab.getAttribute('data-aico-pdp-tab'));
    });
  });
})();

(function () {
  'use strict';

  var form = document.querySelector('[data-aico-pdp-buy]');
  if (!form) {
    return;
  }
  var hasMatrix = form.getAttribute('data-aico-has-size-matrix') === '1';

  // -------- Max order quantity (PIM "Max. Bestellmenge") -----------------
  //
  // Two modes, stamped by the template from the product drop:
  //   - data-aico-max-qty-all-variants="1": the product-level max caps the
  //     SUM across all the product's variants in the cart.
  //   - otherwise each matrix cell's data-aico-variant-max caps its own
  //     variant. The server clamps too (StorefrontCartController) — this
  //     is the visible, immediate guard.
  var productMaxAllVariants = form.getAttribute('data-aico-max-qty-all-variants') === '1';
  var productMaxQty = parseInt(form.getAttribute('data-aico-max-qty'), 10);
  if (isNaN(productMaxQty) || productMaxQty <= 0) {
    productMaxQty = null;
  }

  var maxQtyNote = form.querySelector('[data-aico-max-qty-note]');

  function maxQtyMessage(kind, count) {
    var fallback = kind === 'variant'
      ? 'Maximum order quantity of {count} per size reached.'
      : 'Maximum order quantity of {count} for this product reached.';
    var key = kind === 'variant' ? 'max_quantity_variant_reached' : 'max_quantity_reached';
    return getLocaleHint(key, fallback).replace('{count}', String(count));
  }

  function showMaxQtyNote(kind, count) {
    if (!maxQtyNote) return;
    maxQtyNote.textContent = maxQtyMessage(kind, count);
    maxQtyNote.hidden = false;
  }

  function hideMaxQtyNote() {
    if (maxQtyNote) maxQtyNote.hidden = true;
  }

  // Reflect a computed ceiling on ONE quantity input, so the cap is visible
  // before the user bumps into it: the HTML `max` stops the native spinner
  // (and the −/+ stepper the mirror themes wrap the input in), the "+" half
  // goes inert, and input/box/button carry the localized reason as a hover
  // title. The "+" is marked `aria-disabled` rather than `disabled` on
  // purpose — a disabled button swallows hover, and the tooltip is the whole
  // point. `kind` is null when plain warehouse stock is the binding
  // constraint: nothing max-order-quantity-specific to explain there.
  function applyQtyCeiling(input, ceiling, kind, count) {
    var hasCeiling = typeof ceiling === 'number' && !isNaN(ceiling);
    var min = parseInt(input.getAttribute('min'), 10);
    if (hasCeiling && (isNaN(min) || ceiling >= min)) {
      input.max = String(ceiling);
    }
    var value = parseInt(input.value, 10);
    if (isNaN(value)) {
      value = 0;
    }
    var message = (hasCeiling && value >= ceiling && kind) ? maxQtyMessage(kind, count) : '';

    if (message) {
      input.setAttribute('title', message);
    } else {
      input.removeAttribute('title');
    }

    var box = input.closest ? input.closest('[data-aico-stepper]') : null;
    if (!box) {
      return;
    }
    if (message) {
      box.setAttribute('title', message);
    } else {
      box.removeAttribute('title');
    }
    var plus = box.querySelector('[data-aico-step="1"]');
    if (!plus || input.disabled) {
      return;
    }
    if (hasCeiling && value >= ceiling) {
      plus.setAttribute('aria-disabled', 'true');
    } else {
      plus.removeAttribute('aria-disabled');
    }
    if (message) {
      plus.setAttribute('title', message);
    } else {
      plus.removeAttribute('title');
    }
  }

  // In-cart quantity for this product, summed across all its lines — read
  // from the shared Alpine cart store (already booted for the header
  // badge/mini-cart). 0 when the store isn't available yet.
  function inCartProductQuantity() {
    try {
      var store = window.Alpine && window.Alpine.store ? window.Alpine.store('cart') : null;
      var items = store && store.data && Array.isArray(store.data.items) ? store.data.items : [];
      var idInput = form.querySelector('input[name="product_id"]');
      var productId = idInput && idInput.value ? String(idInput.value) : null;
      if (!productId) return 0;
      return items.reduce(function (sum, line) {
        return String(line.product_id) === productId ? sum + Number(line.quantity || 0) : sum;
      }, 0);
    } catch (error) {
      return 0;
    }
  }

  // -------- Gallery ------------------------------------------------------

  (function setupGallery() {
    var gallery = document.querySelector('[data-aico-pdp-gallery]');
    if (!gallery) {
      return;
    }
    var frame = gallery.querySelector('.aico-pdp-gallery-frame');
    var slides = Array.prototype.slice.call(gallery.querySelectorAll('[data-aico-gallery-slide]'));
    var thumbs = Array.prototype.slice.call(gallery.querySelectorAll('[data-aico-gallery-thumb]'));
    var prev = gallery.querySelector('[data-aico-gallery-prev]');
    var next = gallery.querySelector('[data-aico-gallery-next]');
    var index = 0;
    // Slides can announce interest in activation changes (the 360 rotator
    // autoplays only while its slide is visible).
    var activateListeners = [];

    function activate(target) {
      // Wrap around so prev on slide 0 lands on the last slide. Mirrors
      // aico-commerce's `Carousel` behaviour without the loop option
      // (which has its own focus-ring oddities).
      var len = slides.length;
      if (len === 0) {
        return;
      }
      var nextIndex = ((target % len) + len) % len;
      slides.forEach(function (slide, i) {
        slide.classList.toggle('aico-pdp-gallery-slide-active', i === nextIndex);
      });
      thumbs.forEach(function (thumb, i) {
        thumb.classList.toggle('aico-pdp-gallery-thumb-active', i === nextIndex);
      });
      index = nextIndex;
      activateListeners.forEach(function (listener) { listener(nextIndex); });
    }

    function bindThumb(thumb) {
      thumb.addEventListener('click', function () {
        var raw = thumb.getAttribute('data-aico-gallery-index');
        var idx = parseInt(raw, 10);
        if (!isNaN(idx)) {
          activate(idx);
        }
      });
    }

    if (prev) {
      prev.addEventListener('click', function () { activate(index - 1); });
    }
    if (next) {
      next.addEventListener('click', function () { activate(index + 1); });
    }
    thumbs.forEach(bindThumb);

    // -------- 360° rotator -------------------------------------------------
    //
    // Port of b2b-shop's `Product360Rotator` + `useProduct360`: frames come
    // from the kybunjoya file server keyed by SKU; when available, an extra
    // slide + badge thumbnail are appended to the gallery. Autoplays while
    // the slide is active; pointer-drag scrubs frames (20px per frame, both
    // directions wrap around).
    var GET360_ENDPOINT = 'https://files.kybunjoya.swiss/product-images/get360.php';
    var GET360_PWD = 'XdvfS'; // ships in the public b2b-shop bundle today
    var AUTOROTATE_INTERVAL_MS = 100;
    var PIXELS_PER_FRAME = 20;

    var sku = gallery.getAttribute('data-aico-product-sku') || '';
    if (sku === '' || !frame || typeof fetch !== 'function') {
      return;
    }

    fetch(GET360_ENDPOINT + '?pwd=' + GET360_PWD + '&artno=' + encodeURIComponent(sku))
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        var frames = data && data.available && Array.isArray(data.imageurls) ? data.imageurls : [];
        if (frames.length === 0) {
          return;
        }
        frames.forEach(function (src) { new Image().src = src; });
        append360(frames);
      })
      .catch(function () { /* no 360 set for this product — nothing to do */ });

    function append360(frames) {
      var slideIndex = slides.length;
      var current = 0;
      var autoplayTimer = null;
      var dragging = false;
      var lastPointerX = 0;

      var slide = document.createElement('figure');
      slide.className = 'aico-pdp-gallery-slide aico-pdp-gallery-slide-360';
      slide.setAttribute('data-aico-gallery-slide', '');
      slide.setAttribute('data-aico-gallery-index', String(slideIndex));

      var img = document.createElement('img');
      img.src = frames[0];
      img.alt = '';
      img.draggable = false;
      slide.appendChild(img);

      var hint = document.createElement('span');
      hint.className = 'aico-pdp-360-hint';
      hint.textContent = gallery.getAttribute('data-aico-360-hint') || '';
      slide.appendChild(hint);

      frame.appendChild(slide);
      slides.push(slide);

      var thumbsWrap = gallery.querySelector('.aico-pdp-gallery-thumbs');
      if (!thumbsWrap) {
        thumbsWrap = document.createElement('div');
        thumbsWrap.className = 'aico-pdp-gallery-thumbs';
        thumbsWrap.setAttribute('role', 'tablist');
        frame.insertAdjacentElement('afterend', thumbsWrap);
      }
      var thumb = document.createElement('button');
      thumb.type = 'button';
      thumb.className = 'aico-pdp-gallery-thumb aico-pdp-gallery-thumb-360';
      thumb.setAttribute('data-aico-gallery-thumb', '');
      thumb.setAttribute('data-aico-gallery-index', String(slideIndex));
      thumb.setAttribute('aria-label', gallery.getAttribute('data-aico-360-aria') || '360°');
      thumb.innerHTML = '<span class="aico-pdp-thumb-360-label" aria-hidden="true">360°</span>';
      thumbsWrap.appendChild(thumb);
      thumbs.push(thumb);
      bindThumb(thumb);

      function showFrame(frameIndex) {
        var len = frames.length;
        current = ((frameIndex % len) + len) % len;
        img.src = frames[current];
      }

      function startAutoplay() {
        if (autoplayTimer !== null) {
          return;
        }
        autoplayTimer = window.setInterval(function () { showFrame(current + 1); }, AUTOROTATE_INTERVAL_MS);
      }

      function stopAutoplay() {
        if (autoplayTimer !== null) {
          window.clearInterval(autoplayTimer);
          autoplayTimer = null;
        }
      }

      activateListeners.push(function (activeIndex) {
        if (activeIndex === slideIndex) {
          startAutoplay();
        } else {
          stopAutoplay();
        }
      });

      slide.addEventListener('pointerdown', function (event) {
        stopAutoplay();
        hint.classList.add('aico-pdp-360-hint-hidden');
        dragging = true;
        lastPointerX = event.pageX;
        event.preventDefault();
      });
      document.addEventListener('pointermove', function (event) {
        if (!dragging) {
          return;
        }
        var delta = Math.round((event.pageX - lastPointerX) / PIXELS_PER_FRAME);
        if (delta !== 0) {
          showFrame(current + delta);
          lastPointerX = event.pageX;
        }
      });
      document.addEventListener('pointerup', function () { dragging = false; });
      document.addEventListener('pointercancel', function () { dragging = false; });
    }
  })();

  // -------- Size region tabs --------------------------------------------
  //
  // Each matrix cell carries `data-aico-label-{eu|uk|us|mm}` from
  // `ProductSizeRegionLabelService` — API `sizeCharts` when present,
  // otherwise Core shoe JSON (`core.*_shoes_size_chart`), matching
  // aico-commerce `getEffectiveSizeCharts` / `getSizeDisplayValueByRegion`.

  (function setupSizeRegionTabs() {
    var matrix = document.querySelector('[data-aico-size-matrix]');
    var tabs = Array.prototype.slice.call(form.querySelectorAll('[data-aico-size-region]'));
    if (tabs.length === 0 || matrix == null) {
      return;
    }

    var regionToAttr = {
      EU: 'data-aico-label-eu',
      UK: 'data-aico-label-uk',
      US: 'data-aico-label-us',
      MM: 'data-aico-label-mm'
    };

    function applyRegion(region) {
      var attr = regionToAttr[region];
      if (!attr) {
        return;
      }
      Array.prototype.forEach.call(matrix.querySelectorAll('[data-aico-size-label]'), function (span) {
        var next = span.getAttribute(attr);
        if (next != null && next !== '') {
          span.textContent = next;
        }
      });
    }

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var region = tab.getAttribute('data-region');
        if (!region) {
          return;
        }
        tabs.forEach(function (other) {
          var on = other === tab;
          other.classList.toggle('aico-pdp-size-region-tab-active', on);
          other.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        applyRegion(region);
      });
    });

    var initial = tabs.filter(function (node) {
      return node.classList.contains('aico-pdp-size-region-tab-active');
    })[0];
    var startRegion = initial && initial.getAttribute('data-region') ? initial.getAttribute('data-region') : 'EU';
    applyRegion(startRegion);
  })();

  // -------- Option chips / legacy variant resolution ---------------------

  function readSelectedOptions() {
    var map = {};
    var inputs = form.querySelectorAll('[data-aico-option-input]');
    inputs.forEach(function (input) {
      var name = input.getAttribute('name');
      if (!name) {
        return;
      }
      // Names look like `options[Color]` — strip the wrapper.
      var match = name.match(/^options\[(.+)\]$/);
      var key = match ? match[1] : name;
      if (input.type === 'radio') {
        if (input.checked) {
          map[key] = input.value;
        }
      } else if (input.tagName === 'SELECT') {
        map[key] = input.value;
      }
    });
    return map;
  }

  // Legacy mode resolves the hidden `id` input from the user's option
  // picks. The variants list isn't embedded in the DOM as JSON — we
  // walk the matrix cells (if any) or rely on the form to post the
  // option map and let the backend resolve. For now: in matrix mode
  // each cell carries its own variant id, so we leave the resolution
  // alone. In legacy mode we resolve via a server round-trip after
  // submit (variant id stays empty client-side until cart-add lands).
  (function setupOptionMirror() {
    if (hasMatrix) {
      return;
    }
    var variantInput = form.querySelector('[data-aico-variant-id-input]');
    if (!variantInput) {
      return;
    }
    // TODO follow-up: embed a JSON map of `{ "option-tuple": variantId }`
    // and resolve on input. Today the field is left blank and the
    // backend's add-to-cart resolves from the `options[]` post body.
    var inputs = form.querySelectorAll('[data-aico-option-input]');
    inputs.forEach(function (input) {
      input.addEventListener('change', function () {
        // Cleared selection blanks the resolved id so the form does
        // not POST a stale variant id.
        variantInput.value = '';
      });
    });
  })();

  // -------- Size matrix total -------------------------------------------

  (function setupMatrixTotal() {
    if (!hasMatrix) {
      return;
    }
    var inputs = Array.prototype.slice.call(form.querySelectorAll('[data-aico-size-qty]'));
    var totalNode = form.querySelector('[data-aico-size-total-value]');
    if (inputs.length === 0 || !totalNode) {
      return;
    }

    function variantMaxOf(input) {
      var max = parseInt(input.getAttribute('data-aico-variant-max'), 10);
      return (!isNaN(max) && max > 0) ? max : null;
    }

    // Clamp one cell to the stricter of its warehouse stock and its
    // per-variant max order quantity. Reports whether the MAX (not stock)
    // was the binding constraint so the notice only fires for the cap.
    function clamp(input) {
      var stock = parseInt(input.getAttribute('data-aico-variant-stock'), 10);
      var variantMax = variantMaxOf(input);
      var raw = parseInt(input.value, 10);
      if (isNaN(raw) || raw < 0) {
        raw = 0;
      }
      var clampedByMax = null;
      if (!isNaN(stock) && raw > stock) {
        raw = stock;
      }
      if (variantMax !== null && raw > variantMax) {
        raw = variantMax;
        clampedByMax = variantMax;
      }
      input.value = String(raw);
      return { value: raw, clampedByMax: clampedByMax };
    }

    function refresh(event) {
      var total = 0;
      var variantClampMax = null;
      inputs.forEach(function (input) {
        var result = clamp(input);
        total += result.value;
        if (result.clampedByMax !== null) {
          variantClampMax = result.clampedByMax;
        }
      });

      // Product-wide cap ("for all variants"): the matrix posts ABSOLUTE
      // quantities for every variant (pre-filled from the cart), so the cap
      // is simply the sum of the inputs — pull the just-edited cell back by
      // the overflow.
      var productClamped = false;
      if (productMaxAllVariants && productMaxQty !== null && total > productMaxQty) {
        var target = event && event.target && inputs.indexOf(event.target) !== -1 ? event.target : null;
        if (!target) {
          // No known edit target (initial pass): trim cells from the end.
          for (var i = inputs.length - 1; i >= 0 && total > productMaxQty; i--) {
            var value = parseInt(inputs[i].value, 10) || 0;
            var reduce = Math.min(value, total - productMaxQty);
            inputs[i].value = String(value - reduce);
            total -= reduce;
          }
        } else {
          var current = parseInt(target.value, 10) || 0;
          var next = Math.max(0, current - (total - productMaxQty));
          target.value = String(next);
          total -= (current - next);
        }
        productClamped = true;
      }

      totalNode.textContent = String(total);

      // Per-cell state: in-cart accent, the cell's own ceiling and the at-cap
      // visual, plus the localized notice. The server only stamps
      // `aico-pdp-size-cell-in-cart` at page load, so zeroing a size (or
      // typing into a new one) must re-evaluate the border here. The ceiling
      // is the strictest of warehouse stock, the cell's own cap and the
      // head-room left under the product-wide cap (the total minus what this
      // very cell already contributes) — stamping it on the input is what
      // stops the increment BEFORE the value has to be pulled back.
      var atProductCap = productMaxAllVariants && productMaxQty !== null && total >= productMaxQty;
      inputs.forEach(function (input) {
        var value = parseInt(input.value, 10) || 0;
        var variantMax = variantMaxOf(input);
        var stock = parseInt(input.getAttribute('data-aico-variant-stock'), 10);
        var ceiling = isNaN(stock) ? null : stock;
        var kind = null;
        var count = null;
        if (variantMax !== null && (ceiling === null || variantMax <= ceiling)) {
          ceiling = variantMax;
          kind = 'variant';
          count = variantMax;
        }
        if (productMaxAllVariants && productMaxQty !== null) {
          var room = Math.max(0, productMaxQty - (total - value));
          if (ceiling === null || room <= ceiling) {
            ceiling = room;
            kind = 'product';
            count = productMaxQty;
          }
        }
        applyQtyCeiling(input, ceiling, kind, count);

        var cell = input.closest('[data-aico-size-cell]');
        if (cell) {
          cell.classList.toggle('aico-pdp-size-cell-in-cart', value > 0);
          cell.classList.toggle('aico-pdp-size-cell-at-max', kind !== null && value >= ceiling);
        }
      });

      if (productClamped || atProductCap) {
        showMaxQtyNote('product', productMaxQty);
      } else if (variantClampMax !== null) {
        showMaxQtyNote('variant', variantClampMax);
      } else {
        hideMaxQtyNote();
      }
    }

    inputs.forEach(function (input) {
      input.addEventListener('input', refresh);
      input.addEventListener('change', refresh);
      // Mark step buttons (browser native) with a clamp so the user
      // can't tap past the max stock.
      input.addEventListener('blur', refresh);
    });
    refresh();
  })();

  // -------- Legacy-mode max clamp ---------------------------------------
  //
  // The non-matrix stepper ADDS to the cart (increment semantics), so the
  // room left is the cap minus what the cart already holds. Two caps can
  // apply here:
  //   - product-wide ("for all variants"): the cap covers every line of the
  //     product, which is exactly what inCartProductQuantity() sums;
  //   - per-variant: only knowable client-side when the product has NO
  //     option axis — one variant, its id pre-filled, so the product's cart
  //     quantity IS that variant's. The template stamps the cap onto the
  //     input in that case. With options the variant is resolved
  //     server-side, so there the server clamp stays the only guard.
  var legacyMaxClamp = null;
  (function setupLegacyMaxQty() {
    if (hasMatrix) {
      return;
    }
    var qtyInput = form.querySelector('[data-aico-qty-input]');
    if (!qtyInput) {
      return;
    }
    var variantMax = parseInt(qtyInput.getAttribute('data-aico-variant-max'), 10);
    if (isNaN(variantMax) || variantMax <= 0) {
      variantMax = null;
    }
    var capKind = null;
    var cap = null;
    if (productMaxAllVariants && productMaxQty !== null) {
      capKind = 'product';
      cap = productMaxQty;
    } else if (variantMax !== null) {
      capKind = 'variant';
      cap = variantMax;
    }
    if (capKind === null) {
      return;
    }
    var buyButton = form.querySelector('[data-aico-buy-button]');
    var buttonInitiallyDisabled = !!(buyButton && buyButton.hasAttribute('disabled'));

    function clampLegacy() {
      var room = Math.max(0, cap - inCartProductQuantity());
      if (room <= 0) {
        if (buyButton) {
          buyButton.setAttribute('disabled', 'disabled');
        }
        applyQtyCeiling(qtyInput, 0, capKind, cap);
        showMaxQtyNote(capKind, cap);
        return;
      }
      if (buyButton && !buttonInitiallyDisabled) {
        buyButton.removeAttribute('disabled');
      }
      var value = parseInt(qtyInput.value, 10);
      if (isNaN(value) || value < 1) {
        value = 1;
      }
      if (value > room) {
        value = room;
        qtyInput.value = String(room);
      }
      applyQtyCeiling(qtyInput, room, capKind, cap);
      if (value >= room) {
        showMaxQtyNote(capKind, cap);
      } else {
        hideMaxQtyNote();
      }
    }

    legacyMaxClamp = clampLegacy;
    qtyInput.addEventListener('input', clampLegacy);
    qtyInput.addEventListener('change', clampLegacy);
    // The Alpine cart store hydrates asynchronously after load — re-run
    // once it has had a chance to fetch the cart.
    setTimeout(clampLegacy, 1000);
    clampLegacy();
  })();

  // -------- Quantity steppers (− / +) -----------------------------------
  //
  // Wire the −/+ buttons that wrap every quantity input — the size-matrix
  // cells and the legacy single-quantity field. Each step clamps to the
  // input's own min/max (max = warehouse stock) and dispatches
  // input+change so the matrix total recomputes via setupMatrixTotal.

  (function setupSteppers() {
    var steppers = Array.prototype.slice.call(form.querySelectorAll('[data-aico-stepper]'));
    if (steppers.length === 0) {
      return;
    }
    steppers.forEach(function (stepper) {
      var input = stepper.querySelector('input[type="number"]');
      if (!input) {
        return;
      }
      var buttons = Array.prototype.slice.call(stepper.querySelectorAll('[data-aico-step]'));
      buttons.forEach(function (button) {
        button.addEventListener('click', function () {
          // `aria-disabled` (not the disabled attribute) is how a step goes
          // inert at a cap — a disabled button would swallow the hover that
          // shows the reason, so the no-op lives here instead.
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
  })();

  // -------- Add-to-cart / update-cart submit ----------------------------

  // Parse the LEGACY (non-matrix) buy form into the `add()` payload the
  // cart store expects: a single `{ id, quantity }`. Matrix posts use
  // buildMatrixUpdates() instead (absolute-quantity semantics). Mirrors
  // the FormData parsing in `cart.js`'s global `[data-aico-cart-add]`
  // delegate so both add paths agree.
  function buildAddPayload() {
    var data = new FormData(form);
    if (data.has('id') && data.has('quantity')) {
      var id = data.get('id');
      var quantity = Number(data.get('quantity'));
      if (id && quantity > 0) {
        return { id: Number(id), quantity: quantity };
      }
    }
    return null;
  }

  // Parse the size-matrix cells into `{ variantId: absoluteQty }` for
  // store.bulkUpdate() → /cart/update.js (postUpdateJson). The matrix
  // posts ABSOLUTE line quantities, so zeros are INCLUDED — a 0 removes
  // that variant's line. The variant id comes from each cell's
  // `data-aico-variant-id` (the cell's `name` is `updates[<variantId>]`
  // for the no-JS `/cart/update` fallback; bulkUpdate keys by variant id).
  function buildMatrixUpdates() {
    var updates = {};
    Array.prototype.forEach.call(
      form.querySelectorAll('[data-aico-size-qty]'),
      function (input) {
        var variantId = input.getAttribute('data-aico-variant-id');
        if (!variantId) {
          return;
        }
        var qty = parseInt(input.value, 10);
        if (isNaN(qty) || qty < 0) {
          qty = 0;
        }
        // Absolute semantics: keep zeros so a cleared size removes its line.
        updates[variantId] = qty;
      }
    );
    return updates;
  }

  form.addEventListener('submit', function (event) {
    // This handler owns the buy form's submit end-to-end. Stop the event
    // here so cart.js's document-level [data-aico-cart-add] delegate does
    // not ALSO handle it (preventDefault doesn't stop bubbling) — that
    // double-handling added every line twice (store.add + delegate add).
    event.stopPropagation();

    // Re-apply the max-order-quantity clamp against the latest cart
    // contents before anything is posted (legacy add semantics).
    if (legacyMaxClamp) {
      legacyMaxClamp();
    }

    // Pre-flight: in matrix mode we need at least one row > 0; in
    // legacy mode we need at least one option resolved. The browser's
    // native required-field handling covers some of this, but matrix
    // mode is too dynamic for plain HTML constraints.
    if (hasMatrix) {
      // Matrix posts set ABSOLUTE quantities (mirror-cart semantics). Allow
      // the submit when something is selected OR when the shopper changed a
      // cell away from its prefilled cart value — including zeroing a size
      // out to remove it. Only block when nothing is selected and nothing
      // changed (empty cart, no picks).
      var sizeInputs = Array.prototype.slice.call(form.querySelectorAll('[data-aico-size-qty]'));
      var anySelected = sizeInputs.some(function (input) {
        var n = parseInt(input.value, 10);
        return !isNaN(n) && n > 0;
      });
      var anyChanged = sizeInputs.some(function (input) {
        var n = parseInt(input.value, 10);
        var initial = parseInt(input.getAttribute('data-aico-initial'), 10);
        if (isNaN(n)) { n = 0; }
        if (isNaN(initial)) { initial = 0; }
        return n !== initial;
      });
      if (!anySelected && !anyChanged) {
        event.preventDefault();
        renderError('select_quantity');
        return;
      }
    }

    // Progressive enhancement: route through the shared cart store so the
    // single source of truth (`Alpine.store('cart')`) mutates — header
    // badge, mini-cart contents, toast and drawer all update reactively,
    // with no page navigation. Matrix mode sets ABSOLUTE line quantities
    // via store.bulkUpdate() (/cart/update.js); legacy mode ADDS via
    // store.add() (/cart/add.js). If Alpine/the store is absent, fall
    // through to the native form POST (302) so no-JS still works.
    var store = window.Alpine && window.Alpine.store ? window.Alpine.store('cart') : null;
    var storeMethod = hasMatrix ? 'bulkUpdate' : 'add';
    if (!store || typeof store[storeMethod] !== 'function') {
      return; // let the browser submit the form normally
    }

    event.preventDefault();

    var button = form.querySelector('[data-aico-buy-button]');
    if (button) {
      button.setAttribute('disabled', 'disabled');
    }

    var result;
    if (hasMatrix) {
      // Absolute update: { variantId: qty }, zeros included (0 removes).
      result = store.bulkUpdate(buildMatrixUpdates());
    } else {
      var payload = buildAddPayload();
      if (!payload) {
        // Nothing addable parsed (e.g. legacy variant not yet resolved):
        // surface the same "select a size/option" hint, no network call.
        if (button) {
          button.removeAttribute('disabled');
        }
        renderError('select_quantity');
        return;
      }
      result = store.add(payload);
    }

    Promise.resolve(result).then(function (ok) {
      // The add() path flashes its own cart.added toast. The matrix
      // bulkUpdate() path does not, so flash cart.updated ("Warenkorb
      // aktualisiert") here on success.
      if (ok !== false && hasMatrix && typeof store.flash === 'function') {
        var cartT = (window.__AICO_T__ && window.__AICO_T__.cart) || {};
        store.flash(cartT.updated || 'Cart updated.', 'success');
      }
      if (ok !== false && hasMatrix) {
        syncMatrixBaseline();
      }
      // Clear any stale inline pre-flight message.
      clearMessage();
    }).catch(function () {
      // The store methods resolve rather than reject on failure, but guard
      // against unexpected throws so the button never stays disabled.
      renderError('error');
    }).then(function () {
      if (button) {
        button.removeAttribute('disabled');
      }
      // The cart contents changed — re-derive the room left under the
      // product-wide max (may disable the button when the cap is hit).
      if (legacyMaxClamp) {
        legacyMaxClamp();
      }
    });
  });

  function renderError(kind) {
    var hint = form.querySelector('[data-aico-pdp-message]') || createMessage();
    hint.textContent = messageFor(kind);
    hint.dataset.kind = 'error';
  }

  // After a successful bulk update the cart holds exactly what the matrix
  // shows, so re-baseline the inputs (data-aico-initial feeds the "anything
  // changed?" pre-flight) and flip the button label between "Add to cart"
  // and "Update cart" to match the new cart state (server only stamps the
  // label at render time).
  function syncMatrixBaseline() {
    var anyInCart = false;
    Array.prototype.slice.call(form.querySelectorAll('[data-aico-size-qty]')).forEach(function (input) {
      var n = parseInt(input.value, 10);
      if (isNaN(n) || n < 0) { n = 0; }
      input.setAttribute('data-aico-initial', String(n));
      if (n > 0) { anyInCart = true; }
    });
    var label = form.querySelector('[data-aico-buy-label]');
    if (label) {
      var next = label.getAttribute(anyInCart ? 'data-label-update' : 'data-label-add');
      if (next) { label.textContent = next; }
    }
  }

  // Successful adds surface via the cart store's toast now, so clear any
  // leftover inline pre-flight message instead of writing a success line.
  function clearMessage() {
    var hint = form.querySelector('[data-aico-pdp-message]');
    if (hint && hint.parentNode) {
      hint.parentNode.removeChild(hint);
    }
  }

  function createMessage() {
    var p = document.createElement('p');
    p.className = 'aico-pdp-buy-hint aico-pdp-buy-hint-info';
    p.setAttribute('data-aico-pdp-message', '');
    p.setAttribute('role', 'status');
    form.appendChild(p);
    return p;
  }

  // Tiny in-script copy table. The backend's localised copy is the
  // source of truth for any string the user sees on first render;
  // these are post-submit-only fallbacks, kept inline so the script
  // ships in a single file.
  function messageFor(kind) {
    if (kind === 'select_quantity') {
      return getLocaleHint('select_quantity', 'Select at least one size first.');
    }
    return getLocaleHint('error', 'Could not add to cart.');
  }

  function getLocaleHint(key, fallback) {
    // The template stamps localised strings into a JSON blob the script
    // reads on demand. Defined as a script-level constant so we don't
    // pay for a DOM lookup per call.
    if (!window.AICO_PDP_LOCALE || !window.AICO_PDP_LOCALE[key]) {
      return fallback;
    }
    return window.AICO_PDP_LOCALE[key];
  }

  // -------- Colour-sibling strip -----------------------------------------
  // Single row under the add-to-cart block (templates/product.liquid).
  // Native overflow-x already handles touch panning; this adds
  // vertical-wheel → horizontal scroll and mouse drag-to-scroll (the
  // legacy b2b-shop strip was a free-mode swiper). Clicks still navigate:
  // they are only suppressed after an actual drag.

  (function setupColorStrip() {
    var strip = document.querySelector('[data-aico-color-strip]');
    if (!strip) {
      return;
    }

    strip.addEventListener('wheel', function (event) {
      if (strip.scrollWidth <= strip.clientWidth) {
        return;
      }
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
        return; // trackpads already scroll horizontally
      }
      strip.scrollLeft += event.deltaY;
      event.preventDefault();
    }, { passive: false });

    var pointerDown = false;
    var dragged = false;
    var startX = 0;
    var startScrollLeft = 0;

    strip.addEventListener('pointerdown', function (event) {
      if (event.pointerType !== 'mouse') {
        return; // touch pans natively
      }
      pointerDown = true;
      dragged = false;
      startX = event.clientX;
      startScrollLeft = strip.scrollLeft;
    });

    strip.addEventListener('pointermove', function (event) {
      if (!pointerDown) {
        return;
      }
      var delta = event.clientX - startX;
      if (!dragged) {
        if (Math.abs(delta) < 5) {
          return; // still a click, not a drag
        }
        dragged = true;
        strip.classList.add('aico-pdp-color-strip-dragging');
        try { strip.setPointerCapture(event.pointerId); } catch (e) { /* noop */ }
      }
      strip.scrollLeft = startScrollLeft - delta;
    });

    function endDrag() {
      if (!pointerDown) {
        return;
      }
      pointerDown = false;
      strip.classList.remove('aico-pdp-color-strip-dragging');
    }
    strip.addEventListener('pointerup', endDrag);
    strip.addEventListener('pointercancel', endDrag);

    // After a drag, swallow the click so the tile under the cursor
    // doesn't navigate; plain clicks (and keyboard activation on the
    // tabbable tiles) pass through untouched.
    strip.addEventListener('click', function (event) {
      if (dragged) {
        event.preventDefault();
        event.stopPropagation();
        dragged = false;
      }
    }, true);

    // Links are draggable by default; a native HTML5 drag would eat the
    // pointermove stream mid-drag.
    strip.addEventListener('dragstart', function (event) {
      event.preventDefault();
    });
  })();
})();
