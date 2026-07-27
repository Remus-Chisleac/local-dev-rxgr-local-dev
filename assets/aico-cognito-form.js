/**
 * Crossfade the Cognito Forms embed in once it has actually painted
 * (/return-center, /self-repair).
 *
 * The form is fetched from cognitoforms.com, so the page would otherwise show
 * an empty column for as long as that takes. The Liquid snippet renders a
 * skeleton in the same grid cell as the mount; this reveals the real form and
 * fades the skeleton out.
 *
 * The readiness signal is the DOM, not a Cognito callback: `Cognito` exposes an
 * emitter but no documented ready event we rely on, and a wrong event name
 * would strand the skeleton forever. `.cog-body` is the rendered form body —
 * the form element itself appears before it is populated, so waiting on the
 * body avoids revealing an empty frame.
 */
(function () {
  var REVEAL_SELECTOR = '.cog-body';
  // Cognito is a third party: if it is slow, blocked or down, reveal anyway
  // rather than leaving a skeleton pulsing forever.
  var FALLBACK_MS = 15000;

  function reveal(container, skeleton) {
    if (container.classList.contains('is-ready')) return;
    container.classList.add('is-ready');
    if (!skeleton) return;
    // Drop the skeleton once it has faded, so it stops contributing height to
    // the shared grid cell. Falls back to a timer if transitionend never fires
    // (reduced motion zeroes the duration).
    var removed = false;
    var drop = function () {
      if (removed) return;
      removed = true;
      if (skeleton.parentNode) skeleton.parentNode.removeChild(skeleton);
    };
    skeleton.addEventListener('transitionend', drop);
    setTimeout(drop, 600);
  }

  function watch(container) {
    var mount = container.querySelector('[data-aico-cognito-mount]');
    var skeleton = container.querySelector('[data-aico-cognito-skeleton]');
    if (!mount) return;

    if (mount.querySelector(REVEAL_SELECTOR)) {
      reveal(container, skeleton);
      return;
    }

    var observer = new MutationObserver(function () {
      if (!mount.querySelector(REVEAL_SELECTOR)) return;
      observer.disconnect();
      // One frame so the browser paints the form at opacity 0 before the
      // transition starts — otherwise the crossfade is skipped.
      requestAnimationFrame(function () {
        reveal(container, skeleton);
      });
    });
    observer.observe(mount, { childList: true, subtree: true });

    setTimeout(function () {
      observer.disconnect();
      reveal(container, skeleton);
    }, FALLBACK_MS);
  }

  var containers = document.querySelectorAll('[data-aico-cognito]');
  for (var i = 0; i < containers.length; i++) watch(containers[i]);
})();
