/*
 * Ads / kybun-joya multi-step form (formName: kj-ads-form).
 * Self-contained port of the legacy b2b-shop src/pages/ads/kybun-joya.
 *
 * Submits a multipart POST to {{ routes.aico_forms_url }} with attachments[] and
 * data = {data:{formName:'kj-ads-form', description:{text:<blob>}}}, where the
 * blob is the numbered de_CH Q&A (mirrors the old prepareFormData). Validation
 * mirrors the old firstPage/secondPage.schema.js.
 *
 * Two input pages + a thank-you step. Strings are inlined (de_CH + en) so the
 * form is self-contained; the template supplies resolved image URLs + the
 * active locale + the logged-in user's email/address via the JSON config block.
 *
 * validatePage()/buildBlob() are exported when run under Node so the checks and
 * the submitted text can be unit-tested without a browser; in the browser the
 * module self-boots and renders its own DOM (no shared renderer dependency).
 *
 * Rendering is incremental: each page builds its DOM once; in-page interactions
 * mutate the existing DOM in place (toggle classes, show/hide conditional fields,
 * append/remove single rows, refresh errors). A full rebuild happens ONLY on page
 * navigation (Next / Back / thank-you).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', api.boot);
    else api.boot();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STR = {
    de_CH: {
      userInfo: { text: 'Benutzerinformationen', email: 'E-Mail', address: 'Adresse' },
      errors: { requiredField: 'Dieses Feld ist erforderlich.', requiredQuestion: 'Diese Frage ist erforderlich.' },
      back: 'Zurück', next: 'Weiter',
      firstPage: {
        infoText: { part1: 'Durch Ausfüllen des folgenden Formulars, kannst du dir deine nächste kybun Joya Print-Werbeanzeige zusammenstellen. Jeder Schritt bzw. jede Gestaltungsoption wird ausführlich erklärt.', part2: 'Alle mit einem Sternchen * markierten Angaben sind Pflichtangaben.', part3: 'Ohne diese kann das Formular nicht abgesendet werden.', part4: 'Bei Fragen wende dich bitte an ', mail: 'marketing@kybunjoya.swiss' },
        question1: { text: 'Wann muss die Werbeanzeige bei deiner Zeitung eingereicht werden? *', note: '(mindestens 5 Werktage Vorlaufzeit notwendig)', errors: { minWorkingDays: 'Mindestens 5 Werktage Vorlaufzeit notwendig' } },
        question2: { text: 'Hat die kybun Joya Marketingabteilung dein Geschäftslogo schon in hochauflösender Form? *', option1: 'Ja, ist schon vorhanden', option2: 'Nein, bisher noch nicht', uploadText: 'Bitte hochauflösendes Logo hier hochladen', dropFilesOr: 'Dateien hier ablegen oder', browse: 'Durchsuchen', errors: { uploadRequired: 'Bitte lade ein hochauflösendes Logo hoch.' } }
      },
      secondPage: {
        question3: { text: 'Wähle ein Schmerzbild *', option1: 'a. Rücken', option2: 'b. Knie', option3: 'c. Fuss' },
        question4: { text: 'Wähle einen Anzeigentext *', option1: 'Klassischer PR-Text, obligatorisch bei Inseratgrössen ca. DIN A5 und kleiner', option2: 'Zitat Händler', option3: 'Interview Händler, Inseratgrösse grösser DIN A4' },
        question5: { text: 'Welche Joya Modelle sollen abgebildet werden? *', subText: 'Es sind maximal {{count}} Bilder von A-Ansichten möglich, sowie ein Portrait des Interview-Partners bei den Interview-Texten.', errors: { shoeModelNameRequired: 'Bitte geben Sie den Namen des Joya Schuhmodells an.' } },
        question6: { text: 'Welche kybun Modelle sollen abgebildet werden? *', subText: 'Es sind maximal {{count}} Bilder von A-Ansichten möglich, sowie ein Portrait des Interview-Partners bei den Interview-Texten.', errors: { shoeModelNameRequired: 'Bitte geben Sie den Namen des kybun Schuhmodells an.' } },
        question7: { text: 'Soll es einen Gutschein/Coupon geben? *', option1: 'a. Nein', option2: 'b. Kostenlose Fussdruckmessung im Wert von CHF 30/ EUR 25', option3: 'c. Rabatt von <input/> CHF bzw. € auf kybun und Joya Produkte', extraText: 'Coupon gültig von/bis: *', errors: { couponValueRequired: 'Bitte geben Sie den Rabattbetrag an.', couponValidityRequired: 'Bitte geben Sie die Gültigkeitsdauer des Coupons an.' } },
        question8: { text: 'Bitte gib das genaue Format der Anzeige an. Erst nach Erhalt der exakten Maße kann mit der Erstellung deiner Werbeanzeige begonnen werden. *', widthInMM: 'Breite in mm', heightInMM: 'Höhe in mm', errors: { positiveNumber: 'Bitte geben Sie eine positive Zahl ein.' } },
        otherShoeModel: 'Anderes Schuhmodell', shoeModelName: 'Name des/r Schuhmodells/e *', addModel: 'Modell hinzufügen', submit: 'Absenden'
      },
      forthPage: { youMadeIt: 'Du hast es geschafft!', message1: 'Die Details Ihrer Buchung werden nun an unsere Marketingabteilung weitergeleitet.', message2: 'Wir werden uns in Kürze mit einem Entwurf bei Ihnen melden.' }
    },
    en: {
      userInfo: { text: 'User Information', email: 'E-Mail', address: 'Address' },
      errors: { requiredField: 'This field is required.', requiredQuestion: 'This question is required.' },
      back: 'Back', next: 'Next',
      firstPage: {
        infoText: { part1: 'By filling out the following form, you can put together your next kybun Joya print ad. Each step or design option is explained in detail.', part2: 'All details marked with a star * are mandatory.', part3: 'The form cannot be sent without this information.', part4: 'If you have any questions, please contact ', mail: 'marketing@kybunjoya.swiss' },
        question1: { text: 'When must the advertisement be submitted to your newspaper? *', note: '(Minimum lead time of 5 business days required)', errors: { minWorkingDays: 'Minimum lead time of 5 business days required' } },
        question2: { text: 'Does the kybun Joya Marketing Department already have your business logo in high resolution? *', option1: 'Yes, already exists', option2: 'No, not yet', uploadText: 'Please upload your high-resolution logo here', dropFilesOr: 'Drop files here or', browse: 'Browse', errors: { uploadRequired: 'Please upload a high-resolution logo.' } }
      },
      secondPage: {
        question3: { text: 'Choose a pain point *', option1: 'a. Back', option2: 'b. Knee', option3: 'c. Foot' },
        question4: { text: 'Select an ad text *', option1: 'Classic PR text, mandatory for ad sizes approx. DIN A5 and smaller', option2: 'Quote from dealer', option3: 'Interview with dealer, advertisement size larger than DIN A4' },
        question5: { text: 'Which Joya models should be shown? *', subText: 'A maximum of {{count}} pictures of A-views are possible, as well as a portrait of the interview partner in the interview texts.', errors: { shoeModelNameRequired: 'Please specify the Joya shoe model name.' } },
        question6: { text: 'Which kybun models should be shown? *', subText: 'A maximum of {{count}} pictures of A-views are possible, as well as a portrait of the interview partner in the interview texts.', errors: { shoeModelNameRequired: 'Please specify the kybun shoe model name.' } },
        question7: { text: 'Should there be a voucher/coupon? *', option1: 'a. No', option2: 'b. Free foot pressure measurement worth CHF 30/ EUR 25', option3: 'c. Discount of <input/> CHF or € on kybun and Joya products', extraText: 'Coupon valid from/to: *', errors: { couponValueRequired: 'Please specify the discount amount.', couponValidityRequired: 'Please specify the coupon validity period.' } },
        question8: { text: 'Please specify the exact format of the ad. We can only start creating your advertisement once we have received the exact dimensions. *', widthInMM: 'Width in mm', heightInMM: 'Height in mm', errors: { positiveNumber: 'Please enter a positive number.' } },
        otherShoeModel: 'Other shoe model', shoeModelName: 'Shoe model name *', addModel: 'Add model', submit: 'Submit'
      },
      forthPage: { youMadeIt: 'You have made it!', message1: 'The details of your booking will now be sent to our marketing department.', message2: 'We will get back to you shortly with a draft.' }
    }
  };

  function get(o, p) { return p.split('.').reduce(function (x, k) { return x == null ? undefined : x[k]; }, o); }
  function blank(v) { return v == null || (typeof v === 'string' && v.trim() === ''); }
  function emptyArr(v) { return !Array.isArray(v) || v.length === 0; }

  // ---- working-days rule (mirror isAtLeastFiveWorkingDaysAway) ----
  function fiveWorkingDaysAway(dateStr, now) {
    var d = new Date(dateStr); if (isNaN(d.getTime())) return false;
    var c = new Date((now || new Date()).getTime()); c.setHours(0, 0, 0, 0);
    var target = new Date(d.getTime()); target.setHours(0, 0, 0, 0);
    var added = 0;
    while (added < 5) { c.setDate(c.getDate() + 1); var w = c.getDay(); if (w !== 0 && w !== 6) added++; }
    return target.getTime() >= c.getTime();
  }

  function initialState() {
    return {
      userInfo: { email: '', address: '' },
      firstPage: { question1: '', question2: '', uploadedFiles: [] },
      secondPage: {
        question3: '', question4: '',
        question5: [], question5Extra: '', question6: [], question6Extra: '',
        question7: '', question7Option3Input: '', question7Extra: '',
        question8: { inputWidth: '', inputHeight: '' }
      }
    };
  }

  // ---- validation (mirrors the kj ads *.schema.js) — returns {field:errorMsg} ----
  // `de` is the canonical de_CH bundle used for value comparison (state stores de_CH
  // option strings); `msg` (optional) is the display-language bundle used only to
  // resolve the error message text. Falls back to `de` when omitted.
  function validatePage(pageNum, state, de, msg) {
    var e = {}, s = state, m = msg || de, set = function (f, k) { e[f] = get(m, k); };
    if (pageNum === 1) {
      var fp = s.firstPage;
      if (blank(fp.question1)) set('firstPage.question1', 'errors.requiredQuestion');
      else if (isNaN(new Date(fp.question1).getTime())) set('firstPage.question1', 'errors.requiredField');
      else if (!fiveWorkingDaysAway(fp.question1)) set('firstPage.question1', 'firstPage.question1.errors.minWorkingDays');
      if (blank(fp.question2)) set('firstPage.question2', 'errors.requiredQuestion');
      if (fp.question2 === get(de, 'firstPage.question2.option2') && emptyArr(fp.uploadedFiles)) set('firstPage.uploadedFiles', 'firstPage.question2.errors.uploadRequired');
    } else if (pageNum === 2) {
      var sp = s.secondPage, other = get(de, 'secondPage.otherShoeModel');
      if (blank(sp.question3)) set('secondPage.question3', 'errors.requiredQuestion');
      if (blank(sp.question4)) set('secondPage.question4', 'errors.requiredQuestion');
      if (emptyArr(sp.question5)) set('secondPage.question5', 'errors.requiredQuestion');
      if (emptyArr(sp.question6)) set('secondPage.question6', 'errors.requiredQuestion');
      if (blank(sp.question7)) set('secondPage.question7', 'errors.requiredQuestion');
      if ((sp.question5 || []).indexOf(other) !== -1 && blank(sp.question5Extra)) set('secondPage.question5Extra', 'secondPage.question5.errors.shoeModelNameRequired');
      if ((sp.question6 || []).indexOf(other) !== -1 && blank(sp.question6Extra)) set('secondPage.question6Extra', 'secondPage.question6.errors.shoeModelNameRequired');
      var o2 = get(de, 'secondPage.question7.option2'), o3 = get(de, 'secondPage.question7.option3');
      if ([o2, o3].indexOf(sp.question7) !== -1 && blank(sp.question7Extra)) set('secondPage.question7Extra', 'secondPage.question7.errors.couponValidityRequired');
      if (sp.question7 === o3 && blank(sp.question7Option3Input)) set('secondPage.question7Option3Input', 'secondPage.question7.errors.couponValueRequired');
      ['inputWidth', 'inputHeight'].forEach(function (k) {
        var v = sp.question8[k];
        if (blank(v)) set('secondPage.question8.' + k, 'errors.requiredField');
        else if (!isFinite(Number(v))) set('secondPage.question8.' + k, 'errors.requiredField');
        else if (Number(v) < 0) set('secondPage.question8.' + k, 'secondPage.question8.errors.positiveNumber');
      });
    }
    return e;
  }

  // ---- kj text blob (mirrors prepareFormData, de_CH labels) ----
  function buildBlob(state, de) {
    var TAB = '\t', NL = '\n', o = '', f = state, other = get(de, 'secondPage.otherShoeModel');
    var fp = f.firstPage, sp = f.secondPage;

    o += '1. ' + get(de, 'firstPage.question1.text') + NL + TAB + fp.question1 + NL + NL;
    o += '2. ' + get(de, 'firstPage.question2.text') + NL + TAB + fp.question2 + NL + NL;

    o += '3. ' + get(de, 'secondPage.question3.text') + NL + TAB + (sp.question3 || '-') + NL + NL;
    o += '4. ' + get(de, 'secondPage.question4.text') + NL + TAB + (sp.question4 || '-') + NL + NL;

    o += '5. ' + get(de, 'secondPage.question5.text') + NL;
    (sp.question5 || []).forEach(function (x) { o += TAB + (x === other ? sp.question5Extra : x) + NL; });
    o += NL;

    o += '6. ' + get(de, 'secondPage.question6.text') + NL;
    (sp.question6 || []).forEach(function (x) { o += TAB + (x === other ? sp.question6Extra : x) + NL; });
    o += NL;

    o += '7. ' + get(de, 'secondPage.question7.text') + NL;
    if (sp.question7 === get(de, 'secondPage.question7.option3')) o += TAB + get(de, 'secondPage.question7.option3').replace('<input/>', sp.question7Option3Input) + NL;
    else o += TAB + sp.question7 + NL;
    if (sp.question7Extra) o += TAB + get(de, 'secondPage.question7.extraText') + ': ' + sp.question7Extra + NL;
    o += NL;

    o += '8. ' + get(de, 'secondPage.question8.text') + NL;
    o += TAB + get(de, 'secondPage.question8.widthInMM') + ': ' + sp.question8.inputWidth + NL;
    o += TAB + get(de, 'secondPage.question8.heightInMM') + ': ' + sp.question8.inputHeight + NL + NL;

    o += '------' + NL + get(de, 'userInfo.text') + NL;
    o += TAB + get(de, 'userInfo.email') + ': ' + f.userInfo.email + NL;
    o += TAB + get(de, 'userInfo.address') + ': ' + f.userInfo.address + NL + NL;
    return o;
  }

  // ---- browser bootstrap (self-contained, incremental DOM rendering) ----
  function boot() {
    var root = document.querySelector('[data-aico-eventtool="ads-kybun-joya"]');
    if (!root) return;
    var mount = root.querySelector('[data-et-mount]');
    if (!mount) return;
    var cfgEl = document.getElementById('aico-eventtool-config');
    var cfg = {};
    try { cfg = JSON.parse(cfgEl.textContent); } catch (e) { return; }

    // Display-language resolution: these German-market kj forms default to GERMAN.
    // de* → de_CH; empty or en_us (the prefix-less shop technical default) → de_CH;
    // any other en* → en. Only an explicit non-default English locale is English.
    function resolveDispLang(locale) {
      var l = (locale || '').toLowerCase();
      if (l.indexOf('de') === 0) return 'de_CH';
      if (l === '' || l === 'en_us') return 'de_CH';
      if (l.indexOf('en') === 0) return 'en';
      return 'de_CH';
    }
    var dispLang = resolveDispLang(cfg.locale);   // 'de_CH' | 'en'
    var de = dispLang === 'de_CH';
    var T = de ? STR.de_CH : STR.en;        // display strings (labels + error messages)
    var DE = STR.de_CH;                       // canonical option values + blob (ALWAYS de_CH)

    var FORM_KEY = 'ads-kybun-joya';
    var STORAGE_KEY = 'aico-eventtool-' + FORM_KEY;
    var TOTAL = 2;

    // --- localStorage persistence (excludes uploadedFiles: File objects can't serialize) ---
    function persist() {
      if (page > TOTAL) return;   // don't re-write after a successful submit (thank-you step)
      try {
        var snap = JSON.parse(JSON.stringify(state));   // deep clone via JSON (drops nothing here)
        if (snap.firstPage) snap.firstPage.uploadedFiles = [];
        snap.maxStep = maxStep;   // furthest validated step — sibling of state, never in the payload
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
      } catch (e) { /* storage unavailable / quota — ignore */ }
    }
    function clearPersisted() { try { localStorage.removeItem(STORAGE_KEY); } catch (e) {} }
    function loadPersisted() {
      try { var raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
    }

    var state = initialState();
    var maxStep = 1;   // furthest validated step (jump-ahead guard)
    var saved = loadPersisted();
    if (saved && typeof saved === 'object') {
      // shallow-merge each known slice over the fresh initial state
      if (saved.userInfo) state.userInfo = { email: saved.userInfo.email || '', address: saved.userInfo.address || '' };
      if (saved.firstPage) {
        state.firstPage.question1 = saved.firstPage.question1 || '';
        state.firstPage.question2 = saved.firstPage.question2 || '';
        // uploadedFiles deliberately stays empty (not serialized)
      }
      if (saved.secondPage) {
        var ss = saved.secondPage, ds = state.secondPage;
        ds.question3 = ss.question3 || ''; ds.question4 = ss.question4 || '';
        ds.question5 = Array.isArray(ss.question5) ? ss.question5 : []; ds.question5Extra = ss.question5Extra || '';
        ds.question6 = Array.isArray(ss.question6) ? ss.question6 : []; ds.question6Extra = ss.question6Extra || '';
        ds.question7 = ss.question7 || ''; ds.question7Option3Input = ss.question7Option3Input || ''; ds.question7Extra = ss.question7Extra || '';
        if (ss.question8) ds.question8 = { inputWidth: ss.question8.inputWidth || '', inputHeight: ss.question8.inputHeight || '' };
      }
    }
    if (saved && saved.maxStep != null) {
      var sm = parseInt(saved.maxStep, 10);
      if (!isNaN(sm)) maxStep = Math.min(Math.max(sm, 1), TOTAL);
    }
    // cfg always wins for the user identity fields
    state.userInfo.email = cfg.email || '';
    state.userInfo.address = cfg.address || '';

    var attempted = { 1: false, 2: false };

    // --- current page persisted in the URL (?step=<n>) ---
    function readStepParam() {
      var n;
      try { n = parseInt(new URLSearchParams(window.location.search).get('step'), 10); } catch (e) { n = NaN; }
      if (isNaN(n) || n < 1 || n > TOTAL) return 1;   // clamp to input pages (thank-you isn't bookmarkable)
      return n;
    }
    function writeStepParam(n) {
      try {
        var u = new URL(window.location.href);
        u.searchParams.set('step', String(n));
        window.history.replaceState(window.history.state, '', u.toString());
      } catch (e) { /* ignore */ }
    }

    var page = Math.min(readStepParam(), maxStep);   // can't deep-link past the furthest validated step

    function el(tag, cls, txt) { var n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; }

    // --- in-place error helpers ---
    // Errors are keyed to a host element via data-et-err-for; refreshErrors() wipes
    // existing .et-error nodes and re-inserts current ones, without rebuilding fields.
    function clearErrors(scope) {
      var nodes = scope.querySelectorAll('.et-error');
      Array.prototype.forEach.call(nodes, function (n) { n.parentNode.removeChild(n); });
    }
    function attachError(host, key, errs) {
      var msg = errs[key];
      if (!msg) return;
      var span = el('span', 'et-error', msg);
      host.appendChild(span);
    }

    // ================= PAGE 1 =================
    function buildPage1() {
      var step = el('div', 'et-step is-active');

      var info = el('div', 'et-info');
      [T.firstPage.infoText.part1, T.firstPage.infoText.part2, T.firstPage.infoText.part3].forEach(function (t) { info.appendChild(el('p', null, t)); });
      var p4 = el('p'); p4.appendChild(document.createTextNode(T.firstPage.infoText.part4));
      var a = el('a', null, T.firstPage.infoText.mail); a.href = 'mailto:' + T.firstPage.infoText.mail; p4.appendChild(a);
      info.appendChild(p4);
      step.appendChild(info);

      // Q1 date
      var q1 = el('div', 'et-question');
      q1.appendChild(el('div', 'et-qlabel', '1. ' + T.firstPage.question1.text));
      q1.appendChild(el('span', 'et-qnote', T.firstPage.question1.note));
      var d = el('input', 'et-input'); d.type = 'date'; d.value = state.firstPage.question1;
      d.addEventListener('change', function () { state.firstPage.question1 = d.value; if (attempted[1]) refreshErrors1(step); });
      q1.appendChild(d);
      step.appendChild(q1);

      // Q2 chips (single select)
      var q2 = el('div', 'et-question');
      q2.appendChild(el('div', 'et-qlabel', '2. ' + T.firstPage.question2.text));
      var opts = el('div', 'et-options');
      var chipEls = [];
      [['option1', DE.firstPage.question2.option1, T.firstPage.question2.option1],
       ['option2', DE.firstPage.question2.option2, T.firstPage.question2.option2]].forEach(function (o) {
        var chip = el('div', 'et-chip' + (state.firstPage.question2 === o[1] ? ' is-selected' : ''), o[2]);
        chip._val = o[1];
        chip.addEventListener('click', function () {
          state.firstPage.question2 = (state.firstPage.question2 === o[1]) ? '' : o[1];
          chipEls.forEach(function (c) { c.classList.toggle('is-selected', c._val === state.firstPage.question2); });
          up.hidden = state.firstPage.question2 !== DE.firstPage.question2.option2;   // show/hide upload zone
          if (attempted[1]) refreshErrors1(step);
        });
        chipEls.push(chip);
        opts.appendChild(chip);
      });
      q2.appendChild(opts);
      var q2err = el('div'); q2err.setAttribute('data-et-err-for', 'firstPage.question2'); q2.appendChild(q2err);

      // upload zone — rendered once, shown/hidden by the q2 toggle
      var up = el('div', 'et-upload');
      up.hidden = state.firstPage.question2 !== DE.firstPage.question2.option2;
      up.appendChild(el('div', 'et-field-label', T.firstPage.question2.uploadText));
      var zone = el('label', 'et-upload-zone');
      zone.appendChild(el('span', null, T.firstPage.question2.dropFilesOr + ' ' + T.firstPage.question2.browse));
      var fileInput = el('input'); fileInput.type = 'file'; fileInput.multiple = true; fileInput.style.display = 'none';
      zone.appendChild(fileInput);
      up.appendChild(zone);
      var list = el('ul', 'et-upload-list');
      up.appendChild(list);
      var upErr = el('div'); upErr.setAttribute('data-et-err-for', 'firstPage.uploadedFiles'); up.appendChild(upErr);

      function addFileRow(f) {
        var item = el('li', 'et-upload-item');
        item.appendChild(el('span', null, f.name));
        var rm = el('button', null, '×'); rm.type = 'button';
        rm.addEventListener('click', function () {
          var idx = state.firstPage.uploadedFiles.indexOf(f);
          if (idx !== -1) state.firstPage.uploadedFiles.splice(idx, 1);
          list.removeChild(item);
          if (attempted[1]) refreshErrors1(step);
        });
        item.appendChild(rm);
        list.appendChild(item);
      }
      function ingest(files) {
        var existing = state.firstPage.uploadedFiles.map(function (f) { return f.name; });
        Array.prototype.forEach.call(files, function (file) {
          if (existing.indexOf(file.name) === -1) {
            var rec = { file: file, name: file.name };
            state.firstPage.uploadedFiles.push(rec);
            existing.push(file.name);
            addFileRow(rec);
          }
        });
        if (attempted[1]) refreshErrors1(step);
      }
      fileInput.addEventListener('change', function () { ingest(fileInput.files); });
      zone.addEventListener('dragover', function (ev) { ev.preventDefault(); zone.classList.add('is-dragover'); });
      zone.addEventListener('dragleave', function () { zone.classList.remove('is-dragover'); });
      zone.addEventListener('drop', function (ev) { ev.preventDefault(); zone.classList.remove('is-dragover'); ingest(ev.dataTransfer.files); });
      // seed any pre-existing files (none on fresh state, but keeps it robust)
      state.firstPage.uploadedFiles.forEach(addFileRow);
      q2.appendChild(up);
      step.appendChild(q2);

      // actions
      var actions = el('div', 'et-actions');
      actions.appendChild(el('span', 'et-progress', page + ' / ' + TOTAL));
      var next = el('button', 'et-btn et-btn-primary', T.next); next.type = 'button';
      next.addEventListener('click', function () {
        attempted[1] = true;
        if (Object.keys(validatePage(1, state, DE, T)).length) { refreshErrors1(step); return; }
        navigate(2);
      });
      actions.appendChild(next);
      step.appendChild(actions);

      // expose the date question error host
      q1.setAttribute('data-et-err-for', 'firstPage.question1');
      return step;
    }

    function refreshErrors1(step) {
      var errs = validatePage(1, state, DE, T);
      ['firstPage.question1', 'firstPage.question2', 'firstPage.uploadedFiles'].forEach(function (key) {
        var host = step.querySelector('[data-et-err-for="' + key + '"]');
        if (!host) return;
        clearErrors(host);
        attachError(host, key, errs);
      });
    }

    // ================= PAGE 2 =================
    function buildPage2() {
      var step = el('div', 'et-step is-active');
      var imgs = cfg.images || {};

      // Nav bar builder — Back + .et-progress + Submit (with its own spinner).
      // Page 2 (the last input page) renders one at the TOP and one at the BOTTOM;
      // every Submit button is collected so that clicking either disables BOTH.
      var submitBtns = [];
      function makeActions() {
        var actions = el('div', 'et-actions');
        var back = el('button', 'et-btn et-btn-back', T.back); back.type = 'button';
        back.addEventListener('click', function () { navigate(1); });
        actions.appendChild(back);
        actions.appendChild(el('span', 'et-progress', page + ' / ' + TOTAL));
        var submit = el('button', 'et-btn et-btn-primary'); submit.type = 'button';
        var spinner = el('span', 'et-spinner'); spinner.hidden = true;
        submit.appendChild(spinner);
        submit.appendChild(document.createTextNode(T.secondPage.submit));
        submit.addEventListener('click', function () {
          attempted[2] = true;
          if (Object.keys(validatePage(2, state, DE, T)).length) { refreshErrors2(step); return; }
          doSubmit(submit, spinner, submitBtns);
        });
        submitBtns.push(submit);
        actions.appendChild(submit);
        return actions;
      }

      // top nav bar (page 2 is not the first input page, so it gets one)
      step.appendChild(makeActions());

      function imageCards(qKey, optKeys, imgUrls, getVal, setVal) {
        var cards = el('div', 'et-cards');
        var cardEls = [];
        optKeys.forEach(function (ok, i) {
          var valDe = get(DE, 'secondPage.' + qKey + '.' + ok);
          var label = get(T, 'secondPage.' + qKey + '.' + ok);
          var card = el('div', 'et-card' + (getVal() === valDe ? ' is-selected' : ''));
          card._val = valDe;
          if (imgUrls && imgUrls[i]) { var img = el('img', 'et-card-img'); img.src = imgUrls[i]; img.alt = label; card.appendChild(img); }
          card.appendChild(el('div', 'et-card-title', label));
          card.addEventListener('click', function () {
            setVal(getVal() === valDe ? '' : valDe);
            cardEls.forEach(function (c) { c.classList.toggle('is-selected', c._val === getVal()); });
            if (attempted[2]) refreshErrors2(step);
          });
          cardEls.push(card);
          cards.appendChild(card);
        });
        return cards;
      }

      // Q3
      var q3 = el('div', 'et-question');
      q3.appendChild(el('div', 'et-qlabel', '3. ' + T.secondPage.question3.text));
      q3.appendChild(imageCards('question3', ['option1', 'option2', 'option3'], imgs.q3,
        function () { return state.secondPage.question3; },
        function (v) { state.secondPage.question3 = v; }));
      q3.setAttribute('data-et-err-for', 'secondPage.question3');
      step.appendChild(q3);

      // Q4
      var q4 = el('div', 'et-question');
      q4.appendChild(el('div', 'et-qlabel', '4. ' + T.secondPage.question4.text));
      q4.appendChild(imageCards('question4', ['option1', 'option2', 'option3'], imgs.q4,
        function () { return state.secondPage.question4; },
        function (v) { state.secondPage.question4 = v; }));
      q4.setAttribute('data-et-err-for', 'secondPage.question4');
      step.appendChild(q4);

      // Q5 / Q6 live product image-card pickers (per-question maxSelectable from config)
      var maxSel = cfg.maxSelectable || {};
      step.appendChild(buildProductPicker('question5', 'question5', 'question5Extra', '5. ', 'joya', maxSel.q5, step));
      step.appendChild(buildProductPicker('question6', 'question6', 'question6Extra', '6. ', 'kybun', maxSel.q6, step));

      // Q7 coupon chips
      var q7 = el('div', 'et-question');
      q7.appendChild(el('div', 'et-qlabel', '7. ' + T.secondPage.question7.text));
      var opts = el('div', 'et-options');
      var chipEls = [];
      ['option1', 'option2', 'option3'].forEach(function (ok) {
        var valDe = DE.secondPage.question7[ok];
        var labelStr = T.secondPage.question7[ok];
        var chip = el('div', 'et-chip' + (state.secondPage.question7 === valDe ? ' is-selected' : ''));
        chip._val = valDe;
        if (ok === 'option3') {
          var parts = labelStr.split('<input/>');
          chip.appendChild(document.createTextNode(parts[0]));
          var inl = el('input', 'et-inline-input'); inl.type = 'text'; inl.value = state.secondPage.question7Option3Input;
          inl.addEventListener('click', function (ev) { ev.stopPropagation(); selectCoupon(valDe); });
          inl.addEventListener('input', function () { state.secondPage.question7Option3Input = inl.value; });
          chip.appendChild(inl);
          chip.appendChild(document.createTextNode(parts[1] || ''));
        } else {
          chip.appendChild(document.createTextNode(labelStr));
        }
        chip.addEventListener('click', function () { selectCoupon(state.secondPage.question7 === valDe ? '' : valDe); });
        chipEls.push(chip);
        opts.appendChild(chip);
      });
      q7.appendChild(opts);
      var q7err = el('div'); q7err.setAttribute('data-et-err-for', 'secondPage.question7'); q7.appendChild(q7err);

      // validity field — rendered once, shown/hidden when q7 is option2/option3
      var validityFld = el('div', 'et-field');
      validityFld.appendChild(el('label', 'et-field-label', T.secondPage.question7.extraText));
      var vi = el('input', 'et-input'); vi.type = 'text'; vi.value = state.secondPage.question7Extra;
      vi.addEventListener('input', function () { state.secondPage.question7Extra = vi.value; });
      validityFld.appendChild(vi);
      validityFld.setAttribute('data-et-err-for', 'secondPage.question7Extra');
      q7.appendChild(validityFld);

      function couponShowsValidity(v) { return v === DE.secondPage.question7.option2 || v === DE.secondPage.question7.option3; }
      validityFld.hidden = !couponShowsValidity(state.secondPage.question7);
      function selectCoupon(v) {
        state.secondPage.question7 = v;
        chipEls.forEach(function (c) { c.classList.toggle('is-selected', c._val === v); });
        validityFld.hidden = !couponShowsValidity(v);
        if (attempted[2]) refreshErrors2(step);
      }
      step.appendChild(q7);

      // Q8 width / height
      var q8 = el('div', 'et-question');
      q8.appendChild(el('div', 'et-qlabel', '8. ' + T.secondPage.question8.text));
      [['inputWidth', T.secondPage.question8.widthInMM], ['inputHeight', T.secondPage.question8.heightInMM]].forEach(function (pair) {
        var fld = el('div', 'et-field');
        fld.appendChild(el('label', 'et-field-label', pair[1]));
        var ni = el('input', 'et-input'); ni.type = 'number'; ni.value = state.secondPage.question8[pair[0]];
        ni.addEventListener('input', function () { state.secondPage.question8[pair[0]] = ni.value; if (attempted[2]) refreshErrors2(step); });
        fld.appendChild(ni);
        fld.setAttribute('data-et-err-for', 'secondPage.question8.' + pair[0]);
        q8.appendChild(fld);
      });
      step.appendChild(q8);

      // append the bottom nav bar (top bar was inserted above the questions)
      step.appendChild(makeActions());

      return step;
    }

    // Live product image-card picker (q5/q6). Fetches the brand's products from
    // cfg.productsUrl, renders selectable .et-card cards (max per cfg.maxSelectable,
    // incl. the "other" sentinel). Selecting a card toggles .is-selected in place and
    // pushes/removes the product NAME in state.secondPage[arrKey]. An "Anderes
    // Schuhmodell" card pushes the de_CH sentinel and reveals the name input (extraKey).
    // A live "n / max" counter in the heading updates in place on every (de)select.
    var DEFAULT_MAX_MODELS = 3;
    function buildProductPicker(qKey, arrKey, extraKey, num, brand, maxSel, step) {
      var other = DE.secondPage.otherShoeModel;
      var arr = state.secondPage[arrKey];
      var max = (maxSel && maxSel > 0) ? maxSel : DEFAULT_MAX_MODELS;

      var q = el('div', 'et-question');
      var label = el('div', 'et-qlabel', num + get(T, 'secondPage.' + qKey + '.text'));
      var countEl = el('span', 'et-qcount');
      label.appendChild(document.createTextNode(' '));
      label.appendChild(countEl);
      q.appendChild(label);
      function updateCount() { countEl.textContent = arr.length + ' / ' + max; }
      updateCount();

      var subText = (get(T, 'secondPage.' + qKey + '.subText') || '');
      if (subText.indexOf('{{count}}') !== -1) q.appendChild(el('span', 'et-qnote', subText.replace('{{count}}', String(max))));

      var cards = el('div', 'et-cards');
      q.appendChild(cards);

      // "Anderes Schuhmodell" name input — rendered once, shown/hidden by selection
      var extraFld = el('div', 'et-field');
      extraFld.appendChild(el('label', 'et-field-label', T.secondPage.shoeModelName));
      var extraInp = el('input', 'et-input'); extraInp.type = 'text'; extraInp.value = state.secondPage[extraKey] || '';
      extraInp.addEventListener('input', function () { state.secondPage[extraKey] = extraInp.value; });
      extraFld.appendChild(extraInp);
      extraFld.hidden = arr.indexOf(other) === -1;
      q.appendChild(extraFld);

      // error hosts (array-level + extra)
      var errArr = el('div'); errArr.setAttribute('data-et-err-for', 'secondPage.' + arrKey); q.appendChild(errArr);
      var errEx = el('div'); errEx.setAttribute('data-et-err-for', 'secondPage.' + extraKey); q.appendChild(errEx);

      function makeCard(value, label, imgUrl) {
        var card = el('div', 'et-card' + (arr.indexOf(value) !== -1 ? ' is-selected' : ''));
        card._val = value;
        if (imgUrl) { var img = el('img', 'et-card-img'); img.src = imgUrl; img.alt = label; card.appendChild(img); }
        card.appendChild(el('div', 'et-card-title', label));
        card.addEventListener('click', function () {
          var idx = arr.indexOf(value);
          if (idx !== -1) {
            arr.splice(idx, 1);
            card.classList.remove('is-selected');
          } else if (arr.length < max) {
            arr.push(value);
            card.classList.add('is-selected');
          } else {
            return; // enforce max
          }
          if (value === other) extraFld.hidden = arr.indexOf(other) === -1;
          updateCount();
          if (attempted[2]) refreshErrors2(step);
        });
        return card;
      }

      function renderCards(products) {
        cards.innerHTML = '';
        (products || []).forEach(function (p) { cards.appendChild(makeCard(p.name, p.name, p.image)); });
        // always offer the "Anderes Schuhmodell" sentinel card last
        cards.appendChild(makeCard(other, T.secondPage.otherShoeModel, null));
      }

      // brief loading placeholder, then fetch
      cards.appendChild(el('div', 'et-qnote', '…'));
      var url = (cfg.productsUrl || '') + ((cfg.productsUrl || '').indexOf('?') === -1 ? '?' : '&') +
        'brand=' + encodeURIComponent(brand) + '&locale=' + encodeURIComponent(dispLang);
      if (cfg.productsUrl) {
        fetch(url, { credentials: 'same-origin' })
          .then(function (res) { if (!res.ok) throw new Error('Products fetch failed: ' + res.status); return res.json(); })
          .then(function (data) { renderCards((data && data.products) || []); })
          .catch(function (err) { console.error(err); renderCards([]); });
      } else {
        renderCards([]);
      }
      return q;
    }

    function refreshErrors2(step) {
      var errs = validatePage(2, state, DE, T);
      ['secondPage.question3', 'secondPage.question4',
       'secondPage.question5', 'secondPage.question5Extra',
       'secondPage.question6', 'secondPage.question6Extra',
       'secondPage.question7', 'secondPage.question7Extra', 'secondPage.question7Option3Input',
       'secondPage.question8.inputWidth', 'secondPage.question8.inputHeight'].forEach(function (key) {
        var host = step.querySelector('[data-et-err-for="' + key + '"]');
        if (!host) return;
        clearErrors(host);
        attachError(host, key, errs);
      });
      // question7Option3Input has no dedicated host element; surface it on the q7 host
      var o3 = errs['secondPage.question7Option3Input'];
      if (o3) {
        var q7host = step.querySelector('[data-et-err-for="secondPage.question7"]');
        if (q7host && !q7host.querySelector('.et-error')) attachError(q7host, 'secondPage.question7Option3Input', errs);
      }
    }

    // ================= navigation / submit =================
    function navigate(to) {
      if (to > page && to <= TOTAL) { maxStep = Math.max(maxStep, to); persist(); }   // raise furthest-reached step
      page = to;
      if (page >= 1 && page <= TOTAL) writeStepParam(page);   // only input pages are bookmarkable
      mount.innerHTML = '';
      if (page === 1) mount.appendChild(buildPage1());
      else if (page === 2) mount.appendChild(buildPage2());
      else renderThankYou();
      window.scrollTo(0, 0);
    }

    // btn/spinner = the clicked submit control (spinner shows here only);
    // allBtns = every submit button on the page (all disabled while in flight).
    function doSubmit(btn, spinner, allBtns) {
      var buttons = allBtns && allBtns.length ? allBtns : (btn ? [btn] : []);
      function setLoading(on) {
        buttons.forEach(function (b) { b.disabled = on; });
        if (btn) btn.classList.toggle('is-loading', on);
        if (spinner) spinner.hidden = !on;
      }
      setLoading(true);
      var form = new FormData();
      state.firstPage.uploadedFiles.forEach(function (fileObj, i) {
        if (fileObj && fileObj.file) form.append('attachments[' + i + ']', fileObj.file, fileObj.name || fileObj.file.name);
      });
      form.append('data', JSON.stringify({ data: { formName: cfg.formName || 'kj-ads-form', description: { text: buildBlob(state, DE) } } }));
      fetch(cfg.endpoint, { method: 'POST', body: form, credentials: 'same-origin' })
        .then(function (res) {
          if (!res.ok) throw new Error('Submit failed: ' + res.status);
          setLoading(false);
          clearPersisted();
          state = initialState();
          state.userInfo.email = cfg.email || '';
          state.userInfo.address = cfg.address || '';
          attempted = { 1: false, 2: false };
          navigate(3);
        })
        .catch(function (err) { setLoading(false); console.error(err); });
    }

    function renderThankYou() {
      var ty = el('div', 'et-thankyou');
      ty.appendChild(el('h2', null, T.forthPage.youMadeIt));
      ty.appendChild(el('p', null, T.forthPage.message1));
      ty.appendChild(el('p', null, T.forthPage.message2));
      mount.appendChild(ty);
    }

    // Persist on every in-page state change. All field handlers mutate `state`
    // synchronously on input/change/click, so a delegated bubbling listener fired
    // after them captures the new state without instrumenting each call site.
    mount.addEventListener('input', persist);
    mount.addEventListener('change', persist);
    mount.addEventListener('click', persist);

    navigate(page);   // boot on the URL's ?step (clamped), or default page 1
  }

  return { STR: STR, initialState: initialState, validatePage: validatePage, buildBlob: buildBlob, fiveWorkingDaysAway: fiveWorkingDaysAway, boot: boot };
});
