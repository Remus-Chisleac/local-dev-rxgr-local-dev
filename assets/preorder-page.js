/**
 * Preorder landing: countdown timer, filter persistence, custom selects.
 */
(function () {
  'use strict';

  function readStored(storageKey) {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || '{}');
    } catch (_) {
      return {};
    }
  }

  function writeStored(storageKey, patch) {
    try {
      var current = readStored(storageKey);
      Object.keys(patch).forEach(function (key) {
        if (patch[key] === null || patch[key] === '') {
          delete current[key];
        } else {
          current[key] = patch[key];
        }
      });
      localStorage.setItem(storageKey, JSON.stringify(current));
    } catch (_) {}
  }

  function persist(contextUrl, tokenInput, storageKey, patch) {
    writeStored(storageKey, patch);
    if (!contextUrl || !tokenInput || !tokenInput.value) return;
    var body = new FormData();
    body.append('_token', tokenInput.value);
    Object.keys(patch).forEach(function (key) {
      if (payloadHasValue(patch[key])) {
        body.append(key, patch[key]);
      }
    });
    try {
      fetch(contextUrl, {
        method: 'POST',
        body: body,
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      }).catch(function () {});
    } catch (_) {}
  }

  function payloadHasValue(value) {
    return value !== null && value !== undefined && value !== '';
  }

  function padTwo(value) {
    return value < 10 ? '0' + value : '' + value;
  }

  function countdownText(unit, value) {
    if (unit === 'days') {
      return '' + value;
    }
    return padTwo(value);
  }

  function syncCustomSelect(wrapper) {
    var native = wrapper.querySelector('select.aico-preorder-select-native');
    var labelEl = wrapper.querySelector('[data-aico-custom-select-label]');
    var trigger = wrapper.querySelector('[data-aico-custom-select-trigger]');
    if (!native || !labelEl || !trigger) return;
    var option = native.options[native.selectedIndex];
    labelEl.textContent = option ? option.textContent.trim() : '';
    trigger.disabled = native.disabled;
    trigger.setAttribute(
      'aria-invalid',
      native.required && !native.value ? 'true' : 'false',
    );
  }

  function closeDropdown(wrapper) {
    var panel = wrapper.querySelector('[data-aico-custom-select-dropdown]');
    var trigger = wrapper.querySelector('[data-aico-custom-select-trigger]');
    if (panel) panel.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    wrapper.classList.remove('aico-preorder-custom-select-open');
  }

  function populateList(wrapper, native) {
    var list = wrapper.querySelector('[data-aico-custom-select-list]');
    if (!list) return;
    list.innerHTML = '';
    Array.prototype.forEach.call(native.options, function (opt, index) {
      var row = document.createElement('button');
      row.type = 'button';
      row.setAttribute('role', 'option');
      row.dataset.value = opt.value;
      row.className = 'aico-preorder-custom-select-option';
      row.textContent = opt.textContent;
      row.disabled = opt.disabled;
      row.setAttribute(
        'aria-selected',
        native.selectedIndex === index ? 'true' : 'false',
      );
      row.addEventListener('click', function (event) {
        event.preventDefault();
        if (opt.value !== native.value) {
          native.value = opt.value;
          native.dispatchEvent(new Event('change', { bubbles: true }));
        }
        closeDropdown(wrapper);
        syncCustomSelect(wrapper);
      });
      list.appendChild(row);
    });
  }

  function openDropdown(wrapper) {
    var native = wrapper.querySelector('select.aico-preorder-select-native');
    var trigger = wrapper.querySelector('[data-aico-custom-select-trigger]');
    var panel = wrapper.querySelector('[data-aico-custom-select-dropdown]');
    if (!native || !trigger || !panel) return;
    document
      .querySelectorAll('[data-aico-custom-select].aico-preorder-custom-select-open')
      .forEach(function (other) {
        if (other !== wrapper) closeDropdown(other);
      });
    populateList(wrapper, native);
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    wrapper.classList.add('aico-preorder-custom-select-open');
  }

  function initCustomSelect(root) {
    var wrappers = root.querySelectorAll('[data-aico-custom-select]');
    wrappers.forEach(function (wrapper) {
      if (wrapper.dataset.aicoPreorderCustomSelectInit === '1') return;
      wrapper.dataset.aicoPreorderCustomSelectInit = '1';
      var native = wrapper.querySelector('select.aico-preorder-select-native');
      var trigger = wrapper.querySelector('[data-aico-custom-select-trigger]');
      if (!native || !trigger) return;

      syncCustomSelect(wrapper);

      native.addEventListener('change', function () {
        syncCustomSelect(wrapper);
      });

      trigger.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (native.disabled) return;
        var isOpen = wrapper.classList.contains('aico-preorder-custom-select-open');
        if (isOpen) {
          closeDropdown(wrapper);
        } else {
          openDropdown(wrapper);
        }
      });
    });

    if (!document.documentElement.dataset.aicoPreorderGlobalCloseBound) {
      document.documentElement.dataset.aicoPreorderGlobalCloseBound = '1';
      document.addEventListener(
        'click',
        function () {
          document
            .querySelectorAll('[data-aico-custom-select].aico-preorder-custom-select-open')
            .forEach(closeDropdown);
        },
        false,
      );
      document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape') return;
        document
          .querySelectorAll('[data-aico-custom-select].aico-preorder-custom-select-open')
          .forEach(closeDropdown);
      });
    }
  }

  function refreshCustomSelectLabels(root) {
    root.querySelectorAll('[data-aico-custom-select]').forEach(syncCustomSelect);
  }

  function initPreorderPage() {
    var root = document.querySelector('[data-aico-preorder]');
    if (!root) return;

    function intAttr(element, name) {
      var raw = parseInt(element.getAttribute(name) || '0', 10);
      return isFinite(raw) ? raw : 0;
    }

    var serverDeadline = root.getAttribute('data-aico-preorder-deadline');
    var deadlineMs;
    if (serverDeadline) {
      deadlineMs = Date.parse(serverDeadline);
    } else {
      var sessionKey = 'aico_preorder_mock_deadline';
      var storedDeadline = NaN;
      try {
        var rawDeadline = sessionStorage.getItem(sessionKey);
        storedDeadline = rawDeadline ? parseInt(rawDeadline, 10) : NaN;
      } catch (_) {}

      if (!isFinite(storedDeadline) || storedDeadline <= Date.now()) {
        var offsetMs =
          intAttr(root, 'data-aico-preorder-mock-weeks') * 7 * 86400000 +
          intAttr(root, 'data-aico-preorder-mock-days') * 86400000 +
          intAttr(root, 'data-aico-preorder-mock-hours') * 3600000 +
          intAttr(root, 'data-aico-preorder-mock-minutes') * 60000 +
          intAttr(root, 'data-aico-preorder-mock-seconds') * 1000;
        deadlineMs = Date.now() + offsetMs;
        try {
          sessionStorage.setItem(sessionKey, String(deadlineMs));
        } catch (_) {}
      } else {
        deadlineMs = storedDeadline;
      }
    }

    var slots = {
      days: root.querySelector('[data-aico-countdown-days]'),
      hours: root.querySelector('[data-aico-countdown-hours]'),
      minutes: root.querySelector('[data-aico-countdown-minutes]'),
      seconds: root.querySelector('[data-aico-countdown-seconds]'),
    };

    function tick() {
      if (!slots.days || !slots.hours || !slots.minutes || !slots.seconds) return;
      if (!isFinite(deadlineMs)) {
        slots.days.textContent = '--';
        slots.hours.textContent = '--';
        slots.minutes.textContent = '--';
        slots.seconds.textContent = '--';
        return;
      }
      var remaining = Math.max(0, deadlineMs - Date.now());
      var totalSeconds = Math.floor(remaining / 1000);
      var days = Math.floor(totalSeconds / 86400);
      var hours = Math.floor((totalSeconds % 86400) / 3600);
      var minutes = Math.floor((totalSeconds % 3600) / 60);
      var seconds = totalSeconds % 60;
      slots.days.textContent = countdownText('days', days);
      slots.hours.textContent = countdownText('hours', hours);
      slots.minutes.textContent = countdownText('minutes', minutes);
      slots.seconds.textContent = countdownText('seconds', seconds);
    }

    tick();
    if (isFinite(deadlineMs)) {
      setInterval(tick, 1000);
    }

    var userId = root.getAttribute('data-aico-preorder-user-id') || 'anon';
    var contextUrl = root.getAttribute('data-aico-preorder-context-url');
    var storageKey = 'aico_preorder_context:' + userId;

    function applyStoredSelections() {
      var stored = readStored(storageKey);
      Object.keys(stored).forEach(function (key) {
        var select = root.querySelector('[data-aico-preorder-select="' + key + '"]');
        if (select && stored[key] !== null && stored[key] !== undefined) {
          var matched = Array.prototype.some.call(select.options, function (opt) {
            return String(opt.value) === String(stored[key]);
          });
          if (matched) {
            select.value = String(stored[key]);
          }
        }
      });
      refreshCustomSelectLabels(root);
    }

    applyStoredSelections();
    initCustomSelect(root);

    var form = root.querySelector('[data-aico-preorder-filters]');
    var tokenInput = form ? form.querySelector('input[name="_token"]') : null;

    var selects = root.querySelectorAll('[data-aico-preorder-select]');
    selects.forEach(function (select) {
      select.addEventListener('change', function () {
        var attributeKey = select.getAttribute('data-aico-preorder-select');
        if (!attributeKey) return;
        var delta = {};
        delta[attributeKey] = select.value;
        persist(contextUrl, tokenInput, storageKey, delta);
      });
    });

    if (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
      });
    }

    var viewStorageKey = 'aico_preorder_view:' + userId;
    var viewButtons = root.querySelectorAll('[data-aico-preorder-view]');
    function applyViewMode(value) {
      viewButtons.forEach(function (button) {
        var pressed = button.getAttribute('data-aico-preorder-view') === value;
        button.classList.toggle('aico-preorder-view-button-active', pressed);
        button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      });
      root.setAttribute('data-aico-preorder-view-mode', value);
    }

    var initialView = 'grid';
    try {
      initialView = localStorage.getItem(viewStorageKey) || 'grid';
    } catch (_) {}

    applyViewMode(initialView);

    viewButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        var next = button.getAttribute('data-aico-preorder-view');
        if (!next) return;
        try {
          localStorage.setItem(viewStorageKey, next);
        } catch (_) {}
        applyViewMode(next);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPreorderPage);
  } else {
    initPreorderPage();
  }
})();
