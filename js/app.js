/* =========================================================
   Image-to-PDF — client-side only.
   Uses: pdf-lib (UMD) + SortableJS (UMD) loaded via CDN.
   ========================================================= */
(function () {
  'use strict';

  // ---------- State ----------
  /** @type {Array<{id:string,file:File,name:string,url:string,width:number,height:number,rotation:number}>} */
  var images = [];
  var sortableInstance = null;

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
  var ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
  var DEFAULT_BASENAME = 'ImagesToPdf';

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
      onEnd: function () {
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
  function addFiles(fileList) {
    if (!fileList || !fileList.length) return;
    hideError();
    var validFiles = [];
    for (var i = 0; i < fileList.length; i++) {
      var f = fileList[i];
      if (ACCEPTED.indexOf(f.type) !== -1) validFiles.push(f);
    }
    if (!validFiles.length) return;

    var tasks = validFiles.map(function (f) { return loadImageMeta(f); });
    Promise.all(tasks).then(function (results) {
      results.forEach(function (meta) {
        if (!meta) return;
        images.push(meta);
        renderThumb(meta);
      });
      updateVisibility();
      renumberThumbnails();
    });
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

  // ---------- Rendering ----------
  function renderThumb(item) {
    var li = document.createElement('li');
    li.className = 'thumb';
    li.setAttribute('data-id', item.id);

    var idx = document.createElement('span');
    idx.className = 'thumb-index';
    idx.textContent = '';

    var zoomBtn = document.createElement('button');
    zoomBtn.type = 'button';
    zoomBtn.className = 'thumb-zoom';
    zoomBtn.textContent = '🔍';
    zoomBtn.title = window.t('lightbox.preview');
    zoomBtn.setAttribute('aria-label', window.t('lightbox.preview'));
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

    var rotateBtn = document.createElement('button');
    rotateBtn.type = 'button';
    rotateBtn.textContent = '⟳';
    rotateBtn.title = 'تدوير 90°';
    rotateBtn.setAttribute('aria-label', 'Rotate 90 degrees');
    rotateBtn.addEventListener('click', function () { rotateItem(item.id); });

    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'del';
    delBtn.textContent = '✕';
    delBtn.title = 'حذف';
    delBtn.setAttribute('aria-label', 'Delete');
    delBtn.addEventListener('click', function () { deleteItem(item.id); });

    actions.appendChild(rotateBtn);
    actions.appendChild(delBtn);

    li.appendChild(idx);
    li.appendChild(zoomBtn);
    li.appendChild(imgWrap);
    li.appendChild(meta);
    li.appendChild(actions);
    gallery.appendChild(li);
  }

  function renumberThumbnails() {
    gallery.querySelectorAll('li.thumb').forEach(function (li, i) {
      var badge = li.querySelector('.thumb-index');
      if (badge) badge.textContent = String(i + 1);
    });
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

    var quality = QUALITY_MAP[qualityEl.value] || 0.92;
    var pageSizeMode = pageSizeEl.value;
    var orientation = orientationEl.disabled ? 'portrait' : orientationEl.value;
    var margin = MARGINS[marginsEl.value] || 0;
    var skipped = [];

    try {
      var PDFDocument = PDFLib.PDFDocument;
      var degrees = PDFLib.degrees;
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
          var embedded = await embedImageItem(pdfDoc, item, quality);
          if (!embedded) { skipped.push(item.name); continue; }
          addImagePage(pdfDoc, embedded, item, {
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

  async function embedImageItem(pdfDoc, item, quality) {
    var file = item.file;
    var type = file.type || '';

    if (type === 'image/png') {
      var pngBytes = await readAsArrayBuffer(file);
      return await pdfDoc.embedPng(pngBytes);
    }
    if (type === 'image/jpeg' || type === 'image/jpg') {
      if (quality >= 0.9) {
        var jpgBytes = await readAsArrayBuffer(file);
        return await pdfDoc.embedJpg(jpgBytes);
      }
      var jpegData = await recompressToJpeg(item, quality);
      return await pdfDoc.embedJpg(jpegData);
    }
    var data = await recompressToJpeg(item, quality);
    return await pdfDoc.embedJpg(data);
  }

  function readAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsArrayBuffer(file);
    });
  }

  function recompressToJpeg(item, quality) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        try {
          var rot = item.rotation % 360;
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;

          var canvas = document.createElement('canvas');
          var ctx = canvas.getContext('2d');

          if (rot === 90 || rot === 270) {
            canvas.width = h;
            canvas.height = w;
          } else {
            canvas.width = w;
            canvas.height = h;
          }

          ctx.save();
          if (rot === 90) {
            ctx.translate(canvas.width, 0);
            ctx.rotate(Math.PI / 2);
          } else if (rot === 180) {
            ctx.translate(canvas.width, canvas.height);
            ctx.rotate(Math.PI);
          } else if (rot === 270) {
            ctx.translate(0, canvas.height);
            ctx.rotate(-Math.PI / 2);
          }
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, w, h);
          ctx.restore();

          var dataUrl = canvas.toDataURL('image/jpeg', quality);
          var base64 = dataUrl.split(',')[1];
          var binary = atob(base64);
          var len = binary.length;
          var buf = new Uint8Array(len);
          for (var i = 0; i < len; i++) buf[i] = binary.charCodeAt(i);
          resolve(buf.buffer);
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = function () { reject(new Error('Failed to decode image')); };
      img.src = item.url;
    });
  }

  function addImagePage(pdfDoc, embedded, item, opts) {
    var deg = item.rotation % 360;
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

    page.drawImage(embedded, {
      x: x,
      y: y,
      width: drawW,
      height: drawH,
      rotate: PDFLib.degrees(deg)
    });
  }

  // ---------- Filename ----------
   // ---------- Filename ----------
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