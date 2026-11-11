// How well can the line-up by ear place each stretch of a clip? Slides an
// 18-second window through Deezer's 30-second clip (heard as a small speaker
// through the real mic code) and reports the fit for each start.
// Run: node tests/ear_passage.mjs "chop suey" "system of a down"
import { execFileSync } from 'node:child_process';
import { findCharts, loadChart } from '../js/charts.js';
import { hitCurves, locate } from '../js/align.js';
import { Mic } from '../js/mic.js';

const RATE = 48000;
const messages = [];
let Processor;
globalThis.sampleRate = RATE;
globalThis.currentFrame = 0;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: (m) => messages.push(m) }; } };
globalThis.registerProcessor = (_n, cls) => { Processor = cls; };
await import('../js/onset-worklet.js');

const [title = 'Chop Suey!', artist = 'System Of A Down'] = process.argv.slice(2);
const dz = await (await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(`${artist} ${title}`)}&limit=5`)).json();
const track = (dz.data || []).find((t) => !/live|remix|rmx|acoustic|version/i.test(t.title)) || dz.data[0];
const mp3 = Buffer.from(await (await fetch(track.preview)).arrayBuffer());
const decode = (filter) => {
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', ...(filter ? ['-af', filter] : []), '-f', 'f32le', '-ac', '1', '-ar', String(RATE), 'pipe:1'],
    { input: mp3, maxBuffer: 1 << 28 });
  return new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length >> 2);
};
const chart = (await findCharts({ title, artist, duration: track.duration }))[0];
const notes = (await loadChart(chart)).notes;
const ref = locate(hitCurves(decode(), RATE), notes).at;
const heard = decode('highpass=f=170,volume=0.3');
console.log(`${artist} - ${title} | ${chart.charter} | the clip starts at ${ref.toFixed(2)}s of the chart`);
for (const [from, len] of [[0, 18], [4, 18], [8, 18], [11, 18], [0, 10], [8, 10], [16, 10], [19.5, 10]]) {
  messages.length = 0;
  const proc = new Processor();
  const end = Math.min(heard.length, Math.round((from + len) * RATE));
  for (let i = 0; i + 128 <= end; i += 128) { globalThis.currentFrame = i; proc.process([[heard.subarray(i, i + 128)]]); }
  const mic = new Mic();
  mic.ctx = { sampleRate: RATE, currentTime: end / RATE };
  mic.running = true;
  for (const m of messages) if (m.type === 'bands') mic.keep(m);
  const clip = mic.clip(len - 0.5);
  const start = (mic.bandsStart + (mic.lowE.length - clip.low.length) * 256) / RATE;
  const want = ref + start;
  const f = locate(clip, notes, { from: want - 1.5, to: want + 1.5 });
  console.log(`  seconds ${String(from).padStart(4)}..${String(from + len).padEnd(4)} | lands ${String(Math.round((f.at - want) * 1000)).padStart(5)} ms from the spot | strength ${f.strength.toFixed(1)} | ${f.peaks.length} place(s) nearly as good`);
}
