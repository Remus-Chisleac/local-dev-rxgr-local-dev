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

  // -------- Gallery ------------------------------------------------------

  (function setupGallery() {
    var gallery = document.querySelector('[data-aico-pdp-gallery]');
    if (!gallery) {
      return;
    }
    var slides = Array.prototype.slice.call(gallery.querySelectorAll('[data-aico-gallery-slide]'));
    var thumbs = Array.prototype.slice.call(gallery.querySelectorAll('[data-aico-gallery-thumb]'));
    var prev = gallery.querySelector('[data-aico-gallery-prev]');
    var next = gallery.querySelector('[data-aico-gallery-next]');
    var index = 0;

    if (slides.length <= 1) {
      return;
    }

    function activate(target) {
      // Wrap around so prev on slide 0 lands on the last slide. Mirrors
      // aico-commerce's `Carousel` behaviour without the loop option
      // (which has its own focus-ring oddities).
      var len = slides.length;
      var next = ((target % len) + len) % len;
      slides.forEach(function (slide, i) {
        slide.classList.toggle('aico-pdp-gallery-slide-active', i === next);
      });
      thumbs.forEach(function (thumb, i) {
        thumb.classList.toggle('aico-pdp-gallery-thumb-active', i === next);
      });
      index = next;
    }

    if (prev) {
      prev.addEventListener('click', function () { activate(index - 1); });
    }
    if (next) {
      next.addEventListener('click', function () { activate(index + 1); });
    }
    thumbs.forEach(function (thumb) {
      thumb.addEventListener('click', function () {
        var raw = thumb.getAttribute('data-aico-gallery-index');
        var idx = parseInt(raw, 10);
        if (!isNaN(idx)) {
          activate(idx);
        }
      });
    });
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

    function clamp(input) {
      var max = parseInt(input.getAttribute('data-aico-variant-stock'), 10);
      var raw = parseInt(input.value, 10);
      if (isNaN(raw) || raw < 0) {
        raw = 0;
      }
      if (!isNaN(max) && raw > max) {
        raw = max;
      }
      input.value = String(raw);
      return raw;
    }

    function refresh() {
      var total = 0;
      inputs.forEach(function (input) {
        total += clamp(input);
      });
      totalNode.textContent = String(total);
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
          if (input.disabled) {
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
  // `data-aico-variant-id` (the cell's `name` is `items[<id>][quantity]`
  // for the no-JS `/cart/add` fallback; bulkUpdate keys by variant id).
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
    });
  });

  function renderError(kind) {
    var hint = form.querySelector('[data-aico-pdp-message]') || createMessage();
    hint.textContent = messageFor(kind);
    hint.dataset.kind = 'error';
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
})();
