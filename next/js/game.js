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
    this.rate = 1;                                // the song's tempo (1 = its own): the hit windows are real time
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
    const late = pos - WINDOW * this.rate - this.offset;
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
      if (d > WINDOW * this.rate) break;
      if (d < -WINDOW * this.rate || n.state !== null || (sure && n.pad !== pad)) continue;
      best = n;
      break;
    }
    if (!best) return null;
    // a key hits one drum; a sound hits everything written at that moment
    const hitNotes = sure ? [best] : this.notes.filter((n) => n.group === best.group && n.state === null);
    const off = Math.abs(best.t + this.offset - pos) / this.rate;
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
