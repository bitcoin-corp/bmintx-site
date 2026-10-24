/**
 * @bwalletx/flick: FLICK OFF archive readers, shared by the websites (bmintx.com/flick-off/*) and the bWalletX
 * in-wallet Mint. Give it the files of a platform's data export (from a picked folder, a dropped zip, or a
 * phone upload) and it says what's inside, what it costs at cost price, and what can be imported.
 *
 * PURE: no DOM, no network, no keys. Files are read lazily: only small text files (metadata) are opened;
 * video/photo bytes are never read here, only their sizes. Signing and minting happen in the wallet.
 */
/** House rate used across bMintX / bChatX scripts. */
export const SAT_PER_KB = 100;
/** Cost price in satoshis to write `bytes` on chain at `satPerKb`. */
export const costSats = (bytes, satPerKb = SAT_PER_KB) => Math.ceil((bytes / 1000) * satPerKb);
// ── helpers ───────────────────────────────────────────────────────────────────
/** X archive data files: `window.YTD.tweets.part0 = [ ... ]` → the array. */
export function ytd(js) {
    if (!js)
        return [];
    const i = js.indexOf('[');
    if (i < 0)
        return [];
    try {
        return JSON.parse(js.slice(i));
    }
    catch {
        return [];
    }
}
/**
 * Streaming `ytd`: yields each element of the `window.YTD.x.part0 = [ ... ]` array as text arrives, so a
 * 65 MB tweets.js never sits in memory as one string (or one giant parsed array). `map` runs on each parsed
 * element, so callers keep only the fields they need. Elements that aren't valid JSON are skipped.
 */
