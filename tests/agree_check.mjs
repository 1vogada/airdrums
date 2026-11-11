// Of each chart's bass drum and snare hits, how many are really in the recording?
// Uses Deezer's 30-second clip. Run: node tests/agree_check.mjs
import { execFileSync } from 'node:child_process';
import { findCharts, loadChart } from '../js/charts.js';
import { hitCurves, locate, agreement } from '../js/align.js';

const SONGS = [['Du Hast', 'Rammstein'], ['Everlong', 'Foo Fighters'], ['Enter Sandman', 'Metallica'],
  ['Smells Like Teen Spirit', 'Nirvana'], ['Billie Jean', 'Michael Jackson'], ['Chop Suey!', 'System Of A Down'],
  ['In the End', 'Linkin Park'], ['Blinding Lights', 'The Weeknd']];
for (const [title, artist] of SONGS) {
  const dz = await (await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(`${artist} ${title}`)}&limit=5`)).json();
  const track = (dz.data || []).find((t) => !/live|remix|rmx|acoustic|version/i.test(t.title)) || dz.data?.[0];
  const mp3 = Buffer.from(await (await fetch(track.preview)).arrayBuffer());
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 'f32le', '-ac', '1', '-ar', '22050', 'pipe:1'], { input: mp3, maxBuffer: 1 << 28 });
  const curves = hitCurves(new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length >> 2), 22050);
  const c = (await findCharts({ title, artist, duration: track.duration }))[0];
  const parsed = await loadChart(c);
  const at = locate(curves, parsed.notes).at;
  const right = agreement(curves, parsed.notes, at);
  let wrong = 0;
  const tries = [0.07, 0.11, 0.16, -0.07, -0.13, 0.31, -0.29, 1.03];
  for (const d of tries) wrong += agreement(curves, parsed.notes, at + d) / tries.length;
  console.log(`${artist} - ${title} | ${c.charter} | lined up: ${(right * 100).toFixed(0)}% of bass+snare hits are in the recording | shifted off: ${(wrong * 100).toFixed(0)}%`);
}
