/**
 * Address change-request form (F4 part B).
 *
 * Each address card on customers/addresses has a "Request address change" /
 * "Change the request" button. Clicking opens a single shared modal prefilled
 * from the card's data-field-* attrs (Shopify-shaped fields) + a required
 * aico_explanation textarea. On submit:
 *
 *   - No existing request (no data-aico-change-request-id):
 *       POST {base}/account/addresses/{crmAddressId}/change-request
 *   - Pending (card carries data-aico-change-request-id = the open task id):
 *       PUT  {base}/account/addresses/{crmAddressId}/change-request/{taskId}
 *
 * Both bodies carry the new field values + aico_explanation + _token. On
 * success we toast and reload so the badge/button flip from the fresh render.
 *
 * URL templates come from the page root data-attrs and carry __CRM_ID__ /
 * __TASK_ID__ placeholders (so the ?theme_preview token, if any, stays intact).
 */
(function () {
  'use strict';

  var FIELDS = [
    'company', 'first_name', 'last_name', 'address1', 'address2',
    'zip', 'city', 'province', 'country', 'phone'
  ];

  function init() {
    // The change-request feature lives on two pages that share this script:
    // the profile addresses page ([data-aico-addresses]) and the dedicated
    // store-locator page ([data-aico-store-locator]). Both carry the same
    // change-request data-attrs, modal, cards and toast hooks.
    var root = document.querySelector('[data-aico-addresses]')
      || document.querySelector('[data-aico-store-locator]');
    if (!root) { return; }

    var modal = root.querySelector('[data-aico-change-modal]');
    var form = root.querySelector('[data-aico-change-form]');
    if (!modal || !form) { return; }

    var tokenInput = root.querySelector('input[name="_token"]');
    var token = tokenInput ? tokenInput.value : '';
    var createUrlTpl = root.getAttribute('data-change-request-url') || '';
    var updateUrlTpl = root.getAttribute('data-change-request-update-url') || '';

    var toast = root.querySelector('[data-aico-addresses-toast]')
      || root.querySelector('[data-aico-store-locator-toast]');
    var copy = {
      saving: root.getAttribute('data-copy-saving') || 'Saving…',
      saved: root.getAttribute('data-copy-saved') || 'Saved',
      error: root.getAttribute('data-copy-error') || "Couldn't save"
    };

    var activeCard = null;
    var toastTimer = null;
    // Preserve the toast's page-specific base class (addresses vs store-locator)
    // so styling stays correct on whichever page hosts this script.
    var toastBaseClass = toast ? toast.className : 'aico-toast';

    function setStatus(message, state) {
      if (!toast) { return; }
      if (toastTimer) { window.clearTimeout(toastTimer); toastTimer = null; }
      toast.textContent = message;
      var kind = state === 'saved' ? ' aico-toast-success'
        : state === 'error' ? ' aico-toast-error' : '';
      toast.className = toastBaseClass + kind;
      toast.classList.add('is-visible');
      if (state === 'saved' || state === 'error') {
        toastTimer = window.setTimeout(function () {
          toast.classList.remove('is-visible');
        }, 2600);
      }
    }

    function openModal(card) {
      activeCard = card;
      FIELDS.forEach(function (field) {
        var input = form.querySelector('[data-field="' + field + '"]');
        if (input) {
          input.value = card.getAttribute('data-field-' + field) || '';
        }
      });
      var explanation = form.querySelector('[data-field="aico_explanation"]');
      if (explanation) { explanation.value = ''; }

      modal.hidden = false;
      modal.setAttribute('aria-hidden', 'false');
      var firstInput = form.querySelector('[data-field="company"]');
      if (firstInput) { try { firstInput.focus(); } catch (e) { /* noop */ } }
    }

    function closeModal() {
      modal.hidden = true;
      modal.setAttribute('aria-hidden', 'true');
      activeCard = null;
    }

    function buildUrl(card) {
      var crmId = card.getAttribute('data-aico-crm-address-id') || '';
      var taskId = card.getAttribute('data-aico-change-request-id') || '';
      if (taskId) {
        return {
          method: 'PUT',
          url: updateUrlTpl
            .replace('__CRM_ID__', encodeURIComponent(crmId))
            .replace('__TASK_ID__', encodeURIComponent(taskId))
        };
      }
      return {
        method: 'POST',
        url: createUrlTpl.replace('__CRM_ID__', encodeURIComponent(crmId))
      };
    }

    function submit(event) {
      event.preventDefault();
      if (!activeCard) { return; }

      var explanationInput = form.querySelector('[data-field="aico_explanation"]');
      var explanation = explanationInput ? explanationInput.value.trim() : '';
      if (!explanation) {
        setStatus(copy.error, 'error');
        if (explanationInput) { explanationInput.focus(); }
        return;
      }

      var target = buildUrl(activeCard);
      if (!target.url) { return; }

      var body = new URLSearchParams();
      if (token) { body.append('_token', token); }
      FIELDS.forEach(function (field) {
        var input = form.querySelector('[data-field="' + field + '"]');
        body.append(field, input ? input.value : '');
      });
      body.append('aico_explanation', explanation);

      var submitBtn = form.querySelector('.aico-address-change-submit');
      if (submitBtn) { submitBtn.disabled = true; }
      setStatus(copy.saving, 'saving');

      fetch(target.url, {
        method: target.method,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
      })
        .then(function (response) {
          if (!response.ok) { throw new Error('save failed: ' + response.status); }
          return response.json().catch(function () { return {}; });
        })
        .then(function () {
          setStatus(copy.saved, 'saved');
          window.setTimeout(function () { window.location.reload(); }, 600);
        })
        .catch(function () {
          setStatus(copy.error, 'error');
          if (submitBtn) { submitBtn.disabled = false; }
        });
    }

    root.addEventListener('click', function (event) {
      var openBtn = event.target.closest('[data-aico-change-open]');
      if (openBtn) {
        var card = openBtn.closest('[data-aico-crm-address-id]');
        if (card) { openModal(card); }
        return;
      }
      if (event.target.closest('[data-aico-change-close]')) {
        closeModal();
      }
    });

    form.addEventListener('submit', submit);

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !modal.hidden) { closeModal(); }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
