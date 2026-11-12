// Finds a real drum chart for a song on Chorus Encore (enchor.us, the Clone
// Hero chart search engine) and pulls ONLY the notes file out of its .sng
// package with HTTP range requests - the audio in the package is never fetched.
//
// Every request to the search (api.enchor.us) goes through the paced queue in
// net.js, and every answer row is cut down by slim() in catalog.js the moment
// it arrives. The range requests for notes files (files.enchor.us) go direct.

import { parseNotesFile } from './chartparse.js';
import { post } from './net.js';
import { slim, songs, retries, findVersion } from './catalog.js';
import { norm, cleanTitle } from './text.js';

export { norm, cleanTitle };

const FILES = 'https://files.enchor.us';
export const PER_PAGE = 25;            // charts asked for per page

// ---- what this session has seen (memory only, gone on reload) ---------------

const KEEP_ANSWERS = 50;               // searches whose answers stay, so going Back is instant
const KEEP_SEEN = 600;                 // single versions remembered, for opening a song by its address
const KEEP_FILES = 30;                 // notes files kept (20 to 300 KB each)
const answers = new Map();             // tidy lower-case query -> answer; the one used longest ago comes first
const seen = new Map();                // md5 -> version: every version any answer brought
const notesFiles = new Map();          // md5 -> the bytes of its notes file
const fetching = new Map();            // md5 -> the load of its notes file that is under way
const born = new WeakMap();            // those bytes -> { md5, name }
const realKits = new Map();            // md5 -> does it say what is hit on a real kit (known after a parse)

function keep(map, key, value, most) {
  map.delete(key);
  map.set(key, value);
  while (map.size > most) map.delete(map.keys().next().value);
}

// Forget everything above (the tests start clean with it).
export function forgetAll() {
  for (const m of [answers, seen, notesFiles, fetching, realKits]) m.clear();
}

// Whether this version says what is hit on a real kit: true or false once its
// notes were parsed in this session, undefined before that.
export const realKit = (md5) => realKits.get(md5);

// What is known about real kits: the caller's own knowledge (the library) first, then this session's.
const knows = (real) => (md5) => real?.(md5) ?? realKits.get(md5);

// ---- asking the chart site ----------------------------------------------------

// Answer rows cut down at once, the same chart only once (the site sends one row per copy of it).
function cutDown(body) {
  const rows = [];
  const had = new Set();
  for (const row of body?.data || []) {
    if (!row?.md5 || had.has(row.md5)) continue;
    had.add(row.md5);
    const v = slim(row);
    rows.push(v);
    keep(seen, v.md5, v, KEEP_SEEN);
  }
  return rows;
}

// One page of the answer to a search: { rows, found }. `found` is how many charts the site has for it.
async function ask(query, page, signal) {
  const body = await post('/search', {
    search: query, page, per_page: PER_PAGE, instrument: 'drums', difficulty: null,
    drumType: null, drumsReviewed: false, source: 'website',
  }, { signal });
  return { rows: cutDown(body), found: Number(body?.found) || 0 };
}

// The chart site's answer to a search, in its own order: one record per chart
// (see slim() in catalog.js: md5, name, artist, album, charter, length,
// drumType, lyrics, delay, notes and more), the same chart never twice.
// Rejects with a ChartSiteError (net.js) when the site does not answer.
export async function searchCharts(query, { page = 1, signal } = {}) {
  return (await ask(query, page, signal)).rows;
}

const tidy = (query) => (query || '').trim().replace(/\s+/g, ' ');

// The first page of a search. When it has no song to show, the second tries of
// retries() are asked one after the other until one has.
async function firstPage(asked, signal) {
  const tried = [];
  for (const q of [asked, ...retries(asked)]) {
    tried.push(q);
    const { rows, found } = await ask(q, 1, signal);
    if (songs(rows).length) return { asked, usedQuery: q, tried, rows, found, pages: 1, more: PER_PAGE < found };
  }
  return { asked, usedQuery: asked, tried, rows: [], found: 0, pages: 1, more: false };
}

