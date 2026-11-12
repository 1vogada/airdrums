// Turns a Clone Hero drum chart (notes.chart or notes.mid) into a flat list of
// timed hits on the Air Drums kit: [{ t: seconds, pad: 'snare' | ... }].

export const DIFFICULTIES = ['expert', 'hard', 'medium', 'easy'];

// Chart lanes: 0 kick, 1 red, 2 yellow, 3 blue, 4 green (4-lane) / orange (5-lane), 5 green (5-lane)
function laneToPad(lane, cymbal, drumType) {
  if (lane === 0) return 'kick';
  if (lane === 1) return 'snare';
  if (drumType === 2) {                       // five lane: red, yellow cym, blue tom, orange cym, green tom
    return { 2: 'hihat', 3: 'tom', 4: 'crash', 5: 'floor' }[lane];
  }
  if (drumType === 1) {                       // four lane with cymbals marked
    if (lane === 2) return cymbal ? 'hihat' : 'tom';
    if (lane === 3) return cymbal ? 'ride' : 'tom';
    if (lane === 4) return cymbal ? 'crash' : 'floor';
  }
  // four lane, nothing says cymbal or tom: the usual reading
  return { 2: 'hihat', 3: 'tom', 4: 'crash' }[lane];
}

// ---- tempo map ------------------------------------------------------------

function tempoClock(resolution, tempos) {
  // tempos: [{ tick, usPerBeat }] sorted; returns tick -> seconds
  const t = tempos.length && tempos[0].tick === 0 ? tempos : [{ tick: 0, usPerBeat: 500000 }, ...tempos];
  const marks = [];
  let sec = 0;
  for (let i = 0; i < t.length; i++) {
    if (i > 0) sec += ((t[i].tick - t[i - 1].tick) / resolution) * (t[i - 1].usPerBeat / 1e6);
    marks.push({ tick: t[i].tick, sec, usPerBeat: t[i].usPerBeat });
  }
  return (tick) => {
    let lo = 0, hi = marks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (marks[mid].tick <= tick) lo = mid; else hi = mid - 1;
    }
    const m = marks[lo];
    return m.sec + ((tick - m.tick) / resolution) * (m.usPerBeat / 1e6);
  };
}

// Where each sung line starts: the first syllable at or after each phrase marker.
function phraseStarts(marks, sung) {
  marks.sort((a, b) => a - b);
  sung.sort((a, b) => a - b);
  const out = [];
  marks.forEach((m, i) => {
    const first = sung.find((t) => t >= m);
    if (first !== undefined && (i + 1 >= marks.length || first < marks[i + 1])) out.push(first);
  });
  return out;
}

// When each bar and each other beat starts, in seconds, from the time signatures.
function measures(resolution, sigs, lastTick, clock) {
  const s = [...sigs].sort((a, b) => a.tick - b.tick);
  if (!s.length || s[0].tick > 0) s.unshift({ tick: 0, num: 4, den: 4 });
  const bars = [], beats = [];
  for (let i = 0; i < s.length; i++) {
    const end = i + 1 < s.length ? s[i + 1].tick : lastTick + resolution * 4;
    const beat = (resolution * 4) / (s[i].den || 4);
    for (let tick = s[i].tick, n = 0; tick < end; tick += beat, n++) {
      (n % (s[i].num || 4) === 0 ? bars : beats).push(clock(tick));
      if (bars.length + beats.length > 20000) return { bars, beats };
    }
  }
  return { bars, beats };
}

