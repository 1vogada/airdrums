// The screens around the play screen: Home (search, Liked, Recent, first songs)
// and the page of one song.

import * as store from './store.js';
import * as library from './library.js';
import * as spotify from './spotify.js';
import { search, remembered, advancedByHash, loadChart } from './charts.js';
import { labels, isReal, matching } from './catalog.js';
import { parts } from './parts.js';
import { h, fill, icon, tile, songRow, skeleton, empty, toast, clockTime } from './ui.js';

const $ = (id) => document.getElementById(id);

// Songs that are good to start on, easiest first, with why.
const STARTERS = [
  ['We Will Rock You', 'Queen', 'Three sounds and no hi-hat'],
  ['Back in Black', 'AC/DC', 'The plain rock beat, slow'],
  ['Highway to Hell', 'AC/DC', 'The same beat with more push'],
  ['Another One Bites the Dust', 'Queen', 'Steady, with room to breathe'],
  ['Seven Nation Army', 'The White Stripes', 'Bass drum and floor tom first'],
  ['Come As You Are', 'Nirvana', 'A groove that stays put'],
  ['Boulevard of Broken Dreams', 'Green Day', 'Slow, with clear parts'],
  ['Du Hast', 'Rammstein', 'Open hi-hat, hard and even'],
  ['Smells Like Teen Spirit', 'Nirvana', 'Loud and quiet parts'],
  ['Enter Sandman', 'Metallica', 'Builds up one drum at a time'],
  ['Everlong', 'Foo Fighters', 'Fast hi-hat: the stretch song'],
  ['Chop Suey!', 'System of a Down', 'For when the rest is easy'],
];

// ---- one song, however it is known ------------------------------------------------

// A library entry as a song the screens can show.
const fromEntry = (e) => ({ key: e.key, title: e.title, artist: e.artist, album: e.album, art: e.art || e.charts?.[0]?.art || '', length: e.length || e.charts?.[0]?.length || 0, charts: e.charts || [] });

// The version to open for a song: the one you chose, else the first.
export const firstMd5 = (song) => library.find(song.title, song.artist)?.pick || song.charts?.[0]?.md5 || '';

// The song a version belongs to: from your songs, from the searches still in
// memory, else one request to the chart site. { song, chart } or null.
export async function lookup(md5) {
  for (const e of library.all()) {
    const chart = (e.charts || []).find((c) => c.md5 === md5);
    if (chart) return { song: fromEntry(e), chart };
  }
  return remembered(md5) || advancedByHash(md5);
}

export function toggleLike(song, after) {
  const was = library.isLiked(song.title, song.artist);
  library.like(song, !was);
  if (was) toast('Removed from Liked', 'Undo', () => { library.like(song, true); after?.(); });
  after?.();
}

const best = (e) => (e?.best ? `${e.best.grade} ${Math.round(e.best.accuracy * 100)}%` : '');

// ---- Home ---------------------------------------------------------------------------

let searching = 0;                      // bumps on every search, so a slow answer can't land on a newer one
let abort = null;
let shown = { tab: 'liked', query: '' };

function rowFor(song, again) {
  const md5 = firstMd5(song);
  const entry = library.find(song.title, song.artist);
  const tag = song.labels?.[0] || '';
  return songRow(song, {
    href: md5 ? `#/song/${md5}` : `#/search/${encodeURIComponent(`${song.title} ${song.artist}`)}`,
    liked: Boolean(entry?.liked),
    onLike: () => toggleLike(song, again),
    onPlay: md5 ? () => { location.hash = `#/play/${md5}`; } : null,
    badge: tag || best(entry) || (song.charts?.[0] && isReal(song.charts[0]) ? 'Real kit' : ''),
    warn: Boolean(tag),
  });
}

