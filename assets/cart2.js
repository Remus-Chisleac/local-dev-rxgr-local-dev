/* Grouped cart layout for templates/checkout2.liquid.
 *
 * Collapses line items that share the same product_id into one card:
 * product image + title + unit price once, variant sizes in a single
 * show-data block below.
 */
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
        groupedItems() {
          var cart = Alpine.store('cart');
          if (!cart || !cart.data || !Array.isArray(cart.data.items)) return [];
          return buildGroups(cart.data.items);
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
