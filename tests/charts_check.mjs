// Live check: find and parse real drum charts. Run: node tests/charts_check.mjs
import { findCharts, loadChart, lyricShift, search, remembered, advancedByHash, realKit } from '../js/charts.js';
import { chartSite } from '../js/net.js';
import { syncedLyrics } from '../js/lyrics.js';

chartSite.set({ gap: 1000 });            // a test is no reason to hurry: at most one search a second

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

// every request for a chart package that leaves this process
const realFetch = globalThis.fetch;
let fileRequests = 0;
globalThis.fetch = (url, init) => {
  if (String(url).startsWith('https://files.enchor.us/')) fileRequests++;
  return realFetch(url, init);
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
let first = null;                         // the first chart that loaded, for the checks after the songs
for (const song of SONGS) {
  try {
    const charts = await findCharts(song);
    if (!charts.length) { console.log(`--  ${song.artist} - ${song.title}: no chart`); continue; }
    const c = charts[0];
    const parsed = await loadChart(c);
    first ||= c;
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

function check(what, ok, got) {
  if (!ok) failed++;
  console.log(`${ok ? 'ok ' : 'BAD'} ${what}${ok ? '' : `: got ${JSON.stringify(got)}`}`);
}

if (!first) {
  failed++;
  console.log('BAD no chart loaded, so the checks below could not run');
} else {
  try {
    // The notes file is read once per version: another level, or Play after the song page, asks for nothing.
    const before = fileRequests;
    const again = await loadChart(first, 'easy');
    check(`the notes file of a version is read once: its ${again.difficulty} level came with no new request`, fileRequests === before && again.notes.length > 0, fileRequests - before);
    check('a load tells whether the version is a real-kit chart', typeof realKit(first.md5) === 'boolean', realKit(first.md5));

    // The lookup the search screen calls: songs, the one asked for by name first.
    const found = await search('everlong foo fighters');
    const top = found.songs[0];
    console.log(`    search "everlong foo fighters": ${found.songs.length} songs from ${found.found} charts; first: ${top?.artist} - ${top?.title}, ${top?.charts.length} versions, `
      + `to play first: by ${top?.charts[0].charter}${top?.charts[0].labels.length ? ` [${top.charts[0].labels}]` : ''}`);
    check('search() puts the song asked for by title and artist first, with its versions', top?.exact === 2 && /everlong/i.test(top.title) && top.charts.length >= 2 && found.usedQuery === 'everlong foo fighters', [top?.title, top?.exact]);
    check('...and a version of it is found again in memory', remembered(top?.charts[0].md5)?.song.key === top?.key);
    // the chart site does not fold accents: a wrong one finds nothing, and the search asks again without it
    const folded = await search('rammstéin du hast');
    check(`a search that finds nothing is tried again by itself: "rammstéin du hast" shows results for "${folded.usedQuery}" (${folded.songs.length} songs)`,
      folded.songs.length > 0 && folded.usedQuery === 'rammstein du hast' && folded.tried.length === 2, [folded.usedQuery, folded.tried, folded.songs.length]);

    // The song page opens a version by its md5 with the chart site's advanced search.
    const one = await advancedByHash(first.md5);
    check(`advancedByHash() finds a version by its md5 (${first.artist} - ${first.name} by ${first.charter})`,
      one?.chart.md5 === first.md5 && one.chart.name === first.name && one.chart.charter === first.charter && one.song.charts.length === 1, one?.chart);

    // A browser only hands that answer to the page when it carries Access-Control-Allow-Origin,
    // and it first asks (OPTIONS) whether a JSON POST from the site's address is allowed at all.
    const ORIGIN = 'https://1vogada.github.io';
    const ADVANCED = 'https://api.enchor.us/search/advanced';
    const asBrowser = async (init) => {
      for (let i = 1; ; i++) {
        await pause(1200);
        const res = await realFetch(ADVANCED, init);
        await res.arrayBuffer();
        if (res.status < 500 || i >= 3) return res;
        await pause(2000);
      }
    };
    const post = await asBrowser({
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ hash: first.md5, instrument: 'drums', difficulty: null, drumType: null, drumsReviewed: false, source: 'website', page: 1, per_page: 25 }),
    });
    const allowed = post.headers.get('access-control-allow-origin');
    const postOk = post.ok && (allowed === '*' || allowed === ORIGIN);
    check(`the advanced search, asked the way a page on ${ORIGIN} asks: ${post.status}, Access-Control-Allow-Origin: ${allowed ?? 'MISSING'}`, postOk, [post.status, allowed]);
    const ask = await asBrowser({ method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
    const askAllowed = ask.headers.get('access-control-allow-origin'), askHeaders = ask.headers.get('access-control-allow-headers') || '';
    const askOk = ask.ok && (askAllowed === '*' || askAllowed === ORIGIN) && (askHeaders === '*' || /content-type/i.test(askHeaders));
    check(`...and the browser's question before it (OPTIONS): ${ask.status}, Access-Control-Allow-Origin: ${askAllowed ?? 'MISSING'}, allowed headers: ${askHeaders || 'MISSING'}`, askOk, [ask.status, askAllowed, askHeaders]);
    if (!postOk || !askOk) {
      console.log('!!! A BROWSER WILL NOT LET THE SITE READ THE ADVANCED SEARCH. The song page cannot look a version up by its md5:');
      console.log('!!! it has to fall back to a normal search ("title artist") or to "That version is gone. Search for the song again."');
    }
  } catch (e) {
    failed++;
    console.log(`ERR the checks after the songs: ${e.message}`);
  }
}

console.log(failed ? `${failed} FAILED` : 'all good');
process.exit(failed ? 1 : 0);
