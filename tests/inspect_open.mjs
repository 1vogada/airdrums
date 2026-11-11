// How the open hi-hat marks of a song's best chart are spread: per 15 seconds,
// closed and open hi-hat hits. Run: node tests/inspect_open.mjs "Du Hast" "Rammstein" 235
import { findCharts, loadChart } from '../js/charts.js';

const [title = 'Du Hast', artist = 'Rammstein', duration = '235'] = process.argv.slice(2);
const charts = await findCharts({ title, artist, duration: Number(duration) });
const parsed = await loadChart(charts[0]);
console.log(`${charts[0].charter} | real kit notes: ${parsed.real ? 'yes' : 'no'}`);
const hats = parsed.notes.filter((n) => n.pad === 'hihat');
for (let from = 0; from < hats.at(-1).t; from += 15) {
  const here = hats.filter((n) => n.t >= from && n.t < from + 15);
  if (!here.length) continue;
  const open = here.filter((n) => n.open).length;
  console.log(`  ${String(from).padStart(3)}s  closed ${String(here.length - open).padStart(3)}  open ${String(open).padStart(3)}  ${here.slice(0, 24).map((n) => (n.open ? 'o' : 'x')).join('')}`);
}
