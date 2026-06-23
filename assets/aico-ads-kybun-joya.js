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
  function validatePage(pageNum, state, de) {
    var e = {}, s = state, set = function (f, k) { e[f] = get(de, k); };
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

  // ---- browser bootstrap (self-contained DOM rendering) ----
  function boot() {
    var root = document.querySelector('[data-aico-eventtool="ads-kybun-joya"]');
    if (!root) return;
    var mount = root.querySelector('[data-et-mount]');
    if (!mount) return;
    var cfgEl = document.getElementById('aico-eventtool-config');
    var cfg = {};
    try { cfg = JSON.parse(cfgEl.textContent); } catch (e) { return; }

    var de = (cfg.locale || '').indexOf('de') === 0;
    var T = de ? STR.de_CH : STR.en;        // display strings
    var DE = STR.de_CH;                       // option values + blob are ALWAYS de_CH

    var state = initialState();
    state.userInfo.email = cfg.email || '';
    state.userInfo.address = cfg.address || '';

    var page = 1;          // 1, 2, or 3 (thank-you)
    var attempted = { 1: false, 2: false };

    var TOTAL = 2;
    function el(tag, cls, txt) { var n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; }
    function errors() { return attempted[page] ? validatePage(page, state, DE) : {}; }

    function render() {
      mount.innerHTML = '';
      if (page === 3) return renderThankYou();
      var step = el('div', 'et-step is-active');
      if (page === 1) renderPage1(step);
      else renderPage2(step);
      mount.appendChild(step);
    }

    function fieldError(errs, key) {
      var msg = errs[key];
      if (!msg) return null;
      return el('span', 'et-error', msg);
    }

    // ---------- PAGE 1 ----------
    function renderPage1(step) {
      var errs = errors();
      var info = el('div', 'et-info');
      [T.firstPage.infoText.part1, T.firstPage.infoText.part2, T.firstPage.infoText.part3].forEach(function (t) { info.appendChild(el('p', null, t)); });
      var p4 = el('p'); p4.appendChild(document.createTextNode(T.firstPage.infoText.part4));
      var a = el('a', null, T.firstPage.infoText.mail); a.href = 'mailto:' + T.firstPage.infoText.mail; p4.appendChild(a);
      info.appendChild(p4);
      step.appendChild(info);

      // Q1 date
      var q1 = el('div', 'et-question');
      var l1 = el('div', 'et-qlabel', '1. ' + T.firstPage.question1.text);
      q1.appendChild(l1);
      q1.appendChild(el('span', 'et-qnote', T.firstPage.question1.note));
      var d = el('input', 'et-input'); d.type = 'date'; d.value = state.firstPage.question1;
      d.addEventListener('change', function () { state.firstPage.question1 = d.value; if (attempted[1]) render(); });
      q1.appendChild(d);
      var e1 = fieldError(errs, 'firstPage.question1'); if (e1) q1.appendChild(e1);
      step.appendChild(q1);

      // Q2 chips (single select)
      var q2 = el('div', 'et-question');
      q2.appendChild(el('div', 'et-qlabel', '2. ' + T.firstPage.question2.text));
      var opts = el('div', 'et-options');
      [['option1', DE.firstPage.question2.option1, T.firstPage.question2.option1],
       ['option2', DE.firstPage.question2.option2, T.firstPage.question2.option2]].forEach(function (o) {
        var chip = el('div', 'et-chip' + (state.firstPage.question2 === o[1] ? ' is-selected' : ''), o[2]);
        chip.addEventListener('click', function () {
          state.firstPage.question2 = (state.firstPage.question2 === o[1]) ? '' : o[1];
          render();
        });
        opts.appendChild(chip);
      });
      q2.appendChild(opts);
      var e2 = fieldError(errs, 'firstPage.question2'); if (e2) q2.appendChild(e2);

      // upload zone — shown when question2 === option2 (de)
      if (state.firstPage.question2 === DE.firstPage.question2.option2) {
        var up = el('div', 'et-upload');
        up.appendChild(el('div', 'et-field-label', T.firstPage.question2.uploadText));
        var zone = el('label', 'et-upload-zone');
        zone.appendChild(el('span', null, T.firstPage.question2.dropFilesOr + ' ' + T.firstPage.question2.browse));
        var fileInput = el('input'); fileInput.type = 'file'; fileInput.multiple = true; fileInput.style.display = 'none';
        fileInput.addEventListener('change', function () {
          var existing = state.firstPage.uploadedFiles.map(function (f) { return f.name; });
          Array.prototype.forEach.call(fileInput.files, function (file) {
            if (existing.indexOf(file.name) === -1) state.firstPage.uploadedFiles.push({ file: file, name: file.name });
          });
          render();
        });
        zone.appendChild(fileInput);
        // drag & drop
        zone.addEventListener('dragover', function (ev) { ev.preventDefault(); zone.classList.add('is-dragover'); });
        zone.addEventListener('dragleave', function () { zone.classList.remove('is-dragover'); });
        zone.addEventListener('drop', function (ev) {
          ev.preventDefault(); zone.classList.remove('is-dragover');
          var existing = state.firstPage.uploadedFiles.map(function (f) { return f.name; });
          Array.prototype.forEach.call(ev.dataTransfer.files, function (file) {
            if (existing.indexOf(file.name) === -1) state.firstPage.uploadedFiles.push({ file: file, name: file.name });
          });
          render();
        });
        up.appendChild(zone);
        if (state.firstPage.uploadedFiles.length) {
          var list = el('ul', 'et-upload-list');
          state.firstPage.uploadedFiles.forEach(function (f, i) {
            var item = el('li', 'et-upload-item');
            item.appendChild(el('span', null, f.name));
            var rm = el('button', null, '×'); rm.type = 'button';
            rm.addEventListener('click', function () { state.firstPage.uploadedFiles.splice(i, 1); render(); });
            item.appendChild(rm);
            list.appendChild(item);
          });
          up.appendChild(list);
        }
        var eu = fieldError(errs, 'firstPage.uploadedFiles'); if (eu) up.appendChild(eu);
        q2.appendChild(up);
      }
      step.appendChild(q2);

      // actions
      var actions = el('div', 'et-actions');
      actions.appendChild(el('span', 'et-progress', page + ' / ' + TOTAL));
      var next = el('button', 'et-btn et-btn-primary', T.next); next.type = 'button';
      next.addEventListener('click', function () {
        attempted[1] = true;
        if (Object.keys(validatePage(1, state, DE)).length) { render(); return; }
        page = 2; render(); window.scrollTo(0, 0);
      });
      actions.appendChild(next);
      step.appendChild(actions);
    }

    // ---------- PAGE 2 ----------
    function imageCards(container, qKey, imgUrls, optKeys, selectedVal, onPick) {
      var cards = el('div', 'et-cards');
      optKeys.forEach(function (ok, i) {
        var valDe = get(DE, 'secondPage.' + qKey + '.' + ok);
        var label = get(T, 'secondPage.' + qKey + '.' + ok);
        var card = el('div', 'et-card' + (selectedVal === valDe ? ' is-selected' : ''));
        if (imgUrls && imgUrls[i]) { var img = el('img', 'et-card-img'); img.src = imgUrls[i]; img.alt = label; card.appendChild(img); }
        card.appendChild(el('div', 'et-card-title', label));
        card.addEventListener('click', function () { onPick(selectedVal === valDe ? '' : valDe); });
        cards.appendChild(card);
      });
      container.appendChild(cards);
    }

    function modelList(container, qKey, arrKey, extraKey, errs) {
      // text-entry list of model names; an "Anderes Schuhmodell" row maps to the extra field
      var note = el('span', 'et-qnote', (get(T, 'secondPage.' + qKey + '.subText') || '').replace('{{count}}', '3'));
      container.appendChild(note);
      var other = DE.secondPage.otherShoeModel;
      var arr = state.secondPage[arrKey];
      var wrap = el('div', 'et-models');

      arr.forEach(function (val, idx) {
        var row = el('div', 'et-model-row');
        var inp = el('input', 'et-input'); inp.type = 'text';
        var isOther = val === other;
        inp.value = isOther ? (state.secondPage[extraKey] || '') : val;
        inp.placeholder = T.secondPage.shoeModelName;
        inp.addEventListener('input', function () {
          if (isOther) state.secondPage[extraKey] = inp.value;
          else arr[idx] = inp.value;
        });
        row.appendChild(inp);
        var rm = el('button', 'et-btn et-btn-back', '×'); rm.type = 'button';
        rm.addEventListener('click', function () {
          arr.splice(idx, 1);
          if (isOther) state.secondPage[extraKey] = '';
          render();
        });
        row.appendChild(rm);
        wrap.appendChild(row);
      });

      // add buttons: a normal model row + an "Anderes Schuhmodell" row
      var addRow = el('div', 'et-model-row');
      var addBtn = el('button', 'et-btn et-btn-back', T.secondPage.addModel); addBtn.type = 'button';
      addBtn.addEventListener('click', function () { arr.push(''); render(); });
      addRow.appendChild(addBtn);
      if (arr.indexOf(other) === -1) {
        var addOther = el('button', 'et-btn et-btn-back', T.secondPage.otherShoeModel); addOther.type = 'button';
        addOther.addEventListener('click', function () { arr.push(other); render(); });
        addRow.appendChild(addOther);
      }
      wrap.appendChild(addRow);
      container.appendChild(wrap);

      var eArr = fieldError(errs, 'secondPage.' + arrKey); if (eArr) container.appendChild(eArr);
      var eEx = fieldError(errs, 'secondPage.' + extraKey); if (eEx) container.appendChild(eEx);
    }

    function renderPage2(step) {
      var errs = errors();
      var imgs = cfg.images || {};

      // Q3 image cards
      var q3 = el('div', 'et-question');
      q3.appendChild(el('div', 'et-qlabel', '3. ' + T.secondPage.question3.text));
      imageCards(q3, 'question3', imgs.q3, ['option1', 'option2', 'option3'], state.secondPage.question3, function (v) { state.secondPage.question3 = v; render(); });
      var e3 = fieldError(errs, 'secondPage.question3'); if (e3) q3.appendChild(e3);
      step.appendChild(q3);

      // Q4 image cards
      var q4 = el('div', 'et-question');
      q4.appendChild(el('div', 'et-qlabel', '4. ' + T.secondPage.question4.text));
      imageCards(q4, 'question4', imgs.q4, ['option1', 'option2', 'option3'], state.secondPage.question4, function (v) { state.secondPage.question4 = v; render(); });
      var e4 = fieldError(errs, 'secondPage.question4'); if (e4) q4.appendChild(e4);
      step.appendChild(q4);

      // Q5 Joya model entry list
      var q5 = el('div', 'et-question');
      q5.appendChild(el('div', 'et-qlabel', '5. ' + T.secondPage.question5.text));
      modelList(q5, 'question5', 'question5', 'question5Extra', errs);
      step.appendChild(q5);

      // Q6 kybun model entry list
      var q6 = el('div', 'et-question');
      q6.appendChild(el('div', 'et-qlabel', '6. ' + T.secondPage.question6.text));
      modelList(q6, 'question6', 'question6', 'question6Extra', errs);
      step.appendChild(q6);

      // Q7 coupon chips
      var q7 = el('div', 'et-question');
      q7.appendChild(el('div', 'et-qlabel', '7. ' + T.secondPage.question7.text));
      var opts = el('div', 'et-options');
      ['option1', 'option2', 'option3'].forEach(function (ok) {
        var valDe = DE.secondPage.question7[ok];
        var labelStr = T.secondPage.question7[ok];
        var selected = state.secondPage.question7 === valDe;
        var chip = el('div', 'et-chip' + (selected ? ' is-selected' : ''));
        if (ok === 'option3') {
          // inline discount input within the chip
          var parts = labelStr.split('<input/>');
          chip.appendChild(document.createTextNode(parts[0]));
          var inl = el('input', 'et-inline-input'); inl.type = 'text'; inl.value = state.secondPage.question7Option3Input;
          inl.addEventListener('click', function (ev) { ev.stopPropagation(); state.secondPage.question7 = valDe; render(); });
          inl.addEventListener('input', function () { state.secondPage.question7Option3Input = inl.value; });
          chip.appendChild(inl);
          chip.appendChild(document.createTextNode(parts[1] || ''));
        } else {
          chip.appendChild(document.createTextNode(labelStr));
        }
        chip.addEventListener('click', function () {
          state.secondPage.question7 = selected ? '' : valDe;
          render();
        });
        opts.appendChild(chip);
      });
      q7.appendChild(opts);
      var e7o3 = fieldError(errs, 'secondPage.question7Option3Input'); if (e7o3) q7.appendChild(e7o3);
      var e7 = fieldError(errs, 'secondPage.question7'); if (e7) q7.appendChild(e7);

      // validity input shown when option2 or option3
      var q7v = state.secondPage.question7;
      if (q7v === DE.secondPage.question7.option2 || q7v === DE.secondPage.question7.option3) {
        var fld = el('div', 'et-field');
        fld.appendChild(el('label', 'et-field-label', T.secondPage.question7.extraText));
        var vi = el('input', 'et-input'); vi.type = 'text'; vi.value = state.secondPage.question7Extra;
        vi.addEventListener('input', function () { state.secondPage.question7Extra = vi.value; });
        fld.appendChild(vi);
        var e7e = fieldError(errs, 'secondPage.question7Extra'); if (e7e) fld.appendChild(e7e);
        q7.appendChild(fld);
      }
      step.appendChild(q7);

      // Q8 width / height
      var q8 = el('div', 'et-question');
      q8.appendChild(el('div', 'et-qlabel', '8. ' + T.secondPage.question8.text));
      [['inputWidth', T.secondPage.question8.widthInMM], ['inputHeight', T.secondPage.question8.heightInMM]].forEach(function (pair) {
        var fld = el('div', 'et-field');
        fld.appendChild(el('label', 'et-field-label', pair[1]));
        var ni = el('input', 'et-input'); ni.type = 'number'; ni.value = state.secondPage.question8[pair[0]];
        ni.addEventListener('input', function () { state.secondPage.question8[pair[0]] = ni.value; });
        fld.appendChild(ni);
        var en = fieldError(errs, 'secondPage.question8.' + pair[0]); if (en) fld.appendChild(en);
        q8.appendChild(fld);
      });
      step.appendChild(q8);

      // actions: back + submit
      var actions = el('div', 'et-actions');
      var back = el('button', 'et-btn et-btn-back', T.back); back.type = 'button';
      back.addEventListener('click', function () { page = 1; render(); window.scrollTo(0, 0); });
      actions.appendChild(back);
      actions.appendChild(el('span', 'et-progress', page + ' / ' + TOTAL));
      var submit = el('button', 'et-btn et-btn-primary', T.secondPage.submit); submit.type = 'button';
      submit.addEventListener('click', function () {
        attempted[2] = true;
        if (Object.keys(validatePage(2, state, DE)).length) { render(); return; }
        doSubmit(submit);
      });
      actions.appendChild(submit);
      step.appendChild(actions);
    }

    function doSubmit(btn) {
      if (btn) btn.disabled = true;
      var form = new FormData();
      state.firstPage.uploadedFiles.forEach(function (fileObj, i) {
        if (fileObj && fileObj.file) form.append('attachments[' + i + ']', fileObj.file, fileObj.name || fileObj.file.name);
      });
      form.append('data', JSON.stringify({ data: { formName: cfg.formName || 'kj-ads-form', description: { text: buildBlob(state, DE) } } }));
      fetch(cfg.endpoint, { method: 'POST', body: form, credentials: 'same-origin' })
        .then(function (res) {
          if (!res.ok) throw new Error('Submit failed: ' + res.status);
          state = initialState();
          state.userInfo.email = cfg.email || '';
          state.userInfo.address = cfg.address || '';
          attempted = { 1: false, 2: false };
          page = 3; render(); window.scrollTo(0, 0);
        })
        .catch(function (err) { if (btn) btn.disabled = false; console.error(err); });
    }

    function renderThankYou() {
      var ty = el('div', 'et-thankyou');
      ty.appendChild(el('h2', null, T.forthPage.youMadeIt));
      ty.appendChild(el('p', null, T.forthPage.message1));
      ty.appendChild(el('p', null, T.forthPage.message2));
      mount.appendChild(ty);
    }

    render();
  }

  return { STR: STR, initialState: initialState, validatePage: validatePage, buildBlob: buildBlob, fiveWorkingDaysAway: fiveWorkingDaysAway, boot: boot };
});
