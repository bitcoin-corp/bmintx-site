/* Connect bWalletX on bmintx.com: drop <span data-bwx></span> anywhere and include this after
   @bwalletx/connect's global build and qrcode-generator. Extension / in-app wallets connect straight away;
   on a desktop with no extension it shows a QR to pair the phone app (or paste into web.bwalletx.com). */
(() => {
  const C = window.bWalletXConnect;
  const slots = [...document.querySelectorAll('[data-bwx]')];
  // No button on this page still finishes a sign-in bWalletX sent back here (#bwx=ok…, connect 0.9.0).
  if (!C || (!slots.length && !C.hasReturnFragment?.())) return;
  const short = (k) => k.slice(0, 6) + '…' + k.slice(-4);
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const css = document.createElement('style');
  css.textContent = `.bwx-btn{display:inline-flex;align-items:center;gap:8px;min-height:38px;padding:0 16px;border-radius:999px;border:1px solid rgba(255,210,77,.45);background:#0b0b0c;color:#ffd24d;font:600 14px 'Space Grotesk',sans-serif;cursor:pointer}
  .bwx-btn:hover{border-color:#ffd24d}.bwx-btn.on{background:linear-gradient(180deg,#ffe58a,#ffd24d 55%,#e0a800);color:#000;border:0}
  .bwx-dot{width:8px;height:8px;border-radius:50%;background:currentColor;flex:none}
  header .bwx-btn{max-width:min(46vw,260px);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}@media(max-width:520px){header .bwx-btn{padding:0 12px}.bwx-btn .w{display:none}}
  .bwx-modal{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.8);display:grid;place-items:center;padding:16px}
  .bwx-card{background:#0b0b0c;border:1px solid rgba(255,210,77,.3);border-radius:20px;padding:24px;max-width:360px;width:100%;text-align:center;color:#f4f1e8;font:400 15px/1.5 'IBM Plex Sans',sans-serif}
  .bwx-card h3{font:700 22px 'Space Grotesk';margin:0 0 6px}.bwx-qr{background:#fff;border-radius:12px;padding:12px;margin:14px auto;width:max-content}
  .bwx-code{font:700 30px 'Space Grotesk';letter-spacing:.2em;color:#ffd24d}.bwx-x{margin-top:14px;background:none;border:0;color:#9a968b;cursor:pointer;font-size:14px}
  .bwx-link{word-break:break-all;font-size:11px;color:#9a968b;background:#000;border-radius:8px;padding:8px;margin-top:8px;cursor:copy}`;
  document.head.appendChild(css);

  let key = null;
  let handle = null;
  // Public, CORS-open lookup: the $handle (bWalletX paymail) for this identity key, if it has one.
  const lookup = async (k) => {
    handle = null;
    try {
      const r = await fetch(`https://pay.bwallet.space/api/paymail/lookup?key=${encodeURIComponent(k)}`);
      const j = r.ok ? await r.json() : null;
      const pm = j && typeof j.paymail === 'string' ? j.paymail : null;
      if (pm && key === k) { handle = '$' + pm.split('@')[0]; draw(); }
    } catch {}
  };
  const draw = () => slots.forEach((s) => {
    s.innerHTML = '';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bwx-btn' + (key ? ' on' : '');
    b.innerHTML = key ? `<span class="bwx-dot"></span>${esc(handle || 'bWalletX ' + short(key))}` : 'Connect<span class="w"> bWalletX</span>';
    b.title = key ? 'Connected. Click to disconnect.' : 'Connect your bWalletX';
    b.onclick = key ? disconnect : connect;
    s.appendChild(b);
  });
  const post = async (url, body) => {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  };
  let modal = null;
  const close = () => { modal?.remove(); modal = null; };
  const show = (html) => {
    close();
    modal = document.createElement('div'); modal.className = 'bwx-modal';
    modal.innerHTML = `<div class="bwx-card">${html}<button class="bwx-x" type="button">Cancel</button></div>`;
    modal.querySelector('.bwx-x').onclick = close;
    modal.onclick = (e) => { if (e.target === modal) close(); };
    document.body.appendChild(modal);
    return modal.querySelector('.bwx-card');
  };

  // Connect 0.9.0, sign-in on the same phone: bWalletX signs in on its Connect card and sends the user back to this
  // site's root (#bwx=ok…, often in a new tab), where resumeReturned() finishes it. That tab needs the challenge's
  // sealed ticket for /api/bwalletx/verify, so it is kept here by nonce (it holds no secret: the challenge is public).
  // Entries go once used, or after 10 minutes.
  const TICKETS = 'bwx:tickets';
  const tickets = (fn) => {
    try {
      const m = JSON.parse(localStorage.getItem(TICKETS) || '{}') || {};
      for (const n of Object.keys(m)) if (!(Date.now() - m[n].at < 6e5)) delete m[n];
      const out = fn(m);
      localStorage.setItem(TICKETS, JSON.stringify(m));
      return out;
    } catch { return null; }
  };
  const keepTicket = (nonce, ticket) => tickets((m) => { m[nonce] = { ticket, at: Date.now() }; });
  const takeTicket = (nonce) => tickets((m) => { const t = m[nonce] || null; delete m[nonce]; return t; });
  const here = () => location.origin + location.pathname;
  const go = (to) => { const u = new URL(to, location.origin); if (u.origin === location.origin && u.href !== here()) location.replace(u.href); };

  const signedIn = (identityKey) => {
    key = identityKey; close(); draw(); lookup(key);
    document.dispatchEvent(new CustomEvent('bmintx-wallet', { detail: { identityKey: key } }));
  };
  const failed = (e) => {
    if (e && e.code === 'NOT_FOUND') {
      show(`<h3>No bWalletX found</h3><p>Get the bWalletX extension or app, or use the web wallet.</p><p><a class="bwx-btn on" href="https://bwalletx.com/get">Get bWalletX</a></p>`);
    } else if (modal) {
      modal.querySelector('.bwx-card').insertAdjacentHTML('beforeend', `<p style="color:#ff8a7a">${esc((e && e.message) || 'That didn’t work. Try again.')}</p>`);
    } else {
      show(`<h3>Couldn’t connect</h3><p style="color:#ff8a7a">${esc((e && e.message) || 'Try again.')}</p>`);
    }
  };

  async function connect() {
    let ticket = null, pre = null, app = null;
    const challenge = async (identityKey) => { const ch = await post('/api/bwalletx/challenge', identityKey ? { identityKey } : {}); ticket = ch.ticket; return ch; };
    try {
      // On a phone: "Open bWalletX" (a QR can't be scanned by the phone showing it), with the sign-in folded into
      // Connect so bWalletX asks once and comes back here signed in.
      if (C.isTouchDevice?.()) {
        app = C.pairingModal();
        pre = await challenge().catch(() => null);
        const login = pre && C.foldableLogin?.(pre, location.origin);
        if (login) { app.login = login; keepTicket(pre.nonce, ticket); } else pre = null;
      }
      const r = await C.signInWithBwalletX({
        // A folded sign-in needs a fresh link: a stored pairing would wait on an app in the background.
        reusePairing: !(app && app.login),
        challenge: (identityKey) => { const c = pre; pre = null; return c ? Promise.resolve(c) : challenge(identityKey); },
        pairing: app || {
          onLink: (link) => {
            let qr = '';
            if (window.qrcode) { const q = window.qrcode(0, 'M'); q.addData(link); q.make(); qr = q.createSvgTag({ cellSize: 4, margin: 0 }); }
            const card = show(`<h3>Connect bWalletX</h3><p>Scan with the bWalletX app on your phone, or paste the link into <a href="https://web.bwalletx.com" target="_blank" rel="noopener" style="color:#ffd24d">web.bwalletx.com</a>.</p><div class="bwx-qr">${qr}</div><div class="bwx-link" title="Click to copy">${esc(link)}</div><p id="bwxCode" style="margin:12px 0 0"></p>`);
            card.querySelector('.bwx-link').onclick = () => navigator.clipboard?.writeText(link);
          },
          onCode: (code) => { const el = document.getElementById('bwxCode'); if (el) el.innerHTML = `Check your wallet shows <span class="bwx-code">${esc(code)}</span>, then tap Connect.`; },
        },
      });
      app?.close();
      const v = await post('/api/bwalletx/verify', { identityKey: r.identityKey, nonce: r.nonce, signature: r.signature, ticket });
      takeTicket(r.nonce);
      signedIn(v.identityKey);
    } catch (e) {
      app?.close();
      // bWalletX came back in another tab, which finished the sign-in: pick up its session here.
      if (e && e.code === 'RETURNED_IN_ANOTHER_TAB') return session();
      if (e && e.message === 'cancelled') return draw();
      failed(e);
    }
  }
  // The tab bWalletX returned to: finish the pairing, post the sign-in it folded into Connect, go back to the page the
  // sign-in started on. Resolves true when this page is now signed in (or leaving).
  async function resumeReturned() {
    let r = null;
    try { r = await C.resumeReturnedPairing(); } catch {}
    if (!r) return false;
    try {
      const t = r.login && takeTicket(r.login.nonce);
      let v;
      if (r.login && t) {
        v = await post('/api/bwalletx/verify', { identityKey: r.login.identityKey, nonce: r.login.nonce, signature: r.login.signature, ticket: t.ticket });
      } else {
        // Paired, but no sign-in came with it (an older bWalletX): ask the paired wallet for it the usual way.
        let ticket = null;
        const s = await C.signInWithBwalletX({ wallet: r.wallet, challenge: async (identityKey) => { const ch = await post('/api/bwalletx/challenge', identityKey ? { identityKey } : {}); ticket = ch.ticket; return ch; } });
        v = await post('/api/bwalletx/verify', { identityKey: s.identityKey, nonce: s.nonce, signature: s.signature, ticket });
      }
      signedIn(v.identityKey);
      if (r.page) go(r.page);
      return true;
    } catch (e) {
      failed(e);
      return false;
    }
  }
  async function disconnect() {
    await post('/api/bwalletx/session', {}).catch(() => {});
    try { C.clearPairing?.(); } catch {}
    // Tell the bWalletX extension this site disconnected, so it stops wearing the bMintX theme.
    try { window.postMessage({ type: 'bwallet:disconnect' }, location.origin); } catch {}
    key = null; handle = null; draw();
  }
  // After a reload the session cookie says who you are, but the wallet only wears this site's theme once the page
  // has talked to it. So with an extension or in-app wallet, quietly ask for the identity key again (no pairing).
  const touch = async () => {
    try {
      const f = await C.discoverBwalletX?.(800);
      if (f && f.wallet) await f.wallet.getPublicKey({ identityKey: true });
    } catch {}
  };
  const session = () => fetch('/api/bwalletx/session', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => {
    key = j.identityKey || null; draw();
    if (key) { lookup(key); touch(); }
  }).catch(draw);
  (C.hasReturnFragment?.() ? resumeReturned() : Promise.resolve(false)).then((done) => { if (!done) session(); });
  // Signed out and back on this tab (say, from bWalletX): the sign-in may have finished in another tab.
  document.addEventListener('visibilitychange', () => { if (!key && document.visibilityState === 'visible') session(); });
  draw();
})();
