/* FLICK OFF · X archive on device. The zip is read with File.slice (no upload, no full load) by @bwalletx/flick
   (vendored build in ./flick/, from b0ase/flick-importers). Only data/tweets*.js, data/note-tweet*.js and
   data/account.js are opened; tweets.js is streamed (inflated and parsed a slice at a time).
   PRIVATE BY DEFAULT (owner rule 24 Oct 2026): every post is encrypted by the person's own bWalletX
   (BRC-100 encrypt, protocol [2,'bmintx archive'], a random key id per post, counterparty self) before anything is
   built. On chain, in clear: a fixed tag, the key id and the ciphertext. Public only by choice, post by post.
   This build is a DRY RUN: posts are really encrypted by the wallet (no cost), the transactions are built and kept
   on this device, nothing is signed for spending or sent. LIVE flips that after the owner's go.
   Progress is kept in IndexedDB, so a closed tab carries on from where it stopped. */
import {
  readXArchive, checkOwnership, runImport, loadProgress, clearProgress, progressKey, idbKv,
  planPrivate, encryptBatch, potImportStep, potKey, potFunding, outputBytes, padPlaintext, payloadFor, txOutputScripts,
  parseArchiveScript, openArchiveScript, publicPostMap, publicPostScript, POSTS_PER_TX,
} from '/flick-off/x/flick/index.js';

/** Real minting is on, capped for the owner's test run: at most LIVE_LIMIT posts (the oldest), one transaction. */
const LIVE = true;
const LIVE_LIMIT = 25;
const TEST_RUN = LIVE && LIVE_LIMIT < Infinity;

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
let plan = null, priv = null;
const mintLabel = () => TEST_RUN ? `Test run: write my oldest ${fmt(Math.min(LIVE_LIMIT, plan.posts.length))} posts, encrypted` : `${LIVE ? 'Mint' : 'Dry run:'} my ${fmt(plan.posts.length)} posts, encrypted · ~${money(priv.sats)}`;
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
  priv = planPrivate(plan.posts, { accountId: plan.accountId, username: plan.username });
  $('price').textContent = `${fmt(n)} posts · ~${money(priv.sats)}`;
  $('priceSub').textContent = (usd(priv.sats) ? fmt(priv.sats) + ' sats · ' : '') +
    `Cost price to write every post on chain, encrypted, in ${fmt(priv.batches)} transactions of up to ${POSTS_PER_TX} posts. Photos and videos come later, priced separately.` +
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
  if (TEST_RUN) $('testNote').textContent = `Test run: only your oldest ${fmt(Math.min(LIVE_LIMIT, n))} posts are written now, in one transaction (about ${money(fundPlan().fund)} into the pot). The rest come later.`;
  if (!running) $('mint').textContent = mintLabel();
  if (!o.ok) { $('m4').className = 'msg'; $('m4').textContent = 'Minting unlocks once the archive matches your X sign-in.'; }
}

// ── the wallet: bWalletX in this browser (extension / in-app), else a saved phone pairing
let wallet = null;
async function getWallet() {
  if (wallet) return wallet;
  const C = window.bWalletXConnect;
  if (!C) throw new Error('bWalletX connect didn’t load. Reload the page.');
  const r = await C.connectBwalletX({});
  wallet = r.wallet;
  return wallet;
}

// ── step 4: encrypt + mint, resumable. The sealed X proof is checked by the server first (24 h life).
const kv = idbKv('bmintx-flick', 'progress');
let running = null;
const key = () => progressKey(plan.accountId, !LIVE);
const livePosts = () => (LIVE ? plan.posts.slice(0, LIVE_LIMIT) : plan.posts);
const records = () => livePosts().map((p) => ({ xId: p.id, parentXId: p.parentId }));
const bar4 = (done, total) => { $('bar4').style.display = 'block'; $('bar4I').style.width = (total ? (100 * done) / total : 0) + '%'; };

