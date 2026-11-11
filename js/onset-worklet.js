// Runs on the audio thread: finds drum hits in the microphone signal.
//
// The signal is split into four rough bands (below 200 Hz, 200-1200,
// 1200-5000, above 5000) with one-pole filters. Every HOP samples (about
// 5 ms) the loudness is compared with the recent background: a jump is a
// hit. The band energies of the next 45 ms are sent along as the hit's
// fingerprint, so the page can tell a snare from a cymbal.

const HOP = 256;
const COLLECT = 8;        // hops the fingerprint is taken over
const REFRACT = 12;       // hops before the next hit can start (~64 ms)
const RATIO = 2.0;        // times louder than the background
const FLOOR = 0.0015;     // quietest thing that can be a hit (about -56 dB)
const METER = 8;          // hops between level reports

class Onset extends AudioWorkletProcessor {
  constructor() {
    super();
    const a = (hz) => 1 - Math.exp((-2 * Math.PI * hz) / sampleRate);
    this.a = [a(200), a(1200), a(5000)];
    this.lp = [0, 0, 0];
    this.band = [0, 0, 0, 0];
    this.zc = 0;
    this.prev = 0;
    this.n = 0;
    this.bg = FLOOR;
    this.last = 0;
    this.since = REFRACT;
    this.left = 0;
    this.hit = null;
    this.meterN = 0;
    this.meterPeak = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    const { a, lp, band } = this;
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i];
      lp[0] += a[0] * (x - lp[0]);
      lp[1] += a[1] * (x - lp[1]);
      lp[2] += a[2] * (x - lp[2]);
      const b0 = lp[0], b1 = lp[1] - lp[0], b2 = lp[2] - lp[1], b3 = x - lp[2];
      band[0] += b0 * b0; band[1] += b1 * b1; band[2] += b2 * b2; band[3] += b3 * b3;
      if ((x >= 0) !== (this.prev >= 0)) this.zc++;
      this.prev = x;
      if (++this.n === HOP) this.hop(currentFrame + i + 1 - HOP);
    }
    return true;
  }

  hop(frame) {
    const { band } = this;
    const rms = Math.sqrt((band[0] + band[1] + band[2] + band[3]) / HOP);
    if (this.left > 0) {
      const h = this.hit;
      for (let b = 0; b < 4; b++) h.bands[b] += band[b];
      h.zc += this.zc;
      h.peak = Math.max(h.peak, rms);
      if (--this.left === 0) { this.port.postMessage(h); this.hit = null; }
    } else if (this.since >= REFRACT && rms > FLOOR && rms > this.bg * RATIO && rms > this.last * 1.2) {
      this.hit = { type: 'hit', frame, peak: rms, bands: band.slice(), zc: this.zc, hops: COLLECT };
      this.left = COLLECT - 1;
      this.since = 0;
    }
    this.since++;
    this.bg += (rms - this.bg) * 0.08;
    this.last = rms;
    this.meterPeak = Math.max(this.meterPeak, rms);
    if (++this.meterN === METER) {
      this.port.postMessage({ type: 'level', peak: this.meterPeak });
      this.meterN = 0;
      this.meterPeak = 0;
    }
    band[0] = band[1] = band[2] = band[3] = 0;
    this.zc = 0;
    this.n = 0;
  }
}

registerProcessor('onset', Onset);
