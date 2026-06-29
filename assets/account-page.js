/**
 * Customer profile page — instant-save preference dropdowns.
 *
 * Each <select data-aico-pref="..."> persists on change via a same-origin
 * fetch() to the storefront-host account endpoints (StorefrontAccountController),
 * which reuse the same backend services as the v2 API. No page reload.
 *
 * "customer_view" (Endkundenansicht) is localStorage-only — it has no backend
 * consumer in the storefront yet, matching b2b-shop's behaviour.
 */
(function () {
  'use strict';

  var CUSTOMER_VIEW_STORAGE_KEY = 'customerView';

  var CHEVRON_SVG =
    '<svg class="aico-select-chevron" xmlns="http://www.w3.org/2000/svg" ' +
    'width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<polyline points="6 9 12 15 18 9"></polyline></svg>';

  function closeSelect(wrapper) {
    wrapper.classList.remove('aico-select-open');
    var dropdown = wrapper.querySelector('.aico-select-dropdown');
    var trigger = wrapper.querySelector('.aico-select-trigger');
    if (dropdown) {
      dropdown.hidden = true;
    }
    if (trigger) {
      trigger.setAttribute('aria-expanded', 'false');
    }
  }

  function closeAllSelects(except) {
    var open = document.querySelectorAll('[data-aico-select].aico-select-open');
    Array.prototype.forEach.call(open, function (wrapper) {
      if (wrapper !== except) {
        closeSelect(wrapper);
      }
    });
  }

  /**
   * Progressive enhancement: turn each native <select> inside a
   * [data-aico-select] wrapper into a styled button + listbox. The native
   * select stays in the DOM (visually hidden once ready) and remains the
   * source of truth — selecting an option writes to it and dispatches a
   * native "change" event, so the instant-save handlers keep working and the
   * page degrades to a usable native select when JS is unavailable.
   */
  function enhanceSelects(root) {
    var wrappers = root.querySelectorAll('[data-aico-select]');
    Array.prototype.forEach.call(wrappers, function (wrapper) {
      if (wrapper.dataset.aicoSelectReady === '1') {
        return;
      }
      var native = wrapper.querySelector('select');
      if (!native) {
        return;
      }
      wrapper.dataset.aicoSelectReady = '1';

      var trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'aico-select-trigger';
      trigger.setAttribute('aria-haspopup', 'listbox');
      trigger.setAttribute('aria-expanded', 'false');
      var label = document.createElement('span');
      label.className = 'aico-select-label';
      trigger.appendChild(label);
      trigger.insertAdjacentHTML('beforeend', CHEVRON_SVG);

      var dropdown = document.createElement('div');
      dropdown.className = 'aico-select-dropdown';
      dropdown.hidden = true;
      var list = document.createElement('div');
      list.setAttribute('role', 'listbox');
      list.className = 'aico-select-list';
      dropdown.appendChild(list);

      wrapper.appendChild(trigger);
      wrapper.appendChild(dropdown);
      wrapper.classList.add('aico-select-ready');
      // Let the save flow toggle the trigger's busy state.
      native._aicoSelectTrigger = trigger;

      function syncLabel() {
        var option = native.options[native.selectedIndex];
        label.textContent = option ? option.textContent.trim() : '';
        trigger.disabled = native.disabled;
      }

      function buildOptions() {
        list.innerHTML = '';
        Array.prototype.forEach.call(native.options, function (option, index) {
          var row = document.createElement('button');
          row.type = 'button';
          row.setAttribute('role', 'option');
          row.className = 'aico-select-option';
          row.textContent = option.textContent;
          row.disabled = option.disabled;
          row.setAttribute(
            'aria-selected',
            native.selectedIndex === index ? 'true' : 'false'
          );
          row.addEventListener('click', function (event) {
            event.preventDefault();
            if (option.value !== native.value) {
              native.value = option.value;
              native.dispatchEvent(new Event('change', { bubbles: true }));
            }
            closeSelect(wrapper);
            syncLabel();
          });
          list.appendChild(row);
        });
      }

      function openSelect() {
        closeAllSelects(wrapper);
        buildOptions();
        dropdown.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        wrapper.classList.add('aico-select-open');
      }

      trigger.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (native.disabled) {
          return;
        }
        if (wrapper.classList.contains('aico-select-open')) {
          closeSelect(wrapper);
        } else {
          openSelect();
        }
      });

      native.addEventListener('change', syncLabel);
      syncLabel();
    });

    if (!document.documentElement.dataset.aicoSelectGlobalClose) {
      document.documentElement.dataset.aicoSelectGlobalClose = '1';
      document.addEventListener('click', function () {
        closeAllSelects(null);
      });
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
          closeAllSelects(null);
        }
      });
    }
  }

  function init() {
    var root = document.querySelector('[data-aico-account]');
    if (!root) {
      return;
    }

    var toast = root.querySelector('[data-aico-account-toast]');
    var tokenInput = root.querySelector('input[name="_token"]');
    var token = tokenInput ? tokenInput.value : '';

    var copy = {
      saving: root.getAttribute('data-copy-saving') || 'Saving…',
      saved: root.getAttribute('data-copy-saved') || 'Saved',
      error: root.getAttribute('data-copy-error') || "Couldn't save"
    };

    // pref key -> { url, field, transform } describing the POST body.
    var endpoints = {
      document_language: {
        url: root.getAttribute('data-document-language-url'),
        field: 'language_id'
      },
      email_language: {
        url: root.getAttribute('data-email-language-url'),
        field: 'language_id'
      },
      sizes_region: {
        url: root.getAttribute('data-sizes-region-url'),
        field: 'region'
      },
      exchange_subscription: {
        url: root.getAttribute('data-exchange-subscription-url'),
        field: 'is_subscribed'
      }
    };

    var toastTimer = null;
    function setStatus(message, state) {
      if (!toast) {
        return;
      }
      if (toastTimer) {
        window.clearTimeout(toastTimer);
        toastTimer = null;
      }
      toast.textContent = message;
      // Standard site toast: neutral (saving) = default dark, saved = success,
      // error = error. Position/appearance come from .aico-toast-wrap/.aico-toast.
      var kind = state === 'saved' ? ' aico-toast-success'
        : state === 'error' ? ' aico-toast-error'
        : '';
      toast.className = 'aico-toast aico-account-toast' + kind;
      toast.classList.add('is-visible');
      // "saving" stays until the request resolves; "saved"/"error" auto-dismiss.
      if (state === 'saved' || state === 'error') {
        toastTimer = window.setTimeout(function () {
          toast.classList.remove('is-visible');
        }, 2600);
      }
    }

    function persist(pref, value, select) {
      var endpoint = endpoints[pref];
      if (!endpoint || !endpoint.url) {
        return;
      }

      var body = new URLSearchParams();
      if (token) {
        body.append('_token', token);
      }
      body.append(endpoint.field, value);

      select.disabled = true;
      if (select._aicoSelectTrigger) {
        select._aicoSelectTrigger.disabled = true;
      }
      setStatus(copy.saving, 'saving');

      fetch(endpoint.url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
      })
        .then(function (response) {
          if (!response.ok) {
            throw new Error('save failed: ' + response.status);
          }
          return response.json().catch(function () {
            return {};
          });
        })
        .then(function () {
          setStatus(copy.saved, 'saved');
        })
        .catch(function () {
          setStatus(copy.error, 'error');
        })
        .then(function () {
          select.disabled = false;
          if (select._aicoSelectTrigger) {
            select._aicoSelectTrigger.disabled = false;
          }
        });
    }

    // Restore the locally-stored end-customer view selection.
    var customerViewSelect = root.querySelector('[data-aico-pref="customer_view"]');
    if (customerViewSelect) {
      var stored = null;
      try {
        stored = window.localStorage.getItem(CUSTOMER_VIEW_STORAGE_KEY);
      } catch (error) {
        stored = null;
      }
      if (stored === 'on' || stored === 'off') {
        customerViewSelect.value = stored;
      }
    }

    // Replace the default browser <select> chrome with a custom dropdown.
    enhanceSelects(root);

    var selects = root.querySelectorAll('select[data-aico-pref]');
    Array.prototype.forEach.call(selects, function (select) {
      select.addEventListener('change', function () {
        var pref = select.getAttribute('data-aico-pref');
        var value = select.value;

        if (pref === 'customer_view') {
          try {
            window.localStorage.setItem(CUSTOMER_VIEW_STORAGE_KEY, value);
            setStatus(copy.saved, 'saved');
          } catch (error) {
            setStatus(copy.error, 'error');
          }
          return;
        }

        persist(pref, value, select);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
