/**
 * Preorder stock caps — port of b2b-shop nSumSlice (sizeStock + adjustStock).
 */
(function (global) {
  'use strict';

  var MAX_QUANTITY = 10000;

  var state = {
    sizeStock: {},
    initialMax: {},
    qty: {},
    remainingQuantity: {},
    totalInputPerDate: {},
    totalPerDate: {},
    totalPerProduct: {},
  };

  function idKey(id) {
    return id == null ? '' : String(id);
  }

  function asArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    return [];
  }

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

  function sortedDateKeys(byVariant) {
    return Object.keys(byVariant || {})
      .filter(function (dk) {
        return /^\d{4}-\d{2}-\d{2}$/.test(dk);
      })
      .sort();
  }

  function mergeSizeStock(payload) {
    Object.keys(payload).forEach(function (productId) {
      if (!state.sizeStock[productId]) {
        state.sizeStock[productId] = payload[productId];
        return;
      }
      Object.keys(payload[productId]).forEach(function (priceableId) {
        if (!state.sizeStock[productId][priceableId]) {
          state.sizeStock[productId][priceableId] = payload[productId][priceableId];
          return;
        }
        Object.keys(payload[productId][priceableId]).forEach(function (date) {
          if (!(date in state.sizeStock[productId][priceableId])) {
            state.sizeStock[productId][priceableId][date] =
              payload[productId][priceableId][date];
          }
        });
      });
    });
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
          warehouseDataList(dateRow.data).forEach(function (dataRow) {
            stocksList(dataRow.stocks).forEach(function (stock) {
              var variantId = idKey(stock.variantId || stock.variant_id);
              if (!variantId) return;
              if (!map[productId][variantId]) map[productId][variantId] = {};
              var amount = stock.overallAvailableAmount;
              map[productId][variantId][dateKey] = amount >= 0 ? amount : 0;
            });
          });
        });
      });
    });
    mergeSizeStock(map);
    state.initialMax = {};
    state.qty = {};
    state.remainingQuantity = {};
    state.totalInputPerDate = {};
    state.totalPerDate = {};
    state.totalPerProduct = {};
  }

  function adjustStock(productId, variantId, dateLabel, inputQuantity) {
    var pid = idKey(productId);
    var priceableId = idKey(variantId);
    var inputDate = normalizeDateKey(dateLabel);
    var quantity = inputQuantity == null ? 0 : Math.floor(Number(inputQuantity)) || 0;

    if (!pid || !priceableId || !inputDate) return;

    if (!state.sizeStock[pid]) state.sizeStock[pid] = {};
    if (!state.sizeStock[pid][priceableId]) state.sizeStock[pid][priceableId] = {};

    var dates = sortedDateKeys(state.sizeStock[pid][priceableId]);

    if (dates.length === 0) {
      if (!state.totalInputPerDate[pid]) state.totalInputPerDate[pid] = {};
      if (!state.totalInputPerDate[pid][inputDate]) state.totalInputPerDate[pid][inputDate] = {};
      if (!state.totalPerDate[pid]) state.totalPerDate[pid] = {};
      if (state.totalPerProduct[pid] == null) state.totalPerProduct[pid] = 0;

      state.totalInputPerDate[pid][inputDate][priceableId] = quantity;

      var totalForDateEmpty = 0;
      Object.keys(state.totalInputPerDate[pid][inputDate]).forEach(function (id) {
        totalForDateEmpty += state.totalInputPerDate[pid][inputDate][id];
      });
      state.totalPerDate[pid][inputDate] = totalForDateEmpty;

      state.totalPerProduct[pid] = 0;
      Object.keys(state.totalPerDate[pid]).forEach(function (date) {
        state.totalPerProduct[pid] += state.totalPerDate[pid][date];
      });
      return;
    }

    if (!state.qty[priceableId]) state.qty[priceableId] = {};

    dates.forEach(function (date) {
      if (!state.initialMax[priceableId]) state.initialMax[priceableId] = {};
      if (state.initialMax[priceableId][date] == null) {
        state.initialMax[priceableId][date] = state.sizeStock[pid][priceableId][date];
      }
      if (state.qty[priceableId][date] == null) state.qty[priceableId][date] = 0;
      if (!state.remainingQuantity[priceableId]) state.remainingQuantity[priceableId] = {};
      if (
        state.remainingQuantity[priceableId][date] == null &&
        state.remainingQuantity[priceableId][date] !== 0
      ) {
        state.remainingQuantity[priceableId][date] = state.initialMax[priceableId][date];
      }
    });

    state.qty[priceableId][inputDate] = quantity;

    if (!state.totalInputPerDate[pid]) state.totalInputPerDate[pid] = {};
    if (!state.totalInputPerDate[pid][inputDate]) state.totalInputPerDate[pid][inputDate] = {};
    if (state.totalInputPerDate[pid][inputDate][priceableId] == null) {
      state.totalInputPerDate[pid][inputDate][priceableId] = 0;
    }
    if (!state.totalPerDate[pid]) state.totalPerDate[pid] = {};
    if (state.totalPerProduct[pid] == null) state.totalPerProduct[pid] = 0;

    state.totalInputPerDate[pid][inputDate][priceableId] = quantity;

    var firstDate = dates[0];
    var prevQty = 0;

    dates.forEach(function (date) {
      if (date > dates[0]) {
        prevQty =
          state.initialMax[priceableId][firstDate] -
          state.remainingQuantity[priceableId][firstDate];
        firstDate = date;
      }

      state.remainingQuantity[priceableId][date] =
        state.initialMax[priceableId][date] -
        state.qty[priceableId][date] -
        prevQty;

      if (state.remainingQuantity[priceableId][date] < 0) {
        state.qty[priceableId][date] += state.remainingQuantity[priceableId][date];

        if (!state.totalInputPerDate[pid][date]) state.totalInputPerDate[pid][date] = {};
        if (state.totalInputPerDate[pid][date][priceableId] == null) {
          state.totalInputPerDate[pid][date][priceableId] = 0;
        }

        state.totalInputPerDate[pid][date][priceableId] +=
          state.remainingQuantity[priceableId][date];
        state.remainingQuantity[priceableId][date] = 0;
      }
    });

    var totalForDate = 0;
    Object.keys(state.totalInputPerDate[pid][inputDate]).forEach(function (id) {
      totalForDate += state.totalInputPerDate[pid][inputDate][id];
    });
    state.totalPerDate[pid][inputDate] = totalForDate;
    state.totalPerProduct[pid] = 0;
    Object.keys(state.totalPerDate[pid]).forEach(function (date) {
      state.totalPerProduct[pid] += state.totalPerDate[pid][date];
    });

    var lastDate = dates[dates.length - 1];
    state.sizeStock[pid][priceableId][lastDate] =
      state.remainingQuantity[priceableId][lastDate] + state.qty[priceableId][lastDate];

    var datesCopy = dates.slice().reverse().slice(1);
    datesCopy.forEach(function (date) {
      var minRemaining = Math.min(
        state.remainingQuantity[priceableId][date],
        state.remainingQuantity[priceableId][lastDate],
      );
      lastDate = date;
      state.remainingQuantity[priceableId][date] = minRemaining;
      state.sizeStock[pid][priceableId][date] =
        state.remainingQuantity[priceableId][date] + state.qty[priceableId][date];
    });
  }

  function clampQuantity(quantity, max, isStockRelevant) {
    var n = Math.floor(Number(quantity));
    if (isNaN(n) || n < 0) n = 0;
    if (isStockRelevant && max != null && !isNaN(max) && n > max) n = max;
    return Math.max(0, Math.min(MAX_QUANTITY, n));
  }

  function getAvailableQuantity(productId, variantId, dateLabel) {
    var pid = idKey(productId);
    var vid = idKey(variantId);
    var dateKey = normalizeDateKey(dateLabel);
    var byProduct = state.sizeStock[pid];
    if (!byProduct || !byProduct[vid]) return MAX_QUANTITY;
    var available = byProduct[vid][dateKey];
    if (available == null) return MAX_QUANTITY;
    return Math.max(0, available);
  }

  function getMaxQuantity(productId, variantId, dateLabel) {
    return getAvailableQuantity(productId, variantId, dateLabel);
  }

  function isCellEnabled(productId, variantId, dateLabel, isStockRelevant) {
    if (!isStockRelevant) return true;
    return getAvailableQuantity(productId, variantId, dateLabel) > 0;
  }

  function getQuantity(productId, variantId, dateLabel) {
    var vid = idKey(variantId);
    var dateKey = normalizeDateKey(dateLabel);
    if (!state.qty[vid]) return 0;
    return state.qty[vid][dateKey] || 0;
  }

  function getRowTotal(productId, dateLabel) {
    var pid = idKey(productId);
    var dateKey = normalizeDateKey(dateLabel);
    if (state.totalPerDate[pid] && state.totalPerDate[pid][dateKey] != null) {
      return state.totalPerDate[pid][dateKey];
    }
    return 0;
  }

  function getTotalPerProduct(productId) {
    var pid = idKey(productId);
    return state.totalPerProduct[pid] || 0;
  }

  global.AicoPreorderStock = {
    MAX_QUANTITY: MAX_QUANTITY,
    setSizeStockFromProducts: setSizeStockFromProducts,
    adjustStock: adjustStock,
    clampQuantity: clampQuantity,
    getQuantity: getQuantity,
    getAvailableQuantity: getAvailableQuantity,
    getMaxQuantity: getMaxQuantity,
    isCellEnabled: isCellEnabled,
    getRowTotal: getRowTotal,
    getTotalPerProduct: getTotalPerProduct,
    _state: state,
  };
})(typeof window !== 'undefined' ? window : this);
