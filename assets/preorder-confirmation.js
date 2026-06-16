/**
 * Preorder confirmation — richer post-submit feedback.
 *
 * Renders, into a `[data-aico-preorder-confirmation]` panel:
 *   - a success header,
 *   - the real per-date order number(s) (ecommerceOrders.order_number) + the
 *     umbrella Preorder id as a secondary reference,
 *   - delivery address, total item count, total amount, discount (if any),
 *   - per-date delivery dates (+ their order numbers),
 *   - a PDF area: "generating…" → a working download link once it lands.
 *
 * The PDF arrives asynchronously (GeneratePreorderPdf). Transport is
 * polling-first: it polls `confirmation.js?cart_id=…` until `pdf.file_url`
 * appears. When the backend reports an active pusher driver, the confirmation
 * payload carries a `pusher` block ({ key, cluster, channel, event }) sourced
 * entirely from aico's broadcasting config — the theme then also subscribes to
 * that channel as a progressive enhancement. The merchant configures nothing;
 * the same UI is driven either way. No hard dependency on pusher being on.
 *
 * Backend contract (GET /preorder/cart/confirmation.js?cart_id=):
 *   { aico_confirmation: {
 *       order_numbers: string[], preorder_id, cart_id, status,
 *       delivery_address, item_count, total_amount, discount_percent|null,
 *       per_date: [ { order_number, delivery_date, quantity, total_amount } ],
 *       pdf: { file_url|null, file_name|null }, pdf_ready
 *     } | null }
 *
 * Framework-free, matches the other preorder-*.js modules (no Alpine).
 */
