// Makes the song audible when it runs on the site's own clock: the drum part
// as a guide and a click on every beat, at whatever tempo the clock runs and
// round and round a loop. Called once a frame; it schedules the sounds of the
// next moment on the audio clock, so a late frame can't make a late drum.

import { OwnClock } from './clock.js';

const AHEAD = 0.14;                    // seconds of sound scheduled ahead

// First index in a sorted list of numbers (or of things `at` turns into numbers) that is >= x.
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
    this.until = 0;                    // performance time up to which sound is already scheduled
    this.state = '';
    this.muted = new Set();            // drums the guide leaves out (the ones you are playing yourself)
    this.hold = false;                 // true while the clock is held still for you: nothing new is scheduled
    this.heard = [];                   // performance times of guide and click sounds, for telling them from your hits
  }

  // Forget what was scheduled: the song jumped, stopped or changed tempo.
  reset() {
    this.until = 0;
    this.heard = [];
    this.synth.flush();
  }

  run(clock, game, t) {
    const on = this.synth.running && clock instanceof OwnClock && clock.playing && game && !this.hold;
    // a seek, a pause, another tempo or loop: everything scheduled is wrong now
    const state = on ? `${clock.at}|${clock.rate}|${clock.loop?.from}|${clock.loop?.to}|${game.offset}` : '';
    if (state !== this.state) {
      if (this.state) this.reset();
      this.state = state;
    }
    if (!on) return;
    const from = Math.max(t, this.until);
    const to = t + AHEAD;
    if (to - from < 0.004) return;
    const off = game.offset;
    for (const s of clock.span(from, to)) {
      const when = (songTime) => s.at + (songTime - s.from) / clock.rate;
      if (this.synth.levels.guide) {
        for (let i = lowerBound(game.notes, s.from - off, (n) => n.t); i < game.notes.length; i++) {
          const n = game.notes[i];
          if (n.t + off >= s.to) break;
          if (this.muted.has(n.pad)) continue;
          const at = when(n.t + off);
          this.synth.hit(n.pad, at, { open: n.open });
          this.heard.push(at);
        }
      }
      if (this.synth.levels.click) {
        for (const [list, accent] of [[game.bars || [], true], [game.beats || [], false]]) {
          for (let i = lowerBound(list, s.from - off); i < list.length && list[i] + off < s.to; i++) {
            const at = when(list[i] + off);
            this.synth.click(at, accent);
            this.heard.push(at);
          }
        }
      }
    }
    this.until = to;
    if (this.heard.length > 400) this.heard = this.heard.filter((x) => x > t - 2);
  }

  // Whether a sound the mic heard at performance time t could be the site's
  // own guide or click coming out of the speakers, not your drum.
  mine(t, within = 0.07) {
    return this.heard.some((x) => t - x > -0.02 && t - x < within);
  }
}