// "Show more": the next page of the same search, added to what is there.
async function nextPage(answer, signal) {
  const page = answer.pages + 1;
  const { rows, found } = await ask(answer.usedQuery, page, signal);
  if (answer.pages + 1 !== page) return;                     // another call added this page meanwhile
  const before = songs(answer.rows).length;
  const have = new Set(answer.rows.map((r) => r.md5));
  answer.rows = answer.rows.concat(rows.filter((r) => !have.has(r.md5)));
  answer.pages = page;
  if (found) answer.found = found;
  // stop offering more once a page brings no new song, or everything the site has was asked for
  answer.more = songs(answer.rows).length > before && page * PER_PAGE < answer.found;
}

// Song lookup for the screens: what was typed -> songs, the one asked for by name first.
//   const { songs, found, more, usedQuery } = await search('everlong', { page: 1, signal });
// - songs: every song of pages 1..page, grouped and ordered by songs() in catalog.js (the whole list
//   again on every call: a later page can add a version to a song that is already there).
// - usedQuery: the query the songs really came from. When what was typed finds nothing, up to two
//   second tries are asked by themselves; usedQuery !== query then means "Showing results for ...".
//   `tried` lists every query that was asked, in order.
// - found: how many charts the chart site has for usedQuery. more: whether page + 1 is worth asking.
// - page: the last page that is in `songs`.
// - songs is empty when nothing was found, also after the second tries.
// { signal } calls it off (the promise then rejects with an error named 'AbortError'); { real } is
// (md5) => true | false | undefined, what the library knows about real-kit versions.
// A search that was answered before comes from memory with no request (the last 50 are kept).
// Rejects with a ChartSiteError from net.js (kind 'down', 'busy' or 'refused') when the site fails.
export async function search(query, { page = 1, signal, real } = {}) {
  const asked = tidy(query);
  if (!asked) return { query: asked, usedQuery: asked, tried: [], songs: [], found: 0, more: false, page: 0 };
  const key = asked.toLowerCase();
  let answer = answers.get(key);
  if (!answer) answer = await firstPage(asked, signal);
  if (answer.rows.length) keep(answers, key, answer, KEEP_ANSWERS);    // "nothing found" is asked again next time
  while (answer.pages < page && answer.more) await nextPage(answer, signal);
  return {
    query: asked,
    usedQuery: answer.usedQuery,
    tried: answer.tried,
    songs: songs(answer.rows, { query: asked, real: knows(real) }),
    found: answer.found,
    more: answer.more,
    page: answer.pages,
  };
}

// The song a version belongs to, from the answers still in memory: { song, chart } or null.
// The song has the versions the search that found it knew of. No request is made.
export function remembered(md5, { real } = {}) {
  const lists = [...answers.values()].filter((a) => a.rows.some((r) => r.md5 === md5)).reverse();
  for (const hide of [true, false]) {
    for (const a of lists) {
      const hit = findVersion(songs(a.rows, { query: a.asked, real: knows(real), hide }), md5);
      if (hit) return hit;
    }
  }
  const v = seen.get(md5);
  return v ? findVersion(songs([v], { real: knows(real), hide: false }), md5) : null;
}

// One version looked up by its md5 with ONE request to the chart site's advanced
// search (for a song page opened by its address): { song, chart }, the song having
// just that version, or null when the site no longer has it.
export async function advancedByHash(md5, { signal, real } = {}) {
  const body = await post('/search/advanced', {
    hash: md5, instrument: 'drums', difficulty: null, drumType: null, drumsReviewed: false,
    source: 'website', page: 1, per_page: PER_PAGE,
  }, { signal });
  const v = cutDown(body).find((r) => r.md5 === md5);
  return v ? findVersion(songs([v], { real: knows(real), hide: false }), md5) : null;
}

