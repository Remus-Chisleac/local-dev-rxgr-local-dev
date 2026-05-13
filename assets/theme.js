// Aico storefront — minimal client-side glue.
// Right-side drawer open/close, focus trap, scroll lock, ESC + outside
// click. No framework. Lazily picks up triggers from the DOM at load
// time so the same script powers nav and (later) search.

(function () {
  'use strict';

  var drawer = document.querySelector('[data-aico-drawer]');
  if (!drawer) {
    return;
  }
  var sheet = drawer.querySelector('.aico-drawer-sheet');
  var triggers = document.querySelectorAll('[data-aico-menu-trigger]');
  var closers = drawer.querySelectorAll('[data-aico-drawer-close]');
  var lastTrigger = null;

  function focusableInside(root) {
    return Array.prototype.slice.call(
      root.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter(function (el) {
      return el.offsetParent !== null || el === document.activeElement;
    });
  }

  function lockScroll() {
    document.documentElement.classList.add('aico-no-scroll');
    document.body.classList.add('aico-no-scroll');
  }

  function unlockScroll() {
    document.documentElement.classList.remove('aico-no-scroll');
    document.body.classList.remove('aico-no-scroll');
  }

  function open(trigger) {
    if (drawer.dataset.aicoOpen === 'true') {
      return;
    }
    lastTrigger = trigger || document.activeElement;
    drawer.hidden = false;
    // Force a reflow so the open class triggers the slide transition.
    // eslint-disable-next-line no-unused-expressions
    drawer.offsetHeight;
    drawer.dataset.aicoOpen = 'true';
    drawer.classList.add('aico-drawer-open');
    triggers.forEach(function (t) {
      t.setAttribute('aria-expanded', 'true');
    });
    lockScroll();
    // Defer focus until the sheet is on screen so VoiceOver picks it up.
    setTimeout(function () {
      var initial = drawer.querySelector('[data-aico-drawer-close]');
      if (initial) {
        initial.focus();
      } else if (sheet) {
        sheet.focus();
      }
    }, 30);
  }

  function close() {
    if (drawer.dataset.aicoOpen !== 'true') {
      return;
    }
    drawer.dataset.aicoOpen = 'false';
    drawer.classList.remove('aico-drawer-open');
    triggers.forEach(function (t) {
      t.setAttribute('aria-expanded', 'false');
    });
    unlockScroll();
    // Wait for the slide-out transition to finish before hiding the
    // node so screen readers don't surface the closed sheet.
    setTimeout(function () {
      drawer.hidden = true;
    }, 220);
    if (lastTrigger && typeof lastTrigger.focus === 'function') {
      lastTrigger.focus();
    }
  }

  function trapFocus(event) {
    if (event.key !== 'Tab' || drawer.dataset.aicoOpen !== 'true') {
      return;
    }
    var focusables = focusableInside(drawer);
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  triggers.forEach(function (trigger) {
    trigger.addEventListener('click', function (event) {
      event.preventDefault();
      open(trigger);
    });
  });

  closers.forEach(function (closer) {
    closer.addEventListener('click', function (event) {
      event.preventDefault();
      close();
    });
  });

  // Inner-link clicks close the drawer so the next page renders without
  // it visible. The form-submit case is handled implicitly by the page
  // navigation that follows.
  drawer.addEventListener('click', function (event) {
    var anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (anchor && drawer.contains(anchor)) {
      close();
    }
  });

  // Auto-collapse the contact card when the user interacts with the
  // nav list or the brand picker. Keeps the contact visible when the
  // drawer first opens (markup default), then steps out of the way as
  // soon as the user reaches for actual navigation.
  var contact = drawer.querySelector('[data-aico-contact]');
  if (contact) {
    var collapseContact = function () {
      if (contact.open) {
        contact.open = false;
      }
    };
    var navRegion = drawer.querySelector('.aico-drawer-nav');
    if (navRegion) {
      navRegion.addEventListener('click', collapseContact, true);
    }
    var brandPicker = drawer.querySelector('.aico-drawer-brand-picker');
    if (brandPicker) {
      brandPicker.addEventListener('click', collapseContact, true);
    }
  }

  // Accordion behaviour for drawer nav `<details>`: at each nesting level only
  // one `.aico-drawer-nav-group` stays open among siblings; closing a branch
  // collapses all nested open groups underneath it. (Brand picker + contact
  // disclosure are not `.aico-drawer-nav-group` and stay native.)
  var drawerNav = drawer.querySelector('.aico-drawer-nav');
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

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      close();
    } else {
      trapFocus(event);
    }
  });
})();
