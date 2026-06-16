/**
 * Store-details editor (F4 part A4) — three-tab progressive-enhancement editor
 * reimplementing the legacy b2b-shop store drawer (NOT React).
 *
 * Tabs: contact info / opening hours / images. Wired to the EXISTING aico
 * backend endpoints the legacy b2b-shop used, base:
 *   ${origin}{base}/{aicoShopId}/addresses
 * where {base} = data-store-details-base (default /aico-shops) and the aico
 * shop id comes from data-aico-shop-id (customer.aico_shop_id).
 *
 *   GET/POST  .../contact-info?crmAddressId=     { phones[], emails[], websiteUrl }
 *   GET/POST  .../opening-hours?addressId=       { openingHours[], isCalendarActive, notice }
 *   GET       .../calendar-images?addressId=
 *   POST      .../calendar-image                 (single image upsert)
 *   POST      .../calendar-images-order
 *   DELETE    .../calendar-image/{id}
 *
 * Field shapes match the legacy contracts exactly (see the F4 task file):
 *   phones {phone,label,isMain,crmAddressId,id}; emails {email,label,isMain,crmAddressId,id}
 *   opening hours 7-day {day,isActive,times:[{open,close,id,shouldDelete}],id,shouldUpdate} + notice
 *   images {id,imageUrl,title,description,sortOrder,isNew,imageContent(base64)}
 *
 * FIRST CUT — load + render + submit each tab via fetch with the csrf token,
 * toast on success/error. Stubbed/simplified (documented):
 *   - Images: title/description/replace + delete; reordering is a plain numeric
 *     sortOrder input (saved via calendar-images-order) rather than drag-reorder.
 *   - Validation is minimal (the backend remains the source of truth).
 *   - Endpoints are not verified server-side here; failures degrade to a toast.
 */
