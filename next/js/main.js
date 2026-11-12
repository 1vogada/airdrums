// Ties it together: the routes, the play screen (the engine that runs a song),
// Learn, results and setup. Home and the song page are in pages.js.

import { PADS, PAD, KEY_TO_PAD } from './kit.js';
import * as store from './store.js';
import * as spotify from './spotify.js';
import * as library from './library.js';
import { Follow } from './spotify.js';
import { OwnClock } from './clock.js';
import { findCharts, searchCharts, loadChart, lyricShift, fit } from './charts.js';
import { artUrl } from './catalog.js';
import { syncedLyrics } from './lyrics.js';
import { Mic } from './mic.js';
import { Game } from './game.js';
import { locate, pick, unique, nearest } from './align.js';
import { Stage } from './render.js';
import { Synth } from './synth.js';
import { Player } from './sound.js';
import { parts, countIn } from './parts.js';
import { h, fill, icon, toast, clockTime } from './ui.js';
import { initPages, showHome, showSong, lookup, toggleLike } from './pages.js';

const $ = (id) => document.getElementById(id);
const now = () => performance.now() / 1000;
const EAR_EVERY = 3;                    // seconds between line-ups by ear while the mic is on
const EAR_CLIP = 12;                    // seconds of sound a line-up is worked out from
const EAR_LEAST = 8;                    // ...and the least it will try with
const DELAY = [-0.15, 0.6];             // how late a setup's sound can believably be, in seconds
const EAR_MOST = 0.15;                  // the furthest the mic may move the notes by itself, in all
const CLEAN = 0.85;                     // a pass with this share of its notes hit is clean
const ROUGH = 0.6;                      // two passes under this and the tempo comes down
const VIEWS = [['tab', 'Tab', 'tab'], ['drums', 'Drums', 'kit'], ['colors', 'Colors', 'lanes'], ['taiko', 'Taiko', 'taiko'], ['mania', 'Mania', 'mania']];
const SETS = [['bs', 'Bass + Snare', ['kick', 'snare']], ['hh', '+ Hi-hat', ['kick', 'snare', 'hihat']], ['all', 'All drums', null]];

const mic = new Mic();
const synth = new Synth();
const player = new Player(synth);
let clock = null;                       // Follow (Spotify) or OwnClock (the site's own)
let src = null;                         // who makes the music: 'spotify', 'self' (your own record) or 'site' (the site's drums)
let playing = '';                       // which play address is open, so coming back to it doesn't start over
let song = null;
let charts = [];
let chart = null;
let parsed = null;
let lyrics = null;
let game = null;
let stage = null;
let frame = 0;
let loading = 0;                        // bumps on every load, so a slow one can't land on a newer song
let partList = [];                      // the song's parts, from the chart
let learn = null;                       // the part being looped, or null: see beginLearn
let wantLearn = null;                   // Learn was asked for before the chart had loaded
let slowed = false;                     // the tempo was under 100% at some point of this run
let ended = false;
let heardAt = 0;                        // where the song was last frame, for lighting pads while the site plays a part to you
let steadyFrom = 0;                     // since when the song has played straight through
let lastPos = 0, lastTick = 0, earNext = 0;
let earLast = null;                     // the previous line-up by ear: a change has to show up twice
let earAsked = 0;                       // until when the "Sync by ear" button's wide search runs
let earBase = 0;                        // the tuning the song started with: the mic stays near it by itself
let tunedBy = null;                     // 'ear', 'hand', 'saved' or null (automatic)
let usual = store.get('ear.usual', null);   // how late this setup's sound usually is, learned by ear
const demoLink = new URLSearchParams(location.search).get('demo');   // ?demo=song: play it without Spotify
let roughShift = null;                  // what the lyrics say the chart is off by
let fine = 0;                           // your own tuning on top of that, kept per song and chart
const prefs = { view: 'tab', guide: true, click: true, headphones: false, auto: true, ...store.get('prefs', {}) };
const savePrefs = () => store.set('prefs', prefs);
const shown = {};                       // text last written to the page, so a frame only writes what changed

function put(id, text) {
  if (shown[id] === text) return;
  const el = $(id);
  if (!el) return;
  shown[id] = text;
  el.textContent = text;
}

// ---- routing ----------------------------------------------------------------

function show(page) {
  for (const id of ['home', 'song', 'play', 'map', 'setup']) $(id).hidden = id !== page;
  $('top').hidden = page === 'play';
  document.body.classList.toggle('playing', page === 'play');
}

