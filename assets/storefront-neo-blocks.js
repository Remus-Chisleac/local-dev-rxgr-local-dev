/**
 * storefront-neo-blocks.js  (BR1/W2 — brand pages via the neo content builder)
 *
 * Storefront-specific element renderers for the AICO Neo engine
 * (assets/content-builder-neo.js → window.NewsNeo). Loaded AFTER the engine
 * (both scripts are `defer`, so document order is execution order); it
 * registers extra element types via NewsNeo.registerType and leaves the
 * shared engine file untouched/portable.
 *
 * Registered types:
 *   hero                — banner image + headline/subheadline + CTA button
 *   product-card        — single product card (aico_hydrated.products[0])
 *   product-grid        — N products, authored columns capped at 4
 *   product-carousel    — horizontal scroll-snap track of product cards
 *   brand-gender-links  — women/men tiles (aico_hydrated.women_url/men_url)
 *   brand-news          — strip of up to 3 brand news cards (aico_hydrated.news)
 *
 * Data contract (BINDING — see context/storefront/tasks/br1-brand-pages-neo-builder.md):
 * renderers consume ONLY the authored `el.content` fields plus
 * `el.content.aico_hydrated`, which the storefront backend attaches
 * server-side while inlining the page JSON. No admin-API calls from here.
 * A storefront-typed element WITHOUT `aico_hydrated` (e.g. previewed through
 * a non-hydrating path) renders nothing — empty string, no errors.
 *
 * Hydrated shapes consumed:
 *   products[]: { id, title, url, image_url, price_label,
 *                 compare_at_price_label, badge? }   (badge: string label or
 *                 { label, kind: 'sale'|'new'|'discontinued' })
 *   brand-gender-links: { women_url, men_url }
 *   brand-news:         news[]: { title, url, image, object_position? }
 *
 * Labels fall back to theme locale keys bridged by snippets/neo-content.liquid
 * into `window.aicoNeoI18n` (brand_page.gender_women / gender_men /
 * categories_aria / news_heading).
 *
 * The small escape/url/style helpers replicate the engine's own (they are
 * IIFE-scoped there and intentionally not exported).
 */
