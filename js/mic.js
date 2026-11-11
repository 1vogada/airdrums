// The microphone: hears the Air Drums speaker and reports each hit - when it
// was, how loud, and (once you've taught it your kit) which drum it sounded
// like. The sticks themselves can't be read: they only talk to the speaker.

import * as store from './store.js';
import { rise } from './align.js';

const HOP = 256;                       // samples per step in the worklet
const KEEP = 30;                       // seconds of band loudness kept

const dB = (x) => 20 * Math.log10(Math.max(x, 1e-6));

export class Mic {
  constructor() {
    this.ctx = null;
    this.running = false;
    this.threshold = store.get('mic.threshold', -30);        // dB: quieter sounds aren't your hits
    this.centroids = store.get('mic.centroids', {});         // pad id -> fingerprint
    this.onHit = () => {};      // ({ t, db, loud, pad })  t in performance seconds
    this.onLevel = () => {};    // (db)
    this.teaching = null;
    this.lowE = [];             // loudness of the lowest band, step by step
    this.highE = [];            // ...and of the highest
    this.bandsStart = 0;        // the audio frame lowE[0] starts at
    this.bandsEnd = -1;
  }

  async start() {
    if (this.running) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('this browser has no microphone access');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
    } catch (e) {
      throw new Error(e.name === 'NotAllowedError' ? 'microphone access was refused' : `no microphone: ${e.message}`);
    }
    this.startedAt = performance.now() / 1000;               // when the sound started coming in
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    await this.ctx.audioWorklet.addModule(new URL('./onset-worklet.js', import.meta.url));
    const src = this.ctx.createMediaStreamSource(this.stream);
    const node = new AudioWorkletNode(this.ctx, 'onset', { numberOfInputs: 1, numberOfOutputs: 1 });
    const mute = this.ctx.createGain();
    mute.gain.value = 0;                                     // keeps the graph running without playing the mic back
    src.connect(node).connect(mute).connect(this.ctx.destination);
    node.port.onmessage = (e) => this.heard(e.data);
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.running = true;
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.ctx = null;
    this.running = false;
  }

  setThreshold(db) {
    this.threshold = db;
    store.set('mic.threshold', db);
  }

  heard(m) {
    if (m.type === 'level') { this.onLevel(dB(m.peak)); return; }
    if (m.type === 'bands') { this.keep(m); return; }
    // when it happened, on the page's clock
    const t = performance.now() / 1000 - (this.ctx.currentTime - m.frame / this.ctx.sampleRate);
    const db = dB(m.peak);
    const loud = db >= this.threshold;
    const print = fingerprint(m);
    if (this.teaching && loud) { this.teach(print); return; }
    this.onHit({ t, db, loud, pad: this.classify(print) });
  }

  keep(m) {
    if (m.frame !== this.bandsEnd) {                         // a gap in the sound: start over
      this.lowE = [];
      this.highE = [];
      this.bandsStart = m.frame;
    }
    for (let i = 0; i < m.low.length; i++) { this.lowE.push(m.low[i]); this.highE.push(m.high[i]); }
    this.bandsEnd = m.frame + m.low.length * HOP;
    const most = Math.ceil((KEEP * this.ctx.sampleRate) / HOP);
    if (this.lowE.length > most * 1.25) {
      const drop = this.lowE.length - most;
      this.lowE.splice(0, drop);
      this.highE.splice(0, drop);
      this.bandsStart += drop * HOP;
    }
  }

  // What was heard in the last `seconds`, as hit curves for js/align.js, and
  // `start`: when it began on the page's clock. null until that much is in.
  clip(seconds) {
    if (!this.running) return null;
    const hop = HOP / this.ctx.sampleRate;
    const want = Math.round(seconds / hop);
    if (this.lowE.length < want) return null;
    const from = this.lowE.length - want;
    const frame = this.bandsStart + from * HOP;
    return {
      low: rise(Float32Array.from(this.lowE.slice(from)), hop),
      high: rise(Float32Array.from(this.highE.slice(from)), hop),
      hop,
      start: performance.now() / 1000 - (this.ctx.currentTime - frame / this.ctx.sampleRate),
    };
  }

  get taught() { return Object.keys(this.centroids); }

  // The drum a fingerprint sounds most like, or null before two drums are taught.
  classify(print) {
    const ids = this.taught;
    if (ids.length < 2) return null;
    let best = null, bestD = Infinity;
    for (const id of ids) {
      const d = distance(print, this.centroids[id]);
      if (d < bestD) { best = id; bestD = d; }
    }
    return best;
  }

  // Learn what a drum sounds like from the next `count` hits. onProgress(n, count).
  learn(pad, count, onProgress) {
    return new Promise((resolve) => {
      this.teaching = { pad, count, prints: [], onProgress, resolve };
    });
  }

  cancelLearn() {
    this.teaching?.resolve(false);
    this.teaching = null;
  }

  teach(print) {
    const t = this.teaching;
    t.prints.push(print);
    t.onProgress?.(t.prints.length, t.count);
    if (t.prints.length < t.count) return;
    this.centroids[t.pad] = print.map((_, i) => t.prints.reduce((s, p) => s + p[i], 0) / t.prints.length);
    store.set('mic.centroids', this.centroids);
    this.teaching = null;
    t.resolve(true);
  }

  forget() {
    this.centroids = {};
    store.del('mic.centroids');
  }
}

// What a hit sounds like, independent of how loud it was: the four band
// levels relative to their average, plus how "noisy" it is (zero crossings).
function fingerprint(m) {
  const logs = m.bands.map((e) => Math.log10(e + 1e-12));
  const mean = logs.reduce((s, v) => s + v, 0) / logs.length;
  return [...logs.map((v) => v - mean), (m.zc / (m.hops * 256)) * 4];
}

function distance(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return s;
}
