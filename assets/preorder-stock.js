/**
 * Preorder stock caps — per-size (variant) pool model.
 *
 * Each shoe size has a single stock pool S, shared across ALL delivery dates:
 *   sum(qty over every date for that variant) <= S.
 * The "remaining" pool for a variant is S - sum(all dates' qty); a single cell's
 * cap is therefore qty(cell) + remaining = S - sum(OTHER dates' qty). Reducing
 * any date's qty frees the pool again on every date. This replaces the old
 * cross-date "spillover" accumulation, which was buggy.
 *
 * Committed floors: a reopened/submitted cart carries a committed_quantity per
 * line (the add-only floor). A cell can never drop below its committed floor;
 * its decrement is disabled there and `min` is set to it.
 */
(function (global) {
  'use strict';

  var MAX_QUANTITY = 10000;

  var state = {
    // sizeStock[productId][variantId] = S (single pool across dates)
    sizeStock: {},
    // qty[productId][variantId][dateKey] = current quantity in that cell
    qty: {},
    // committed[productId][variantId][dateKey] = add-only floor (>0 only)
    committed: {},
  };

  function idKey(id) {
    return id == null ? '' : String(id);
  }

  // Cells are always addressed by the catalog's human date label (e.g.
  // "Aug 10, 2026"); the page maps server ISO dates to that same label before
  // seeding, so a plain trimmed string is a stable, timezone-safe key.
  function dateKey(dateLabel) {
    return String(dateLabel == null ? '' : dateLabel).trim();
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

  // Build the per-variant pool from each product's preorderStockData. The
  // payload lists an available amount per (date, warehouse, variant); the cap is
  // per size, so we collapse to ONE pool per variant by taking the max available
  // amount seen across dates/warehouses (they are the same warehouse figure in
  // practice; max is the safe choice if they ever differ).
  function setSizeStockFromProducts(productGroups) {
    asArray(productGroups).forEach(function (group) {
      asArray(group && group.items).forEach(function (product) {
        var pid = idKey(product.id);
        if (!pid) return;
        if (!state.sizeStock[pid]) state.sizeStock[pid] = {};
        asArray(product.preorderStockData).forEach(function (dateRow) {
          warehouseDataList(dateRow.data).forEach(function (dataRow) {
            stocksList(dataRow.stocks).forEach(function (stock) {
              var vid = idKey(stock.variantId || stock.variant_id);
              if (!vid) return;
              var amount = stock.overallAvailableAmount;
              amount = amount >= 0 ? Math.floor(amount) : 0;
              if (
                state.sizeStock[pid][vid] == null ||
                amount > state.sizeStock[pid][vid]
              ) {
                state.sizeStock[pid][vid] = amount;
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

  function poolFor(pid, vid) {
    var byProduct = state.sizeStock[pid];
    if (!byProduct || byProduct[vid] == null) return null; // unknown => unlimited
    return byProduct[vid];
  }

  function usedFor(pid, vid) {
    var byVariant = state.qty[pid] && state.qty[pid][vid];
    if (!byVariant) return 0;
    var total = 0;
    Object.keys(byVariant).forEach(function (dk) {
      total += byVariant[dk] || 0;
    });
    return total;
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

  // The most this single cell could hold = S - sum(other dates' qty for the
  // variant). Returns MAX_QUANTITY when the variant has no known pool.
  function capForCell(productId, variantId, dateLabel) {
    var pid = idKey(productId);
    var vid = idKey(variantId);
    var S = poolFor(pid, vid);
    if (S == null) return MAX_QUANTITY;
    var usedOthers = usedFor(pid, vid) - getQuantity(productId, variantId, dateLabel);
    return Math.max(0, S - usedOthers);
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
  //  - boxDisabled: empty cell with no remaining pool -> full gray box.
  //  - incrementDisabled: pool exhausted -> can't add more on this (or any) date.
  //  - decrementDisabled: at/below the committed floor (0 for new cells).
  //  - committedStyle: value equals a committed floor and hasn't been raised ->
  //    gray placeholder, no border (2.2). Raising it flips to `filled` (blue).
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
    var S = poolFor(pid, vid);
    if (S == null) return base; // unknown pool => treat as unlimited

    var remaining = S - usedFor(pid, vid); // pool left across all dates
    base.remaining = remaining;
    base.max = qty + Math.max(0, remaining); // == S - sum(other dates)
    base.boxDisabled = qty <= 0 && remaining <= 0;
    base.incrementDisabled = remaining <= 0;
    return base;
  }

  // Clamp a raw value for a cell to [floor, cap].
  //  - upper bound = capForCell (only when stock is relevant);
  //  - lower bound = committed floor, but only when enforceFloor is set
  //    (used on commit/blur, not on every keystroke, so typing stays free).
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
  // state). A cell that already has a qty stays enabled even when the pool is
  // exhausted — only its increment is then disabled (see getCellState).
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
      total += usedFor(pid, vid);
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
