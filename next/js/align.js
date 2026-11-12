// Finds where a stretch of real audio sits in a drum chart, by ear.
//
// The audio's drums are picked out as two "when did something hit" curves: a
// low one (bass drum) and a high one (snare, cymbals). The chart gives the
// same two from its notes. Sliding the audio along the chart, the place where
// they agree best is where the audio belongs - to within a few milliseconds,
// because drum hits are sharp.
//
// The audio can be a clip of the recording (tests) or what the microphone
// heard in the last seconds (the site). Pure maths: browser and node.

export const HOP = 0.005;                 // seconds per step, for audio turned into curves here

function onePole(hz, sampleRate) {
  return 1 - Math.exp((-2 * Math.PI * hz) / sampleRate);
}

// The two hit curves of a piece of audio (mono samples): { low, high, hop }.
export function hitCurves(samples, sampleRate) {
  const step = Math.round(sampleRate * HOP);
  const frames = Math.floor(samples.length / step);
  const lowE = new Float32Array(frames), highE = new Float32Array(frames);
  const aLow = onePole(110, sampleRate), aHigh = onePole(4500, sampleRate);
  let lp = 0, lp2 = 0, hp = 0;
  for (let f = 0, i = 0; f < frames; f++) {
    let lo = 0, hi = 0;
    for (let k = 0; k < step; k++, i++) {
      const x = samples[i];
      lp += aLow * (x - lp);
      lp2 += aLow * (lp - lp2);           // two poles: a steeper cut, less of the bass guitar's upper notes
      hp += aHigh * (x - hp);
      const h = x - hp;
      lo += lp2 * lp2;
      hi += h * h;
    }
    lowE[f] = lo / step;
    highE[f] = hi / step;
  }
  return { low: rise(lowE, step / sampleRate), high: rise(highE, step / sampleRate), hop: step / sampleRate };
}

// How sharply the level jumps at each step: the hits, with the steady sound
// taken out. `energy` is the loudness of each step of `hop` seconds.
export function rise(energy, hop) {
  const n = energy.length;
  const level = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = energy[Math.max(0, i - 1)], b = energy[i], c = energy[Math.min(n - 1, i + 1)];
    level[i] = Math.log(1e-10 + (a + 2 * b + c) / 4);
  }
  const out = new Float32Array(n);
  for (let i = 2; i < n; i++) out[i] = Math.max(0, level[i] - level[i - 2]);
  // even out loud and quiet stretches: each step against the average around it
  const W = Math.round(1 / hop);          // one second each way
  let sum = 0;
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) { sum += out[i]; pre[i + 1] = sum; }
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - W), b = Math.min(n, i + W);
    out[i] /= (pre[b] - pre[a]) / (b - a) + 0.05;
  }
  return out;
}

const LOW = { kick: 1 };
const HIGH = { snare: 1, hihat: 0.6, ride: 0.6, crash: 0.9, tom: 0.5, floor: 0.4 };