// "verse_1a" or "gtr solo" as the chart writes it -> "Verse 1a", "Gtr Solo".
// Quotes and brackets around or inside a name are not part of it:
// `section "XIV 2.0"` -> "XIV 2.0", `section [Verse 1]` -> "Verse 1".
// (js/parts.js does the rest of the cleaning: tags, short forms, capitals.)
export function sectionName(raw) {
  const words = raw.replace(/"/g, '').replace(/[\[\]]/g, ' ').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().split(' ');
  return words.map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}

// The song's parts in order, in seconds: [{ t, name }]. One per place.
function sectionList(marks, clock) {
  const out = [];
  for (const m of [...marks].sort((a, b) => a.tick - b.tick)) {
    if (/^\s*_endofsong/i.test(m.name)) continue;   // "[section _ENDOFSONG]": Guitar Hero's end-of-song marker, not a part
    const name = sectionName(m.name);
    if (!name) continue;
    if (out.length && out[out.length - 1].tick === m.tick) out[out.length - 1].name = name;
    else out.push({ tick: m.tick, name });
  }
  return out.map((s) => ({ t: clock(s.tick), name: s.name }));
}

function finish(hits, phrases, clock, drumType, extra) {
  const seen = new Set();
  const notes = [];
  for (const h of hits) {
    const pad = h.pad || laneToPad(h.lane, h.cymbal, drumType);
    if (!pad) continue;
    const key = h.tick + pad;
    if (seen.has(key)) continue;              // two chart lanes landing on one pad
    seen.add(key);
    const note = { t: clock(h.tick), pad };
    if (h.open && pad === 'hihat') note.open = true;
    notes.push(note);
  }
  notes.sort((a, b) => a.t - b.t);
  return { notes, phrases: phrases.map(clock).sort((a, b) => a - b), ...extra };
}

// ---- .chart ---------------------------------------------------------------

const CHART_SECTION = { expert: 'ExpertDrums', hard: 'HardDrums', medium: 'MediumDrums', easy: 'EasyDrums' };

export function parseChartText(text, wanted = 'expert') {
  const sections = {};
  let name = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('[')) { name = line.slice(1, line.indexOf(']')); sections[name] = []; continue; }
    if (line === '{' || line === '}' || !name) continue;
    sections[name].push(line);
  }
  const song = {};
  for (const l of sections.Song || []) {
    const i = l.indexOf('=');
    if (i > 0) song[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^"|"$/g, '');
  }
  const resolution = Number(song.Resolution) || 192;
  const tempos = [], sigs = [];
  for (const l of sections.SyncTrack || []) {
    const m = /^(\d+)\s*=\s*B\s+(\d+)/.exec(l);
    if (m && Number(m[2]) > 0) tempos.push({ tick: Number(m[1]), usPerBeat: 6e10 / Number(m[2]) });
    const ts = /^(\d+)\s*=\s*TS\s+(\d+)(?:\s+(\d+))?/.exec(l);
    if (ts && Number(ts[2]) > 0) sigs.push({ tick: Number(ts[1]), num: Number(ts[2]), den: 2 ** Number(ts[3] ?? 2) });
  }
  tempos.sort((a, b) => a.tick - b.tick);
  const marks = [], sung = [], parts = [];
  for (const l of sections.Events || []) {
    // the name runs to the LAST quote of the line: it can hold quotes and brackets itself
    // (`E "section "XIV 2.0""`, `E "section Polaris", by H.P. Lovecraft (1)"`, `E "section [Verse 1]"`)
    const part = /^(\d+)\s*=\s*E\s+"\[?(?:section[ _]|prc_)(.*)"/.exec(l);
    if (part) { parts.push({ tick: Number(part[1]), name: part[2] }); continue; }
    const m = /^(\d+)\s*=\s*E\s+"(phrase_start|lyric )/.exec(l);
    if (m) (m[2] === 'phrase_start' ? marks : sung).push(Number(m[1]));
  }
  const phrases = phraseStarts(marks, sung);
  const available = DIFFICULTIES.filter((d) => (sections[CHART_SECTION[d]] || []).some((l) => /=\s*N\s/.test(l)));
  const difficulty = available.includes(wanted) ? wanted : available[0];
  const hits = [];
  let drumType = 0;
  if (difficulty) {
    const byTick = new Map();
    for (const l of sections[CHART_SECTION[difficulty]]) {
      const m = /^(\d+)\s*=\s*N\s+(\d+)/.exec(l);
      if (!m) continue;
      const tick = Number(m[1]), n = Number(m[2]);
      if (!byTick.has(tick)) byTick.set(tick, { lanes: new Set(), cym: new Set() });
      const at = byTick.get(tick);
      if (n <= 5) at.lanes.add(n);
      else if (n === 32) at.lanes.add(0);                 // double kick: still a kick
      else if (n >= 66 && n <= 68) { at.cym.add(n - 64); drumType = Math.max(drumType, 1); }
      if (n === 5) drumType = 2;
    }
    for (const [tick, at] of byTick) {
      for (const lane of at.lanes) hits.push({ tick, lane, cymbal: at.cym.has(lane) });
    }
  }
  const clock = tempoClock(resolution, tempos);
  return finish(hits, phrases, clock, drumType, {
    difficulty, available, drumType, offset: Number(song.Offset) || 0, format: 'chart',
    sections: sectionList(parts, clock),
    ...measures(resolution, sigs, hits.reduce((m, h) => Math.max(m, h.tick), 0), clock),
  });
}

