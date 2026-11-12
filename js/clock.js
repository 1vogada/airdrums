// The site's own clock, for a song that isn't following Spotify. Unlike
// Spotify's it belongs to the site, so it can run slower than the song, loop a
// stretch of it and start before 0:00: that is what learning a song needs.
//
// Times are seconds. `t` is performance time (performance.now() / 1000), a
// place is seconds into the song (the chart's own time).
//
// ---------------------------------------------------------------------------
// WHAT THE SESSION CALLS
//
//   const clock = new OwnClock(song)
//   clock.kind                       'own'
//   clock.can                        { rate: true, loop: true, seek: true, sound: true }
//   clock.playing, clock.rate        read only: change them through the calls below
//   clock.loop                       { from, to } in song seconds, or null
//   clock.at                         performance time of the last change (tests/ear_e2e.mjs reads it)
//
// Reading (every frame, every hit):
//   clock.position(t)                where the song is at time t; in a loop it comes round, so it is
//                                    always under loop.to
//   clock.lap(t)                     how many times the loop has come round (see THE COUNT OF PASSES)
//   clock.lapStart(t)                the performance time at which the lap running at t began
//   clock.span(t0, t1)               the stretches of song played between two moments (see span)
//
// Changing:
//   clock.play() / pause() / toggle() / stop()     stop() is pause()
//   clock.setRate(0.5 ... 1)         tempo; the place stays (RATES lists the steps the dock offers)
//   clock.seekTo(place)              jump; never below the smaller of 0:00 and the loop's start
//   clock.set(place, playing)        put the song somewhere and say whether it runs (the demo uses it)
//   clock.setLoop(from, to)          repeat that stretch; `from` may be below 0 (a counted bar before
//                                    0:00). Returns false when it is no loop (not over 0.2 s long).
//                                    The place stays when it is inside the stretch, else it goes to `from`.
//   clock.clearLoop()
//   clock.cue(place, lead)           START OF A PASS: puts the song `lead` seconds of REAL time before
//                                    `place`, with no lower limit. Sound has to be handed to the
//                                    speakers a little ahead, so a sound that lies exactly where the
//                                    song is put can never be on time. Start every pass like this:
//                                        clock.setLoop(from, to);
//                                        clock.cue(from, player.lead);     // js/sound.js says how long
//                                        clock.play();
//                                    Later passes need nothing: the loop comes round by itself.
//
// Calls that change nothing do nothing: play() while playing, pause() while paused,
// setRate() with the tempo it has, setLoop() with the loop it has, clearLoop()
// without a loop. They leave `at`, the count of passes and the sound alone.
//
// THE COUNT OF PASSES
//   lap(t) is 0 until the loop's end is reached for the first time, then 1, 2, 3...
//   Starting, stopping and changing the tempo keep the count. It goes back to 0
//   only when the song is put somewhere: seekTo, set, cue, clearLoop, and setLoop
//   with another loop. Each of those also adds 1 to clock.epoch, so:
//
//       // once a frame, before game.update
//       const lap = clock.lap(t);
//       if (clock.epoch !== seenEpoch) { seenEpoch = clock.epoch; seenLap = lap; }   // put somewhere: no wrap
//       else if (lap > seenLap) { wrap(); seenLap = lap; }                           // the loop came round
//
//   A hit with an old time stamp (the microphone's) belongs to the pass before
//   when its stamp is earlier than clock.lapStart(t): drop it.
//   Never show lap() as the pass number: keep that in the session.
//
// WHAT TO KNOW
//   - position(t) and lap(t) for a moment before the last change (`at`) are
//     counted back at today's tempo from today's place. Right after a pause, a
//     resume or a tempo change they are not where the song really was.
//   - clock.moved goes up by 1 on every change of place, tempo, loop or
//     playing; clock.epoch only when the song is put somewhere.
//   - A note written exactly at loop.to is never reached; one at loop.from is
//     reached once every lap.
// ---------------------------------------------------------------------------

const now = () => performance.now() / 1000;

export const RATES = [0.5, 0.6, 0.7, 0.8, 0.9, 1];

const SHORTEST = 0.2;                  // seconds: a loop has to be longer than this
const MOST_LAPS = 10000;               // span() gives up counting laps beyond this (a page that slept for hours)

export class OwnClock {
  constructor(song) {
    this.song = song;
    this.kind = 'own';
    this.can = { rate: true, loop: true, seek: true, sound: true };
    this.playing = false;
    this.rate = 1;                     // 1 is the song's own tempo, 0.5 half of it
    this.loop = null;                  // { from, to } in song seconds: the stretch that repeats
    this.progress = 0;                 // where the song was at `at`, as if nothing looped
    this.at = now();
    this.since = this.at;              // when the song was last put somewhere
    this.epoch = 0;                    // + 1 each time the song is put somewhere: the count of passes starts over
    this.moved = 0;                    // + 1 on every change at all: what was scheduled before is wrong now
  }

