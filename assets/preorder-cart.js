/**
 * Preorder cart state + auto-save against the version-guarded backend.
 *
 * Backend contract (snake_case snapshot from PreorderCartLoader::toArray):
 *   { id, version, status (DRAFT|SUBMITTED|ERROR|CLOSED), notes, empty,
 *     list_count, item_count, total_quantity,
 *     item_lists: [ { id, preorder_date, list_type (PRODUCT|FLYER), item_count,
 *                     total_quantity,
 *                     items: [ {id, product_id, variant_id, quantity, is_valid,
 *                               committed_quantity} ] } ] }
 *
 * There are NO prices in the snapshot — checkout totals are computed client-side
 * from the catalog (see preorder-page.js).
 *
 * Writes are auto-saved (no "Save Cart" button): quantity changes are coalesced
 * over a short window and POSTed as ONE batched add.js (Shopify's `items[]`
 * shape) carrying the absolute quantity of every cell that moved; line removals
 * by id still go to change.js. All writes are
 * serialized through a single promise chain so the client never races its own
 * optimistic version: each write reads `this.version` only after the previous
 * one has settled and updated it. A 409 (version_conflict) refetches the fresh
 * version and retries the write once; a 422 (committed_quantity) re-syncs from
 * the returned cart and flags the floored line.
 */
