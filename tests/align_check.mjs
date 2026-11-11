// Measures the charts against the real recordings.
//
// For each song: takes Deezer's 30-second clip of the recording, finds where
// it sits in the chart by its drums (js/align.js), and compares that with what
// the lyrics say. A strong match means the chart's drums are the recording's
// drums. Needs ffmpeg on the path.
// Run: node tests/align_check.mjs
import { execFileSync } from 'node:child_process';
import { findCharts, loadChart, lyricShift } from '../js/charts.js';
import { syncedLyrics } from '../js/lyrics.js';
import { hitCurves, locate } from '../js/align.js';

const SONGS = process.argv.length > 2
  ? [{ title: process.argv[2], artist: process.argv[3] || '' }]
  : [
    { title: 'Du Hast', artist: 'Rammstein' },
    { title: 'Everlong', artist: 'Foo Fighters' },
    { title: 'Enter Sandman', artist: 'Metallica' },
    { title: 'Smells Like Teen Spirit', artist: 'Nirvana' },
    { title: 'Billie Jean', artist: 'Michael Jackson' },
    { title: 'Chop Suey!', artist: 'System Of A Down' },
    { title: 'Blinding Lights', artist: 'The Weeknd' },
    { title: 'In the End', artist: 'Linkin Park' },
  ];
const RATE = 22050;

for (const song of SONGS) {
  try {
    const dz = await (await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(`${song.artist} ${song.title}`)}&limit=5`)).json();
    const track = (dz.data || []).find((t) => !/live|remix|rmx|acoustic|version/i.test(t.title)) || dz.data?.[0];
    if (!track?.preview) { console.log(`--  ${song.title}: no clip on Deezer`); continue; }
    song.duration = track.duration;
    const mp3 = Buffer.from(await (await fetch(track.preview)).arrayBuffer());
    const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 'f32le', '-ac', '1', '-ar', String(RATE), 'pipe:1'],
      { input: mp3, maxBuffer: 1 << 28 });
    const samples = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length >> 2);
    const curves = hitCurves(samples, RATE);

    const charts = await findCharts(song);
    if (!charts.length) { console.log(`--  ${song.title}: no chart`); continue; }
    const lyrics = await syncedLyrics(song).catch(() => null);
    for (const c of charts.slice(0, 3)) {
      const parsed = await loadChart(c);
      const t0 = performance.now();
      const found = locate(curves, parsed.notes);
      const ms = Math.round(performance.now() - t0);
      const rough = lyrics ? lyricShift(parsed.phrases, lyrics.filter((l) => l.text).map((l) => l.t)) : null;
      // if the chart needs `rough` added to match the song, the clip starts at found.at + rough in the song
      const inSong = rough === null ? '   ?  ' : (found.at + rough).toFixed(2).padStart(6);
      console.log(`${found.margin > 1.5 ? 'ok ' : 'weak'} ${song.artist} - ${song.title} | ${(c.charter || '?').slice(0, 18).padEnd(18)} `
        + `| clip sits at ${found.at.toFixed(3).padStart(8)}s of the chart | strength ${found.strength.toFixed(1).padStart(5)}, margin ${found.margin.toFixed(1).padStart(4)} `
        + `| lyrics say shift ${rough === null ? ' none ' : rough.toFixed(2).padStart(6)} -> clip starts ${inSong}s into the song | ${ms} ms`);
    }
  } catch (e) {
    console.log(`ERR ${song.title}: ${e.message}`);
  }
}
