/**
 * Preorder stock caps — per-date stock with upward "rolling".
 *
 * Each shoe size (variant) has its OWN stock per delivery date. Unused stock of
 * an EARLIER date rolls up to LATER dates, so for dates sorted chronologically
 * the available pool at date i is the cumulative own-stock up to i minus the
 * cumulative quantity entered up to i:
 *
 *     remaining[i] = (Σ ownStock[0..i]) − (Σ qty[0..i])
 *
 * Example — own stock 5 / 10 / 15 for date0 / date1 / date2:
 *     remaining (nothing entered) = 5 / 15 / 30
 *     enter 2 on date0            → 3 / 13 / 28
 *     then enter 13 on date1      → 3 / 0  / 15
 * A later date's quantity never affects an earlier date; an earlier date's
 * quantity reduces every later date's pool.
 *
 * The most a single cell can hold (its input cap) is bounded by EVERY date from
 * it onward (raising it must not push any later date's remaining below 0):
 *
 *     cap[i] = qty[i] + min( remaining[j] for all j ≥ i )
 *
 * Committed floors: a reopened/submitted cart carries a committed_quantity per
 * line (the add-only floor). A cell can never drop below its committed floor.
 */
(function (global) {
  'use strict';

  var MAX_QUANTITY = 10000;

  var state = {
    // stockByDate[productId][variantId][dateKey] = own stock for that date
    stockByDate: {},
    // productDates[productId] = { dateKey: true } — every date the product offers
    productDates: {},
    // dateTs[dateKey] = epoch ms, so dates sort chronologically
    dateTs: {},
    // qty[productId][variantId][dateKey] = current quantity in that cell
    qty: {},
    // committed[productId][variantId][dateKey] = add-only floor (>0 only)
    committed: {},
  };

  function idKey(id) {
    return id == null ? '' : String(id);
  }

  // Cells are addressed by the catalog's human date label (e.g. "Aug 10, 2026");
  // the stock data's raw date is normalised to the SAME label below so a plain
  // trimmed string is a stable, timezone-safe key shared by stock and quantities.
  function dateKey(dateLabel) {
    return String(dateLabel == null ? '' : dateLabel).trim();
  }

  // Match the catalog's date label exactly (extractDatesFromProducts) so the
  // stock keys line up with the rendered cells' data-date.
  function dateLabelFromRaw(rawDate) {
    try {
      var parsed = new Date(rawDate);
      if (isNaN(parsed.getTime())) return null;
      return {
        label: parsed.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
        ts: parsed.getTime(),
      };
    } catch (_) {
      return null;
    }
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

  // Build the per-(variant, date) own stock from each product's
  // preorderStockData. The payload lists an available amount per
  // (date, warehouse, variant); we keep it per date (not collapsed to a pool)
  // and take the max across warehouses for the same (variant, date).
  function setSizeStockFromProducts(productGroups) {
    asArray(productGroups).forEach(function (group) {
      asArray(group && group.items).forEach(function (product) {
        var pid = idKey(product.id);
        if (!pid) return;
        if (!state.stockByDate[pid]) state.stockByDate[pid] = {};
        if (!state.productDates[pid]) state.productDates[pid] = {};
        asArray(product.preorderStockData).forEach(function (dateRow) {
          var info = dateLabelFromRaw(dateRow.date);
          if (!info) return;
          var dk = info.label;
          state.productDates[pid][dk] = true;
          state.dateTs[dk] = info.ts;
          warehouseDataList(dateRow.data).forEach(function (dataRow) {
            stocksList(dataRow.stocks).forEach(function (stock) {
              var vid = idKey(stock.variantId || stock.variant_id);
              if (!vid) return;
              var amount = stock.overallAvailableAmount;
              amount = amount >= 0 ? Math.floor(amount) : 0;
              if (!state.stockByDate[pid][vid]) state.stockByDate[pid][vid] = {};
              var existing = state.stockByDate[pid][vid][dk];
              if (existing == null || amount > existing) {
                state.stockByDate[pid][vid][dk] = amount;
              }
            });
          });
        });
      });
    });
    // Quantities + committed floors are re-seeded from the cart right after this
    // (onProductsLoaded), so clear them to avoid double counting on re-load.
    state.qty = {};
    state.committed = {};
  }

  function hasStock(pid, vid) {
    return !!(state.stockByDate[pid] && state.stockByDate[pid][vid]);
  }

  function getQuantity(productId, variantId, dateLabel) {
    var pid = idKey(productId);
    var vid = idKey(variantId);
    var dk = dateKey(dateLabel);
    if (state.qty[pid] && state.qty[pid][vid] && state.qty[pid][vid][dk] != null) {
      return state.qty[pid][vid][dk];
    }
    return 0;
  }

  function getCommitted(productId, variantId, dateLabel) {
    var pid = idKey(productId);
    var vid = idKey(variantId);
    var dk = dateKey(dateLabel);
    if (
      state.committed[pid] &&
      state.committed[pid][vid] &&
      state.committed[pid][vid][dk] != null
    ) {
      return state.committed[pid][vid][dk];
    }
    return 0;
  }

  // Chronologically-ordered rows for a variant with the rolling pool maths.
  // Returns null when the variant has no known stock (treated as unlimited).
  // Each row: { dateKey, ownStock, qty, remaining, suffixMinRemaining }.
  function variantRows(pid, vid) {
    if (!hasStock(pid, vid)) return null;
    var stock = state.stockByDate[pid][vid];
    var qtys = (state.qty[pid] && state.qty[pid][vid]) || {};
    // Every date the product offers (a zero-own-stock date still receives rolled
    // stock from earlier dates, so it must take part in the cumulative maths).
    var dateSet = {};
    Object.keys(state.productDates[pid] || {}).forEach(function (dk) { dateSet[dk] = true; });
    Object.keys(stock).forEach(function (dk) { dateSet[dk] = true; });
    var keys = Object.keys(dateSet).sort(function (a, b) {
      return (state.dateTs[a] || 0) - (state.dateTs[b] || 0);
    });

    var rows = [];
    var cumStock = 0;
    var cumQty = 0;
    keys.forEach(function (dk) {
      cumStock += stock[dk] != null ? stock[dk] : 0;
      cumQty += qtys[dk] || 0;
      rows.push({
        dateKey: dk,
        ownStock: stock[dk] != null ? stock[dk] : 0,
        qty: qtys[dk] || 0,
        remaining: cumStock - cumQty,
      });
    });
    // Suffix-min of remaining: the cap on raising any one date is bounded by it
    // and every later date.
    var suffixMin = Infinity;
    for (var i = rows.length - 1; i >= 0; i--) {
      suffixMin = Math.min(suffixMin, rows[i].remaining);
      rows[i].suffixMinRemaining = suffixMin;
    }
    return rows;
  }

  function rowFor(pid, vid, dk) {
    var rows = variantRows(pid, vid);
    if (!rows) return null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].dateKey === dk) return rows[i];
    }
    return null;
  }

  // The most this single cell can hold: qty[i] + min(remaining[j], j ≥ i).
  // MAX_QUANTITY when the variant has no known stock.
  function capForCell(productId, variantId, dateLabel) {
    var pid = idKey(productId);
    var vid = idKey(variantId);
    if (!hasStock(pid, vid)) return MAX_QUANTITY;
    var row = rowFor(pid, vid, dateKey(dateLabel));
    if (!row) return MAX_QUANTITY;
    return Math.max(0, row.qty + row.suffixMinRemaining);
  }

  function setQuantity(productId, variantId, dateLabel, quantity) {
    var pid = idKey(productId);
    var vid = idKey(variantId);
    var dk = dateKey(dateLabel);
    if (!pid || !vid || !dk) return;
    var q = quantity == null ? 0 : Math.floor(Number(quantity));
    if (isNaN(q) || q < 0) q = 0;
    if (q > MAX_QUANTITY) q = MAX_QUANTITY;
    if (!state.qty[pid]) state.qty[pid] = {};
    if (!state.qty[pid][vid]) state.qty[pid][vid] = {};
    state.qty[pid][vid][dk] = q;
  }

  // Backwards-compatible name used by the catalog/page: set a cell's absolute qty.
  function adjustStock(productId, variantId, dateLabel, inputQuantity) {
    setQuantity(productId, variantId, dateLabel, inputQuantity);
  }

  function setCommitted(productId, variantId, dateLabel, committedQuantity) {
    var pid = idKey(productId);
    var vid = idKey(variantId);
    var dk = dateKey(dateLabel);
    if (!pid || !vid || !dk) return;
    var c = committedQuantity == null ? 0 : Math.floor(Number(committedQuantity));
    if (isNaN(c) || c < 0) c = 0;
    if (!state.committed[pid]) state.committed[pid] = {};
    if (!state.committed[pid][vid]) state.committed[pid][vid] = {};
    state.committed[pid][vid][dk] = c;
  }

  // One call describes everything the UI needs to paint a cell.
  //  - max: the cell's input cap (rolling cumulative bound).
  //  - remaining: cumulative stock − cumulative qty up to this date (display).
  //  - boxDisabled: empty cell whose cap is 0 -> full gray box.
  //  - incrementDisabled: cap reached for this date -> can't add more.
  //  - decrementDisabled: at/below the committed floor (0 for new cells).
  //  - committedStyle: value equals a committed floor and hasn't been raised ->
  //    gray placeholder, bordered (locked minimum). Raising it flips to `filled`.
  function getCellState(productId, variantId, dateLabel, isStockRelevant) {
    var qty = getQuantity(productId, variantId, dateLabel);
    var committed = getCommitted(productId, variantId, dateLabel);
    var committedStyle = committed > 0 && qty === committed;
    var base = {
      qty: qty,
      committed: committed,
      max: MAX_QUANTITY,
      remaining: Infinity,
      boxDisabled: false,
      incrementDisabled: false,
      decrementDisabled: qty <= committed,
      committedStyle: committedStyle,
      filled: qty > 0 && !committedStyle,
    };
    if (!isStockRelevant) return base;

    var pid = idKey(productId);
    var vid = idKey(variantId);
    if (!hasStock(pid, vid)) return base; // unknown stock => unlimited
    var row = rowFor(pid, vid, dateKey(dateLabel));
    if (!row) return base;

    var cap = Math.max(0, row.qty + row.suffixMinRemaining);
    base.max = cap;
    base.remaining = row.remaining;
    base.boxDisabled = qty <= 0 && cap <= 0;
    base.incrementDisabled = cap <= qty;
    return base;
  }

  // Clamp a raw value for a cell to [floor, cap].
  //  - upper bound = capForCell (only when stock is relevant);
  //  - lower bound = committed floor, but only when enforceFloor is set.
  function clampCell(productId, variantId, dateLabel, raw, isStockRelevant, enforceFloor) {
    var n = Math.floor(Number(raw));
    if (isNaN(n) || n < 0) n = 0;
    if (isStockRelevant) {
      var cap = capForCell(productId, variantId, dateLabel);
      if (n > cap) n = cap;
    }
    if (enforceFloor) {
      var floor = getCommitted(productId, variantId, dateLabel);
      if (n < floor) n = floor;
    }
    if (n > MAX_QUANTITY) n = MAX_QUANTITY;
    return Math.max(0, n);
  }

  // Legacy signature kept for safety; clamps to a passed max only.
  function clampQuantity(quantity, max, isStockRelevant) {
    var n = Math.floor(Number(quantity));
    if (isNaN(n) || n < 0) n = 0;
    if (isStockRelevant && max != null && !isNaN(max) && n > max) n = max;
    return Math.max(0, Math.min(MAX_QUANTITY, n));
  }

  function getMaxQuantity(productId, variantId, dateLabel) {
    return capForCell(productId, variantId, dateLabel);
  }

  function getAvailableQuantity(productId, variantId, dateLabel) {
    return capForCell(productId, variantId, dateLabel);
  }

  // True when the whole box is interactable (not the full-gray empty+exhausted
  // state). A cell that already has a qty stays enabled even when its cap is
  // reached — only its increment is then disabled (see getCellState).
  function isCellEnabled(productId, variantId, dateLabel, isStockRelevant) {
    if (!isStockRelevant) return true;
    return !getCellState(productId, variantId, dateLabel, true).boxDisabled;
  }

  function getRowTotal(productId, dateLabel) {
    var pid = idKey(productId);
    var dk = dateKey(dateLabel);
    var byVariant = state.qty[pid];
    if (!byVariant) return 0;
    var total = 0;
    Object.keys(byVariant).forEach(function (vid) {
      total += byVariant[vid][dk] || 0;
    });
    return total;
  }

  function getTotalPerProduct(productId) {
    var pid = idKey(productId);
    var byVariant = state.qty[pid];
    if (!byVariant) return 0;
    var total = 0;
    Object.keys(byVariant).forEach(function (vid) {
      var byDate = byVariant[vid];
      Object.keys(byDate).forEach(function (dk) {
        total += byDate[dk] || 0;
      });
    });
    return total;
  }

  global.AicoPreorderStock = {
    MAX_QUANTITY: MAX_QUANTITY,
    setSizeStockFromProducts: setSizeStockFromProducts,
    adjustStock: adjustStock,
    setCommitted: setCommitted,
    getCommitted: getCommitted,
    getCellState: getCellState,
    clampCell: clampCell,
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
