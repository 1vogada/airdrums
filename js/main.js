// Ties the pages together: menu, the game pages (tab, drums, colors, taiko, mania) and setup.

import { PADS, PAD, KEY_TO_PAD } from './kit.js';
import * as store from './store.js';
import * as spotify from './spotify.js';
import { Follow, ManualClock } from './spotify.js';
import { findCharts, searchCharts, loadChart, lyricShift, fit } from './charts.js';
import { syncedLyrics } from './lyrics.js';
import { Mic } from './mic.js';
import { Game } from './game.js';
import { locate, pick, unique, nearest } from './align.js';
import { Stage } from './render.js';

const $ = (id) => document.getElementById(id);
const now = () => performance.now() / 1000;
const EAR_EVERY = 3;                    // seconds between line-ups by ear while the mic is on
const EAR_CLIP = 12;                    // seconds of sound a line-up is worked out from
const EAR_LEAST = 8;                    // ...and the least it will try with
const DELAY = [-0.15, 0.6];             // how late a setup's sound can believably be, in seconds
const EAR_MOST = 0.15;                  // the furthest the mic may move the notes by itself, in all

const mic = new Mic();
let clock = null;                       // Follow (Spotify) or ManualClock
let song = null;
let charts = [];
let chart = null;
let parsed = null;
let lyrics = null;
let game = null;
let stage = null;
let frame = 0;
let loading = 0;                        // bumps on every load, so a slow one can't land on a newer song
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

// ---- routing ----------------------------------------------------------------

const MODES = { tab: 'tab', drums: 'kit', colors: 'lanes', taiko: 'taiko', mania: 'mania' };     // page name -> how the stage draws it

