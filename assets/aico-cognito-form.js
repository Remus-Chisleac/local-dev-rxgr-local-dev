/**
 * Crossfade the Cognito Forms embed in once it has actually painted
 * (/return-center, /self-repair).
 *
 * The form is fetched from cognitoforms.com, so the page would otherwise show
 * an empty column for as long as that takes. The Liquid snippet renders a
 * spinner in the same grid cell as the mount; this reveals the real form and
 * fades the spinner out.
 *
 * The readiness signal is the DOM, not a Cognito callback: `Cognito` exposes an
 * emitter but no documented ready event we rely on, and a wrong event name
 * would strand the spinner forever. `.cog-body` is the rendered form body — the
 * form element appears before it is populated, so waiting on the body avoids
 * revealing an empty frame.
 *
 * Polling rather than a MutationObserver: measured, an observer attached from
 * this asset consistently missed Cognito's inserts and only ever revealed via
 * the timeout (16.8s), because the script executes after seamless.js has
 * finished mutating. A poll cannot lose that race — it revealed at ~0.8s.
 */
(function () {
  var REVEAL_SELECTOR = '.cog-body';
  var POLL_MS = 100;
  // Cognito is a third party: if it is slow, blocked or down, reveal anyway
  // rather than leaving the spinner turning forever.
  var GIVE_UP_MS = 15000;

  function reveal(container, spinner) {
    if (container.classList.contains('is-ready')) return;
    container.classList.add('is-ready');
    if (!spinner) return;
    // Drop the spinner once it has faded, so it stops contributing height to
    // the shared grid cell. Timer fallback because transitionend does not fire
    // when reduced motion zeroes the duration.
    var removed = false;
    var drop = function () {
      if (removed) return;
      removed = true;
      if (spinner.parentNode) spinner.parentNode.removeChild(spinner);
    };
    spinner.addEventListener('transitionend', drop);
    setTimeout(drop, 600);
  }

  function watch(container) {
    var mount = container.querySelector('[data-aico-cognito-mount]');
    var spinner = container.querySelector('[data-aico-cognito-loading]');
    if (!mount) return;

    var waited = 0;
    var timer = setInterval(function () {
      waited += POLL_MS;
      if (!mount.querySelector(REVEAL_SELECTOR) && waited < GIVE_UP_MS) return;
      clearInterval(timer);
      // One frame so the browser paints the form at opacity 0 before the
      // transition starts — otherwise the crossfade is skipped.
      requestAnimationFrame(function () {
        reveal(container, spinner);
      });
    }, POLL_MS);
  }

  var containers = document.querySelectorAll('[data-aico-cognito]');
  for (var i = 0; i < containers.length; i++) watch(containers[i]);
})();
