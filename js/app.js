/* =========================================================
   Image-to-PDF — client-side only.
   Uses: pdf-lib (UMD) + SortableJS (UMD) loaded via CDN,
   heic2any lazy-loaded only when an HEIC file is added.
   ---------------------------------------------------------
   Image pipeline (single unified path):
   every image goes through <canvas> before embedding, which
   - bakes the user's rotation into the pixels (no pdf-lib
     rotate needed — pdf-lib rotates about the image corner,
     which misplaces the image),
   - normalizes EXIF orientation (phone portrait photos),
   - caps the longest edge at the chosen resolution,
   - flattens transparency over white (documents, not photos).
   ========================================================= */
(function () {
  'use strict';

  // ---------- State ----------
  /** @type {Array<{id:string,file:File,name:string,url:string,width:number,height:number,rotation:number}>} */
  var images = [];
  var sortableInstance = null;
  var heic2anyPromise = null;

  // ---------- DOM ----------
  var $ = function (id) { return document.getElementById(id); };
  var dropzone = $('dropzone');
  var fileInput = $('fileInput');
  var gallerySection = $('gallerySection');
  var gallery = $('gallery');
  var settingsSection = $('settingsSection');
  var convertSection = $('convertSection');
  var convertBtn = $('convertBtn');
  var clearAllBtn = $('clearAll');
  var progressWrap = $('progressWrap');
  var progressFill = $('progressFill');
  var progressText = $('progressText');
  var errorBox = $('errorBox');
  var pageSizeEl = $('pageSize');
  var orientationEl = $('orientation');
  var marginsEl = $('margins');
  var qualityEl = $('quality');
  var resolutionEl = $('resolution');
  var fileNameEl = $('fileName');
  var langToggle = $('langToggle');
  var themeToggle = $('themeToggle');
  var yearEl = $('year');

  // Lightbox
  var lightbox = $('lightbox');
  var lbImage = $('lbImage');
  var lbFilename = $('lbFilename');
  var lbCounter = $('lbCounter');
  var lbClose = $('lbClose');
  var lbPrev = $('lbPrev');
  var lbNext = $('lbNext');
  var lbRotate = $('lbRotate');
  var lbDelete = $('lbDelete');
  var lbOk = $('lbOk');
  var lbImageWrap = $('lbImageWrap');
  var currentPreviewId = null;

  // ---------- Constants ----------
  var A4 = { w: 595.28, h: 841.89 };
  var LETTER = { w: 612, h: 792 };
  var MARGINS = { none: 0, small: 18, large: 42 };
  var QUALITY_MAP = { high: 0.92, medium: 0.75, low: 0.55 };
  var RESOLUTION_MAP = { large: 2480, medium: 1600, original: Infinity };
  var ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
  var HEIC_TYPES = ['image/heic', 'image/heif'];
  var HEIC2ANY_URL = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
  var DEFAULT_BASENAME = 'ImagesToPdf';
  var t = window.t;

  // ---------- Init ----------
  function init() {
    applyThemeOnLoad();
    applyLangOnLoad();
    bindEvents();
    bindLightboxEvents();
    initSortable();
    if (yearEl) yearEl.textContent = new Date().getFullYear();
    updateVisibility();
  }

  // ---------- Theme / Lang persistence ----------
  function applyThemeOnLoad() {
    if (localStorage.getItem('theme') === 'dark') {
      document.documentElement.classList.add('dark');
      if (themeToggle) themeToggle.textContent = '☀️';
    }
  }
  function applyLangOnLoad() {
    var lang = window.getLang();
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'en' ? 'ltr' : 'rtl';
    if (langToggle) langToggle.textContent = lang === 'en' ? 'AR' : 'EN';
    window.applyI18n();
  }

  // ---------- Events ----------
  function bindEvents() {
    // Dropzone click
    dropzone.addEventListener('click', function () { fileInput.click(); });
    dropzone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
    });

    // File input
    fileInput.addEventListener('change', function (e) {
      addFiles(e.target.files);
      fileInput.value = '';
    });

    // Drag & drop on dropzone
    ['dragenter', 'dragover'].forEach(function (ev) {
      dropzone.addEventListener(ev, function (e) {
        e.preventDefault(); e.stopPropagation();
        dropzone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dropzone.addEventListener(ev, function (e) {
        e.preventDefault(); e.stopPropagation();
        dropzone.classList.remove('dragover');
      });
    });
    dropzone.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
    });

    // Prevent page-wide drop from opening files
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); });

    // Clear all
    clearAllBtn.addEventListener('click', clearAll);

    // Reverse order
    var reverseBtn = $('reverseOrder');
    if (reverseBtn) reverseBtn.addEventListener('click', reverseOrder);

    // Settings: disable orientation when "image" size selected
    pageSizeEl.addEventListener('change', function () {
      orientationEl.disabled = pageSizeEl.value === 'image';
    });

    // Sanitize filename input as user types (no slashes, no weird chars)
    if (fileNameEl) {
      fileNameEl.addEventListener('input', function () {
        var cleaned = fileNameEl.value.replace(/[\\/:*?"<>|]+/g, '');
        if (cleaned !== fileNameEl.value) fileNameEl.value = cleaned;
      });
    }

    // Convert
    convertBtn.addEventListener('click', convertToPdf);

    // Theme toggle
    if (themeToggle) {
      themeToggle.addEventListener('click', function () {
        document.documentElement.classList.toggle('dark');
        var dark = document.documentElement.classList.contains('dark');
        localStorage.setItem('theme', dark ? 'dark' : 'light');
        themeToggle.textContent = dark ? '☀️' : '🌙';
      });
    }

    // Lang toggle
    if (langToggle) {
      langToggle.addEventListener('click', function () {
        var cur = window.getLang();
        var next = cur === 'ar' ? 'en' : 'ar';
        localStorage.setItem('lang', next);
        if (next === 'en') {
          location.href = '/en/';
        } else {
          location.href = '/';
        }
      });
    }
  }

  // ---------- Sortable ----------
  function initSortable() {
    if (typeof Sortable === 'undefined') return;
    sortableInstance = new Sortable(gallery, {
      animation: 150,
      ghostClass: 'sortable-ghost',
      dragClass: 'sortable-drag',
      // Drag starts from the visible ⋮⋮ handle only: on touch screens this
      // keeps scrolling working everywhere else on the thumbnail.
      handle: '.thumb-handle',
      // On touch screens a small delay avoids fighting with scroll gestures.
      delay: 120,
      delayOnTouchOnly: true,
      scroll: true,
      scrollSensitivity: 90,
      scrollSpeed: 12,
      bubbleScroll: true,
      onStart: function () {
        gallery.classList.remove('show-hint');
      },
      onEnd: function () {
        gallery.classList.remove('show-hint');
        var newOrder = [];
        gallery.querySelectorAll('li.thumb').forEach(function (li) {
          var id = li.getAttribute('data-id');
          var img = images.find(function (x) { return x.id === id; });
          if (img) newOrder.push(img);
        });
        images = newOrder;
        renumberThumbnails();
      }
    });
  }

  // ---------- Adding files ----------
  function isHeicFile(f) {
    if (HEIC_TYPES.indexOf(f.type) !== -1) return true;
    return /\.hei[cf]$/i.test(f.name || '');
  }

  // Lazy-load heic2any only when the first HEIC file shows up,
  // so JPG/PNG users never pay the ~1.3MB download.
  function loadHeic2Any() {
    if (heic2anyPromise) return heic2anyPromise;
    heic2anyPromise = new Promise(function (resolve, reject) {
      if (typeof window.heic2any !== 'undefined') { resolve(); return; }
      var s = document.createElement('script');
      s.src = HEIC2ANY_URL;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('heic2any failed to load')); };
      document.head.appendChild(s);
    });
    return heic2anyPromise;
  }

  function convertHeicFile(file) {
    return loadHeic2Any().then(function () {
      return window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    }).then(function (result) {
      var blob = Array.isArray(result) ? result[0] : result;
      if (!blob) throw new Error('HEIC conversion returned nothing');
      var base = (file.name || 'image').replace(/\.hei[cf]$/i, '') || 'image';
      return new File([blob], base + '.jpg', { type: 'image/jpeg' });
    });
  }

  async function addFiles(fileList) {
    if (!fileList || !fileList.length) return;
    hideError();

    var rejected = [];
    var queue = [];
    for (var i = 0; i < fileList.length; i++) {
      var f = fileList[i];
      if (ACCEPTED.indexOf(f.type) !== -1) {
        queue.push({ file: f, heic: false });
      } else if (isHeicFile(f)) {
        queue.push({ file: f, heic: true });
      } else {
        rejected.push(f.name || 'file');
      }
    }

    for (var q = 0; q < queue.length; q++) {
      var entry = queue[q];
      try {
        if (entry.heic) showProgress(0, t('progress.heic'));
        var file = entry.heic ? await convertHeicFile(entry.file) : entry.file;
        var meta = await loadImageMeta(file);
        if (!meta) { rejected.push(entry.file.name || 'file'); continue; }
        images.push(meta);
        renderThumb(meta);
      } catch (err) {
        console.warn('Skipping file:', entry.file && entry.file.name, err);
        if (err && err.message === 'heic2any failed to load') {
          showError(t('error.heicNoLib', { list: entry.file.name || 'file' }));
          hideProgress();
          return;
        }
        rejected.push(entry.file.name || 'file');
      } finally {
        hideProgress();
      }
    }

    if (rejected.length) {
      showError(t('error.invalidFiles', { list: rejected.join(', ') }));
    }
    updateVisibility();
    renumberThumbnails();
  }

  function loadImageMeta(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        resolve({
          id: 'img_' + Math.random().toString(36).slice(2, 10),
          file: file,
          name: file.name || 'image',
          url: url,
          width: img.naturalWidth || img.width,
          height: img.naturalHeight || img.height,
          rotation: 0
        });
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }

  function loadHtmlImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('Failed to decode image')); };
      img.src = url;
    });
  }

  // ---------- Rendering ----------
  function renderThumb(item) {
    var li = document.createElement('li');
    li.className = 'thumb';
    li.setAttribute('data-id', item.id);

    var idx = document.createElement('span');
    idx.className = 'thumb-index';
    idx.textContent = '';

    var handle = document.createElement('span');
    handle.className = 'thumb-handle';
    handle.textContent = '⋮⋮';
    handle.title = t('gallery.handle');
    handle.setAttribute('aria-label', t('gallery.handle'));

    var zoomBtn = document.createElement('button');
    zoomBtn.type = 'button';
    zoomBtn.className = 'thumb-zoom';
    zoomBtn.textContent = '🔍';
    zoomBtn.title = t('lightbox.preview');
    zoomBtn.setAttribute('aria-label', t('lightbox.preview'));
    zoomBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      openLightbox(item.id);
    });

    var imgWrap = document.createElement('div');
    imgWrap.className = 'thumb-img-wrap';
    var img = document.createElement('img');
    img.src = item.url;
    img.alt = item.name;
    img.loading = 'lazy';
    imgWrap.appendChild(img);

    var meta = document.createElement('div');
    meta.className = 'thumb-meta';
    var nameEl = document.createElement('span');
    nameEl.className = 'thumb-name';
    nameEl.textContent = item.name;
    nameEl.title = item.name;
    var dimsEl = document.createElement('span');
    dimsEl.className = 'thumb-dims';
    dimsEl.textContent = item.width + ' × ' + item.height;
    meta.appendChild(nameEl);
    meta.appendChild(dimsEl);

    var actions = document.createElement('div');
    actions.className = 'thumb-actions';

    // In RTL the first page is on the right, so "earlier" points right.
    var isRtl = window.getLang() !== 'en';
    var earlierBtn = document.createElement('button');
    earlierBtn.type = 'button';
    earlierBtn.textContent = isRtl ? '▶' : '◀';
    earlierBtn.title = t('gallery.moveEarlier');
    earlierBtn.setAttribute('aria-label', t('gallery.moveEarlier'));
    earlierBtn.addEventListener('click', function () { moveItem(item.id, -1); });

    var laterBtn = document.createElement('button');
    laterBtn.type = 'button';
    laterBtn.textContent = isRtl ? '◀' : '▶';
    laterBtn.title = t('gallery.moveLater');
    laterBtn.setAttribute('aria-label', t('gallery.moveLater'));
    laterBtn.addEventListener('click', function () { moveItem(item.id, 1); });

    var rotateBtn = document.createElement('button');
    rotateBtn.type = 'button';
    rotateBtn.textContent = '⟳';
    rotateBtn.title = t('gallery.rotate');
    rotateBtn.setAttribute('aria-label', t('gallery.rotate'));
    rotateBtn.addEventListener('click', function () { rotateItem(item.id); });

    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'del';
    delBtn.textContent = '✕';
    delBtn.title = t('gallery.delete');
    delBtn.setAttribute('aria-label', t('gallery.delete'));
    delBtn.addEventListener('click', function () { deleteItem(item.id); });

    actions.appendChild(earlierBtn);
    actions.appendChild(laterBtn);
    actions.appendChild(rotateBtn);
    actions.appendChild(delBtn);

    li.appendChild(idx);
    li.appendChild(handle);
    li.appendChild(zoomBtn);
    li.appendChild(imgWrap);
    li.appendChild(meta);
    li.appendChild(actions);
    gallery.appendChild(li);
  }

  // Re-apply the images[] order to the DOM (used by arrows + reverse).
  function syncGalleryOrder() {
    var map = {};
    gallery.querySelectorAll('li.thumb').forEach(function (li) {
      map[li.getAttribute('data-id')] = li;
    });
    images.forEach(function (item) {
      if (map[item.id]) gallery.appendChild(map[item.id]);
    });
    renumberThumbnails();
  }

  // Move one step toward the start (dir=-1) or the end (dir=+1) of the PDF.
  function moveItem(id, dir) {
    var i = images.findIndex(function (x) { return x.id === id; });
    var j = i + dir;
    if (i < 0 || j < 0 || j >= images.length) return;
    var tmp = images[i];
    images[i] = images[j];
    images[j] = tmp;
    syncGalleryOrder();
  }

  function reverseOrder() {
    images.reverse();
    syncGalleryOrder();
  }

  function renumberThumbnails() {
    gallery.querySelectorAll('li.thumb').forEach(function (li, i) {
      var badge = li.querySelector('.thumb-index');
      if (badge) badge.textContent = String(i + 1);
    });
  }

  // Dimensions label follows the rotation, since rotation is baked
  // into the PDF output.
  function updateThumbDims(id) {
    var item = images.find(function (x) { return x.id === id; });
    if (!item) return;
    var li = gallery.querySelector('li[data-id="' + id + '"]');
    if (!li) return;
    var dimsEl = li.querySelector('.thumb-dims');
    if (!dimsEl) return;
    var r = ((item.rotation % 360) + 360) % 360;
    dimsEl.textContent = (r === 90 || r === 270)
      ? (item.height + ' × ' + item.width)
      : (item.width + ' × ' + item.height);
  }

  // ---------- Item actions ----------
  function rotateItem(id) {
    var item = images.find(function (x) { return x.id === id; });
    if (!item) return;
    item.rotation = (item.rotation + 90) % 360;
    var li = gallery.querySelector('li[data-id="' + id + '"]');
    if (li) {
      var img = li.querySelector('.thumb-img-wrap img');
      if (img) img.style.transform = 'rotate(' + item.rotation + 'deg)';
    }
    updateThumbDims(id);
  }

  function deleteItem(id) {
    var idx = images.findIndex(function (x) { return x.id === id; });
    if (idx === -1) return;
    var item = images[idx];
    try { URL.revokeObjectURL(item.url); } catch (e) { /* noop */ }
    images.splice(idx, 1);
    var li = gallery.querySelector('li[data-id="' + id + '"]');
    if (li && li.parentNode) li.parentNode.removeChild(li);
    updateVisibility();
    renumberThumbnails();
  }

  function clearAll() {
    images.forEach(function (item) {
      try { URL.revokeObjectURL(item.url); } catch (e) { /* noop */ }
    });
    images = [];
    gallery.innerHTML = '';
    hideError();
    updateVisibility();
    hideProgress();
  }

  // ---------- Visibility ----------
  function updateVisibility() {
    var hasImages = images.length > 0;
    gallerySection.classList.toggle('hidden', !hasImages);
    settingsSection.classList.toggle('hidden', !hasImages);
    convertSection.classList.toggle('hidden', !hasImages);
    // Pulse the drag handles the first time 2+ images are shown,
    // so the student discovers reordering. Removed on first drag.
    if (images.length > 1) gallery.classList.add('show-hint');
  }

  // ---------- Progress / errors ----------
  function showProgress(pct, text) {
    progressWrap.classList.remove('hidden');
    progressFill.style.width = Math.max(0, Math.min(100, pct)) + '%';
    progressText.textContent = text || '';
  }
  function hideProgress() {
    progressWrap.classList.add('hidden');
    progressFill.style.width = '0%';
    progressText.textContent = '';
  }
  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.classList.remove('hidden');
  }
  function hideError() {
    errorBox.classList.add('hidden');
    errorBox.textContent = '';
  }

  // ---------- PDF conversion ----------
  async function convertToPdf() {
    if (!images.length) return;
    if (typeof PDFLib === 'undefined') {
      showError('PDF library failed to load. Please check your connection and reload.');
      return;
    }

    hideError();
    hideProgress();
    convertBtn.disabled = true;
    showProgress(2, t('progress.preparing'));

    var quality = QUALITY_MAP[qualityEl.value] || 0.92;
    var maxDim = RESOLUTION_MAP[resolutionEl.value];
    if (!maxDim) maxDim = 2480;
    var pageSizeMode = pageSizeEl.value;
    var orientation = orientationEl.disabled ? 'portrait' : orientationEl.value;
    var margin = MARGINS[marginsEl.value] || 0;
    var skipped = [];

    try {
      var PDFDocument = PDFLib.PDFDocument;
      var pdfDoc = await PDFDocument.create();

      var total = images.length;
      for (var i = 0; i < total; i++) {
        var item = images[i];
        showProgress(
          Math.round((i / total) * 90),
          t('progress.processing', { i: i + 1, n: total })
        );
        await new Promise(function (r) { setTimeout(r, 0); });

        try {
          // Single unified path: canvas normalizes rotation + EXIF +
          // resolution, then we embed the resulting JPEG bytes.
          var prepared = await prepareImageItem(item, quality, maxDim);
          var embedded = await pdfDoc.embedJpg(prepared.data);
          addImagePage(pdfDoc, embedded, {
            pageSizeMode: pageSizeMode,
            orientation: orientation,
            margin: margin
          });
        } catch (err) {
          console.warn('Skipping image:', item.name, err);
          skipped.push(item.name);
        }
      }

      if (pdfDoc.getPageCount() === 0) {
        showError(t('error.none'));
        hideProgress();
        return;
      }

      showProgress(95, t('progress.saving'));
      await new Promise(function (r) { setTimeout(r, 0); });

      var bytes = await pdfDoc.save();
      var blob = new Blob([bytes], { type: 'application/pdf' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = buildFilename();
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 30000);

      showProgress(100, t('progress.done'));
      if (skipped.length) {
        showError(t('error.skipped', { list: skipped.join(', ') }));
      }

      // Hide progress bar shortly after completion
      setTimeout(function () { hideProgress(); }, 1800);

    } catch (err) {
      console.error(err);
      showError('Conversion failed: ' + (err && err.message ? err.message : String(err)));
      hideProgress();
    } finally {
      convertBtn.disabled = false;
    }
  }

  /**
   * Normalize one image through <canvas> and return JPEG bytes.
   * - rotation is baked into the pixels (drawImage rotate in pdf-lib
   *   pivots around the image corner and misplaces the page),
   * - EXIF orientation is applied by the browser when drawing, so the
   *   output has no EXIF tag for PDF viewers to misread,
   * - the longest edge is capped at maxDim,
   * - transparency is flattened over white.
   * Returns { data: ArrayBuffer, width, height } of the final image.
   */
  function prepareImageItem(item, quality, maxDim) {
    return loadHtmlImage(item.url).then(function (img) {
      var rot = ((item.rotation % 360) + 360) % 360;
      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;

      // Final (post-rotation) dimensions.
      var outW = (rot === 90 || rot === 270) ? h : w;
      var outH = (rot === 90 || rot === 270) ? w : h;

      var scale = 1;
      var longest = Math.max(outW, outH);
      if (longest > maxDim) scale = maxDim / longest;

      var cw = Math.max(1, Math.round(outW * scale));
      var ch = Math.max(1, Math.round(outH * scale));

      var canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      var ctx = canvas.getContext('2d');

      // White background FIRST, in untransformed space, so transparent
      // PNGs never end up with black regions after rotation.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cw, ch);

      // Rotate about the canvas center, draw the image centered.
      ctx.save();
      ctx.translate(cw / 2, ch / 2);
      if (rot) ctx.rotate(rot * Math.PI / 180);
      var dw = w * scale;
      var dh = h * scale;
      ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();

      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (!blob) { reject(new Error('Failed to encode image')); return; }
          blob.arrayBuffer().then(function (buf) {
            resolve({ data: buf, width: cw, height: ch });
          }, reject);
        }, 'image/jpeg', quality);
      });
    });
  }

  function addImagePage(pdfDoc, embedded, opts) {
    // embedded dims are already final (rotation baked, EXIF normalized).
    var imgW = embedded.width;
    var imgH = embedded.height;

    var pageW, pageH;
    if (opts.pageSizeMode === 'image') {
      pageW = imgW + opts.margin * 2;
      pageH = imgH + opts.margin * 2;
    } else {
      var base = opts.pageSizeMode === 'letter' ? LETTER : A4;
      if (opts.orientation === 'landscape') {
        pageW = base.h;
        pageH = base.w;
      } else {
        pageW = base.w;
        pageH = base.h;
      }
    }

    var page = pdfDoc.addPage([pageW, pageH]);

    var availW = Math.max(1, pageW - opts.margin * 2);
    var availH = Math.max(1, pageH - opts.margin * 2);

    var scale = Math.min(availW / imgW, availH / imgH);
    var drawW = imgW * scale;
    var drawH = imgH * scale;

    var x = (pageW - drawW) / 2;
    var y = (pageH - drawH) / 2;

    // No rotate here: rotation is already baked into the pixels.
    page.drawImage(embedded, { x: x, y: y, width: drawW, height: drawH });
  }

  // ---------- Filename ----------
  function buildFilename() {
    // Sanitize whatever the user typed (if anything).
    var base = '';
    if (fileNameEl) base = (fileNameEl.value || '').trim();
    base = base.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();

    // Case 1: user provided a name → use it as-is, no date appended.
    if (base) {
      return base + '.pdf';
    }

    // Case 2: no name → default base + timestamp for uniqueness.
    var d = new Date();
    var pad = function (n) {
      n = Number(n) || 0;
      return n < 10 ? '0' + n : String(n);
    };
    var stamp =
      d.getFullYear() + '-' +
      pad(d.getMonth() + 1) + '-' +
      pad(d.getDate()) + '-' +
      pad(d.getHours()) + '-' +
      pad(d.getMinutes());

    return DEFAULT_BASENAME + '-' + stamp + '.pdf';
  }

  // ---------- Lightbox / Preview ----------
  function openLightbox(id) {
    if (!lightbox) return;
    var idx = images.findIndex(function (x) { return x.id === id; });
    if (idx === -1) return;
    currentPreviewId = id;
    renderLightbox();
    lightbox.classList.add('open');
    lightbox.setAttribute('aria-hidden', 'false');
    document.body.classList.add('lightbox-open');
    setTimeout(function () { lbClose.focus(); }, 50);
  }

  function closeLightbox() {
    lightbox.classList.remove('open');
    lightbox.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('lightbox-open');
    currentPreviewId = null;
  }

  function renderLightbox() {
    var idx = images.findIndex(function (x) { return x.id === currentPreviewId; });
    if (idx === -1) { closeLightbox(); return; }
    var item = images[idx];

    lbImage.src = item.url;
    lbImage.alt = item.name;
    lbImage.style.transform = 'rotate(' + item.rotation + 'deg)';
    lbFilename.textContent = item.name;
    lbFilename.title = item.name;
    lbCounter.textContent = (idx + 1) + ' / ' + images.length;

    lbPrev.disabled = images.length < 2;
    lbNext.disabled = images.length < 2;
  }

  function lightboxNavigate(delta) {
    if (!currentPreviewId || images.length < 2) return;
    var idx = images.findIndex(function (x) { return x.id === currentPreviewId; });
    if (idx === -1) return;
    var next = (idx + delta + images.length) % images.length;
    currentPreviewId = images[next].id;
    renderLightbox();
  }

  function lightboxRotate() {
    if (!currentPreviewId) return;
    var item = images.find(function (x) { return x.id === currentPreviewId; });
    if (!item) return;
    item.rotation = (item.rotation + 90) % 360;
    lbImage.style.transform = 'rotate(' + item.rotation + 'deg)';
    var li = gallery.querySelector('li[data-id="' + item.id + '"]');
    if (li) {
      var thumbImg = li.querySelector('.thumb-img-wrap img');
      if (thumbImg) thumbImg.style.transform = 'rotate(' + item.rotation + 'deg)';
    }
    updateThumbDims(item.id);
  }

  function lightboxDelete() {
    if (!currentPreviewId) return;
    var id = currentPreviewId;
    var idx = images.findIndex(function (x) { return x.id === id; });
    if (idx === -1) return;

    if (images.length === 1) {
      deleteItem(id);
      closeLightbox();
      return;
    }

    var nextIdx = idx < images.length - 1 ? idx + 1 : idx - 1;
    var nextId = images[nextIdx].id;

    deleteItem(id);
    currentPreviewId = nextId;
    renderLightbox();
  }

  // ---------- Lightbox events ----------
  function bindLightboxEvents() {
    if (!lightbox || !lbClose || !lbOk || !lbRotate || !lbDelete || !lbPrev || !lbNext || !lbImageWrap) {
      console.error('[Lightbox] Missing DOM elements — check the HTML markup.');
      return;
    }

    lbClose.addEventListener('click', closeLightbox);
    lbOk.addEventListener('click', closeLightbox);
    lbRotate.addEventListener('click', lightboxRotate);
    lbDelete.addEventListener('click', lightboxDelete);
    lbPrev.addEventListener('click', function () { lightboxNavigate(-1); });
    lbNext.addEventListener('click', function () { lightboxNavigate(1); });

    lightbox.addEventListener('click', function (e) {
      if (e.target === lightbox || e.target === lbImageWrap) closeLightbox();
    });

    document.addEventListener('keydown', function (e) {
      if (!lightbox.classList.contains('open')) return;
      if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); lightboxNavigate(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); lightboxNavigate(1); }
    });

    var touchStartX = 0, touchStartY = 0, touchActive = false;
    lbImageWrap.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      touchActive = true;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });

    lbImageWrap.addEventListener('touchend', function (e) {
      if (!touchActive) return;
      touchActive = false;
      var t = e.changedTouches[0];
      var dx = t.clientX - touchStartX;
      var dy = t.clientY - touchStartY;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) lightboxNavigate(1);
        else lightboxNavigate(-1);
      }
    }, { passive: true });
  }

  // ---------- Boot ----------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
