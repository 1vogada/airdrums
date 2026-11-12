# Version 2: decisions that override the spec

[spec.md](spec.md) is the council's build spec. Two outside critics then went through it
([critiques.md](critiques.md)). This file is what was decided about their points. **Where this file and
spec.md disagree, this file wins.** Builders read both.

## Order of work

1. B01 safety net (done by the main session): branch `v2`, tag `v1`, the copy under `v1/`, the do-not-break list
   ([do-not-break.md](do-not-break.md)).
2. In parallel, in their own worktrees, new files only: B02 (rig), and the pure modules of B05 (`net.js`,
   `catalog.js`), B06 (`library.js` additions), B10 (`parts.js`), B11 (`practice.js`, `game.js`), and the sound
   engine of B09 (`clock.js`, `synth.js`, `sound.js`).
3. B03 (session), then B04 (shell and design system).
4. Two tracks in parallel: lookup (B05 screens, B06, B07) and play (B08, B09, B10 strip).
5. B12 (Learn), then **B14 (mic on the site's clock), then B13 (results)**. Stop line B is after B14, not B12.
6. B15 (Spotify) and B16 (Setup, backup, report, README) alongside step 5.
7. B17 and B18 (below), last and droppable.

Work happens on branch `v2`. Nothing is pushed and `main` is not touched until the main session ships.
No item is "shippable" before stop line B: B04 to B07 are one block, and entry points to screens that do not
exist yet (Learn, results, the part strip) are rendered from a feature table (`FEATURES` in `js/app.js`:
`{ learn, results, partStrip, siteSound, micOnSiteClock, spotifyStart, spotifyLiked }`) that an item switches on
when it is green. The rig checks that no link or button on any screen leads to a route without a screen.

## Findings on the first modules

[foundation-findings.md](foundation-findings.md) lists what six reviewers found in `js/clock.js`, `js/sound.js`,
`js/synth.js`, `js/library.js`, the section reading and the way they meet `js/game.js` and the microphone.
Every **confirmed** finding is fixed by the builder who owns that file; every **not verified** one is checked by
that builder and fixed if real. Ownership: `clock.js`, `sound.js`, `synth.js` belong to the sound-engine piece;
`game.js` and `practice.js` to the practice piece; `chartparse.js` (sections) and `parts.js` to the parts piece;
`library.js` and `store.js` to the library piece.

## Changes to items

### B02 rig

- Warm up once and wait for `navigator.serviceWorker.controller` before the first scenario (the page reloads
  itself once when the worker first takes control).
- Seed storage once per open, not on every load: "still there after a reload" checks must see what the page wrote.
- Start Edge with `--use-file-for-fake-audio-capture` pointing at a silent stereo 48 kHz WAV the rig writes: the
  default fake microphone produces hits.
- Count errors from `Runtime.consoleAPICalled` (level error) and `Runtime.exceptionThrown` only, with a
  per-scenario allow-list for failures the scenario stubs on purpose.
- Covers in fixtures are `data:` or `files.enchor.us` URLs.
- `hide()` / `show()` helpers redefine `document.hidden` and `visibilityState` and dispatch `visibilitychange`.
- Every scenario starts with cleared `localStorage` and `sessionStorage` and a set window size.
- Fixtures are written as a table in `tests/fixtures/README.md`: every section's notes per level, vocal phrase
  times with no common period (so `lyricShift` has one clear answer), both LRCLIB routes. Add a second fixture
  song of about 16 s with four short parts for ladder, results and bests scenarios.
- The Spotify stub is a small fake player (started at, progress from the clock, pause, next track), not a static body.
- `--only <item>` runs one item's scenarios plus the pin list; the full suite runs at stop lines. The 30 s
  "chart site is busy" wait is a constant the rig can shorten.

### B03 session

- Stop-on-leave and pause-when-hidden apply to source `site` only. For `self` and the demo the clock keeps
  running while the tab is hidden and across a visit to Setup; only the frame loop stops. After the demo's
  `clock.set(at, true)` nothing may call `set`, `setRate` or `setLoop` on that clock (`tests/ear_e2e.mjs`
  reads `clock.at`).
- `?demo=` with no hash still opens the demo.
- Drop the style-only acceptance checks (the grep for `getElementById`, the MutationObserver write count).
  The pin list proves the move.

### B04 shell

- B04 also builds the design system described in [design.md](design.md): tokens, components, icons, favicon.
  Every later screen uses it. Each builder opens its own screenshots and goes through the visual checklist there.
- Enter in the search field searches when the field's text differs from the query of the rows on screen;
  otherwise it opens the highlighted row. Esc navigates to a stored parent route, never `history.back()`.
- A one-time toast for a returning user: "New: search, Liked and Learn. The five pages are now the view switch (V)."

### B05 lookup

- Rows show: tile or cover, title, artist, length, at most ONE badge, heart, play button. How busy, versions,
  labels and the rest live on the song page. No tooltips that need a hover.
- A song is ranked first when the query's words equal its title plus artist words.
- The slim record keeps `notes`. `loadChart` is split into `fetchNotesFile(md5)` (bytes kept in memory per md5)
  and `parseNotes(bytes, level, delay)`; `loadChart` stays as a wrapper with today's signature.
- The artist name on a row and on the song page links to `#/search/{artist}`.
- A starter-list click opens the song page when title and artist both match exactly one song, else shows results.

### B06 library

- `library.save()` stays synchronous, listeners included. The session defers its own calls
  (`setTimeout(0)`) so nothing is written inside a frame.
- At most 150 not-liked songs are kept. Recent rows have Remove. The song page has "Reset progress for this song".
- A song liked from Spotify that has no chart: run `findCharts` once through the paced queue. With a result,
  store the slim versions. With none, keep the entry flagged `noChart`, show it with the label "No drum part yet",
  and make the row run a search for "title artist" instead of opening a song page. Only songs with at least one
  version are filed in Recent.
- Part progress is keyed `md5|level|partId`. Defaults when a caller gives none: `set: 'all'`, `by: 'pass'`
  (the existing test relies on it).

### B07 song page

- The md5 in the address wins over `entry.pick`; rows link to `entry.pick` when one is set.
- `#/play/{md5}` and `#/learn/{md5}` opened cold use the same lookup chain as the song page.
- Ctrl+Enter skips the Ready overlay.

### B08 play screen

- Below 900 px the chips fold into More and the dock wraps; the header never breaks.
- `#/play/live` with Spotify not linked shows an overlay: "Spotify is not linked" with Setup and "Find a song".

### B09 the site's clock with sound

- `js/parts.js` is created here with `countIn()`; `parts()` arrives with B10 (in practice both are written in
  the parallel step).
- Synth levels: every number is measured on the bus before the compressor, in an `OfflineAudioContext`, in the
  rig. The master gain is derived, not fixed: the five-drum pile (kick, snare, hi-hat, crash, floor tom together)
  peaks at 0.9. Compressor knee 0. Noise voices start at a fixed offset so a hit always has the same peak.
  Sound-timing checks skip the first 0.5 s while the audio-to-performance skew settles.
- `own.outDelay` (ms, default 0, from -100 to 400): for a computer whose speakers are late (Bluetooth). The
  scheduler places sounds that much earlier. Sound chip: "Sound late or early: − +" next to Test sound, with a
  pad flashing on each test beat so it can be set by eye and ear. With the mic off on the site's clock, `[` and
  `]` nudge it. Stored in the backup.
- Any moment under 100% tempo makes the run a "Slowed run": never a best.

### B10 parts

- Parts are shaped from the highest level the version has, so the part list does not change with the level.
  A part's id is its own start in milliseconds (the section start for an uncut part, the piece's start for a
  piece cut from a long section).