  // Seconds into the song as if nothing looped. It only ever grows while the
  // song plays, through pauses and tempo changes, until the song is put somewhere.
  raw(t = now()) {
    return this.playing ? this.progress + (t - this.at) * this.rate : this.progress;
  }

  // The performance time at which the song reaches that raw place, playing as it does now.
  timeOf(raw) {
    return this.at + (raw - this.progress) / this.rate;
  }

  // A raw place as the place in the song and the number of times the loop came
  // round to get there. Both come from one division, so they always agree.
  where(raw) {
    const l = this.loop;
    if (!l || raw < l.to) return { pos: raw, turns: 0 };
    const len = l.to - l.from;
    const d = raw - l.from;
    const rest = d % len;
    let turns = Math.round((d - rest) / len);
    let pos = l.from + rest;
    if (pos >= l.to) { pos = l.from; turns++; }      // rounding put it on the end: that is the next start
    return { pos, turns };
  }

  fold(raw) { return this.where(raw).pos; }

  // Seconds into the song at time t.
  position(t = now()) { return this.where(this.raw(t)).pos; }

  // How many times the loop has come round since the song was last put somewhere.
  lap(t = now()) { return this.where(this.raw(t)).turns; }

  // When the lap running at time t began: the moment the loop last came round,
  // or in the first lap the moment the song was put there.
  lapStart(t = now()) {
    const { turns } = this.where(this.raw(t));
    const l = this.loop;
    return turns && l ? this.timeOf(l.from + turns * (l.to - l.from)) : this.since;
  }

  // Put the song somewhere (a raw place folded into the loop). The count of passes starts over.
  put(place, playing, t = now()) {
    this.progress = this.fold(place);
    this.playing = Boolean(playing);
    this.at = t;
    this.since = t;
    this.epoch++;
    this.moved++;
  }

  // The same place and the same count of passes, on a new footing.
  keep(playing, rate = this.rate) {
    const t = now();                                 // the timer is read once: the place cannot slip
    this.progress = this.raw(t);
    this.at = t;
    this.playing = playing;
    this.rate = rate;
    this.moved++;
  }

  set(progress, playing) { if (Number.isFinite(progress)) this.put(progress, playing); }

  toggle() { this.keep(!this.playing); }
  play() { if (!this.playing) this.keep(true); }
  pause() { if (this.playing) this.keep(false); }
  stop() { this.pause(); }

  // A jump. The song cannot be put before 0:00, or before the start of the loop when that is earlier.
  seekTo(seconds) {
    if (!Number.isFinite(seconds)) return;
    const lowest = Math.min(0, this.loop ? this.loop.from : 0);
    this.put(Math.max(lowest, seconds), this.playing);
  }

  // The start of a pass: `lead` seconds of real time before `place`, with no lower limit.
  cue(place, lead = 0) {
    if (!Number.isFinite(place)) return;
    this.put(place - Math.max(0, lead || 0) * this.rate, this.playing);
  }

  setRate(rate) {
    if (!Number.isFinite(rate)) return;
    const next = Math.max(0.25, Math.min(1.5, rate));
    if (next !== this.rate) this.keep(this.playing, next);
  }

  // Repeat the song from `from` to `to`. Where the song is now stays, if it
  // is inside the stretch; otherwise it starts from `from`.
  setLoop(from, to) {
    if (!(Number.isFinite(from) && Number.isFinite(to) && to - from > SHORTEST)) {
      this.clearLoop();
      return false;
    }
    const l = this.loop;
    if (l && l.from === from && l.to === to) return true;
    const t = now();
    const p = this.position(t);
    this.loop = { from, to };
    this.put(p >= from && p < to ? p : from, this.playing, t);
    return true;
  }

  clearLoop() {
    if (!this.loop) return;
    const t = now();
    const p = this.position(t);
    this.loop = null;
    this.put(p, this.playing, t);
  }

  // What the song does between two moments, as straight stretches:
  // [{ from, to, at }] - the song runs from `from` up to but not including
  // `to`, starting at time `at`; a place x in it is reached at
  // at + (x - from) / rate. More than one stretch when the loop comes round in
  // between. This is what sounds are scheduled from.
  //
  // Stretches asked one after the other meet exactly: span(a, b) ends on the
  // very number span(b, c) starts from, or on loop.to with the next one
  // starting on loop.from. So a note is in exactly one of them.
  span(t0, t1) {
    if (!this.playing || !(t1 > t0)) return [];
    const a = this.where(this.raw(t0));
    const b = this.where(this.raw(t1));
    const out = [];
    let p = a.pos;
    let t = t0;
    if (b.turns > a.turns) {
      const l = this.loop;
      const len = l.to - l.from;
      let k = a.turns;
      if (b.turns - k > MOST_LAPS) { k = b.turns - 1; p = l.to; }
      for (; k < b.turns; k++) {                     // each time the loop comes round in between
        if (l.to > p) out.push({ from: p, to: l.to, at: t });
        t = this.timeOf(l.to + k * len);
        p = l.from;
      }
    }
    if (b.pos > p) out.push({ from: p, to: b.pos, at: t });
    return out;
  }
}
