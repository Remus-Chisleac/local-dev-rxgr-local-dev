/**
 * Per-store editor (full page) — replaces the old 3-tab store-details modal.
 *
 * Lives on customers/aico_store_locator (/account/store-locator?store=<crmId>).
 * Renders the three groups (contact info / opening hours / images) as stacked
 * page SECTIONS, fetched from / saved to the storefront-session endpoints under
 * data-store-details-base (/account/store-details/...). One "Save changes"
 * button saves contact + hours + image order together; image upload/delete are
 * immediate file ops. A dirty flag + leave-guard dialog protects unsaved edits
 * when the shopper clicks Back / a nav link, plus a native beforeunload prompt
 * for hard reload/close.
 *
 * crmAddressId comes from the root data-aico-crm-address-id (server-resolved &
 * ownership-checked). Localized row labels come from the inline
 * [data-aico-store-editor-i18n] JSON block.
 */
(function () {
  'use strict';

  var DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  function init() {
    var root = document.querySelector('[data-aico-store-editor]');
    if (!root) { return; }

    var crmAddressId = root.getAttribute('data-aico-crm-address-id');
    if (!crmAddressId) { return; } // not-found state — nothing to edit

    var base = root.getAttribute('data-store-details-base') || '/account/store-details';
    var accountUrl = root.getAttribute('data-account-url') || '/account';
    var tokenInput = root.querySelector('input[name="_token"]');
    var token = tokenInput ? tokenInput.value : '';
    var toast = root.querySelector('[data-aico-store-editor-toast]');
    var copy = {
      saving: root.getAttribute('data-copy-saving') || 'Saving…',
      saved: root.getAttribute('data-copy-saved') || 'Saved',
      error: root.getAttribute('data-copy-error') || "Couldn't save"
    };

    var i18n = readI18n();

    var panels = {
      contact: root.querySelector('[data-aico-store-panel="contact"]'),
      hours: root.querySelector('[data-aico-store-panel="hours"]'),
      images: root.querySelector('[data-aico-store-panel="images"]')
    };

    var dirty = false;
    var dirtyHint = root.querySelector('[data-aico-store-dirty-hint]');
    var leaveModal = root.querySelector('[data-aico-store-leave-modal]');
    var pendingHref = null;
    var toastTimer = null;

    function readI18n() {
      var el = root.querySelector('[data-aico-store-editor-i18n]');
      if (!el) { return {}; }
      try { return JSON.parse(el.textContent) || {}; } catch (e) { return {}; }
    }
    function t(key, fallback) {
      return (i18n && i18n[key]) || fallback || '';
    }

    function endpoint(path) { return base + path; }

    function setStatus(message, state) {
      if (!toast) { return; }
      if (toastTimer) { window.clearTimeout(toastTimer); toastTimer = null; }
      toast.textContent = message;
      var kind = state === 'saved' ? ' aico-toast-success'
        : state === 'error' ? ' aico-toast-error' : '';
      toast.className = 'aico-toast aico-store-editor-toast' + kind;
      toast.classList.add('is-visible');
      if (state === 'saved' || state === 'error') {
        toastTimer = window.setTimeout(function () { toast.classList.remove('is-visible'); }, 2600);
      }
    }

    function markDirty() {
      if (dirty) { return; }
      dirty = true;
      if (dirtyHint) { dirtyHint.hidden = false; }
    }
    function clearDirty() {
      dirty = false;
      if (dirtyHint) { dirtyHint.hidden = true; }
    }

    function request(method, url, body) {
      var headers = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
      var opts = { method: method, credentials: 'same-origin', headers: headers };
      if (body !== undefined && body !== null) {
        headers['Content-Type'] = 'application/json';
        if (token) { body._token = token; }
        opts.body = JSON.stringify(body);
      }
      return fetch(url, opts).then(function (response) {
        if (!response.ok) { throw new Error('request failed: ' + response.status); }
        return response.json().catch(function () { return {}; });
      });
    }

    function escapeHtml(value) {
      return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ----- Contact section -------------------------------------------------
    function renderContact(data) {
      var phones = (data && data.phones) || [];
      var emails = (data && data.emails) || [];
      var websiteUrl = (data && data.websiteUrl) || '';
      var html = '';
      html += '<div class="aico-store-editor-group"><h3 class="aico-store-editor-subhead">' + escapeHtml(t('phones', 'Phones')) + '</h3><div class="aico-store-editor-rows" data-contact-phones>';
      phones.forEach(function (p) { html += phoneRow(p); });
      html += '</div><button type="button" class="aico-store-editor-add" data-add-phone>+ ' + escapeHtml(t('addPhone', 'Phone')) + '</button></div>';
      html += '<div class="aico-store-editor-group"><h3 class="aico-store-editor-subhead">' + escapeHtml(t('emails', 'Emails')) + '</h3><div class="aico-store-editor-rows" data-contact-emails>';
      emails.forEach(function (e) { html += emailRow(e); });
      html += '</div><button type="button" class="aico-store-editor-add" data-add-email>+ ' + escapeHtml(t('addEmail', 'Email')) + '</button></div>';
      html += '<label class="aico-store-editor-field"><span class="aico-store-editor-label">' + escapeHtml(t('website', 'Website')) + '</span><input class="aico-store-editor-input" type="text" data-website value="' + escapeHtml(websiteUrl) + '"></label>';
      panels.contact.innerHTML = html;
    }
    function phoneRow(p) {
      p = p || {};
      return '<div class="aico-store-editor-row" data-phone-row data-id="' + escapeHtml(p.id || '') + '">'
        + '<input class="aico-store-editor-input" type="text" data-phone placeholder="' + escapeHtml(t('phonePlaceholder', 'Phone')) + '" value="' + escapeHtml(p.phone || '') + '">'
        + '<input class="aico-store-editor-input" type="text" data-label placeholder="' + escapeHtml(t('labelPlaceholder', 'Label')) + '" value="' + escapeHtml(p.label || '') + '">'
        + '<label class="aico-store-editor-main"><input type="radio" name="phone-main" data-main' + (p.isMain ? ' checked' : '') + '> ' + escapeHtml(t('mainLabel', 'main')) + '</label>'
        + '<button type="button" class="aico-store-editor-remove" data-remove aria-label="remove">&times;</button></div>';
    }
    function emailRow(e) {
      e = e || {};
      return '<div class="aico-store-editor-row" data-email-row data-id="' + escapeHtml(e.id || '') + '">'
        + '<input class="aico-store-editor-input" type="text" data-email placeholder="' + escapeHtml(t('emailPlaceholder', 'Email')) + '" value="' + escapeHtml(e.email || '') + '">'
        + '<input class="aico-store-editor-input" type="text" data-label placeholder="' + escapeHtml(t('labelPlaceholder', 'Label')) + '" value="' + escapeHtml(e.label || '') + '">'
        + '<label class="aico-store-editor-main"><input type="radio" name="email-main" data-main' + (e.isMain ? ' checked' : '') + '> ' + escapeHtml(t('mainLabel', 'main')) + '</label>'
        + '<button type="button" class="aico-store-editor-remove" data-remove aria-label="remove">&times;</button></div>';
    }
    function collectContact() {
      var phones = Array.prototype.map.call(panels.contact.querySelectorAll('[data-phone-row]'), function (row) {
        return {
          id: row.getAttribute('data-id') || null,
          phone: row.querySelector('[data-phone]').value,
          label: row.querySelector('[data-label]').value,
          isMain: row.querySelector('[data-main]').checked,
          crmAddressId: crmAddressId
        };
      });
      var emails = Array.prototype.map.call(panels.contact.querySelectorAll('[data-email-row]'), function (row) {
        return {
          id: row.getAttribute('data-id') || null,
          email: row.querySelector('[data-email]').value,
          label: row.querySelector('[data-label]').value,
          isMain: row.querySelector('[data-main]').checked,
          crmAddressId: crmAddressId
        };
      });
      var website = panels.contact.querySelector('[data-website]');
      return { phones: phones, emails: emails, websiteUrl: website ? website.value : '', crmAddressId: crmAddressId };
    }
    function loadContact() {
      panels.contact.innerHTML = '<p class="aico-store-editor-loading">' + escapeHtml(t('loading', 'Loading…')) + '</p>';
      return request('GET', endpoint('/contact-info?crmAddressId=' + encodeURIComponent(crmAddressId)))
        .then(function (data) { renderContact((data && data.data) || data || {}); })
        .catch(function () { renderContact({}); });
    }

    // ----- Opening-hours section ------------------------------------------
    function renderHours(data) {
      var hours = (data && data.openingHours) || [];
      var byDay = {};
      hours.forEach(function (h) { byDay[h.day] = h; });
      var isActive = !data || data.isCalendarActive !== false;
      var notice = (data && data.notice) || '';
      var html = '<label class="aico-store-editor-toggle"><input type="checkbox" data-calendar-active' + (isActive ? ' checked' : '') + '> ' + escapeHtml(t('calendarActive', 'Calendar active')) + '</label>';
      html += '<div class="aico-store-editor-days">';
      DAYS.forEach(function (day) {
        var h = byDay[day] || { day: day, isActive: false, times: [], id: null };
        html += dayRow(day, h);
      });
      html += '</div>';
      html += '<label class="aico-store-editor-field"><span class="aico-store-editor-label">' + escapeHtml(t('notice', 'Notice')) + '</span><textarea class="aico-store-editor-input aico-store-editor-textarea" data-notice maxlength="200">' + escapeHtml(notice) + '</textarea></label>';
      panels.hours.innerHTML = html;
    }
    function dayRow(day, h) {
      var times = (h.times || []);
      var first = times[0] || {};
      var dayLabel = (i18n.days && i18n.days[day]) || day;
      return '<div class="aico-store-editor-day" data-day-row data-day="' + escapeHtml(day) + '" data-id="' + escapeHtml(h.id || '') + '">'
        + '<label class="aico-store-editor-day-name"><input type="checkbox" data-day-active' + (h.isActive ? ' checked' : '') + '> ' + escapeHtml(dayLabel) + '</label>'
        + '<input class="aico-store-editor-time" type="time" data-open data-time-id="' + escapeHtml(first.id || '') + '" value="' + escapeHtml(first.open || '') + '">'
        + '<span class="aico-store-editor-time-sep">–</span>'
        + '<input class="aico-store-editor-time" type="time" data-close value="' + escapeHtml(first.close || '') + '"></div>';
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
        crmAddressId: crmAddressId
      };
    }
    function loadHours() {
      panels.hours.innerHTML = '<p class="aico-store-editor-loading">' + escapeHtml(t('loading', 'Loading…')) + '</p>';
      return request('GET', endpoint('/opening-hours?crmAddressId=' + encodeURIComponent(crmAddressId)))
        .then(function (data) { renderHours((data && data.data) || data || {}); })
        .catch(function () { renderHours({}); });
    }

    // ----- Images section --------------------------------------------------
    function renderImages(images) {
      images = images || [];
      var html = '';
      html += '<div class="aico-store-editor-images" data-images>';
      if (images.length === 0) {
        html += '<p class="aico-store-editor-muted" data-images-empty>' + escapeHtml(t('noImages', 'No images yet.')) + '</p>';
      }
      images.forEach(function (img) { html += imageRow(img); });
      html += '</div>';
      html += '<label class="aico-store-editor-upload">'
        + '<input type="file" accept="image/*" data-image-file hidden>'
        + '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path></svg>'
        + '<span class="aico-store-editor-upload-text">' + escapeHtml(t('addImage', 'Add image')) + '</span>'
        + '</label>';
      panels.images.innerHTML = html;
    }
    function imageRow(img) {
      img = img || {};
      return '<div class="aico-store-editor-image" data-image-row data-id="' + escapeHtml(img.id || '') + '">'
        + (img.imageUrl ? '<img src="' + escapeHtml(img.imageUrl) + '" alt="" class="aico-store-editor-image-thumb">' : '<span class="aico-store-editor-image-thumb aico-store-editor-image-thumb--empty" aria-hidden="true"></span>')
        + '<div class="aico-store-editor-image-fields">'
        + '<label class="aico-store-editor-field"><span class="aico-store-editor-label">' + escapeHtml(t('imageTitlePlaceholder', 'Title')) + '</span>'
        + '<input class="aico-store-editor-input" type="text" data-image-title placeholder="' + escapeHtml(t('imageTitlePlaceholder', 'Title')) + '" value="' + escapeHtml(img.title || '') + '"></label>'
        + '<label class="aico-store-editor-field aico-store-editor-order-field"><span class="aico-store-editor-label">' + escapeHtml(t('orderLabel', 'Order')) + '</span>'
        + '<input class="aico-store-editor-input aico-store-editor-input--order" type="number" min="0" data-image-order value="' + escapeHtml(img.sortOrder || 0) + '"></label>'
        + '</div>'
        + '<button type="button" class="aico-store-editor-remove aico-store-editor-image-remove" data-image-delete aria-label="remove">&times;</button></div>';
    }
    function loadImages() {
      panels.images.innerHTML = '<p class="aico-store-editor-loading">' + escapeHtml(t('loading', 'Loading…')) + '</p>';
      return request('GET', endpoint('/calendar-images?crmAddressId=' + encodeURIComponent(crmAddressId)))
        .then(function (data) { renderImages((data && data.data) || data || []); })
        .catch(function () { renderImages([]); });
    }
    function collectImageOrder() {
      var rows = panels.images.querySelectorAll('[data-image-row]');
      return Array.prototype.map.call(rows, function (row) {
        return {
          id: row.getAttribute('data-id') || null,
          title: (row.querySelector('[data-image-title]') || {}).value || '',
          sortOrder: parseInt((row.querySelector('[data-image-order]') || {}).value, 10) || 0
        };
      });
    }
    function uploadImage(file) {
      var reader = new FileReader();
      reader.onload = function () {
        setStatus(copy.saving, 'saving');
        request('POST', endpoint('/calendar-image'), {
          crmAddressId: crmAddressId, id: null, title: file.name, description: '',
          imageContent: reader.result, isNew: true
        })
          .then(function () { setStatus(copy.saved, 'saved'); loadImages(); })
          .catch(function () { setStatus(copy.error, 'error'); });
      };
      reader.readAsDataURL(file);
    }
    function deleteImage(id, rowEl) {
      if (!id) { if (rowEl) { rowEl.parentNode.removeChild(rowEl); } return; }
      setStatus(copy.saving, 'saving');
      request('DELETE', endpoint('/calendar-image/' + encodeURIComponent(id) + '?crmAddressId=' + encodeURIComponent(crmAddressId)))
        .then(function () { setStatus(copy.saved, 'saved'); loadImages(); })
        .catch(function () { setStatus(copy.error, 'error'); });
    }

    // ----- Save all --------------------------------------------------------
    function saveAll() {
      setStatus(copy.saving, 'saving');
      return Promise.all([
        request('POST', endpoint('/contact-info'), collectContact()),
        request('POST', endpoint('/opening-hours'), collectHours()),
        request('POST', endpoint('/calendar-images-order'), { crmAddressId: crmAddressId, calendarImages: collectImageOrder() })
      ]).then(function () {
        clearDirty();
        setStatus(copy.saved, 'saved');
        return true;
      }).catch(function () {
        setStatus(copy.error, 'error');
        return false;
      });
    }

    // ----- Leave guard -----------------------------------------------------
    function openLeaveModal(href) {
      pendingHref = href;
      if (leaveModal) {
        leaveModal.hidden = false;
        leaveModal.setAttribute('aria-hidden', 'false');
      }
    }
    function closeLeaveModal() {
      pendingHref = null;
      if (leaveModal) {
        leaveModal.hidden = true;
        leaveModal.setAttribute('aria-hidden', 'true');
      }
    }
    function navigate(href) {
      clearDirty(); // suppress the beforeunload prompt for an intentional leave
      window.location.href = href || accountUrl;
    }

    // Intercept in-app navigation (back button + any nav link) while dirty.
    document.addEventListener('click', function (event) {
      var link = event.target.closest('a[href]');
      if (!link) { return; }
      if (link.closest('[data-aico-store-leave-modal]')) { return; }
      if (link.getAttribute('target') === '_blank' || link.hasAttribute('download')) { return; }
      var href = link.getAttribute('href');
      if (!href || href.charAt(0) === '#' || href.indexOf('javascript:') === 0) { return; }
      if (!dirty) { return; }
      event.preventDefault();
      openLeaveModal(link.href);
    });

    root.addEventListener('click', function (event) {
      if (event.target.closest('[data-aico-store-save]')) { saveAll(); return; }

      if (event.target.closest('[data-aico-store-leave-cancel]')) { closeLeaveModal(); return; }
      if (event.target.closest('[data-aico-store-leave-discard]')) { var h = pendingHref; closeLeaveModal(); navigate(h); return; }
      if (event.target.closest('[data-aico-store-leave-save]')) {
        var target = pendingHref;
        saveAll().then(function (ok) { if (ok) { closeLeaveModal(); navigate(target); } });
        return;
      }

      var addPhone = event.target.closest('[data-add-phone]');
      if (addPhone) { panels.contact.querySelector('[data-contact-phones]').insertAdjacentHTML('beforeend', phoneRow({})); markDirty(); return; }
      var addEmail = event.target.closest('[data-add-email]');
      if (addEmail) { panels.contact.querySelector('[data-contact-emails]').insertAdjacentHTML('beforeend', emailRow({})); markDirty(); return; }
      var remove = event.target.closest('[data-remove]');
      if (remove) {
        var row = remove.closest('[data-phone-row], [data-email-row]');
        if (row) { row.parentNode.removeChild(row); markDirty(); }
        return;
      }
      var del = event.target.closest('[data-image-delete]');
      if (del) { var imageRowEl = del.closest('[data-image-row]'); if (imageRowEl) { deleteImage(imageRowEl.getAttribute('data-id'), imageRowEl); } }
    });

    // Any field edit marks the form dirty (the image file input auto-uploads,
    // so it isn't a "pending change" — exclude it).
    root.addEventListener('input', function (event) {
      if (event.target.closest('[data-image-file]')) { return; }
      if (event.target.closest('[data-aico-store-section]')) { markDirty(); }
    });
    root.addEventListener('change', function (event) {
      var fileInput = event.target.closest('[data-image-file]');
      if (fileInput && fileInput.files && fileInput.files[0]) { uploadImage(fileInput.files[0]); return; }
      if (event.target.closest('[data-aico-store-section]')) { markDirty(); }
    });

    window.addEventListener('beforeunload', function (event) {
      if (!dirty) { return; }
      event.preventDefault();
      event.returnValue = '';
      return '';
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && leaveModal && !leaveModal.hidden) { closeLeaveModal(); }
    });

    // Initial load of all three sections.
    loadContact();
    loadHours();
    loadImages();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
