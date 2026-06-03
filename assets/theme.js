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
})();
