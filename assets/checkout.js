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

  // Build the canonical order-confirmation URL: the thank-you page plus a
  // single `?order=<order number>` param and NOTHING else.
  //
  // The order number is the only reference the page needs — it re-reads the
  // persisted totals from /checkout/order-summary, so no amounts belong in
  // the URL. When the submit response carries no ecommerce order number yet
  // (it is allocated before the async save, so this is rare) we fall back to
  // `?order_id=`, which the page accepts and replaces with `?order=` once it
  // learns the number.
  function thankYouUrlFor(orderNumber, orderId) {
    var base = (routes.thankYouUrl || '/checkout/thank-you').replace(/\/+$/, '');
    if (orderNumber) return base + '?order=' + encodeURIComponent(String(orderNumber));
    if (orderId) return base + '?order_id=' + encodeURIComponent(String(orderId));
    return base;
  }

  // Per-currency Intl formatters: the checkout currency FOLLOWS the selected
  // delivery address (the refreshed /cart.js?delivery_address_id=… response
  // carries the address-mapped currency, e.g. Austrian address → EUR), so the
  // fixed cart-store formatter (page-load currency) is only the fallback.
  var moneyFormatters = {};
  // CHF prices display rounded to the NEAREST 0.05 (display only —
  // stored/charged amounts stay exact).
  function roundChfDisplay(amount, currency) {
    if (String(currency || '').toUpperCase() !== 'CHF') return amount;
    return Math.round(amount / 0.05) * 0.05;
  }
  function formatMoneyValue(value, currencyCode) {
    var amount = Number(value || 0);
    if (currencyCode) {
      amount = roundChfDisplay(amount, currencyCode);
      if (!(currencyCode in moneyFormatters)) {
        // __AICO_SHOP__.locale may be a locale DROP object (request.locale | json).
        var rawLocale = (window.__AICO_SHOP__ && window.__AICO_SHOP__.locale) || 'en';
        if (rawLocale && typeof rawLocale === 'object') rawLocale = rawLocale.iso_code || rawLocale.locale || 'en';
        var locale = String(rawLocale).replace('_', '-');
        try {
          moneyFormatters[currencyCode] = new Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode });
        } catch (_) {
          moneyFormatters[currencyCode] = null;
        }
      }
      var formatter = moneyFormatters[currencyCode];
      if (formatter) {
        try { return formatter.format(amount); } catch (_) { /* fall through */ }
      }
      return amount.toFixed(2) + ' ' + currencyCode;
    }
    var store = window.Alpine && window.Alpine.store('cart');
    if (store) return store.formatMoney(value);
    var pageCurrency = (window.__AICO_SHOP__ && window.__AICO_SHOP__.currency) || '';
    return roundChfDisplay(amount, pageCurrency).toFixed(2);
  }

  function readInitialCart() {
    var el = document.getElementById('aico-cart-data');
    if (!el) return null;
    try {
      return JSON.parse(el.textContent || 'null') || null;
    } catch (_) {
      return null;
    }
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

      cart: readInitialCart(),
      shippingAmount: null,
      vatAmount: null,
      vatRate: null,
      // Promo-code discount on the CHECKOUT cart, sourced from /cart/vat.js
      // (NOT /cart.js: on separated-cart shops that endpoint may resolve a
      // different cart row than the one the order will charge — see #124).
      discountValue: 0,
      discountPercentage: 0,
      discountCode: null,
      creditCardFlatFee: 0,
      creditCardFeePercent: 0,
      totalsLoaded: false,
      totalsLoading: false,
      termsAccepted: false,
      termsError: false,
      submitting: false,
      submitError: null,
      // What the shopper has typed into the discount box. Kept separate from
      // `discountCode` above, which is the code the BACKEND reports as applied.
      discountCodeInput: seeds.initialDiscountCode || '',
      discountApplying: false,
      discountStatus: null, // null | 'applied' | 'invalid'
      _refreshInFlight: null,
      _totalsInFlight: null,
      _deliveryRefreshTimer: null,

      init: function () {
        var self = this;
        if (!self.paymentMethodId && self.paymentMethods.length > 0) {
          self.paymentMethodId = self.paymentMethods[0].id;
        }
        self.syncCreditCardFeePercent();
        self.applyCreditLimitGuard();

        if (self.cart && self.cart.empty) {
          window.location.href = cartRoutes.url || '/cart';
          return Promise.resolve();
        }

        // Refresh the cart with the PRESELECTED delivery address too — the
        // SSR'd cart seed is priced in the debtor currency, which can differ
        // from the address-mapped checkout currency on first paint.
        return Promise.all([self.refreshCart(), self.refreshTotals()]);
      },

      syncCreditCardFeePercent: function () {
        var method = this.selectedPaymentMethod;
        this.creditCardFeePercent = (method && method.is_credit_card)
          ? Number(method.fee_percentage || 0)
          : 0;
      },

      refreshTotals: function () {
        var self = this;
        if (!self.cart || !self.cart.id || !self.deliveryAddressId) {
          return Promise.resolve();
        }
        if (self._totalsInFlight) {
          return self._totalsInFlight;
        }

        self.totalsLoading = true;
        var shippingUrl = (cartRoutes.shippingJsonUrl || '/cart/shipping.js')
          + '?delivery_address_id=' + encodeURIComponent(String(self.deliveryAddressId));
        var vatUrl = (cartRoutes.vatJsonUrl || '/cart/vat.js')
          + '?delivery_address_id=' + encodeURIComponent(String(self.deliveryAddressId))
          + '&payment_method_id=' + encodeURIComponent(String(self.paymentMethodId || 0));

        self._totalsInFlight = Promise.all([
          fetch(shippingUrl, { headers: jsonHeaders(), credentials: 'same-origin' })
            .then(function (res) { return res.ok ? res.json() : null; }),
          fetch(vatUrl, { headers: jsonHeaders(), credentials: 'same-origin' })
            .then(function (res) { return res.ok ? res.json() : null; }),
        ])
          .then(function (results) {
            var shippingBody = results[0];
            var vatBody = results[1];
            if (shippingBody) {
              self.shippingAmount = Number(shippingBody.shipping_amount || 0);
            }
            if (vatBody) {
              self.vatAmount = Number(vatBody.vat || 0);
              self.creditCardFlatFee = Number(vatBody.credit_card_flat_fee || 0);
              // AICO extension: the single VAT percentage applied to the cart's
              // items (null when rates are mixed -> plain "VAT" label).
              self.vatRate = (vatBody.vat_rate === null || vatBody.vat_rate === undefined || isNaN(Number(vatBody.vat_rate)))
                ? null
                : Number(vatBody.vat_rate);
              // Promo-code discount of the checkout cart (backend-computed;
              // the VAT above is already calculated on the discount-reduced
              // position totals, so no client-side VAT correction is needed).
              self.discountValue = Number(vatBody.discount_value || 0);
              self.discountPercentage = Number(vatBody.discount_percentage || 0);
              self.discountCode = vatBody.discount_code || null;
            }
            self.totalsLoaded = true;
          })
          .catch(function () { /* keep previous totals */ })
          .finally(function () {
            self.totalsLoading = false;
            self._totalsInFlight = null;
          });

        return self._totalsInFlight;
      },

      refreshCart: function () {
        var self = this;
        if (self._refreshInFlight) {
          return self._refreshInFlight;
        }
        var url = cartRoutes.jsonUrl || '/cart.js';
        if (self.deliveryAddressId) {
          url += (url.indexOf('?') === -1 ? '?' : '&') + 'delivery_address_id=' + self.deliveryAddressId;
        }
        self._refreshInFlight = fetch(url, { headers: jsonHeaders(), credentials: 'same-origin' })
          .then(function (res) { return res.ok ? res.json() : null; })
          .then(function (body) {
            if (body) self.cart = body;
          })
          .catch(function () { /* keep SSR / previous cart */ })
          .finally(function () {
            self._refreshInFlight = null;
          });
        return self._refreshInFlight;
      },

      /**
       * Apply the typed discount code. `POST /cart/discount` returns the
       * resulting discount only, which we merge into the cart snapshot the
       * summary renders from — the page is never reloaded, so the shopper
       * stays where they are instead of being thrown back to the top.
       */
      applyDiscount: function () {
        var self = this;
        var code = String(self.discountCodeInput || '').trim();
        if (!code || self.discountApplying) {
          return Promise.resolve();
        }
        self.discountApplying = true;
        self.discountStatus = null;

        return fetch(cartRoutes.discountUrl || '/cart/discount', {
          method: 'POST',
          headers: jsonHeaders(),
          credentials: 'same-origin',
          body: formEncoded({ discount_code: code }),
        })
          .then(function (res) { return res.ok ? res.json() : null; })
          .then(function (body) {
            if (!body) {
              self.discountStatus = 'invalid';
              return;
            }
            // The summary renders the top-level discount state, which normally
            // comes from /cart/vat.js (#124) — the endpoint reads the same
            // checkout cart, so seed it now for instant feedback and let
            // refreshTotals() re-affirm it from that source.
            self.discountValue = Number(body.aico_discount_value || 0);
            self.discountPercentage = Number(body.aico_discount_percentage || 0);
            self.discountCode = body.aico_discount_code || null;
            self.discountStatus = body.applied ? 'applied' : 'invalid';
            if (body.applied) {
              // VAT is charged on the discounted base, so the totals follow.
              return self.refreshTotals();
            }
          })
          .catch(function () { self.discountStatus = 'invalid'; })
          .finally(function () { self.discountApplying = false; });
      },

      onDeliveryAddressChange: function () {
        var self = this;
        if (self._deliveryRefreshTimer) {
          clearTimeout(self._deliveryRefreshTimer);
        }
        self._deliveryRefreshTimer = setTimeout(function () {
          self._deliveryRefreshTimer = null;
          self.refreshCart();
          self.refreshTotals();
        }, 300);
      },

      onPaymentMethodChange: function () {
        this.syncCreditCardFeePercent();
        this.refreshTotals();
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
        if (!this.totalsLoaded || this.totalsLoading) return false;
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
        // Same pending placeholder as vatDisplay so the two rows never mix
        // "…" with the calculated-at-checkout text while totals reload.
        if (!this.totalsLoaded || this.totalsLoading) return '…';
        return formatMoneyValue(this.shippingAmount || 0, this.cartCurrency());
      },

      vatDisplay: function () {
        if (!this.totalsLoaded || this.totalsLoading) return '…';
        return formatMoneyValue(this.vatAmount || 0, this.cartCurrency());
      },

      // The checkout's display currency: the (possibly address-remapped)
      // currency of the last /cart.js snapshot, falling back to the shop's
      // page-load currency.
      cartCurrency: function () {
        return (this.cart && this.cart.currency)
          || (window.__AICO_SHOP__ && window.__AICO_SHOP__.currency)
          || null;
      },

      // "VAT (8.1%)" / "MwSt. (8.1%)" once the rate is known; plain label
      // before the totals load or when the cart mixes VAT rates.
      vatLabel: function () {
        var base = translations.vat || 'VAT';
        if (this.vatRate === null || this.vatRate === undefined) return base;
        var rate = String(Number(this.vatRate));
        var template = translations.vat_with_rate;
        if (template && template.indexOf('{{') !== -1) {
          return template.replace(/\{\{\s*rate\s*\}\}/g, rate);
        }
        return base + ' (' + rate + '%)';
      },

      totalDisplay: function () {
        if (!this.totalsLoaded) {
          return (this.cart && this.cart.total_price) || 0;
        }
        var subtotal = (this.cart && this.cart.total_price) || 0;
        // Business rule: the discount reduces the products cost before every
        // subsequent component (the backend VAT is already discount-aware).
        var discount = this.discountValue || 0;
        var shipping = this.shippingAmount || 0;
        var vat = this.vatAmount || 0;
        var ccFlat = this.creditCardFlatFee || 0;
        var total = subtotal - discount + shipping + vat + ccFlat;
        return Math.max(0, total);
      },

      formatMoney: function (value) {
        return formatMoneyValue(value, this.cartCurrency());
      },

      // Collapse line items that share a product so the order summary shows
      // each product name once with the summed quantity and line total.
      summaryGroups: function () {
        var items = (this.cart && this.cart.items) || [];
        var groups = [];
        var index = {};
        items.forEach(function (line) {
          var key = line.product_id ? ('p:' + line.product_id) : ('l:' + line.id);
          if (!index[key]) {
            index[key] = {
              key: key,
              title: line.title,
              quantity: 0,
              line_price: 0,
              invalid: false,
            };
            groups.push(index[key]);
          }
          var group = index[key];
          group.quantity += Number(line.quantity || 0);
          group.line_price += Number(line.line_price || 0);
          if (line.aico_quantity_exceeds_stock || !line.aico_is_valid) {
            group.invalid = true;
          }
        });
        return groups;
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

        fetch(routes.submitUrl || routes.url || '/checkout', {
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
              // Route by payment type, mirroring the legacy b2b-shop: only
              // credit-card orders wait on the processing page (they need the
              // Adyen round-trip / async payment confirmation). Every other
              // payment condition goes straight to the thank-you page — the
              // order keeps saving in the background and does not block the
              // shopper on a spinner.
              var selectedMethod = self.selectedPaymentMethod;
              var isCreditCardPayment = !!(selectedMethod && selectedMethod.is_credit_card);
              if (isCreditCardPayment && data.order_id) {
                var processing = routes.processingUrl || '/checkout/processing';
                window.location = processing + '?order_id=' + encodeURIComponent(String(data.order_id));
                return;
              }
              // The confirmation URL carries ONLY the order number, as a path
              // segment. The amounts are deliberately not passed: the page
              // reads them back from the persisted order via
              // /checkout/order-summary, so what the shopper sees is what the
              // backend actually charged and the URL stays a stable, reloadable
              // reference to one order instead of client-supplied totals.
              window.location = thankYouUrlFor(data.ecommerce_order_number, data.order_id);
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

      // Credit-card orders carry the Adyen hosted-page URL (`url` on the
      // Pusher event, `hosted_page_url` on the poll response) — the shopper
      // must be sent THERE to pay, mirroring the legacy b2b-shop
      // `redirectToUrl`. Only URL-less orders go straight to thank-you.
      navigateToThankYou: function (data) {
        var hostedPageUrl = data.url || data.hosted_page_url;
        if (hostedPageUrl) {
          window.location = hostedPageUrl;
          return;
        }
        // The Adyen leg carries sessionId/sessionResult, which the
        // confirmation page needs to verify the payment — those are
        // preserved. Only the order reference moves into the path.
        var query = new URLSearchParams(window.location.search);
        var orderId = query.get('order_id');
        query.delete('order_id');
        query.delete('order_number');
        var url = thankYouUrlFor(data.ecommerce_order_number, orderId);
        var rest = query.toString();
        if (!rest) {
          window.location = url;
          return;
        }
        window.location = url + (url.indexOf('?') === -1 ? '?' : '&') + rest;
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
                self.navigateToThankYou({
                  hosted_page_url: body.hosted_page_url,
                  ecommerce_order_number: body.ecommerce_order_number,
                });
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

  /**
   * Thank-you page payment verification. Adyen's Hosted Checkout redirects
   * back with `sessionId` + `sessionResult` in the query string; those are
   * verified against Adyen via /checkout/payment-status before the success
   * card is shown (mirrors the legacy b2b-shop thank-you page, which called
   * `/orders/payment-session-status/handle`). Without session params — the
   * non-credit-card flow — the template renders statically and this
   * component is never mounted.
   *
   * States: 'verifying' → 'success' | 'cancelled' (session verified but not
   * completed — includes paymentPending, expired, refused) | 'unverified'
   * (verification unavailable after retries; neutral copy, no false claims).
   */
  function buildCheckoutThankYouPage() {
    return {
      state: 'verifying',
      // Persisted totals of the just-placed order, or null while loading.
      summary: null,
      // The order this page is about, from `?order=` (or a legacy param).
      orderNumber: '',
      orderId: '',
      // True while the async save is still running — the page shows a
      // "we are confirming your order" state instead of blank totals.
      pending: true,
      // The order exists but is not visible to this shopper's organisation,
      // or does not exist at all.
      notFound: false,
      _pusher: null,
      _channel: null,

      init: function () {
        var query = new URLSearchParams(window.location.search);
        // `order` is the canonical param; `order_number` / `orderRef` are the
        // legacy dialects (old bookmarks, and Adyen's returnUrl, which is
        // shared with the legacy b2b-shop and so cannot be changed).
        this.orderNumber = query.get('order')
          || query.get('order_number') || query.get('orderRef') || '';
        this.orderId = query.get('order_id') || '';
        this.resetCartBadge();
        this.loadOrderSummary(0);

        // Adyen's Hosted Checkout returns with sessionId + sessionResult; the
        // payment must be verified before the success card is shown. Without
        // them (every non-credit-card order) the confirmation is immediate.
        var sessionId = query.get('sessionId');
        var sessionResult = query.get('sessionResult');
        if (!sessionId || !sessionResult) {
          this.state = 'success';
          return;
        }
        this.verify(sessionId, sessionResult, 0);
      },

      destroy: function () {
        this.unsubscribeFromOrder();
      },

      // The header cart badge is seeded from the SSR'd cart snapshot, which
      // still contains the just-ordered lines: the async SaveAicoShopOrder
      // job only consumes the cart after this page has rendered. Reaching
      // this page at all means an order was placed, so optimistically zero
      // the `$store.cart` data the badge/mini-cart read. Once the order is
      // confirmed the authoritative cart is re-fetched (see onOrderReady),
      // which also self-corrects historical visits to this page.
      resetCartBadge: function () {
        if (!this.orderNumber && !this.orderId) return;
        var store = window.Alpine && typeof window.Alpine.store === 'function'
          ? window.Alpine.store('cart')
          : null;
        if (store && store.data) {
          store.data.items = [];
          store.data.item_count = 0;
          store.data.total_price = 0;
          store.data.empty = true;
        }
      },

      refreshCartStore: function () {
        var store = window.Alpine && typeof window.Alpine.store === 'function'
          ? window.Alpine.store('cart')
          : null;
        if (store && typeof store.refresh === 'function') store.refresh();
      },

      // Read the persisted order.
      //
      // Two cases, and the page must handle both without the shopper noticing
      // a difference:
      //   - the order is ALREADY saved (a reload, a bookmark, a link a
      //     colleague opened): the first fetch answers `ready` and the totals
      //     render immediately;
      //   - the save is still in flight (the usual path straight after
      //     submit): the fetch answers `ready: false`, and we wait for the
      //     AicoShopOrderCreatedEvent broadcast for THIS order instead of
      //     hammering the endpoint. Polling stays as the fallback for when
      //     pusher is not configured or the socket fails to connect.
      loadOrderSummary: function (attempt) {
        var self = this;
        if (!this.orderNumber && !this.orderId) {
          this.pending = false;
          this.notFound = true;
          return;
        }
        var url = routes.orderSummaryUrl || '/checkout/order-summary';
        var params = new URLSearchParams();
        if (this.orderId) params.set('order_id', this.orderId);
        else params.set('order_number', this.orderNumber);

        fetch(url + '?' + params.toString(), { headers: jsonHeaders(), credentials: 'same-origin' })
          .then(function (response) {
            // 404 = no such order, or one this organisation may not see. That
            // is a terminal answer for an order number typed into the URL —
            // but right after submit it is also the transient state while the
            // async save has not created the ecommerce-order row yet, so it
            // only becomes terminal once the retries are exhausted.
            if (response.status === 404) return { missing: true };
            return response.ok ? response.json() : null;
          })
          .then(function (body) {
            if (body && body.ready) {
              self.onOrderReady(body);
              return;
            }
            // The order row exists but is still saving: learn its id so we can
            // subscribe to the broadcast, then wait for it.
            if (body && !body.missing && body.order_id) {
              self.orderId = String(body.order_id);
              if (!self.orderNumber && body.order_number) self.orderNumber = String(body.order_number);
              if (self.subscribeToOrder()) return;
            }
            self.retryLoad(attempt, !!(body && body.missing));
          })
          .catch(function () { self.retryLoad(attempt, false); });
      },

      // 20 × 1.5s ≈ 30s. Only used until the broadcast subscription is live,
      // or for the whole wait when pusher is unavailable.
      retryLoad: function (attempt, missing) {
        var self = this;
        if (attempt >= 20) {
          this.pending = false;
          this.notFound = missing;
          return;
        }
        setTimeout(function () { self.loadOrderSummary(attempt + 1); }, 1500);
      },

      // Subscribe to the order-saved broadcast. Returns true when the
      // subscription is live and the caller can stop polling.
      subscribeToOrder: function () {
        var self = this;
        if (this._channel) return true;
        if (!pusherConfig || !window.Pusher || !this.orderId) return false;
        try {
          this._pusher = new window.Pusher(pusherConfig.key, {
            cluster: pusherConfig.cluster,
            authEndpoint: pusherConfig.authEndpoint || undefined,
          });
          var channelName = (pusherConfig.appSlug || 'storefront') + '.order_saved.' + this.orderId;
          this._channel = this._pusher.subscribe(channelName);
          this._channel.bind('AicoShopOrderCreatedEvent', function () {
            // The event says the order reached SAVED; re-read the totals
            // rather than trusting the payload, which carries no amounts.
            self.loadOrderSummary(0);
          });
          return true;
        } catch (e) {
          return false;
        }
      },

      unsubscribeFromOrder: function () {
        try {
          if (this._pusher && typeof this._pusher.disconnect === 'function') this._pusher.disconnect();
        } catch (e) { /* nothing to clean up */ }
        this._pusher = null;
        this._channel = null;
      },

      onOrderReady: function (body) {
        this.summary = body;
        this.pending = false;
        this.notFound = false;
        if (body.order_number) this.orderNumber = String(body.order_number);
        if (body.order_id) this.orderId = String(body.order_id);
        this.unsubscribeFromOrder();
        // The save completed → the cart was consumed server-side; replace the
        // optimistic zero with the authoritative cart.
        this.refreshCartStore();
        this.canonicaliseUrl();
      },

      // Rewrite a legacy `?order_number=…&subtotal=…` URL to the canonical
      // `?order=<number>` once the number is known, so a reload or a shared
      // link uses the clean form. History is REPLACED (not pushed) — the
      // confirmation is the end of the flow, and a back button that walks
      // through URL variants of the same page would be noise.
      canonicaliseUrl: function () {
        if (!this.orderNumber || !window.history || !window.history.replaceState) return;
        // Drop the order references (now in the path) and the legacy amount
        // params; keep anything else the URL carries — notably Adyen's
        // sessionId/sessionResult, which the payment verification reads.
        var query = new URLSearchParams(window.location.search);
        // `order` too: thankYouUrlFor re-adds it, and leaving it here would
        // emit it twice.
        ['order', 'order_id', 'order_number', 'orderRef', 'subtotal', 'discount', 'discount_code',
          'shipping', 'shippingCost', 'vat', 'cc_fee', 'fee', 'total', 'currency']
          .forEach(function (key) { query.delete(key); });
        var rest = query.toString();
        var target = thankYouUrlFor(this.orderNumber, null) + (rest ? '&' + rest : '');
        if (window.location.pathname + window.location.search === target) return;
        try {
          window.history.replaceState(window.history.state, '', target);
        } catch (e) { /* non-fatal: the page is already rendered correctly */ }
      },

      summaryValue: function (key) {
        return this.summary ? Number(this.summary[key] || 0) : 0;
      },

      formatSummary: function (key) {
        return formatMoneyValue(
          this.summaryValue(key),
          (this.summary && this.summary.currency) || (window.__AICO_SHOP__ && window.__AICO_SHOP__.currency) || null
        );
      },

      verify: function (sessionId, sessionResult, attempt) {
        var self = this;
        var statusUrl = routes.paymentStatusUrl || '/checkout/payment-status';
        var retry = function () {
          if (attempt < 2) {
            setTimeout(function () { self.verify(sessionId, sessionResult, attempt + 1); }, 2000);
          } else {
            self.state = 'unverified';
          }
        };
        fetch(
          statusUrl
            + '?session_id=' + encodeURIComponent(sessionId)
            + '&session_result=' + encodeURIComponent(sessionResult),
          { headers: jsonHeaders(), credentials: 'same-origin' }
        )
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (body) {
            var status = body && body.payment_session_status;
            if (!status) {
              retry();
            } else if (status === 'completed') {
              self.state = 'success';
            } else {
              self.state = 'cancelled';
            }
          })
          .catch(retry);
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

    Alpine.data('aicoCheckoutThankYouPage', function () {
      return buildCheckoutThankYouPage();
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