async function resumeNote() {
  const p = await loadProgress(kv, key(), records()).catch(() => null);
  $('reset').classList.toggle('hidden', !p || LIVE); // a live run's progress is never cleared from the page
  $('s5').classList.toggle('hidden', !p);
  if (p && p.cursor > 0) {
    bar4(p.cursor, p.total);
    $('m4').className = 'msg';
    if (TEST_RUN && p.cursor >= p.total) { $('mint').disabled = true; $('reset').classList.add('hidden'); }
    $('m4').textContent = p.cursor >= p.total
      ? TEST_RUN ? `Test run done: ${fmt(p.total)} posts written. Check them below.` : `${LIVE ? 'Done' : 'Dry run done'} on this device (${fmt(p.total)} posts, encrypted). Open your archive below.`
      : `You stopped at ${fmt(p.cursor)} of ${fmt(p.total)} posts last time. It carries on from there.`;
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

// ── the archive pot: its own money, so the archive's transactions never touch the wallet's change addresses
const WOC = 'https://api.whatsonchain.com/v1/bsv/main';
const potKv = () => `${key()}:pot`;
function fundPlan() {
  const ctx = { accountId: plan.accountId, username: plan.username }, sizes = [];
  const ps = livePosts();
  for (let i = 0; i < ps.length; i += POSTS_PER_TX)
    sizes.push(ps.slice(i, i + POSTS_PER_TX).map((p) => outputBytes(padPlaintext(payloadFor(p, ctx)).length) - 11).concat([260]));
  return potFunding(sizes);
}
let pk = null;
async function drawPot(w) {
  pk = pk || (await potKey(w, plan.accountId));
  const f = fundPlan(), st = await kv.get(potKv());
  $('pot').classList.remove('hidden');
  $('potAddr').textContent = pk.address;
  $('potAmt').textContent = `${money(f.fund)} (${fmt(f.fund)} sats: every fee for ${fmt(f.txs)} transactions + 10%)`;
  $('potState').textContent = st ? `Pot funded: ${fmt(st.satoshis)} sats left after ${fmt(st.txs)} transactions.` : 'Not funded yet.';
  return { f, st };
}
async function fundFromWallet() {
  const m = $('mPot'); m.className = 'msg';
  try {
    const w = await getWallet(); const { f } = await drawPot(w);
    if (!LIVE) { await kv.set(potKv(), { v: 1, txid: '00'.repeat(32), vout: 0, satoshis: f.fund, spentSats: 0, txs: 0, dry: true }); m.textContent = 'Dry run: pot marked funded on this device. Nothing was sent.'; return drawPot(w); }
    m.textContent = 'Approve the pot payment in your wallet (one sheet)…';
    const r = await w.createAction({ description: 'Fund your private archive pot', outputs: [{ lockingScript: pk.lockingScript, satoshis: f.fund, outputDescription: 'Archive pot' }], options: { randomizeOutputs: false } });
    if (!r || !r.txid) throw new Error('no txid');
    await kv.set(potKv(), { v: 1, txid: r.txid, vout: 0, satoshis: f.fund, spentSats: 0, txs: 0 });
    m.className = 'msg ok'; m.textContent = 'Pot funded from your bWalletX.'; drawPot(w);
  } catch { m.className = 'msg bad'; m.textContent = 'The pot wasn’t funded. Nothing was spent.'; }
}
async function checkOutsideFunding() {
  const m = $('mPot'); m.className = 'msg';
  try {
    const w = await getWallet(); const { f } = await drawPot(w);
    if (!LIVE) { m.textContent = 'Dry run: in the live version this checks the pot address for your payment.'; return; }
    const u = await (await fetch(`${WOC}/address/${pk.address}/unspent`)).json();
    const best = (Array.isArray(u) ? u : []).sort((x, y) => y.value - x.value)[0];
    if (!best || best.value < f.fund) { m.textContent = best ? `Found ${fmt(best.value)} sats; send at least ${fmt(f.fund)} in one payment.` : 'Nothing has arrived yet. It can take a minute.'; return; }
    await kv.set(potKv(), { v: 1, txid: best.tx_hash, vout: best.tx_pos, satoshis: best.value, spentSats: 0, txs: 0 });
    m.className = 'msg ok'; m.textContent = 'Payment found. The pot is funded, and it isn’t linked to your wallet.'; drawPot(w);
  } catch { m.className = 'msg bad'; m.textContent = 'Couldn’t check the pot address. Try again.'; }
}
$('fundWallet').addEventListener('click', fundFromWallet);
$('fundOutside').addEventListener('click', async () => { $('outside').classList.remove('hidden'); try { await drawPot(await getWallet()); } catch {} });
$('checkPot').addEventListener('click', checkOutsideFunding);

/** The wallet must pin [2,'bmintx archive'] to bmintx.com (bwallet #57), advertised as getVersion().pinnedProtocols >= 1,
 *  or as a `+pN` suffix on the version string (bwallet #64; the connect binary wire carries only `version`). */
const PIN_VERSION = 1;
function pinLevel(v) {
  const m = v && typeof v.version === 'string' ? v.version.match(/(?:\+p|; pin=)(\d+)\b/) : null;
  return Math.max(Number(v && v.pinnedProtocols) || 0, m ? Number(m[1]) : 0);
}
async function walletPins(w) {
  try { return pinLevel(await w.getVersion({})) >= PIN_VERSION; } catch { return false; }
}

async function broadcast(rawHex) {
  const r = await fetch(`${WOC}/tx/raw`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ txhex: rawHex }) });
  if (!r.ok) throw new Error('broadcast failed: ' + (await r.text()).slice(0, 200));
}

