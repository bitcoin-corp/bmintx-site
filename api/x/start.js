// GET /api/x/start -> redirect to X's consent screen for bMintX.
import { AUTHORIZE_URL, SCOPES, config, pkce, redirectUri, sealState } from './_oauth.js';

export default function handler(req, res) {
  const c = config();
  if (!c) return res.redirect(302, '/flick-off/x#x=offline');
  const { verifier, challenge } = pkce();
  const q = new URLSearchParams({
    response_type: 'code', client_id: c.id, redirect_uri: redirectUri(), scope: SCOPES,
    state: sealState(c.key, { v: verifier }), code_challenge: challenge, code_challenge_method: 'S256',
  });
  res.setHeader('Cache-Control', 'no-store');
  return res.redirect(302, `${AUTHORIZE_URL}?${q}`);
}
