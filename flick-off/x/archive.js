/* FLICK OFF · X archive on device. The zip is read with File.slice (no upload, no full load) by @bwalletx/flick
   (vendored build in ./flick/, from b0ase/flick-importers). Only data/tweets*.js, data/note-tweet*.js and
   data/account.js are opened; tweets.js is streamed (inflated and parsed a slice at a time).
   Minting is a DRY RUN in this version: records are built, walked batch by batch and shown, never signed or sent.
   The walk's progress is kept in IndexedDB, so a closed tab carries on from where it stopped. */
import { readXArchive, checkOwnership, buildMintBatch, runImport, loadProgress, clearProgress, progressKey, idbKv } from '/flick-off/x/flick/index.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-GB');
const KEY = 'flick-x-owner';

// dollars first: BSV/USD from WhatsOnChain; sats only if the rate can't be fetched
let bsvUsd = null;
const usd = (sats) => {
  if (!bsvUsd) return null;
  const d = (sats / 1e8) * bsvUsd;
  if (d < 0.01) return '<$0.01';
  return '$' + (d < 10 ? d.toFixed(2) : Math.round(d).toLocaleString('en-US'));
};
const money = (sats) => usd(sats) ?? fmt(sats) + ' sats';

// ── step 1: who you are (Sign in with X; result arrives in the URL fragment, then lives in this tab only)
let who = null;
try { who = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { who = null; }
const hash = /[#&]x=([A-Za-z0-9_-]+)/.exec(location.hash);
if (hash) {
  history.replaceState(null, '', location.pathname);
  let j = null;
  try { j = JSON.parse(atob(hash[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { j = { error: 'token' }; }
  if (j && j.id && /^\d+$/.test(String(j.id))) {
    who = { id: String(j.id), handle: String(j.handle || ''), name: String(j.name || ''), avatar: String(j.avatar || ''), proof: String(j.proof || '') };
    try { sessionStorage.setItem(KEY, JSON.stringify(who)); } catch {}
  } else {
    $('m1').className = 'msg bad';
    $('m1').textContent = {
      offline: 'Sign in with X isn’t switched on yet.',
      denied: 'You cancelled the X sign-in.',
      expired: 'That sign-in took too long. Try again.',
    }[j && j.error] || 'X sign-in didn’t work this time. Try again.';
  }
}
function drawWho() {
  if (!who) return;
  $('s1').classList.add('done');
  $('who').classList.remove('hidden');
  if (/^https:\/\//.test(who.avatar)) $('av').src = who.avatar; else $('av').removeAttribute('src');
  $('whoName').textContent = who.name || '@' + who.handle;
  $('whoHandle').textContent = '@' + who.handle + ' · signed in with X';
  $('whoTxt').textContent = 'Signed in. Now pick the archive for this account.';
  $('signIn').textContent = 'Use a different X account';
}
drawWho();
$('signIn').addEventListener('click', () => { location.href = '/api/x/start?to=archive'; });

// ── step 2: the zip
let plan = null;
const drop = $('drop'), input = $('zip');
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) read(f); });
input.addEventListener('change', () => input.files[0] && read(input.files[0]));

const gb = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : Math.max(1, Math.round(b / 1e6)) + ' MB');
async function read(file) {
  const m = $('m2'); m.className = 'msg'; m.textContent = `Reading ${gb(file.size)} on your device…`;
  $('bar').style.display = 'block'; $('barI').style.width = '30%';
  const t0 = performance.now();
  try {
    const r = await readXArchive(file);
    plan = r.plan;
    $('barI').style.width = '100%';
    $('s2').classList.add('done');
    m.className = 'msg ok';
    m.textContent = `Read in ${((performance.now() - t0) / 1000).toFixed(1)} s. ${gb(r.bytesRead)} of ${gb(r.archiveBytes)} opened; nothing left your device.`;
    show();
    resumeNote();
  } catch (e) {
    plan = null;
    m.className = 'msg bad';
    m.textContent = /not an X archive/.test(e.message)
      ? 'That zip doesn’t look like an X archive: there’s no data/tweets.js inside.'
      : 'Couldn’t read that file. Make sure it’s the .zip X sent you, still zipped.';
  } finally { setTimeout(() => ($('bar').style.display = 'none'), 500); }
}

// ── step 3 + 4: preview, ownership, dry-run mint
function show() {
  if (!plan) return;
  $('s3').classList.remove('hidden'); $('s4').classList.remove('hidden');
  const n = plan.posts.length, threads = plan.posts.filter((p) => p.parentId).length, replies = plan.posts.filter((p) => p.replyUrl).length;
  $('price').textContent = `${fmt(n)} posts · ~${money(plan.cost.text)}`;
  $('priceSub').textContent = (usd(plan.cost.text) ? fmt(plan.cost.text) + ' sats · ' : '') +
    'Cost price to write every post, its date and its link on chain. Photos and videos come later, priced separately.' +
    (plan.skipped.edits ? ` Edited posts come over as their final version (${fmt(plan.skipped.edits)} earlier versions left out).` : '');
  const stat = (v, l) => `<div class="stat"><b>${fmt(v)}</b><span>${l}</span></div>`;
  $('stats').innerHTML = stat(n, 'your posts') + stat(plan.longPosts, 'long posts, full text') + stat(threads, 'thread replies') +
    stat(replies, 'replies (link to theirs)') + stat(plan.skipped.retweets, 'reposts skipped') + stat(plan.mediaFiles, 'photos and videos');
  const o = checkOwnership(plan, who);
  const own = $('own');
  if (o.ok) { own.className = 'msg ok'; own.textContent = `This archive is @${plan.username}’s, and that’s the account you signed in with.`; }
  else {
    own.className = 'msg bad';
    own.textContent = {
      'not-signed-in': 'Sign in with X (step 1) to prove this archive is yours. Then pick it again.',
      'no-account-id': 'This archive has no account id (data/account.js), so we can’t check it’s yours.',
      'different-account': `This archive belongs to a different X account than @${who && who.handle}. Sign in as the archive’s owner.`,
    }[o.reason];
  }
  $('mint').disabled = !o.ok;
  if (!running) $('mint').textContent = `Mint my ${fmt(n)} posts · ~${money(plan.cost.text)}`;
  if (!o.ok) { $('m4').className = 'msg'; $('m4').textContent = 'Minting unlocks once the archive matches your X sign-in.'; }
}

// ── step 4: DRY RUN mint, resumable. The sealed X proof is checked by the server first (24 h life).
const kv = idbKv('bmintx-flick', 'progress');
const BATCH = 25;
let batch = null, running = null;
const key = () => progressKey(plan.accountId, true);
const bar4 = (done, total) => { $('bar4').style.display = 'block'; $('bar4I').style.width = (total ? (100 * done) / total : 0) + '%'; };

async function resumeNote() {
  batch = buildMintBatch(plan);
  const p = await loadProgress(kv, key(), batch.records).catch(() => null);
  $('reset').classList.toggle('hidden', !p);
  if (p && p.cursor > 0) {
    bar4(p.cursor, p.total);
    $('m4').className = 'msg';
    $('m4').textContent = p.cursor >= p.total
      ? `Dry run already done on this device (${fmt(p.total)} posts). Run it again or start over.`
      : `You stopped at ${fmt(p.cursor)} of ${fmt(p.total)} posts last time. Mint carries on from there (dry run).`;
  }
}

async function checkProof() {
  if (!who || !who.proof) return 'Sign in with X again (step 1): this sign-in has no proof.';
  try {
    const r = await fetch('/api/x/proof', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ proof: who.proof }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) return j.error || 'Couldn’t check your X sign-in. Try again.';
    if (String(j.id) !== plan.accountId) return 'Your X sign-in doesn’t match this archive’s account.';
    return null;
  } catch { return 'Couldn’t reach bMintX to check your X sign-in. Try again.'; }
}

function showRecords(b) {
  const box = $('records'); box.textContent = '';
  const row = (label, text, map) => {
    const d = document.createElement('div'); d.className = 'rec';
    const t = document.createElement('div'); t.className = 't'; t.textContent = text; // post text is untrusted: text only, never HTML
    const pill = document.createElement('span'); pill.className = 'pill'; pill.textContent = label;
    const c = document.createElement('code'); c.textContent = 'MAP SET ' + map.map(([k, v]) => `${k} ${v}`).join(' ');
    d.append(pill, t, c); box.appendChild(d);
  };
  row('link', `X account ${plan.accountId} → your bWalletX`, b.link.map);
  const SHOW = 50;
  for (const r of b.records.slice(0, SHOW)) row(new Date(Object.fromEntries(r.map).source_at).toISOString().slice(0, 10), r.text, r.map);
  if (b.records.length > SHOW) { const d = document.createElement('div'); d.className = 'rec small'; d.textContent = `…and ${fmt(b.records.length - SHOW)} more, oldest first.`; box.appendChild(d); }
  $('dry').classList.remove('hidden');
}

$('mint').addEventListener('click', async () => {
  if (!plan || !checkOwnership(plan, who).ok) return;
  if (running) { running.abort(); return; } // pause
  const m = $('m4'); m.className = 'msg'; m.textContent = 'Checking your X sign-in…';
  const bad = await checkProof();
  if (bad) { m.className = 'msg bad'; m.textContent = bad; return; }
  batch = batch || buildMintBatch(plan);
  showRecords(batch);
  running = new AbortController();
  $('mint').textContent = 'Pause';
  try {
    let p = await loadProgress(kv, key(), batch.records);
    if (p && p.cursor >= p.total) { await clearProgress(kv, key()); p = null; }
    p = await runImport({
      records: batch.records, kv, key: key(), dryRun: true, batchSize: BATCH, signal: running.signal,
      // DRY RUN: nothing is signed or sent. A real step hands the batch to bWalletX (after bwalletx-connect #6).
      step: async (rs) => { await new Promise((r) => setTimeout(r, 0)); return rs.map(() => 'dry-run'); },
      onProgress: (done, total) => { bar4(done, total); m.textContent = `Dry run: ${fmt(done)} of ${fmt(total)} posts walked. Nothing signed or sent.`; },
    });
    m.className = p.cursor >= p.total ? 'msg ok' : 'msg';
    m.textContent = p.cursor >= p.total
      ? `Dry run done: ${fmt(batch.records.length + 1)} records (1 account link + ${fmt(batch.records.length)} posts), ~${money(plan.cost.text)} at cost price. Nothing was signed or sent.` +
        (batch.tooLong ? ` ${fmt(batch.tooLong)} posts are over 10,000 characters and would need splitting.` : '')
      : `Paused at ${fmt(p.cursor)} of ${fmt(p.total)}. Saved on this device: close the tab if you like, it carries on from here.`;
    $('reset').classList.remove('hidden');
  } catch {
    m.className = 'msg bad'; m.textContent = 'The dry run stopped. Try again: it carries on from the last saved batch.';
  } finally {
    running = null;
    $('mint').textContent = `Mint my ${fmt(plan.posts.length)} posts · ~${money(plan.cost.text)}`;
  }
});

$('reset').addEventListener('click', async () => {
  if (!plan || running) return;
  await clearProgress(kv, key()).catch(() => {});
  $('reset').classList.add('hidden'); $('bar4').style.display = 'none';
  $('m4').className = 'msg'; $('m4').textContent = 'Progress cleared on this device.';
});

fetch('https://api.whatsonchain.com/v1/bsv/main/exchangerate').then((r) => r.json()).then((j) => { bsvUsd = Number(j.rate) || null; show(); }).catch(() => {});
