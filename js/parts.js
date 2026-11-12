// The parts of a song (Intro, Verse 1, Chorus 1...) as ONE list that the part
// strip, the song page, Learn and the results all read, and the counted bar
// that leads into a part. No DOM, no storage, no network: numbers in, numbers out.
//
// ---------------------------------------------------------------------------
// parts(parsed, { top, length }) -> [part, part, ...]
//
//   parsed   what loadChart() gives for the level being played:
//            { notes: [{ t, pad }], sections: [{ t, name }], bars: [s], beats: [s] }
//   top      the same chart loaded at its highest level (parsed.available[0]).
//            The list is SHAPED from it, so ids, names and times are the same
//            on every level. Leave it out when `parsed` is the highest level.
//   length   the song's length in seconds, when known: the list then runs to
//            the end of the song. Leave it out and it stops 2 s after the last note.
//
// Every part, in time order:
//
//   {
//     id:     8000,          // whole number, unique, rising: the part's own start in
//                            // milliseconds of chart time. Use it in addresses and as
//                            // the key of stored progress.
//     n:      2,             // 1, 2, 3... among the parts that have drums; 0 for a stretch without
//     name:   'Verse 1',     // ready to show: 'Chorus 2', 'Bridge (2)', 'Guitar Solo - 2',
//                            // 'Part 6', 'Bars 9-16'; '' for a stretch without drums that
//                            // the chart did not name
//     stem:   'verse',       // the name minus number, letter suffix, '(2)' and piece number.
//                            // Two parts with the same stem are "the same part again".
//                            // '' = no stem ('Part 6', 'Bars 9-16'): never the same as anything.
//     from:   8,             // seconds of chart time (the clock of notes[].t), where it starts:
//                            // its own marker, which can sit just before a bar line
//     to:     24,            // seconds, where it ends = where the next one starts
//     length: 16,            // to - from
//     notes:  32,            // drum notes of `parsed` (the level played) in [from, to)
//     counts: { kick: 8, snare: 8, hihat: 16 },   // the same notes per drum; drums not hit are left out
//     nps:    2,             // notes per second: notes / length
//     empty:  false,         // true: no drum notes here. The strip hatches it; it is not
//                            // listed, not learned, not stepped to and has no count-in.
//   }
//
// What can be relied on:
//   - The list has no holes: each part ends where the next one starts.
//   - A note belongs to the part with from <= t < to.
//   - The parts to play are list.filter((p) => !p.empty). Stretches without drums
//     (a guitar intro, an outro, a long rest) are in the list too so that the
//     strip can draw them, hatched.
//   - A part starts at the chart's own marker, never moved to a bar line.
//   - An empty list means the chart has no drum notes.
//
// ---------------------------------------------------------------------------
// countIn(parsed, at) -> { from, to, beat, clicks: [{ t, n, accent }] }
//
//   at       a part from the list above, or a time in seconds. Left out: the
//            first drum note of the song (the start of a whole run).
//
//   from     seconds of chart time where the clock starts: the first click.
//            It can be below 0 when the part starts at the top of the song.
//   to       where the counted bar ends and the part starts (part.from)
//   beat     seconds one beat lasts at the tempo there
//   clicks   one per beat, on the chart's own beats: t (seconds), n (the
//            numeral to show: the beat's number in its bar) and accent (true
//            on the first beat of a bar). Every t is before `to`.
// ---------------------------------------------------------------------------

