/**
 * X archive straight from the zip, on the device: no upload, no full load. Only data/tweets*.js,
 * data/note-tweet*.js and data/account.js are ever opened; media is sized from the zip's directory.
 * DMs, contacts and everything else stay closed.
 *
 * Then: an ownership check (the archive's accountId must be the X account the person signed in with) and
 * the bChatX records a mint would write, as a DRY RUN (nothing is signed or broadcast here).
 */
import { openZip } from './zip.js';
import { planX, costSats, X_POST_OVERHEAD } from './index.js';
/** The only entries we ever open. */
// (own literal, not index.ts's TWEETS_JS: index re-exports this module, so its constants aren't ready at load)
export const X_ARCHIVE_OPEN = [/(^|\/)data\/(tweets?|note-tweets?)(-part\d+)?\.js$/, /(^|\/)data\/account\.js$/];
export function zipFlickFiles(zip) {
    return zip.entries.filter((e) => !e.dir).map((e) => ({
        path: e.name, size: e.size,
        text: () => (X_ARCHIVE_OPEN.some((re) => re.test(e.name)) ? zip.text(e) : Promise.resolve('')),
    }));
}
/** Read an X archive zip (a File / Blob) on the device. */
export async function readXArchive(blob) {
    const zip = await openZip(blob);
    const files = zipFlickFiles(zip);
    const plan = await planX(files);
    const opened = zip.entries.filter((e) => !e.dir && X_ARCHIVE_OPEN.some((re) => re.test(e.name)));
    return { plan, entries: zip.entries.length, bytesRead: zip.bytesRead + opened.reduce((a, e) => a + e.compressedSize + 30 + e.name.length, 0), archiveBytes: blob.size };
}
/** The archive must belong to the X account proven by Sign in with X (by numeric id; handles can change). */
export function checkOwnership(plan, who) {
    if (!who?.id)
        return { ok: false, reason: 'not-signed-in' };
    if (!/^\d{1,25}$/.test(plan.accountId))
        return { ok: false, reason: 'no-account-id' };
    return plan.accountId === who.id ? { ok: true } : { ok: false, reason: 'different-account' };
}
// ── mint batch (DRY RUN) ──────────────────────────────────────────────────────
/** bChatX post records (bit-sign src/lib/feed/script.ts): B text + MAP SET app bChat type post … + AIP. */
export const BCHAT_APP = 'bChat';
export const MAP_PREFIX = '1PuQa7K62MiKCtssSLKy1kh56WWU7MtUR5';
export const B_PREFIX = '19HxigV4QyBv3tHpQVcUEQyq1pzZVdoAut';
/** bChatX Plus post limit (MAX_PLUS_POST_CHARS); longer posts are flagged, never silently cut. */
export const MAX_POST_CHARS = 10_000;
const mapFor = (p) => {
    const kv = [['app', BCHAT_APP], ['type', 'post']];
    if (p.parentId)
        kv.push(['context', 'tx'], ['tx', `<txid of ${p.parentId}>`]);
    else if (p.replyUrl)
        kv.push(['context', 'url'], ['url', p.replyUrl]);
    kv.push(['source', 'x'], ['source_id', p.id], ['source_at', p.at], ['source_url', p.url]);
    return kv;
};
/** Build what a mint would write, oldest first (a thread's parent is signed before its replies). No keys, no network. */
export function buildMintBatch(plan, opts = {}) {
    const enc = new TextEncoder();
    const posts = opts.limit ? plan.posts.slice(0, opts.limit) : plan.posts;
    const records = posts.map((p) => {
        const map = mapFor(p);
        const bytes = X_POST_OVERHEAD + enc.encode(p.text).length;
        return {
            xId: p.id, text: p.text, map, parentXId: p.parentId, bytes, sats: costSats(bytes), fits: p.text.length <= MAX_POST_CHARS,
            outline: `B ${JSON.stringify(p.text.length > 80 ? p.text.slice(0, 80) + '…' : p.text)} text/plain utf-8 | MAP SET ${map.map(([k, v]) => `${k} ${v}`).join(' ')}`,
        };
    });
    return {
        dryRun: true, app: BCHAT_APP, records,
        link: { map: [['app', BCHAT_APP], ['type', 'link'], ['network', 'x'], ['account_id', plan.accountId], ['handle', plan.username]] },
        totalSats: records.reduce((a, r) => a + r.sats, 0),
        tooLong: records.filter((r) => !r.fits).length,
    };
}
