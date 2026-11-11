// Live check: find and parse real drum charts. Run: node tests/charts_check.mjs
import { findCharts, loadChart, lyricShift } from '../js/charts.js';
import { syncedLyrics } from '../js/lyrics.js';

const SONGS = [
  { title: 'Everlong', artist: 'Foo Fighters', duration: 250 },
  { title: 'Enter Sandman - Remastered 2021', artist: 'Metallica', duration: 331 },
  { title: 'Blinding Lights', artist: 'The Weeknd', duration: 200 },
  { title: 'Smells Like Teen Spirit', artist: 'Nirvana', duration: 301 },
  { title: 'Billie Jean', artist: 'Michael Jackson', duration: 294 },
  { title: 'Levitating', artist: 'Dua Lipa', duration: 203 },
  { title: 'Du Hast', artist: 'Rammstein', duration: 235 },
  { title: 'Back In Black', artist: 'AC/DC', duration: 255 },
  { title: 'Chop Suey!', artist: 'System Of A Down', duration: 210 },
];

let failed = 0;
for (const song of SONGS) {
  try {
    const charts = await findCharts(song);
    if (!charts.length) { console.log(`--  ${song.artist} - ${song.title}: no chart`); continue; }
    const c = charts[0];
    const parsed = await loadChart(c);
    const count = {};
    for (const n of parsed.notes) count[n.pad] = (count[n.pad] || 0) + 1;
    const last = parsed.notes[parsed.notes.length - 1].t;
    const ordered = parsed.notes.every((n, i, a) => i === 0 || a[i - 1].t <= n.t);
    const sane = ordered && last > 30 && last < c.length + 15 && parsed.notes[0].t >= 0;
    let shift = 'no lyrics';
    const lyr = await syncedLyrics(song).catch(() => null);
    if (lyr) {
      const s = lyricShift(parsed.phrases, lyr.filter((l) => l.text).map((l) => l.t));
      shift = s === null ? `no clear shift (${parsed.phrases.length} phrases, ${lyr.length} lines)` : `shift ${s.toFixed(3)}s`;
    }
    console.log(`${sane ? 'ok' : 'BAD'}  ${c.artist} - ${c.name} | by ${c.charter}, real kit ${parsed.real ? 'yes' : 'no'}, open hats ${parsed.notes.filter((n) => n.open).length} | ${parsed.format} ${parsed.difficulty} of [${parsed.available}] `
      + `| type ${parsed.drumType} | ${parsed.notes.length} notes, last at ${last.toFixed(1)}s of ${c.length.toFixed(0)}s `
      + `| ${Object.entries(count).map(([k, v]) => `${k} ${v}`).join(', ')} | ${shift} | ${charts.length} candidates, fit ${c.fit}`);
    if (!sane) failed++;
  } catch (e) {
    failed++;
    console.log(`ERR ${song.artist} - ${song.title}: ${e.message}`);
  }
}
console.log(failed ? `${failed} FAILED` : 'all good');
process.exit(failed ? 1 : 0);