// ---- .mid -----------------------------------------------------------------

const MIDI_BASE = { expert: 96, hard: 84, medium: 72, easy: 60 };

// Rock Band charts carry a second set of notes that drive the on-screen
// drummer: what is really hit on a real kit, hand by hand. The game lanes are
// a simplification (an open hi-hat is often written on the "ride" lane, a
// floor tom groove on the "hi-hat" lane); these say which drum it really is.
const REAL = {
  24: 'kick',
  26: 'snare', 27: 'snare', 28: 'snare', 29: 'snare',
  30: 'hihat', 31: 'hihat',
  34: 'crash', 35: 'crash', 36: 'crash', 37: 'crash', 38: 'crash', 39: 'crash',
  40: 'crash', 41: 'crash', 44: 'crash', 45: 'crash',
  42: 'ride', 43: 'ride',
  46: 'tom', 47: 'tom', 48: 'tom', 49: 'tom',
  50: 'floor', 51: 'floor',
};
const HAT_OPEN = 25;                                  // held while the hi-hat is open
const HAND_ORDER = ['snare', 'hihat', 'tom', 'ride', 'floor', 'crash'];   // red, then yellow-ish to green-ish
const CYMBALS = ['hihat', 'ride', 'crash'];
const TOMS = ['tom', 'floor'];

// The real-kit notes of a drum track: tick -> pads, and when the hi-hat is open.
function realKit(drums, division) {
  const ticks = [], pads = [];
  for (const e of drums.on) {
    const pad = REAL[e.note];
    if (!pad) continue;
    if (ticks.length && ticks[ticks.length - 1] === e.tick) pads[pads.length - 1].add(pad);
    else { ticks.push(e.tick); pads.push(new Set([pad])); }
  }
  const open = [];
  const offs = drums.off.filter((e) => e.note === HAT_OPEN).map((e) => e.tick);
  for (const e of drums.on) if (e.note === HAT_OPEN) open.push([e.tick, offs.find((o) => o > e.tick) ?? e.tick + division / 4]);
  const NEAR = Math.max(1, Math.round(division / 16));        // the two sets aren't always on the same tick
  const at = (tick) => {
    let lo = 0, hi = ticks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ticks[mid] < tick - NEAR) lo = mid + 1; else hi = mid;
    }
    const out = new Set();
    for (; lo < ticks.length && ticks[lo] <= tick + NEAR; lo++) for (const p of pads[lo]) out.add(p);
    return out;
  };
  return { count: ticks.length, at, isOpen: (tick) => open.some(([a, z]) => tick >= a && tick < z) };
}

// Give the hits written at one moment their real drums. `hits` are the hand
// ones (red, yellow, blue, green: lanes 1..4) at one tick, `real` the pads
// the real-kit notes have there. Each hit first looks for a real drum of its
// own kind (red: snare; a cymbal lane: a cymbal; a tom lane: a tom), then
// takes what's left. So a fast hi-hat run written on the red lane to make it
// playable in the game comes out as the hi-hat it is.
function assignReal(hits, real, split) {
  const pads = HAND_ORDER.filter((p) => real.has(p));
  if (!pads.length) return;
  hits.sort((a, b) => a.lane - b.lane);
  const used = new Set();
  const give = (h, order) => {
    const pad = order.find((p) => real.has(p) && !used.has(p));
    if (pad) { h.pad = pad; used.add(pad); }
    return Boolean(pad);
  };
  const rest = [];
  for (const h of hits) {
    const own = h.lane === 1 ? ['snare'] : !split ? [] : h.cymbal ? CYMBALS : TOMS;
    if (!give(h, own)) rest.push(h);
  }
  // nothing of its own kind was hit: it's one of the drums that were (two
  // lanes on one real drum come out as a single hit)
  for (const h of rest) if (!give(h, HAND_ORDER)) h.pad = pads[pads.length - 1];
}

