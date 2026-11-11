// Ties the pages together: menu, the two game pages (drums and colors) and setup.

import { PADS, PAD, KEY_TO_PAD } from './kit.js';
import * as store from './store.js';
import * as spotify from './spotify.js';
import { Follow, ManualClock } from './spotify.js';
import { findCharts, searchCharts, loadChart, lyricShift, fit } from './charts.js';
import { syncedLyrics } from './lyrics.js';
import { Mic } from './mic.js';
import { Game, listenShift } from './game.js';
import { Stage } from './render.js';

const $ = (id) => document.getElementById(id);
const now = () => performance.now() / 1000;
const LISTEN = 12;                      // seconds "sync by ear" listens for

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
let listening = null;                   // { until, heard: [] } while syncing by ear
const demoLink = new URLSearchParams(location.search).get('demo');   // ?demo=song: play it without Spotify
let roughShift = null;                  // what the lyrics say the chart is off by
let fine = 0;                           // your own tuning on top of that, kept per song and chart

// ---- routing ----------------------------------------------------------------

function route() {
  const where = location.hash.replace(/^#\/?/, '') || 'menu';
  const page = where === 'drums' || where === 'colors' ? 'play' : where === 'setup' || where === 'map' ? where : 'menu';
  for (const id of ['menu', 'play', 'setup', 'map']) $(id).hidden = id !== page;
  cancelAnimationFrame(frame);
  if (page === 'play') enterPlay(where === 'drums' ? 'kit' : 'lanes');
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
    fillDifficulty();
    roughShift = null;
    fine = store.get(fineKey(), 0);
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
  const how = !game ? '' : fine ? 'tuned' : roughShift !== null ? 'auto' : 'not synced';
  $('offset').textContent = `${ms > 0 ? '+' : ''}${ms} ms${how ? ` · ${how}` : ''}`;
}

function setFine(seconds) {
  if (!game) return;
  fine = seconds;
  if (fine) store.set(fineKey(), fine); else store.del(fineKey());
  game.offset = (roughShift ?? 0) + fine;
  showOffset();
}

const nudge = (seconds) => setFine(fine + seconds);

function tick() {
  frame = requestAnimationFrame(tick);
  const t = now();
  const pos = clock ? clock.position(t) : 0;
  if (listening && t >= listening.until) finishListen();
  if (game && clock.playing && !listening) game.update(pos, t);
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
  if (game && clock?.playing && !listening) game.hit(clock.position(t), t, pad, sure);
}

mic.onHit = (h) => {
  if (listening) {
    if (clock?.playing) listening.heard.push(clock.position(h.t));
    return;
  }
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

async function startListen() {
  if (!game || listening) return;
  if (!clock.playing) { notice('Start the song first, then sync.'); return; }
  if (!(await micOn())) return;
  listening = { until: now() + LISTEN, heard: [] };
  $('listen').disabled = true;
  notice(`Listening to the song for ${LISTEN} seconds… don't play yet.`);
}

function finishListen() {
  const { heard } = listening;
  listening = null;
  $('listen').disabled = false;
  const wide = roughShift === null && !fine;
  const shift = game ? listenShift(game.groupTimes, heard, game.offset, wide ? 3 : 1) : null;
  if (shift === null) {
    notice(`Couldn't make out the drums (${heard.length} sounds heard). Turn the music up or move the mic closer, or nudge with − and +.`);
  } else {
    setFine(shift - (roughShift ?? 0));
    notice('');
  }
  if (game) game.reset(clock.position());
}

$('chartPick').addEventListener('change', (e) => {
  chart = charts.find((c) => c.md5 === e.target.value) || chart;
  store.set(`pick.${song.id}`, chart.md5);
  loadPicked();
});
$('difficulty').addEventListener('change', (e) => { store.set('difficulty', e.target.value); loadPicked(); });
$('offset').addEventListener('click', () => { setFine(0); if (game) game.reset(clock.position()); });
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
  if ($('play').hidden || e.target.matches('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
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
  const s = { id: `manual.${c.md5}`, title: c.name, artist: c.artist, duration: c.length, charts: [c] };
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
    await playManual(ranked[0]);
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
  $('spotifyState').textContent = message || (on ? 'Linked. Play a song on Spotify and open Drums or Colors.' : 'Not linked yet.');
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
  mic,
};

addEventListener('hashchange', route);
const came = await spotify.finishLogin();
if (came) {
  location.hash = '#/setup';
  route();
  showSetup(came === 'linked' ? 'Linked. Play a song on Spotify and open Drums or Colors.' : came);
} else {
  const q = new URLSearchParams(location.search);
  if (q.get('demo') && !/^#\/(drums|colors)/.test(location.hash)) location.hash = '#/colors';
  route();
  if (q.get('demo')) demo(q.get('demo'), Number(q.get('at')) || 0);
}
