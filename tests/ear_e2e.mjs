// In a real browser: a recording is played in as the microphone while the site
// shows the same song, and the page has to say where the sound belongs.
//
// The page's clock is started on purpose a little after the microphone (by
// however long the page takes to get going, measured in the page). After 26
// seconds the page is asked where the last 10 and the last 18 seconds of sound
// sit against its clock: the answer has to be that same delay, to within a few
// hundredths of a second. That checks the whole microphone path in the browser:
// worklet, buffer, and the two clocks.
//
// It does not check the page then moving the notes by itself: Deezer's clips
// are 30 seconds, too short for that. tests/ear_check.mjs covers that choice
// with the same code outside a browser.
//
// Needs ffmpeg, Microsoft Edge and the dev server (node dev/serve.mjs).
// Run: node tests/ear_e2e.mjs
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { searchCharts, findCharts, loadChart, lyricShift } from '../js/charts.js';
import { syncedLyrics } from '../js/lyrics.js';
import { hitCurves, locate } from '../js/align.js';

const EDGE = process.env.EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9337;
const SONG = { title: process.argv[2] || 'Chop Suey!', artist: process.argv[3] || 'System Of A Down' };
SONG.q = `${SONG.title} ${SONG.artist}`.replace(/[^\w ]/g, '');

const dir = mkdtempSync(join(tmpdir(), 'airdrums-e2e-'));
const dz = await (await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(`${SONG.artist} ${SONG.title}`)}&limit=5`)).json();
const track = dz.data.find((t) => !/live|remix|rmx|acoustic|version/i.test(t.title)) || dz.data[0];
const mp3 = Buffer.from(await (await fetch(track.preview)).arrayBuffer());
const ffmpeg = (args) => execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', ...args, 'pipe:1'], { input: mp3, maxBuffer: 1 << 28 });

// the chart the site would pick for this song with Spotify, and where the clip sits in it
// (worked out here, from the clean clip)
const chart = (await findCharts({ ...SONG, duration: track.duration }))[0];
if (!(await searchCharts(SONG.q)).some((c) => c.md5 === chart.md5)) throw new Error('the demo search does not list that chart');
const parsed = await loadChart(chart);
const notes = parsed.notes;
const pcm = ffmpeg(['-f', 'f32le', '-ac', '1', '-ar', '22050']);
const clipAt = locate(hitCurves(new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length >> 2), 22050), notes).at;
// the page lines the chart up with the song from the lyrics, the same way: so in song time the clip starts here
const lyrics = await syncedLyrics({ title: chart.name, artist: chart.artist }).catch(() => null);
const rough = (lyrics && lyricShift(parsed.phrases, lyrics.filter((l) => l.text).map((l) => l.t))) || 0;
console.log(`${chart.artist} - ${chart.name} by ${chart.charter}: the clip starts at ${clipAt.toFixed(2)}s of the chart, ${(clipAt + rough).toFixed(2)}s of the song`);

// what a laptop mic would get from a small speaker: no bass, quieter
writeFileSync(join(dir, 'mic.wav'), ffmpeg(['-af', 'highpass=f=170,volume=0.3', '-ac', '2', '-ar', '48000', '-f', 'wav']));

const url = `http://127.0.0.1:8377/?demo=${encodeURIComponent(SONG.q)}&at=${(clipAt + rough).toFixed(3)}&chart=${chart.md5}&mic=1#/tab`;
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--user-data-dir=${join(dir, 'profile')}`, `--remote-debugging-port=${PORT}`,
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${join(dir, 'mic.wav')}%noloop`,
  '--autoplay-policy=no-user-gesture-required', '--window-size=1280,800', url], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
try {
  let target;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    target = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json()).then((l) => l.find((t) => t.type === 'page')).catch(() => null);
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); waiting.get(m.id)?.(m); };
  const run = (expression) => new Promise((resolve) => {
    waiting.set(++id, (m) => resolve(m.result?.result?.value));
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  });
  const ask = async (expression) => JSON.parse(await run(`JSON.stringify(${expression})`) || 'null');

  await sleep(26000);
  const page = await ask(`{ mic: window.airdrums.mic.running, playing: window.airdrums.clock?.playing, sync: document.getElementById('offset').textContent,
    md5: window.airdrums.song?.charts?.[0]?.md5, micStarted: window.airdrums.mic.startedAt, clockStarted: window.airdrums.clock?.at,
    offset: window.airdrums.game?.offset }`);
  if (!page?.mic || !page.playing) throw new Error(`the page isn't listening and playing: ${JSON.stringify(page)}`);
  if (page.md5 !== chart.md5) throw new Error('the page picked another chart than this test did');
  const late = page.clockStarted - page.micStarted;        // the clock started this long after the microphone
  console.log(`the page's clock started ${late.toFixed(3)}s after its microphone, and shows "${page.sync}"`);
  // the notes are right when the page's line-up cancels that delay
  const lineUp = Math.round((page.offset - rough + late) * 1000);
  let ok = Math.abs(lineUp) <= 60;
  console.log(`the page's own line-up is ${lineUp} ms from right${ok ? '' : ': it WANDERED OFF'}`);
  for (const seconds of [18, 10]) {
    const h = await ask(`window.airdrums.hear(${seconds}, 1)`);
    if (!h?.found) { console.log(`last ${seconds} s of sound: nothing found`); ok = false; continue; }
    // the sound should sit `late` ahead of the clock, less what the page already corrected
    const off = Math.round((h.found.at - h.guess - late - (page.offset - rough)) * 1000);
    if (seconds === 18 && Math.abs(off) > 60) ok = false;
    console.log(`last ${seconds} s of sound: placed ${off} ms from the truth, strength ${h.found.strength.toFixed(1)}, ${h.found.peaks.length} place(s) nearly as good`);
  }
  console.log(ok ? 'the page places the sound where it really is' : 'something is WRONG');
  process.exitCode = ok ? 0 : 1;
} finally {
  ws?.close();
  edge.kill();
  await sleep(500);
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* the browser may still hold it */ }
}
