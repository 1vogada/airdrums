# Findings on the first version-2 modules

Six reviewers attacked the modules written before the council met (`js/clock.js`, `js/sound.js`, `js/synth.js`,
`js/library.js`, the section reading in `js/chartparse.js`) and how they will work with `js/game.js` and the
microphone. Two skeptics then tried to refute each finding.

- **Confirmed**: both skeptics agreed it is real. These must be fixed by the builder who owns the file.
- **Not verified**: the skeptics were cut off before they could check. The builder who owns the file checks
  each one itself and fixes the real ones. Titles only here; treat each as a test to write.
- **Refuted**: a skeptic showed it is not a problem in practice. Listed so nobody raises it again.

## The clock (js/clock.js)

### Confirmed: Consecutive spans do not meet on the same number, so a note on a span boundary is asked twice or not at all

`js/clock.js`, severity: wrong

**What goes wrong.** A span ends at p + dt*rate (added up inside span, lines 88-90), the next one begins at position(t1) (computed afresh, line 83). The two differ by rounding. Over 10 000 random frames: rate 0.7, loop 10-14: 3763 gaps and 3785 overlaps, worst 3.9e-14 s; rate 0.9, loop 30-30.25: 4153 gaps, 4196 overlaps, worst 4.7e-13 s; rates 0.5 and 1 with round numbers: exact. A note inside an overlap is in both spans, a note inside a gap in neither.
With arbitrary numbers that never hits a note. With a timer in whole milliseconds and a round-tempo chart it does, because the notes' real times and the span ends (t + 0.14) are then both whole milliseconds.

**Fix.** The same rewrite as in the first finding: the last stretch ends at this.fold(this.raw(t1)), which is the very expression the next span starts from, and a stretch that reaches the loop end ends at loop.to itself. On the patched copy a3_span.mjs gives 'exact 9999, gap 0, overlap 0' in all 18 cases.

**A skeptic's better fix.** The proposed fix is right. I wrote it independently (patched\js\clock.js in my scratch folder) and it holds:
- a_span.mjs: exact 9999 of 9999 in all 12 cases
- b_player.mjs: 0 asked twice and 0 never asked in every row, also with game.offset at 0.03, -0.045, 0.12 and 0.02
- real Edge: 0 and 0 on the same frames where the repo code gave 5 and 2
- a copy of tests/clock_check.mjs still passes

Two points to keep when applying it:

1. **Count laps from fold()'s own remainder, not from lap()'s division.** Use `d = raw - loop.from; laps = Math.round((d - d % len) / len)`. With `Math.floor(d / len)`, as the repo's lap() does, the count can be one off from fold() on the boundary frame. I tested that variant (naive\js\clock.js): the first note of the loop is still dropped (2, 1 and 17 times in 5x300 laps at 100 bpm rate 1, 100 bpm rate 0.8 and 125 bpm rate 0.5), and when the count is one too high a whole extra lap is scheduled in one frame (97071 asks for 96000 notes at 125 bpm rate 0.5).

2. **Do not treat it as Firefox/Safari only.** Real Edge showed it too, so the fix should not be gated on the browser or lowered in priority on that ground.

The shape that passed everything:
- `r0 = raw(t0)`, `r1 = raw(t1)`, `p0 = fold(r0)`, `p1 = fold(r1)`, `laps = laps(r1) - laps(r0)`
- no loop or laps <= 0: return `[{ from: p0, to: p1, at: t0 }]` if p1 > p0, else `[]`
- otherwise, for each lap: push `{ from: p, to: loop.to, at: t }` if loop.to > p, then `t += (loop.to - p) / rate` and `p = loop.from`
- finally push `{ from: p, to: p1, at: t }` if p1 > p

**A skeptic's better fix.** Take only the span() rewrite and the laps() helper from the reviewer's patched clock.js. Their copy also changes set() (folds progress), setRate() and setLoop(), which belong to other findings and are not needed here; span-only is what I tested ((scratch) skeptic-spanmeet-v7\spanonly\js\clock.js).

Add one case to tests/clock_check.mjs so it stays fixed: for consecutive span(a, b) and span(b, c) on whole-millisecond times at rates 0.5 to 1, the last stretch's `to` must equal the next first stretch's `from`, or be loop.to followed by loop.from.

### Confirmed: The note and the click on the loop start are never scheduled on the first pass

`js/sound.js`, severity: wrong

**What goes wrong.** setLoop() from outside the stretch (and seekTo(x), and play()) anchor the clock at now(); the Player's first span starts at the next frame's t (`from = Math.max(t, this.until)` with until 0), which is later. What is due between clock.at and that frame is never asked of the synth. With setLoop(10,14); play(): the note at 10.0 and the bar click at 10.0 are asked 0 times when the first frame comes 0.1 ms, 4 ms or 16 ms later (1 time only if the frame reads the very same timer value); the first sound is the one at 10.5. Same for seekTo(10) while playing. Every later lap plays them.

**Fix.** Either of two, both run:
(a) js/sound.js line 46: `const from = this.until ? Math.max(t, this.until) : Math.max(clock.at, t - 0.05);` (a10_firstnote_patched2.mjs: asked 1 time in every case; a sound due a few ms ago is played at once, because Synth.when() takes Math.max(ctx.currentTime, ...)).
(b) main.js starts a loop with a run-up: clock.setLoop(from, to); clock.seekTo(from - lead). The clock handles a place before loop.from (a10 last line: asked 1 time; a9_runup.mjs shows the stretches). Note the guide then also plays the notes of the run-up.

**A skeptic's better fix.** Both proposed fixes work for the reported case in my runs (fix a: 1/1 in all 32 rows; run-up b on the repo code: 1/1 in all 8 rows), but each has a hole I measured, so do a narrower (a) AND (b):

1. Fix (a) as written also looks back 50 ms when the Player was reset without the clock moving. Shown: playing, the note at 10.0 sounded 20 ms (and 40 ms) ago, then game.offset += 0.001 (the nudge; clock.at unchanged): repo code asks the note 0 more times, fix (a) asks it 1 more time, i.e. the drum is struck a second time. Look back only when the clock itself was re-anchored. In js/sound.js run(), instead of line 46:
    const fresh = clock.at !== this.anchor; this.anchor = clock.at;
    const from = this.until ? Math.max(t, this.until) : fresh ? Math.max(clock.at, t - 0.05) : t;
With this variant (temp copy sound_fixA2.mjs): 1/1 in all 32 first-pass rows, and 0 extra asks in the nudge case.

2. Run-up (b) alone does not cover a loop that starts at 0, because OwnClock.seekTo clamps to 0: setLoop(0,4); seekTo(-1); play(); first frame 4 ms later, repo sound.js: note at 0 / bar click at 0 asked 0/0 (1/1 with the sound.js change above). It also leaves seekTo(x) while playing and play() after a pause on a note at 0/0.

Things for the next step to decide, following from the same numbers: with any look-back fix, play() after a pause exactly on a note now sounds that note at once (row 'paused at note;play': 0/0 becomes 1/1), which matters if a wait-for-me mode holds the clock on a note. And a looked-back sound cannot be on time: synth.js line 149 returns Math.max(ctx.currentTime, t + skew), so it comes out late by the frame gap plus the output latency; only the run-up (b) makes the first downbeat of a loop land on time, so main.js should start loops with a run-up and sound.js should carry the anchor-aware look-back as the safety net.

**A skeptic's better fix.** Use (b) as a rule, not (a), and leave js/sound.js line 46 as it is so nothing is bunched at 'now'.