function drawLists() {
  const liked = library.liked().map(fromEntry);
  const recent = library.recent(30).map(fromEntry);
  $('tabLiked').textContent = `Liked (${liked.length})`;
  $('tabLiked').classList.toggle('on', shown.tab === 'liked');
  $('tabRecent').classList.toggle('on', shown.tab === 'recent');
  const list = shown.tab === 'liked' ? liked : recent;
  const rows = list.map((s) => {
    const row = rowFor(s, drawLists);
    if (shown.tab === 'recent') {
      row.insertBefore(h('button', { class: 'btn icon ghost', type: 'button', title: 'Remove from Recent',
        onclick: (e) => { e.preventDefault(); e.stopPropagation(); const entry = library.get(s.key); if (entry?.liked) library.unplay(s.key); else library.forget(s.key); drawLists(); drawContinue(); } }, icon('close')), row.lastChild);
    }
    return row;
  });
  fill($('list'), ...(rows.length ? rows : [shown.tab === 'liked'
    ? empty('Nothing liked yet. Press the heart on a song to keep it here.', 'Find a song', () => $('search').focus())
    : empty('Songs you open show up here.')]));
}

function drawContinue() {
  const e = library.recent(1)[0];
  const md5 = e && (e.pick || e.charts?.[0]?.md5);
  $('continue').hidden = !md5;
  if (!md5) return;
  fill($('continue'), 
    tile(e.title, e.art || e.charts[0].art, 'big'),
    h('div', { class: 'grow' }, h('span', { class: 'soft', text: 'Continue' }), h('b', { text: e.title }), h('span', { class: 'soft', text: [e.artist, best(e) && `Best ${best(e)}`].filter(Boolean).join(' · ') })),
    h('a', { class: 'btn', href: `#/learn/${md5}`, text: 'Learn' }),
    h('a', { class: 'btn primary', href: `#/play/${md5}`, text: 'Play' }));
}

function drawStarters() {
  fill($('starters'), ...STARTERS.map(([title, artist, why]) => h('a', { class: 'starter', href: `#/search/${encodeURIComponent(`${title} ${artist}`)}` },
    tile(title, ''), h('span', { class: 'row-text' }, h('b', { text: title }), h('span', { text: `${artist} · ${why}` })))));
}

async function drawNow() {
  const bar = $('now');
  bar.hidden = !spotify.linked();
  if (bar.hidden) return;
  fill(bar, h('span', { class: 'soft', text: 'Spotify is linked. Start a song there, then press Play along.' }), h('a', { class: 'btn', href: '#/live', text: 'Play along' }));
  try {
    const now = await spotify.nowPlaying();
    if (!now || $('home').hidden) return;
    fill(bar, tile(now.title, now.art), h('span', { class: 'row-text' }, h('span', { class: 'soft', text: 'Now on Spotify' }), h('b', { text: `${now.title} · ${now.artist}` })),
      h('a', { class: 'btn primary', href: '#/live', text: 'Play along' }));
  } catch { /* the bar keeps its plain line */ }
}

async function drawResults(query) {
  const mine = ++searching;
  abort?.abort();
  abort = new AbortController();
  const box = $('results');
  const own = matching(library.all().filter((e) => e.charts?.length).map(fromEntry), query);
  const head = (text) => h('h2', { text });
  const yours = own.length ? [head('Your songs'), ...own.slice(0, 5).map((s) => rowFor(s, () => drawResults(query)))] : [];
  fill(box, ...yours, head(`Songs for "${query}"`), ...skeleton(5));
  try {
    const got = await search(query, { signal: abort.signal });
    if (mine !== searching) return;
    const note = got.usedQuery && got.usedQuery !== got.query ? h('p', { class: 'soft', text: `Nothing for "${got.query}". Showing results for "${got.usedQuery}".` }) : null;
    const listed = new Set(own.slice(0, 5).map((s) => s.key));          // already listed under Your songs
    const rows = got.songs.filter((s) => !listed.has(s.key)).map((s) => rowFor(s, () => drawResults(query)));
    fill(box, ...yours, head(`Songs for "${query}"`), note,
      ...(rows.length || got.songs.length ? rows : [empty(`No drum part found for "${query}". Rock and metal are covered best. Try only the title or only the artist.`)]),
      got.more && h('button', { class: 'btn', type: 'button', text: 'Show more', onclick: async (e) => {
        e.target.disabled = true;
        try { await search(query, { page: got.page + 1 }); } catch { /* the list stays as it is */ }
        drawResults(query);
      } }));
    // a first-songs click names one song: open it when it is the only one that fits
    if (pendingOpen && rows.length && got.songs[0].exact) { const md5 = firstMd5(got.songs[0]); pendingOpen = false; if (md5) location.replace(`#/song/${md5}`); }
    pendingOpen = false;
  } catch (e) {
    if (mine !== searching || e?.name === 'AbortError') return;
    fill(box, ...yours, head(`Songs for "${query}"`), empty("The chart site didn't answer. It does that now and then.", 'Try again', () => drawResults(query)));
  }
}