- Left and Right in Learn step through all parts, learned ones included.

### B11 judging and practice rules

- `Game.grace` (real seconds, default 0): `update()` and `closePass()` call a note missed only after
  130 ms + grace. The session sets `grace = micDelay + 0.06` whenever mic hits are judged on the site's clock,
  and the Learn loop's tail is `max(0.15, micDelay + 0.1)` s of real time. Node cases: with grace set, a hit
  reported 140 ms and 250 ms after its note is `perfect`; the last note of a part is credited before `closePass`.
- **One headline number everywhere: the share of notes hit.** It is the big number on the strip, the grade, the
  part bars, the Learn verdict and the bests. Timing is a second line ("Timing: 62% perfect, 30% good, 8% ok").
  `Game.accuracy` and `library.grade()` stay as they are for the existing tests; callers hand `grade()` the hit share.
- Sets ("drums to play") are compared by the notes they give in this part: a state whose notes equal the
  all-drums notes IS all drums. From such a state two clean passes raise the tempo.
- `verdict()` has a precision guard: when unmatched onsets in the judged stretch outnumber the matched ones, or
  exceed half the notes, the pass reads "Not scored: too many other sounds" and changes nothing. A "learned" by
  pass needs the guard to pass.
- `fitDelay`: one rule. Take every delay from -0.05 to 0.4 s whose match count is within 10% of the best,
  choose the smallest, and answer only with 8 or more hits and 60% matched. It ignores hits earlier than the
  part's first note minus 130 ms. After 3 passes with no fit the UI says "Set the hit delay by hand with [ and ]".
