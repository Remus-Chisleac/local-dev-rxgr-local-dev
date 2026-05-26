/* Checkout page state + processing-page Pusher listener.
 *
 * Seeds are SSR'd into <script id="aico-checkout-seeds"> as JSON so
 * Liquid never has to splice data into an Alpine `x-data="…"` attribute
 * (which breaks easily on special characters and leaves the whole page
 * dead when the expression fails to parse).
 *
 * Registers Alpine.data('aicoCheckoutPage', …) on `alpine:init`, mirroring
 * the cart store bootstrap in assets/cart.js.
 */
(function () {
  'use strict';

  var routes = (window.__AICO_ROUTES__ && window.__AICO_ROUTES__.checkout) || {};
  var cartRoutes = (window.__AICO_ROUTES__ && window.__AICO_ROUTES__.cart) || {};
  var csrfToken = window.__AICO_CSRF__ || '';
  var cartTranslations = (window.__AICO_T__ && window.__AICO_T__.cart) || {};
  var checkoutTranslations = (window.__AICO_T__ && window.__AICO_T__.checkout) || {};
  var translations = Object.assign({}, cartTranslations, checkoutTranslations);
  var pusherConfig = window.__AICO_PUSHER__ || null;
  var featureFlags = window.__AICO_FLAGS__ || {};

  function isCreditLimitEnforced() {
    return featureFlags.credit_limit_enforcement === true;
  }

  function readCheckoutSeeds() {
    var el = document.getElementById('aico-checkout-seeds');
    if (!el) return {};
    try {
      return JSON.parse(el.textContent || '{}') || {};
    } catch (_) {
      return {};
    }
  }

  function jsonHeaders() {
    var headers = { 'Accept': 'application/json' };
    if (csrfToken) headers['X-CSRF-TOKEN'] = csrfToken;
    return headers;
  }

  function formEncoded(body) {
    var params = new URLSearchParams();
    Object.keys(body).forEach(function (key) {
      var value = body[key];
      if (value !== undefined && value !== null) params.set(key, String(value));
    });
    if (csrfToken) params.set('_token', csrfToken);
    return params;
  }

  function formatMoneyValue(value) {
    var store = window.Alpine && window.Alpine.store('cart');
    if (store) return store.formatMoney(value);
    return Number(value || 0).toFixed(2);
  }

  function buildCheckoutPage(seeds) {
    seeds = seeds || {};
    return {
      billingAddressId: seeds.initialBillingAddressId || 0,
      deliveryAddressId: seeds.initialDeliveryAddressId || 0,
      paymentMethodId: seeds.initialPaymentMethodId || 0,
      creditLimit: seeds.creditLimit || 0,
      shippingBlocked: !!seeds.shippingBlocked,
      paymentMethods: seeds.paymentMethods || [],
      placeOrderLabel: seeds.placeOrderLabel || 'Place order',
      processingLabel: seeds.processingLabel || 'Processing…',

      cart: null,
      shippingAmount: null,
      vatAmount: null,
      creditCardFee: 0,
      termsAccepted: false,
      termsError: false,
      submitting: false,
      submitError: null,
      _pollHandle: null,

      init: function () {
        var self = this;
        return this.refreshCart().then(function () {
          if (self.cart && self.cart.empty) {
            window.location.href = cartRoutes.url || '/cart';
            return;
          }
          if (!self.paymentMethodId && self.paymentMethods.length > 0) {
            self.paymentMethodId = self.paymentMethods[0].id;
            self.onPaymentMethodChange();
          }
          self.applyCreditLimitGuard();
          self._pollHandle = setInterval(function () { self.refreshCart(); }, 1000);
        });
      },

      refreshCart: function () {
        var self = this;
        var url = cartRoutes.jsonUrl || '/cart.js';
        if (self.deliveryAddressId) {
          url += (url.indexOf('?') === -1 ? '?' : '&') + 'delivery_address_id=' + self.deliveryAddressId;
        }
        return fetch(url, { headers: jsonHeaders(), credentials: 'same-origin' })
          .then(function (res) { return res.ok ? res.json() : null; })
          .then(function (body) {
            if (body) self.cart = body;
          })
          .catch(function () { /* keep previous cart */ });
      },

      onDeliveryAddressChange: function () {
        this.refreshCart();
      },

      onPaymentMethodChange: function () {
        var method = this.selectedPaymentMethod;
        if (method && method.is_credit_card) {
          var cartTotal = (this.cart && this.cart.total_price) || 0;
          this.creditCardFee = cartTotal * (method.fee_percentage || 0) / 100;
        } else {
          this.creditCardFee = 0;
        }
      },

      applyCreditLimitGuard: function () {
        if (!isCreditLimitEnforced() || !this.creditLimitExceeded) return;
        if (this.selectedPaymentMethod && this.selectedPaymentMethod.is_credit_card) return;
        var cc = this.paymentMethods.find(function (m) { return m.is_credit_card; });
        if (cc) {
          this.paymentMethodId = cc.id;
          this.onPaymentMethodChange();
        }
      },

      get selectedPaymentMethod() {
        var id = this.paymentMethodId;
        return this.paymentMethods.find(function (m) { return m.id === id; }) || null;
      },

      get creditLimitExceeded() {
        if (!isCreditLimitEnforced() || !this.cart) return false;
        return (this.cart.total_price || 0) > (this.creditLimit || 0);
      },

      get creditCardOptionAvailable() {
        return this.paymentMethods.some(function (m) { return m.is_credit_card; });
      },

      isPaymentMethodAvailable: function (methodId) {
        if (this.shippingBlocked) return false;
        if (!isCreditLimitEnforced() || !this.creditLimitExceeded) return true;
        var method = this.paymentMethods.find(function (m) { return m.id === methodId; });
        return method ? !!method.is_credit_card : false;
      },

      canSubmit: function () {
        if (this.shippingBlocked) return false;
        if (this.submitting) return false;
        if (!this.cart || this.cart.empty) return false;
        if (this.cart.aico_has_invalid_quantity || this.cart.aico_has_invalid_price) return false;
        if (this.cart.aico_status === 'ERROR' || this.cart.aico_status === 'SAVING_LONGER_THAN_EXPECTED') return false;
        if (!this.billingAddressId || !this.deliveryAddressId || !this.paymentMethodId) return false;
        if (!this.termsAccepted) return false;
        if (isCreditLimitEnforced() && this.creditLimitExceeded) {
          var method = this.selectedPaymentMethod;
          if (!method || !method.is_credit_card) return false;
        }
        return true;
      },

      shippingDisplay: function () {
        if (this.shippingAmount === null) {
          return translations.shipping_at_checkout || 'Calculated at checkout';
        }
        return formatMoneyValue(this.shippingAmount);
      },

      vatDisplay: function () {
        if (this.vatAmount === null) return '—';
        return formatMoneyValue(this.vatAmount);
      },

      totalDisplay: function () {
        var subtotal = (this.cart && this.cart.total_price) || 0;
        var shipping = this.shippingAmount || 0;
        var vat = this.vatAmount || 0;
        return subtotal + shipping + vat + (this.creditCardFee || 0);
      },

      formatMoney: function (value) {
        return formatMoneyValue(value);
      },

      submit: function () {
        var self = this;
        this.submitError = null;
        if (!this.termsAccepted) {
          this.termsError = true;
          return;
        }
        this.termsError = false;
        if (!this.canSubmit()) {
          this.submitError = this.errorMessage('missing_fields');
          return;
        }
        this.submitting = true;

        fetch(routes.url || '/checkout', {
          method: 'POST',
          headers: jsonHeaders(),
          credentials: 'same-origin',
          body: formEncoded({
            billing_address_id: this.billingAddressId,
            delivery_address_id: this.deliveryAddressId,
            payment_method_id: this.paymentMethodId,
          }),
        })
          .then(function (res) {
            if (!res.ok) {
              return res.json().catch(function () { return null; }).then(function (body) {
                self.submitError = (body && body.error)
                  ? self.errorMessage(body.error)
                  : (translations.submit_failed || 'Could not submit the order.');
                self.submitting = false;
              });
            }
            return res.json().then(function (data) {
              if (data.hosted_page_url) {
                window.location = data.hosted_page_url;
                return;
              }
              var thankYou = routes.thankYouUrl || '/checkout/thank-you';
              var params = new URLSearchParams();
              if (data.ecommerce_order_number) params.set('order_number', data.ecommerce_order_number);
              if (data.order_id) params.set('order_id', data.order_id);
              var subtotal = (self.cart && self.cart.total_price) || 0;
              if (subtotal) params.set('subtotal', String(subtotal));
              if (self.shippingAmount) params.set('shipping', String(self.shippingAmount));
              if (self.vatAmount) params.set('vat', String(self.vatAmount));
              if (self.creditCardFee) params.set('cc_fee', String(self.creditCardFee));
              var total = self.totalDisplay();
              if (total) params.set('total', String(total));
              var currency = window.__AICO_SHOP__ && window.__AICO_SHOP__.currency;
              if (currency) params.set('currency', currency);
              window.location = thankYou + '?' + params.toString();
            });
          })
          .catch(function () {
            self.submitError = translations.submit_failed || 'Could not submit the order.';
            self.submitting = false;
          });
      },

      errorMessage: function (code) {
        switch (code) {
          case 'missing_fields': return translations.missing_fields || 'Please fill in all required fields.';
          case 'empty_cart': return translations.cart_modified || 'Your cart has changed.';
          case 'unauthorized': return translations.login_required || 'Please sign in to continue.';
          default: return translations.submit_failed || 'Could not submit the order.';
        }
      },
    };
  }

  function buildCheckoutProcessingPage() {
    return {
      elapsed: 0,
      _interval: null,
      _pusher: null,
      _channel: null,

      init: function () {
        var self = this;
        this._interval = setInterval(function () { self.elapsed += 1; }, 1000);

        var query = new URLSearchParams(window.location.search);
        var orderId = query.get('order_id');
        if (!orderId) return;

        if (!pusherConfig || !window.Pusher) {
          this.pollStatus(orderId);
          return;
        }

        try {
          this._pusher = new window.Pusher(pusherConfig.key, {
            cluster: pusherConfig.cluster,
            authEndpoint: pusherConfig.authEndpoint || undefined,
          });
          var channelName = (pusherConfig.appSlug || 'storefront') + '.order_saved.' + orderId;
          this._channel = this._pusher.subscribe(channelName);
          this._channel.bind('AicoShopOrderCreatedEvent', function (data) {
            self.navigateToThankYou(data || {});
          });
        } catch (e) {
          this.pollStatus(orderId);
        }
      },

      navigateToThankYou: function (data) {
        var thankYou = routes.thankYouUrl || '/checkout/thank-you';
        var query = new URLSearchParams(window.location.search);
        if (data.ecommerce_order_number) query.set('order_number', data.ecommerce_order_number);
        window.location = thankYou + '?' + query.toString();
      },

      pollStatus: function (orderId) {
        var self = this;
        var statusUrl = routes.paymentStatusUrl || '/checkout/payment-status';
        var attempts = 0;
        var tick = function () {
          attempts += 1;
          fetch(statusUrl + '?order_id=' + orderId, { headers: jsonHeaders(), credentials: 'same-origin' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (body) {
              if (!body) return;
              var status = body.status || body.payment_status;
              if (status && status !== 'SAVING' && status !== 'paymentPending') {
                self.navigateToThankYou({ ecommerce_order_number: null });
              } else if (attempts < 60) {
                setTimeout(tick, 2000);
              }
            })
            .catch(function () {
              if (attempts < 60) setTimeout(tick, 2000);
            });
        };
        setTimeout(tick, 2000);
      },
    };
  }

  var checkoutRegistered = false;

  function registerCheckoutAlpineComponents() {
    if (checkoutRegistered || typeof window.Alpine === 'undefined') return;
    checkoutRegistered = true;

    Alpine.data('aicoCheckoutPage', function () {
      return buildCheckoutPage(readCheckoutSeeds());
    });

    Alpine.data('aicoCheckoutProcessingPage', function () {
      return buildCheckoutProcessingPage();
    });
  }

  document.addEventListener('alpine:init', registerCheckoutAlpineComponents);
  registerCheckoutAlpineComponents();

  // Legacy entry points — kept for tests / manual invocation.
  window.aicoCheckout = function (seeds) {
    return buildCheckoutPage(seeds || readCheckoutSeeds());
  };
  window.aicoCheckoutProcessing = function () {
    return buildCheckoutProcessingPage();
  };
})();
