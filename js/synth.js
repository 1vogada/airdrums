// The site's own drum sounds, made in the browser from oscillators and noise:
// no samples, nothing downloaded, nobody's recording. They are what you hear
// when a song plays on the site's own clock (no Spotify): the drum part as a
// guide, and a click on the beat.
//
// Sounds are scheduled a little ahead on the audio clock, which is the only
// clock in a browser that is exact to the sample.

const perf = () => performance.now() / 1000;

// One drum hit into `out` at audio time `at`. `noise` is a buffer of white
// noise. Works on any BaseAudioContext, so a test can render it offline.
export function voice(ctx, out, noise, pad, at, { open = false, gain = 1 } = {}) {
  const env = (peak, attack, decay) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * gain), at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    g.connect(out);
    return g;
  };
  const tone = (type, from, to, glide, peak, decay) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, at);
    if (to !== from) o.frequency.exponentialRampToValueAtTime(to, at + glide);
    o.connect(env(peak, 0.002, decay));
    o.start(at);
    o.stop(at + decay + 0.05);
  };
  const hiss = (kind, freq, q, peak, decay, attack = 0.001) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = kind;
    f.frequency.value = freq;
    f.Q.value = q;
    s.connect(f);
    f.connect(env(peak, attack, decay));
    s.start(at, (at * 7.3) % 1);                       // a different bit of noise each time
    s.stop(at + attack + decay + 0.05);
  };

  switch (pad) {
    case 'kick':
      tone('sine', 150, 46, 0.11, 1.0, 0.32);
      tone('triangle', 900, 120, 0.02, 0.35, 0.03);      // the beater's click
      break;
    case 'snare':
      tone('triangle', 240, 170, 0.06, 0.55, 0.11);
      hiss('highpass', 1800, 0.7, 0.6, 0.17);
      break;
    case 'hihat':
      if (open) hiss('highpass', 6500, 0.9, 0.34, 0.38);
      else hiss('highpass', 7500, 0.9, 0.34, 0.045);
      break;
    case 'pedal':                                         // the hi-hat closed with the foot: a short "chick"
      hiss('bandpass', 5200, 1.4, 0.3, 0.03);
      break;
    case 'crash':
      hiss('highpass', 3800, 0.6, 0.42, 1.1);
      hiss('bandpass', 9000, 2.5, 0.2, 0.6);
      break;
    case 'ride':
      hiss('bandpass', 7200, 3, 0.2, 0.45);
      tone('sine', 3350, 3350, 0, 0.09, 0.3);            // the bell's ping
      break;
    case 'tom':
      tone('sine', 230, 150, 0.12, 0.8, 0.26);
      break;
    case 'floor':
      tone('sine', 135, 82, 0.16, 0.9, 0.38);
      break;
    case 'click':
      tone('square', 1100, 1100, 0, 0.22, 0.025);
      break;
    case 'accent':                                        // the click on the first beat of a bar
      tone('square', 1650, 1650, 0, 0.3, 0.03);
      break;
    default:
  }
}

export function whiteNoise(ctx, seconds = 1) {
  const buffer = ctx.createBuffer(1, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 22222;                                      // the same noise every time: a hit always sounds the same
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 16807) % 2147483647;
    data[i] = (seed / 2147483647) * 2 - 1;
  }
  return buffer;
}

export class Synth {
  constructor() {
    this.ctx = null;
    this.levels = { guide: 0.8, click: 0.5 };            // 0 is off
    this.skew = null;                                     // audio clock minus performance clock, for sound heard "now"
  }

  get running() { return this.ctx?.state === 'running'; }

  // Browsers only let sound start from a click or a key press: call this from one.
  async start() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error("this browser can't make sound");
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.noise = whiteNoise(this.ctx);
      this.master = this.ctx.createDynamicsCompressor();  // many hits at once must not crackle
      this.master.connect(this.ctx.destination);
      this.open();
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    return this.running;
  }

  open() {
    this.guide = this.ctx.createGain();
    this.clicks = this.ctx.createGain();
    this.guide.gain.value = this.levels.guide;
    this.clicks.gain.value = this.levels.click;
    this.guide.connect(this.master);
    this.clicks.connect(this.master);
  }

  setLevel(which, level) {
    this.levels[which] = Math.max(0, Math.min(1, level));
    const node = which === 'guide' ? this.guide : this.clicks;
    if (node) node.gain.setTargetAtTime(this.levels[which], this.ctx.currentTime, 0.02);
  }

  // The audio-clock time at which a sound has to be scheduled to be HEARD at
  // performance time t: the browser says which moment of the audio clock is
  // coming out of the speakers right now.
  when(t) {
    const ctx = this.ctx;
    const stamp = ctx.getOutputTimestamp?.();
    let skew;
    if (stamp && stamp.performanceTime > 0 && stamp.contextTime > 0) {
      skew = stamp.contextTime - stamp.performanceTime / 1000;
    } else {
      skew = ctx.currentTime - perf() - (ctx.outputLatency || ctx.baseLatency || 0);
    }
    // the reading jitters by a few milliseconds: follow it slowly, jump only when it really moved
    this.skew = this.skew === null || Math.abs(skew - this.skew) > 0.05 ? skew : this.skew + (skew - this.skew) * 0.05;
    return Math.max(ctx.currentTime, t + this.skew);
  }

  // A drum of the guide, heard at performance time t.
  hit(pad, t, options) {
    if (!this.running || !this.levels.guide) return;
    voice(this.ctx, this.guide, this.noise, pad, this.when(t), options);
  }

  // The click on a beat, heard at performance time t.
  click(t, accent = false) {
    if (!this.running || !this.levels.click) return;
    voice(this.ctx, this.clicks, this.noise, accent ? 'accent' : 'click', this.when(t));
  }

  // Drop everything scheduled but not yet heard (the song jumped or stopped).
  flush() {
    if (!this.ctx) return;
    for (const node of [this.guide, this.clicks]) {
      node.gain.cancelScheduledValues(this.ctx.currentTime);
      node.gain.setTargetAtTime(0, this.ctx.currentTime, 0.008);
      setTimeout(() => node.disconnect(), 120);
    }
    this.open();
  }
}