// How well a chart fits the song: higher is better, below 0 is "not this song".
export function fit(chart, song) {
  const cn = norm(chart.name), sn = norm(cleanTitle(song.title));
  const ca = norm(chart.artist), sa = norm((song.artist || '').split(',')[0]);
  if (!sn || !(cn.includes(sn) || sn.includes(cn)) || !cn) return -1;
  let score = cn === sn ? 50 : 25;
  if (sa) {
    if (ca.includes(sa) || sa.includes(ca)) score += 40; else score -= 40;
  }
  if (song.duration && chart.length) {
    const off = Math.abs(chart.length - song.duration);
    score += off < 3 ? 30 : off < 8 ? 15 : off < 20 ? 0 : -25;
  }
  if (chart.drumType === 1) score += 15;                    // cymbals and toms told apart
  if (chart.lyrics) score += 10;                            // can be lined up with the song by its lyrics
  if (/harmonix/i.test(chart.charter)) score += 35;         // Rock Band's own charts also say what's hit on a real kit
  else if (/neversoft/i.test(chart.charter)) score += 3;    // Guitar Hero's own charts
  if (/\b(2x|double)\b/i.test(chart.name)) score -= 3;
  const other = /\b(live|acoustic|demo|remix|cover)\b/i;    // another recording: its drums won't line up
  if (other.test(chart.name) !== other.test(song.title || '')) score -= 45;
  return score;
}

// Charts for a song, best fit first (only ones that look like the song).
export async function findCharts(song) {
  const title = cleanTitle(song.title);
  const first = (song.artist || '').split(',')[0].trim();
  let found = await searchCharts(`${title} ${first}`.trim());
  let ranked = found.map((c) => ({ ...c, fit: fit(c, song) })).filter((c) => c.fit > 0);
  if (!ranked.length && first) {                             // the artist can be spelled differently there
    found = await searchCharts(title);
    ranked = found.map((c) => ({ ...c, fit: fit(c, song) })).filter((c) => c.fit > 0);
  }
  return ranked.sort((a, b) => b.fit - a.fit);
}

