// Turns the chart site's answer into songs. The site lists charts: one row per
// upload, the same chart sometimes twice, five people's versions of one song
// side by side, whole albums and guitar-only uploads in between, in no order
// of how well known a song is. Here that becomes one row per song with its
// versions behind it, the one to play first on top.
//
// Pure functions, no DOM and no network: runs in Node (tests/catalog_check.mjs).

import { cleanTitle, songKey } from './text.js';

export const LEVELS = ['expert', 'hard', 'medium', 'easy'];

const cut = (s, max) => String(s ?? '').trim().slice(0, max);
const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;

// A raw answer row is 3 to 70 KB. This is all of it that is kept: about 400 bytes.
// Times are in seconds; `length` is the song_length the site reports (what fit()
// compares with), `playLength` where the notes end (better for showing: the
// site's song_length is wrong on some rows).
export function slim(row) {
  const data = row.notesData || {};
  const counts = {};
  let notes = 0;
  for (const c of data.noteCounts || []) {
    if (c?.instrument !== 'drums') continue;
    notes = Math.max(notes, c.count || 0);
    counts[c.difficulty] = c.count || 0;
  }
  const levels = {};
  for (const level of LEVELS) if (counts[level] > 0) levels[level] = counts[level];
  const length = (row.song_length || 0) / 1000;
  const playLength = round((data.effectiveLength || 0) / 1000, 3);
  const over = playLength || length;
  return {
    md5: row.md5,
    name: cut(row.name, 100),
    artist: cut(row.artist, 60),
    album: cut(row.album, 48),
    year: Number(/\d{4}/.exec(String(row.year ?? ''))?.[0]) || 0,      // "1964 (July 10)" -> 1964, unknown -> 0
    genre: cut(row.genre, 20),
    charter: cut(row.charter, 40),
    length,
    playLength,
    tier: Number.isFinite(row.diff_drums) ? row.diff_drums : -1,       // how hard the site says the drums are, -1 unknown
    levels,                                                            // { expert: notes, hard: notes, ... } only the ones it has
    nps: over > 0 ? round((levels.expert || notes) / over, 2) : 0,     // notes per second: how busy
    drumType: data.drumType ?? 0,                                      // 0 four lanes, 1 cymbals told apart, 2 five lanes
    lyrics: Boolean(data.hasLyrics),                                   // can be lined up with Spotify by its lyrics
    twoKick: Boolean(data.has2xKick),
    delay: (row.delay || 0) / 1000 + (row.chart_offset || 0) / 1000,
    notes,                                                             // the most notes any level has
    art: row.albumArtMd5 || '',
    pack: cut(row.packName, 24),
    modified: Date.parse(row.modifiedTime) || 0,
  };
}

// A record that is already slim (from the library, or an older one with fewer fields) with every field there.
function whole(v) {
  return {
    name: '', artist: '', album: '', year: 0, genre: '', charter: '', length: 0, playLength: 0, tier: -1,
    nps: 0, drumType: 0, lyrics: false, twoKick: false, delay: 0, notes: 0, art: '', pack: '', modified: 0,
    ...v,
    levels: v.levels || {},
  };
}

const isRaw = (row) => 'song_length' in row || 'notesData' in row || 'albumArtMd5' in row;

// The picture of a version or song: the chart site's album art (kept as its md5), or a link kept as it is.
export const artUrl = (art) => (/^[0-9a-f]{32}$/i.test(art || '') ? `https://files.enchor.us/${art}.jpg` : art || '');

// ---- labels ---------------------------------------------------------------

// A word only says what kind of recording it is when it stands in brackets or
// after a dash: "Song (Live)", "Song [Acoustic]", "Song - Demo". "Live Forever"
// and "Cover Me" are just titles.
const KINDS = [['Live', /\blive\b/i], ['Acoustic', /\bacoustic\b/i], ['Demo', /\bdemo\b/i], ['Remix', /\bremix\b/i], ['Cover', /\bcover\b/i]];
const TWO_PEDALS = /\b2x\b|\bdouble[\s-]+(bass|kick|pedal)\b|\bexpert\s*\+/i;
const TAG = /\s*[([][^)\]]*(\blive\b|\bacoustic\b|\bdemo\b|\bremix\b|\bcover\b|\b2x\b|\bdouble[\s-]+(bass|kick|pedal)\b|\bbass\s+pedal\b|\bexpert\s*\+)[^)\]]*[)\]]/gi;

