/* Grouped cart layout for templates/cart2.liquid. */
(function () {
  'use strict';

  function groupKey(line) {
    if (line && line.product_id) return String(line.product_id);
    return 'line:' + String(line && line.id);
  }

  function buildGroups(items) {
    var groups = [];
    var index = {};

    (items || []).forEach(function (line) {
      var key = groupKey(line);
      if (!index[key]) {
        index[key] = {
          key: key,
          product_id: line.product_id || null,
          title: line.title,
          url: line.url,
          image: line.image,
          price: line.price,
          lines: [],
        };
        groups.push(index[key]);
      }
      index[key].lines.push(line);
    });

    return groups;
  }

  function registerGroupedCartPage() {
    Alpine.data('aicoCartGroupedPage', function () {
      return {
        openGroups: {},

        groupedItems() {
          var cart = Alpine.store('cart');
          if (!cart || !cart.data || !Array.isArray(cart.data.items)) return [];
          return buildGroups(cart.data.items);
        },

        isGroupOpen(key) {
          if (this.openGroups[key] === undefined) return true;
          return !!this.openGroups[key];
        },

        toggleGroup(key) {
          this.openGroups[key] = !this.isGroupOpen(key);
        },

        groupLineTotal(group) {
          return (group.lines || []).reduce(function (sum, line) {
            return sum + Number(line.line_price || 0);
          }, 0);
        },

        groupHasInvalidLine(group) {
          var cart = Alpine.store('cart');
          return (group.lines || []).some(function (line) {
            return !line.aico_is_valid || (cart && cart.lineExceedsStock(line));
          });
        },

        lineSizeLabel(line, group) {
          var label = (line && line.aico_variant_label) || '';
          var title = (group && group.title) || '';
          if (label && title && label.indexOf(title) === 0) {
            var trimmed = label.slice(title.length).replace(/^[\s,–—-]+/, '').trim();
            if (trimmed) return trimmed;
          }
          if (label) return label;
          return (line && line.sku) || '';
        },
      };
    });
  }

  var groupedCartRegistered = false;
  function ensureGroupedCartPage() {
    if (groupedCartRegistered || typeof window.Alpine === 'undefined') return;
    groupedCartRegistered = true;
    registerGroupedCartPage();
  }

  document.addEventListener('alpine:init', ensureGroupedCartPage);
  ensureGroupedCartPage();
})();