async function range(url, from, to) {
  const res = await fetch(url, { headers: { Range: `bytes=${from}-${to}` } });
  if (!res.ok) throw new Error(`the chart file said ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// The file table of a .sng package: [{ name, size, offset }] and its xor mask.
async function sngIndex(url) {
  let head = await range(url, 0, 8191);
  if (new TextDecoder().decode(head.subarray(0, 6)) !== 'SNGPKG') throw new Error('not a chart package');
  const u64 = (b, p) => Number(new DataView(b.buffer, b.byteOffset, b.byteLength).getBigUint64(p, true));
  const metaLen = u64(head, 26);
  const need = 34 + metaLen + 8 + (head.length >= 42 + metaLen ? u64(head, 34 + metaLen) : 65536);
  if (need > head.length) head = await range(url, 0, need - 1);
  const mask = head.slice(10, 26);
  let p = 34 + metaLen + 8;
  const count = u64(head, p);
  p += 8;
  const files = [];
  for (let i = 0; i < count; i++) {
    const len = head[p++];
    const name = new TextDecoder().decode(head.subarray(p, p + len));
    p += len;
    files.push({ name, size: u64(head, p), offset: u64(head, p + 8) });
    p += 16;
  }
  return { files, mask };
}

async function readNotesFile(md5) {
  const url = `${FILES}/${md5}.sng`;
  const { files, mask } = await sngIndex(url);
  const file = files.find((f) => f.name.toLowerCase() === 'notes.chart')
    || files.find((f) => f.name.toLowerCase() === 'notes.mid');
  if (!file) throw new Error('that chart has no notes file');
  const raw = await range(url, file.offset, file.offset + file.size - 1);
  for (let i = 0; i < raw.length; i++) raw[i] ^= mask[i % 16] ^ (i & 0xff);
  born.set(raw, { md5, name: file.name });
  return raw;
}

// The notes file of a version (notes.chart or notes.mid, as bytes), read out of
// its package with two or three range requests. The bytes stay in memory per
// md5, so asking again (another level, Play after the song page) costs no
// request; two calls at once share one load. A failed load is not kept.
// Never change the bytes: every caller gets the same array.
export function fetchNotesFile(md5) {
  const kept = notesFiles.get(md5);
  if (kept) {
    keep(notesFiles, md5, kept, KEEP_FILES);
    return Promise.resolve(kept);
  }
  let load = fetching.get(md5);
  if (!load) {
    load = readNotesFile(md5).then((bytes) => {
      keep(notesFiles, md5, bytes, KEEP_FILES);
      return bytes;
    }).finally(() => { if (fetching.get(md5) === load) fetching.delete(md5); });
    fetching.set(md5, load);
  }
  return load;
}

const isMidi = (b) => b[0] === 0x4d && b[1] === 0x54 && b[2] === 0x68 && b[3] === 0x64;   // "MThd"

// The drum chart in a notes file, at one level, with every time moved by the
// version's delay (seconds): { notes, phrases, bars, beats, sections, difficulty,
// available, drumType, format, real, ... }. No request: parsing the same bytes
// again for another level is instant, and every call gives fresh objects.
// - bytes: what fetchNotesFile() gave, or any notes.chart / notes.mid bytes.
// - level: 'expert' | 'hard' | 'medium' | 'easy'; a level the file lacks falls back to its highest.
// - delay: the version's `delay`.
// - drumType: the version's `drumType`. A .mid without tom markers cannot tell cymbals
//   from toms by itself, so hand it over whenever the version is known.
export function parseNotes(bytes, level = 'expert', delay = 0, drumType = null) {
  const from = born.get(bytes);
  const name = from?.name || (isMidi(bytes) ? 'notes.mid' : 'notes.chart');
  const parsed = parseNotesFile(name, bytes, level, drumType);
  if (!parsed.notes.length) throw new Error('that chart has no drum notes');
  if (from) realKits.set(from.md5, Boolean(parsed.real));
  const shift = (delay || 0) + (parsed.offset || 0);
  if (shift) {
    for (const n of parsed.notes) n.t += shift;
    parsed.phrases = parsed.phrases.map((t) => t + shift);
    parsed.bars = parsed.bars.map((t) => t + shift);
    parsed.beats = parsed.beats.map((t) => t + shift);
    parsed.sections = parsed.sections.map((s) => ({ ...s, t: s.t + shift }));
  }
  return parsed;
}

// The parsed drum chart of one search result.
export async function loadChart(chart, difficulty = 'expert') {
  return parseNotes(await fetchNotesFile(chart.md5), difficulty, chart.delay, chart.drumType);
}

// The chart was timed to its own copy of the song, which can start earlier or
// later than Spotify's (game versions often have a few seconds of lead-in).
// Both the chart (vocal phrases) and the synced lyrics know when each line
// starts: the shift that puts the most lyric lines on a phrase is how far
// apart the two copies are. Returns seconds to add to the chart's times, or
// null when there's no clear answer. Good to about a fifth of a second - the
// lyric timings are hand-made - so it gets the notes onto the right beat, not
// onto the exact millisecond.
export function lyricShift(phrases, lineTimes, maxShift = 20) {
  if (phrases.length < 5 || lineTimes.length < 5) return null;
  const NEAR = 0.45, STEP = 0.05;
  const ps = [...phrases].sort((a, b) => a - b);
  const gap = (x) => {                                      // x minus the nearest phrase
    let lo = 0, hi = ps.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ps[mid] < x) lo = mid + 1; else hi = mid;
    }
    const a = x - ps[lo], b = lo > 0 ? x - ps[lo - 1] : Infinity;
    return Math.abs(a) < Math.abs(b) ? a : b;
  };
  let best = null;
  const tries = [];
  for (let d = -maxShift; d <= maxShift; d += STEP) {
    let n = 0, err = 0;
    for (const l of lineTimes) {
      const g = Math.abs(gap(l - d));
      if (g <= NEAR) { n++; err += g; }
    }
    tries.push({ d, n, err });
    if (!best || n > best.n || (n === best.n && err < best.err)) best = { d, n, err };
  }
  // songs repeat, so a shift of a whole line also fits some lines: the right
  // one has to fit clearly more of them than any other
  const rival = Math.max(0, ...tries.filter((t) => Math.abs(t.d - best.d) > 1).map((t) => t.n));
  const enough = Math.max(5, Math.min(phrases.length, lineTimes.length) * 0.5);
  if (best.n < enough || best.n < rival + 2) return null;
  const gaps = lineTimes.map((l) => gap(l - best.d)).filter((g) => Math.abs(g) <= NEAR).sort((a, b) => a - b);
  return best.d + gaps[gaps.length >> 1];
}
