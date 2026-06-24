/*
 * Events / Joya multi-step form (formName: joya-formular).
 * Self-contained vanilla-JS port of the legacy b2b-shop src/pages/events/joya.
 *
 * UNLIKE the kybun-joya form, the joya form submits the RAW STATE OBJECT as the
 * `description` (not a text blob). The submitted object keeps EXACTLY the same
 * structure as the legacy FormContext.initialFormState — including the per-page
 * `errors` arrays and the top-level userEmail / userAddress fields.
 *
 * Localisation contract (mirrors the kybun-joya `de` vs `msg` split):
 *   - DE  = STR.de_CH  -> the CANONICAL option strings stored in state / used for
 *           value comparisons. The submitted `description` always carries de_CH
 *           option text, regardless of UI language.
 *   - MSG = STR[displayLocale] -> display labels + error MESSAGE text shown to the
 *           user in the active language.
 *
 * Multipart POST to cfg.endpoint ({{ routes.aico_forms_url }}):
 *   attachments[0..n] = each uploaded File,
 *   data = JSON.stringify({ data: { formName: 'joya-formular', description: <state> } }).
 * Auth = storefront session cookie -> credentials:'same-origin'.
 *
 * Rendering: each step is built ONCE on page navigation. In-page interactions
 * (chip/card select, conditional reveals, add/remove rows, validation errors)
 * mutate the DOM IN PLACE and never rebuild the step.
 *
 * initialState() / buildDescription() / validateThirdPage() are exported under
 * Node so the exact-shape contract can be unit-tested without a browser.
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
      back: 'Zurück', next: 'Weiter', submit: 'Absenden',
      errorMessage: 'Dieses Feld ist erforderlich.',
      minimumDaysErrorMessage: 'Mindestens 5 Werktage Vorlaufzeit notwendig',
      infoText: {
        firstPart: 'Durch Ausfüllen des folgenden Formulars, kannst du dir Marketingmaterialien für deinen nächsten Joya Erlebnistag zusammenstellen. Jeder Schritt bzw. jede Gestaltungsoption wird ausführlich erklärt.',
        secondPart: 'Alle mit einem Sternchen * markierten Angaben sind Pflichtangaben.',
        thirdPart: 'Ohne diese kann das Formular nicht abgesendet werden.',
        forthPart: 'Bei Fragen wende dich bitte an ',
        mail: 'marketing@kybunjoya.swiss'
      },
      firstPage: {
        startingInfo: 'Eckdaten zum geplanten Joya Erlebnistag *',
        dateQuestion: 'Termin Joya Erlebnistag (Datum in DD.MM.YY)',
        dateNote: 'Diesen solltest du bereits mit deinem Außendienstansprechpartner abgestimmt haben.',
        startTimeQuestion: 'Wann soll es losgehen? (Startzeit in HH:MM)',
        endTimeQuestion: 'Bis wann? (Endzeit in HH:MM)',
        logoQuestion: 'Hat die Joya Marketingabteilung dein Geschäftslogo schon in hochauflösender Form? *',
        logoYes: 'Ja, ist schon vorhanden',
        logoNo: 'Nein, bisher noch nicht',
        uploadLogo: 'Bitte hochauflösendes Logo hier hochladen',
        imageUploadError: 'Die Bildabmessungen sind zu groß. Die maximal zulässigen Abmessungen betragen 2000x1800.',
        dropFilesOr: 'Dateien hier ablegen oder',
        browse: 'Browse'
      },
      secondPage: {
        firstQuestion: { option1: 'a. Klassischer PR-Text', option2: 'b. Interview Experte', option3: 'c. Interview Händler/in' },
        secondQuestion: { followingShoeModels: 'Folgende(s) Schuhmodell(e)' },
        shoeText: { text1: 'a. Laura dark red', text2: 'b. Dynamo ZIP dark grey', text3: 'c. Veloce STX pink' },
        startPRText: 'Wähle einen PR-Text *',
        sendDetailsText: '* Bitte sende uns für diesen Fall Namen und Portrait der Person, die genannt werden soll, sowie deine Textänderungswünsche',
        additionalElementsText: 'Welche Schuhmodelle sollen, wenn möglich, im Textteil angezeigt werden? *',
        chooseMaxImages: 'Es sind maximal zwei Bilder von A-Ansichten möglich, sowie ein Portrait des Interview-Partners bei den Interview-Texten',
        shoeModelName: '* Name des/r Schuhmodells/e'
      },
      thirdPage: {
        designVariants: "In dieser Saison steht zur Bewerbung von Erlebnistagen das Motiv 'Fersensporn' zur Verfügung. Das gesamte Material für deinen Erlebnistag wird in einem einheitlichen Design erstellt.",
        currentSeasonModels: 'Welche Modelle der aktuellen Saison sollen abgebildet werden? * (Bitte wähle 2 Modelle aus)',
        adFormatRequest: 'Bitte gib das genaue Format deiner Anzeige an *',
        adFormatInfo: 'Erst nach Erhalt der exakten Maße kann mit der Erstellung deiner Werbeanzeige begonnen werden.',
        widthInMM: 'Breite in mm',
        heightInMM: 'Höhe in mm',
        additionalMarketingMaterials: 'Welche weiteren Marketing-Materialien wünscht du?',
        suggestAnotherModel: 'Weiteres Modell vorschlagen',
        yes: 'Ja', no: 'Nein',
        flyerTemplateLabel: 'Ich möchte die Druckvorlage für Flyer *',
        posterTemplateLabel: 'Ich möchte die Druckvorlage für Plakate *',
        socialMediaGraphicLabel: 'Ich möchte eine Social Media Vorlage *',
        googleBusinessGraphicLabel: 'Ich möchte eine Vorlage für Google My Business *',
        commentSection: 'Bereich für Kommentare & Anmerkungen',
        submit: 'Absenden'
      },
      forthPage: {
        youMadeIt: 'Du hast es geschafft!',
        successMessageFirst: 'Die Angaben deiner Buchung werden nun an usere Marketingabteilung übermittelt.',
        successMessageSecond: 'Wir werden uns in Kürze mit einem Entwurf bei dir melden.'
      }
    },
    en: {
      back: 'Back', next: 'Next', submit: 'Submit',
      errorMessage: 'This field is required.',
      minimumDaysErrorMessage: 'Minimum lead time of 5 business days required',
      infoText: {
        firstPart: 'By filling out the following form, you can put together marketing materials for your next Joya Experience Day. Each step or design option is explained in detail.',
        secondPart: 'All details marked with a star * are mandatory.',
        thirdPart: ' The form cannot be sent without them.',
        forthPart: 'If you have any questions, please contact ',
        mail: 'marketing@kybunjoya.swiss'
      },
      firstPage: {
        startingInfo: 'Key data on the planned Joya Experience Day *',
        dateQuestion: 'Joya Experience Day date? (Date in DD.MM.YY)',
        dateNote: 'You should have already coordinated this with your field representative.',
        startTimeQuestion: 'When should it start? (Start time in HH:MM)',
        endTimeQuestion: 'Until when? (End time in HH:MM)',
        logoQuestion: 'Does the Joya Marketing department already have your business logo in high resolution? *',
        logoYes: 'Yes, already exists',
        logoNo: 'No, not yet',
        uploadLogo: 'Please upload your high-resolution logo here',
        imageUploadError: 'Image dimensions are too large. Maximum allowed dimensions are 2000x1800.',
        dropFilesOr: 'Drop files here or',
        browse: 'Browse'
      },
      secondPage: {
        firstQuestion: { option1: 'a. Classic PR Text', option2: 'b. Expert interview', option3: 'c. Interview retailer' },
        secondQuestion: { followingShoeModels: 'Following shoe model(s)' },
        shoeText: { text1: 'a. Laura dark red', text2: 'b. Dynamo ZIP dark grey', text3: 'c. Veloce STX pink' },
        startPRText: 'Choose a PR text *',
        sendDetailsText: '* For this case, please send us the name and portrait of the person to be mentioned, as well as your text modification requests.',
        additionalElementsText: 'Which shoe models should be displayed in the text section? *',
        chooseMaxImages: 'A maximum of two pictures of A-views are possible, as well as a portrait of the interview partner in the interview texts.',
        shoeModelName: '* Shoe model name'
      },
      thirdPage: {
        designVariants: 'This season, the ‘heel spur’ motif is available for advertising experience days. All the material for your experience day is created in a standardised design.',
        currentSeasonModels: 'Which models of the current season should be shown? (Please select two models) *',
        adFormatRequest: 'Please specify the exact format of your ad *',
        adFormatInfo: 'We can only start creating your ad once we have received the exact dimensions.',
        widthInMM: 'Width in mm',
        heightInMM: 'Height in mm',
        additionalMarketingMaterials: 'What other marketing materials would you like?',
        suggestAnotherModel: 'Suggest another model',
        yes: 'Yes', no: 'No',
        flyerTemplateLabel: 'I would like the print template for flyers *',
        posterTemplateLabel: 'I would like the print template for posters *',
        socialMediaGraphicLabel: ' I would like a social media template *',
        googleBusinessGraphicLabel: 'I would like a template for Google My Business *',
        commentSection: 'Area for comments & notes',
        submit: 'Submit'
      },
      forthPage: {
        youMadeIt: 'You have made it!',
        successMessageFirst: 'The details of your booking will now be sent to our marketing department. ',
        successMessageSecond: 'We will get back to you shortly with a draft.'
      }
    }
  };

  var MAX_SHOES = 2;

  // ---- EXACT initial state (must serialize identically to b2b FormContext.initialFormState) ----
  function initialState() {
    return {
      uploadedFiles: [],
      userEmail: '',
      userAddress: '',
      firstPage: { question1: '', question2: '', question3: '', question4: '', errors: [] },
      secondPage: { question1: '', question1Extra: '', question2: [], question2Extra: '', errors: [] },
      thirdPage: {
        question1: 'default choice',
        question2: [],
        question2Extra: '',
        question3: '',
        question4: '',
        question5: '',
        question6: '',
        question7: 'question removed (ignore)',
        question8: '',
        question9: '',
        question10: '',
        errors: []
      }
    };
  }

  function emptyArr(v) { return Array.isArray(v) && v.length === 0; }

  // ---- third-page validation (mirror ThirdPage.handleErrors fieldsToValidate) ----
  // Returns the array of invalid third-page field names (the errors array).
  function validateThirdPage(state, showExtraShoe) {
    var fieldsToValidate = ['question2', 'question3', 'question4', 'question5', 'question6', 'question8', 'question9'];
    var th = state.thirdPage, errs = [];
    fieldsToValidate.forEach(function (field) {
      var v = th[field];
      var isInvalidArray = Array.isArray(v) && v.length === 0;
      var isInvalidValue = !v;
      if (isInvalidArray || isInvalidValue) errs.push(field);
    });
    if (!th.question2Extra && showExtraShoe) errs.push('question2Extra');
    return errs;
  }

  // ---- build the description object that is submitted (state AS-IS, errors kept) ----
  function buildDescription(state, cfg) {
    var s = JSON.parse(JSON.stringify(state));
    s.userEmail = (cfg && cfg.email) || '';
    s.userAddress = (cfg && cfg.address) || '';
    return s;
  }

  // ---------- browser bootstrap ----------
  function boot() {
    var root = document.querySelector('[data-aico-eventtool="events-joya"]');
    if (!root) return;
    var mount = root.querySelector('[data-et-mount]');
    if (!mount) return;
    var cfgEl = document.getElementById('aico-eventtool-config');
    var cfg = {};
    try { cfg = JSON.parse(cfgEl.textContent); } catch (e) { return; }

    // de = CANONICAL option strings (stored in state, compared, submitted)
    // msg = display-language strings (labels + error message text)
    var DE = STR.de_CH;
    var MSG = STR[cfg.locale === 'en' ? 'en' : 'de_CH'];
    var images = cfg.images || {};

    var state = initialState();
    // UI-only flags (not part of the submitted description)
    var ui = { page: 1, showQ3Extra: false, showShoeExtra2: false, showShoeExtra3: false, files: [], fileListEl: null };

    function imgUrl(q, key) { return (images[q] && images[q][key]) || ''; }

    // ----- small DOM helpers -----
    function el(tag, attrs, kids) {
      var n = document.createElement(tag);
      if (attrs) Object.keys(attrs).forEach(function (k) {
        if (k === 'class') n.className = attrs[k];
        else if (k === 'text') n.textContent = attrs[k];
        else if (k === 'html') n.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') n.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
      });
      (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
      return n;
    }

    function clearErr(arr, field) {
      var i = arr.indexOf(field);
      if (i !== -1) arr.splice(i, 1);
    }

    // ----- IN-PLACE error rendering -----
    // Each question wrapper owns at most one direct-child `.et-error` node when
    // invalid. We add / update / remove that single node in place rather than
    // rebuilding the question.
    function setError(questionEl, present, msg) {
      if (!questionEl) return;
      var existing = null, kids = questionEl.children;
      for (var i = 0; i < kids.length; i++) { if (kids[i].classList && kids[i].classList.contains('et-error')) { existing = kids[i]; break; } }
      if (present) {
        if (existing) existing.textContent = msg;
        else questionEl.appendChild(el('span', { class: 'et-error', text: msg }));
      } else if (existing) {
        existing.parentNode.removeChild(existing);
      }
    }

    // clear `.is-selected` on siblings within a container, set on the clicked node
    function singleSelect(container, node) {
      var sel = container.querySelectorAll('.is-selected');
      Array.prototype.forEach.call(sel, function (n) { n.classList.remove('is-selected'); });
      node.classList.add('is-selected');
    }

    // image-card option. Stores `canonical` in state but shows `display` label.
    function card(display, url, selected, onClick) {
      return el('div', { class: 'et-card' + (selected ? ' is-selected' : ''), onclick: onClick }, [
        url ? el('img', { class: 'et-card-img', src: url, alt: display, loading: 'lazy' }) : null,
        el('div', { class: 'et-card-title', text: display })
      ]);
    }

    // ===================== STEP 1 =====================
    function renderFirst() {
      var wrap = el('div', { class: 'et-step is-active' });
      var info = el('div', { class: 'et-info' });
      info.appendChild(el('p', { text: MSG.infoText.firstPart }));
      info.appendChild(el('p', { text: MSG.infoText.secondPart }));
      info.appendChild(el('p', { text: MSG.infoText.thirdPart }));
      info.appendChild(el('p', {}, [MSG.infoText.forthPart, el('a', { href: 'mailto:' + MSG.infoText.mail, text: MSG.infoText.mail })]));
      wrap.appendChild(info);

      // Q1 - date (own question wrapper so its error renders in place)
      var q1 = el('div', { class: 'et-question' });
      q1.appendChild(el('span', { class: 'et-qlabel', html: '1. <b>' + MSG.firstPage.startingInfo + '</b>' }));
      var dF = el('div', { class: 'et-field' });
      dF.appendChild(el('span', { class: 'et-field-label', text: MSG.firstPage.dateQuestion }));
      dF.appendChild(el('span', { class: 'et-qnote', text: MSG.firstPage.dateNote }));
      var dInput = el('input', { class: 'et-input', type: 'date', value: state.firstPage.question1 });
      dInput.addEventListener('input', function () { state.firstPage.question1 = dInput.value; clearErr(state.firstPage.errors, 'question1'); setError(q1, false); });
      dF.appendChild(dInput);
      q1.appendChild(dF);
      wrap.appendChild(q1);

      // Q2 - start time
      var q2 = el('div', { class: 'et-question' });
      var sF = el('div', { class: 'et-field' });
      sF.appendChild(el('span', { class: 'et-field-label', text: MSG.firstPage.startTimeQuestion }));
      var sInput = el('input', { class: 'et-input', type: 'time', value: state.firstPage.question2 });
      sInput.addEventListener('input', function () { state.firstPage.question2 = sInput.value; clearErr(state.firstPage.errors, 'question2'); setError(q2, false); });
      sF.appendChild(sInput);
      q2.appendChild(sF);
      wrap.appendChild(q2);

      // Q3 - end time
      var q3 = el('div', { class: 'et-question' });
      var eF = el('div', { class: 'et-field' });
      eF.appendChild(el('span', { class: 'et-field-label', text: MSG.firstPage.endTimeQuestion }));
      var eInput = el('input', { class: 'et-input', type: 'time', value: state.firstPage.question3 });
      eInput.addEventListener('input', function () { state.firstPage.question3 = eInput.value; clearErr(state.firstPage.errors, 'question3'); setError(q3, false); });
      eF.appendChild(eInput);
      q3.appendChild(eF);
      wrap.appendChild(q3);

      // Q4 - logo available? (single-select chips; canonical = de_CH, display = MSG)
      var q4 = el('div', { class: 'et-question' });
      q4.appendChild(el('span', { class: 'et-qlabel', html: '2. <b>' + MSG.firstPage.logoQuestion + '</b>' }));
      var q4opts = el('div', { class: 'et-options' });
      ['logoYes', 'logoNo'].forEach(function (key) {
        var canonical = DE.firstPage[key];
        var chip = el('div', { class: 'et-chip' + (state.firstPage.question4 === canonical ? ' is-selected' : ''), text: MSG.firstPage[key] });
        chip.addEventListener('click', function () {
          state.firstPage.question4 = canonical;
          clearErr(state.firstPage.errors, 'question4');
          singleSelect(q4opts, chip);
          setError(q4, false);
        });
        q4opts.appendChild(chip);
      });
      q4.appendChild(q4opts);
      wrap.appendChild(q4);

      // Upload zone
      var up = el('div', { class: 'et-question' });
      up.appendChild(el('span', { class: 'et-qlabel', text: MSG.firstPage.uploadLogo }));
      var zone = el('div', { class: 'et-upload' });
      var dz = el('div', { class: 'et-upload-zone' }, [
        el('p', {}, [MSG.firstPage.dropFilesOr + ' ', el('span', { style: 'text-decoration:underline;cursor:pointer', text: MSG.firstPage.browse })])
      ]);
      var fileInput = el('input', { type: 'file', multiple: 'multiple', style: 'display:none' });
      dz.addEventListener('click', function () { fileInput.click(); });
      dz.addEventListener('dragover', function (ev) { ev.preventDefault(); dz.classList.add('is-dragover'); });
      dz.addEventListener('dragleave', function () { dz.classList.remove('is-dragover'); });
      dz.addEventListener('drop', function (ev) { ev.preventDefault(); dz.classList.remove('is-dragover'); addFiles(ev.dataTransfer.files); });
      fileInput.addEventListener('change', function () { addFiles(fileInput.files); fileInput.value = ''; });
      zone.appendChild(dz);
      zone.appendChild(fileInput);

      var list = el('ul', { class: 'et-upload-list' });
      ui.fileListEl = list; // reference for in-place add/remove of rows
      ui.files.forEach(function (f) { list.appendChild(buildFileRow(f)); });
      zone.appendChild(list);
      up.appendChild(zone);
      wrap.appendChild(up);

      // nav
      var actions = el('div', { class: 'et-actions' });
      actions.appendChild(el('span', { class: 'et-progress', text: ui.page + ' / 4' }));
      var nextBtn = el('button', { class: 'et-btn et-btn-primary', type: 'button', text: MSG.next });
      nextBtn.addEventListener('click', function () { onFirstNext([q1, q2, q3, q4]); });
      actions.appendChild(nextBtn);
      wrap.appendChild(actions);
      return wrap;
    }

    function buildFileRow(f) {
      var item = el('li', { class: 'et-upload-item' }, [el('span', { text: f.name })]);
      var rm = el('button', { type: 'button', text: '×' });
      rm.addEventListener('click', function () {
        var idx = ui.files.indexOf(f);
        if (idx !== -1) ui.files.splice(idx, 1);
        if (item.parentNode) item.parentNode.removeChild(item); // remove ONLY this row
      });
      item.appendChild(rm);
      return item;
    }

    function addFiles(fileList) {
      var existing = ui.files.map(function (f) { return f.name; });
      Array.prototype.forEach.call(fileList || [], function (file) {
        if (existing.indexOf(file.name) === -1) {
          var f = { file: file, name: file.name };
          ui.files.push(f);
          existing.push(file.name);
          if (ui.fileListEl) ui.fileListEl.appendChild(buildFileRow(f)); // append ONLY this row
        }
      });
    }

    function onFirstNext(qEls) {
      var fields = ['question1', 'question2', 'question3', 'question4'];
      var errs = state.firstPage.errors, ok = true;
      fields.forEach(function (field, i) {
        var invalid = !state.firstPage[field];
        if (invalid && errs.indexOf(field) === -1) errs.push(field);
        if (!invalid) clearErr(errs, field);
        setError(qEls[i], invalid, MSG.errorMessage);
        if (invalid) ok = false;
      });
      if (!ok) return;
      ui.page = 2; window.scrollTo(0, 0); render();
    }

    // ===================== STEP 2 =====================
    function shoeOptions() {
      // canonical (state) = de_CH text; display = MSG text. They share content
      // (config Text1..3 are identical across locales) but the split stays intact.
      return [
        { canonical: DE.secondPage.shoeText.text1, display: MSG.secondPage.shoeText.text1, url: imgUrl('question5', 'Image1') },
        { canonical: DE.secondPage.shoeText.text2, display: MSG.secondPage.shoeText.text2, url: imgUrl('question5', 'Image2') },
        { canonical: DE.secondPage.shoeText.text3, display: MSG.secondPage.shoeText.text3, url: imgUrl('question5', 'Image3') },
        { canonical: DE.secondPage.secondQuestion.followingShoeModels, display: MSG.secondPage.secondQuestion.followingShoeModels, url: '', isOther: true }
      ];
    }

    function renderSecond() {
      var wrap = el('div', { class: 'et-step is-active' });

      // Q3 - PR text (image cards, single select); option3 reveals extra input
      var q3 = el('div', { class: 'et-question' });
      q3.appendChild(el('span', { class: 'et-qlabel', html: '3. <b>' + MSG.secondPage.startPRText + '</b>' }));
      var prCanon = [DE.secondPage.firstQuestion.option1, DE.secondPage.firstQuestion.option2, DE.secondPage.firstQuestion.option3];
      var prDisp = [MSG.secondPage.firstQuestion.option1, MSG.secondPage.firstQuestion.option2, MSG.secondPage.firstQuestion.option3];
      var prImgs = ['Image1', 'Image2', 'Image3'];
      var cards3 = el('div', { class: 'et-cards' });

      // conditional extra built ONCE, only toggled hidden
      var q3ExtraField = el('div', { class: 'et-field' });
      q3ExtraField.appendChild(el('span', { class: 'et-field-label', text: MSG.secondPage.sendDetailsText }));
      var q3ExtraIn = el('input', { class: 'et-input', type: 'text', value: state.secondPage.question1Extra });
      q3ExtraIn.addEventListener('input', function () { state.secondPage.question1Extra = q3ExtraIn.value; clearErr(state.secondPage.errors, 'question1Extra'); setError(q3, false); });
      q3ExtraField.appendChild(q3ExtraIn);
      q3ExtraField.hidden = !ui.showQ3Extra;

      prCanon.forEach(function (canonical, idx) {
        var cd = card(prDisp[idx], imgUrl('question3', prImgs[idx]), state.secondPage.question1 === canonical, function () {
          if (state.secondPage.question1 === canonical) {
            state.secondPage.question1 = '';
            cd.classList.remove('is-selected');
            if (idx === 2) { ui.showQ3Extra = false; q3ExtraField.hidden = true; }
          } else {
            state.secondPage.question1 = canonical;
            singleSelect(cards3, cd);
            ui.showQ3Extra = (idx === 2);
            q3ExtraField.hidden = !ui.showQ3Extra;
          }
          clearErr(state.secondPage.errors, 'question1');
          setError(q3, false);
        });
        cards3.appendChild(cd);
      });
      q3.appendChild(cards3);
      q3.appendChild(q3ExtraField);
      wrap.appendChild(q3);

      // Q4 - shoe models (image cards, multi select max 2) + "other" reveals extra
      var q4 = el('div', { class: 'et-question' });
      q4.appendChild(el('span', { class: 'et-qlabel', html: '4. <b>' + MSG.secondPage.additionalElementsText + '</b>' }));
      q4.appendChild(el('span', { class: 'et-qnote', text: MSG.secondPage.chooseMaxImages }));
      var counter4 = el('span', { class: 'et-qnote', text: state.secondPage.question2.length + '/' + MAX_SHOES });
      q4.appendChild(counter4);
      var cards4 = el('div', { class: 'et-cards' });

      var q4ExtraField = el('div', { class: 'et-field' });
      q4ExtraField.appendChild(el('span', { class: 'et-field-label', text: MSG.secondPage.shoeModelName }));
      var q4ExtraIn = el('input', { class: 'et-input', type: 'text', value: state.secondPage.question2Extra });
      q4ExtraIn.addEventListener('input', function () { state.secondPage.question2Extra = q4ExtraIn.value; clearErr(state.secondPage.errors, 'question2Extra'); setError(q4, false); });
      q4ExtraField.appendChild(q4ExtraIn);
      q4ExtraField.hidden = !ui.showShoeExtra2;

      shoeOptions().forEach(function (opt) {
        var sel = state.secondPage.question2.indexOf(opt.canonical) !== -1;
        var cd = card(opt.display, opt.url, sel, function () {
          var arr = state.secondPage.question2;
          var i = arr.indexOf(opt.canonical);
          if (i !== -1) {
            arr.splice(i, 1);
            cd.classList.remove('is-selected');
            if (opt.isOther) { ui.showShoeExtra2 = false; q4ExtraField.hidden = true; }
          } else if (arr.length < MAX_SHOES) {
            arr.push(opt.canonical);
            cd.classList.add('is-selected');
            if (opt.isOther) { ui.showShoeExtra2 = true; q4ExtraField.hidden = false; }
          }
          counter4.textContent = state.secondPage.question2.length + '/' + MAX_SHOES;
          clearErr(state.secondPage.errors, 'question2');
          setError(q4, false);
        });
        cards4.appendChild(cd);
      });
      q4.appendChild(cards4);
      q4.appendChild(q4ExtraField);
      wrap.appendChild(q4);

      var actions = el('div', { class: 'et-actions' });
      var backBtn = el('button', { class: 'et-btn et-btn-back', type: 'button', text: MSG.back });
      backBtn.addEventListener('click', function () { ui.page = 1; window.scrollTo(0, 0); render(); });
      actions.appendChild(backBtn);
      actions.appendChild(el('span', { class: 'et-progress', text: ui.page + ' / 4' }));
      var nextBtn = el('button', { class: 'et-btn et-btn-primary', type: 'button', text: MSG.next });
      nextBtn.addEventListener('click', function () { onSecondNext(q3, q4); });
      actions.appendChild(nextBtn);
      wrap.appendChild(actions);
      return wrap;
    }

    function onSecondNext(q3, q4) {
      var sp = state.secondPage, errs = sp.errors, ok = true;

      var q1Bad = !sp.question1;
      if (q1Bad && errs.indexOf('question1') === -1) errs.push('question1'); else if (!q1Bad) clearErr(errs, 'question1');
      var q1eBad = !sp.question1Extra && ui.showQ3Extra;
      if (q1eBad && errs.indexOf('question1Extra') === -1) errs.unshift('question1Extra'); else if (!q1eBad) clearErr(errs, 'question1Extra');
      setError(q3, q1Bad || q1eBad, MSG.errorMessage);
      if (q1Bad || q1eBad) ok = false;

      var q2Bad = emptyArr(sp.question2);
      if (q2Bad && errs.indexOf('question2') === -1) errs.push('question2'); else if (!q2Bad) clearErr(errs, 'question2');
      var q2eBad = !sp.question2Extra && ui.showShoeExtra2;
      if (q2eBad && errs.indexOf('question2Extra') === -1) errs.unshift('question2Extra'); else if (!q2eBad) clearErr(errs, 'question2Extra');
      setError(q4, q2Bad || q2eBad, MSG.errorMessage);
      if (q2Bad || q2eBad) ok = false;

      if (!ok) return;
      ui.page = 3; window.scrollTo(0, 0); render();
    }

    // ===================== STEP 3 =====================
    // yes/no single-select chips. canonical = de_CH yes/no; display = MSG yes/no.
    function yesNo(field, label, imgQ, qRef) {
      var wrap = el('div', { class: 'et-question' });
      wrap.appendChild(el('span', { class: 'et-qlabel', html: label }));
      if (imgQ) {
        var u = imgUrl(imgQ, 'Image1');
        if (u) wrap.appendChild(el('img', { class: 'et-header-img', src: u, alt: '', loading: 'lazy', style: 'max-width:700px;' }));
      }
      var opts = el('div', { class: 'et-options' });
      ['yes', 'no'].forEach(function (key) {
        var canonical = DE.thirdPage[key];
        var chip = el('div', { class: 'et-chip' + (state.thirdPage[field] === canonical ? ' is-selected' : ''), text: MSG.thirdPage[key] });
        chip.addEventListener('click', function () {
          state.thirdPage[field] = canonical;
          clearErr(state.thirdPage.errors, field);
          singleSelect(opts, chip);
          setError(wrap, false);
        });
        opts.appendChild(chip);
      });
      wrap.appendChild(opts);
      qRef[field] = wrap;
      return wrap;
    }

    function renderThird() {
      var wrap = el('div', { class: 'et-step is-active' });
      var qRef = {}; // field -> question wrapper, for in-place error updates

      // Q5 - design variants (image only; thirdPage.question1 stays 'default choice')
      var q5 = el('div', { class: 'et-question' });
      q5.appendChild(el('span', { class: 'et-qlabel', html: '5. <b>' + MSG.thirdPage.designVariants + '</b>' }));
      var u5 = imgUrl('question8', 'Image1');
      if (u5) q5.appendChild(el('img', { class: 'et-header-img', src: u5, alt: '', loading: 'lazy', style: 'max-width:510px;' }));
      wrap.appendChild(q5);

      // Q6 - current season models (image cards, multi select max 2)
      var q6 = el('div', { class: 'et-question' });
      qRef.question2 = q6;
      q6.appendChild(el('span', { class: 'et-qlabel', html: '6. <b>' + MSG.thirdPage.currentSeasonModels + '</b>' }));
      var counter6 = el('span', { class: 'et-qnote', text: state.thirdPage.question2.length + '/' + MAX_SHOES });
      q6.appendChild(counter6);
      var cards6 = el('div', { class: 'et-cards' });

      var q6ExtraField = el('div', { class: 'et-field' });
      qRef.question2Extra = q6ExtraField;
      q6ExtraField.appendChild(el('span', { class: 'et-field-label', text: MSG.thirdPage.suggestAnotherModel }));
      var q6ExtraIn = el('input', { class: 'et-input', type: 'text', value: state.thirdPage.question2Extra });
      q6ExtraIn.addEventListener('input', function () { state.thirdPage.question2Extra = q6ExtraIn.value; clearErr(state.thirdPage.errors, 'question2Extra'); setError(q6ExtraField, false); });
      q6ExtraField.appendChild(q6ExtraIn);
      q6ExtraField.hidden = !ui.showShoeExtra3;

      shoeOptions().forEach(function (opt) {
        var sel = state.thirdPage.question2.indexOf(opt.canonical) !== -1;
        var cd = card(opt.display, opt.url, sel, function () {
          var arr = state.thirdPage.question2;
          var i = arr.indexOf(opt.canonical);
          if (i !== -1) {
            arr.splice(i, 1);
            cd.classList.remove('is-selected');
            if (opt.isOther) { ui.showShoeExtra3 = false; q6ExtraField.hidden = true; }
          } else if (arr.length < MAX_SHOES) {
            arr.push(opt.canonical);
            cd.classList.add('is-selected');
            if (opt.isOther) { ui.showShoeExtra3 = true; q6ExtraField.hidden = false; }
          }
          counter6.textContent = state.thirdPage.question2.length + '/' + MAX_SHOES;
          clearErr(state.thirdPage.errors, 'question2');
          setError(q6, false);
        });
        cards6.appendChild(cd);
      });
      q6.appendChild(cards6);
      q6.appendChild(q6ExtraField);
      wrap.appendChild(q6);

      // Q7 - ad format (width -> question3, height -> question4)
      var q7w = el('div', { class: 'et-question' });
      qRef.question3 = q7w;
      q7w.appendChild(el('span', { class: 'et-qlabel', html: '7. <b>' + MSG.thirdPage.adFormatRequest + '</b>' }));
      q7w.appendChild(el('span', { class: 'et-qnote', text: MSG.thirdPage.adFormatInfo }));
      var wF = el('div', { class: 'et-field' });
      wF.appendChild(el('span', { class: 'et-field-label', text: MSG.thirdPage.widthInMM }));
      var wIn = el('input', { class: 'et-input', type: 'number', value: state.thirdPage.question3 });
      wIn.addEventListener('input', function () { state.thirdPage.question3 = wIn.value; clearErr(state.thirdPage.errors, 'question3'); setError(q7w, false); });
      wF.appendChild(wIn);
      q7w.appendChild(wF);
      wrap.appendChild(q7w);

      var q7h = el('div', { class: 'et-question' });
      qRef.question4 = q7h;
      var hF = el('div', { class: 'et-field' });
      hF.appendChild(el('span', { class: 'et-field-label', text: MSG.thirdPage.heightInMM }));
      var hIn = el('input', { class: 'et-input', type: 'number', value: state.thirdPage.question4 });
      hIn.addEventListener('input', function () { state.thirdPage.question4 = hIn.value; clearErr(state.thirdPage.errors, 'question4'); setError(q7h, false); });
      hF.appendChild(hIn);
      q7h.appendChild(hF);
      wrap.appendChild(q7h);

      wrap.appendChild(el('p', { style: 'font-size:1.25rem;font-weight:700;margin:2rem 0 1.5rem;', text: MSG.thirdPage.additionalMarketingMaterials }));

      // Q8 flyer -> question5 ; Q9 poster -> question6 ; Q10 social -> question8 ; Q11 google -> question9
      wrap.appendChild(yesNo('question5', '8. ' + MSG.thirdPage.flyerTemplateLabel, 'question8', qRef));
      wrap.appendChild(yesNo('question6', '9. ' + MSG.thirdPage.posterTemplateLabel, 'question9', qRef));
      wrap.appendChild(yesNo('question8', '10. ' + MSG.thirdPage.socialMediaGraphicLabel, 'question10', qRef));
      wrap.appendChild(yesNo('question9', '11. ' + MSG.thirdPage.googleBusinessGraphicLabel, 'question11', qRef));

      // Q12 comments -> question10
      var q12 = el('div', { class: 'et-question' });
      q12.appendChild(el('span', { class: 'et-qlabel', html: '12. <b>' + MSG.thirdPage.commentSection + '</b>' }));
      var ta = el('textarea', { class: 'et-textarea', rows: '4' });
      ta.value = state.thirdPage.question10;
      ta.addEventListener('input', function () { state.thirdPage.question10 = ta.value; });
      q12.appendChild(ta);
      wrap.appendChild(q12);

      var actions = el('div', { class: 'et-actions' });
      var backBtn = el('button', { class: 'et-btn et-btn-back', type: 'button', text: MSG.back });
      backBtn.addEventListener('click', function () { ui.page = 2; window.scrollTo(0, 0); render(); });
      actions.appendChild(backBtn);
      actions.appendChild(el('span', { class: 'et-progress', text: ui.page + ' / 4' }));
      var submitBtn = el('button', { class: 'et-btn et-btn-primary', type: 'button', text: MSG.thirdPage.submit });
      submitBtn.addEventListener('click', function () { onSubmit(qRef); });
      actions.appendChild(submitBtn);
      wrap.appendChild(actions);
      return wrap;
    }

    function onSubmit(qRef) {
      var errs = validateThirdPage(state, ui.showShoeExtra3);
      state.thirdPage.errors = errs;
      // update error nodes IN PLACE (don't rebuild the step)
      ['question2', 'question3', 'question4', 'question5', 'question6', 'question8', 'question9', 'question2Extra'].forEach(function (field) {
        if (qRef[field]) setError(qRef[field], errs.indexOf(field) !== -1, MSG.errorMessage);
      });
      if (errs.length) {
        var firstEl = qRef[errs[0]];
        if (firstEl && firstEl.scrollIntoView) firstEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      submit();
    }

    function submit() {
      // sync uploaded file names into the description shape; keep File objects for multipart
      state.uploadedFiles = ui.files.map(function (f) { return { name: f.name }; });
      var description = buildDescription(state, cfg);
      var form = new FormData();
      ui.files.forEach(function (f, i) { form.append('attachments[' + i + ']', f.file, f.name); });
      form.append('data', JSON.stringify({ data: { formName: 'joya-formular', description: description } }));
      fetch(cfg.endpoint, { method: 'POST', body: form, credentials: 'same-origin' })
        .then(function (res) {
          if (!res.ok) throw new Error('submit failed: ' + res.status);
          state = initialState();
          ui = { page: 4, showQ3Extra: false, showShoeExtra2: false, showShoeExtra3: false, files: [], fileListEl: null };
          render();
        })
        .catch(function (e) { console.error(e); });
    }

    // ===================== THANK YOU =====================
    function renderThankYou() {
      var wrap = el('div', { class: 'et-step is-active' });
      wrap.appendChild(el('div', { class: 'et-thankyou' }, [
        el('h2', { text: MSG.forthPage.youMadeIt }),
        el('p', { text: MSG.forthPage.successMessageFirst }),
        el('p', { text: MSG.forthPage.successMessageSecond }),
        el('p', { class: 'et-progress', text: '4 / 4' })
      ]));
      return wrap;
    }

    // Full rebuild ONLY on page navigation.
    function render() {
      mount.innerHTML = '';
      if (ui.page === 1) mount.appendChild(renderFirst());
      else if (ui.page === 2) mount.appendChild(renderSecond());
      else if (ui.page === 3) mount.appendChild(renderThird());
      else mount.appendChild(renderThankYou());
    }

    render();
  }

  return {
    STR: STR,
    initialState: initialState,
    validateThirdPage: validateThirdPage,
    buildDescription: buildDescription,
    boot: boot
  };
});
