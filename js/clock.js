// The site's own clock, for a song that isn't following Spotify. Unlike
// Spotify's it belongs to the site, so it can run slower than the song and
// loop a stretch of it: that is what learning a song needs.
//
// Times are seconds. `t` is performance time (performance.now() / 1000), a
// position is seconds into the song.

const now = () => performance.now() / 1000;

export const RATES = [0.5, 0.6, 0.7, 0.8, 0.9, 1];

export class OwnClock {
  constructor(song) {
    this.song = song;
    this.playing = false;
    this.rate = 1;                 // 1 is the song's own tempo, 0.5 half of it
    this.loop = null;              // { from, to } in song seconds: the stretch that repeats
    this.progress = 0;             // where the song was at `at`, as if nothing looped
    this.at = now();
  }

  // Seconds into the song as if nothing looped.
  raw(t = now()) {
    return this.playing ? this.progress + (t - this.at) * this.rate : this.progress;
  }

  // Seconds into the song at time t.
  position(t = now()) {
    return this.fold(this.raw(t));
  }

  fold(raw) {
    const l = this.loop;
    if (!l || raw < l.to) return raw;
    return l.from + ((raw - l.from) % (l.to - l.from));
  }

  // How many times the loop has come round since it was set, the song was
  // moved or the tempo changed.
  lap(t = now()) {
    const l = this.loop;
    const raw = this.raw(t);
    return !l || raw < l.to ? 0 : Math.floor((raw - l.from) / (l.to - l.from));
  }

  set(progress, playing) {
    this.progress = progress;
    this.playing = playing;
    this.at = now();
  }

  toggle() { this.set(this.position(), !this.playing); }
  play() { this.set(this.position(), true); }
  pause() { this.set(this.position(), false); }
  seekTo(seconds) { this.set(Math.max(0, seconds), this.playing); }

  setRate(rate) {
    this.set(this.position(), this.playing);
    this.rate = Math.max(0.25, Math.min(1.5, rate));
  }

  // Repeat the song from `from` to `to`. Where the song is now stays, if it
  // is inside the stretch; otherwise it starts from `from`.
  setLoop(from, to) {
    const p = this.position();
    this.loop = to - from > 0.2 ? { from: Math.max(0, from), to } : null;
    this.set(this.loop && (p < this.loop.from || p >= this.loop.to) ? this.loop.from : p, this.playing);
  }

  clearLoop() {
    const p = this.position();
    this.loop = null;
    this.set(p, this.playing);
  }

  // What the song does between two moments, as straight stretches:
  // [{ from, to, at }] - the song runs from `from` to `to`, starting at time
  // `at`. More than one when the loop comes round in between. This is what
  // sounds are scheduled from.
  span(t0, t1) {
    if (!this.playing || t1 <= t0) return [];
    const out = [];
    let p = this.position(t0);
    let t = t0;
    for (let guard = 0; t < t1 - 1e-9 && guard < 64; guard++) {
      const room = this.loop ? (this.loop.to - p) / this.rate : Infinity;
      const dt = Math.min(t1 - t, room);
      out.push({ from: p, to: p + dt * this.rate, at: t });
      t += dt;
      p = dt === room ? this.loop.from : p + dt * this.rate;
    }
    return out;
  }

  stop() { this.pause(); }
}