function asides(name) {
  const out = [...(name || '').matchAll(/[([]([^)\]]*)[)\]]/g)].map((m) => m[1]);
  const tail = /\s+-\s+(.*)$/.exec(name || '');
  if (tail) out.push(tail[1]);
  return out.join(' | ');
}

// What to know before choosing this version: 'Live', 'Acoustic', 'Demo', 'Remix', 'Cover', '2x pedal'.
export function labels(v) {
  const said = asides(v.name);
  const out = KINDS.filter(([, re]) => re.test(said)).map(([word]) => word);
  if (v.twoKick || TWO_PEDALS.test(v.name || '')) out.push('2x pedal');   // bass drum notes written for two pedals
  return out;
}

// The name without those bracketed remarks: "Song (Live) (2x Bass Pedal)" -> "Song".
export const plainName = (name) => (name || '').replace(TAG, '').trim() || (name || '');

// Never shown as songs: a whole album as one chart, and guitar-only re-uploads.
export function hidden(v) {
  return (v.playLength || v.length || 0) > 15 * 60 || /full\s+album/i.test(v.name || '') || /\b6[\s-]?fret\b/i.test(v.name || '');
}

// Does this version say what is hit on a real kit? Known for sure only after its
// notes were loaded once (v.real, or `known(md5)`); until then Rock Band's own
// charts (charter Harmonix) are taken to.
export function isReal(v, known) {
  const sure = typeof v.real === 'boolean' ? v.real : known?.(v.md5);
  return typeof sure === 'boolean' ? sure : /harmonix/i.test(v.charter || '');
}

// How busy the drums are, from the site's tier: { word, dots } or null when unknown.
export function busy(tier) {
  if (!Number.isFinite(tier) || tier < 0) return null;
  if (tier <= 1) return { word: 'Gentle', dots: 1 };
  if (tier <= 3) return { word: 'Moderate', dots: 2 };
  if (tier <= 5) return { word: 'Busy', dots: 3 };
  return { word: 'Intense', dots: 4 };
}

// The one badge a row has room for: a caution first (Live, Acoustic, Demo,
// Remix, Cover, 2x pedal, Expert only), else the best thing about the version
// (Real kit, Auto sync). { text, caution } or null.
export function badge(v, known) {
  const warn = (v.labels || labels(v))[0];
  if (warn) return { text: warn, caution: true };
  const has = Object.keys(v.levels || {});
  if (has.length === 1 && has[0] === 'expert') return { text: 'Expert only', caution: true };
  if (isReal(v, known)) return { text: 'Real kit', caution: false };
  if (v.lyrics) return { text: 'Auto sync', caution: false };
  return null;
}

// ---- songs ----------------------------------------------------------------

const ODD = { ø: 'o', Ø: 'O', æ: 'ae', Æ: 'AE', œ: 'oe', Œ: 'OE', ß: 'ss', đ: 'd', Đ: 'D', ł: 'l', Ł: 'L' };

