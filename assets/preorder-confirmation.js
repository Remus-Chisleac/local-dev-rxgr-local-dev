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
 * Transport is PUSHER-driven. When the backend has an active broadcast driver
 * the confirmation payload carries a `pusher` block ({ key, cluster, channel,
 * event }) assembled from aico's broadcasting config, and `confirmation.js` is
 * then fetched exactly TWICE for a submit: once on arrival (initial data +
 * the channel to subscribe to) and once on PreorderProcessedEvent (the final
 * details). Everything in between — the submit progress and the PDF — arrives
 * as broadcasts; no timer runs while the socket is healthy.
 *
 * There is deliberately NO retry/poll loop. A dropped socket message is not
 * worth defending against here: this panel's state is entirely re-derivable
 * from the endpoint, so reloading the page shows whatever is true at that
 * moment. A deployment with no broadcast driver therefore leaves the wait state
 * up until the shopper reloads — the same outcome, one keystroke later.
 *
 * Backend contract (GET /preorder/cart/confirmation.js?cart_id=):
 *   { aico_confirmation: {
 *       processing: false,
 *       order_numbers: string[], preorder_id, cart_id, status,
 *       delivery_address, item_count, discount_percent|null,
 *       total_amount (net of the discount, excl. VAT), total_amount_with_vat,
 *       per_date: [ { order_number, delivery_date, quantity, total_amount,
 *                     total_amount_with_vat } ],
 *       pdf: { file_url|null, file_name|null }, pdf_ready
 *     } | null }
 *
 * While a dispatched submit/edit is still running, the backend instead returns
 * a slim processing block — { processing: true, cart_id, status, pusher } —
 * NEVER the previous submission's stale orders/PDF. The panel then shows a
 * "we are processing your preorder" spinner state and re-fetches when
 * PreorderProcessedEvent arrives on the pusher channel.
 * Both FIRST submits and edit re-submits land here the same way: the preorder
 * page redirects right after the submit is queued (no status checks there).
 *
 * If the queued submit fails with nothing committed, the backend returns
 * { processing: false, error: true, cart_id, status } — the panel then swaps
 * the spinner for an error state instead of waiting for details forever. The
 * same happens when a processing block was seen but a later fetch reports no
 * confirmation at all (e.g. a version conflict left the cart DRAFT).
 *
 * Framework-free, matches the other preorder-*.js modules (no Alpine).
 */