- In the one function that starts a pass (main.js or the session: Enter, Home, change of tempo, drums or part, resume, jump to a part), never put the clock on the first sound. Put it LEAD real seconds before: clock.setLoop(from, to); clock.seekTo(first - LEAD * clock.rate); clock.play(), where `first` is the first sound of the pass (the counted bar's first click, which is loop.from in the spec).
- LEAD must be at least the look-ahead plus the output latency. 0.25 s was the value I ran: the first click was asked 123 to 140 ms ahead in 300 of 300 starts, and later passes were unchanged.
- For this to hold at the start of a song, OwnClock must be allowed below 0:00, which spec.md line 273 already asks for. Drop the Math.max(0, ...) in seekTo() and in setLoop() in js/clock.js. Today seekTo(-0.25) gives 0 and setLoop(-2, 8) gives loop.from 0, so the lead and a counted bar before 0:00 are cut off.
- The Game must hold no judged notes in the lead. In the spec it holds only the part's notes, so there are none.

### Confirmed: Game cannot follow a loop: the loop's first note is unhittable after the first lap, short loops die, totals restart

`js/game.js`, severity: wrong

**What goes wrong.** Driven exactly as planned (every frame game.update(clock.position(t), t); hits through game.hit(clock.position(t), t, pad, true)), kicks every 0.5 s:
- Loop 10-14, every note hit dead on: lap 0 is 8 perfect; on every later lap the hit on the first note returns null and the note at 10.0 ends as 'skip'. The hit arrives before the frame that notices the jump (cursor still at the loop end), and update()'s reset(pos) then marks everything before pos, which is already past 10.0, as 'skip' (line 36). Also null when that hit is 20, 50 or 100 ms late.
- Loop 10-11 (1 s, under update()'s 1.5 s jump test): after lap 0 every hit returns null for good; score stays 200.
- reset() zeroes score and counts at every wrap of a longer loop (800 after lap 0, 700 after each later lap).
- Sixteenth notes (0.125 s apart), loop 10-14, nothing hit: 31 misses counted on lap 0 and 30 on lap 1 out of 32; the note 0.125 s before the loop end (inside the 0.13 s window) is never counted.
- First note hit 30 ms early: it is judged against the note at 14.0, the next part outside the loop ('perfect' only because that note happens to be the same pad), and the note at 10.0 stays 'skip'.

**Fix.** Sketch, not run. main.js has to see the loop come round before BOTH game.update and game.hit (in tick() and in struck()), e.g. `if (clock.loop && pos < lastLoopPos - 0.05) game.again(clock.loop.from, clock.loop.to, t); lastLoopPos = pos;`, with a new Game method that keeps the totals:

  again(from, to, at) {
    this.update(to + WINDOW - 1e-6, at);                 // what was not hit before `to` is a miss
    for (const n of this.notes) { const t = n.t + this.offset; if (t >= from - 1e-6 && t < to - 1e-6) n.state = null; }
    const i = this.notes.findIndex((n) => n.t + this.offset >= from - 1e-6);
    this.cursor = i < 0 ? this.notes.length : i;
    this.lastPos = from;                                  // so update() does not take the wrap for a seek
  }

Still open after that: a hit in the last 0.13 s before loop.to that was meant for the loop's first note (try it again at pos - (to - from)).

**A skeptic's better fix.** Build what docs/v2/spec.md B11/B12 already says instead of the reviewer's again(). I tried both on subclasses in my temp folder.

The spec's plan (autoReset off while a loop is set; in the frame only: when clock.lap(t) changes, closePass(from, to), then game.reset(loop.from), then update; Game built from the part's notes only; loop = [part start - counted bar, part end + 0.15 * rate]) removes all five symptoms: 8/8 on every pass at tempo 1 and 0.5, 2/2 on every pass of a 1 s part, 32 of 32 misses counted per pass, the 30 ms early first note is perfect on its own note, mic-style hits 8/8.

Two things it still needs, both shown:
1. The first part of a song. OwnClock.setLoop clamps from to 0 (clock.js line 66; seekTo does the same at line 55), though the spec says the clock may start below 0:00. Part 0-4 with a note at 0.0 and a 2 s counted bar asked for: the loop becomes 0 to 4.15, and on passes 1 and 2 the hit on the first note returns null (7/8). The clamp has to go, or the counted bar has to be kept some other way.
2. Mic hits carry a time in the past (mic.js line 67). One sound at position 14.11 in pass 0, heard of 60 ms later, after the frame that saw the wrap, is judged 'ok' against the note at 13.99 of pass 1: pass 1 closes with 1 of 9 hit although nothing was played in it. Dropping in struck() any hit whose clock.lap(h.t) is not the lap the session is on gives 0 of 9.

Why not the reviewer's sketch: it works for keys (800, 1600, 2400; 32 misses a lap), but its wrap test in struck() misfires on such a late-heard mic hit. The hit sets lastLoopPos back to 13.98, the next frame calls again() a second time, and its update(to + WINDOW) jumps more than 1.5 s from lastPos, so reset() wipes the totals: misses after three laps read 8, 8, 16 instead of 8, 16, 24.

**A skeptic's better fix.** Tested in scratch only: (scratch) skeptic-gameloop-7c2\game_better.js, built from the repo's js/game.js by make_better.mjs in the same folder.

**1. main.js: see the turn from the clock's lap counter, not from positions.** A hit with an old stamp can then never look like a turn. Call it before `game.update` in `tick()` and before `game.hit` in `struck()`:

```js
let lapAt = null, lapSeen = 0;
function turn(t) {                       // how many turns t is behind the last one seen
  const l = clock instanceof OwnClock ? clock.loop : null;
  game.loop = l;
  if (!l) return 0;
  const lap = clock.lap(t);
  if (clock.at !== lapAt) { lapAt = clock.at; lapSeen = lap; }   // seek, pause, tempo, another loop: the count starts over
  if (lap > lapSeen) { lapSeen = lap; game.again(t); }
  return lapSeen - lap;
}
// tick():   turn(t); game.update(pos, t);
// struck(): let pos = clock.position(t);
//           if (turn(t) > 0) pos -= clock.loop.to - clock.loop.from;   // stamped before a turn already seen
//           game.hit(pos, t, pad, sure);
```

**2. game.js: four changes** (full code in game_better.js):
- **`this.loop`** (`{ from, to }` or null), plus `this.early = []` and `this.tail = []`, both cleared in `reset()`.
- **`hit()` stops at the loop's end:** break when `n.t + offset >= loop.to - 1e-6`, so the next part is never hit. A hit that finds no note while `pos > loop.to - WINDOW` is pushed onto `early` as `{ pos, at, pad, sure }`.
- **`again(at)`:**
  - Notes still unhit from the cursor to the loop's end are copied into `tail` as `{ t: n.t - len, pad, group, state: null }`, so they stay hittable just before the loop's start for as long as they would have been.
  - The loop's notes go back to `state = null`, the cursor goes to the loop's first note, and `lastPos = loop.from`.
  - The `early` hits are replayed at `pos - len`.
  - Totals are kept.
- **`tail` in `hit()` and `update()`:** `hit()` looks through `tail` before the notes (oldest waiting note first, the existing rule). `update()` turns tail notes older than `pos - WINDOW` into misses.

**What I ran on it:**
- **equiv.mjs:** 2268 runs (14 loops including a 1.2 s one, keys and mic at 43-65 ms age, tempo [...]

### Confirmed: lap() and the Player's schedule restart on calls that change nothing

`js/clock.js`, severity: rough

**What goes wrong.** Every re-anchor goes through set(position(), ...), which folds the place and moves .at. Loop 10-14 after 9 s (lap 2): pause() gives lap 0; play() while already playing gives lap 0 and a new .at; toggle() twice gives 0; setRate() to the rate it already has gives 0; setLoop() with the same loop gives 0. The comment on lap() only names setting the loop, moving the song and changing the tempo.
Because the Player's state key holds clock.at (sound.js line 40), each of these while playing also makes it flush and schedule again: play(), setRate(1), setLoop(10,14) while playing each gave 1 flush, and the note due 100 ms later was asked a second time.

**Fix.** Return early when nothing changes: `play() { if (!this.playing) this.set(this.position(), true); }`, `pause() { if (this.playing) this.set(this.position(), false); }`, in setRate: clamp first, then `if (rate === this.rate) return;`, in setLoop: return when the loop asked for is the one already set and the place is inside it. If laps must survive a pause, keep a count beside it (add this.lap() to a field in toggle/play/pause, zero it in seekTo/setLoop/clearLoop/setRate); otherwise say in the comment that pause and play restart it.

**A skeptic's better fix.** Keep the early returns, and stop folding the place on pause and resume instead of adding a second lap counter: `progress` is already documented as "as if nothing looped", fold() and lap() take any raw value, and nothing outside the clock reads clock.progress (checked with grep over js/). In js/clock.js:

  toggle() { this.set(this.raw(), !this.playing); }
  play() { if (!this.playing) this.set(this.raw(), true); }
  pause() { if (this.playing) this.set(this.raw(), false); }

  setRate(rate) {
    const next = Math.max(0.25, Math.min(1.5, rate));
    if (next === this.rate) return;
    this.set(this.position(), this.playing);
    this.rate = next;
  }

  setLoop(from, to) {
    const p = this.position();
    const next = to - from > 0.2 ? { from: Math.max(0, from), to } : null;
    const inside = next && p >= next.from && p < next.to;
    if (!next && !this.loop) return;
    if (inside && this.loop && this.loop.from === next.from && this.loop.to === next.to) return;
    this.loop = next;
    this.set(next && !inside ? next.from : p, this.playing);
  }

  clearLoop() {
    if (!this.loop) return;
    const p = this.position();
    this.loop = null;
    this.set(p, this.playing);
  }

The comment on lap() then is true as written (it restarts when the loop is set, the song is moved or the tempo changes, and not on pause or resume). sound.js needs no change.

Tried on a temp copy ((scratch) verify-lap-noop\fix\js\clock.js; the repo was not touched):
- the repo's tests/clock_check.mjs run against the copy: all 13 checks ok
- v1_clock.mjs: pause(), play() while playing, toggle() twice, setRate(1), setLoop(10,14): lap stays 2 in all; .at stays 100 for the three no-ops; the lap watcher sees only the real wrap, 2 -> 3
- v2_player.mjs: play() while playing, setRate(1), setLoop(10,14), clearLoop() with no loop, setLoop(5,5.1) with no loop: 0 flushes, 13 hits, none asked twice, mine() stays true. toggle() twice between frames still gives 1 flush, which is right: the song really stopped and started
- v3_resume.mjs (loop 10-14 at rate 0.5, pause in lap 2 for 30 s, resume): position 13.5 and span() [13.5-14 at 153, 10-11 at 154] are the same as the repo's; lap is 2 then 3 [...]

**A skeptic's better fix.** Carry the lap count across everything that keeps the place, instead of only documenting the restart. Tested as (scratch) skeptic-noop-r4\fixD\js\clock.js: tests/clock_check.mjs 13/13 ok; lap through "9 s | pause | play +4 s | setRate(0.5) | +8 s | seekTo(12) | +8 s | setLoop(20,24) | clearLoop" reads 2 2 3 3 4 0 1 0 0; 0 flushes on play(), setRate(same), setLoop(same); detectors A, B and the read-back form of C are right in all six scenes.

In js/clock.js:
- constructor: `this.laps = 0;`
- lap(): `return this.laps + (!l || raw < l.to ? 0 : Math.floor((raw - l.from) / (l.to - l.from)));`
- set(): add `this.laps = 0;` (a seek, a new loop, clearLoop and a direct set() restart the count)
- new: `keep(playing) { const laps = this.lap(); this.set(this.position(), playing); this.laps = laps; }`
- `toggle() { this.keep(!this.playing); }`
- `play() { if (!this.playing) this.keep(true); }`
- `pause() { if (this.playing) this.keep(false); }`
- setRate: `rate = Math.max(0.25, Math.min(1.5, rate)); if (rate === this.rate) return; this.keep(this.playing); this.rate = rate;`
- setLoop: build the new loop first and `return` when it equals the one set and the place is inside it (p >= from && p < to); otherwise as now.
- `seekTo(seconds) { this.set(this.fold(Math.max(0, seconds)), this.playing); }` - needed once the count is carried: today a paused seekTo(22) in loop 18-22 reads lap 1, and without the fold that lap is carried into play (seen in the fixC copy: "play, +1 s: pos 19, lap 1"). The position read back is the same as before (18).
- comment on lap(): "since the loop was set or the song was moved; starting, stopping and changing the tempo keep the count, and setting the loop it already has changes nothing".

Whatever is done to the clock, write the session's detector as: every frame `const lap = clock.lap(t); if (lap > prev) wrap(); prev = lap;`. It was the only form right in every scene on every clock, the unfixed one included. Never assume the count is 0 after the session's own setRate/setLoop; read clock.lap() back.

If the smaller change is preferred: keep the reporter's early returns and correct the comment to name pause, play and toggle as restarts and to say that a [...]

### Not verified

- span() leaves the loop's first instant out when a span ends within 1 ns after the loop comes round

### Refuted

- seekTo() or set() past the loop end makes lap() jump. Why not: The mechanics are true, but nothing in the planned use reaches them, and the proposed fix makes the one borderline case worse.

**Reproduced.** Loop 10-14, playing, position 13, lap 0, on the real js/clock.js:
- seekTo(position()+5) gives position 10, lap 2.
- seekTo(100) gives position 12, lap 22.
- set(57, true) gives position 13, lap 11.

**Why those inputs do not occur:**
- **No reader.** [...]
- setLoop() judges the length before clamping `from`; setRate() takes a rate that is not a number. Why not: The mechanics reproduce, but neither input can come from the learning mode as planned, and the proposed setLoop fix goes against the v2 spec.

**Mechanics (confirmed).** On the current js/clock.js: setLoop(-1, 0) stores {from:0,to:0} and position() is NaN, still NaN after clearLoop() and setLoop(10,14). setLoop(-5, -1) gives 64 stretches running backwards. setRate(NaN) and setRate(undefined) give [...]
- Long spans: span() stops after 64 stretches without saying so, and a long last stretch can end one rounding step past loop.to. Why not: The mechanics are as described, but neither half can happen in the way the code is used, so it is not a defect to fix.

What I ran (real js/clock.js and js/sound.js, nothing edited): (scratch) skeptic-span64-m3\check.mjs and (scratch) skeptic-span64-m3\guard.mjs

1. Reproduced the report's numbers with direct long calls: loop 10-10.25 rate 1, span(100,120) -> 64 stretches, 16 s; loop 10-10.21 [...]
- main.js tells its own clock by `instanceof ManualClock`; an OwnClock falls into the Spotify branch. Why not: The mechanics are true, but the inputs cannot occur, so this is a wiring note and not a defect in the new code.

1. An OwnClock can never be in `clock` while main.js still has its `instanceof ManualClock` tests.
- Today main.js does not import OwnClock; `clock` is only ever a Follow (line 79) or a ManualClock (line 412).
- The wiring plan already covers this. docs/v2/spec.md line 41: "ManualClock [...]

## The sound scheduler (js/sound.js, js/synth.js)

### Not verified

- The sounds on the very place the song starts from never play (a section's first beat and its accent click)
- A freshly started audio context is read tens of ms wrong, and when() keeps that error for seconds
- when() follows a real move of the audio clock at 5% per sound, not in time
- AHEAD is a fixed 140 ms: when the sound takes longer than that to come out, every drum is late and wobbles with the frames
- With game.offset not 0, the notes exactly on loop.from can be skipped on every lap
- reset() forgets `heard`, so mine() no longer knows a guide sound that is still coming out of the speakers
- run() with a t read before the clock was set schedules what lies before the place the song was put
- The compressor holds every sound back 6 ms and when() does not allow for it

## How the drums sound (js/synth.js)

### Confirmed: Floor tom is the same sound as the kick

`js/synth.js`, severity: wrong

**What goes wrong.** voice() 'kick' (lines 47-48: sine 150->46 Hz over 0.11 s, peak 1.0, decay 0.32 + triangle click) and 'floor' (line 73: sine 135->82 Hz over 0.16 s, peak 0.9, decay 0.38) come out as the same thump. Because the envelope falls 80 dB over `decay`, almost all the energy is in the first 20-30 ms, when both are still near 125 Hz. Kick: strongest partial 120 Hz, centroid 131 Hz, 96.5 % of energy below 200 Hz, pitch 127 Hz (5-25 ms) -> 94 -> 57 -> 46. Floor: strongest partial 122 Hz, centroid 130 Hz, 97.9 % below 200 Hz, pitch 128 -> 119 -> 103 -> 85. A-weighted loudness -26.3 vs -26.8 dB. The floor tom even rings longer than the kick (-40 dB after 195 ms vs 149 ms). The only difference is the kick's click: 3.5 % of its energy between 200 Hz and 2 kHz against 2.1 %. The tom is fine (strongest 211 Hz, 218 -> 150 Hz). Side effect of a kick that is one 120 Hz sine: with everything below 200 Hz removed (laptop speakers) it drops from -11.4 to -23.0 dB.

**Fix.** In voice(): case 'kick': tone('sine', 260, 50, 0.045, 0.85, 0.45); tone('triangle', 1200, 200, 0.012, 0.2, 0.02);   case 'floor': tone('sine', 160, 105, 0.15, 0.8, 0.42);   ('tom' stays tone('sine', 230, 150, 0.12, 0.8, 0.26)).

**A skeptic's better fix.** Use the reviewer's recipe but keep the kick's decay at 0.32 instead of 0.45:

`case 'kick': tone('sine', 260, 50, 0.045, 0.85, 0.32); tone('triangle', 1200, 200, 0.012, 0.2, 0.02);`
`case 'floor': tone('sine', 160, 105, 0.15, 0.8, 0.42);`
(`'tom'` unchanged.)

Measured in the same headless Edge render:
- **Separation is the same:** kick/floor distance 11.2 dB C-weighted and 8.4 A-weighted (11.4 / 8.5 with decay 0.45), waveform correlation 0.480 (0.473), kick/tom 10.9 dB.
- **Laptop band is the same:** −18.9 dB (−18.6 with 0.45; −23.0 today).
- **No extra masking of the learner's next hit:** thresholds after a guide kick on a full-range speaker are 3 / 0 / −6 / −11 / −25 dB at 75 / 100 / 150 / 200 / 300 ms. Today's kick gives 3 / 1 / −4 / −10 / −23; the 0.45 version gives 5 / 3 / −1 / −5 / −18.
- **Tail:** −40 dB after 162 ms (232 ms with 0.45; 149 ms today). Raw peak 0.762.

The cost is level: the loudest 125 ms is −12.9 dB against −11.4 today, so 1.5 dB quieter unweighted, though 0.9 dB louder A-weighted (−25.4 against −26.3). A decay of 0.38 sits in between: −12.1 dB, −40 dB after 192 ms, thresholds 4 / 1 / −3 / −7 / −21.

Neither version fully separates the two on laptop speakers (distance 5.5 dB there). I did not test a recipe that does.

### Confirmed: Hi-hat, crash and snare noise get quieter and duller depending on where between two samples the hit starts

`js/synth.js`, severity: wrong

**What goes wrong.** voice() starts the noise source at `at` exactly (s.start(at, ...), line 41). When `at` is not on a whole sample, Edge/Chromium interpolates the noise buffer to honour the sub-sample start, which low-passes it. Same closed hi-hat started 0, 1/4, 1/2, 3/4 of a sample late (at = (4800 + f) / 48000): energy 6.6, 4.0, 2.7, 4.0 dB, peak -8.7, -10.0, -11.7, -11.8 dB, and it gets duller (energy of the first difference over energy 2.37 -> 1.62). Open hi-hat 16.2 -> 12.5 dB, crash 23.3 -> 20.3 dB, snare 19.4 -> 17.8 dB, ride 8.3 -> 7.9 dB; kick and click do not move (oscillators). In real use `at` is Synth.when(t), any float, so every hi-hat lands on a random fraction: up to 3.9 dB of random level and brightness change from hit to hit. Hats started on whole samples are even: 64 sixteenths, energy sd 0.28 dB.

**Fix.** First line of voice(), before `const env`: at = Math.round(at * ctx.sampleRate) / ctx.sampleRate;   (at most 10 microseconds of timing error at 48 kHz).

### Confirmed: Coinciding hits clip: the compressor does not hold them under full scale

`js/synth.js`, severity: wrong

**What goes wrong.** Through Synth's own chain (guide gain 0.8, click gain 0.5, default DynamicsCompressor straight into the destination) kick + snare + hihat + crash at the same instant peak at 1.053 (+0.4 dB, 3 samples over 1.0; 1.889 before the compressor). A bar of sixteenth hi-hats at 160 bpm with those four on beat 1, kick/snare on the other beats and the click: 1.088 (4 samples over). The four on every beat plus click: 1.163 (+1.3 dB, 14 samples over). With both level sliders at 1.0: 1.109 and 1.215 (22 samples over). Sixteenth hi-hats alone do not clip (0.548). Causes measured: the default compressor makes a quiet sound 3.7 dB louder (-40 dBFS 1 kHz sine in, +3.7 dB out) and lets the first milliseconds of a hit through; and single hits already exceed full scale before the gain: kick 1.147 (sine 1.0 + click 0.35), snare 1.172 (triangle 0.55 + noise 0.6). The overs are 3 to 22 samples long, so this is a faint crackle on the loudest coincidences, not constant distortion.

**Fix.** Two parts. (1) voice(): keep single hits under 1.0: kick as in the kick finding (raw peak 0.777) and case 'snare': tone('triangle', 240, 170, 0.06, 0.45, 0.16); hiss('highpass', 1800, 0.7, 0.48, 0.24);  (raw peak 0.989, loudness unchanged: -18.6 dB vs -18.4, A-weighted -22.7 vs -22.3, -40 dB after 121 ms). (2) Synth.start(), lines 112-113: this.master = this.ctx.createDynamicsCompressor(); this.trim = this.ctx.createGain(); this.trim.gain.value = 0.8; this.master.connect(this.trim); this.trim.connect(this.ctx.destination);  Worst measured peak is then 0.91 with both levels at 1.0.

**A skeptic's better fix.** Size the gain after the compressor from arbitrary start times, not from the whole-sample case. With the recipes unchanged, in `Synth.start()`:

`this.master = this.ctx.createDynamicsCompressor(); this.trim = this.ctx.createGain(); this.trim.gain.value = 0.7; this.master.connect(this.trim); this.trim.connect(this.ctx.destination);`

- **Why 0.7:** a gain after the compressor scales the output linearly. The worst measured peak was 1.400 at levels 1.0/1.0 and 1.265 at default levels, so 0.7 gives 0.98 and 0.89. It costs 3.1 dB, about the 3.7 dB the default compressor adds to quiet sounds.
- **Alternative with less loss:** `this.master.attack.value = 0` plus a trim of 0.85. With attack 0 the worst measured peak was 1.106 at levels 1.0/1.0 and 1.043 at default, so the result is 0.94 and 0.89. This changes how the start of each hit sounds; I did not listen to it.
- **Recipes:** the snare change is not needed for this (worst peak only drops from 1.265 to 1.227). If the kick recipe changes too, re-measure at arbitrary start times before settling on 0.8.

Whichever is chosen, the check in tests/synth_check.html should start hits at arbitrary times, not only at 0.1 s.

### Refuted

- Crash is the loudest sound by far, and short. Why not: The reviewer's numbers are correct, but nothing in the intended use depends on them and the proposed fix conflicts with the project's own plan for the synth.

**Reproduced.** I ran `tests/synth_check.html` in headless Edge and got the same figures:
- Crash "out ear" -18.2 dB, snare -25.2, kick -29.0; 20 dB down at 295.2 ms, 40 dB down at 598.1 ms.
- With the fix (crash only): peak 0.326, 538.6 / [...]
- Open hi-hat is as loud as the snare and louder than the kick. Why not: The reviewer's numbers are correct, but they do not show a defect: the balance they describe is the one the project's own spec sets.

**What I measured myself.** I rendered the real `js/synth.js` in headless Edge 157 (OfflineAudioContext, 48 kHz and 44.1 kHz) from my own page and server on port 8455, and measured the samples in Node with my own FFT and weightings. Nothing under the repo was [...]
- Every guide drum and click is heard 6 ms later than when() intends. Why not: The mechanics are true, but the 6 ms does not matter in the learning mode as planned. Nothing under js/, css/ or index.html was touched.

**Mechanics confirmed (headless Edge on this PC):**
- The compressor delays everything by 6.00 ms at 48 kHz and 5.99 ms at 44.1 kHz, both offline and in a live AudioContext.
- It is a pure shift: onset, peak and best cross-correlation of kick, snare, hi-hat, [...]

## Clock, sound, judging and the microphone together

### Confirmed: Every loop wrap breaks the judging: long loops are wiped and lose their first note, short loops stop being judged

`js\game.js`, severity: breaks

**What goes wrong.** With the page calling game.update(clock.position(t), t) every frame on a looping OwnClock:
- Loop longer than 1.5 s (10-14 s, 16 notes a lap, keys or mic, 100% or 50%): update() resets the game one frame after every wrap, so score and counts return to 0 each lap. The reset is given the position one frame past loop.from, so the note written exactly at loop.from becomes 'skip' from lap 1 on and the learner's hit on it returns null (15 of 16 hits judged in laps 1-3). Notes in the last 130 ms of the loop never become misses (16ths, nobody playing: 31 of 32 misses on lap 0, 30 of 32 after; the note at 13.875 is never judged). A hit 30 ms early on the next lap's first note is credited to the note at loop.to, outside the loop (lap 0 showed 17 judged of 16).
- Loop of 1.5 s or less (10-11.25 and 10-11.5): no reset, the cursor stays at the end. Lap 0 is judged, then 0 of 5 (0 of 6) hits in every later lap.
- Real charts: a note sits right at the section start in 14 of 22 sections (Everlong), 11 of 13 (Du Hast), 18 of 19 (Smells Like Teen Spirit). Everlong's bar is 1.52 s, so a one-bar loop sits on the 1.5 s edge.

**Fix.** Do not let update() decide. Recipe, tried on today's Game in recipe.mjs (32 of 32 per pass over 4 passes for keys and for mic, 32 misses per pass when nobody plays, also right on a 1.3 s loop): Game.autoReset = false while a loop is set, whatever its length. On the frame where clock.lap(t) is higher than on the last frame, BEFORE game.update: (1) every note still waiting becomes a miss (the planned closePass), (2) copy game.counts for the verdict, (3) game.reset(clock.loop.from), the loop's own start and never the current position, (4) then update. The loop must start a counted bar before the first judged note and end at least 0.13 + micDelay + 0.06 s of real time after the last, so no hit has to be matched across the wrap. A mic hit whose stamped time lies before the wrap but which is reported after it (clock.lap(stamp) is lower than the pass now running) must be dropped: after the reset, game.hit() at 13.98 would credit the note at 13.875 of the pass that has only just begun.

**A skeptic's better fix.** The recipe holds, but only under a condition the report does not state: its own recipe.mjs builds the Game from the part's notes alone. main.js line 125 builds it from the whole song, and sound.js (guide drums) and render.js read game.notes, so cutting the list down would also silence and hide everything outside the part.

Tried in (scratch) skeptic-wrap\fix.mjs and fix2.mjs (same folder):

1. Recipe as written on a whole-song Game: the "every waiting note becomes a miss" step also hits every note after the part, and the counted bar's notes are judged. Made-up song (part 10-14, loop 8-14.25): 48 missed per pass, and 4 on-time hits credited to notes outside the part. Everlong Intro C: 143/143 hit but 2206 missed per pass.
   Fix: keep the whole song in the Game and give reset a judged stretch, e.g. reset(pos, from = pos, until = Infinity), which marks every note with t + offset < part start or >= part end as 'skip'. With that, on the made-up song and on Everlong Intro C, Verse 1a and Verse 1b: all notes hit and 0 missed per pass for keys on time and for mic at 50%, exactly the part's note count missed when nobody plays, 0 credited outside the part.

2. The counted bar is required, not optional. With loop = part (10-14) the recipe still gives 31/32 on laps 1-3 for on-time keys, because the key press at the wrap arrives before the frame that does the reset.

3. Compare the lap with the previous frame's value (set lastLap = lap every frame). clock.lap() goes back to 0 on setRate, seek and setLoop: pressing the tempo button in lap 2 took it from 2 to 0. A "higher than the highest seen" test (as recipe.mjs codes it) closed only 4 of 6 passes; the per-frame comparison closed 6 of 6.

4. Confirmed from the recipe: a mic hit stamped at 13.98 and reported after the wrap is credited to the new pass's note at 13.875 (1/32 hit in passes that should have 0) unless it is dropped. A 1.3 s loop (9.6-10.9) gives 4/4 on all 5 passes.

**A skeptic's better fix.** Keep the recipe (it is the spec's B11 wiring: on a wrap, close the pass, copy the counts, game.reset(clock.loop.from), then update), with these corrections, each shown by a script in the skeptic-wrapjudge-q4 folder:

1. Limit "every note still waiting becomes a miss" to the part's notes. recipe.mjs loops over all game.notes. On a Game built as main.js builds it today (new Game(parsed.notes), the whole song) that gave 864 misses per pass (t2.mjs T3a). Limited to [loop.from, loop.to) it still gave 18 false misses: the 16 notes of the counted bar and 2 in the tail (T3b). Build the Learn Game from the part's notes only, or use closePass(partStart, partEnd).

2. Detect the wrap against the previous frame's lap, setting lastLap = lap every frame. recipe.mjs codes a running maximum (if (lap > lastLap) lastLap = lap). clock.setRate(), seekTo() and setLoop() put lap() back to 0, so after the planned tempo step at a wrap 3 of 8 wraps went unseen (T2a: 5 passes closed, 3 resets fell back to update()). With the previous-frame comparison all 8 were seen (T2b).

3. Scale the tail while Game's window is still song time. Today WINDOW is 0.13 s of song, which is 0.26 s real at 50%. With the report's tail of 0.13 + micDelay + 0.06 = 0.245 s real at rate 0.5, a hit 200 ms real late on the last note is reported after the wrap. It was credited 'ok' to pass 1 (t4.mjs d) or dropped (t4.mjs e); either way the pass it was played in gets a miss. Use 0.13 / rate + micDelay + 0.06 real seconds, or land B11's real-time windows (Game.rate) first.

4. Decide a stale mic hit by time, not by clock.lap(stamp): drop hits stamped before the performance time at which the running pass began. After a setRate() on the wrap frame, lap(stamp) and lap(now) are both 0, so the lap rule does not see the hit (t4.mjs g). In that case position(stamp) is 7.975, before loop.from, so it matches nothing: harmless today, but the time rule is simpler and always right.

Game.autoReset = false stays worthwhile as a safety net, per the spec. It is not what makes the recipe work.

### Confirmed: OwnClock.lap() goes back to 0 on pause, resume and tempo change, so wraps seen through lap() are wrong

`js\clock.js`, severity: breaks

**What goes wrong.** Loop 10-14, playing for 9 s: lap() is 2 and raw() is 19. pause() gives lap 0, raw 11. After play() and 8 s lap is 2 again; setRate(0.5) gives lap 0. toggle(), play(), pause() and setRate() all call set(this.position()), which folds the position back into the first lap. A session that takes 'lap changed' as a wrap closes a pass at every pause, tempo change or hidden tab. One that tests 'lap > last' with the old value 2 misses the next two real wraps (0 to 1, 1 to 2), so two passes are never closed or reset. Also: a stroke 20 ms before a wrap, read after pause() + play(), is placed at 9.98 (before the loop) instead of 13.98, and seekTo(20) with loop 10-14 lands on 12.0.

**Fix.** In js/clock.js use this.raw() instead of this.position() in toggle() (line 52), play() (53), pause() (54) and the first line of setRate() (58). Tried on a copy (scratch folder fix\js\clock.js): tests/clock_check.mjs still passes, lap stays 2 through pause() and setRate(), and is 0 after seekTo(). The session still sets its own pass counter back whenever it seeks or sets a loop. In seekTo() while a loop is set, clamp the target into the loop or clear the loop.

**A skeptic's better fix.** The reporter's fix is right for lines 52, 53, 54 and 58 (this.raw() instead of this.position()). Three additions:

1. seekTo: instead of "clamp or clear the loop", fold the target, one line at js/clock.js:55:
   seekTo(seconds) { this.set(this.fold(Math.max(0, seconds)), this.playing); }
   Tried on the copy: seekTo(20) with loop 10-14 still lands on 12.000 (same place as today) but lap() is 0 and raw is 12.000, so "since the song was moved" becomes true. tests/clock_check.mjs still passes.

2. Change the comment on lap() (lines 38-39): with the fix the count no longer restarts on a tempo change, only on setLoop(), clearLoop() and seekTo(). A session that wants a fresh pass at a tempo change must reset its own counter.

3. Add checks to tests/clock_check.mjs so it stays that way: after the "and again" check (lap 3), pause() then play() then setRate(0.5) must leave lap() at 3; seekTo(20) inside loop 10-14 must give lap() 0.

Not covered by either fix: a stroke read after a real tempo change is still extrapolated back at the new rate.

**A skeptic's better fix.** Take the four-line part of the proposed fix and drop the rest:
1. js\clock.js lines 52, 53, 54 and 58: this.raw() instead of this.position() in toggle(), play(), pause() and the first line of setRate(). Leave setLoop() and clearLoop() on position().
2. Same file, lines 38-39: change the lap() comment to "since it was set or the song was moved" (a tempo change no longer restarts it).
3. tests\clock_check.mjs: after the 'and again' check (lap 3) add: lap is still 3 after pause(), after play(), after toggle() twice and after setRate(0.5); lap is 0 after seekTo(13.5) and after setLoop().
4. Do not add the seekTo clamp now. The spec's later step already changes seekTo (clamp at min(0, loop start)); decide there what a target at or past loop.to should do (today seekTo(20) with loop 10-14 lands on 12.0 with lap 2).
5. Rule for the session whatever happens to the clock: a wrap is "lap went up since the last frame"; after every own seekTo, setLoop or clearLoop re-read clock.lap() (it goes to 0 by design); keep the pass number in the session, never show clock.lap() as it.

### Confirmed: The hit window is song time: slower tempo makes the same playing score higher and hides a fixed delay

`js\game.js`, severity: wrong

**What goes wrong.** WINDOW and the JUDGE limits are compared with song seconds. (A) The same hands (errors with a spread of 50 ms of real time) on 240 eighth notes at 120 bpm: at 100% 159 perfect and 4 misses, 85% of the points (grade B); at 70% 94% (A); at 50% 217 perfect, 97% (S). (B) A constant 140 ms of real lateness, which is what an uncorrected kit and mic delay looks like: miss at 100%, ok at 90-70%, good at 60-50%. 250 ms late is still 'ok' at 50%. So a learner is stepped up on scores that collapse at the next tempo through no fault of theirs.

**Fix.** As planned in B11, with these exact places: Game.rate; in hit() measure in real time, `const d = (n.t + this.offset - pos) / this.rate` (line 73, used by lines 74-75) and `off = Math.abs(best.t + this.offset - pos) / this.rate` (line 82); in update() line 53 `const late = pos - (WINDOW + grace) * this.rate - this.offset`. If line 53 stays in song time, a miss shows 260 ms after the note at 50% while hits stop counting at 130 ms. CHORD (line 9) can stay song time. Take the mic delay out in real time before the position is read, in struck() for mic hits only: game.hit(clock.position(h.t - micDelay), ...). Do not use game.offset for it: it is song time (it would need delay x rate) and Player adds it to every guide note too (js/sound.js lines 49 and 57). Nothing else needs changing for tempo: Stage.visible's lead times are song seconds, so at 50% notes keep their spacing on screen and move at half speed (no bunching). js/main.js line 221 and byEar (lines 314-317) assume real time equals song time and must stay off on OwnClock, as already decided.

**A skeptic's better fix.** The reported fix is right and I verified it (lines 53, 73, 82 plus Game.rate, with grace from docs/v2/decisions.md on line 53: `const late = pos - (WINDOW + this.grace) * this.rate - this.offset`). One place it leaves out: line 93 still stores `early: best.t + this.offset - pos` in song seconds. B11 says every judged hit keeps its signed error in real milliseconds, and summarise's median error / B14's fitDelay will read it; at 50% a hit 80 ms late in real time is stored as early = -0.040. Make it `early: (best.t + this.offset - pos) / this.rate`. Whoever owns the clock must also set game.rate = clock.rate on every tempo change (OwnClock.setRate), otherwise the default 1 silently brings the bug back; a node case in the planned game_check that runs the same real-time errors at rate 1 and 0.5 and expects identical counts would lock it (my repro does exactly this: seed 12345 gives 166/53/20/1 at every rate with the fix).

**A skeptic's better fix.** Keep the reviewer's fix and add three things my run showed it leaves open:

1. Line 93 as well: `early: (best.t + this.offset - pos) / this.rate`. After the proposed fix a hit 100 ms of real time late at 50% still stores early = -50 ms, while B11 says every judged hit keeps its signed error in real milliseconds (fitDelay and the median error will read it).

2. Subtracting the mic delay and Game.grace must land in the same change. `position(h.t - micDelay)` with grace 0 gave 16 misses of 16 (delay 140 ms, report 30 ms later, 50%): update() closes the note before the hit is reported. In line 53 it is `this.grace` (default 0 in the constructor), set to micDelay + 0.06 as decisions.md says.

3. `this.rate = 1` in the constructor means every new Game starts at 1, and Learn builds a new Game for each drum set (notesFor). The session must set game.rate = clock.rate right after building a Game and on every tempo change; otherwise the song-time window comes back silently. B11's headless line (robot late:140 at 50% scores nothing) only catches this if it is also run after a change of drum set.

Wording for whoever writes it up: with real-time windows a slower tempo gives no extra milliseconds (sd 100 ms hands read 81% Close at every tempo), which is what B11 asks for; and example A should be restated in share of notes hit, not points.

### Confirmed: Player.heard and Player.mine() cannot tell the site's sound from the learner's drum

`js\sound.js`, severity: breaks

**What goes wrong.** 8 bars of a rock beat at 120 bpm (96 notes), site sound reaching the mic 30 ms late:
- Guide and click on, nobody plays, no gate: 96 of 96 notes perfect, 100%.
- Same with a good learner (20 ms spread) and mine() as the gate: 0 of 96. 40 of the 64 strokes fall inside a site sound's 64 ms and are never reported as their own hit, 23 are thrown away by mine().
- Every guide drum muted, click only, nobody plays: 64 of 96 notes perfect. With mine() and a good learner: 32 of 96.
- Guide plays only the hi-hat, nobody plays: 96 of 96 (the bass and snare notes are hit by the hi-hat).
- Speaker 200 ms late (Bluetooth): mine()'s 70 ms window lets everything through, 94 of 96 'good' with nobody playing.
The real onset worklet shows why no loudness rule helps: a click at -48 dB (far under the -30 dB threshold) arriving 0-30 ms before a snare gives one hit stamped at the click; 50 ms before, the snare is not reported as a loud hit at all (40 of 40 tries); only from 70 ms apart are both reported.

**Fix.** Delete heard, mine() and their two push lines (js/sound.js 27, 59, 67, 78-80), as already decided; no timing or loudness gate replaces them. Rule: a mic hit is judged only while no site sound can reach the mic. Through speakers the learner's turn is silent, with a beat dot on screen; guide on with the mic through speakers means the run is not scored by mic. No judged note may lie inside the counted bar while its clicks sound through speakers (pickup notes there are either not judged or the click stops before them). Words for the UI: speakers, your turn: "Your turn is silent: the microphone would hear the site's drums and click and score them as yours. On headphones? Tick 'I'm on headphones' to keep the click and the other drums." Guide on in Play: "Not scored by mic: it hears the site's drums. Turn Guide off or use headphones." Headphones ticked but the probe hears the site: "The microphone can hear the site's sound. This pass is not scored. Turn the headphones down or untick 'I'm on headphones'."

**A skeptic's better fix.** The reviewer's line list is incomplete and would crash the player. On a temp copy of js/sound.js with only lines 27, 59, 67 and 78-80 deleted, the first Player.run() that schedules sound throws "Cannot read properties of undefined (reading 'length')" from line 73 (`if (this.heard.length > 400) ...`), because line 73 and line 33 (`this.heard = [];` in reset()) still use heard (patched_check.mjs). Delete all of: 27 (the field), 33 (in reset), 59 and 67 (the two pushes), 73 (the trim) and 76-80 (comment and mine()). With exactly those lines removed the copy passes node --check and run() works. Nothing else in js/ or tests/ uses Player.heard or mine(). The rule that replaces it (mic hits judged only while no site sound can reach the mic; silent turn through speakers, guide/click only with headphones ticked) is the one docs/v2/spec.md already settled, and the worklet measurement adds one concrete number to it: a site click must end at least 70 ms before the first judged note, since even a -48 dB click 40-60 ms before a real hit makes the worklet drop that hit.

**A skeptic's better fix.** Keep the report's rule and UI words (they match docs/v2/spec.md B09 and B14), with these corrections:
1. In js/sound.js delete lines 27, 33, 59, 67, 73 and 76-80 (not only 27, 59, 67, 78-80): line 73 left in place throws a TypeError on the first scheduling frame. With the full list the Player schedules exactly what it does today.
2. Make the silent turn through the lists given to Player.run (clicks = the counted bar only, no notes), as B09's explicit click list already plans. Do not do it by switching synth.levels at the marker or at the wrap: that drops the counted bar's first accent on every lap after the first and can leave an accent on note 1.
3. Open mic judging only after the last click of the counted bar could have reached the mic: its meant time plus the speaker's delay plus the worklet's 64 ms. The delay can be measured from the counted bar itself (the mic hearing its clicks is also the 'probe' for the headphones warning); when it is unknown assume 300 ms. A note whose 130 ms window opens before that moment is not judged by mic. On a fast song at full tempo (a beat under about 430 ms with the 300 ms assumption) that is note 1 of each pass.
4. Separate from this report, for B14: when a hit delay is subtracted from mic hits, the miss sweep in game.update has to wait that delay plus about 45 ms, or every note is already a miss when its hit arrives (95.7 of 96 at 140 ms).

### Confirmed: The planned hearsSite window (0 to 150 ms) misses a late speaker and mistakes a learner tapping along for the site

`docs\v2\decisions.md`, severity: wrong

**What goes wrong.** The decided rule is: the mic hears the site when loud onsets fall 0 to 150 ms after the site's sounds for at least 3 and at least 40% of them. Written out and tried 1000 times per case: a speaker 30 ms away is found 100% of the time; a Bluetooth speaker 210 ms late is found 0% of the time, so guide and click would keep sounding and the mic would be judged (the 94 of 96 case above). On headphones with the learner tapping along with the count (30 ms spread) the rule says 'hears the site' 88% of the time on one counted bar and 100% on a 16-note Listen pass, so the turn goes silent for someone on headphones.

**Fix.** Ask for one steady lag instead of a window: the mic hears the site when at least 3 and at least 75% of the sounds are each followed by an onset at the same lag, within 8 ms, anywhere from 0 to 500 ms (steadyLag() in probe.mjs). It finds the speaker at 30 ms and at 210 ms 100% of the time and returns the lag; tapping along gives a false yes in 13% of counted bars but 0% over 16 sounds (9% for a very steady tapper). So decide only from 8 or more sounds (the Listen pass, two counted bars, or Setup's Test sound) and until then keep the silent turn unless headphones are ticked. When bleed and tapping overlap both rules weaken (54% and 38%), which is another reason for the silent default. The lag found is the answer to 'can the page measure it': it is the speaker's unreported delay plus the mic's own, so offer it as own.outDelay ("Your speaker is about 210 ms late"). It cannot contain the kit's stick-to-sound delay; that still has to come from the learner's own hits (fitDelay).

**A skeptic's better fix.** Make the probe answer three ways, so that a failure to recognise the speaker can never switch the click back on:

- **"hears"**: one steady lag anywhere from 0 to 500 ms on 8 or more sounds (the reviewer's `steadyLag`), with a tolerance wider than ±8 ms (about ±15 ms) to survive device-buffer jitter.
- **"does not hear"**: only from a quiet probe. That is 8 or more sounds with at most one (or 10%) of them followed by any loud onset within 0 to 450 ms, not counting past the next site sound.
- **Anything else** (the learner was playing during the probe, or there were fewer than 8 sounds): keep the last answer. The first answer is the silent turn unless "I'm on headphones" is ticked.

Tried in d_three.mjs (1000 tries, 8 and 16 sounds):
- With a speaker at 30 or 210 ms and any play-along case, it answers "does not hear" 0% of the time. The proposed yes/no rule answers it 41-98% in the same cases.
- With no site sound and nobody playing, it answers "does not hear" 100%.
- With no site sound and the learner playing, it keeps the last answer 74-100%. A very steady player gets a false "hears" 8% at 16 sounds and 26% at 8, which only costs the click.

Show the lag as a suggestion ("Your speaker is about 210 ms late, apply?") only when it is over about 100 ms. Do not write it into `own.outDelay` by itself, because it contains the mic's input delay.

A one-line alternative is to stretch the decided window to 0-450 ms, capped at the next site sound, keeping "at least 3 and 40%". In c_fix.mjs it finds the speaker 100% in every case except the 4-click bar with a 30 ms speaker and a 40 ms kit (90%), and it errs only toward the silent turn. It cannot report the lag.

### Not verified

- Sound is late when the output is slower than the 0.14 s scheduled ahead, and the first sound after every start is always late

### Refuted

- 'Share of notes hit' with a flat 130 ms window cannot tell playing the part from playing between the notes. Why not: The mechanics reproduce (windows.mjs block C and reach.mjs give the reported numbers), but as filed it does not matter in real use, and the proposed fix fails honest players on the very songs it is aimed at.

1. The headline player is decided behaviour, not a defect. "Half a gap late" on 8ths at 120 bpm is a constant 125 ms lateness. docs/v2/critiques.md line 176 (adopted in decisions.md, B11 [...]
- A 'wait for me' mode built on pause and Player.hold deadlocks, slows the song, cuts the sound and calls every stroke perfect. Why not: The numbers reproduce, but only inside the reviewer's own prototype of a mode the site does not have and has decided not to build.

1. Nothing in the site stops the clock at a note. `grep "\.hold\b"` over js/, index.html, tests/ and v1/js finds two lines, both in js\sound.js: line 26 (the field, default false) and line 38 (the read). Nothing sets it. The lines that create the fault, [...]

## Song parts read from charts (js/chartparse.js)

### Confirmed: .mid: five marker spellings are skipped, so the part before runs on through them

`js/chartparse.js`, severity: wrong

**What goes wrong.** 15 part markers in 10 of 1,409 .mid charts are not read; each lost part is silently merged into the one before it. The spellings, each copied from a real chart's EVENTS track: (1) a lyric event FF 05 instead of a text event FF 01: "[prc_main_riff_1]" (King Diamond - A Mansion in Darkness by DashRetro, md5 78580709: the first part is lost, 224 notes over 14 s end up before any part), also twenty one pilots - Holding on to You by Hoph2o dd45f21f (3 parts) and Roselia - Sprechchor by Niv47 d3d2490e; (2) no opening bracket: "prc_chorus_3b]" (Russell Allen & Jorn Lande - Where Have the Angels Gone by Luke Noel III a0c61e3b), "prc_main_riff_1]" (twenty one pilots - Ode to Sleep by Hoph2o 05cfcbed); (3) no closing bracket: "[section Verse 3A" (The Contortionist - Exoplanet by RAT KING 03b73657); (4) a space before the bracket: " [prc_gtr_solo_1b]" (FamilyJules - Melizande's Theme by Luke Noel III 303cfb0f); (5) "section" misspelt in Rock Band's own charts: "[secton jam_a]", "[secton jam_b]" (The Who - Young Man Blues (Live at Leeds) 0bfabaaf), "[secrion main_riff_1]" x3 (Sixx:A.M. - Life is Beautiful b9f45b3b), "[sectiom gtr_mel_1]" (Pixies - Monkey Gone to Heaven d0db295d), all charter Harmonix. Cause: readTrack line 275 files every FF 01 / FF 05 event that does not start with "[" as a lyric and line 276 keeps text only for FF 01; the regex at line 350 needs "[", the exact word "section" and "]".

**Fix.** Lines 275-276 become:
      else if ((type === 0x05 || type === 0x01) && len) {
        if (b[p] !== 0x5b) track.lyrics.push(tick);              // not "[section]" text
        track.texts.push({ tick, text: readText(b.subarray(p, p + len)) });
      }
Add above readTrack (line 264):
function readText(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return new TextDecoder('latin1').decode(bytes); }
}
Line 350 becomes:
      const m = /^\[?(?:sec[a-z]{3,5}[ _]|prc_)([^\]]+)\]?$/.exec(e.text.trim());
The whole change is applied in the copy patched/chartparse.js in the survey folder.

**A skeptic's better fix.** Keep the reviewer's change to lines 275-276 and the readText helper, but use a narrower regex at line 350:

      const m = /^\[?(?:sec[a-z]?i?o[nm][ _]|prc_)([^\]]+)/.exec(e.text.trim());

Two things my synth2.mjs showed about the reviewer's regex /^\[?(?:sec[a-z]{3,5}[ _]|prc_)([^\]]+)\]?$/ (both on made-up texts only; I did not find either in a real chart):
1. "sec" plus any 3 to 5 letters, with the bracket now optional and FF 05 now read, turns ordinary words into parts: FF 05 "second chance" becomes a part "Chance", FF 01 "secret track" becomes "Track", "[second_gtr on]" becomes "Gtr On". The narrower word pattern sec[a-z]?i?o[nm] still takes section, secton, secrion and sectiom and rejects all three.
2. The new "$" drops something the site reads today: FF 01 "[section verse_2] x" gives "Verse 2" on the site and nothing with the reviewer's regex. Without the "$" it is still read.

Checked: the narrower variant returns the same sections as the reviewer's fix on all ten real charts (the same 15 gained, none lost, everything else identical) and reads all the synthetic spellings from the report.

### Confirmed: .chart: a part name with a quote or bracket in it is dropped, cut short or keeps a bracket

`js/chartparse.js`, severity: wrong

**What goes wrong.** The [Events] regex stops the name at the first " or ]. Real lines: `0 = E "section "XIV 2.0""` and `111420 = E "section "Behold 2.0""` give no section at all (Jason Richardson & Luke Holland - XIV 2.0/Behold 2.0 by thehwdavis, md5 b429342f: the two song starts are missing). `276480 = E "section Polaris", by H.P. Lovecraft (1)"` (and (2), (3)) give three parts all named "Polaris" (Secret Band - Moon by SirMonkfish, moopuns 55d8763c). `3840 = E "section [Verse 1]"` gives "[Verse 1" with the bracket left on: 13 sections in 2 charts by InsaneOwO (Car Seat Headrest - Reuse The Cels 244419c4, They Might Be Giants - Ana Ng a2bcbb14). 4 of 1,442 .chart charts in all.

**Fix.** Line 137 becomes:
    const part = /^(\d+)\s*=\s*E\s+"\[?(?:section[ _]|prc_)(.*?)\]?"$/.exec(l);
and sectionName (line 73) takes quotes and brackets out before the rest: `.replace(/"/g, '').replace(/[\[\]]/g, ' ')` (full sectionName in the next finding).

### Not verified

- Part names keep Clone Hero's text styling tags
- Guitar Hero's end markers come out as parts named "ENDOFSONG" and "ENDOFSONG CAREER"
- Rock Band Network's automatic cuts come out as "Ugc Section 10 30"
- .mid part names written in UTF-8 come out garbled
- Short forms from Rock Band charts are shown as written: "Gtr Solo", "Bre", "Kybd Intro"
- A .mid with bare part names gives no sections at all
- 29% of charts have parts with no drum note in them
- 2% of charts have drum notes before the first part
- Loops must not be snapped forward to a bar line: 3 to 5 percent of parts start with a pickup

## Your songs (js/library.js)

### Not verified

- Songs with non-Latin or punctuation-only titles fall on one key, or cannot be kept at all
- A live, acoustic or remix version is filed as the studio song and takes over its entry
- One song becomes two when Spotify and the chart write the artist or title differently
- remember() lets the last caller win: a chart's facts replace Spotify's, one chart replaces the six kept, the chart in use can be dropped
- A run or a part in which no note was judged counts as perfect: grade S, new best, part learned
- partDone keeps the fastest try however bad it was
- best is the highest raw score across tempo, level and chart; a first run without a number sticks
- Storage full or blocked: the page is told it saved
- Two tabs: the tab that saves last throws away what the other one saved
- Nothing is ever dropped and every change rewrites the whole library
- Entries, runs and part records handed out are the stored objects
- Damaged or foreign JSON under the key breaks the lists or loses everything silently
- Order and small traps: clock set back, liking twice, a throwing listener, get('constructor')
- What the shape cannot carry for the liked page, the results screen and per-part progress

## Numbers the reviewers measured

### The clock (js/clock.js)

All scripts are in (scratch) clock-attack (node 24.19). Nothing under the repo was created, edited or committed; headless Edge and the scratch server on port 8437 were closed (0 processes, 0 listeners left). tests/clock_check.mjs passes on the repo clock (13 ok) and on the patched scratch copy.

Things that held:
- Long runs (a2_precision.mjs, against exact rational arithmetic, 20 000 times each at rates 0.5, 0.7, 1): worst error of position() after 1 h of looping 1.7e-13 s, after 10 h 2.7e-12 s, after 100 h 1.9e-11 s. No drift: nothing accumulates between re-anchors. lap() wrong 0 of 180 000; position() outside [from, to) 0 of 180 000; 735 216 inputs built to make position() return exactly loop.to found none.
- Tempo changes inside a loop: the place does not jump. One hour with 2002 tempo changes, pauses and loop re-sets: place off by at most 7.0e-13 s.
- Each re-anchor reads the timer twice (position(), then set()): the place slips back by the time between the two readings (5 us per call in a test where every reading is 5 us later). In Edge the timer steps 0.1 ms, so it is normally 0.
- position exactly at loop.to gives loop.from and lap 1; 1 ns before gives 13.999999999 and lap 0. A loop set while paused or playing keeps the place when inside (also at exactly from) and goes to from when outside (also at exactly to).
- span() over 18 cases of 10 000 random frames (rates 0.5, 0.6, 0.7, 0.8, 0.9, 1; loops 10-14, 61.3713-75.9127, 30-30.25, 0.3-1.1, 250.1-300.7, none): no empty stretch, none backward, none under 1 ns, first .at === t0 always, .to === loop.to and next .from === loop.from at all 7125 loop ends, sum of stretches equals the time asked within 6.4e-12 s over up to 548 s. Zero-length or negative stretches only came from the invalid loops in the bad-input finding.
- Rate changed between two span calls: the second span starts from the re-anchored place, so the two do not tile (by design); the Player copes because clock.at is in its state key and it flushes.
- Timing of sounds asked through the real Player: worst 1.8e-12 s from ideal over 300 laps, at every rate.

Edge's timer (timer.html, headless Edge 157, page not cross-origin isolated): performance.now() steps 0.1 ms; values are multiples of 2^-26 ms (e.g. 18.100000008940697).

Old ManualClock against OwnClock (a6_contract.mjs, rate 1, no loop): position(), position(t in the past), playing and .at are identical through toggle(), seekTo(pos+5), seekTo(pos-50), set(20, true). No member of ManualClock is missing. Only difference: stop(). OwnClock pauses and keeps the place (21.5); ManualClock's stop() only clears playing, so its position falls back to the last anchor (20.0). main.js never reads a clock after stop() (lines 75, 410, 499).
New with OwnClock: position(t) for a moment before the last re-anchor is extrapolated with today's tempo and no loop: 10 s at tempo 1, then 1 s at 0.5, position(now-6) says 7.5 (the song was at 5); loop 10-14, tempo set just after the wrap, position(now-1) says 9.6 (it was at 13.6). main.js asks exactly this for mic clips (clock.position(clip.start), lines 314 and 520).

Game's windows are in song seconds: at half tempo a hit 100 ms late in real time is 50 ms of song and scores 'good' (a7_game.mjs case E); every window is twice as wide in real time at 0.5.

setLoop(5, undefined) and setLoop(14, 10) give no loop without any sign (a last section without an end time would silently not loop).

### The sound scheduler (js/sound.js, js/synth.js)

All runs: real js/sound.js + js/clock.js (+ js/synth.js where said), node 24, fake performance clock, frames 4-40 ms unless said. Scripts in (scratch) sound-attack.

RIGHT AS IT IS
- Steady play at tempo 0.5, 0.7, 1.0, straight and round a section, 3 charts (18 runs): apart from the start (finding 1) every note, accent and click is asked for exactly once, timing error at most 1.1e-13 s. Notes exactly on loop.to never sound; notes exactly on loop.from sound once a lap (offset 0).
- Two hours round one section at 60 fps, half tempo (525 laps, 432,001 frames, 35,700 sounds): 0 twice, 0 lost, largest timing error 1.8e-12 s; Player.heard stays at 119 entries.
- A 0.25 s loop at tempo 0.5, 1 and 1.5, a seek past the loop's end and one before its start: nothing twice, nothing lost.
- No change in mid-song (pause/resume, seek, setRate, setLoop, clearLoop, offset) ever made a sound play twice.

STALLS
- A frame longer than AHEAD leaves a silent hole of (frame - 140 ms); the sounds in it are skipped, not bunched. 300 ms stall = 160 ms hole, 0 to 3 sounds each; over 8 stalls 4, 15 and 20 sounds lost at tempo 0.5, 0.7, 1.0. Fixed frame length: nothing lost up to 139 ms; 141 ms loses 3 of 327; 150 ms loses 106 of 327.

AFTER A CHANGE
- Sounds already scheduled keep sounding until the next frame flushes them: 11 such sounds in 40 runs, the latest 29.7 ms after the change. Lost is only what falls between the change and the next frame (finding 1).
- game.offset changed in mid-song: +0.05 s makes 18 of 2192 notes sound twice, -0.05 s makes 13 of 2202 never sound; +0.2 s 62 twice, -0.2 s 52 never.
- Muting a pad in mid-song: it still sounds up to 127 ms later (16 sounds in 40 runs). Unmuting, or guide/click level back up from 0: up to 133 ms of notes missing (12 / 26 / 8 sounds in 40 runs).
- hold with the clock paused, 2 s: nothing twice, nothing lost beyond the start gap. hold on and off between two frames with the clock untouched: no effect at all.
- If the loop is set in chart time (section.t) while game.offset is -0.05: the section's own first beat sounds 0 times in 3 laps and the next section's first beat 12 times. The loop has to be section.t + game.offset.

SYNTH, headless Edge 157 on this PC (sample rate 48000, baseLatency 0.01, outputLatency 0.04)
- voice(): 88 offline renders (11 voices x 4 sub-sample offsets x 48 kHz and 44.1 kHz): no sample before the due time, first samples at most 2.2e-4, last samples before the stop at most 1e-4: no click at either end. The hit reaches 10% of its peak 0.73 to 1.6 ms after it is due.
- A voice asked for 12 ms in the past starts at once, 12 ms late, with its envelope already past the attack (kick first sample 0.045, click 0.207): shorter, no extra click.
- Books of a 30 s run at full tempo: 961 nodes (387 sources, 389 gains, 183 filters), every source given a stop() after its envelope ends, 0 disconnect() calls. Finished voices cost nothing afterwards: after 14,500 voices, 30 s of silence renders in 12-19 ms against 12-21 ms for a context that never played.
- flush() on the live context: a ringing crash is gone within about 70 ms; a snare after a flush peaks 0.767 (0.716 before any flush), a hit in the same instant as the flush 0.779, after 60 flushes in a row 0.793; a snare scheduled before the flush for after it: 0.0015; guide level 0: 0, level back: 0.713. flush() does not leave the next sounds silent.
- Peaks before the bus gain: kick 1.15-1.18, snare up to 1.17. Crash + kick + hi-hat + accent on one [...]

### How the drums sound (js/synth.js)

Run: headless Edge 157, PORT=8431 node dev/serve.mjs, http://127.0.0.1:8431/tests/synth_check.html, numbers read over CDP; the server logged the REPORT JSON. Server and browser are stopped, port 8431 is free, git shows only the new tests/synth_check.html. The page sets window.result and window.done, and window.run(otherVoice) measures a changed recipe the same way. All single hits are scheduled at 0.1 s = on a whole sample, which is the best case for the noise sounds until the rounding fix is in.

ONE HIT EACH, raw voice() (peak | -20 dB ms | -40 dB ms | centroid Hz | strongest Hz | % <200 Hz / 200-2k / 2-5k / >5k | loudest 125 ms dB: flat / A-weighted / nothing below 200 Hz) and as it leaves the page through gain + compressor (peak / A-weighted):
kick 1.147 | 77 | 149 | 131 | 120 | 96.5/3.5/0/0 | -11.4/-26.3/-23.0 ; out 0.821/-29.0 ; pitch 127>94>57>46
snare 1.172 | 39 | 83 | 7657 | 219 | 2.7/37.1/8.4/51.8 | -18.4/-22.3/-18.8 ; out 0.812/-25.2
hihat closed 0.368 | 15 | 26 | 13888 | 8567 | 0/0/0.8/99.2 (57 % above 12 kHz) | -31.2/-35.2/-31.2 ; out 0.355/-35.4
hihat open 0.470 | 105 | 216 | 13521 | 8955 | 0/0/1.8/98.2 | -21.6/-25.3/-21.6 ; out 0.457/-25.2
pedal 0.150 | 10 | 19 | 6858 | 4758 | 0/2.4/28.7/68.8 | -41.8/-42.2/-41.8 ; out 0.146/-42.3
crash 0.681 | 295 | 598 | 12182 | 8955 | 0/0.2/9.9/89.9 | -15.1/-17.8/-15.1 ; out 0.607/-18.2
ride 0.204 | 116 | 252 | 4931 | 3350 | 0/0.1/66.2/33.7 | -29.5/-29.0/-29.5 ; out 0.200/-28.7
tom 0.799 | 69 | 134 | 223 | 211 | 10.6/89.3/0/0 | -14.2/-23.9/-16.1 ; out 0.664/-25.2 ; pitch 218>199>168>150
floor 0.889 | 98 | 195 | 130 | 122 | 97.9/2.1/0/0 | -11.6/-26.8/-24.5 ; out 0.700/-28.6 ; pitch 128>119>103>85
click 0.204 | 9.5 | 16.7 | 1853 | 1100 | 0.1/83.1/9.3/7.5 | -33.2/-33.0/-33.2 ; out 0.125/-37.2
accent 0.280 | 10.7 | 19.4 | 2507 | 1650 | 0.1/83.1/8.6/8.2 | -30.0/-29.2/-30.0 ; out 0.171/-33.5

JUDGED AS FINE (no change needed): snare = body at 219 Hz plus noise (52 % above 5 kHz); closed hat short and bright (26 ms, 99 % above 5 kHz); open hat 8.3 times longer than closed; ride has its ping (strongest partial 3350 Hz, 66 % of energy in 2-5 kHz) and sits far from the hats (centroid 4.9 kHz vs 13.5 kHz); tom is a note (218 > 150 Hz) and distinct from kick and floor; click and accent are short (17 / 19 ms), a fifth apart, and unlike any drum (83 % in 200 Hz-2 kHz, where no drum has its strongest partial). In the mix the click stands out at its own frequency: at 1100 Hz 20 ms after the hit, snare+hihat -53.5 dB vs -38.0 with the click (+15.5 dB), kick+hihat +23.0 dB, tom+floor+ride +17.7 dB; accent at 1650 Hz over kick+snare+hihat+crash +9.2 dB. The compressor ducks the click 4.7 dB under a snare and the accent 7.4 dB under four drums.

NO CLICKS AT START OR END: all 11 sounds are exactly silent before `at`; first sample is 66 to 103 dB below the sound's peak; level when the source is stopped is 66 dB (click) to 200 dB below peak; largest sample-to-sample step of the pure tones is 5 to 9 % of peak.

BUSY BAR through Synth's chain (160 bpm, 2 s): together 1.053 (3 samples over 1), sixteenth hats 0.548, bar 1.053 (3), bar + click 1.088 (4), every beat 1.163 (14); before the compressor 1.889 / 0.442 / 1.889 / 1.994 / 2.2. Compressor: quiet sound +3.7 dB, delay 6 ms.

VERIFIED RECIPE (all changes measured together with run()): kick 0.777 | 121 | 232 | strongest 51 Hz | 84.4/15.6 | -11.4/-24.9/-18.6 ; out 0.635/-26.6 ; pitch 157>66>50>50. snare 0.989 | 54 | 121 | 216 Hz | -18.6/-22.7/-19.1 ; out [...]

### Your songs (js/library.js)

All runs on node v24.19.0 and headless Edge 157 (own profile, own ports 8463 then 8491/8492; port 8463 was later taken by another agent's server.mjs, left alone). Nothing under the repo was created or changed; git state untouched.

Keys: 43 of 71 title/artist pairs not as wanted on the repo, 11 of 71 with the proposal (the 11 are listed in the artist finding). Real Chorus Encore data, 16 songs: 'Queen & David Bowie - Under Pressure' and 'AC/DC - Back in Black (Live)' are the real cases; for non-Latin Spotify titles findCharts returns 0 charts (fit() needs a non-empty norm).

Sizes (stored JSON, chars): song only opened with 6 charts 1,629-1,637; each run 273; each part 110; 500 songs x 12 runs x 11 parts = 3,061,121 (2.92 MiB). Edge localStorage for one origin: 5,242,368 chars measured (binary search, 1 KiB steps). 3,179 opened-only songs fit; filling 500 songs took 11,500 whole-library writes = 16.8 GiB written in all.

One save in Edge (median / max ms): 50 songs 0.6-0.9 / 2.1; 150 songs 4.1-5.1 / 6.9; 500 songs 19.4-25 / 28.3. First read: 1.1 / 3.8 / 11-15 ms. Reads at 500 songs: isLiked 0.0007-0.0013 ms, liked() 0.1 ms, recent() 0.1 ms. Proposal at 500 songs in Edge: save 21-24 ms, liked() 0.1 ms, isLiked 0.0023 ms, first read 12.6 ms.

Real charts: 27 charts with parts from 10 songs: 13 have a part with no drum notes, 1 has a part name twice; in the 12 charts tests/sections_check.mjs prints, every name is unique.

Game points vs thresholds: all 'good' = 0.70 (C), all 'ok' = 0.40 (D), 85 perfect + 15 missed = 0.85 (B, learned), 50 perfect + 50 good = 0.85 (B, learned). grade edges: 0.95 S, 0.9499999 A, 0.88 A, 0.78 B, 0.65 C, NaN/undefined/null D, Infinity and 1.2 S. learned edges: {0.85, 0.99} true, {0.85, 0.98999} false, {0.8499, 1} false, {1, 1.5} true; 0.5 stepped +0.05 ten times is 1.0000000000000004 and passes.

Checked and fine on the repo: AC/DC, accents (Beyoncé, Motörhead), full-width Latin, curly apostrophes, blink-182, remaster in ' - ', () and []; the stored title files under the same key for all real titles tried; empty charts list, empty art and 0 length do not wipe; best stays when it falls off the 12 kept runs; plays counts finished runs only.

Proposal: patched/js/library.js (276 lines, same exports plus saved(); no longer imports charts.js) and patched/js/store.js (set returns true/false). fixed.mjs: 4 of 50 checks ok on the repo's library, 50 of 50 on the proposal. The repo's tests/library_check.mjs on the proposal: all ok once line 52 reads the entry again (patched/tests/library_check_reread.mjs); unchanged it fails that one line. Contract changes the wiring step must know: songKey returns '' (not '|') when unusable; record() returns kept:false and run.grade null for a run with nothing judged; partDone takes notes; listeners get { saved }; lists and entries are copies; unlike of an unknown song returns null.

### Song parts read from charts (js/chartparse.js)

SAMPLES. (A) Well-known songs: 91 searched with searchCharts (rock 22, metal 18, pop 13, punk 14, older 18 had a fitting chart = 85 songs; none for Iron Man, Psychosocial, Rolling in the Deep, Shake It Off, Get Lucky, Hotel California, Born to Be Wild), up to 3 charts each, 177 charts loaded with loadChart: 130 .mid, 47 .chart; charter Harmonix 65, Neversoft 43, other 69. (B) Catalogue: 27 pages of 100 spread over the whole drum list (newest to oldest), 2,700 charts: 1,297 .mid, 1,403 .chart. Together 2,851 different charts, 0 load failures (api.enchor.us retried inside the script).

SHARE WITH SECTIONS, site reader as it is. A: .mid 130/130, .chart 46/47 (the one without: The Weeknd - Blinding Lights by BepoCS 8f328383, [Events] block empty). B: .mid 1,292/1,297 = 99.6%, .chart 1,395/1,403 = 99.4%. With 3 or more sections and real names (not the automatic cut): .mid 1,279/1,297 = 98.6%, .chart 1,389/1,403 = 99.0%. And nothing to clean in any name (tags, bracket, end marker, garbled letters): .mid 1,266/1,297 = 97.6%, .chart 1,360/1,403 = 96.9%. Harmonix: 354/354 with sections.
The 13 charts in B with no sections: 8 .chart have no section line in the file ([Events] empty or only "EVENTS", "music_start", "music_end", "end": 5 by InsaneOwO, 3 Rage Against the Machine charts by sailingwhisper); 4 .mid have only [music_start] / [music_end] / [end] / [crowd_*]; 1 .mid has bare names (Powerwolf, see findings).

SPELLINGS IN USE (B, charts): .chart `E "section Name"` 1,393 (2 of them `"section [Name]"`); .mid `[section name]` 734, `[prc_name]` 561, `[section_name]` 2 (Harmonix), both section and prc in one file 3 (no doubles). Not seen in 2,851 charts: capital "Section"/"PRC", markers in FF 06/07 events, markers in a track other than EVENTS.

SECTIONS PER CHART: median 14 (5% of charts 7-8, 95% 25-27); max 45 in A, 251 in B (full-album charts; 41 charts in B have over 40).
LENGTH (start to next start): A median 15.1 s, 5% 7.4, 95% 31.8, shortest 2.27, longest 64.0. B median 13.7 s, 5% 6.4, 95% 28.5, shortest 0.01, longest 337.8; under 2 s: 0.2% of sections in 1.5% of charts (two markers almost on each other); over 60 s: 0.2% of sections in 1.7% of charts.
FIRST SECTION MINUS FIRST NOTE: A median -4.88 s (range -78.4 to +4.97); B median -2.04 s (5% -36.9, range -183.4 to +13.99). Same moment within 0.05 s: 26% A, 37% B. Section first: 72% / 61%. Note first: 2.3% / 2.0%.
ORDER: section events out of order in the file 0 charts; two on one tick 0; same time after reading 0. The same name is used for more than one section in 4.0% (A) / 7.3% (B) of charts (e.g. "Chorus" three times), so the page must key parts by index, not name.
EMPTY: sections with no drum note 2.8% (A) / 3.8% (B), in 29% of charts in both.

BARS AGAINST SECTIONS (reader's bars, 30 ms): on a bar line A 2,438/2,668 = 91%, B 40,591/42,944 = 95%; on any beat 97% / 98%. By format in B: .mid 94%, .chart 95%. Charts with every section on a bar line: A 64%, B 71%; with 90%+: 86% / 87%; with under half: 4.5% / 3.2%. Off the bar: up to a beat before a bar line 5.4% / 2.7% (83% / 82% of those have notes before the bar line); up to a beat after 0.8% / 0.6%; elsewhere 2.2% / 1.7%; past the reader's last bar 0.3% / 0.4%. By ticks: section length is a whole number of bars 86% / 85% (92% / 94% where one time signature covers it), a whole number of beats 97% / 97%. One time signature for the whole song: 66% / 57% of charts.

PROPOSED READER CHANGES, CHECKED. patched/chartparse.js in the survey [...]

### Clock, sound, judging and the microphone together

All scripts are in (scratch) practice. Nothing in the repo was changed; my Edge process and the server on port 8467 are stopped.

Things that are right:
- Player.run with OwnClock.span (sched.mjs): over 60 s at 100, 70 and 50%, with loops 10-14, 10.3-13.9 and 10-11.2, every guide note was scheduled exactly once with 0 microseconds of error. A note written exactly at loop.to never sounded in 355 laps, and the stretch before a wrap overshot loop.to in 0 of 120000 tries.
- Mic stamps: the real onset worklet on made-up sound stamps a click, snare or kick 4.5 ms early to 2.2 ms late (median 1 ms early) and tells the page 38-45 ms after the sound starts. In headless Edge with Chromium's fake mic, hits reached the page 42.7-45.6 ms after their stamp, and Mic's stamps differed from the sample count by at most 2.1 ms over 26 gaps, so js/mic.js line 67 needs no change.
- Synth.when's clock reading: in Edge on this PC (48 kHz, baseLatency 10 ms, outputLatency 41-42 ms) the getOutputTimestamp skew stayed within -0.03 to +0.14 ms over 5 s. The currentTime fallback differs from it by 0.3 to 11.4 ms (median 5.7).
- The same drum repeated: the worklet reports 16 of 16 strokes down to 75 ms apart; at 62 ms, snare 11.4 of 16 and kick 7 of 16.
- Stage.visible's lead times are song seconds (lanes 1.8, mania 1.15, kit 0.9, tab about 3.5 at 1280 px): at 50% notes take twice as long and keep their spacing.
- The planned loop tail of max(0.15, micDelay + 0.1) s is enough for the three charts fetched: no note lies within 75 ms before a section start in 54 sections (within 130 ms: 13 of 22, 0 of 13, 4 of 19).

Other numbers:
- With frame stalls of 250 ms, 6 of 335 (and 6 of 240) guide notes were never scheduled; they are skipped silently, not bunched. The planned 25 ms timer and dropped counter cover this.
- Today's Game loses mic hits that are in the window but reported late: strokes stamped 92 and 98 ms after their note were reported 135 and 140 ms after it and matched nothing (2 of 64 for a learner with a 20 ms spread and 40 ms kit delay). This is the already known reason for Game.grace.
- Real charts (expert): Everlong 2449 notes, median gap 95 ms, 80% of gaps under 130 ms, bar 1.52 s; Du Hast median 240 ms, bar 1.92 s; Smells Like Teen Spirit median 254 ms, bar 2.04 s. No gap under 64 ms in any of the three.
- The wrap recipe on today's Game (recipe.mjs): 32 of 32 per pass over 4 passes for keys and for mic 60 ms late, 32 misses per pass when nobody plays.

Not tested on real hardware: the bleed, delay and Bluetooth figures are simulations with stated delays (speaker to mic 30 or 200 ms, kit 40 ms, report 43 ms); no real kit, speaker or microphone was used.
