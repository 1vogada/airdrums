// Makes the song audible when it runs on the site's own clock: the drum part
// as a guide and a click on every beat, at whatever tempo the clock runs and
// round and round a loop. Called once a frame; it schedules the sounds of the
// next moment on the audio clock, so a late frame can't make a late drum.
//
//   player.run(clock, tune, t)
//   tune = {
//     notes, offset, bars, beats,      // what to play, in the chart's time (+ offset = song time)
//     guide: (note) => 0..1,           // how loud that drum is in the guide; 0 leaves it out
//     click: (songTime) => true/false, // whether the click sounds at that place
//   }
//
// Sound has to be handed to the speakers a little ahead, so a pass is started
// `player.lead` seconds before its first sound: clock.cue(place, player.lead).

import { OwnClock } from './clock.js';

const AHEAD = 0.14;                    // seconds of sound scheduled ahead
const LATE = 0.05;                     // a sound this late is dropped, not bunched up with the next ones

// First index in a sorted list whose time is >= x.
function lowerBound(list, x, at = (v) => v) {
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (at(list[mid]) < x) lo = mid + 1; else hi = mid;
  }
  return lo;
}

export class Player {
  constructor(synth) {
    this.synth = synth;
    this.lead = 0.2;
    this.until = 0;                    // performance time up to which sound is already scheduled
    this.moved = -1;                   // the clock's change count the schedule belongs to
    this.count = 0;                    // sounds scheduled so far (for tests)
  }

  // Forget what was scheduled: the song jumped, stopped or changed tempo.
  reset() {
    this.until = 0;
    this.synth.flush();
  }

  run(clock, tune, t) {
    const on = this.synth.running && clock instanceof OwnClock && clock.playing && tune;
    const moved = on ? clock.moved : -1;
    if (moved !== this.moved) {                              // a seek, a pause, another tempo or loop
      if (this.moved !== -1) this.reset();
      this.until = 0;
      this.moved = moved;
    }
    if (!on) return;
    let from = this.until || Math.max(clock.at, t - 0.1);
    if (from < t - LATE) from = t - 0.02;                    // the page stalled: what is past stays unplayed
    const to = t + AHEAD;
    if (to - from < 0.004) return;
    const off = tune.offset || 0;
    for (const s of clock.span(from, to)) {
      const when = (songTime) => s.at + (songTime - s.from) / clock.rate;
      if (this.synth.levels.guide) {
        for (let i = lowerBound(tune.notes, s.from - off, (n) => n.t); i < tune.notes.length; i++) {
          const n = tune.notes[i];
          if (n.t + off >= s.to) break;
          const gain = tune.guide ? tune.guide(n) : 1;
          if (!gain) continue;
          this.synth.hit(n.pad, when(n.t + off), { open: n.open, gain });
          this.count++;
        }
      }
      if (this.synth.levels.click) {
        for (const [list, accent] of [[tune.bars || [], true], [tune.beats || [], false]]) {
          for (let i = lowerBound(list, s.from - off); i < list.length && list[i] + off < s.to; i++) {
            if (tune.click && !tune.click(list[i] + off)) continue;
            this.synth.click(when(list[i] + off), accent);
            this.count++;
          }
        }
      }
    }
    this.until = to;
  }
}
