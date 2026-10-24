import { costSats } from './index.js';
import { MAP_PREFIX, B_PREFIX } from './archive.js';
export const ARCHIVE_PROTOCOL = [2, 'bmintx archive'];
export const ARCHIVE_LABEL = ARCHIVE_PROTOCOL[1];
export const ARCHIVE_APP = 'bmintx';
export const ARCHIVE_VERSION = '1';
/** Signature marker for the seal: ECDSA (DER) over sha256 of the data, with the derived public key (BRC-3). */
export const SEAL_SIG = 'BRC3';
export const PAD_BUCKET = 128;
export const POSTS_PER_TX = 25;
/** BRC-2: 32-byte IV + AES-GCM ciphertext + 16-byte tag. */
export const BRC2_OVERHEAD = 48;
/** Inputs, change output, version/locktime and the seal output, per transaction (estimate). */
export const TX_OVERHEAD_BYTES = 520;
export const payloadFor = (p, ctx) => ({
    v: 1, source: 'x', x_id: p.id, account_id: ctx.accountId, handle: ctx.username, text: p.text, created_at: p.at,
    url: p.url, reply_to: p.parentId, reply_url: p.replyUrl, media: p.media.map((m) => ({ name: m.name, bytes: m.bytes })), long: p.long,
});
const enc = new TextEncoder();
const dec = new TextDecoder();
/** JSON then spaces up to the next PAD_BUCKET (JSON.parse ignores trailing whitespace). */
export function padPlaintext(payload, bucket = PAD_BUCKET) {
    const raw = enc.encode(JSON.stringify(payload));
    const out = new Uint8Array(Math.ceil((raw.length + 1) / bucket) * bucket).fill(0x20);
    out.set(raw);
    return out;
}
export const readPayload = (plaintext) => {
    const j = JSON.parse(dec.decode(Uint8Array.from(plaintext)));
    if (!j || j.v !== 1 || j.source !== 'x' || typeof j.text !== 'string')
        throw new Error('not a bmintx archive payload');
    return j;
};
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (h) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
/** 128-bit random key id, hex. Random, so it says nothing about the post. */
export function newKeyId(rand = (a) => globalThis.crypto.getRandomValues(a)) {
    return hex(rand(new Uint8Array(16)));
}
// ── script building (OP_FALSE OP_RETURN + pushes) ──────────────────────────────
const pushData = (d) => {
    const n = d.length;
    const head = n < 0x4c ? [n] : n <= 0xff ? [0x4c, n] : n <= 0xffff ? [0x4d, n & 0xff, n >> 8] : [0x4e, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24];
    return [...head, ...d];
};
const s = (t) => enc.encode(t);
const opReturn = (parts) => hex([0x00, 0x6a, ...parts.flatMap(pushData)]);
const PIPE = s('|');
export const archiveScript = (kid, ciphertext) => opReturn([
    s(B_PREFIX), Uint8Array.from(ciphertext), s('application/octet-stream'), s('binary'), PIPE,
    s(MAP_PREFIX), s('SET'), s('app'), s(ARCHIVE_APP), s('type'), s('archive'), s('v'), s(ARCHIVE_VERSION), s('enc'), s('brc2'), s('kid'), s(kid),
]);
export const sealScript = (batchKid, count, publicKey, signature) => opReturn([
    s(MAP_PREFIX), s('SET'), s('app'), s(ARCHIVE_APP), s('type'), s('archive-seal'), s('v'), s(ARCHIVE_VERSION), s('n'), s(String(count)), s('kid'), s(batchKid),
    PIPE, s(SEAL_SIG), s(publicKey), s(hex(signature)),
]);
/** Split a script hex into its pushes (after OP_FALSE OP_RETURN). Null if it isn't one. */
export function readPushes(scriptHex) {
    const b = unhex(scriptHex);
    if (b[0] !== 0x00 || b[1] !== 0x6a)
        return null;
    const out = [];
    for (let i = 2; i < b.length;) {
        const op = b[i++];
        let n;
        if (op < 0x4c)
            n = op;
        else if (op === 0x4c)
            n = b[i++];
        else if (op === 0x4d) {
            n = b[i] | (b[i + 1] << 8);
            i += 2;
        }
        else if (op === 0x4e) {
            n = (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) + b[i + 3] * 2 ** 24;
            i += 4;
        }
        else
            return null;
        if (i + n > b.length)
            return null;
        out.push(b.slice(i, i + n));
        i += n;
    }
    return out;
}
/** An archive output's kid and ciphertext, or null if the script isn't one. */
export function parseArchiveScript(scriptHex) {
    const p = readPushes(scriptHex);
    if (!p || p.length !== 17)
        return null;
    const t = p.map((x) => dec.decode(x));
    if (t[0] !== B_PREFIX || t[4] !== '|' || t[5] !== MAP_PREFIX || t[7] !== 'app' || t[8] !== ARCHIVE_APP || t[10] !== 'archive' || t[15] !== 'kid')
        return null;
    if (!/^[0-9a-f]{32}$/.test(t[16]))
        return null;
    return { kid: t[16], ciphertext: p[1] };
}
const sha256 = async (d) => new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', d));
/** What the seal signs: sha256 of the batch's ciphertexts in output order. */
export async function sealDigest(cts) {
    const total = cts.reduce((a, c) => a + c.length, 0), all = new Uint8Array(total);
    let o = 0;
    for (const c of cts) {
        all.set(Uint8Array.from(c), o);
        o += c.length;
    }
    return sha256(all);
}
// ── sizes and cost ────────────────────────────────────────────────────────────
const pushLen = (n) => n + (n < 0x4c ? 1 : n <= 0xff ? 2 : n <= 0xffff ? 3 : 5);
/** Bytes of one post's output (script + 8-byte value + varint length), exact for a given payload. */
export function outputBytes(plaintextBytes) {
    const ct = plaintextBytes + BRC2_OVERHEAD;
    const parts = [B_PREFIX.length, ct, 24, 6, 1, MAP_PREFIX.length, 3, 3, ARCHIVE_APP.length, 4, 7, 1, 1, 3, 4, 3, 32];
    const script = 2 + parts.reduce((a, n) => a + pushLen(n), 0);
    return 8 + (script < 0xfd ? 1 : 3) + script;
}
/** Exact output sizes (padding is deterministic), estimated per-tx overhead. */
export function planPrivate(posts, ctx, perTx = POSTS_PER_TX, satPerKb) {
    let bytes = 0;
    for (const p of posts)
        bytes += outputBytes(padPlaintext(payloadFor(p, ctx)).length);
    const batches = Math.ceil(posts.length / perTx);
    bytes += batches * TX_OVERHEAD_BYTES;
    return { batches, outputs: posts.length, bytes, sats: costSats(bytes, satPerKb), perTx };
}
/**
 * Encrypt up to `perTx` posts with the wallet and build the transaction's outputs (posts first, seal last).
 * The seal is skipped (sealed: false) when the wallet has no createSignature/getPublicKey.
 */
