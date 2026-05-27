/**
 * Preorder2 stock caps — isolated from preorder-stock.js (/preorder).
 */
(function (global) {
  'use strict';

  var state = {
    sizeStock: {},
    qty: {},
  };

  function idKey(id) {
    return id == null ? '' : String(id);
  }

  function asArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    return [];
  }

  /** API may return one warehouse row or one stock row as an object, not []. */
  function warehouseDataList(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (typeof data === 'object' && ('warehouse' in data || 'stocks' in data)) {
      return [data];
    }
    return [];
  }

  function stocksList(stocks) {
    if (!stocks) return [];
    if (Array.isArray(stocks)) return stocks;
    if (
      typeof stocks === 'object' &&
      ('variantId' in stocks || 'variant_id' in stocks || 'productId' in stocks)
    ) {
      return [stocks];
    }
    return [];
  }

  function normalizeDateKey(dateLabel) {
    try {
      var d = new Date(dateLabel);
      if (!isNaN(d.getTime())) {
        return d.toISOString().slice(0, 10);
      }
    } catch (_) {}
    return String(dateLabel);
  }

  function dateLabelFromRow(dateRow) {
    try {
      return new Date(dateRow.date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch (_) {
      return String(dateRow.date);
    }
  }

  function qtyAt(productId, variantId, dateKey) {
    var pid = idKey(productId);
    var vid = idKey(variantId);
    var byProduct = state.qty[pid];
    if (!byProduct) return 0;
    var byVariant = byProduct[vid];
    if (!byVariant) return 0;
    return byVariant[dateKey] || 0;
  }

  function setSizeStockFromProducts(productGroups) {
    var map = {};
    asArray(productGroups).forEach(function (group) {
      asArray(group && group.items).forEach(function (product) {
        var productId = idKey(product.id);
        if (!productId) return;
        if (!map[productId]) map[productId] = {};
        asArray(product.preorderStockData).forEach(function (dateRow) {
          var dateKey = normalizeDateKey(dateRow.date);
          var dateLabel = dateLabelFromRow(dateRow);
          warehouseDataList(dateRow.data).forEach(function (dataRow) {
            stocksList(dataRow.stocks).forEach(function (stock) {
              var variantId = idKey(stock.variantId || stock.variant_id);
              if (!variantId) return;
              if (!map[productId][variantId]) map[productId][variantId] = {};
              var amount = stock.overallAvailableAmount;
              var capped = amount >= 0 ? amount : 0;
              map[productId][variantId][dateKey] = capped;
              map[productId][variantId][dateLabel] = capped;
            });
          });
        });
      });
    });
    state.sizeStock = map;
    state.qty = {};
  }

  function adjustStock(productId, variantId, dateLabel, quantity) {
    var pid = idKey(productId);
    var vid = idKey(variantId);
    var dateKey = normalizeDateKey(dateLabel);
    if (!state.qty[pid]) state.qty[pid] = {};
    if (!state.qty[pid][vid]) state.qty[pid][vid] = {};
    state.qty[pid][vid][dateKey] = quantity;
    state.qty[pid][vid][dateLabel] = quantity;
  }

  function getMaxQuantity(productId, variantId, dateLabel) {
    var pid = idKey(productId);
    var vid = idKey(variantId);
    var stockMap = state.sizeStock[pid];
    if (!stockMap || !stockMap[vid]) return 9999;
    var byVariant = stockMap[vid];
    var dateKey = normalizeDateKey(dateLabel);
    var initial =
      byVariant[dateKey] != null ? byVariant[dateKey] : byVariant[dateLabel];
    if (initial == null) return 9999;
    var used = 0;
    Object.keys(byVariant)
      .sort()
      .forEach(function (dk) {
        if (dk <= dateKey) used += qtyAt(pid, vid, dk);
      });
    return Math.max(0, initial - (used - qtyAt(pid, vid, dateKey)));
  }

  function getRowTotal(productId, dateLabel) {
    var pid = idKey(productId);
    var dateKey = normalizeDateKey(dateLabel);
    var total = 0;
    var byVariant = state.qty[pid] || {};
    Object.keys(byVariant).forEach(function (vid) {
      var byVid = byVariant[vid] || {};
      total += byVid[dateKey] != null ? byVid[dateKey] : byVid[dateLabel] || 0;
    });
    return total;
  }

  function getQuantity(productId, variantId, dateLabel) {
    var dateKey = normalizeDateKey(dateLabel);
    return qtyAt(idKey(productId), idKey(variantId), dateKey) ||
      qtyAt(idKey(productId), idKey(variantId), dateLabel);
  }

  function getTotalPerProduct(productId) {
    var pid = idKey(productId);
    var byDate = {};
    var byVariant = state.qty[pid] || {};
    Object.keys(byVariant).forEach(function (vid) {
      Object.keys(byVariant[vid] || {}).forEach(function (dk) {
        byDate[dk] = (byDate[dk] || 0) + (byVariant[vid][dk] || 0);
      });
    });
    var total = 0;
    Object.keys(byDate).forEach(function (dk) {
      total += byDate[dk];
    });
    return total;
  }

  global.AicoPreorder2Stock = {
    setSizeStockFromProducts: setSizeStockFromProducts,
    adjustStock: adjustStock,
    getQuantity: getQuantity,
    getMaxQuantity: getMaxQuantity,
    getRowTotal: getRowTotal,
    getTotalPerProduct: getTotalPerProduct,
    _state: state,
  };
})(typeof window !== 'undefined' ? window : this);