- Repeated parts inherit the START, never the tick: when a part has no stored state and another part of the same
  version with the same cleaned name stem (the name minus number, letter suffix and "(2)") is learned, it starts
  at that part's clean drums and tempo, skips the automatic Listen pass and says "Same as Chorus 1? Starting at
  100%". One clean pass then ticks it. A pure rule in `practice.js` with a table test.
- `hearsSite(soundTimes, micOnsets, last)`: pure, and it answers three ways, so that failing to recognise the
  speaker can never switch the click back on (see [foundation-findings.md](foundation-findings.md)):
  - `"hears"`: 8 or more site sounds, and at least 75% of them are each followed by a loud onset at ONE steady
    lag (within 15 ms of each other) anywhere from 0 to 500 ms. It also returns that lag.
  - `"does not hear"`: only from a quiet probe: 8 or more site sounds with at most one (or 10%) of them followed
    by any loud onset within 0 to 450 ms (not counting past the next site sound).
  - anything else (the learner was playing during the probe, or fewer than 8 sounds): the last answer stands.
    The first answer is "hears" (the silent turn) unless "I'm on headphones" is ticked.
  The lag found is the computer speaker's unreported delay plus the mic's own: it is offered as `own.outDelay`
  ("Your speaker is about 210 ms late. Use it?"), never applied silently. It says nothing about the kit's own
  stick-to-sound delay; that still comes from the learner's hits (`fitDelay`).

### B12 Learn

- `#/learn/{md5}` with every part learned shows the "All parts learned" overlay with "Play the whole song" and
  the part list to practise again. An unknown part id falls back to the first unlearned part with a toast.
- G pressed again undoes a mark made by hand.
- With an untaught mic, one line on Ready: "Teach your drums in Setup to have the right drum checked too."

### B14 the microphone on the site's clock (before B13)

- The site finds out whether the mic hears it instead of assuming. The unjudged Listen pass and every counted
  bar are a probe (`hearsSite`). Mic does not hear the site: the click, and the guide for the drums left out,
  keep sounding in your turn and the mic is judged. Mic hears the site: your turn is silent with the pulsing
  beat dot, as the spec says. "I'm on headphones" forces the first case. The first site-clock session with the
  mic on asks once where the site's sound comes out (speakers near the mic / headphones or far away).
- Guide has a key: `U`.
- Per Learn pass: under 30% matched with at least half as many unmatched hits as notes means no verdict and no
  step; `fitDelay` runs again on that pass and the line says "Re-checking your kit's delay". A new value
  replaces the stored one only when two passes agree within 20 ms.
