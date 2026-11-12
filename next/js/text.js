// Comparing song names: pure functions with no imports, so every module can use
// them (the chart lookup, the song list, your library) without importing each other.

// "Beyoncé" -> "beyonce", "AC/DC" -> "acdc": a to z and digits only, accents folded.
export const norm = (s) => (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');

// "Song - Remastered 2011", "Song (feat. X)" -> "Song"
export function cleanTitle(title) {
  return (title || '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/\s*[([][^)\]]*(feat|with|remaster|version|edit|mix|live|mono|stereo|deluxe|bonus|from)[^)\]]*[)\]]/gi, '')
    .trim() || title;
}

// One half of a song's key. For a name written with a to z, digits, accents and
// punctuation this is exactly norm(). A name in another script ("紅", "Кино")
// keeps its own letters: norm() would leave nothing of it, and every such song
// of one artist would then be filed as the same song.
const filed = (s) => (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\p{M}]+/gu, '');

// What a song is filed under: its first artist and its cleaned title. A song is
// the same song whether Spotify played it or it was looked up on the chart site.
export const songKey = (title, artist) => `${filed((artist || '').split(',')[0])}|${filed(cleanTitle(title))}`;
