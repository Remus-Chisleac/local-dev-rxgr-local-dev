// Aico storefront — menu panel enhancements.
//
// Open/close, slide animation, scroll-lock and focus for the side panels
// (menu / search) now live in assets/header-panels.js via the
// `$store.panels` Alpine store. This file only progressively enhances the
// *content* of the menu panel: the nav accordion and the contact-card
// auto-collapse. No framework, attaches at load.

(function () {
  'use strict';

  var menu = document.querySelector('[data-aico-menu-panel]');
  if (!menu) {
    return;
  }

  // Auto-collapse the contact card when the user opens a nav collection (a
  // `<details>` group with sub-items) or reaches for the brand picker. Keeps
  // the contact visible when the menu first opens (markup default), then
  // steps out of the way to make room for the expanded sub-items. A plain
  // link row has nothing to make room for — it just navigates — so it must
  // leave the card alone.
  var contact = menu.querySelector('[data-aico-contact]');
  if (contact) {
    var collapseContact = function () {
      if (contact.open) {
        contact.open = false;
      }
    };
    var navRegion = menu.querySelector('.aico-drawer-nav');
    if (navRegion) {
      // `toggle` doesn't bubble, so listen for it in the capture phase.
      navRegion.addEventListener('toggle', function (event) {
        var details = event.target;
        if (details instanceof HTMLDetailsElement
          && details.open
          && details.matches('.aico-drawer-nav-group')) {
          collapseContact();
        }
      }, true);
    }
    var brandPicker = menu.querySelector('.aico-drawer-brand-picker');
    if (brandPicker) {
      brandPicker.addEventListener('click', collapseContact, true);
    }
  }

  // Accordion behaviour for the menu nav `<details>`: at each nesting level
  // only one `.aico-drawer-nav-group` stays open among siblings; closing a
  // branch collapses all nested open groups underneath it. (Brand picker +
  // contact disclosure are not `.aico-drawer-nav-group` and stay native.)
  var drawerNav = menu.querySelector('.aico-drawer-nav');
  if (drawerNav) {
    var navGroupSel = '.aico-drawer-nav-group';

    drawerNav.addEventListener('toggle', function (event) {
      var details = event.target;
      if (!(details instanceof HTMLDetailsElement)) {
        return;
      }
      if (!details.matches(navGroupSel)) {
        return;
      }

      if (!details.open) {
        details.querySelectorAll('.aico-drawer-nav-children ' + navGroupSel).forEach(function (nested) {
          nested.open = false;
        });
        return;
      }

      var parent = details.parentElement;
      if (!parent) {
        return;
      }
      var sibling = parent.firstElementChild;
      while (sibling) {
        var next = sibling.nextElementSibling;
        if (sibling !== details && sibling instanceof HTMLDetailsElement && sibling.matches(navGroupSel)) {
          sibling.open = false;
        }
        sibling = next;
      }
    });
  }

  // Outside-click auto-close for the brand `<details>` dropdown: a click
  // anywhere outside `.aico-drawer-brand-picker` collapses just the dropdown
  // (the menu panel stays open). Mirrors the legacy drawer behaviour.
  var brandPickerEl = menu.querySelector('.aico-drawer-brand-picker');
  var brandDisclosure = brandPickerEl ? brandPickerEl.querySelector('details.aico-disclosure') : null;
  if (brandDisclosure) {
    document.addEventListener('click', function (event) {
      if (!brandDisclosure.open) {
        return;
      }
      var target = event.target;
      if (!(target && target.closest && target.closest('.aico-drawer-brand-picker'))) {
        brandDisclosure.open = false;
      }
    });
  }
})();

// Smart back links: a [data-aico-back] anchor prefers the browser history
// (so "back" returns to the page the shopper actually came from — brand
// page, search, another product …) and only follows its href fallback when
// there is no same-origin page behind it (direct entry, external referrer).
(function () {
  'use strict';

  document.addEventListener('click', function (event) {
    var link = event.target && event.target.closest ? event.target.closest('[data-aico-back]') : null;
    if (!link) {
      return;
    }
    var referrer = document.referrer;
    var sameOrigin = false;
    try {
      sameOrigin = !!referrer && new URL(referrer).origin === window.location.origin;
    } catch (error) {
      sameOrigin = false;
    }
    if (!sameOrigin || referrer === window.location.href) {
      return;
    }
    event.preventDefault();
    if (window.history.length > 1) {
      window.history.back();
    } else {
      // Same-origin referrer but nothing to pop (e.g. opened in a new tab):
      // navigate to the referrer instead of the generic fallback.
      window.location.href = referrer;
    }
  });
})();

