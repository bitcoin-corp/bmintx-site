/* FLICK OFF · YouTube: read a Google Takeout export in the browser (names, sizes and the metadata CSV only;
   video bytes are never read), price every video at cost and let the creator pick. Nothing is uploaded. */
(() => {
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.round(n).toLocaleString('en-GB');
  const mb = (b) => (b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : (b / 1e6).toFixed(b < 1e7 ? 1 : 0) + ' MB');
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // cost price: 100 sat/kB (bMintX house rate) on the video plus ~1 kB for its title, description, date and signature
  const SAT_PER_KB = 100, META_BYTES = 1000;
  const sats = (bytes) => ((bytes + META_BYTES) / 1000) * SAT_PER_KB;
  let bsvUsd = null;
  fetch('https://api.whatsonchain.com/v1/bsv/main/exchangerate').then((r) => r.json()).then((j) => { bsvUsd = Number(j.rate) || null; render(); }).catch(() => {});
  const price = (s) => (bsvUsd ? '$' + ((s / 1e8) * bsvUsd).toFixed(s / 1e8 * bsvUsd < 10 ? 2 : 0) : fmt(s) + ' sats');

  // the switch flicks once, then on click
  const flick = $('flick');
  const toggle = () => { flick.classList.toggle('on'); $('knobTxt').textContent = flick.classList.contains('on') ? 'b' : '▶'; };
  setTimeout(toggle, 900); flick.addEventListener('click', toggle);

  const VIDEO = /\.(mp4|mov|m4v|webm|mkv|avi|flv|3gp|wmv|mpg|mpeg)$/i;
  const norm = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();

  /** RFC 4180-ish CSV parser (quoted fields may hold commas, quotes and newlines). */
  function csv(text) {
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows.filter((r) => r.some((x) => x !== ''));
  }

  /** Takeout's video metadata CSV → title-keyed records. Column names vary between Takeout versions. */
  function metadata(text) {
    const rows = csv(text.replace(/^﻿/, ''));
    if (rows.length < 2) return new Map();
    const h = rows[0].map((x) => x.toLowerCase());
    const col = (...keys) => h.findIndex((x) => keys.some((k) => x.includes(k)));
    const ti = col('video title', 'title'), di = col('publish timestamp', 'create timestamp', 'timestamp', 'date'), de = col('description'), du = col('duration'), pr = col('privacy');
    const m = new Map();
    for (const r of rows.slice(1)) {
      const title = r[ti]; if (!title) continue;
      m.set(norm(title), { title, date: di >= 0 ? r[di] : '', desc: de >= 0 ? r[de] : '', ms: du >= 0 ? Number(r[du]) || 0 : 0, privacy: pr >= 0 ? r[pr] : '' });
    }
    return m;
  }

  let vids = []; // {name, title, date, bytes, privacy, on}
  async function load(files) {
    // files: [{path, size, text?()}]
    const meta = files.find((f) => /video metadata\/.*videos?\.csv$/i.test(f.path) || /\/videos\.csv$/i.test(f.path));
    const m = meta ? metadata(await meta.text()) : new Map();
    vids = files.filter((f) => VIDEO.test(f.path) && /youtube/i.test(f.path)).map((f) => {
      const base = f.path.split('/').pop().replace(VIDEO, '');
      const hit = m.get(norm(base)) || [...m.values()].find((x) => norm(x.title).startsWith(norm(base).slice(0, 40)));
      const date = hit && hit.date ? new Date(hit.date) : null;
      return { name: base, title: hit ? hit.title : base, date: date && !isNaN(date) ? date : null, bytes: f.size, privacy: hit ? hit.privacy : '', on: true };
    }).sort((a, b) => (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0));
    if (!vids.length) {
      $('ytMsg').className = 'msg bad';
      $('ytMsg').textContent = files.length ? 'No YouTube videos in there. Make sure you chose the unzipped Takeout folder with “YouTube and YouTube Music” in it.' : 'That folder is empty.';
      $('yt').classList.remove('show'); return;
    }
    $('ytMsg').className = 'msg';
    $('ytMsg').textContent = meta ? '' : 'No video metadata file found, so titles come from file names and dates are missing. Tick “video metadata” in Takeout for both.';
    $('yt').classList.add('show');
    const total = vids.reduce((a, v) => a + v.bytes, 0);
    $('sVids').textContent = fmt(vids.length); $('sSize').textContent = mb(total); $('sAll').textContent = price(vids.reduce((a, v) => a + sats(v.bytes), 0));
    $('vlist').innerHTML = '<div class="vrow head"><span></span><span>Video</span><span class="r sz">Size</span><span class="r">Cost</span></div>' +
      vids.map((v, i) => `<label class="vrow"><input type="checkbox" data-i="${i}" checked><span><b>${esc(v.title)}</b><span class="d">${v.date ? v.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'date unknown'}${v.privacy ? ' · ' + esc(v.privacy) : ''}</span></span><span class="r sz">${mb(v.bytes)}</span><span class="r">${price(sats(v.bytes))}</span></label>`).join('');
    $('vlist').querySelectorAll('input').forEach((c) => c.addEventListener('change', () => { vids[c.dataset.i].on = c.checked; render(); }));
    render();
    $('yt').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function render() {
    if (!vids.length) return;
    const sel = vids.filter((v) => v.on);
    $('selN').textContent = fmt(sel.length);
    $('selSize').textContent = mb(sel.reduce((a, v) => a + v.bytes, 0));
    $('selCost').textContent = sel.length ? price(sel.reduce((a, v) => a + sats(v.bytes), 0)) : '–';
    // prices update when the live BSV rate arrives
    $('vlist').querySelectorAll('.vrow:not(.head)').forEach((row, i) => { row.lastElementChild.textContent = price(sats(vids[i].bytes)); });
    if ($('sAll').textContent !== '–') $('sAll').textContent = price(vids.reduce((a, v) => a + sats(v.bytes), 0));
  }

  document.querySelectorAll('[data-sel]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.sel;
    vids.forEach((v, i) => { v.on = k === 'all' ? true : k === 'none' ? false : k === 'small' ? v.bytes < 50e6 : i < 20; });
    $('vlist').querySelectorAll('input').forEach((c) => { c.checked = vids[c.dataset.i].on; });
    render();
  }));

  // ---- inputs: folder picker, dragged folder, or a small zip
  const fromFileList = (list) => [...list].map((f) => ({ path: f.webkitRelativePath || f.name, size: f.size, text: () => f.text() }));
  $('folder').addEventListener('change', (e) => e.target.files.length && load(fromFileList(e.target.files)));

  const dz = $('dropzone');
  ['dragenter', 'dragover'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', async (e) => {
    const items = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    if (items.length === 1 && items[0].isFile && /\.zip$/i.test(items[0].name)) return readZip(e.dataTransfer.files[0]);
    $('ytMsg').className = 'msg'; $('ytMsg').textContent = 'Reading the folder…';
    const out = [];
    const walk = (entry, path) => new Promise((res) => {
      if (entry.isFile) entry.file((f) => { out.push({ path: path + f.name, size: f.size, text: () => f.text() }); res(); }, res);
      else {
        const r = entry.createReader(); const all = [];
        const more = () => r.readEntries(async (batch) => { if (!batch.length) { for (const c of all) await walk(c, path + entry.name + '/'); res(); } else { all.push(...batch); more(); } }, res);
        more();
      }
    });
    for (const it of items) await walk(it, '');
    load(out);
  });

  async function readZip(file) {
    $('ytMsg').className = 'msg'; $('ytMsg').textContent = 'Reading ' + file.name + '…';
    if (file.size > 1.5e9) { $('ytMsg').className = 'msg bad'; $('ytMsg').textContent = 'That zip is too big to open in a browser. Unzip it and choose the folder instead.'; return; }
    try {
      const zip = await JSZip.loadAsync(file);
      load(Object.values(zip.files).filter((f) => !f.dir).map((f) => ({ path: f.name, size: (f._data && f._data.uncompressedSize) || 0, text: () => f.async('string') })));
    } catch { $('ytMsg').className = 'msg bad'; $('ytMsg').textContent = 'Couldn’t read that zip. Unzip it and choose the folder instead.'; }
  }
  $('zipin').addEventListener('change', (e) => e.target.files[0] && readZip(e.target.files[0]));
})();