(function () {
  'use strict';

  var DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  function init() {
    var root = document.querySelector('[data-aico-addresses]');
    if (!root) { return; }

    var modal = root.querySelector('[data-aico-store-details-modal]');
    if (!modal) { return; }

    var tokenInput = root.querySelector('input[name="_token"]');
    var token = tokenInput ? tokenInput.value : '';
    var aicoShopId = root.getAttribute('data-aico-shop-id') || '';
    var base = (root.getAttribute('data-store-details-base') || '/aico-shops');
    var toast = root.querySelector('[data-aico-addresses-toast]');
    var copy = {
      saving: root.getAttribute('data-copy-saving') || 'Saving…',
      saved: root.getAttribute('data-copy-saved') || 'Saved',
      error: root.getAttribute('data-copy-error') || "Couldn't save"
    };

    var panels = {
      contact: modal.querySelector('[data-aico-store-details-panel="contact"]'),
      hours: modal.querySelector('[data-aico-store-details-panel="hours"]'),
      images: modal.querySelector('[data-aico-store-details-panel="images"]')
    };

    var activeCrmAddressId = null;
    var toastTimer = null;

    function endpoint(path) {
      return base + '/' + encodeURIComponent(aicoShopId) + '/addresses' + path;
    }

    function setStatus(message, state) {
      if (!toast) { return; }
      if (toastTimer) { window.clearTimeout(toastTimer); toastTimer = null; }
      toast.textContent = message;
      var kind = state === 'saved' ? ' aico-toast-success'
        : state === 'error' ? ' aico-toast-error' : '';
      toast.className = 'aico-toast aico-addresses-toast' + kind;
      toast.classList.add('is-visible');
      if (state === 'saved' || state === 'error') {
        toastTimer = window.setTimeout(function () {
          toast.classList.remove('is-visible');
        }, 2600);
      }
    }

    function request(method, url, body) {
      var headers = {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      };
      var init = { method: method, credentials: 'same-origin', headers: headers };
      if (body !== undefined && body !== null) {
        headers['Content-Type'] = 'application/json';
        if (token) { body._token = token; }
        init.body = JSON.stringify(body);
      }
      return fetch(url, init).then(function (response) {
        if (!response.ok) { throw new Error('request failed: ' + response.status); }
        return response.json().catch(function () { return {}; });
      });
    }

    function escapeHtml(value) {
      return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    // ----- Contact tab -----------------------------------------------------
    function renderContact(data) {
      var phones = (data && data.phones) || [];
      var emails = (data && data.emails) || [];
      var websiteUrl = (data && data.websiteUrl) || '';
      var html = '';
      html += '<div class="aico-store-details-section"><h4 class="aico-store-details-subhead">Phones</h4><div data-contact-phones>';
      phones.forEach(function (p) { html += phoneRow(p); });
      html += '</div><button type="button" class="aico-store-details-add" data-add-phone>+ Phone</button></div>';
      html += '<div class="aico-store-details-section"><h4 class="aico-store-details-subhead">Emails</h4><div data-contact-emails>';
      emails.forEach(function (e) { html += emailRow(e); });
      html += '</div><button type="button" class="aico-store-details-add" data-add-email>+ Email</button></div>';
      html += '<label class="aico-store-details-field"><span>Website</span><input type="text" data-website value="' + escapeHtml(websiteUrl) + '"></label>';
      html += '<div class="aico-store-details-actions"><button type="button" class="aico-store-details-save" data-save-contact>Save</button></div>';
      panels.contact.innerHTML = html;
    }

    function phoneRow(p) {
      p = p || {};
      return '<div class="aico-store-details-row" data-phone-row data-id="' + escapeHtml(p.id || '') + '">'
        + '<input type="text" data-phone placeholder="Phone" value="' + escapeHtml(p.phone || '') + '">'
        + '<input type="text" data-label placeholder="Label" value="' + escapeHtml(p.label || '') + '">'
        + '<label class="aico-store-details-main"><input type="radio" name="phone-main" data-main' + (p.isMain ? ' checked' : '') + '> main</label>'
        + '<button type="button" class="aico-store-details-remove" data-remove>&times;</button></div>';
    }

    function emailRow(e) {
      e = e || {};
      return '<div class="aico-store-details-row" data-email-row data-id="' + escapeHtml(e.id || '') + '">'
        + '<input type="text" data-email placeholder="Email" value="' + escapeHtml(e.email || '') + '">'
        + '<input type="text" data-label placeholder="Label" value="' + escapeHtml(e.label || '') + '">'
        + '<label class="aico-store-details-main"><input type="radio" name="email-main" data-main' + (e.isMain ? ' checked' : '') + '> main</label>'
        + '<button type="button" class="aico-store-details-remove" data-remove>&times;</button></div>';
    }

    function collectContact() {
      var phones = Array.prototype.map.call(panels.contact.querySelectorAll('[data-phone-row]'), function (row) {
        return {
          id: row.getAttribute('data-id') || null,
          phone: row.querySelector('[data-phone]').value,
          label: row.querySelector('[data-label]').value,
          isMain: row.querySelector('[data-main]').checked,
          crmAddressId: activeCrmAddressId
        };
      });
      var emails = Array.prototype.map.call(panels.contact.querySelectorAll('[data-email-row]'), function (row) {
        return {
          id: row.getAttribute('data-id') || null,
          email: row.querySelector('[data-email]').value,
          label: row.querySelector('[data-label]').value,
          isMain: row.querySelector('[data-main]').checked,
          crmAddressId: activeCrmAddressId
        };
      });
      var website = panels.contact.querySelector('[data-website]');
      return { phones: phones, emails: emails, websiteUrl: website ? website.value : '' };
    }

    function loadContact() {
      panels.contact.innerHTML = '<p class="aico-store-details-loading">Loading…</p>';
      request('GET', endpoint('/contact-info?crmAddressId=' + encodeURIComponent(activeCrmAddressId)))
        .then(function (data) { renderContact(data); })
        .catch(function () { renderContact({}); });
    }

    function saveContact() {
      var payload = collectContact();
      payload.crmAddressId = activeCrmAddressId;
      setStatus(copy.saving, 'saving');
      request('POST', endpoint('/contact-info?crmAddressId=' + encodeURIComponent(activeCrmAddressId)), payload)
        .then(function () { setStatus(copy.saved, 'saved'); })
        .catch(function () { setStatus(copy.error, 'error'); });
    }

    // ----- Opening-hours tab ----------------------------------------------
    function renderHours(data) {
      var hours = (data && data.openingHours) || [];
      var byDay = {};
      hours.forEach(function (h) { byDay[h.day] = h; });
      var isActive = !data || data.isCalendarActive !== false;
      var notice = (data && data.notice) || '';
      var html = '<label class="aico-store-details-toggle"><input type="checkbox" data-calendar-active' + (isActive ? ' checked' : '') + '> Calendar active</label>';
      DAYS.forEach(function (day) {
        var h = byDay[day] || { day: day, isActive: false, times: [], id: null };
        html += dayRow(day, h);
      });
      html += '<label class="aico-store-details-field"><span>Notice</span><textarea data-notice maxlength="200">' + escapeHtml(notice) + '</textarea></label>';
      html += '<div class="aico-store-details-actions"><button type="button" class="aico-store-details-save" data-save-hours>Save</button></div>';
      panels.hours.innerHTML = html;
    }

    function dayRow(day, h) {
      var times = (h.times || []);
      var first = times[0] || {};
      // First cut: one open/close interval per day (the backend supports
      // multiple; multi-interval editing is a documented follow-up).
      return '<div class="aico-store-details-day" data-day-row data-day="' + escapeHtml(day) + '" data-id="' + escapeHtml(h.id || '') + '">'
        + '<label class="aico-store-details-day-name"><input type="checkbox" data-day-active' + (h.isActive ? ' checked' : '') + '> ' + day + '</label>'
        + '<input type="time" data-open data-time-id="' + escapeHtml(first.id || '') + '" value="' + escapeHtml(first.open || '') + '">'
        + '<input type="time" data-close value="' + escapeHtml(first.close || '') + '"></div>';
    }

    function collectHours() {
      var openingHours = Array.prototype.map.call(panels.hours.querySelectorAll('[data-day-row]'), function (row) {
        var openInput = row.querySelector('[data-open]');
        var closeInput = row.querySelector('[data-close]');
        var timeId = openInput.getAttribute('data-time-id') || null;
        var open = openInput.value;
        var close = closeInput.value;
        var times = [];
        if (open || close) {
          times.push({ open: open, close: close, id: timeId || null, shouldDelete: false });
        } else if (timeId) {
          times.push({ open: open, close: close, id: timeId, shouldDelete: true });
        }
        return {
          day: row.getAttribute('data-day'),
          isActive: row.querySelector('[data-day-active]').checked,
          times: times,
          id: row.getAttribute('data-id') || null,
          shouldUpdate: true
        };
      });
      var noticeEl = panels.hours.querySelector('[data-notice]');
      var activeEl = panels.hours.querySelector('[data-calendar-active]');
      return {
        openingHours: openingHours,
        isCalendarActive: activeEl ? activeEl.checked : true,
        notice: noticeEl ? noticeEl.value : null,
        addressId: activeCrmAddressId
      };
    }

    function loadHours() {
      panels.hours.innerHTML = '<p class="aico-store-details-loading">Loading…</p>';
      request('GET', endpoint('/opening-hours?addressId=' + encodeURIComponent(activeCrmAddressId)))
        .then(function (data) { renderHours(data); })
        .catch(function () { renderHours({}); });
    }

    function saveHours() {
      var payload = collectHours();
      setStatus(copy.saving, 'saving');
      request('POST', endpoint('/opening-hours?addressId=' + encodeURIComponent(activeCrmAddressId)), payload)
        .then(function () { setStatus(copy.saved, 'saved'); })
        .catch(function () { setStatus(copy.error, 'error'); });
    }

    // ----- Images tab ------------------------------------------------------
    function renderImages(images) {
      images = images || [];
      var html = '<div class="aico-store-details-images" data-images>';
      images.forEach(function (img) { html += imageRow(img); });
      html += '</div>';
      html += '<label class="aico-store-details-field"><span>Add image</span><input type="file" accept="image/*" data-image-file></label>';
      html += '<div class="aico-store-details-actions"><button type="button" class="aico-store-details-save" data-save-image-order>Save order</button></div>';
      panels.images.innerHTML = html;
    }

    function imageRow(img) {
      img = img || {};
      return '<div class="aico-store-details-image" data-image-row data-id="' + escapeHtml(img.id || '') + '">'
        + (img.imageUrl ? '<img src="' + escapeHtml(img.imageUrl) + '" alt="" class="aico-store-details-image-thumb">' : '')
        + '<input type="text" data-image-title placeholder="Title" value="' + escapeHtml(img.title || '') + '">'
        + '<input type="number" data-image-order placeholder="Order" value="' + escapeHtml(img.sortOrder || 0) + '">'
        + '<button type="button" class="aico-store-details-remove" data-image-delete>&times;</button></div>';
    }

    function loadImages() {
      panels.images.innerHTML = '<p class="aico-store-details-loading">Loading…</p>';
      request('GET', endpoint('/calendar-images?addressId=' + encodeURIComponent(activeCrmAddressId)))
        .then(function (data) { renderImages((data && data.data) || data || []); })
        .catch(function () { renderImages([]); });
    }

    function saveImageOrder() {
      var rows = panels.images.querySelectorAll('[data-image-row]');
      var ordered = Array.prototype.map.call(rows, function (row) {
        return {
          id: row.getAttribute('data-id') || null,
          sortOrder: parseInt(row.querySelector('[data-image-order]').value, 10) || 0
        };
      });
      setStatus(copy.saving, 'saving');
      request('POST', endpoint('/calendar-images-order'), { addressId: activeCrmAddressId, b2bCalendarImages: ordered })
        .then(function () { setStatus(copy.saved, 'saved'); })
        .catch(function () { setStatus(copy.error, 'error'); });
    }

    function uploadImage(file) {
      var reader = new FileReader();
      reader.onload = function () {
        setStatus(copy.saving, 'saving');
        request('POST', endpoint('/calendar-image'), {
          addressId: activeCrmAddressId,
          id: null,
          title: file.name,
          description: '',
          imageContent: reader.result,
          isNew: true
        })
          .then(function () { setStatus(copy.saved, 'saved'); loadImages(); })
          .catch(function () { setStatus(copy.error, 'error'); });
      };
      reader.readAsDataURL(file);
    }

    function deleteImage(id) {
      if (!id) { return; }
      setStatus(copy.saving, 'saving');
      request('DELETE', endpoint('/calendar-image/' + encodeURIComponent(id)))
        .then(function () { setStatus(copy.saved, 'saved'); loadImages(); })
        .catch(function () { setStatus(copy.error, 'error'); });
    }

    // ----- Tabs / modal ----------------------------------------------------
    function activateTab(name) {
      Array.prototype.forEach.call(modal.querySelectorAll('[data-aico-store-details-tab]'), function (tab) {
        tab.classList.toggle('is-active', tab.getAttribute('data-aico-store-details-tab') === name);
      });
      Object.keys(panels).forEach(function (key) {
        if (panels[key]) { panels[key].classList.toggle('is-active', key === name); }
      });
    }

    function openModal(card) {
      activeCrmAddressId = card.getAttribute('data-aico-crm-address-id');
      modal.hidden = false;
      modal.setAttribute('aria-hidden', 'false');
      activateTab('contact');
      loadContact();
      loadHours();
      loadImages();
    }

    function closeModal() {
      modal.hidden = true;
      modal.setAttribute('aria-hidden', 'true');
      activeCrmAddressId = null;
    }

    root.addEventListener('click', function (event) {
      var openBtn = event.target.closest('[data-aico-store-details-open]');
      if (openBtn) {
        var card = openBtn.closest('[data-aico-crm-address-id]');
        if (card) { openModal(card); }
        return;
      }
      if (event.target.closest('[data-aico-store-details-close]')) { closeModal(); return; }

      var tab = event.target.closest('[data-aico-store-details-tab]');
      if (tab) { activateTab(tab.getAttribute('data-aico-store-details-tab')); return; }

      if (event.target.closest('[data-save-contact]')) { saveContact(); return; }
      if (event.target.closest('[data-save-hours]')) { saveHours(); return; }
      if (event.target.closest('[data-save-image-order]')) { saveImageOrder(); return; }

      var addPhone = event.target.closest('[data-add-phone]');
      if (addPhone) {
        panels.contact.querySelector('[data-contact-phones]').insertAdjacentHTML('beforeend', phoneRow({}));
        return;
      }
      var addEmail = event.target.closest('[data-add-email]');
      if (addEmail) {
        panels.contact.querySelector('[data-contact-emails]').insertAdjacentHTML('beforeend', emailRow({}));
        return;
      }
      var remove = event.target.closest('[data-remove]');
      if (remove) {
        var row = remove.closest('[data-phone-row], [data-email-row]');
        if (row) { row.parentNode.removeChild(row); }
        return;
      }
      var del = event.target.closest('[data-image-delete]');
      if (del) {
        var imageRowEl = del.closest('[data-image-row]');
        if (imageRowEl) { deleteImage(imageRowEl.getAttribute('data-id')); }
      }
    });

    root.addEventListener('change', function (event) {
      var fileInput = event.target.closest('[data-image-file]');
      if (fileInput && fileInput.files && fileInput.files[0]) {
        uploadImage(fileInput.files[0]);
      }
    });

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