export async function encryptBatch(wallet, posts, ctx, opts = {}) {
    const outputs = [], items = [], cts = [];
    for (const p of posts) {
        const kid = newKeyId(opts.rand);
        const { ciphertext } = await wallet.encrypt({ plaintext: Array.from(padPlaintext(payloadFor(p, ctx))), protocolID: ARCHIVE_PROTOCOL, keyID: kid, counterparty: 'self' });
        cts.push(ciphertext);
        items.push({ xId: p.id, kid, vout: outputs.length });
        outputs.push({ lockingScript: archiveScript(kid, ciphertext), satoshis: 0, outputDescription: 'Private archive record' });
    }
    const batchKid = newKeyId(opts.rand);
    let sealed = false;
    if (wallet.createSignature && wallet.getPublicKey && posts.length) {
        const keyID = `seal ${batchKid}`;
        const digest = await sealDigest(cts);
        const [{ publicKey }, { signature }] = [
            await wallet.getPublicKey({ protocolID: ARCHIVE_PROTOCOL, keyID, counterparty: 'self' }),
            await wallet.createSignature({ data: Array.from(digest), protocolID: ARCHIVE_PROTOCOL, keyID, counterparty: 'self' }),
        ];
        outputs.push({ lockingScript: sealScript(batchKid, posts.length, publicKey, signature), satoshis: 0, outputDescription: 'Private archive seal' });
        sealed = true;
    }
    return { outputs, items, batchKid, sealed };
}
/** Decrypt one archive output locally with the wallet. */
export async function openArchiveScript(wallet, scriptHex) {
    const r = parseArchiveScript(scriptHex);
    if (!r)
        return null;
    const { plaintext } = await wallet.decrypt({ ciphertext: Array.from(r.ciphertext), protocolID: ARCHIVE_PROTOCOL, keyID: r.kid, counterparty: 'self' });
    return { kid: r.kid, payload: readPayload(plaintext) };
}
// ── make one post public (opt-in, per post) ───────────────────────────────────
/**
 * The bChatX post a person publishes when they choose to make ONE archived post public:
 * B <text> text/plain utf-8 | MAP SET app bChat type post [context url url <their post>] source x source_id … source_at … source_url …
 *   reveal <txid:vout of the private record>
 * Only this post is disclosed; the rest of the archive stays encrypted (its keys are separate).
 * Thread context (`context tx`) is only added when the parent was itself made public (its public txid given).
 */
