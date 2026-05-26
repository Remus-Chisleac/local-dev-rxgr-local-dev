/**
 * Preorder product catalog — four-group pagination (b2b-shop parity).
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

  function mergeGroupedProducts(prev, result) {
    var newProducts = prev.slice();
    var groups = (result && result.data && result.data.products) || [];
    if (Array.isArray(result && result.data)) {
      groups = groupFlatProducts(result.data);
    }
    if (Array.isArray(result)) {
      groups = groupFlatProducts(result);
    }
    if (result && result.data && Array.isArray(result.data) && !result.data.products) {
      groups = groupFlatProducts(result.data);
    }

    groups.forEach(function (newGroup) {
      var name = newGroup.optionGroupName;
      var idx = -1;
      for (var i = 0; i < newProducts.length; i++) {
        if (newProducts[i].optionGroupName === name) {
          idx = i;
          break;
        }
      }
      if (idx >= 0) {
        newProducts[idx] = {
          optionGroupName: name,
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

  function mergePreorderDates(lists) {
    var set = new Set();
    lists.forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (d) {
        if (d) set.add(d);
      });
    });
    return Array.from(set);
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
    if (params.optionGroupName) {
      url.searchParams.set('filter[option_group_name]', params.optionGroupName);
    }
    return url.toString();
  }

  function fetchProductsJson(url) {
    return fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    }).then(function (res) {
      if (!res.ok) throw new Error('products_fetch_failed');
      return res.json();
    });
  }

  function getSizeOption(product) {
    var opts = product.variationOptions || [];
    for (var i = 0; i < opts.length; i++) {
      var n = (opts[i].name || '').toLowerCase();
      if (n.indexOf('size') >= 0 || n === 'größe' || n === 'grosse') {
        return opts[i];
      }
    }
    return opts[0] || { name: 'Size', values: [] };
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
    return product.name || product.webName || product.title || product.sku || '';
  }

  function productImage(product) {
    return (
      product.mainImage ||
      (product.productImages && product.productImages[0] && product.productImages[0].imageUrl) ||
      ''
    );
  }

  function formatMoney(price, currency) {
    if (price == null || price < 0) return '';
    var cur = currency || 'CHF';
    return cur + ' ' + Number(price).toFixed(2);
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
    this.getSelectedDates = config.getSelectedDates || function () {
      return [];
    };
    this.getSizeRegion = config.getSizeRegion || function () {
      return 'EU';
    };
    this.getSession = config.getSession || function () {
      return null;
    };
    this.getCartState = config.getCartState || function () {
      return null;
    };
    this.onQuantityChange = config.onQuantityChange || function () {};

    this.products = [];
    this.groupPagination = {};
    this.loadGeneration = 0;
    this.loading = false;
    this.loadingMore = false;
    this.hasMore = true;
    this.preorderDates = [];
  }

  CatalogController.prototype.reload = function () {
    var self = this;
    var buyerAddressId = this.getBuyerAddressId();
    if (!buyerAddressId || !this.productsUrl) {
      this.products = [];
      this.render();
      return Promise.resolve();
    }

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
          pageNumber: 1,
          pageSize: PAGE_SIZE,
          optionGroupName: groupName,
        }),
      );
    });

    return Promise.all(fetches)
      .then(function (results) {
        if (generation !== self.loadGeneration) return;
        var merged = [];
        var pagination = {};
        results.forEach(function (result, i) {
          merged = mergeGroupedProducts(merged, { data: result.data });
          pagination[OPTION_GROUP_ORDER[i]] = {
            currentPage: 1,
            meta: result.meta || null,
          };
        });
        self.products = merged;
        self.groupPagination = pagination;
        self.preorderDates = extractDatesFromProducts(merged);
        self.hasMore = OPTION_GROUP_ORDER.some(function (name) {
          var m = pagination[name] && pagination[name].meta;
          return m && m.currentPage < m.lastPage;
        });
        self.onProductsLoaded(self.products, self.preorderDates);
        self.render();
        if (self.hasMore) self.loadMore();
      })
      .catch(function () {
        if (generation !== self.loadGeneration) return;
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

    var buyerAddressId = this.getBuyerAddressId();
    if (!buyerAddressId) return Promise.resolve();

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
        pageNumber: nextPage,
        pageSize: PAGE_SIZE,
        optionGroupName: groupName,
      }),
    )
      .then(function (result) {
        if (generation !== self.loadGeneration) return;
        self.products = mergeGroupedProducts(self.products, { data: result.data });
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

  CatalogController.prototype.render = function () {
    if (!this.catalogEl) return;
    var self = this;
    var session = this.getSession() || {};
    var charts = session.shoeSizeCharts || {};
    var region = this.getSizeRegion();
    var dates = this.getSelectedDates();
    if (!dates.length) dates = this.preorderDates;
    var viewMode = this.root.getAttribute('data-aico-preorder-view-mode') || 'grid';
    var isStockRelevant = !!session.isStockRelevant;
    var html = '';

    if (!this.products.length && !this.loading) {
      this.catalogEl.innerHTML =
        '<p class="aico-preorder-catalog-empty">' +
        escapeHtml(
          this.root.getAttribute('data-aico-preorder-copy-empty') || 'No products.',
        ) +
        '</p>';
      return;
    }

    this.products.forEach(function (group) {
      var sizeOpts = [];
      group.items.forEach(function (item) {
        var so = getSizeOption(item);
        (so.values || []).forEach(function (v) {
          if (sizeOpts.indexOf(v) < 0) sizeOpts.push(v);
        });
      });

      html += '<section class="aico-preorder-group" data-aico-preorder-group>';
      html +=
        '<header class="aico-preorder-group-header"><h3 class="aico-preorder-group-title">' +
        escapeHtml(group.optionGroupName) +
        '</h3>';
      if (sizeOpts.length) {
        html += '<div class="aico-preorder-size-labels" aria-hidden="true">';
        sizeOpts.forEach(function (opt) {
          html +=
            '<span class="aico-preorder-size-label">' +
            escapeHtml(getCountryLabel(charts, group.optionGroupName, region, opt)) +
            '</span>';
        });
        html += '</div></header>';
      } else {
        html += '</header>';
      }

      group.items.forEach(function (product) {
        html += self.renderProductRow(product, group.optionGroupName, dates, viewMode, isStockRelevant);
      });
      html += '</section>';
    });

    this.catalogEl.innerHTML = html;
    this.bindQuantityInputs();
  };

  CatalogController.prototype.renderProductRow = function (
    product,
    optionGroupName,
    dates,
    viewMode,
    isStockRelevant,
  ) {
    var self = this;
    var sizeOption = getSizeOption(product);
    var values = sizeOption.values || [];
    var title = productTitle(product);
    var img = productImage(product);
    var price = product.price != null ? product.price : product.variantPrice;
    var currency = product.variantPriceCurrency || product.currency || 'CHF';
    var compact = viewMode === 'list' ? ' aico-preorder-product-row--list' : '';

    var html =
      '<article class="aico-preorder-product-row' +
      compact +
      '" data-aico-preorder-product-id="' +
      product.id +
      '">';
    html += '<div class="aico-preorder-product-media">';
    if (img) {
      html += '<img src="' + escapeHtml(img) + '" alt="" loading="lazy" decoding="async">';
    }
    html += '</div><div class="aico-preorder-product-body">';
    html += '<h4 class="aico-preorder-product-title">' + escapeHtml(title) + '</h4>';
    if (product.sku) {
      html += '<p class="aico-preorder-product-sku">' + escapeHtml(product.sku) + '</p>';
    }
    if (price != null && price >= 0) {
      html += '<p class="aico-preorder-product-price">' + escapeHtml(formatMoney(price, currency)) + '</p>';
    }
    html += '<div class="aico-preorder-product-grid">';

    dates.forEach(function (dateLabel) {
      html += '<div class="aico-preorder-date-column">';
      html += '<span class="aico-preorder-date-label">' + escapeHtml(dateLabel) + '</span>';
      html += '<div class="aico-preorder-size-inputs">';
      values.forEach(function (optVal) {
        var variant = getVariantForOption(product, optVal);
        if (!variant) return;
        var qty = self.getQuantity(product.id, variant.id, dateLabel);
        var maxAttr = '';
        if (isStockRelevant && global.AicoPreorderStock) {
          var max = global.AicoPreorderStock.getMaxQuantity(
            product.id,
            variant.id,
            dateLabel,
            product,
          );
          if (max >= 0) maxAttr = ' max="' + max + '"';
        }
        html +=
          '<label class="aico-preorder-qty-field"><span class="aico-sr-only">' +
          escapeHtml(optVal) +
          '</span><input type="number" min="0" step="1" value="' +
          qty +
          '"' +
          maxAttr +
          ' data-aico-preorder-qty data-product-id="' +
          product.id +
          '" data-variant-id="' +
          variant.id +
          '" data-date="' +
          escapeHtml(dateLabel) +
          '" data-option-value="' +
          escapeHtml(optVal) +
          '"></label>';
      });
      html += '</div></div>';
    });

    html += '</div></div></article>';
    return html;
  };

  CatalogController.prototype.getQuantity = function (productId, variantId, dateLabel) {
    var cart = this.getCartState();
    if (!cart || !cart.preorderItemLists) return 0;
    var list = cart.preorderItemLists.find(function (l) {
      return String(l.preorderDate).indexOf(dateLabel) >= 0 || dateLabel.indexOf(String(l.preorderDate)) >= 0;
    });
    if (!list) return 0;
    var item = (list.preorderItems || []).find(function (it) {
      var pid = it.productId || (it.product && it.product.id);
      var vid = it.productVariantId || (it.productVariant && it.productVariant.id);
      return pid === productId && vid === variantId;
    });
    return item ? item.quantity || 0 : 0;
  };

  CatalogController.prototype.bindQuantityInputs = function () {
    var self = this;
    this.catalogEl.querySelectorAll('[data-aico-preorder-qty]').forEach(function (input) {
      input.addEventListener('change', function () {
        var productId = parseInt(input.getAttribute('data-product-id'), 10);
        var variantId = parseInt(input.getAttribute('data-variant-id'), 10);
        var dateLabel = input.getAttribute('data-date');
        var qty = parseInt(input.value, 10) || 0;
        self.onQuantityChange(productId, variantId, dateLabel, qty, input);
      });
    });
  };

  global.AicoPreorderCatalog = {
    OPTION_GROUP_ORDER: OPTION_GROUP_ORDER,
    CatalogController: CatalogController,
    mergeGroupedProducts: mergeGroupedProducts,
    extractDatesFromProducts: extractDatesFromProducts,
  };
})(typeof window !== 'undefined' ? window : this);
