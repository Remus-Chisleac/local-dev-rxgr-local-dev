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

  // Auto-collapse the contact card when the user reaches for the nav list
  // or the brand picker. Keeps the contact visible when the menu first
  // opens (markup default), then steps out of the way.
  var contact = menu.querySelector('[data-aico-contact]');
  if (contact) {
    var collapseContact = function () {
      if (contact.open) {
        contact.open = false;
      }
    };
    var navRegion = menu.querySelector('.aico-drawer-nav');
    if (navRegion) {
      navRegion.addEventListener('click', collapseContact, true);
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
