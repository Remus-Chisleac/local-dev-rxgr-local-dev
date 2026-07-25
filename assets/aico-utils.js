/*
 * aico-utils.js — shared, dependency-free helpers loaded before every other
 * theme script (layout/theme.liquid, deferred, first in document order).
 *
 * AICO extension: `AicoUtils` is not part of Shopify's Liquid/theme surface,
 * hence the aico- prefix on both the asset and the global.
 */
(function (global) {
  'use strict';

  /*
   * Currencies whose DISPLAYED amount snaps to a coarser step than 0.01.
   * CHF is settled in 5-rappen steps, so Swiss prices are shown at the
   * nearest 0.05. This is presentation only — the charged amount stays
   * whatever the price list resolved, so never feed a rounded value back
   * into a total, a percentage, or a cart payload.
   */
  var DISPLAY_STEP = { CHF: 0.05 };

  /*
   * The display value for an amount in a given currency. Returns null for a
   * non-numeric amount so callers can render "price on request" rather than
   * "NaN". An unknown currency is returned untouched.
   */
  function roundForDisplay(amount, currencyCode) {
    // Number(null) is 0 and Number('') is 0 — without this guard a missing
    // price would render as "0.00" instead of "price on request".
    if (amount === null || amount === undefined || amount === '') {
      return null;
    }
    var value = Number(amount);
    if (!isFinite(value)) {
      return null;
    }
    var code = typeof currencyCode === 'string' ? currencyCode.toUpperCase() : '';
    var step = DISPLAY_STEP[code];
    if (!step) {
      return value;
    }

    /*
     * Must agree with the server (Modules/Storefront/Support/MoneyDisplay.php),
     * or a Liquid-rendered price and a JS-built card price disagree on the same
     * amount. PHP's round() pre-corrects binary representation error before
     * deciding a tie; Math.round() does not. 1.075 / 0.05 is 21.499999999999996
     * in both runtimes — PHP reads that as the 21.5 tie and rounds up (1.10),
     * bare Math.round takes it literally and rounds down (1.05). toPrecision(15)
     * collapses the error the same way PHP does, so both land on 1.10.
     */
    var quotient = Number((value / step).toPrecision(15));

    return Math.round(Math.round(quotient) * step * 100) / 100;
  }

  global.AicoUtils = global.AicoUtils || {};
  global.AicoUtils.DISPLAY_STEP = DISPLAY_STEP;
  global.AicoUtils.roundForDisplay = roundForDisplay;
})(typeof window !== 'undefined' ? window : this);
