/**
 * preorder2 — header dock.
 *
 * On /preorder2 only: once the hero scrolls up behind the sticky site header the
 * preorder title fades in next to the brand logo, and once the filter row's
 * catalog tools scroll past, mirrored search / delivery-dates / size-type
 * controls fade in beside it.
 *
 * The real controls are NEVER moved. preorder2-page.js resolves its bindings with
 * live `root.querySelector(...)` calls, so reparenting a field out of
 * `[data-aico-preorder2]` would silently break it. Everything here is a MIRROR
 * that writes to the real control and dispatches the event preorder2-page.js
 * already listens for:
 *
 *   search      → set value + `input`   (its handler debounces catalog filtering)
 *   size type   → set value + `change`  (its handler re-renders + relabels the custom select)
 *   dates       → forward a click to the real option button — the real control is
 *                 a MULTI-select checkbox list whose native <select> is a stub, so
 *                 there is no value to mirror; the real handler owns the state.
 *
 * Nothing here duplicates catalog, cart or session logic — that all stays in the
 * page's own forked bundles (preorder2-page/catalog/cart/stock/confirmation.js).
 */
(function () {
  'use strict';

  function init() {
    var root = document.querySelector('[data-aico-preorder2]');
    var dock = document.querySelector('[data-aico-preorder2-dock]');
    if (!root || !dock) return;

    var headerRow = document.querySelector('.aico-header-row');
    var brandEl = document.querySelector('.aico-header-brand');
    var heroEl = root.querySelector('[data-aico-preorder2-hero]');
    var heroTitleEl = root.querySelector('[data-aico-preorder2-hero-title]');
    // NOT [data-aico-preorder2-catalog-tools] — that wrapper is `display: contents`,
    // so it has no box of its own and getBoundingClientRect() is permanently 0x0.
    // The filter BAR is the thing with real geometry, and "the selector row has
    // scrolled out of view" is exactly the threshold we want anyway.
    var filtersBarEl = root.querySelector('[data-aico-preorder2-filters-wrap]');

    var titleEl = dock.querySelector('[data-aico-preorder2-dock-title]');
    var spacerEl = dock.querySelector('[data-aico-preorder2-dock-spacer]');

    dock.hidden = false;

    /* ---------------------------------------------------------------- */
    /* Geometry — pin the dock over the sticky header row                */
    /* ---------------------------------------------------------------- */

    // The header row sits below a welcome strip that may or may not render, and
    // its height is responsive, so measure rather than hardcode an offset.
    function position() {
      if (!headerRow) return;
      var rect = headerRow.getBoundingClientRect();
      dock.style.top = Math.max(0, rect.top) + 'px';
      dock.style.height = rect.height + 'px';
      if (spacerEl && brandEl) {
        spacerEl.style.width = Math.round(brandEl.getBoundingClientRect().width) + 'px';
      }
    }

    /* ---------------------------------------------------------------- */
    /* Title mirror                                                     */
    /* ---------------------------------------------------------------- */

    // preorder2-page.js writes the hero title only once the session resolves, so
    // watch it rather than reading once at init.
    function syncTitle() {
      if (!titleEl || !heroTitleEl) return;
      var text = (heroTitleEl.textContent || '').trim();
      if (titleEl.textContent !== text) titleEl.textContent = text;
    }
    if (heroTitleEl && window.MutationObserver) {
      new MutationObserver(syncTitle).observe(heroTitleEl, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }
    syncTitle();

    /* ---------------------------------------------------------------- */
    /* Search mirror (two-way)                                          */
    /* ---------------------------------------------------------------- */

    var realSearch = root.querySelector('[data-aico-preorder2-search]');
    var dockSearch = dock.querySelector('[data-aico-preorder2-dock-search]');
    if (realSearch && dockSearch) {
      // Guard against the echo: writing one input fires the listener on the other.
      var searchSyncing = false;
      dockSearch.addEventListener('input', function () {
        if (searchSyncing) return;
        searchSyncing = true;
        realSearch.value = dockSearch.value;
        realSearch.dispatchEvent(new Event('input', { bubbles: true }));
        searchSyncing = false;
      });
      realSearch.addEventListener('input', function () {
        if (searchSyncing) return;
        searchSyncing = true;
        dockSearch.value = realSearch.value;
        searchSyncing = false;
      });
    }

    /* ---------------------------------------------------------------- */
    /* Dropdown plumbing shared by the two mirrored selects             */
    /* ---------------------------------------------------------------- */

    var openDropdown = null;

    // Set while a mirror row replays a click onto its real control: that click
    // bubbles to document, where the outside-click handler below would otherwise
    // close the dock dropdown mid-interaction.
    var forwardingClick = false;

    function forwardClick(realEl) {
      forwardingClick = true;
      try {
        realEl.click();
      } finally {
        forwardingClick = false;
      }
    }

    function closeOpenDropdown() {
      if (!openDropdown) return;
      openDropdown.panel.hidden = true;
      openDropdown.trigger.setAttribute('aria-expanded', 'false');
      openDropdown.wrap.classList.remove('is-open');
      openDropdown = null;
    }

    function bindDropdown(wrap, trigger, panel, onOpen) {
      if (!wrap || !trigger || !panel) return;
      trigger.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        var wasOpen = openDropdown && openDropdown.panel === panel;
        closeOpenDropdown();
        if (wasOpen) return;
        onOpen();
        panel.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        wrap.classList.add('is-open');
        openDropdown = { wrap: wrap, trigger: trigger, panel: panel };
      });
      panel.addEventListener('click', function (event) {
        event.stopPropagation();
      });
    }

    document.addEventListener('click', function () {
      if (forwardingClick) return;
      closeOpenDropdown();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeOpenDropdown();
    });

    /* ---------------------------------------------------------------- */
    /* Delivery dates mirror — clone rows, forward clicks               */
    /* ---------------------------------------------------------------- */

    var realDateSelect = root.querySelector('[data-aico-preorder2-date-select]');
    var realDateWrap = realDateSelect ? realDateSelect.closest('[data-aico-custom-select]') : null;
    var realDateList = realDateWrap ? realDateWrap.querySelector('[data-aico-custom-select-list]') : null;
    var realDateLabel = realDateWrap ? realDateWrap.querySelector('[data-aico-custom-select-label]') : null;

    var dateWrap = dock.querySelector('[data-aico-preorder2-dock-dates]');
    var dateTrigger = dock.querySelector('[data-aico-preorder2-dock-dates-trigger]');
    var dateLabel = dock.querySelector('[data-aico-preorder2-dock-dates-label]');
    var datePanel = dock.querySelector('[data-aico-preorder2-dock-dates-list]');

    function syncDateLabel() {
      if (!dateLabel || !realDateLabel) return;
      var text = (realDateLabel.textContent || '').trim();
      if (dateLabel.textContent !== text) dateLabel.textContent = text;
    }

    // Rebuild from the real list every time it opens: the real control re-renders
    // its rows whenever the delivery dates change, so a cached copy goes stale.
    function renderDateRows() {
      if (!datePanel || !realDateList) return;
      datePanel.innerHTML = '';
      realDateList.querySelectorAll('[data-date-value]').forEach(function (realBtn) {
        var row = document.createElement('button');
        row.type = 'button';
        row.className = 'aico-preorder2-dock-option';
        row.setAttribute('role', 'option');
        var checked = realBtn.classList.contains('is-checked');
        if (checked) row.classList.add('is-checked');
        row.setAttribute('aria-selected', checked ? 'true' : 'false');
        row.innerHTML =
          '<span class="aico-preorder2-dock-check" aria-hidden="true"></span><span></span>';
        row.lastChild.textContent = (realBtn.textContent || '').trim();
        row.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          // Let the REAL control own the multi-select state; just replay the click.
          forwardClick(realBtn);
          // Its handler re-renders the real rows synchronously, but the label is
          // updated in the same pass — re-read on the next frame to be safe.
          requestAnimationFrame(function () {
            renderDateRows();
            syncDateLabel();
          });
        });
        datePanel.appendChild(row);
      });
    }

    if (realDateLabel && window.MutationObserver) {
      new MutationObserver(syncDateLabel).observe(realDateLabel, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }
    syncDateLabel();
    bindDropdown(dateWrap, dateTrigger, datePanel, renderDateRows);

    /* ---------------------------------------------------------------- */
    /* Size type mirror — single select                                 */
    /* ---------------------------------------------------------------- */

    var realSize = root.querySelector('[data-aico-preorder2-select="size_region"]');
    var sizeWrap = dock.querySelector('[data-aico-preorder2-dock-size]');
    var sizeTrigger = dock.querySelector('[data-aico-preorder2-dock-size-trigger]');
    var sizeLabel = dock.querySelector('[data-aico-preorder2-dock-size-label]');
    var sizePanel = dock.querySelector('[data-aico-preorder2-dock-size-list]');

    function syncSizeLabel() {
      if (!sizeLabel || !realSize) return;
      var option = realSize.options[realSize.selectedIndex];
      var text = option ? (option.textContent || '').trim() : '';
      if (sizeLabel.textContent !== text) sizeLabel.textContent = text;
    }

    function renderSizeRows() {
      if (!sizePanel || !realSize) return;
      sizePanel.innerHTML = '';
      Array.prototype.forEach.call(realSize.options, function (option) {
        var row = document.createElement('button');
        row.type = 'button';
        row.className = 'aico-preorder2-dock-option';
        row.setAttribute('role', 'option');
        var checked = option.value === realSize.value;
        if (checked) row.classList.add('is-checked');
        row.setAttribute('aria-selected', checked ? 'true' : 'false');
        row.innerHTML =
          '<span class="aico-preorder2-dock-check" aria-hidden="true"></span><span></span>';
        row.lastChild.textContent = (option.textContent || '').trim();
        row.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          realSize.value = option.value;
          // `change` is what preorder2-page.js binds (persist + re-render) and what
          // relabels the real custom-select UI.
          realSize.dispatchEvent(new Event('change', { bubbles: true }));
          syncSizeLabel();
          closeOpenDropdown();
        });
        sizePanel.appendChild(row);
      });
    }

    if (realSize) realSize.addEventListener('change', syncSizeLabel);
    // `change` alone misses programmatic restores: preorder2-page.js re-applies the
    // stored size type at load by writing the native select's value directly and
    // relabeling its own custom-select UI — no event fires. The real label is
    // rewritten on every path (user or programmatic), so watch it like the dates
    // mirror does; syncSizeLabel still reads the native select as source of truth.
    var realSizeWrap = realSize ? realSize.closest('[data-aico-custom-select]') : null;
    var realSizeLabel = realSizeWrap
      ? realSizeWrap.querySelector('[data-aico-custom-select-label]')
      : null;
    if (realSizeLabel && window.MutationObserver) {
      new MutationObserver(syncSizeLabel).observe(realSizeLabel, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }
    syncSizeLabel();
    bindDropdown(sizeWrap, sizeTrigger, sizePanel, renderSizeRows);

    /* ---------------------------------------------------------------- */
    /* Display options mirror — gear                                    */
    /* ---------------------------------------------------------------- */

    var realDisplayField = root.querySelector('[data-aico-preorder2-display]');
    var realDisplayPanel = realDisplayField
      ? realDisplayField.querySelector('[data-aico-preorder2-display-panel]')
      : null;
    var realDisplayStrip = realDisplayField
      ? realDisplayField.querySelector('[data-aico-preorder2-display-strip]')
      : null;

    var displayWrap = dock.querySelector('[data-aico-preorder2-dock-display]');
    var displayTrigger = dock.querySelector('[data-aico-preorder2-dock-display-trigger]');
    var displayPanel = dock.querySelector('[data-aico-preorder2-dock-display-list]');

    // Rebuilt on every open (and after every row click) from the real panel, so
    // checked state and copy can never drift from what the filter bar shows.
    function renderDisplayRows() {
      if (!displayPanel || !realDisplayPanel) return;
      displayPanel.innerHTML = '';

      function addText(className, sourceEl) {
        if (!sourceEl) return;
        var p = document.createElement('p');
        p.className = className;
        p.textContent = (sourceEl.textContent || '').trim();
        displayPanel.appendChild(p);
      }

      // Rows forward clicks to the REAL inputs — page.js owns state, persistence
      // and applying the prefs to the catalog; `.click()` works while its panel
      // stays hidden.
      function addRow(realInput) {
        if (!realInput) return;
        var labelEl = realInput.closest('label');
        var row = document.createElement('button');
        row.type = 'button';
        row.className = 'aico-preorder2-dock-option';
        var checked = realInput.checked;
        if (checked) row.classList.add('is-checked');
        row.setAttribute('aria-pressed', checked ? 'true' : 'false');
        row.innerHTML =
          '<span class="aico-preorder2-dock-check" aria-hidden="true"></span><span></span>';
        row.lastChild.textContent = labelEl ? (labelEl.textContent || '').trim() : '';
        row.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          forwardClick(realInput);
          renderDisplayRows();
        });
        displayPanel.appendChild(row);
      }

      addText('aico-preorder2-dock-display-heading',
        realDisplayPanel.querySelector('.aico-preorder2-display-heading'));
      addRow(realDisplayStrip);
      addText('aico-preorder2-dock-display-group-label',
        realDisplayPanel.querySelector('.aico-preorder2-display-group-label'));
      realDisplayPanel
        .querySelectorAll('[data-aico-preorder2-display-sizes]')
        .forEach(addRow);
    }

    bindDropdown(displayWrap, displayTrigger, displayPanel, renderDisplayRows);

    // Belt-and-braces: re-read every mirrored value the moment the dock becomes
    // visible, so it can never fade in showing state that went stale while hidden.
    function syncMirrors() {
      syncDateLabel();
      syncSizeLabel();
      if (realSearch && dockSearch && document.activeElement !== dockSearch) {
        dockSearch.value = realSearch.value;
      }
    }

    /* ---------------------------------------------------------------- */
    /* Visibility — two independent scroll thresholds                   */
    /* ---------------------------------------------------------------- */

    // The title docks when the hero has passed behind the header; the tools dock
    // when the filter row's tools have. Two thresholds so the title arrives
    // first, as the page scrolls.
    function update() {
      position();
      var headerBottom = headerRow ? headerRow.getBoundingClientRect().bottom : 0;

      var showTitle = !!heroEl && heroEl.getBoundingClientRect().bottom <= headerBottom;

      // Only dock the tools once the real ones exist on screen — the filter bar
      // renders before a session + addresses are chosen, but its catalog tools
      // (search / dates / size) do not, and docking empty mirrors looks broken.
      // The search field is the proxy: it has a real box, unlike its wrapper.
      var searchFieldEl = realSearch
        ? realSearch.closest('.aico-preorder2-field') || realSearch
        : null;
      var toolsReady = !!searchFieldEl && searchFieldEl.getBoundingClientRect().height > 0;
      var barRect = filtersBarEl ? filtersBarEl.getBoundingClientRect() : null;
      var showTools = toolsReady && !!barRect && barRect.height > 0 && barRect.bottom <= headerBottom;

      dock.classList.toggle('is-title-visible', showTitle);
      if (showTools && !dock.classList.contains('is-tools-visible')) syncMirrors();
      dock.classList.toggle('is-tools-visible', showTools);
      if (!showTools) closeOpenDropdown();
    }

    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        update();
      });
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
