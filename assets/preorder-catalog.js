/**
 * Preorder catalog — sizes in sticky teal header; qty-only matrix cells.
 */
(function (global) {
  'use strict';

  var OPTION_GROUP_ORDER = [
    'Women Shoes',
    'Women Sandals',
    'Men Shoes',
    'Men Sandals',
  ];

  function groupOrderIndex(name) {
    var i = OPTION_GROUP_ORDER.indexOf(name);
    return i < 0 ? OPTION_GROUP_ORDER.length : i;
  }

  // Render the sections in the fixed OPTION_GROUP_ORDER regardless of which
  // group's products arrive first, so the catalog order is always consistent.
  // Unknown groups keep their relative arrival order, after the known ones.
  function sortGroupsByOrder(products) {
    return asArray(products)
      .map(function (group, index) { return { group: group, index: index }; })
      .sort(function (a, b) {
        var diff = groupOrderIndex(a.group && a.group.optionGroupName) -
          groupOrderIndex(b.group && b.group.optionGroupName);
        return diff !== 0 ? diff : a.index - b.index;
      })
      .map(function (entry) { return entry.group; });
  }

  var PAGE_SIZE = 15;

  function renderQtyInput(opts) {
    var ariaLabel = opts.ariaLabel || '';
    var qty = opts.qty || 0;
    // boxDisabled: empty cell with no remaining stock -> whole box grayed.
    // incrementDisabled / decrementDisabled: per-button (a cell that has a qty
    // stays editable even when the pool is exhausted — only the increment is off).
    var boxDisabled = !!opts.boxDisabled;
    var incDisabled = boxDisabled || !!opts.incrementDisabled;
    var decDisabled = boxDisabled || !!opts.decrementDisabled;
    var committedStyle = !!opts.committedStyle;
    var filled = !!opts.filled;
    var attrs = opts.attrs || '';
    var maxAttr = opts.maxAttr || '';
    var minAttr = opts.minAttr || ' min="0"';
    var sizeLabelHtml = opts.sizeLabelHtml || '';
    var displayVal = qty > 0 ? String(qty) : '';
    var inputDisabledAttr = boxDisabled ? ' disabled' : '';
    var classes = 'aico-preorder-qty-box';
    if (filled) classes += ' aico-preorder-qty-box--filled';
    if (committedStyle) classes += ' aico-preorder-qty-box--committed';
    if (boxDisabled) classes += ' aico-preorder-qty-box--disabled';
    return (
      '<span class="' +
      classes +
      '">' +
      '<span class="aico-preorder-qty-box__size" aria-hidden="true">' +
      sizeLabelHtml +
      '</span>' +
      '<span class="aico-preorder-qty-box__inner">' +
      '<input type="number" class="aico-preorder-qty-input" step="1"' +
      minAttr +
      ' value="' +
      displayVal +
      '"' +
      maxAttr +
      inputDisabledAttr +
      ' data-aico-preorder-qty ' +
      attrs +
      ' aria-label="' +
      escapeHtml(ariaLabel) +
      '">' +
      '<span class="aico-preorder-qty-box__spinners">' +
      '<button type="button" class="aico-preorder-qty-box__step" data-aico-preorder-qty-step="1" tabindex="-1"' +
      (incDisabled ? ' disabled' : '') +
      ' aria-label="Increase quantity">' +
      '<svg viewBox="0 0 8 5" width="8" height="5" aria-hidden="true"><path d="M1 4 L4 1 L7 4" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '</button>' +
      '<button type="button" class="aico-preorder-qty-box__step" data-aico-preorder-qty-step="-1" tabindex="-1"' +
      (decDisabled ? ' disabled' : '') +
      ' aria-label="Decrease quantity">' +
      '<svg viewBox="0 0 8 5" width="8" height="5" aria-hidden="true"><path d="M1 1 L4 4 L7 1" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '</button>' +
      '</span></span></span>'
    );
  }

  function asArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'object') return Object.values(value);
    return [];
  }

  function mergeGroupedProducts(prev, result) {
    var newProducts = prev.slice();
    var groups = [];
    if (result && result.data) {
      if (Array.isArray(result.data)) {
        groups = groupFlatProducts(result.data);
      } else if (result.data.products && Array.isArray(result.data.products)) {
        groups = result.data.products.map(function (g) {
          return {
            optionGroupName: g.optionGroupName || 'Other',
            items: asArray(g.items),
          };
        });
      }
    } else if (Array.isArray(result)) {
      groups = groupFlatProducts(result);
    }

    groups.forEach(function (newGroup) {
      var idx = -1;
      for (var i = 0; i < newProducts.length; i++) {
        if (newProducts[i].optionGroupName === newGroup.optionGroupName) {
          idx = i;
          break;
        }
      }
      if (idx >= 0) {
        newProducts[idx] = {
          optionGroupName: newGroup.optionGroupName,
          items: newProducts[idx].items.concat(newGroup.items),
        };
      } else {
        newProducts.push(newGroup);
      }
    });
    return newProducts;
  }

  function groupFlatProducts(flat) {
    var groups = {};
    flat.forEach(function (product) {
      var name = product.groupingInformation || 'Other';
      if (!groups[name]) {
        groups[name] = { optionGroupName: name, items: [] };
      }
      groups[name].items.push(product);
    });
    return Object.keys(groups).map(function (k) {
      return groups[k];
    });
  }

  function extractDatesFromProducts(groups) {
    // Map each display label to its timestamp so the rows sort chronologically.
    // (Sorting the formatted labels alphabetically gives Aug, Oct, Sep — wrong —
    // and makes the cumulative stock cap look arbitrary.)
    var timeByLabel = {};
    asArray(groups).forEach(function (group) {
      asArray(group && group.items).forEach(function (product) {
        (product.preorderStockData || []).forEach(function (row) {
          if (row.date) {
            try {
              var parsed = new Date(row.date);
              if (isNaN(parsed.getTime())) return;
              var label = parsed.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              });
              if (!(label in timeByLabel)) timeByLabel[label] = parsed.getTime();
            } catch (_) {}
          }
        });
      });
    });
    return Object.keys(timeByLabel).sort(function (a, b) {
      return timeByLabel[a] - timeByLabel[b];
    });
  }

  function groupHasMorePages(entry) {
    if (!entry || !entry.meta) return false;
    var lastPage = Number(entry.meta.lastPage) || 1;
    var currentPage = Number(entry.currentPage) || 1;
    return currentPage < lastPage;
  }

  function buildProductsUrl(baseUrl, params) {
    var url = new URL(baseUrl, window.location.origin);
    if (params.buyerAddressId) {
      url.searchParams.set('buyer_address_id', String(params.buyerAddressId));
    }
    url.searchParams.set('page[number]', String(params.pageNumber || 1));
    url.searchParams.set('page[size]', String(params.pageSize || PAGE_SIZE));
    if (params.debtorId) {
      url.searchParams.set('debtor_id', String(params.debtorId));
    }
    if (params.optionGroupName) {
      url.searchParams.set('filter[optionGroupName]', params.optionGroupName);
    }
    return url.toString();
  }

  function fetchProductsJson(url) {
    return fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    }).then(function (res) {
      return res.text().then(function (text) {
        var body = null;
        if (text) {
          try {
            body = JSON.parse(text);
          } catch (parseErr) {
            throw new Error('products_invalid_json');
          }
        }
        if (!res.ok) {
          throw new Error(body && body.error ? body.error : 'products_fetch_failed');
        }
        if (body && body.error && body.data == null) {
          throw new Error(body.error);
        }
        return body || { data: [], meta: null };
      });
    });
  }

  /** b2b-shop transformVariationOption maps variationOptionValues → values. */
  function sizeOptionValues(option) {
    if (!option) return [];
    if (option.values && option.values.length) {
      return option.values
        .map(function (v) {
          return typeof v === 'string' ? v : v && v.value;
        })
        .filter(Boolean);
    }
    return (option.variationOptionValues || [])
      .map(function (v) {
        return typeof v === 'string' ? v : v && v.value;
      })
      .filter(Boolean);
  }

  function getSizeOption(product) {
    var opts = product.variationOptions || [];
    var picked = null;
    for (var i = 0; i < opts.length; i++) {
      var n = (opts[i].name || '').toLowerCase();
      if (
        n.indexOf('size') >= 0 ||
        n.indexOf('größe') >= 0 ||
        n.indexOf('grosse') >= 0 ||
        n.indexOf('grössen') >= 0
      ) {
        picked = opts[i];
        break;
      }
    }
    if (!picked && opts.length) {
      for (var j = 0; j < opts.length; j++) {
        if (opts[j].isDefault || opts[j].is_default) {
          picked = opts[j];
          break;
        }
      }
      if (!picked) picked = opts[0];
    }
    return {
      name: (picked && picked.name) || 'Size',
      values: sizeOptionValues(picked),
    };
  }

  function collectGroupSizeValues(items) {
    var sizeValues = [];
    items.forEach(function (item) {
      var so = getSizeOption(item);
      (so.values || []).forEach(function (v) {
        if (sizeValues.indexOf(v) < 0) sizeValues.push(v);
      });
      if (!so.values.length && item.productVariants) {
        item.productVariants.forEach(function (variant) {
          (variant.productVariantOptions || []).forEach(function (opt) {
            if (opt.value && sizeValues.indexOf(opt.value) < 0) {
              sizeValues.push(opt.value);
            }
          });
        });
      }
    });
    sizeValues.sort(function (a, b) {
      var na = parseFloat(a);
      var nb = parseFloat(b);
      if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
      return String(a).localeCompare(String(b));
    });
    return sizeValues;
  }

  function getVariantForOption(product, optionValue) {
    var variants = product.productVariants || [];
    var needle = String(optionValue);
    for (var i = 0; i < variants.length; i++) {
      var v = variants[i];
      var options = v.productVariantOptions || [];
      for (var j = 0; j < options.length; j++) {
        if (String(options[j].value) === needle) return v;
      }
    }
    return null;
  }

  function formatSizeLabel(label) {
    // Traditional fraction writing \u2014 keep "35 1/3" / "37 2/3" as plain text
    // instead of the custom \u2153/\u2154 superscript glyphs.
    return String(label).trim();
  }

  function formatSizeLabelHtml(label) {
    return escapeHtml(formatSizeLabel(label));
  }

  function normalizeShoeSizeCharts(charts) {
    if (!charts || typeof charts !== 'object') return {};
    if (charts.data && typeof charts.data === 'object') return charts.data;
    return charts;
  }

  function regionToChartKey(region) {
    var key = String(region || 'EU').toUpperCase();
    if (key === 'KR' || key === 'MM') return 'Millimeters';
    return key;
  }

  function resolveChartGender(charts, optionGroupName) {
    if (!charts || typeof charts !== 'object') return null;
    var name = String(optionGroupName || '').toLowerCase();
    var keys = Object.keys(charts);
    function pick(test) {
      var lower = test.toLowerCase();
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].toLowerCase() === lower) return keys[i];
      }
      for (var j = 0; j < keys.length; j++) {
        if (keys[j].toLowerCase().indexOf(lower) >= 0) return keys[j];
      }
      return null;
    }
    if (/women|woman/.test(name)) return pick('women') || pick('Women');
    if (/unisex/.test(name)) return pick('unisex') || pick('Unisex');
    if (/men|man/.test(name)) return pick('men') || pick('Men');
    return pick('men') || pick('Men') || pick('women') || keys[0] || null;
  }

  function lookupChartSize(sizes, option) {
    if (!sizes || typeof sizes !== 'object') return null;
    if (sizes[option] != null) return sizes[option];
    var trimmed = String(option).trim();
    var keys = Object.keys(sizes);
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i]).trim() === trimmed) return sizes[keys[i]];
    }
    var num = parseFloat(trimmed);
    if (!isNaN(num)) {
      for (var j = 0; j < keys.length; j++) {
        var kn = parseFloat(String(keys[j]));
        if (!isNaN(kn) && Math.abs(kn - num) < 0.0001) return sizes[keys[j]];
      }
    }
    return null;
  }

  function getCountryLabel(charts, optionGroupName, region, option) {
    var raw = option;
    var normalized = normalizeShoeSizeCharts(charts);
    var gender = resolveChartGender(normalized, optionGroupName);
    var chartKey = regionToChartKey(region);
    if (gender && normalized[gender] && normalized[gender][chartKey]) {
      var mapped = lookupChartSize(normalized[gender][chartKey], option);
      if (mapped != null && mapped !== '') raw = mapped;
    }
    return formatSizeLabel(raw);
  }

  function estimateSizeCellWidthRem(label, layout) {
    var formatted = formatSizeLabel(String(label));
    var hasFrac = /[\u2153\u2154]/.test(formatted);
    var wholeLen = formatted.replace(/[\u2153\u2154]/g, '').trim().length;
    var rem = 2.25;
    if (layout === 'qty') {
      rem = 2.25;
    } else if (layout === 'header') {
      rem = 0.85 + wholeLen * 0.26 + (hasFrac ? 0.65 : 0);
    } else if (layout === 'box') {
      rem = 0.9 + wholeLen * 0.28 + (hasFrac ? 0.7 : 0) + 1.75;
    } else {
      rem = Math.max(2.25, 1.35 + wholeLen * 0.4 + (hasFrac ? 0.9 : 0));
    }
    // Wide enough for a 3-digit quantity (up to 999) plus the stepper column.
    if (layout === 'qty') return '2.75rem';
    if (layout === 'header') return Math.min(4.25, Math.max(2.35, rem)) + 'rem';
    return Math.min(5.25, Math.max(layout === 'box' ? 3.25 : 3.25, rem)) + 'rem';
  }

  function parseRemValue(remStr) {
    return parseFloat(String(remStr).replace('rem', '')) || 0;
  }

  function computeGlobalSizeCellWidthRem(products, charts, region, layout) {
    var maxRem = 0;
    asArray(products).forEach(function (group) {
      var items = asArray(group && group.items);
      collectGroupSizeValues(items).forEach(function (opt) {
        var label = getCountryLabel(charts, group.optionGroupName, region, opt);
        var rem = parseRemValue(estimateSizeCellWidthRem(label, layout));
        if (rem > maxRem) maxRem = rem;
      });
    });
    if (!maxRem) {
      return layout === 'header' ? '3.25rem' : layout === 'box' ? '5rem' : '3.5rem';
    }
    return maxRem + 'rem';
  }

  function computeGroupMatrixCellWidthRem(group, charts, region) {
    var labelW = parseRemValue(
      computeGlobalSizeCellWidthRem([group], charts, region, 'header'),
    );
    var qtyW = parseRemValue(estimateSizeCellWidthRem('', 'qty'));
    var w = Math.max(labelW, qtyW, 2.5);
    return Math.min(3.25, w) + 'rem';
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function productTitle(product) {
    if (product.name) return product.name;
    if (product.webName) return product.webName;
    if (product.title) return product.title;
    var t = product.translations;
    if (Array.isArray(t) && t.length) {
      return t[0].name || t[0].webName || product.sku || '';
    }
    if (t && typeof t === 'object') {
      var first = t[Object.keys(t)[0]];
      if (first) return first.name || first.webName || product.sku || '';
    }
    return product.sku || '';
  }

  // Pick the price-list row that prices this product. The payload nests rows
  // under priceList.priceListRows (per country/currency); there is no flat
  // priceList.price. Prefer a non-free row (first one is fine for display).
  function priceRowFor(product) {
    var priceList = product && product.priceList;
    if (!priceList || !priceList.priceListRows || !priceList.priceListRows.length) {
      return null;
    }
    var rows = priceList.priceListRows;
    return (
      rows.find(function (row) {
        return !row.is_free && !row.isFree;
      }) || rows[0]
    );
  }

  function productPrice(product) {
    if (product.price != null && product.price >= 0) return product.price;
    var row = priceRowFor(product);
    if (row) {
      // Mirror the backend (AicoShopItemService::setItemPrice): use the discount
      // price only when it is a real reduction, otherwise the selling price.
      var selling = row.selling_price != null ? row.selling_price : row.sellingPrice;
      var discount = row.discount_price != null ? row.discount_price : row.discountPrice;
      if (discount != null && discount > 0 && discount < selling) return discount;
      if (selling != null) return selling;
      if (discount != null) return discount;
    }
    if (product.priceList && product.priceList.price != null) {
      return product.priceList.price;
    }
    if (product.variantPrice != null) return product.variantPrice;
    return null;
  }

  function productCurrency(product) {
    if (product.variantPriceCurrency) return product.variantPriceCurrency;
    if (product.currency) return product.currency;
    var row = priceRowFor(product);
    if (row && row.currency) {
      return row.currency.name || row.currency.code || 'CHF';
    }
    return 'CHF';
  }

  function productImage(product) {
    return product.mainImage || '';
  }

  function formatMoney(price, currency) {
    if (price == null || price < 0) return '';
    return Number(price).toFixed(2) + ' ' + (currency || 'CHF');
  }

  function rowTotalForDate(productId, dateLabel) {
    if (!global.AicoPreorderStock || !global.AicoPreorderStock.getRowTotal) return 0;
    return global.AicoPreorderStock.getRowTotal(productId, dateLabel) || 0;
  }

  function productTotal(productId) {
    if (!global.AicoPreorderStock || !global.AicoPreorderStock.getTotalPerProduct) return 0;
    return global.AicoPreorderStock.getTotalPerProduct(productId) || 0;
  }

  function CatalogController(config) {
    this.root = config.root;
    this.productsUrl = config.productsUrl;
    this.catalogEl = config.catalogEl;
    this.loadingEl = config.loadingEl;
    this.errorEl = config.errorEl;
    this.loadMoreEl = config.loadMoreEl;
    this.onProductsLoaded = config.onProductsLoaded || function () {};
    this.getBuyerAddressId = config.getBuyerAddressId || function () {
      return null;
    };
    this.getDebtorId = config.getDebtorId || function () {
      return null;
    };
    this.shouldSkipProducts = config.shouldSkipProducts || function () {
      return false;
    };
    this.getSelectedDates = config.getSelectedDates || function () {
      return [];
    };
    this.getSizeRegion = config.getSizeRegion || function () {
      return 'EU';
    };
    this.getSession = config.getSession || function () {
      return {};
    };
    this.getCartState = config.getCartState || function () {
      return null;
    };
    this.onQuantityChange = config.onQuantityChange || function () {};
    this.getCopy = config.getCopy || function () {
      return {};
    };

    this.products = [];
    this.groupPagination = {};
    this.loadGeneration = 0;
    this.loading = false;
    this.loadingMore = false;
    this.hasMore = true;
    this.preorderDates = [];
    this.searchQuery = '';
    this.autoLoadMore = config.autoLoadMore === true;
    // Collapsed state per category (optionGroupName), preserved across re-renders.
    this.collapsedGroups = {};
  }

  CatalogController.prototype.setSearchQuery = function (q) {
    this.searchQuery = (q || '').toLowerCase().trim();
    this.render();
  };

  CatalogController.prototype.reload = function () {
    var self = this;
    if (!this.productsUrl || this.shouldSkipProducts()) {
      this.products = [];
      this.render();
      return Promise.resolve();
    }
    var buyerAddressId = this.getBuyerAddressId();
    var debtorId = this.getDebtorId();

    this.loadGeneration += 1;
    var generation = this.loadGeneration;
    this.products = [];
    this.groupPagination = {};
    this.hasMore = false;
    this.loading = true;
    this.showLoading(true);
    this.showError(false);

    var failures = 0;
    var completed = 0;
    var totalGroups = OPTION_GROUP_ORDER.length;

    function hasAnyItems() {
      return self.products.some(function (g) {
        return asArray(g && g.items).length > 0;
      });
    }

    function displayCatalog() {
      try {
        self.onProductsLoaded(self.products, self.preorderDates);
        self.render();
      } catch (err) {
        console.error('preorder catalog: display', err);
        self.showError(true);
      }
    }

    function finishGroup() {
      completed += 1;
      if (generation !== self.loadGeneration) return;
      if (hasAnyItems()) {
        self.showError(false);
        self.showLoading(false);
      }
      if (completed < totalGroups) return;
      self.loading = false;
      if (!hasAnyItems()) {
        self.showError(failures > 0);
      }
      self.hasMore =
        self.autoLoadMore &&
        OPTION_GROUP_ORDER.some(function (name) {
          return groupHasMorePages(self.groupPagination[name]);
        });
      if (self.autoLoadMore && self.hasMore) {
        self.loadMore();
      }
    }

    OPTION_GROUP_ORDER.forEach(function (groupName) {
      fetchProductsJson(
        buildProductsUrl(self.productsUrl, {
          buyerAddressId: buyerAddressId,
          debtorId: debtorId,
          pageNumber: 1,
          pageSize: PAGE_SIZE,
          optionGroupName: groupName,
        }),
      )
        .then(function (result) {
          if (generation !== self.loadGeneration) return;
          self.products = mergeGroupedProducts(self.products, result);
          self.groupPagination[groupName] = {
            currentPage: 1,
            meta: result.meta || null,
          };
          self.preorderDates = extractDatesFromProducts(self.products);
          displayCatalog();
          finishGroup();
        })
        .catch(function (err) {
          if (generation !== self.loadGeneration) return;
          failures += 1;
          console.warn('preorder catalog: group fetch failed', groupName, err);
          self.groupPagination[groupName] = { currentPage: 1, meta: null };
          finishGroup();
        });
    });

    return Promise.resolve();
  };

  CatalogController.prototype.loadMore = function () {
    var self = this;
    if (this.loadingMore || !this.hasMore || this.loading) return Promise.resolve();

    if (this.shouldSkipProducts()) return Promise.resolve();

    var buyerAddressId = this.getBuyerAddressId();
    var debtorId = this.getDebtorId();

    var groupName = null;
    for (var i = 0; i < OPTION_GROUP_ORDER.length; i++) {
      var g = this.groupPagination[OPTION_GROUP_ORDER[i]];
      if (groupHasMorePages(g)) {
        groupName = OPTION_GROUP_ORDER[i];
        break;
      }
    }
    if (!groupName) {
      this.hasMore = false;
      return Promise.resolve();
    }

    var generation = this.loadGeneration;
    this.loadingMore = true;
    this.showLoadMore(true);

    var g = this.groupPagination[groupName];
    var nextPage = g.currentPage + 1;

    return fetchProductsJson(
      buildProductsUrl(this.productsUrl, {
        buyerAddressId: buyerAddressId,
        debtorId: debtorId,
        pageNumber: nextPage,
        pageSize: PAGE_SIZE,
        optionGroupName: groupName,
      }),
    )
      .then(function (result) {
        if (generation !== self.loadGeneration) return;
        self.products = mergeGroupedProducts(self.products, result);
        self.groupPagination[groupName] = {
          currentPage: nextPage,
          meta: result.meta || null,
        };
        self.preorderDates = extractDatesFromProducts(self.products);
        self.hasMore = self.autoLoadMore && OPTION_GROUP_ORDER.some(function (name) {
          return groupHasMorePages(self.groupPagination[name]);
        });
        try {
          self.onProductsLoaded(self.products, self.preorderDates);
          self.render();
        } catch (err) {
          console.error('preorder catalog: loadMore render', err);
        }
      })
      .catch(function (err) {
        console.warn('preorder catalog: loadMore failed', err);
      })
      .finally(function () {
        if (generation === self.loadGeneration) {
          self.loadingMore = false;
          self.showLoadMore(false);
        }
      });
  };

  CatalogController.prototype.showLoading = function (on) {
    if (this.loadingEl) this.loadingEl.hidden = !on;
  };

  CatalogController.prototype.showError = function (on) {
    if (this.errorEl) this.errorEl.hidden = !on;
  };

  CatalogController.prototype.showLoadMore = function (on) {
    if (this.loadMoreEl) this.loadMoreEl.hidden = !on;
  };

  CatalogController.prototype.filterItems = function (items) {
    var q = this.searchQuery;
    if (!q) return items;
    return items.filter(function (p) {
      var title = productTitle(p).toLowerCase();
      var sku = (p.sku || '').toLowerCase();
      return title.indexOf(q) >= 0 || sku.indexOf(q) >= 0;
    });
  };

  CatalogController.prototype.render = function () {
    var self = this;
    if (!this.catalogEl) return;

    var copy = this.getCopy();
    var session = this.getSession() || {};
    var charts = normalizeShoeSizeCharts(session.shoeSizeCharts || {});
    var region = this.getSizeRegion();
    var dates = this.getSelectedDates();
    if (!dates.length) dates = this.preorderDates;
    var isStockRelevant = !!session.isStockRelevant;

    if (!this.products.length && !this.loading) {
      this.catalogEl.innerHTML =
        '<p class="aico-preorder-catalog-empty">' +
        escapeHtml(copy.empty || 'No products.') +
        '</p>';
      return;
    }

    this.catalogEl.style.setProperty('--aico-preorder-aside-w', '8.25rem');
    this.catalogEl.style.setProperty('--aico-preorder-date-w', '5.5rem');
    this.catalogEl.style.setProperty('--aico-preorder-total-w', '3.5rem');
    this.catalogEl.style.setProperty('--aico-preorder-grid-gap', '0.35rem');

    var searching = !!this.searchQuery;
    var groupsHtml = '';
    var matchedCount = 0;
    var totalCount = 0;

    sortGroupsByOrder(this.products).forEach(function (group) {
      var all = asArray(group && group.items);
      totalCount += all.length;
      var items = self.filterItems(all);
      if (!items.length) return;
      matchedCount += items.length;

      var collapsed = !!self.collapsedGroups[group.optionGroupName];
      var sizeValues = collectGroupSizeValues(items);
      var cellW = computeGroupMatrixCellWidthRem(group, charts, region);

      groupsHtml +=
        '<section class="aico-preorder-group' +
        (collapsed ? ' aico-preorder-group-collapsed' : '') +
        '" data-aico-preorder-group style="--aico-preorder-cell-w:' +
        cellW +
        '">';
      groupsHtml += '<header class="aico-preorder-group-head">';
      groupsHtml += '<div class="aico-preorder-group-header-row">';
      // The title is a toggle button so the whole category can be collapsed; the
      // count badge makes a search visibly change the header even when the
      // remaining cards look alike.
      groupsHtml +=
        '<h3 class="aico-preorder-group-title">' +
        '<button type="button" class="aico-preorder-group-toggle" data-aico-preorder-group-toggle ' +
        'data-group-name="' + escapeHtml(group.optionGroupName) + '" aria-expanded="' +
        (collapsed ? 'false' : 'true') + '">' +
        '<svg class="aico-preorder-group-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>' +
        '<span class="aico-preorder-group-name">' + escapeHtml(group.optionGroupName) + '</span>' +
        '<span class="aico-preorder-group-count' + (searching ? ' aico-preorder-group-count--searching' : '') +
        '">' + items.length + (searching ? '/' + all.length : '') + '</span>' +
        '</button>' +
        '</h3>';
      // Size labels live once in the group header, aligned with the box columns
      // and scroll-synced with the per-product matrices (scrollbar hidden here).
      groupsHtml +=
        '<div class="aico-preorder-matrix-scroll aico-preorder-matrix-scroll--header" data-aico-preorder-matrix-scroll aria-hidden="true">' +
        '<div class="aico-preorder-matrix-track">';
      sizeValues.forEach(function (optVal) {
        var headLabel = getCountryLabel(charts, group.optionGroupName, region, optVal);
        groupsHtml +=
          '<span class="aico-preorder-size-head">' +
          formatSizeLabelHtml(headLabel) +
          '</span>';
      });
      groupsHtml += '</div></div>';
      groupsHtml +=
        '<div class="aico-preorder-matrix-total-head">' +
        escapeHtml(copy.productTotal || 'Total') +
        '</div>';
      groupsHtml += '</div></header>';

      items.forEach(function (product) {
        groupsHtml += self.renderProductCard(
          product,
          group.optionGroupName,
          dates,
          sizeValues,
          isStockRelevant,
          charts,
          region,
          copy,
        );
      });
      groupsHtml += '</section>';
    });

    var countBadge = searching
      ? '<span class="aico-preorder-products-count" data-aico-preorder-products-count>' +
        matchedCount + '/' + totalCount + '</span>'
      : '';
    var html =
      '<div class="aico-preorder-products-heading">' +
      escapeHtml(copy.productsHeading || 'Products') +
      countBadge +
      '</div>';

    if (!groupsHtml && searching) {
      // A search that matches nothing must say so — otherwise the blank area
      // reads as "the search didn't run".
      html +=
        '<p class="aico-preorder-catalog-empty aico-preorder-no-matches">' +
        escapeHtml(copy.empty || 'No products.') +
        ' “' + escapeHtml(this.searchQuery) + '”</p>';
    } else {
      html += groupsHtml;
    }

    this.catalogEl.innerHTML = html;
    this.bindQuantityInputs();
    this.bindGroupToggles();
    this.bindMatrixScrollSync();
    this.syncMatrixScrollPositions();
  };

  // Collapse/expand a category in place (no re-render, so quantity inputs keep
  // their values and focus). The collapsed set persists across renders.
  CatalogController.prototype.bindGroupToggles = function () {
    var self = this;
    if (!this.catalogEl) return;
    this.catalogEl
      .querySelectorAll('[data-aico-preorder-group-toggle]')
      .forEach(function (btn) {
        btn.addEventListener('click', function () {
          var name = btn.getAttribute('data-group-name');
          var section = btn.closest('[data-aico-preorder-group]');
          var collapsed = !self.collapsedGroups[name];
          self.collapsedGroups[name] = collapsed;
          if (section) {
            section.classList.toggle('aico-preorder-group-collapsed', collapsed);
          }
          btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        });
      });
  };

  // Update one product card's cell values, max/disabled state and totals in
  // place — no DOM rebuild, no focus/scroll loss. Used for the eager per-change
  // update and the idle reconcile so the grid stays snappy.
  CatalogController.prototype.refreshProduct = function (productId) {
    if (!this.catalogEl) return;
    var card = this.catalogEl.querySelector(
      '[data-aico-preorder-product-id="' + productId + '"]',
    );
    if (!card) return;
    var self = this;
    var session = this.getSession() || {};
    var isStockRelevant = !!session.isStockRelevant;
    var copy = this.getCopy();

    card.querySelectorAll('[data-aico-preorder-qty]').forEach(function (input) {
      var variantId = parseInt(input.getAttribute('data-variant-id'), 10);
      var dateLabel = input.getAttribute('data-date');
      var cell = self.cellState(productId, variantId, dateLabel, isStockRelevant);
      if (document.activeElement !== input) {
        input.value = cell.qty > 0 ? String(cell.qty) : '';
      }
      var box = input.closest('.aico-preorder-qty-box');
      var incBtn = box ? box.querySelector('[data-aico-preorder-qty-step="1"]') : null;
      var decBtn = box ? box.querySelector('[data-aico-preorder-qty-step="-1"]') : null;

      if (isStockRelevant && cell.max >= 0 && cell.max < 10000) {
        input.setAttribute('max', String(cell.max));
      } else {
        input.removeAttribute('max');
      }
      if (cell.committed > 0) input.setAttribute('min', String(cell.committed));
      else input.setAttribute('min', '0');

      input.disabled = cell.boxDisabled;
      if (incBtn) incBtn.disabled = cell.boxDisabled || cell.incrementDisabled;
      if (decBtn) decBtn.disabled = cell.boxDisabled || cell.decrementDisabled;
      if (box) {
        box.classList.toggle('aico-preorder-qty-box--disabled', cell.boxDisabled);
        box.classList.toggle('aico-preorder-qty-box--filled', cell.filled);
        box.classList.toggle('aico-preorder-qty-box--committed', cell.committedStyle);
      }
    });

    card.querySelectorAll('.aico-preorder-matrix-row').forEach(function (row) {
      var dateEl = row.querySelector('.aico-preorder-matrix-date');
      var totalEl = row.querySelector('.aico-preorder-matrix-row-total strong');
      if (dateEl && totalEl) {
        totalEl.textContent = rowTotalForDate(productId, dateEl.textContent.trim());
      }
    });

    var totalStrong = card.querySelector('.aico-preorder-product-total strong');
    if (totalStrong) {
      totalStrong.textContent = productTotal(productId) + ' ' + (copy.pcs || 'STK');
    }
  };

  CatalogController.prototype.refreshAll = function () {
    var self = this;
    (this.products || []).forEach(function (group) {
      (group.items || []).forEach(function (p) {
        self.refreshProduct(p.id);
      });
    });
  };

  CatalogController.prototype.syncMatrixScrollPositions = function () {
    if (!this.catalogEl) return;
    this.catalogEl.querySelectorAll('[data-aico-preorder-group]').forEach(function (groupEl) {
      var scrollEls = groupEl.querySelectorAll('[data-aico-preorder-matrix-scroll]');
      if (scrollEls.length < 2) return;
      var anchor = scrollEls[0];
      var left = anchor.scrollLeft;
      for (var i = 1; i < scrollEls.length; i++) {
        scrollEls[i].scrollLeft = left;
      }
    });
  };

  CatalogController.prototype.bindMatrixScrollSync = function () {
    if (!this.catalogEl) return;
    this.catalogEl.querySelectorAll('[data-aico-preorder-group]').forEach(function (groupEl) {
      var scrollEls = groupEl.querySelectorAll('[data-aico-preorder-matrix-scroll]');
      if (!scrollEls.length) return;
      var syncing = false;
      function syncFrom(source, left) {
        if (syncing) return;
        syncing = true;
        var scrollLeft = left != null ? left : source.scrollLeft;
        scrollEls.forEach(function (el) {
          if (el.scrollLeft !== scrollLeft) el.scrollLeft = scrollLeft;
        });
        syncing = false;
      }
      scrollEls.forEach(function (el) {
        el.addEventListener('scroll', function () {
          syncFrom(el);
        });
      });
      groupEl.querySelectorAll('[data-aico-preorder-product-rows]').forEach(function (matrix) {
        matrix.addEventListener(
          'wheel',
          function (e) {
            var delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
            if (!delta) return;
            e.preventDefault();
            var anchor = scrollEls[0];
            if (!anchor) return;
            syncFrom(anchor, anchor.scrollLeft + delta);
          },
          { passive: false },
        );
      });
    });
  };

  CatalogController.prototype.renderProductCard = function (
    product,
    optionGroupName,
    dates,
    sizeValues,
    isStockRelevant,
    charts,
    region,
    copy,
  ) {
    var self = this;
    var title = productTitle(product);
    var img = productImage(product);
    var price = productPrice(product);
    var currency = productCurrency(product);
    var totalPcs = productTotal(product.id);

    var html =
      '<article class="aico-preorder-product-card" data-aico-preorder-product-id="' +
      product.id +
      '">';

    html += '<div class="aico-preorder-product-grid">';
    html += '<div class="aico-preorder-product-aside">';
    if (img) {
      html +=
        '<div class="aico-preorder-product-media"><img src="' +
        escapeHtml(img) +
        '" alt="" loading="lazy" decoding="async" width="96" height="96"></div>';
    }
    html += '<div class="aico-preorder-product-info">';
    html += '<h4 class="aico-preorder-product-title">' + escapeHtml(title) + '</h4>';
    if (product.sku) {
      html += '<p class="aico-preorder-product-sku">' + escapeHtml(product.sku) + '</p>';
    }
    if (price != null && price >= 0) {
      html +=
        '<p class="aico-preorder-product-price">' +
        escapeHtml(formatMoney(price, currency)) +
        '</p>';
    }
    html += '</div></div>';
    html += '<div class="aico-preorder-product-rows" data-aico-preorder-product-rows>';

    dates.forEach(function (dateLabel, dateIdx) {
      var scrollClass = 'aico-preorder-matrix-scroll';
      if (dateIdx === dates.length - 1) {
        scrollClass += ' aico-preorder-matrix-scroll--bar';
      }
      html += '<div class="aico-preorder-matrix-row">';
      html +=
        '<div class="aico-preorder-matrix-date">' +
        escapeHtml(dateLabel) +
        '</div>';
      html +=
        '<div class="' +
        scrollClass +
        '" data-aico-preorder-matrix-scroll><div class="aico-preorder-matrix-track">';
      sizeValues.forEach(function (optVal) {
        var variant = getVariantForOption(product, optVal);
        var label = getCountryLabel(charts, optionGroupName, region, optVal);
        if (!variant) {
          html +=
            '<span class="aico-preorder-qty-box aico-preorder-qty-box--missing" aria-hidden="true">' +
            '<span class="aico-preorder-qty-box__dash">-</span></span>';
          return;
        }
        var cell = self.cellState(product.id, variant.id, dateLabel, isStockRelevant);
        var maxAttr = '';
        var minAttr = '';
        if (isStockRelevant && cell.max >= 0 && cell.max < 10000) {
          maxAttr = ' max="' + cell.max + '"';
        }
        if (cell.committed > 0) minAttr = ' min="' + cell.committed + '"';
        html += renderQtyInput({
          ariaLabel: label + ' ' + dateLabel,
          qty: cell.qty,
          boxDisabled: cell.boxDisabled,
          incrementDisabled: cell.incrementDisabled,
          decrementDisabled: cell.decrementDisabled,
          committedStyle: cell.committedStyle,
          filled: cell.filled,
          maxAttr: maxAttr,
          minAttr: minAttr,
          sizeLabelHtml: formatSizeLabelHtml(label),
          attrs:
            'data-product-id="' +
            product.id +
            '" data-variant-id="' +
            variant.id +
            '" data-date="' +
            escapeHtml(dateLabel) +
            '"',
        });
      });
      html += '</div></div>';
      var rowTotal = rowTotalForDate(product.id, dateLabel);
      html +=
        '<div class="aico-preorder-matrix-row-total"><strong>' +
        rowTotal +
        '</strong></div>';
      html += '</div>';
    });
    html += '</div></div>';

    html +=
      '<div class="aico-preorder-product-footer"><span class="aico-preorder-product-total">' +
      escapeHtml(copy.productTotal || 'Total') +
      ': <strong>' +
      totalPcs +
      ' ' +
      escapeHtml(copy.pcs || 'STK') +
      '</strong></span></div>';

    html += '</article>';
    return html;
  };

  CatalogController.prototype.getQuantity = function (productId, variantId, dateLabel) {
    var session = this.getSession() || {};
    if (
      session.isStockRelevant &&
      global.AicoPreorderStock &&
      global.AicoPreorderStock.getQuantity
    ) {
      return global.AicoPreorderStock.getQuantity(
        productId,
        variantId,
        dateLabel,
      );
    }
    var cart = this.getCartState();
    if (!cart || !cart.preorderItemLists) return 0;
    var list = cart.preorderItemLists.find(function (l) {
      var d = String(l.preorderDate || '');
      return d.indexOf(dateLabel) >= 0 || dateLabel.indexOf(d) >= 0;
    });
    if (!list) return 0;
    var item = (list.preorderItems || []).find(function (it) {
      var pid = it.productId || (it.product && it.product.id);
      var vid = it.productVariantId || (it.productVariant && it.productVariant.id);
      return pid === productId && vid === variantId;
    });
    return item ? item.quantity || 0 : 0;
  };

  // Normalized cell descriptor for rendering/refresh. Delegates to the stock
  // module's getCellState; falls back to a plain qty-only state when stock isn't
  // tracked client-side (non-stock sessions, or module not loaded).
  CatalogController.prototype.cellState = function (productId, variantId, dateLabel, isStockRelevant) {
    if (global.AicoPreorderStock && global.AicoPreorderStock.getCellState) {
      return global.AicoPreorderStock.getCellState(
        productId,
        variantId,
        dateLabel,
        !!isStockRelevant,
      );
    }
    var qty = this.getQuantity(productId, variantId, dateLabel);
    return {
      qty: qty,
      committed: 0,
      max: 10000,
      remaining: Infinity,
      boxDisabled: false,
      incrementDisabled: false,
      decrementDisabled: qty <= 0,
      committedStyle: false,
      filled: qty > 0,
    };
  };

  CatalogController.prototype.findProduct = function (productId) {
    for (var g = 0; g < this.products.length; g++) {
      var items = this.products[g].items || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].id === productId) return items[i];
      }
    }
    return null;
  };

  CatalogController.prototype.bindQuantityInputs = function () {
    var self = this;

    function clampFor(productId, variantId, dateLabel, raw, isStockRelevant, enforceFloor) {
      if (global.AicoPreorderStock && global.AicoPreorderStock.clampCell) {
        return global.AicoPreorderStock.clampCell(
          productId,
          variantId,
          dateLabel,
          raw,
          isStockRelevant,
          enforceFloor,
        );
      }
      var n = Math.floor(Number(raw));
      if (isNaN(n) || n < 0) n = 0;
      return Math.min(10000, n);
    }

    // Apply a value to a cell. enforceFloor=false during live typing (so the
    // user can clear/lower a box without it snapping to the committed floor);
    // enforceFloor=true on commit (change/blur) and step clicks. The upper bound
    // (cross-date pool cap) is always enforced — that's the live clamp (6.3).
    function apply(input, value, enforceFloor) {
      var productId = parseInt(input.getAttribute('data-product-id'), 10);
      var variantId = parseInt(input.getAttribute('data-variant-id'), 10);
      var dateLabel = input.getAttribute('data-date');
      var session = self.getSession() || {};
      var isStockRelevant = !!session.isStockRelevant;
      var raw = value == null ? (input.value === '' ? 0 : parseInt(input.value, 10)) : value;
      var qty = clampFor(productId, variantId, dateLabel, raw, isStockRelevant, enforceFloor);
      var display = qty > 0 ? String(qty) : '';
      if (input.value !== display) input.value = display;
      var product = self.findProduct(productId);
      self.onQuantityChange(productId, variantId, dateLabel, qty, product);
      // Eager UI: update only this product's cells/totals in place (stock mode
      // tracks quantities client-side, so we never wait for the backend). The
      // focused input keeps its own caret — refreshProduct only rewrites the
      // value of non-focused inputs. Fall back to a full render when stock isn't
      // tracked client-side.
      if (isStockRelevant && self.refreshProduct) {
        self.refreshProduct(productId);
      } else {
        self.render();
      }
    }

    this.catalogEl.querySelectorAll('[data-aico-preorder-qty]').forEach(function (input) {
      // Aggressive live clamp: run the FULL clamp (upper cap + committed floor) on
      // every interaction — as soon as the user types, not on blur/Enter. Typing
      // above the cross-date cap snaps down to it; typing below a committed min
      // snaps up to it; both happen immediately on the `input` event (6.3 / 6.2).
      input.addEventListener('input', function () {
        apply(input, null, true);
      });
      input.addEventListener('change', function () {
        apply(input, null, true);
      });
      input.addEventListener('wheel', function (e) {
        e.preventDefault();
        input.blur();
      });
    });

    this.catalogEl.querySelectorAll('[data-aico-preorder-qty-step]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        if (btn.disabled) return;
        var control = btn.closest('.aico-preorder-qty-box__inner');
        var input = control && control.querySelector('[data-aico-preorder-qty]');
        if (!input || input.disabled) return;
        var step = parseInt(btn.getAttribute('data-aico-preorder-qty-step'), 10) || 0;
        var current = parseInt(input.value, 10) || 0;
        apply(input, current + step, true);
      });
    });
  };

  global.AicoPreorderCatalog = {
    OPTION_GROUP_ORDER: OPTION_GROUP_ORDER,
    CatalogController: CatalogController,
    productTitle: productTitle,
    productPrice: productPrice,
    productCurrency: productCurrency,
  };
})(typeof window !== 'undefined' ? window : this);
