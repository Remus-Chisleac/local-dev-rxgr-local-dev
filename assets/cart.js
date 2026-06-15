/* Cart store + Alpine glue for the storefront.
 *
 * Exposes `Alpine.store('cart', …)` with:
 *   - data:    last-fetched CartDrop JSON (or null if no cart yet)
 *   - drawer:  boolean for the mini-cart panel
 *   - toast:   transient feedback message ({kind, text})
 *
 * Methods:
 *   refresh()       — GET /cart.js, update store
 *   add(items)      — POST /cart/add.js, refresh + toast
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
      drawerOpen: false,
      drawerMounted: false,
      _drawerCloseTimer: null,
      toast: null,
      _toastTimer: null,
      _fixingInvalid: false,
      _pendingLineUpdates: {},
      _lineUpdateDelay: 400,

      // Mini-cart client-side pagination. `/cart.js` returns the whole
      // items array (no server paging), and B2B carts can be large, so
      // the side drawer reveals items a page at a time and grows on
      // scroll. The header count stays authoritative over the full
      // array (see itemCount) — never paginated.
      _miniCartPageSize: 8,
      miniCartVisibleCount: 8,

      _recalcTotals() {
        if (!this.data || !Array.isArray(this.data.items)) return;
        var count = 0;
        var total = 0;
        this.data.items.forEach(function (line) {
          var qty = Number(line.quantity || 0);
          var price = Number(line.price || 0);
          line.line_price = price * qty;
          count += qty;
          total += line.line_price;
        });
        this.data.item_count = count;
        this.data.total_price = total;
        this.data.empty = count === 0;
      },

      setLineQuantity(lineId, qty) {
        var next = Math.max(0, Number(qty || 0));
        if (this.data && Array.isArray(this.data.items)) {
          var line = this.data.items.find(function (item) { return item.id === lineId; });
          if (line) {
            line.quantity = next;
            this._recalcTotals();
          }
        }

        if (this._pendingLineUpdates[lineId]) {
          clearTimeout(this._pendingLineUpdates[lineId]);
        }

        var self = this;
        if (next === 0) {
          delete this._pendingLineUpdates[lineId];
          return this.update(lineId, 0);
        }

        this._pendingLineUpdates[lineId] = setTimeout(function () {
          delete self._pendingLineUpdates[lineId];
          self.update(lineId, next);
        }, this._lineUpdateDelay);
      },

      hasPendingLineUpdates() {
        return Object.keys(this._pendingLineUpdates).length > 0;
      },

      async flushPendingLineUpdates() {
        var self = this;
        var pending = Object.keys(this._pendingLineUpdates).map(function (lineId) {
          clearTimeout(self._pendingLineUpdates[lineId]);
          delete self._pendingLineUpdates[lineId];
          var line = self.data && self.data.items
            ? self.data.items.find(function (item) { return String(item.id) === String(lineId); })
            : null;
          return line ? self.update(lineId, line.quantity) : Promise.resolve();
        });
        await Promise.all(pending);
      },

      async goCheckout(href, shippingBlocked) {
        if (this.hasPendingLineUpdates()) {
          await this.flushPendingLineUpdates();
        }
        if (!this.canCheckout(shippingBlocked)) return;
        window.location.href = href;
      },

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

      openDrawer() {
        if (this.drawerOpen) {
          return;
        }
        // Fresh open → show the first page from the top.
        this.resetMiniCartPagination();
        if (this._drawerCloseTimer) {
          clearTimeout(this._drawerCloseTimer);
          this._drawerCloseTimer = null;
        }
        this.drawer = true;
        this.drawerOpen = false;
        this.drawerMounted = true;
        document.documentElement.classList.add('aico-no-scroll');
        document.body.classList.add('aico-no-scroll');

        // Alpine batches store writes — defer the open class until the
        // mounted (hidden removed) + closed frame has painted, same as
        // theme.js forcing reflow before .aico-drawer-open.
        var self = this;
        function applyOpenClass() {
          var root = document.querySelector('.aico-mini-cart');
          if (root) {
            void root.offsetHeight;
          }
          self.drawerOpen = true;
        }
        if (typeof window.Alpine !== 'undefined' && typeof window.Alpine.nextTick === 'function') {
          window.Alpine.nextTick(function () {
            window.Alpine.nextTick(applyOpenClass);
          });
        } else {
          requestAnimationFrame(function () {
            requestAnimationFrame(applyOpenClass);
          });
        }
      },
      closeDrawer() {
        if (!this.drawerMounted) {
          return;
        }
        this.drawer = false;
        this.drawerOpen = false;
        document.documentElement.classList.remove('aico-no-scroll');
        document.body.classList.remove('aico-no-scroll');
        var self = this;
        if (this._drawerCloseTimer) {
          clearTimeout(this._drawerCloseTimer);
        }
        this._drawerCloseTimer = setTimeout(function () {
          self._drawerCloseTimer = null;
          if (!self.drawerOpen) {
            self.drawerMounted = false;
          }
        }, 220);
      },
      toggleDrawer() {
        if (this.drawerOpen) {
          this.closeDrawer();
        } else {
          this.openDrawer();
        }
      },

      flash(text, kind) {
        this.toast = { text: text, kind: kind || 'success' };
        if (this._toastTimer) clearTimeout(this._toastTimer);
        var self = this;
        this._toastTimer = setTimeout(function () { self.toast = null; }, 3500);
      },

      // ── Mini-cart pagination (client-side, load-on-scroll) ──
      // The visible slice of the cart for the side drawer. The full
      // array still backs itemCount()/the full cart page.
      miniCartItems() {
        return (this.data && Array.isArray(this.data.items)) ? this.data.items : [];
      },
      miniCartVisibleItems() {
        return this.miniCartItems().slice(0, this.miniCartVisibleCount);
      },
      miniCartHasMore() {
        return this.miniCartItems().length > this.miniCartVisibleCount;
      },
      resetMiniCartPagination() {
        this.miniCartVisibleCount = this._miniCartPageSize;
      },
      // Bump the visible slice by a page. Bound to the drawer body's
      // scroll handler; no-op once everything is shown.
      loadMoreMiniCart() {
        if (this.miniCartHasMore()) {
          this.miniCartVisibleCount += this._miniCartPageSize;
        }
      },
      // Scroll-driven reveal: when the body is scrolled near its bottom
      // and there's more to show, grow the slice.
      onMiniCartScroll(event) {
        var el = event && event.target;
        if (!el || !this.miniCartHasMore()) return;
        var threshold = 120; // px from the bottom
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - threshold) {
          this.loadMoreMiniCart();
        }
      },

      // Header / mini-cart badge label. Plural via the count.
      itemCount() { return (this.data && this.data.item_count) || 0; },
      itemCountLabel() {
        var count = this.itemCount();
        var template = translations[pluralKey(count)] || (count + ' items');
        return interpolate(template, count);
      },

      // Match b2b-shop's checkout-button gate: cart non-empty, no
      // invalid qty/price, status saved, no shipping block. Credit
      // limit is enforced on /checkout (payment method), not here.
      canCheckout(shippingBlocked) {
        var c = this.data;
        if (!c || c.empty) return false;
        if (c.aico_has_invalid_quantity || c.aico_has_invalid_price) return false;
        if (shippingBlocked) return false;
        if (c.aico_status === 'ERROR' || c.aico_status === 'SAVING_LONGER_THAN_EXPECTED') {
          return false;
        }
        // Stale SAVING from a prior batch add self-heals via refresh();
        // don't block checkout forever on the cart page snapshot.
        return true;
      },

      lineExceedsStock(line) {
        if (!line) return false;
        if (line.aico_quantity_exceeds_stock) return true;
        var stock = line.aico_available_stock;
        if (stock === null || stock === undefined) return false;
        return Number(line.quantity || 0) > Number(stock);
      },

      lineQuantityError(line) {
        if (!this.lineExceedsStock(line)) return '';
        var stock = line.aico_available_stock;
        if (stock === null || stock === undefined) {
          return translations.quantity_exceeds_stock_generic || 'Reduce the quantity to continue.';
        }
        if (Number(stock) <= 0) {
          return translations.out_of_stock || 'Out of stock — remove this item or set quantity to 0.';
        }
        var template = translations.quantity_exceeds_stock || 'Only {count} in stock — reduce the quantity.';
        return template.replace('{count}', String(stock));
      },

      fixedQuantityForLine(line) {
        if (!line) return null;
        var qty = Number(line.quantity || 0);
        if (qty <= 0) return null;

        var next = qty;
        var stock = line.aico_available_stock;
        var max = line.aico_max_quantity_per_order;

        if (stock !== null && stock !== undefined && qty > Number(stock)) {
          next = Math.max(0, Number(stock));
        }
        if (max !== null && max !== undefined && next > Number(max)) {
          next = Number(max);
        }

        return next === qty ? null : next;
      },

      hasFixableInvalidQuantity() {
        if (!this.data || !this.data.aico_has_invalid_quantity) return false;
        var self = this;
        return (this.data.items || []).some(function (line) {
          return self.fixedQuantityForLine(line) !== null;
        });
      },

      async fixInvalidQuantities() {
        if (this._fixingInvalid) return false;

        if (this.hasPendingLineUpdates()) {
          await this.flushPendingLineUpdates();
        }
        if (!this.hasFixableInvalidQuantity()) {
          await this.refresh();
          return false;
        }

        this._fixingInvalid = true;
        var self = this;
        var updates = [];
        (this.data.items || []).forEach(function (line) {
          var next = self.fixedQuantityForLine(line);
          if (next !== null) updates.push({ id: line.id, quantity: next });
        });

        try {
          for (var i = 0; i < updates.length; i++) {
            var row = updates[i];
            var res = await fetch(routes.changeJsonUrl || '/cart/change.js', {
              method: 'POST',
              headers: jsonHeaders(),
              credentials: 'same-origin',
              body: formEncoded({ id: row.id, quantity: row.quantity }),
            });
            if (!res.ok) throw new Error('update failed');
            this.data = await res.json();
          }
          await this.refresh();
          this.flash(
            translations.fixed_invalid_quantity || 'Quantities adjusted to available stock.',
            'success'
          );
          return true;
        } catch (e) {
          this.flash(
            translations.fix_invalid_quantity_error || 'Could not adjust cart quantities.',
            'error'
          );
          await this.refresh();
          return false;
        } finally {
          this._fixingInvalid = false;
        }
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
      var open = Alpine.store('cart').drawerOpen;
      if (open) Alpine.store('cart').refresh();
    });

    // Whenever the cart data is replaced (add / refresh / update), clamp
    // the mini-cart's visible slice back to the first page so a fresh
    // add doesn't leave a huge slice from a prior reveal. Reading
    // `.data` registers the dependency; `_recalcTotals` mutates items
    // in place (same object ref) so qty tweaks don't reset the slice.
    Alpine.effect(function () {
      var data = Alpine.store('cart').data; // track replacement
      void data;
      Alpine.store('cart').resetMiniCartPagination();
    });
  }

  // Register via `alpine:init`. theme.liquid loads this script before Alpine
  // so the listener is in place when Alpine.start() runs. If Alpine already
  // booted (wrong order / hot reload), register immediately instead.
  var cartStoreRegistered = false;
  function ensureCartStore() {
    if (cartStoreRegistered || typeof window.Alpine === 'undefined') return;
    cartStoreRegistered = true;
    registerCartStore();
  }
  document.addEventListener('alpine:init', ensureCartStore);
  ensureCartStore();

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
