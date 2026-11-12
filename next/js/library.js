// Your songs: the ones you liked, the ones you played, your best scores and
// how far you got learning each part. Everything stays in this browser.
//
// A song is the same song whether Spotify played it or you looked it up, so
// it is filed under its artist and title, not under an id either of them gives.

import * as store from './store.js';
import { cleanTitle, songKey } from './text.js';

const KEY = 'library';
const KEEP_CHARTS = 6;                 // chart versions remembered per song, so opening it again needs no search
const KEEP_RUNS = 12;                  // past runs remembered per song

export { songKey };

// A letter for how a run went, from the share of the points you got.
export function grade(accuracy) {
  if (accuracy >= 0.95) return 'S';
  if (accuracy >= 0.88) return 'A';
  if (accuracy >= 0.78) return 'B';
  if (accuracy >= 0.65) return 'C';
  return 'D';
}

let cache = null;
const listeners = new Set();

// The time now, never the same twice: two things done in one millisecond keep their order.
let last = 0;
function stamp() {
  last = Math.max(Date.now(), last + 1);
  return last;
}

function load() {
  if (!cache) {
    const kept = store.get(KEY, null);
    cache = kept && typeof kept === 'object' && kept.songs ? kept : { songs: {} };
  }
  return cache;
}

function save() {
  store.set(KEY, cache);
  for (const fn of listeners) fn();
}

// Call `fn` whenever anything about your songs changes. Returns how to stop.
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const slim = (c) => ({
  md5: c.md5, name: c.name, artist: c.artist, album: c.album || '', charter: c.charter || '', length: c.length || 0,
  drumType: c.drumType ?? 0, lyrics: Boolean(c.lyrics), delay: c.delay || 0, notes: c.notes || 0, art: c.art || '',
  year: c.year || 0, playLength: c.playLength || 0, levels: c.levels || {}, tier: c.tier ?? -1,
});

// The song's entry, made or filled in from what is known about it now:
// { title, artist, album, art, length, charts }. Returns the entry.
export function remember(song) {
  const key = songKey(song.title, song.artist);
  if (!key || key === '|') return null;
  const all = load().songs;
  const e = all[key] || { key, title: song.title, artist: song.artist, album: '', art: '', length: 0, charts: [], liked: 0, played: 0, plays: 0, best: null, runs: [], parts: {} };
  if (!all[key]) e.title = cleanTitle(song.title) || song.title;
  if (song.album && !e.album) e.album = song.album;
  if (song.art) e.art = song.art;
  if (song.length || song.duration) e.length = song.length || song.duration;
  if (song.charts?.length) e.charts = song.charts.slice(0, KEEP_CHARTS).map(slim);
  if (song.spotify) e.spotify = song.spotify;                // spotify:track:... once it is known
  all[key] = e;
  return e;
}

export const get = (key) => load().songs[key] || null;
export const all = () => Object.values(load().songs);

// Something on an entry was changed in place (the version you chose, progress reset): keep it.
export const touch = () => save();

// Take a song out of the recent list without forgetting the rest about it.
export function unplay(key) {
  const e = load().songs[key];
  if (e) { e.played = 0; save(); }
}
export const find = (title, artist) => get(songKey(title, artist));

export function like(song, on = true) {
  const e = remember(song);
  if (!e) return null;
  e.liked = on ? stamp() : 0;
  save();
  return e;
}

export const isLiked = (title, artist) => Boolean(find(title, artist)?.liked);

export function liked() {
  return Object.values(load().songs).filter((e) => e.liked).sort((a, b) => b.liked - a.liked);
}

export function recent(limit = 12) {
  return Object.values(load().songs).filter((e) => e.played).sort((a, b) => b.played - a.played).slice(0, limit);
}

// You opened the song to play it.
export function played(song) {
  const e = remember(song);
  if (!e) return null;
  e.played = stamp();
  save();
  return e;
}

// A finished run: { score, accuracy, combo, counts, mode, chart, level, notes, rate }.
// Returns { entry, best: true when it beat your best, previous }.
export function record(song, run) {
  const e = remember(song);
  if (!e) return null;
  const kept = { ...run, grade: grade(run.accuracy), at: stamp() };
  const previous = e.best;
  const beat = !previous || kept.score > previous.score;
  if (beat) e.best = kept;
  e.plays = (e.plays || 0) + 1;
  e.played = kept.at;
  e.runs = [kept, ...(e.runs || [])].slice(0, KEEP_RUNS);
  save();
  return { entry: e, best: beat, previous, run: kept };
}

// Learning: how clean you got one part of the song, and at what tempo.
// Kept per chart, since another chart cuts the song up differently.
export function partDone(song, chart, part, { accuracy, rate }) {
  const e = remember(song);
  if (!e) return null;
  e.parts ||= {};
  const id = `${chart}|${part}`;
  const old = e.parts[id];
  const better = !old || rate > old.rate || (rate === old.rate && accuracy > old.accuracy);
  if (better) e.parts[id] = { accuracy, rate, at: stamp() };
  e.parts[id].tries = (old?.tries || 0) + 1;
  save();
  return e.parts[id];
}

export const part = (entry, chart, name) => entry?.parts?.[`${chart}|${name}`] || null;

// A part counts as learned once it was clean at (nearly) full tempo.
export const learned = (p) => Boolean(p && p.rate >= 0.99 && p.accuracy >= 0.85);

export function forget(key) {
  delete load().songs[key];
  save();
}

// For tests: start from what is in storage again.
export function reload() { cache = null; }