// Quantity boxes preselect their contents when focus ENTERS them, so the first
// keystroke replaces the quantity instead of extending it: clicking a size-grid
// cell holding "5" and typing "0" used to leave "50" behind — a tenfold order
// the buyer never asked for. Only the entering focus selects; a second click
// inside the same box still places a caret, so a multi-digit quantity can be
// corrected digit by digit.
(function () {
  'use strict';

  // Every quantity-entry control in the theme: the PDP size matrix, its
  // single-variant and quick-add-drawer variants (data-aico-size-qty), the PDP
  // legacy stepper, the preorder size × date grid and the cart lines.
  var QUANTITY_INPUTS = [
    '[data-aico-size-qty]',
    '[data-aico-qty-input]',
    '[data-aico-preorder-qty]',
    '.aico-qty-input'
  ].join(',');

  // Delegated, because the quick-add drawer, the preorder catalog and the
  // Alpine cart all build (and rebuild) their inputs after load — a per-input
  // listener would need re-attaching on every render.
  document.addEventListener('focusin', function (event) {
    var input = event.target && event.target.closest ? event.target.closest(QUANTITY_INPUTS) : null;
    if (!input || input.disabled || input.readOnly || input.value === '') {
      return;
    }
    input.select();
  });
})();

// Keep the locale switcher pointing at the page as it is NOW. The pill hrefs
// come from `aico_locale_url`, which renders the request's path — but several
// pages rewrite their own URL afterwards without reloading (products-page.js
// pushes the applied facets into the path as `/filter/<id>/<value>`,
// order-history does the same in the query). Switching language then went to
// the page as it looked on load, so a filtered listing came back unfiltered.
//
// Each pill's href and the load-time location share a trailing run of
// segments — the locale-stripped sub-path — and differ only in the head
// (base + locale prefix). So the pill's own head plus whatever the page has
// since made of the live path is the same page in the other locale, without
// the theme having to know the preview prefix or the locale-code mapping.
(function () {
  'use strict';

  function sharedTailLength(pathA, pathB) {
    var a = pathA.split('/');
    var b = pathB.split('/');
    var shared = 0;
    while (shared < a.length && shared < b.length
      && a[a.length - 1 - shared] === b[b.length - 1 - shared]) {
      shared++;
    }
    return shared;
  }

  function headOf(path, tailLength) {
    var segments = path.split('/');
    return segments.slice(0, segments.length - tailLength).join('/');
  }

  function liveQuery() {
    // `locale` is dropped for the same reason the filter drops it: since the
    // locale lives in the path prefix, a stale param would override it.
    var params = new URLSearchParams(window.location.search);
    params.delete('locale');
    var query = params.toString();
    return query ? '?' + query : '';
  }

  function start() {
    var options = document.querySelectorAll('.aico-locale-pill-option');
    if (!options.length) {
      return;
    }
    var loadPath = window.location.pathname;
    var pills = [];
    for (var i = 0; i < options.length; i++) {
      var rendered = options[i].getAttribute('href');
      if (!rendered) {
        continue;
      }
      var tail = sharedTailLength(new URL(rendered, window.location.href).pathname, loadPath);
      pills.push({
        link: options[i],
        head: headOf(new URL(rendered, window.location.href).pathname, tail),
        loadHead: headOf(loadPath, tail),
      });
    }

    var retarget = function () {
      var live = window.location.pathname;
      pills.forEach(function (pill) {
        // The page navigated somewhere the rendered href says nothing about
        // (shouldn't happen — a real navigation re-renders the pill) — leave
        // the server-rendered href alone rather than guess.
        if (live.indexOf(pill.loadHead) !== 0) {
          return;
        }
        pill.link.setAttribute(
          'href',
          pill.head + live.slice(pill.loadHead.length) + liveQuery() + window.location.hash
        );
      });
    };

    // Capture phase so the href is current before the click navigates;
    // `auxclick` covers middle-click / open-in-new-tab.
    document.addEventListener('click', retarget, true);
    document.addEventListener('auxclick', retarget, true);
    window.addEventListener('popstate', retarget);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
