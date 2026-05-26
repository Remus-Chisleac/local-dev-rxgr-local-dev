/* Cart store + Alpine glue for the storefront.
 *
 * Exposes `Alpine.store('cart', …)` with:
 *   - data:    last-fetched CartDrop JSON (or null if no cart yet)
 *   - drawer:  boolean for the mini-cart panel
 *   - toast:   transient feedback message ({kind, text})
 *
 * Methods:
 *   refresh()       — GET /cart.js, update store
 *   add(items)      — POST /cart/add.js, refresh + open drawer + toast
 *   update(id, qty) — POST /cart/change.js, refresh
 *   clear()         — POST /cart/clear (form post, triggers a reload)
 *   canCheckout()   — gate matching b2b-shop's checkout-button rules
 *   formatMoney(n)  — money formatter using the shop's locale + currency
 *   itemCountLabel  — "1 item" / "{count} items" via translations
 *
 * Designed to progressively enhance: every form on the page still
 * works without JS — the store just gives Alpine-bound controls a
 * faster path that skips full page reloads.
 */
(function () {
  'use strict';

  function registerCartStore() {
    var translations = (window.__AICO_T__ && window.__AICO_T__.cart) || {};
    var currencyCode = (window.__AICO_SHOP__ && window.__AICO_SHOP__.currency) || 'CHF';
    var locale = (window.__AICO_SHOP__ && window.__AICO_SHOP__.locale) || 'en';
    var csrfToken = window.__AICO_CSRF__ || '';
    var routes = (window.__AICO_ROUTES__ && window.__AICO_ROUTES__.cart) || {};

    // Pull whatever the server SSR'd onto the page (initial cart JSON
    // is injected into <script id="aico-cart-data">). Falls back to
    // null which the templates treat as "not loaded yet".
    var initial = null;
    var seed = document.getElementById('aico-cart-data');
    if (seed) {
      try { initial = JSON.parse(seed.textContent || 'null'); } catch (_) { initial = null; }
    }

    var moneyFormatter;
    try {
      moneyFormatter = new Intl.NumberFormat(locale.replace('_', '-'), {
        style: 'currency',
        currency: currencyCode,
      });
    } catch (_) {
      moneyFormatter = null;
    }

    function jsonHeaders() {
      var headers = { 'Accept': 'application/json' };
      if (csrfToken) headers['X-CSRF-TOKEN'] = csrfToken;
      return headers;
    }

    function formEncoded(body) {
      var params = new URLSearchParams();
      Object.keys(body).forEach(function (key) {
        var value = body[key];
        if (value !== undefined && value !== null) params.set(key, String(value));
      });
      if (csrfToken) params.set('_token', csrfToken);
      return params;
    }

    function pluralKey(count) {
      return count === 1 ? 'item_count_one' : 'item_count_other';
    }

    function interpolate(template, count) {
      return (template || '').replace('{count}', String(count));
    }

    Alpine.store('cart', {
      data: initial,
      drawer: false,
      toast: null,
      _toastTimer: null,

      async refresh() {
        try {
          var res = await fetch(routes.jsonUrl || '/cart.js', { headers: jsonHeaders(), credentials: 'same-origin' });
          if (!res.ok) return;
          this.data = await res.json();
        } catch (e) {
          // Network blip — leave existing data in place rather than
          // wiping the visible cart.
        }
      },

      async add(items) {
        var body;
        if (Array.isArray(items)) {
          body = {};
          items.forEach(function (item, index) {
            body['items[' + index + '][id]'] = item.id;
            body['items[' + index + '][quantity]'] = item.quantity;
          });
        } else {
          body = { id: items.id, quantity: items.quantity };
        }
        try {
          var res = await fetch(routes.addJsonUrl || '/cart/add.js', {
            method: 'POST',
            headers: jsonHeaders(),
            credentials: 'same-origin',
            body: formEncoded(body),
          });
          if (!res.ok) {
            this.flash(translations.add_error || 'Could not add to cart.', 'error');
            return false;
          }
          this.data = await res.json();
          this.flash(translations.added || 'Item added to cart.', 'success');
          this.openDrawer();
          return true;
        } catch (e) {
          this.flash(translations.add_error || 'Could not add to cart.', 'error');
          return false;
        }
      },

      async update(lineId, qty) {
        try {
          var res = await fetch(routes.changeJsonUrl || '/cart/change.js', {
            method: 'POST',
            headers: jsonHeaders(),
            credentials: 'same-origin',
            body: formEncoded({ id: lineId, quantity: qty }),
          });
          if (!res.ok) {
            this.flash(translations.update_error || 'Could not update cart.', 'error');
            await this.refresh();
            return false;
          }
          this.data = await res.json();
          if (qty === 0) {
            this.flash(translations.removed || 'Item removed.', 'success');
          }
          return true;
        } catch (e) {
          this.flash(translations.update_error || 'Could not update cart.', 'error');
          await this.refresh();
          return false;
        }
      },

      openDrawer() { this.drawer = true; },
      closeDrawer() { this.drawer = false; },
      toggleDrawer() { this.drawer = !this.drawer; },

      flash(text, kind) {
        this.toast = { text: text, kind: kind || 'success' };
        if (this._toastTimer) clearTimeout(this._toastTimer);
        var self = this;
        this._toastTimer = setTimeout(function () { self.toast = null; }, 3500);
      },

      // Header / mini-cart badge label. Plural via the count.
      itemCount() { return (this.data && this.data.item_count) || 0; },
      itemCountLabel() {
        var count = this.itemCount();
        var template = translations[pluralKey(count)] || (count + ' items');
        return interpolate(template, count);
      },

      // Match b2b-shop's checkout-button gate: cart non-empty, no
      // invalid qty/price, status saved, no shipping block.
      canCheckout(shippingBlocked) {
        var c = this.data;
        if (!c || c.empty) return false;
        if (c.aico_has_invalid_quantity || c.aico_has_invalid_price) return false;
        if (c.aico_status && c.aico_status !== 'SAVED') return false;
        if (shippingBlocked) return false;
        return true;
      },

      formatMoney(value) {
        var amount = Number(value || 0);
        if (moneyFormatter) {
          try { return moneyFormatter.format(amount); } catch (_) { /* fall through */ }
        }
        return amount.toFixed(2) + ' ' + currencyCode;
      },
    });

    // Mini-cart lazy refresh — when the drawer opens, fetch fresh
    // contents so the panel never shows stale data after another tab
    // mutated the cart.
    Alpine.effect(function () {
      var open = Alpine.store('cart').drawer;
      if (open) Alpine.store('cart').refresh();
    });
  }

  // Belt-and-braces: register on `alpine:init` (the normal path), AND
  // immediately if Alpine has already started by the time this script
  // executes. Defer-script ordering should make `alpine:init` reliable,
  // but a stray `Alpine.start()` elsewhere or a non-deferred re-injection
  // could fire it before our listener attaches — and then the store would
  // never exist and every `$store.cart.*` call would silently no-op.
  if (window.Alpine && window.Alpine.store) {
    registerCartStore();
  } else {
    document.addEventListener('alpine:init', registerCartStore);
  }

  // Progressive enhancement: turn any <form data-aico-cart-add> into a
  // fetch-based submit that lives entirely on this page. Falls back to
  // the form's regular POST if Alpine isn't loaded or the fetch
  // rejects with a redirect.
  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (!form.matches('[data-aico-cart-add]')) return;
    if (!window.Alpine || !window.Alpine.store('cart')) return;
    event.preventDefault();

    var data = new FormData(form);
    var items = [];
    // Support either single-line (`id`, `quantity`) or batch (`items[*][id]`).
    var batch = {};
    data.forEach(function (value, key) {
      var match = key.match(/^items\[(\d+)\]\[(id|quantity)\]$/);
      if (match) {
        var bucket = batch[match[1]] || (batch[match[1]] = {});
        bucket[match[2]] = value;
      }
    });
    var indices = Object.keys(batch);
    if (indices.length > 0) {
      indices.forEach(function (idx) {
        var row = batch[idx];
        if (row.id && row.quantity) {
          items.push({ id: Number(row.id), quantity: Number(row.quantity) });
        }
      });
    } else if (data.has('id') && data.has('quantity')) {
      items = { id: Number(data.get('id')), quantity: Number(data.get('quantity')) };
    } else {
      return; // nothing meaningful to submit
    }

    Alpine.store('cart').add(items);
  });
})();
