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
 * Transport is PUSHER-first with a POLL SAFETY NET while processing. When the
 * backend has an active broadcast driver the confirmation payload carries a
 * `pusher` block ({ key, cluster, channel, event }) assembled from aico's
 * broadcasting config; the submit progress, the processed signal and the PDF
 * then arrive as broadcasts. But as long as the panel shows the PROCESSING
 * state it ALSO polls the endpoint (POLL_INTERVAL_MS) — a submit or edit
 * mutates a live preorder, so its terminal states (details or the error card)
 * must reach the shopper even when the socket never connects or a worker dies
 * mid-pipeline. The poll stops the moment a terminal state renders; after the
 * details land the PDF reveal is socket/reload-driven as before.
 *
 * The wait message is a single line that each backend STAGE replaces in place
 * (checking → saving → updating → finalizing, from the progress payload's
 * `stage`), exactly like the old processing → almost-there swap — deliberately
 * NOT the checkout's step checklist. During `updating`, processed/total counts
 * REAL work units (changed + newly-added lines on an edit; all lines on a
 * first submit). A `failed` stage — or an { error: true } payload — swaps to
 * the error card. When nothing has moved for a while the message swaps to the
 * "taking longer than expected" copy until progress resumes.
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
  // Backend stages, in order — the wait message is replaced per stage and only
  // ever moves FORWARD (events can arrive out of order; a message that jumps
  // back reads as a bug). `failed` is terminal and handled separately.
  var PROGRESS_STAGES = ['checking', 'saving', 'updating', 'finalizing'];
  // Poll cadence while the panel shows the processing state. The socket is the
  // fast path; this is the guarantee. Capped so an abandoned tab does not poll
  // forever — the cap comfortably covers the backend's 15-minute
  // stale-processing fallback, whose answer the last polls pick up.
  var POLL_INTERVAL_MS = 2500;
  var POLL_MAX_ATTEMPTS = 380;
  // No stage/count movement for this long → swap in the "taking longer than
  // expected" copy (cleared again by the next movement).
  var DELAYED_AFTER_MS = 60000;

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
    value = AicoUtils.roundForDisplay(value, currency) || 0;
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
    this._progressTotal = 0; // work-unit total, once any counter has surfaced
    this._almostThere = false; // every work unit counted; only the wrap-up left
    this._stage = ''; // furthest backend stage rendered (forward-only)
    this._delayed = false; // no movement for DELAYED_AFTER_MS — calmer copy shown
    this._sawProcessing = false; // a processing block was seen at least once
    this._processingSince = 0; // when the processing state first rendered
    this._errored = false; // terminal error state rendered — transports stopped
    this._pollTimer = null; // processing-state safety-net poll (see header)
    this._pollAttempts = 0;
    this._pusherClient = null;
    this._pusherSubscribed = false; // attempted a subscription
  }

  /** Start with a known confirmation payload (e.g. seeded from submit response). */
  Confirmation.prototype.start = function (seed) {
    if (!this.confirmationUrl || !this.cartId) {
      // Nothing to confirm against, and nothing ever will be — no fetch is
      // possible without a cart id. Say that plainly instead of resolving the
      // server-rendered processing state into the generic thank-you copy,
      // which left the success skeleton standing behind it: "…" for the order
      // number, an em dash for every total, and a PDF spinner that spun
      // forever. See renderMissing().
      this.renderMissing();
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
    if (!this._processingSince) this._processingSince = Date.now();
    var headerEl = this.root.querySelector('[data-aico-confirmation-header]');
    if (headerEl) {
      headerEl.textContent = copyOf(this.root, 'processing-title', 'We are processing your preorder…');
    }
    this.renderProcessingMessage();
    this.setPdfState('generating');
    // Safety-net poll for every way of arriving in the wait state (fresh
    // submit, reload mid-processing, server-rendered processing shell). No-op
    // when already scheduled.
    this._schedulePoll();
  };

  /**
   * Processing-state safety net: as long as the panel is waiting, re-read the
   * confirmation every POLL_INTERVAL_MS so the terminal states — the details
   * or the error card — land even when no broadcast ever arrives (socket
   * blocked, worker died, driver off). Self-terminating: stops on a terminal
   * state, and the attempt cap outlives the backend's own stale-processing
   * fallback, whose stale-but-stable answer the last polls pick up.
   */
  Confirmation.prototype._schedulePoll = function () {
    if (this._pollTimer || this._errored || this.detailLoaded) return;
    if (this._pollAttempts >= POLL_MAX_ATTEMPTS) return;
    var self = this;
    this._pollTimer = setTimeout(function () {
      self._pollTimer = null;
      if (self._errored || self.detailLoaded) return;
      self._pollAttempts += 1;
      // Nothing has moved for a while — swap in the calmer "taking longer
      // than expected" copy until progress resumes (_renderProgress clears it).
      var lastMovement = Math.max(self._lastProgressAt, self._processingSince);
      if (!self._delayed && lastMovement && Date.now() - lastMovement > DELAYED_AFTER_MS) {
        self._delayed = true;
        self.renderProcessingMessage();
      }
      self.fetchConfirmation();
      self._schedulePoll();
    }, POLL_INTERVAL_MS);
  };

  /**
   * The single wait-message line under the processing title — each state
   * REPLACES the previous text in place (the panel's long-standing behavior;
   * deliberately not a step checklist). Written through a helper because
   * renderPending() runs again on every processing payload, and a plain
   * assignment there would keep undoing the current stage's swap.
   *
   * Priority: "taking longer than expected" (no movement lately) → the
   * finalizing stage → "almost there" (all work units counted, wrap-up
   * pending) → the current backend stage's copy → the generic processing copy.
   */
  Confirmation.prototype.renderProcessingMessage = function () {
    var messageEl = this.root.querySelector('[data-aico-confirmation-message]');
    if (!messageEl) return;
    var fallback = copyOf(this.root, 'processing-message', '');
    if (this._delayed) {
      messageEl.textContent = copyOf(this.root, 'delayed', fallback);
      return;
    }
    if (this._stage === 'finalizing') {
      messageEl.textContent = copyOf(this.root, 'stage-finalizing', copyOf(this.root, 'almost-there', fallback));
      return;
    }
    if (this._almostThere) {
      messageEl.textContent = copyOf(this.root, 'almost-there', fallback);
      return;
    }
    if (this._stage) {
      var stageCopy = copyOf(this.root, 'stage-' + this._stage, '');
      if (stageCopy) {
        messageEl.textContent = stageCopy;
        return;
      }
    }
    messageEl.textContent = fallback;
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
    // A failed EDIT keeps the previously submitted preorder — say that,
    // instead of the first-submit copy's "your preorder was not placed".
    var isUpdate = !!this._errorIsUpdate;
    var fallbackTitle = 'We could not process your preorder';
    var fallbackMessage = 'Something went wrong while processing your preorder. Please go back to the preorder page and try again.';
    var headerEl = this.root.querySelector('[data-aico-confirmation-header]');
    if (headerEl) {
      headerEl.textContent = isUpdate
        ? copyOf(this.root, 'update-error-title', copyOf(this.root, 'error-title', fallbackTitle))
        : copyOf(this.root, 'error-title', fallbackTitle);
    }
    var messageEl = this.root.querySelector('[data-aico-confirmation-message]');
    if (messageEl) {
      messageEl.textContent = isUpdate
        ? copyOf(this.root, 'update-error-message', copyOf(this.root, 'error-message', fallbackMessage))
        : copyOf(this.root, 'error-message', fallbackMessage);
    }
  };

  /**
   * Terminal "nothing to show" state: the panel was opened without a cart id,
   * so there is no preorder to confirm and never will be. Reached by a bare
   * visit to /preorder/thank-you, an old bookmark, and — until the locale
   * switcher stopped dropping the query string — every language change made
   * on a real confirmation page.
   *
   * Deliberately NOT the --error state: nothing failed. The preorder the
   * shopper is looking for was very likely placed fine; we simply were not
   * told which one. So it borrows --error's job of hiding the detail
   * placeholders but keeps the medallion visible, flipped to the warning
   * disc, and points at the orders list rather than apologising for a failure
   * that did not happen.
   */
  Confirmation.prototype.renderMissing = function () {
    this.clearPending();
    this.root.hidden = false;
    this.root.classList.add('aico-preorder-confirmation--missing');
    var status = this.root.querySelector('[data-aico-confirmation-status]');
    if (status) status.classList.add('aico-ty-status--warn');
    var headerEl = this.root.querySelector('[data-aico-confirmation-header]');
    if (headerEl) {
      headerEl.textContent = copyOf(this.root, 'missing-title', 'No preorder reference');
    }
    var messageEl = this.root.querySelector('[data-aico-confirmation-message]');
    if (messageEl) {
      messageEl.textContent = copyOf(
        this.root,
        'missing-message',
        'This page needs a preorder reference to show a confirmation, and the link you opened did not carry one. Head back to the preorder page to see your preorders.',
      );
    }
  };

  /**
   * Fetch the confirmation block: on arrival, on PreorderProcessedEvent, and
   * from the processing-state safety-net poll (_schedulePoll). Idempotent —
   * apply() folds whatever comes back into the current state.
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
    // Terminal failure broadcast (FailPreorderEdit / a compensated submit):
    // skip the dwell queue and show the error card — the marker also reaches
    // the poll via { error: true }, whichever lands first wins.
    if (String(data.stage || '') === 'failed') {
      this._swapToState(this.renderError.bind(this));
      return;
    }
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

    // Stage first: it may arrive with no counter at all (checking/saving, or a
    // no-op edit that never seeds one). Forward-only — see PROGRESS_STAGES.
    var incomingStage = String(data.stage || '');
    if (PROGRESS_STAGES.indexOf(incomingStage) > PROGRESS_STAGES.indexOf(this._stage)) {
      this._stage = incomingStage;
      this._delayed = false; // movement — drop the "taking longer" copy
      this._lastProgressAt = Date.now();
      this.renderProcessingMessage();
    }

    var processed = Number(data.processed);
    var total = Number(data.total);
    if (!isFinite(processed) || !isFinite(total) || total <= 0) return;
    processed = Math.max(0, Math.min(Math.round(processed), Math.round(total)));
    total = Math.round(total);
    if (processed < this._progressSeen) return;
    if (processed > this._progressSeen && this._delayed) {
      this._delayed = false;
      this.renderProcessingMessage();
    }
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

    // The queued submit/edit failed: no fresh details will arrive for this
    // cart — show the error state instead of spinning forever. Shares the
    // animated swap with the confirmed path. is_update selects the truthful
    // copy (a failed edit keeps the previously submitted preorder).
    if (confirmation.error) {
      this._errorIsUpdate = !!confirmation.is_update;
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