function route() {
  const bits = location.hash.replace(/^#\/?/, '').split('/');
  const name = bits[0] || '';
  const a = bits[1] ? decodeURIComponent(bits[1]) : '';
  const b = bits[2] ? decodeURIComponent(bits[2]) : '';
  if (VIEWS.some((v) => v[0] === name)) {                   // the old addresses: the five pages are views now
    prefs.view = name;
    savePrefs();
    if (!demoLink) { location.replace(spotify.linked() ? '#/live' : '#/'); return; }
    show('play');
    enterPlay('demo');
    return;
  }
  const play = ((name === 'play' || name === 'learn') && a) || name === 'live';
  if (!play) leavePlay();
  if (play) {
    show('play');
    enterPlay(name === 'live' ? 'live' : name === 'learn' ? 'learn' : b === 'self' ? 'self' : 'site', a, name === 'learn' ? b : '');
  } else if (name === 'song' && a) {
    show('song');
    showSong(a);
  } else if (name === 'map' || name === 'setup') {
    show(name);
    document.title = `${name === 'map' ? 'Kit map' : 'Setup'} · Air Drums`;
    if (name === 'setup') showSetup();
  } else {
    show('home');
    document.title = 'Air Drums';
    showHome({ tab: name === 'recent' ? 'recent' : name === 'liked' ? 'liked' : undefined, query: name === 'search' ? a : '' });
  }
  showChips();
}

function showChips() {
  $('chipSpotify').classList.toggle('on', spotify.linked());
  $('chipSpotify').querySelector('span').textContent = spotify.linked() ? 'Spotify linked' : 'Spotify not linked';
  $('chipMic').classList.toggle('on', mic.running);
  $('chipMic').querySelector('span').textContent = mic.running ? 'Mic on' : 'Mic off';
}

// ---- the play screen --------------------------------------------------------

// Leaving the play screen: the site's own sound stops. Your own record and the
// demo keep their place, as the site can't stop those.
function leavePlay() {
  cancelAnimationFrame(frame);
  if (!clock) return;
  if (src === 'site') { clock.pause(); player.reset(); playing = ''; }
  if (src === 'spotify') { clock.stop(); clock = null; playing = ''; }
}

async function enterPlay(kind, md5 = '', partId = '') {
  if (!stage) stage = new Stage($('stage'), 'tab');
  setView(prefs.view);
  stage.resize();
  showMic();
  cancelAnimationFrame(frame);
  tick();
  $('back').href = md5 ? `#/song/${md5}` : '#/';
  const key = `${kind}|${md5}`;
  if (key === playing && clock) {                           // the same song again (back from Setup, another part)
    if (kind === 'learn' && game && partId && String(learn?.part.id) !== partId) beginLearn(partId);
    drawDock();
    return;
  }
  if (clock) { clock.stop(); player.reset(); }
  playing = key;
  clock = null; game = null; parsed = null; song = null; lyrics = null; learn = null; partList = []; charts = []; chart = null; ended = false;
  wantLearn = kind === 'learn' ? { partId } : null;
  $('done').hidden = true;
  $('count').hidden = true;
  drawStrip();
  put('title', 'No song yet'); put('artist', ''); put('line', ''); put('nextLine', '');
  $('art').hidden = true;
  if (kind === 'live') {
    src = 'spotify';
    drawDock();
    showOffset();
    if (!spotify.linked()) { notice('Spotify is not linked.', [['Link it in Setup', '#/setup'], ['Find a song', '#/']]); return; }
    const expect = JSON.parse(sessionStorage.getItem('airdrums.expect') || 'null');
    sessionStorage.removeItem('airdrums.expect');
    notice(expect ? `Play "${expect.title}" in Spotify. The notes follow.` : 'Play a song in Spotify. The notes follow.', [['or pick a song', '#/']]);
    clock = new Follow(setSong, (err) => { if (err && !game) notice(err); });
    return;
  }
  if (kind === 'demo') {
    src = 'self';
    drawDock();
    const q = new URLSearchParams(location.search);
    demo(q.get('demo'), Number(q.get('at')) || 0);
    return;
  }
  src = kind === 'self' ? 'self' : 'site';
  drawDock();
  showOffset();
  notice('Loading the drum part…');
  let found = null;
  try { found = await lookup(md5); } catch { /* handled below */ }
  if (playing !== key) return;
  if (!found) { notice("Couldn't find that version. The chart site may be down.", [['Try again', () => { playing = ''; enterPlay(kind, md5, partId); }], ['Find a song', '#/']]); return; }
  const { song: info, chart: c } = found;
  const kept = library.find(info.title, info.artist);
  const s = { id: `${src === 'self' ? 'manual' : 'site'}.${c.md5}`, title: info.title, artist: info.artist, album: info.album || '', art: artUrl(kept?.art || info.art || c.art),
    charts: [c, ...(info.charts || []).filter((x) => x.md5 !== c.md5)] };
  clock = new OwnClock(s);
  setSong(s);
}

function setView(name) {
  const v = VIEWS.find((x) => x[0] === name) || VIEWS[0];
  prefs.view = v[0];
  if (stage) stage.mode = v[2];
  for (const b of $('views').children) b.classList.toggle('on', b.dataset.view === v[0]);
}

// What the stage says over the notes: one line, and at most a few things to press.
function notice(text, buttons = []) {
  $('noticeText').textContent = text || '';
  fill($('noticeBtns'), ...buttons.map(([label, to]) => (typeof to === 'string'
    ? h('a', { class: 'btn', href: to, text: label })
    : h('button', { class: 'btn', type: 'button', text: label, onclick: to }))));
  $('notice').hidden = !text;
}

// The song as the library files it.
const filed = () => (song ? { title: song.title, artist: song.artist, album: song.album, art: song.art, duration: song.duration, charts: charts.length ? charts : song.charts } : null);

async function setSong(s) {
  song = s;
  game = null;
  parsed = null;
  lyrics = null;
  roughShift = null;
  learn = null;
  partList = [];
  ended = false;
  $('done').hidden = true;
  put('title', s.title);
  put('artist', s.artist);
  document.title = `${s.title} · Air Drums`;
  $('art').hidden = !s.art;
  if (s.art) $('art').src = s.art;
  put('line', ''); put('nextLine', '');
  drawStrip();
  drawHeart();
  const mine = ++loading;
  notice(`Looking for the drum part of ${s.title}…`);
  syncedLyrics(s).then((l) => { if (mine === loading) { lyrics = l; applyRough(); } }).catch(() => {});
  try {
    const found = s.charts || await findCharts(s);
    if (mine !== loading) return;
    charts = found;
    fillCharts();
    if (!charts.length) {
      notice(`No drum part found for ${s.title}. Rock and metal are covered best.`, [['Find another song', '#/']]);
      return;
    }
    const kept = store.get(`pick.${s.id}`);
    chart = charts.find((c) => c.md5 === kept) || charts[0];
    $('chartPick').value = chart.md5;
    await loadPicked(mine);
  } catch (e) {
    if (mine === loading) notice(e.message);
  }
}

async function loadPicked(mine = ++loading) {
  notice('Loading the drum part…');
  try {
    const got = await loadChart(chart, store.get('difficulty', 'expert'));
    if (mine !== loading) return;
    parsed = got;
    partList = parts(parsed);
    game = makeGame(parsed.notes);
    fillDifficulty();
    roughShift = null;
    earLast = null;
    slowed = false;
    ended = false;
    if (src === 'site') {                                   // the chart's own time is the song: nothing to line up
      fine = 0;
      tunedBy = null;
      if (clock.rate !== 1) clock.setRate(1);
    } else {
      const saved = store.get(fineKey(), null);
      fine = saved ?? usual ?? 0;                           // nothing kept for this song: how late this setup usually is
      earBase = fine;
      tunedBy = saved !== null ? 'saved' : null;
    }
    game.offset = fine;
    applyRough();
    game.reset(clock.position());
    showOffset();
    drawStrip();
    drawDock();
    drawHeart();
    const info = filed();
    setTimeout(() => library.played(info), 0);
    if (wantLearn) { const id = wantLearn.partId; wantLearn = null; beginLearn(id); return; }
    const own = clock instanceof OwnClock;
    notice(own && !clock.playing ? (src === 'self' ? 'Press Enter when your song starts.' : 'Press Enter to start.') : '');
    if (src === 'site' && mic.running && prefs.guide && !prefs.headphones) toast('The mic will hear the guide drums as hits. Turn Guide off (U) or use headphones to be scored.');
  } catch (e) {
    if (mine === loading) { game = null; notice(`${e.message}.`, [['Try again', () => loadPicked()]]); }
  }
}

function makeGame(notes) {
  const g = new Game(notes);
  g.bars = parsed.bars;
  g.beats = parsed.beats;
  g.rate = clock instanceof OwnClock ? clock.rate : 1;
  return g;
}

const fineKey = () => `fine.${song.id}.${chart.md5}`;

// The lyrics and the chart both know when each line is sung: the gap between
// them is how far the chart's copy of the song is from Spotify's. Your own
// tuning goes on top of it. On the site's own clock the notes stay where the
// chart has them and the lyrics are moved instead.
function applyRough() {
  if (!game || !lyrics || !parsed) return;
  roughShift = lyricShift(parsed.phrases, lyrics.filter((l) => l.text).map((l) => l.t));
  if (roughShift !== null && src !== 'site') { game.offset = roughShift + fine; game.reset(clock.position()); showOffset(); }
}

function fillCharts() {
  const sel = $('chartPick');
  fill(sel, ...charts.map((c) => {
    const version = /live|acoustic|demo|remix|cover/i.exec(c.name);       // not the recording you're hearing
    return h('option', { value: c.md5, text: `${c.charter || 'unknown'} · ${clockTime(c.length)}${c.drumType === 1 ? '' : ' · simple'}${version ? ` · ${version[0].toLowerCase()} version` : ''}` });
  }));
  sel.disabled = charts.length < 2;
}

function fillDifficulty() {
  const sel = $('difficulty');
  fill(sel, ...parsed.available.map((d) => h('option', { value: d, text: d[0].toUpperCase() + d.slice(1) })));
  sel.value = parsed.difficulty;
  sel.disabled = parsed.available.length < 2;
}

function showOffset() {
  $('syncChip').classList.remove('warn');
  if (src === 'site') { put('offset', 'site clock'); return; }
  const ms = Math.round((game?.offset || 0) * 1000);
  const how = !game ? '' : { ear: 'by ear', hand: 'tuned', saved: 'saved' }[tunedBy]
    || (roughShift !== null ? 'auto' : 'not synced');
  put('offset', `${ms > 0 ? '+' : ''}${ms} ms${how ? ` · ${how}` : ''}`);
  $('syncChip').classList.toggle('warn', how === 'not synced');
}

// Your tuning (or the mic's) on top of the automatic line-up, kept for this song and chart.
function setFine(seconds, by = 'hand') {
  if (!game || src === 'site') return;
  fine = seconds;
  if (by === 'hand') earBase = fine;            // you set it: the mic works from there
  tunedBy = by;
  store.set(fineKey(), fine);
  game.offset = (roughShift ?? 0) + fine;
  showOffset();
}

// Back to the automatic line-up.
function dropFine() {
  if (!game || src === 'site') return;
  store.del(fineKey());
  fine = usual ?? 0;
  earBase = fine;
  tunedBy = null;
  earLast = null;
  game.offset = (roughShift ?? 0) + fine;
  game.reset(clock.position());
  showOffset();
}

const nudge = (seconds) => setFine(fine + seconds);

// The share of the judged notes that were hit: the one number shown for how it went.
function hitShare(g = game) {
  if (!g || !g.judged) return null;
  return (g.judged - g.counts.miss) / g.judged;
}

function tick() {
  frame = requestAnimationFrame(tick);
  const t = now();
  const own = clock instanceof OwnClock;
  let pos = clock ? clock.position(t) : 0;
  if (src !== 'site') {
    // the mic can only place the song in a stretch that played straight through
    if (!clock?.playing || Math.abs(pos - lastPos - (t - lastTick)) > 0.25) { steadyFrom = t; earLast = null; }
    lastPos = pos;
    lastTick = t;
    if (earAsked) {                                         // the button: keep trying until there's enough sound
      const got = byEar(t, true);
      if (got === 'done' || got === 'unclear' || t > earAsked) {
        earAsked = 0;
        $('listen').disabled = false;
        notice(got === 'done' ? '' : "Couldn't make out the song's drums. Move the mic closer to the speaker or turn the music up, or nudge with − and +.");
        if (got === 'done' && game) game.reset(pos);
      }
    } else if (t >= earNext) {
      earNext = t + EAR_EVERY;
      byEar(t);
    }
  }
  if (learn && own) {                                       // the loop came round: close the pass before judging goes on
    const lap = clock.lap(t);
    if (clock.epoch !== learn.epoch) { learn.epoch = clock.epoch; learn.lap = lap; }
    else if (lap > learn.lap) { learn.lap = lap; closePass(); pos = clock.position(t); }
  }
  if (game && clock.playing) {
    if (!learn?.listen) game.update(pos, t);
    else for (const n of game.notes) if (n.t > heardAt && n.t <= pos) stage.flash(n.pad, t, 'good');   // the site is playing it to you
  }
  heardAt = pos;
  if (src === 'site') player.run(clock, tune(), t);
  stage.draw(game, pos, t);
  put('score', game ? game.score.toLocaleString('en') : '0');
  put('combo', game && game.combo > 1 ? `${game.combo} combo` : '');
  const share = hitShare();
  put('acc', share === null ? '' : `${Math.round(share * 100)}% hit · ${game.counts.miss} missed`);
  if (learn) {
    put('line', `${learn.part.name} · ${Math.round(clock.rate * 100)}% · ${SETS.find((s) => s[0] === learn.set)[1]}`);
    put('nextLine', learn.listen ? 'Listen: the site plays this part. Your turn comes next.' : learn.said || `Pass ${learn.pass + 1}`);
    const inCount = clock.playing && pos < learn.part.from - 0.02;
    $('count').hidden = !inCount;
    if (inCount) put('count', String(learn.count.clicks.filter((c) => c.t <= pos + 0.03).length || 1));
  } else if (lyrics && (src !== 'site' || roughShift !== null)) {
    const at = pos + (src === 'site' ? roughShift : 0);
    let i = -1;
    while (i + 1 < lyrics.length && lyrics[i + 1].t <= at) i++;
    put('line', i >= 0 ? lyrics[i].text || '♪' : '');
    put('nextLine', lyrics[i + 1]?.text || '');
  }
  moveHead(pos);
  if (own) {
    put('time', `${clockTime(pos)}${parsed ? ` / ${clockTime(songEnd())}` : ''}`);
    if (clock.rate < 1 && clock.playing) slowed = true;
    if (src === 'site' && !learn && game && clock.playing && !ended && pos > songEnd()) finish();
  }
}

// Where the song is over: two seconds after its last note.
const songEnd = () => (parsed?.notes.length ? parsed.notes[parsed.notes.length - 1].t + 2 : 0);

// What the site's drums play right now: the whole part as a guide, the drums
// you left out, or nothing. While the microphone listens through speakers the
// site stays quiet in your turn: it can't tell its own drums from yours.
function tune() {
  if (!game || !parsed) return null;
  const micHears = mic.running && !prefs.headphones;
  if (!learn) return { notes: parsed.notes, offset: 0, bars: parsed.bars, beats: parsed.beats, guide: () => (prefs.guide ? 1 : 0), click: () => prefs.click };
  const mine = SETS.find((s) => s[0] === learn.set)[2];
  const from = learn.part.from;
  return {
    notes: parsed.notes, offset: 0, bars: parsed.bars, beats: parsed.beats,
    guide: (n) => {
      const yours = !mine || mine.includes(n.pad);
      if (learn.listen) return yours ? 1 : 0.35;
      return !prefs.guide || micHears || yours ? 0 : 0.6;   // your turn: only the drums you left out, and only if the mic can't hear them
    },
    click: (x) => x < from - 0.01 || learn.listen || (prefs.click && !micHears),
  };
}

// A drum was hit: by a key (we know which) or by a sound the mic heard.
function struck(t, pad, sure) {
  if (!stage || $('play').hidden) return;
  if (pad) stage.flash(pad, t);
  if (pad && PAD[pad].free) return;                   // nothing is written for it: it only lights up
  if (learn?.listen) return;                          // the site is showing how it goes: nothing is judged
  if (game && clock?.playing) game.hit(clock.position(t), t, pad, sure);
}

// ---- the part strip ---------------------------------------------------------

function drawStrip() {
  const strip = $('strip');
  const list = partList;
  strip.hidden = !list.length;
  shown.part = null;
  if (!list.length) { fill(strip); return; }
  const entry = song ? library.find(song.title, song.artist) : null;
  const own = clock instanceof OwnClock;
  fill(strip, ...list.map((p) => {
    const done = !p.empty && library.learned(library.part(entry, chart.md5, String(p.id)));
    return h('button', { class: `pblock${p.empty ? ' empty' : ''}${done ? ' done' : ''}`, type: 'button', style: `flex:${Math.max(0.4, p.length)} 1 0`, title: p.name || 'No drums', 'data-id': String(p.id),
      disabled: p.empty || !own, onclick: (e) => { e.currentTarget.blur(); jumpTo(p); } }, h('span', { text: p.name }));
  }), h('i', { id: 'head' }));
  strip.dataset.total = String(list[list.length - 1].to);
}

function moveHead(pos) {
  if (!partList.length) return;
  const total = Number($('strip').dataset.total) || 1;
  const head = $('head');
  if (head) head.style.left = `${Math.max(0, Math.min(100, (pos / total) * 100))}%`;
  const cur = learn ? learn.part : partList.find((p) => pos >= p.from && pos < p.to);
  const id = cur ? String(cur.id) : '';
  if (shown.part === id) return;
  shown.part = id;
  for (const b of $('strip').children) b.classList.toggle('on', b.dataset.id === id);
}

function jumpTo(part) {
  if (!(clock instanceof OwnClock) || !game) return;
  if (learn) { startPart(learn.list.findIndex((p) => p.id === part.id)); return; }
  clock.seekTo(Math.max(0, countIn(parsed, part).from));
  game.reset(clock.position());
  ended = false;
  $('done').hidden = true;
}

// ---- Learn: one part, round and round, slower first -------------------------

// learn = { list, index, part, count, set, listen, pass, clean, low, said, lap, epoch }
function beginLearn(partId) {
  const list = partList.filter((p) => !p.empty);
  if (!list.length) { notice('This version has no parts to learn.', [['Back to the song', $('back').getAttribute('href')]]); return; }
  const entry = library.find(song.title, song.artist);
  let index = list.findIndex((p) => String(p.id) === String(partId));
  if (index < 0) index = list.findIndex((p) => !library.learned(library.part(entry, chart.md5, String(p.id))));
  if (index < 0) index = 0;
  learn = { list, index: -1, part: list[index], set: 'all', listen: false, pass: 0, clean: 0, low: 0, said: '', lap: 0, epoch: -1 };
  startPart(index, false);
  notice(`${learn.part.name}: ${Math.round(learn.part.length)} s, ${learn.part.notes} notes, starting at ${Math.round(clock.rate * 100)}% tempo. Press Enter to start.`);
}

// Put the loop on a part. A part met for the first time is played to you once before your turn.
function startPart(index, run = clock.playing) {
  if (!learn || index < 0 || index >= learn.list.length) return;
  const part = learn.list[index];
  const entry = library.find(song.title, song.artist);
  const kept = library.part(entry, chart.md5, String(part.id));
  if (index !== learn.index) {
    learn.pass = 0; learn.clean = 0; learn.low = 0; learn.said = '';
    learn.listen = !kept;                                   // never tried: hear it first
    learn.set = !kept && part.nps > 5 && (part.counts.hihat || 0) > part.notes * 0.4 ? 'bs' : 'all';
    const rate = kept ? Math.min(1, Math.max(0.5, kept.rate)) : 0.7;
    if (clock.rate !== rate) clock.setRate(rate);
  }
  learn.index = index;
  learn.part = part;
  learn.count = countIn(parsed, part);
  buildPass();
  clock.setLoop(learn.count.from, part.to + 0.2);
  clock.cue(learn.count.from, player.lead);
  if (run) clock.play();
  learn.epoch = clock.epoch;
  learn.lap = clock.lap();
  game.reset(clock.position());
  if (location.hash !== `#/learn/${chart.md5}/${part.id}`) history.replaceState(null, '', `#/learn/${chart.md5}/${part.id}`);
  drawDock();
  shown.part = null;
}

// The notes you play in this pass: the drums chosen, inside the part.
function buildPass() {
  const part = learn.part;
  const inPart = (n) => n.t >= part.from - 0.001 && n.t < part.to - 0.001;
  const mine = SETS.find((s) => s[0] === learn.set)[2];
  let notes = parsed.notes.filter((n) => inPart(n) && (!mine || mine.includes(n.pad)));
  if (notes.length < 4) { learn.set = 'all'; notes = parsed.notes.filter(inPart); }
  game = makeGame(notes);
}

// The loop came round: say how the pass went and step by the rules.
function closePass() {
  const total = game.notes.length;
  const hit = game.notes.filter((n) => n.state && n.state !== 'miss' && n.state !== 'skip').length;
  const share = total ? hit / total : 0;
  const rate = clock.rate;
  const all = learn.set === 'all';
  const setName = () => SETS.find((s) => s[0] === learn.set)[1];
  if (learn.listen) {
    learn.listen = false;
    learn.said = 'Your turn.';
    drawDock();
  } else if (!hit) {
    learn.pass++;
    learn.said = 'Not scoring: no hits heard. Press G when it feels clean.';
  } else {
    learn.pass++;
    const pct = `${Math.round(share * 100)}%`;
    const info = filed(), md5 = chart.md5, id = String(learn.part.id);
    setTimeout(() => { library.partDone(info, md5, id, { accuracy: share, rate: all ? rate : Math.min(rate, 0.95) }); drawStrip(); }, 0);
    if (share >= CLEAN) {
      learn.clean++; learn.low = 0;
      if (all && rate >= 0.99) { learned(`${pct}, clean at full tempo: learned.`); return; }
      if (learn.clean >= 2 && prefs.auto) {
        learn.clean = 0;
        if (!all) { learn.set = SETS[SETS.findIndex((s) => s[0] === learn.set) + 1][0]; buildPass(); learn.said = `${pct}. Clean: ${setName()} now.`; }
        else { clock.setRate(Math.min(1, Math.round((rate + 0.1) * 10) / 10)); learn.said = `${pct}. Clean: up to ${Math.round(clock.rate * 100)}%.`; }
        drawDock();
      } else learn.said = `${pct}. Clean${prefs.auto ? ': once more' : ''}.`;
    } else if (share < ROUGH) {
      learn.low++; learn.clean = 0;
      if (learn.low >= 2 && prefs.auto && rate > 0.5) { learn.low = 0; clock.setRate(Math.max(0.5, Math.round((rate - 0.1) * 10) / 10)); learn.said = `${pct}. Again: down to ${Math.round(clock.rate * 100)}%.`; drawDock(); }
      else learn.said = `${pct}. Again.`;
    } else { learn.clean = 0; learn.low = 0; learn.said = `${pct}. Close.`; }
  }
  game.rate = clock.rate;
  game.reset(clock.position());
}

// This part is done: tick it and move on to the next one that isn't.
function learned(text, byHand = false) {
  if (!learn) return;
  const part = learn.part;
  const md5 = chart.md5;
  library.partDone(filed(), md5, String(part.id), { accuracy: byHand ? CLEAN : 1, rate: 1 });
  drawStrip();
  const entry = library.find(song.title, song.artist);
  const next = learn.list.findIndex((p) => !library.learned(library.part(entry, md5, String(p.id))));
  toast(`${part.name}: ${text}`, byHand ? 'Undo' : null, () => { const e = library.find(song.title, song.artist); if (e?.parts) { delete e.parts[`${md5}|${part.id}`]; library.touch(); drawStrip(); } });
  if (next < 0) {
    clock.pause();
    drawDock();
    notice('All parts learned. Play the whole song.', [['Play the whole song', `#/play/${md5}`], ['Back to the song', `#/song/${md5}`]]);
    return;
  }
  startPart(next);
  learn.said = `Next: ${learn.part.name}.`;
}

function setTempo(step) {
  if (!(clock instanceof OwnClock) || src !== 'site') return;
  const next = Math.max(0.5, Math.min(1, Math.round((clock.rate + step) * 10) / 10));
  if (next === clock.rate) return;
  clock.setRate(next);
  if (game) game.rate = next;
  if (learn) { learn.clean = 0; learn.low = 0; }
  drawDock();
}

// The pass starts over from its counted bar (the drums or the listening changed).
function recue() {
  const run = clock.playing;
  clock.cue(learn.count.from, player.lead);
  if (run) clock.play();
  game.reset(clock.position());
  drawDock();
}

function nextSet() {
  if (!learn) return;
  learn.set = SETS[(SETS.findIndex((s) => s[0] === learn.set) + 1) % SETS.length][0];
  learn.clean = 0; learn.low = 0;
  buildPass();
  recue();
}

function listen() {
  if (!learn) return;
  learn.listen = !learn.listen;
  recue();
}

// ---- the end of a run on the site's drums -----------------------------------

function finish() {
  ended = true;
  clock.pause();
  drawDock();
  const share = hitShare() ?? 0;
  const heard = game.judged - game.counts.miss > 0;
  const bars = partList.filter((p) => !p.empty).map((p) => {
    const notes = game.notes.filter((n) => n.t >= p.from && n.t < p.to && n.state && n.state !== 'skip');
    return { part: p, share: notes.length ? notes.filter((n) => n.state !== 'miss').length / notes.length : null };
  }).filter((b) => b.share !== null);
  const weakest = bars.length ? bars.reduce((x, y) => (y.share < x.share ? y : x)) : null;
  let kept = null;
  if (heard && !slowed && game.judged >= 20) {
    kept = library.record(filed(), { score: game.score, accuracy: share, combo: game.bestCombo, counts: { ...game.counts }, mode: prefs.view, chart: chart.md5, level: parsed.difficulty });
  }
  const c = game.counts;
  const judged = Math.max(1, game.judged);
  fill($('done'), 
    h('h2', { text: heard ? `${library.grade(share)} · ${Math.round(share * 100)}% of the notes hit` : 'You watched this one' }),
    h('p', { class: 'soft', text: !heard ? 'No hits were heard. Turn the mic on, or play on the keyboard: Q W E, A S D, Z, Space.'
      : `${slowed ? 'Slowed run, so not a best. ' : kept?.best ? 'New best. ' : ''}Timing: ${Math.round((c.perfect / judged) * 100)}% perfect, ${Math.round((c.good / judged) * 100)}% good, ${Math.round(((c.ok + c.wrong) / judged) * 100)}% ok · best combo ${game.bestCombo}` }),
    heard && h('div', { class: 'bars' }, ...bars.map((x) => h('a', { class: 'bar', href: `#/learn/${chart.md5}/${x.part.id}`, title: `Learn ${x.part.name}` },
      h('span', { text: x.part.name }), h('i', {}, h('u', { style: `width:${Math.round(x.share * 100)}%`, class: x.share >= CLEAN ? 'good' : x.share < ROUGH ? 'bad' : '' })), h('em', { text: `${Math.round(x.share * 100)}%` })))),
    h('div', { class: 'row' },
      weakest && heard && weakest.share < CLEAN && h('a', { class: 'btn primary', href: `#/learn/${chart.md5}/${weakest.part.id}`, text: `Learn ${weakest.part.name}` }),
      h('button', { class: 'btn', type: 'button', text: 'Play again', onclick: restart }),
      h('a', { class: 'btn', href: `#/song/${chart.md5}`, text: 'Back to the song' })));
  $('done').hidden = false;
}

function restart() {
  if (!clock) return;
  $('done').hidden = true;
  ended = false;
  if (clock instanceof OwnClock) {
    slowed = clock.rate < 1;
    if (learn) { startPart(learn.index, true); notice(''); return; }
    clock.seekTo(0);
    game?.reset(0);
    if (src === 'site') { synth.start().catch(() => {}); clock.play(); notice(''); drawDock(); }
    return;
  }
  spotify.seek(0).then(() => clock.ask()).catch((e) => notice(e.message));
}

// Enter: start or pause a clock the site runs.
async function startStop() {
  if (!(clock instanceof OwnClock) || !game) return;
  if (ended) { restart(); return; }
  if (src === 'site' && !clock.playing) await synth.start().catch(() => {});
  clock.toggle();
  notice(clock.playing ? '' : 'Paused. Enter to go on.');
  drawDock();
}

// ---- the dock: what you can do with this clock -------------------------------

function drawDock() {
  const dock = $('dock');
  const own = clock instanceof OwnClock;
  const key = (k) => h('kbd', { text: k });
  const btn = (label, k, on, fn, extra = '') => h('button', { class: `btn${on ? ' on' : ''} ${extra}`, type: 'button', onclick: (e) => { e.currentTarget.blur(); fn(); } }, label, k && key(k));
  shown.time = null;
  if (src === 'spotify') {
    fill(dock, h('span', { class: 'soft', text: 'Following Spotify. Spotify plays at full speed.' }),
      chart && h('a', { class: 'btn', href: `#/learn/${chart.md5}`, text: "Learn this song on the site's drums" }),
      btn('Restart', '', false, restart));
    return;
  }
  if (src === 'self' || !own) {
    fill(dock, h('span', { class: 'soft' }, 'Your music: ', key('Enter'), ' when it starts · ', key('←'), ' ', key('→'), ' 5 s · ', key('Home'), ' start over'),
      h('output', { id: 'time', class: 'time' }),
      chart && h('a', { class: 'btn', href: `#/play/${chart.md5}`, text: "Play on the site's drums instead" }));
    return;
  }
  const tempo = h('span', { class: 'group', title: 'Tempo (arrow up and down)' }, btn('−', '', false, () => setTempo(-0.1), 'icon'), h('output', { text: `${Math.round(clock.rate * 100)}%` }), btn('+', '', false, () => setTempo(0.1), 'icon'));
  const sound = [btn('Guide', 'U', prefs.guide, () => { prefs.guide = !prefs.guide; savePrefs(); drawDock(); }),
    btn('Click', 'C', prefs.click, () => { prefs.click = !prefs.click; savePrefs(); drawDock(); }),
    btn('Headphones', '', prefs.headphones, () => { prefs.headphones = !prefs.headphones; savePrefs(); drawDock(); })];
  const again = h('button', { class: 'btn icon', type: 'button', title: 'Start over (Home)', onclick: (e) => { e.currentTarget.blur(); restart(); } }, icon('restart'));
  const go = [btn(clock.playing ? 'Pause' : 'Play', 'Enter', false, startStop, 'primary'), again, h('output', { id: 'time', class: 'time' })];
  if (!learn) { fill(dock, ...go, tempo, ...sound, chart && h('a', { class: 'btn', href: `#/learn/${chart.md5}`, text: 'Learn' })); return; }
  fill(dock, ...go,
    h('span', { class: 'group' }, btn('‹', '', false, () => startPart(learn.index - 1), 'icon'), h('output', { class: 'partname', text: `${learn.index + 1}/${learn.list.length} ${learn.part.name}` }), btn('›', '', false, () => startPart(learn.index + 1), 'icon')),
    tempo,
    btn(SETS.find((s) => s[0] === learn.set)[1], 'K', false, nextSet),
    btn('Listen', 'L', learn.listen, listen),
    btn('Auto', '', prefs.auto, () => { prefs.auto = !prefs.auto; savePrefs(); drawDock(); }),
    ...sound,
    btn('Got it', 'G', false, () => learned('marked as learned.', true)));
}

function drawHeart() {
  const liked = song ? library.isLiked(song.title, song.artist) : false;
  $('heart').classList.toggle('on', liked);
  fill($('heart'), icon('heart', liked));
  $('heart').disabled = !song;
}

// ---- the microphone ---------------------------------------------------------

mic.onHit = (hit) => {
  if (hit.loud) struck(hit.t, hit.pad, false);
  if (!$('setup').hidden && hit.loud) {
    $('lastHit').textContent = `Last hit: ${Math.round(hit.db)} dB${hit.pad ? `, sounds like ${PAD[hit.pad].name}` : ''}`;
  }
};
mic.onLevel = (db) => {
  if ($('setup').hidden) return;
  $('level').style.width = `${Math.max(0, Math.min(100, ((db + 60) / 55) * 100))}%`;
};

async function micOn() {
  try {
    await mic.start();
  } catch (e) {
    notice(e.message);
    $('micState').textContent = e.message;
  }
  showMic();
  return mic.running;
}

function showMic() {
  $('micBtn').querySelector('span').textContent = mic.running ? 'Mic on' : 'Mic off';
  $('micBtn').classList.toggle('on', mic.running);
  $('micToggle').textContent = mic.running ? 'Turn mic off' : 'Turn mic on';
  $('micState').textContent = mic.running ? 'Listening.' : '';
  showChips();
}

const toggleMic = () => { if (mic.running) { mic.stop(); showMic(); } else micOn(); };

// The "Sync by ear" button: one wide search, for when the notes are far off.
async function startListen() {
  if (!game || src === 'site') return;
  if (!clock.playing) { notice('Start the song first, then sync.'); return; }
  if (!(await micOn())) return;
  earAsked = now() + 30;
  earLast = null;
  $('listen').disabled = true;
  notice('Listening to the song… keep it playing for about 10 seconds.');
}

function learnDelay(delay) {
  const seen = [...store.get('ear.delays', []), delay].slice(-7);
  store.set('ear.delays', seen);
  usual = [...seen].sort((x, y) => x - y)[seen.length >> 1];
  store.set('ear.usual', usual);
}

// Line the notes up with what the mic hears. The mic hears the song as you
// do - late by whatever the speaker and Bluetooth add - so this is the one
// line-up that matches your ears. Runs every few seconds while the mic is on;
// `wide` is the button's search. Says what came of it.
function byEar(t, wide = false) {
  if (!mic.running || !game || !clock?.playing || src === 'site') return 'off';
  const length = Math.min(EAR_CLIP, Math.floor(t - steadyFrom - 0.3));
  if (length < EAR_LEAST) return 'wait';
  const clip = mic.clip(length);
  if (!clip) return 'wait';
  const began = clock.position(clip.start);                 // where the song was when the clip began
  const guess = began - game.offset;                        // ...and where in the chart we think that is
  const reach = wide ? 1.5 : 0.5;
  const found = locate(clip, game.notes, { from: guess - reach, to: guess + reach });
  if (!found || found.strength < 3.6) return 'unclear';
  // by itself only a small correction; the button may move the notes further
  const at = wide ? nearest(found, guess) : pick(found, guess);
  if (at === null) return 'unclear';
  const delay = began - at - (roughShift ?? 0);             // on top of what the lyrics said
  if (wide) {
    earBase = delay;
  } else {
    if (roughShift !== null && (delay < DELAY[0] || delay > DELAY[1])) return 'unclear';
    if (Math.abs(delay - earBase) > EAR_MOST) return 'unclear';   // small steps must not add up to a beat
    const twice = earLast !== null && Math.abs(delay - earLast) < 0.03;
    earLast = delay;
    if (!twice) return 'once';
  }
  // how late this setup's sound is, for songs not lined up by ear yet
  if (roughShift !== null && (wide || unique(found)) && delay >= DELAY[0] && delay <= DELAY[1]) learnDelay(delay);
  if (Math.abs(delay - fine) >= 0.012 || tunedBy !== 'ear') setFine(delay, 'ear');
  return 'done';
}

// ---- controls ---------------------------------------------------------------

fill($('views'), ...VIEWS.map(([name, label]) => h('button', { type: 'button', 'data-view': name, text: label, onclick: (e) => { setView(name); savePrefs(); e.currentTarget.blur(); } })));
$('chartPick').addEventListener('change', (e) => {
  chart = charts.find((c) => c.md5 === e.target.value) || chart;
  store.set(`pick.${song.id}`, chart.md5);
  if (learn) wantLearn = { partId: '' };
  learn = null;
  loadPicked();
});
$('difficulty').addEventListener('change', (e) => { store.set('difficulty', e.target.value); if (learn) wantLearn = { partId: String(learn.part.id) }; learn = null; loadPicked(); });
$('offReset').addEventListener('click', dropFine);
$('offDown').addEventListener('click', (e) => nudge(e.shiftKey ? -0.05 : -0.01));
$('offUp').addEventListener('click', (e) => nudge(e.shiftKey ? 0.05 : 0.01));
$('listen').addEventListener('click', startListen);
$('micBtn').addEventListener('click', (e) => { e.currentTarget.blur(); toggleMic(); });
$('heart').addEventListener('click', (e) => { e.currentTarget.blur(); if (song) toggleLike(filed(), drawHeart); });

addEventListener('keydown', (e) => {
  const typing = e.target.matches?.('input, select, textarea');
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if ($('play').hidden) {                                   // everywhere else: / goes to the search field
    if (e.key === '/' && !typing) { e.preventDefault(); $('search').focus(); }
    return;
  }
  if (typing) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const pad = KEY_TO_PAD[key];
  if (pad) {                                                // the drum keys never press a button
    e.preventDefault();
    if (!e.repeat) struck(now(), pad, true);
    return;
  }
  const own = clock instanceof OwnClock;
  if (key === '[') nudge(e.shiftKey ? -0.05 : -0.01);
  else if (key === ']') nudge(e.shiftKey ? 0.05 : 0.01);
  else if (key === '{') nudge(-0.05);
  else if (key === '}') nudge(0.05);
  else if (key === 'v') { setView(VIEWS[(VIEWS.findIndex((v) => v[0] === prefs.view) + 1) % VIEWS.length][0]); savePrefs(); }
  else if (key === 'h') $('heart').click();
  else if (key === 'm') toggleMic();
  else if (key === 'Escape') {
    if (document.querySelector(':popover-open')) return;
    if (src === 'site' && clock?.playing) startStop(); else location.hash = $('back').getAttribute('href');
  } else if (own && key === 'Enter') startStop();
  else if (own && key === 'Home') restart();
  else if (own && learn && key === 'ArrowLeft') startPart(learn.index - 1);
  else if (own && learn && key === 'ArrowRight') startPart(learn.index + 1);
  else if (own && key === 'ArrowLeft') { clock.seekTo(clock.position() - 5); game?.reset(clock.position()); }
  else if (own && key === 'ArrowRight') { clock.seekTo(clock.position() + 5); game?.reset(clock.position()); }
  else if (src === 'site' && key === 'ArrowUp') setTempo(0.1);
  else if (src === 'site' && key === 'ArrowDown') setTempo(-0.1);
  else if (src === 'site' && key === 'u') { prefs.guide = !prefs.guide; savePrefs(); drawDock(); }
  else if (src === 'site' && key === 'c') { prefs.click = !prefs.click; savePrefs(); drawDock(); }
  else if (learn && key === 'k') nextSet();
  else if (learn && key === 'l') listen();
  else if (learn && key === 'g') learned('marked as learned.', true);
  else return;
  e.preventDefault();
  if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
});

new ResizeObserver(() => stage?.resize()).observe($('stage'));
document.addEventListener('visibilitychange', () => {       // the site's own drums don't play to an empty room
  if (document.hidden && src === 'site' && clock?.playing && !$('play').hidden) startStop();
});

// A song played on a silent clock you start yourself (your own record, the demo link).
function playSelf(c) {
  clock?.stop();
  src = 'self';
  const s = { id: `manual.${c.md5}`, title: c.name, artist: c.artist, charts: [c] };   // no length: the chart's own isn't the song's
  clock = new OwnClock(s);
  drawDock();
  return setSong(s);
}

// A link like ?demo=everlong foo fighters&at=20#/colors opens straight into
// a song with the clock running: for showing the site off without Spotify.
async function demo(query, at) {
  try {
    const found = await searchCharts(query);
    if (!found.length) { notice('No drum part found for that.'); return; }
    // of the versions of the first song found, the one the site would pick itself
    const like = { title: found[0].name, artist: found[0].artist };
    const ranked = found.map((c) => ({ ...c, fit: fit(c, like) })).sort((x, y) => y.fit - x.fit);
    const asked = new URLSearchParams(location.search);
    await playSelf(found.find((c) => c.md5 === asked.get('chart')) || ranked[0]);     // &chart=<md5>: that chart
    if (asked.get('mic')) await micOn();                                             // &mic=1: with the microphone on
    if (game) { clock.set(at, true); notice(''); }
  } catch (e) {
    notice(e.message);
  }
}

// ---- setup ------------------------------------------------------------------

function showSetup(message) {
  $('redirect').textContent = spotify.redirectUri();
  $('clientId').value = spotify.clientId();
  const on = spotify.linked();
  $('unlink').hidden = !on;
  $('link').textContent = on ? 'Link again' : 'Link Spotify';
  $('spotifyState').textContent = message || (on ? 'Linked. Play a song on Spotify, then press Play along on the home screen.' : 'Not linked yet.');
  $('threshold').value = mic.threshold;
  showThreshold();
  showMic();
  showTeach();
}

function showThreshold() {
  $('thresholdOut').textContent = `${mic.threshold} dB`;
  $('mark').style.left = `${((mic.threshold + 60) / 55) * 100}%`;
}

function showTeach() {
  fill($('teach'), ...PADS.map((p) => {
    const b = h('button', { type: 'button', text: p.name, style: `--c:${p.color}` });
    b.classList.toggle('done', mic.taught.includes(p.id));
    b.addEventListener('click', () => teach(p, b));
    return b;
  }));
}

async function teach(pad, button) {
  if (!(await micOn())) return;
  mic.cancelLearn();
  button.classList.add('busy');
  $('teachState').textContent = `Hit the ${pad.name} 4 times…`;
  const ok = await mic.learn(pad.id, 4, (n, of) => { $('teachState').textContent = `${pad.name}: ${n} of ${of}`; });
  if (ok) $('teachState').textContent = `${pad.name} learned.`;
  showTeach();
}

$('clientId').addEventListener('change', (e) => spotify.setClientId(e.target.value));
$('copyRedirect').addEventListener('click', async () => {
  await navigator.clipboard.writeText(spotify.redirectUri()).catch(() => {});
  $('copyRedirect').textContent = 'Copied';
});
$('link').addEventListener('click', async () => {
  spotify.setClientId($('clientId').value);
  try {
    await spotify.login();
  } catch (e) {
    $('spotifyState').textContent = e.message;
  }
});
$('unlink').addEventListener('click', () => {
  spotify.unlink();
  if (src === 'spotify') { clock?.stop(); clock = null; playing = ''; }
  showSetup();
  showChips();
});
$('micToggle').addEventListener('click', toggleMic);
$('threshold').addEventListener('input', (e) => { mic.setThreshold(Number(e.target.value)); showThreshold(); });
$('forget').addEventListener('click', () => { mic.forget(); $('teachState').textContent = 'Forgotten.'; showTeach(); });
$('testSound').addEventListener('click', async () => {
  await synth.start().catch(() => {});
  const t0 = now() + 0.15;
  ['kick', 'snare', 'hihat', 'hihat', 'tom', 'floor', 'crash', 'ride'].forEach((pad, i) => synth.hit(pad, t0 + i * 0.3, {}));
});

// ---- start ------------------------------------------------------------------

// For poking at the game from the browser console.
window.airdrums = {
  get clock() { return clock; },
  get game() { return game; },
  get song() { return song; },
  get parsed() { return parsed; },
  get stage() { return stage; },
  get learn() { return learn; },
  get src() { return src; },
  get parts() { return partList; },
  player, synth, library,
  // what the mic's last seconds look like against the chart, for checking the line-up by ear
  hear(seconds = EAR_CLIP, reach = 1.5) {
    const clip = mic.clip(seconds);
    if (!clip || !game) return null;
    const began = clock.position(clip.start);
    const guess = began - game.offset;
    const found = locate(clip, game.notes, { from: guess - reach, to: guess + reach });
    return { began, guess, steadyFor: now() - steadyFrom, found };
  },
  mic,
};

initPages();
addEventListener('hashchange', route);
const came = await spotify.finishLogin();
if (came) {
  location.hash = '#/setup';
  route();
  showSetup(came === 'linked' ? 'Linked. Play a song on Spotify, then press Play along on the home screen.' : came);
} else {
  if (demoLink && !VIEWS.some((v) => location.hash.startsWith(`#/${v[0]}`))) location.hash = '#/tab';
  route();
}