(function (global) {
  'use strict';

  var FLYER_MAX = 3;

  // Coalescing window for product-cell writes. Quiet time after the last edit
  // before the batch goes out — long enough to swallow a tab-and-type burst
  // across a size row, short enough that a single edit still saves as the
  // shopper moves on.
  var CELL_FLUSH_IDLE_MS = 150;
  // Hard ceiling measured from the FIRST pending edit, so continuous editing
  // still saves on a steady cadence instead of being pushed out indefinitely.
  var CELL_FLUSH_MAX_MS = 600;

  function csrfToken() {
    return (
      (typeof global.__AICO_CSRF__ === 'string' && global.__AICO_CSRF__) ||
      (document.querySelector('meta[name="csrf-token"]') || {}).content ||
      (document.querySelector('[data-aico-preorder] input[name="_token"]') || {}).value ||
      ''
    );
  }

  function uuid() {
    try {
      if (global.crypto && typeof global.crypto.randomUUID === 'function') {
        return global.crypto.randomUUID();
      }
    } catch (_) {}
    return 'idem-' + new Date().getTime() + '-' + Math.floor(Math.random() * 1e9);
  }

  function sameDate(a, b) {
    try {
      return new Date(a).toDateString() === new Date(b).toDateString();
    } catch (_) {
      return String(a) === String(b);
    }
  }

  /**
   * Map the snake_case server snapshot to the camelCase "localCart" shape the
   * catalog fallback (getCartState) and the reload-seeding code already expect.
   */
  function snapshotToLocalCart(snapshot) {
    if (!snapshot) {
      return { shoppingCartId: null, preorderItemLists: [], flyers: { id: null, preorderItems: [] } };
    }
    var lists = [];
    var flyers = { id: null, preorderDate: null, preorderItems: [] };
    (snapshot.item_lists || []).forEach(function (list) {
      var items = (list.items || []).map(function (item) {
        return {
          id: item.id,
          productId: item.product_id,
          productVariantId: item.variant_id,
          quantity: item.quantity,
          committedQuantity: item.committed_quantity,
          isValid: item.is_valid,
        };
      });
      if (String(list.list_type).toUpperCase() === 'FLYER') {
        flyers = { id: list.id, preorderDate: list.preorder_date, preorderItems: items };
      } else {
        lists.push({ id: list.id, preorderDate: list.preorder_date, preorderItems: items });
      }
    });
    return {
      shoppingCartId: snapshot.id || null,
      preorderItemLists: lists,
      flyers: flyers,
    };
  }

  function CartController(config) {
    this.cartUrl = config.cartUrl;
    this.addUrl = config.addUrl;
    this.changeUrl = config.changeUrl;
    this.clearUrl = config.clearUrl;
    this.submitUrl = config.submitUrl;
    this.getDeliveryAddressId = config.getDeliveryAddressId || function () { return null; };
    this.getDebtorId = config.getDebtorId || function () { return null; };
    this.getPreorderSessionId = config.getPreorderSessionId || function () { return null; };
    this.onCartUpdated = config.onCartUpdated || function () {};
    this.onDirtyChange = config.onDirtyChange || function () {};
    this.onError = config.onError || function () {};
    // Called after a product-cell write settles with the server's authoritative
    // quantity for that cell, so the optimistic grid can correct a clamped value
    // without pulling the full cart. Args: (cell, quantity).
    this.onProductCellSaved = config.onProductCellSaved || function () {};
    // When true, writes ask the server for a slim response
    // ({id,version,status,quantity}) instead of the full cart; the client trusts
    // the echoed per-cell quantity rather than reconciling via cart.js. Enabled
    // only for the optimistic (stock-relevant) flow.
    this.slimWrites = config.slimWrites || function () { return false; };

    this.version = 0;
    this.cartId = null;
    this.status = null;
    this.snapshot = null;
    this.localCart = snapshotToLocalCart(null);

    // serialization + coalescing
    this.saving = false;
    this._writeChain = Promise.resolve();
    this._pendingWrites = 0;
    // latest desired quantity per product/variant/date cell (absolute), waiting
    // out the coalescing window; flushed together as one batched write
    this._pendingCells = {};
    this._flushTimer = null;
    this._flushDeadline = 0;
  }

  CartController.prototype._cellKey = function (productId, variantId, dateLabel) {
    return [productId, variantId, dateLabel].join('|');
  };

  CartController.prototype._applySnapshot = function (snapshot) {
    if (!snapshot) return;
    this.snapshot = snapshot;
    if (typeof snapshot.version === 'number') this.version = snapshot.version;
    if (snapshot.id) this.cartId = snapshot.id;
    this.status = snapshot.status || this.status;
    // A slim write response carries no item_lists — adopt only the version/status
    // and keep the existing localCart (the optimistic grid is the source of truth
    // until the next full cart.js fetch).
    if (Array.isArray(snapshot.item_lists)) {
      this.localCart = snapshotToLocalCart(snapshot);
    }
    this.onCartUpdated(this.snapshot, this.localCart);
  };

  CartController.prototype._setSaving = function (saving) {
    if (this.saving === saving) return;
    this.saving = saving;
    this.onDirtyChange(saving);
  };

  /**
   * True while the client still has optimistic work the server hasn't caught up
   * to: an in-flight write, a queued write, or a debounced/pending cell. While
   * this is true the UI must stay optimistic and NOT reconcile from a (stale)
   * server snapshot, or it would revert the user's latest edit.
   */
  CartController.prototype.hasPendingWork = function () {
    if (this._pendingWrites > 0) return true;
    if (this._flushTimer) return true;
    var k;
    for (k in this._pendingCells) {
      if (this._pendingCells.hasOwnProperty(k)) return true;
    }
    return false;
  };

  CartController.prototype._post = function (url, body) {
    return fetch(new URL(url, window.location.origin).toString(), {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-TOKEN': csrfToken(),
      },
      body: JSON.stringify(body),
    });
  };

  /** Common request body fields every write needs. */
  CartController.prototype._scope = function () {
    return {
      delivery_address_id: this.getDeliveryAddressId(),
      debtor_id: this.getDebtorId(),
    };
  };

  CartController.prototype.fetchCart = function () {
    var self = this;
    var url = new URL(this.cartUrl, window.location.origin);
    var delivery = this.getDeliveryAddressId();
    var debtor = this.getDebtorId();
    if (delivery) url.searchParams.set('delivery_address_id', String(delivery));
    if (debtor) url.searchParams.set('debtor_id', String(debtor));

    return fetch(url.toString(), {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then(function (res) {
        if (!res.ok) throw new Error('cart_failed');
        return res.json();
      })
      .then(function (snapshot) {
        self._applySnapshot(snapshot);
        return snapshot;
      });
  };

  /** Append work onto the serialized write chain; track saving state. */
  CartController.prototype._enqueue = function (work) {
    var self = this;
    this._pendingWrites += 1;
    this._setSaving(true);
    var run = function () {
      return Promise.resolve()
        .then(work)
        .catch(function (err) {
          self.onError('write_failed', err);
        })
        .then(function () {
          self._pendingWrites -= 1;
          if (self._pendingWrites <= 0) {
            self._pendingWrites = 0;
            self._setSaving(false);
          }
        });
    };
    this._writeChain = this._writeChain.then(run, run);
    return this._writeChain;
  };

  /**
   * Handle a write response. 200 -> apply snapshot. 409 -> adopt fresh version
   * and retry the write once. 422 (committed_quantity) -> re-sync + flag.
   */
  CartController.prototype._handleWrite = function (res, retry) {
    var self = this;
    if (res.ok) {
      return res.json().then(function (snapshot) {
        self._applySnapshot(snapshot);
        return snapshot;
      });
    }
    return res.json().then(function (payload) {
      if (res.status === 409 && payload && payload.error === 'version_conflict') {
        if (payload.cart) self._applySnapshot(payload.cart);
        else if (typeof payload.current_version === 'number') self.version = payload.current_version;
        if (retry) return retry();
        return null;
      }
      if (res.status === 422 && payload && payload.error === 'committed_quantity') {
        if (payload.cart) self._applySnapshot(payload.cart);
        self.onError('committed_quantity', payload);
        return null;
      }
      if (payload && payload.cart) self._applySnapshot(payload.cart);
      self.onError(payload && payload.error ? payload.error : 'write_failed', payload);
      return null;
    });
  };

  /**
   * Auto-save a product quantity change. `quantity` is absolute.
   *
   * Edits are COALESCED, not debounced per cell: the newest value for each cell
   * is held, and one batched add.js goes out once the shopper pauses. Filling a
   * size row by tab-and-type produced one request per cell before this — a dozen
   * round-trips for what is a single intent — and each of those requests pays the
   * whole shopper/shop/cart resolution again. The batch is applied server-side in
   * one transaction (see StorefrontPreorderCartService::setItems).
   */
  CartController.prototype.updateQuantity = function (productId, variantId, dateLabel, quantity, product) {
    var key = this._cellKey(productId, variantId, dateLabel);
    this._pendingCells[key] = {
      productId: productId,
      variantId: variantId,
      dateLabel: dateLabel,
      quantity: quantity,
    };
    this._scheduleFlush();
  };

  /**
   * Arm (or re-arm) the coalescing window. Each new edit pushes the flush out by
   * CELL_FLUSH_IDLE_MS, but never past CELL_FLUSH_MAX_MS from the first pending
   * edit — otherwise sustained typing would keep resetting the timer and nothing
   * would ever be saved while the shopper works.
   */
  CartController.prototype._scheduleFlush = function () {
    var self = this;
    var now = new Date().getTime();
    if (!this._flushDeadline) this._flushDeadline = now + CELL_FLUSH_MAX_MS;
    if (this._flushTimer) clearTimeout(this._flushTimer);
    var wait = Math.max(0, Math.min(CELL_FLUSH_IDLE_MS, this._flushDeadline - now));
    this._flushTimer = setTimeout(function () {
      self.flushPendingCells();
    }, wait);
  };

  /**
   * Send every pending cell as ONE write, now. Called by the coalescing timer
   * and directly before a submit, so a value the shopper typed a moment earlier
   * can never be left sitting in the window.
   */
  CartController.prototype.flushPendingCells = function () {
    var self = this;
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    this._flushDeadline = 0;
    var cells = [];
    var key;
    for (key in this._pendingCells) {
      if (this._pendingCells.hasOwnProperty(key)) cells.push(this._pendingCells[key]);
    }
    this._pendingCells = {};
    if (!cells.length) return;
    this._enqueue(function () {
      return self._saveProductCells(cells);
    });
  };

  CartController.prototype._cellBody = function (cell) {
    return {
      product_id: cell.productId,
      variant_id: cell.variantId || null,
      quantity: cell.quantity,
      preorder_date: cell.dateLabel,
      list_type: 'PRODUCT',
    };
  };

  CartController.prototype._saveProductCells = function (cells, isRetry) {
    var self = this;
    // A single cell keeps the flat, top-level body — the shape every backend
    // understands. Only a real batch uses Shopify's `items[]` form, which needs
    // a backend that reads it. That way a theme deployed ahead of its backend
    // still saves ordinary edits, and only a rapid multi-cell burst fails
    // loudly (422) instead of silently writing one cell out of ten.
    var body = Object.assign(
      cells.length === 1
        ? this._cellBody(cells[0])
        : { items: cells.map(this._cellBody, this) },
      {
        version: this.version,
        slim: this.slimWrites() ? 1 : 0,
      },
      this._scope(),
    );
    return this._post(this.addUrl, body).then(function (res) {
      return self._handleWrite(res, isRetry ? null : function () {
        return self._saveProductCells(cells, true);
      });
    }).then(function (snapshot) {
      // Adopt the server's authoritative quantity for a single-cell write
      // (handles a server-side clamp), unless the user has already queued a
      // newer edit for that cell — then the optimistic value wins until that
      // write settles. Batched writes carry no per-cell echo; they reconcile
      // through the idle cart.js fetch like every other multi-line change.
      if (cells.length !== 1) return;
      if (!snapshot || typeof snapshot.quantity !== 'number') return;
      var cell = cells[0];
      var key = self._cellKey(cell.productId, cell.variantId, cell.dateLabel);
      if (self._pendingCells[key]) return;
      self.onProductCellSaved(cell, snapshot.quantity);
    });
  };

  CartController.prototype.getFlyerQuantity = function (flyerId) {
    var items = (this.localCart && this.localCart.flyers && this.localCart.flyers.preorderItems) || [];
    var rows = items.filter(function (it) {
      return it.productId === flyerId;
    });
    if (!rows.length) return 0;
    // Mirror the backend's deterministic flyer-line target (setItem's FLYER
    // match): the committed row first, then a row with a server-resolved
    // variant, then the first. Duplicate rows for one flyer are a legacy fork
    // (variant-null write next to the committed variant row) that the next
    // write absorbs — never first-match blindly, or the slider snaps back to
    // the stray row's quantity.
    var item =
      rows.find(function (it) {
        return it.committedQuantity != null;
      }) ||
      rows.find(function (it) {
        return it.productVariantId != null;
      }) ||
      rows[0];
    return item.quantity || 0;
  };

  /** Auto-save a flyer quantity (FLYER list; server derives the date). */
  CartController.prototype.updateFlyerQuantity = function (flyerId, quantity) {
    var self = this;
    quantity = Math.max(0, Math.min(FLYER_MAX, Math.floor(quantity) || 0));
    return this._enqueue(function () {
      return self._saveFlyerCell(flyerId, quantity);
    });
  };

  CartController.prototype._saveFlyerCell = function (flyerId, quantity, isRetry) {
    var self = this;
    var body = Object.assign(
      {
        product_id: flyerId,
        variant_id: null,
        quantity: quantity,
        list_type: 'FLYER',
        version: this.version,
      },
      this._scope(),
    );
    return this._post(this.addUrl, body).then(function (res) {
      return self._handleWrite(res, isRetry ? null : function () {
        return self._saveFlyerCell(flyerId, quantity, true);
      });
    });
  };

  /** Remove every line (keeps the cart). */
  CartController.prototype.clearCart = function () {
    var self = this;
    return this._enqueue(function () {
      var body = Object.assign({ version: self.version }, self._scope());
      return self._post(self.clearUrl, body).then(function (res) {
        return self._handleWrite(res, null);
      });
    });
  };

  /**
   * Place the preorder: flush pending writes, POST submit.js. Resolves as soon
   * as the backend has accepted + queued the submission (the heavy work runs
   * async on the queue) — the caller then redirects straight to the thank-you/
   * processing page, which shows the "we are processing your preorder" state
   * and swaps to the final details when PreorderProcessedEvent arrives on the
   * pusher channel (see preorder-confirmation.js). No client-side status
   * polling here: first submits and edit re-submits share that one mechanism.
   * Rejects on synchronous failures (version conflict, ineligibility, 5xx).
   */
  CartController.prototype.submitPreorder = function (notes) {
    var self = this;
    var idempotencyKey = uuid();
    // Send anything still sitting in the coalescing window FIRST — a cell edited
    // a moment before hitting "place preorder" must not be left behind by the
    // very submit it was meant for. flushPendingCells enqueues, so the submit
    // below still lands after it on the write chain.
    this.flushPendingCells();
    // Chain the submit after every queued write so the version is final.
    return this._enqueue(function () {
      var body = Object.assign(
        {
          version: self.version,
          idempotency_key: idempotencyKey,
          notes: notes || '',
        },
        self._scope(),
      );
      return self._post(self.submitUrl, body).then(function (res) {
        if (res.ok) {
          return res.json().then(function (snapshot) {
            self._applySnapshot(snapshot);
          });
        }
        return res.json().then(function (payload) {
          if (payload && payload.cart) self._applySnapshot(payload.cart);
          var err = new Error(payload && payload.error ? payload.error : 'submit_failed');
          err.payload = payload;
          throw err;
        });
      });
    });
  };

  /** Best-effort quantity discount lookup, used by the client-side summary. */
  CartController.prototype.getDiscount = function (discounts, totalQty) {
    if (!discounts || !discounts.length) return 0;
    var applicable = discounts.filter(function (d) {
      var from = d.from_quantity != null ? d.from_quantity : d.fromQuantity;
      return from != null && from <= totalQty;
    });
    if (!applicable.length) return 0;
    return applicable.reduce(function (prev, cur) {
      var val = cur.discount != null ? cur.discount : 0;
      return Math.max(prev, val);
    }, 0);
  };

  global.AicoPreorderCart = {
    CartController: CartController,
    snapshotToLocalCart: snapshotToLocalCart,
    sameDate: sameDate,
  };
})(typeof window !== 'undefined' ? window : this);
