// Sign in with X for bMintX (FLICK OFF). OAuth 2.0 + PKCE against bMintX's OWN X app (not bChatX's).
// The PKCE verifier rides inside an AES-GCM encrypted `state`, so no server store is needed and the
// browser can neither read nor forge it (same design as bit-sign's lib/x-oauth.ts).
//
// Env (Vercel, project bmintx): X_CLIENT_ID, X_CLIENT_SECRET, X_STATE_SECRET (64 hex chars).
// Callback registered in X's developer portal: https://bmintx.com/api/x/callback
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export const AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';
export const TOKEN_URL = 'https://api.x.com/2/oauth2/token';
export const REVOKE_URL = 'https://api.x.com/2/oauth2/revoke';
export const ME_URL = 'https://api.x.com/2/users/me?user.fields=profile_image_url,public_metrics,created_at';
// users.read + tweet.read only: enough to show who you are and count your posts. No offline.access,
// so no refresh token: we never hold a lasting credential for someone's X account.
export const SCOPES = 'users.read tweet.read';
const STATE_TTL_MS = 10 * 60_000;

export function config() {
  const id = process.env.X_CLIENT_ID, secret = process.env.X_CLIENT_SECRET, key = process.env.X_STATE_SECRET;
  if (!id || !secret || !/^[0-9a-f]{64}$/i.test(key || '')) return null;
  return { id, secret, key: Buffer.from(key, 'hex') };
}

export const redirectUri = () => (process.env.BMINTX_ORIGIN || 'https://bmintx.com') + '/api/x/callback';

export function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export function sealState(key, data) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(JSON.stringify({ ...data, t: Date.now() }), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64url');
}

/** Open something sealed by sealState, if it is genuine and younger than `ttlMs` (and not from the future). */
export function openSealed(key, sealed, ttlMs) {
  try {
    const b = Buffer.from(String(sealed), 'base64url');
    if (b.length < 29) return null;
    const d = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    const j = JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
    const age = Date.now() - Number(j.t);
    return age >= -60_000 && age < ttlMs ? j : null;
  } catch { return null; }
}

export const openState = (key, state) => openSealed(key, state, STATE_TTL_MS);

/** The archive-owner proof (`p: 'x-owner'`) lives longer than a sign-in: long enough to read and mint a big archive. */
export const PROOF_TTL_MS = 24 * 60 * 60_000;
export function openProof(key, proof) {
  const j = openSealed(key, proof, PROOF_TTL_MS);
  return j && j.p === 'x-owner' && /^\d{1,25}$/.test(String(j.id)) ? { id: String(j.id), handle: String(j.handle || ''), t: Number(j.t) } : null;
}

/** X wants the client credentials as HTTP Basic on the token endpoint, not in the body. */
export const basic = (c) => 'Basic ' + Buffer.from(`${c.id}:${c.secret}`).toString('base64');
