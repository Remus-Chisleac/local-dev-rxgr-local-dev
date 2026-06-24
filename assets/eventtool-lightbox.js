/*
 * Events & ads tool — image-card zoom lightbox (shared across all 4 forms).
 *
 * Auto-injects a magnifier(+) button into the top-right of every image card
 * (.et-card with an .et-card-img), including cards rendered dynamically by the
 * form engines (via MutationObserver). Clicking it opens a single-image modal
 * styled like the preorder gallery. No per-form wiring needed beyond loading
 * this script.
 */
(function () {
  'use strict';

  var ZOOM_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="11" cy="11" r="8"></circle>' +
    '<line x1="21" x2="16.65" y1="21" y2="16.65"></line>' +
    '<line x1="11" x2="11" y1="8" y2="14"></line>' +
    '<line x1="8" x2="14" y1="11" y2="11"></line>' +
    '</svg>';

  var box, imgEl, lastFocus;

  function ensureBox() {
    if (box) { return; }
    box = document.createElement('div');
    box.className = 'et-lightbox';
    box.hidden = true;
    box.innerHTML =
      '<div class="et-lightbox-backdrop" data-et-lb-close></div>' +
      '<div class="et-lightbox-dialog" role="dialog" aria-modal="true" aria-label="Bild">' +
      '<button type="button" class="et-lightbox-close" data-et-lb-close aria-label="Schliessen">&times;</button>' +
      '<div class="et-lightbox-stage"><img class="et-lightbox-img" alt=""></div>' +
      '</div>';
    document.body.appendChild(box);
    imgEl = box.querySelector('.et-lightbox-img');
    box.addEventListener('click', function (e) {
      if (e.target && e.target.hasAttribute('data-et-lb-close')) { close(); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && box && !box.hidden) { close(); }
    });
  }

  function open(src, alt) {
    if (!src) { return; }
    ensureBox();
    lastFocus = document.activeElement;
    imgEl.src = src;
    imgEl.alt = alt || '';
    box.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    var closeBtn = box.querySelector('.et-lightbox-close');
    if (closeBtn) { closeBtn.focus(); }
  }

  function close() {
    if (!box) { return; }
    box.hidden = true;
    imgEl.src = '';
    document.documentElement.style.overflow = '';
    if (lastFocus && lastFocus.focus) { lastFocus.focus(); }
  }

  function inject(card) {
    if (!card || !card.querySelector) { return; }
    var img = card.querySelector('.et-card-img');
    if (!img || card.querySelector('.et-card-zoom')) { return; } // image cards only; once
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'et-card-zoom';
    btn.setAttribute('aria-label', 'Bild vergrössern');
    btn.innerHTML = ZOOM_SVG;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation(); // don't toggle the card selection
      var current = card.querySelector('.et-card-img');
      if (current && current.src) {
        var title = card.querySelector('.et-card-title');
        open(current.src, title ? current.alt || title.textContent : current.alt);
      }
    });
    card.appendChild(btn);
  }

  function scan(root) {
    var cards = (root || document).querySelectorAll('.et-card');
    for (var i = 0; i < cards.length; i++) { inject(cards[i]); }
  }

  function boot() {
    scan(document);
    if ('MutationObserver' in window) {
      var mo = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
          var added = mutations[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            var n = added[j];
            if (!n || n.nodeType !== 1) { continue; }
            if (n.classList && n.classList.contains('et-card')) { inject(n); }
            if (n.querySelectorAll) { scan(n); }
          }
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
