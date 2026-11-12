# Do not break

What version 2 must leave working exactly as it does in version 1 (tag `v1`, copy under `v1/`).

## Stored data (localStorage, prefix `airdrums.`)

Version 2 only ADDS keys. It never changes the format of one of these:

`spotify.clientId`, `spotify.tokens`, `spotify.pending`, `mic.threshold`, `mic.centroids`, `difficulty`,
`ear.usual`, `ear.delays`, `pick.{songId}`, `fine.{songId}.{md5}`.

`spotify.tokens` may gain optional fields; a value without them must still work.

## Addresses

- `#/tab` `#/drums` `#/colors` `#/taiko` `#/mania` `#/map` `#/setup` (the five view addresses become aliases).
- `?demo=<song>&at=<seconds>&chart=<md5>&mic=1`, with or without a hash.
- The Spotify login returning to the site root with `?code=` or `?error=`.

## What `tests/ear_e2e.mjs` reads (the test must pass unchanged)

`window.airdrums.clock.at` and `.playing`, `.game.offset`, `.song.charts[0].md5`, `.mic.running` and
`.mic.startedAt`, `.hear()`, and the element with the id `offset`. After the demo's `clock.set(at, true)`
nothing may re-base that clock.

## Files not edited in this version

`js/render.js`, `js/mic.js`, `js/onset-worklet.js`, `js/align.js`, `js/lyrics.js`, `js/kit.js`, `sw.js`,
`tests/ear_e2e.mjs`.

## Behaviour

- The five views draw the same notes (Tab, Drums, Colors, Taiko, Mania).
- Following Spotify: the notes follow a pause, a seek and a skip; lyrics show in time; the chart is lined up from
  the lyrics; with the mic on the notes line up by ear, and "Sync by ear" searches wider.
- Microphone scoring, teaching the drums, the keyboard test keys (Q W E / A S D / Z / Space).
- The kit map. The setup page's three sections.
- Never in the repo: a Spotify client ID, a token, a real chart, lyric or audio file.