// "Motörhead" -> "Motorhead". The chart site does not fold accents itself.
export function fold(s) {
  return (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').normalize('NFC').replace(/[øØæÆœŒßđĐłŁ]/g, (c) => ODD[c]);
}

// Words for comparing what was typed with a title: accents folded, apostrophes dropped, "the" ignored.
function words(s) {
  return fold(s).toLowerCase().replace(/['’`]/g, '').split(/[^\p{L}\p{N}]+/u).filter((w) => w && w !== 'the');
}
const sameWords = (a, b) => a.length > 0 && a.length === b.length && [...a].sort().join(' ') === [...b].sort().join(' ');
const firstArtist = (artist) => (artist || '').split(',')[0];
const flat = (s) => words(s).join(' ');

// 2: the words typed are exactly the title plus the artist ("everlong foo fighters", in any order).
// 1: they are exactly the title, or exactly the artist. 0: neither.
export function exactness(song, query) {
  const q = words(query);
  if (!q.length) return 0;
  const t = words(cleanTitle(song.title)), a = words(firstArtist(song.artist));
  if (sameWords(q, [...t, ...a])) return 2;
  return sameWords(q, t) || sameWords(q, a) ? 1 : 0;
}

// rows: raw answer rows or slim records, in the chart site's order (several pages one after the other).
// { query }: what was typed, for the order. { real }: (md5) => true | false | undefined, what loading a
// version taught about it. { hide: false } keeps albums and 6-fret uploads (opening one by its address).
// Returns songs in the order to show them:
//   { key, title, artist, album, year, art, length, charts: [version, ...], labels, exact }
// `charts` are the song's versions, the one to play first at [0]; each is the slim record plus `labels`.
// `labels` are those of that first version: not empty means the song only exists as live, cover, 2x pedal...
// `key` is songKey(title, artist): the same key the library files the song under.
export function songs(rows, { query = '', real, hide = true } = {}) {
  const seen = new Set();
  const groups = new Map();
  for (const row of rows || []) {
    if (!row?.md5 || seen.has(row.md5)) continue;            // the same chart again (one row per copy of it)
    seen.add(row.md5);
    const v = isRaw(row) ? slim(row) : whole(row);
    if (hide && hidden(v)) continue;
    v.labels = labels(v);
    const key = songKey(plainName(v.name), v.artist);
    if (key === '|') continue;                               // no name and no artist: nothing to show
    if (!groups.has(key)) groups.set(key, { key, first: groups.size, charts: [] });
    const list = groups.get(key).charts;
    // a charter's newer upload of the same title replaces the older one
    const same = v.charter ? list.findIndex((o) => flat(o.charter) === flat(v.charter) && flat(o.name) === flat(v.name)) : -1;
    if (same < 0) list.push(v);
    else if (v.modified > list[same].modified) list[same] = v;
  }

  const order = (v) => [
    v.labels.length ? 1 : 0,                                 // the plain recording before live, cover, 2x pedal...
    isReal(v, real) ? 0 : 1,                                 // says what is hit on a real kit
    v.lyrics ? 0 : 1,                                        // can be lined up by its lyrics
    v.drumType === 1 ? 0 : 1,                                // cymbals and toms told apart
    -Object.keys(v.levels).length,                           // more levels
    -v.modified,                                             // newest
  ];
  const byOrder = (a, b) => {
    const x = order(a), y = order(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  };

  const out = [];
  for (const g of groups.values()) {
    g.charts.sort(byOrder);
    const best = g.charts[0];
    const song = {
      key: g.key,
      title: plainName(best.name),
      artist: best.artist,
      album: best.album,
      year: best.year,
      art: best.art,
      length: best.playLength || best.length,
      charts: g.charts,
      labels: best.labels,
      exact: 0,
      first: g.first,
    };
    song.exact = exactness(song, query);
    out.push(song);
  }
  // what was asked for by name first; songs that only exist as live, cover... after the plain ones; else the site's order
  out.sort((a, b) => b.exact - a.exact || (a.labels.length ? 1 : 0) - (b.labels.length ? 1 : 0) || a.first - b.first);
  for (const s of out) delete s.first;
  return out;
}

// The song with exactly this title and artist (a starter-list click, a song Spotify names), or null.
export function findSong(list, title, artist) {
  const key = songKey(title, artist);
  return (list || []).find((s) => s.key === key) || null;
}

// The song that has this version, and the version: { song, chart } or null.
export function findVersion(list, md5) {
  for (const song of list || []) {
    const chart = (song.charts || []).find((c) => c.md5 === md5);
    if (chart) return { song, chart };
  }
  return null;
}

// Songs you already have that fit what is being typed: shown at once under
// "Your songs" while the chart site is asked, and when it is down. Every typed
// word has to begin a word of the title, the artist or the album. The song
// asked for by name comes first; the rest keep the order they were given in.
// `list`: library entries or songs, anything with { title, artist }.
export function matching(list, query) {
  const typed = words(query);
  if (!typed.length) return [];
  const hits = [];
  (list || []).forEach((song, i) => {
    const has = [...words(song.title), ...words(song.artist), ...words(song.album)];
    if (typed.every((w) => has.some((h) => h.startsWith(w)))) hits.push({ song, i, exact: exactness(song, query) });
  });
  return hits.sort((a, b) => b.exact - a.exact || a.i - b.i).map((h) => h.song);
}

// ---- second tries ---------------------------------------------------------

// What to ask instead when a search finds nothing: at most two more queries.
// (1) accents folded and punctuation after the last word removed: the site
//     matches the last word as a beginning, and "believin'" begins nothing.
//     Apostrophes inside a word stay ("don't").
// (2) that, without its last word.
export function retries(query) {
  const tidy = (s) => s.trim().replace(/\s+/g, ' ');
  const bare = (s) => tidy(s).replace(/[^\p{L}\p{N}]+$/u, '');
  const asked = tidy(query || '');
  const out = [];
  const first = bare(fold(asked));
  if (first && first !== asked) out.push(first);
  const parts = (first || asked).split(' ');
  if (parts.length > 1) {
    const second = bare(parts.slice(0, -1).join(' '));
    if (second && second !== asked && !out.includes(second)) out.push(second);
  }
  return out;
}
