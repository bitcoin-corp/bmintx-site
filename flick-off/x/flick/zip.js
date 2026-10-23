/**
 * Read a zip without loading it: only the central directory and the entries you ask for are read, via
 * Blob.slice. A 23 GB X archive on a phone costs a couple of MB of memory (the directory) plus the entries
 * opened. Works on any Blob/File: iOS Safari, Android Chrome, the bWallet in-app browser, and Node
 * (`fs.openAsBlob`). Inflate uses the platform's DecompressionStream('deflate-raw'), so no dependency.
 *
 * The archive is untrusted: sizes are checked against the file, encrypted entries and unknown methods are
 * refused, output is capped and CRC-checked, and nothing is ever executed or written to disk.
 */
/** Biggest single entry we will inflate (tweets.js is ~65 MB for a 15-year account). */
export const MAX_ENTRY_BYTES = 512 * 1024 * 1024;
/** Biggest central directory we will read (15k entries is ~1.3 MB). */
export const MAX_DIRECTORY_BYTES = 64 * 1024 * 1024;
export class ZipError extends Error {
    constructor(message) { super(message); this.name = 'ZipError'; }
}
const u16 = (v, o) => v.getUint16(o, true);
const u32 = (v, o) => v.getUint32(o, true);
const u64 = (v, o) => {
    const n = v.getUint32(o + 4, true) * 2 ** 32 + v.getUint32(o, true);
    if (!Number.isSafeInteger(n))
        throw new ZipError('Zip size field out of range.');
    return n;
};
const slice = async (blob, start, end) => new Uint8Array(await blob.slice(start, end).arrayBuffer());
let table = null;
export function crc32(bytes) {
    if (!table) {
        table = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let k = 0; k < 8; k++)
                c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            table[i] = c >>> 0;
        }
    }
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++)
        c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
async function inflateRaw(data, expected) {
    const out = new Uint8Array(expected);
    let n = 0;
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        if (n + value.length > expected) {
            await reader.cancel();
            throw new ZipError('Entry inflates past its stated size.');
        }
        out.set(value, n);
        n += value.length;
    }
    if (n !== expected)
        throw new ZipError('Entry is shorter than its stated size.');
    return out;
}
export async function openZip(blob) {
    const size = blob.size;
    if (size < 22)
        throw new ZipError('Not a zip file.');
    // End of central directory: in the last 22 bytes + up to 64 KB of comment.
    const tailStart = Math.max(0, size - 22 - 0xffff);
    const tail = await slice(blob, tailStart, size);
    const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    let e = -1;
    for (let i = tail.length - 22; i >= 0; i--)
        if (u32(tv, i) === 0x06054b50) {
            e = i;
            break;
        }
    if (e < 0)
        throw new ZipError('Not a zip file (no end of central directory).');
    let count = u16(tv, e + 10), cdSize = u32(tv, e + 12), cdOffset = u32(tv, e + 16);
    let bytesRead = tail.length;
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
        // ZIP64: the locator sits just before the EOCD and points at the ZIP64 EOCD record.
        if (e < 20 || u32(tv, e - 20) !== 0x07064b50)
            throw new ZipError('ZIP64 locator missing.');
        const recOff = u64(tv, e - 20 + 8);
        if (recOff + 56 > size)
            throw new ZipError('ZIP64 record out of range.');
        const rec = await slice(blob, recOff, recOff + 56);
        bytesRead += 56;
        const rv = new DataView(rec.buffer, rec.byteOffset, rec.byteLength);
        if (u32(rv, 0) !== 0x06064b50)
            throw new ZipError('ZIP64 record missing.');
        count = u64(rv, 32);
        cdSize = u64(rv, 40);
        cdOffset = u64(rv, 48);
    }
    if (cdOffset + cdSize > size)
        throw new ZipError('Central directory out of range.');
    if (cdSize > MAX_DIRECTORY_BYTES)
        throw new ZipError('Central directory too big.');
    const cd = await slice(blob, cdOffset, cdOffset + cdSize);
    bytesRead += cd.length;
    const cv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
    const utf8 = new TextDecoder('utf-8');
    const entries = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
        if (p + 46 > cd.length || u32(cv, p) !== 0x02014b50)
            throw new ZipError('Central directory is damaged.');
        const flags = u16(cv, p + 8), method = u16(cv, p + 10), crc = u32(cv, p + 16);
        let compressedSize = u32(cv, p + 20), usize = u32(cv, p + 24);
        const nameLen = u16(cv, p + 28), extraLen = u16(cv, p + 30), commentLen = u16(cv, p + 32);
        let offset = u32(cv, p + 42);
        if (p + 46 + nameLen + extraLen + commentLen > cd.length)
            throw new ZipError('Central directory is damaged.');
        const name = utf8.decode(cd.subarray(p + 46, p + 46 + nameLen));
        // ZIP64 extra field (0x0001): the 64-bit values, in order, for whichever fields are 0xFFFFFFFF.
        let x = p + 46 + nameLen;
        const xEnd = x + extraLen;
        while (x + 4 <= xEnd) {
            const id = u16(cv, x), len = u16(cv, x + 2);
            if (id === 0x0001) {
                let q = x + 4;
                if (usize === 0xffffffff && q + 8 <= x + 4 + len) {
                    usize = u64(cv, q);
                    q += 8;
                }
                if (compressedSize === 0xffffffff && q + 8 <= x + 4 + len) {
                    compressedSize = u64(cv, q);
                    q += 8;
                }
                if (offset === 0xffffffff && q + 8 <= x + 4 + len) {
                    offset = u64(cv, q);
                    q += 8;
                }
            }
            x += 4 + len;
        }
        entries.push({ name, size: usize, compressedSize, method, crc32: crc, offset, encrypted: !!(flags & 1), dir: name.endsWith('/') });
        p += 46 + nameLen + extraLen + commentLen;
    }
    async function read(entry) {
        if (entry.encrypted)
            throw new ZipError(`${entry.name} is encrypted.`);
        if (entry.size > MAX_ENTRY_BYTES)
            throw new ZipError(`${entry.name} is too big to open here.`);
        if (entry.method !== 0 && entry.method !== 8)
            throw new ZipError(`${entry.name} uses an unsupported compression method.`);
        if (entry.offset + 30 > size)
            throw new ZipError('Entry out of range.');
        const head = await slice(blob, entry.offset, entry.offset + 30);
        const hv = new DataView(head.buffer, head.byteOffset, head.byteLength);
        if (u32(hv, 0) !== 0x04034b50)
            throw new ZipError('Local header missing.');
        const start = entry.offset + 30 + u16(hv, 26) + u16(hv, 28);
        if (start + entry.compressedSize > size)
            throw new ZipError('Entry out of range.');
        const raw = await slice(blob, start, start + entry.compressedSize);
        let out;
        if (entry.method === 0) {
            if (raw.length !== entry.size)
                throw new ZipError('Stored entry size mismatch.');
            out = raw;
        }
        else
            out = await inflateRaw(raw, entry.size);
        if (crc32(out) !== entry.crc32)
            throw new ZipError(`${entry.name} failed its checksum.`);
        return out;
    }
    const text = async (entry) => new TextDecoder('utf-8').decode(await read(entry));
    return { entries, bytesRead, read, text };
}