let pendingOpen = false;

// Home, with search results in place of its lists while something is typed.
export function showHome({ tab, query } = {}) {
  if (tab) shown.tab = tab;
  shown.query = query || '';
  const first = !library.all().length;
  $('hero').hidden = !first || Boolean(shown.query);
  $('results').hidden = !shown.query;
  $('lists').hidden = Boolean(shown.query) || first;
  $('startersBox').hidden = Boolean(shown.query);
  if ($('search').value.trim() !== shown.query && document.activeElement !== $('search')) $('search').value = shown.query;
  if (shown.query) { $('continue').hidden = true; $('now').hidden = true; drawResults(shown.query); return; }
  searching++;
  drawContinue();
  drawLists();
  drawStarters();
  drawNow();
}

export function initPages() {
  $('tabLiked').addEventListener('click', () => { location.hash = '#/liked'; });
  $('tabRecent').addEventListener('click', () => { location.hash = '#/recent'; });
  $('starters').addEventListener('click', () => { pendingOpen = true; });
  let timer = 0;
  const go = (now) => {
    clearTimeout(timer);
    const q = $('search').value.trim();
    const run = () => {
      const to = q.length >= 2 ? `#/search/${encodeURIComponent(q)}` : '#/';
      if (location.hash === to) return;
      if (/^#\/(search\/|$)/.test(location.hash) || location.hash === '') { history.replaceState(null, '', to); showHomeFromHash(); } else location.hash = to;
    };
    if (now) run(); else timer = setTimeout(run, 380);
  };
  $('search').addEventListener('input', () => go(false));
  $('searchForm').addEventListener('submit', (e) => { e.preventDefault(); go(true); });
  $('search').addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('search').value = ''; go(true); $('search').blur(); } });
}

function showHomeFromHash() {
  const m = /^#\/search\/(.*)$/.exec(location.hash);
  for (const id of ['home', 'song', 'play', 'map', 'setup']) $(id).hidden = id !== 'home';
  showHome({ query: m ? decodeURIComponent(m[1]) : '' });
}

// ---- the page of one song -----------------------------------------------------------

let opening = 0;

