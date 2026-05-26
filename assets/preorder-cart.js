/**
 * Preorder cart state, save, and status polling (b2b-shop parity).
 */
(function (global) {
  'use strict';

  function mapCartToItemList(cart, sessionDates) {
    var lists =
      (cart &&
        cart.preorderItemLists &&
        cart.preorderItemLists.map(function (itemList) {
          return {
            id: itemList.id,
            preorderDate: itemList.preorderDate,
            shouldUpdate: false,
            preorderItems: (itemList.preorderItems || []).map(function (item) {
              return {
                id: item.id,
                quantity: item.quantity,
                itemPrice: item.itemPrice,
                shouldUpdate: false,
                productId: item.product ? item.product.id : item.productId,
                productVariantId: item.productVariant
                  ? item.productVariant.id
                  : item.productVariantId,
                product: item.product,
                productVariant: item.productVariant,
              };
            }),
          };
        })) ||
      [];

    var flyers = {
      id: cart && cart.flyers ? cart.flyers.id : null,
      preorderDate:
        (cart && cart.flyers && cart.flyers.preorderDate) ||
        (sessionDates && sessionDates[0]) ||
        new Date().toISOString(),
      preorderItems: ((cart && cart.flyers && cart.flyers.preorderItems) || []).map(
        function (item) {
          return {
            id: item.id,
            quantity: item.quantity,
            shouldUpdate: false,
            productId: item.product ? item.product.id : item.productId,
            productVariantId: item.productVariant
              ? item.productVariant.id
              : item.productVariantId,
          };
        },
      ),
    };

    return {
      shoppingCartId: (cart && cart.id) || null,
      preorderSessionId: cart && cart.preorderSessionId,
      debtorId: cart && cart.debtorId,
      preorderItemLists: lists,
      flyers: flyers,
      totalPrice: cart && cart.totalPrice,
    };
  }

  function sameDate(a, b) {
    try {
      return new Date(a).toDateString() === new Date(b).toDateString();
    } catch (_) {
      return String(a) === String(b);
    }
  }

  function CartController(config) {
    this.cartUrl = config.cartUrl;
    this.statusUrl = config.statusUrl;
    this.itemsUrl = config.itemsUrl;
    this.submitUrl = config.submitUrl;
    this.getBuyerAddressId = config.getBuyerAddressId;
    this.getBillingAddressId = config.getBillingAddressId;
    this.getDeliveryAddressId = config.getDeliveryAddressId;
    this.getDebtorId = config.getDebtorId;
    this.getPreorderSessionId = config.getPreorderSessionId;
    this.onCartUpdated = config.onCartUpdated || function () {};
    this.onDirtyChange = config.onDirtyChange || function () {};

    this.serverCart = null;
    this.localCart = null;
    this.pollTimer = null;
    this.saving = false;
  }

  CartController.prototype.fetchCart = function () {
    var self = this;
    var url = new URL(this.cartUrl, window.location.origin);
    var buyer = this.getBuyerAddressId();
    var debtor = this.getDebtorId();
    if (buyer) url.searchParams.set('buyer_address_id', String(buyer));
    if (debtor) url.searchParams.set('debtor_id', String(debtor));

    return fetch(url.toString(), {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then(function (res) {
        if (!res.ok) throw new Error('cart_failed');
        return res.json();
      })
      .then(function (json) {
        self.serverCart = json.data || null;
        self.localCart = mapCartToItemList(self.serverCart, []);
        self.onCartUpdated(self.serverCart, self.localCart);
        if (self.serverCart && self.serverCart.id) {
          self.startStatusPoll(self.serverCart.id);
        }
        return self.serverCart;
      });
  };

  CartController.prototype.startStatusPoll = function (cartId) {
    var self = this;
    this.stopStatusPoll();
    var poll = function () {
      var url = new URL(self.statusUrl, window.location.origin);
      url.searchParams.set('cart_id', String(cartId));
      fetch(url.toString(), {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
        .then(function (res) {
          return res.json();
        })
        .then(function (json) {
          var status = json.data && json.data.status;
          if (status === 'SAVING') {
            self.saving = true;
          } else if (status === 'SAVED') {
            self.saving = false;
            self.fetchCart();
          }
        })
        .catch(function () {});
    };
    poll();
    this.pollTimer = setInterval(poll, 3000);
  };

  CartController.prototype.stopStatusPoll = function () {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  };

  CartController.prototype.updateQuantity = function (
    productId,
    variantId,
    dateLabel,
    quantity,
    product,
  ) {
    if (!this.localCart) {
      this.localCart = mapCartToItemList(null, []);
    }
    var list = this.localCart.preorderItemLists.find(function (l) {
      return sameDate(l.preorderDate, dateLabel) || String(l.preorderDate).indexOf(dateLabel) >= 0;
    });
    if (!list) {
      list = {
        id: null,
        preorderDate: dateLabel,
        shouldUpdate: true,
        preorderItems: [],
      };
      this.localCart.preorderItemLists.push(list);
    }
    list.shouldUpdate = true;
    var idx = list.preorderItems.findIndex(function (it) {
      return it.productId === productId && it.productVariantId === variantId;
    });
    if (idx >= 0) {
      list.preorderItems[idx].quantity = quantity;
      list.preorderItems[idx].shouldUpdate = true;
    } else if (quantity > 0) {
      list.preorderItems.push({
        productId: productId,
        productVariantId: variantId,
        quantity: quantity,
        shouldUpdate: true,
        product: product,
      });
    }
    if (global.AicoPreorderStock) {
      global.AicoPreorderStock.adjustStock(productId, variantId, dateLabel, quantity);
    }
    this.onDirtyChange(this.hasDirty());
    this.onCartUpdated(this.serverCart, this.localCart);
  };

  CartController.prototype.hasDirty = function () {
    if (!this.localCart) return false;
    var dirty = this.localCart.preorderItemLists.some(function (list) {
      if (!list.shouldUpdate) return false;
      return list.preorderItems.some(function (it) {
        return it.shouldUpdate;
      });
    });
    return dirty;
  };

  CartController.prototype.filterDirtyPayload = function () {
    return {
      shoppingCartId: this.localCart.shoppingCartId,
      preorderItemLists: this.localCart.preorderItemLists
        .filter(function (l) {
          return l.shouldUpdate;
        })
        .map(function (l) {
          return {
            id: l.id,
            preorderDate: l.preorderDate,
            preorderItems: l.preorderItems.filter(function (it) {
              return it.shouldUpdate;
            }),
          };
        }),
      flyers: this.localCart.flyers,
    };
  };

  CartController.prototype.saveCart = function () {
    var self = this;
    if (!this.itemsUrl || !this.localCart) return Promise.resolve();
    var url = new URL(this.itemsUrl, window.location.origin);
    var debtor = this.getDebtorId();
    if (debtor) url.searchParams.set('debtor_id', String(debtor));

    var body = {
      data: Object.assign(this.filterDirtyPayload(), {
        preorderSessionId: this.getPreorderSessionId(),
        billingAddressId: this.getBillingAddressId(),
        deliveryAddressId: this.getDeliveryAddressId(),
      }),
    };

    return fetch(url.toString(), {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-TOKEN':
          (typeof window.__AICO_CSRF__ === 'string' && window.__AICO_CSRF__) ||
          (document.querySelector('meta[name="csrf-token"]') || {}).content ||
          (document.querySelector('[data-aico-preorder] input[name="_token"]') || {}).value ||
          '',
      },
      body: JSON.stringify(body),
    })
      .then(function (res) {
        if (!res.ok) throw new Error('save_failed');
        return res.json();
      })
      .then(function () {
        self.resetShouldUpdate();
        if (self.serverCart && self.serverCart.id) {
          self.startStatusPoll(self.serverCart.id);
        }
        return self.fetchCart();
      });
  };

  CartController.prototype.resetShouldUpdate = function () {
    if (!this.localCart) return;
    this.localCart.preorderItemLists.forEach(function (list) {
      list.shouldUpdate = false;
      list.preorderItems.forEach(function (it) {
        it.shouldUpdate = false;
      });
    });
    this.onDirtyChange(false);
  };

  CartController.prototype.submitPreorder = function (notes) {
    var self = this;
    var url = new URL(this.submitUrl, window.location.origin);
    var debtor = this.getDebtorId();
    if (debtor) url.searchParams.set('debtor_id', String(debtor));

    var body = {
      data: {
        shoppingCartId: this.localCart && this.localCart.shoppingCartId,
        billingAddressId: this.getBillingAddressId(),
        deliveryAddressId: this.getDeliveryAddressId(),
        notes: notes || '',
      },
    };

    return fetch(url.toString(), {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-TOKEN':
          (typeof window.__AICO_CSRF__ === 'string' && window.__AICO_CSRF__) ||
          (document.querySelector('meta[name="csrf-token"]') || {}).content ||
          (document.querySelector('[data-aico-preorder] input[name="_token"]') || {}).value ||
          '',
      },
      body: JSON.stringify(body),
    }).then(function (res) {
      if (!res.ok) throw new Error('submit_failed');
      return res.json();
    });
  };

  CartController.prototype.getDiscount = function (discounts, totalQty) {
    if (!discounts || !discounts.length) return 0;
    var applicable = discounts.filter(function (d) {
      return d.from_quantity <= totalQty || d.fromQuantity <= totalQty;
    });
    if (!applicable.length) return 0;
    return applicable.reduce(function (prev, cur) {
      var val = cur.discount != null ? cur.discount : 0;
      return Math.max(prev, val);
    }, 0);
  };

  global.AicoPreorderCart = {
    mapCartToItemList: mapCartToItemList,
    CartController: CartController,
  };
})(typeof window !== 'undefined' ? window : this);