(function (global) {
  'use strict';

  var POLL_INTERVAL = 2000; // legacy parity (2s)
  var MAX_DETAIL_POLLS = 60; // ~2 min waiting for the umbrella preorder
  var MAX_PDF_POLLS = 90; // ~3 min waiting for the PDF render

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[ch];
    });
  }

  function copyOf(root, name, fallback) {
    var value = root.getAttribute('data-aico-confirmation-' + name);
    return value != null && value !== '' ? value : fallback;
  }

  function formatMoney(amount, currency) {
    var value = Number(amount || 0);
    try {
      return new Intl.NumberFormat(undefined, {
        style: currency ? 'currency' : 'decimal',
        currency: currency || undefined,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);
    } catch (_) {
      return (currency ? currency + ' ' : '') + value.toFixed(2);
    }
  }

  function formatDate(value) {
    if (!value) return '';
    try {
      var d = new Date(value);
      if (isNaN(d.getTime())) return String(value);
      return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }).format(d);
    } catch (_) {
      return String(value);
    }
  }

  function Confirmation(root) {
    this.root = root;
    this.confirmationUrl = root.getAttribute('data-aico-confirmation-url');
    this.cartId = root.getAttribute('data-aico-confirmation-cart-id') || null;
    this.currency = root.getAttribute('data-aico-confirmation-currency') || '';

    this.detailPolls = 0;
    this.pdfPolls = 0;
    this.pdfReady = false;
    this.detailLoaded = false;
    this._pusherClient = null;
    this._pusherSubscribed = false;
    this._timer = null;
  }

  /** Start with a known confirmation payload (e.g. seeded from submit response). */
  Confirmation.prototype.start = function (seed) {
    if (!this.confirmationUrl || !this.cartId) {
      // Nothing to confirm against — leave whatever static copy is in the panel.
      return;
    }
    this.root.hidden = false;
    if (seed && typeof seed === 'object') {
      this.apply(seed);
    } else {
      this.renderPending();
    }
    // Poll regardless — it is the source of truth and covers the broadcast-off
    // path. Pusher (progressive enhancement) is subscribed lazily once a payload
    // arrives carrying the backend-sourced `pusher` block.
    this.poll();
  };

  Confirmation.prototype.renderPending = function () {
    var headerEl = this.root.querySelector('[data-aico-confirmation-header]');
    if (headerEl) {
      headerEl.textContent = copyOf(this.root, 'title', 'Thank you');
    }
    this.setPdfState('generating');
  };

  Confirmation.prototype.poll = function () {
    var self = this;
    var url = new URL(this.confirmationUrl, global.location.origin);
    url.searchParams.set('cart_id', String(this.cartId));
    fetch(url.toString(), {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (payload) {
        var confirmation = payload && payload.aico_confirmation;
        if (confirmation) {
          self.apply(confirmation);
        }
        self.scheduleNextPoll(confirmation);
      })
      .catch(function () {
        self.scheduleNextPoll(null);
      });
  };

  Confirmation.prototype.scheduleNextPoll = function (confirmation) {
    var self = this;
    // Stop once we have details AND the PDF (or a delivered broadcast).
    if (this.detailLoaded && this.pdfReady) return;

    if (!confirmation) {
      this.detailPolls += 1;
      if (this.detailPolls >= MAX_DETAIL_POLLS) return; // submission likely still queued
    } else if (!this.pdfReady) {
      this.pdfPolls += 1;
      if (this.pdfPolls >= MAX_PDF_POLLS) {
        // Give up waiting for the PDF; the details still stand.
        this.setPdfState('unavailable');
        return;
      }
    }
    this._timer = setTimeout(function () {
      self.poll();
    }, POLL_INTERVAL);
  };

  /** Render the full confirmation from a payload (poll or broadcast-merged). */
  Confirmation.prototype.apply = function (confirmation) {
    if (!confirmation || typeof confirmation !== 'object') return;
    this.detailLoaded = true;
    this.root.hidden = false;

    var root = this.root;

    var headerEl = root.querySelector('[data-aico-confirmation-header]');
    if (headerEl) headerEl.textContent = copyOf(root, 'title', 'Thank you');

    var messageEl = root.querySelector('[data-aico-confirmation-message]');
    if (messageEl) messageEl.textContent = copyOf(root, 'message', '');

    var numbers = Array.isArray(confirmation.order_numbers) ? confirmation.order_numbers : [];
    var numberEl = root.querySelector('[data-aico-confirmation-number]');
    if (numberEl) {
      numberEl.textContent = numbers.length
        ? numbers.join(', ')
        : copyOf(root, 'number-pending', '…');
    }

    this.setText('[data-aico-confirmation-reference]', confirmation.preorder_id || '');
    this.setText('[data-aico-confirmation-address]', confirmation.delivery_address || '—');
    this.setText('[data-aico-confirmation-item-count]', confirmation.item_count || 0);
    this.setText(
      '[data-aico-confirmation-total]',
      formatMoney(confirmation.total_amount, this.currency),
    );

    var discountWrap = root.querySelector('[data-aico-confirmation-discount-row]');
    if (discountWrap) {
      if (confirmation.discount_percent) {
        discountWrap.hidden = false;
        this.setText(
          '[data-aico-confirmation-discount]',
          Number(confirmation.discount_percent).toFixed(0) + '%',
        );
      } else {
        discountWrap.hidden = true;
      }
    }

    this.renderPerDate(confirmation.per_date || []);

    var pdf = confirmation.pdf || {};
    if (pdf.file_url) {
      this.showPdfLink(pdf.file_url, pdf.file_name);
    } else if (!this.pdfReady) {
      this.setPdfState('generating');
    }

    // Backend-driven progressive enhancement: subscribe the moment the payload
    // first carries an active pusher block (aico sets it only when its driver is
    // on). Polling above already covers the no-pusher path.
    if (!this._pusherSubscribed && confirmation.pusher) {
      this.subscribePusher(confirmation.pusher);
    }
  };

  Confirmation.prototype.setText = function (selector, value) {
    var el = this.root.querySelector(selector);
    if (el) el.textContent = String(value == null ? '' : value);
  };

  Confirmation.prototype.renderPerDate = function (rows) {
    var container = this.root.querySelector('[data-aico-confirmation-dates]');
    if (!container) return;
    if (!rows.length) {
      container.innerHTML = '';
      return;
    }
    var qtyLabel = copyOf(this.root, 'pcs', 'pcs');
    var self = this;
    container.innerHTML = rows
      .map(function (row) {
        return (
          '<div class="aico-preorder-confirmation-date-row">' +
          '<span class="aico-preorder-confirmation-date">' +
          escapeHtml(formatDate(row.delivery_date)) +
          '</span>' +
          '<span class="aico-preorder-confirmation-date-number">' +
          escapeHtml(row.order_number || '') +
          '</span>' +
          '<span class="aico-preorder-confirmation-date-qty">' +
          escapeHtml(String(row.quantity || 0) + ' ' + qtyLabel) +
          '</span>' +
          '<span class="aico-preorder-confirmation-date-total">' +
          escapeHtml(formatMoney(row.total_amount, self.currency)) +
          '</span>' +
          '</div>'
        );
      })
      .join('');
  };

  /** state: 'generating' | 'unavailable' */
  Confirmation.prototype.setPdfState = function (state) {
    var area = this.root.querySelector('[data-aico-confirmation-pdf]');
    if (!area) return;
    if (state === 'generating') {
      area.innerHTML =
        '<span class="aico-preorder-confirmation-pdf-spinner" aria-hidden="true"></span>' +
        '<span>' +
        escapeHtml(copyOf(this.root, 'pdf-generating', 'Generating your confirmation PDF…')) +
        '</span>';
      area.setAttribute('aria-busy', 'true');
    } else if (state === 'unavailable') {
      area.removeAttribute('aria-busy');
      area.innerHTML =
        '<span>' +
        escapeHtml(copyOf(this.root, 'pdf-unavailable', 'The confirmation PDF will be emailed to you shortly.')) +
        '</span>';
    }
  };

  Confirmation.prototype.showPdfLink = function (fileUrl, fileName) {
    if (this.pdfReady) return;
    this.pdfReady = true;
    var area = this.root.querySelector('[data-aico-confirmation-pdf]');
    if (!area) return;
    area.removeAttribute('aria-busy');
    var label = copyOf(this.root, 'pdf-download', 'Download confirmation (PDF)');
    var name = fileName ? ' download="' + escapeHtml(fileName) + '"' : ' download';
    area.innerHTML =
      '<a class="aico-preorder-confirmation-pdf-link aico-btn aico-btn-primary" href="' +
      escapeHtml(fileUrl) +
      '"' +
      name +
      ' rel="noopener">' +
      escapeHtml(label) +
      '</a>';
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  };

  /**
   * Optional pusher subscriber. `config` is the backend-sourced block from the
   * confirmation payload ({ key, cluster, channel, event }); aico assembles the
   * channel name and only sends this when its broadcast driver is active. Loaded
   * lazily, once, and failures are swallowed (polling still drives the reveal).
   */
  Confirmation.prototype.subscribePusher = function (config) {
    var self = this;
    if (this._pusherSubscribed) return;
    if (!config || !config.key || !config.channel) return;
    this._pusherSubscribed = true;
    var eventName = config.event || 'PreorderPdfCreatedEvent';
    this.loadPusher()
      .then(function (Pusher) {
        if (!Pusher) return;
        try {
          self._pusherClient = new Pusher(config.key, {
            cluster: config.cluster || 'mt1',
            forceTLS: true,
          });
          var channel = self._pusherClient.subscribe(config.channel);
          channel.bind(eventName, function (data) {
            if (data && data.fileUrl) {
              self.showPdfLink(data.fileUrl, data.fileName);
            } else {
              // Trust the event arrival; re-poll to pull the stored locator.
              self.poll();
            }
          });
        } catch (_) {
          /* polling fallback already running */
        }
      })
      .catch(function () {
        /* polling fallback already running */
      });
  };

  Confirmation.prototype.loadPusher = function () {
    if (global.Pusher) return Promise.resolve(global.Pusher);
    return new Promise(function (resolve) {
      var script = document.createElement('script');
      script.src = 'https://js.pusher.com/8.2.0/pusher.min.js';
      script.async = true;
      script.onload = function () {
        resolve(global.Pusher || null);
      };
      script.onerror = function () {
        resolve(null);
      };
      document.head.appendChild(script);
    });
  };

  function init() {
    var root = document.querySelector('[data-aico-preorder-confirmation]');
    if (!root) return;
    var controller = new Confirmation(root);
    global.AicoPreorderConfirmation = controller;

    // Standalone (thank-you template) auto-init: read the cart id from the URL
    // if it wasn't server-rendered onto the panel, then start.
    if (!controller.cartId) {
      try {
        var params = new URLSearchParams(global.location.search);
        controller.cartId = params.get('cart') || params.get('cart_id') || null;
      } catch (_) {}
    }
    // The inline path (preorder page) starts the controller itself after submit,
    // so only auto-start when the panel is the page's primary content
    // (data-aico-confirmation-autostart="1" on the thank-you template).
    if (root.getAttribute('data-aico-confirmation-autostart') === '1') {
      controller.start();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : this);