function readMidi(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'MThd') throw new Error('not a midi file');
  const division = dv.getUint16(12);
  if (division & 0x8000) throw new Error('timecode midi files are not supported');
  const tracks = [];
  let p = 8 + dv.getUint32(4);
  while (p + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.subarray(p, p + 4));
    const len = dv.getUint32(p + 4);
    const end = Math.min(p + 8 + len, bytes.length);
    if (id === 'MTrk') tracks.push(readTrack(bytes, p + 8, end));
    p = end;
  }
  return { division, tracks };
}

// Text in a .mid: UTF-8 where it is valid UTF-8, else Latin-1 (charts have both).
function readText(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return new TextDecoder('latin1').decode(bytes); }
}

function readTrack(b, p, end) {
  const track = { name: '', tempos: [], sigs: [], on: [], off: [], lyrics: [], texts: [] };
  let tick = 0, status = 0;
  const vlq = () => { let v = 0, c; do { c = b[p++]; v = (v << 7) | (c & 0x7f); } while (c & 0x80 && p < end); return v; };
  while (p < end) {
    tick += vlq();
    let s = b[p];
    if (s & 0x80) { p++; if (s < 0xf0) status = s; } else s = status;      // running status
    if (s === 0xff) {
      const type = b[p++], len = vlq();
      if (type === 0x03 && !track.name) track.name = new TextDecoder('latin1').decode(b.subarray(p, p + len));
      else if ((type === 0x05 || type === 0x01) && len) {
        if (b[p] !== 0x5b) track.lyrics.push(tick);                          // not "[section]" text
        // kept as text too: some charts write a part marker as a lyric event, or without its "["
        track.texts.push({ tick, type, text: readText(b.subarray(p, p + len)) });
      }
      else if (type === 0x51 && len === 3) track.tempos.push({ tick, usPerBeat: (b[p] << 16) | (b[p + 1] << 8) | b[p + 2] });
      else if (type === 0x58 && len >= 2 && b[p]) track.sigs.push({ tick, num: b[p], den: 2 ** b[p + 1] });
      p += len;
    } else if (s === 0xf0 || s === 0xf7) {
      p += vlq();
    } else {
      const kind = s & 0xf0;
      if (kind === 0xc0 || kind === 0xd0) { p += 1; continue; }
      const note = b[p], vel = b[p + 1];
      p += 2;
      if (kind === 0x90 && vel > 0) track.on.push({ tick, note });
      else if (kind === 0x80 || kind === 0x90) track.off.push({ tick, note });
    }
  }
  return track;
}

