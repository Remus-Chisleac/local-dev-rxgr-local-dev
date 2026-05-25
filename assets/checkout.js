/* Checkout page state + processing-page Pusher listener.
 *
 * The /checkout template binds `x-data="aicoCheckout({...seeds...})"`
 * and `x-init="init()"`. This module:
 *
 *   - Tracks the radio selections (billing, delivery, payment).
 *   - Polls /cart.js every 1s to mirror b2b-shop's `pollingInterval: 1000`
 *     so cart changes from other tabs surface as a banner / disable
 *     the place-order button.
 *   - On delivery-address change, re-fetches /cart.js with the new
 *     address so VAT + shipping recalc.
 *   - Auto-selects credit-card payment when the cart total exceeds the
 *     debtor credit limit (matches b2b-shop Payment.js:22-26).
 *   - Disables non-CC payment options under the same condition.
 *   - On submit, POSTs /checkout. If the response carries a
 *     hosted_page_url (credit-card path), navigates to it; otherwise
 *     redirects to /checkout/thank-you with query params.
 *
 * The processing page binds `x-data="aicoCheckoutProcessing()"` —
 * subscribes to Pusher for the order-created event and redirects
 * to thank-you when it fires.
 */
(function () {
  'use strict';

  var routes = (window.__AICO_ROUTES__ && window.__AICO_ROUTES__.checkout) || {};
  var cartRoutes = (window.__AICO_ROUTES__ && window.__AICO_ROUTES__.cart) || {};
  var csrfToken = window.__AICO_CSRF__ || '';
  var translations = (window.__AICO_T__ && window.__AICO_T__.cart) || {};
  var pusherConfig = window.__AICO_PUSHER__ || null;

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

  window.aicoCheckout = function (seeds) {
    return {
      // SSR-supplied seeds
      billingAddressId: seeds.initialBillingAddressId || 0,
      deliveryAddressId: seeds.initialDeliveryAddressId || 0,
      paymentMethodId: seeds.initialPaymentMethodId || 0,
      creditLimit: seeds.creditLimit || 0,
      shippingBlocked: !!seeds.shippingBlocked,
      paymentMethods: seeds.paymentMethods || [],

      // Live state (refreshed from /cart.js)
      cart: null,
      shippingAmount: null,
      vatAmount: null,
      creditCardFee: 0,
      termsAccepted: false,
      termsError: false,
      submitting: false,
      submitError: null,
      _pollHandle: null,

      async init() {
        await this.refreshCart();
        this.applyCreditLimitGuard();
        // Start the 1s poll to mirror b2b-shop. Stops on unmount via
        // page navigation (Alpine GCs the component automatically).
        var self = this;
        this._pollHandle = setInterval(function () { self.refreshCart(); }, 1000);
      },

      async refreshCart() {
        try {
          var url = cartRoutes.jsonUrl || '/cart.js';
          if (this.deliveryAddressId) {
            url += (url.indexOf('?') === -1 ? '?' : '&') + 'delivery_address_id=' + this.deliveryAddressId;
          }
          var res = await fetch(url, { headers: jsonHeaders(), credentials: 'same-origin' });
          if (!res.ok) return;
          this.cart = await res.json();
        } catch (e) {
          // Keep previous cart state on transient failure.
        }
      },

      onDeliveryAddressChange() {
        this.refreshCart();
        // TODO: when the backend exposes a per-address shipping/VAT
        // endpoint for the storefront surface, fetch those here too
        // and populate shippingAmount + vatAmount. For now we display
        // "calculated at checkout" until the order-submit endpoint
        // returns the final numbers.
      },

      onPaymentMethodChange() {
        var method = this.selectedPaymentMethod;
        if (method && method.is_credit_card) {
          var cartTotal = (this.cart && this.cart.total_price) || 0;
          this.creditCardFee = cartTotal * (method.fee_percentage || 0) / 100;
        } else {
          this.creditCardFee = 0;
        }
      },

      applyCreditLimitGuard() {
        if (!this.creditLimitExceeded) return;
        if (this.selectedPaymentMethod && this.selectedPaymentMethod.is_credit_card) return;
        // Auto-select first credit-card option, mirroring b2b-shop.
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
        if (!this.cart) return false;
        return (this.cart.total_price || 0) > (this.creditLimit || 0);
      },

      get creditCardOptionAvailable() {
        return this.paymentMethods.some(function (m) { return m.is_credit_card; });
      },

      isPaymentMethodAvailable(methodId) {
        if (this.shippingBlocked) return false;
        if (!this.creditLimitExceeded) return true;
        // Above credit limit: only credit-card methods stay available.
        var method = this.paymentMethods.find(function (m) { return m.id === methodId; });
        return method ? !!method.is_credit_card : false;
      },

      canSubmit() {
        if (this.shippingBlocked) return false;
        if (this.submitting) return false;
        if (!this.cart || this.cart.empty) return false;
        if (this.cart.aico_has_invalid_quantity || this.cart.aico_has_invalid_price) return false;
        if (this.cart.aico_status && this.cart.aico_status !== 'SAVED') return false;
        if (!this.billingAddressId || !this.deliveryAddressId || !this.paymentMethodId) return false;
        if (!this.termsAccepted) return false;
        if (this.creditLimitExceeded) {
          var method = this.selectedPaymentMethod;
          if (!method || !method.is_credit_card) return false;
        }
        return true;
      },

      shippingDisplay() {
        if (this.shippingAmount === null) {
          return (translations.shipping_at_checkout || 'Calculated at checkout');
        }
        return formatMoneyValue(this.shippingAmount);
      },

      vatDisplay() {
        if (this.vatAmount === null) return '—';
        return formatMoneyValue(this.vatAmount);
      },

      totalDisplay() {
        var subtotal = (this.cart && this.cart.total_price) || 0;
        var shipping = this.shippingAmount || 0;
        var vat = this.vatAmount || 0;
        return subtotal + shipping + vat + (this.creditCardFee || 0);
      },

      formatMoney(value) { return formatMoneyValue(value); },

      async submit() {
        if (!this.termsAccepted) { this.termsError = true; return; }
        this.termsError = false;
        if (!this.canSubmit()) return;
        this.submitting = true;
        this.submitError = null;

        try {
          var res = await fetch(routes.url || '/checkout', {
            method: 'POST',
            headers: jsonHeaders(),
            credentials: 'same-origin',
            body: formEncoded({
              billing_address_id: this.billingAddressId,
              delivery_address_id: this.deliveryAddressId,
              payment_method_id: this.paymentMethodId,
            }),
          });

          if (!res.ok) {
            var body = null;
            try { body = await res.json(); } catch (_) {}
            this.submitError = (body && body.error)
              ? this.errorMessage(body.error)
              : (translations.submit_failed || 'Could not submit the order.');
            this.submitting = false;
            return;
          }

          var data = await res.json();
          if (data.hosted_page_url) {
            // Credit-card path — Adyen hosted page redirect.
            window.location = data.hosted_page_url;
            return;
          }

          // Non-CC path — straight to thank-you with the order details.
          var thankYou = routes.thankYouUrl || '/checkout/thank-you';
          var params = new URLSearchParams();
          if (data.ecommerce_order_number) params.set('order_number', data.ecommerce_order_number);
          if (data.order_id) params.set('order_id', data.order_id);
          var subtotal = (this.cart && this.cart.total_price) || 0;
          if (subtotal) params.set('subtotal', String(subtotal));
          if (this.shippingAmount) params.set('shipping', String(this.shippingAmount));
          if (this.vatAmount) params.set('vat', String(this.vatAmount));
          if (this.creditCardFee) params.set('cc_fee', String(this.creditCardFee));
          var total = this.totalDisplay();
          if (total) params.set('total', String(total));
          var currency = window.__AICO_SHOP__ && window.__AICO_SHOP__.currency;
          if (currency) params.set('currency', currency);
          window.location = thankYou + '?' + params.toString();
        } catch (e) {
          this.submitError = translations.submit_failed || 'Could not submit the order.';
          this.submitting = false;
        }
      },

      errorMessage(code) {
        switch (code) {
          case 'missing_fields':   return translations.missing_fields || 'Please fill in all required fields.';
          case 'empty_cart':       return translations.cart_modified || 'Your cart has changed.';
          case 'unauthorized':     return translations.login_required || 'Please sign in to continue.';
          default:                 return translations.submit_failed || 'Could not submit the order.';
        }
      },
    };
  };

  /* /checkout/processing — Pusher listener for the order-created event.
   * Subscribes to the channel using window.__AICO_PUSHER__ config
   * injected by the renderer. When the event lands, navigates to
   * /checkout/thank-you with the relevant query params already on the
   * URL (passed through from the submit step).
   */
  window.aicoCheckoutProcessing = function () {
    return {
      elapsed: 0,
      _interval: null,
      _pusher: null,
      _channel: null,

      init() {
        var self = this;
        this._interval = setInterval(function () { self.elapsed += 1; }, 1000);

        var query = new URLSearchParams(window.location.search);
        var orderId = query.get('order_id');
        if (!orderId) return;

        if (!pusherConfig || !window.Pusher) {
          // No Pusher available — fall back to a slow status poll so
          // the page is not a dead-end if the broadcaster is offline.
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

      navigateToThankYou(data) {
        var thankYou = routes.thankYouUrl || '/checkout/thank-you';
        var query = new URLSearchParams(window.location.search);
        if (data.ecommerce_order_number) query.set('order_number', data.ecommerce_order_number);
        window.location = thankYou + '?' + query.toString();
      },

      pollStatus(orderId) {
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
  };
})();