function route() {
  const where = location.hash.replace(/^#\/?/, '') || 'menu';
  const page = MODES[where] ? 'play' : where === 'setup' || where === 'map' ? where : 'menu';
  for (const id of ['menu', 'play', 'setup', 'map']) $(id).hidden = id !== page;
  cancelAnimationFrame(frame);
  if (page === 'play') enterPlay(MODES[where]);
  if (page === 'menu') showMenu();
  if (page === 'setup') showSetup();
}

function showMenu() {
  $('menuSpotify').textContent = spotify.linked() ? 'Spotify linked' : 'Spotify not linked';
  $('menuMic').textContent = mic.running ? 'Mic on' : 'Mic off';
}

// ---- the game pages ---------------------------------------------------------

function enterPlay(mode) {
  stage = new Stage($('stage'), mode);
  if (!clock || (clock instanceof ManualClock && spotify.linked() && !demoLink)) startClock();
  $('manual').hidden = Boolean(clock);
  $('manualKeys').hidden = !(clock instanceof ManualClock);
  showMic();
  tick();
}

function startClock() {
  clock?.stop();
  clock = null;
  if (!spotify.linked() || demoLink) { notice(''); return; }
  notice('Waiting for Spotify… play a song there.');
  clock = new Follow(setSong, (err) => { if (err && !game) notice(err); });
}

function notice(text) {
  $('notice').textContent = text || '';
  $('notice').hidden = !text;
}

async function setSong(s) {
  song = s;
  game = null;
  parsed = null;
  lyrics = null;
  roughShift = null;
  $('title').textContent = s.title;
  $('artist').textContent = s.artist;
  $('art').hidden = !s.art;
  if (s.art) $('art').src = s.art;
  $('line').textContent = $('nextLine').textContent = '';
  const mine = ++loading;
  notice(`Looking for the drum chart of ${s.title}…`);
  syncedLyrics(s).then((l) => { if (mine === loading) { lyrics = l; applyRough(); } }).catch(() => {});
  try {
    const found = s.charts || await findCharts(s);
    if (mine !== loading) return;
    charts = found;
    fillCharts();
    if (!charts.length) {
      notice(`No drum chart found for ${s.title}. Rock and metal are covered best; try another song.`);
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
  notice('Loading the chart…');
  try {
    const got = await loadChart(chart, store.get('difficulty', 'expert'));
    if (mine !== loading) return;
    parsed = got;
    game = new Game(parsed.notes);
    game.bars = parsed.bars;
    game.beats = parsed.beats;
    fillDifficulty();
    roughShift = null;
    earLast = null;
    const saved = store.get(fineKey(), null);
    fine = saved ?? usual ?? 0;                 // nothing kept for this song: how late this setup usually is
    earBase = fine;
    tunedBy = saved !== null ? 'saved' : null;
    game.offset = fine;
    applyRough();
    game.reset(clock.position());
    showOffset();
    notice(clock instanceof ManualClock && !clock.playing ? 'Press Enter when your song starts.' : '');
  } catch (e) {
    if (mine === loading) { game = null; notice(e.message); }
  }
}

const fineKey = () => `fine.${song.id}.${chart.md5}`;

// The lyrics and the chart both know when each line is sung: the gap between
// them is how far the chart's copy of the song is from Spotify's. Your own
// tuning goes on top of it.
function applyRough() {
  if (!game || !lyrics || !parsed) return;
  roughShift = lyricShift(parsed.phrases, lyrics.filter((l) => l.text).map((l) => l.t));
  if (roughShift !== null) { game.offset = roughShift + fine; game.reset(clock.position()); showOffset(); }
}

function fillCharts() {
  const sel = $('chartPick');
  sel.replaceChildren(...charts.map((c) => {
    const o = document.createElement('option');
    o.value = c.md5;
    const version = /live|acoustic|demo|remix|cover/i.exec(c.name);       // not the recording you're hearing
    o.textContent = `${c.charter || 'unknown'} · ${clockTime(c.length)}${c.drumType === 1 ? '' : ' · simple'}`
      + (version ? ` · ${version[0].toLowerCase()} version` : '');
    return o;
  }));
  sel.disabled = charts.length < 2;
}

function fillDifficulty() {
  const sel = $('difficulty');
  sel.replaceChildren(...parsed.available.map((d) => {
    const o = document.createElement('option');
    o.value = d;
    o.textContent = d[0].toUpperCase() + d.slice(1);
    return o;
  }));
  sel.value = parsed.difficulty;
  sel.disabled = parsed.available.length < 2;
}

const clockTime = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

function showOffset() {
  const ms = Math.round((game?.offset || 0) * 1000);
  const how = !game ? '' : { ear: 'by ear', hand: 'tuned', saved: 'saved' }[tunedBy]
    || (roughShift !== null ? 'auto' : 'not synced');
  $('offset').textContent = `${ms > 0 ? '+' : ''}${ms} ms${how ? ` · ${how}` : ''}`;
}

// Your tuning (or the mic's) on top of the automatic line-up, kept for this song and chart.
function setFine(seconds, by = 'hand') {
  if (!game) return;
  fine = seconds;
  if (by === 'hand') earBase = fine;            // you set it: the mic works from there
  tunedBy = by;
  store.set(fineKey(), fine);
  game.offset = (roughShift ?? 0) + fine;
  showOffset();
}

// Back to the automatic line-up.
function dropFine() {
  if (!game) return;
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

function tick() {
  frame = requestAnimationFrame(tick);
  const t = now();
  const pos = clock ? clock.position(t) : 0;
  // the mic can only place the song in a stretch that played straight through
  if (!clock?.playing || Math.abs(pos - lastPos - (t - lastTick)) > 0.25) { steadyFrom = t; earLast = null; }
  lastPos = pos;
  lastTick = t;
  if (earAsked) {                                           // the button: keep trying until there's enough sound
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
  if (game && clock.playing) game.update(pos, t);
  stage.draw(game, pos, t);
  $('score').textContent = game ? game.score.toLocaleString('en') : '0';
  $('combo').textContent = game && game.combo > 1 ? `${game.combo} combo` : '';
  $('acc').textContent = game && game.judged ? `${Math.round(game.accuracy * 100)}% · ${game.counts.miss} missed` : '';
  if (lyrics) {
    let i = -1;
    while (i + 1 < lyrics.length && lyrics[i + 1].t <= pos) i++;
    $('line').textContent = i >= 0 ? lyrics[i].text || '♪' : '';
    $('nextLine').textContent = lyrics[i + 1]?.text || '';
  }
}

// A drum was hit: by a key (we know which) or by a sound the mic heard.
function struck(t, pad, sure) {
  if (!stage || $('play').hidden) return;
  if (pad) stage.flash(pad, t);
  if (pad && PAD[pad].free) return;                   // nothing is written for it: it only lights up
  if (game && clock?.playing) game.hit(clock.position(t), t, pad, sure);
}

mic.onHit = (h) => {
  if (h.loud) struck(h.t, h.pad, false);
  if (!$('setup').hidden && h.loud) {
    $('lastHit').textContent = `Last hit: ${Math.round(h.db)} dB${h.pad ? `, sounds like ${PAD[h.pad].name}` : ''}`;
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
  $('micBtn').textContent = mic.running ? 'Mic on' : 'Mic off';
  $('micBtn').classList.toggle('on', mic.running);
  $('micToggle').textContent = mic.running ? 'Turn mic off' : 'Turn mic on';
  $('micState').textContent = mic.running ? 'Listening.' : '';
}

// The "Sync by ear" button: one wide search, for when the notes are far off.
async function startListen() {
  if (!game) return;
  if (!clock.playing) { notice('Start the song first, then sync.'); return; }
  if (!(await micOn())) return;
  earAsked = now() + 30;
  earLast = null;
  $('listen').disabled = true;
  notice('Listening to the song… keep it playing for about 10 seconds.');
}

function learn(delay) {
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
  if (!mic.running || !game || !clock?.playing) return 'off';
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
  if (roughShift !== null && (wide || unique(found)) && delay >= DELAY[0] && delay <= DELAY[1]) learn(delay);
  if (Math.abs(delay - fine) >= 0.012 || tunedBy !== 'ear') setFine(delay, 'ear');
  return 'done';
}

$('chartPick').addEventListener('change', (e) => {
  chart = charts.find((c) => c.md5 === e.target.value) || chart;
  store.set(`pick.${song.id}`, chart.md5);
  loadPicked();
});
$('difficulty').addEventListener('change', (e) => { store.set('difficulty', e.target.value); loadPicked(); });
$('offset').addEventListener('click', dropFine);
$('offDown').addEventListener('click', (e) => nudge(e.shiftKey ? -0.05 : -0.01));
$('offUp').addEventListener('click', (e) => nudge(e.shiftKey ? 0.05 : 0.01));
$('listen').addEventListener('click', startListen);
$('micBtn').addEventListener('click', () => { if (mic.running) { mic.stop(); showMic(); } else micOn(); });
$('restart').addEventListener('click', async () => {
  if (clock instanceof ManualClock) { clock.seekTo(0); return; }
  if (!clock) return;
  try {
    await spotify.seek(0);
    clock.ask();
  } catch (e) {
    notice(e.message);
  }
});

addEventListener('keydown', (e) => {
  if ($('play').hidden || e.target.matches?.('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const pad = KEY_TO_PAD[key];
  if (pad) {
    e.preventDefault();
    if (!e.repeat) struck(now(), pad, true);
    return;
  }
  if (key === '[') nudge(e.shiftKey ? -0.05 : -0.01);
  else if (key === ']') nudge(e.shiftKey ? 0.05 : 0.01);
  else if (key === '{') nudge(-0.05);
  else if (key === '}') nudge(0.05);
  else if (clock instanceof ManualClock) {
    if (key === 'Enter') { clock.toggle(); notice(''); }
    else if (key === 'ArrowLeft') clock.seekTo(clock.position() - 5);
    else if (key === 'ArrowRight') clock.seekTo(clock.position() + 5);
    else if (key === 'Home') clock.seekTo(0);
    else return;
    e.preventDefault();
  }
});

new ResizeObserver(() => stage?.resize()).observe($('stage'));

// Playing without Spotify: find a chart by name and run the clock yourself.
$('manual').addEventListener('submit', async (e) => {
  e.preventDefault();
  const list = $('results');
  list.replaceChildren();
  try {
    const found = await searchCharts($('q').value.trim());
    if (!found.length) { list.append(li('No drum chart found for that.')); return; }
    for (const c of found.slice(0, 12)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = '<b></b> <small></small>';
      b.firstChild.textContent = `${c.artist} - ${c.name}`;
      b.lastChild.textContent = `${clockTime(c.length)} · by ${c.charter || 'unknown'}`;
      b.addEventListener('click', () => playManual(c));
      const item = document.createElement('li');
      item.append(b);
      list.append(item);
    }
  } catch (err) {
    list.append(li(err.message));
  }
});

function playManual(c) {
  clock?.stop();
  const s = { id: `manual.${c.md5}`, title: c.name, artist: c.artist, charts: [c] };   // no length: the chart's own isn't the song's
  clock = new ManualClock(s);
  $('manual').hidden = true;
  $('manualKeys').hidden = false;
  return setSong(s);
}

// A link like ?demo=everlong foo fighters&at=20#/colors opens straight into
// a song with the clock running: for showing the site off without Spotify.
async function demo(query, at) {
  try {
    const found = await searchCharts(query);
    if (!found.length) { notice('No drum chart found for that.'); return; }
    // of the versions of the first song found, the one the site would pick itself
    const like = { title: found[0].name, artist: found[0].artist };
    const ranked = found.map((c) => ({ ...c, fit: fit(c, like) })).sort((a, b) => b.fit - a.fit);
    const asked = new URLSearchParams(location.search);
    await playManual(found.find((c) => c.md5 === asked.get('chart')) || ranked[0]);   // &chart=<md5>: that chart
    if (asked.get('mic')) await micOn();                                             // &mic=1: with the microphone on
    if (game) { clock.set(at, true); notice(''); }
  } catch (e) {
    notice(e.message);
  }
}

function li(text) {
  const item = document.createElement('li');
  item.textContent = text;
  return item;
}

// ---- setup ------------------------------------------------------------------

function showSetup(message) {
  $('redirect').textContent = spotify.redirectUri();
  $('clientId').value = spotify.clientId();
  const on = spotify.linked();
  $('unlink').hidden = !on;
  $('link').textContent = on ? 'Link again' : 'Link Spotify';
  $('spotifyState').textContent = message || (on ? 'Linked. Play a song on Spotify and pick a page from the menu.' : 'Not linked yet.');
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
  $('teach').replaceChildren(...PADS.map((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = p.name;
    b.style.setProperty('--c', p.color);
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
  clock?.stop();
  clock = null;
  showSetup();
});
$('micToggle').addEventListener('click', () => { if (mic.running) { mic.stop(); showMic(); } else micOn(); });
$('threshold').addEventListener('input', (e) => { mic.setThreshold(Number(e.target.value)); showThreshold(); });
$('forget').addEventListener('click', () => { mic.forget(); $('teachState').textContent = 'Forgotten.'; showTeach(); });

// ---- start ------------------------------------------------------------------

// For poking at the game from the browser console.
window.airdrums = {
  get clock() { return clock; },
  get game() { return game; },
  get song() { return song; },
  get parsed() { return parsed; },
  get stage() { return stage; },
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

addEventListener('hashchange', route);
const came = await spotify.finishLogin();
if (came) {
  location.hash = '#/setup';
  route();
  showSetup(came === 'linked' ? 'Linked. Play a song on Spotify and pick a page from the menu.' : came);
} else {
  const q = new URLSearchParams(location.search);
  if (q.get('demo') && !/^#\/(tab|drums|colors|taiko|mania)/.test(location.hash)) location.hash = '#/tab';
  route();
  if (q.get('demo')) demo(q.get('demo'), Number(q.get('at')) || 0);
}
