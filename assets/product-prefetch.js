// Product card hover/focus prefetch.
//
// When the shopper hovers (or focuses, or touches) a product card link,
// prefetch the product-detail document so the navigation is near-instant.
// Delegated on the document so it covers every card surface — products
// listing (incl. JS infinite-scroll cards), brand page, content pages —
// with no per-card wiring. Each URL is prefetched at most once.
//
// Respects the user's connection: skipped under Save-Data or on slow
// (2g) connections so we never waste a metered/constrained link.

(function () {
  'use strict';

  var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn) {
    if (conn.saveData) {
      return;
    }
    if (typeof conn.effectiveType === 'string' && /(^|-)2g$/.test(conn.effectiveType)) {
      return;
    }
  }

  var prefetched = {};

  function prefetch(url) {
    if (!url || prefetched[url]) {
      return;
    }
    prefetched[url] = true;
    var link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = url;
    link.as = 'document';
    document.head.appendChild(link);
  }

  function cardLinkFrom(target) {
    if (!target || !target.closest) {
      return null;
    }
    var a = target.closest('.aico-product-card-link');
    if (!a || !a.href) {
      return null;
    }
    // Same-origin only — never prefetch off to another host.
    if (a.origin && a.origin !== window.location.origin) {
      return null;
    }
    return a.href;
  }

  function onIntent(e) {
    var url = cardLinkFrom(e.target);
    if (url) {
      prefetch(url);
    }
  }

  // pointerover covers mouse + pen hover; focusin covers keyboard; touchstart
  // gives mobile a head start on tap. All bubble, so document-level delegation
  // catches every card; all passive — never block the UI.
  document.addEventListener('pointerover', onIntent, { passive: true });
  document.addEventListener('focusin', onIntent, { passive: true });
  document.addEventListener('touchstart', onIntent, { passive: true });
})();