export async function showSong(md5) {
  const mine = ++opening;
  const page = $('songBody');
  fill(page, ...skeleton(3));
  let found;
  try { found = await lookup(md5); } catch { found = null; }
  if (mine !== opening) return;
  if (!found) { toast('That version is gone. Search for the song again.'); location.replace('#/'); return; }
  const { song, chart } = found;
  document.title = `${song.title} · Air Drums`;
  const draw = () => {
    const entry = library.find(song.title, song.artist);
    const liked = Boolean(entry?.liked);
    const lines = [song.album, song.year || '', clockTime(chart.playLength || chart.length || song.length)].filter(Boolean).join(' · ');
    const versions = song.charts.length > 1 && h('label', { class: 'pick' }, 'Version ', h('select', { onchange: (e) => {
      library.remember({ ...song, charts: song.charts }); const kept = library.find(song.title, song.artist); if (kept) { kept.pick = e.target.value; library.touch(); }
      location.replace(`#/song/${e.target.value}`);
    } }, ...song.charts.map((c) => h('option', { value: c.md5, selected: c.md5 === chart.md5, text: `${c.charter || 'unknown'} · ${clockTime(c.playLength || c.length)}${isReal(c) ? ' · real kit' : ''}${labels(c).length ? ` · ${labels(c).join(', ').toLowerCase()}` : ''}` }))));
    fill($('songHead'), 
      tile(song.title, entry?.art || song.art || chart.art, 'huge'),
      h('div', { class: 'grow' },
        h('h1', { text: song.title }),
        h('a', { class: 'artist', href: `#/search/${encodeURIComponent(song.artist)}`, text: song.artist }),
        h('p', { class: 'soft', text: lines }),
        entry?.best && h('p', { class: 'soft', text: `Best: ${best(entry)} · played ${entry.plays} ${entry.plays === 1 ? 'time' : 'times'}` }),
        h('div', { class: 'starts' },
          h('a', { class: 'btn big primary', id: 'startPlay', href: `#/play/${chart.md5}` }, icon('play', true), 'Play'),
          h('a', { class: 'btn big', href: `#/learn/${chart.md5}` }, icon('loop'), 'Learn'),
          spotify.linked() && h('a', { class: 'btn big', href: '#/live', onclick: () => sessionStorage.setItem('airdrums.expect', JSON.stringify({ md5: chart.md5, title: song.title, artist: song.artist })) }, 'Play along with Spotify'),
          h('button', { class: `btn big icon heart${liked ? ' on' : ''}`, type: 'button', title: liked ? 'Remove from Liked' : 'Like', onclick: () => toggleLike(song, draw) }, icon('heart', liked))),
        h('p', { class: 'soft small' }, 'Play and Learn use the site\'s own drum sounds, no music. ', h('a', { href: `#/play/${chart.md5}/self`, text: "I'll start the music myself" }), '.'),
        versions));
    $('startPlay').focus({ preventScroll: true });
  };
  draw();
  fill(page, h('h2', { text: 'Parts' }), ...skeleton(4));
  try {
    const parsed = await loadChart(chart, store.get('difficulty', 'expert'));
    if (mine !== opening) return;
    const entry = library.find(song.title, song.artist);
    const list = parts(parsed).filter((p) => !p.empty);
    const done = list.filter((p) => library.learned(library.part(entry, chart.md5, String(p.id)))).length;
    const level = parsed.available.length > 1 && h('label', { class: 'pick' }, 'Level ', h('select', { onchange: (e) => { store.set('difficulty', e.target.value); showSong(md5); } },
      ...parsed.available.map((d) => h('option', { value: d, selected: d === parsed.difficulty, text: `${d[0].toUpperCase()}${d.slice(1)}${chart.levels?.[d] ? ` · ${chart.levels[d].toLocaleString('en')} notes` : ''}` }))));
    fill(page, 
      h('div', { class: 'between' }, h('h2', { text: `Parts · ${done} of ${list.length} learned` }), level),
      h('div', { class: 'parts' }, ...list.map((p) => {
        const kept = library.part(entry, chart.md5, String(p.id));
        const state = library.learned(kept) ? 'learned' : kept ? `${Math.round(kept.rate * 100)}% tempo` : '';
        return h('a', { class: `part${library.learned(kept) ? ' done' : ''}`, href: `#/learn/${chart.md5}/${p.id}` },
          h('span', { class: 'part-n', text: String(p.n) }), h('b', { text: p.name }),
          h('span', { class: 'soft', text: `${clockTime(p.from)} · ${Math.round(p.length)} s · ${p.notes} notes` }),
          h('span', { class: 'part-state' }, library.learned(kept) && icon('check'), state));
      })),
      entry && Object.keys(entry.parts || {}).length ? h('button', { class: 'btn ghost', type: 'button', text: 'Reset progress for this song', onclick: () => { entry.parts = {}; library.touch(); showSong(md5); } }) : null);
  } catch (e) {
    if (mine !== opening) return;
    fill(page, empty("Couldn't load this version.", 'Try again', () => showSong(md5)));
  }
}
