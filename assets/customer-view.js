// Aico storefront — customer-view ("Endkundenansicht") toggle.
//
// A salesperson-facing switch that hides all prices + sale/discount badges on
// the products listing, brand pages, and PDP so the screen can be shown to an
// end customer. State is client-only (localStorage), mirroring the legacy
// b2b-shop. The active state is telegraphed by a full-width system banner and
// the header eye icon swapping to an eye-off.
//
// Price hiding itself is pure CSS, keyed off the `aico-customer-view` class on
// <html> — so it covers both the server-rendered and the JS-built
// (infinite-scroll) product cards without touching either renderer. The
// <head> bootstrap sets the class before first paint to avoid a flash of
// prices; this script just wires the toggle button and keeps it in sync.

(function () {
  'use strict';

  var STORAGE_KEY = 'customerView';
  var ON_CLASS = 'aico-customer-view';
  var root = document.documentElement;

  function isOn() {
    return root.classList.contains(ON_CLASS);
  }

  function syncButtons(on) {
    var toggles = document.querySelectorAll('[data-aico-customer-view-toggle]');
    for (var i = 0; i < toggles.length; i++) {
      toggles[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function apply(on) {
    root.classList.toggle(ON_CLASS, on);
    try {
      window.localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
    } catch (e) {
      // Private mode / storage disabled — the class still toggles for this page.
    }
    syncButtons(on);
  }

  document.addEventListener('click', function (event) {
    var trigger = event.target && event.target.closest
      ? event.target.closest('[data-aico-customer-view-toggle]')
      : null;
    if (!trigger) {
      return;
    }
    event.preventDefault();
    apply(!isOn());
  });

  // Reflect the pre-paint class state onto the button(s) on load.
  syncButtons(isOn());
})();