$('mint').addEventListener('click', async () => {
  if (!plan || !checkOwnership(plan, who).ok) return;
  if (running) { running.abort(); return; } // pause
  const m = $('m4'); m.className = 'msg'; m.textContent = 'Checking your X sign-in…';
  const bad = await checkProof();
  if (bad) { m.className = 'msg bad'; m.textContent = bad; return; }
  let w;
  try { m.textContent = 'Connecting your bWalletX…'; w = await getWallet(); }
  catch (e) { m.className = 'msg bad'; m.textContent = e && e.code === 'NOT_FOUND' ? 'Connect bWalletX first (top right): your wallet does the encrypting.' : (e && e.message) || 'Couldn’t reach your bWalletX.'; return; }
  if (LIVE && !(await walletPins(w))) {
    m.className = 'msg bad';
    m.textContent = 'This bWalletX is too old to keep your archive private from other sites. Use web.bwalletx.com (up to date), or wait for the next app update. Nothing was written.';
    return;
  }
  try { m.textContent = 'Your wallet asks once to lock your archive with your keys. Approve it to start.'; await drawPot(w); }
  catch { m.className = 'msg bad'; m.textContent = 'Your wallet said no, so nothing was encrypted.'; return; }
  if (!(await kv.get(potKv()))) { m.className = 'msg'; m.textContent = 'Fund the archive pot first (below).'; return; }
  running = new AbortController();
  $('mint').textContent = 'Pause';
  const ctx = { accountId: plan.accountId, username: plan.username };
  const k = key();
  let batchNo = 0;
  try {
    let p = await loadProgress(kv, k, records());
    if (p && p.cursor >= p.total) { await clearProgress(kv, k); await clearOutputs(k); p = null; }
    batchNo = p ? p.cursor / POSTS_PER_TX : 0;
    const posts = new Map(plan.posts.map((x) => [x.id, x]));
    const step = potImportStep({
      wallet: w, key: pk, dryRun: !LIVE, broadcast: LIVE ? broadcast : undefined,
      loadPot: () => kv.get(potKv()), savePot: (st) => kv.set(potKv(), st),
      encrypt: async (rs) => {
        const b = await encryptBatch(w, rs.map((r) => posts.get(r.xId)), ctx);
        // kept on this device so "Open my archive" works offline (and, in the dry run, at all). Ciphertext only.
        await kv.set(`${k}:out:${batchNo++}`, { scripts: b.outputs.map((o) => o.lockingScript), items: b.items });
        return b;
      },
    });
    p = await runImport({
      records: records(), kv, key: k, dryRun: !LIVE, batchSize: POSTS_PER_TX, signal: running.signal, step,
      onProgress: (done, total) => { bar4(done, total); m.textContent = `${LIVE ? '' : 'Dry run: '}${fmt(done)} of ${fmt(total)} posts encrypted${LIVE ? ' and written' : ' and signed from the pot. Nothing sent'}.`; },
    });
    drawPot(w).catch(() => {});
    m.className = p.cursor >= p.total ? 'msg ok' : 'msg';
    m.textContent = p.cursor >= p.total
      ? (TEST_RUN ? `Test run done: ${fmt(p.total)} posts written. Check them below.` : LIVE ? `Done: ${fmt(p.total)} posts written, encrypted with your keys.` : `Dry run done: ${fmt(p.total)} posts encrypted by your wallet into ${fmt(Math.ceil(p.total / POSTS_PER_TX))} transactions, ~${money(priv.sats)} at cost price. Nothing was sent or spent.`)
      : `Paused at ${fmt(p.cursor)} of ${fmt(p.total)}. Saved on this device: close the tab if you like, it carries on from here.`;
    if (!LIVE) $('reset').classList.remove('hidden');
    $('s5').classList.remove('hidden');
    if (TEST_RUN && p.cursor >= p.total) { $('mint').disabled = true; $('mine').textContent = ''; shown = 0; iter = null; openMore(); }
  } catch (e) {
    m.className = 'msg bad';
    m.textContent = /denied|declin|permission/i.test(String(e && e.message)) ? 'Your wallet said no, so nothing was encrypted. Try again when you’re ready.' : 'It stopped. Try again: it carries on from the last saved batch.';
  } finally {
    running = null;
    $('mint').textContent = mintLabel();
  }
});

