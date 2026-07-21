// Aico storefront — header panel coordinator + live search drawer.
//
// One Alpine store (`$store.panels`) owns which side panel is open —
// 'menu' or 'search' — so only one occupies the right-edge drawer space
// at a time, with the same slide / scroll-lock behaviour as the
// mini-cart. The cart drawer stays owned by `$store.cart`
// (assets/cart.js); the three are kept mutually exclusive by closing the
// others whenever one opens.
//
// Also registers the `aicoSearch` Alpine component: a debounced live
// product search that talks to Meilisearch directly with the public
// read-only key — the same client-side pattern as assets/products-page.js,
// reusing the `aico_search_config` bootstrap the renderer injects on every
// page. Results are ordered by name A→Z to match the legacy b2b-shop side
// search.

(function () {
  'use strict';

  var ANIM_MS = 220;

  function lockScroll() {
    document.documentElement.classList.add('aico-no-scroll');
    document.body.classList.add('aico-no-scroll');
  }
  function unlockScroll() {
    document.documentElement.classList.remove('aico-no-scroll');
    document.body.classList.remove('aico-no-scroll');
  }

  // ---- Panel coordinator store ------------------------------------

  function registerPanelsStore() {
    Alpine.store('panels', {
      active: null, // 'menu' | 'search' | null
      mounted: { menu: false, search: false },
      _timers: { menu: null, search: null },

      isOpen: function (name) { return this.active === name; },
      isMounted: function (name) { return !!this.mounted[name]; },
      anyMounted: function () { return this.mounted.menu || this.mounted.search; },

      open: function (name) {
        if (name !== 'menu' && name !== 'search') { return; }
        if (this.active === name) { return; }

        // Close the cart (separate store) so only one drawer shows.
        var cart = Alpine.store('cart');
        if (cart && typeof cart.closeDrawer === 'function') { cart.closeDrawer(); }

        // Drop every other panel instantly (including one mid-close) so the
        // incoming sheet slides in over the persistent backdrop and two sheets
        // never occupy the space at once.
        var self0 = this;
        Object.keys(this.mounted).forEach(function (key) {
          if (key !== name && self0.mounted[key]) {
            if (self0._timers[key]) { clearTimeout(self0._timers[key]); self0._timers[key] = null; }
            self0.mounted[key] = false;
          }
        });

        if (this._timers[name]) { clearTimeout(this._timers[name]); this._timers[name] = null; }
        this.mounted[name] = true;
        this.active = null; // keep off-screen for the slide-in frame
        lockScroll();

        var self = this;
        function applyOpen() { self.active = name; }
        if (window.Alpine && typeof window.Alpine.nextTick === 'function') {
          window.Alpine.nextTick(function () {
            // Force a reflow so the open class triggers the transition,
            // same trick assets/cart.js uses for the mini-cart.
            var sheet = document.querySelector('.aico-panel--' + name);
            if (sheet) { void sheet.offsetHeight; }
            window.Alpine.nextTick(applyOpen);
          });
        } else {
          requestAnimationFrame(function () { requestAnimationFrame(applyOpen); });
        }
      },

      close: function () {
        var previous = this.active;
        if (!previous) { return; }
        this.active = null;
        unlockScroll();
        this._scheduleUnmount(previous);
      },

      toggle: function (name) {
        if (this.active === name) { this.close(); } else { this.open(name); }
      },

      _scheduleUnmount: function (name) {
        var self = this;
        if (this._timers[name]) { clearTimeout(this._timers[name]); }
        this._timers[name] = setTimeout(function () {
          self._timers[name] = null;
          if (self.active !== name) { self.mounted[name] = false; }
        }, ANIM_MS);
      },
    });
  }

  // ---- Search bootstrap config ------------------------------------

  function readSearchConfig() {
    var el = document.getElementById('aico-search-config');
    if (!el) { return null; }
    var cfg;
    try {
      cfg = JSON.parse(el.textContent);
    } catch (e) {
      return null;
    }
    if (!cfg || !cfg.meilisearch || !cfg.meilisearch.host || !cfg.meilisearch.searchKey || !cfg.meilisearch.indexName) {
      return null;
    }
    return cfg;
  }

  // ---- Hit → card transform (port of assets/products-page.js) ------

  function nonEmpty(s) {
    if (typeof s !== 'string') { return null; }
    var t = s.trim();
    return t === '' ? null : t;
  }

  function pickTranslation(list, locale) {
    if (!Array.isArray(list) || !list.length) { return null; }
    var normalized = String(locale || '').replace(/-/g, '_');
    for (var i = 0; i < list.length; i++) {
      var row = list[i];
      if (row && typeof row === 'object' && String(row.locale || '').replace(/-/g, '_') === normalized) {
        return row;
      }
    }
    for (var j = 0; j < list.length; j++) {
      var row2 = list[j];
      if (row2 && typeof row2 === 'object' && String(row2.locale || '').replace(/-/g, '_') === 'de_CH') {
        return row2;
      }
    }
    return list[0] || null;
  }

  function pickName(hit, locale) {
    var list = hit.translations;
    var primary = pickTranslation(list, locale) || {};
    var fromPrimary = nonEmpty(primary.webName) || nonEmpty(primary.name);
    if (fromPrimary) { return fromPrimary; }
    if (Array.isArray(list)) {
      for (var i = 0; i < list.length; i++) {
        var row = list[i];
        var n = nonEmpty(row && row.webName) || nonEmpty(row && row.name);
        if (n) { return n; }
      }
    }
    return nonEmpty(hit.sku) || '';
  }

  function pickImage(hit, locale) {
    var list = hit.translations;
    if (Array.isArray(list) && list.length) {
      var primary = pickTranslation(list, locale) || {};
      var fp = nonEmpty(primary.mainImage) || nonEmpty(primary.secondaryImage);
      if (fp) { return fp; }
      for (var i = 0; i < list.length; i++) {
        var row = list[i];
        var u = nonEmpty(row && row.mainImage) || nonEmpty(row && row.secondaryImage);
        if (u) { return u; }
      }
    }
    var top = nonEmpty(hit.mainImage);
    if (top) { return top; }
    var g = hit.imageGroup || {};
    var gm = nonEmpty(g.mainImage);
    if (gm) { return gm; }
    if (Array.isArray(g.images)) {
      for (var k = 0; k < g.images.length; k++) {
        var img = nonEmpty(g.images[k]);
        if (img) { return img; }
      }
    }
    return null;
  }

  function toNumber(v) {
    if (typeof v === 'number' && isFinite(v)) { return v; }
    if (typeof v === 'string' && v.trim() !== '') {
      var n = Number(v);
      return isFinite(n) ? n : null;
    }
    return null;
  }

  // Prices are resolved SERVER-SIDE only: the drawer sends the hit scout ids
  // to the prices endpoint (config.pricesApi) and each hit gets back the one
  // price this shopper is entitled to (`hit.pricing`). There is deliberately
  // NO client-side priceLists extraction or fallback — a hit without a
  // server-resolved price simply shows no price.
  function fetchServerPrices(hits, cfg) {
    var url = cfg && cfg.pricesApi;
    if (!url || !hits.length) { return Promise.resolve(); }
    var ids = [];
    hits.forEach(function (h) { if (h && h.id != null) { ids.push(h.id); } });
    if (!ids.length) { return Promise.resolve(); }
    var sep = url.indexOf('?') === -1 ? '?' : '&';
    return fetch(url + sep + 'ids=' + encodeURIComponent(ids.join(',')), {
      headers: { 'Accept': 'application/json' },
      credentials: 'same-origin',
    }).then(function (r) { return r.ok ? r.json() : {}; }).then(function (priced) {
      hits.forEach(function (h) {
        var p = (priced[h.id] != null) ? priced[h.id] : priced[String(h.id)];
        if (p) { h.pricing = p; }
      });
    }).catch(function () { /* no price shown for unresolved hits */ });
  }

  function extractPricing(hit) {
    var p = hit && hit.pricing;
    if (!p || typeof p !== 'object') { return null; }
    var sp = toNumber(p.sellingPrice);
    if (sp == null) { return null; }
    var dp = toNumber(p.discountPrice);
    var isOnSale = !!p.isOnSale && dp != null && dp > 0 && dp < sp;
    return {
      sellingPrice: sp,
      discountPrice: isOnSale ? dp : null,
      isOnSale: isOnSale,
      currencyCode: typeof p.currencyCode === 'string' ? p.currencyCode : null,
    };
  }

  var moneyCache = {};
  function formatMoney(amount, currencyCode, locale) {
    var lc = (locale || 'en').replace(/_/g, '-');
    if (amount == null) { return null; }
    // CHF prices display rounded UP to the nearest 0.05 (display only).
    if (currencyCode && String(currencyCode).toUpperCase() === 'CHF') {
      amount = Math.ceil(Math.round((amount / 0.05) * 1e6) / 1e6) * 0.05;
    }
    if (!currencyCode || !/^[A-Z]{3}$/.test(currencyCode.toUpperCase())) {
      return amount.toFixed(2);
    }
    var key = lc + '|' + currencyCode.toUpperCase();
    if (!moneyCache[key]) {
      try {
        moneyCache[key] = new Intl.NumberFormat(lc, { style: 'currency', currency: currencyCode.toUpperCase() });
      } catch (e) {
        return amount.toFixed(2) + ' ' + currencyCode.toUpperCase();
      }
    }
    return moneyCache[key].format(amount);
  }

  function discountPercentOf(p) {
    if (!p || !p.isOnSale || p.discountPrice == null || p.sellingPrice <= 0 || p.discountPrice >= p.sellingPrice) {
      return null;
    }
    var pct = Math.round(((p.sellingPrice - p.discountPrice) / p.sellingPrice) * 100);
    return pct > 0 ? pct : null;
  }

  function mapHit(hit, cfg) {
    var id = String(hit.productId != null ? hit.productId : (hit.id != null ? hit.id : (hit.urlHandle || '')));
    var urlHandle = (typeof hit.urlHandle === 'string' && hit.urlHandle.trim()) ? hit.urlHandle.trim() : id;
    var pricing = extractPricing(hit);
    var displayed = pricing ? (pricing.isOnSale && pricing.discountPrice != null ? pricing.discountPrice : pricing.sellingPrice) : null;
    var prefix = cfg.productUrlPrefix || '/products/';
    var suffix = cfg.productUrlQuery || '';
    // The hit carries only brandId; resolve the small square brand icon +
    // label from the server-built map so each result shows its brand.
    var brandId = (hit.brandId != null && isFinite(Number(hit.brandId))) ? Number(hit.brandId) : null;
    var brands = (cfg.brands && typeof cfg.brands === 'object') ? cfg.brands : {};
    var brandInfo = brandId != null ? brands[String(brandId)] : null;
    return {
      id: id,
      title: pickName(hit, cfg.locale) || id,
      url: prefix + encodeURIComponent(urlHandle) + suffix,
      image: pickImage(hit, cfg.locale),
      priceLabel: pricing ? formatMoney(displayed, pricing.currencyCode, cfg.locale) : null,
      compareLabel: (pricing && pricing.isOnSale && pricing.discountPrice != null)
        ? formatMoney(pricing.sellingPrice, pricing.currencyCode, cfg.locale)
        : null,
      discountPercent: discountPercentOf(pricing),
      onSale: !!(pricing && pricing.isOnSale),
      discontinued: !!hit.isDiscontinued,
      brandId: brandId,
      brandIcon: (brandInfo && brandInfo.icon) ? brandInfo.icon : null,
      brandLabel: (brandInfo && brandInfo.label) ? brandInfo.label : null,
      gender: (typeof hit.gender === 'string' && hit.gender !== '') ? hit.gender : null,
    };
  }

  // ---- Search Alpine component ------------------------------------

  var PRELOAD_LIMIT = 12;
  var QUERY_LIMIT = 8;

  function registerSearchComponent() {
    Alpine.data('aicoSearch', function () {
      return {
        query: '',
        results: [],
        loading: false,
        searched: false,   // a typed query has returned (drives the no-results state)
        error: false,
        total: 0,
        isPreload: false,   // current results are the preloaded set, not a typed query
        preloaded: false,   // preload fetch has been kicked off
        minChars: 2,
        _debounce: null,
        _seq: 0,
        _preloadResults: null,
        cfg: null,
        i18n: null,

        init: function () {
          this.cfg = readSearchConfig();
          this.i18n = (typeof window !== 'undefined' && window.__AICO_SEARCH_I18N__) || null;
        },

        get configured() { return !!this.cfg; },

        // Localized gender label ('men' → 'Herren'); falls back to the raw value.
        genderLabel: function (gender) {
          if (!gender) { return ''; }
          var map = (this.i18n && this.i18n.gender) || {};
          return map[gender] || gender;
        },

        // Preload products the first time the drawer opens (empty query →
        // newest products, like aico-commerce's search panel), cached so
        // re-opening doesn't refetch.
        ensurePreloaded: function () {
          if (!this.cfg || this.preloaded) { return; }
          this.preloaded = true;
          this.runFetch('', true);
        },

        onInput: function () {
          var q = (this.query || '').trim();
          if (this._debounce) { clearTimeout(this._debounce); }
          if (q.length < this.minChars) {
            // Below the threshold → fall back to the preloaded set.
            this._seq++; // cancel any in-flight typed query
            this.error = false;
            this.searched = false;
            this.loading = false;
            if (this._preloadResults) {
              this.results = this._preloadResults;
              this.total = this._preloadResults.length;
              this.isPreload = true;
            } else {
              this.results = [];
              this.total = 0;
              this.isPreload = false;
              this.ensurePreloaded();
            }
            return;
          }
          this.loading = true;
          var self = this;
          this._debounce = setTimeout(function () { self.runFetch(q, false); }, 250);
        },

        runFetch: function (q, isPreload) {
          var cfg = this.cfg;
          if (!cfg) { this.loading = false; return; }
          var seq = ++this._seq;
          var self = this;
          // Typed queries order A→Z like the b2b-shop side search; the
          // preload shows the newest products like aico-commerce.
          var sortKey = isPreload ? '-date' : 'name';
          var sortExpr = (cfg.sortExpressions && cfg.sortExpressions[sortKey]) || 'translations.name:asc';
          var url = cfg.meilisearch.host + '/indexes/' + encodeURIComponent(cfg.meilisearch.indexName) + '/search';
          var body = {
            q: q,
            limit: isPreload ? PRELOAD_LIMIT : QUERY_LIMIT,
            offset: 0,
            filter: (cfg.scope && cfg.scope.filter) || '',
            sort: [sortExpr],
          };
          this.loading = true;
          fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + cfg.meilisearch.searchKey,
            },
            body: JSON.stringify(body),
          }).then(function (r) {
            if (!r.ok) { throw new Error('meilisearch ' + r.status); }
            return r.json();
          }).then(function (data) {
            var hits = (data && Array.isArray(data.hits)) ? data.hits : [];
            // Attach the server-resolved entitled price to each hit before
            // mapping — the only price source for the drawer.
            return fetchServerPrices(hits, cfg).then(function () { return { data: data, hits: hits }; });
          }).then(function (priced) {
            if (seq !== self._seq) { return; } // a newer query superseded this one
            var data = priced.data;
            var hits = priced.hits;
            var products = hits.map(function (h) { return mapHit(h, cfg); });
            var estimated = (data && typeof data.estimatedTotalHits === 'number')
              ? data.estimatedTotalHits
              : products.length;
            if (isPreload) {
              self._preloadResults = products;
              // Only surface the preload if the user hasn't started typing.
              if ((self.query || '').trim().length < self.minChars) {
                self.results = products;
                self.total = estimated;
                self.isPreload = true;
                self.searched = false;
              }
            } else {
              self.results = products;
              self.total = estimated;
              self.isPreload = false;
              self.searched = true;
            }
            self.loading = false;
            self.error = false;
          }).catch(function () {
            if (seq !== self._seq) { return; }
            self.loading = false;
            self.error = true;
            if (isPreload) {
              self.preloaded = false; // allow a retry on the next open
            } else {
              self.results = [];
              self.total = 0;
              self.searched = true;
            }
          });
        },

        clear: function () {
          if (this._debounce) { clearTimeout(this._debounce); }
          this._seq++;
          this.query = '';
          this.searched = false;
          this.loading = false;
          this.error = false;
          // Restore the preloaded set rather than emptying the drawer.
          if (this._preloadResults) {
            this.results = this._preloadResults;
            this.total = this._preloadResults.length;
            this.isPreload = true;
          } else {
            this.results = [];
            this.total = 0;
            this.isPreload = false;
            this.ensurePreloaded();
          }
        },
      };
    });
  }

  // ---- Cross-exclusion: close menu/search when the cart opens ------
  // Covers the cart's own open paths (header button, add-to-cart auto-open
  // in assets/cart.js) without that file needing to know about panels.
  function watchCart() {
    if (!window.Alpine || typeof window.Alpine.effect !== 'function') { return; }
    window.Alpine.effect(function () {
      var cart = Alpine.store('cart');
      var panels = Alpine.store('panels');
      if (cart && cart.drawerOpen && panels && panels.active) {
        panels.close();
      }
    });
  }

  document.addEventListener('alpine:init', function () {
    registerPanelsStore();
    registerSearchComponent();
    watchCart();
  });
})();
