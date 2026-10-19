// GET /api/x/callback?code&state -> who you are + your counts, then straight back to /flick-off/x.
// The access token is used once for /2/users/me and revoked immediately; nothing is stored.
// Results travel in the URL FRAGMENT (#x=...), which browsers never send to any server.
import { ME_URL, REVOKE_URL, TOKEN_URL, basic, config, openState, redirectUri } from './_oauth.js';

const back = (res, payload) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.redirect(302, '/flick-off/x#x=' + Buffer.from(JSON.stringify(payload)).toString('base64url'));
};

export default async function handler(req, res) {
  const c = config();
  if (!c) return back(res, { error: 'offline' });
  if (req.query.error) return back(res, { error: 'denied' });
  const st = openState(c.key, req.query.state);
  if (!st || !req.query.code) return back(res, { error: 'expired' });
  try {
    const tok = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: basic(c), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: redirectUri(), code_verifier: st.v }),
    });
    if (!tok.ok) return back(res, { error: 'token' });
    const { access_token } = await tok.json();
    const me = await fetch(ME_URL, { headers: { Authorization: `Bearer ${access_token}` } });
    const j = me.ok ? await me.json() : null;
    // revoke now: we proved who they are and counted their posts; we keep no credential
    fetch(REVOKE_URL, { method: 'POST', headers: { Authorization: basic(c), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: access_token, token_type_hint: 'access_token' }) }).catch(() => {});
    if (!j?.data) return back(res, { error: 'me' });
    const m = j.data.public_metrics || {};
    return back(res, {
      handle: j.data.username, name: j.data.name, avatar: j.data.profile_image_url, since: j.data.created_at,
      posts: m.tweet_count || 0, followers: m.followers_count || 0, following: m.following_count || 0,
      readUsd: Number(process.env.X_READ_USD_PER_POST) || null,
    });
  } catch {
    return back(res, { error: 'token' });
  }
}
