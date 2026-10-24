/**
 * The archive pot: a separate pot of money for one archive, so its ~770 transactions never touch (or link to) the
 * wallet's own change addresses.
 *
 * - Key: derived by the person's wallet, protocol [2,'bmintx archive'], keyID `pot <accountId>`, counterparty self.
 *   Seed-derived, so the pot is always recoverable from the 12 words (locks-non-custodial rule). The keyID never goes
 *   on chain.
 * - Funding: one wallet transaction pays cost + 10% to the pot's P2PKH address (this ONE transaction links pot and
 *   wallet), or the person sends BSV to the pot address from anywhere else (an exchange), which links nothing.
 * - Every archive transaction spends only the pot (one input) and pays its change back to the pot. Built and signed
 *   here: the sighash goes to wallet.createSignature (hashToDirectlySign, level-2 protocol pinned to bmintx.com),
 *   so no wallet coins, no wallet change. Transactions chain: each spends the previous one's pot change.
 * - At the end the leftover goes back to the wallet (a BRC-29 self payment) or stays in the pot.
 *
 * Pure (hashes, serialisation, BIP143/FORKID sighash). No network: broadcasting is injected.
 */
import { ARCHIVE_PROTOCOL } from './private.js';
// ── hashes ────────────────────────────────────────────────────────────────────
const toBuf = (b) => b;
export const sha256 = async (d) => new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', toBuf(d)));
export const sha256d = async (d) => sha256(await sha256(d));
/** RIPEMD-160 (needed for P2PKH addresses; WebCrypto has none). */
export function ripemd160(msg) {
    const rl = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8, 3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12, 1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2, 4, 0, 5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13];
    const rr = [5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12, 6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2, 15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13, 8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14, 12, 15, 10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11];
    const sl = [11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8, 7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12, 11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5, 11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12, 9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6];
    const sr = [8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6, 9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11, 9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5, 15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8, 8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11];
    const kl = [0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e], kr = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0x00000000];
    const f = (j, x, y, z) => j < 16 ? x ^ y ^ z : j < 32 ? (x & y) | (~x & z) : j < 48 ? (x | ~y) ^ z : j < 64 ? (x & z) | (y & ~z) : x ^ (y | ~z);
    const rol = (x, n) => (x << n) | (x >>> (32 - n));
    const len = msg.length, padLen = ((len + 8) >> 6) * 64 + 64;
    const m = new Uint8Array(padLen);
    m.set(msg);
    m[len] = 0x80;
    const dv = new DataView(m.buffer);
    dv.setUint32(padLen - 8, (len * 8) >>> 0, true);
    dv.setUint32(padLen - 4, Math.floor((len * 8) / 2 ** 32), true);
    let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
    for (let o = 0; o < padLen; o += 64) {
        const X = Array.from({ length: 16 }, (_, i) => dv.getUint32(o + i * 4, true));
        let al = h0, bl = h1, cl = h2, dl = h3, el = h4, ar = h0, br = h1, cr = h2, dr = h3, er = h4;
        for (let j = 0; j < 80; j++) {
            const r = j >> 4;
            let t = (rol((al + f(j, bl, cl, dl) + X[rl[j]] + kl[r]) | 0, sl[j]) + el) | 0;
            al = el;
            el = dl;
            dl = rol(cl, 10);
            cl = bl;
            bl = t;
            t = (rol((ar + f(79 - j, br, cr, dr) + X[rr[j]] + kr[r]) | 0, sr[j]) + er) | 0;
            ar = er;
            er = dr;
            dr = rol(cr, 10);
            cr = br;
            br = t;
        }
        const t = (h1 + cl + dr) | 0;
        h1 = (h2 + dl + er) | 0;
        h2 = (h3 + el + ar) | 0;
        h3 = (h4 + al + br) | 0;
        h4 = (h0 + bl + cr) | 0;
        h0 = t;
    }
    const out = new Uint8Array(20), ov = new DataView(out.buffer);
    [h0, h1, h2, h3, h4].forEach((h, i) => ov.setUint32(i * 4, h >>> 0, true));
    return out;
}
export const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const unhex = (h) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** Mainnet P2PKH address for a compressed public key (hex). */
export async function p2pkhAddress(pubHex) {
    const h = ripemd160(await sha256(unhex(pubHex)));
    const body = new Uint8Array([0x00, ...h]);
    const full = new Uint8Array([...body, ...(await sha256d(body)).slice(0, 4)]);
    let n = BigInt('0x' + hex(full)), s = '';
    while (n > 0n) {
        s = B58[Number(n % 58n)] + s;
        n /= 58n;
    }
    for (const b of full) {
        if (b)
            break;
        s = '1' + s;
    }
    return s;
}
export async function p2pkhScript(pubHex) {
    return '76a914' + hex(ripemd160(await sha256(unhex(pubHex)))) + '88ac';
}
const varint = (n) => n < 0xfd ? [n] : n <= 0xffff ? [0xfd, n & 0xff, n >> 8] : [0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24];
const u32 = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const u64 = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return [...b]; };
const rev = (h) => [...unhex(h)].reverse();
const withLen = (h) => { const b = unhex(h); return [...varint(b.length), ...b]; };
export function serializeTx(t) {
    return Uint8Array.from([
        ...u32(t.version), ...varint(t.inputs.length),
        ...t.inputs.flatMap((i) => [...rev(i.txid), ...u32(i.vout), ...withLen(i.script), ...u32(i.sequence)]),
        ...varint(t.outputs.length), ...t.outputs.flatMap((o) => [...u64(o.satoshis), ...withLen(o.script)]), ...u32(t.locktime),
    ]);
}
export const txid = async (t) => hex([...(await sha256d(serializeTx(t)))].reverse());
export const SIGHASH_ALL_FORKID = 0x41;
/** BIP143 (BSV FORKID) preimage for input `i` spending `prevScript` worth `prevSats`. */
export async function sighashPreimage(t, i, prevScript, prevSats) {
    const prevouts = Uint8Array.from(t.inputs.flatMap((x) => [...rev(x.txid), ...u32(x.vout)]));
    const seqs = Uint8Array.from(t.inputs.flatMap((x) => u32(x.sequence)));
    const outs = Uint8Array.from(t.outputs.flatMap((o) => [...u64(o.satoshis), ...withLen(o.script)]));
    const inp = t.inputs[i];
    return Uint8Array.from([
        ...u32(t.version), ...(await sha256d(prevouts)), ...(await sha256d(seqs)), ...rev(inp.txid), ...u32(inp.vout),
        ...withLen(prevScript), ...u64(prevSats), ...u32(inp.sequence), ...(await sha256d(outs)), ...u32(t.locktime), ...u32(SIGHASH_ALL_FORKID),
    ]);
}
const push = (b) => (b.length < 0x4c ? [b.length, ...b] : [0x4c, b.length, ...b]);
/** Unlocking-script estimate for P2PKH: sig (≤72 + 1) + pubkey (33) + pushes. */
export const P2PKH_UNLOCK_BYTES = 107;
export const DEFAULT_FEE_SAT_PER_KB = 100;
export const DUST = 1;
export const potKeyId = (accountId) => `pot ${accountId}`;
/** The pot's key, script and address, from the wallet (no prompt beyond the archive protocol grant). */
export async function potKey(wallet, accountId) {
    const keyID = potKeyId(accountId);
    const { publicKey } = await wallet.getPublicKey({ protocolID: ARCHIVE_PROTOCOL, keyID, counterparty: 'self' });
    return { keyID, publicKey, lockingScript: await p2pkhScript(publicKey), address: await p2pkhAddress(publicKey) };
}
/** Exact size once signed (DER sig length varies by a byte; 73 is the max). */
export const txSize = (t) => serializeTx({ ...t, inputs: t.inputs.map((i) => ({ ...i, script: i.script || '00'.repeat(P2PKH_UNLOCK_BYTES) })) }).length;
export const feeFor = (bytes, satPerKb = DEFAULT_FEE_SAT_PER_KB) => Math.ceil((bytes * satPerKb) / 1000);
/** Spend the pot into `outputs`, change back to the pot (always the last output). Unsigned. */
export function buildPotTx(pot, key, outputs, satPerKb = DEFAULT_FEE_SAT_PER_KB) {
    const tx = { version: 1, locktime: 0, inputs: [{ txid: pot.txid, vout: pot.vout, script: '', sequence: 0xffffffff }], outputs: [...outputs, { satoshis: 0, script: key.lockingScript }] };
    const fee = feeFor(txSize(tx), satPerKb);
    const change = pot.satoshis - outputs.reduce((a, o) => a + o.satoshis, 0) - fee;
    if (change < DUST)
        throw new PotEmptyError(pot.satoshis, fee);
    tx.outputs[tx.outputs.length - 1].satoshis = change;
    return { tx, fee, change };
}
/** Spend the whole pot to one script (the leftover going back to the wallet). */
export function buildSweepTx(pot, toScript, satPerKb = DEFAULT_FEE_SAT_PER_KB) {
    const tx = { version: 1, locktime: 0, inputs: [{ txid: pot.txid, vout: pot.vout, script: '', sequence: 0xffffffff }], outputs: [{ satoshis: 0, script: toScript }] };
    const fee = feeFor(txSize(tx), satPerKb), amount = pot.satoshis - fee;
    if (amount < DUST)
        throw new PotEmptyError(pot.satoshis, fee);
    tx.outputs[0].satoshis = amount;
    return { tx, fee, amount };
}
export class PotEmptyError extends Error {
    have;
    fee;
    constructor(have, fee) {
        super(`pot too small: ${have} sats, needs more than ${fee}`);
        this.have = have;
        this.fee = fee;
        this.name = 'PotEmptyError';
    }
}
/** Sign input 0 with the pot key through the wallet (hash signed directly; no wallet coins involved). */
export async function signPotTx(wallet, tx, key, pot) {
    const digest = await sha256d(await sighashPreimage(tx, 0, key.lockingScript, pot.satoshis));
    const { signature } = await wallet.createSignature({ hashToDirectlySign: Array.from(digest), protocolID: ARCHIVE_PROTOCOL, keyID: key.keyID, counterparty: 'self' });
    const script = hex([...push(Uint8Array.from([...signature, SIGHASH_ALL_FORKID])), ...push(unhex(key.publicKey))]);
    return { ...tx, inputs: [{ ...tx.inputs[0], script }] };
}
// ── planning ──────────────────────────────────────────────────────────────────
/** How much to put in the pot: every batch's exact fee (chained), plus 10% headroom. */
export function potFunding(batchSizes, satPerKb = DEFAULT_FEE_SAT_PER_KB) {
    // A stand-in key/outpoint of the right sizes: fee only depends on byte counts.
    const key = { keyID: '', publicKey: '02' + '00'.repeat(32), lockingScript: '76a914' + '00'.repeat(20) + '88ac', address: '' };
    let fees = 0;
    for (const outs of batchSizes) {
        const tx = { version: 1, locktime: 0, inputs: [{ txid: '00'.repeat(32), vout: 0, script: '', sequence: 0 }],
            outputs: [...outs.map((n) => ({ satoshis: 0, script: '00'.repeat(n) })), { satoshis: 1, script: key.lockingScript }] };
        fees += feeFor(txSize(tx), satPerKb);
    }
    const sweep = feeFor(txSize({ version: 1, locktime: 0, inputs: [{ txid: '00'.repeat(32), vout: 0, script: '', sequence: 0 }], outputs: [{ satoshis: 1, script: key.lockingScript }] }), satPerKb);
    return { fees: fees + sweep, fund: Math.ceil((fees + sweep) * 1.1) + DUST, txs: batchSizes.length };
}
/**
 * runImport step: encrypt the batch (records), build a pot tx (records + change to pot), sign through the wallet,
 * then `broadcast` it (live) or not (dry run), and move the pot to the new change output. Pot state is saved by
 * `savePot` after every batch, before the step returns.
 */
