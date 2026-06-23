/*
 * Events / kybun-joya multi-step form (formName: kj-events-form).
 * Self-contained port of the legacy b2b-shop src/pages/events/kybun-joya.
 *
 * Submits a multipart POST to /aico-storefront-api/forms with attachments[] and
 * data = {data:{formName:'kj-events-form', description:{text:<blob>}}}, where the
 * blob is the numbered de_CH Q&A (mirrors the old prepareFormData). Validation
 * mirrors the old firstPage/secondPage/thirdPage.schema.js.
 *
 * Strings are inlined (de_CH + en) so the form is self-contained; the template
 * supplies resolved image URLs + the active locale + the logged-in user's
 * email/address via the JSON config block.
 *
 * validatePage()/buildBlob() are exported when run under Node so the checks and
 * the submitted text can be unit-tested without a browser.
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
      errors: { requiredField: 'Dieses Feld ist erforderlich.', requiredQuestion: 'Bitte beantworten Sie diese Frage.' },
      back: 'Zurück', next: 'Weiter',
      firstPage: {
        infoText: { part1: 'Mit dem Ausfüllen des nachfolgenden Formulars können Sie Marketingmaterialien für Ihren nächsten kybun Joya Experience Day zusammenstellen. Jeder Schritt bzw. jede Designoption wird ausführlich erklärt.', part2: 'Alle mit einem Stern * gekennzeichneten Angaben sind Pflichtangaben.', part3: 'Ohne diese Angaben kann das Formular nicht versendet werden.', part4: 'Bei Fragen wenden Sie sich bitte an ', mail: 'marketing@kybunjoya.swiss' },
        question1: { text: 'Kernangaben zum geplanten kybun Joya Experience Day *', note: '(Es sind mindestens 5 Arbeitstage Vorlaufzeit erforderlich)', dateLabel: 'Datum des kybun Joya Experience Day? (Datum im Format TT.MM.JJ)', startTimeLabel: 'Wann soll er beginnen? (Startzeit im Format HH:MM)', endTimeLabel: 'Bis wann? (Endzeit im Format HH:MM)', errors: { minWorkingDays: 'Es sind mindestens 5 Arbeitstage Vorlaufzeit erforderlich', endTimeAfterStartTime: 'Die Endzeit muss nach der Startzeit liegen' } },
        question2: { text: 'Liegt der kybun Joya Marketingabteilung Ihr Firmenlogo bereits in hoher Auflösung vor? *', option1: 'Ja, liegt bereits vor', option2: 'Nein, noch nicht', uploadText: 'Bitte laden Sie hier Ihr hochauflösendes Logo hoch', dropFilesOr: 'Dateien hier ablegen oder', browse: 'Durchsuchen', errors: { uploadRequired: 'Bitte laden Sie ein hochauflösendes Logo hoch.' } }
      },
      secondPage: {
        question3: { text: 'Wählen Sie einen Schmerzpunkt *', option1: 'a. Rücken', option2: 'b. Knie', option3: 'c. Fuss' },
        question4: { text: 'Wählen Sie einen Anzeigentext *', option1: 'Klassischer PR-Text, Pflichtangabe für Anzeigengrössen ca. DIN A5 und kleiner', option2: 'Zitat aus dem Fachhandel', option3: 'Interview mit dem Fachhandel, Anzeigengrösse grösser als DIN A4' },
        question5: { text: 'Welche Joya-Modelle sollen gezeigt werden? *', subText: 'Es sind maximal {{count}} Bilder von A-Ansichten möglich sowie ein Porträt des Interviewpartners in den Interviewtexten.', errors: { shoeModelNameRequired: 'Bitte geben Sie den Namen des Joya-Schuhmodells an.' } },
        question6: { text: 'Welche kybun-Modelle sollen gezeigt werden? *', subText: 'Es sind maximal {{count}} Bilder von A-Ansichten möglich sowie ein Porträt des Interviewpartners in den Interviewtexten.', errors: { shoeModelNameRequired: 'Bitte geben Sie den Namen des kybun-Schuhmodells an.' } },
        question7: { text: 'Soll es einen Gutschein/Coupon geben? *', option1: 'a. Nein', option2: 'b. Kostenlose Fussdruckmessung im Wert von CHF 30/ EUR 25', option3: 'c. Rabatt von <input/> CHF bzw. € auf kybun und Joya Produkte', extraText: 'Coupon gültig von/bis: *', errors: { couponValueRequired: 'Bitte geben Sie den Rabattbetrag an.', couponValidityRequired: 'Bitte geben Sie die Gültigkeitsdauer des Coupons an.' } },
        otherShoeModel: 'Anderes Schuhmodell', shoeModelName: 'Name des Schuhmodells *', addModel: 'Modell hinzufügen'
      },
      thirdPage: {
        question8: { text: 'Welche Programmpunkte sollten aufgeführt werden? *', note: '(Mehrfachauswahl möglich)', option1: 'a. Beratung durch kybun Joya Gesundheitsexperte', option2: 'b. kybun Testschuh draussen auf Asphalt ausprobieren', option3: 'c. Fußdruckmessung', option4: 'd. Innovatives Fussmassagegerät erleben', option5: 'e. Neue Herbst- / Winterkollektion', option6: 'f. Freies Eingabefeld <input/>' },
        question9: { text: 'Bitte gib das genaue Format der Anzeige an. Erst nach Erhalt der exakten Maße kann mit der Erstellung deiner Werbeanzeige begonnen werden. *', widthInMM: 'Breite in mm', heightInMM: 'Höhe in mm', errors: { positiveNumber: 'Bitte geben Sie eine positive Zahl ein.' } },
        question10: { text: 'Welche weiteren Marketingmaterialien wünschen Sie sich? *', note: '(Mehrfachauswahl möglich)', option1: 'a. Druckvorlage Plakat DIN A1', option2: 'b. Druckvorlage Flyer', option3: 'c. Social Media Grafik', option4: 'd. Google my Business Grafik' },
        question11: { text: 'Bereich für Kommentare & Anmerkungen' }, submit: 'Absenden'
      },
      forthPage: { youMadeIt: 'Du hast es geschafft!', message1: 'Die Angaben deiner Buchung werden nun an unsere Marketingabteilung übermittelt.', message2: 'Wir werden uns in Kürze mit einem Entwurf bei dir melden.' }
    },
    en: {
      userInfo: { text: 'User Information', email: 'E-Mail', address: 'Address' },
      errors: { requiredField: 'This field is required.', requiredQuestion: 'This question is required.' },
      back: 'Back', next: 'Next',
      firstPage: {
        infoText: { part1: 'By filling out the following form, you can put together marketing materials for your next kybun Joya Experience Day. Each step or design option is explained in detail.', part2: 'All details marked with a star * are mandatory.', part3: 'The form cannot be sent without this information.', part4: 'If you have any questions, please contact ', mail: 'marketing@kybunjoya.swiss' },
        question1: { text: 'Key data on the planned kybun Joya Experience Day *', note: '(Minimum lead time of 5 business days required)', dateLabel: 'kybun Joya Experience Day date? (Date in DD.MM.YY)', startTimeLabel: 'When should it start? (Start time in HH:MM)', endTimeLabel: 'Until when? (End time in HH:MM)', errors: { minWorkingDays: 'Minimum lead time of 5 business days required', endTimeAfterStartTime: 'End time must be after start time' } },
        question2: { text: 'Does the kybun Joya Marketing Department already have your business logo in high resolution? *', option1: 'Yes, already exists', option2: 'No, not yet', uploadText: 'Please upload your high-resolution logo here', dropFilesOr: 'Drop files here or', browse: 'Browse', errors: { uploadRequired: 'Please upload a high-resolution logo.' } }
      },
      secondPage: {
        question3: { text: 'Choose a pain point *', option1: 'a. Back', option2: 'b. Knee', option3: 'c. Foot' },
        question4: { text: 'Select an ad text *', option1: 'Classic PR text, mandatory for ad sizes approx. DIN A5 and smaller', option2: 'Quote from dealer', option3: 'Interview with dealer, advertisement size larger than DIN A4' },
        question5: { text: 'Which Joya models should be shown? *', subText: 'A maximum of {{count}} pictures of A-views are possible, as well as a portrait of the interview partner in the interview texts.', errors: { shoeModelNameRequired: 'Please specify the Joya shoe model name.' } },
        question6: { text: 'Which kybun models should be shown? *', subText: 'A maximum of {{count}} pictures of A-views are possible, as well as a portrait of the interview partner in the interview texts.', errors: { shoeModelNameRequired: 'Please specify the kybun shoe model name.' } },
        question7: { text: 'Should there be a voucher/coupon? *', option1: 'a. No', option2: 'b. Free foot pressure measurement worth CHF 30/ EUR 25', option3: 'c. Discount of <input/> CHF or € on kybun and Joya products', extraText: 'Coupon valid from/to: *', errors: { couponValueRequired: 'Please specify the discount amount.', couponValidityRequired: 'Please specify the coupon validity period.' } },
        otherShoeModel: 'Other shoe model', shoeModelName: 'Shoe model name *', addModel: 'Add model'
      },
      thirdPage: {
        question8: { text: 'Which event program items should be listed? *', note: '(multiple selection possible)', option1: 'a. Consultation by kybun Joya health expert', option2: 'b. Try kybun test shoe outside on asphalt', option3: 'c. Foot pressure measurement', option4: 'd. Experience the innovative foot massage device', option5: 'e. New autumn / winter collection', option6: 'f. Free text field <input/>' },
        question9: { text: 'Please specify the exact format of the ad. We can only start creating your advertisement once we have received the exact dimensions. *', widthInMM: 'Width in mm', heightInMM: 'Height in mm', errors: { positiveNumber: 'Please enter a positive number.' } },
        question10: { text: 'What other marketing materials would you like? *', note: '(multiple selection possible)', option1: 'a. Print template for DIN A1 poster', option2: 'b. Flyer print template', option3: 'c. Social media graphic', option4: 'd. Google my Business graphic' },
        question11: { text: 'Area for comments & notes' }, submit: 'Submit'
      },
      forthPage: { youMadeIt: 'You have made it!', message1: 'The details of your booking will now be sent to our marketing department.', message2: 'We will get back to you shortly with a draft.' }
    }
  };

  var MAX_MODELS = 3;
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
      firstPage: { question1: { date: '', startTime: '', endTime: '' }, question2: '', uploadedFiles: [] },
      secondPage: { question3: '', question4: '', question5: [], question5Extra: '', question6: [], question6Extra: '', question7: '', question7Option3Input: '', question7Extra: '' },
      thirdPage: { question8: [], question8OtherOptionInput: '', question9: { inputWidth: '', inputHeight: '' }, question10: [], question11: '' }
    };
  }

  // ---- validation (mirrors the kj *.schema.js) — returns {field:errorMsg} ----
  function validatePage(pageNum, state, de) {
    var e = {}, s = state, set = function (f, k) { e[f] = get(de, k); };
    if (pageNum === 1) {
      var q1 = s.firstPage.question1;
      if (blank(q1.date) || isNaN(new Date(q1.date).getTime())) set('firstPage.question1.date', 'errors.requiredField');
      else if (!fiveWorkingDaysAway(q1.date)) set('firstPage.question1.date', 'firstPage.question1.errors.minWorkingDays');
      if (blank(q1.startTime)) set('firstPage.question1.startTime', 'errors.requiredField');
      if (blank(q1.endTime)) set('firstPage.question1.endTime', 'errors.requiredField');
      else if (q1.startTime && q1.endTime <= q1.startTime) set('firstPage.question1.endTime', 'firstPage.question1.errors.endTimeAfterStartTime');
      if (blank(s.firstPage.question2)) set('firstPage.question2', 'errors.requiredQuestion');
      if (s.firstPage.question2 === get(de, 'firstPage.question2.option2') && emptyArr(s.firstPage.uploadedFiles)) set('firstPage.uploadedFiles', 'firstPage.question2.errors.uploadRequired');
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
    } else if (pageNum === 3) {
      var th = s.thirdPage;
      if (emptyArr(th.question8)) set('thirdPage.question8', 'errors.requiredQuestion');
      if ((th.question8 || []).indexOf(get(de, 'thirdPage.question8.option6')) !== -1 && blank(th.question8OtherOptionInput)) set('thirdPage.question8OtherOptionInput', 'errors.requiredField');
      ['inputWidth', 'inputHeight'].forEach(function (k) {
        var v = th.question9[k];
        if (blank(v)) set('thirdPage.question9.' + k, 'errors.requiredField');
        else if (!isFinite(Number(v))) set('thirdPage.question9.' + k, 'errors.requiredField');
        else if (Number(v) < 0) set('thirdPage.question9.' + k, 'thirdPage.question9.errors.positiveNumber');
      });
    }
    return e;
  }

  // ---- kj text blob (mirrors prepareFormData, de_CH labels) ----
  function buildBlob(state, de) {
    var TAB = '\t', NL = '\n', o = '', f = state, other = get(de, 'secondPage.otherShoeModel');
    var q1 = f.firstPage.question1;
    o += '1. ' + get(de, 'firstPage.question1.text') + NL;
    o += TAB + get(de, 'firstPage.question1.dateLabel') + ': ' + q1.date + NL;
    o += TAB + get(de, 'firstPage.question1.startTimeLabel') + ': ' + q1.startTime + NL;
    o += TAB + get(de, 'firstPage.question1.endTimeLabel') + ': ' + q1.endTime + NL + NL;
    o += '2. ' + get(de, 'firstPage.question2.text') + NL + TAB + f.firstPage.question2 + NL + NL;
    var sp = f.secondPage;
    o += '3. ' + get(de, 'secondPage.question3.text') + NL + TAB + sp.question3 + NL + NL;
    o += '4. ' + get(de, 'secondPage.question4.text') + NL + TAB + sp.question4 + NL + NL;
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
    var th = f.thirdPage;
    o += '8. ' + get(de, 'thirdPage.question8.text') + NL;
    (th.question8 || []).map(function (it) { return it === get(de, 'thirdPage.question8.option6') ? get(de, 'thirdPage.question8.option6').replace('<input/>', th.question8OtherOptionInput) : it; }).sort().forEach(function (it) { o += TAB + it + NL; });
    o += NL;
    o += '9. ' + get(de, 'thirdPage.question9.text') + NL;
    o += TAB + get(de, 'thirdPage.question9.widthInMM') + ': ' + th.question9.inputWidth + NL;
    o += TAB + get(de, 'thirdPage.question9.heightInMM') + ': ' + th.question9.inputHeight + NL + NL;
    o += '10. ' + get(de, 'thirdPage.question10.text') + NL;
    (th.question10 || []).slice().sort().forEach(function (it) { o += TAB + it + NL; });
    o += NL;
    o += '11. ' + get(de, 'thirdPage.question11.text') + NL + TAB + th.question11 + NL + NL;
    o += '------' + NL + get(de, 'userInfo.text') + NL;
    o += TAB + get(de, 'userInfo.email') + ': ' + f.userInfo.email + NL;
    o += TAB + get(de, 'userInfo.address') + ': ' + f.userInfo.address + NL + NL;
    return o;
  }

  // ---- DOM helpers ----
  function el(tag, cls, attrs) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function errEl(msg) { return el('span', 'et-error', { text: msg }); }

  // ---- inline self-contained renderer ----
  function render(opts) {
    var root = opts.root, cfg = opts.cfg, mount = root.querySelector('[data-et-mount]');
    var dispLang = (String(cfg.locale || 'de_CH').toLowerCase().indexOf('de') === 0) ? 'de_CH' : 'en';
    var L = STR[dispLang];        // displayed labels
    var DE = STR.de_CH;           // canonical (validation + blob)
    var images = cfg.images || {};
    var state = initialState();
    state.userInfo.email = cfg.email || '';
    state.userInfo.address = cfg.address || '';
    var page = 1;                 // 1..3 input pages, 4 = thank-you
    var errors = {};              // {fieldPath: msg} from validatePage
    var TOTAL = 4;

    function err(field) { return errors[field] ? errEl(errors[field]) : null; }
    function maybeAppend(parent, node) { if (node) parent.appendChild(node); }

    // ---------- single-select chip group ----------
    function chipGroup(parent, opts2, current, onPick) {
      var box = el('div', 'et-options');
      opts2.forEach(function (o) {
        var chip = el('span', 'et-chip' + (current === o.value ? ' is-selected' : ''), { text: o.label });
        chip.addEventListener('click', function () { onPick(current === o.value ? '' : o.value); });
        box.appendChild(chip);
      });
      parent.appendChild(box);
    }

    // ---------- image card group ----------
    function cardGroup(parent, cards, isSelected, onToggle) {
      var grid = el('div', 'et-cards');
      cards.forEach(function (c) {
        var card = el('div', 'et-card' + (isSelected(c.value) ? ' is-selected' : ''));
        if (c.img) card.appendChild(el('img', 'et-card-img', { src: c.img, alt: '' }));
        card.appendChild(el('div', 'et-card-title', { text: c.label }));
        card.addEventListener('click', function () { onToggle(c.value); });
        grid.appendChild(card);
      });
      parent.appendChild(grid);
    }

    function question(num, labelText, note) {
      var q = el('div', 'et-question');
      q.appendChild(el('span', 'et-qlabel', { text: num + '. ' + labelText }));
      if (note) q.appendChild(el('span', 'et-qnote', { text: note }));
      return q;
    }

    // ============================ PAGE 1 ============================
    function renderPage1() {
      var wrap = el('div', 'et-step is-active');

      // intro
      var info = el('div', 'et-info');
      [L.firstPage.infoText.part1, L.firstPage.infoText.part2, L.firstPage.infoText.part3].forEach(function (t) {
        info.appendChild(el('p', null, { text: t }));
      });
      var p4 = el('p');
      p4.appendChild(document.createTextNode(L.firstPage.infoText.part4));
      var mail = el('a', null, { href: 'mailto:' + L.firstPage.infoText.mail, text: L.firstPage.infoText.mail });
      p4.appendChild(mail);
      info.appendChild(p4);
      wrap.appendChild(info);

      // Q1
      var q1 = question('1', L.firstPage.question1.text, L.firstPage.question1.note);
      var dq = state.firstPage.question1;
      [
        { key: 'date', type: 'date', label: L.firstPage.question1.dateLabel },
        { key: 'startTime', type: 'time', label: L.firstPage.question1.startTimeLabel },
        { key: 'endTime', type: 'time', label: L.firstPage.question1.endTimeLabel }
      ].forEach(function (f) {
        var field = el('div', 'et-field');
        field.appendChild(el('label', 'et-field-label', { text: f.label }));
        var inp = el('input', 'et-input', { type: f.type, value: dq[f.key] || '' });
        inp.addEventListener('input', function () { dq[f.key] = inp.value; });
        field.appendChild(inp);
        maybeAppend(field, err('firstPage.question1.' + f.key));
        q1.appendChild(field);
      });
      wrap.appendChild(q1);

      // Q2
      var q2 = question('2', L.firstPage.question2.text);
      chipGroup(q2, [
        { value: DE.firstPage.question2.option1, label: L.firstPage.question2.option1 },
        { value: DE.firstPage.question2.option2, label: L.firstPage.question2.option2 }
      ], state.firstPage.question2, function (v) {
        state.firstPage.question2 = v;
        rerender();
      });
      maybeAppend(q2, err('firstPage.question2'));

      // upload zone only when "Nein" (option2)
      if (state.firstPage.question2 === DE.firstPage.question2.option2) {
        var up = el('div', 'et-upload');
        up.appendChild(el('div', 'et-field-label', { text: L.firstPage.question2.uploadText }));
        var zone = el('div', 'et-upload-zone');
        zone.appendChild(el('span', null, { text: L.firstPage.question2.dropFilesOr + ' ' + L.firstPage.question2.browse }));
        var fileInput = el('input', null, { type: 'file', multiple: 'multiple' });
        fileInput.style.display = 'none';
        zone.appendChild(fileInput);
        function addFiles(list) {
          var existing = (state.firstPage.uploadedFiles || []).map(function (f) { return f.name; });
          Array.prototype.forEach.call(list, function (file) {
            if (existing.indexOf(file.name) === -1) {
              state.firstPage.uploadedFiles.push({ file: file, name: file.name });
              existing.push(file.name);
            }
          });
          rerender();
        }
        zone.addEventListener('click', function () { fileInput.click(); });
        fileInput.addEventListener('change', function () { addFiles(fileInput.files); });
        zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('is-dragover'); });
        zone.addEventListener('dragleave', function () { zone.classList.remove('is-dragover'); });
        zone.addEventListener('drop', function (e) {
          e.preventDefault(); zone.classList.remove('is-dragover');
          if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
        });
        up.appendChild(zone);
        if ((state.firstPage.uploadedFiles || []).length) {
          var ul = el('ul', 'et-upload-list');
          state.firstPage.uploadedFiles.forEach(function (f, i) {
            var li = el('li', 'et-upload-item');
            li.appendChild(el('span', null, { text: f.name }));
            var rm = el('button', null, { type: 'button', text: '×' });
            rm.addEventListener('click', function () {
              state.firstPage.uploadedFiles.splice(i, 1); rerender();
            });
            li.appendChild(rm);
            ul.appendChild(li);
          });
          up.appendChild(ul);
        }
        maybeAppend(up, err('firstPage.uploadedFiles'));
        q2.appendChild(up);
      }
      wrap.appendChild(q2);

      wrap.appendChild(actions(false, L.next));
      return wrap;
    }

    // ============================ PAGE 2 ============================
    function renderPage2() {
      var wrap = el('div', 'et-step is-active');
      var sp = state.secondPage;
      var other = DE.secondPage.otherShoeModel;

      // Q3 image cards (single)
      var q3 = question('3', L.secondPage.question3.text);
      cardGroup(q3, [
        { value: DE.secondPage.question3.option1, label: L.secondPage.question3.option1, img: (images.q3 || [])[0] },
        { value: DE.secondPage.question3.option2, label: L.secondPage.question3.option2, img: (images.q3 || [])[1] },
        { value: DE.secondPage.question3.option3, label: L.secondPage.question3.option3, img: (images.q3 || [])[2] }
      ], function (v) { return sp.question3 === v; }, function (v) {
        sp.question3 = sp.question3 === v ? '' : v; rerender();
      });
      maybeAppend(q3, err('secondPage.question3'));
      wrap.appendChild(q3);

      // Q4 image cards (single)
      var q4 = question('4', L.secondPage.question4.text);
      cardGroup(q4, [
        { value: DE.secondPage.question4.option1, label: L.secondPage.question4.option1, img: (images.q4 || [])[0] },
        { value: DE.secondPage.question4.option2, label: L.secondPage.question4.option2, img: (images.q4 || [])[1] },
        { value: DE.secondPage.question4.option3, label: L.secondPage.question4.option3, img: (images.q4 || [])[2] }
      ], function (v) { return sp.question4 === v; }, function (v) {
        sp.question4 = sp.question4 === v ? '' : v; rerender();
      });
      maybeAppend(q4, err('secondPage.question4'));
      wrap.appendChild(q4);

      // Q5 model text-entry list
      wrap.appendChild(modelQuestion('5', L.secondPage.question5.text, 'question5', 'question5Extra', other));
      // Q6 model text-entry list
      wrap.appendChild(modelQuestion('6', L.secondPage.question6.text, 'question6', 'question6Extra', other));

      // Q7 coupon chips (single) + inline discount on option3 + validity extra
      var q7 = question('7', L.secondPage.question7.text);
      var box = el('div', 'et-options');
      var o1 = DE.secondPage.question7.option1, o2 = DE.secondPage.question7.option2, o3 = DE.secondPage.question7.option3;
      // option1
      var c1 = el('span', 'et-chip' + (sp.question7 === o1 ? ' is-selected' : ''), { text: L.secondPage.question7.option1 });
      c1.addEventListener('click', function () { sp.question7 = sp.question7 === o1 ? '' : o1; rerender(); });
      box.appendChild(c1);
      // option2
      var c2 = el('span', 'et-chip' + (sp.question7 === o2 ? ' is-selected' : ''), { text: L.secondPage.question7.option2 });
      c2.addEventListener('click', function () { sp.question7 = sp.question7 === o2 ? '' : o2; rerender(); });
      box.appendChild(c2);
      // option3 with inline input (split label on <input/>)
      var c3 = el('span', 'et-chip' + (sp.question7 === o3 ? ' is-selected' : ''));
      var parts = String(L.secondPage.question7.option3).split('<input/>');
      c3.appendChild(document.createTextNode(parts[0] || ''));
      var inlineInp = el('input', 'et-inline-input', { type: 'text', value: sp.question7Option3Input || '' });
      inlineInp.addEventListener('click', function (e) {
        e.stopPropagation();
        if (sp.question7 !== o3) { sp.question7 = o3; rerender(); }
      });
      inlineInp.addEventListener('input', function () { sp.question7Option3Input = inlineInp.value; });
      c3.appendChild(inlineInp);
      c3.appendChild(document.createTextNode(parts[1] || ''));
      c3.addEventListener('click', function () { sp.question7 = sp.question7 === o3 ? '' : o3; rerender(); });
      box.appendChild(c3);
      q7.appendChild(box);
      maybeAppend(q7, err('secondPage.question7Option3Input'));
      maybeAppend(q7, err('secondPage.question7'));
      // validity period extra when option2 or option3
      if (sp.question7 === o2 || sp.question7 === o3) {
        var field = el('div', 'et-field');
        field.appendChild(el('label', 'et-field-label', { text: L.secondPage.question7.extraText }));
        var inp = el('input', 'et-input', { type: 'text', value: sp.question7Extra || '' });
        inp.addEventListener('input', function () { sp.question7Extra = inp.value; });
        field.appendChild(inp);
        maybeAppend(field, err('secondPage.question7Extra'));
        q7.appendChild(field);
      }
      wrap.appendChild(q7);

      wrap.appendChild(actions(true, L.next));
      return wrap;
    }

    // model text-entry list (q5/q6): typed names ARE the array; "other" sentinel + extra input
    function modelQuestion(num, labelText, arrKey, extraKey, other) {
      var sp = state.secondPage;
      var q = question(num, labelText);
      var list = el('div', 'et-models');
      // typed model rows (skip the sentinel; it is rendered via the chip below)
      sp[arrKey].forEach(function (val, idx) {
        if (val === other) return;
        var row = el('div', 'et-model-row');
        var inp = el('input', 'et-input', { type: 'text', value: val, placeholder: L.secondPage.shoeModelName });
        inp.addEventListener('input', function () { sp[arrKey][idx] = inp.value; });
        row.appendChild(inp);
        var rm = el('button', 'et-btn et-btn-back', { type: 'button', text: '×' });
        rm.addEventListener('click', function () { sp[arrKey].splice(idx, 1); rerender(); });
        row.appendChild(rm);
        list.appendChild(row);
      });
      q.appendChild(list);
      // add-model button
      var add = el('button', 'et-btn', { type: 'button', text: L.secondPage.addModel });
      add.addEventListener('click', function () { sp[arrKey].push(''); rerender(); });
      q.appendChild(add);
      // "Anderes Schuhmodell" chip + extra input
      var hasOther = sp[arrKey].indexOf(other) !== -1;
      var chipBox = el('div', 'et-options');
      var chip = el('span', 'et-chip' + (hasOther ? ' is-selected' : ''), { text: L.secondPage.otherShoeModel });
      chip.addEventListener('click', function () {
        if (hasOther) {
          sp[arrKey] = sp[arrKey].filter(function (x) { return x !== other; });
          sp[extraKey] = '';
        } else { sp[arrKey].push(other); }
        rerender();
      });
      chipBox.appendChild(chip);
      q.appendChild(chipBox);
      if (hasOther) {
        var field = el('div', 'et-field');
        field.appendChild(el('label', 'et-field-label', { text: L.secondPage.shoeModelName }));
        var inp2 = el('input', 'et-input', { type: 'text', value: sp[extraKey] || '' });
        inp2.addEventListener('input', function () { sp[extraKey] = inp2.value; });
        field.appendChild(inp2);
        maybeAppend(field, err('secondPage.' + extraKey));
        q.appendChild(field);
      }
      maybeAppend(q, err('secondPage.' + arrKey));
      return q;
    }

    // ============================ PAGE 3 ============================
    function renderPage3() {
      var wrap = el('div', 'et-step is-active');
      var th = state.thirdPage;

      // Q8 multi chips, option6 has inline free-text
      var q8 = question('8', L.thirdPage.question8.text, L.thirdPage.question8.note);
      var box = el('div', 'et-options');
      var opt6De = DE.thirdPage.question8.option6;
      for (var i = 1; i <= 6; i++) {
        (function (n) {
          var deVal = DE.thirdPage.question8['option' + n];
          var label = L.thirdPage.question8['option' + n];
          var sel = th.question8.indexOf(deVal) !== -1;
          var chip = el('span', 'et-chip' + (sel ? ' is-selected' : ''));
          if (n === 6) {
            var parts = String(label).split('<input/>');
            chip.appendChild(document.createTextNode(parts[0] || ''));
            var inl = el('input', 'et-inline-input', { type: 'text', value: th.question8OtherOptionInput || '' });
            inl.addEventListener('click', function (e) {
              e.stopPropagation();
              if (th.question8.indexOf(deVal) === -1) { th.question8.push(deVal); rerender(); }
            });
            inl.addEventListener('input', function () { th.question8OtherOptionInput = inl.value; });
            chip.appendChild(inl);
            chip.appendChild(document.createTextNode(parts[1] || ''));
          } else {
            chip.textContent = label;
          }
          chip.addEventListener('click', function () {
            var idx = th.question8.indexOf(deVal);
            if (idx !== -1) th.question8.splice(idx, 1); else th.question8.push(deVal);
            rerender();
          });
          box.appendChild(chip);
        })(i);
      }
      q8.appendChild(box);
      maybeAppend(q8, err('thirdPage.question8OtherOptionInput'));
      maybeAppend(q8, err('thirdPage.question8'));
      wrap.appendChild(q8);

      // Q9 width/height number inputs
      var q9 = question('9', L.thirdPage.question9.text);
      [
        { key: 'inputWidth', label: L.thirdPage.question9.widthInMM },
        { key: 'inputHeight', label: L.thirdPage.question9.heightInMM }
      ].forEach(function (f) {
        var field = el('div', 'et-field');
        field.appendChild(el('label', 'et-field-label', { text: f.label }));
        var inp = el('input', 'et-input', { type: 'number', value: th.question9[f.key] || '' });
        inp.addEventListener('input', function () { th.question9[f.key] = inp.value; });
        field.appendChild(inp);
        maybeAppend(field, err('thirdPage.question9.' + f.key));
        q9.appendChild(field);
      });
      wrap.appendChild(q9);

      // Q10 image cards (multi)
      var q10 = question('10', L.thirdPage.question10.text, L.thirdPage.question10.note);
      cardGroup(q10, [
        { value: DE.thirdPage.question10.option1, label: L.thirdPage.question10.option1, img: (images.q10 || [])[0] },
        { value: DE.thirdPage.question10.option2, label: L.thirdPage.question10.option2, img: (images.q10 || [])[1] },
        { value: DE.thirdPage.question10.option3, label: L.thirdPage.question10.option3, img: (images.q10 || [])[2] },
        { value: DE.thirdPage.question10.option4, label: L.thirdPage.question10.option4, img: (images.q10 || [])[3] }
      ], function (v) { return th.question10.indexOf(v) !== -1; }, function (v) {
        var idx = th.question10.indexOf(v);
        if (idx !== -1) th.question10.splice(idx, 1); else th.question10.push(v);
        rerender();
      });
      maybeAppend(q10, err('thirdPage.question10'));
      wrap.appendChild(q10);

      // Q11 textarea
      var q11 = question('11', L.thirdPage.question11.text);
      var ta = el('textarea', 'et-textarea');
      ta.value = th.question11 || '';
      ta.addEventListener('input', function () { th.question11 = ta.value; });
      q11.appendChild(ta);
      wrap.appendChild(q11);

      wrap.appendChild(actions(true, L.thirdPage.submit));
      return wrap;
    }

    // ============================ THANK-YOU ============================
    function renderThankYou() {
      var wrap = el('div', 'et-step is-active');
      var ty = el('div', 'et-thankyou');
      ty.appendChild(el('h2', null, { text: L.forthPage.youMadeIt }));
      ty.appendChild(el('p', null, { text: L.forthPage.message1 }));
      ty.appendChild(el('p', null, { text: L.forthPage.message2 }));
      wrap.appendChild(ty);
      return wrap;
    }

    // ---------- nav actions ----------
    function actions(showBack, primaryLabel) {
      var bar = el('div', 'et-actions');
      if (showBack) {
        var back = el('button', 'et-btn et-btn-back', { type: 'button', text: '‹ ' + L.back });
        back.addEventListener('click', function () { errors = {}; page -= 1; rerender(); window.scrollTo(0, 0); });
        bar.appendChild(back);
      }
      bar.appendChild(el('span', 'et-progress', { text: page + '/' + TOTAL }));
      var prim = el('button', 'et-btn et-btn-primary', { type: 'button', text: primaryLabel });
      prim.addEventListener('click', onPrimary);
      bar.appendChild(prim);
      return bar;
    }

    function onPrimary() {
      errors = validatePage(page, state, DE);
      if (Object.keys(errors).length) {
        rerender();
        var firstErr = mount.querySelector('.et-error');
        if (firstErr) firstErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (page < 3) { page += 1; rerender(); window.scrollTo(0, 0); return; }
      // page === 3 → submit
      submit();
    }

    function submit() {
      var form = new FormData();
      (state.firstPage.uploadedFiles || []).forEach(function (f, i) {
        form.append('attachments[' + i + ']', f.file, f.name);
      });
      form.append('data', JSON.stringify({
        data: { formName: cfg.formName, description: { text: buildBlob(state, DE) } }
      }));
      fetch(cfg.endpoint, { method: 'POST', body: form, credentials: 'same-origin' })
        .then(function (res) {
          if (!res.ok) throw new Error('Submit failed: ' + res.status);
          state = initialState();
          state.userInfo.email = cfg.email || '';
          state.userInfo.address = cfg.address || '';
          errors = {};
          page = 4;
          rerender();
          window.scrollTo(0, 0);
        })
        .catch(function (e) { console.error('[aico-events-kybun-joya]', e); });
    }

    function rerender() {
      clear(mount);
      var node;
      if (page === 1) node = renderPage1();
      else if (page === 2) node = renderPage2();
      else if (page === 3) node = renderPage3();
      else node = renderThankYou();
      mount.appendChild(node);
    }

    rerender();
  }

  // ---- browser bootstrap ----
  function boot() {
    var root = document.querySelector('[data-aico-eventtool="events-kybun-joya"]');
    if (!root) return;
    var cfgEl = document.getElementById('aico-eventtool-config');
    var cfg = {};
    try { cfg = JSON.parse(cfgEl.textContent); } catch (e) { return; }
    render({ root: root, cfg: cfg });
  }

  return { STR: STR, initialState: initialState, validatePage: validatePage, buildBlob: buildBlob, fiveWorkingDaysAway: fiveWorkingDaysAway, boot: boot };
});
