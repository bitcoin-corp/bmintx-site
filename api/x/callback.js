// GET /api/x/callback?code&state -> who you are + your counts, then straight back to /flick-off/x.
// The access token is used once for /2/users/me and revoked immediately; nothing is stored.
// Results travel in the URL FRAGMENT (#x=...), which browsers never send to any server.
import { ME_URL, REVOKE_URL, TOKEN_URL, basic, config, openState, redirectUri } from './_oauth.js';
import { db } from '../_db.js';

// where a verified link sends you afterwards (fixed list: never an address from the request)
const RETURN = { bfriendsx: 'https://bfriendsx.com/friends', '': '/link/x' };
const linked = (res, st, payload) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.redirect(302, (RETURN[st.r] ?? RETURN['']) + '#' + new URLSearchParams(payload));
};

/** Link X account -> wallet. One wallet per X account and one X account per wallet: the newest proof wins. */
async function saveLink(identityKey, id, handle) {
  const q = db(); if (!q) return false;
  const del = await q(`bx_handles?network=eq.x&or=(identity_key.eq.${identityKey},account_id.eq.${encodeURIComponent(id)})`, { method: 'DELETE' });
  if (!del.ok) return false;
  const ins = await q('bx_handles', { method: 'POST', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ identity_key: identityKey, network: 'x', account_id: id, handle }) });
  return ins.ok;
}

const back = (res, payload) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.redirect(302, '/flick-off/x#x=' + Buffer.from(JSON.stringify(payload)).toString('base64url'));
};

export default async function handler(req, res) {
  const c = config();
  if (!c) return back(res, { error: 'offline' });
  if (req.query.error) { const st0 = openState(c.key, req.query.state); return st0?.k ? linked(res, st0, { err: 'denied' }) : back(res, { error: 'denied' }); }
  const st = openState(c.key, req.query.state);
  if (!st || !req.query.code) return back(res, { error: 'expired' });
  const fail = (e) => (st.k ? linked(res, st, { err: e }) : back(res, { error: e }));
  try {
    const tok = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: basic(c), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: redirectUri(), code_verifier: st.v }),
    });
    if (!tok.ok) return fail('token');
    const { access_token } = await tok.json();
    const me = await fetch(ME_URL, { headers: { Authorization: `Bearer ${access_token}` } });
    const j = me.ok ? await me.json() : null;
    // revoke now: we proved who they are and counted their posts; we keep no credential
    fetch(REVOKE_URL, { method: 'POST', headers: { Authorization: basic(c), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: access_token, token_type_hint: 'access_token' }) }).catch(() => {});
    if (!j?.data) return fail('me');
    if (st.k) return (await saveLink(st.k, j.data.id, j.data.username)) ? linked(res, st, { linked: 'x', handle: j.data.username }) : linked(res, st, { err: 'save' });
    const m = j.data.public_metrics || {};
    return back(res, {
      handle: j.data.username, name: j.data.name, avatar: j.data.profile_image_url, since: j.data.created_at,
      posts: m.tweet_count || 0, followers: m.followers_count || 0, following: m.following_count || 0,
      readUsd: Number(process.env.X_READ_USD_PER_POST) || null,
    });
  } catch {
    return fail('token');
  }
}
