// GET /api/x-estimate?handle=jack -> public counts for an X account, for the FLICK OFF cost estimate.
// Uses X API v2 user lookup (one cheap call, no tweets read). Needs X_BEARER_TOKEN in the Vercel env;
// without it the page falls back to "roughly how many posts?" and the archive tool, which need no API at all.
// Optional X_READ_USD_PER_POST: X's per-post read price, passed to the page so the fetch route shows X's fee.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');
  const handle = String(req.query.handle || '').trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) return res.status(400).json({ error: 'That isn’t an X handle (letters, numbers and _ only, up to 15).' });
  const readUsd = Number(process.env.X_READ_USD_PER_POST) || null;
  const token = process.env.X_BEARER_TOKEN;
  if (!token) return res.status(503).json({ error: 'lookup-offline', readUsd });
  try {
    const r = await fetch(`https://api.x.com/2/users/by/username/${handle}?user.fields=public_metrics,profile_image_url,name,created_at`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.status === 404) return res.status(404).json({ error: `No X account called @${handle}.` });
    if (!r.ok) return res.status(502).json({ error: 'lookup-offline', readUsd });
    const j = await r.json();
    if (!j.data) return res.status(404).json({ error: `No X account called @${handle}.` });
    const m = j.data.public_metrics || {};
    return res.status(200).json({
      handle: j.data.username, name: j.data.name, avatar: j.data.profile_image_url, since: j.data.created_at,
      posts: m.tweet_count || 0, followers: m.followers_count || 0, following: m.following_count || 0, readUsd,
    });
  } catch {
    return res.status(502).json({ error: 'lookup-offline', readUsd });
  }
}