export const RULES = {
  shortSeconds: 6,       // a part shorter than this is folded into its neighbour
  shortNotes: 8,         // ...and so is one with fewer drum notes than this
  longSeconds: 32,       // a part longer than this is cut into pieces
  pieceBars: 8,          // ...of this many bars
  pieceMin: 8,           // seconds: when the bars are so short that a piece lasts less, the pieces are twice as many bars
  pieceMax: 32,          // seconds: when a piece would last longer, the pieces are half as many bars
  fewParts: 3,           // a chart with this many usable parts or fewer is cut into blocks of bars instead
  tail: 2,               // seconds after the last note that the last part lasts
  restSeconds: 6,        // a silent start or end of a part at least this long...
  restBars: 2,           // ...and at least this many bars is split off as a stretch without drums
  nameMax: 24,           // letters a name may have
  near: 0.05,            // seconds: a marker this close to a beat is on it
  countMin: 1.2,         // seconds: a counted bar shorter than this is counted twice
  countMax: 3.2,         // seconds: of a counted bar longer than this only the second half is counted
};

// First index whose value is not below x.
function lowerBound(list, x) {
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < x) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// ---- names ----------------------------------------------------------------

const WORDS = { gtr: 'guitar', gtrs: 'guitars', kybd: 'keyboard', kbd: 'keyboard', vox: 'vocals', bre: 'big rock ending' };
const ROMAN = /^(ii|iii|iv|vi|vii|viii|ix)$/;