export function potImportStep(o) {
    return async (records) => {
        const b = await o.encrypt(records);
        const pot = await o.loadPot();
        const { tx, fee, change } = buildPotTx(pot, o.key, b.outputs.map((x) => ({ satoshis: 0, script: x.lockingScript })), o.satPerKb);
        const signed = await signPotTx(o.wallet, tx, o.key, pot);
        const raw = serializeTx(signed), id = await txid(signed);
        if (!o.dryRun) {
            if (!o.broadcast)
                throw new Error('broadcast needed for a live import');
            await o.broadcast(hex(raw), id);
        }
        await o.savePot({ v: 1, txid: id, vout: signed.outputs.length - 1, satoshis: change, spentSats: pot.spentSats + fee, txs: pot.txs + 1 });
        await o.onTx?.({ txid: id, raw, fee, change });
        return b.items.map((i) => `${o.dryRun ? 'dry:' : ''}${id}:${i.vout}`);
    };
}
/** Output scripts (hex) of a raw transaction, for read-back from the chain. */
export function txOutputScripts(rawHex) {
    const b = unhex(rawHex);
    let i = 4;
    const vi = () => { const f = b[i++]; if (f < 0xfd)
        return f; if (f === 0xfd) {
        const n = b[i] | (b[i + 1] << 8);
        i += 2;
        return n;
    } const n = (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) + b[i + 3] * 2 ** 24; i += f === 0xfe ? 4 : 8; return n; };
    const nin = vi();
    for (let k = 0; k < nin; k++) {
        i += 36;
        const n = vi();
        i += n + 4;
    }
    const nout = vi(), out = [];
    for (let k = 0; k < nout; k++) {
        i += 8;
        const n = vi();
        out.push(hex(b.slice(i, i + n)));
        i += n;
    }
    return out;
}
