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
 *       processing: false,
 *       order_numbers: string[], preorder_id, cart_id, status,
 *       delivery_address, item_count, total_amount, discount_percent|null,
 *       per_date: [ { order_number, delivery_date, quantity, total_amount } ],
 *       pdf: { file_url|null, file_name|null }, pdf_ready
 *     } | null }
 *
 * While a dispatched submit/edit is still running, the backend instead returns
 * a slim processing block — { processing: true, cart_id, status, pusher } —
 * NEVER the previous submission's stale orders/PDF. The panel then shows a
 * "we are processing your preorder" spinner state and re-fetches when
 * PreorderProcessedEvent arrives on the pusher channel (or via polling).
 * Both FIRST submits and edit re-submits land here the same way: the preorder
 * page redirects right after the submit is queued (no status polling there).
 *
 * If the queued submit fails with nothing committed, the backend returns
 * { processing: false, error: true, cart_id, status } — the panel then swaps
 * the spinner for an error state instead of polling for details forever. The
 * same happens when a processing block was seen but a later fetch reports no
 * confirmation at all (e.g. a version conflict left the cart DRAFT).
 *
 * Framework-free, matches the other preorder-*.js modules (no Alpine).
 */
(function (global) {
  'use strict';

  var POLL_INTERVAL = 2000; // legacy parity (2s)
  var MAX_DETAIL_POLLS = 60; // ~2 min waiting for the umbrella preorder
  var MAX_PROCESSING_POLLS = 300; // ~10 min while the submit/edit is processing
  var MAX_PDF_POLLS = 90; // ~3 min waiting for the PDF render
  var PUSHER_FALLBACK_MS = 20000; // if the live socket delivers nothing in 20s, poll instead

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
    // CHF prices display rounded to the NEAREST 0.05 (display only), like the legacy shop.
    if (String(currency || '').toUpperCase() === 'CHF') {
      value = Math.round(value / 0.05) * 0.05;
    }
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
    this.processingPolls = 0;
    this.pdfPolls = 0;
    this.pdfReady = false;
    this.detailLoaded = false;
    this._progressSeen = 0; // highest processed count rendered (monotonic guard)
    this._sawProcessing = false; // a processing block was seen at least once
    this._errored = false; // terminal error state rendered — transports stopped
    this._pusherClient = null;
    this._pusherSubscribed = false; // attempted a subscription
    this._pusherActive = false; // channel subscription confirmed live
    this._pusherFallbackArmed = false;
    this._fallbackTimer = null;
    this._timer = null;
  }

  /** Start with a known confirmation payload (e.g. seeded from submit response). */
  Confirmation.prototype.start = function (seed) {
    if (!this.confirmationUrl || !this.cartId) {
      // Nothing to confirm against. The thank-you template now server-renders
      // the PROCESSING state (so the checkmark never flashes before the data
      // is verified) — swap the spinner for the generic thank-you copy, since
      // no confirmation will ever be fetched for a bare visit.
      this.clearPending();
      var headerEl = this.root.querySelector('[data-aico-confirmation-header]');
      if (headerEl) headerEl.textContent = copyOf(this.root, 'title', 'Thank you');
      var messageEl = this.root.querySelector('[data-aico-confirmation-message]');
      if (messageEl) messageEl.textContent = copyOf(this.root, 'message', '');
      return;
    }
    this.root.hidden = false;
    if (seed && typeof seed === 'object') {
      this.apply(seed);
    } else {
      this.renderPending();
    }
    // One initial fetch loads the details (and any already-ready PDF). If the
    // payload offers a pusher channel, polling then stops and the broadcast
    // drives the PDF reveal; otherwise polling continues as the fallback.
    this.poll();
  };

  /**
   * The "we are processing your preorder" state: spinner + processing copy,
   * details hidden (via the --processing class) so a re-submit never shows the
   * PREVIOUS submission's numbers while the queue is still merging the new one.
   */
  Confirmation.prototype.renderPending = function () {
    this.root.classList.add('aico-preorder-confirmation--processing');
    this.root.setAttribute('aria-busy', 'true');
    var headerEl = this.root.querySelector('[data-aico-confirmation-header]');
    if (headerEl) {
      headerEl.textContent = copyOf(this.root, 'processing-title', 'We are processing your preorder…');
    }
    var messageEl = this.root.querySelector('[data-aico-confirmation-message]');
    if (messageEl) {
      messageEl.textContent = copyOf(this.root, 'processing-message', '');
    }
    this.setPdfState('generating');
  };

  Confirmation.prototype.clearPending = function () {
    this.root.classList.remove('aico-preorder-confirmation--processing');
    this.root.removeAttribute('aria-busy');
  };

  /**
   * Terminal error state: the queued submit failed and no details will arrive.
   * Swap the spinner for the error copy and stop every transport (polling +
   * fallback timers) — a spinner that never resolves is worse than bad news.
   */
  Confirmation.prototype.renderError = function () {
    if (this._errored) return;
    this._errored = true;
    this.clearPending();
    this.root.hidden = false;
    this.root.classList.add('aico-preorder-confirmation--error');
    var headerEl = this.root.querySelector('[data-aico-confirmation-header]');
    if (headerEl) {
      headerEl.textContent = copyOf(this.root, 'error-title', 'We could not process your preorder');
    }
    var messageEl = this.root.querySelector('[data-aico-confirmation-message]');
    if (messageEl) {
      messageEl.textContent = copyOf(
        this.root,
        'error-message',
        'Something went wrong while processing your preorder. Please go back to the preorder page and try again.',
      );
    }
    this.stopPolling();
    if (this._fallbackTimer) {
      clearTimeout(this._fallbackTimer);
      this._fallbackTimer = null;
    }
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
        } else if (payload && self._sawProcessing && !self.detailLoaded) {
          // The processing marker cleared but there is nothing to show: the
          // submit failed without committing anything (e.g. a version conflict
          // left the cart DRAFT). Error state, not an endless spinner.
          self._swapToState(self.renderError.bind(self));
        }
        self.scheduleNextPoll(confirmation);
      })
      .catch(function () {
        self.scheduleNextPoll(null);
      });
  };

  Confirmation.prototype.scheduleNextPoll = function (confirmation) {
    var self = this;
    if (this._errored) return; // terminal — nothing left to fetch
    // Stop once we have details AND the PDF (or a delivered broadcast).
    if (this.detailLoaded && this.pdfReady) return;

    var processing = !!(confirmation && confirmation.processing);

    // Pusher is primary when available: while we wait on the processed details
    // or (details in hand) on the PDF, STOP polling and let the broadcast drive
    // the update. A single fallback timer resumes polling if the socket
    // delivers nothing — so we never poll in parallel with a working pusher
    // connection.
    var pusherOffered = !!(confirmation && confirmation.pusher && confirmation.pusher.key && confirmation.pusher.channel);
    if ((processing || (this.detailLoaded && !this.pdfReady)) && (pusherOffered || this._pusherActive)) {
      this.armPusherFallback();
      return;
    }

    if (processing) {
      this.processingPolls += 1;
      // Give up tight-polling eventually; the spinner stays and a late pusher
      // event (still bound) can resolve the page.
      if (this.processingPolls >= MAX_PROCESSING_POLLS) return;
    } else if (!confirmation) {
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

  /** Arm a one-shot timer that resumes polling if pusher delivers no PDF in time. */
  Confirmation.prototype.armPusherFallback = function () {
    var self = this;
    if (this._pusherFallbackArmed) return;
    this._pusherFallbackArmed = true;
    this._fallbackTimer = setTimeout(function () {
      self._fallbackTimer = null;
      if (self.pdfReady) return;
      // Socket gave us nothing in time — drop back to polling.
      self._pusherActive = false;
      self._pusherFallbackArmed = false;
      self.poll();
    }, PUSHER_FALLBACK_MS);
  };

  Confirmation.prototype.stopPolling = function () {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  };

  /** Pusher dropped/failed before delivering — resume the polling fallback now. */
  Confirmation.prototype.resumePolling = function () {
    if (this.pdfReady) return;
    this._pusherActive = false;
    this._pusherFallbackArmed = false;
    if (this._fallbackTimer) {
      clearTimeout(this._fallbackTimer);
      this._fallbackTimer = null;
    }
    if (!this._timer) this.poll();
  };

  /**
   * Live submit progress (PreorderSubmitProgressEvent — first submits only):
   * the backend's chunk jobs feed a redis counter and broadcast a throttled
   * { processed, total } line-item pair on the same channel. Reveal the bar on
   * the FIRST event (the edit flow emits none, so its plain spinner stays) and
   * advance it; only meaningful while the panel still shows the processing
   * state. Progress never moves backwards (pusher gives no ordering promise),
   * and a live stream re-arms the polling fallback — events prove the socket
   * is healthy, so the fallback poll should not fire mid-submit.
   */
  Confirmation.prototype.applyProgress = function (data) {
    if (this.detailLoaded || this._errored || !data) return;
    if (!this.root.classList.contains('aico-preorder-confirmation--processing')) return;
    var processed = Number(data.processed);
    var total = Number(data.total);
    if (!isFinite(processed) || !isFinite(total) || total <= 0) return;
    processed = Math.max(0, Math.min(Math.round(processed), Math.round(total)));
    total = Math.round(total);
    if (processed < this._progressSeen) return;
    this._progressSeen = processed;

    var wrap = this.root.querySelector('[data-aico-confirmation-progress]');
    if (!wrap) return;
    wrap.hidden = false;

    var percent = Math.round((processed / total) * 100);
    var fill = wrap.querySelector('[data-aico-confirmation-progress-fill]');
    if (fill) fill.style.width = percent + '%';
    var track = wrap.querySelector('[data-aico-confirmation-progress-track]');
    if (track) track.setAttribute('aria-valuenow', String(percent));
    var countEl = wrap.querySelector('[data-aico-confirmation-progress-count]');
    if (countEl) {
      var template =
        wrap.getAttribute('data-aico-confirmation-progress-template') ||
        '{{ processed }} / {{ total }}';
      countEl.textContent = template
        .replace(/\{\{\s*processed\s*\}\}/g, String(processed))
        .replace(/\{\{\s*total\s*\}\}/g, String(total));
    }

    // Push the pusher-silence fallback out: the stream is alive.
    if (this._fallbackTimer) {
      clearTimeout(this._fallbackTimer);
      this._fallbackTimer = null;
    }
    this._pusherFallbackArmed = false;
    this.armPusherFallback();
  };

  /**
   * Animated processing → final swap. When the panel currently shows the
   * processing spinner, fade/slide the panel out, run `render` (which swaps
   * the DOM to the confirmed/error state), then fade/slide it back in — the
   * state change reads as a transition, not an abrupt replace. When the panel
   * is not in the processing state (later PDF updates, re-applies) or the
   * user prefers reduced motion, `render` runs immediately with no animation
   * (the CSS classes are also inert under prefers-reduced-motion: reduce).
   */
  Confirmation.prototype._swapToState = function (render) {
    var root = this.root;
    var reduced = false;
    try {
      reduced = global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (_) {}
    var processing = root.classList.contains('aico-preorder-confirmation--processing');
    if (!processing || reduced) {
      render();
      return;
    }
    // A newer payload while mid-swap just replaces what gets rendered.
    if (this._swapping) {
      this._pendingSwapRender = render;
      return;
    }
    this._swapping = true;
    this._pendingSwapRender = render;
    root.classList.add('aico-preorder-confirmation--swap-out');
    var self = this;
    setTimeout(function () {
      var run = self._pendingSwapRender;
      self._pendingSwapRender = null;
      if (run) run();
      root.classList.remove('aico-preorder-confirmation--swap-out');
      root.classList.add('aico-preorder-confirmation--swap-in');
      setTimeout(function () {
        root.classList.remove('aico-preorder-confirmation--swap-in');
        self._swapping = false;
      }, 300);
    }, 190);
  };

  /** Render the full confirmation from a payload (poll or broadcast-merged). */
  Confirmation.prototype.apply = function (confirmation) {
    if (!confirmation || typeof confirmation !== 'object') return;

    // The queued submit failed with nothing committed (pre-batch stock check,
    // batch failure with a full compensation): no details will ever arrive for
    // this cart — show the error state instead of spinning forever. Shares the
    // animated swap with the confirmed path.
    if (confirmation.error) {
      this._swapToState(this.renderError.bind(this));
      return;
    }

    // Submit/edit still running on the queue: show (or keep) the processing
    // spinner — the payload carries no details yet, only the pusher block.
    // Subscribe now so PreorderProcessedEvent can flip us to the real data.
    if (confirmation.processing) {
      this._sawProcessing = true;
      this.root.hidden = false;
      this.renderPending();
      if (!this._pusherSubscribed && confirmation.pusher) {
        this.subscribePusher(confirmation.pusher);
      }
      return;
    }

    // Flags flip synchronously (scheduleNextPoll reads them right after this
    // returns); only the DOM swap below is deferred by the animation.
    this.detailLoaded = true;
    this._errored = false;
    var self = this;
    this._swapToState(function () {
      self.renderDetails(confirmation);
    });
  };

  /** The confirmed-state DOM swap (called directly or via the animated swap). */
  Confirmation.prototype.renderDetails = function (confirmation) {
    this.root.classList.remove('aico-preorder-confirmation--error');
    this.clearPending();
    this.root.hidden = false;

    var root = this.root;

    // On an edit of an already-submitted preorder the backend sets is_update;
    // show "updated, not a new preorder; the new document replaces the old"
    // copy instead of the first-submit thank-you.
    var isUpdate = !!confirmation.is_update;
    var headerEl = root.querySelector('[data-aico-confirmation-header]');
    if (headerEl) headerEl.textContent = copyOf(root, isUpdate ? 'update-title' : 'title', 'Thank you');

    var messageEl = root.querySelector('[data-aico-confirmation-message]');
    if (messageEl) messageEl.textContent = copyOf(root, isUpdate ? 'update-message' : 'message', '');

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

    // The discount row stays visible and shows an en-dash when no discount was
    // applied (matches the confirmation mockup, where "Angewandter Rabatt" is
    // always a line in the totals column).
    var discountWrap = root.querySelector('[data-aico-confirmation-discount-row]');
    if (discountWrap) {
      discountWrap.hidden = false;
      this.setText(
        '[data-aico-confirmation-discount]',
        confirmation.discount_percent
          ? Number(confirmation.discount_percent).toFixed(0) + '%'
          : '–',
      );
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
    // Open the PDF in a new tab by default (no `download` attribute) so the
    // browser's PDF viewer shows it; the user can still download from there.
    area.innerHTML =
      '<a class="aico-preorder-confirmation-pdf-link aico-btn aico-btn-primary" href="' +
      escapeHtml(fileUrl) +
      '" target="_blank" rel="noopener">' +
      escapeHtml(label) +
      '</a>';
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (this._fallbackTimer) {
      clearTimeout(this._fallbackTimer);
      this._fallbackTimer = null;
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
    var processedEventName = config.processed_event || 'PreorderProcessedEvent';
    var progressEventName = config.progress_event || 'PreorderSubmitProgressEvent';
    this.loadPusher()
      .then(function (Pusher) {
        if (!Pusher) { self.resumePolling(); return; } // script blocked → poll
        try {
          self._pusherClient = new Pusher(config.key, {
            cluster: config.cluster || 'mt1',
            forceTLS: true,
          });
          var channel = self._pusherClient.subscribe(config.channel);
          // Channel confirmed live → pusher is now the source of truth: stop
          // polling and reconcile once (covers a PDF that landed during setup).
          channel.bind('pusher:subscription_succeeded', function () {
            self._pusherActive = true;
            self.stopPolling();
            if (!self.pdfReady) self.poll();
          });
          // The async submit/edit finished processing — the details are final;
          // re-fetch the confirmation to swap the processing spinner for them.
          channel.bind(processedEventName, function () {
            self.poll();
          });
          // Live first-submit progress → drive the processing-state bar.
          channel.bind(progressEventName, function (data) {
            self.applyProgress(data);
          });
          channel.bind(eventName, function (data) {
            if (data && data.fileUrl && self.detailLoaded) {
              self.showPdfLink(data.fileUrl, data.fileName);
            } else {
              // No locator in the event, or the details themselves are still
              // pending (processed event missed?) — re-poll for the full block.
              self.poll();
            }
          });
          // Socket trouble → resume the polling fallback immediately.
          self._pusherClient.connection.bind('unavailable', function () { self.resumePolling(); });
          self._pusherClient.connection.bind('failed', function () { self.resumePolling(); });
        } catch (_) {
          self.resumePolling();
        }
      })
      .catch(function () {
        self.resumePolling();
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
