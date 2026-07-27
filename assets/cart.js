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

  // CHF prices display rounded to the NEAREST 0.05 (display only —
  // stored/charged amounts stay exact).
  // Kept as a local alias so the existing call sites stay untouched; the rule
  // itself lives in AicoUtils so it is defined and tested in exactly one place.
  function roundChfDisplay(amount, currency) {
    var rounded = AicoUtils.roundForDisplay(amount, currency);
    return rounded === null ? amount : rounded;
  }

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

      // Cart-generation guard: every backend response carries
      // aico_generation (bumped on each mutation), so a slow response
      // arriving after a newer one can be discarded instead of
      // regressing the badge/totals.
      _generation: 0,

      // Mini-cart SERVER-SIDE pagination. On non-cart pages the seed is
      // slim (data.items === null — see theme.liquid) and mutations
      // return deltas, so the full items array is never shipped there.
      // The drawer fetches its lines page by page from /cart.js
      // (aico_page/aico_limit) and grows on scroll; drawerItems is its
      // own list, independent of data.items.
      _drawerPageSize: 8,
      drawerItems: [],
      drawerTotalLines: 0,
      _drawerNextPage: 1,
      _drawerLoading: false,
      _drawerStale: true,

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
        var line = null;
        if (this.data && Array.isArray(this.data.items)) {
          line = this.data.items.find(function (item) { return item.id === lineId; });
        }
        // The drawer keeps its own (server-paged) line list — the stepper
        // there must clamp and update optimistically too.
        var drawerLine = this.drawerItems.find(function (item) { return item.id === lineId; });
        if (line || drawerLine) {
          // Last line of defence: stepper clicks, typed input and any
          // programmatic caller all funnel through here, so the stock /
          // max-order-quantity ceiling is applied once, centrally. The server
          // clamps too — this just stops the UI from showing a number that
          // the next response would silently walk back.
          var max = this.lineMaxQuantity(line || drawerLine);
          if (max !== null && next > max) next = max;
          if (line) line.quantity = next;
          if (drawerLine) drawerLine.quantity = next;
          this._recalcTotals();
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
          var byId = function (item) { return String(item.id) === String(lineId); };
          var line = (self.data && Array.isArray(self.data.items) ? self.data.items.find(byId) : null)
            || self.drawerItems.find(byId);
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

      // Discard responses older than the newest generation we've seen.
      // Returns true when the payload may be applied.
      _acceptGeneration(payload) {
        var gen = Number((payload && payload.aico_generation) || 0);
        if (gen && this._generation && gen < this._generation) return false;
        if (gen > this._generation) this._generation = gen;
        return true;
      },

      /**
       * Apply an `aico_delta` mutation response: cart aggregates come from
       * the payload; the touched lines' RESULTING state (server-clamped)
       * upserts into whatever line lists are loaded — data.items on the
       * cart/checkout pages, drawerItems in the mini-cart. Slim pages keep
       * items === null; nothing ships the whole cart.
       */
      applyDelta(payload) {
        if (!payload || payload.aico_delta !== true) return false;
        if (!this._acceptGeneration(payload)) return true; // stale — consumed, ignored
        if (!this.data) this.data = {};
        var d = this.data;
        d.id = payload.id;
        d.item_count = Number(payload.item_count || 0);
        d.total_price = Number(payload.total_price || 0);
        d.empty = !!payload.empty;
        if (payload.currency) d.currency = payload.currency;
        d.aico_status = payload.aico_status;
        d.aico_has_invalid_quantity = !!payload.aico_has_invalid_quantity;
        d.aico_has_invalid_price = !!payload.aico_has_invalid_price;

        var removed = payload.aico_removed_line_ids || [];
        var touched = Array.isArray(payload.items) ? payload.items : [];

        function patch(list, allowAppend) {
          if (!Array.isArray(list)) return list;
          var next = list.filter(function (line) { return removed.indexOf(line.id) === -1; });
          touched.forEach(function (line) {
            var idx = -1;
            for (var i = 0; i < next.length; i++) {
              if (next[i].id === line.id) { idx = i; break; }
            }
            if (idx !== -1) next[idx] = line;
            else if (allowAppend) next.push(line);
          });
          return next;
        }

        if (Array.isArray(d.items)) d.items = patch(d.items, true);
        // Drawer: update/remove in place, but never append (it is paged —
        // a line not on a loaded page shows up via the stale reload).
        this.drawerItems = patch(this.drawerItems, false);
        if (payload.aico_total_lines !== undefined) {
          this.drawerTotalLines = Number(payload.aico_total_lines || 0);
        }
        this._drawerStale = true;
        return true;
      },

      // Apply a mutation response of either shape: delta (aico_delta=1
      // backends) or the legacy full-cart JSON.
      _applyMutationResponse(payload) {
        if (this.applyDelta(payload)) return;
        if (this._acceptGeneration(payload)) this.data = payload;
      },

      async refresh() {
        try {
          var res = await fetch(routes.jsonUrl || '/cart.js', { headers: jsonHeaders(), credentials: 'same-origin' });
          if (!res.ok) return;
          var payload = await res.json();
          if (this._acceptGeneration(payload)) this.data = payload;
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
        body.aico_delta = '1';
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
          this._applyMutationResponse(await res.json());
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
            body: formEncoded({ id: lineId, quantity: qty, aico_delta: '1' }),
          });
          if (!res.ok) {
            this.flash(translations.update_error || 'Could not update cart.', 'error');
            await this.refresh();
            return false;
          }
          this._applyMutationResponse(await res.json());
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

      // Set ABSOLUTE per-variant quantities in one POST (the PDP size
      // matrix). `updatesMap` is `{ variantId: absoluteQty }` — a 0
      // removes that line. POSTs `updates[<variantId>]=<qty>` to
      // /cart/update.js (postUpdateJson), which returns the same
      // CartDrop snapshot add()/update() apply. Mirrors add(): refreshes
      // the snapshot, flashes on failure, returns true/false. (No
      // drawer-open here — like add() in this theme, the toast carries
      // the feedback and the badge updates reactively.)
      async bulkUpdate(updatesMap) {
        if (!updatesMap || typeof updatesMap !== 'object') return false;
        var body = {};
        Object.keys(updatesMap).forEach(function (variantId) {
          body['updates[' + variantId + ']'] = updatesMap[variantId];
        });
        if (Object.keys(body).length === 0) return false;
        body.aico_delta = '1';
        try {
          var res = await fetch(routes.updateJsonUrl || '/cart/update.js', {
            method: 'POST',
            headers: jsonHeaders(),
            credentials: 'same-origin',
            body: formEncoded(body),
          });
          if (!res.ok) {
            this.flash(translations.update_error || 'Could not update cart.', 'error');
            return false;
          }
          this._applyMutationResponse(await res.json());
          return true;
        } catch (e) {
          this.flash(translations.update_error || 'Could not update cart.', 'error');
          return false;
        }
      },

      /**
       * Cart quantities for ONE product — `{total_quantity, variants: {id: qty}}`
       * from the aico_product_status endpoint. One indexed query server-side;
       * used by the PDP stepper and quick-add prefill instead of reading the
       * (no longer shipped) full items array.
       */
      async fetchProductStatus(productId) {
        var empty = { product_id: productId, total_quantity: 0, variants: {} };
        if (!productId) return empty;
        try {
          var url = routes.productStatusUrl || '/cart/aico_product_status.js';
          url += (url.indexOf('?') === -1 ? '?' : '&') + 'product_id=' + encodeURIComponent(productId);
          var res = await fetch(url, { headers: jsonHeaders(), credentials: 'same-origin' });
          if (!res.ok) return empty;
          var payload = await res.json();
          return {
            product_id: productId,
            total_quantity: Number(payload.total_quantity || 0),
            variants: payload.variants || {},
          };
        } catch (e) {
          return empty;
        }
      },

      openDrawer() {
        if (this.drawerOpen) {
          return;
        }
        // Fresh open → (re)load the first page when anything mutated the
        // cart since the last load. Replaces the old open-triggered full
        // /cart.js refresh — the drawer only ever fetches a page.
        if (this._drawerStale || this.drawerItems.length === 0) {
          this.loadDrawerPage(true);
        }
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

      // ── Mini-cart pagination (server-side, load-on-scroll) ──
      // The drawer fetches pages from /cart.js?aico_page=N&aico_limit=M —
      // the whole items array is never shipped. The header badge stays
      // authoritative from data.item_count (updated by every response).
      async loadDrawerPage(reset) {
        if (this._drawerLoading) return;
        this._drawerLoading = true;
        try {
          var page = reset ? 1 : this._drawerNextPage;
          var url = routes.jsonUrl || '/cart.js';
          url += (url.indexOf('?') === -1 ? '?' : '&')
            + 'aico_page=' + page + '&aico_limit=' + this._drawerPageSize;
          var res = await fetch(url, { headers: jsonHeaders(), credentials: 'same-origin' });
          if (!res.ok) return;
          var payload = await res.json();
          var items = Array.isArray(payload.items) ? payload.items : [];
          if (this._acceptGeneration(payload)) {
            // The page response carries the cart aggregates too — keep the
            // badge/summary in sync while we're here.
            if (!this.data) this.data = {};
            this.data.item_count = Number(payload.item_count || 0);
            this.data.total_price = Number(payload.total_price || 0);
            this.data.empty = !!payload.empty;
            this.data.aico_status = payload.aico_status;
            this.data.aico_has_invalid_quantity = !!payload.aico_has_invalid_quantity;
            this.data.aico_has_invalid_price = !!payload.aico_has_invalid_price;
          }
          this.drawerTotalLines = Number(payload.aico_total_lines || items.length);
          if (reset) {
            this.drawerItems = items;
            this._drawerNextPage = 2;
            this._drawerStale = false;
          } else {
            var known = {};
            this.drawerItems.forEach(function (line) { known[line.id] = true; });
            var self = this;
            items.forEach(function (line) {
              if (!known[line.id]) self.drawerItems.push(line);
            });
            this._drawerNextPage = page + 1;
          }
        } catch (e) {
          // Network blip — keep whatever pages are already shown.
        } finally {
          this._drawerLoading = false;
        }
      },
      miniCartVisibleItems() {
        return this.drawerItems;
      },
      miniCartHasMore() {
        return this.drawerItems.length < this.drawerTotalLines;
      },
      // Fetch the next page. Bound to the drawer body's scroll handler and
      // the "load more" button; no-op once everything is shown.
      loadMoreMiniCart() {
        if (this.miniCartHasMore()) {
          this.loadDrawerPage(false);
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

      // ── Per-line quantity ceiling ────────────────────────────────────────
      //
      // Three independent limits, all mirrored from the server-side clamps in
      // StorefrontCartController / SeparatedCartService::clampAddedQuantity:
      //
      //   1. warehouse stock            — line.aico_available_stock
      //   2. per-variant PIM cap        — line.aico_max_quantity_per_order
      //   3. product-wide PIM cap       — line.aico_product_max_quantity_per_order
      //      (PIM "for all variants" mode: caps the SUM across every variant of
      //      the product, so this line's own room is the cap minus what the
      //      product's OTHER lines already hold)
      //
      // The binding limit is the smallest of whichever are set; null means
      // "no limit known" and must NOT be treated as 0 — hence the explicit
      // null/undefined checks rather than `a || b` (a cap of 0 is falsy and a
      // real constraint).

      /** Sum of every OTHER cart line that belongs to the same product. */
      otherLinesQuantityForProduct(line) {
        if (!line || !this.data || !Array.isArray(this.data.items)) return 0;
        var productId = line.product_id;
        if (productId === null || productId === undefined) return 0;
        var lineId = line.id;
        return this.data.items.reduce(function (sum, other) {
          if (other.id === lineId) return sum;
          if (other.product_id !== productId) return sum;
          return sum + Number(other.quantity || 0);
        }, 0);
      },

      /**
       * Highest quantity this line may hold, or null when unconstrained.
       * Never returns a negative number — a product already over its cap on
       * other lines floors this line at 0.
       */
      lineMaxQuantity(line) {
        if (!line) return null;
        var limit = null;

        function tighten(value) {
          if (value === null || value === undefined) return;
          var next = Number(value);
          if (isNaN(next)) return;
          if (limit === null || next < limit) limit = next;
        }

        tighten(line.aico_available_stock);
        tighten(line.aico_max_quantity_per_order);

        var productCap = line.aico_product_max_quantity_per_order;
        if (productCap !== null && productCap !== undefined && !isNaN(Number(productCap))) {
          tighten(Number(productCap) - this.otherLinesQuantityForProduct(line));
        }

        return limit === null ? null : Math.max(0, limit);
      },

      /** True when the line already sits at (or past) its ceiling — "+" is dead. */
      lineAtMaxQuantity(line) {
        var max = this.lineMaxQuantity(line);
        if (max === null) return false;
        return Number(line.quantity || 0) >= max;
      },

      /**
       * Hover text explaining why "+" is disabled. Empty string when the line
       * is not capped, so the template can bind it straight to `:title` (an
       * empty title renders no tooltip).
       */
      lineMaxQuantityHint(line) {
        if (!line || !this.lineAtMaxQuantity(line)) return '';
        var max = this.lineMaxQuantity(line);

        // Which limit actually bound? Stock wins the message when it is the
        // smallest, because "only N left" is more actionable than "max N".
        var stock = line.aico_available_stock;
        if (stock !== null && stock !== undefined && Number(stock) <= max) {
          if (Number(stock) <= 0) {
            return translations.out_of_stock || 'Out of stock.';
          }
          var stockTemplate = translations.max_stock_reached || 'Only {count} in stock.';
          return stockTemplate.replace('{count}', String(Number(stock)));
        }

        var productCap = line.aico_product_max_quantity_per_order;
        if (productCap !== null && productCap !== undefined) {
          var productTemplate = translations.max_quantity_product_reached
            || 'Maximum order quantity of {count} for this product reached.';
          return productTemplate.replace('{count}', String(Number(productCap)));
        }

        var variantTemplate = translations.max_quantity_reached
          || 'Maximum order quantity of {count} reached.';
        return variantTemplate.replace('{count}', String(max));
      },

      /**
       * Clamp a typed value into [0, lineMaxQuantity] and write it back onto
       * the line before the debounced server write. Bound to the qty input's
       * `@input` so pasting/typing "999" snaps to the real ceiling instead of
       * bouncing back only after the server responds.
       */
      clampLineQuantity(line, value) {
        if (!line) return 0;
        var next = Math.floor(Number(value));
        if (isNaN(next) || next < 0) next = 0;
        var max = this.lineMaxQuantity(line);
        if (max !== null && next > max) next = max;
        if (line.quantity !== next) line.quantity = next;
        return next;
      },

      /**
       * Per-line limits only (stock + the variant cap) — deliberately WITHOUT
       * the product-wide cap, which cannot be judged one line at a time.
       * `plannedQuantityFixes()` layers that on with a running budget.
       */
      fixedQuantityForLine(line) {
        if (!line) return null;
        var qty = Number(line.quantity || 0);
        if (qty <= 0) return null;

        var next = qty;
        var stock = line.aico_available_stock;
        var max = line.aico_max_quantity_per_order;

        if (stock !== null && stock !== undefined && next > Number(stock)) {
          next = Math.max(0, Number(stock));
        }
        if (max !== null && max !== undefined && next > Number(max)) {
          next = Math.max(0, Number(max));
        }

        return next === qty ? null : next;
      },

      /**
       * The full "adjust quantities automatically" plan: one pass over the
       * cart applying each line's own limits, then spending a per-product
       * budget in cart order for products under a product-wide cap.
       *
       * Walking with a running budget (instead of asking each line to subtract
       * its siblings) is what keeps two lines of the same capped product from
       * BOTH backing off by the full overage — e.g. two lines of 10 under a cap
       * of 12 settle at 10 + 2, not 2 + 2.
       *
       * @return {Array<{id: number, quantity: number}>}
       */
      plannedQuantityFixes() {
        if (!this.data || !Array.isArray(this.data.items)) return [];
        var self = this;
        var remainingByProduct = {};
        var updates = [];

        this.data.items.forEach(function (line) {
          var current = Number(line.quantity || 0);
          var next = self.fixedQuantityForLine(line);
          if (next === null) next = current;

          var productCap = line.aico_product_max_quantity_per_order;
          var productId = line.product_id;
          if (productCap !== null && productCap !== undefined
            && productId !== null && productId !== undefined
            && !isNaN(Number(productCap))) {
            if (!(productId in remainingByProduct)) {
              remainingByProduct[productId] = Math.max(0, Number(productCap));
            }
            next = Math.min(next, remainingByProduct[productId]);
            remainingByProduct[productId] -= next;
          }

          if (next !== current) updates.push({ id: line.id, quantity: next });
        });

        return updates;
      },

      hasFixableInvalidQuantity() {
        if (!this.data || !this.data.aico_has_invalid_quantity) return false;
        return this.plannedQuantityFixes().length > 0;
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
        var updates = this.plannedQuantityFixes();

        try {
          for (var i = 0; i < updates.length; i++) {
            var row = updates[i];
            var res = await fetch(routes.changeJsonUrl || '/cart/change.js', {
              method: 'POST',
              headers: jsonHeaders(),
              credentials: 'same-origin',
              body: formEncoded({ id: row.id, quantity: row.quantity, aico_delta: '1' }),
            });
            if (!res.ok) throw new Error('update failed');
            this._applyMutationResponse(await res.json());
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
        var amount = roundChfDisplay(Number(value || 0), currencyCode);
        if (moneyFormatter) {
          try { return moneyFormatter.format(amount); } catch (_) { /* fall through */ }
        }
        return amount.toFixed(2) + ' ' + currencyCode;
      },
    });

    // Whenever the cart data is REPLACED wholesale (a full refresh / a
    // legacy full-cart response), the drawer's paged list may no longer
    // match — mark it stale so the next open reloads page 1. Reading
    // `.data` registers the dependency; delta merges mutate in place
    // (same object ref) and maintain the drawer themselves.
    Alpine.effect(function () {
      var data = Alpine.store('cart').data; // track replacement
      void data;
      Alpine.store('cart')._drawerStale = true;
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
