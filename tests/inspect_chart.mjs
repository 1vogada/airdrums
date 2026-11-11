// Shows what each chart found for a song says, section by section.
// Run: node tests/inspect_chart.mjs "Du Hast" "Rammstein" 235
import { findCharts, loadChart } from '../js/charts.js';

const [title = 'Du Hast', artist = 'Rammstein', duration = '235'] = process.argv.slice(2);
const song = { title, artist, duration: Number(duration) };
const ORDER = ['kick', 'snare', 'hihat', 'tom', 'floor', 'ride', 'crash'];

const charts = await findCharts(song);
console.log(`${charts.length} charts for ${artist} - ${title} (${duration}s)\n`);
for (const c of charts) {
  let parsed;
  try {
    parsed = await loadChart(c);
  } catch (e) {
    console.log(`fit ${c.fit} | ${c.charter} | ${c.length.toFixed(0)}s | type ${c.drumType} | ERROR ${e.message}\n`);
    continue;
  }
  console.log(`fit ${c.fit} | ${c.artist} - ${c.name} | by ${c.charter} | ${c.length.toFixed(0)}s | enchor type ${c.drumType} `
    + `| ${parsed.format}, parsed type ${parsed.drumType}, ${parsed.difficulty} of [${parsed.available}] | ${parsed.notes.length} notes | real kit notes: ${parsed.real ? 'yes' : 'no'}, open hi-hats ${parsed.notes.filter((n) => n.open).length} | md5 ${c.md5}`);
  const STEP = 15;
  const end = parsed.notes[parsed.notes.length - 1].t;
  for (let from = 0; from < end; from += STEP) {
    const count = {};
    for (const n of parsed.notes) if (n.t >= from && n.t < from + STEP) count[n.pad] = (count[n.pad] || 0) + 1;
    const line = ORDER.filter((p) => count[p]).map((p) => `${p} ${count[p]}`).join(', ');
    console.log(`  ${String(from).padStart(3)}s  ${line || '-'}`);
  }
  console.log();
}