- `mic.hitDelay` is ONE setup-wide value subtracted from mic hit times on the site's clock (stored as
  `own.micDelay`). Song sync (`fine.*`) is never touched by it.
- An unscored whole-song run says "Guide was on, so the mic was not scored", never "You watched this one" when
  hits were heard.

### B13 results

- **Cut: the timing sentence with its "Fix it" button.** The continuous line-up by ear would undo it. Results
  show the hit share, the timing line, the bar per part and "Learn {weakest part}".
- On `#/play/live`, Enter opens the run card's Details.

### B15 Spotify

Kept small, because none of it can be tried against a real account before it ships:

- A 401: refresh once ignoring `expires_at` and retry. Unlink only on `invalid_grant`.
- A 429: stop asking only when the JSON body says `QUOTA_EXCEEDED` or a readable `Retry-After` is over 60 s.
  When the header cannot be read, back off 5 s doubling to 60 s.
- **Polling stays at 2 s** while playing, waiting or paused. Stop on leaving the play screen and while the tab
  is hidden; ask at once (at most once a second) when the tab becomes visible. `steady()` is untouched.
- The zero-call hand-off as specified, plus: on `#/play/live`, when a song was expected and a different or
  unmatched track is playing, offer "Use {expected title}'s drum part for this track". It stores
  `pick.{spotify id} = md5`.
- "Login valid until": when no date is stored, "Login date unknown. Logins last 6 months; link again to see the date."

### B16 Setup, backup, labels, README

- Setup gets "Check my setup" (lines that turn green: test sound played, mic heard a hit, hit delay found,
  Spotify answered) and "Copy report": version, browser, prefs, `own.micDelay` and the last fits with their
  counts, `own.outDelay`, mic threshold, the last 20 pass verdicts, sounds dropped, output latency, the last
  Spotify statuses and reasons, the last errors. Never tokens or the client ID.
- `prefs.micOn`: the mic turns on at the first Enter when permission is already granted.
- README gets a ten-minute first-session script for the real kit, and "Not verified" lists mic scoring and
  line-up by ear in a real room.
- `v1/` is made with `git archive` and `.gitattributes` holds `v1/** -text`.
- Dialog focus is asserted as "inside the dialog or on the body", not as a strict trap.

### B17 Play along with Spotify starts the song (new, droppable)

Behind the same "Play along with Spotify" button, in tiers, each falling back to the next:

1. `GET /v1/search?type=track&limit=5` for "title artist" (one call per press), chosen with `fit()` and the
   length. It gives the exact link `open.spotify.com/track/{id}`, binds `pick.{id} = md5` so matching is by
   track id, and stores the id and cover on the entry.
2. `PUT /v1/me/player/play` with that track. On anything but 204 (no device, not Premium, any error) fall back
   to the hand-off screen, now with the exact track link.
3. The hand-off as in B15.

Home restarts the song on Spotify (the existing seek) and the dock shows it. When Spotify is linked and
`prefs.lastStart` is unset, the song page focuses "Play along with Spotify" and labels the other button
"Play with site drums (no music)". No new permission is needed. Marked "not tried on a real account" in Setup.

### B18 Spotify Liked Songs (new, droppable, last)

A button on the Liked tab: "Show my Spotify Liked Songs". Only that button asks for the extra permission
`user-library-read` (`login()` takes a scope list; stored tokens are replaced only on a successful return).
One `GET /v1/me/tracks?limit=50` per press ("50 more"), kept slim in localStorage (id, title, artist, cover).
A row click runs the normal lookup like a starter item, so no chart request is spent before that. A 403 reads
"Link again to allow Liked Songs". If the item is dropped, the Liked tab says so in one line.

## Smaller rules

- Keys: the spec's map, plus `U` guide. Space and the drum keys never change meaning.
- Words: Learn (not Practise), Setup (not Settings), "drums to play", "pass".
- Every feature that could not be tried on a real kit, microphone or Spotify account says so in Setup's
  "Not verified" list.
