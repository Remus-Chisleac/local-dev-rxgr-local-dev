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
