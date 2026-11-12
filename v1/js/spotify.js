// The Spotify link: which song is playing and how far into it you are.
//
// Same idea as minitype: Spotify only lets a hobby app have a handful of
// users, so the site ships no app of its own. You make a free app at
// developer.spotify.com/dashboard, add this page's address as its redirect
// URI and paste its client ID in setup. Login is the PKCE flow (no client
// secret); the tokens stay in this browser.

import * as store from './store.js';

const AUTH = 'https://accounts.spotify.com/authorize';
const TOKEN = 'https://accounts.spotify.com/api/token';
const PLAYER = 'https://api.spotify.com/v1/me/player';
const SCOPES = 'user-read-currently-playing user-read-playback-state user-modify-playback-state';

const now = () => performance.now() / 1000;

export class SpotifyError extends Error {}

// The address Spotify sends the login back to: this page, without index.html.
export function redirectUri() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

export const clientId = () => (store.get('spotify.clientId', '') || '').trim();
export const setClientId = (id) => store.set('spotify.clientId', (id || '').trim());
export const linked = () => Boolean(store.get('spotify.tokens')?.refresh_token);
export const unlink = () => store.del('spotify.tokens');

function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function post(form) {
  let res;
  try {
    res = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form),
    });
  } catch {
    throw new SpotifyError("couldn't reach spotify - are you online?");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new SpotifyError(`spotify said no (${res.status}${body.error_description ? ': ' + body.error_description : ''})`);
  return body;
}

function keep(d) {
  const old = store.get('spotify.tokens') || {};
  store.set('spotify.tokens', {
    access_token: d.access_token,
    refresh_token: d.refresh_token || old.refresh_token,
    expires_at: Date.now() + (Number(d.expires_in) || 3600) * 1000 - 60000,
    client_id: clientId(),
  });
}

// Send the browser to Spotify's login; it comes back to this page with a code.
export async function login() {
  const id = clientId();
  if (!id) throw new SpotifyError('paste your spotify client id first');
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(64)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  store.set('spotify.pending', { verifier, state });
  location.assign(`${AUTH}?${new URLSearchParams({
    client_id: id, response_type: 'code', redirect_uri: redirectUri(),
    code_challenge_method: 'S256', code_challenge: challenge, scope: SCOPES, state,
  })}`);
}

// Call once when the page loads: if Spotify just sent the browser back, keep
// the login. Returns 'linked', an error message, or null when nothing came back.
export async function finishLogin() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return null;
  const pending = store.get('spotify.pending');
  store.del('spotify.pending');
  history.replaceState(null, '', redirectUri() + location.hash);
  if (q.get('error')) return `spotify said: ${q.get('error')}`;
  if (!pending || q.get('state') !== pending.state) return "the login answer didn't match - try again";
  try {
    keep(await post({
      grant_type: 'authorization_code', code: q.get('code'), redirect_uri: redirectUri(),
      client_id: clientId(), code_verifier: pending.verifier,
    }));
    return 'linked';
  } catch (e) {
    return e.message;
  }
}

let refreshing = null;

async function token() {
  const t = store.get('spotify.tokens');
  if (!t?.refresh_token) throw new SpotifyError('not linked to spotify yet');
  if (t.access_token && Date.now() < t.expires_at) return t.access_token;
  refreshing ||= post({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: t.client_id || clientId() })
    .then(keep)
    .finally(() => { refreshing = null; });
  await refreshing;
  return store.get('spotify.tokens').access_token;
}

async function api(path, init = {}) {
  let res;
  try {
    res = await fetch(PLAYER + path, { ...init, headers: { Authorization: `Bearer ${await token()}` } });
  } catch (e) {
    if (e instanceof SpotifyError) throw e;
    throw new SpotifyError("couldn't reach spotify - are you online?");
  }
  if (res.status === 401) throw new SpotifyError('the spotify login ran out - link again in setup');
  if (res.status === 403) throw new SpotifyError('spotify said no (403) - that needs spotify premium');
  if (res.status === 429) {
    const e = new SpotifyError('spotify says too many requests - waiting a bit');
    e.retryAfter = Number(res.headers.get('Retry-After')) || 5;
    throw e;
  }
  if (!res.ok && res.status !== 204) throw new SpotifyError(`spotify said ${res.status}`);
  return res;
}

