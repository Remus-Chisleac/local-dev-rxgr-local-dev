/**
 * Preorder product catalog — b2b-shop matrix layout + four-group pagination.
 */
(function (global) {
  'use strict';

  var OPTION_GROUP_ORDER = [
    'Women Shoes',
    'Women Sandals',
    'Men Shoes',
    'Men Sandals',
  ];

  var PAGE_SIZE = 15;

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
    var set = new Set();
    groups.forEach(function (group) {
      group.items.forEach(function (product) {
        (product.preorderStockData || []).forEach(function (row) {
          if (row.date) {
            try {
              set.add(
                new Date(row.date).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                }),
              );
            } catch (_) {}
          }
        });
      });
    });
    return Array.from(set).sort();
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
    for (var i = 0; i < variants.length; i++) {
      var v = variants[i];
      var options = v.productVariantOptions || [];
      for (var j = 0; j < options.length; j++) {
        if (options[j].value === optionValue) return v;
      }
    }
    return null;
  }

  function getCountryLabel(charts, optionGroupName, region, option) {
    if (!charts || typeof charts !== 'object') return option;
    var gender =
      Object.keys(charts).find(function (g) {
        return optionGroupName.indexOf(g) >= 0;
      }) || 'Men';
    var sizes = charts[gender] && charts[gender][region];
    return sizes && sizes[option] ? sizes[option] : option;
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

  function productPrice(product) {
    if (product.price != null && product.price >= 0) return product.price;
    if (product.priceList && product.priceList.price != null) {
      return product.priceList.price;
    }
    if (product.variantPrice != null) return product.variantPrice;
    return null;
  }

  function productCurrency(product) {
    return (
      product.variantPriceCurrency ||
      product.currency ||
      (product.priceList && product.priceList.currency) ||
      'CHF'
    );
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
    this.hasMore = true;
    this.loading = true;
    this.showLoading(true);
    this.showError(false);

    var fetches = OPTION_GROUP_ORDER.map(function (groupName) {
      return fetchProductsJson(
        buildProductsUrl(self.productsUrl, {
          buyerAddressId: buyerAddressId,
          debtorId: debtorId,
          pageNumber: 1,
          pageSize: PAGE_SIZE,
          optionGroupName: groupName,
        }),
      );
    });

    return Promise.allSettled(fetches)
      .then(function (settlements) {
        if (generation !== self.loadGeneration) return;
        var merged = [];
        var pagination = {};
        var failures = 0;
        settlements.forEach(function (settled, i) {
          if (settled.status === 'fulfilled') {
            var result = settled.value;
            merged = mergeGroupedProducts(merged, result);
            pagination[OPTION_GROUP_ORDER[i]] = {
              currentPage: 1,
              meta: result.meta || null,
            };
          } else {
            failures += 1;
            console.warn(
              'preorder catalog: group fetch failed',
              OPTION_GROUP_ORDER[i],
              settled.reason,
            );
            pagination[OPTION_GROUP_ORDER[i]] = { currentPage: 1, meta: null };
          }
        });
        self.products = merged;
        self.groupPagination = pagination;
        self.preorderDates = extractDatesFromProducts(merged);
        self.hasMore = OPTION_GROUP_ORDER.some(function (name) {
          var m = pagination[name] && pagination[name].meta;
          return m && m.currentPage < m.lastPage;
        });
        if (!merged.length && failures > 0) {
          self.showError(true);
          return;
        }
        self.showError(false);
        try {
          self.onProductsLoaded(self.products, self.preorderDates);
        } catch (hookErr) {
          console.error('preorder catalog: onProductsLoaded', hookErr);
        }
        try {
          self.render();
        } catch (renderErr) {
          console.error('preorder catalog: render', renderErr);
          self.showError(true);
          return;
        }
        if (self.hasMore) self.loadMore();
      })
      .catch(function (err) {
        if (generation !== self.loadGeneration) return;
        console.error('preorder catalog:', err);
        self.showError(true);
      })
      .finally(function () {
        if (generation === self.loadGeneration) {
          self.loading = false;
          self.showLoading(false);
        }
      });
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
      if (g && g.meta && g.meta.currentPage < g.meta.lastPage) {
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
        self.hasMore = OPTION_GROUP_ORDER.some(function (name) {
          var m = self.groupPagination[name] && self.groupPagination[name].meta;
          return m && m.currentPage < m.lastPage;
        });
        self.onProductsLoaded(self.products, self.preorderDates);
        self.render();
        if (self.hasMore) return self.loadMore();
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
    var charts = session.shoeSizeCharts || {};
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

    var html = '<div class="aico-preorder-products-heading">' +
      escapeHtml(copy.productsHeading || 'Products') +
      '</div>';

    this.products.forEach(function (group) {
      var items = self.filterItems(group.items);
      if (!items.length) return;

      var sizeValues = collectGroupSizeValues(items);

      html += '<section class="aico-preorder-group" data-aico-preorder-group>';
      html +=
        '<header class="aico-preorder-group-header"><h3 class="aico-preorder-group-title">' +
        escapeHtml(group.optionGroupName) +
        '</h3>';
      if (sizeValues.length) {
        html += '<div class="aico-preorder-group-sizes" aria-hidden="true">';
        sizeValues.forEach(function (opt) {
          html +=
            '<span class="aico-preorder-group-size-pill">' +
            escapeHtml(getCountryLabel(charts, group.optionGroupName, region, opt)) +
            '</span>';
        });
        html += '</div>';
      }
      html += '</header>';

      items.forEach(function (product) {
        html += self.renderProductCard(
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
      html += '</section>';
    });

    this.catalogEl.innerHTML = html;
    this.bindQuantityInputs();
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
      '"><div class="aico-preorder-product-card-inner">';

    html += '<div class="aico-preorder-product-meta">';
    html += '<div class="aico-preorder-product-media">';
    if (img) {
      html +=
        '<img src="' +
        escapeHtml(img) +
        '" alt="" loading="lazy" decoding="async" width="120" height="120">';
    }
    html += '</div><div class="aico-preorder-product-info">';
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

    html += '<div class="aico-preorder-matrix-wrap">';
    html += '<div class="aico-preorder-matrix">';
    html += '<div class="aico-preorder-matrix-dates">';
    dates.forEach(function (dateLabel) {
      html += '<div class="aico-preorder-matrix-date-label">' + escapeHtml(dateLabel) + '</div>';
    });
    html += '</div>';

    html += '<div class="aico-preorder-matrix-grid">';
    sizeValues.forEach(function (optVal) {
      var variant = getVariantForOption(product, optVal);
      if (!variant) return;
      var label = getCountryLabel(charts, optionGroupName, region, optVal);
      html += '<div class="aico-preorder-size-column">';
      html += '<div class="aico-preorder-size-column-label">' + escapeHtml(label) + '</div>';
      dates.forEach(function (dateLabel) {
        var qty = self.getQuantity(product.id, variant.id, dateLabel);
        var maxAttr = '';
        if (isStockRelevant && global.AicoPreorderStock) {
          var max = global.AicoPreorderStock.getMaxQuantity(
            product.id,
            variant.id,
            dateLabel,
            product,
          );
          if (max >= 0 && max < 10000) maxAttr = ' max="' + max + '"';
        }
        html +=
          '<input type="number" class="aico-preorder-qty-input" min="0" step="1" value="' +
          qty +
          '"' +
          maxAttr +
          ' data-aico-preorder-qty data-product-id="' +
          product.id +
          '" data-variant-id="' +
          variant.id +
          '" data-date="' +
          escapeHtml(dateLabel) +
          '" aria-label="' +
          escapeHtml(label + ' ' + dateLabel) +
          '">';
      });
      html += '</div>';
    });
    html += '</div>';

    html += '<div class="aico-preorder-matrix-row-totals">';
    dates.forEach(function (dateLabel) {
      var rowTotal = rowTotalForDate(product.id, dateLabel);
      html +=
        '<div class="aico-preorder-matrix-row-total">' +
        escapeHtml(copy.rowTotal || 'Total Input') +
        ': <strong>' +
        rowTotal +
        '</strong></div>';
    });
    html += '</div></div></div>';

    html +=
      '<p class="aico-preorder-product-total">' +
      escapeHtml(copy.productTotal || 'Total') +
      ': <strong>' +
      totalPcs +
      ' ' +
      escapeHtml(copy.pcs || 'STK') +
      '</strong></p>';

    html += '</div></div></article>';
    return html;
  };

  CatalogController.prototype.getQuantity = function (productId, variantId, dateLabel) {
    if (global.AicoPreorderStock && global.AicoPreorderStock.getQuantity) {
      var cart = this.getCartState();
      if (!cart || !cart.preorderItemLists) {
        return global.AicoPreorderStock.getQuantity(
          productId,
          variantId,
          dateLabel,
        );
      }
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
    this.catalogEl.querySelectorAll('[data-aico-preorder-qty]').forEach(function (input) {
      input.addEventListener('change', function () {
        var productId = parseInt(input.getAttribute('data-product-id'), 10);
        var variantId = parseInt(input.getAttribute('data-variant-id'), 10);
        var dateLabel = input.getAttribute('data-date');
        var qty = parseInt(input.value, 10);
        if (isNaN(qty) || qty < 0) qty = 0;
        input.value = qty;
        var product = self.findProduct(productId);
        self.onQuantityChange(productId, variantId, dateLabel, qty, product);
        self.render();
      });
    });
  };

  global.AicoPreorderCatalog = {
    OPTION_GROUP_ORDER: OPTION_GROUP_ORDER,
    CatalogController: CatalogController,
    productTitle: productTitle,
  };
})(typeof window !== 'undefined' ? window : this);
