// Compares when the chart says each line is sung with when the lyrics say so.
// Run: node tests/inspect_sync.mjs "Du Hast" "Rammstein" 235
import { findCharts, loadChart, lyricShift } from '../js/charts.js';
import { syncedLyrics } from '../js/lyrics.js';

const [title = 'Du Hast', artist = 'Rammstein', duration = '235'] = process.argv.slice(2);
const song = { title, artist, duration: Number(duration) };
const lyrics = await syncedLyrics(song);
console.log(`lyrics: ${lyrics ? lyrics.length + ' lines' : 'none'}`);
if (lyrics) console.log('  lines at:   ', lyrics.filter((l) => l.text).map((l) => l.t.toFixed(1)).join(' '));
for (const c of await findCharts(song)) {
  const parsed = await loadChart(c);
  const shift = lyrics ? lyricShift(parsed.phrases, lyrics.filter((l) => l.text).map((l) => l.t)) : null;
  console.log(`\n${c.charter} | ${c.length.toFixed(0)}s | first note ${parsed.notes[0].t.toFixed(2)}s, last ${parsed.notes.at(-1).t.toFixed(2)}s | `
    + `${parsed.phrases.length} phrases | shift ${shift === null ? 'none' : shift.toFixed(3)}`);
  console.log('  phrases at: ', parsed.phrases.map((t) => t.toFixed(1)).join(' '));
}
