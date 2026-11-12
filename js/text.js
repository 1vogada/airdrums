// Comparing song names: pure functions with no imports, so every module can use
// them (the chart lookup, the song list, your library) without importing each other.

// "Beyoncé" -> "beyonce", "AC/DC" -> "acdc": letters and digits only, accents folded.
export const norm = (s) => (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');

// "Song - Remastered 2011", "Song (feat. X)" -> "Song"
export function cleanTitle(title) {
  return (title || '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/\s*[([][^)\]]*(feat|with|remaster|version|edit|mix|live|mono|stereo|deluxe|bonus|from)[^)\]]*[)\]]/gi, '')
    .trim() || title;
}

// What a song is filed under: its first artist and its cleaned title. A song is
// the same song whether Spotify played it or it was looked up on the chart site.
export const songKey = (title, artist) => `${norm((artist || '').split(',')[0])}|${norm(cleanTitle(title))}`;