// A section name as charts write it ('verse_1a', '<b>SOLE</b> Chorus 1', 'Verse1',
// 'gtr solo') as a name to show ('Verse 1a', 'Sole Chorus 1', 'Verse 1', 'Guitar Solo').
// '' when it says nothing (empty, or Rock Band Network's 'ugc_section_3_1').
export function cleanName(raw) {
  let s = String(raw ?? '')
    .replace(/<[^>]*>/g, ' ')                       // Clone Hero's rich-text tags
    .replace(/[_\s]+/g, ' ')
    .trim();
  if (!s || /^ugc\b/i.test(s) || /^ugc[ _]?section/i.test(s)) return '';
  s = s.replace(/(\p{L}{3,})(\d)/gu, '$1 $2');      // 'Verse1' -> 'Verse 1'
  s = s.toLowerCase().split(' ').map((w) => WORDS[w] || w).join(' ');
  s = s.replace(/(^|[\s\-/([.,!?&+:"])(\p{L})/gu, (m, before, letter) => before + letter.toUpperCase());
  s = s.split(' ').map((w) => (ROMAN.test(w.toLowerCase()) ? w.toUpperCase() : w)).join(' ');
  if (s.length > RULES.nameMax) s = s.slice(0, RULES.nameMax - 1).trimEnd() + '…';
  return s;
}

// 'Chorus 2' -> 'chorus', 'Verse 1a' -> 'verse', 'Main Riff 3' -> 'main riff'.
export function stemOf(name) {
  const words = String(name || '').toLowerCase().replace(/…/g, '').replace(/\(\d+\)/g, ' ').split(/\s+/).filter(Boolean);
  const kept = words.filter((w) => !/^\d+[a-z]?$/.test(w));
  if (kept.length > 1 && /^[a-z]$/.test(kept[kept.length - 1])) kept.pop();    // 'Verse A'
  return kept.join(' ');
}

// ---- the grid of bars and beats -------------------------------------------

// Every beat of the chart in order: { t, bar (index of its bar), n (1 = the bar line) }.
function grid(chart) {
  const bars = [...(chart.bars || [])].sort((a, b) => a - b);
  const beats = [...(chart.beats || [])].sort((a, b) => a - b);
  const out = [];
  let k = 0;
  bars.forEach((t, bar) => {
    const next = bar + 1 < bars.length ? bars[bar + 1] : Infinity;
    out.push({ t, bar, n: 1 });
    let n = 2;
    while (k < beats.length && beats[k] < t) k++;             // a beat before the first bar belongs to no bar
    for (; k < beats.length && beats[k] < next; k++) out.push({ t: beats[k], bar, n: n++ });
  });
  return { bars, all: out };
}

// ---- shaping --------------------------------------------------------------

// The list without the numbers of a level: [{ from, to, raw, drums, kind, ... }].
function shape(chart, length) {
  const R = RULES;
  const times = (chart.notes || []).map((n) => n.t).sort((a, b) => a - b);
  if (!times.length) return [];
  const count = (a, b) => lowerBound(times, b) - lowerBound(times, a);
  const firstNote = times[0], lastNote = times[times.length - 1];
  const end = lastNote + R.tail;
  const { bars } = grid(chart);

  // the bar line a time belongs to: the last one at or before it (a hair after counts)
  const barAt = (t) => lowerBound(bars, t + R.near) - 1;
  // the first bar line at or after a time (a hair before counts)
  const barFrom = (t) => lowerBound(bars, t - R.near);
  // where the part that holds the note at `t` may start: its bar line, or the note itself when it comes before
  const lineBefore = (t) => {
    const i = barAt(t);
    return i < 0 ? t : Math.min(bars[i], t);
  };

  // 1. the chart's own sections, as stretches
  const marks = (chart.sections || [])
    .filter((s) => s && Number.isFinite(s.t))
    .map((s) => ({ t: s.t, raw: String(s.name ?? '') }))
    .sort((a, b) => a.t - b.t);
  let list = [];
  if (!marks.length || firstNote < marks[0].t) {
    list.push({ from: lineBefore(firstNote), to: marks.length ? marks[0].t : end, raw: '' });
  }
  marks.forEach((m, i) => {
    const next = i + 1 < marks.length ? marks[i + 1].t : Math.max(end, m.t);
    list.push({ from: m.t, to: next, raw: m.raw });
  });
  // the stretch with the last note ends 2 s after it when nothing follows
  const lastWith = list.findLastIndex((p) => count(p.from, p.to) > 0);
  if (lastWith === list.length - 1) list[lastWith].to = end;
  list = list.filter((p) => p.to > p.from);
  for (const p of list) p.drums = count(p.from, p.to);

  // 2. a long silent start or end of a section is a stretch of its own
  const split = [];
  for (const p of list) {
    if (!p.drums) { split.push({ ...p, named: true }); continue; }
    let { from, to } = p;
    const a = lowerBound(times, from), b = lowerBound(times, to);
    const start = lineBefore(times[a]);
    if (start - from >= R.restSeconds && barAt(start) - barFrom(from) >= R.restBars) {
      split.push({ from, to: start, raw: '', drums: 0 });
      from = start;
    }
    const lastIn = times[b - 1];
    const after = lowerBound(bars, lastIn + R.near);                  // the first bar line after the last note
    let rest = null;
    if (after < bars.length && bars[after] < to) {
      const stop = bars[after];
      if (to - stop >= R.restSeconds && barFrom(to) - after >= R.restBars) {
        rest = { from: stop, to, raw: '', drums: 0 };
        to = stop;
      }
    }
    split.push({ from, to, raw: p.raw, drums: p.drums });
    if (rest) split.push(rest);
  }
  list = split;

  // 3. a short part, or one with only a few notes, joins the part before it (else the one after)
  const short = (p) => p.drums > 0 && (p.to - p.from < R.shortSeconds || p.drums < R.shortNotes);
  const folded = [];
  for (const p of list) {
    const before = folded[folded.length - 1];
    if (short(p) && before && before.drums) {
      before.to = p.to;
      before.drums += p.drums;
    } else folded.push({ ...p });
  }
  for (let i = 0; i < folded.length - 1; i++) {
    const p = folded[i], next = folded[i + 1];
    if (short(p) && next.drums) {
      next.from = p.from;
      next.drums += p.drums;
      folded.splice(i, 1);
      i--;
    }
  }
  list = folded;

  // 4. too few parts to learn a song by: blocks of bars instead. Otherwise long parts are cut into pieces.
  const usable = list.filter((p) => p.drums).length;
  const cut = [];
  if (usable <= R.fewParts) {
    const start = Math.min(list[0].from, lineBefore(firstNote));
    const from = lineBefore(firstNote);
    if (from - start > 0) cut.push({ from: start, to: from, raw: '', drums: 0 });
    const lastTo = list[list.length - 1].to;
    for (const piece of pieces({ from, to: end }, true)) cut.push({ ...piece, block: true });
    if (lastTo > end) cut.push({ from: end, to: lastTo, raw: '', drums: 0 });
  } else {
    for (const p of list) {
      if (!p.drums || p.to - p.from <= R.longSeconds) { cut.push(p); continue; }
      const made = pieces(p, false);
      const playable = made.filter((x) => x.drums).length;
      if (playable < 2) { cut.push(p); continue; }
      let k = 0;
      for (const x of made) cut.push(x.drums ? { ...x, raw: p.raw, group: p, piece: ++k } : { ...x, raw: '' });
    }
  }
  list = cut;

  // Cut one stretch at bar lines into pieces of 8 bars. `always`: even when it is not long.
  function pieces(p, always) {
    const j = barFrom(p.from);                                        // the bar line the stretch starts on (or its first one)
    const z = lowerBound(bars, p.to - R.near);                        // bars[j..z-1] are inside
    if (z - j < 2) return [{ from: p.from, to: p.to, drums: count(p.from, p.to) }];
    const barLength = (Math.min(p.to, bars[z - 1] + (bars[z - 1] - bars[z - 2])) - bars[j]) / (z - j);
    let per = R.pieceBars;
    while (per * barLength < R.pieceMin && per < 64) per *= 2;
    while (per * barLength > R.pieceMax && per > 1) per /= 2;
    const edges = [p.from];
    for (let i = j + per; i < z; i += per) edges.push(bars[i]);
    // a last piece under half the bars joins the one before
    if (edges.length > 1 && z - lowerBound(bars, edges[edges.length - 1] - R.near) < per / 2) edges.pop();
    edges.push(p.to);
    if (edges.length < 3 && !always) return [{ from: p.from, to: p.to, drums: count(p.from, p.to) }];
    let out = [];
    for (let i = 0; i + 1 < edges.length; i++) out.push({ from: edges[i], to: edges[i + 1], drums: count(edges[i], edges[i + 1]) });
    // a piece with only a few notes joins the piece before it (else the one after)
    const few = (x) => x.drums > 0 && x.drums < R.shortNotes;
    const joined = [];
    for (const x of out) {
      const before = joined[joined.length - 1];
      if (few(x) && before && before.drums) { before.to = x.to; before.drums += x.drums; } else joined.push(x);
    }
    for (let i = 0; i < joined.length - 1; i++) {
      if (few(joined[i]) && joined[i + 1].drums) {
        joined[i + 1].from = joined[i].from;
        joined[i + 1].drums += joined[i].drums;
        joined.splice(i, 1);
        i--;
      }
    }
    return joined;
  }

  // 5. the song before its first part and after its last one
  if (list[0].from >= 1) list.unshift({ from: 0, to: list[0].from, raw: '', drums: 0 });
  const lastTo = list[list.length - 1].to;
  if (Number.isFinite(length) && length - lastTo >= 1) list.push({ from: lastTo, to: length, raw: '', drums: 0 });

  // 6. stretches without drums that touch are one stretch
  const merged = [];
  for (const p of list) {
    const before = merged[merged.length - 1];
    if (!p.drums && before && !before.drums) {
      before.to = p.to;
      if (!cleanName(before.raw)) before.raw = p.raw;
    } else merged.push({ ...p });
  }
  list = merged;

  // 7. names, numbers, ids
  const seen = new Map();                                             // name in lower case -> times used
  const given = new Map();                                            // a cut part -> the name its pieces share
  let n = 0, lastId = -Infinity;
  const barNumber = (t) => Math.max(1, barAt(t) + 1);
  return list.map((p) => {
    const id = Math.max(Math.round(p.from * 1000), lastId + 1);
    lastId = id;
    if (!p.drums) return { id, n: 0, name: cleanName(p.raw), stem: '', from: p.from, to: p.to, drums: 0 };
    n++;
    let name, stem = '';
    if (p.block) {
      const a = lowerBound(times, p.from), b = lowerBound(times, p.to);
      const first = barNumber(Math.max(p.from, bars.length ? bars[Math.min(barFrom(p.from), bars.length - 1)] : p.from));
      const last = Math.max(first, barNumber(times[b - 1]));
      name = bars.length ? `Bars ${Math.min(first, barNumber(times[a]))}-${last}` : `Part ${n}`;
    } else {
      const key = p.group || p;
      let base = given.get(key);
      if (base === undefined) {
        base = cleanName(p.raw);
        if (base) {
          stem = stemOf(base);
          const used = (seen.get(base.toLowerCase()) || 0) + 1;
          seen.set(base.toLowerCase(), used);
          if (used > 1) base += ` (${used})`;
        } else base = `Part ${n}`;
        given.set(key, base);
      }
      stem = cleanName(p.raw) ? stemOf(cleanName(p.raw)) : '';
      name = p.piece ? `${base} - ${p.piece}` : base;
    }
    return { id, n, name, stem, from: p.from, to: p.to, drums: p.drums };
  });
}

export function parts(parsed, { top, length } = {}) {
  const list = shape(top || parsed, length);
  const notes = [...(parsed.notes || [])].sort((a, b) => a.t - b.t);
  const times = notes.map((x) => x.t);
  return list.map((p) => {
    const a = lowerBound(times, p.from), b = lowerBound(times, p.to);
    const counts = {};
    for (let i = a; i < b; i++) counts[notes[i].pad] = (counts[notes[i].pad] || 0) + 1;
    const span = p.to - p.from;
    return {
      id: p.id, n: p.n, name: p.name, stem: p.stem, from: p.from, to: p.to, length: span,
      notes: b - a, counts, nps: span > 0 ? (b - a) / span : 0, empty: !p.drums || b === a,
    };
  });
}

// ---- the counted bar ------------------------------------------------------

export function countIn(parsed, at) {
  const R = RULES;
  const { bars, all } = grid(parsed);
  let marker = typeof at === 'number' ? at : at && Number.isFinite(at.from) ? at.from : null;
  if (marker === null) {
    const first = (parsed.notes || []).reduce((m, x) => Math.min(m, x.t), Infinity);
    marker = Number.isFinite(first) ? first : 0;
  }
  // the bar the part starts in: its beats, and how long one lasts there
  let K = 4, beat = 0.5, home = marker;                                 // nothing known: four beats at 120
  if (bars.length) {
    let j = lowerBound(bars, marker - R.near);                         // the first bar line at or after the marker
    if (j >= bars.length) j = bars.length - 1;
    home = bars[j];
    let b = j + 1 < bars.length ? j : j - 1;                           // the last bar line has no bar after it
    if (b < 0) b = 0;
    const inBar = all.filter((g) => g.bar === b).length || 4;
    const span = b + 1 < bars.length ? bars[b + 1] - bars[b] : inBar * 0.5;
    K = inBar;
    beat = span / inBar;
    if (home < marker - R.near) home += Math.ceil((marker - R.near - home) / (K * beat)) * K * beat;   // past the last bar line
  }
  // beats run back from the bar line at the tempo there; the count is the last ones before the marker
  let total = K;
  if (K * beat < R.countMin) total = K * 2;
  else if (K * beat > R.countMax) total = Math.ceil(K / 2);
  let back = 1;
  while (home - back * beat >= marker - R.near) back++;                // the first beat that is before the marker
  const clicks = [];
  for (let i = total - 1; i >= 0; i--) {
    const k = back + i;                                                // beats before the bar line
    const n = ((K - (k % K)) % K) + 1;
    clicks.push({ t: home - k * beat, n, accent: n === 1 });
  }
  return { from: clicks[0].t, to: marker, beat, clicks };
}
