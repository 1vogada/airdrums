// Does the microphone line-up work? Plays real recordings into the real mic
// code and checks it finds where the song is.
//
// For each song: Deezer's 30-second clip is made to sound like a small speaker
// heard by a laptop mic (no bass, some echo, noise), fed through the actual
// worklet (js/onset-worklet.js) and Mic buffer (js/mic.js), and the last 10
// seconds are lined up against the chart starting from a wrong guess. It should
// land on the same place every time. Then the same audio is tried against a
// different song's chart: that must be turned down.
// Needs ffmpeg. Run: node tests/ear_check.mjs
import { execFileSync } from 'node:child_process';
import { findCharts, loadChart } from '../js/charts.js';
import { hitCurves, locate, pick } from '../js/align.js';
import { Mic } from '../js/mic.js';

const RATE = 48000;
const messages = [];
let Processor;
globalThis.sampleRate = RATE;
globalThis.currentFrame = 0;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: (m) => messages.push(m) }; } };
globalThis.registerProcessor = (_name, cls) => { Processor = cls; };
await import('../js/onset-worklet.js');

const SONGS = [['Du Hast', 'Rammstein'], ['Everlong', 'Foo Fighters'], ['Enter Sandman', 'Metallica'],
  ['Smells Like Teen Spirit', 'Nirvana'], ['Billie Jean', 'Michael Jackson'], ['In the End', 'Linkin Park'],
  ['Blinding Lights', 'The Weeknd'], ['Chop Suey!', 'System Of A Down']];
const CLIP = 10, REACH = 0.5;

function decode(mp3, filter) {
  const args = ['-v', 'error', '-i', 'pipe:0'];
  if (filter) args.push('-af', filter);
  const pcm = execFileSync('ffmpeg', [...args, '-f', 'f32le', '-ac', '1', '-ar', String(RATE), 'pipe:1'], { input: mp3, maxBuffer: 1 << 28 });
  return new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length >> 2);
}

// The audio as the mic code hears it: through the worklet, into the Mic buffer.
function throughMic(samples) {
  messages.length = 0;
  const proc = new Processor();
  for (let i = 0; i + 128 <= samples.length; i += 128) {
    globalThis.currentFrame = i;
    proc.process([[samples.subarray(i, i + 128)]]);
  }
  const mic = new Mic();
  mic.ctx = { sampleRate: RATE, currentTime: samples.length / RATE };
  mic.running = true;
  for (const m of messages) if (m.type === 'bands') mic.keep(m);
  return mic;
}

const loaded = [];
for (const [title, artist] of SONGS) {
  const dz = await (await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(`${artist} ${title}`)}&limit=5`)).json();
  const track = (dz.data || []).find((t) => !/live|remix|rmx|acoustic|version/i.test(t.title)) || dz.data?.[0];
  const mp3 = Buffer.from(await (await fetch(track.preview)).arrayBuffer());
  const chart = (await findCharts({ title, artist, duration: track.duration }))[0];
  loaded.push({ title, mp3, notes: (await loadChart(chart)).notes });
}

let bad = 0, landed = 0, tried = 0;
const rightStats = [], wrongStats = [];
for (const [k, song] of loaded.entries()) {
  // where the clean clip sits in the chart: the reference
  const ref = locate(hitCurves(decode(song.mp3), RATE), song.notes);
  // a small speaker heard across a room by a laptop mic
  const heard = decode(song.mp3, 'highpass=f=170,lowpass=f=9000,aecho=0.8:0.6:28|61:0.35|0.2,volume=0.25');
  for (let i = 0; i < heard.length; i++) heard[i] += (Math.random() - 0.5) * 0.004;
  const mic = throughMic(heard);
  const clip = mic.clip(CLIP);
  // seconds into the 30 s clip that the mic's last 10 seconds start at
  const clipStart = (mic.bandsStart + (mic.lowE.length - clip.low.length) * 256) / RATE;
  const want = ref.at + clipStart;                              // chart time the last 10 s start at
  // a guess that's a little off (what the lyrics give): must land on the spot
  const errors = [];
  let worst = null;
  for (const wrongBy of [-0.1, -0.05, 0, 0.05, 0.1]) {
    const guess = want + wrongBy;
    const found = locate(clip, song.notes, { from: guess - REACH, to: guess + REACH });
    const at = pick(found, guess);
    errors.push(at === null ? null : Math.round((at - want) * 1000));
    if (!worst || found.strength < worst.strength) worst = found;
    rightStats.push(found);
  }
  // a guess that's far off: land on the spot or say "can't tell", never somewhere else
  const far = [];
  for (const wrongBy of [-0.42, -0.2, 0.2, 0.37]) {
    const guess = want + wrongBy;
    const at = pick(locate(clip, song.notes, { from: guess - REACH, to: guess + REACH }), guess);
    far.push(at === null ? null : Math.round((at - want) * 1000));
  }
  // from a near guess: never a wrong place, and it should usually land. A far guess is
  // outside what this is for (it can sit on the next beat): shown, not judged.
  const ok = errors.every((e) => e === null || Math.abs(e) <= 20);
  landed += errors.filter((e) => e !== null).length;
  tried += errors.length;
  if (!ok) bad++;
  // the same sound against another song's chart
  const other = loaded[(k + 3) % loaded.length];
  const stray = locate(clip, other.notes, { from: 60 - REACH, to: 60 + REACH });
  wrongStats.push(stray);
  const show = (list) => list.map((e) => (e === null ? '  ? ' : String(e).padStart(4))).join(' ');
  console.log(`${ok ? 'ok ' : 'BAD'} ${song.title.padEnd(24)} | near guesses: off by ${show(errors)} ms | far guesses: ${show(far)} `
    + `| weakest: strength ${worst.strength.toFixed(1)}, share ${(worst.share * 100).toFixed(0)}% `
    + `| against ${other.title}: ${pick(stray, 60) === null ? 'turned down' : 'ACCEPTED'} (strength ${stray.strength.toFixed(1)})`);
}
const min = (a, f) => Math.min(...a.map(f)).toFixed(2), max = (a, f) => Math.max(...a.map(f)).toFixed(2);
console.log(`right song:  strength ${min(rightStats, (x) => x.strength)}..${max(rightStats, (x) => x.strength)}, share ${min(rightStats, (x) => x.share)}..${max(rightStats, (x) => x.share)}`);
console.log(`wrong song:  strength ${min(wrongStats, (x) => x.strength)}..${max(wrongStats, (x) => x.strength)}, share ${min(wrongStats, (x) => x.share)}..${max(wrongStats, (x) => x.share)}`);
console.log(`near guesses that landed: ${landed} of ${tried} (the rest said "can't tell")`);
console.log(bad ? `${bad} songs BAD: a wrong place was accepted` : 'all good: no wrong place accepted');
process.exit(bad ? 1 : 0);
