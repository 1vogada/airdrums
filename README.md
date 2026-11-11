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
  engine) and maps it onto the kit: six stick zones and two foot pedals.
- **Shows lyrics** in time, from [LRCLIB](https://lrclib.net).
- **Scores your hits by microphone.** The sticks only talk to the speaker, so
  the site listens for the drum sounds.

![The tab page: Du Hast written out, one line per drum](docs/tab.png)

Three pages, same notes:

- **Tab** (the main one): the drum part written out like a tab. One line per
  drum, bars and beats, scrolling under a play line. A cross is a cymbal, a
  dot is a drum, a small ring over a hi-hat cross means open.
- **Drums**: the kit laid out like the manual's picture. A ring closes in on
  the drum to hit.
- **Colors**: six lanes in the sticks' LED colours. Notes fall and you hit
  them on the line. The bass drum is the wide bar.

Eight things to hit, seven instruments (the hi-hat is a stick zone and a pedal).
The site's [kit map](https://1vogada.github.io/airdrums/#/map) shows where each one is:

![Kit map: two rows of three stick zones and the two foot pedals](docs/kit-map.png)

| Zone | LED colour | Chart lane |
|---|---|---|
| Crash | light blue | green cymbal |
| Tom 2 | pink | yellow or blue tom |
| Ride | orange | blue cymbal |
| Hi-Hat | green | yellow cymbal |
| Snare | yellow | red |
| Floor Drum | purple | green tom |
| Bass drum (right foot) | (white here) | kick |
| Hi-hat pedal (left foot) | (green here) | open / closed hi-hat, where the chart says |

The left foot is the hi-hat pedal: flat makes the sticks' hi-hat closed, raised
makes it open, and putting it down plays the hi-hat cymbal.

### Which drum a note really is

A chart's lanes are a game's simplification. An open hi-hat is often written on
the "ride" lane, and a fast hi-hat run on the snare lane so two hands can play
it. Rock Band's own charts (charter "Harmonix") also carry the notes that drive
the on-screen drummer: what is hit on a real kit, and when the hi-hat is open.
Where a chart has those, the site goes by them and prefers that chart:

- every hit lands on the drum it really is;
- an open hi-hat is drawn hollow (Colors) or dashed (Drums), and the left foot
  pad says up or down.

Other charts fall back to the lanes (table above). `tests/inspect_chart.mjs`
shows what each chart of a song says, section by section.

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

- **Auto.** The chart knows when each line is sung and so do the lyrics: the
  gap between them is how far apart the two copies are (game charts often
  start 2 to 5 seconds late). Good to about 0.2 s, since lyric timings are
  hand-made. Charts without vocals can't be lined up this way and show
  "not synced".
- **Sync by ear** listens to the song through the mic for 12 seconds and lines
  the notes up with the drums it hears.
- **−** and **+** (or `[` and `]`, with Shift for bigger steps) nudge by hand.

Your tuning sits on top of the automatic line-up and is remembered per song and
chart. Click the number to drop it and go back to automatic.

## Limits

- Chart coverage is best for rock and metal; plenty of pop and hip-hop has no
  drum chart. The site says so when it finds none.
- Charts are community-made. The **Chart** menu switches between versions;
  ones marked "simple" don't tell cymbals from toms.
- The mic can tell that you hit and roughly which drum, not which stick.
- Restart needs Spotify Premium.

## Next

- Left foot: teach the mic the open hi-hat and the pedal "chick" as their own
  sounds, and score them. Only Rock Band's own charts say when the hi-hat is
  open.
- Line-up: for a chart without vocals, borrow the line-up of another chart of
  the same song by matching their drum patterns.
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
| `sw.js` | makes browsers check for new files on every load, so an update never runs half old |
