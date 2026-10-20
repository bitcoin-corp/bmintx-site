// GET /api/x/start            -> redirect to X's consent screen for bMintX (FLICK OFF: who you are + counts).
// GET /api/x/start?link=1&return=bfriendsx -> same, but afterwards link that X account to your connected bWalletX
//     so friends who import you can find you on b. Needs a bWalletX session on bmintx.com.
import { readCookie, verifySession } from '@bwalletx/connect/server';
import { AUTHORIZE_URL, SCOPES, config, pkce, redirectUri, sealState } from './_oauth.js';
import { secret } from '../bwalletx/_auth.js';

export default async function handler(req, res) {
  const c = config();
  const link = req.query.link === '1';
  if (!c) return res.redirect(302, link ? '/link/x#err=offline' : '/flick-off/x#x=offline');
  let k = null;
  if (link) {
    const s = secret();
    k = s ? (await verifySession(readCookie(req.headers.cookie, 'bwx_session'), { secret: s }))?.sub : null;
    if (!k) return res.redirect(302, '/link/x#err=wallet');
  }
  const { verifier, challenge } = pkce();
  const q = new URLSearchParams({
    response_type: 'code', client_id: c.id, redirect_uri: redirectUri(), scope: SCOPES,
    state: sealState(c.key, link ? { v: verifier, k, r: String(req.query.return || '') } : { v: verifier }), code_challenge: challenge, code_challenge_method: 'S256',
  });
  res.setHeader('Cache-Control', 'no-store');
  return res.redirect(302, `${AUTHORIZE_URL}?${q}`);
}
