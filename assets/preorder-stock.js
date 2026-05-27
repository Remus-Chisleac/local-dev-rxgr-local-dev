/**
 * Preorder stock caps (simplified port of b2b-shop nSumSlice).
 */
(function (global) {
  'use strict';

  var state = {
    sizeStock: {},
    qty: {},
  };

  function normalizeDateKey(dateLabel) {
    try {
      var d = new Date(dateLabel);
      if (!isNaN(d.getTime())) {
        return d.toISOString().slice(0, 10);
      }
    } catch (_) {}
    return String(dateLabel);
  }

  function setSizeStockFromProducts(productGroups) {
    var map = {};
    productGroups.forEach(function (group) {
      group.items.forEach(function (product) {
        var productId = product.id;
        if (!map[productId]) map[productId] = {};
        (product.preorderStockData || []).forEach(function (dateRow) {
          var dateKey = normalizeDateKey(dateRow.date);
          (dateRow.data || []).forEach(function (dataRow) {
            (dataRow.stocks || []).forEach(function (stock) {
              var variantId = stock.variantId;
              if (!variantId) return;
              if (!map[productId][variantId]) map[productId][variantId] = {};
              var amount = stock.overallAvailableAmount;
              map[productId][variantId][dateKey] =
                amount >= 0 ? amount : 0;
              map[productId][variantId][dateLabelFromRow(dateRow)] =
                amount >= 0 ? amount : 0;
            });
          });
        });
      });
    });
    state.sizeStock = map;
    state.qty = {};
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

  function adjustStock(productId, variantId, dateLabel, quantity) {
    var dateKey = normalizeDateKey(dateLabel);
    if (!state.qty[productId]) state.qty[productId] = {};
    if (!state.qty[productId][variantId]) state.qty[productId][variantId] = {};
    state.qty[productId][variantId][dateKey] = quantity;
    state.qty[productId][variantId][dateLabel] = quantity;
  }

  function getMaxQuantity(productId, variantId, dateLabel, product) {
    var stockMap = state.sizeStock[productId];
    if (!stockMap || !stockMap[variantId]) return 9999;
    var dateKey = normalizeDateKey(dateLabel);
    var initial =
      stockMap[variantId][dateKey] != null
        ? stockMap[variantId][dateKey]
        : stockMap[variantId][dateLabel];
    if (initial == null) return 9999;
    var used = 0;
    var dates = Object.keys(stockMap[variantId]);
    dates.sort();
    dates.forEach(function (dk) {
      var q =
        (state.qty[productId] &&
          state.qty[productId][variantId] &&
          state.qty[productId][variantId][dk]) ||
        0;
      if (dk <= dateKey) used += q;
    });
    return Math.max(0, initial - (used - (state.qty[productId][variantId][dateKey] || 0)));
  }

  function getRowTotal(productId, dateLabel) {
    var dateKey = normalizeDateKey(dateLabel);
    var total = 0;
    var byVariant = state.qty[productId] || {};
    Object.keys(byVariant).forEach(function (vid) {
      var q =
        byVariant[vid][dateKey] != null
          ? byVariant[vid][dateKey]
          : byVariant[vid][dateLabel];
      total += q || 0;
    });
    return total;
  }

  function getTotalPerProduct(productId) {
    var byDate = {};
    var byVariant = state.qty[productId] || {};
    Object.keys(byVariant).forEach(function (vid) {
      Object.keys(byVariant[vid]).forEach(function (dk) {
        byDate[dk] = (byDate[dk] || 0) + (byVariant[vid][dk] || 0);
      });
    });
    var total = 0;
    Object.keys(byDate).forEach(function (dk) {
      total += byDate[dk];
    });
    return total;
  }

  global.AicoPreorderStock = {
    setSizeStockFromProducts: setSizeStockFromProducts,
    adjustStock: adjustStock,
    getMaxQuantity: getMaxQuantity,
    getRowTotal: getRowTotal,
    getTotalPerProduct: getTotalPerProduct,
    _state: state,
  };
})(typeof window !== 'undefined' ? window : this);
