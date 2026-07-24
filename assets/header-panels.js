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
// page. Results are ranked by relevance and matched against product identity
// only (name / SKU / EAN). Nothing is fetched until the shopper types; further
// pages load lazily as the list is scrolled, and the term is persisted to
// localStorage so it survives navigating to a product and back.

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
    // CHF prices display rounded to the NEAREST 0.05 (display only), like the legacy shop.
    if (currencyCode && String(currencyCode).toUpperCase() === 'CHF') {
      amount = Math.round(amount / 0.05) * 0.05;
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

  // The index's translation rows are keyed `en` / `de_CH`, NOT the storefront
  // locale (`en_US` / `de_CH`) — so translation lookups use the server-supplied
  // `indexLocale`, while money formatting keeps the real BCP-47 `locale`.
  // Falling back to `locale` keeps an older cached config working.
  function translationLocale(cfg) {
    return (cfg && cfg.indexLocale) || (cfg && cfg.locale) || 'en';
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
      title: pickName(hit, translationLocale(cfg)) || id,
      url: prefix + encodeURIComponent(urlHandle) + suffix,
      image: pickImage(hit, translationLocale(cfg)),
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
      sku: (typeof hit.sku === 'string' && hit.sku !== '') ? hit.sku : null,
    };
  }

  // ---- Search Alpine component ------------------------------------

  // One page of results. The drawer never preloads: with no query there is
  // nothing to show, so the first request only fires once the shopper has
  // typed `minChars` characters. Further pages are pulled in by the sentinel
  // observer as the results list is scrolled.
  var PAGE_SIZE = 12;

  // The term survives navigation, so opening a result and coming back leaves
  // the search intact. sessionStorage would die with the tab; localStorage
  // also survives a reload, which is what "going to a page does not clear it"
  // asks for.
  var STORAGE_KEY = 'aico:search:query';

  function readStoredQuery() {
    try {
      var stored = window.localStorage.getItem(STORAGE_KEY);
      return typeof stored === 'string' ? stored : '';
    } catch (e) {
      return ''; // storage disabled / private mode
    }
  }

  function writeStoredQuery(query) {
    try {
      if (query) {
        window.localStorage.setItem(STORAGE_KEY, query);
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch (e) { /* non-fatal — the drawer just forgets between pages */ }
  }

  function registerSearchComponent() {
    Alpine.data('aicoSearch', function () {
      return {
        query: '',
        results: [],
        loading: false,      // the first page of a query is in flight
        loadingMore: false,  // a follow-up page is in flight
        searched: false,     // a query has returned (drives the no-results state)
        error: false,
        total: 0,
        hasMore: false,
        minChars: 2,
        _debounce: null,
        _seq: 0,
        _observer: null,
        cfg: null,
        i18n: null,

        init: function () {
          this.cfg = readSearchConfig();
          this.i18n = (typeof window !== 'undefined' && window.__AICO_SEARCH_I18N__) || null;
          // Restore the last term into the input but do NOT search yet: the
          // fetch waits until the drawer is actually opened (onOpen), so a
          // page load never costs a Meilisearch request.
          this.query = readStoredQuery();
        },

        destroy: function () {
          if (this._observer) { this._observer.disconnect(); this._observer = null; }
          if (this._debounce) { clearTimeout(this._debounce); }
        },

        get configured() { return !!this.cfg; },

        // Localized gender label ('men' → 'Herren'); falls back to the raw value.
        genderLabel: function (gender) {
          if (!gender) { return ''; }
          var map = (this.i18n && this.i18n.gender) || {};
          return map[gender] || gender;
        },

        // Drawer opened: run the restored term once. Results are kept after
        // that, so re-opening the drawer doesn't refetch.
        onOpen: function () {
          if (!this.cfg) { return; }
          var query = (this.query || '').trim();
          if (query.length >= this.minChars && !this.results.length && !this.loading) {
            this.runQuery(query);
          }
        },

        onInput: function () {
          var query = (this.query || '').trim();
          writeStoredQuery(query);
          if (this._debounce) { clearTimeout(this._debounce); }
          if (query.length < this.minChars) {
            // Below the threshold there is nothing to show — the drawer has
            // no preloaded set to fall back to any more.
            this._seq++; // cancel any in-flight query
            this.resetResults();
            this.loading = false;
            this.error = false;
            this.searched = false;
            return;
          }
          this.loading = true;
          var self = this;
          this._debounce = setTimeout(function () { self.runQuery(query); }, 250);
        },

        resetResults: function () {
          this.results = [];
          this.total = 0;
          this.hasMore = false;
          this.loadingMore = false;
        },

        // First page of a term — drops whatever is currently listed.
        runQuery: function (query) {
          this.resetResults();
          this.loading = true;
          this.runFetch(query, 0, false);
        },

        // Next page, driven by the sentinel scrolling into view.
        loadMore: function () {
          if (!this.cfg || !this.hasMore || this.loading || this.loadingMore) { return; }
          var query = (this.query || '').trim();
          if (query.length < this.minChars) { return; }
          this.loadingMore = true;
          this.runFetch(query, this.results.length, true);
        },

        // Watch the sentinel that sits below the list, rooted on the scrolling
        // panel body, so paging triggers on actually reaching the bottom rather
        // than on a scroll-position guess. Re-runs whenever Alpine recreates
        // the results block, hence the disconnect first.
        initSentinel: function (el) {
          if (!el || typeof IntersectionObserver !== 'function') { return; }
          if (this._observer) { this._observer.disconnect(); }
          var self = this;
          this._observer = new IntersectionObserver(function (entries) {
            for (var i = 0; i < entries.length; i++) {
              if (entries[i].isIntersecting) { self.loadMore(); }
            }
          }, { root: el.closest('.aico-search-body') || null, rootMargin: '200px' });
          this._observer.observe(el);
        },

        runFetch: function (query, offset, append) {
          var cfg = this.cfg;
          if (!cfg) { this.loading = false; this.loadingMore = false; return; }
          var seq = ++this._seq;
          var self = this;
          // No sort expression: Meilisearch ranks by relevance, same as the
          // server-side product search (ProductCatalogLoader::searchProductsForApi).
          // Forcing A→Z here reordered the whole result set alphabetically, so
          // an exact name match ("Colorado") lost its place to whatever
          // happened to start with an "A".
          var url = cfg.meilisearch.host + '/indexes/' + encodeURIComponent(cfg.meilisearch.indexName) + '/search';
          var body = {
            q: query,
            limit: PAGE_SIZE,
            offset: offset,
            filter: (cfg.scope && cfg.scope.filter) || '',
          };
          // Identity-only whitelist (name / SKU / EAN) served in the config:
          // the index is `searchableAttributes: ['*']`, so without it a query
          // also matches facet LABELS ("Color", "Size"), image URLs and locale
          // codes — typing "col" returned the whole catalogue.
          if (Array.isArray(cfg.meilisearch.attributesToSearchOn) && cfg.meilisearch.attributesToSearchOn.length) {
            body.attributesToSearchOn = cfg.meilisearch.attributesToSearchOn;
          }
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
            var products = priced.hits.map(function (h) { return mapHit(h, cfg); });
            self.results = append ? self.results.concat(products) : products;
            var estimated = (data && typeof data.estimatedTotalHits === 'number')
              ? data.estimatedTotalHits
              : self.results.length;
            self.total = estimated;
            // Only claim another page when this one came back FULL and the
            // running count is still short of the estimate — a last page that
            // exactly fills PAGE_SIZE would otherwise cost one empty fetch.
            self.hasMore = products.length === PAGE_SIZE && self.results.length < estimated;
            self.searched = true;
            self.loading = false;
            self.loadingMore = false;
            self.error = false;
          }).catch(function () {
            if (seq !== self._seq) { return; }
            self.loading = false;
            self.loadingMore = false;
            if (append) {
              // Keep the pages already listed; just stop paging.
              self.hasMore = false;
            } else {
              self.error = true;
              self.resetResults();
              self.searched = true;
            }
          });
        },

        clear: function () {
          if (this._debounce) { clearTimeout(this._debounce); }
          this._seq++;
          this.query = '';
          writeStoredQuery('');
          this.resetResults();
          this.searched = false;
          this.loading = false;
          this.error = false;
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
