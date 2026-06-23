/*
 * Events / Joya multi-step form (formName: joya-formular).
 * Self-contained vanilla-JS port of the legacy b2b-shop src/pages/events/joya.
 *
 * UNLIKE the kybun-joya form, the joya form submits the RAW STATE OBJECT as the
 * `description` (not a text blob). The submitted object keeps EXACTLY the same
 * structure as the legacy FormContext.initialFormState — including the per-page
 * `errors` arrays and the top-level userEmail / userAddress fields.
 *
 * Multipart POST to cfg.endpoint ({{ routes.aico_forms_url }}):
 *   attachments[0..n] = each uploaded File,
 *   data = JSON.stringify({ data: { formName: 'joya-formular', description: <state> } }).
 * Auth = storefront session cookie -> credentials:'same-origin'.
 *
 * Strings inlined (de_CH + en) so the form is self-contained; the template
 * supplies the active locale, resolved image URLs, endpoint and the logged-in
 * user's email / address via the JSON config block.
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

  function blank(v) { return v == null || (typeof v === 'string' && v.trim() === ''); }
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
    delete s.__ui;
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
    var T = STR[cfg.locale === 'en' ? 'en' : 'de_CH'];
    var images = cfg.images || {};

    var state = initialState();
    // UI-only flags (not part of the submitted description)
    var ui = { page: 1, showQ3Extra: false, showShoeExtra2: false, showShoeExtra3: false, files: [] };

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
    function err(msg) { return el('span', { class: 'et-error', text: msg }); }

    function clearErr(arr, field) {
      var i = arr.indexOf(field);
      if (i !== -1) arr.splice(i, 1);
    }

    // image-card option (single or multi select)
    function card(title, url, selected, onClick) {
      var c = el('div', { class: 'et-card' + (selected ? ' is-selected' : ''), onclick: onClick }, [
        url ? el('img', { class: 'et-card-img', src: url, alt: title, loading: 'lazy' }) : null,
        el('div', { class: 'et-card-title', text: title })
      ]);
      return c;
    }

    function yesNo(field, page, value, label, imgQ) {
      var wrap = el('div', { class: 'et-question' });
      wrap.appendChild(el('span', { class: 'et-qlabel', text: label }));
      if (imgQ) {
        var u = imgUrl(imgQ, 'Image1');
        if (u) wrap.appendChild(el('img', { class: 'et-header-img', src: u, alt: label, loading: 'lazy', style: 'max-width:700px;' }));
      }
      var opts = el('div', { class: 'et-options' });
      [['yes', T.thirdPage.yes], ['no', T.thirdPage.no]].forEach(function (pair) {
        var lbl = pair[1];
        var chip = el('div', { class: 'et-chip' + (state[page][field] === lbl ? ' is-selected' : '') }, [lbl]);
        chip.addEventListener('click', function () {
          state[page][field] = lbl;
          clearErr(state[page].errors, field);
          render();
        });
        opts.appendChild(chip);
      });
      wrap.appendChild(opts);
      if (state[page].errors.indexOf(field) !== -1) wrap.appendChild(err(T.errorMessage));
      return wrap;
    }

    // ----- page renderers -----
    function renderFirst() {
      var wrap = el('div', { class: 'et-step is-active' });
      var info = el('div', { class: 'et-info' });
      info.appendChild(el('p', { text: T.infoText.firstPart }));
      info.appendChild(el('p', { text: T.infoText.secondPart }));
      info.appendChild(el('p', { text: T.infoText.thirdPart }));
      var contact = el('p', {}, [T.infoText.forthPart, el('a', { href: 'mailto:' + T.infoText.mail, text: T.infoText.mail })]);
      info.appendChild(contact);
      wrap.appendChild(info);

      // Q1 - key data (date / start / end)
      var q1 = el('div', { class: 'et-question' });
      q1.appendChild(el('span', { class: 'et-qlabel', html: '1. <b>' + T.firstPage.startingInfo + '</b>' }));

      var dF = el('div', { class: 'et-field' });
      dF.appendChild(el('span', { class: 'et-field-label', text: T.firstPage.dateQuestion }));
      dF.appendChild(el('span', { class: 'et-qnote', text: T.firstPage.dateNote }));
      var dInput = el('input', { class: 'et-input', type: 'date', value: state.firstPage.question1 });
      dInput.addEventListener('input', function () { state.firstPage.question1 = dInput.value; clearErr(state.firstPage.errors, 'question1'); });
      dF.appendChild(dInput);
      q1.appendChild(dF);
      if (state.firstPage.errors.indexOf('question1') !== -1) q1.appendChild(err(T.errorMessage));

      var sF = el('div', { class: 'et-field' });
      sF.appendChild(el('span', { class: 'et-field-label', text: T.firstPage.startTimeQuestion }));
      var sInput = el('input', { class: 'et-input', type: 'time', value: state.firstPage.question2 });
      sInput.addEventListener('input', function () { state.firstPage.question2 = sInput.value; clearErr(state.firstPage.errors, 'question2'); });
      sF.appendChild(sInput);
      q1.appendChild(sF);
      if (state.firstPage.errors.indexOf('question2') !== -1) q1.appendChild(err(T.errorMessage));

      var eF = el('div', { class: 'et-field' });
      eF.appendChild(el('span', { class: 'et-field-label', text: T.firstPage.endTimeQuestion }));
      var eInput = el('input', { class: 'et-input', type: 'time', value: state.firstPage.question3 });
      eInput.addEventListener('input', function () { state.firstPage.question3 = eInput.value; clearErr(state.firstPage.errors, 'question3'); });
      eF.appendChild(eInput);
      q1.appendChild(eF);
      if (state.firstPage.errors.indexOf('question3') !== -1) q1.appendChild(err(T.errorMessage));
      wrap.appendChild(q1);

      // Q2 - logo available?
      var q2 = el('div', { class: 'et-question' });
      q2.appendChild(el('span', { class: 'et-qlabel', html: '2. <b>' + T.firstPage.logoQuestion + '</b>' }));
      var opts = el('div', { class: 'et-options' });
      [T.firstPage.logoYes, T.firstPage.logoNo].forEach(function (lbl) {
        var chip = el('div', { class: 'et-chip' + (state.firstPage.question4 === lbl ? ' is-selected' : '') }, [lbl]);
        chip.addEventListener('click', function () {
          state.firstPage.question4 = lbl;
          clearErr(state.firstPage.errors, 'question4');
          render();
        });
        opts.appendChild(chip);
      });
      q2.appendChild(opts);
      if (state.firstPage.errors.indexOf('question4') !== -1) q2.appendChild(err(T.errorMessage));
      wrap.appendChild(q2);

      // Upload zone
      var up = el('div', { class: 'et-question' });
      up.appendChild(el('span', { class: 'et-qlabel', text: T.firstPage.uploadLogo }));
      var zone = el('div', { class: 'et-upload' });
      var dz = el('div', { class: 'et-upload-zone' }, [
        el('p', {}, [T.firstPage.dropFilesOr + ' ', el('span', { style: 'text-decoration:underline;cursor:pointer', text: T.firstPage.browse })])
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
      ui.files.forEach(function (f, idx) {
        var item = el('li', { class: 'et-upload-item' }, [el('span', { text: f.name })]);
        var rm = el('button', { type: 'button', text: '×' });
        rm.addEventListener('click', function () { ui.files.splice(idx, 1); render(); });
        item.appendChild(rm);
        list.appendChild(item);
      });
      zone.appendChild(list);
      up.appendChild(zone);
      wrap.appendChild(up);

      // nav
      var actions = el('div', { class: 'et-actions' });
      actions.appendChild(el('span', { class: 'et-progress', text: ui.page + ' / 4' }));
      var nextBtn = el('button', { class: 'et-btn et-btn-primary', type: 'button', text: T.next });
      nextBtn.addEventListener('click', onFirstNext);
      actions.appendChild(nextBtn);
      wrap.appendChild(actions);
      return wrap;
    }

    function addFiles(fileList) {
      var existing = ui.files.map(function (f) { return f.name; });
      Array.prototype.forEach.call(fileList || [], function (file) {
        if (existing.indexOf(file.name) === -1) {
          ui.files.push({ file: file, name: file.name });
          existing.push(file.name);
        }
      });
      render();
    }

    function onFirstNext() {
      var errs = state.firstPage.errors;
      ['question1', 'question2', 'question3', 'question4'].forEach(function (field) {
        if (!state.firstPage[field] && errs.indexOf(field) === -1) errs.push(field);
      });
      if (errs.length) { render(); return; }
      ui.page = 2; window.scrollTo(0, 0); render();
    }

    function renderSecond() {
      var wrap = el('div', { class: 'et-step is-active' });

      // Q3 - PR text (image cards, single select); option3 reveals extra input
      var q3 = el('div', { class: 'et-question' });
      q3.appendChild(el('span', { class: 'et-qlabel', html: '3. <b>' + T.secondPage.startPRText + '</b>' }));
      var prOpts = [T.secondPage.firstQuestion.option1, T.secondPage.firstQuestion.option2, T.secondPage.firstQuestion.option3];
      var prImgs = ['Image1', 'Image2', 'Image3'];
      var cards3 = el('div', { class: 'et-cards' });
      prOpts.forEach(function (label, idx) {
        cards3.appendChild(card(label, imgUrl('question3', prImgs[idx]), state.secondPage.question1 === label, function () {
          if (state.secondPage.question1 === label) {
            state.secondPage.question1 = '';
            if (idx === 2) ui.showQ3Extra = false;
          } else {
            state.secondPage.question1 = label;
            ui.showQ3Extra = (idx === 2);
          }
          clearErr(state.secondPage.errors, 'question1');
          render();
        }));
      });
      q3.appendChild(cards3);
      if (state.secondPage.errors.indexOf('question1') !== -1) q3.appendChild(err(T.errorMessage));
      if (ui.showQ3Extra) {
        var exF = el('div', { class: 'et-field' });
        exF.appendChild(el('span', { class: 'et-field-label', text: T.secondPage.sendDetailsText }));
        var exIn = el('input', { class: 'et-input', type: 'text', value: state.secondPage.question1Extra });
        exIn.addEventListener('input', function () { state.secondPage.question1Extra = exIn.value; clearErr(state.secondPage.errors, 'question1Extra'); });
        exF.appendChild(exIn);
        q3.appendChild(exF);
        if (state.secondPage.errors.indexOf('question1Extra') !== -1) q3.appendChild(err(T.errorMessage));
      }
      wrap.appendChild(q3);

      // Q4 - shoe models (image cards, multi select max 2) + "other" reveals extra input
      var q4 = el('div', { class: 'et-question' });
      q4.appendChild(el('span', { class: 'et-qlabel', html: '4. <b>' + T.secondPage.additionalElementsText + '</b>' }));
      q4.appendChild(el('span', { class: 'et-qnote', text: T.secondPage.chooseMaxImages }));
      q4.appendChild(el('span', { class: 'et-qnote', text: state.secondPage.question2.length + '/' + MAX_SHOES }));
      var cards4 = el('div', { class: 'et-cards' });
      var shoeOpts = ['Image1', 'Image2', 'Image3'].map(function (k, i) {
        return { label: 'a. Laura dark red,b. Dynamo ZIP dark grey,c. Veloce STX pink'.split(',')[i], url: imgUrl('question5', k) };
      });
      shoeOpts.push({ label: T.secondPage.secondQuestion.followingShoeModels, url: '' });
      shoeOpts.forEach(function (opt) {
        var sel = state.secondPage.question2.indexOf(opt.label) !== -1;
        cards4.appendChild(card(opt.label, opt.url, sel, function () {
          var arr = state.secondPage.question2;
          var idx = arr.indexOf(opt.label);
          if (idx !== -1) {
            arr.splice(idx, 1);
            if (opt.label === T.secondPage.secondQuestion.followingShoeModels) ui.showShoeExtra2 = false;
          } else if (arr.length < MAX_SHOES) {
            arr.push(opt.label);
            if (opt.label === T.secondPage.secondQuestion.followingShoeModels) ui.showShoeExtra2 = true;
          }
          clearErr(state.secondPage.errors, 'question2');
          render();
        }));
      });
      q4.appendChild(cards4);
      if (state.secondPage.errors.indexOf('question2') !== -1) q4.appendChild(err(T.errorMessage));
      if (ui.showShoeExtra2) {
        var sF = el('div', { class: 'et-field' });
        sF.appendChild(el('span', { class: 'et-field-label', text: T.secondPage.shoeModelName }));
        var sIn = el('input', { class: 'et-input', type: 'text', value: state.secondPage.question2Extra });
        sIn.addEventListener('input', function () { state.secondPage.question2Extra = sIn.value; clearErr(state.secondPage.errors, 'question2Extra'); });
        sF.appendChild(sIn);
        q4.appendChild(sF);
        if (state.secondPage.errors.indexOf('question2Extra') !== -1) q4.appendChild(err(T.errorMessage));
      }
      wrap.appendChild(q4);

      var actions = el('div', { class: 'et-actions' });
      var backBtn = el('button', { class: 'et-btn et-btn-back', type: 'button', text: T.back });
      backBtn.addEventListener('click', function () { ui.page = 1; window.scrollTo(0, 0); render(); });
      actions.appendChild(backBtn);
      actions.appendChild(el('span', { class: 'et-progress', text: ui.page + ' / 4' }));
      var nextBtn = el('button', { class: 'et-btn et-btn-primary', type: 'button', text: T.next });
      nextBtn.addEventListener('click', onSecondNext);
      actions.appendChild(nextBtn);
      wrap.appendChild(actions);
      return wrap;
    }

    function onSecondNext() {
      var sp = state.secondPage, errs = sp.errors;
      if (!sp.question1 && errs.indexOf('question1') === -1) errs.push('question1');
      if (emptyArr(sp.question2) && errs.indexOf('question2') === -1) errs.push('question2');
      if (!sp.question2Extra && ui.showShoeExtra2 && errs.indexOf('question2Extra') === -1) errs.unshift('question2Extra');
      if (!sp.question1Extra && ui.showQ3Extra && errs.indexOf('question1Extra') === -1) errs.unshift('question1Extra');
      if (errs.length) { render(); return; }
      ui.page = 3; window.scrollTo(0, 0); render();
    }

    function renderThird() {
      var wrap = el('div', { class: 'et-step is-active' });

      // Q5 - design variants (image only; thirdPage.question1 stays 'default choice')
      var q5 = el('div', { class: 'et-question' });
      q5.appendChild(el('span', { class: 'et-qlabel', html: '5. <b>' + T.thirdPage.designVariants + '</b>' }));
      var u5 = imgUrl('question8', 'Image1');
      if (u5) q5.appendChild(el('img', { class: 'et-header-img', src: u5, alt: 'design', loading: 'lazy', style: 'max-width:510px;' }));
      wrap.appendChild(q5);

      // Q6 - current season models (image cards, multi select max 2)
      var q6 = el('div', { class: 'et-question' });
      q6.appendChild(el('span', { class: 'et-qlabel', html: '6. <b>' + T.thirdPage.currentSeasonModels + '</b>' }));
      q6.appendChild(el('span', { class: 'et-qnote', text: state.thirdPage.question2.length + '/' + MAX_SHOES }));
      var cards6 = el('div', { class: 'et-cards' });
      var shoeOpts = ['Image1', 'Image2', 'Image3'].map(function (k, i) {
        return { label: 'a. Laura dark red,b. Dynamo ZIP dark grey,c. Veloce STX pink'.split(',')[i], url: imgUrl('question5', k) };
      });
      shoeOpts.push({ label: T.secondPage.secondQuestion.followingShoeModels, url: '' });
      shoeOpts.forEach(function (opt) {
        var sel = state.thirdPage.question2.indexOf(opt.label) !== -1;
        cards6.appendChild(card(opt.label, opt.url, sel, function () {
          var arr = state.thirdPage.question2;
          var idx = arr.indexOf(opt.label);
          if (idx !== -1) {
            arr.splice(idx, 1);
            if (opt.label === T.secondPage.secondQuestion.followingShoeModels) ui.showShoeExtra3 = false;
          } else if (arr.length < MAX_SHOES) {
            arr.push(opt.label);
            if (opt.label === T.secondPage.secondQuestion.followingShoeModels) ui.showShoeExtra3 = true;
          }
          clearErr(state.thirdPage.errors, 'question2');
          render();
        }));
      });
      q6.appendChild(cards6);
      if (state.thirdPage.errors.indexOf('question2') !== -1) q6.appendChild(err(T.errorMessage));
      if (ui.showShoeExtra3) {
        var seF = el('div', { class: 'et-field' });
        seF.appendChild(el('span', { class: 'et-field-label', text: T.thirdPage.suggestAnotherModel }));
        var seIn = el('input', { class: 'et-input', type: 'text', value: state.thirdPage.question2Extra });
        seIn.addEventListener('input', function () { state.thirdPage.question2Extra = seIn.value; clearErr(state.thirdPage.errors, 'question2Extra'); });
        seF.appendChild(seIn);
        q6.appendChild(seF);
        if (state.thirdPage.errors.indexOf('question2Extra') !== -1) q6.appendChild(err(T.errorMessage));
      }
      wrap.appendChild(q6);

      // Q7 - ad format (width -> question3, height -> question4)
      var q7 = el('div', { class: 'et-question' });
      q7.appendChild(el('span', { class: 'et-qlabel', html: '7. <b>' + T.thirdPage.adFormatRequest + '</b>' }));
      q7.appendChild(el('span', { class: 'et-qnote', text: T.thirdPage.adFormatInfo }));
      var wF = el('div', { class: 'et-field' });
      wF.appendChild(el('span', { class: 'et-field-label', text: T.thirdPage.widthInMM }));
      var wIn = el('input', { class: 'et-input', type: 'number', value: state.thirdPage.question3 });
      wIn.addEventListener('input', function () { state.thirdPage.question3 = wIn.value; clearErr(state.thirdPage.errors, 'question3'); });
      wF.appendChild(wIn);
      q7.appendChild(wF);
      if (state.thirdPage.errors.indexOf('question3') !== -1) q7.appendChild(err(T.errorMessage));
      var hF = el('div', { class: 'et-field' });
      hF.appendChild(el('span', { class: 'et-field-label', text: T.thirdPage.heightInMM }));
      var hIn = el('input', { class: 'et-input', type: 'number', value: state.thirdPage.question4 });
      hIn.addEventListener('input', function () { state.thirdPage.question4 = hIn.value; clearErr(state.thirdPage.errors, 'question4'); });
      hF.appendChild(hIn);
      q7.appendChild(hF);
      if (state.thirdPage.errors.indexOf('question4') !== -1) q7.appendChild(err(T.errorMessage));
      wrap.appendChild(q7);

      // section header
      wrap.appendChild(el('p', { style: 'font-size:1.25rem;font-weight:700;margin:2rem 0 1.5rem;', text: T.thirdPage.additionalMarketingMaterials }));

      // Q8 flyer -> question5 ; Q9 poster -> question6 ; Q10 social -> question8 ; Q11 google -> question9
      wrap.appendChild(yesNo('question5', 'thirdPage', null, '8. ' + T.thirdPage.flyerTemplateLabel, 'question8'));
      wrap.appendChild(yesNo('question6', 'thirdPage', null, '9. ' + T.thirdPage.posterTemplateLabel, 'question9'));
      wrap.appendChild(yesNo('question8', 'thirdPage', null, '10. ' + T.thirdPage.socialMediaGraphicLabel, 'question10'));
      wrap.appendChild(yesNo('question9', 'thirdPage', null, '11. ' + T.thirdPage.googleBusinessGraphicLabel, 'question11'));

      // Q12 comments -> question10
      var q12 = el('div', { class: 'et-question' });
      q12.appendChild(el('span', { class: 'et-qlabel', html: '12. <b>' + T.thirdPage.commentSection + '</b>' }));
      var ta = el('textarea', { class: 'et-textarea', rows: '4' });
      ta.value = state.thirdPage.question10;
      ta.addEventListener('input', function () { state.thirdPage.question10 = ta.value; });
      q12.appendChild(ta);
      wrap.appendChild(q12);

      var actions = el('div', { class: 'et-actions' });
      var backBtn = el('button', { class: 'et-btn et-btn-back', type: 'button', text: T.back });
      backBtn.addEventListener('click', function () { ui.page = 2; window.scrollTo(0, 0); render(); });
      actions.appendChild(backBtn);
      actions.appendChild(el('span', { class: 'et-progress', text: ui.page + ' / 4' }));
      var submitBtn = el('button', { class: 'et-btn et-btn-primary', type: 'button', text: T.thirdPage.submit });
      submitBtn.addEventListener('click', onSubmit);
      actions.appendChild(submitBtn);
      wrap.appendChild(actions);
      return wrap;
    }

    function onSubmit() {
      var errs = validateThirdPage(state, ui.showShoeExtra3);
      state.thirdPage.errors = errs;
      if (errs.length) { render(); return; }
      submit();
    }

    function submit() {
      // sync uploaded files into the description shape (names only) + keep File objects for multipart
      state.uploadedFiles = ui.files.map(function (f) { return { name: f.name }; });
      var description = buildDescription(state, cfg);
      var form = new FormData();
      ui.files.forEach(function (f, i) { form.append('attachments[' + i + ']', f.file, f.name); });
      form.append('data', JSON.stringify({ data: { formName: 'joya-formular', description: description } }));
      fetch(cfg.endpoint, { method: 'POST', body: form, credentials: 'same-origin' })
        .then(function (res) {
          if (!res.ok) throw new Error('submit failed: ' + res.status);
          // reset + thank-you
          state = initialState();
          ui = { page: 4, showQ3Extra: false, showShoeExtra2: false, showShoeExtra3: false, files: [] };
          render();
        })
        .catch(function (e) { console.error(e); });
    }

    function renderThankYou() {
      var wrap = el('div', { class: 'et-step is-active' });
      var ty = el('div', { class: 'et-thankyou' }, [
        el('h2', { text: T.forthPage.youMadeIt }),
        el('p', { text: T.forthPage.successMessageFirst }),
        el('p', { text: T.forthPage.successMessageSecond }),
        el('p', { class: 'et-progress', text: '4 / 4' })
      ]);
      wrap.appendChild(ty);
      return wrap;
    }

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