(function (window, document) {
  'use strict';

  var Neo = window.NewsNeo;
  if (!Neo || typeof Neo.registerType !== 'function') {
    if (window.console && console.warn) {
      console.warn('storefront-neo-blocks: NewsNeo engine missing — load content-builder-neo.js first');
    }
    return;
  }

  // ============================================================
  // Helpers (mirroring content-builder-neo.js, which keeps its own IIFE-scoped)
  // ============================================================

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Prefix bare domains with https:// so they don't get treated as relative paths.
  function normalizeUrl(url) {
    if (!url) return '';
    var s = String(url).trim();
    if (!s) return '';
    if (/^javascript:/i.test(s)) return '';
    if (/^([a-z][a-z0-9+.\-]*:|\/\/|\/|#)/i.test(s)) return s;
    if (/^[^\s\/?]+\.[a-z]{2,}/i.test(s)) return 'https://' + s;
    return s;
  }

  // Strip a single wrapping <p> so rich-text headlines aren't invalid <hN><p>.
  function stripOuterParagraph(html) {
    if (!html) return '';
    return String(html).replace(/^\s*<p[^>]*>([\s\S]*?)<\/p>\s*$/i, '$1');
  }

  function camelToKebab(s) {
    return s.replace(/([A-Z])/g, '-$1').toLowerCase();
  }

  // Carry the builder's styles.desktop onto the wrapper (trimmed version of the
  // engine's stylesToInline — no shorthand expansion needed for our wrappers).
  function inlineStyleAttr(node) {
    if (!node || !node.styles) return '';
    var styleObj = node.styles.desktop;
    if (!styleObj || typeof styleObj !== 'object' || Array.isArray(styleObj)) return '';
    var out = [];
    for (var key in styleObj) {
      if (!Object.prototype.hasOwnProperty.call(styleObj, key)) continue;
      var val = styleObj[key];
      if (val === null || val === undefined || val === '') continue;
      out.push(camelToKebab(key) + ':' + val);
    }
    return out.length ? ' style="' + escapeAttr(out.join(';')) + '"' : '';
  }

  function i18n(key, fallback) {
    var dict = window.aicoNeoI18n;
    if (dict && typeof dict[key] === 'string' && dict[key]) return dict[key];
    return fallback;
  }

  // Server-hydrated payload; storefront elements render nothing without it.
  function hydrated(el) {
    var content = el && el.content;
    var payload = content && content.aico_hydrated;
    return (payload && typeof payload === 'object') ? payload : null;
  }

  function hydratedProducts(el) {
    var payload = hydrated(el);
    var list = payload && Array.isArray(payload.products) ? payload.products : [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && (list[i].url || list[i].title)) out.push(list[i]);
    }
    return out;
  }

  // ============================================================
  // Product card (mirrors snippets/product-card.liquid so the existing
  // .aico-product-card CSS in theme.css styles it — keep classes in sync)
  // ============================================================

  var EMPTY_IMAGE_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M21 15V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10"></path>' +
      '<path d="m3 21 9-9 4 4 8-8"></path>' +
      '<line x1="2" x2="22" y1="2" y2="22"></line>' +
    '</svg>';

  function renderBadge(badge) {
    if (!badge) return '';
    var label;
    var kind;
    if (typeof badge === 'string') {
      label = badge;
      kind = 'sale';
    } else if (typeof badge === 'object') {
      label = badge.label || '';
      kind = badge.kind || badge.type || 'sale';
    }
    if (!label) return '';
    if (kind !== 'sale' && kind !== 'new' && kind !== 'discontinued') kind = 'sale';
    return '<span class="aico-product-card-badge aico-product-card-badge-' + kind + '">' + escapeHtml(label) + '</span>';
  }

  function renderProductCard(product) {
    var url = normalizeUrl(product.url || '');
    var title = product.title || '';
    var image = product.image_url || '';
    var price = product.price_label || '';
    var compare = product.compare_at_price_label || '';

    var html = '<article class="aico-product-card aico-neo-product-card">';
    html += '<a href="' + escapeAttr(url) + '" class="aico-product-card-link" aria-label="' + escapeAttr(title) + '">';
    html += '<div class="aico-product-card-image-wrap">';
    if (image) {
      html += '<img class="aico-product-card-image" src="' + escapeAttr(image) + '" alt="" loading="lazy" decoding="async">';
    } else {
      html += '<div class="aico-product-card-image-empty" aria-hidden="true">' + EMPTY_IMAGE_SVG + '</div>';
    }
    html += renderBadge(product.badge);
    html += '</div>';
    html += '<div class="aico-product-card-body">';
    html += '<h3 class="aico-product-card-title">' + escapeHtml(title) + '</h3>';
    if (price) {
      html += '<p class="aico-product-card-price">';
      if (compare) {
        html += '<span class="aico-product-card-price-was"><span class="aico-product-card-price-list">' + escapeHtml(compare) + '</span></span>';
      }
      html += '<span class="aico-product-card-price-now"><span class="aico-product-card-price-current">' + escapeHtml(price) + '</span></span>';
      html += '</p>';
    }
    html += '</div>';
    html += '</a>';
    html += '</article>';
    return html;
  }

  // ============================================================
  // hero — authored fields per aiconeo elements.ts:
  // backgroundImage, headline, subheadline, buttonText, buttonUrl.
  // Generic (not storefront-gated): renders from authored content alone.
  // Visual language mirrors the retired .aico-brand-hero (photo + scrim + copy).
  // ============================================================

  Neo.registerType('hero', function (el) {
    var content = el.content || {};
    var image = content.backgroundImage || '';
    var headline = stripOuterParagraph(content.headline || '');
    var subheadline = stripOuterParagraph(content.subheadline || '');
    var ctaText = content.buttonText || '';
    var ctaUrl = normalizeUrl(content.buttonUrl || '');
    if (!image && !headline && !subheadline) return '';

    var html = '<div class="aico-neo-hero"' + inlineStyleAttr(el) + '>';
    if (image) {
      // The hero is the page's LCP banner — load eagerly, unlike the cards below.
      html += '<img class="aico-neo-hero-photo" src="' + escapeAttr(image) + '" alt="" loading="eager">';
      html += '<div class="aico-neo-hero-scrim" aria-hidden="true"></div>';
    }
    html += '<div class="aico-neo-hero-inner"><div class="aico-neo-hero-copy' + (image ? '' : ' aico-neo-hero-copy--plain') + '">';
    if (headline) html += '<h2 class="aico-neo-hero-heading">' + headline + '</h2>';
    if (subheadline) html += '<p class="aico-neo-hero-sub">' + subheadline + '</p>';
    if (ctaText && ctaUrl) {
      html += '<a class="aico-button aico-button-primary aico-neo-hero-cta" href="' + escapeAttr(ctaUrl) + '">' + escapeHtml(ctaText) + '</a>';
    }
    html += '</div></div>';
    html += '</div>';
    return html;
  });

  // ============================================================
  // product-card — single card from aico_hydrated.products[0]
  // ============================================================

  Neo.registerType('product-card', function (el) {
    var products = hydratedProducts(el);
    if (products.length === 0) return '';
    return '<div class="aico-neo-product-single"' + inlineStyleAttr(el) + '>' + renderProductCard(products[0]) + '</div>';
  });

  // ============================================================
  // product-grid — authored `columns` capped at 4; the element owns the
  // responsive collapse (CSS: 2-up base, authored count from 900px —
  // matching the retired .aico-brand-product-grid breakpoints).
  // ============================================================

  Neo.registerType('product-grid', function (el) {
    var products = hydratedProducts(el);
    if (products.length === 0) return '';
    var content = el.content || {};
    var columns = parseInt(content.columns, 10);
    if (!isFinite(columns) || columns < 1) columns = 4;
    if (columns > 4) columns = 4;

    var html = '<ul class="aico-neo-product-grid aico-neo-product-grid--cols-' + columns + '" role="list"' + inlineStyleAttr(el) + '>';
    for (var i = 0; i < products.length; i++) {
      html += '<li class="aico-neo-product-grid-item">' + renderProductCard(products[i]) + '</li>';
    }
    html += '</ul>';
    return html;
  });

  // ============================================================
  // product-carousel — scroll-snap track of the same cards; nav buttons are
  // wired in the hydrate wrapper below (pattern-matching the engine's
  // media-gallery carousel hydration).
  // ============================================================

  Neo.registerType('product-carousel', function (el) {
    var products = hydratedProducts(el);
    if (products.length === 0) return '';
    var content = el.content || {};
    var perView = parseInt(content.slidesToShow, 10);
    if (!isFinite(perView) || perView < 1) perView = 4;
    if (perView > 4) perView = 4;

    var html = '<div class="aico-neo-product-carousel" data-aico-neo-carousel="1"' + inlineStyleAttr(el) + '>';
    html += '<div class="aico-neo-product-carousel-track" style="--aico-neo-carousel-cols:' + perView + ';">';
    for (var i = 0; i < products.length; i++) {
      html += '<div class="aico-neo-product-carousel-item">' + renderProductCard(products[i]) + '</div>';
    }
    html += '</div>';
    if (products.length > perView) {
      html += '<button type="button" class="aico-neo-product-carousel-nav aico-neo-product-carousel-nav--prev" aria-label="Previous">&#10094;</button>';
      html += '<button type="button" class="aico-neo-product-carousel-nav aico-neo-product-carousel-nav--next" aria-label="Next">&#10095;</button>';
    }
    html += '</div>';
    return html;
  });

  // ============================================================
  // brand-gender-links — two tiles from aico_hydrated.women_url/men_url.
  // Authored labels/images: womenLabel/menLabel, womenImage/menImage;
  // labels fall back to brand_page.gender_women / gender_men.
  // ============================================================

  Neo.registerType('brand-gender-links', function (el) {
    var payload = hydrated(el);
    if (!payload || (!payload.women_url && !payload.men_url)) return '';
    var content = el.content || {};
    var tiles = [
      { key: 'women', url: payload.women_url, label: content.womenLabel || i18n('gender_women', 'Women'), image: content.womenImage || '' },
      { key: 'men', url: payload.men_url, label: content.menLabel || i18n('gender_men', 'Men'), image: content.menImage || '' }
    ];

    var html = '<nav class="aico-neo-gender-tiles" aria-label="' + escapeAttr(i18n('categories_aria', 'Shop by category')) + '"' + inlineStyleAttr(el) + '>';
    for (var i = 0; i < tiles.length; i++) {
      var tile = tiles[i];
      var url = normalizeUrl(tile.url || '');
      if (!url) continue;
      html += '<a class="aico-neo-gender-tile aico-neo-gender-tile--' + tile.key + '" href="' + escapeAttr(url) + '">';
      if (tile.image) {
        html += '<img class="aico-neo-gender-tile-photo" src="' + escapeAttr(tile.image) + '" alt="" loading="lazy">';
      }
      html += '<span class="aico-neo-gender-label">' + escapeHtml(tile.label) + '</span>';
      html += '</a>';
    }
    html += '</nav>';
    return html;
  });

  // ============================================================
  // brand-news — up to 3 cards from aico_hydrated.news. Markup mirrors the
  // retired brand.liquid strip so the existing .aico-brand-news CSS styles it.
  // Optional authored heading overrides the brand_page.news_heading locale key.
  // ============================================================

  Neo.registerType('brand-news', function (el) {
    var payload = hydrated(el);
    var rawNews = payload && Array.isArray(payload.news) ? payload.news : [];
    var news = [];
    for (var i = 0; i < rawNews.length && news.length < 3; i++) {
      if (rawNews[i] && rawNews[i].url && rawNews[i].title) news.push(rawNews[i]);
    }
    if (news.length === 0) return '';
    var content = el.content || {};
    var heading = content.heading || i18n('news_heading', 'Latest news');

    var html = '<section class="aico-brand-news aico-neo-brand-news"' + inlineStyleAttr(el) + '>';
    html += '<h2 class="aico-brand-news-heading">' + escapeHtml(heading) + '</h2>';
    html += '<ul class="aico-brand-news-grid" role="list">';
    for (var j = 0; j < news.length; j++) {
      var item = news[j];
      var image = item.image || item.image_url || '';
      html += '<li class="aico-brand-news-card">';
      html += '<a class="aico-brand-news-link" href="' + escapeAttr(normalizeUrl(item.url)) + '">';
      html += '<div class="aico-brand-news-image">';
      if (image) {
        var position = item.object_position ? ' style="object-position:' + escapeAttr(item.object_position) + ';"' : '';
        html += '<img src="' + escapeAttr(image) + '" alt="" loading="lazy"' + position + '>';
      }
      html += '</div>';
      html += '<h3 class="aico-brand-news-title">' + escapeHtml(item.title) + '</h3>';
      html += '</a>';
      html += '</li>';
    }
    html += '</ul>';
    html += '</section>';
    return html;
  });

  // ============================================================
  // Hydration — wrap the engine's hydrate so the bootstrap's single
  // hydrate(mount) call also wires our carousel nav (the engine's own
  // wiring runs first, untouched).
  // ============================================================

  function wireProductCarousel(root) {
    if (root.__aicoNeoCarouselWired) return;
    root.__aicoNeoCarouselWired = true;
    var track = root.querySelector('.aico-neo-product-carousel-track');
    if (!track) return;
    var prev = root.querySelector('.aico-neo-product-carousel-nav--prev');
    var next = root.querySelector('.aico-neo-product-carousel-nav--next');
    if (!prev && !next) return;

    function snapToItem(dir) {
      var firstItem = track.querySelector('.aico-neo-product-carousel-item');
      if (!firstItem) return;
      var styles = window.getComputedStyle(track);
      var gap = parseFloat(styles.columnGap || styles.gap) || 0;
      var step = firstItem.offsetWidth + gap;
      if (step <= 0) return;
      var current = track.scrollLeft / step;
      var nearest = Math.round(current);
      var targetIdx = (Math.abs(current - nearest) < 0.1)
        ? nearest + dir
        : (dir > 0 ? Math.ceil(current) : Math.floor(current));
      if (targetIdx < 0) targetIdx = 0;
      track.scrollTo({ left: targetIdx * step, behavior: 'smooth' });
    }

    if (prev) prev.addEventListener('click', function () { snapToItem(-1); });
    if (next) next.addEventListener('click', function () { snapToItem(1); });
  }

  var engineHydrate = Neo.hydrate;
  Neo.hydrate = function (root) {
    engineHydrate.call(Neo, root);
    var scope = root && root.querySelectorAll ? root : document;
    var carousels = scope.querySelectorAll('[data-aico-neo-carousel="1"]');
    for (var i = 0; i < carousels.length; i++) wireProductCarousel(carousels[i]);
  };

})(window, document);
