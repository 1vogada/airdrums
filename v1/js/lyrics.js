// Time-synced lyrics from LRCLIB (lrclib.net), a free open lyrics database.
// Spotify has no lyrics API; it only says what is playing.

import { cleanTitle } from './charts.js';

const API = 'https://lrclib.net/api';

export function parseLrc(text) {
  const lines = [];
  for (const raw of (text || '').split(/\r?\n/)) {
    const m = /^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/.exec(raw.trim());
    if (m) lines.push({ t: Number(m[1]) * 60 + Number(m[2]), text: m[3].trim() });
  }
  return lines.sort((a, b) => a.t - b.t);
}

// [{ t, text }] for a song, or null when there are no synced lyrics for it.
export async function syncedLyrics(song) {
  const artist = (song.artist || '').split(',')[0].trim();
  const q = new URLSearchParams({ track_name: song.title, artist_name: artist });
  if (song.album) q.set('album_name', song.album);
  if (song.duration) q.set('duration', String(Math.round(song.duration)));
  let res = await fetch(`${API}/get?${q}`);
  if (res.ok) {
    const d = await res.json();
    if (d.syncedLyrics) return parseLrc(d.syncedLyrics);
  }
  res = await fetch(`${API}/search?${new URLSearchParams({ track_name: cleanTitle(song.title), artist_name: artist })}`);
  if (!res.ok) return null;
  const all = (await res.json()).filter((d) => d.syncedLyrics);
  if (!all.length) return null;
  all.sort((a, b) => Math.abs(a.duration - (song.duration || a.duration)) - Math.abs(b.duration - (song.duration || b.duration)));
  if (song.duration && Math.abs(all[0].duration - song.duration) > 5) return null;   // another version of the song
  return parseLrc(all[0].syncedLyrics);
}
