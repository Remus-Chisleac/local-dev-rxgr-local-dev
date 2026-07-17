// Aico storefront — products page client controller.
//
// Hydrates the server-rendered products listing: live search, sort,
// facet toggles, size-chip group selection, and infinite scroll.
// Talks to Meilisearch directly with the public read-only key (same
// pattern as aico-commerce / b2b-shop) and mirrors the PHP
// `ProductCatalogLoader` hit→card transform so JS-rendered cards are
// indistinguishable from the server-rendered first page.
//
// Layout: top filter bar (search pill + filters dropdown + sort) and
// a mega-panel that animates open below the bar with the facet
// columns + size-chip row.

(function () {
  'use strict';

  var rootEl = document.querySelector('[data-aico-products-controller]');
  if (!rootEl) {
    return;
  }

  var configEl = document.getElementById('aico-products-config');
  if (!configEl) {
    return;
  }

  var config;
  try {
    config = JSON.parse(configEl.textContent);
  } catch (e) {
    console.warn('aico-products: invalid bootstrap config', e);
    return;
  }

  if (!config || !config.meilisearch || !config.meilisearch.host || !config.meilisearch.searchKey || !config.meilisearch.indexName) {
    return;
  }

  // ---- DOM refs ---------------------------------------------------

  var grid = rootEl.querySelector('[data-aico-products-grid]');
  var sentinel = rootEl.querySelector('[data-aico-products-sentinel]');
  var emptyEl = rootEl.querySelector('[data-aico-empty]');
  var loaderEl = rootEl.querySelector('[data-aico-loader]');
  var endEl = rootEl.querySelector('[data-aico-end]');
  var countEl = rootEl.querySelector('[data-aico-results-count]');
  var searchInput = rootEl.querySelector('[data-aico-search-input]');
  var sortSelect = rootEl.querySelector('[data-aico-sort-select]');
  var clearAllBtn = rootEl.querySelector('[data-aico-clear-all]');
  var panelToggle = rootEl.querySelector('[data-aico-panel-toggle]');
  var panel = rootEl.querySelector('[data-aico-panel]');
  var filterCountBadge = rootEl.querySelector('[data-aico-filter-count]');
  var facetColumnsEl = rootEl.querySelector('[data-aico-facet-columns]');
  var sizesSection = rootEl.querySelector('[data-aico-sizes-section]');
  var sizesRow = rootEl.querySelector('[data-aico-size-chips]');

  // ---- Config defaults --------------------------------------------

  var SIZE_FACET_ATTRIBUTE = (config.facetAttributes && config.facetAttributes.sizes) || 'size.data.filterValue';
  var EU_SIZES = Array.isArray(config.euSizes) ? config.euSizes.slice() : [];
  var EU_SIZES_SET = {};
  for (var ei = 0; ei < EU_SIZES.length; ei++) {
    EU_SIZES_SET[EU_SIZES[ei]] = true;
  }

  // ---- State ------------------------------------------------------

  var state = {
    query: (config.initial && config.initial.query) || '',
    sort: (config.initial && config.initial.sort) || '-date',
    appliedFacets: copyAppliedFacets(config.initial && config.initial.appliedFacets),
    page: 1,
    totalHits: 0,
    loading: false,
    exhausted: false,
    // Last seen facet distribution — used to expand size chip
    // selections to the warehouse-prefixed raw values Meilisearch
    // expects in the filter clause.
    lastDistribution: {},
  };

  // Preset category — the category facet values already present in the
  // URL at page init (before any user interaction), e.g. arriving from a
  // menu link. A preset hides the category facet group entirely and is
  // sticky: "clear all" re-applies it. Categories picked by the user on
  // an unfiltered listing stay clearable as before.
  var PRESET_CATEGORIES = (state.appliedFacets.category || []).slice();

  function hasPresetCategory() {
    return PRESET_CATEGORIES.length > 0;
  }

  function copyAppliedFacets(obj) {
    var out = {};
    if (!obj || typeof obj !== 'object') {
      return out;
    }
    Object.keys(obj).forEach(function (key) {
      if (Array.isArray(obj[key])) {
        out[key] = obj[key].slice();
      }
    });
    return out;
  }

  // ---- Size grouping (mirrors SizeFacetGrouper) -------------------

  function parseEuSizeForSort(size) {
    var s = String(size || '').trim();
    if (s === '') {
      return 0;
    }
    var parts = s.split(' ');
    var base = parseFloat(parts[0]);
    if (isNaN(base)) {
      return 0;
    }
    if (parts.length === 1) {
      return base;
    }
    var fraction = parts[1];
    if (fraction && fraction.indexOf('/') !== -1) {
      var pieces = fraction.split('/').map(Number);
      if (!isNaN(pieces[0]) && !isNaN(pieces[1]) && pieces[1] !== 0) {
        return base + pieces[0] / pieces[1];
      }
    }
    return base;
  }

  function getEuSizeGroup(euSize) {
    var size = String(euSize || '').trim();
    var value = parseEuSizeForSort(size);
    if (value === 0 && size !== '0') {
      return [size];
    }
    var base;
    if (size.indexOf('2/3') !== -1) {
      base = Math.ceil(value);
    } else if (size.indexOf('1/3') !== -1) {
      base = Math.floor(value);
    } else {
      base = Math.round(value);
    }
    var patterns = [(base - 1) + ' 2/3', String(base), base + ' 1/3'];
    var group = [];
    for (var i = 0; i < patterns.length; i++) {
      if (EU_SIZES_SET[patterns[i]] && group.indexOf(patterns[i]) === -1) {
        group.push(patterns[i]);
      }
    }
    if (!group.length) {
      return [size];
    }
    group.sort(function (a, b) { return parseEuSizeForSort(a) - parseEuSizeForSort(b); });
    return group;
  }

  function getMiddleSizeFromGroup(euSizeGroup) {
    if (!euSizeGroup.length) {
      return '';
    }
    for (var i = 0; i < euSizeGroup.length; i++) {
      var s = String(euSizeGroup[i]);
      var parsed = parseEuSizeForSort(s);
      if (parsed === Math.floor(parsed) && s.indexOf('/') === -1) {
        return s;
      }
    }
    return String(euSizeGroup[Math.floor(euSizeGroup.length / 2)] || '');
  }

  function stripWarehousePrefix(value) {
    var m = String(value).match(/^\d+-(.+)$/);
    return m ? m[1] : String(value);
  }

  // Size-grouping universe: the set getEuSizeGroup checks band patterns
  // against. The server ships `config.euSizes` empty and leaves the ⅓-step
  // grouping to the client, so we seed a canonical EU ⅓-step ladder (matches
  // b2b-shop's static sizeCharts). It is deliberately NOT derived from the
  // live size distribution: a filtered result set can be missing a whole
  // size while still having its thirds, which makes getEuSizeGroup anchor the
  // band on a fraction (e.g. "34 1/3" instead of "34"). A fixed ladder keeps
  // every band's middle on a whole size. Seeded once; any arg is ignored.
  var euUniverseSeeded = false;
  function setEuUniverse() {
    if (euUniverseSeeded) {
      return;
    }
    euUniverseSeeded = true;
    // Respect a theme-provided euSizes list when present.
    if (Object.keys(EU_SIZES_SET).length > 0) {
      return;
    }
    for (var euLadderN = 33; euLadderN <= 52; euLadderN++) {
      EU_SIZES_SET[String(euLadderN)] = true;
      EU_SIZES_SET[euLadderN + ' 1/3'] = true;
      EU_SIZES_SET[euLadderN + ' 2/3'] = true;
    }
  }

  function buildSizeChips(distribution) {
    if (!distribution) {
      return [];
    }
    var values = Object.keys(distribution);
    if (!values.length) {
      return [];
    }
    var existingEu = {};
    for (var i = 0; i < values.length; i++) {
      existingEu[stripWarehousePrefix(values[i])] = true;
    }
    var byMiddle = {};
    for (var j = 0; j < values.length; j++) {
      var raw = values[j];
      var eu = stripWarehousePrefix(raw);
      var group = getEuSizeGroup(eu);
      var hit = false;
      for (var k = 0; k < group.length; k++) {
        if (existingEu[group[k]]) {
          hit = true;
          break;
        }
      }
      if (!hit) {
        continue;
      }
      var middle = getMiddleSizeFromGroup(group);
      if (!byMiddle[middle]) {
        byMiddle[middle] = { display: middle, totalCount: 0 };
      }
      byMiddle[middle].totalCount += distribution[raw] || 0;
    }
    var rows = [];
    Object.keys(byMiddle).forEach(function (k) { rows.push(byMiddle[k]); });
    rows.sort(function (a, b) { return parseEuSizeForSort(a.display) - parseEuSizeForSort(b.display); });
    return rows;
  }

  function expandSelectedDisplaysToRawValues(selectedDisplays, distribution) {
    if (!selectedDisplays.length || !distribution) {
      return [];
    }
    var rawByEu = {};
    Object.keys(distribution).forEach(function (raw) {
      var eu = stripWarehousePrefix(raw);
      if (!rawByEu[eu]) {
        rawByEu[eu] = [];
      }
      rawByEu[eu].push(raw);
    });
    var out = [];
    selectedDisplays.forEach(function (display) {
      var d = String(display || '').trim();
      if (!d) {
        return;
      }
      getEuSizeGroup(d).forEach(function (eu) {
        (rawByEu[eu] || []).forEach(function (raw) {
          if (out.indexOf(raw) === -1) {
            out.push(raw);
          }
        });
      });
    });
    return out;
  }

  // ---- Filter expression (mirrors ProductCatalogLoader::buildFilter) --

  function escapeFilterString(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function normalizeColor(value) {
    var v = String(value).trim();
    if (!v) {
      return v;
    }
    if (v.charAt(0) === '#') {
      return v.toUpperCase();
    }
    if (/^[0-9a-fA-F]{6}$/.test(v)) {
      return '#' + v.toUpperCase();
    }
    return v;
  }

  function stringFacetOrClause(attribute, values) {
    var ors = values.map(function (v) {
      return attribute + ' = "' + escapeFilterString(v) + '"';
    });
    return '(' + ors.join(' OR ') + ')';
  }

  // Same-facet multi-select narrows results: the indexed attribute is an
  // array of a product's variants, so requiring every selected value (AND)
  // matches b2b-shop. Only the size grouping above uses OR.
  function stringFacetAndClause(attribute, values) {
    var ands = values.map(function (v) {
      return attribute + ' = "' + escapeFilterString(v) + '"';
    });
    return '(' + ands.join(' AND ') + ')';
  }

  function buildFilter() {
    var parts = [];
    if (config.scope && config.scope.filter) {
      parts.push(config.scope.filter);
    }
    Object.keys(state.appliedFacets).forEach(function (facetId) {
      var values = state.appliedFacets[facetId] || [];
      if (!values.length) {
        return;
      }
      if (facetId === 'sale') {
        // kj: match the B2B selling list's own discount (server-built clause),
        // not any discounted list — else regular products show as on sale.
        parts.push(config.saleFilter || 'isSaleInPriceLists IS NOT EMPTY');
        return;
      }
      if (facetId === 'sizes') {
        // Each selected band is an OR of its raw ⅓/⅔ values; multiple bands
        // are AND'd (one clause each), so a product must be available in
        // every chosen size — e.g. 34 AND 37, each incl. its thirds.
        var sizeDistribution = state.lastDistribution[SIZE_FACET_ATTRIBUTE] || {};
        values.forEach(function (display) {
          var bandRaws = expandSelectedDisplaysToRawValues([display], sizeDistribution);
          if (bandRaws.length) {
            parts.push(stringFacetOrClause(SIZE_FACET_ATTRIBUTE, bandRaws));
          }
        });
        return;
      }
      var attr = config.facetAttributes[facetId];
      if (!attr) {
        return;
      }
      var clean = facetId === 'color' ? values.map(normalizeColor) : values;
      parts.push(stringFacetAndClause(attr, clean));
    });
    return parts.join(' AND ');
  }

  // ---- URL sync ---------------------------------------------------

  // The listing's base pathname: the current path with any `/filter/...`
  // tail from a previous sync cut off. Anchoring on the `filter` segment
  // (not on a literal `products`) keeps the `__storefront-preview/<slug>`
  // / locale prefix intact AND works when the theme's route map serves
  // the listing under a custom prefix (e.g. `/shop`).
  function productsBasePath() {
    var segs = window.location.pathname.split('/');
    var idx = segs.indexOf('filter');
    if (idx === -1) {
      return window.location.pathname;
    }
    return segs.slice(0, idx).join('/');
  }

  // Applied facets ride the URL PATH, b2b-shop style:
  // /products/filter/<facetId>/<value>/... — pairs of segments, one per
  // selected value. The server parses the same shape back into
  // config.initial.appliedFacets (ProductCatalogLoader::appliedFacetsFromPath).
  // A value with a literal `/` can't be a path segment (the server's route
  // param is URL-decoded, which would split it), so it stays on the legacy
  // ?facet[id][]= query form the server still accepts.
  function syncUrl() {
    var params = new URLSearchParams();
    if (state.query) {
      params.set('q', state.query);
    }
    if (state.sort && state.sort !== '-date') {
      params.set('sort', state.sort);
    }
    var filterSegs = [];
    Object.keys(state.appliedFacets).forEach(function (facetId) {
      (state.appliedFacets[facetId] || []).forEach(function (v) {
        var value = String(v);
        if (value.indexOf('/') !== -1) {
          params.append('facet[' + facetId + '][]', value);
          return;
        }
        filterSegs.push(encodeURIComponent(facetId) + '/' + encodeURIComponent(value));
      });
    });
    var qs = params.toString();
    var path = productsBasePath()
      + (filterSegs.length ? '/filter/' + filterSegs.join('/') : '')
      + (qs ? '?' + qs : '');
    try {
      window.history.replaceState(window.history.state, '', path);
    } catch (e) {
      // Some browsers throw on replaceState in unusual contexts (sandboxed iframes); ignore.
    }
  }

  // ---- Meilisearch transport --------------------------------------

  function meiliSearch(opts) {
    var url = config.meilisearch.host + '/indexes/' + encodeURIComponent(config.meilisearch.indexName) + '/search';
    var body = {
      q: state.query || '',
      limit: config.meilisearch.hitsPerPage,
      offset: opts.offset,
      filter: buildFilter(),
      sort: [config.sortExpressions[state.sort] || config.sortExpressions['-date']],
    };
    if (opts.includeFacets) {
      body.facets = Object.keys(config.facetAttributes)
        .map(function (id) { return config.facetAttributes[id]; })
        .filter(Boolean);
    }
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + config.meilisearch.searchKey,
      },
      body: JSON.stringify(body),
    }).then(function (r) {
      if (!r.ok) {
        throw new Error('meilisearch ' + r.status);
      }
      return r.json();
    }).then(function (resp) {
      // The v2 product index is price-free; batch-fetch the separated price
      // index and attach priceLists so extractPricing can resolve a price.
      return mergeSeparatedPrices(resp).then(function () { return resp; });
    });
  }

  // Batch-fetch the separated price index for the current hits (by scout id)
  // and attach `priceLists`/`variantPrices` onto each hit. No-op on the legacy
  // embedded-price deployment (config.meilisearch.pricesIndex is null).
  // Resolve prices SERVER-SIDE: send the hit scout ids to the prices endpoint
  // and attach the resolved price each shopper is entitled to onto `hit.pricing`.
  // The browser never touches the price index, so other price lists can't leak.
  function mergeSeparatedPrices(resp) {
    var url = config.pricesApi;
    var hits = (resp && Array.isArray(resp.hits)) ? resp.hits : [];
    if (!url || hits.length === 0) {
      return Promise.resolve();
    }
    var ids = [];
    hits.forEach(function (h) { if (h && h.id != null) { ids.push(h.id); } });
    if (ids.length === 0) {
      return Promise.resolve();
    }
    var sep = url.indexOf('?') === -1 ? '?' : '&';
    return fetch(url + sep + 'ids=' + encodeURIComponent(ids.join(',')), {
      headers: { 'Accept': 'application/json' },
      credentials: 'same-origin',
    }).then(function (r) { return r.ok ? r.json() : {}; }).then(function (priced) {
      hits.forEach(function (h) {
        var p = (priced[h.id] != null) ? priced[h.id] : priced[String(h.id)];
        if (p) { h.pricing = p; }
      });
    }).catch(function () { /* leave prices unset → product hidden by the no-price rule */ });
  }

  // ---- Hit → card transform (port of PHP ProductCatalogLoader) -----

  function nonEmpty(s) {
    if (typeof s !== 'string') {
      return null;
    }
    var t = s.trim();
    return t === '' ? null : t;
  }

  function pickTranslation(list, locale) {
    if (!Array.isArray(list) || !list.length) {
      return null;
    }
    var normalized = String(locale || '').replace(/-/g, '_');
    for (var i = 0; i < list.length; i++) {
      var row = list[i];
      if (row && typeof row === 'object') {
        var rl = String(row.locale || '').replace(/-/g, '_');
        if (rl === normalized) {
          return row;
        }
      }
    }
    for (var j = 0; j < list.length; j++) {
      var row2 = list[j];
      if (row2 && typeof row2 === 'object') {
        var rl2 = String(row2.locale || '').replace(/-/g, '_');
        if (rl2 === 'de_CH') {
          return row2;
        }
      }
    }
    return list[0] || null;
  }

  function pickName(hit, locale) {
    var list = hit.translations;
    var primary = pickTranslation(list, locale) || {};
    var fromPrimary = nonEmpty(primary.webName) || nonEmpty(primary.name);
    if (fromPrimary) {
      return fromPrimary;
    }
    if (Array.isArray(list)) {
      for (var i = 0; i < list.length; i++) {
        var row = list[i];
        var n = nonEmpty(row && row.webName) || nonEmpty(row && row.name);
        if (n) {
          return n;
        }
      }
    }
    return nonEmpty(hit.sku) || '';
  }

  function pickImage(hit, locale) {
    var list = hit.translations;
    if (Array.isArray(list) && list.length) {
      var primary = pickTranslation(list, locale) || {};
      var fp = nonEmpty(primary.mainImage) || nonEmpty(primary.secondaryImage);
      if (fp) {
        return fp;
      }
      for (var i = 0; i < list.length; i++) {
        var row = list[i];
        var u = nonEmpty(row && row.mainImage) || nonEmpty(row && row.secondaryImage);
        if (u) {
          return u;
        }
      }
    }
    var top = nonEmpty(hit.mainImage);
    if (top) {
      return top;
    }
    var g = hit.imageGroup || {};
    var gm = nonEmpty(g.mainImage);
    if (gm) {
      return gm;
    }
    if (Array.isArray(g.images)) {
      for (var k = 0; k < g.images.length; k++) {
        var img = nonEmpty(g.images[k]);
        if (img) {
          return img;
        }
      }
    }
    return null;
  }

  function toNumber(v) {
    if (typeof v === 'number' && isFinite(v)) {
      return v;
    }
    if (typeof v === 'string' && v.trim() !== '') {
      var n = Number(v);
      return isFinite(n) ? n : null;
    }
    return null;
  }

  function rowCurrencyName(row) {
    var c = row && row.currency;
    if (c && typeof c === 'object' && typeof c.name === 'string') {
      var t = c.name.trim();
      return t === '' ? null : t;
    }
    return null;
  }

  function pickBestRow(rows, preferredCurrency) {
    var objectRows = (rows || []).filter(function (r) { return r && typeof r === 'object'; });
    var hasSelling = function (row) { return toNumber(row.sellingPrice) !== null; };
    if (preferredCurrency) {
      // Strict currency match — never cross-fall-back to a foreign
      // currency row (mirrors ProductPriceResolver::pickBestRow + the
      // b2b-shop contract). No matching row → null → "price on request".
      var needle = preferredCurrency.toUpperCase();
      for (var i = 0; i < objectRows.length; i++) {
        var cn = rowCurrencyName(objectRows[i]);
        if (cn && cn.toUpperCase() === needle && hasSelling(objectRows[i])) {
          return objectRows[i];
        }
      }
      return null;
    }
    // Only when no debtor currency was resolved (logged-out preview) do
    // we fall back to the first priced row.
    for (var j = 0; j < objectRows.length; j++) {
      if (hasSelling(objectRows[j])) {
        return objectRows[j];
      }
    }
    return null;
  }

  function tryPriceFromRows(entry, preferred) {
    var rows = entry.priceListRows;
    if (!Array.isArray(rows) || !rows.length) {
      return null;
    }
    var row = pickBestRow(rows, preferred);
    if (!row) {
      return null;
    }
    var sp = toNumber(row.sellingPrice);
    if (sp == null) {
      return null;
    }
    var dp = toNumber(row.discountPrice) || 0;
    var isOnSale = dp > 0 && dp < sp;
    return {
      sellingPrice: sp,
      discountPrice: isOnSale ? dp : null,
      isOnSale: isOnSale,
      currencyCode: rowCurrencyName(row),
    };
  }

  function tryPriceFromGross(entry, preferred) {
    var cur = typeof entry.currency === 'string' ? nonEmpty(entry.currency) : null;
    var curU = cur ? cur.toUpperCase() : null;
    // Strict currency match: when we know the debtor currency, the gross
    // entry must positively carry the same code. A mismatched OR an
    // unknown-currency gross is rejected (→ "price on request") rather
    // than mislabelled with the debtor's symbol.
    if (preferred && curU !== preferred.toUpperCase()) {
      return null;
    }
    var dg = toNumber(entry.discountedGross);
    var bg = toNumber(entry.gross);
    if (dg != null && bg != null && dg < bg) {
      return { sellingPrice: bg, discountPrice: dg, isOnSale: true, currencyCode: cur };
    }
    var useGross = dg != null ? dg : bg;
    if (useGross == null) {
      return null;
    }
    return { sellingPrice: useGross, discountPrice: null, isOnSale: false, currencyCode: cur };
  }

  function preferredKeys(debtor) {
    if (!debtor || debtor.priceListId == null || !debtor.debtorName) {
      return [];
    }
    var base = 'priceList' + debtor.priceListId + debtor.debtorName;
    var code = debtor.currencyCode;
    return code ? [base + code, base] : [base];
  }

  function orderedKeys(map, debtor) {
    var keys = Object.keys(map).filter(function (k) { return k !== 'retailPriceList'; });
    keys.sort();
    var ordered = [];
    var pref = preferredKeys(debtor);
    for (var i = 0; i < pref.length; i++) {
      if (map[pref[i]] != null && ordered.indexOf(pref[i]) === -1) {
        ordered.push(pref[i]);
      }
    }
    for (var j = 0; j < keys.length; j++) {
      if (ordered.indexOf(keys[j]) === -1) {
        ordered.push(keys[j]);
      }
    }
    return ordered;
  }

  // Separated-shop resolution (kj): selling = shop default-list row in the
  // debtor currency; retail list = struck-through compare-at when higher.
  // Mirrors PHP ProductPriceResolver::resolveSeparatedForShop.
  function separatedRows(lists, listId) {
    if (listId == null) { return []; }
    var entry = lists[String(listId)] || lists[listId];
    return (entry && Array.isArray(entry.rows)) ? entry.rows : [];
  }
  function pickSeparatedRow(rows, currencyId) {
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!row || toNumber(row.sellingPrice) === null) { continue; }
      var cid = row.currencyId != null ? Number(row.currencyId) : null;
      if (currencyId == null || cid === Number(currencyId)) { return row; }
    }
    return null;
  }
  function extractSeparatedPricing(lists, sp) {
    var sellingRow = pickSeparatedRow(separatedRows(lists, sp.sellingPriceListId), sp.currencyId);
    if (!sellingRow) { return null; }
    var selling = toNumber(sellingRow.sellingPrice);
    if (selling === null) { return null; }
    var rowDiscount = toNumber(sellingRow.discountPrice) || 0;
    // On sale ONLY when the B2B selling row itself is discounted. The retail
    // (B2C) list is NEVER a sale signal — B2B is structurally below retail, so
    // comparing them would mark every product on sale. It's the informational
    // RRP instead (regular + its own sale price when the retail list is itself
    // discounted, which kj does in lockstep with the B2B list).
    var onSale = rowDiscount > 0 && rowDiscount < selling;
    var cur = sp.currencyCode || null;
    var rrp = null, rrpDiscount = null;
    if (sp.retailPriceListId != null && sp.retailPriceListId !== sp.sellingPriceListId) {
      var retailRow = pickSeparatedRow(separatedRows(lists, sp.retailPriceListId), sp.currencyId);
      if (retailRow) {
        rrp = toNumber(retailRow.sellingPrice);
        var rd = toNumber(retailRow.discountPrice) || 0;
        if (rrp !== null && rd > 0 && rd < rrp) { rrpDiscount = rd; }
      }
    }
    return { sellingPrice: selling, discountPrice: onSale ? rowDiscount : null, isOnSale: onSale, currencyCode: cur, rrp: rrp, rrpDiscount: rrpDiscount };
  }

  function extractPricing(hit) {
    // Prices are resolved server-side (mergeSeparatedPrices → the prices API);
    // each hit carries ONLY this shopper's entitled price under `hit.pricing`
    // ({ sellingPrice, discountPrice, isOnSale, currencyCode, rrp, rrpDiscount }).
    return hit.pricing || null;
  }

  var moneyCache = {};
  function formatMoney(amount, currencyCode, locale) {
    // Match the legacy b2b-shop's DisplayPrice: Swiss-rounded to 0.05, two
    // decimals, currency AFTER the amount (EUR shown as €, others as the ISO
    // code) — NOT Intl's currency style, which puts the symbol first.
    var rounded = (Math.round((Number(amount) || 0) / 0.05) * 0.05).toFixed(2);
    var code = (typeof currencyCode === 'string') ? currencyCode.toUpperCase() : '';
    var symbol = code === 'EUR' ? '€' : code;
    return symbol ? (rounded + ' ' + symbol) : rounded;
  }

  function discountPercentOf(p) {
    if (!p || !p.isOnSale || p.discountPrice == null || p.sellingPrice <= 0 || p.discountPrice >= p.sellingPrice) {
      return null;
    }
    var pct = Math.round(((p.sellingPrice - p.discountPrice) / p.sellingPrice) * 100);
    return pct > 0 ? pct : null;
  }

  // ---- Card builder (mirrors templates/products.liquid markup) ----

  var configLabels = (config && config.labels) || {};
  var labelSale = configLabels.sale || 'Sale';
  var labelDiscontinued = configLabels.discontinued || '';
  var labelPriceOnRequest = configLabels.priceOnRequest || 'Price on request';
  var labelRrp = configLabels.rrp || 'RRP';
  var labelNew = configLabels.new || 'New';
  var newWithinDays = (typeof config.newWithinDays === 'number' && config.newWithinDays > 0) ? config.newWithinDays : 30;

  // Mirror ProductCatalogLoader::isWithinNewWindow — a hit is "new" when its
  // createdAt is within `newWithinDays` of now. Accepts the ISO string the
  // index stores or a numeric unix timestamp; bad values are simply not new.
  function isHitNew(hit) {
    var raw = hit && hit.createdAt;
    if (raw == null || raw === '') {
      return false;
    }
    var ms;
    if (typeof raw === 'number') {
      ms = raw < 1e12 ? raw * 1000 : raw;
    } else {
      ms = Date.parse(String(raw));
    }
    if (!isFinite(ms)) {
      return false;
    }
    return (Date.now() - ms) <= newWithinDays * 86400000;
  }

  // Add an `aico-img-pending` class while an `<img>` is still being
  // fetched, then strip it on load — the card's existing opacity
  // transition does the actual fade. Already-loaded (cached) images
  // skip the class so there's no flicker on revisit.
  function fadeInImage(img) {
    if (!img) {
      return;
    }
    if (img.complete && img.naturalWidth > 0) {
      return;
    }
    img.classList.add('aico-img-pending');
    var done = function () { img.classList.remove('aico-img-pending'); };
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });
  }

  function buildCard(hit, eager) {
    var li = document.createElement('li');
    li.className = 'aico-products-grid-item';
    var id = String(hit.productId != null ? hit.productId : (hit.id != null ? hit.id : (hit.urlHandle || '')));
    li.setAttribute('data-aico-product-id', id);

    var urlHandle = (typeof hit.urlHandle === 'string' && hit.urlHandle.trim()) ? hit.urlHandle.trim() : id;
    var title = pickName(hit, config.locale) || id;
    var image = pickImage(hit, config.locale);
    var pricing = extractPricing(hit, config.debtor);
    // No-price contract: a product with no resolvable price is hidden, not
    // shown as "price on request" (the legacy b2b-shop has no such state).
    if (!pricing) {
      return null;
    }
    var cc = pricing.currencyCode, loc = config.locale;
    var displayedAmount = pricing.isOnSale && pricing.discountPrice != null ? pricing.discountPrice : pricing.sellingPrice;
    var priceLabel = formatMoney(displayedAmount, cc, loc);
    // Struck regular price — sale only (the B2B selling row is discounted).
    var compareLabel = pricing.isOnSale && pricing.discountPrice != null ? formatMoney(pricing.sellingPrice, cc, loc) : null;
    var pct = discountPercentOf(pricing);
    // RRP (recommended retail) — informational "(RRP X)" beside the price: the
    // sale RRP beside the current price, the regular RRP beside the struck one.
    // Only when strictly above that line's price.
    var rrpRaw = pricing.isOnSale ? (pricing.rrpDiscount != null ? pricing.rrpDiscount : pricing.rrp) : pricing.rrp;
    var rrpLabel = (rrpRaw != null && rrpRaw > displayedAmount) ? formatMoney(rrpRaw, cc, loc) : null;
    var compareRrpLabel = (pricing.isOnSale && pricing.rrp != null && pricing.rrp > pricing.sellingPrice) ? formatMoney(pricing.rrp, cc, loc) : null;
    var isDiscontinued = !!hit.isDiscontinued;

    var article = document.createElement('article');
    article.className = 'aico-product-card';

    var link = document.createElement('a');
    // Use the server-supplied prefix (host/preview base + active-locale segment)
    // + preview-token query so JS-rendered cards link identically to the SSR
    // cards (E3): keeps the active locale (`/en-us/products/<handle>`) and the
    // `/__storefront-preview/<slug>/` prefix instead of a bare `/products/...`.
    var productUrlPrefix = config.productUrlPrefix || '/products/';
    var productUrlQuery = config.productUrlQuery || '';
    link.href = productUrlPrefix + encodeURIComponent(urlHandle) + productUrlQuery;
    link.className = 'aico-product-card-link';
    link.setAttribute('aria-label', title);

    var imgWrap = document.createElement('div');
    imgWrap.className = 'aico-product-card-image-wrap';
    if (image) {
      var img = document.createElement('img');
      img.className = 'aico-product-card-image';
      img.src = image;
      img.alt = '';
      img.loading = eager ? 'eager' : 'lazy';
      img.decoding = 'async';
      fadeInImage(img);
      imgWrap.appendChild(img);
    } else {
      var empty = document.createElement('div');
      empty.className = 'aico-product-card-image-empty';
      empty.setAttribute('aria-hidden', 'true');
      imgWrap.appendChild(empty);
    }
    if (pricing && pricing.isOnSale && pct) {
      var saleBadge = document.createElement('span');
      saleBadge.className = 'aico-product-card-badge aico-product-card-badge-sale';
      saleBadge.textContent = '−' + pct + '%';
      imgWrap.appendChild(saleBadge);
    } else if (isHitNew(hit) && labelNew) {
      var newBadge = document.createElement('span');
      newBadge.className = 'aico-product-card-badge aico-product-card-badge-new';
      newBadge.textContent = labelNew;
      imgWrap.appendChild(newBadge);
    }
    if (isDiscontinued && labelDiscontinued) {
      var discBadge = document.createElement('span');
      discBadge.className = 'aico-product-card-badge aico-product-card-badge-discontinued';
      discBadge.textContent = labelDiscontinued;
      imgWrap.appendChild(discBadge);
    }

    var body = document.createElement('div');
    body.className = 'aico-product-card-body';
    // Name first, price underneath (matches the b2b-shop card order).
    var h3 = document.createElement('h3');
    h3.className = 'aico-product-card-title';
    h3.textContent = title;
    body.appendChild(h3);
    if (priceLabel) {
      var p = document.createElement('p');
      p.className = 'aico-product-card-price';
      var mkRrp = function (label, extraCls) {
        var s = document.createElement('span');
        s.className = 'aico-product-card-rrp' + (extraCls ? ' ' + extraCls : '');
        s.textContent = '(' + labelRrp + ' ' + label + ')';
        return s;
      };
      if (compareLabel) {
        // Struck regular line (sale): regular price + its RRP, both struck.
        var was = document.createElement('span');
        was.className = 'aico-product-card-price-was';
        var cs = document.createElement('span');
        cs.className = 'aico-product-card-price-list';
        cs.textContent = compareLabel;
        was.appendChild(cs);
        if (compareRrpLabel) {
          was.appendChild(mkRrp(compareRrpLabel, 'aico-product-card-rrp-was'));
        }
        p.appendChild(was);
      }
      // Current line: current price + its RRP (informational, not a sale).
      var now = document.createElement('span');
      now.className = 'aico-product-card-price-now';
      var cp = document.createElement('span');
      cp.className = 'aico-product-card-price-current';
      cp.textContent = priceLabel;
      now.appendChild(cp);
      if (rrpLabel) {
        now.appendChild(mkRrp(rrpLabel));
      }
      p.appendChild(now);
      body.appendChild(p);
    } else {
      // No row in the debtor's currency → "price on request" (mirrors the
      // server-rendered first page's templates/products.liquid else branch).
      var pr = document.createElement('p');
      pr.className = 'aico-product-card-price aico-product-card-price-on-request';
      pr.textContent = labelPriceOnRequest;
      body.appendChild(pr);
    }

    link.appendChild(imgWrap);
    link.appendChild(body);
    article.appendChild(link);
    li.appendChild(article);
    return li;
  }

  // ---- Facet column + size chip rendering -------------------------

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  // Localized display label for a canonical (EN/hex) facet value — the
  // server ships config.facetValueLabels for non-English locales; values
  // without an entry (and English) display as-is.
  var FACET_VALUE_LABELS = config.facetValueLabels || {};
  function facetValueLabel(facetId, value) {
    var m = FACET_VALUE_LABELS[facetId];
    return (m && m[value]) || value;
  }

  function isFacetValueActive(facetId, value) {
    var arr = state.appliedFacets[facetId] || [];
    for (var i = 0; i < arr.length; i++) {
      if (String(arr[i]) === String(value)) {
        return true;
      }
    }
    return false;
  }

  function renderFacetColumn(facetId, distribution) {
    var section = facetColumnsEl && facetColumnsEl.querySelector('section.aico-filtercol[data-facet-id="' + facetId + '"]');
    if (!section) {
      return;
    }
    // A preset category keeps its facet column hidden — it would only
    // repeat the single (locked) selection.
    if (facetId === 'category' && hasPresetCategory()) {
      section.hidden = true;
      return;
    }
    var values = Object.keys(distribution || {});
    if (!values.length) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    values.sort(function (a, b) {
      var diff = (distribution[b] || 0) - (distribution[a] || 0);
      if (diff !== 0) {
        return diff;
      }
      return a.localeCompare(b);
    });

    var container = section.querySelector('[data-aico-facet-values]');
    if (!container) {
      return;
    }

    var html;
    if (facetId === 'color') {
      html = '';
      values.forEach(function (v) {
        var active = isFacetValueActive(facetId, v);
        html += '<button type="button"';
        html += ' class="aico-swatch' + (active ? ' aico-swatch-active' : '') + '"';
        html += ' title="' + escapeAttr(facetValueLabel(facetId, v)) + ' (' + (distribution[v] || 0) + ')"';
        html += ' data-aico-facet-checkbox data-facet-id="' + facetId + '"';
        html += ' data-facet-value="' + escapeAttr(v) + '"';
        html += ' data-checked="' + (active ? '1' : '0') + '">';
        html += '<span class="aico-swatch-dot" style="background:' + escapeAttr(v) + '"></span>';
        html += '</button>';
      });
      container.className = 'aico-filtercol-swatches';
    } else {
      html = '';
      values.forEach(function (v) {
        var active = isFacetValueActive(facetId, v);
        html += '<li><button type="button"';
        html += ' class="aico-filtercol-item' + (active ? ' aico-filtercol-item-active' : '') + '"';
        html += ' data-aico-facet-checkbox data-facet-id="' + facetId + '"';
        html += ' data-facet-value="' + escapeAttr(v) + '"';
        html += ' data-checked="' + (active ? '1' : '0') + '">';
        html += '<span class="aico-filtercol-item-label">' + escapeHtml(facetValueLabel(facetId, v)) + '</span>';
        html += '<span class="aico-filtercol-item-count">(' + (distribution[v] || 0) + ')</span>';
        html += '</button></li>';
      });
      container.className = 'aico-filtercol-list';
    }
    container.innerHTML = html;
  }

  function renderSizeChips(distribution) {
    if (!sizesRow || !sizesSection) {
      return;
    }
    var chips = buildSizeChips(distribution || {});
    if (!chips.length) {
      sizesSection.hidden = true;
      sizesRow.innerHTML = '';
      return;
    }
    sizesSection.hidden = false;
    var selected = state.appliedFacets.sizes || [];
    var html = '';
    chips.forEach(function (chip) {
      var active = selected.indexOf(chip.display) !== -1;
      html += '<button type="button"';
      html += ' class="aico-size-chip' + (active ? ' aico-size-chip-active' : '') + '"';
      html += ' title="' + escapeAttr(chip.display) + ' (' + chip.totalCount + ')"';
      html += ' data-aico-size-chip data-size-display="' + escapeAttr(chip.display) + '"';
      html += ' data-checked="' + (active ? '1' : '0') + '">';
      html += escapeHtml(chip.display);
      html += '</button>';
    });
    sizesRow.innerHTML = html;
  }

  function renderFacetColumns(distribution) {
    Object.keys(config.facetAttributes).forEach(function (facetId) {
      if (facetId === 'sizes' || facetId === 'sale') {
        return;
      }
      var attr = config.facetAttributes[facetId];
      if (!attr) {
        return;
      }
      renderFacetColumn(facetId, distribution[attr] || {});
    });
    renderSizeChips(distribution[SIZE_FACET_ATTRIBUTE] || {});
  }

  // ---- Result count + filter badge --------------------------------

  function setCount(total) {
    state.totalHits = total;
    if (!countEl) {
      return;
    }
    var template = total === 1 ? countEl.dataset.singular : countEl.dataset.plural;
    countEl.textContent = (template || '{count}').replace('{count}', total);
  }

  function updateFilterCountBadge() {
    var n = 0;
    Object.keys(state.appliedFacets).forEach(function (k) {
      // The preset category is locked (its facet group is hidden and
      // "clear all" keeps it) — don't count it as an active filter.
      if (k === 'category' && hasPresetCategory()) {
        return;
      }
      n += (state.appliedFacets[k] || []).length;
    });
    if (filterCountBadge) {
      filterCountBadge.textContent = String(n);
      if (n > 0) {
        filterCountBadge.classList.add('aico-filterbar-badge-active');
      } else {
        filterCountBadge.classList.remove('aico-filterbar-badge-active');
      }
    }
    if (panelToggle) {
      if (n > 0) {
        panelToggle.classList.add('aico-filterbar-toggle-active');
      } else {
        panelToggle.classList.remove('aico-filterbar-toggle-active');
      }
    }
  }

  // ---- Grid rendering --------------------------------------------

  function resetGrid() {
    state.page = 1;
    state.exhausted = false;
    if (grid) {
      grid.innerHTML = '';
      grid.hidden = false;
    }
    if (endEl) {
      endEl.hidden = true;
    }
    if (emptyEl) {
      emptyEl.hidden = true;
    }
  }

  function appendHits(hits, eagerStart) {
    if (!grid) {
      return;
    }
    var frag = document.createDocumentFragment();
    hits.forEach(function (hit, i) {
      var card = buildCard(hit, eagerStart + i < 8);
      if (card) {
        frag.appendChild(card);
      }
    });
    grid.appendChild(frag);
  }

  // ---- Fetch + render --------------------------------------------

  function fetchAndRender(opts) {
    if (state.loading) {
      return Promise.resolve();
    }
    state.loading = true;
    if (loaderEl) {
      loaderEl.hidden = false;
    }
    var offset = (state.page - 1) * config.meilisearch.hitsPerPage;
    return meiliSearch({ offset: offset, includeFacets: !!(opts && opts.includeFacets) }).then(function (resp) {
      var hits = Array.isArray(resp.hits) ? resp.hits : [];
      var total = typeof resp.estimatedTotalHits === 'number' ? resp.estimatedTotalHits : (typeof resp.nbHits === 'number' ? resp.nbHits : hits.length);

      if (opts && opts.replace) {
        resetGrid();
        appendHits(hits, 0);
        setCount(total);
        if (hits.length === 0) {
          if (emptyEl) {
            emptyEl.hidden = false;
          }
          if (grid) {
            grid.hidden = true;
          }
        }
      } else {
        var startIdx = grid ? grid.children.length : 0;
        appendHits(hits, startIdx);
        setCount(total);
      }

      var loaded = state.page * config.meilisearch.hitsPerPage;
      state.exhausted = loaded >= total || hits.length === 0;
      if (state.exhausted && endEl && total > 0) {
        endEl.hidden = false;
      }

      if (opts && opts.includeFacets && resp.facetDistribution) {
        state.lastDistribution = resp.facetDistribution;
        setEuUniverse();
        renderFacetColumns(resp.facetDistribution);
      }
    }).catch(function (err) {
      console.warn('aico-products: meilisearch error', err);
    }).then(function () {
      state.loading = false;
      if (loaderEl) {
        loaderEl.hidden = true;
      }
    });
  }

  // ---- Category heading -------------------------------------------

  // The filter-bar heading mirrors the category selection: the selected
  // category's display name (localized via config.facetValueLabels) when
  // one is applied — preset or user-picked — and the all-products label
  // otherwise.
  var categoryHeadingEl = rootEl.querySelector('[data-aico-category-heading]');

  function updateCategoryHeading() {
    if (!categoryHeadingEl) {
      return;
    }
    var values = state.appliedFacets.category || [];
    if (values.length) {
      var labels = values.map(function (v) {
        return facetValueLabel('category', v);
      });
      categoryHeadingEl.textContent = labels.join(', ');
    } else {
      categoryHeadingEl.textContent = categoryHeadingEl.getAttribute('data-all-categories-label') || '';
    }
  }

  function refresh() {
    syncUrl();
    updateFilterCountBadge();
    updateCategoryHeading();
    return fetchAndRender({ replace: true, includeFacets: true });
  }

  // ---- Event wiring -----------------------------------------------

  if (searchInput) {
    var debounceTimer = null;
    searchInput.addEventListener('input', function (e) {
      var v = String(e.target.value || '');
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        if (v === state.query) {
          return;
        }
        state.query = v;
        refresh();
      }, 250);
    });
  }

  if (sortSelect) {
    sortSelect.addEventListener('change', function (e) {
      var v = String(e.target.value || '-date');
      if (v === state.sort) {
        return;
      }
      state.sort = v;
      refresh();
    });
  }

  // Custom sort dropdown — a styled button + listbox that drives the hidden
  // native <select> (kept as the source of truth so the change handler above
  // stays the single sort entry point). Selecting an option writes the select
  // value and dispatches `change`.
  (function initSortMenu() {
    var menu = rootEl.querySelector('[data-aico-sortmenu]');
    if (!menu || !sortSelect) {
      return;
    }
    var button = menu.querySelector('[data-aico-sortmenu-button]');
    var label = menu.querySelector('[data-aico-sortmenu-label]');
    var list = menu.querySelector('[data-aico-sortmenu-list]');
    if (!button || !label || !list) {
      return;
    }
    var options = Array.prototype.slice.call(list.querySelectorAll('[role="option"]'));
    options.forEach(function (o) { o.tabIndex = -1; });

    function syncLabel() {
      var opt = sortSelect.options[sortSelect.selectedIndex];
      label.textContent = opt ? opt.textContent.trim() : '';
      options.forEach(function (o) {
        if (o.getAttribute('data-value') === sortSelect.value) {
          o.setAttribute('aria-selected', 'true');
        } else {
          o.removeAttribute('aria-selected');
        }
      });
    }

    function isOpen() { return !list.hidden; }

    function onOutside(e) {
      if (!menu.contains(e.target)) { close(false); }
    }

    function open() {
      if (isOpen()) { return; }
      list.hidden = false;
      menu.classList.add('aico-sortmenu-open');
      button.setAttribute('aria-expanded', 'true');
      var current = list.querySelector('[aria-selected="true"]') || options[0];
      if (current) { current.focus(); }
      document.addEventListener('click', onOutside, true);
    }

    function close(focusButton) {
      if (!isOpen()) { return; }
      list.hidden = true;
      menu.classList.remove('aico-sortmenu-open');
      button.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', onOutside, true);
      if (focusButton) { button.focus(); }
    }

    function choose(opt) {
      var value = opt.getAttribute('data-value');
      if (value && value !== sortSelect.value) {
        sortSelect.value = value;
        sortSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      syncLabel();
      close(true);
    }

    button.addEventListener('click', function () {
      if (isOpen()) { close(true); } else { open(); }
    });
    button.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
    list.addEventListener('click', function (e) {
      var opt = e.target.closest && e.target.closest('[role="option"]');
      if (opt) { choose(opt); }
    });
    list.addEventListener('keydown', function (e) {
      var idx = options.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); close(true); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); (options[idx + 1] || options[0]).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (options[idx - 1] || options[options.length - 1]).focus(); }
      else if (e.key === 'Home') { e.preventDefault(); options[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); options[options.length - 1].focus(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (idx >= 0) { choose(options[idx]); } }
    });

    syncLabel();
  })();

  // Facet column buttons + sale toggle (delegated). The native HTML
  // is a `<button>` for swatch / list items and a `<input checkbox>`
  // for the sale toggle — both carry data-aico-facet-checkbox.
  rootEl.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-aico-facet-checkbox]');
    if (!t || t.tagName === 'INPUT') {
      // Inputs are handled in the change listener below.
      return;
    }
    e.preventDefault();
    var facetId = t.getAttribute('data-facet-id');
    var value = t.getAttribute('data-facet-value');
    if (!facetId || !value) {
      return;
    }
    var nextChecked = t.getAttribute('data-checked') !== '1';
    toggleFacet(facetId, value, nextChecked);
    t.setAttribute('data-checked', nextChecked ? '1' : '0');
  });

  rootEl.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || t.nodeName !== 'INPUT' || !t.matches || !t.matches('[data-aico-facet-checkbox]')) {
      return;
    }
    var facetId = t.getAttribute('data-facet-id');
    var value = t.getAttribute('data-facet-value');
    if (!facetId || !value) {
      return;
    }
    toggleFacet(facetId, value, !!t.checked);
  });

  function toggleFacet(facetId, value, checked) {
    var current = (state.appliedFacets[facetId] || []).slice();
    if (checked) {
      if (current.indexOf(value) === -1) {
        current.push(value);
      }
    } else {
      current = current.filter(function (v) { return v !== value; });
    }
    if (current.length) {
      state.appliedFacets[facetId] = current;
    } else {
      delete state.appliedFacets[facetId];
    }
    refresh();
  }

  // Size chips — clicking toggles the chip's display value in the
  // sizes facet selection. The buildFilter() expansion rebuilds the
  // raw warehouse-prefixed clause from the latest distribution.
  rootEl.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-aico-size-chip]');
    if (!t) {
      return;
    }
    e.preventDefault();
    var display = t.getAttribute('data-size-display');
    if (!display) {
      return;
    }
    var current = (state.appliedFacets.sizes || []).slice();
    var alreadyOn = current.indexOf(display) !== -1;
    if (alreadyOn) {
      current = current.filter(function (v) { return v !== display; });
    } else {
      current.push(display);
    }
    if (current.length) {
      state.appliedFacets.sizes = current;
    } else {
      delete state.appliedFacets.sizes;
    }
    t.setAttribute('data-checked', alreadyOn ? '0' : '1');
    if (alreadyOn) {
      t.classList.remove('aico-size-chip-active');
    } else {
      t.classList.add('aico-size-chip-active');
    }
    refresh();
  });

  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', function () {
      state.appliedFacets = {};
      // A category preset from the URL survives "clear all" — only
      // filters the user added during the session are cleared.
      if (hasPresetCategory()) {
        state.appliedFacets.category = PRESET_CATEGORIES.slice();
      }
      // Reset every checkbox + button in the panel.
      rootEl.querySelectorAll('[data-aico-facet-checkbox]').forEach(function (el) {
        if (el.tagName === 'INPUT') {
          el.checked = false;
        } else {
          el.setAttribute('data-checked', '0');
          el.classList.remove('aico-swatch-active');
          el.classList.remove('aico-filtercol-item-active');
        }
      });
      rootEl.querySelectorAll('[data-aico-size-chip]').forEach(function (el) {
        el.setAttribute('data-checked', '0');
        el.classList.remove('aico-size-chip-active');
      });
      refresh();
    });
  }

  // Mega-panel toggle — animated open/close via CSS grid-template-rows
  // (0fr→1fr) on the panel. We drop the SSR `hidden` attribute on boot so
  // the element stays in the DOM and the class transition can run; the
  // collapsed state (clipped + visibility:hidden) keeps it inert when closed.
  if (panelToggle && panel) {
    panel.hidden = false;
    panelToggle.addEventListener('click', function () {
      var open = !panel.classList.contains('aico-filterbar-panel-open');
      panel.classList.toggle('aico-filterbar-panel-open', open);
      panel.dataset.aicoOpen = open ? 'true' : 'false';
      panelToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      panelToggle.classList.toggle('aico-filterbar-toggle-open', open);
    });
  }

  // Load successive pages until the sentinel is pushed past the viewport (+the
  // observer margin) or the catalogue is exhausted. Needed because the page now
  // renders page 1 client-side: if those cards don't fill the screen the
  // IntersectionObserver fires once while still loading and never re-arms.
  function fillViewport() {
    if (!sentinel || state.loading || state.exhausted) {
      return;
    }
    var vh = window.innerHeight || document.documentElement.clientHeight;
    if (sentinel.getBoundingClientRect().top <= vh + 400) {
      state.page += 1;
      fetchAndRender({}).then(function () { fillViewport(); });
    }
  }

  if (sentinel && 'IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) {
          return;
        }
        if (state.loading || state.exhausted) {
          return;
        }
        state.page += 1;
        fetchAndRender({});
      });
    }, { rootMargin: '400px 0px' });
    observer.observe(sentinel);
  }

  // ---- Boot -------------------------------------------------------

  // Hook the server-rendered cards' images so any that are still in
  // flight when JS boots (slow CDN, big files) fade in instead of
  // popping. Cached images return early inside fadeInImage().
  if (grid) {
    var initialImages = grid.querySelectorAll('.aico-product-card-image');
    for (var ii = 0; ii < initialImages.length; ii++) {
      fadeInImage(initialImages[ii]);
    }
  }

  if (countEl) {
    var initialDigits = countEl.textContent.replace(/\D/g, '');
    var initialTotal = parseInt(initialDigits, 10);
    if (isFinite(initialTotal)) {
      state.totalHits = initialTotal;
      state.exhausted = config.meilisearch.hitsPerPage >= initialTotal;
      if (state.exhausted && endEl && initialTotal > 0) {
        endEl.hidden = false;
      }
    }
  }

  // Preset category boot state — the server hides the column when it can
  // see the applied category in the facet distribution; force it here too
  // so edge cases (e.g. a preset with zero hits) behave identically.
  if (hasPresetCategory() && facetColumnsEl) {
    var presetCategorySection = facetColumnsEl.querySelector('section.aico-filtercol[data-facet-id="category"]');
    if (presetCategorySection) {
      presetCategorySection.hidden = true;
    }
  }

  updateFilterCountBadge();
  updateCategoryHeading();

  // Boot the grid. Two modes:
  //  - The products page hydrates entirely client-side (no SSR cards): render
  //    page 1 from Meili now — refresh() does a full replace render + seeds the
  //    facet distribution / EU-size universe + sets the real count + exhausted.
  //  - Legacy SSR mode (server rendered page 1): leave those cards untouched and
  //    only seed the facet distribution + EU-size universe (size chips can't
  //    group by ⅓ band without it, and a deep-linked size facet needs it to
  //    expand display→raw), re-querying only when facets are already applied.
  var hasSsrCards = !!(grid && grid.querySelector('.aico-products-grid-item'));
  if (!hasSsrCards) {
    refresh().then(function () { fillViewport(); });
  } else {
    meiliSearch({ offset: 0, includeFacets: true }).then(function (resp) {
      if (resp && resp.facetDistribution) {
        state.lastDistribution = resp.facetDistribution;
        setEuUniverse();
        renderFacetColumns(resp.facetDistribution);
      }
      if (Object.keys(state.appliedFacets).length > 0) {
        refresh();
      }
    }).catch(function () {});
  }
})();