// Where the audio starts in the chart's own time (seconds), looking between
// `from` and `to`. `notes` are the chart's [{ t, pad }], sorted. Returns
// { at, strength, margin, share }: `strength` is how far the best place stands
// above the others looked at (in standard deviations), `margin` how far above
// the next best one, `share` how much of the chart's bass and snare the audio
// confirms there.
export function locate(curves, notes, { from = -10, to = Infinity } = {}) {
  const hop = curves.hop;
  const n = curves.low.length;
  const last = notes.length ? notes[notes.length - 1].t : 0;
  const lo = Math.floor(Math.max(from, -n * hop) / hop);
  const hi = Math.ceil(Math.min(to, last) / hop);
  if (hi <= lo || n < 10) return null;
  const score = new Float32Array(hi - lo + 1);
  // each note votes for every place the audio could start so that a hit lands on it
  const spread = [[-1, 0.5], [0, 1], [1, 0.5]];
  for (const note of notes) {
    const j = Math.round(note.t / hop);
    if (j < lo - 1 || j > hi + n + 1) continue;
    for (const [curve, weight] of [[curves.low, LOW[note.pad]], [curves.high, HIGH[note.pad]]]) {
      if (!weight) continue;
      for (const [d, w] of spread) {
        // the audio's step i sits on chart step j + d when the audio starts at j + d - i
        const first = Math.max(0, j + d - hi), end = Math.min(n - 1, j + d - lo);
        for (let i = first; i <= end; i++) score[j + d - i - lo] += curve[i] * weight * w;
      }
    }
  }
  let best = 0;
  for (let i = 1; i < score.length; i++) if (score[i] > score[best]) best = i;
  let mean = 0;
  for (const s of score) mean += s;
  mean /= score.length;
  let dev = 0;
  for (const s of score) dev += (s - mean) ** 2;
  dev = Math.sqrt(dev / score.length) || 1;
  let rival = -Infinity;
  const near = Math.round(0.06 / hop);
  for (let i = 0; i < score.length; i++) if (Math.abs(i - best) > near && score[i] > rival) rival = score[i];
  // finer than one step: the top of the curve through a step and its neighbours
  const top = (i) => {
    const a = score[i - 1] ?? score[i], b = score[i], c = score[i + 1] ?? score[i];
    return (i + lo + (a - 2 * b + c < 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0)) * hop;
  };
  // every place that fits nearly as well as the best: a drum pattern repeats,
  // so the audio also fits a beat or half a bar away
  const peaks = [];
  for (let i = 0; i < score.length; i++) {
    if (score[i] < score[best] * 0.8) continue;
    if (score[i] < (score[i - 1] ?? -Infinity) || score[i] < (score[i + 1] ?? -Infinity)) continue;
    peaks.push({ at: top(i), fit: score[i] / score[best] });
  }
  const at = top(best);
  return {
    at,
    strength: (score[best] - mean) / dev,
    margin: rival === -Infinity ? 0 : (score[best] - rival) / dev,
    share: agreement(curves, notes, at),
    peaks,
  };
}

// For the automatic line-up: a small correction only. The best place within
// `close` seconds of where we expected the audio (`guess`, chart seconds), if
// it fits nearly as well as the best place looked at; otherwise null.
//
// Why so careful: a drum pattern repeats, so the audio also fits a beat or
// half a bar away, sometimes just as well - and a small speaker has no bass,
// so a bass drum and a snare can swap. Taking the best fit wherever it is can
// walk the notes a whole beat off, one confident step at a time. A correction
// smaller than the gap between two drum hits can't do that.
export function pick(found, guess, close = 0.12) {
  if (!found || found.strength < 3.6) return null;
  const near = found.peaks.filter((p) => Math.abs(p.at - guess) <= close && p.fit >= 0.9);
  return near.length ? near.reduce((x, y) => (y.fit > x.fit ? y : x)).at : null;
}

// For a wider search: of the places that fit about as well as the best, the
// one nearest the guess. A repeating beat fits many places; the nearest is the
// likeliest, and the least the notes have to move.
export function nearest(found, guess) {
  if (!found || found.strength < 3.6) return null;
  const good = found.peaks.filter((p) => p.fit >= 0.9);
  return good.reduce((a, b) => (Math.abs(b.at - guess) < Math.abs(a.at - guess) ? b : a)).at;
}

// Whether the audio fits one place only: nothing else comes near the best.
export const unique = (found) => Boolean(found) && found.strength >= 4 && found.peaks.length === 1;

// How much of the chart the audio confirms when it starts at `at`: of the
// chart's bass drum and snare hits inside it, the share with a real hit in the
// audio within 25 ms.
export function agreement(curves, notes, at) {
  const hop = curves.hop;
  const n = curves.low.length;
  const near = Math.round(0.025 / hop);
  let total = 0, found = 0;
  for (const note of notes) {
    const curve = note.pad === 'kick' ? curves.low : note.pad === 'snare' ? curves.high : null;
    if (!curve) continue;
    const i = Math.round((note.t - at) / hop);
    if (i < near || i >= n - near) continue;
    total++;
    let peak = 0;
    for (let k = i - near; k <= i + near; k++) peak = Math.max(peak, curve[k]);
    if (peak > 1.5) found++;                       // well above the average around it
  }
  return total >= 8 ? found / total : 0;
}