export async function* ytdStream(chunks, map = (v) => v) {
    let started = false, depth = 0, inStr = false, esc = false;
    let parts = [], from = -1;
    for await (const c of chunks) {
        let i = 0;
        if (!started) {
            const k = c.indexOf('[');
            if (k < 0)
                continue;
            started = true;
            i = k + 1;
        }
        from = depth > 0 ? 0 : -1;
        for (; i < c.length; i++) {
            const ch = c.charCodeAt(i);
            if (inStr) {
                if (esc)
                    esc = false;
                else if (ch === 92)
                    esc = true;
                else if (ch === 34)
                    inStr = false;
                continue;
            }
            if (ch === 34) {
                inStr = true;
                continue;
            } // (top-level elements are objects; strings only matter for brackets inside them)
            if (ch === 123 || ch === 91) {
                if (depth === 0)
                    from = i;
                depth++;
                continue;
            }
            if (ch === 125 || ch === 93) {
                if (depth === 0)
                    return; // the closing ']' of the top-level array
                if (--depth === 0) {
                    parts.push(c.slice(from, i + 1));
                    const txt = parts.join('');
                    parts = [];
                    from = -1;
                    let v;
                    try {
                        v = JSON.parse(txt);
                    }
                    catch {
                        continue;
                    }
                    yield map(v);
                }
            }
        }
        if (depth > 0 && from >= 0)
            parts.push(c.slice(from));
    }
}
/** RFC 4180 CSV (quoted fields may hold commas, quotes and newlines). */
export function csv(text) {
    const rows = [];
    let row = [], f = '', q = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) {
            if (c === '"') {
                if (text[i + 1] === '"') {
                    f += '"';
                    i++;
                }
                else
                    q = false;
            }
            else
                f += c;
        }
        else if (c === '"')
            q = true;
        else if (c === ',') {
            row.push(f);
            f = '';
        }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n')
                i++;
            row.push(f);
            rows.push(row);
            row = [];
            f = '';
        }
        else
            f += c;
    }
    if (f || row.length) {
        row.push(f);
        rows.push(row);
    }
    return rows.filter((r) => r.some((x) => x !== ''));
}
const find = (files, re) => files.find((f) => re.test(f.path));
const unescapeHtml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
/** Which platform's export this is, or null. */
export function detect(files) {
    if (find(files, /(^|\/)data\/tweets?\.js$/))
        return 'x';
    if (files.some((f) => /youtube/i.test(f.path) && (VIDEO.test(f.path) || /video metadata\//i.test(f.path))))
        return 'youtube';
    return null;
}
/** Post text with t.co links expanded and media t.co links removed. */
export function xText(t) {
    let s = t.full_text ?? t.text ?? '';
    for (const u of t.entities?.urls ?? [])
        if (u.url && u.expanded_url)
            s = s.split(u.url).join(u.expanded_url);
    for (const m of [...(t.entities?.media ?? []), ...(t.extended_entities?.media ?? [])])
        if (m.url)
            s = s.split(m.url).join('');
    return unescapeHtml(s).replace(/[ \t]+\n/g, '\n').trim();
}
export const TWEETS_JS = /(^|\/)data\/tweets?(-part\d+)?\.js$/;
export const NOTES_JS = /(^|\/)data\/note-tweets?(-part\d+)?\.js$/;
const str = (v) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined);
const tid = (t) => t.id_str ?? t.id ?? '';
/**
 * One tweets.js row (`{ tweet: {...} }` or the bare tweet) cut down to what planning needs. X writes ~40 fields
 * per post; keeping these few is what lets a phone hold 30k posts. Unknown shapes come out empty, never throw.
 */
export function slimTweet(row) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = (row ?? {}), t = (r.tweet ?? r);
    if (!t || typeof t !== 'object')
        return {};
    const urls = Array.isArray(t.entities?.urls) ? t.entities.urls.map((u) => ({ url: str(u?.url) ?? '', expanded_url: str(u?.expanded_url) })) : undefined;
    const media = [...(Array.isArray(t.entities?.media) ? t.entities.media : []), ...(Array.isArray(t.extended_entities?.media) ? t.extended_entities.media : [])]
        .map((m) => ({ url: str(m?.url) ?? '' }));
    const ei = t.edit_info, chain = ei?.initial?.editTweetIds ?? ei?.edit?.editControlInitial?.editTweetIds;
    return {
        id_str: str(t.id_str) ?? str(t.id), full_text: str(t.full_text) ?? str(t.text), created_at: str(t.created_at),
        retweeted: t.retweeted === true || t.retweeted === 'true',
        in_reply_to_status_id_str: str(t.in_reply_to_status_id_str) ?? null, in_reply_to_user_id_str: str(t.in_reply_to_user_id_str) ?? null,
        in_reply_to_screen_name: str(t.in_reply_to_screen_name) ?? null,
        entities: { urls, media },
        edit_ids: Array.isArray(chain) ? chain.map(String) : undefined,
    };
}
/**
 * Edited posts: X keeps every version as its own tweet, each carrying the chain of version ids, oldest first
 * (edit_info.initial.editTweetIds on the original, edit_info.edit.editControlInitial.editTweetIds on edits).
 * Only the final version present in the archive is kept; earlier versions are dropped (if the newest was
 * deleted, the newest one left stands).
 */
export function latestEdits(tweets) {
    const have = new Set(tweets.map(tid));
    const kept = tweets.filter((t) => {
        const chain = t.edit_ids;
        if (!chain || chain.length < 2)
            return true;
        const me = chain.indexOf(tid(t));
        return me < 0 || !chain.slice(me + 1).some((x) => have.has(x));
    });
    return { kept, dropped: tweets.length - kept.length };
}
/** X's created_at ("Wed Jul 26 07:10:46 +0000 2023") or an ISO date → whole seconds, or NaN. */
const epochSec = (s) => (s ? Math.floor(new Date(s).getTime() / 1000) : NaN);
/** Comparable prefix: no leading @mentions, no links, entities decoded, whitespace collapsed. */
const matchKey = (s) => unescapeHtml(s).replace(/^(@\w+\s+)+/, '').replace(/https?:\/\/\S+/g, '').replace(/…/g, '').replace(/\s+/g, ' ').trim().slice(0, 50);
/**
 * Long posts: tweets.js holds a truncated full_text; the whole text is in note-tweet.js, which carries no tweet
 * id. A note matches the tweet created in the same second (or up to 2 s later: X stamps the tweet just after
 * the note) whose text starts the same way; a reply's leading @mentions are not in the note, so they're
 * ignored when comparing. Returns tweet id → full text (t.co expanded). Same rule as bit-sign's
 * matchNoteTweets (src/lib/import/x-archive-rules.ts), so both report the same count.
 */
export function matchNotes(tweets, notes) {
    const out = new Map();
    if (!notes.length)
        return out;
    const bySec = new Map();
    for (const t of tweets) {
        const sec = epochSec(t.created_at);
        if (!Number.isNaN(sec)) {
            const l = bySec.get(sec);
            if (l)
                l.push(t);
            else
                bySec.set(sec, [t]);
        }
    }
    for (const n of notes) {
        let text = n.core?.text ?? '';
        const sec = epochSec(n.createdAt);
        if (!text || Number.isNaN(sec))
            continue;
        const key = matchKey(text);
        let hit = null;
        for (let d = 0; d <= 2 && !hit; d++) {
            const same = (bySec.get(sec + d) ?? []).filter((t) => !out.has(tid(t)) && matchKey(t.full_text ?? t.text ?? '') === key);
            if (same.length === 1)
                hit = same[0];
        }
        const id = hit && tid(hit);
        if (!id)
            continue;
        for (const u of n.core?.urls ?? [])
            if (u.shortUrl && u.expandedUrl)
                text = text.split(u.shortUrl).join(u.expandedUrl);
        out.set(id, text);
    }
    return out;
}
/** Full text of a long post: the tweet's leading @mentions (replies) + the note's text, media links removed. */
export function longText(t, note) {
    const mentions = /^(@\w+\s+)+/.exec(unescapeHtml(t.full_text ?? t.text ?? ''))?.[0] ?? '';
    let s = note.startsWith(mentions.trim()) ? note : mentions + note;
    for (const m of [...(t.entities?.media ?? []), ...(t.extended_entities?.media ?? [])])
        if (m.url)
            s = s.split(m.url).join('');
    return s.replace(/[ \t]+\n/g, '\n').trim();
}
/** Bytes per post on chain besides its text and inline media (inputs, change, MAP, AIP, origin fields). */
export const X_POST_OVERHEAD = 610;
export async function planX(files) {
    const read = async (...names) => {
        for (const n of names) {
            const f = find(files, new RegExp(`(^|/)data/${n}\\.js$`));
            if (f)
                return f.text();
        }
        return null;
    };
    // big accounts are split: data/tweets.js, data/tweets-part1.js, ... (same for note-tweet)
    const parts = (re) => Promise.all(files.filter((f) => re.test(f.path)).sort((a, b) => a.path.localeCompare(b.path)).map((f) => f.text()));
    // tweets.js is the big one (65 MB for a 15-year account): streamed and slimmed post by post when the file can stream
    const tweetFiles = files.filter((f) => TWEETS_JS.test(f.path)).sort((a, b) => a.path.localeCompare(b.path));
    const readTweets = async () => {
        const rows = [];
        for (const f of tweetFiles) {
            if (f.chunks) {
                for await (const t of ytdStream(f.chunks(), slimTweet))
                    rows.push(t);
            }
            else
                for (const r of ytd(await f.text()))
                    rows.push(slimTweet(r));
        }
        return rows;
    };
    const [allRows, noteParts, accountJs, followerJs, followingJs, dmJs] = await Promise.all([
        readTweets(), parts(NOTES_JS), read('account'), read('follower'), read('following'), read('direct-messages', 'direct-message'),
    ]);
    if (!tweetFiles.length)
        throw new Error('No data/tweets.js: this is not an X archive.');
    const { kept: rows, dropped: edits } = latestEdits(allRows);
    const notes = matchNotes(rows, noteParts.flatMap((js) => ytd(js)).map((r) => r.noteTweet ?? r));
    const acct = ytd(accountJs)[0]?.account ?? {};
    const username = acct.username ?? 'unknown', accountId = acct.accountId ?? '';
    const byPost = new Map();
    for (const f of files) {
        const m = /data\/tweets?_media\/(\d+)-([^/]+)$/.exec(f.path);
        if (m)
            byPost.set(m[1], [...(byPost.get(m[1]) ?? []), { name: m[1] + '-' + m[2], bytes: f.size }]);
    }
    const posts = [];
    const skipped = { retweets: 0, empty: 0, edits };
    for (const t of rows) {
        const id = t.id_str ?? t.id;
        if (!id)
            continue;
        if (t.retweeted || /^RT @\w+:/.test(t.full_text ?? t.text ?? '')) {
            skipped.retweets++;
            continue;
        }
        const short = xText(t), note = notes.get(id), full = note ? longText(t, note) : null;
        const text = full && full.length > short.length ? full : short, media = byPost.get(id) ?? [];
        const at = t.created_at ? new Date(t.created_at) : null;
        if ((!text && !media.length) || !at || isNaN(at.getTime())) {
            skipped.empty++;
            continue;
        }
        const self = !!t.in_reply_to_status_id_str && !!accountId && t.in_reply_to_user_id_str === accountId;
        const other = !!t.in_reply_to_status_id_str && !self && !!t.in_reply_to_screen_name;
        posts.push({
            id, text, at: at.toISOString(), url: `https://x.com/${username}/status/${id}`,
            parentId: self ? t.in_reply_to_status_id_str : null,
            replyUrl: other ? `https://x.com/${t.in_reply_to_screen_name}/status/${t.in_reply_to_status_id_str}` : null,
            media, long: text !== short,
        });
    }
    posts.sort((a, b) => a.at.localeCompare(b.at)); // oldest first: a thread's parent is signed before its replies
    const enc = new TextEncoder();
    const textBytes = posts.reduce((a, p) => a + X_POST_OVERHEAD + enc.encode(p.text).length, 0);
    const mediaBytes = posts.reduce((a, p) => a + p.media.reduce((x, m) => x + m.bytes, 0), 0);
    const text = costSats(textBytes), media = costSats(mediaBytes);
    return {
        platform: 'x', username, accountId, posts, skipped, longPosts: posts.filter((p) => p.long).length,
        mediaFiles: posts.reduce((a, p) => a + p.media.length, 0),
        followers: ytd(followerJs).length, following: ytd(followingJs).length,
        dms: ytd(dmJs).reduce((a, c) => a + (c.dmConversation?.messages?.length ?? 0), 0),
        cost: { text, media, total: text + media },
    };
}
// ── YouTube (Google Takeout) ──────────────────────────────────────────────────
export const VIDEO = /\.(mp4|mov|m4v|webm|mkv|avi|flv|3gp|wmv|mpg|mpeg)$/i;
/** Bytes per video besides the file: title, description, date, MAP fields, signature. */
export const YT_META_BYTES = 1000;
/** Takeout's video metadata CSV → records keyed by normalised title. Column names vary between Takeout versions. */
export function youtubeMetadata(text) {
    const rows = csv(text);
    const m = new Map();
    if (rows.length < 2)
        return m;
    const h = rows[0].map((x) => x.toLowerCase());
    const col = (...keys) => h.findIndex((x) => keys.some((k) => x.includes(k)));
    const ti = col('video title', 'title'), di = col('publish timestamp', 'create timestamp', 'timestamp', 'date'), de = col('description'), pr = col('privacy');
    for (const r of rows.slice(1)) {
        const title = r[ti];
        if (!title)
            continue;
        m.set(norm(title), { title, date: di >= 0 ? r[di] : '', desc: de >= 0 ? r[de] : '', privacy: pr >= 0 ? r[pr] : '' });
    }
    return m;
}
export async function planYouTube(files) {
    const metaFile = find(files, /video metadata\/.*videos?\.csv$/i) ?? find(files, /youtube.*\/videos\.csv$/i);
    const m = metaFile ? youtubeMetadata(await metaFile.text()) : new Map();
    const videos = files.filter((f) => VIDEO.test(f.path) && /youtube/i.test(f.path)).map((f) => {
        const base = f.path.split('/').pop().replace(VIDEO, '');
        const hit = m.get(norm(base)) ?? [...m.values()].find((x) => norm(x.title).startsWith(norm(base).slice(0, 40)));
        const d = hit?.date ? new Date(hit.date) : null;
        return {
            path: f.path, title: hit?.title ?? base, description: hit?.desc ?? '',
            at: d && !isNaN(d.getTime()) ? d.toISOString() : null, privacy: hit?.privacy ?? '',
            bytes: f.size, cost: costSats(f.size + YT_META_BYTES),
        };
    }).sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
    return {
        platform: 'youtube', videos, hasMetadata: !!metaFile,
        bytes: videos.reduce((a, v) => a + v.bytes, 0), cost: videos.reduce((a, v) => a + v.cost, 0),
    };
}
/** Detect the platform and plan it in one go. */
export async function plan(files) {
    const p = detect(files);
    if (p === 'x')
        return planX(files);
    if (p === 'youtube')
        return planYouTube(files);
    throw new Error('Not an export we can read yet. Supported: X (Twitter) archive, YouTube via Google Takeout. For friends lists (Facebook, Instagram, LinkedIn, X) use friends().');
}
export * from './friends.js';
export * from './zip.js';
export * from './archive.js';
export * from './progress.js';
export * from './private.js';
