// Charts turned into songs, the second tries, and the lookup the screens call.
//   node tests/catalog_check.mjs
// Nothing here touches the network: the chart site and its files are made up
// below (hand-written rows in the shape the real site answers with, a
// hand-written notes file, a package built in memory).
import { isDeepStrictEqual } from 'node:util';
import {
  slim, songs, retries, labels, plainName, hidden, isReal, busy, badge, exactness, findSong, findVersion, matching, artUrl, fold, LEVELS,
} from '../js/catalog.js';
import { norm, cleanTitle, songKey } from '../js/text.js';
import { chartSite, isAbort } from '../js/net.js';
import * as charts from '../js/charts.js';

let failed = 0;
function check(what, ok, got) {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : `: got ${JSON.stringify(got)}`}`);
}

// ---- rows shaped like the chart site's ------------------------------------------

// One answer row with every field the real site sends (the list in docs/v2/facts.md), values made up.
let lastId = 0;
const md5Of = (n) => 'f1'.repeat(14) + n.toString(16).padStart(4, '0');
function row(over = {}) {
  const id = ++lastId;
  const { levels = { expert: 240, easy: 96 }, lyrics = false, twoKick = false, drumType = 1, effectiveLength, issues = [], ...rest } = over;
  const length = rest.song_length ?? 60000;
  return {
    ordering: id, encoderVersion: 1,
    name: 'Test Song', artist: 'The Fixtures', album: 'Test Album', genre: 'Rock', year: '2020',
    chartName: null, chartAlbum: null, chartGenre: null, chartYear: null,
    chartId: 400000 + id, songId: null, groupId: -(400000 + id), chartDriveChartId: 410000 + id,
    albumArtMd5: 'c0ffee00c0ffee00c0ffee00c0ffee00', md5: md5Of(id), chartHash: 'Zml4dHVyZQ==', versionGroupId: 400000 + id,
    charter: 'Fixture A', song_length: length,
    diff_band: -1, diff_guitar: -1, diff_guitar_coop: -1, diff_rhythm: -1, diff_bass: -1, diff_drums: 2, diff_drums_real: -1,
    diff_keys: -1, diff_guitarghl: -1, diff_guitar_coop_ghl: -1, diff_rhythm_ghl: -1, diff_bassghl: -1, diff_vocals: -1,
    preview_start_time: -1, icon: '', loading_phrase: '', album_track: 1, playlist_track: 16000,
    modchart: false, delay: 0, chart_offset: 0, hopo_frequency: 0, eighthnote_hopo: false, multiplier_note: 0,
    sustain_cutoff_threshold: -1, chord_snap_threshold: 0, video_start_time: 0,
    five_lane_drums: false, pro_drums: true, end_events: true,
    notesData: {
      instruments: ['guitar', 'drums'], drumType, hasSoloSections: false, hasLyrics: lyrics, hasVocals: lyrics,
      hasForcedNotes: false, hasTapNotes: false, hasOpenNotes: false, has2xKick: twoKick, hasFlexLanes: false,
      chartIssues: issues,
      noteCounts: [
        { instrument: 'guitar', difficulty: 'expert', count: 999 },
        ...Object.entries(levels).map(([difficulty, count]) => ({ instrument: 'drums', difficulty, count })),
      ],
      maxNps: [{ instrument: 'drums', difficulty: 'expert', nps: 8, time: 1000 }],
      trackHashes: Object.keys(levels).map((difficulty) => ({ instrument: 'drums', difficulty, hash: 'aGFzaA==' })),
      tempoMapHash: 'deadbeefdeadbeef', tempoMarkerCount: 1, effectiveLength: effectiveLength ?? length - 500,
    },
    folderIssues: [], metadataIssues: [], hasVideoBackground: false,
    modifiedTime: '2025-01-01T00:00:00.000Z', applicationDriveId: 'drive-fixture', applicationUsername: 'fixture',
    drumsReviewed: true, packName: null,
    ...rest,
  };
}
const ALL_LEVELS = { expert: 300, hard: 220, medium: 150, easy: 90 };

// The six-row answer of the browser rig (item B02 of the spec): two charts of Test Song, the first one
// again (the site sends one row per copy of a chart), a whole album, a live version, and another song.
const A = row({ charter: 'Fixture A', lyrics: true, levels: { expert: 240, easy: 96 } });
const B = row({ charter: 'Fixture B', levels: { expert: 250 } });
const A_AGAIN = { ...A, chartDriveChartId: A.chartDriveChartId + 50, applicationDriveId: 'drive-other', packName: 'Fixture Pack' };
const ALBUM = row({ name: 'Test Album (Full Album)', charter: 'Fixture A', song_length: 43 * 60000, levels: { expert: 9000 } });
const LIVE = row({ name: 'Test Song (Live)', charter: 'Fixture C', lyrics: true, levels: ALL_LEVELS });
const OTHER = row({ name: 'Other Song', artist: 'Someone Else', album: 'Other Album', charter: 'Fixture D' });
const SIX = [A, B, A_AGAIN, ALBUM, LIVE, OTHER];

// ---- slim(): what is kept of a row ------------------------------------------------
{
  const raw = row({
    name: '  Floaty Fixture  ', year: '1964 (July 10)', genre: 'Post-Grunge', song_length: 271252, effectiveLength: 266262.195,
    diff_drums: 4, delay: 250, chart_offset: -100, lyrics: true, twoKick: true, drumType: 2, levels: { easy: 400, expert: 1770, hard: 1204 },
    packName: 'Fixture Band 2 DLC', modifiedTime: '2024-03-16T21:47:16.000Z', albumArtMd5: '506b69b3c723614c15f62800fb2b550f',
  });
  const s = slim(raw);
  check('slim keeps exactly these fields', isDeepStrictEqual(s, {
    md5: raw.md5, name: 'Floaty Fixture', artist: 'The Fixtures', album: 'Test Album', year: 1964, genre: 'Post-Grunge',
    charter: 'Fixture A', length: 271.252, playLength: 266.262, tier: 4, levels: { expert: 1770, hard: 1204, easy: 400 },
    nps: 6.65, drumType: 2, lyrics: true, twoKick: true, delay: 0.15, notes: 1770,
    art: '506b69b3c723614c15f62800fb2b550f', pack: 'Fixture Band 2 DLC', modified: Date.parse('2024-03-16T21:47:16.000Z'),
  }), s);
  check('...the levels in the order expert, hard, medium, easy', Object.keys(s.levels).join() === 'expert,hard,easy', Object.keys(s.levels));

  // what searchCharts() gave before version 2, field for field
  const before = {
    md5: raw.md5, name: raw.name || '', artist: raw.artist || '', album: raw.album || '', charter: raw.charter || '',
    length: (raw.song_length || 0) / 1000, drumType: raw.notesData?.drumType ?? 0, lyrics: Boolean(raw.notesData?.hasLyrics),
    delay: (raw.delay || 0) / 1000 + (raw.chart_offset || 0) / 1000,
    notes: Math.max(0, ...(raw.notesData?.noteCounts || []).filter((n) => n.instrument === 'drums').map((n) => n.count)),
  };
  check('...and every field today\'s callers read has the value it had (name only loses its outer spaces)',
    Object.keys(before).every((k) => (k === 'name' ? s.name === before.name.trim() : isDeepStrictEqual(s[k], before[k]))), [s, before]);

  const bare = slim({ md5: 'x' });
  check('a row with nothing but an md5 still gives a whole record', isDeepStrictEqual(bare, {
    md5: 'x', name: '', artist: '', album: '', year: 0, genre: '', charter: '', length: 0, playLength: 0, tier: -1, levels: {},
    nps: 0, drumType: 0, lyrics: false, twoKick: false, delay: 0, notes: 0, art: '', pack: '', modified: 0,
  }), bare);
  check('a year written as "October 16, 1965" is 1965, an unknown one is 0',
    slim(row({ year: 'October 16, 1965' })).year === 1965 && slim(row({ year: 'unknown' })).year === 0 && slim(row({ year: null })).year === 0);
  check('an unknown drum tier (-1) stays unknown', slim(row({ diff_drums: -1 })).tier === -1 && busy(slim(row({ diff_drums: -1 })).tier) === null);

  const issues = Array.from({ length: 700 }, (_, i) => ({
    instrument: 'guitar', difficulty: 'expert', noteIssue: 'brokenNote', description: `Fixture issue ${i}: the note at tick ${i * 480} is closer than 15 ms to the one before it`,
  }));
  const big = row({ issues, lyrics: true, levels: ALL_LEVELS, packName: 'Fixture Band Network' });
  const bigBytes = Buffer.byteLength(JSON.stringify(big)), slimBytes = Buffer.byteLength(JSON.stringify(slim(big)));
  check('slim() of a 70 KB row is under 700 bytes', bigBytes > 70000 && slimBytes < 700, [bigBytes, slimBytes]);
  check('...an everyday row comes out at about 400 bytes', Buffer.byteLength(JSON.stringify(slim(A))) < 480, Buffer.byteLength(JSON.stringify(slim(A))));
  const long = 'x'.repeat(400);
  const worst = slim(row({
    name: long, artist: long, album: long, genre: long, charter: long, packName: long, year: '1999', song_length: 25500507, effectiveLength: 2580123.456,
    diff_drums: 10, delay: -3500, levels: { expert: 12345, hard: 12345, medium: 12345, easy: 12345 }, modifiedTime: '2026-11-11T23:59:59.000Z',
  }));
  check('...and even a row with endless names stays under 700', JSON.stringify(worst).length < 700, JSON.stringify(worst).length);
}

// ---- songs(): the six rows ---------------------------------------------------------
{
  const list = songs(SIX);
  const test = list[0];
  check('six rows become 2 songs: Test Song and Other Song', list.length === 2 && test.title === 'Test Song' && list[1].title === 'Other Song', list.map((s) => s.title));
  check('Test Song has 3 versions, the chart that came twice only once',
    test.charts.length === 3 && test.charts.filter((c) => c.md5 === A.md5).length === 1, test.charts.map((c) => c.charter));
  check('the 43-minute album chart is not there', !list.some((s) => s.charts.some((c) => c.md5 === ALBUM.md5)));
  const last = test.charts[2];
  check('the live version is labelled Live and comes last (though it has lyrics and all four levels)',
    last.md5 === LIVE.md5 && last.labels.join() === 'Live' && test.charts.slice(0, 2).every((c) => c.labels.length === 0), test.charts.map((c) => [c.charter, c.labels]));
  check('the version to play first is the one by Fixture A (it has lyrics)', test.charts[0].charter === 'Fixture A' && test.charts[1].charter === 'Fixture B', test.charts.map((c) => c.charter));
  check('a song says what a row shows: title, artist, album, year, picture, length',
    test.artist === 'The Fixtures' && test.album === 'Test Album' && test.year === 2020 && test.art === A.albumArtMd5 && test.length === 59.5 && test.labels.length === 0, test);
  check('a song is filed under the same key as in the library', list.every((s) => s.key === songKey(s.title, s.artist)) && test.key === 'thefixtures|testsong', list.map((s) => s.key));
  check('the versions are slim records, not the raw rows', test.charts.every((c) => !('notesData' in c) && c.levels && JSON.stringify(c).length < 700));
  check('songs() leaves the rows it was given alone', !('labels' in A) && !('labels' in slim(A)));
  const kept = songs(SIX.map(slim));
  check('rows that were already cut down give the same songs', isDeepStrictEqual(kept, list), kept.map((s) => s.title));
  const fromLibrary = songs([{ md5: 'aaa', name: 'Everlong', artist: 'Foo Fighters', charter: 'Harmonix', length: 250 }]);
  check('a version kept by an older library (fewer fields) still makes a song', fromLibrary.length === 1 && fromLibrary[0].charts[0].levels && fromLibrary[0].length === 250, fromLibrary);
  check('with { hide: false } the album is listed too (a version opened by its address)', songs(SIX, { hide: false }).some((s) => s.title === 'Test Album (Full Album)'));
  check('no rows, no songs', songs([]).length === 0 && songs(null).length === 0 && songs([{ name: 'no md5' }]).length === 0);
}

// ---- what is hidden, what is labelled ---------------------------------------------
{
  const v = (name, more = {}) => slim(row({ name, ...more }));
  check('hidden: over 15 minutes', hidden(v('Long Jam', { song_length: 16 * 60000 })) && !hidden(v('Long Jam', { song_length: 14 * 60000 })));
  check('hidden: "Full Album" in the name, whatever its length', hidden(v('Fixtures Full Album')) && hidden(v('Fixtures (FULL ALBUM)')));
  check('hidden: 6 Fret uploads', hidden(v('Test Song (6 Fret)')) && hidden(v('Test Song [6-fret]')) && !hidden(v('Test Song')));
  check('not hidden: a 4-minute song the site gives a wrong length of 7 hours', !hidden(v('Test Song', { song_length: 25500507, effectiveLength: 232000 })));

  const says = (name, more) => labels(v(name, more)).join();
  check('labels from brackets: Live, Acoustic, Demo, Remix, Cover',
    says('Song (Live)') === 'Live' && says('Song [Acoustic]') === 'Acoustic' && says('Song (Demo)') === 'Demo'
    && says('Song (Fixture Remix)') === 'Remix' && says('Song (The Fixtures Cover)') === 'Cover', [says('Song (Live)'), says('Song (Fixture Remix)')]);
  check('labels after a dash, and two at once', says('Song - Live at the Fixture Hall') === 'Live' && says('Song (Live) (Acoustic)') === 'Live,Acoustic', says('Song (Live) (Acoustic)'));
  check('a title is not a label: Live Forever, Cover Me, Demolition', says('Live Forever') === '' && says('Cover Me') === '' && says('Demolition (Album Version)') === '');
  check('2x pedal from the name', says('Song (2x Bass Pedal)') === '2x pedal' && says('Song (Double Bass)') === '2x pedal' && says('Song (Expert+)') === '2x pedal', says('Song (2x Bass Pedal)'));
  check('2x pedal from the chart itself (has2xKick)', says('Song', { twoKick: true }) === '2x pedal' && says('Song (Live)', { twoKick: true }) === 'Live,2x pedal');
  check('the name without its remarks', plainName('Song (Live) (2x Bass Pedal)') === 'Song' && plainName('Song [Acoustic]') === 'Song'
    && plainName('Song (feat. Someone)') === 'Song (feat. Someone)' && plainName('(Live)') === '(Live)', plainName('Song (Live) (2x Bass Pedal)'));
}

// ---- which version comes first ----------------------------------------------------
{
  const first = (rows, opts) => songs(rows, opts)[0].charts.map((c) => c.charter).join();
  const plain = { name: 'Song', artist: 'Band' };
  check('unlabelled before labelled, whatever else the labelled one has',
    first([row({ ...plain, name: 'Song (2x Bass Pedal)', charter: 'Harmonix', lyrics: true, levels: ALL_LEVELS }), row({ ...plain, charter: 'P', drumType: 0, levels: { expert: 9 } })]) === 'P,Harmonix');
  check('then real kit: Rock Band\'s own charts (Harmonix) are taken to be',
    first([row({ ...plain, charter: 'P', lyrics: true, levels: ALL_LEVELS }), row({ ...plain, charter: 'Harmonix', levels: { expert: 9 } })]) === 'Harmonix,P');
  const p = row({ ...plain, charter: 'P' }), h = row({ ...plain, charter: 'Harmonix' });
  check('...until a load says otherwise', first([p, h], { real: (md5) => (md5 === h.md5 ? false : undefined) }) === 'P,Harmonix'
    && first([h, p], { real: (md5) => (md5 === p.md5 ? true : md5 === h.md5 ? false : undefined) }) === 'P,Harmonix');
  check('...and a flag stored on the version itself counts too', first([slim(h), { ...slim(p), real: true }].map((x) => (x.charter === 'Harmonix' ? { ...x, real: false } : x))) === 'P,Harmonix'
    && isReal({ charter: 'Harmonix' }) && !isReal({ charter: 'Harmonix', real: false }) && isReal({ charter: 'P', md5: 'm' }, () => true) && !isReal({ charter: 'P' }));
  check('then lyrics', first([row({ ...plain, charter: 'P', levels: ALL_LEVELS }), row({ ...plain, charter: 'Q', lyrics: true, drumType: 0, levels: { expert: 9 } })]) === 'Q,P');
  check('then cymbals told apart', first([row({ ...plain, charter: 'P', drumType: 0, levels: ALL_LEVELS }), row({ ...plain, charter: 'Q', drumType: 1, levels: { expert: 9 } })]) === 'Q,P');
  check('then more levels', first([row({ ...plain, charter: 'P', levels: { expert: 9 } }), row({ ...plain, charter: 'Q', levels: { expert: 9, hard: 5 } })]) === 'Q,P');
  check('then the newest', first([row({ ...plain, charter: 'P', modifiedTime: '2022-01-01T00:00:00.000Z' }), row({ ...plain, charter: 'Q', modifiedTime: '2024-01-01T00:00:00.000Z' })]) === 'Q,P');

  // a charter's updated upload is a new md5 with the same name: only the newer one is kept
  const old = row({ ...plain, charter: 'Fixture M', modifiedTime: '2024-06-09T00:00:00.000Z' });
  const renewed = row({ ...plain, charter: 'Fixture M', modifiedTime: '2025-03-22T00:00:00.000Z' });
  const both = songs([old, renewed, row({ ...plain, charter: 'Other Charter' })]);
  check('a charter\'s older upload of the same title is dropped', both[0].charts.length === 2 && both[0].charts.some((c) => c.md5 === renewed.md5) && !both[0].charts.some((c) => c.md5 === old.md5),
    both[0].charts.map((c) => [c.charter, c.modified]));
  check('...whichever of the two the site lists first', songs([renewed, old])[0].charts.length === 1 && songs([renewed, old])[0].charts[0].md5 === renewed.md5);
  check('...but the same charter\'s 2x pedal version of it is another version',
    songs([old, row({ ...plain, name: 'Song (2x Bass Pedal)', charter: 'Fixture M' })])[0].charts.length === 2);
}

// ---- which song comes first -------------------------------------------------------
{
  const rows = [
    row({ name: 'Only Stage (Live)', artist: 'The Fixtures', charter: 'O' }),         // a song that only exists live
    row({ name: 'Everfix Now', artist: 'The Fixtures', charter: 'N' }),
    row({ name: 'Everfix', artist: 'Cover Band', charter: 'C' }),
    row({ name: 'Everfix (Live)', artist: 'The Fixtures', charter: 'L' }),            // a live version of the song two rows down
    row({ name: 'The Fixtures', artist: 'Someone Else', charter: 'S' }),
    row({ name: 'Everfix', artist: 'The Fixtures', charter: 'F' }),
  ];
  const order = (query) => songs(rows, { query }).map((s) => `${s.artist}: ${s.title}${s.labels.length ? ' [' + s.labels + ']' : ''}`);
  check('with nothing typed: the site\'s order of first appearance, songs that only exist as live last',
    isDeepStrictEqual(order(''), ['The Fixtures: Everfix Now', 'Cover Band: Everfix', 'The Fixtures: Everfix', 'Someone Else: The Fixtures', 'The Fixtures: Only Stage [Live]']), order(''));
  const everfix = songs(rows).find((s) => s.title === 'Everfix' && s.artist === 'The Fixtures');
  check('a live version joins the song it is a version of, behind the plain one', everfix.charts.map((c) => c.charter).join() === 'F,L' && everfix.labels.length === 0, everfix.charts.map((c) => c.charter));
  check('the words typed equal title plus artist: that song first, above a cover the site listed higher',
    order('everfix the fixtures')[0] === 'The Fixtures: Everfix' && order('Fixtures  EVERFIX')[0] === 'The Fixtures: Everfix', order('everfix the fixtures'));
  check('...then songs whose title or artist is exactly what was typed',
    isDeepStrictEqual(order('everfix').slice(0, 2), ['Cover Band: Everfix', 'The Fixtures: Everfix']) && order('cover band')[0] === 'Cover Band: Everfix', order('everfix'));
  check('...also when that song only exists live', order('only stage')[0] === 'The Fixtures: Only Stage [Live]', order('only stage'));
  const s = { title: 'Don\'t Stop Believin\'', artist: 'Jöurney, Someone' };
  check('typed words are compared without accents, apostrophes, case or "the"',
    exactness(s, 'dont stop believin journey') === 2 && exactness(s, 'JOURNEY don\'t stop believin\'') === 2 && exactness(s, 'the journey') === 1
    && exactness(s, 'dont stop') === 0 && exactness(s, '') === 0 && exactness({ title: 'Song - Remastered 2011', artist: 'Band' }, 'song band') === 2);
  check('the exact rank is on the song', songs(rows, { query: 'everfix the fixtures' })[0].exact === 2 && songs(rows, { query: 'everfix' })[0].exact === 1 && songs(rows)[0].exact === 0);
}

// ---- keys, finding, the row's badge -------------------------------------------------
{
  const kept = new Map();
  globalThis.localStorage = { getItem: (k) => (kept.has(k) ? kept.get(k) : null), setItem: (k, v) => kept.set(k, String(v)), removeItem: (k) => kept.delete(k) };
  const lib = await import('../js/library.js');
  const names = [['Everlong', 'Foo Fighters'], ['Everlong - Remastered 2011', 'Foo Fighters, Someone Else'], ['Back In Black', 'AC/DC'], ['Chop Suey!', 'System Of A Down'],
    ['Déjà Vu (feat. Someone)', 'Beyoncé'], ['Ace of Spades', 'Motörhead'], ['', ''], [undefined, undefined]];
  check('the song key is the library\'s key for names written with a to z', names.every(([t, a]) => songKey(t, a) === lib.songKey(t, a)), names.map(([t, a]) => [songKey(t, a), lib.songKey(t, a)]));
  check('the chart lookup still hands out the name helpers', charts.norm === norm && charts.cleanTitle === cleanTitle && norm('AC/DC') === 'acdc' && cleanTitle('Song - Remastered 2011') === 'Song');
  const kana = songs([row({ name: '紅蓮華', artist: 'リサ' }), row({ name: '炎', artist: 'リサ' }), row({ name: 'Кино', artist: 'Группа' })]);
  check('songs whose names are not written with a to z stay apart', kana.length === 3 && new Set(kana.map((s) => s.key)).size === 3 && !kana.some((s) => s.key.endsWith('|')), kana.map((s) => s.key));

  const list = songs(SIX);
  check('findSong: the song with exactly this title and artist', findSong(list, 'Test Song - Remastered', 'The Fixtures, Guest')?.title === 'Test Song'
    && findSong(list, 'Test', 'The Fixtures') === null && findSong(list, 'Test Song', 'Someone Else') === null);
  const hit = findVersion(list, B.md5);
  check('findVersion: the song a version belongs to', hit?.song.title === 'Test Song' && hit.chart.charter === 'Fixture B' && findVersion(list, ALBUM.md5) === null);

  const mine = [{ title: 'Other Song', artist: 'Someone Else', album: 'Test Album' }, { title: 'Test Song', artist: 'The Fixtures' }, { title: 'Évérfix', artist: 'Foo Fixers', charts: [] }];
  const titles = (query) => matching(mine, query).map((s) => s.title).join();
  check('your own songs that fit what is being typed: every word begins a word of the title, artist or album',
    titles('tes') === 'Other Song,Test Song' && titles('so tes') === 'Other Song,Test Song' && titles('fix') === 'Test Song,Évérfix' && titles('everf foo') === 'Évérfix' && titles('zzz') === '' && titles('est') === '', [titles('tes'), titles('fix')]);
  check('...the one asked for by name first, and nothing while nothing is typed', titles('test song') === 'Test Song,Other Song' && titles('') === '' && titles('the') === '' && matching(null, 'x').length === 0, titles('test song'));
  check('findVersion copes with a library song that has no versions', findVersion(mine, 'x') === null);

  const [a, b, live] = list[0].charts;
  check('a row gets one badge: a caution before a plus',
    isDeepStrictEqual(badge(live), { text: 'Live', caution: true }) && isDeepStrictEqual(badge(b), { text: 'Expert only', caution: true })
    && isDeepStrictEqual(badge(a), { text: 'Auto sync', caution: false }) && isDeepStrictEqual(badge({ ...a, real: true }), { text: 'Real kit', caution: false })
    && isDeepStrictEqual(badge(a, () => true), { text: 'Real kit', caution: false }) && badge({ ...a, lyrics: false }) === null, [badge(live), badge(b), badge(a)]);
  check('how busy, from the site\'s tier', busy(0).word === 'Gentle' && busy(1).dots === 1 && busy(3).word === 'Moderate' && busy(5).word === 'Busy' && busy(6).word === 'Intense' && busy(10).dots === 4 && busy(-1) === null && busy(undefined) === null);
  check('the picture address: the chart site\'s by md5, any other link as it is',
    artUrl(a.art) === 'https://files.enchor.us/c0ffee00c0ffee00c0ffee00c0ffee00.jpg' && artUrl('https://example.test/cover.jpg') === 'https://example.test/cover.jpg' && artUrl('') === '');
  check('the levels a version can have', LEVELS.join() === 'expert,hard,medium,easy');
}

// ---- second tries -----------------------------------------------------------------
{
  check('an accented query is tried again with the accents folded', isDeepStrictEqual(retries('Motörhead'), ['Motorhead']) && retries('Beyoncé déjà vu')[0] === 'Beyonce deja vu', retries('Motörhead'));
  check('a query ending in an apostrophe loses only that apostrophe', retries('don\'t stop believin\'')[0] === 'don\'t stop believin', retries('don\'t stop believin\''));
  check('the second retry drops the last word', isDeepStrictEqual(retries('don\'t stop believin\''), ['don\'t stop believin', 'don\'t stop'])
    && isDeepStrictEqual(retries('everlong xyzzy'), ['everlong']) && isDeepStrictEqual(retries('Motörhead ace of spadez'), ['Motorhead ace of spadez', 'Motorhead ace of']), retries('everlong xyzzy'));
  check('other punctuation at the very end goes too, punctuation inside stays', isDeepStrictEqual(retries('chop suey!'), ['chop suey', 'chop']) && isDeepStrictEqual(retries('guns n\' roses'), ['guns n']) && retries('ac/dc').length === 0, retries('chop suey!'));
  check('never more than two, never the query itself, none for one plain word',
    ['everlong', '', '   ', 'ø', 'a b c d e\'', 'Sigur Rós!'].every((q) => retries(q).length <= 2 && !retries(q).includes(q.trim())) && retries('everlong').length === 0 && retries('').length === 0 && retries(undefined).length === 0);
  check('letters the chart site spells out are spelled out', fold('Mø Ænima Motörhead Straße') === 'Mo AEnima Motorhead Strasse', fold('Mø Ænima Motörhead Straße'));
}

// ---- the lookup, against a made-up chart site --------------------------------------
const realFetch = globalThis.fetch;
chartSite.set({ gap: 0, retryWait: 0, busyWait: 0 });                // no real waiting here: tests/net_check.mjs proves the pacing
const sent = [];                                                    // every request to the search: { path, body }
const ranges = [];                                                  // every range request for a file: { md5, range }
let site = () => ({});                                              // (path, body, signal) => { status, body }
const packages = new Map();                                         // md5 -> the bytes of its made-up .sng
let filesDown = false;
const answer = (rows, found = new Set(rows.map((r) => r.md5)).size) => ({ body: { found, out_of: 26011, page: 1, data: rows, search_time_ms: 3 } });
const calledOff = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.enchor.us')) {
    if (init.signal?.aborted) throw calledOff();
    const body = JSON.parse(init.body);
    sent.push({ path: u.slice('https://api.enchor.us'.length), body, method: init.method, type: init.headers?.['Content-Type'] });
    const a = (await site(sent[sent.length - 1].path, body, init.signal)) || {};
    return { status: a.status ?? 201, json: async () => a.body ?? { found: 0, data: [] } };
  }
  if (u.startsWith('https://files.enchor.us/')) {
    const md5 = u.slice('https://files.enchor.us/'.length).replace(/\.sng$/, '');
    const m = /^bytes=(\d+)-(\d+)$/.exec(init.headers?.Range || '');
    ranges.push({ md5, range: init.headers?.Range });
    const pack = packages.get(md5);
    if (filesDown || !pack || !m) return { ok: false, status: filesDown ? 503 : 404, arrayBuffer: async () => new ArrayBuffer(0) };
    const part = pack.slice(Number(m[1]), Number(m[2]) + 1);
    return { ok: true, status: 206, arrayBuffer: async () => part.buffer };
  }
  throw new Error(`a request to somewhere unexpected: ${u}`);
};
const caught = async (promise) => { try { await promise; return null; } catch (e) { return e; } };

{
  site = () => answer(SIX);
  const got = await charts.searchCharts('test');
  check('searchCharts asks the search for 25 drum charts a page, reviewed or not',
    sent.length === 1 && sent[0].path === '/search' && sent[0].method === 'POST' && sent[0].type === 'application/json' && isDeepStrictEqual(sent[0].body, {
      search: 'test', page: 1, per_page: 25, instrument: 'drums', difficulty: null, drumType: null, drumsReviewed: false, source: 'website',
    }), sent);
  check('...and answers as before: one record per chart, in the site\'s order', Array.isArray(got) && got.map((c) => c.md5).join() === [A, B, ALBUM, LIVE, OTHER].map((r) => r.md5).join(), got.map((c) => c.name));
  const c = got[0];
  check('...with every field its callers read', c.md5 === A.md5 && c.name === 'Test Song' && c.artist === 'The Fixtures' && c.album === 'Test Album' && c.charter === 'Fixture A'
    && c.length === 60 && c.drumType === 1 && c.lyrics === true && c.delay === 0 && c.notes === 240, c);
  check('...and none of the raw rows', got.every((r) => !('notesData' in r)) && JSON.stringify(got).length < 5 * 700);
  await charts.searchCharts('test', { page: 3 });
  check('...another page when asked', sent[1].body.page === 3, sent[1].body);
}

{
  charts.forgetAll(); sent.length = 0;
  site = () => answer(SIX);
  const r = await charts.search('test');
  check('search(): what was typed becomes songs', r.songs.length === 2 && r.songs[0].title === 'Test Song' && r.songs[0].charts.length === 3 && r.songs[0].charts[0].charter === 'Fixture A', r.songs.map((s) => s.title));
  check('...with how many charts the site has, no more to ask for, and the query used', r.found === 5 && r.more === false && r.usedQuery === 'test' && r.query === 'test' && r.page === 1 && isDeepStrictEqual(r.tried, ['test']), r);
  check('...for one request', sent.length === 1, sent.length);
  const again = await charts.search('  TEST ');
  check('the same search again comes from memory: no request', sent.length === 1 && again.songs.length === 2 && isDeepStrictEqual(again.songs, r.songs), sent.length);
  check('...and typed in other capitals it is still the query that was used', again.query === 'TEST' && again.usedQuery === 'TEST' && isDeepStrictEqual(again.tried, ['TEST']), again);
  const named = await charts.search('other song someone else');
  check('the song asked for by title and artist comes first', named.songs[0].title === 'Other Song' && named.songs[0].exact === 2, named.songs.map((s) => [s.title, s.exact]));
  const none = await charts.search('   ');
  check('nothing typed: nothing asked', none.songs.length === 0 && none.more === false && sent.length === 2, sent.length);
}

{
  charts.forgetAll(); sent.length = 0;
  site = (path, body) => (body.search === 'Test Song' ? answer(SIX) : answer([]));
  const r = await charts.search('Tést Sóng');
  check('nothing found: the accents are folded and it is asked again by itself', isDeepStrictEqual(sent.map((s) => s.body.search), ['Tést Sóng', 'Test Song']) && r.songs.length === 2, sent.map((s) => s.body.search));
  check('...and the answer says which query the songs came from', r.query === 'Tést Sóng' && r.usedQuery === 'Test Song' && isDeepStrictEqual(r.tried, ['Tést Sóng', 'Test Song']), r);
  check('...and is remembered under what was typed', (await charts.search('Tést Sóng')).usedQuery === 'Test Song' && sent.length === 2, sent.length);

  charts.forgetAll(); sent.length = 0;
  site = (path, body) => (body.search === 'test song' ? answer(SIX) : answer([]));
  const two = await charts.search('test song xyzzy\'');
  check('still nothing: the last word is dropped', isDeepStrictEqual(sent.map((s) => s.body.search), ['test song xyzzy\'', 'test song xyzzy', 'test song']) && two.usedQuery === 'test song' && two.songs.length === 2 && two.tried.length === 3, sent.map((s) => s.body.search));

  charts.forgetAll(); sent.length = 0;
  site = () => answer([]);
  const nothing = await charts.search('zzz yyy\'');
  check('nothing for any of them: no songs, three requests', nothing.songs.length === 0 && nothing.found === 0 && nothing.more === false && nothing.usedQuery === 'zzz yyy\'' && isDeepStrictEqual(nothing.tried, ['zzz yyy\'', 'zzz yyy', 'zzz']) && sent.length === 3, [nothing, sent.length]);
  await charts.search('zzz yyy\'');
  check('...and "nothing" is not remembered: searching again asks again', sent.length === 6, sent.length);

  charts.forgetAll(); sent.length = 0;
  site = (path, body) => (body.search === 'test album' ? answer([ALBUM]) : answer(SIX));
  const album = await charts.search('test album');
  check('an answer with only a whole-album chart counts as nothing: the second try runs', album.usedQuery === 'test' && album.songs.length === 2 && sent.length === 2, [album.usedQuery, sent.length]);
}

{
  // 60 songs, 25 charts a page
  const many = Array.from({ length: 60 }, (_, i) => row({ name: `Song ${i + 1}`, artist: 'Band' }));
  const paged = (rows, found = rows.length) => (path, body) => answer(rows.slice((body.page - 1) * 25, body.page * 25), found);
  charts.forgetAll(); sent.length = 0;
  site = paged(many);
  const p1 = await charts.search('song');
  check('a first page of 25 with 60 found: there is more', p1.songs.length === 25 && p1.found === 60 && p1.more === true && p1.page === 1, [p1.songs.length, p1.found, p1.more]);
  const p2 = await charts.search('song', { page: 2 });
  check('page 2 is one request, and the songs are those of both pages', sent.length === 2 && sent[1].body.page === 2 && p2.songs.length === 50 && p2.more === true && p2.page === 2 && p2.songs[0].title === 'Song 1' && p2.songs[49].title === 'Song 50', [sent.length, p2.songs.length]);
  const p3 = await charts.search('song', { page: 3 });
  check('page 3 brings the last 10: 3 x 25 is past the 60 found, so no more', p3.songs.length === 60 && p3.more === false && p3.page === 3 && sent.length === 3, [p3.songs.length, p3.more]);
  const p4 = await charts.search('song', { page: 4 });
  check('asking past the end asks nothing', sent.length === 3 && p4.songs.length === 60 && p4.page === 3, sent.length);
  check('going back to page 1 gives everything that is in memory, with no request', (await charts.search('song')).songs.length === 60 && sent.length === 3);

  charts.forgetAll(); sent.length = 0;
  const fresh = await charts.search('song', { page: 3 });
  check('page 3 asked cold asks pages 1, 2 and 3 in turn', isDeepStrictEqual(sent.map((s) => s.body.page), [1, 2, 3]) && fresh.songs.length === 60, sent.map((s) => s.body.page));

  charts.forgetAll(); sent.length = 0;
  const versions = [...many.slice(0, 25), ...many.slice(0, 25).map((r) => row({ name: r.name, artist: 'Band', charter: 'Fixture Z' }))];
  site = paged(versions, 200);
  await charts.search('song');
  const stuck = await charts.search('song', { page: 2 });
  check('a page that brings no new song ends "show more", though it adds versions', stuck.more === false && stuck.songs.length === 25 && stuck.songs[0].charts.length === 2, [stuck.more, stuck.songs.length, stuck.songs[0].charts.length]);

  charts.forgetAll(); sent.length = 0;
  site = paged(many);
  await charts.search('song');
  const [x, y] = await Promise.all([charts.search('song', { page: 2 }), charts.search('song', { page: 2 })]);
  check('page 2 asked twice at once: both get 50 songs and there is still more', x.songs.length === 50 && y.songs.length === 50 && x.more && y.more && x.page === 2, [x.songs.length, y.songs.length, x.more, y.more]);
}

{
  charts.forgetAll(); sent.length = 0;
  let n = 0;
  site = () => (n++ === 0 ? { status: 500 } : answer(SIX));
  const r = await charts.search('test');
  check('the site answers 500 once: asked once more, and the list fills', sent.length === 2 && r.songs.length === 2, sent.length);

  charts.forgetAll(); sent.length = 0;
  site = () => ({ status: 500 });
  const down = await caught(charts.search('test'));
  check('500 twice: the search fails as "the chart site didn\'t answer"', down?.name === 'ChartSiteError' && down.kind === 'down' && /didn't answer/.test(down.message) && sent.length === 2, [down?.kind, down?.message, sent.length]);
  site = () => answer(SIX);
  check('...and a retry asks again and works', (await charts.search('test')).songs.length === 2 && sent.length === 3, sent.length);

  charts.forgetAll(); sent.length = 0;
  site = () => ({ status: 400 });
  const refused = await caught(charts.searchCharts('test'));
  check('a 400 is not asked again', refused?.kind === 'refused' && refused.status === 400 && sent.length === 1, [refused?.kind, sent.length]);

  charts.forgetAll(); sent.length = 0;
  site = (path, body, signal) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(calledOff())));
  const ac = new AbortController();
  const waiting = caught(charts.search('slow', { signal: ac.signal }));
  await new Promise((r) => setTimeout(r, 5));
  ac.abort();
  const off = await waiting;
  check('a search can be called off while the site is thinking', isAbort(off) && sent.length === 1, [off?.name, sent.length]);
  site = () => answer(SIX);
  check('...nothing of it is remembered, and the next search goes through', (await charts.search('slow')).songs.length === 2 && sent.length === 2, sent.length);
  const gone = new AbortController();
  gone.abort();
  check('a search that was called off before it began asks nothing', isAbort(await caught(charts.search('never', { signal: gone.signal }))) && sent.length === 2, sent.length);
}

{
  charts.forgetAll(); sent.length = 0;
  site = () => answer(SIX);
  await charts.search('test');
  const hit = charts.remembered(B.md5);
  check('a version seen in a search is found again in memory, with its song and the other versions', hit?.chart.md5 === B.md5 && hit.song.title === 'Test Song' && hit.song.charts.length === 3 && sent.length === 1, hit);
  const album = charts.remembered(ALBUM.md5);
  check('...also one that was hidden from the list', album?.chart.md5 === ALBUM.md5 && album.song.title === 'Test Album (Full Album)', album);
  check('...an unknown one is not', charts.remembered('0'.repeat(32)) === null);

  charts.forgetAll(); sent.length = 0;
  site = (path, body) => (path === '/search/advanced' && body.hash === B.md5 ? answer([B, { ...B, chartDriveChartId: 1 }]) : answer([]));
  check('after forgetting, memory has nothing', charts.remembered(B.md5) === null);
  const byHash = await charts.advancedByHash(B.md5);
  check('advancedByHash: one request to the advanced search, by md5, for drum charts reviewed or not',
    sent.length === 1 && sent[0].path === '/search/advanced' && sent[0].body.hash === B.md5 && sent[0].body.instrument === 'drums' && sent[0].body.drumsReviewed === false, sent);
  check('...gives the version and a song made of it', byHash?.chart.md5 === B.md5 && byHash.chart.charter === 'Fixture B' && byHash.song.title === 'Test Song' && byHash.song.charts.length === 1
    && byHash.song.key === songKey('Test Song', 'The Fixtures') && !('notesData' in byHash.chart), byHash);
  check('...which memory then knows, with no request', charts.remembered(B.md5)?.song.title === 'Test Song' && sent.length === 1);
  check('...a version the site no longer has: null', (await charts.advancedByHash('0'.repeat(32))) === null && sent.length === 2);
  site = () => answer([ALBUM]);
  check('...a whole-album chart opened by its address is still a song', (await charts.advancedByHash(ALBUM.md5))?.song.title === 'Test Album (Full Album)');
}

// ---- the notes file: read once, parsed as often as needed ---------------------------

// A .sng package as sngIndex() in js/charts.js reads it: header, xor mask, metadata, file table, masked data.
function packSng(files) {
  const enc = new TextEncoder();
  const u64 = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return [...b]; };
  const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return [...b]; };
  const mask = Array.from({ length: 16 }, (_, i) => (i * 37 + 11) & 255);
  const metaKey = [...enc.encode('name')], metaValue = [...enc.encode('Test Song')];
  const meta = [...u64(1), ...u32(metaKey.length), ...metaKey, ...u32(metaValue.length), ...metaValue];
  const head = [...enc.encode('SNGPKG'), ...u32(1), ...mask, ...u64(meta.length), ...meta];
  const tableSize = 8 + files.reduce((sum, f) => sum + 1 + enc.encode(f.name).length + 16, 0);
  let at = head.length + 8 + tableSize + 8;                         // where the first file's data starts
  const table = [...u64(files.length)];
  const data = [];
  for (const f of files) {
    const name = [...enc.encode(f.name)];
    table.push(name.length, ...name, ...u64(f.bytes.length), ...u64(at));
    f.bytes.forEach((b, i) => data.push(b ^ mask[i % 16] ^ (i & 0xff)));
    at += f.bytes.length;
  }
  return Uint8Array.from([...head, ...u64(table.length), ...table, ...u64(data.length), ...data]);
}

// A hand-written notes.chart: 120 beats a minute, so 192 ticks are half a second.
const CHART = `[Song]
{
  Name = "Test Song"
  Resolution = 192
  Offset = 0
}
[SyncTrack]
{
  0 = TS 4
  0 = B 120000
}
[Events]
{
  0 = E "section Intro"
  1536 = E "section verse_1"
}
[ExpertDrums]
{
  0 = N 0 0
  192 = N 1 0
  384 = N 0 0
  384 = N 2 0
  576 = N 1 0
  1536 = N 0 0
}
[EasyDrums]
{
  0 = N 0 0
  384 = N 1 0
}
`;

// A hand-written notes.mid: a kick, a note on the blue lane, a snare, a beat apart, with no tom markers.
function midi() {
  const text = (s) => [...s].map((c) => c.charCodeAt(0));
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const chunk = (id, bytes) => [...text(id), ...u32(bytes.length), ...bytes];
  const beat = [0x83, 0x60];                                        // 480 ticks, as a variable-length number
  const tempo = [0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20, 0, 0xff, 0x2f, 0];
  const name = text('PART DRUMS');
  const drums = [0, 0xff, 0x03, name.length, ...name,
    0, 0x90, 96, 100, 0, 0x80, 96, 0,
    ...beat, 0x90, 99, 100, 0, 0x80, 99, 0,
    ...beat, 0x90, 97, 100, 0, 0x80, 97, 0,
    0, 0xff, 0x2f, 0];
  return Uint8Array.from([...chunk('MThd', [0, 1, 0, 2, 0x01, 0xe0]), ...chunk('MTrk', tempo), ...chunk('MTrk', drums)]);
}

{
  const md5 = 'ab'.repeat(16);
  const chartBytes = new TextEncoder().encode(CHART);
  packages.set(md5, packSng([
    { name: 'song.ini', bytes: new TextEncoder().encode('[song]\nname = Test Song\n') },
    { name: 'song.opus', bytes: new Uint8Array(5000).fill(7) },      // stands for the audio: must never be asked for
    { name: 'notes.chart', bytes: chartBytes },
  ]));
  const version = { md5, delay: 0.25, drumType: 0 };
  charts.forgetAll(); ranges.length = 0;

  check('before a load nothing is known about the real kit', charts.realKit(md5) === undefined);
  const expert = await charts.loadChart(version);
  const pads = expert.notes.map((n) => `${n.t} ${n.pad}`).join(', ');
  check('loadChart reads the notes out of the package and parses them', pads === '0.25 kick, 0.75 snare, 1.25 kick, 1.25 hihat, 1.75 snare, 4.25 kick' && expert.difficulty === 'expert' && expert.format === 'chart'
    && isDeepStrictEqual(expert.available, ['expert', 'easy']), pads);
  check('...with the parts, bars and beats moved by the version\'s delay like the notes',
    isDeepStrictEqual(expert.sections, [{ t: 0.25, name: 'Intro' }, { t: 4.25, name: 'Verse 1' }]) && expert.bars[0] === 0.25 && expert.bars[1] === 2.25 && expert.beats[0] === 0.75, [expert.sections, expert.bars.slice(0, 2), expert.beats[0]]);
  const start = packages.get(md5).length - chartBytes.length;
  check('...in two range requests: the start of the package, then the notes file alone', ranges.length === 2 && ranges[0].range === 'bytes=0-8191' && ranges[1].range === `bytes=${start}-${start + chartBytes.length - 1}`, ranges);

  const easy = await charts.loadChart(version, 'easy');
  check('another level of the same version costs no request', ranges.length === 2 && easy.notes.length === 2 && easy.difficulty === 'easy', [ranges.length, easy.notes.length]);
  const hard = await charts.loadChart(version, 'hard');
  check('a level the version does not have falls back to its highest', hard.difficulty === 'expert' && hard.notes.length === 6);
  check('every load gives its own notes: changing one does not reach the next', (() => { expert.notes[0].t = 99; return true; })() && (await charts.loadChart(version)).notes[0].t === 0.25);
  check('after a load the version is known not to be a real-kit chart', charts.realKit(md5) === false);

  const bytes = await charts.fetchNotesFile(md5);
  check('fetchNotesFile gives the notes file itself, from memory', ranges.length === 2 && bytes instanceof Uint8Array && new TextDecoder().decode(bytes) === CHART);
  const noDelay = charts.parseNotes(bytes, 'easy', 0);
  const moved = charts.parseNotes(bytes, 'easy', 1.5);
  check('parseNotes: bytes, level, delay -> the chart, with no request', noDelay.notes[0].t === 0 && moved.notes[0].t === 1.5 && moved.notes[1].t === 2.5 && moved.notes[1].pad === 'snare' && ranges.length === 2, [noDelay.notes, moved.notes]);
  check('...leaving the bytes as they were', new TextDecoder().decode(bytes) === CHART);
  check('...and with no level or delay given: expert, not moved', charts.parseNotes(bytes).notes.length === 6 && charts.parseNotes(bytes).notes[0].t === 0);

  charts.forgetAll(); ranges.length = 0;
  const [one, two] = await Promise.all([charts.fetchNotesFile(md5), charts.fetchNotesFile(md5)]);
  check('two loads of one version at once share the two requests', ranges.length === 2 && one === two, ranges.length);

  charts.forgetAll(); ranges.length = 0;
  filesDown = true;
  const failed1 = await caught(charts.loadChart(version));
  filesDown = false;
  check('a load that fails says so', /the chart file said 503/.test(failed1?.message || ''), failed1?.message);
  check('...and is not kept: the next try reads the package again', (await charts.loadChart(version)).notes.length === 6 && ranges.length === 3, ranges.length);
  check('a version that is gone fails', /the chart file said 404/.test((await caught(charts.loadChart({ md5: 'cd'.repeat(16) })))?.message || ''));

  const audioOnly = 'ef'.repeat(16);
  packages.set(audioOnly, packSng([{ name: 'song.opus', bytes: new Uint8Array(100) }]));
  check('a package with no notes file fails', /no notes file/.test((await caught(charts.loadChart({ md5: audioOnly })))?.message || ''));
  const empty = '12'.repeat(16);
  packages.set(empty, packSng([{ name: 'notes.chart', bytes: new TextEncoder().encode('[Song]\n{\n  Resolution = 192\n}\n[ExpertDrums]\n{\n}\n') }]));
  check('a notes file with no drum notes fails', /no drum notes/.test((await caught(charts.loadChart({ md5: empty })))?.message || ''));

  // a .mid, and why parseNotes takes the version's drum type as a fourth argument
  const mid = midi();
  const plain = charts.parseNotes(mid, 'expert', 0);
  const pro = charts.parseNotes(mid, 'expert', 0, 1);
  check('parseNotes tells a .mid from a .chart by its first bytes', plain.format === 'mid' && plain.notes.map((n) => `${n.t} ${n.pad}`).join(', ') === '0 kick, 0.5 tom, 1 snare', plain.notes);
  check('...and with the version\'s drum type (cymbals told apart) the blue lane is the ride, as loadChart reads it', pro.notes[1].pad === 'ride' && pro.drumType === 1, pro.notes);
  const midMd5 = '34'.repeat(16);
  packages.set(midMd5, packSng([{ name: 'notes.mid', bytes: mid }]));
  const viaLoad = await charts.loadChart({ md5: midMd5, delay: 0, drumType: 1 });
  check('...loadChart hands that drum type over', viaLoad.notes[1].pad === 'ride' && viaLoad.format === 'mid', viaLoad.notes);
}

globalThis.fetch = realFetch;
console.log(failed ? `${failed} FAILED` : 'all good');
process.exit(failed ? 1 : 0);