async function clearOutputs(k) { for (let b = 0; ; b++) { if (!(await kv.get(`${k}:out:${b}`))) break; await kv.del(`${k}:out:${b}`); } }

$('reset').addEventListener('click', async () => {
  if (!plan || running) return;
  await clearOutputs(key()).catch(() => {});
  await clearProgress(kv, key()).catch(() => {});
  $('reset').classList.add('hidden'); $('bar4').style.display = 'none'; $('s5').classList.add('hidden'); $('mine').textContent = '';
  $('m4').className = 'msg'; $('m4').textContent = 'Progress cleared on this device.';
});

// ── step 5: read back. Decrypted here, in this tab, by your wallet. "Make public" is per post and opt-in.
async function* myRecords(w) {
  // this device first (kept as each batch was written); another device reads the chain instead
  let any = false;
  for (let b = 0; ; b++) {
    const o = await kv.get(`${key()}:out:${b}`);
    if (!o) break;
    const txids = (await kv.get(`${key()}:tx:${b}`)) || [];
    for (const [j, it] of o.items.entries()) { any = true; yield { script: o.scripts[it.vout], at: LIVE && txids[j] ? txids[j] : `dry run ${b + 1}:${it.vout}` }; }
  }
  if (any || !LIVE) return;
  // live: walk the pot address's history on chain (archive txs aren't wallet actions; they spend the pot)
  pk = pk || (await potKey(w, plan.accountId));
  const hist = await (await fetch(`${WOC}/address/${pk.address}/history`)).json();
  for (const h of Array.isArray(hist) ? hist : []) {
    const raw = await (await fetch(`${WOC}/tx/${h.tx_hash}/hex`)).text();
    const outs = txOutputScripts(raw.trim());
    for (const [i, sc] of outs.entries()) if (parseArchiveScript(sc)) yield { script: sc, at: `${h.tx_hash}:${i}` };
  }
}

