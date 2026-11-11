// Finds a real drum chart for a song on Chorus Encore (enchor.us, the Clone
// Hero chart search engine) and pulls ONLY the notes file out of its .sng
// package with HTTP range requests - the audio in the package is never fetched.

import { parseNotesFile } from './chartparse.js';

const API = 'https://api.enchor.us/search';
const FILES = 'https://files.enchor.us';

export const norm = (s) => (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');

// "Song - Remastered 2011", "Song (feat. X)" -> "Song"
export function cleanTitle(title) {
  return (title || '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/\s*[([][^)\]]*(feat|with|remaster|version|edit|mix|live|mono|stereo|deluxe|bonus|from)[^)\]]*[)\]]/gi, '')
    .trim() || title;
}

export async function searchCharts(query) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      search: query, page: 1, instrument: 'drums', difficulty: null,
      drumType: null, drumsReviewed: false, source: 'website',
    }),
  });
  if (res.status === 429) throw new Error('the chart site says too many requests - wait a minute');
  if (!res.ok) throw new Error(`the chart site said ${res.status}`);
  const body = await res.json();
  return (body.data || []).map((c) => ({
    md5: c.md5,
    name: c.name || '',
    artist: c.artist || '',
    album: c.album || '',
    charter: c.charter || '',
    length: (c.song_length || 0) / 1000,
    drumType: c.notesData?.drumType ?? 0,
    delay: (c.delay || 0) / 1000 + (c.chart_offset || 0) / 1000,
    notes: Math.max(0, ...(c.notesData?.noteCounts || []).filter((n) => n.instrument === 'drums').map((n) => n.count)),
  }));
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
  if (/harmonix|neversoft/i.test(chart.charter)) score += 5; // official game charts
  if (/\b(2x|double)\b/i.test(chart.name)) score -= 3;
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

// The parsed drum chart of one search result.
export async function loadChart(chart, difficulty = 'expert') {
  const url = `${FILES}/${chart.md5}.sng`;
  const { files, mask } = await sngIndex(url);
  const file = files.find((f) => f.name.toLowerCase() === 'notes.chart')
    || files.find((f) => f.name.toLowerCase() === 'notes.mid');
  if (!file) throw new Error('that chart has no notes file');
  const raw = await range(url, file.offset, file.offset + file.size - 1);
  for (let i = 0; i < raw.length; i++) raw[i] ^= mask[i % 16] ^ (i & 0xff);
  const parsed = parseNotesFile(file.name, raw, difficulty, chart.drumType);
  if (!parsed.notes.length) throw new Error('that chart has no drum notes');
  const shift = (chart.delay || 0) + (parsed.offset || 0);
  if (shift) {
    for (const n of parsed.notes) n.t += shift;
    parsed.phrases = parsed.phrases.map((t) => t + shift);
  }
  return parsed;
}

// The chart was timed to its own copy of the song, which can start a little
// earlier or later than Spotify's. Both the chart (vocal phrases) and the
// synced lyrics know when each line starts: the shift that lines up the most
// of them is how far apart the two copies are. Returns seconds to add to the
// chart's times, or null when there's no clear answer.
export function lyricShift(phrases, lineTimes, maxShift = 20) {
  if (phrases.length < 6 || lineTimes.length < 6) return null;
  const BIN = 0.1, NEAR = 0.2;
  const votes = new Map();
  for (const p of phrases) {
    for (const l of lineTimes) {
      const d = l - p;
      if (Math.abs(d) <= maxShift) votes.set(Math.round(d / BIN), (votes.get(Math.round(d / BIN)) || 0) + 1);
    }
  }
  const around = (k) => (votes.get(k - 1) || 0) + (votes.get(k) || 0) + (votes.get(k + 1) || 0);
  let best = null, bestN = 0;
  for (const k of votes.keys()) {
    const n = around(k);
    if (n > bestN || (n === bestN && Math.abs(k) < Math.abs(best))) { best = k; bestN = n; }
  }
  let second = 0;                                           // the best of the shifts that aren't the same one
  for (const k of votes.keys()) if (Math.abs(k - best) > 4) second = Math.max(second, around(k));
  const enough = Math.max(5, Math.min(phrases.length, lineTimes.length) * 0.35);
  if (best === null || bestN < enough || bestN < second * 1.4) return null;
  // the middle of the matched pairs, finer than the bin
  const diffs = [];
  for (const p of phrases) {
    for (const l of lineTimes) if (Math.abs(l - p - best * BIN) <= NEAR) diffs.push(l - p);
  }
  diffs.sort((a, b) => a - b);
  return diffs.length ? diffs[diffs.length >> 1] : best * BIN;
}