export function publicPostMap(p, o = {}) {
    const kv = [['app', 'bChat'], ['type', 'post']];
    if (p.reply_to && o.parentPublicTxid)
        kv.push(['context', 'tx'], ['tx', o.parentPublicTxid]);
    else if (p.reply_url)
        kv.push(['context', 'url'], ['url', p.reply_url]);
    kv.push(['source', 'x'], ['source_id', p.x_id], ['source_at', p.created_at], ['source_url', p.url]);
    if (o.record)
        kv.push(['reveal', o.record]);
    return kv;
}
export const publicPostScript = (p, o = {}) => opReturn([s(B_PREFIX), s(p.text), s('text/plain'), s('utf-8'), PIPE, s(MAP_PREFIX), s('SET'), ...publicPostMap(p, o).flatMap(([k, v]) => [s(k), s(v)])]);
/**
 * A `step` for runImport: encrypt the batch, then (live) one createAction per batch with the archive label, so a
 * spending grant for [2,'bmintx archive'] covers it without a sheet; or (dry run) nothing is sent and the built
 * outputs go to `onDry` (kept on the device so the read-back view can open them). Returns one id per post:
 * live "txid:vout", dry "dry:<kid>:<vout>".
 */
export function privateImportStep(o) {
    return async (records) => {
        const posts = records.map((r) => { const p = o.posts.get(r.xId); if (!p)
            throw new Error('unknown post'); return p; });
        const b = await encryptBatch(o.wallet, posts, o.ctx, { rand: o.rand });
        if (o.dryRun) {
            await o.onDry?.(b);
            return b.items.map((i) => `dry:${i.kid}:${i.vout}`);
        }
        if (!o.createAction)
            throw new Error('createAction needed for a live import');
        const r = await o.createAction({
            description: `Private archive: ${posts.length} posts`,
            outputs: b.outputs,
            labels: [ARCHIVE_LABEL],
            options: { randomizeOutputs: false, acceptDelayedBroadcast: true, spendingAuthorization: { protocolID: ARCHIVE_PROTOCOL } },
        });
        if (!r?.txid)
            throw new Error('wallet returned no txid');
        return b.items.map((i) => `${r.txid}:${i.vout}`);
    };
}
