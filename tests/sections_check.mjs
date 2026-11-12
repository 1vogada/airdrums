// Which parts (Intro, Verse 1, Chorus...) the charts of a few songs name, and when.
//   node tests/sections_check.mjs ["song artist" ...]
import { searchCharts, loadChart } from '../js/charts.js';

const songs = process.argv.slice(2);
if (!songs.length) songs.push('everlong foo fighters', 'du hast rammstein', 'smells like teen spirit nirvana', 'chop suey system of a down');

async function retry(run, tries = 4) {
  for (let i = 1; ; i++) {
    try { return await run(); } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
}

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
let withParts = 0, looked = 0;
for (const q of songs) {
  const found = await retry(() => searchCharts(q));
  const seen = new Set();
  // one Rock Band chart (.mid) and one other, where there are both
  const picks = [found.find((c) => /harmonix/i.test(c.charter)), found.find((c) => !/harmonix/i.test(c.charter))].filter(Boolean);
  for (const c of picks) {
    if (seen.has(c.md5)) continue;
    seen.add(c.md5);
    const parsed = await retry(() => loadChart(c));
    looked++;
    if (parsed.sections.length) withParts++;
    console.log(`\n${c.artist} - ${c.name} by ${c.charter} (${parsed.format}): ${parsed.sections.length} parts`);
    console.log('  ' + parsed.sections.map((s) => `${clock(s.t)} ${s.name}`).join(' | '));
  }
}
console.log(`\n${withParts} of ${looked} charts name their parts`);