function track(item) {
  return {
    id: item.id || `${item.name}|${item.duration_ms}`,
    title: item.name || '',
    artist: (item.artists || []).map((a) => a.name).join(', '),
    album: item.album?.name || '',
    art: item.album?.images?.[1]?.url || item.album?.images?.[0]?.url || '',
    duration: (item.duration_ms || 0) / 1000,
  };
}

// What's playing: { id, title, artist, album, duration, progress, playing, at }
// (seconds; `at` is when it was asked), or null when nothing is.
export async function nowPlaying() {
  const sent = now();
  const res = await api('/currently-playing');
  if (res.status === 204) return null;
  const d = await res.json().catch(() => null);
  const at = (sent + now()) / 2;          // spotify read the progress somewhere in between
  if (!d?.item || (d.item.type && d.item.type !== 'track')) return null;
  return { ...track(d.item), progress: (d.progress_ms || 0) / 1000, playing: Boolean(d.is_playing), at };
}

// Jump to a place in the song (needs Spotify Premium).
export async function seek(seconds) {
  await api(`/seek?position_ms=${Math.max(0, Math.round(seconds * 1000))}`, { method: 'PUT' });
}

// Keeps up with Spotify in the background: asks what's playing every EVERY
// seconds so the notes follow a pause, a seek or a skip. `onSong(song)` is
// called when a different song comes on.
export class Follow {
  static EVERY = 2.0;
  static SEEK = 2.0;                      // an answer this far off is a seek, not jitter
  static KEEP = 3;                        // answers the steady clock is read from

  constructor(onSong, onError) {
    this.now = null;                      // the latest answer
    this.onSong = onSong;
    this.onError = onError || (() => {});
    this.starts = [];
    this.stopped = false;
    this.wait = 0;
    this.loop();
  }

  get song() { return this.now; }
  get playing() { return Boolean(this.now?.playing); }

  // Seconds into the song at time t (performance seconds).
  position(t = now()) {
    const n = this.now;
    if (!n) return 0;
    return n.playing ? n.progress + (t - n.at) : n.progress;
  }

  async loop() {
    while (!this.stopped) {
      await this.ask();
      await new Promise((r) => setTimeout(r, (this.wait || Follow.EVERY) * 1000));
      this.wait = 0;
    }
  }

  async ask() {
    let got;
    try {
      got = await nowPlaying();
      this.onError(null);
    } catch (e) {
      this.wait = e.retryAfter || 0;
      this.onError(e.message);
      return;
    }
    if (this.stopped) return;
    if (!got) {                           // nothing playing: hold where it was
      if (this.now) this.now = { ...this.now, playing: false, progress: this.position(), at: now() };
      return;
    }
    const changed = got.id !== this.now?.id;
    this.now = this.steady(got);
    if (changed) this.onSong(got);
  }

  // An answer with its jitter taken out. Spotify's progress comes back up to
  // a second stale, by a different amount each time, so the notes would
  // twitch at every answer. While the same song plays on, each answer says
  // when the song started; the earliest of the last few (the least stale) is
  // kept. A pause, a new song or a far-off answer (a seek) starts over.
  steady(got) {
    const start = got.at - got.progress;
    const same = got.playing && this.now?.playing && got.id === this.now.id;
    if (!same || !this.starts.length || Math.abs(start - Math.min(...this.starts)) > Follow.SEEK) {
      this.starts = got.playing ? [start] : [];
      return got;
    }
    this.starts = [...this.starts, start].slice(-Follow.KEEP);
    return { ...got, progress: got.at - Math.min(...this.starts) };
  }

  stop() { this.stopped = true; }
}

// A clock you run yourself, for playing without Spotify: start it when your
// song starts.
export class ManualClock {
  constructor(song) {
    this.song = song;
    this.playing = false;
    this.progress = 0;
    this.at = now();
  }

  position(t = now()) {
    return this.playing ? this.progress + (t - this.at) : this.progress;
  }

  toggle() { this.set(this.position(), !this.playing); }
  seekTo(seconds) { this.set(Math.max(0, seconds), this.playing); }
  set(progress, playing) { this.progress = progress; this.playing = playing; this.at = now(); }
  stop() { this.playing = false; }
}
