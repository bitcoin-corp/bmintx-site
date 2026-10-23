/**
 * Import progress that survives a closed tab (iOS evicts background tabs; a 19k-post import takes a while).
 * Records are written strictly in order (oldest first), so progress is a cursor plus, per batch, the txids
 * written: enough to resume and to resolve a thread reply's parent txid. Kept in IndexedDB in the browser
 * (`idbKv`), in memory elsewhere (`memoryKv`). Keyed by X account id and mode, so a DRY RUN never mixes with
 * a real import, and a different archive (other post list) starts over instead of resuming wrongly.
 *
 * No keys and no network here: `step` is what signs/sends (or, in a dry run, does nothing).
 */
export function memoryKv() {
    const m = new Map();
    return {
        get: async (k) => m.get(k),
        set: async (k, v) => { m.set(k, structuredClone(v)); },
        del: async (k) => { m.delete(k); },
    };
}
/** IndexedDB-backed KV (browser). Falls back to memory when IndexedDB isn't there (private mode, Node). */
export function idbKv(dbName = 'bwalletx-flick', storeName = 'progress', factory = globalThis.indexedDB) {
    if (!factory)
        return memoryKv();
    let dbp = null;
    const db = () => (dbp ??= new Promise((ok, no) => {
        const r = factory.open(dbName, 1);
        r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(storeName))
            r.result.createObjectStore(storeName); };
        r.onsuccess = () => ok(r.result);
        r.onerror = () => no(r.error);
    }));
    const tx = async (mode, fn) => {
        const d = await db();
        return new Promise((ok, no) => {
            const t = d.transaction(storeName, mode), req = fn(t.objectStore(storeName));
            t.oncomplete = () => ok(req.result);
            t.onerror = t.onabort = () => no(t.error ?? req.error);
        });
    };
    return {
        get: (k) => tx('readonly', (s) => s.get(k)),
        set: async (k, v) => { await tx('readwrite', (s) => s.put(v, k)); },
        del: async (k) => { await tx('readwrite', (s) => s.delete(k)); },
    };
}
export const progressKey = (accountId, dryRun) => `x:${accountId}:${dryRun ? 'dry' : 'live'}`;
const fingerprintOf = (rs) => `${rs.length}:${rs[0]?.xId ?? ''}:${rs[rs.length - 1]?.xId ?? ''}`;
/** Saved progress for this post list, or null (none, or it was for a different archive). */
export async function loadProgress(kv, key, records) {
    const p = await kv.get(key);
    return p && p.v === 1 && p.fingerprint === fingerprintOf(records) ? p : null;
}
export async function clearProgress(kv, key) {
    const p = await kv.get(key);
    if (p)
        for (let b = 0; b * p.batchSize < p.cursor; b++)
            await kv.del(`${key}:tx:${b}`);
    await kv.del(key);
}
/**
 * Run (or resume) an import: skips what's done, writes the rest batch by batch, saving after each one.
 * Stops cleanly between batches when `signal` aborts; call again to carry on.
 */
export async function runImport(o) {
    const size = o.batchSize ?? 25;
    let p = await loadProgress(o.kv, o.key, o.records);
    if (p && p.batchSize !== size) {
        await clearProgress(o.kv, o.key);
        p = null;
    }
    if (!p)
        p = { v: 1, dryRun: o.dryRun, fingerprint: fingerprintOf(o.records), total: o.records.length, cursor: 0, batchSize: size, updatedAt: new Date().toISOString() };
    const index = new Map(o.records.map((r, i) => [r.xId, i]));
    const txids = new Map();
    const parentTxid = (xId) => {
        const i = index.get(xId);
        return i === undefined ? undefined : txids.get(Math.floor(i / size))?.[i % size];
    };
    for (let b = 0; b * size < p.cursor; b++)
        txids.set(b, (await o.kv.get(`${o.key}:tx:${b}`)) ?? []);
    o.onProgress?.(p.cursor, p.total);
    while (p.cursor < p.total) {
        if (o.signal?.aborted)
            break;
        const b = p.cursor / size, batch = o.records.slice(p.cursor, p.cursor + size);
        const ids = await o.step(batch, parentTxid);
        if (ids.length !== batch.length)
            throw new Error('step must return one txid per record');
        txids.set(b, ids);
        await o.kv.set(`${o.key}:tx:${b}`, ids);
        p = { ...p, cursor: p.cursor + batch.length, updatedAt: new Date().toISOString() };
        await o.kv.set(o.key, p);
        o.onProgress?.(p.cursor, p.total);
    }
    return p;
}
