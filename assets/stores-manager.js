/**
 * Store locations manager — full rebuild (customers/aico_store_locator).
 *
 * Left rail: searchable, selectable list of the shopper's store-locator
 * addresses. Right pane: the selected store's editable detail (contact info /
 * opening hours / images) rendered as one card with quiet section dividers.
 *
 * Each group is fetched from / saved to the storefront-session endpoints under
 * data-store-details-base (/account/store-details/...). One "Save changes"
 * button persists contact + hours + image order together; image upload/delete
 * are immediate. A dirty flag drives the accent save button + leave-guard.
 *
 * Opening hours support up to 3 time ranges per day. The API models a day as
 * B2bCalendarDay { id, day, is_active, b2b_calendar_time_intervals[] } and
 * stores intervals as { id, start_time, end_time }. The seed data contains
 * duplicate day rows (capitalised + lowercase) so days are canonicalised by
 * lowercase name; the record that already holds intervals is kept as the save
 * target. Removing an interval emits { id, shouldDelete: true }.
 *
 * The "Request address change" control reuses the shared address-change.js: the
 * detail head is rendered with the active store's data-aico-crm-address-id +
 * data-field-* so that script prefills/submits the shared modal unchanged.
 */
(function () {
  'use strict';

  var DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  var MAX_INTERVALS = 3;
  var ADDRESS_FIELDS = [
    'company', 'first_name', 'last_name', 'address1', 'address2',
    'zip', 'city', 'province', 'country', 'phone'
  ];

  function init() {
    var root = document.querySelector('[data-aico-stores]');
    if (!root) { return; }

    var list = root.querySelector('[data-aico-stores-list]');
    var detail = root.querySelector('[data-aico-stores-detail]');
    if (!detail) { return; }

    var base = root.getAttribute('data-store-details-base') || '/account/store-details';
    var accountUrl = root.getAttribute('data-account-url') || '/account';
    var tokenInput = root.querySelector('input[name="_token"]');
    var token = tokenInput ? tokenInput.value : '';
    var toast = root.querySelector('[data-aico-stores-toast]');
    var copy = {
      saving: root.getAttribute('data-copy-saving') || 'Saving…',
      saved: root.getAttribute('data-copy-saved') || 'Saved',
      error: root.getAttribute('data-copy-error') || "Couldn't save"
    };
    var i18n = readI18n();

    var crmAddressId = null;
    var activeCard = null;
    var panels = { contact: null, hours: null, images: null };
    // Interval ids present per canonical day at load time — used to emit
    // shouldDelete for intervals the shopper removed before saving.
    var loadedIntervalIds = {};

    var dirty = false;
    var leaveModal = root.querySelector('[data-aico-stores-leave]');
    var pendingAction = null;
    var toastTimer = null;

    // ── helpers ──────────────────────────────────────────────────────────
    function readI18n() {
      var el = root.querySelector('[data-aico-stores-i18n]');
      if (!el) { return {}; }
      try { return JSON.parse(el.textContent) || {}; } catch (e) { return {}; }
    }
    function t(key, fallback) { return (i18n && i18n[key]) || fallback || ''; }
    function endpoint(path) { return base + path; }
    function esc(value) {
      return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function hhmm(value) {
      if (!value) { return ''; }
      var match = String(value).match(/^(\d{2}:\d{2})/);
      return match ? match[1] : String(value);
    }

    function setStatus(message, state) {
      if (!toast) { return; }
      if (toastTimer) { window.clearTimeout(toastTimer); toastTimer = null; }
      toast.textContent = message;
      var kind = state === 'saved' ? ' aico-toast-success'
        : state === 'error' ? ' aico-toast-error' : '';
      toast.className = 'aico-toast aico-stores-toast' + kind;
      toast.classList.add('is-visible');
      if (state === 'saved' || state === 'error') {
        toastTimer = window.setTimeout(function () { toast.classList.remove('is-visible'); }, 2600);
      }
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

    function saveBtnEl() { return detail.querySelector('[data-aico-stores-save]'); }
    function dirtyHintEl() { return detail.querySelector('[data-aico-stores-dirty]'); }
    function markDirty() {
      if (dirty) { return; }
      dirty = true;
      var hint = dirtyHintEl(); if (hint) { hint.hidden = false; }
      var btn = saveBtnEl(); if (btn) { btn.classList.add('is-dirty'); }
    }
    function clearDirty() {
      dirty = false;
      var hint = dirtyHintEl(); if (hint) { hint.hidden = true; }
      var btn = saveBtnEl(); if (btn) { btn.classList.remove('is-dirty'); }
    }

    // ── detail shell ─────────────────────────────────────────────────────
    function field(card, name) { return card.getAttribute('data-field-' + name) || ''; }

    function detailHtml(card) {
      var change = card.getAttribute('data-aico-change-request-id');
      var name = field(card, 'name') || field(card, 'company') || field(card, 'address1');

      var headAttrs = 'data-aico-crm-address-id="' + esc(card.getAttribute('data-aico-crm-address-id')) + '" data-bucket="store_locator"';
      if (change) { headAttrs += ' data-aico-change-request-id="' + esc(change) + '"'; }
      ADDRESS_FIELDS.forEach(function (key) {
        headAttrs += ' data-field-' + key + '="' + esc(field(card, key)) + '"';
      });

      var summary = '';
      if (field(card, 'company') && field(card, 'company') !== name) {
        summary += '<p class="aico-stores-detail-line">' + esc(field(card, 'company')) + '</p>';
      }
      var street = [];
      if (field(card, 'address1')) { street.push(field(card, 'address1')); }
      if (field(card, 'address2')) { street.push(field(card, 'address2')); }
      var locality = (field(card, 'zip') + ' ' + field(card, 'city')).trim();
      var line = street.join(', ');
      if (line && locality) { line += ' · '; }
      line += locality;
      if (field(card, 'country')) { line += ' · ' + field(card, 'country'); }
      if (line) { summary += '<p class="aico-stores-detail-line">' + esc(line) + '</p>'; }
      if (field(card, 'phone')) { summary += '<p class="aico-stores-detail-line">' + esc(field(card, 'phone')) + '</p>'; }

      var badge = change ? '<span class="aico-change-pending-badge" data-aico-change-pending>' + esc(t('changePending', 'Change pending')) + '</span>' : '';
      var changeBtn = change
        ? '<button type="button" class="aico-stores-btn aico-stores-btn--ghost is-pending" data-aico-change-open>' + esc(t('editRequest', 'Change the request')) + '</button>'
        : '<button type="button" class="aico-stores-btn aico-stores-btn--ghost" data-aico-change-open>' + esc(t('requestChange', 'Request address change')) + '</button>';

      var html = ''
        + '<header class="aico-stores-detail-head" ' + headAttrs + '>'
        + '  <div class="aico-stores-detail-id">'
        + '    <h2 class="aico-stores-detail-name">' + esc(name) + '</h2>'
        + summary
        + '  </div>'
        + '  <div class="aico-stores-detail-change">' + badge + changeBtn + '</div>'
        + '</header>'
        + '<div class="aico-stores-body">';

      [['contact', 'sectionContact'], ['hours', 'sectionHours'], ['images', 'sectionImages']].forEach(function (pair) {
        html += '<section class="aico-stores-section" data-aico-stores-section="' + pair[0] + '">'
          + '<h3 class="aico-stores-section-title">' + esc(t(pair[1], pair[0])) + '</h3>'
          + '<div class="aico-stores-section-body" data-aico-stores-panel="' + pair[0] + '">'
          + '<p class="aico-stores-loading">' + esc(t('loading', 'Loading…')) + '</p>'
          + '</div></section>';
      });

      html += '</div>'
        + '<div class="aico-stores-savebar">'
        + '<span class="aico-stores-dirty" data-aico-stores-dirty hidden>' + esc(t('unsavedHint', 'You have unsaved changes')) + '</span>'
        + '<button type="button" class="aico-stores-save" data-aico-stores-save>' + esc(t('saveChanges', 'Save changes')) + '</button>'
        + '</div>';

      return html;
    }

    function queryPanels() {
      panels.contact = detail.querySelector('[data-aico-stores-panel="contact"]');
      panels.hours = detail.querySelector('[data-aico-stores-panel="hours"]');
      panels.images = detail.querySelector('[data-aico-stores-panel="images"]');
    }

    // ── contact section ──────────────────────────────────────────────────
    function contactRow(kind, entry) {
      entry = entry || {};
      var isEmail = kind === 'email';
      var valueAttr = isEmail ? 'data-value-email' : 'data-value-phone';
      var fieldLabel = isEmail ? t('emailAddressLabel', 'Email address') : t('numberLabel', 'Phone number');
      var placeholder = isEmail ? t('emailPlaceholder', 'Email') : t('phonePlaceholder', 'Phone');
      var value = isEmail ? (entry.email || '') : (entry.phone || '');
      return '<div class="aico-stores-contact-row" data-contact-row="' + kind + '" data-id="' + esc(entry.id || '') + '">'
        + '<label class="aico-stores-field aico-stores-field--grow"><span class="aico-stores-label">' + esc(fieldLabel) + '</span>'
        + '<input class="aico-stores-input" type="' + (isEmail ? 'email' : 'tel') + '" ' + valueAttr + ' placeholder="' + esc(placeholder) + '" value="' + esc(value) + '"></label>'
        + '<label class="aico-stores-field aico-stores-field--grow"><span class="aico-stores-label">' + esc(t('labelFieldLabel', 'Label')) + '</span>'
        + '<input class="aico-stores-input" type="text" data-value-label placeholder="' + esc(t('labelPlaceholder', 'Label')) + '" value="' + esc(entry.label || '') + '"></label>'
        + '<label class="aico-stores-main"><input type="radio" name="' + kind + '-main" data-main' + (entry.isMain ? ' checked' : '') + '><span>' + esc(t('mainLabel', 'main')) + '</span></label>'
        + '<button type="button" class="aico-stores-iconbtn" data-remove aria-label="' + esc(t('removeLabel', 'Remove')) + '">&times;</button>'
        + '</div>';
    }
    function contactGroup(kind, entries) {
      var subhead = kind === 'email' ? t('emails', 'Emails') : t('phones', 'Phones');
      var addLabel = kind === 'email' ? t('addEmail', 'Email') : t('addPhone', 'Phone');
      var empty = kind === 'email' ? t('noEmails', '') : t('noPhones', '');
      var html = '<div class="aico-stores-group" data-contact-group="' + kind + '">'
        + '<h4 class="aico-stores-subhead">' + esc(subhead) + '</h4>'
        + '<div class="aico-stores-contact-rows" data-contact-rows="' + kind + '">';
      if (!entries.length && empty) { html += '<p class="aico-stores-muted" data-contact-empty>' + esc(empty) + '</p>'; }
      entries.forEach(function (entry) { html += contactRow(kind, entry); });
      html += '</div>'
        + '<button type="button" class="aico-stores-add" data-add="' + kind + '">+ ' + esc(addLabel) + '</button>'
        + '</div>';
      return html;
    }
    function renderContact(data) {
      var phones = (data && data.phones) || [];
      var emails = (data && data.emails) || [];
      var website = (data && data.websiteUrl) || '';
      panels.contact.innerHTML = ''
        + contactGroup('phone', phones)
        + contactGroup('email', emails)
        + '<label class="aico-stores-field"><span class="aico-stores-label">' + esc(t('website', 'Website')) + '</span>'
        + '<input class="aico-stores-input" type="text" data-website placeholder="' + esc(t('websitePlaceholder', '')) + '" value="' + esc(website) + '"></label>';
    }
    function collectContactList(kind) {
      var rows = panels.contact.querySelectorAll('[data-contact-row="' + kind + '"]');
      return Array.prototype.map.call(rows, function (row) {
        var valueEl = row.querySelector(kind === 'email' ? '[data-value-email]' : '[data-value-phone]');
        var entry = {
          id: row.getAttribute('data-id') || null,
          label: (row.querySelector('[data-value-label]') || {}).value || '',
          isMain: !!(row.querySelector('[data-main]') || {}).checked,
          crmAddressId: crmAddressId
        };
        entry[kind === 'email' ? 'email' : 'phone'] = valueEl ? valueEl.value : '';
        return entry;
      }).filter(function (entry) { return (entry.phone || entry.email || '').trim() !== ''; });
    }
    function collectContact() {
      var websiteEl = panels.contact.querySelector('[data-website]');
      return {
        phones: collectContactList('phone'),
        emails: collectContactList('email'),
        websiteUrl: websiteEl ? websiteEl.value : '',
        crmAddressId: crmAddressId
      };
    }
    function loadContact() {
      panels.contact.innerHTML = '<p class="aico-stores-loading">' + esc(t('loading', 'Loading…')) + '</p>';
      return request('GET', endpoint('/contact-info?crmAddressId=' + encodeURIComponent(crmAddressId)))
        .then(function (res) { renderContact((res && res.data) || res || {}); })
        .catch(function () { renderContact({}); });
    }

    // ── opening-hours section ────────────────────────────────────────────
    // Collapse the API's duplicate day rows into one model per weekday.
    function canonicalDays(payload) {
      var raw = (payload && payload.openingHours) || [];
      var byDay = {};
      raw.forEach(function (record) {
        var key = String(record.day || '').toLowerCase();
        if (DAYS.indexOf(key) === -1) { return; }
        var intervals = (record.b2b_calendar_time_intervals || record.times || []).map(function (interval) {
          return { id: interval.id || null, open: hhmm(interval.start_time || interval.open), close: hhmm(interval.end_time || interval.close) };
        });
        var existing = byDay[key];
        if (!existing) {
          byDay[key] = { key: key, id: record.id || null, isActive: !!record.is_active, intervals: intervals };
        } else {
          // Prefer the record that actually carries intervals as the save target.
          if (intervals.length && !existing.intervals.length) { existing.id = record.id || existing.id; }
          existing.intervals = existing.intervals.concat(intervals);
          existing.isActive = existing.isActive || !!record.is_active;
        }
      });
      return DAYS.map(function (key) {
        return byDay[key] || { key: key, id: null, isActive: false, intervals: [] };
      });
    }
    function intervalRow(interval) {
      interval = interval || {};
      return '<div class="aico-stores-interval" data-interval data-id="' + esc(interval.id || '') + '">'
        + '<input class="aico-stores-time" type="time" data-open value="' + esc(interval.open || '') + '" aria-label="' + esc(t('openLabel', 'Open')) + '">'
        + '<span class="aico-stores-time-sep">–</span>'
        + '<input class="aico-stores-time" type="time" data-close value="' + esc(interval.close || '') + '" aria-label="' + esc(t('closeLabel', 'Close')) + '">'
        + '<button type="button" class="aico-stores-iconbtn aico-stores-interval-remove" data-interval-remove aria-label="' + esc(t('removeLabel', 'Remove')) + '">&times;</button>'
        + '</div>';
    }
    function dayBodyHtml(day) {
      var html = '<div class="aico-stores-intervals" data-intervals>';
      day.intervals.forEach(function (interval) { html += intervalRow(interval); });
      html += '</div>';
      html += '<button type="button" class="aico-stores-add aico-stores-add-interval" data-add-interval' + (day.intervals.length >= MAX_INTERVALS ? ' hidden' : '') + '>+ ' + esc(t('addInterval', 'Add hours')) + '</button>';
      return html;
    }
    function dayRow(day) {
      var label = (i18n.days && i18n.days[day.key]) || day.key;
      return '<div class="aico-stores-day' + (day.isActive ? ' is-open' : '') + '" data-day-row data-day="' + esc(day.key) + '" data-id="' + esc(day.id || '') + '">'
        + '<label class="aico-stores-day-toggle"><input type="checkbox" data-day-active' + (day.isActive ? ' checked' : '') + '><span class="aico-stores-day-name">' + esc(label) + '</span></label>'
        + '<div class="aico-stores-day-body" data-day-body>' + dayBodyHtml(day) + '</div>'
        + '<span class="aico-stores-day-closed" data-day-closed>' + esc(t('closed', 'Closed')) + '</span>'
        + '</div>';
    }
    function renderHours(payload) {
      var days = canonicalDays(payload);
      loadedIntervalIds = {};
      days.forEach(function (day) {
        loadedIntervalIds[day.key] = day.intervals.map(function (i) { return i.id; }).filter(Boolean);
      });
      var isActive = !payload || payload.isCalendarActive !== false && payload.isCalendarActive !== 0;
      var notice = (payload && payload.notice) || '';
      var html = '<label class="aico-stores-toggle"><input type="checkbox" data-calendar-active' + (isActive ? ' checked' : '') + '><span>' + esc(t('calendarActive', 'Calendar active')) + '</span></label>';
      if (t('calendarActiveHint', '')) { html += '<p class="aico-stores-hint">' + esc(t('calendarActiveHint', '')) + '</p>'; }
      html += '<div class="aico-stores-days">';
      days.forEach(function (day) { html += dayRow(day); });
      html += '</div>';
      if (t('hoursHint', '')) { html += '<p class="aico-stores-hint">' + esc(t('hoursHint', '')) + '</p>'; }
      html += '<label class="aico-stores-field"><span class="aico-stores-label">' + esc(t('notice', 'Notice')) + '</span>'
        + '<textarea class="aico-stores-input aico-stores-textarea" data-notice maxlength="200" placeholder="' + esc(t('noticePlaceholder', '')) + '">' + esc(notice) + '</textarea></label>';
      panels.hours.innerHTML = html;
    }
    function collectHours() {
      var openingHours = Array.prototype.map.call(panels.hours.querySelectorAll('[data-day-row]'), function (row) {
        var key = row.getAttribute('data-day');
        var dayId = row.getAttribute('data-id') || null;
        var times = [];
        var seen = {};
        Array.prototype.forEach.call(row.querySelectorAll('[data-interval]'), function (intervalEl) {
          var id = intervalEl.getAttribute('data-id') || null;
          var open = (intervalEl.querySelector('[data-open]') || {}).value || '';
          var close = (intervalEl.querySelector('[data-close]') || {}).value || '';
          if (id) { seen[id] = true; }
          if (open || close) {
            times.push({ id: id, open: open, close: close, shouldDelete: false });
          } else if (id) {
            times.push({ id: id, open: open, close: close, shouldDelete: true });
          }
        });
        // Intervals that existed at load but were removed from the DOM → delete.
        (loadedIntervalIds[key] || []).forEach(function (id) {
          if (!seen[id]) { times.push({ id: id, open: '', close: '', shouldDelete: true }); }
        });
        return {
          day: key.charAt(0).toUpperCase() + key.slice(1),
          id: dayId,
          isActive: !!(row.querySelector('[data-day-active]') || {}).checked,
          times: times
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
      panels.hours.innerHTML = '<p class="aico-stores-loading">' + esc(t('loading', 'Loading…')) + '</p>';
      return request('GET', endpoint('/opening-hours?crmAddressId=' + encodeURIComponent(crmAddressId)))
        .then(function (res) { renderHours((res && res.data) || res || {}); })
        .catch(function () { renderHours({}); });
    }

    // ── images section ───────────────────────────────────────────────────
    function imageCard(image) {
      image = image || {};
      return '<div class="aico-stores-image" data-image-row data-id="' + esc(image.id || '') + '">'
        + (image.imageUrl
            ? '<img src="' + esc(image.imageUrl) + '" alt="" class="aico-stores-image-thumb">'
            : '<span class="aico-stores-image-thumb aico-stores-image-thumb--empty" aria-hidden="true"></span>')
        + '<div class="aico-stores-image-fields">'
        + '<label class="aico-stores-field"><span class="aico-stores-label">' + esc(t('imageTitle', 'Title')) + '</span>'
        + '<input class="aico-stores-input" type="text" data-image-title value="' + esc(image.title || '') + '"></label>'
        + '<label class="aico-stores-field aico-stores-field--order"><span class="aico-stores-label">' + esc(t('orderLabel', 'Order')) + '</span>'
        + '<input class="aico-stores-input" type="number" min="0" data-image-order value="' + esc(image.sortOrder || 0) + '"></label>'
        + '</div>'
        + '<button type="button" class="aico-stores-iconbtn aico-stores-image-remove" data-image-delete aria-label="' + esc(t('removeLabel', 'Remove')) + '">&times;</button>'
        + '</div>';
    }
    function renderImages(images) {
      images = images || [];
      var html = '';
      if (t('imagesHint', '')) { html += '<p class="aico-stores-hint">' + esc(t('imagesHint', '')) + '</p>'; }
      html += '<div class="aico-stores-images" data-images>';
      if (!images.length) { html += '<p class="aico-stores-muted" data-images-empty>' + esc(t('noImages', 'No images yet.')) + '</p>'; }
      images.forEach(function (image) { html += imageCard(image); });
      html += '</div>';
      html += '<label class="aico-stores-upload">'
        + '<input type="file" accept="image/*" data-image-file hidden>'
        + '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path></svg>'
        + '<span>' + esc(t('addImage', 'Add image')) + '</span>'
        + '</label>';
      panels.images.innerHTML = html;
    }
    function collectImageOrder() {
      return Array.prototype.map.call(panels.images.querySelectorAll('[data-image-row]'), function (row) {
        return {
          id: row.getAttribute('data-id') || null,
          title: (row.querySelector('[data-image-title]') || {}).value || '',
          sortOrder: parseInt((row.querySelector('[data-image-order]') || {}).value, 10) || 0
        };
      });
    }
    function loadImages() {
      panels.images.innerHTML = '<p class="aico-stores-loading">' + esc(t('loading', 'Loading…')) + '</p>';
      return request('GET', endpoint('/calendar-images?crmAddressId=' + encodeURIComponent(crmAddressId)))
        .then(function (res) { renderImages((res && res.data) || res || []); })
        .catch(function () { renderImages([]); });
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

    // ── save all ─────────────────────────────────────────────────────────
    function saveAll() {
      if (!crmAddressId) { return Promise.resolve(false); }
      var btn = saveBtnEl(); if (btn) { btn.disabled = true; }
      setStatus(copy.saving, 'saving');
      return Promise.all([
        request('POST', endpoint('/contact-info'), collectContact()),
        request('POST', endpoint('/opening-hours'), collectHours()),
        request('POST', endpoint('/calendar-images-order'), { crmAddressId: crmAddressId, calendarImages: collectImageOrder() })
      ]).then(function () {
        clearDirty();
        setStatus(copy.saved, 'saved');
        if (btn) { btn.disabled = false; }
        // Reload hours so freshly-created interval ids are tracked for next save.
        return loadHours().then(function () { return true; });
      }).catch(function () {
        setStatus(copy.error, 'error');
        if (btn) { btn.disabled = false; }
        return false;
      });
    }

    // ── selection ────────────────────────────────────────────────────────
    function doSelect(card) {
      crmAddressId = card.getAttribute('data-aico-crm-address-id');
      activeCard = card;
      if (list) {
        Array.prototype.forEach.call(list.querySelectorAll('[data-aico-stores-select]'), function (item) {
          item.classList.toggle('is-active', item === card);
          if (item === card) { item.setAttribute('aria-current', 'true'); } else { item.removeAttribute('aria-current'); }
        });
      }
      detail.innerHTML = detailHtml(card);
      detail.classList.add('is-loaded');
      queryPanels();
      clearDirty();
      loadContact();
      loadHours();
      loadImages();
    }
    function selectStore(card) {
      if (!card || card === activeCard) { return; }
      if (dirty) { openLeave({ type: 'switch', card: card }); return; }
      doSelect(card);
    }

    // ── leave / switch guard ─────────────────────────────────────────────
    function openLeave(action) {
      pendingAction = action;
      if (leaveModal) { leaveModal.hidden = false; leaveModal.setAttribute('aria-hidden', 'false'); }
    }
    function closeLeave() {
      pendingAction = null;
      if (leaveModal) { leaveModal.hidden = true; leaveModal.setAttribute('aria-hidden', 'true'); }
    }
    function performPending() {
      var action = pendingAction;
      closeLeave();
      if (!action) { return; }
      clearDirty();
      if (action.type === 'nav') { window.location.href = action.href || accountUrl; }
      else if (action.type === 'switch') { doSelect(action.card); }
    }

    // ── events ───────────────────────────────────────────────────────────
    // List search.
    var search = root.querySelector('[data-aico-stores-search]');
    var noResults = root.querySelector('[data-aico-stores-noresults]');
    if (search && list) {
      search.addEventListener('input', function () {
        var q = search.value.trim().toLowerCase();
        var any = false;
        Array.prototype.forEach.call(list.querySelectorAll('[data-aico-stores-select]'), function (item) {
          var hay = item.getAttribute('data-search') || item.textContent || '';
          var match = !q || hay.toLowerCase().indexOf(q) !== -1;
          item.hidden = !match;
          if (match) { any = true; }
        });
        if (noResults) { noResults.hidden = any; }
      });
    }

    // Intercept in-app navigation (back link / nav) while dirty.
    document.addEventListener('click', function (event) {
      var link = event.target.closest('a[href]');
      if (!link || link.closest('[data-aico-stores-leave]')) { return; }
      if (link.getAttribute('target') === '_blank' || link.hasAttribute('download')) { return; }
      var href = link.getAttribute('href');
      if (!href || href.charAt(0) === '#' || href.indexOf('javascript:') === 0) { return; }
      if (!dirty) { return; }
      event.preventDefault();
      openLeave({ type: 'nav', href: link.href });
    });

    root.addEventListener('click', function (event) {
      var selectBtn = event.target.closest('[data-aico-stores-select]');
      if (selectBtn && (!list || list.contains(selectBtn))) { selectStore(selectBtn); return; }

      if (event.target.closest('[data-aico-stores-save]')) { saveAll(); return; }
      if (event.target.closest('[data-aico-stores-leave-cancel]')) { closeLeave(); return; }
      if (event.target.closest('[data-aico-stores-leave-discard]')) { performPending(); return; }
      if (event.target.closest('[data-aico-stores-leave-save]')) {
        saveAll().then(function (ok) { if (ok) { performPending(); } });
        return;
      }

      var add = event.target.closest('[data-add]');
      if (add) {
        var kind = add.getAttribute('data-add');
        var rows = panels.contact.querySelector('[data-contact-rows="' + kind + '"]');
        var empty = rows.querySelector('[data-contact-empty]');
        if (empty) { empty.parentNode.removeChild(empty); }
        rows.insertAdjacentHTML('beforeend', contactRow(kind, {}));
        markDirty();
        return;
      }
      var remove = event.target.closest('[data-remove]');
      if (remove) {
        var row = remove.closest('[data-contact-row]');
        if (row) { row.parentNode.removeChild(row); markDirty(); }
        return;
      }

      var addInterval = event.target.closest('[data-add-interval]');
      if (addInterval) {
        var dayBody = addInterval.closest('[data-day-body]');
        var intervals = dayBody.querySelector('[data-intervals]');
        if (intervals.querySelectorAll('[data-interval]').length < MAX_INTERVALS) {
          intervals.insertAdjacentHTML('beforeend', intervalRow({}));
        }
        if (intervals.querySelectorAll('[data-interval]').length >= MAX_INTERVALS) { addInterval.hidden = true; }
        markDirty();
        return;
      }
      var intervalRemove = event.target.closest('[data-interval-remove]');
      if (intervalRemove) {
        var dayBody2 = intervalRemove.closest('[data-day-body]');
        var intervalEl = intervalRemove.closest('[data-interval]');
        if (intervalEl) { intervalEl.parentNode.removeChild(intervalEl); }
        var addBtn = dayBody2.querySelector('[data-add-interval]');
        if (addBtn && dayBody2.querySelectorAll('[data-interval]').length < MAX_INTERVALS) { addBtn.hidden = false; }
        markDirty();
        return;
      }

      var imageDelete = event.target.closest('[data-image-delete]');
      if (imageDelete) {
        var imageRowEl = imageDelete.closest('[data-image-row]');
        if (imageRowEl) { deleteImage(imageRowEl.getAttribute('data-id'), imageRowEl); }
      }
    });

    // Toggling a day open/closed reflects on its row immediately.
    root.addEventListener('change', function (event) {
      var fileInput = event.target.closest('[data-image-file]');
      if (fileInput && fileInput.files && fileInput.files[0]) { uploadImage(fileInput.files[0]); return; }
      var dayActive = event.target.closest('[data-day-active]');
      if (dayActive) {
        var dayRowEl = dayActive.closest('[data-day-row]');
        if (dayRowEl) { dayRowEl.classList.toggle('is-open', dayActive.checked); }
      }
      if (event.target.closest('[data-aico-stores-section]')) { markDirty(); }
    });
    root.addEventListener('input', function (event) {
      if (event.target.closest('[data-image-file]')) { return; }
      if (event.target.closest('[data-aico-stores-section]')) { markDirty(); }
    });

    window.addEventListener('beforeunload', function (event) {
      if (!dirty) { return; }
      event.preventDefault();
      event.returnValue = '';
      return '';
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && leaveModal && !leaveModal.hidden) { closeLeave(); }
    });

    // Initial selection: the server-marked active card, else the first store.
    if (list) {
      var initial = list.querySelector('[data-aico-stores-select].is-active')
        || list.querySelector('[data-aico-stores-select]');
      if (initial) { doSelect(initial); }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
