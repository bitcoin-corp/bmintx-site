/* FLICK OFF: the switch, the handle estimate and the in-browser X archive reader. No tracking, no uploads. */
(() => {
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.round(n).toLocaleString('en-GB');

  // Cost model (cost price). Fee rate matches the NPG/bMintX minting scripts (100 sat/kB).
  const SAT_PER_KB = 100;
  const BYTES_PER_POST = 650;        // post text + MAP fields + signature, typical
  const BYTES_PER_MEDIA = 150 * 1024; // average compressed photo; videos are bigger
  let bsvUsd = null;
  fetch('https://api.whatsonchain.com/v1/bsv/main/exchangerate').then((r) => r.json()).then((j) => { bsvUsd = Number(j.rate) || null; render(); }).catch(() => {});

  const usd = (sats) => (bsvUsd ? '$' + ((sats / 1e8) * bsvUsd).toFixed(2) : fmt(sats) + ' sats');
  const sats = (posts, media) => ((posts * BYTES_PER_POST + media * BYTES_PER_MEDIA) / 1024) * SAT_PER_KB;

  // the switch flicks itself once, then on click
  const flick = $('flick');
  const toggle = () => { flick.classList.toggle('on'); $('knobTxt').textContent = flick.classList.contains('on') ? 'b' : '𝕏'; };
  setTimeout(toggle, 900);
  flick.addEventListener('click', toggle);

  // ---- estimate state
  let st = null; // {source:'handle'|'guess'|'archive', posts, media, followers, following, readUsd}
  function render() {
    if (!st) return;
    $('est').classList.add('show');
    $('sPosts').textContent = fmt(st.posts);
    $('sFollowers').textContent = st.followers != null ? fmt(st.followers) : '–';
    $('sFollowing').textContent = st.following != null ? fmt(st.following) : '–';
    const media = st.media ?? Math.round(st.posts * 0.15); // ~15% of posts carry media when we can't count
    const mint = sats(st.posts, media);
    const rows = [
      [`Mint ${fmt(st.posts)} posts to Bitcoin`, usd(sats(st.posts, 0))],
      [`Mint ${st.media != null ? '' : '~'}${fmt(media)} photos and videos`, usd(sats(0, media))],
    ];
    let total = usd(mint);
    if (st.source !== 'archive') {
      if (st.readUsd) {
        const x = st.posts * st.readUsd;
        rows.push(['X’s API fee to fetch them', '$' + x.toFixed(2)]);
        if (bsvUsd) total = '$' + (x + (mint / 1e8) * bsvUsd).toFixed(2);
      } else rows.push(['X’s API fee to fetch them', 'shown when you sign in']);
      rows.push(['Bring your archive instead', 'skips X’s fee']);
    }
    $('bill').innerHTML = rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('') + `<tr class="total"><td>Estimated cost price</td><td>${total}</td></tr>`;
  }

  // ---- by handle
  $('handleForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const h = $('handle').value.trim().replace(/^@/, '');
    $('eMsg').className = 'msg'; $('eMsg').textContent = '';
    if (!/^[A-Za-z0-9_]{1,15}$/.test(h)) { $('eMsg').className = 'msg bad'; $('eMsg').textContent = 'That isn’t an X handle: letters, numbers and _ only, up to 15.'; $('est').classList.add('show'); return; }
    $('eMsg').textContent = 'Looking up @' + h + '…'; $('est').classList.add('show');
    try {
      const r = await fetch('/api/x-estimate?handle=' + encodeURIComponent(h));
      const j = await r.json();
      if (r.ok) {
        $('manual').classList.remove('show');
        $('eAvatar').src = j.avatar || ''; $('eName').textContent = j.name || '@' + j.handle; $('eHandle').textContent = '@' + j.handle;
        st = { source: 'handle', posts: j.posts, followers: j.followers, following: j.following, readUsd: j.readUsd };
        $('eMsg').textContent = '';
      } else if (j.error === 'lookup-offline') {
        guessMode(h, j.readUsd);
      } else { $('eMsg').className = 'msg bad'; $('eMsg').textContent = j.error; return; }
    } catch { guessMode(h, null); }
    render();
  });
  function guessMode(h, readUsd) {
    $('eAvatar').removeAttribute('src'); $('eName').textContent = '@' + h; $('eHandle').textContent = 'live lookup offline';
    $('manual').classList.add('show');
    st = { source: 'guess', posts: Number($('postsGuess').value), followers: null, following: null, readUsd };
    $('eMsg').textContent = 'Or drop your archive below for an exact count.';
  }
  $('postsGuess').addEventListener('input', (e) => { $('guessOut').textContent = fmt(e.target.value); if (st && st.source === 'guess') { st.posts = Number(e.target.value); render(); } });

  // Sign in with X: /api/x/start -> X consent -> /api/x/callback -> back here with #x=<base64url json>
  $('signInX').addEventListener('click', () => { location.href = '/api/x/start'; });
  const fromHash = (() => {
    const m = /[#&]x=([A-Za-z0-9_-]+)/.exec(location.hash);
    if (!m) return null;
    history.replaceState(null, '', location.pathname); // drop it from the address bar
    try { return JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return { error: 'token' }; }
  })();
  if (fromHash) {
    $('est').classList.add('show');
    if (fromHash.error) {
      $('eMsg').className = 'msg bad';
      $('eMsg').textContent = {
        offline: 'Sign in with X isn’t switched on yet. Type your handle above or drop your archive below.',
        denied: 'You cancelled the X sign-in. No problem: type your handle or drop your archive instead.',
        expired: 'That sign-in took too long. Try again.',
      }[fromHash.error] || 'X sign-in didn’t work this time. Try again, or drop your archive below.';
    } else {
      $('eAvatar').src = fromHash.avatar || ''; $('eName').textContent = fromHash.name || '@' + fromHash.handle;
      $('eHandle').textContent = '@' + fromHash.handle + ' · signed in with X';
      $('handle').value = fromHash.handle;
      st = { source: 'handle', posts: fromHash.posts, followers: fromHash.followers, following: fromHash.following, readUsd: fromHash.readUsd };
      $('eMsg').className = 'msg';
      $('eMsg').textContent = 'Signed in. We used your sign-in once to count your posts, then handed it back to X. Nothing stored.';
      render();
    }
  }

  // ---- the archive (read locally with JSZip; only the small data/*.js files are opened)
  const drop = $('drop'), zipIn = $('zip');
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) readArchive(f); });
  zipIn.addEventListener('change', () => zipIn.files[0] && readArchive(zipIn.files[0]));

  const ytd = (txt) => { const i = txt.indexOf('['); return i < 0 ? [] : JSON.parse(txt.slice(i)); };
  async function readArchive(file) {
    const out = $('zipOut'); out.className = 'msg'; out.textContent = 'Reading ' + file.name + ' on your device…';
    $('bar').style.display = 'block'; $('barI').style.width = '15%';
    try {
      const zip = await JSZip.loadAsync(file);
      $('barI').style.width = '55%';
      const pick = (...names) => names.map((n) => zip.file(new RegExp('(^|/)data/' + n + '\\.js$'))[0]).find(Boolean);
      const read = async (f) => (f ? ytd(await f.async('string')) : null);
      const [tweets, followers, following, dms, account] = await Promise.all([
        read(pick('tweets', 'tweet')), read(pick('follower')), read(pick('following')),
        read(pick('direct-messages', 'direct-message')), read(pick('account')),
      ]);
      if (!tweets) throw new Error('no-tweets');
      const media = Object.keys(zip.files).filter((n) => /data\/tweets?_media\//.test(n) && !zip.files[n].dir).length;
      const dmCount = dms ? dms.reduce((a, c) => a + ((c.dmConversation && c.dmConversation.messages) || []).length, 0) : 0;
      const acct = account && account[0] && account[0].account;
      $('barI').style.width = '100%';
      st = { source: 'archive', posts: tweets.length, media, followers: followers ? followers.length : null, following: following ? following.length : null };
      $('eAvatar').removeAttribute('src');
      $('eName').textContent = acct ? acct.accountDisplayName || '@' + acct.username : 'Your archive';
      $('eHandle').textContent = acct ? '@' + acct.username + ' · from your archive' : 'from your archive';
      $('manual').classList.remove('show');
      out.innerHTML = `Found <b class="gold">${fmt(tweets.length)}</b> posts, <b class="gold">${fmt(media)}</b> photos and videos` +
        (dmCount ? `, and ${fmt(dmCount)} DMs (kept private, opt-in only)` : '') + '. Your estimate is at the top.';
      $('eMsg').textContent = 'Exact count from your archive. No X fees on this route.';
      render();
      document.getElementById('handleForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      out.className = 'msg bad';
      out.textContent = e.message === 'no-tweets'
        ? 'That zip doesn’t look like an X archive: there’s no data/tweets.js inside.'
        : 'Couldn’t read that file. Make sure it’s the .zip X sent you, not unzipped.';
    } finally { setTimeout(() => ($('bar').style.display = 'none'), 600); }
  }
})();
