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
  // `de` drives value comparisons (state stores the de_CH canonical option
  // strings); `msg` (defaults to `de`) drives the error MESSAGE language so the
  // UI shows errors in the displayed locale, not always German.
  function validatePage(pageNum, state, de, msg) {
    var e = {}, s = state, M = msg || de, set = function (f, k) { e[f] = get(M, k); };
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

    // Per-field error anchors registered while the step is built ONCE.
    // anchors[field] = the DOM node AFTER which the .et-error span is inserted.
    var anchors = {};
    function anchor(field, node) { anchors[field] = node; return node; }

    // Clear all current .et-error nodes and (re)insert from the `errors` map,
    // in place — never rebuilds the step.
    function applyErrors() {
      var existing = mount.querySelectorAll('.et-error');
      Array.prototype.forEach.call(existing, function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
      Object.keys(errors).forEach(function (field) {
        var a = anchors[field];
        if (!a || !a.parentNode) return;
        a.parentNode.insertBefore(errEl(errors[field]), a.nextSibling);
      });
    }

    function question(num, labelText, note) {
      var q = el('div', 'et-question');
      q.appendChild(el('span', 'et-qlabel', { text: num + '. ' + labelText }));
      if (note) q.appendChild(el('span', 'et-qnote', { text: note }));
      return q;
    }

    // ---------- single-select chip group (toggles in place) ----------
    // get()/set() read+write the selected value on state.
    function singleChipGroup(parent, opts2, getSel, setSel, afterChange) {
      var box = el('div', 'et-options');
      var chips = [];
      function paint() {
        var cur = getSel();
        chips.forEach(function (c) {
          if (c.value === cur) c.node.classList.add('is-selected');
          else c.node.classList.remove('is-selected');
        });
      }
      opts2.forEach(function (o) {
        var chip = el('span', 'et-chip', { text: o.label });
        chip.addEventListener('click', function () {
          setSel(getSel() === o.value ? '' : o.value);
          paint();
          if (afterChange) afterChange();
        });
        chips.push({ value: o.value, node: chip });
        box.appendChild(chip);
      });
      parent.appendChild(box);
      paint();
      return { box: box, repaint: paint };
    }

    // ---------- image card group (single or multi, toggles in place) ----------
    function cardGroup(parent, cards, isSelected, onToggle) {
      var grid = el('div', 'et-cards');
      var nodes = [];
      function paint() {
        nodes.forEach(function (c) {
          if (isSelected(c.value)) c.node.classList.add('is-selected');
          else c.node.classList.remove('is-selected');
        });
      }
      cards.forEach(function (c) {
        var card = el('div', 'et-card');
        if (c.img) card.appendChild(el('img', 'et-card-img', { src: c.img, alt: '' }));
        card.appendChild(el('div', 'et-card-title', { text: c.label }));
        card.addEventListener('click', function () { onToggle(c.value); paint(); });
        nodes.push({ value: c.value, node: card });
        grid.appendChild(card);
      });
      parent.appendChild(grid);
      paint();
      return grid;
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
        anchor('firstPage.question1.' + f.key, inp);
        q1.appendChild(field);
      });
      wrap.appendChild(q1);

      // Q2 (single chip) — upload zone rendered ONCE, shown/hidden by selection
      var q2 = question('2', L.firstPage.question2.text);
      var q2group = singleChipGroup(q2, [
        { value: DE.firstPage.question2.option1, label: L.firstPage.question2.option1 },
        { value: DE.firstPage.question2.option2, label: L.firstPage.question2.option2 }
      ], function () { return state.firstPage.question2; },
        function (v) { state.firstPage.question2 = v; },
        function () { toggleUpload(); });
      // anchor for the q2 required error is the chip box
      anchor('firstPage.question2', q2group.box);

      // upload zone (always present, toggled hidden)
      var up = el('div', 'et-upload');
      up.appendChild(el('div', 'et-field-label', { text: L.firstPage.question2.uploadText }));
      var zone = el('div', 'et-upload-zone');
      zone.appendChild(el('span', null, { text: L.firstPage.question2.dropFilesOr + ' ' + L.firstPage.question2.browse }));
      var fileInput = el('input', null, { type: 'file', multiple: 'multiple' });
      fileInput.style.display = 'none';
      zone.appendChild(fileInput);
      var ul = el('ul', 'et-upload-list');
      function addFileRow(f) {
        var li = el('li', 'et-upload-item');
        li.appendChild(el('span', null, { text: f.name }));
        var rm = el('button', null, { type: 'button', text: '×' });
        rm.addEventListener('click', function () {
          var i = state.firstPage.uploadedFiles.indexOf(f);
          if (i !== -1) state.firstPage.uploadedFiles.splice(i, 1);
          if (li.parentNode) li.parentNode.removeChild(li);  // remove ONLY this row
        });
        li.appendChild(rm);
        ul.appendChild(li);
      }
      function addFiles(list) {
        var existing = (state.firstPage.uploadedFiles || []).map(function (f) { return f.name; });
        Array.prototype.forEach.call(list, function (file) {
          if (existing.indexOf(file.name) === -1) {
            var rec = { file: file, name: file.name };
            state.firstPage.uploadedFiles.push(rec);
            existing.push(file.name);
            addFileRow(rec);  // append ONLY the new row
          }
        });
      }
      zone.addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', function () { addFiles(fileInput.files); fileInput.value = ''; });
      zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('is-dragover'); });
      zone.addEventListener('dragleave', function () { zone.classList.remove('is-dragover'); });
      zone.addEventListener('drop', function (e) {
        e.preventDefault(); zone.classList.remove('is-dragover');
        if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
      });
      up.appendChild(zone);
      up.appendChild(ul);
      (state.firstPage.uploadedFiles || []).forEach(addFileRow);
      // anchor for the upload-required error is the upload block itself
      anchor('firstPage.uploadedFiles', up);
      q2.appendChild(up);

      function toggleUpload() {
        up.hidden = state.firstPage.question2 !== DE.firstPage.question2.option2;
      }
      toggleUpload();
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
      var q3grid = cardGroup(q3, [
        { value: DE.secondPage.question3.option1, label: L.secondPage.question3.option1, img: (images.q3 || [])[0] },
        { value: DE.secondPage.question3.option2, label: L.secondPage.question3.option2, img: (images.q3 || [])[1] },
        { value: DE.secondPage.question3.option3, label: L.secondPage.question3.option3, img: (images.q3 || [])[2] }
      ], function (v) { return sp.question3 === v; }, function (v) {
        sp.question3 = sp.question3 === v ? '' : v;
      });
      anchor('secondPage.question3', q3grid);
      wrap.appendChild(q3);

      // Q4 image cards (single)
      var q4 = question('4', L.secondPage.question4.text);
      var q4grid = cardGroup(q4, [
        { value: DE.secondPage.question4.option1, label: L.secondPage.question4.option1, img: (images.q4 || [])[0] },
        { value: DE.secondPage.question4.option2, label: L.secondPage.question4.option2, img: (images.q4 || [])[1] },
        { value: DE.secondPage.question4.option3, label: L.secondPage.question4.option3, img: (images.q4 || [])[2] }
      ], function (v) { return sp.question4 === v; }, function (v) {
        sp.question4 = sp.question4 === v ? '' : v;
      });
      anchor('secondPage.question4', q4grid);
      wrap.appendChild(q4);

      // Q5 live Joya product image-card picker
      wrap.appendChild(modelQuestion('5', 'q5', 'question5', 'question5Extra', other, 'joya'));
      // Q6 live kybun product image-card picker
      wrap.appendChild(modelQuestion('6', 'q6', 'question6', 'question6Extra', other, 'kybun'));

      // Q7 coupon chips (single) + inline discount on option3 + validity extra
      var q7 = question('7', L.secondPage.question7.text);
      var box = el('div', 'et-options');
      var o1 = DE.secondPage.question7.option1, o2 = DE.secondPage.question7.option2, o3 = DE.secondPage.question7.option3;
      function paintQ7() {
        c1.classList.toggle('is-selected', sp.question7 === o1);
        c2.classList.toggle('is-selected', sp.question7 === o2);
        c3.classList.toggle('is-selected', sp.question7 === o3);
        // validity field shown for option2 OR option3, hidden otherwise
        validityField.hidden = !(sp.question7 === o2 || sp.question7 === o3);
      }
      // option1
      var c1 = el('span', 'et-chip', { text: L.secondPage.question7.option1 });
      c1.addEventListener('click', function () { sp.question7 = sp.question7 === o1 ? '' : o1; paintQ7(); });
      box.appendChild(c1);
      // option2
      var c2 = el('span', 'et-chip', { text: L.secondPage.question7.option2 });
      c2.addEventListener('click', function () { sp.question7 = sp.question7 === o2 ? '' : o2; paintQ7(); });
      box.appendChild(c2);
      // option3 with inline input (split label on <input/>)
      var c3 = el('span', 'et-chip');
      var parts = String(L.secondPage.question7.option3).split('<input/>');
      c3.appendChild(document.createTextNode(parts[0] || ''));
      var inlineInp = el('input', 'et-inline-input', { type: 'text', value: sp.question7Option3Input || '' });
      inlineInp.addEventListener('click', function (e) {
        e.stopPropagation();
        if (sp.question7 !== o3) { sp.question7 = o3; paintQ7(); }
      });
      inlineInp.addEventListener('input', function () { sp.question7Option3Input = inlineInp.value; });
      c3.appendChild(inlineInp);
      c3.appendChild(document.createTextNode(parts[1] || ''));
      c3.addEventListener('click', function () { sp.question7 = sp.question7 === o3 ? '' : o3; paintQ7(); });
      box.appendChild(c3);
      q7.appendChild(box);
      anchor('secondPage.question7Option3Input', inlineInp);
      anchor('secondPage.question7', box);
      // validity period field (rendered once, toggled hidden)
      var validityField = el('div', 'et-field');
      validityField.appendChild(el('label', 'et-field-label', { text: L.secondPage.question7.extraText }));
      var vInp = el('input', 'et-input', { type: 'text', value: sp.question7Extra || '' });
      vInp.addEventListener('input', function () { sp.question7Extra = vInp.value; });
      validityField.appendChild(vInp);
      anchor('secondPage.question7Extra', vInp);
      q7.appendChild(validityField);
      paintQ7();
      wrap.appendChild(q7);

      wrap.appendChild(actions(true, L.next));
      return wrap;
    }

    // live product image-card picker (q5/q6): selected product NAMES are the array;
    // "other" sentinel + extra name input kept. maxSelectable comes from config.
    // Selecting a card toggles .is-selected IN PLACE (no step rebuild); products
    // fetched per brand. cfgKey = 'q5' | 'q6' (into cfg.maxSelectable + STR strings).
    function modelQuestion(num, cfgKey, arrKey, extraKey, other, brand) {
      var sp = state.secondPage;
      var strQ = L.secondPage['question' + num];
      var MAX = (cfg.maxSelectable && cfg.maxSelectable[cfgKey]) || 3;

      // heading with live counter span inside the .et-qlabel
      var q = el('div', 'et-question');
      var qlabel = el('span', 'et-qlabel', { text: num + '. ' + strQ.text });
      var counter = el('span', 'et-qcount');
      qlabel.appendChild(counter);
      q.appendChild(qlabel);
      // subText as .et-qnote, with {{count}} → MAX
      if (strQ.subText) {
        q.appendChild(el('span', 'et-qnote', { text: String(strQ.subText).replace('{{count}}', MAX) }));
      }

      // live counter text (count = array length incl. the "other" sentinel)
      function updateCounter() { counter.textContent = ((sp[arrKey] || []).length) + ' / ' + MAX; }

      // grid host for product cards + a loading/empty status line
      var grid = el('div', 'et-cards');
      var status = el('div', 'et-qnote');
      status.textContent = (dispLang === 'de_CH') ? 'Produkte werden geladen…' : 'Loading products…';
      q.appendChild(status);
      q.appendChild(grid);

      // "Anderes Schuhmodell" chip + extra input (rendered once, toggled hidden)
      var chipBox = el('div', 'et-options');
      var chip = el('span', 'et-chip', { text: L.secondPage.otherShoeModel });
      if ((sp[arrKey] || []).indexOf(other) !== -1) chip.classList.add('is-selected');
      var extraField = el('div', 'et-field');
      extraField.appendChild(el('label', 'et-field-label', { text: L.secondPage.shoeModelName }));
      var extraInp = el('input', 'et-input', { type: 'text', value: sp[extraKey] || '' });
      extraInp.addEventListener('input', function () { sp[extraKey] = extraInp.value; });
      extraField.appendChild(extraInp);
      function toggleExtra() { extraField.hidden = !chip.classList.contains('is-selected'); }

      // count of selected items (incl. the sentinel) for max enforcement
      function selectedCount() { return (sp[arrKey] || []).length; }
      function atMax() { return selectedCount() >= MAX; }

      // repaint every product card's disabled/selected look from current state
      var cardNodes = [];  // {name, node}
      function repaintCards() {
        var full = atMax();
        cardNodes.forEach(function (c) {
          var sel = (sp[arrKey] || []).indexOf(c.name) !== -1;
          c.node.classList.toggle('is-selected', sel);
          // visually disable unselected cards when at max
          c.node.style.opacity = (!sel && full) ? '0.5' : '';
          c.node.style.pointerEvents = (!sel && full) ? 'none' : '';
        });
        // also disable the "other" chip when at max and not active
        var otherActive = chip.classList.contains('is-selected');
        chip.style.opacity = (!otherActive && full) ? '0.5' : '';
        chip.style.pointerEvents = (!otherActive && full) ? 'none' : '';
        updateCounter();  // keep the live "n / max" counter in sync, in place
      }

      function makeCard(p) {
        var card = el('div', 'et-card');
        if (p.image) card.appendChild(el('img', 'et-card-img', { src: p.image, alt: '' }));
        card.appendChild(el('div', 'et-card-title', { text: p.name }));
        card.addEventListener('click', function () {
          var arr = sp[arrKey] || (sp[arrKey] = []);
          var idx = arr.indexOf(p.name);
          if (idx !== -1) { arr.splice(idx, 1); }
          else { if (atMax()) return; arr.push(p.name); }  // enforce max-3
          repaintCards();
        });
        cardNodes.push({ name: p.name, node: card });
        grid.appendChild(card);
      }

      // "other" chip behaviour (counts toward max via the sentinel in the array)
      chip.addEventListener('click', function () {
        var arr = sp[arrKey] || (sp[arrKey] = []);
        var has = chip.classList.contains('is-selected');
        if (has) {
          var i = arr.indexOf(other);
          if (i !== -1) arr.splice(i, 1);
          chip.classList.remove('is-selected');
          sp[extraKey] = ''; extraInp.value = '';
        } else {
          if (atMax()) return;  // enforce max-3
          arr.push(other);
          chip.classList.add('is-selected');
        }
        toggleExtra();
        repaintCards();
      });

      chipBox.appendChild(chip);
      q.appendChild(chipBox);
      anchor('secondPage.' + extraKey, extraInp);
      q.appendChild(extraField);
      toggleExtra();
      anchor('secondPage.' + arrKey, chipBox);
      updateCounter();  // initial "n / max" before products load

      // fetch this brand's products (cookie-authed), then render cards
      var url = cfg.productsUrl;
      if (url) {
        var qs = (url.indexOf('?') === -1 ? '?' : '&') + 'brand=' + encodeURIComponent(brand) + '&locale=' + encodeURIComponent(cfg.locale || 'de_CH');
        fetch(url + qs, { credentials: 'same-origin' })
          .then(function (res) { if (!res.ok) throw new Error('Products fetch failed: ' + res.status); return res.json(); })
          .then(function (data) {
            var products = (data && data.products) || [];
            products.forEach(makeCard);
            status.textContent = '';
            status.hidden = true;
            repaintCards();
          })
          .catch(function (e) {
            console.error('[aico-events-kybun-joya]', e);
            status.textContent = '';
            status.hidden = true;
          });
      } else {
        status.textContent = '';
        status.hidden = true;
      }

      return q;
    }

    // ============================ PAGE 3 ============================
    function renderPage3() {
      var wrap = el('div', 'et-step is-active');
      var th = state.thirdPage;

      // Q8 multi chips, option6 has inline free-text (toggles in place)
      var q8 = question('8', L.thirdPage.question8.text, L.thirdPage.question8.note);
      var box = el('div', 'et-options');
      for (var i = 1; i <= 6; i++) {
        (function (n) {
          var deVal = DE.thirdPage.question8['option' + n];
          var label = L.thirdPage.question8['option' + n];
          var chip = el('span', 'et-chip');
          if (th.question8.indexOf(deVal) !== -1) chip.classList.add('is-selected');
          if (n === 6) {
            var parts = String(label).split('<input/>');
            chip.appendChild(document.createTextNode(parts[0] || ''));
            var inl = el('input', 'et-inline-input', { type: 'text', value: th.question8OtherOptionInput || '' });
            inl.addEventListener('click', function (e) {
              e.stopPropagation();
              if (th.question8.indexOf(deVal) === -1) { th.question8.push(deVal); chip.classList.add('is-selected'); }
            });
            inl.addEventListener('input', function () { th.question8OtherOptionInput = inl.value; });
            chip.appendChild(inl);
            chip.appendChild(document.createTextNode(parts[1] || ''));
            anchor('thirdPage.question8OtherOptionInput', inl);
          } else {
            chip.textContent = label;
          }
          chip.addEventListener('click', function () {
            var idx = th.question8.indexOf(deVal);
            if (idx !== -1) { th.question8.splice(idx, 1); chip.classList.remove('is-selected'); }
            else { th.question8.push(deVal); chip.classList.add('is-selected'); }
          });
          box.appendChild(chip);
        })(i);
      }
      q8.appendChild(box);
      anchor('thirdPage.question8', box);
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
        anchor('thirdPage.question9.' + f.key, inp);
        q9.appendChild(field);
      });
      wrap.appendChild(q9);

      // Q10 image cards (multi)
      var q10 = question('10', L.thirdPage.question10.text, L.thirdPage.question10.note);
      var q10grid = cardGroup(q10, [
        { value: DE.thirdPage.question10.option1, label: L.thirdPage.question10.option1, img: (images.q10 || [])[0] },
        { value: DE.thirdPage.question10.option2, label: L.thirdPage.question10.option2, img: (images.q10 || [])[1] },
        { value: DE.thirdPage.question10.option3, label: L.thirdPage.question10.option3, img: (images.q10 || [])[2] },
        { value: DE.thirdPage.question10.option4, label: L.thirdPage.question10.option4, img: (images.q10 || [])[3] }
      ], function (v) { return th.question10.indexOf(v) !== -1; }, function (v) {
        var idx = th.question10.indexOf(v);
        if (idx !== -1) th.question10.splice(idx, 1); else th.question10.push(v);
      });
      anchor('thirdPage.question10', q10grid);
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
        back.addEventListener('click', function () { errors = {}; page -= 1; buildStep(); window.scrollTo(0, 0); });
        bar.appendChild(back);
      }
      bar.appendChild(el('span', 'et-progress', { text: page + '/' + TOTAL }));
      var prim = el('button', 'et-btn et-btn-primary', { type: 'button', text: primaryLabel });
      prim.addEventListener('click', onPrimary);
      bar.appendChild(prim);
      return bar;
    }

    function onPrimary() {
      errors = validatePage(page, state, DE, L);
      if (Object.keys(errors).length) {
        applyErrors();  // update errors IN PLACE — no step rebuild
        var firstErr = mount.querySelector('.et-error');
        if (firstErr) firstErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      errors = {};
      applyErrors();
      if (page < 3) { page += 1; buildStep(); window.scrollTo(0, 0); return; }
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
          buildStep();
          window.scrollTo(0, 0);
        })
        .catch(function (e) { console.error('[aico-events-kybun-joya]', e); });
    }

    // Full rebuild of the active step — ONLY used for page navigation.
    function buildStep() {
      anchors = {};
      clear(mount);
      var node;
      if (page === 1) node = renderPage1();
      else if (page === 2) node = renderPage2();
      else if (page === 3) node = renderPage3();
      else node = renderThankYou();
      mount.appendChild(node);
    }

    buildStep();
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
