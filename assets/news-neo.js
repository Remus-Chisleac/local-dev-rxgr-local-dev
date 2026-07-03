/**
 * news-neo.js
 *
 * Renders `contentBuilderNeoJson` (new AICO format). news.js delegates here
 * when `window.NewsNeo.hasContent(data)` is true; otherwise its legacy
 * `contentBuilder` path runs unchanged.
 *
 * Public API (window.NewsNeo):
 *   - hasContent(data)       → boolean
 *   - render(data)           → HTML string
 *   - registerType(type, fn) → add or override an element renderer
 */
(function (window) {
  'use strict';

  // Forward styles.desktop from the JSON to the DOM
  var USE_API_INLINE_STYLES = true;

  // ============================================================
  // Detection
  // ============================================================

  function hasNeoContent(data) {
    if (!data || typeof data !== 'object') return false;
    var neo = data.contentBuilderNeoJson;
    if (!neo || typeof neo !== 'object') return false;
    if (!Array.isArray(neo.sections) || neo.sections.length === 0) return false;
    return true;
  }

  // ============================================================
  // Style helpers (used only when USE_API_INLINE_STYLES is true)
  // ============================================================

  function camelToKebab(s) {
    return s.replace(/([A-Z])/g, '-$1').toLowerCase();
  }

  // Expand `padding`/`margin` shorthand into longhands when both are present, so longhands always win.
  function normalizeShorthands(styleObj) {
    var out = {};
    for (var k in styleObj) {
      if (Object.prototype.hasOwnProperty.call(styleObj, k)) out[k] = styleObj[k];
    }
    var sides = ['Top', 'Right', 'Bottom', 'Left'];
    ['padding', 'margin'].forEach(function (base) {
      var hasIndividual = sides.some(function (s) { return (base + s) in out; });
      if (!hasIndividual || !(base in out)) return;
      var parts = String(out[base]).trim().split(/\s+/);
      var top = parts[0];
      var right = parts[1] !== undefined ? parts[1] : top;
      var bottom = parts[2] !== undefined ? parts[2] : top;
      var left = parts[3] !== undefined ? parts[3] : right;
      var fill = { Top: top, Right: right, Bottom: bottom, Left: left };
      sides.forEach(function (s) { if (!(base + s in out)) out[base + s] = fill[s]; });
      delete out[base];
    });
    return out;
  }

  function stylesToInline(styleObj) {
    if (!styleObj || typeof styleObj !== 'object' || Array.isArray(styleObj)) return '';
    var normalized = normalizeShorthands(styleObj);
    var out = [];
    for (var key in normalized) {
      if (!Object.prototype.hasOwnProperty.call(normalized, key)) continue;
      var val = normalized[key];
      if (val === null || val === undefined || val === '') continue;
      out.push(camelToKebab(key) + ':' + val);
    }
    return out.join(';');
  }

  function pickStyles(node, breakpoint) {
    if (!node || !node.styles) return {};
    var s = node.styles[breakpoint || 'desktop'];
    if (!s || Array.isArray(s)) return {};
    return s;
  }

  function inlineStyleAttr(node) {
    if (!USE_API_INLINE_STYLES) return '';
    var s = stylesToInline(pickStyles(node));
    return s ? ' style="' + s + '"' : '';
  }

  // Strip a single wrapping <p> so heading text from the rich-text editor isn't invalid <hN><p>.
  function stripOuterParagraph(html) {
    if (!html) return '';
    return String(html).replace(/^\s*<p[^>]*>([\s\S]*?)<\/p>\s*$/i, '$1');
  }

  function escapeAttr(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Pick the active translation: window.current_locale_code if matched, else first available.
  function pickTranslation(translations) {
    if (!translations || typeof translations !== 'object') return {};
    var loc = (typeof window !== 'undefined' && window.current_locale_code) ? window.current_locale_code : null;
    if (loc && translations[loc]) return translations[loc];
    for (var k in translations) {
      if (Object.prototype.hasOwnProperty.call(translations, k)) return translations[k] || {};
    }
    return {};
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

  // Element renderers return inner HTML only; row/column wrapping lives in
  // renderSection. The `columns` type is handled there, not here.
  var renderers = {};

  renderers.heading = function (el) {
    var content = el.content || {};
    var level = content.level || 'h2';
    if (!/^h[1-6]$/i.test(level)) level = 'h2';
    var text = stripOuterParagraph(content.text != null ? content.text : '');
    return '<div class="content-type-title content-type-neo-heading">' +
      '<' + level + inlineStyleAttr(el) + '>' + text + '</' + level + '>' +
      '</div>';
  };

  renderers.text = function (el) {
    var content = el.content || {};
    var text = content.text != null ? content.text : '';
    return '<div class="content-type-text content-type-neo-text"' + inlineStyleAttr(el) + '>' + text + '</div>';
  };

  // Custom HTML block — render the author's raw markup verbatim (matches the React builder's
  // `html` element, which stores HTML untouched by the rich-text engine).
  renderers.html = function (el) {
    var content = el.content || {};
    var html = content.html != null ? content.html : '';
    return '<div class="content-type-html content-type-neo-html"' + inlineStyleAttr(el) + '>' + html + '</div>';
  };

  renderers.image = function (el) {
    var content = el.content || {};
    var src = content.src || '';
    if (!src) return '';
    var alt = escapeAttr(content.alt || '');
    var caption = content.caption || '';
    // Inline styles go on the <img> — no legacy .image-container wrapper (forced max-width:75%).
    var html = '<div class="content-type-neo-image">';
    html += '<img src="' + escapeAttr(src) + '" alt="' + alt + '" loading="lazy"' + inlineStyleAttr(el) + '>';
    if (caption) {
      html += '<span class="caption">' + caption + '</span>';
    }
    html += '</div>';
    return html;
  };

  renderers.divider = function (el) {
    return '<div class="content-type-divider content-type-neo-divider"><hr' + inlineStyleAttr(el) + '></div>';
  };

  // ----- video helpers -----

  function youtubeId(url) {
    if (!url) return '';
    var m = String(url).match(/(?:youtube\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
    return m ? m[1] : '';
  }

  function vimeoId(url) {
    if (!url) return '';
    var m = String(url).match(/vimeo\.com\/(?:video\/)?(\d+)/);
    return m ? m[1] : '';
  }

  function parseAspectRatio(s, fallback) {
    if (!s) return fallback;
    var str = String(s).replace(':', '/');
    if (/^\d+(\.\d+)?(\/\d+(\.\d+)?)?$/.test(str)) return str;
    return fallback;
  }

  renderers.youtube = function (el) {
    var content = el.content || {};
    var id = content.videoId || youtubeId(content.src || '');
    if (!id) return '';
    var aspect = parseAspectRatio(content.aspectRatio, '16/9');
    var title = escapeAttr(content.videoTitle || 'YouTube video');
    var iframe = '<iframe title="' + title + '" src="https://www.youtube.com/embed/' + escapeAttr(id) +
      '" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>';
    return '<div class="content-type-neo-youtube"' + inlineStyleAttr(el) + '>' +
      '<div class="neo-video__frame" style="aspect-ratio:' + aspect + ';">' + iframe + '</div>' +
      '</div>';
  };

  renderers.video = function (el) {
    var content = el.content || {};
    var src = content.src || '';
    if (!src) return '';
    var aspect = parseAspectRatio(content.aspectRatio, '16/9');
    var type = content.type || 'custom';
    var inner;
    if (type === 'youtube') {
      var yid = youtubeId(src);
      if (!yid) return '';
      inner = '<iframe src="https://www.youtube.com/embed/' + escapeAttr(yid) +
        '" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>';
    } else if (type === 'vimeo') {
      var vid = vimeoId(src);
      if (!vid) return '';
      inner = '<iframe src="https://player.vimeo.com/video/' + escapeAttr(vid) +
        '" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>';
    } else {
      inner = '<video src="' + escapeAttr(src) + '" controls></video>';
    }
    return '<div class="content-type-neo-video"' + inlineStyleAttr(el) + '>' +
      '<div class="neo-video__frame" style="aspect-ratio:' + aspect + ';">' + inner + '</div>' +
      '</div>';
  };

  renderers.gallery = function (el) {
    var content = el.content || {};
    var rawImages = Array.isArray(content.images) ? content.images : [];
    var images = [];
    for (var i = 0; i < rawImages.length; i++) {
      if (rawImages[i] && rawImages[i].src) images.push(rawImages[i]);
    }
    if (images.length === 0) return '';

    var cols = parseInt(content.columns, 10);
    if (!isFinite(cols) || cols < 1) cols = 3;
    if (cols > 6) cols = 6;

    var variant = content.layoutVariant
      ? ' content-type-neo-gallery--' + escapeAttr(String(content.layoutVariant))
      : '';

    var apiStyles = USE_API_INLINE_STYLES ? stylesToInline(pickStyles(el)) : '';
    var gridCols = 'grid-template-columns:repeat(' + cols + ',1fr)';
    var combined = apiStyles ? apiStyles + ';' + gridCols : gridCols;

    var html = '<div class="content-type-neo-gallery' + variant + '" style="' + combined + '">';
    for (var k = 0; k < images.length; k++) {
      var img = images[k];
      html += '<img src="' + escapeAttr(img.src) + '" alt="' + escapeAttr(img.alt || '') + '" loading="lazy">';
    }
    html += '</div>';
    return html;
  };

  function renderMediaGalleryItem(file, showCaptions) {
    var src = file.optimizedImageUrl || file.url;
    var t = pickTranslation(file.translations);
    var alt = escapeAttr(t.alternativeText || t.name || '');
    var caption = t.caption || '';
    var html = '<figure class="neo-media-gallery__item">';
    html += '<img src="' + escapeAttr(src) + '" alt="' + alt + '" loading="lazy">';
    if (showCaptions && caption) {
      html += '<figcaption class="neo-media-gallery__caption">' + caption + '</figcaption>';
    }
    html += '</figure>';
    return html;
  }

  renderers['media-gallery'] = function (el) {
    var content = el.content || {};
    var rawFiles = Array.isArray(content.files) ? content.files : [];
    if (rawFiles.length === 0) return '';

    var files = rawFiles.slice().sort(function (a, b) {
      var ao = (a && typeof a.order === 'number') ? a.order : 0;
      var bo = (b && typeof b.order === 'number') ? b.order : 0;
      return ao - bo;
    }).filter(function (f) {
      return f && (f.url || f.optimizedImageUrl);
    });
    if (files.length === 0) return '';

    var cols = parseInt(content.columns, 10);
    if (!isFinite(cols) || cols < 1) cols = 3;
    if (cols > 6) cols = 6;

    var layout = (content.layout || 'grid').toLowerCase();
    if (layout !== 'grid' && layout !== 'masonry' && layout !== 'carousel') layout = 'grid';

    var showCaptions = content.showCaptions !== false;
    var subsectionTitle = content.subsectionTitle || '';
    var variantClass = ' content-type-neo-media-gallery--' + layout;

    var inner = '';
    if (layout === 'masonry') {
      inner += '<div class="neo-media-gallery__masonry" style="column-count:' + cols + ';">';
      for (var i = 0; i < files.length; i++) inner += renderMediaGalleryItem(files[i], showCaptions);
      inner += '</div>';
    } else if (layout === 'carousel') {
      var hasOverflow = files.length > cols;
      inner += '<div class="neo-media-gallery__carousel" data-neo-mg-carousel="1" data-cols="' + cols + '">';
      inner += '<div class="neo-media-gallery__carousel-track" style="--neo-mg-cols:' + cols + ';">';
      for (var j = 0; j < files.length; j++) inner += renderMediaGalleryItem(files[j], showCaptions);
      inner += '</div>';
      if (hasOverflow) {
        inner += '<button type="button" class="neo-media-gallery__nav neo-media-gallery__nav--prev" aria-label="Previous">&#10094;</button>';
        inner += '<button type="button" class="neo-media-gallery__nav neo-media-gallery__nav--next" aria-label="Next">&#10095;</button>';
        inner += '<div class="neo-media-gallery__scrubber" style="position:relative;height:6px;background:#d0d0d0;border-radius:3px;margin-top:16px;cursor:pointer;touch-action:none;user-select:none;overflow:hidden;">';
        inner += '<div class="neo-media-gallery__scrubber-thumb" style="position:absolute;top:0;left:0;height:100%;width:60px;min-width:60px;background:#333;border-radius:3px;pointer-events:none;display:block;"></div>';
        inner += '</div>';
      }
      inner += '</div>';
    } else {
      inner += '<div class="neo-media-gallery__grid" style="grid-template-columns:repeat(' + cols + ',1fr);">';
      for (var k = 0; k < files.length; k++) inner += renderMediaGalleryItem(files[k], showCaptions);
      inner += '</div>';
    }

    var html = '<div class="content-type-neo-media-gallery' + variantClass + '"' + inlineStyleAttr(el) + '>';
    if (subsectionTitle) html += '<h3 class="neo-media-gallery__title">' + subsectionTitle + '</h3>';
    html += inner;
    html += '</div>';
    return html;
  };

  renderers.slideshow = function (el) {
    var content = el.content || {};
    var rawSlides = Array.isArray(content.slides) ? content.slides : [];
    var slides = [];
    for (var i = 0; i < rawSlides.length; i++) {
      if (rawSlides[i] && rawSlides[i].src) slides.push(rawSlides[i]);
    }
    if (slides.length === 0) return '';

    var autoplay = content.autoplay === true;
    var interval = parseInt(content.autoplayInterval, 10);
    if (!isFinite(interval) || interval < 1000) interval = 5000;
    var showDots = content.showDots !== false;
    var showArrows = content.showArrows !== false;
    var aspect = parseAspectRatio(content.aspectRatio, '16/9');

    var html = '<div class="content-type-text content-type-neo-slideshow"' +
      ' data-neo-slideshow="1"' +
      ' data-autoplay="' + (autoplay ? '1' : '0') + '"' +
      ' data-interval="' + interval + '"' +
      inlineStyleAttr(el) + '>';
    html += '<div class="neo-slideshow__viewport" style="aspect-ratio:' + aspect + ';">';
    html += '<div class="neo-slideshow__track">';
    for (var s = 0; s < slides.length; s++) {
      var slide = slides[s];
      html += '<div class="neo-slideshow__slide">';
      html += '<img src="' + escapeAttr(slide.src) + '" alt="' + escapeAttr(slide.alt || '') + '" loading="lazy">';
      if (slide.headline || (slide.buttonText && slide.buttonUrl)) {
        html += '<div class="neo-slideshow__caption">';
        if (slide.headline) html += '<h3 class="neo-slideshow__headline" style="color:#fff !important;font-size:28px !important;font-weight:600 !important;line-height:1.2 !important;margin:0 !important;">' + slide.headline + '</h3>';
        var btnUrl = normalizeUrl(slide.buttonUrl);
        if (slide.buttonText && btnUrl) {
          html += '<a class="neo-slideshow__btn" href="' + escapeAttr(btnUrl) + '">' + slide.buttonText + '</a>';
        }
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>'; // track
    if (showArrows && slides.length > 1) {
      html += '<button type="button" class="neo-slideshow__nav neo-slideshow__nav--prev" aria-label="Previous slide">&#10094;</button>';
      html += '<button type="button" class="neo-slideshow__nav neo-slideshow__nav--next" aria-label="Next slide">&#10095;</button>';
    }
    html += '</div>'; // viewport
    if (showDots && slides.length > 1) {
      html += '<div class="neo-slideshow__dots">';
      for (var d = 0; d < slides.length; d++) {
        html += '<button type="button" class="neo-slideshow__dot" data-idx="' + d + '" aria-label="Go to slide ' + (d + 1) + '"></button>';
      }
      html += '</div>';
    }
    html += '</div>';
    return html;
  };

  function renderUnknown(el) {
    if (window.console && console.warn) {
      console.warn('NewsNeo: no renderer for type', el && el.type, el);
    }
    return '';
  }

  // ============================================================
  // Dispatch (single element, NOT a column container)
  // ============================================================

  function renderElement(el) {
    if (!el || typeof el !== 'object') return '';
    if (el.type === 'columns') {
      // Should never reach here - handled in renderSection. Safe guard.
      return '';
    }
    var fn = renderers[el.type];
    if (typeof fn !== 'function') return renderUnknown(el);
    try {
      return fn(el);
    } catch (e) {
      if (window.console && console.warn) {
        console.warn('NewsNeo: renderer for "' + el.type + '" threw', e);
      }
      return '';
    }
  }

  // ============================================================
  // Row / column wrappers
  // Mirrors the legacy structure produced inside news.js so news.css
  // styles the result identically.
  // ============================================================

  function wrapContent(innerHtml, contentIndex) {
    if (!innerHtml) return '';
    return '<div class="content content__' + contentIndex + '">' + innerHtml + '</div>';
  }

  function wrapColumn(contentHtmlList, columnIndex) {
    var inner = contentHtmlList.join('');
    return '<div class="content-column column__' + columnIndex + '">' + inner + '</div>';
  }

  function wrapRow(columnsHtml, rowIndex, totalColumns, isFullWidth) {
    var classes = ['content-row', 'row__' + rowIndex, 'total-columns-' + totalColumns];
    if (isFullWidth) classes.push('fullwidth');
    return '<div class="' + classes.join(' ') + '">' + columnsHtml + '</div>';
  }

  // Render a `columns` element as one multi-column row.
  function renderColumnsRow(columnsEl, rowIndex, isFullWidth) {
    var content = columnsEl.content || {};
    var count = parseInt(content.columnCount, 10);
    if (isNaN(count) || count < 1) count = 2;
    if (count > 4) count = 4; // legacy CSS supports up to total-columns-4

    var children = Array.isArray(columnsEl.children) ? columnsEl.children : [];

    var sorted = children.slice().sort(function (a, b) {
      var ai = (a && a.content && typeof a.content.columnIndex === 'number') ? a.content.columnIndex : 0;
      var bi = (b && b.content && typeof b.content.columnIndex === 'number') ? b.content.columnIndex : 0;
      return ai - bi;
    });

    var buckets = [];
    for (var c = 0; c < count; c++) buckets.push([]);
    var fallbackIdx = 0;
    for (var j = 0; j < sorted.length; j++) {
      var child = sorted[j];
      var ci = (child && child.content && typeof child.content.columnIndex === 'number')
        ? child.content.columnIndex
        : fallbackIdx++;
      if (ci < 0) ci = 0;
      if (ci >= count) ci = count - 1;
      buckets[ci].push(child);
    }

    var columnsHtml = '';
    for (var col = 0; col < count; col++) {
      var contentsHtml = [];
      for (var k = 0; k < buckets[col].length; k++) {
        var rendered = renderElement(buckets[col][k]);
        if (rendered) contentsHtml.push(wrapContent(rendered, k + 1));
      }
      columnsHtml += wrapColumn(contentsHtml, col + 1);
    }

    return wrapRow(columnsHtml, rowIndex, count, isFullWidth);
  }

  // Emits N rows per section: consecutive non-columns elements stack into one row;
  // each `columns` element becomes its own multi-column row, in document order.
  function renderSection(section, startRowIndex) {
    if (!section || !Array.isArray(section.elements) || section.elements.length === 0) {
      return { html: '', rowCount: 0 };
    }

    var isFullWidth = !!section.fullWidth;
    var elements = section.elements;
    var html = '';
    var rowIndex = startRowIndex;
    var buffer = [];

    function flushBuffer() {
      if (buffer.length === 0) return;
      var singleCol = wrapColumn(buffer, 1);
      html += wrapRow(singleCol, rowIndex++, 1, isFullWidth);
      buffer = [];
    }

    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      if (!el) continue;
      if (el.type === 'columns') {
        flushBuffer();
        var columnsRow = renderColumnsRow(el, rowIndex, isFullWidth);
        if (columnsRow) { html += columnsRow; rowIndex++; }
      } else {
        var rendered = renderElement(el);
        if (rendered) buffer.push(wrapContent(rendered, buffer.length + 1));
      }
    }
    flushBuffer();

    return { html: html, rowCount: rowIndex - startRowIndex };
  }

  // Section wrapper — carries the builder's section-level design across:
  // styles.desktop (backgroundColor, padding, color, …) go inline on the wrapper;
  // layout.mode 'full' makes the background span the entire viewport width
  // (breakout from any centered container, e.g. the 880px article column) while
  // layout.innerContainer re-contains the content inside the full-bleed band.
  // Mirrors the aiconeo builder's section semantics (SectionPropertiesPanel).
  function wrapSection(section, innerHtml) {
    if (!innerHtml) return '';
    var layout = (section && section.layout) || {};
    var mode = layout.mode || ((section && section.fullWidth) ? 'full' : 'contained');
    var styleStr = USE_API_INLINE_STYLES ? stylesToInline(pickStyles(section)) : '';

    var inner = innerHtml;
    var innerContainer = layout.innerContainer || {};
    if (mode === 'full' && innerContainer.enabled !== false) {
      var maxWidth = innerContainer.maxWidth || layout.maxWidth || '';
      inner = '<div class="neo-section__inner"' +
        (maxWidth ? ' style="max-width:' + escapeAttr(maxWidth) + '"' : '') +
        '>' + innerHtml + '</div>';
    }

    var classes = 'neo-section' + (mode === 'full' ? ' neo-section--full' : '');
    return '<section class="' + classes + '"' + (styleStr ? ' style="' + styleStr + '"' : '') + '>' + inner + '</section>';
  }

  function render(data) {
    if (!hasNeoContent(data)) return '';
    var neo = data.contentBuilderNeoJson;

    var html = '';
    var nextRowIndex = 1;
    for (var i = 0; i < neo.sections.length; i++) {
      var result = renderSection(neo.sections[i], nextRowIndex);
      html += wrapSection(neo.sections[i], result.html);
      nextRowIndex += result.rowCount;
    }
    return html;
  }

  // ============================================================
  // Self-contained styles for slideshow/video/youtube/gallery.
  // Injected once per page so the renderer ships its own CSS.
  // ============================================================

  var STYLES_INJECTED = false;
  var NEO_STYLES = [
    // Section shell: full-bleed color band + re-contained inner (see wrapSection).
    // 100vw includes the scrollbar gutter, so clip the body's x-overflow while a
    // full-bleed section is on the page to avoid a phantom horizontal scrollbar.
    '.neo-section{position:relative;}',
    '.neo-section--full{width:100vw;margin-left:calc(50% - 50vw);margin-right:calc(50% - 50vw);}',
    '.neo-section__inner{margin:0 auto;}',
    'body:has(.neo-section--full){overflow-x:clip;}',
    '.neo-slideshow__viewport{position:relative;overflow:hidden;border-radius:inherit;}',
    '.neo-slideshow__track{display:flex;width:100%;height:100%;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;scroll-behavior:smooth;scrollbar-width:none;-ms-overflow-style:none;}',
    '.neo-slideshow__track::-webkit-scrollbar{display:none;}',
    '.neo-slideshow__slide{flex:0 0 100%;height:100%;scroll-snap-align:start;position:relative;}',
    '.neo-slideshow__slide img{width:100%;height:100%;object-fit:cover;display:block;}',
    '.neo-slideshow__nav{position:absolute;top:50%;transform:translateY(-50%);background:rgba(0,0,0,0.5);color:#fff;border:0;width:36px;height:36px;border-radius:50%;cursor:pointer;z-index:1;font-size:16px;line-height:1;padding:0;display:flex;align-items:center;justify-content:center;}',
    '.neo-slideshow__nav--prev{left:8px;}',
    '.neo-slideshow__nav--next{right:8px;}',
    '.neo-slideshow__dots{display:flex;justify-content:center;gap:8px;margin-top:8px;}',
    '.neo-slideshow__dot{width:8px;height:8px;border-radius:50%;border:0;background:#ccc;cursor:pointer;padding:0;}',
    '.neo-slideshow__dot.is-active{background:#333;}',
    '.neo-slideshow__caption{position:absolute;inset:0;padding:24px;background:rgba(0,0,0,0.35);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:12px;}',
    '.neo-slideshow__headline{margin:0;color:#fff !important;font-size:28px;font-weight:600;line-height:1.2;}',
    '.neo-slideshow__btn{display:inline-block;padding:8px 16px;background:#fff;color:#111;text-decoration:none;border-radius:4px;}',
    '.neo-video__frame{position:relative;width:100%;}',
    '.neo-video__frame iframe,.neo-video__frame video{position:absolute;inset:0;width:100%;height:100%;border:0;}',
    '.content-type-neo-image img{max-width:100%;height:auto;display:block;}',
    // overflow:hidden so wrapper border-radius actually clips the iframe/slides inside.
    '.content-type-neo-youtube,.content-type-neo-video,.content-type-neo-slideshow{overflow:hidden;}',
    '.content-type-neo-gallery{display:grid;gap:8px;}',
    '.content-type-neo-gallery img{width:100%;height:auto;display:block;}',
    '.neo-media-gallery__title{margin:0 0 16px;}',
    '.neo-media-gallery__grid{display:grid;gap:8px;}',
    '.neo-media-gallery__item{margin:0;}',
    '.neo-media-gallery__item img{width:100%;height:auto;display:block;}',
    '.neo-media-gallery__caption{font-size:12px;color:#555;margin-top:4px;}',
    '[class*="content-type-neo-"] a{text-decoration:underline;}',
    '.neo-media-gallery__masonry{column-gap:8px;}',
    '.neo-media-gallery__masonry .neo-media-gallery__item{break-inside:avoid;margin:0 0 8px;display:block;}',
    '.neo-media-gallery__carousel{position:relative;}',
    '.neo-media-gallery__carousel-track{display:flex;gap:8px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;-ms-overflow-style:none;}',
    '.neo-media-gallery__carousel-track::-webkit-scrollbar{display:none;}',
    '.neo-media-gallery__carousel .neo-media-gallery__item{flex:0 0 calc(60% - 8px);}',
    '.neo-media-gallery__nav{position:absolute;top:50%;transform:translateY(-50%);background:rgba(0,0,0,0.5);color:#fff;border:0;width:36px;height:36px;border-radius:50%;cursor:pointer;z-index:1;font-size:16px;line-height:1;padding:0;display:flex;align-items:center;justify-content:center;}',
    '.neo-media-gallery__nav--prev{left:8px;}',
    '.neo-media-gallery__nav--next{right:8px;}',
    '.neo-media-gallery__scrubber{position:relative;height:8px;background:#e5e5e5;border-radius:4px;margin-top:16px;cursor:pointer;touch-action:none;user-select:none;overflow:hidden;}',
    '.neo-media-gallery__scrubber-thumb{position:absolute;top:0;left:0;height:100%;width:48px;background:#333;border-radius:4px;pointer-events:none;min-width:48px;display:block;}',
    '.neo-media-gallery__scrubber:hover .neo-media-gallery__scrubber-thumb{background:#111;}'
  ].join('');

  function injectStyles() {
    if (STYLES_INJECTED) return;
    STYLES_INJECTED = true;
    try {
      var style = document.createElement('style');
      style.setAttribute('data-neo-styles', '1');
      style.appendChild(document.createTextNode(NEO_STYLES));
      (document.head || document.documentElement).appendChild(style);
    } catch (e) { /* no-op */ }
  }

  // ============================================================
  // Hydration (runs after the HTML string has been injected)
  // ============================================================

  function hydrateSlideshow(root) {
    if (root.__neoWired) return;
    root.__neoWired = true;

    var track = root.querySelector('.neo-slideshow__track');
    if (!track) return;
    var slides = track.children;
    var count = slides.length;
    if (count === 0) return;

    var dots = root.querySelectorAll('.neo-slideshow__dot');
    var prev = root.querySelector('.neo-slideshow__nav--prev');
    var next = root.querySelector('.neo-slideshow__nav--next');
    var idx = 0;
    var timer = null;

    function updateDots() {
      for (var k = 0; k < dots.length; k++) {
        if (k === idx) dots[k].classList.add('is-active');
        else dots[k].classList.remove('is-active');
      }
    }

    function goTo(i) {
      if (i < 0) i = count - 1;
      if (i >= count) i = 0;
      idx = i;
      track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' });
      updateDots();
    }

    function resetAutoplay() {
      if (timer) { clearInterval(timer); timer = null; }
      if (root.getAttribute('data-autoplay') !== '1' || count < 2) return;
      var ms = parseInt(root.getAttribute('data-interval'), 10) || 5000;
      timer = setInterval(function () {
        if (!root.isConnected) { clearInterval(timer); timer = null; return; }
        goTo(idx + 1);
      }, ms);
    }

    if (prev) prev.addEventListener('click', function () { goTo(idx - 1); resetAutoplay(); });
    if (next) next.addEventListener('click', function () { goTo(idx + 1); resetAutoplay(); });
    for (var k = 0; k < dots.length; k++) {
      (function (k) {
        dots[k].addEventListener('click', function () { goTo(k); resetAutoplay(); });
      })(k);
    }

    // Track manual swipes so dots stay in sync.
    var scrollTick;
    track.addEventListener('scroll', function () {
      clearTimeout(scrollTick);
      scrollTick = setTimeout(function () {
        var w = track.clientWidth;
        if (w === 0) return;
        var i = Math.round(track.scrollLeft / w);
        if (i !== idx) { idx = i; updateDots(); }
      }, 80);
    });

    updateDots();
    resetAutoplay();
  }

  // ============================================================
  // Lightbox: click a media-gallery image → full-size singleton overlay.
  // ============================================================

  var lightbox = { el: null, imgEl: null, capEl: null, prevBtn: null, nextBtn: null, items: [], idx: 0 };

  function ensureLightbox() {
    if (lightbox.el) return;
    var el = document.createElement('div');
    el.setAttribute('data-neo-lightbox', '1');
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,0.9);display:none;align-items:center;justify-content:center;padding:40px;';
    el.innerHTML =
      '<button type="button" data-neo-lb-close aria-label="Close" style="position:absolute;top:16px;right:16px;background:rgba(0,0,0,0.5);border:0;color:#fff;width:40px;height:40px;border-radius:50%;cursor:pointer;font-size:22px;line-height:1;padding:0;display:flex;align-items:center;justify-content:center;z-index:2;">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' +
      '</button>' +
      '<button type="button" data-neo-lb-prev aria-label="Previous" style="position:absolute;top:50%;left:16px;transform:translateY(-50%);background:rgba(0,0,0,0.5);border:0;color:#fff;width:48px;height:48px;border-radius:50%;cursor:pointer;font-size:20px;display:flex;align-items:center;justify-content:center;z-index:1;">&#10094;</button>' +
      '<button type="button" data-neo-lb-next aria-label="Next" style="position:absolute;top:50%;right:16px;transform:translateY(-50%);background:rgba(0,0,0,0.5);border:0;color:#fff;width:48px;height:48px;border-radius:50%;cursor:pointer;font-size:20px;display:flex;align-items:center;justify-content:center;z-index:1;">&#10095;</button>' +
      '<div data-neo-lb-stage style="max-width:90vw;max-height:90vh;display:flex;flex-direction:column;align-items:center;gap:12px;">' +
        '<img data-neo-lb-img alt="" style="max-width:100%;max-height:80vh;object-fit:contain;display:block;">' +
        '<div data-neo-lb-cap style="color:#fff;text-align:center;font-size:14px;display:none;"></div>' +
      '</div>';
    document.body.appendChild(el);

    lightbox.el = el;
    lightbox.imgEl = el.querySelector('[data-neo-lb-img]');
    lightbox.capEl = el.querySelector('[data-neo-lb-cap]');
    lightbox.prevBtn = el.querySelector('[data-neo-lb-prev]');
    lightbox.nextBtn = el.querySelector('[data-neo-lb-next]');

    el.querySelector('[data-neo-lb-close]').addEventListener('click', closeLightbox);
    lightbox.prevBtn.addEventListener('click', function () { stepLightbox(-1); });
    lightbox.nextBtn.addEventListener('click', function () { stepLightbox(1); });
    el.addEventListener('click', function (e) { if (e.target === el) closeLightbox(); });
    document.addEventListener('keydown', function (e) {
      if (!lightbox.el || lightbox.el.style.display !== 'flex') return;
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowLeft') stepLightbox(-1);
      else if (e.key === 'ArrowRight') stepLightbox(1);
    });
  }

  function showLightboxItem() {
    var item = lightbox.items[lightbox.idx];
    if (!item) return;
    lightbox.imgEl.src = item.src;
    lightbox.imgEl.alt = item.alt || '';
    if (item.caption) {
      lightbox.capEl.textContent = item.caption;
      lightbox.capEl.style.display = 'block';
    } else {
      lightbox.capEl.textContent = '';
      lightbox.capEl.style.display = 'none';
    }
    var many = lightbox.items.length > 1;
    lightbox.prevBtn.style.display = many ? 'flex' : 'none';
    lightbox.nextBtn.style.display = many ? 'flex' : 'none';
  }

  function openLightbox(items, idx) {
    if (!items || items.length === 0) return;
    ensureLightbox();
    lightbox.items = items;
    lightbox.idx = Math.max(0, Math.min(items.length - 1, idx || 0));
    showLightboxItem();
    lightbox.el.style.display = 'flex';
    lightbox.el.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    if (!lightbox.el) return;
    lightbox.el.style.display = 'none';
    lightbox.el.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    lightbox.items = [];
    lightbox.idx = 0;
  }

  function stepLightbox(dir) {
    if (lightbox.items.length === 0) return;
    var n = lightbox.items.length;
    lightbox.idx = (lightbox.idx + dir + n) % n;
    showLightboxItem();
  }

  function hydrateMediaGalleryLightbox(root) {
    if (root.__neoLbWired) return;
    root.__neoLbWired = true;

    var imgs = root.querySelectorAll('.neo-media-gallery__item img');
    for (var i = 0; i < imgs.length; i++) imgs[i].style.cursor = 'zoom-in';

    root.addEventListener('click', function (e) {
      var img = e.target && e.target.tagName === 'IMG' ? e.target : null;
      if (!img || !img.closest('.neo-media-gallery__item')) return;
      var all = root.querySelectorAll('.neo-media-gallery__item img');
      var items = [];
      var startIdx = 0;
      for (var k = 0; k < all.length; k++) {
        var fig = all[k].closest('.neo-media-gallery__item');
        var capNode = fig ? fig.querySelector('.neo-media-gallery__caption') : null;
        items.push({
          src: all[k].getAttribute('src') || all[k].src,
          alt: all[k].getAttribute('alt') || '',
          caption: capNode ? capNode.textContent.trim() : ''
        });
        if (all[k] === img) startIdx = k;
      }
      openLightbox(items, startIdx);
    });
  }

  function hydrateMediaGalleryCarousel(root) {
    if (root.__neoWired) return;
    root.__neoWired = true;
    var track = root.querySelector('.neo-media-gallery__carousel-track');
    if (!track) return;
    var prev = root.querySelector('.neo-media-gallery__nav--prev');
    var next = root.querySelector('.neo-media-gallery__nav--next');
    var scrubber = root.querySelector('.neo-media-gallery__scrubber');
    var thumb = root.querySelector('.neo-media-gallery__scrubber-thumb');

    function snapToItem(dir) {
      var firstItem = track.querySelector('.neo-media-gallery__item');
      var step = firstItem ? firstItem.offsetWidth + 8 : track.clientWidth;
      if (step <= 0) return;
      var current = track.scrollLeft / step;
      var nearest = Math.round(current);
      // If we're already sitting on (or sub-pixel near) an item slot, step away from it.
      // Otherwise floor/ceil to the next slot in the requested direction.
      var targetIdx = (Math.abs(current - nearest) < 0.1)
        ? nearest + dir
        : (dir > 0 ? Math.ceil(current) : Math.floor(current));
      if (targetIdx < 0) targetIdx = 0;
      track.scrollTo({ left: targetIdx * step, behavior: 'smooth' });
    }
    if (prev) prev.addEventListener('click', function () { snapToItem(-1); });
    if (next) next.addEventListener('click', function () { snapToItem(1); });

    if (!scrubber || !thumb) return;

    function updateThumb() {
      var sw = track.scrollWidth;
      var cw = track.clientWidth;
      if (sw <= cw) { thumb.style.width = '100%'; thumb.style.left = '0'; return; }
      var widthPct = (cw / sw) * 100;
      var leftPct = (track.scrollLeft / (sw - cw)) * (100 - widthPct);
      thumb.style.width = widthPct + '%';
      thumb.style.left = leftPct + '%';
    }

    var ticking = false;
    track.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { updateThumb(); ticking = false; });
    });
    window.addEventListener('resize', updateThumb);

    function pointerToScrollLeft(clientX) {
      var rect = scrubber.getBoundingClientRect();
      var ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      var sw = track.scrollWidth;
      var cw = track.clientWidth;
      return ratio * (sw - cw);
    }

    var dragging = false;
    scrubber.addEventListener('pointerdown', function (e) {
      dragging = true;
      scrubber.setPointerCapture(e.pointerId);
      track.scrollLeft = pointerToScrollLeft(e.clientX);
    });
    scrubber.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      track.scrollLeft = pointerToScrollLeft(e.clientX);
    });
    scrubber.addEventListener('pointerup', function (e) {
      dragging = false;
      if (scrubber.hasPointerCapture && scrubber.hasPointerCapture(e.pointerId)) {
        scrubber.releasePointerCapture(e.pointerId);
      }
    });
    scrubber.addEventListener('pointercancel', function () { dragging = false; });

    // Defer to after layout (initial scrollWidth/clientWidth can both be 0),
    // and re-run when the track resizes (lazy images, viewport changes).
    requestAnimationFrame(updateThumb);
    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(updateThumb);
      ro.observe(track);
    }
  }

  function hydrate(root) {
    injectStyles();
    var scope = root && root.querySelectorAll ? root : document;
    var slideshows = scope.querySelectorAll('[data-neo-slideshow="1"]');
    for (var i = 0; i < slideshows.length; i++) hydrateSlideshow(slideshows[i]);
    var carousels = scope.querySelectorAll('[data-neo-mg-carousel="1"]');
    for (var j = 0; j < carousels.length; j++) hydrateMediaGalleryCarousel(carousels[j]);
    var galleries = scope.querySelectorAll('.content-type-neo-media-gallery');
    for (var k = 0; k < galleries.length; k++) hydrateMediaGalleryLightbox(galleries[k]);
  }

  // ============================================================
  // Public API
  // ============================================================

  window.NewsNeo = {
    hasContent: hasNeoContent,
    render: render,
    hydrate: hydrate,
    registerType: function (type, fn) {
      if (typeof type === 'string' && typeof fn === 'function') {
        renderers[type] = fn;
      }
    },
    _renderers: renderers
  };

})(window);