(function (global) {
  'use strict';

  // Circumference of the status medallion's ring (r=24 on the 52×52 viewBox),
  // matching the stroke-dasharray theme.css sets on it.
  var RING_CIRCUMFERENCE = 151;
  // Minimum time a progress state stays on screen before the next one replaces
  // it. A small submit finishes in about a second, so without this the count,
  // the determinate arc and the "almost there" state all land in the same
  // handful of frames and the shopper sees none of them — the page just blinks
  // from spinner to checkmark. Updates that arrive inside the window are not
  // dropped, only deferred (the newest wins).
  var MIN_PROGRESS_DWELL_MS = 550;

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

    this.pdfReady = false;
    this.detailLoaded = false;
    this._progressSeen = 0; // highest processed count rendered (monotonic guard)
    this._lastProgressAt = 0; // when the last progress state was painted
    this._progressQueue = []; // states waiting out the dwell window, in order
    this._dwellTimer = null;
    this._progressTotal = 0; // line-item total, once any counter has surfaced
    this._almostThere = false; // every line item counted; only the wrap-up left
    this._sawProcessing = false; // a processing block was seen at least once
    this._errored = false; // terminal error state rendered — transports stopped
    this._pusherClient = null;
    this._pusherSubscribed = false; // attempted a subscription
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
    // payload offers a pusher channel, no further fetch is scheduled and the
    // broadcasts drive everything from there.
    this.fetchConfirmation();
  };

  /**
   * The "we are processing your preorder" state: the status medallion sweeps,
   * processing copy, details hidden (via the --processing class) so a re-submit
   * never shows the PREVIOUS submission's numbers while the queue is still
   * merging the new one.
   */
  Confirmation.prototype.renderPending = function () {
    this.root.classList.add('aico-preorder-confirmation--processing');
    this.root.setAttribute('aria-busy', 'true');
    var headerEl = this.root.querySelector('[data-aico-confirmation-header]');
    if (headerEl) {
      headerEl.textContent = copyOf(this.root, 'processing-title', 'We are processing your preorder…');
    }
    this.renderProcessingMessage();
    this.setPdfState('generating');
  };

  /**
   * The sub-copy under the processing title. Written through a helper because
   * renderPending() runs again on every processing payload, and a plain
   * assignment there would keep undoing the "almost there" swap.
   */
  Confirmation.prototype.renderProcessingMessage = function () {
    var messageEl = this.root.querySelector('[data-aico-confirmation-message]');
    if (!messageEl) return;
    messageEl.textContent = this._almostThere
      ? copyOf(this.root, 'almost-there', copyOf(this.root, 'processing-message', ''))
      : copyOf(this.root, 'processing-message', '');
  };

  Confirmation.prototype.clearPending = function () {
    this.root.classList.remove('aico-preorder-confirmation--processing');
    this.root.removeAttribute('aria-busy');
    // Hand the medallion back to its own confirmed sequence: a leftover
    // determinate arc would otherwise sit under the green ring being drawn.
    this.setStatusProgress(0, 0);
  };

  /**
   * Terminal error state: the queued submit failed and no details will arrive.
   * Swap the spinner for the error copy — a spinner that never resolves is
   * worse than bad news.
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
  };

  /**
   * Fetch the confirmation block. Called exactly twice for a normal submit — on
   * arrival (initial state + the pusher channel) and on PreorderProcessedEvent
   * (the final details). Nothing here schedules a repeat: the server pushes.
   */
  Confirmation.prototype.fetchConfirmation = function () {
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
      })
      .catch(function () {
        // A dropped request is not worth a retry loop: this panel's state is
        // fully re-derivable, so a reload shows whatever is true at that moment.
      });
  };

  /**
   * Live submit progress — a { processed, total } line-item pair, from the
   * confirmation payload's processing block (the first one the page sees, so
   * the count is up before any chunk has finished) or from a throttled
   * PreorderSubmitProgressEvent. Both submit flows emit it: the first submit's
   * chunk batch and the edit merge.
   *
   * Reveals the count under the medallion and drives the ring. Only meaningful
   * while the panel still shows the processing state. Progress never moves
   * backwards (pusher gives no ordering promise), and a live stream re-arms the
   * fallback watchdog — events prove the socket is healthy, so it should not
   * fire mid-submit.
   */
  Confirmation.prototype.applyProgress = function (data) {
    // Deliberately NOT gated on detailLoaded: apply() sets that flag before it
    // hands the confirmed swap to _swapToState, and the swap waits for this
    // queue to drain — gating here would silently discard the very states the
    // wait was extended for. The panel still showing --processing is the real
    // condition, and _renderProgress checks it.
    if (this._errored || !data) return;
    this._progressQueue.push(data);
    // A three-event submit (0/X, part-way, X/X) can land inside a couple of
    // frames, so states are QUEUED rather than overwritten — collapsing to the
    // newest would skip the part-way state, which is the only one that ever
    // shows the ring as a percentage. Longer bursts collapse to first+last so
    // the queue can never lag more than one extra dwell behind reality.
    if (this._progressQueue.length > 2) {
      this._progressQueue = [this._progressQueue[0], this._progressQueue[this._progressQueue.length - 1]];
    }
    this._drainProgress();
  };

  /** Paint the next queued progress state, then hold it for its dwell. */
  Confirmation.prototype._drainProgress = function () {
    if (this._dwellTimer || !this._progressQueue.length) return;
    var waited = this._lastProgressAt ? Date.now() - this._lastProgressAt : MIN_PROGRESS_DWELL_MS;
    if (waited < MIN_PROGRESS_DWELL_MS) {
      var self = this;
      this._dwellTimer = setTimeout(function () {
        self._dwellTimer = null;
        self._drainProgress();
      }, MIN_PROGRESS_DWELL_MS - waited);
      return;
    }
    this._renderProgress(this._progressQueue.shift());
    if (this._progressQueue.length) this._drainProgress();
  };

  /** Paint one progress state. Always reached through applyProgress()'s pacing. */
  Confirmation.prototype._renderProgress = function (data) {
    if (this._errored || !data) return;
    if (!this.root.classList.contains('aico-preorder-confirmation--processing')) return;
    var processed = Number(data.processed);
    var total = Number(data.total);
    if (!isFinite(processed) || !isFinite(total) || total <= 0) return;
    processed = Math.max(0, Math.min(Math.round(processed), Math.round(total)));
    total = Math.round(total);
    if (processed < this._progressSeen) return;
    this._progressSeen = processed;
    this._progressTotal = total;
    this._lastProgressAt = Date.now();

    var wrap = this.root.querySelector('[data-aico-confirmation-progress]');
    if (wrap) {
      wrap.hidden = false;
      wrap.setAttribute('aria-valuenow', String(Math.round((processed / total) * 100)));
      var countEl = wrap.querySelector('[data-aico-confirmation-progress-count]');
      if (countEl) {
        var template =
          wrap.getAttribute('data-aico-confirmation-progress-template') ||
          '{{ processed }} / {{ total }}';
        countEl.textContent = template
          .replace(/\{\{\s*processed\s*\}\}/g, String(processed))
          .replace(/\{\{\s*total\s*\}\}/g, String(total));
      }
    }

    this.setStatusProgress(processed, total);

    // Every line item is counted, but the submit is not done — the totals, the
    // documents and the PDF still have to be built. Say so, rather than leaving
    // a completed ring implying the page is stuck.
    if (processed >= total && !this._almostThere) {
      this._almostThere = true;
      this.renderProcessingMessage();
    }
  };

  /**
   * Point the status medallion's orange arc at `processed / total`.
   *
   * Determinate only strictly BETWEEN the ends: at 0 there is nothing to show
   * yet, and a full circle that then sits there while the wrap-up runs reads as
   * a frozen page — both of those keep the indeterminate sweep instead. The
   * dash offset is computed here rather than in CSS so the ring never depends
   * on calc() inside an SVG geometry property.
   */
  Confirmation.prototype.setStatusProgress = function (processed, total) {
    var status = this.root.querySelector('[data-aico-confirmation-status]');
    if (!status) return;
    var arc = status.querySelector('.aico-ty-status-spin');
    if (processed <= 0 || processed >= total) {
      status.classList.remove('aico-ty-status--progress');
      if (arc) arc.style.strokeDashoffset = '';
      return;
    }
    status.classList.add('aico-ty-status--progress');
    if (arc) {
      arc.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - processed / total));
    }
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

    // Let the wait state finish being a wait state. The submit can complete in
    // about a second, and swapping to the confirmed panel the instant the last
    // progress event lands means the 100% / "almost there" step is painted and
    // replaced in the same breath. Flush anything still queued, then hold the
    // swap until that final state has had its dwell.
    var sinceProgress = this._lastProgressAt ? Date.now() - this._lastProgressAt : MIN_PROGRESS_DWELL_MS;
    if (this._progressQueue.length || sinceProgress < MIN_PROGRESS_DWELL_MS) {
      var deferred = this;
      setTimeout(function () {
        deferred._swapToState(render);
      }, this._progressQueue.length ? MIN_PROGRESS_DWELL_MS : Math.max(MIN_PROGRESS_DWELL_MS - sinceProgress, 0));
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

  /** Render the full confirmation from a payload (fetched or broadcast-merged). */
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
      // The counter as the backend has it right now — this is what puts "0 of X"
      // on screen while the first chunk is still running.
      this.applyProgress(confirmation.progress);
      if (!this._pusherSubscribed && confirmation.pusher) {
        this.subscribePusher(confirmation.pusher);
      }
      return;
    }

    // Flags flip synchronously; only the DOM swap below is deferred by the
    // animation and the progress dwell.
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
    // Both totals come from the endpoint already computed (net of the tier
    // discount, and the same figure with VAT). The theme deliberately does no
    // money arithmetic: the discount is a per-line percentage and the VAT rate
    // can differ per line, so neither is derivable from a single total here.
    this.setText(
      '[data-aico-confirmation-total]',
      formatMoney(confirmation.total_amount, this.currency),
    );
    this.setText(
      '[data-aico-confirmation-total-with-vat]',
      confirmation.total_amount_with_vat == null
        ? '—'
        : formatMoney(confirmation.total_amount_with_vat, this.currency),
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
    // on).
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
  };

  /**
   * Optional pusher subscriber. `config` is the backend-sourced block from the
   * confirmation payload ({ key, cluster, channel, event }); aico assembles the
   * channel name and only sends this when its broadcast driver is active. Loaded
   * lazily, once, and failures are swallowed.
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
        if (!Pusher) return; // script blocked — a reload re-derives the state
        try {
          self._pusherClient = new Pusher(config.key, {
            cluster: config.cluster || 'mt1',
            forceTLS: true,
          });
          var channel = self._pusherClient.subscribe(config.channel);
          // Channel confirmed live → pusher is now the source of truth: stop

          channel.bind('pusher:subscription_succeeded', function () {
            // Reconcile ONLY for a PDF that landed while the socket was being
            // set up. While the submit is still processing there is nothing to
            // reconcile — PreorderProcessedEvent carries that news.
            if (self.detailLoaded && !self.pdfReady) self.fetchConfirmation();
          });
          // The async submit/edit finished processing — the details are final;
          // re-fetch the confirmation to swap the processing spinner for them.
          channel.bind(processedEventName, function () {
            self.fetchConfirmation();
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
              // pending (processed event missed?) — fetch the full block.
              self.fetchConfirmation();
            }
          });
        } catch (_) {
          // Subscription failed — the panel keeps its wait state; reloading the
          // page re-derives whatever is true then.
        }
      })
      .catch(function () {});
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
