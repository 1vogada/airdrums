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
    lyrics: Boolean(c.notesData?.hasLyrics),
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
