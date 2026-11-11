# Air Drums

Play the real drum part of the song Spotify is playing, on the Fresh 'n Rebel
Air Drums (1AAD100). A static site: no server, no build step.

Live: https://1vogada.github.io/airdrums/

Try it without Spotify: https://1vogada.github.io/airdrums/?demo=everlong%20foo%20fighters&at=40#/colors

## What it does

- **Follows Spotify.** It asks Spotify what is playing and how far in you are,
  every two seconds, so the notes follow a pause, a seek or a skip.
- **Loads the real drum part.** For each song it looks up a community drum
  chart on [Chorus Encore](https://www.enchor.us) (the Clone Hero chart search
  engine) and maps it onto the kit's six zones and the bass pedal.
- **Shows lyrics** in time, from [LRCLIB](https://lrclib.net).
- **Scores your hits by microphone.** The sticks only talk to the speaker, so
  the site listens for the drum sounds.

Two pages, same notes:

- **Drums**: the kit laid out like the manual's picture. A ring closes in on
  the drum to hit.
- **Colors**: six lanes in the sticks' LED colours. Notes fall and you hit
  them on the line. The bass pedal is the wide bar.

| Zone | LED colour | Chart lane |
|---|---|---|
| Crash | light blue | green cymbal |
| Tom 2 | pink | yellow or blue tom |
| Ride | orange | blue cymbal |
| Hi-Hat | green | yellow cymbal |
| Snare | yellow | red |
| Floor Drum | purple | green tom |
| Bass drum (right foot) | (white here) | kick |

The left foot is the hi-hat pedal: flat makes the sticks' hi-hat closed, raised
makes it open, and putting it down plays the hi-hat cymbal. Charts only write
bass drum hits, so the left foot has no notes of its own yet (see Next).

## Setup

Open **Setup** on the site.

1. **Spotify.** Spotify limits hobby apps to a few users, so the site uses
   your own free app. At [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
   open your app, add the redirect URI the setup page shows
   (`https://1vogada.github.io/airdrums/`), and paste the app's client ID into
   the site. Login is PKCE: no client secret, and the tokens stay in your browser.
2. **Microphone.** Turn it on and set the line so only your hits go over it.
   Music from the same speaker also reaches the mic: keep it quieter than the
   drums, or play the music on headphones.
3. **Teach it your drums** (optional). Hit each drum four times. After that
   it also checks you hit the right drum, not only the timing.

## Getting the notes in time

A chart is timed to its own copy of the song, which can start earlier or later
than Spotify's, and a Bluetooth speaker adds its own delay.

- When both the chart and the lyrics have line timings, the site starts from
  the gap between them (rough, about 0.2 s).
- **Sync by ear** listens to the song through the mic for 12 seconds and lines
  the notes up with the drums it hears.
- **−** and **+** (or `[` and `]`, with Shift for bigger steps) nudge by hand.

The result is remembered per song and chart.

## Limits

- Chart coverage is best for rock and metal; plenty of pop and hip-hop has no
  drum chart. The site says so when it finds none.
- Charts are community-made. The **Chart** menu switches between versions;
  ones marked "simple" don't tell cymbals from toms.
- The mic can tell that you hit and roughly which drum, not which stick.
- Restart needs Spotify Premium.

## Next

- Left foot: show when the hi-hat should be open or closed, and teach the mic
  the open hi-hat and the pedal "chick" as their own sounds. Clone Hero charts
  don't mark open hi-hats, so this needs another source or a guess from the
  pattern.
- Mic: sync by ear and scoring are only tested with a fake microphone so far.
- Songs with no chart: fall back to a generated beat.

## Where the data comes from

The site hosts no charts, audio or lyrics. Each browser fetches what it needs:

- Chart search: `api.enchor.us`. Notes: only the `notes.chart` / `notes.mid`
  entry of the chart's `.sng` package is read from `files.enchor.us`, with
  HTTP range requests. The audio in the package is never downloaded.
- Lyrics: `lrclib.net`.
- Playback state: the Spotify Web API.

## Development

```bash
node dev/serve.mjs
```

Then open http://127.0.0.1:8377/ (Spotify wants `127.0.0.1`, not `localhost`;
add `http://127.0.0.1:8377/` as a second redirect URI to log in locally).

```bash
node tests/charts_check.mjs
```

finds and parses real charts for a handful of songs. `tests/mic_check.html`
reports what the mic code hears (a browser's fake microphone works).

| File | What it holds |
|---|---|
| `js/kit.js` | the zones, their colours and test keys |
| `js/charts.js` | chart search, fetching the notes file, lyric-based alignment |
| `js/chartparse.js` | `.chart` and `.mid` parsers |
| `js/spotify.js` | login, now playing, the follow clock |
| `js/lyrics.js` | LRCLIB |
| `js/mic.js`, `js/onset-worklet.js` | hit detection and drum fingerprints |
| `js/game.js` | judging, score, sync by ear |
| `js/render.js` | the two game pages |
| `js/main.js` | menu, pages, setup |
