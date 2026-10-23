// POST /api/x/proof  { proof } -> { ok, id, handle, issuedAt, expiresAt }
// Checks the sealed "you own this X account" proof that Sign in with X (?to=archive) handed back: genuine
// (AES-GCM under X_STATE_SECRET, so the browser can't forge it), an archive-owner proof (not an OAuth state),
// and under 24 h old. The archive page only lets the mint step go ahead when the archive's accountId equals
// the id this returns. Nothing is stored.
import { config, openProof, PROOF_TTL_MS } from './_oauth.js';
import { originOk } from '../bwalletx/_auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).end();
  if (!originOk(req.headers.origin)) return res.status(403).json({ error: 'Wrong origin.' });
  const c = config();
  if (!c) return res.status(503).json({ error: 'Sign in with X isn’t switched on yet.' });
  const proof = typeof req.body === 'object' && req.body ? req.body.proof : null;
  if (typeof proof !== 'string' || proof.length > 2048) return res.status(400).json({ error: 'No proof.' });
  const p = openProof(c.key, proof);
  if (!p) return res.status(401).json({ ok: false, error: 'That X sign-in has expired. Sign in with X again.' });
  return res.status(200).json({ ok: true, id: p.id, handle: p.handle, issuedAt: new Date(p.t).toISOString(), expiresAt: new Date(p.t + PROOF_TTL_MS).toISOString() });
}
