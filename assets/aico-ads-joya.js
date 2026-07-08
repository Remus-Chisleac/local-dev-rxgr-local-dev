/*
 * Ads / joya multi-step form (formName: joya-form).
 * Self-contained port of the legacy b2b-shop src/pages/ads/joya.
 *
 * Submits a multipart POST to {{ routes.aico_forms_url }} with attachments[i] and
 * data = {data:{formName:'joya-form', description:<state object>}}, where the state
 * object is the live form state with the `errors` arrays stripped from firstPage and
 * secondPage (mirrors the old SecondPage handleFormSubmit noErrorsFormState). No
 * userEmail/userAddress is sent — this is a "joya" raw-object form.
 *
 * Localisation contract (mirrors events/kybun-joya):
 *   - `DE` (STR.de_CH) is CANONICAL: every option VALUE stored in state — and so the
 *     submitted `description` — is the de_CH string, regardless of display language.
 *   - `t` (STR[dispLang]) drives DISPLAYED text only: option labels, field labels,
 *     and validation error MESSAGES follow the active UI language.
 *
 * Rendering: the step is built ONCE per page. In-page interactions (selecting a
 * chip/card, revealing an extra input, adding/removing a file, showing/clearing
 * validation errors) mutate the DOM in place and NEVER rebuild the step. A full
 * rebuild happens only on page navigation (Next / Back / thank-you).
 *
 * initialState()/validate*()/buildDescription() are exported when run under Node so
 * the checks and the submitted shape can be unit-tested without a browser.
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
      errorMessage: 'Dieses Feld ist erforderlich.',
      minimumDaysErrorMessage: 'Mindestens 5 Werktage Vorlaufzeit notwendig',
      back: 'Zurück', next: 'Weiter',
      infoText: {
        firstPart: 'Durch Ausfüllen des folgenden Formulars, kannst du dir deine nächste Joya Print-Werbeanzeige zusammenstellen. Jeder Schritt bzw. jede Gestaltungsoption wird ausführlich erklärt.',
        secondPart: 'Alle mit einem Sternchen * markierten Angaben sind Pflichtangaben.',
        thirdPart: 'Ohne diese kann das Formular nicht abgesendet werden.',
        forthPart: 'Bei Fragen wende dich bitte an ',
        mail: 'marketing@kybunjoya.swiss'
      },
      firstPage: {
        adPublishDate: { boldPart: 'Wann muss die Werbeanzeige bei deiner Zeitung eingereicht werden? *', note: '(mindestens 5 Werktage Vorlaufzeit notwendig)' },
        marketingDeptLogo: { boldPart: 'Hat die Joya Marketingabteilung dein Geschäftslogo schon in hochauflösender Form? *' },
        logoAvailable: 'Ja, ist schon vorhanden',
        logoNotAvailable: 'Nein, bisher noch nicht',
        uploadHighResLogo: 'Bitte hochauflösendes Logo hier hochladen',
        imageUploadError: 'Die Bildabmessungen sind zu groß. Die maximal zulässigen Abmessungen betragen 2000x1800.',
        dropFilesOr: 'Dateien hier ablegen oder',
        browse: 'Browse'
      },
      secondPage: {
        firstQuestion: { option1: 'a. Klassischer PR-Text', option2: 'b. Interview Experte', option3: 'c. Interview Händler/in' },
        secondQuestion: { option1: 'Close up Damen', option2: 'Close up Herren', option3: 'Joya entlastet sofort', option4: 'Folgende(s) Schuhmodell(e)' },
        PRTextWish: 'Wähle einen PR-Text *',
        textChangeWish: 'Bitte sende uns für diesen Fall Namen und Portrait der Person, die genannt werden soll, sowie deine Textänderungswünsche *',
        importantElements: 'Welche Schuhmodelle sollen, wenn möglich, im Textteil angezeigt werden? *',
        shoeModelName: '* Name des/r Schuhmodells/e',
        chooseMaxImages: 'Es sind maximal zwei Bilder von A-Ansichten möglich, sowie ein Portrait des Interview-Partners bei den Interview-Texten',
        adDesignVariant: 'Wähle die Gestaltungsvariante für deine Anzeige *',
        modelsOfSeason: 'Welche Modelle der aktuellen Saison sollen abgebildet werden? *',
        modelsOfSeasonNumber1: '(Ein Modell wählbar)',
        modelsOfSeasonNumber2: '(Bis zu zwei Modelle wählbar)',
        exactAdFormat: 'Bitte gib das genaue Format der Anzeige an. Erst nach Erhalt der exakten Maße kann mit der Erstellung deiner Werbeanzeige begonnen werden. *',
        widthInMM: 'Breite in mm',
        heightInMM: 'Höhe in mm',
        commentArea: 'Bereich für Kommentare & Anmerkungen',
        youMadeIt: 'Du hast es geschafft!',
        successMessageFirst: 'Die Angaben deiner Buchung werden nun an usere Marketingabteilung übermittelt.',
        successMessageSecond: 'Wir werden uns in Kürze mit einem Entwurf bei dir melden.',
        successMessageThird: 'Weiteres Werbematerial findest du auf der Marketing Plattform unter',
        downloadLink: 'Download-Bereich',
        submit: 'Absenden',
        close: 'Schliessen'
      }
    },
    en: {
      errorMessage: 'This field is required.',
      minimumDaysErrorMessage: 'Minimum lead time of 5 business days required',
      back: 'Back', next: 'Next',
      infoText: {
        firstPart: 'By filling out the following form, you can put together your next Joya print ad. Each step or design option is explained in detail.',
        secondPart: 'All details marked with a star * are mandatory.',
        thirdPart: 'The form cannot be sent without this information.',
        forthPart: 'If you have any questions, please contact ',
        mail: 'marketing@kybunjoya.swiss'
      },
      firstPage: {
        adPublishDate: { boldPart: 'When must the advertisement be submitted to your newspaper? *', note: '(Minimum lead time of 5 business days required)' },
        marketingDeptLogo: { boldPart: 'Does the Joya Marketing Department already have your business logo in high resolution? *' },
        logoAvailable: 'Yes, already exists',
        logoNotAvailable: 'No, not yet',
        uploadHighResLogo: 'Please upload your high-resolution logo here',
        imageUploadError: 'Image dimensions are too large. Maximum allowed dimensions are 2000x1800.',
        dropFilesOr: 'Drop files here or',
        browse: 'Browse'
      },
      secondPage: {
        firstQuestion: { option1: 'a. Classic PR Text', option2: 'b. Expert interview', option3: 'c. Interview retailer' },
        secondQuestion: { option1: 'Close up Women', option2: 'Close up Men', option3: 'Joya provides immediate relief', option4: 'Following shoe model(s)' },
        PRTextWish: 'Choose a PR text *',
        textChangeWish: 'Please send us the name and portrait of the person to be mentioned, as well as your text modification requests for this case. *',
        importantElements: 'Which shoe models should be displayed in the text section? *',
        shoeModelName: '* Shoe model name',
        chooseMaxImages: 'A maximum of two pictures of A-views are possible, as well as a portrait of the interview partner in the interview texts.',
        adDesignVariant: 'Choose the design variant for your advertisement *',
        modelsOfSeason: 'Which models of the current season should be shown? *',
        modelsOfSeasonNumber1: '(One model can be selected)',
        modelsOfSeasonNumber2: '(Up to two models can be selected)',
        exactAdFormat: 'Please specify the exact format of the ad. We can only start creating your advertisement once we have received the exact dimensions. *',
        widthInMM: 'Width in mm',
        heightInMM: 'Height in mm',
        commentArea: 'Area for comments & notes',
        youMadeIt: 'You have made it!',
        successMessageFirst: 'The details of your booking will now be sent to our marketing department.',
        successMessageSecond: 'We will get back to you shortly with a draft.',
        successMessageThird: 'You can find additional advertising materials on the marketing platform under',
        downloadLink: 'Download-Center',
        submit: 'Submit',
        close: 'Close'
      }
    }
  };

  // q-models (state secondPage.question5 / UI "season models") allows max 2.
  var MAX_MODELS = 2;
  // canonical de_CH "no logo" / "yes logo" values (stored in state regardless of locale)
  var Q2_YES = STR.de_CH.firstPage.logoAvailable;     // 'Ja, ist schon vorhanden'
  var Q2_NO = STR.de_CH.firstPage.logoNotAvailable;   // 'Nein, bisher noch nicht'

  function blank(v) { return v == null || (typeof v === 'string' && v.trim() === ''); }
  function emptyArr(v) { return !Array.isArray(v) || v.length === 0; }

  // EXACT FormContext.initialFormState
  function initialState() {
    return {
      uploadedFiles: [],
      firstPage: { question1: '', question2: null, errors: [] },
      secondPage: {
        question1: '',
        question1Extra: '',
        question2: [],
        question2Extra: '',
        question3: '',
        question4: 'question removed (ignore)',
        question5: [],
        question6: '',
        question7: '',
        question8: '',
        errors: []
      }
    };
  }

  // ---- working-days rule (mirror isAtLeastFiveWorkingDaysAway) ----
  function fiveWorkingDaysAway(dateStr, now) {
    var d = new Date(dateStr); if (isNaN(d.getTime())) return false;
    var c = new Date((now || new Date()).getTime()); c.setHours(0, 0, 0, 0);
    var target = new Date(d.getTime()); target.setHours(0, 0, 0, 0);
    var added = 0;
    while (added < 5) { c.setDate(c.getDate() + 1); var w = c.getDay(); if (w !== 0 && w !== 6) added++; }
    return target.getTime() >= c.getTime();
  }

  // ---- page 1 validation (mirrors FirstPage handleNextPageClick) ----
  // Returns {fieldErrors:{}, fiveDays:bool}. Value comparisons use the de_CH canonical.
  function validateFirstPage(state) {
    var fp = state.firstPage, fe = {}, fiveDays = false;
    if (!fp.question1) fe.question1 = true;
    else if (!fiveWorkingDaysAway(fp.question1)) fiveDays = true;
    if (!fp.question2) fe.question2 = true;
    // upload mandatory only when "no logo" (de_CH canonical) was chosen
    if (fp.question2 === Q2_NO && emptyArr(state.uploadedFiles)) fe.uploadFiles = true;
    return { fieldErrors: fe, fiveDays: fiveDays };
  }

  // ---- page 2 validation (mirrors SecondPage handleErrors) ----
  // required: question1, question2, question3, question5, question6, question7
  // conditional: question1Extra (when option3 of question1 picked),
  //              question2Extra (when "other shoe model" picked)
  function validateSecondPage(state, opts) {
    var sp = state.secondPage, e = {};
    ['question1', 'question2', 'question3', 'question5', 'question6', 'question7'].forEach(function (f) {
      var v = sp[f];
      var invalidArr = Array.isArray(v) && v.length === 0;
      var invalidVal = !v;
      if (invalidArr || invalidVal) e[f] = true;
    });
    if (blank(sp.question2Extra) && opts && opts.showSecondQuestionInput) e.question2Extra = true;
    if (blank(sp.question1Extra) && opts && opts.showFirstQuestionInput) e.question1Extra = true;
    return e;
  }

  // ---- description payload (mirror handleFormSubmit noErrorsFormState) ----
  function buildDescription(state) {
    var fp = state.firstPage, sp = state.secondPage;
    return {
      uploadedFiles: state.uploadedFiles,
      firstPage: { question1: fp.question1, question2: fp.question2 },
      secondPage: {
        question1: sp.question1,
        question1Extra: sp.question1Extra,
        question2: sp.question2,
        question2Extra: sp.question2Extra,
        question3: sp.question3,
        question4: sp.question4,
        question5: sp.question5,
        question6: sp.question6,
        question7: sp.question7,
        question8: sp.question8
      }
    };
  }

  // ====================================================================
  // browser rendering (self-contained, no framework)
  // ====================================================================
  var STORAGE_KEY = 'aico-eventtool-ads-joya';

  // shallow-merge a saved plain object over a fresh initialState (so newly-added
  // keys keep their defaults). uploadedFiles is always reset to [] (File objects
  // cannot be serialised) and the persisted `errors` arrays are dropped.
  function mergeSavedState(saved) {
    var base = initialState();
    if (!saved || typeof saved !== 'object') return base;
    if (saved.firstPage && typeof saved.firstPage === 'object') {
      ['question1', 'question2'].forEach(function (k) {
        if (k in saved.firstPage) base.firstPage[k] = saved.firstPage[k];
      });
    }
    if (saved.secondPage && typeof saved.secondPage === 'object') {
      ['question1', 'question1Extra', 'question2', 'question2Extra', 'question3',
       'question4', 'question5', 'question6', 'question7', 'question8'].forEach(function (k) {
        if (k in saved.secondPage) base.secondPage[k] = saved.secondPage[k];
      });
    }
    base.uploadedFiles = []; // never restored
    return base;
  }

  // Resolve the display language. These German-market kj forms DEFAULT to German;
  // only an explicit non-default English locale yields English. The storefront's
  // technical default 'en_US' (prefix-less, the shop default) must NOT count as English.
  //   - lowercased starts with 'de'        -> 'de_CH'
  //   - empty OR exactly 'en_us'           -> 'de_CH'  (technical default)
  //   - any other 'en*' (e.g. 'en', 'en_gb') -> 'en'
  //   - default                            -> 'de_CH'
  function resolveDispLang(locale) {
    var l = String(locale == null ? '' : locale).toLowerCase().trim();
    if (l.indexOf('de') === 0) return 'de_CH';
    if (l === '' || l === 'en_us') return 'de_CH';
    if (l.indexOf('en') === 0) return 'en';
    return 'de_CH';
  }

  var LAST_INPUT_PAGE = 2;

  // read the persisted draft → { state, maxStep } (or null if nothing/invalid saved).
  function readSaved() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      var maxStep = parseInt(parsed && parsed.maxStep, 10);
      if (!isFinite(maxStep) || maxStep < 1) maxStep = 1;
      if (maxStep > LAST_INPUT_PAGE) maxStep = LAST_INPUT_PAGE;
      return { state: mergeSavedState(parsed), maxStep: maxStep };
    } catch (e) { return null; }
  }

  // requested page from ?step=<n>, clamped to 1..LAST_INPUT_PAGE (thank-you not restored).
  function readStepFromUrl() {
    try {
      var v = new URLSearchParams(window.location.search).get('step');
      var n = parseInt(v, 10);
      if (!isFinite(n) || n < 1) return 1;
      return n > LAST_INPUT_PAGE ? LAST_INPUT_PAGE : n;
    } catch (e) { return 1; }
  }

  function boot() {
    var root = document.querySelector('[data-aico-eventtool="ads-joya"]');
    if (!root) return;
    var cfgEl = document.getElementById('aico-eventtool-config');
    var cfg = {};
    try { cfg = JSON.parse(cfgEl.textContent); } catch (e) { return; }
    var dispLang = resolveDispLang(cfg.locale);
    var form = new AdsJoyaForm(root, cfg, dispLang);
    var saved = readSaved();
    if (saved) { form.state = saved.state; form.maxStep = saved.maxStep; }
    // can't jump ahead via ?step without having reached that step before.
    var requested = readStepFromUrl();
    var target = Math.min(requested, form.maxStep);
    if (target < 1) target = 1;
    if (target > LAST_INPUT_PAGE) target = LAST_INPUT_PAGE;
    // navigate so the resolved step is written back to the URL.
    form.goToPage(target);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function AdsJoyaForm(root, cfg, dispLang) {
    this.root = root;
    this.cfg = cfg;
    this.images = cfg.images || {};
    this.DE = STR.de_CH;          // canonical (state values + comparisons)
    this.t = STR[dispLang];       // displayed text (labels + error messages)
    this.dispLang = dispLang;
    this.state = initialState();
    this.page = 1;
    this.maxStep = 1; // furthest input page reached; gates ?step jump-ahead
    this.mount = root.querySelector('[data-et-mount]') || root;
    // "other shoe model" / "PR text option 3" reveal flags (mirror showFirst/SecondQuestionInput)
    this.showFirstQuestionInput = false;
    this.showSecondQuestionInput = false;
    // config-driven option text for q-design-variant + q-models (each has de_CH + en maps)
    var qj = (cfg.optionText || {});
    this.q5Text = qj.question5 || {};   // design-variant texts
    this.q6Text = qj.question6 || {};   // 4 model texts
    // index (0-based) of the design variant that only fits ONE season model; -1 = none.
    // Selecting it caps Q6 (season models) to 1 and clears any already-picked models,
    // mirroring the b2b "Medical Fersensporn mit FOREVERFOAM" enforceMaxOne behaviour.
    this.singleModelDesignIndex = (typeof cfg.singleModelDesignIndex === 'number') ? cfg.singleModelDesignIndex : -1;
    var q5DE = this.q5Text.de_CH || this.q5Text.en || {};
    this.singleModelValue = (this.singleModelDesignIndex >= 0)
      ? (q5DE['Text' + (this.singleModelDesignIndex + 1)] || null)
      : null;
    // whether the currently-selected design caps season models to 1 (derived in syncRevealFlags)
    this.enforceMaxOne = false;
  }

  // persist the in-progress answers (excluding uploadedFiles + errors) to localStorage.
  AdsJoyaForm.prototype.persist = function () {
    try {
      var s = this.state, fp = s.firstPage, sp = s.secondPage;
      var snapshot = {
        maxStep: this.maxStep,
        firstPage: { question1: fp.question1, question2: fp.question2 },
        secondPage: {
          question1: sp.question1, question1Extra: sp.question1Extra,
          question2: sp.question2, question2Extra: sp.question2Extra,
          question3: sp.question3, question4: sp.question4,
          question5: sp.question5, question6: sp.question6,
          question7: sp.question7, question8: sp.question8
        }
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch (e) { /* storage unavailable / quota — ignore */ }
  };

  AdsJoyaForm.prototype.clearPersisted = function () {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  };

  // derive the conditional-reveal flags from current state so a restored form
  // re-shows the right "extra" inputs.
  AdsJoyaForm.prototype.syncRevealFlags = function () {
    var sp = this.state.secondPage;
    this.showFirstQuestionInput = (sp.question1 === this.DE.secondPage.firstQuestion.option3);
    this.showSecondQuestionInput = (sp.question2 || []).indexOf(this.DE.secondPage.secondQuestion.option4) !== -1;
    this.enforceMaxOne = (this.singleModelValue != null && sp.question3 === this.singleModelValue);
  };

  // navigate between input pages; mirror the page in ?step=<n>.
  AdsJoyaForm.prototype.goToPage = function (n) {
    this.page = n;
    try {
      var url = new URL(window.location.href);
      url.searchParams.set('step', String(n));
      window.history.replaceState(null, '', url.toString());
    } catch (e) { /* ignore */ }
    this.render();
  };

  AdsJoyaForm.prototype.render = function () {
    this.syncRevealFlags();
    this.mount.innerHTML = '';
    if (this.page === 1) this.renderFirstPage();
    else if (this.page === 2) this.renderSecondPage();
    else this.renderThankYou();
    window.scrollTo(0, 0);
  };

  // ---------- PAGE 1 ----------
  AdsJoyaForm.prototype.renderFirstPage = function () {
    var t = this.t, self = this, st = this.state;
    var step = el('div', 'et-step is-active');

    var info = el('div', 'et-info');
    info.appendChild(el('p', null, t.infoText.firstPart));
    info.appendChild(el('p', null, t.infoText.secondPart));
    info.appendChild(el('p', null, t.infoText.thirdPart));
    var pMail = el('p');
    pMail.appendChild(document.createTextNode(t.infoText.forthPart));
    var a = el('a', null, t.infoText.mail); a.href = 'mailto:' + t.infoText.mail;
    pMail.appendChild(a);
    info.appendChild(pMail);
    step.appendChild(info);

    // Q1 date
    var q1 = el('div', 'et-question');
    var q1l = el('div', 'et-qlabel'); q1l.appendChild(document.createTextNode('1. '));
    q1l.appendChild(el('strong', null, t.firstPage.adPublishDate.boldPart));
    q1.appendChild(q1l);
    q1.appendChild(el('span', 'et-qnote', t.firstPage.adPublishDate.note));
    var dateField = el('div', 'et-field');
    var dateInput = el('input', 'et-input'); dateInput.type = 'date';
    dateInput.value = st.firstPage.question1;
    dateInput.addEventListener('change', function () { st.firstPage.question1 = this.value; self.persist(); self.clearErr(q1); });
    dateField.appendChild(dateInput);
    q1.appendChild(dateField);
    step.appendChild(q1);

    // Q2 logo radios — display label = active locale, stored value = de_CH canonical
    var q2 = el('div', 'et-question');
    var q2l = el('div', 'et-qlabel'); q2l.appendChild(document.createTextNode('2. '));
    q2l.appendChild(el('strong', null, t.firstPage.marketingDeptLogo.boldPart));
    q2.appendChild(q2l);
    var opts = el('div', 'et-options');
    var yes = el('div', 'et-chip', t.firstPage.logoAvailable);
    var no = el('div', 'et-chip', t.firstPage.logoNotAvailable);
    function syncRadio() {
      yes.classList.toggle('is-selected', st.firstPage.question2 === Q2_YES);
      no.classList.toggle('is-selected', st.firstPage.question2 === Q2_NO);
    }
    yes.addEventListener('click', function () { st.firstPage.question2 = Q2_YES; self.persist(); syncRadio(); self.clearErr(q2); self.clearErr(upWrap); });
    no.addEventListener('click', function () { st.firstPage.question2 = Q2_NO; self.persist(); syncRadio(); self.clearErr(q2); });
    syncRadio();
    opts.appendChild(yes); opts.appendChild(no);
    q2.appendChild(opts);
    step.appendChild(q2);

    // Upload — file rows appended/removed in place
    var upWrap = el('div', 'et-question');
    upWrap.appendChild(el('div', 'et-qlabel', t.firstPage.uploadHighResLogo));
    var up = el('div', 'et-upload');
    var zone = el('div', 'et-upload-zone');
    var zp = el('p');
    zp.appendChild(document.createTextNode(t.firstPage.dropFilesOr + ' '));
    var browse = el('span', null, t.firstPage.browse); browse.style.textDecoration = 'underline';
    zp.appendChild(browse);
    zone.appendChild(zp);
    var fileInput = el('input'); fileInput.type = 'file'; fileInput.multiple = true; fileInput.style.display = 'none';
    var list = el('ul', 'et-upload-list');
    function appendFileRow(fileObj) {
      var li = el('li', 'et-upload-item');
      li.appendChild(el('span', null, fileObj.name));
      var del = el('button'); del.type = 'button'; del.textContent = '×';
      del.addEventListener('click', function () {
        var i = st.uploadedFiles.indexOf(fileObj);
        if (i !== -1) st.uploadedFiles.splice(i, 1);
        if (li.parentNode) li.parentNode.removeChild(li);
      });
      li.appendChild(del);
      list.appendChild(li);
    }
    function addFiles(files) {
      var names = st.uploadedFiles.map(function (f) { return f.name; });
      Array.prototype.forEach.call(files, function (file) {
        if (names.indexOf(file.name) === -1) {
          var fileObj = { file: file, name: file.name };
          st.uploadedFiles.push(fileObj);
          names.push(file.name);
          appendFileRow(fileObj);
        }
      });
      self.clearErr(upWrap);
    }
    zone.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () { addFiles(this.files); this.value = ''; });
    zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('is-dragover'); });
    zone.addEventListener('dragleave', function () { zone.classList.remove('is-dragover'); });
    zone.addEventListener('drop', function (e) { e.preventDefault(); zone.classList.remove('is-dragover'); if (e.dataTransfer) addFiles(e.dataTransfer.files); });
    up.appendChild(zone); up.appendChild(fileInput); up.appendChild(list);
    upWrap.appendChild(up);
    st.uploadedFiles.forEach(appendFileRow);
    step.appendChild(upWrap);

    // actions
    var actions = el('div', 'et-actions');
    actions.appendChild(el('span', 'et-progress', '1 / 2'));
    var nextBtn = el('button', 'et-btn et-btn-primary', t.next); nextBtn.type = 'button';
    nextBtn.addEventListener('click', function () {
      self.clearErr(q1); self.clearErr(q2); self.clearErr(upWrap);
      var res = validateFirstPage(st);
      var fe = res.fieldErrors;
      var ok = true;
      if (fe.question1) { self.showErr(q1, t.errorMessage); ok = false; }
      else if (res.fiveDays) { self.showErr(q1, t.minimumDaysErrorMessage); ok = false; }
      if (fe.question2) { self.showErr(q2, t.errorMessage); ok = false; }
      if (fe.uploadFiles) { self.showErr(upWrap, t.errorMessage); ok = false; }
      if (ok) {
        self.maxStep = Math.max(self.maxStep, 2); // record furthest reached; Back never lowers it
        self.persist();                            // save the bumped maxStep
        self.goToPage(2);
      }
    });
    actions.appendChild(nextBtn);
    step.appendChild(actions);

    this.mount.appendChild(step);
  };

  // ---------- PAGE 2 ----------
  AdsJoyaForm.prototype.renderSecondPage = function () {
    var t = this.t, DE = this.DE, self = this, sp = this.state.secondPage, loc = this.dispLang;
    var step = el('div', 'et-step is-active');

    // --- Q3 (state question1): choose a PR text — 3 image cards, single select ---
    // value = de_CH canonical; label = active locale.
    var qPR = el('div', 'et-question');
    var qPRl = el('div', 'et-qlabel'); qPRl.appendChild(document.createTextNode('3. '));
    qPRl.appendChild(el('strong', null, t.secondPage.PRTextWish));
    qPR.appendChild(qPRl);
    var prChoices = [
      { value: DE.secondPage.firstQuestion.option1, label: t.secondPage.firstQuestion.option1 },
      { value: DE.secondPage.firstQuestion.option2, label: t.secondPage.firstQuestion.option2 },
      { value: DE.secondPage.firstQuestion.option3, label: t.secondPage.firstQuestion.option3 }
    ];
    var prImgs = this.images.question3 || [];
    var prCards = el('div', 'et-cards');
    // PR-text "extra" input — render ONCE, toggle hidden on selection.
    var extraField = el('div', 'et-field');
    extraField.appendChild(el('label', 'et-field-label', t.secondPage.textChangeWish));
    var extraInput = el('input', 'et-input'); extraInput.type = 'text'; extraInput.value = sp.question1Extra || '';
    extraInput.addEventListener('input', function () { sp.question1Extra = this.value; self.persist(); self.clearErr(extraField); });
    extraField.appendChild(extraInput);
    function syncExtra() { extraField.hidden = !self.showFirstQuestionInput; if (extraField.hidden) self.clearErr(extraField); }
    prChoices.forEach(function (opt, idx) {
      var card = el('div', 'et-card');
      if (prImgs[idx]) { var im = el('img', 'et-card-img'); im.src = prImgs[idx]; im.alt = opt.label; card.appendChild(im); }
      card.appendChild(el('div', 'et-card-title', opt.label));
      card.classList.toggle('is-selected', sp.question1 === opt.value);
      card.addEventListener('click', function () {
        if (sp.question1 === opt.value) { sp.question1 = ''; self.showFirstQuestionInput = false; }
        else { sp.question1 = opt.value; self.showFirstQuestionInput = (idx === 2); }
        Array.prototype.forEach.call(prCards.children, function (c, ci) {
          c.classList.toggle('is-selected', sp.question1 === prChoices[ci].value);
        });
        self.persist();
        syncExtra();
        self.clearErr(qPR);
      });
      prCards.appendChild(card);
    });
    qPR.appendChild(prCards);
    qPR.appendChild(extraField);
    syncExtra();
    step.appendChild(qPR);

    // --- Q4 (state question2): shoe models in text section ---
    // LIVE Sandalen picker (b2b brandId 6). Product NAME lands in sp.question2.
    // The "Folgende/other shoe model" card (de_CH canonical) reveals the extra name input.
    // Cap is config-driven (cfg.maxSelectable.shoes), default 2 (the b2b cap).
    var Q2_MAX = (this.cfg.maxSelectable && this.cfg.maxSelectable.shoes) || 2;
    var qModels = el('div', 'et-question');
    var qMl = el('div', 'et-qlabel'); qMl.appendChild(document.createTextNode('4. '));
    qMl.appendChild(el('strong', null, t.secondPage.importantElements));
    // live counter (n / max incl. the "other" sentinel) — floats right via .et-qcount
    var modelCount = el('span', 'et-qcount');
    qMl.appendChild(modelCount);
    function syncModelCount() { modelCount.textContent = sp.question2.length + ' / ' + Q2_MAX; }
    qModels.appendChild(qMl);
    qModels.appendChild(el('span', 'et-qnote', t.secondPage.chooseMaxImages));
    var otherValue = DE.secondPage.secondQuestion.option4; // 'Folgende(s) Schuhmodell(e)'
    var modelCards = el('div', 'et-cards');
    var modelLoading = el('div', 'et-info'); modelLoading.textContent = '…';
    qModels.appendChild(modelLoading);
    qModels.appendChild(modelCards);
    // "other shoe model" name input — render ONCE, toggle hidden.
    var m2Field = el('div', 'et-field');
    m2Field.appendChild(el('label', 'et-field-label', t.secondPage.shoeModelName));
    var m2Input = el('input', 'et-input'); m2Input.type = 'text'; m2Input.value = sp.question2Extra || '';
    m2Input.addEventListener('input', function () { sp.question2Extra = this.value; self.persist(); self.clearErr(m2Field); });
    m2Field.appendChild(m2Input);
    function syncM2() { m2Field.hidden = !self.showSecondQuestionInput; if (m2Field.hidden) self.clearErr(m2Field); }
    qModels.appendChild(m2Field);
    syncM2();
    syncModelCount();
    step.appendChild(qModels);

    // toggles a value in sp.question2 (shared Q2_MAX across products + "other"); in place
    function toggleModel(value, card, isOther) {
      var i = sp.question2.indexOf(value);
      if (i !== -1) {
        sp.question2.splice(i, 1);
        card.classList.remove('is-selected');
        if (isOther) { self.showSecondQuestionInput = false; syncM2(); }
      } else if (sp.question2.length < Q2_MAX) {
        sp.question2.push(value);
        card.classList.add('is-selected');
        if (isOther) { self.showSecondQuestionInput = true; syncM2(); }
      }
      self.persist();
      syncModelCount();
      self.clearErr(qModels);
    }
    function addModelCard(value, label, imageUrl, isOther) {
      var card = el('div', 'et-card');
      if (imageUrl) { var im = el('img', 'et-card-img'); im.src = imageUrl; im.alt = label; card.appendChild(im); }
      card.appendChild(el('div', 'et-card-title', label));
      card.classList.toggle('is-selected', sp.question2.indexOf(value) !== -1);
      card.addEventListener('click', function () { toggleModel(value, card, isOther); });
      modelCards.appendChild(card);
    }
    // the "other shoe model" card is always available (no image); add it up front.
    function addOtherCard() { addModelCard(otherValue, t.secondPage.secondQuestion.option4, null, true); }
    // fetch live joya products, then render their cards before the "other" card.
    this.fetchProducts(function (products, err) {
      if (modelLoading.parentNode) modelLoading.parentNode.removeChild(modelLoading);
      (products || []).forEach(function (p) {
        if (p && p.name) addModelCard(p.name, p.name, p.image, false);
      });
      addOtherCard();
    });

    // --- Q5 (state question3): design variant — image cards, single select ---
    // value = de_CH text from config; label = active-locale text from config.
    // forward-declared: re-applies the season-model cap (note text + card selection)
    // when the design selection changes it. Assigned when Q6 is built below.
    var applySeasonCap = null;
    var qDesign = el('div', 'et-question');
    var qDl = el('div', 'et-qlabel'); qDl.appendChild(document.createTextNode('5. '));
    qDl.appendChild(el('strong', null, t.secondPage.adDesignVariant));
    qDesign.appendChild(qDl);
    var designImgs = this.images.question5 || [];
    var designDE = this.q5Text.de_CH || this.q5Text.en || {};
    var designDisp = this.q5Text[loc] || this.q5Text.en || this.q5Text.de_CH || {};
    var designCards = el('div', 'et-cards');
    var dCount = designImgs.length || Object.keys(designDE).filter(function (k) { return /^Text\d+$/.test(k); }).length;
    var designVals = [];
    for (var di = 0; di < dCount; di++) {
      (function (idx) {
        var value = designDE['Text' + (idx + 1)] || ('Option ' + (idx + 1));
        var label = designDisp['Text' + (idx + 1)] || value;
        designVals[idx] = value;
        var card = el('div', 'et-card');
        if (designImgs[idx]) { var im = el('img', 'et-card-img'); im.src = designImgs[idx]; im.alt = label; card.appendChild(im); }
        card.appendChild(el('div', 'et-card-title', label));
        card.classList.toggle('is-selected', sp.question3 === value);
        card.addEventListener('click', function () {
          var selecting = (sp.question3 !== value);
          sp.question3 = selecting ? value : '';
          // the single-model design caps Q6 to 1 and drops any already-picked models
          self.enforceMaxOne = (selecting && idx === self.singleModelDesignIndex);
          if (self.enforceMaxOne) sp.question5 = [];
          Array.prototype.forEach.call(designCards.children, function (c, ci) {
            c.classList.toggle('is-selected', sp.question3 === designVals[ci]);
          });
          if (applySeasonCap) applySeasonCap();
          self.persist();
          self.clearErr(qDesign);
        });
        designCards.appendChild(card);
      })(di);
    }
    qDesign.appendChild(designCards);
    step.appendChild(qDesign);

    // --- Q6 (state question5): season models — q6 cards, multi up to 2 ---
    // image1 exists; options 2-4 are text-only. Cap drops to 1 when the design
    // variant flagged singleModelDesignIndex is selected (self.enforceMaxOne).
    var qSeason = el('div', 'et-question');
    var qSl = el('div', 'et-qlabel'); qSl.appendChild(document.createTextNode('6. '));
    qSl.appendChild(el('strong', null, t.secondPage.modelsOfSeason));
    qSeason.appendChild(qSl);
    var seasonNote = el('span', 'et-qnote', t.secondPage.modelsOfSeasonNumber2);
    qSeason.appendChild(seasonNote);
    var seasonImgs = this.images.question6 || []; // only image1 present
    var seasonDE = this.q6Text.de_CH || this.q6Text.en || {};
    var seasonDisp = this.q6Text[loc] || this.q6Text.en || this.q6Text.de_CH || {};
    var sCount = Object.keys(seasonDE).filter(function (k) { return /^Text\d+$/.test(k); }).length || 4;
    var seasonCards = el('div', 'et-cards');
    var seasonVals = [];
    for (var si = 0; si < sCount; si++) {
      (function (idx) {
        var value = seasonDE['Text' + (idx + 1)] || ('Option ' + (idx + 1));
        var label = seasonDisp['Text' + (idx + 1)] || value;
        seasonVals[idx] = value;
        var card = el('div', 'et-card');
        if (seasonImgs[idx]) { var im = el('img', 'et-card-img'); im.src = seasonImgs[idx]; im.alt = label; card.appendChild(im); }
        card.appendChild(el('div', 'et-card-title', label));
        card.classList.toggle('is-selected', sp.question5.indexOf(value) !== -1);
        card.addEventListener('click', function () {
          var i = sp.question5.indexOf(value);
          var cap = self.enforceMaxOne ? 1 : MAX_MODELS;
          if (i !== -1) { sp.question5.splice(i, 1); card.classList.remove('is-selected'); }
          else if (sp.question5.length < cap) { sp.question5.push(value); card.classList.add('is-selected'); }
          self.persist();
          self.clearErr(qSeason);
        });
        seasonCards.appendChild(card);
      })(si);
    }
    qSeason.appendChild(seasonCards);
    step.appendChild(qSeason);

    // re-apply the season cap after a design change: swap the note text and resync
    // each card's selected state from sp.question5 (design change may have cleared it).
    applySeasonCap = function () {
      seasonNote.textContent = self.enforceMaxOne ? t.secondPage.modelsOfSeasonNumber1 : t.secondPage.modelsOfSeasonNumber2;
      Array.prototype.forEach.call(seasonCards.children, function (c, ci) {
        c.classList.toggle('is-selected', sp.question5.indexOf(seasonVals[ci]) !== -1);
      });
    };
    applySeasonCap(); // set the initial note per the restored enforceMaxOne

    // --- Q7 (state question6 width / question7 height): exact ad format ---
    var qFormat = el('div', 'et-question');
    var qFl = el('div', 'et-qlabel'); qFl.appendChild(document.createTextNode('7. '));
    qFl.appendChild(el('strong', null, t.secondPage.exactAdFormat));
    qFormat.appendChild(qFl);
    var wField = el('div', 'et-field');
    wField.appendChild(el('label', 'et-field-label', t.secondPage.widthInMM));
    var wInput = el('input', 'et-input'); wInput.type = 'number'; wInput.value = sp.question6 || '';
    wInput.addEventListener('input', function () { sp.question6 = this.value; self.persist(); self.clearErr(wField); });
    wField.appendChild(wInput);
    qFormat.appendChild(wField);
    var hField = el('div', 'et-field');
    hField.appendChild(el('label', 'et-field-label', t.secondPage.heightInMM));
    var hInput = el('input', 'et-input'); hInput.type = 'number'; hInput.value = sp.question7 || '';
    hInput.addEventListener('input', function () { sp.question7 = this.value; self.persist(); self.clearErr(hField); });
    hField.appendChild(hInput);
    qFormat.appendChild(hField);
    step.appendChild(qFormat);

    // --- Q8 (state question8): comments textarea (not required) ---
    var qComment = el('div', 'et-question');
    var qCl = el('div', 'et-qlabel'); qCl.appendChild(document.createTextNode('8. '));
    qCl.appendChild(el('strong', null, t.secondPage.commentArea));
    qComment.appendChild(qCl);
    var ta = el('textarea', 'et-textarea'); ta.rows = 4; ta.value = sp.question8 || '';
    ta.addEventListener('input', function () { sp.question8 = this.value; self.persist(); });
    qComment.appendChild(ta);
    step.appendChild(qComment);

    // --- actions: same bar at TOP (last input page) and BOTTOM; same handlers ---
    var submitBtns = []; // every Submit button across both bars (disabled together in flight)

    function onBack() { self.goToPage(1); }
    function onSubmit(clickedBtn) {
      var map = { question1: qPR, question2: qModels, question3: qDesign, question5: qSeason, question6: qFormat, question7: qFormat, question1Extra: extraField, question2Extra: m2Field };
      // clear in place: remove only the error nodes attached to validated containers
      Object.keys(map).forEach(function (k) { self.clearErr(map[k]); });
      var e = validateSecondPage(self.state, { showFirstQuestionInput: self.showFirstQuestionInput, showSecondQuestionInput: self.showSecondQuestionInput });
      var keys = Object.keys(e);
      if (keys.length) {
        keys.forEach(function (k) { if (map[k]) self.showErr(map[k], t.errorMessage); });
        return;
      }
      self.submit(clickedBtn, submitBtns);
    }
    function makeActions() {
      var actions = el('div', 'et-actions');
      var backBtn = el('button', 'et-btn et-btn-back', t.back); backBtn.type = 'button';
      backBtn.addEventListener('click', onBack);
      actions.appendChild(backBtn);
      actions.appendChild(el('span', 'et-progress', '2 / 2'));
      var submitBtn = el('button', 'et-btn et-btn-primary', t.secondPage.submit); submitBtn.type = 'button';
      submitBtn.addEventListener('click', function () { onSubmit(submitBtn); });
      actions.appendChild(submitBtn);
      submitBtns.push(submitBtn);
      return actions;
    }

    // TOP bar (every input page except page 1 → here, the last input page)
    step.insertBefore(makeActions(), step.firstChild);
    // BOTTOM bar (all input pages)
    step.appendChild(makeActions());

    this.mount.appendChild(step);
  };

  // ---------- live products (Sandalen, b2b brandId 6 → brand=joya) ----------
  // Caches the result so re-entering page 2 doesn't refetch. cb(products, err).
  AdsJoyaForm.prototype.fetchProducts = function (cb) {
    var self = this;
    if (this._products) { cb(this._products, null); return; }
    var base = this.cfg.productsUrl;
    if (!base) { this._products = []; cb([], null); return; }
    var url = base + (base.indexOf('?') === -1 ? '?' : '&') +
      'brand=joya&locale=' + encodeURIComponent(this.dispLang);
    fetch(url, { method: 'GET', credentials: 'same-origin' })
      .then(function (res) { if (!res.ok) throw new Error('Products fetch failed: ' + res.status); return res.json(); })
      .then(function (json) {
        self._products = (json && Array.isArray(json.products)) ? json.products : [];
        cb(self._products, null);
      })
      .catch(function (err) {
        // eslint-disable-next-line no-console
        console.error(err);
        self._products = [];
        cb([], err);
      });
  };

  // ---------- THANK YOU ----------
  AdsJoyaForm.prototype.renderThankYou = function () {
    var t = this.t;
    var step = el('div', 'et-step is-active');
    var ty = el('div', 'et-thankyou');
    ty.appendChild(el('h2', null, t.secondPage.youMadeIt));
    ty.appendChild(el('p', null, t.secondPage.successMessageFirst));
    ty.appendChild(el('p', null, t.secondPage.successMessageSecond));
    step.appendChild(ty);
    this.mount.appendChild(step);
  };

  // ---------- error helpers (in-place) ----------
  AdsJoyaForm.prototype.showErr = function (container, msg) {
    this.clearErr(container);
    container.appendChild(el('span', 'et-error', msg));
  };
  AdsJoyaForm.prototype.clearErr = function (container) {
    var errs = container.querySelectorAll(':scope > .et-error');
    Array.prototype.forEach.call(errs, function (n) { n.parentNode.removeChild(n); });
  };

  // ---------- submit ----------
  // btn = the clicked Submit button (spinner shown on it); allBtns = every Submit
  // button on the page (top + bottom bars) — ALL get disabled while in flight.
  AdsJoyaForm.prototype.submit = function (btn, allBtns) {
    var self = this;
    var buttons = allBtns && allBtns.length ? allBtns : (btn ? [btn] : []);
    var form = new FormData();
    this.state.uploadedFiles.forEach(function (fileObj, index) {
      if (fileObj && fileObj.file) form.append('attachments[' + index + ']', fileObj.file, fileObj.name);
    });
    form.append('data', JSON.stringify({ data: { formName: 'joya-form', description: buildDescription(this.state) } }));

    // disable ALL submit buttons; show .et-spinner + .is-loading on the clicked one.
    var spinner = null;
    buttons.forEach(function (b) { b.disabled = true; });
    if (btn) {
      btn.classList.add('is-loading');
      spinner = el('span', 'et-spinner');
      btn.insertBefore(spinner, btn.firstChild);
    }
    function restoreBtn() {
      buttons.forEach(function (b) { b.disabled = false; });
      if (btn) btn.classList.remove('is-loading');
      if (spinner && spinner.parentNode) spinner.parentNode.removeChild(spinner);
    }

    fetch(this.cfg.endpoint, { method: 'POST', body: form, credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) throw new Error('Form submit failed: ' + res.status);
        restoreBtn();
        self.clearPersisted();           // drop saved draft (incl. maxStep) on success
        self.state = initialState();
        self.maxStep = 1;                // reset the step guard for a fresh form
        self.showFirstQuestionInput = false;
        self.showSecondQuestionInput = false;
        // reset ?step to 1 so a reload after success lands on a clean page 1.
        try {
          var u = new URL(window.location.href);
          u.searchParams.set('step', '1');
          window.history.replaceState(null, '', u.toString());
        } catch (e) { /* ignore */ }
        self.page = 3;
        self.render();
      })
      .catch(function (err) {
        // eslint-disable-next-line no-console
        console.error(err);
        restoreBtn();
      });
  };

  return {
    STR: STR,
    initialState: initialState,
    validateFirstPage: validateFirstPage,
    validateSecondPage: validateSecondPage,
    buildDescription: buildDescription,
    fiveWorkingDaysAway: fiveWorkingDaysAway,
    resolveDispLang: resolveDispLang,
    boot: boot
  };
});
