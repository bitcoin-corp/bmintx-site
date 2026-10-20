// POST /api/x/unlink  (signed in with bWalletX on bmintx.com) -> { removed: n }
// Removes your X link from the on-b directory, so friends' imports stop finding you.
import { readCookie, verifySession } from '@bwalletx/connect/server';
import { originOk, secret } from '../bwalletx/_auth.js';
import { db } from '../_db.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).end();
  if (!originOk(req.headers.origin)) return res.status(403).json({ error: 'Wrong origin.' });
  const s = secret(), q = db();
  if (!s || !q) return res.status(503).json({ error: 'Not switched on yet.' });
  const me = (await verifySession(readCookie(req.headers.cookie, 'bwx_session'), { secret: s }))?.sub;
  if (!me) return res.status(401).json({ error: 'Connect bWalletX first.' });
  const r = await q(`bx_handles?network=eq.x&identity_key=eq.${me}`, { method: 'DELETE', headers: { prefer: 'return=representation' } });
  if (!r.ok) return res.status(502).json({ error: 'Could not remove it. Try again.' });
  return res.status(200).json({ removed: (await r.json()).length });
}
