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
  var langToggle = $('langToggle');
  var themeToggle = $('themeToggle');
  var yearEl = $('year');

  // ---------- Constants ----------
  var A4 = { w: 595.28, h: 841.89 };
  var LETTER = { w: 612, h: 792 };
  var MARGINS = { none: 0, small: 18, large: 42 };
  var QUALITY_MAP = { high: 0.92, medium: 0.75, low: 0.55 };
  var ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

  // ---------- Init ----------
  function init() {
    applyThemeOnLoad();
    applyLangOnLoad();
    bindEvents();
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
        // Navigate to the appropriate static page
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
        // Sync the state array to the new DOM order
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

    // Load dimensions for each file
    var tasks = validFiles.map(function (f) { return loadImageMeta(f); });
    Promise.all(tasks).then(function (results) {
      results.forEach(function (meta) {
        if (!meta) return; // failed to load -> skipped silently here
        images.push(meta);
        renderThumb(meta);
      });
      updateVisibility();
      renumberThumbnails();
    });
  }

  /** Load a File into an Image and get its natural dimensions. */
  function loadImageMeta(file) {
    return new Promise(function (resolve) {
      // For WEBP we'll need to draw via canvas later, but Image can decode WEBP in modern browsers.
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
    progressWrap.classList.add('hidden');
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
    // keep the bar visible briefly with 100%? We'll just hide after conversion.
    progressWrap.classList.add('hidden');
    progressFill.style.width = '0%';
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
    convertBtn.disabled = true;

    var quality = QUALITY_MAP[qualityEl.value] || 0.92;
    var pageSizeMode = pageSizeEl.value; // 'a4' | 'letter' | 'image'
    var orientation = orientationEl.disabled ? 'portrait' : orientationEl.value;
    var margin = MARGINS[marginsEl.value] || 0;
    var skipped = [];

    try {
      var { PDFDocument, degrees } = PDFLib;
      var pdfDoc = await PDFDocument.create();

      var total = images.length;
      for (var i = 0; i < total; i++) {
        var item = images[i];
        showProgress(
          Math.round((i / total) * 90),
          t('progress.processing', { i: i + 1, n: total })
        );
        // Yield to the browser so the UI updates
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
    } catch (err) {
      console.error(err);
      showError('Conversion failed: ' + (err && err.message ? err.message : String(err)));
    } finally {
      convertBtn.disabled = false;
    }
  }

  /** Embed a single image into pdfDoc, converting WEBP -> JPEG if needed. */
  async function embedImageItem(pdfDoc, item, quality) {
    var file = item.file;
    var type = file.type || '';

    // PDF-lib supports JPEG & PNG directly. WEBP must go through a canvas.
    if (type === 'image/png') {
      var pngBytes = await readAsArrayBuffer(file);
      return await pdfDoc.embedPng(pngBytes);
    }
    if (type === 'image/jpeg' || type === 'image/jpg') {
      // If quality is "high" we can embed as-is. Otherwise recompress via canvas.
      if (quality >= 0.9) {
        var jpgBytes = await readAsArrayBuffer(file);
        return await pdfDoc.embedJpg(jpgBytes);
      }
      var jpegData = await recompressToJpeg(item, quality);
      return await pdfDoc.embedJpg(jpegData);
    }
    // Fallback: treat everything else (WEBP) through canvas -> JPEG
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

  /**
   * Draw the image (with its current rotation applied) onto a canvas and
   * export as JPEG at the requested quality. Returns an ArrayBuffer suitable
   * for pdfDoc.embedJpg().
   */
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
          // White background (avoids black when converting transparent PNG/WEBP)
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

  /**
   * Add a page for the given embedded image, honouring page size / orientation /
   * margins / rotation.
   */
  function addImagePage(pdfDoc, embedded, item, opts) {
    var deg = item.rotation % 360;
    var rotated = (deg === 90 || deg === 270);
    var imgW = embedded.width;
    var imgH = embedded.height;

    // Determine page dimensions
    var pageW, pageH;
    if (opts.pageSizeMode === 'image') {
      // Page = image size + margins (no orientation switch for "image" mode)
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

    // For "image" mode, page is exactly image+margin, so just fit.
    // For fixed page modes, fit inside (page - margins).
    var availW = Math.max(1, pageW - opts.margin * 2);
    var availH = Math.max(1, pageH - opts.margin * 2);

    var scale = Math.min(availW / imgW, availH / imgH);
    var drawW = imgW * scale;
    var drawH = imgH * scale;

    // After rotation, the visual box is drawH × drawW (if 90/270).
    // We centre the *drawn* box within the page.
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
  function buildFilename() {
    var d = new Date();
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    var stamp =
      d.getFullYear() + '-' +
      pad(d.getMonth() + 1) + '-' +
      pad(d.getDate()) + '-' +
      pad(d.getHours()) + pad(d.getMinutes());
    return 'images-' + stamp + '.pdf';
  }

  // ---------- Boot ----------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();