const SHOW = 50;
let shown = 0, iter = null;
async function openMore() {
  const m = $('m5'); m.className = 'msg';
  let w;
  try { w = await getWallet(); } catch { m.className = 'msg bad'; m.textContent = 'Connect bWalletX first: only your wallet can open your archive.'; return; }
  m.textContent = 'Opening on this device…';
  iter = iter || myRecords(w);
  let n = 0;
  try {
    for (;;) {
      if (n >= SHOW) break;
      const nx = await iter.next();
      if (nx.done) { iter = null; break; }
      const o = await openArchiveScript(w, nx.value.script);
      if (o) { row(o.payload, nx.value.at); n++; shown++; }
    }
    m.textContent = shown ? `${fmt(shown)} posts opened. Only you can see these.` : 'Nothing here yet.';
    $('more').classList.toggle('hidden', !iter);
  } catch { m.className = 'msg bad'; m.textContent = 'Couldn’t open your archive. Your wallet has to approve opening it.'; }
}

function row(p, at) {
  const d = document.createElement('div'); d.className = 'rec';
  const pill = document.createElement('span'); pill.className = 'pill'; pill.textContent = p.created_at.slice(0, 10);
  const lock = document.createElement('span'); lock.className = 'small'; lock.textContent = 'Private';
  const t = document.createElement('div'); t.className = 't'; t.textContent = p.text; // untrusted: text only
  const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-ghost mini'; b.textContent = 'Make public';
  const out = document.createElement('code'); out.className = 'hidden';
  b.onclick = () => makePublic(p, at, b, out, lock);
  d.append(pill, lock, t, b, out); $('mine').appendChild(d);
}

async function makePublic(p, at, btn, out, lock) {
  if (!confirm('Make this one post public on bChatX? Anyone will be able to read it, for good. The rest of your archive stays private.')) return;
  const record = /^[0-9a-f]{64}:\d+$/.test(at) ? at : undefined;
  // a thread reply links into its thread when its parent was made public too
  const pub = (await kv.get(`${key()}:public`)) || {};
  const parentPublicTxid = p.reply_to ? pub[p.reply_to] : undefined;
  if (!LIVE) {
    out.textContent = 'Dry run, not sent: MAP SET ' + publicPostMap(p, { record, parentPublicTxid }).map(([k, v]) => `${k} ${v}`).join(' ');
    pub[p.x_id] = 'dry-' + p.x_id; await kv.set(`${key()}:public`, pub);
    out.classList.remove('hidden'); btn.disabled = true; btn.textContent = 'Would be public';
    return;
  }
  try {
    const w = await getWallet();
    btn.disabled = true; btn.textContent = 'Publishing…';
    const r = await w.createAction({ description: 'Make one archived post public on bChatX', labels: ['bchat post'],
      outputs: [{ lockingScript: publicPostScript(p, { record, parentPublicTxid }), satoshis: 0, outputDescription: 'Public bChatX post' }] });
    if (r.txid) { pub[p.x_id] = r.txid; await kv.set(`${key()}:public`, pub); }
    btn.textContent = 'Public'; lock.textContent = 'Public';
    out.textContent = r.txid || ''; out.classList.remove('hidden');
  } catch { btn.disabled = false; btn.textContent = 'Make public'; }
}

$('open').addEventListener('click', () => { $('mine').textContent = ''; shown = 0; iter = null; openMore(); });
$('more').addEventListener('click', openMore);

fetch('https://api.whatsonchain.com/v1/bsv/main/exchangerate').then((r) => r.json()).then((j) => { bsvUsd = Number(j.rate) || null; show(); }).catch(() => {});
