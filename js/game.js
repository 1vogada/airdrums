// The game itself: the notes of one song, judged against your hits.

export const WINDOW = 0.13;                       // seconds a hit may be off
const JUDGE = [
  { name: 'perfect', within: 0.045, points: 100 },
  { name: 'good', within: 0.085, points: 70 },
  { name: 'ok', within: WINDOW, points: 40 },
];
const CHORD = 0.02;                               // notes this close are hit together

export class Game {
  constructor(notes) {
    // notes: [{ t, pad }] sorted by t, in the chart's own time
    this.notes = notes.map((n) => ({ t: n.t, pad: n.pad, open: Boolean(n.open), state: null, group: 0 }));
    this.knowsOpen = this.notes.some((n) => n.open);   // the chart says when the hi-hat is open
    let g = -1, last = -Infinity;
    for (const n of this.notes) {
      if (n.t - last > CHORD) { g++; last = n.t; }
      n.group = g;
    }
    this.groupTimes = [];
    for (const n of this.notes) if (this.groupTimes[n.group] === undefined) this.groupTimes[n.group] = n.t;
    this.offset = 0;                              // seconds added to every note: chart vs what you hear
    this.reset(0);
  }

  // Start judging from `pos` (seconds into the song): what's before it doesn't count.
  reset(pos) {
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.counts = { perfect: 0, good: 0, ok: 0, wrong: 0, miss: 0 };
    this.cursor = 0;
    this.lastPos = pos;
    this.events = [];                             // { at, name, pads } for the screen to pop up
    for (const n of this.notes) n.state = n.t + this.offset < pos ? 'skip' : null;
  }

  get judged() {
    const c = this.counts;
    return c.perfect + c.good + c.ok + c.wrong + c.miss;
  }

  get accuracy() {
    return this.judged ? this.score / (this.judged * 100) : 1;
  }

  // Once a frame: notes that went by unhit are misses; a jump in the song
  // (seek, restart, another answer from Spotify) starts the judging over.
  update(pos, at) {
    if (Math.abs(pos - this.lastPos) > 1.5) this.reset(pos);
    this.lastPos = pos;
    const late = pos - WINDOW - this.offset;
    while (this.cursor < this.notes.length && this.notes[this.cursor].t < late) {
      const n = this.notes[this.cursor++];
      if (n.state !== null) continue;
      n.state = 'miss';
      this.counts.miss++;
      this.combo = 0;
      this.events.push({ at, name: 'miss', pads: [n.pad] });
    }
  }

  // A hit at `pos` seconds into the song. `pad` is the drum if known (a key
  // press knows it exactly; the mic's guess is only used when `sure` is false
  // to tell a right drum from a wrong one). Returns the judgement or null.
  hit(pos, at, pad = null, sure = false) {
    // the oldest note still waiting that this hit is close enough to (not the
    // nearest: in a fast run a slightly late hit is nearer to the next note)
    let best = null;
    for (let i = this.cursor; i < this.notes.length; i++) {
      const n = this.notes[i];
      const d = n.t + this.offset - pos;
      if (d > WINDOW) break;
      if (d < -WINDOW || n.state !== null || (sure && n.pad !== pad)) continue;
      best = n;
      break;
    }
    if (!best) return null;
    // a key hits one drum; a sound hits everything written at that moment
    const hitNotes = sure ? [best] : this.notes.filter((n) => n.group === best.group && n.state === null);
    const off = Math.abs(best.t + this.offset - pos);
    let j = JUDGE.find((x) => off <= x.within);
    if (!sure && pad && !hitNotes.some((n) => n.pad === pad)) j = { name: 'wrong', points: 20 };
    for (const n of hitNotes) {
      n.state = j.name;
      n.hitAt = at;
      this.counts[j.name]++;
      this.score += j.points;
    }
    this.combo += hitNotes.length;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.events.push({ at, name: j.name, pads: hitNotes.map((n) => n.pad), early: best.t + this.offset - pos });
    return j.name;
  }
}

// Work out how far the chart is from what the microphone hears. `heard` is
// the song position of each sound the mic picked up while the song played
// (its drums included); the chart says where the drums are. The shift that
// puts the most sounds on a note is the answer: seconds to add to the chart,
// or null when nothing stands out. `around` is the best guess so far.
export function listenShift(groupTimes, heard, around = 0, reach = 1.5) {
  if (heard.length < 16 || groupTimes.length < 16) return null;
  const STEP = 0.004, NEAR = 0.022;
  const near = (x) => {
    let lo = 0, hi = groupTimes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (groupTimes[mid] < x) lo = mid + 1; else hi = mid;
    }
    const a = Math.abs(groupTimes[lo] - x);
    const b = lo > 0 ? Math.abs(groupTimes[lo - 1] - x) : Infinity;
    return a < b ? groupTimes[lo] - x : groupTimes[lo - 1] - x;
  };
  const scores = [];
  for (let d = around - reach; d <= around + reach; d += STEP) {
    let n = 0;
    for (const h of heard) if (Math.abs(near(h - d)) <= NEAR) n++;
    scores.push({ d, n });
  }
  const top = Math.max(...scores.map((s) => s.n));
  const sorted = scores.map((s) => s.n).sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  if (top < 12 || top < heard.length * 0.35 || top < median * 1.5) return null;
  // of the shifts that fit about as well, the one nearest the guess (a drum
  // pattern repeats, so a whole beat away fits nearly as well)
  const good = scores.filter((s) => s.n >= top * 0.93);
  good.sort((a, b) => Math.abs(a.d - around) - Math.abs(b.d - around));
  const d = good[0].d;
  let sum = 0, n = 0;
  for (const h of heard) {
    const off = near(h - d);
    if (Math.abs(off) <= NEAR) { sum += off; n++; }
  }
  return d - (n ? sum / n : 0);
}
