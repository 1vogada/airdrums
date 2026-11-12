# Air Drums

Find a song, see its real drum part, and play or learn it on the Fresh 'n Rebel
Air Drums (1AAD100). A static site: no server, no build step.

Live: https://1vogada.github.io/airdrums/

Try it without anything set up: https://1vogada.github.io/airdrums/#/search/everlong

## What it does

- **Song lookup.** Type a song or an artist. The drum parts come from
  [Chorus Encore](https://www.enchor.us) (the Clone Hero chart search engine);
  the site groups the charts it finds into songs, one row per song.
- **Liked and Recent.** A heart on every song. What you liked and what you
  opened are on the home screen, with your best result. Everything stays in
  your browser.
- **A page per song**: Play, Learn, the song's parts (Intro, Verse 1, Chorus...)
  with the ones you learned ticked, the version and the level.
- **One play screen, five views** of the same notes: Tab, Drums, Colors, Taiko,
  Mania. `V` switches. The song's parts run along the top.
- **Play** runs the song on the site's own clock with the site's own drum
  sounds as a guide and a click. No music: the drum part by itself. Tempo from
  50 to 100%. A run ends in a result: the share of notes you hit, a bar per
  part, and a button to learn the weakest one.
- **Learn** loops one part: a counted bar, then the part, round and round. A
  part you never tried is played to you first. Busy parts start on bass drum
  and snare. Two clean passes bring in the next drums, then raise the tempo;
  one clean pass at full tempo ticks the part as learned and moves on.
- **Play along with Spotify.** Link your Spotify, start a song there, and the
  notes follow it, with lyrics in time from [LRCLIB](https://lrclib.net).
- **Scoring by microphone.** The sticks only talk to their speaker, so the site
  listens for the drum sounds. The keyboard works too: `Q W E` top row,
  `A S D` bottom row, `Z` left foot, `Space` right foot.

![The play screen: Du Hast in the Taiko view](docs/taiko.png)

Eight things to hit, seven instruments (the hi-hat is a stick zone and a pedal).
The [kit map](https://1vogada.github.io/airdrums/#/map) shows where each one is:

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

## Three ways to run a song

| | Who makes the music | Tempo and loop | Sync |
|---|---|---|---|
| **Play / Learn** | the site's own drum sounds, no music | yes | none needed: the chart's own time |
| **Play along with Spotify** | Spotify | no (Spotify can't be slowed) | by the lyrics, then by ear with the mic |
| **I'll start the music myself** | your own record or player | no | by the lyrics, then by ear with the mic |

### Learn, step by step

1. Open a song and press **Learn** (or a part on its page, or on the strip).
2. `Enter` starts. A counted bar comes before every pass.
3. A part you never tried is a **Listen** pass first: the site plays it, nothing
   is judged. `L` asks for it again.
4. Your turn: the part loops by itself. After each pass the line says how it
   went: the share of the notes you hit.
5. With **Auto** on: two clean passes (85%) bring in the next drums
   (Bass + Snare, + Hi-hat, All drums; `K` steps by hand), then raise the tempo
   by 10%. Two passes under 60% lower it.
6. One clean pass at 100% with all drums: the part is learned, and the loop
   moves to the next part that isn't.
7. `G` marks a part as learned by hand, for when the site can't hear you.

While the microphone listens through speakers the site stays quiet in your
turn (only the counted bar clicks): it can't tell its own drums from yours.
**Headphones** in the dock tells it the mic can't hear the site.

### Which drum a note really is

A chart's lanes are a game's simplification. An open hi-hat is often written on
the "ride" lane, and a fast hi-hat run on the snare lane so two hands can play
it. Rock Band's own charts (charter "Harmonix") also carry the notes that drive
the on-screen drummer: what is hit on a real kit, and when the hi-hat is open.
Where a chart has those, the site goes by them and puts that version first.
`tests/inspect_chart.mjs` shows what each chart of a song says.

## Setup

Nothing is needed for Play and Learn. For the rest, open **Setup**:

1. **Spotify.** Spotify limits hobby apps to a few users, so the site uses
   your own free app. At [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
   open your app, add the redirect URI the setup page shows
   (`https://1vogada.github.io/airdrums/`), and paste the app's client ID into
   the site. Login is PKCE: no client secret, and the tokens stay in your browser.
2. **Microphone.** Turn it on and set the line so only your hits go over it.
3. **Teach it your drums** (optional). Hit each drum four times. After that
   it also checks you hit the right drum, not only the timing.
4. **Sound.** Test the site's own drum sounds.

## Getting the notes in time with music

Only for Spotify and your own music; Play and Learn need none of this.

- **Auto.** The chart knows when each line is sung and so do the lyrics: the
  gap between them is how far apart the two copies are. Good to about 0.2 s.
- **By ear, all the time.** With the mic on, the site keeps comparing the last
  12 seconds of sound with the chart and tightens the line-up to a few
  milliseconds. By itself it only makes small corrections.
- **Sync by ear** (in the Sync chip) searches wider, for when the notes are far off.
- `[` and `]` (with Shift for bigger steps) nudge by hand.

## Not tried on a real kit

Everything was tested with stand-ins: the keyboard as the drums, a recording as
the microphone. Not yet tried with a real kit in a room: scoring by microphone,
the line-up by ear, the Spotify link on the live site, and how Learn scores
microphone hits (the kit's own speaker adds a delay nobody has measured yet).
Version 1 of the site is kept at [v1/](https://1vogada.github.io/airdrums/v1/).

## Limits

- Chart coverage is best for rock and metal; plenty of pop and hip-hop has no
  drum chart. The site says so when it finds none.
- The chart site can't sort by fame and answers with an error now and then.
- The mic can tell that you hit and roughly which drum, not which stick.
- Restart on Spotify needs Spotify Premium.

## Where the data comes from

The site hosts no charts, audio or lyrics. Each browser fetches what it needs:

- Chart search: `api.enchor.us`, one request at a time. Notes: only the
  `notes.chart` / `notes.mid` entry of the chart's package is read from
  `files.enchor.us`, with range requests. The audio in the package is never
  downloaded.
- Lyrics: `lrclib.net`. Playback state: the Spotify Web API.
- The drum sounds in Play and Learn are made in the browser from oscillators
  and noise. No samples.

## Development

```bash
node dev/serve.mjs
```

Then open http://127.0.0.1:8377/ (Spotify wants `127.0.0.1`, not `localhost`;
add `http://127.0.0.1:8377/` as a second redirect URI to log in locally).

| Test | What it shows |
|---|---|
| `tests/clock_check.mjs` | the site's own clock: tempo, loop, count of passes |
| `tests/library_check.mjs` | liked, recent, bests, parts learned |
| `tests/catalog_check.mjs`, `tests/net_check.mjs` | charts grouped into songs; paced requests to the chart site |
| `tests/charts_check.mjs`, `tests/sections_check.mjs` | real charts found and parsed (live network) |
| `tests/ear_e2e.mjs` | the line-up by ear in a real browser, a recording played in as the microphone |
| `tests/agree_check.mjs`, `align_check.mjs`, `ear_check.mjs`, `ear_passage.mjs` | charts against the real recordings |
| `tests/inspect_chart.mjs`, `inspect_sync.mjs`, `inspect_open.mjs` | what the charts of one song say |

| File | What it holds |
|---|---|
| `js/main.js` | routes, the play screen, Learn, results, setup |
| `js/pages.js`, `js/ui.js` | Home (search, Liked, Recent), the song page; rows, tiles, toasts |
| `js/charts.js`, `js/catalog.js`, `js/net.js`, `js/text.js` | chart search, charts grouped into songs, the notes file |
| `js/chartparse.js`, `js/parts.js` | `.chart` and `.mid` parsers; the song's parts and the counted bar |
| `js/clock.js`, `js/synth.js`, `js/sound.js` | the site's own clock, drum sounds and their scheduling |
| `js/game.js` | judging and score |
| `js/library.js`, `js/store.js` | your songs, in the browser |
| `js/render.js`, `js/kit.js` | the five views; the zones and their colours |
| `js/spotify.js`, `js/lyrics.js` | login, now playing, the follow clock; LRCLIB |
| `js/mic.js`, `js/onset-worklet.js`, `js/align.js` | hit detection, drum fingerprints, the line-up by ear |
| `sw.js` | makes browsers check for new files on every load |

`docs/v2/` holds the plan a council of agents wrote for this version and what
two critics said about it. The version that shipped is smaller than that plan;
this README describes what is there.
