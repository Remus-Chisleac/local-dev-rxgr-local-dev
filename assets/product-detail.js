// PDP client-side glue. No frameworks, no build step — same IIFE style
// as `assets/theme.js`. Picks up its DOM targets lazily so a future
// snippet-based refactor doesn't need to change the script.
//
// Responsibilities:
//   1. Gallery — prev/next + thumb click → swap the active slide.
//   2. Option chips/dropdowns → resolve the matching variant id and
//      mirror it into the hidden `id` input (legacy mode only).
//   3. Size matrix — sum the per-size quantity inputs into "Total".
//   4. Add-to-cart submit — currently posts to the form's action URL.
//      The backend endpoint may return 501 until cart-add is wired
//      (see the PDP plan §5 + storefront.php route stub). The script
//      degrades to a no-op error banner in that case.

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

  // -------- Add-to-cart submit ------------------------------------------

  form.addEventListener('submit', function (event) {
    // Pre-flight: in matrix mode we need at least one row > 0; in
    // legacy mode we need at least one option resolved. The browser's
    // native required-field handling covers some of this, but matrix
    // mode is too dynamic for plain HTML constraints.
    if (hasMatrix) {
      var anySelected = Array.prototype.some.call(
        form.querySelectorAll('[data-aico-size-qty]'),
        function (input) {
          var n = parseInt(input.value, 10);
          return !isNaN(n) && n > 0;
        }
      );
      if (!anySelected) {
        event.preventDefault();
        renderError('select_quantity');
        return;
      }
    }

    // Optimistic UX: the script intercepts the submit and posts via
    // fetch so the page does not navigate away. The backend endpoint
    // returns 501 until cart-add is wired (PDP plan §5). When it
    // lands, the response shape will follow Shopify's `/cart/add.js`
    // (return the cart line as JSON); the no-JS fallback continues to
    // submit the form normally (the browser navigation overrides this
    // listener if JS is disabled).
    event.preventDefault();
    var button = form.querySelector('[data-aico-buy-button]');
    if (button) {
      button.setAttribute('disabled', 'disabled');
    }

    var data = new FormData(form);
    fetch(form.action, {
      method: form.method || 'POST',
      body: data,
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    }).then(function (response) {
      if (button) {
        button.removeAttribute('disabled');
      }
      if (response.status === 501) {
        renderError('not_implemented');
        return;
      }
      if (!response.ok) {
        renderError('error');
        return;
      }
      renderSuccess();
    }).catch(function () {
      if (button) {
        button.removeAttribute('disabled');
      }
      renderError('error');
    });
  });

  function renderError(kind) {
    var hint = form.querySelector('[data-aico-pdp-message]') || createMessage();
    hint.textContent = messageFor(kind);
    hint.dataset.kind = 'error';
  }

  function renderSuccess() {
    var hint = form.querySelector('[data-aico-pdp-message]') || createMessage();
    hint.textContent = messageFor('saved');
    hint.dataset.kind = 'ok';
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
    if (kind === 'saved') {
      return getLocaleHint('items_saved', 'Items saved to cart.');
    }
    if (kind === 'not_implemented') {
      return getLocaleHint('not_implemented', 'Add-to-cart is not connected yet.');
    }
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