export function parseMidi(bytes, wanted = 'expert', drumTypeHint = null) {
  const { division, tracks } = readMidi(bytes);
  const tempos = tracks.flatMap((t) => t.tempos).sort((a, b) => a.tick - b.tick);
  const drums = tracks.find((t) => /^PART DRUMS?$/i.test(t.name.trim()))
    || tracks.find((t) => /drum/i.test(t.name));
  const vocals = tracks.find((t) => /^PART VOCALS$/i.test(t.name.trim()));
  const phrases = vocals
    ? phraseStarts([...new Set(vocals.on.filter((e) => e.note === 105 || e.note === 106).map((e) => e.tick))], vocals.lyrics)
    : [];
  const hits = [];
  let available = [], difficulty, drumType = 0, real = false;
  if (drums) {
    available = DIFFICULTIES.filter((d) => drums.on.some((e) => e.note >= MIDI_BASE[d] && e.note <= MIDI_BASE[d] + 5));
    difficulty = available.includes(wanted) ? wanted : available[0];
    // tom markers 110..112 turn yellow / blue / green from cymbal into tom while held
    const tomSpans = { 2: [], 3: [], 4: [] };
    for (const lane of [2, 3, 4]) {
      const n = 108 + lane;
      const ons = drums.on.filter((e) => e.note === n).map((e) => e.tick);
      const offs = drums.off.filter((e) => e.note === n).map((e) => e.tick);
      for (const start of ons) tomSpans[lane].push([start, offs.find((o) => o >= start) ?? Infinity]);
    }
    const hasToms = Object.values(tomSpans).some((s) => s.length);
    const five = difficulty && drums.on.some((e) => e.note === MIDI_BASE[difficulty] + 5);
    drumType = five ? 2 : (hasToms || drumTypeHint === 1) ? 1 : (drumTypeHint ?? 0);
    if (difficulty) {
      const base = MIDI_BASE[difficulty];
      for (const e of drums.on) {
        let lane = e.note - base;
        if (e.note === base - 1) lane = 0;                 // double kick
        if (lane < 0 || lane > 5) continue;
        const isTom = lane >= 2 && lane <= 4 && tomSpans[lane].some(([a, z]) => e.tick >= a && e.tick < Math.max(z, a + 1));
        hits.push({ tick: e.tick, lane, cymbal: !isTom });
      }
      // where the chart also says what's hit on a real kit, go by that
      const kit = realKit(drums, division);
      const moments = new Map();
      for (const h of hits) {
        if (!moments.has(h.tick)) moments.set(h.tick, []);
        moments.get(h.tick).push(h);
      }
      let covered = 0;
      for (const tick of moments.keys()) if (kit.at(tick).size) covered++;
      if (kit.count && covered >= moments.size * 0.6) {
        real = true;
        for (const [tick, group] of moments) {
          assignReal(group.filter((h) => h.lane >= 1 && h.lane <= 4), kit.at(tick), drumType === 1);
          if (kit.isOpen(tick)) for (const h of group) h.open = true;
        }
      }
    }
  }
  const clock = tempoClock(division, tempos);
  // Part markers: "[section verse_1]" or "[prc_verse_1]" in the EVENTS track. Real charts also
  // have them with a bracket missing ("prc_chorus_3b]", "[section Verse 3A"), with a space in
  // front, as a lyric event, and with "section" misspelt ("secton", "secrion", "sectiom").
  const events = tracks.filter((x) => /^EVENTS$/i.test(x.name.trim()));
  const parts = [];
  for (const t of events) {
    for (const e of t.texts) {
      const m = /^\[?(?:sec[a-z]?i?o[nm][ _]|prc_)([^\]]+)/.exec(e.text.trim());
      if (m) parts.push({ tick: e.tick, name: m[1] });
    }
  }
  // A chart with no marker at all may name its parts bare: text events "Intro", "Verse 1"...
  // Taken only when there are at least two and none is one of the words charts put there for
  // other reasons.
  if (!parts.length) {
    const bare = events.flatMap((t) => t.texts).filter((e) => e.type === 0x01 && /^\p{L}[^\[\]]{0,39}$/u.test(e.text.trim())
      && !/^(events|default|idle|play|end|coda|section|solo|soloend|lyric\b.*|phrase_.*|music_.*|crowd_.*)$/i.test(e.text.trim()));
    if (bare.length >= 2) for (const e of bare) parts.push({ tick: e.tick, name: e.text.trim() });
  }
  return finish(hits, phrases, clock, drumType, {
    difficulty, available, drumType, offset: 0, format: 'mid', real,
    sections: sectionList(parts, clock),
    ...measures(division, tracks.flatMap((t) => t.sigs), hits.reduce((m, h) => Math.max(m, h.tick), 0), clock),
  });
}

export function parseNotesFile(name, bytes, wanted, drumTypeHint) {
  if (name.toLowerCase().endsWith('.mid')) return parseMidi(bytes, wanted, drumTypeHint);
  const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe;
  const text = new TextDecoder(utf16 ? 'utf-16le' : 'utf-8').decode(bytes).replace(/^﻿/, '');
  return parseChartText(text, wanted);
}
