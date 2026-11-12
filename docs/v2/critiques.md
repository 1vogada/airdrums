# What the two outside critics found in the spec

Both read the spec after the council finished. What was done about each point is in [decisions.md](decisions.md).

## Critic: can it be built?

Feasible as a static site, but not as written: one blocker and eight serious issues need a spec change before the build.

Nothing in build_now needs the sticks' data, Spotify speed control or a server. I read js/main.js, spotify.js, charts.js, chartparse.js, game.js, render.js, clock.js, sound.js, synth.js, library.js, mic.js, index.html, sw.js and the tests in ~\Desktop\airdrums, and ran tests/library_check.mjs and tests/clock_check.mjs (both pass on the working tree). No browser was started, so the browser-side claims below are from the code and the Web Audio and CDP specifications, not from a run.

What holds up:
- **View switch:** render.js reads `this.mode` on every draw, so assigning `stage.mode` works with no edit.
- **Fewer drums and loops:** every view tolerates a Game built from filtered notes, notes left unjudged, and positions below 0:00.
- **Rig:** the .sng layout read by `sngIndex()` is simple to pack, and Chromium's Fetch domain should pause CORS preflights, so the stubbed network should work. Node 24, Edge and ffmpeg are on the machine.
- **Clock swap:** OwnClock has the same surface as ManualClock, including `at`, which tests/ear_e2e.mjs reads.

What must change before building:
1. **Blocker: the microphone in Learn before B14.** At stop line B the owner's real setup (kit plus mic) gets either hits judged with no kit-delay correction or a silent, unscored turn. The rig stays green because it only presses keys.
2. **'Fix it' on a followed song** is reverted within seconds by the continuous line-up by ear in main.js. Keep a separate hit delay instead of touching the song sync.
3. **Spotify hardening** can regress the only path proven on the kit: unlinking on a 401, treating an unreadable Retry-After as a lock-out, and 10 s polling while paused or waiting.
4. **Deferred library saves** cannot coexist with the unchanged library test.
5. **Pause on hidden and stop on leave** must apply to the site's own sound only, not to the user's own music or the demo clock.
6. **Build order:** several acceptance checks need screens from later items, B09 needs parts.js from B10, and a ship at stop line A would carry dead Learn buttons.
7. **Songs liked from Spotify with no chart** have no md5, yet every row and route is md5-addressed.
8. **Rig traps:** the service-worker reload on a fresh profile, seeds re-applied on reload, the fake microphone producing hits, and no defined way to hide the tab.
9. **Mic verdicts** accept any sound, so noise can write 'learned'; a precision guard is needed.

The minor issues are mostly numbers and rules that contradict their own acceptance checks (synth levels, the drums step, fitDelay, part ids) and navigation details left to guesswork.

### [blocker] B09 / B11 / B12 / B14: the microphone in Learn before B14 lands (stop line B)

**Problem.** B09 says mic hits on the site clock only light the pads until B14. B11's soundPlan nevertheless returns 'guide off, click in the counted bar only, micJudged true' for a Learn turn with the mic on, and B12 plays by soundPlan. B14 sits after stop line B and may be left out. So at stop line B the owner's normal setup (kit plus mic on) gets one of two broken results: hits judged with no kit-delay correction (the kit's Bluetooth speaker makes every hit late, so every pass reads 'Again' and Auto walks the tempo down to 50%), or a silent turn that reads 'not scoring: no hits heard' although hits were heard. B13 would also tell someone who played 'You watched this one. No hits were heard.' The rig drives Learn only with robot keys, so it stays green and nobody sees this before shipping.

**Fix.** Add one switch, micScoresOnSiteClock, false until B14 is green. While false the session calls soundPlan with micOn=false (guide and click as set, never the silent plan), mic hits only light pads, Auto does not step on a pass with no key hits, and the practice line and results say 'The mic cannot score on the site's drums yet. Press G when it feels clean.' Or move B14's rule 1 and the delay fit in front of B12 and make stop line B = B01-B12 plus B14. Add a rig scenario at B12: mic on, injected mic hits, expect no score, no step, guide present in the sound log.

### [serious] B13 'Fix it' on a followed song is undone by the continuous line-up by ear

**Problem.** B13 folds the median hit lean into the song's sync with setFine. The timing sentence only shows on microphone runs, and with the mic on byEar() (js\main.js lines 308-336, moved unchanged into session.js) runs every 3 s. After a +40 ms hand change earBase equals the new value, byEar measures the old acoustic value 40 ms away (inside EAR_MOST 0.15), sees it twice and calls setFine(delay,'ear'): the fix is reverted within about 6 s of play. The rig check passes only because its mic is not running. It also moves the notes away from the music the player hears, when the thing that is late is the kit's own speaker.

**Fix.** Never fold a hit lean into the song sync. Keep one hit delay for mic hits that is subtracted from mic hit times in every source (generalise own.micDelay, e.g. mic.hitDelay with a per-source value) and let 'Fix it' change that. Acceptance: with the fake mic running and by ear active, the value still holds 15 s after 'Fix it', and game.offset is unchanged.

### [serious] B15 Spotify hardening can break the one path proven on the real kit

**Problem.** Three rules are riskier than today's code (js/spotify.js). (1) 'a 401 unlinks': today a 401 only shows a message; deleting the refresh token on one 401 forces a full re-link for a stale or revoked access token that a refresh would cure. (2) 'a longer or missing Retry-After means asking stops': nobody checked that api.spotify.com exposes Retry-After to page script (Access-Control-Expose-Headers); the scouts only measured that for enchor, where the headers are hidden. If it is hidden, headers.get returns null and every ordinary 429 becomes the 'Spotify paused this app' state with an unknown N; today it waits 5 s. The rig cannot catch this because a CDP-fulfilled answer exposes whatever the stub says. (3) Polling every 10 s while paused, with no interval stated for the 204 or waiting state: a resume, or the song started after the hand-off ('I am listening'), is noticed up to 10 s late plus the chart load; today it is 2 s.

**Fix.** 401: refresh once ignoring expires_at and retry; unlink only on invalid_grant. 429: stop only when the JSON body says QUOTA_EXCEEDED or a readable Retry-After is over 60 s; when the header is unreadable back off 5 s doubling to 60 s. Rig: serve 429 both with and without Access-Control-Expose-Headers: Retry-After. Polling: 2 s in the waiting/204 state and for the first 2 minutes of a pause, 10 s only after that; state the interval for every state in a table and test it in spotify_check.

### [serious] B06 'saves are queued outside the frame' contradicts 'tests/library_check.mjs passes unchanged'

**Problem.** The existing test (tests/library_check.mjs lines 30-36 and 56-57) counts onChange calls synchronously (changes === 2) and calls lib.reload() right after record/partDone, then expects everything to be in storage. With a setTimeout-queued save the listener count is 0 and reload() reads stale storage; worse, a queued save that runs after reload() (or after the planned 'storage event drops the in-memory copy') writes a null or stale cache over good data. I ran the test on the working tree: it passes today because save() is synchronous.

**Fix.** Keep library.save() synchronous (listeners included). Do the deferring in the session: it calls library.partDone / record / played from a setTimeout(0) outside the frame. If a queue is kept anyway, reload() and the storage-event handler must flush it first and the queued write must capture the object, not read the module cache later. Add the reload-after-write case to library_check.

### [serious] B03 / B09: stopping or pausing the 'self' clock breaks today's own-music mode

**Problem.** B03 has session.stop() stop the clock whenever the play screen is left, and B09 says 'when the tab is hidden the own clock pauses'. Both 'site' and 'self' are OwnClock. Today the manual clock keeps running through a visit to Setup or a tab switch (route() only cancels the frame), which is what keeps the notes in step with a record the site does not control. Pausing it loses the place for good. tests/ear_e2e.mjs also computes late = clock.at - mic.startedAt, so any later re-base of the demo clock (setRate, setLoop, a pause and resume, all of which call set()) makes that test fail although the page is right.

**Fix.** Pause on hidden and stop on leave apply to source 'site' only. For 'self' and the demo the clock keeps running while hidden and across Setup; only the frame loop stops. Add to the do-not-break list: after the demo's clock.set(at, true) nothing may call set/setRate/setLoop on that clock. Also keep today's behaviour that ?demo= with no hash opens the demo (main.js line 536 forces #/tab); the spec only covers old view hashes.

### [serious] Build order: acceptance checks and features that depend on later items; dead buttons at stop line A

**Problem.** B04's acceptance needs screens built later (#/search/test, #/liked, #/recent, and the route-token check on #/song/{md5} from B07). B06's 'row still opens the song page with its versions' needs B07. B09's count-in calls countIn() in js/parts.js, which is created in B10. B13's 'Fix it' writes the hit delay from B14. Stop line A is declared shippable after B09, but B07 puts a 'Learn' button on the song page and B08 a 'Learn this song on the site's drums' link in the Spotify dock, both pointing at #/learn, which has no screen until B12; the 28 px part strip band is also empty until B10. Between B04 and B07 the un-linked user has no way to a typed song (the old form is unreachable, the song page is not built).

**Fix.** Move each forward-looking check to the item that builds its screen (route token to B07, Liked reload to B07). Create js/parts.js with countIn() in B09 and add parts() in B10. Render entry points from a feature table (learn, results, partStrip) that an item switches on when it is green, so a stop-line ship has no dead control; add a rig check 'no link or button on any screen leads to a route without a screen'. State that B04-B07 are one unshippable block.

### [serious] B06: a song liked from Spotify can have no chart, but every row and route is addressed by md5

**Problem.** The heart on Home's Spotify bar likes the playing song 'with no extra call', and the play header heart also exists when the overlay says 'No drum part'. Such an entry has zero versions, so its Liked row has nothing to link to (#/song/{md5}), no length or tier, and a pop song with no chart at all sits in Liked forever. The acceptance 'liking it there and liking the same song from the search leave ONE row' passes while the row from Spotify alone is dead.

**Fix.** Decide one rule: on a like without versions run findCharts once through the paced queue; with a result store the slim versions, with none keep the entry flagged noChart, show it with the label 'No drum part yet' and make the row run a search for 'title artist' instead of opening a song page. Add a rig check: like from the Home bar with the chart site stubbed empty, then click the row.

### [serious] B02 rig: mechanics that give false reds and false greens

**Problem.** (1) index.html reloads the page once when the service worker first takes control (controllerchange); every rig run starts on a fresh profile, so the first scenario is reloaded mid-test and its request counts double (setBypassServiceWorker does not stop registration). (2) Page.addScriptToEvaluateOnNewDocument re-seeds localStorage on every load, so every 'still there after a reload' check (B06, B07, B12) is overwritten by the seed. (3) The default fake microphone is not silent: the README says the browser's fake mic produces hits, so any scenario with the mic on gets stray hits that score notes, complete a Teach step and feed fitDelay. (4) 'Fails on any console error' will trip on the intended 404/500/failed requests if the Log domain is used. (5) The stubbed Spotify track carries a cover URL on another host (i.scdn.co), which 'any other outside host fails the run' turns into a failure. (6) CDP has no call for a hidden tab, yet B08, B09 and B15 assert on it. (7) State leaks between scenarios (difficulty = easy, prefs.view, likes).

**Fix.** Warm up once and wait for navigator.serviceWorker.controller before the first scenario. Seed once per open (guard flag in sessionStorage or remove the script after the first load). Start Edge with --use-file-for-fake-audio-capture pointing at a silent WAV the rig writes. Count errors from Runtime.consoleAPICalled and Runtime.exceptionThrown only, with a per-scenario allow-list for stubbed failures. Use data: or files.enchor.us URLs for covers in fixtures. Give the rig a hide()/show() helper that redefines document.hidden and visibilityState and dispatches visibilitychange. Clear localStorage and sessionStorage at the start of every scenario and set the size with Emulation.setDeviceMetricsOverride.

### [serious] B14: a mic verdict accepts any sound, so 'Clean' and 'learned' can be written by noise

**Problem.** The site cannot read the sticks, and an untaught mic hit credits every note written within 130 ms of any onset; verdict() says extra hits cost nothing. Music still playing in the room (the spec itself says 'Pause Spotify if it is still playing'), the learner playing hi-hat eighths over a Bass + Snare set, or steady tapping will match most quarter notes, read 'Clean', step Auto and store a permanent 'learned' tick. The council cut F77 for exactly this reason. Also fitDelay searches -50 to +300 ms while own.micDelay is defined as 0 to 0.4 s, and nobody knows the kit speaker's real delay; a Bluetooth link above 300 ms can never be fitted.

**Fix.** Give verdict() a precision guard: when unmatched onsets in the judged stretch exceed the matched ones (or exceed half the notes), the pass reads 'Not scored: too many other sounds' and changes nothing. Require the guard to pass for a 'learned' by pass. Make the fit range and the stored range the same (for example 0 to 400 ms) and say what the UI shows when no delay in range fits after 3 passes ('Set the hit delay by hand with [ and ]').

### [minor] B02 fixtures and Spotify stub are underspecified for the numbers the checks assert

**Problem.** (1) lyricShift (js/charts.js lines 165-169) returns null unless the best shift beats every rival more than 1 s away by 2 lines; evenly spaced vocal phrases make a shift of one period fit N-1 lines, so the '+2000 ms auto' pin fails. (2) A static currently-playing body makes Follow.steady() see a seek at every poll (start moves 2 s per answer, SEEK is 2.0) and Game.update resets; B13 and B15 need a stub that advances progress with time, can pause, end and change track on command. (3) '60 s of steady play: at most 16 requests' sits exactly on the edge for a 60 s track because the spec's own last-6-seconds rule adds polls at 56, 58 and 60 s. (4) The Bridge and ugc_section_9_9 contents, the easy level, the second chart for 'Fixture B' and the LRCLIB routes (/get and /search) are not given, but parts and level checks depend on them (each kept part needs 6 s and 8 notes).

**Fix.** Write the fixture as a table in the spec: every section's notes per level, irregular phrase times (no common period), both LRCLIB routes. Make the Spotify stub a small fake player (startedAt, progress from the clock, pause, next track) and give its track a duration well over the test window, or measure the 16-request bound over a window that ends before the last 6 s.

### [minor] B09 synth numbers come from a different synth than the one being shipped

**Problem.** The target peaks, 'master gain 0.5' and 'pile under 1.0' were measured on the scout's own recipes in a Node stand-in. The repo's js/synth.js voices pile up more tightly (3.06 for the same five drums against single peaks of about 1.0, 1.1, 0.44, 0.68): trimmed to the target peaks and multiplied by 0.5 the pile is about 1.2, so the check fails before the compressor. After the compressor the numbers move again: a DynamicsCompressorNode adds make-up gain by specification (about +3 dB at threshold -6, ratio 20, knee 0), has a default knee of 30 dB that the spec does not set, and delays the signal by about 6 ms; 'kick + hi-hat under 0.6' fails there. Noise voices start at a different point of the noise buffer for each hit (synth.js line 41), so their peak varies from hit to hit.

**Fix.** State where each number is measured (the bus before the compressor). Treat the master gain as derived: render the five-drum pile in the rig's OfflineAudioContext and set the gain so it peaks at 0.9. Set knee 0 or drop the compressor for a fixed gain. Start noise at a fixed offset or widen the peak tolerance for noise voices to 25%. Assert gaps on the intended heard time (perfTime) and skip the first 0.5 s while the audio-to-performance skew settles.

### [minor] B11 step rule and B12 acceptance disagree on the fixture

**Problem.** B11: after two clean passes 'the next set that adds notes in this part comes in at the same tempo, else the tempo goes up'. The fixture's Verse 1 has only hi-hat, bass and snare, so 'all' adds nothing over '+ Hi-hat'. B12's acceptance still expects (hh, 70%) then (all, 70%), which spends two passes on an identical note set and contradicts the rule. It is also unclear whether (hh, 100%) with nothing left out counts as 'all drums' for 'learned'.

**Fix.** Define: sets are compared by the notes they give in this part; a state whose notes equal the 'all' notes is 'all'. From such a state two clean passes raise the tempo. Change the B12 expectation to (hh, 70%) then (all, 80%), or add a crash to the fixture's Verse 1.

### [minor] B14 fitDelay: two rules contradict each other and the Node acceptance

**Problem.** 'A winner at least a quarter better than any rival more than 40 ms away' and 'between equal winners the smaller delay wins' cannot both hold. On the acceptance case (pattern every 250 ms, hits 30 ms late) the rival at 280 ms matches 31 of 32 hits, so the first rule returns no answer while the acceptance expects 30 ms.

**Fix.** One rule: take every delay whose match count is within 10% of the best, choose the smallest of them, and answer only if it has 8 or more hits and 60% matched. Keep the 250 ms case and add a case where the true delay is 280 ms on a 500 ms pattern.

### [minor] B10 parts: level dependence, ids of cut pieces, the legacy learned() test

**Problem.** Folding uses drum-note counts, which differ per level, so the part list and 'n of m' change when the level changes, and a part learned on Easy shows as learned on Expert (the part record has no level). 'id = the start of the part's first raw section' gives every 8-bar piece of one long section the same id. The existing test calls partDone with no set and expects learned() true at rate 1, so set must default to 'all' and by to 'pass'.

**Fix.** Shape parts from the highest level the version has, id = the part's own start in ms (equal to the section start for uncut parts), and store level in the part record; ticks show for the current level only. Write the defaults for set and by into the library item.

### [minor] Navigation rules a developer would have to guess

**Problem.** (1) Enter in the search field is both 'search at once' and 'open the highlighted row': with stale rows on screen it would open the wrong song. (2) #/song/{md5} against entry.pick: which wins, and which md5 a search or Liked row links to when a pick exists. (3) Ctrl+Enter 'starts at once': through the Ready overlay or straight into the counted bar. (4) #/play/{md5} and #/learn/{md5} opened cold (Continue card after 'Forget my songs', a shared link) have no stated lookup; only #/song has the hash search. (5) #/play/live when Spotify is not linked. (6) 'Esc goes to the list it came from' with no history entry. (7) A tempo change in the middle of a run: label and best rule.

**Fix.** State: Enter searches when the field text differs from the query of the rows shown, otherwise opens the highlight. The address md5 wins and rows link to entry.pick when set. Ctrl+Enter skips Ready. Play and Learn routes use the same lookup chain as the song page. #/play/live unlinked shows an overlay with 'Link Spotify in Setup' and 'Play with the site's drums'. Esc navigates to a stored parent route, not history.back(). Any moment under 100% makes the run a 'Slowed run'.

### [minor] B05 / B07: 'charts.js as it is' against the changes the items need

**Problem.** searchCharts is to keep its return shape but go through slim(), which has no 'notes' field (js/library.js line 56 reads c.notes). loadChart fetches and parses in one call for one level, so 'the notes file was range-read only once' and 'changing the level reloads' cannot both hold from a parsed-chart cache. The advanced endpoint (hash lookup) was called by the scouts from Node; its CORS answer for a foreign browser origin was not shown separately from /search.

**Fix.** Keep notes in the slim record (or drop it from library.js in the same commit). Split loadChart into fetchNotesFile(md5) (bytes cached in memory per md5) and parse(bytes, level, delay). If the hash lookup fails for any reason fall back to the toast 'Search for the song again', and add one live check of POST /search/advanced with an Origin header to tests/charts_check.mjs.

### [minor] End-to-end run time against 'one sitting'

**Problem.** Loops and runs happen in real time: a pass of the 16 s fixture part at 70% is 26 s, B12's ladder and step checks need about 6 minutes, B13 needs seven or more full 60 s runs, B05 waits 30 s for the 429 case. A full app_e2e run is roughly 25 minutes, the gate asks for two in a row, and the rig is meant to stay green after every item.

**Fix.** Add a second fixture song of about 16 s with four short parts for ladder, results and bests scenarios; keep one full 60 s run. Run --only <item> plus the pin list after each item and the full suite only at the stop lines. Let the rig start several Edge processes (own profile and port each) to run item groups in parallel. Make the 30 s busy wait a constant the rig can shorten.

### [minor] B01 / B15 / B16 small facts

**Problem.** core.autocrlf is true in this repo, so a later checkout rewrites v1/ line endings and the byte-identity check fails. tests/sections_check.mjs is a live network print script with no pass or fail. 'Login valid until {date}' cannot be filled for the owner's existing login (no date stored, Spotify does not give one), and a token refresh done from v1/ rewrites spotify.tokens without scope and login date. Native dialogs do not guarantee 'Tab stays inside the dialog' in a headless browser.

**Fix.** Create v1/ with git archive or git show and add '.gitattributes: v1/** -text'. Drop sections_check from the must-pass list. Show 'Login date unknown. Logins last 6 months; link again to see the date.' and treat missing fields as unknown everywhere. Assert 'focus is inside the dialog or on the body' instead of a strict trap.

## Critic: does it give the owner what he asked for?

Revise before building. The structure is sound (rig first, play logic moved not rewritten, pure modules, stop lines) and for a keyboard player all five asks land: lookup (B05, B07), layout (B04, B08), liked (B06), Learn (B10-B12) and the finished-app pieces (B13, B16). For the player with sticks three things do not hold. (1) Blocker: mic judging on the site's own clock cannot work as specified, because js/game.js marks a note missed before a delayed mic hit arrives; B14's own acceptance cannot pass, and B14 sits after stop line B, so Learn could ship unjudged for the kit. (2) On speakers, the default, whole-song Play is unscored or silent and Learn turns have no metronome; a probe during Listen passes and counted bars fixes the default. (3) Lookup never starts the music: the Spotify hand-off is several mouse steps, matches by title only, and B15 slows the follow clock to a 5-10 s lag. Also fix: two meanings of 'accuracy', the timing 'Fix it' that sync by ear undoes, no output-delay control, repeated parts restarting the ladder, no visual spec or visual gate for 'fleshed out ui', and Spotify Liked Songs deferred on a 'proven on the kit' claim the README contradicts. Pay for these by cutting the timing sentence, the polling slowdown, the style-only checks and the row extras.

### [blocker] B14 with B11: delayed microphone hits on the site's own clock (miss finalisation in js/game.js)

**Problem.** In js\game.js, update() turns a note into 'miss' as soon as the clock is 130 ms past it and moves `cursor` on; hit() only searches from `cursor`. B14 subtracts own.micDelay from a mic hit's time, but the hit report only reaches the page micDelay plus worklet lag AFTER the stroke. With the spec's own example (140 ms) the note is already a miss when the hit arrives, so a perfectly played pass scores near 0% and B14's acceptance line ('hits 140 ms after every note ... pass 2 is judged Clean') cannot pass with the Game that B11 defines. The loop tail (150 ms real) is also shorter than micDelay plus lag, so the last note of a part is closed as missed. Under rule B01(6) the item would then be left out and the kit is never judged in Learn. Smaller: own.micDelay is '0 to 0.4 s' while fitDelay searches -50 to +300 ms; count-in clicks the mic hears count as unmatched hits against the 60% rule.

**Fix.** Specify it in B11: Game.grace (real seconds, default 0); update() and closePass finalise a miss only after 130 ms + grace. The session sets grace = micDelay + 60 ms whenever mic hits are judged on the site clock, and the Learn loop tail = max(150 ms, micDelay + 100 ms) of real time. Node cases in game_check: with grace set, a hit reported 140 ms and 250 ms after its note is 'perfect', and the last note of a part is credited before closePass. Use one range (-0.05 to 0.4 s). fitDelay ignores hits earlier than the part's first note minus 130 ms.

### [serious] Stop line B and the order of B13 and B14

**Problem.** The spec says that with B01-B12 green 'all five things the owner named work end to end'. For the person holding sticks that is not so: until B14, mic hits on the site clock only light pads, so every Learn pass reads 'not scoring: no hits heard', Auto never steps, no part gets a tick except by walking to the keyboard for G, and Play on the site's drums has no score. Learn at stop line B is a keyboard feature. B13 (results) is built before B14 although site-clock results are also empty for the kit until B14.

**Fix.** Build B14 (with the grace fix) straight after B12 and before B13, and move stop line B after it. If B14 still has to be dropped, say so in the stop-line text and in the app ('With the kit, Learn loops and counts in; tick parts with G') instead of claiming the ask is complete.

### [serious] B09/B11/B12 sound plan for a kit player on speakers (the default)

**Problem.** With the mic on and 'I'm on headphones' off (the default), whole-song Play is either unscored (Guide on, the default) or minutes of total silence after the counted bar (Guide off), and every Learn turn is silent with only a pulsing dot: slow practice with no metronome. After an unscored run B13 would show 'You watched this one. No hits were heard', which is false. The one switch that changes all this sits inside the Sound chip popover, and Guide has no key, so fixing it mid-session needs the mouse.

**Fix.** Let the site find out instead of assuming. The unjudged Listen pass and every counted bar are a free probe: if no LOUD mic onset (the mic's own hit line) falls 0-150 ms after the site's scheduled sounds, the mic does not hear the site as hits: keep the click (and the left-out drums) sounding in the turn and judge the mic; otherwise go silent as specified. Rig: micHit injected on click times gives a silent turn, none gives click on. Ask once at the first site-clock session with the mic on where the site's sound comes out. Add a key for Guide. Unscored result text: 'Guide was on, so the mic was not scored'.

### [serious] Song lookup when Spotify is linked: song page default, B15 hand-off, F45 left in 'later'

**Problem.** The ask is to find a song by typing on a site whose point is playing along with the real song. As specified, Enter-Enter on a result starts synth drums with no music. The Spotify button leads to a waiting screen, an 'Open in Spotify' SEARCH page in another tab, a click on the right track there and a tab switch back; the song is then already running and Restart is inside the More menu (mouse). The expected song is matched by artist|title, so a Spotify title that differs counts as another song. If the owner's Spotify app works at all he has Premium (Development Mode rule), and starting playback needs no new scope.

**Fix.** Tier 1 (no new scope, one call per press): GET /v1/search type=track limit=5 for 'title artist', chosen with fit() and duration. That gives the exact link open.spotify.com/track/{id}, binds pick.{id} = md5 so matching is by track id, and stores id and cover on the entry. Tier 2 behind the same button: PUT /me/player/play {uris:[uri]}; on anything but 204 fall back to the hand-off screen exactly as specified. Make Home restart the song on Spotify (existing seek) and show it in the dock. When Spotify is linked and prefs.lastStart is unset, focus 'Play along with Spotify'; label the other button 'Play with site drums (no music)'.

### [serious] B15 polling cadence on #/play/live

**Problem.** Polling drops from every 2 s to 5 s while playing and 10 s while paused or waiting. The site only reads Spotify, so the lag is felt directly: after 'Start the song in Spotify' the notes can take up to 10 s (plus chart search and load) to appear; a pause lets the notes run on for up to 5 s and pile up misses; a resume leaves them frozen for up to 10 s; a skip or seek made in Spotify shows up to 5 s late. This lands on the hand-off flow the spec makes the main Spotify entry. The quota reason is one unconfirmed forum report; the lag is certain.

**Fix.** Keep stop-on-leave, stop-when-hidden, invalid_grant and QUOTA_EXCEEDED handling. Change the cadence only where it costs nothing: 2 s while waiting or paused for the first 3 minutes on a visible play screen (then 5 s, then 10 s), 3-4 s while playing steadily, and ask at once (at most once a second) on window focus, visibilitychange and any key or pointer event on the play screen. Rig lines: a stubbed pause is followed within 4 s; a song started while waiting is loaded within 3 s of the stub changing.

### [serious] B08/B11/B13: two different numbers both shown as a percentage

**Problem.** Game.accuracy in js\game.js is the share of POINTS (perfect 100, good 70, ok 40, wrong 20) and library.grade() grades that. The Learn verdict, 'Finished: 87% of the notes hit', the part bars and 'Weakest: Bridge, 54%' are the share of NOTES hit. A mic player, whose hits arrive with jitter, can hit every note 'good' or 'ok': strip 55%, grade D, and every part bar at 100% in the same dialog. The rig only tries 'perfect' and 'skip', so it cannot see this. The 85% rule for 'Learn {part}' and the S-D ladder then mean different things.

**Fix.** One headline number everywhere: share of notes hit, used for the big strip number, the grade, part bars, verdicts and bests. Timing goes on a second line ('Timing: 62% perfect, 30% good, 8% ok'). Leave Game.accuracy and library.grade() as they are for the existing tests and hand grade() the hit share. Rig case: robot late:100 over the whole fixture gives 100% hit, full part bars and a timing line saying 'ok'.

### [serious] B13 timing sentence and 'Fix it'

**Problem.** It fires only on microphone runs. On a followed song the mic also drives the line-up by ear, which in js\main.js (byEar -> setFine(delay, 'ear')) already holds the notes within a few ms of the music the mic hears and overwrites any tuning within 0.15 s of it after two readings. So 'That is probably the sync, not you' is wrong exactly when by-ear is active (a constant lean is then the player or the kit's own latency), and 'Fix it' through setFine is undone a few seconds into the next play although the rig line ('moves #offset by 40 ms') passes.

**Fix.** Cheapest: cut the sentence and the button from this version. If kept: show the 'probably the sync' wording and Fix it only when the line-up is NOT by ear (auto, saved, not synced); when it is by ear say only 'You were about 40 ms late on average'. A constant mic lean belongs in one setup-wide hit delay applied to mic hits on every source, not in the per-song sync.

### [serious] Site-clock sound: no control for output delay (B09, B14)

**Problem.** On the site clock game.offset is fixed at 0, sync by ear is off, and [ ] is reused for the mic hit delay and hidden with the mic off. The scouts found the reported output latency cannot be trusted over Bluetooth (wrong by 100-300 ms). A PC playing through a wireless speaker or headset then sounds the guide and click that much after the notes cross the line, in Listen passes, in Play and for keyboard players, and there is nothing to turn.

**Fix.** Add own.outDelay (ms, default 0, -100 to 400): the session draws and judges at clock.position(t - outDelay), or the scheduler places sounds that much earlier with a longer look-ahead. Sound chip: 'Sound late or early: - +' next to Test sound, with a pad flashing on each test beat so it can be set by eye and ear; stored in the backup. On the site clock with the mic off, [ ] nudge this. Rig: with outDelay 100 the sound log's audio times lead the note times by 100 ms.

### [serious] 'liked': Spotify's Liked Songs left out (F41), and the reason given

**Problem.** On a Spotify-driven site 'liked' can as easily mean Spotify's Liked Songs as a new list, and the brief asked to consider it. build_now fills the list one song at a time. The deferral rests on 'the only path proven on the real kit', but README.md says scoring was only tested with a fake microphone and the line-up by ear not yet in a room, and the project notes list the live Spotify login as untested: nothing is proven on the kit. An opt-in import does not touch the stored tokens unless the owner presses it.

**Fix.** Add a small, droppable last item after B15: a button on the Liked tab 'Show my Spotify Liked Songs'. Only that button asks for the extra scope user-library-read (login() takes a scope list; tokens are replaced only on a successful return). One GET /v1/me/tracks?limit=50 per press ('50 more'), kept slim in localStorage (id, title, artist, cover). A row click runs the normal lookup like a starter item, so no chart request is spent before that. A 403 reads 'Link again to allow Liked Songs'. If it is still left out, say so on the Liked tab instead of staying silent.

### [serious] B12 start state for parts that repeat (Chorus 1, 2, 3...)

**Problem.** Every part never tried starts from practice.startState: 70% and usually Bass + Snare. Songs repeat: the scouts' Everlong chart has 14 parts made of 4 patterns. Hands-free, each part needs a Listen pass and about 11 judged passes (two clean per step from Bass + Snare at 70% to all drums at 100%), roughly 5 minutes for a perfect player, so over an hour for the song, most of it re-climbing the ladder for a chorus already learned. F77 (auto-ticking families) was rightly cut, but nothing took its place.

**Fix.** Inherit the START only, never the tick: when a part has no stored state and another part of the same version with the same cleaned name stem (name minus number, letter suffix and '(2)') is learned, start at that part's clean drums and tempo, skip the automatic Listen pass and say 'Same as Chorus 1? Starting at 100%'. One clean pass then ticks it honestly; two passes under 60% step down as usual. A pure rule in practice.js with a table test.

### [serious] 'fleshed out ui': no visual specification and no visual acceptance

**Problem.** The spec fixes heights, routes and states but not how anything looks: no colour and type tokens, no component set (button, chip, popover, dialog, row, tile, toast, segmented control) with hover, focus, pressed and disabled states, no icons (heart, play, mic), no favicon. Acceptance only checks 'not blank' and 'no sideways scroll', so an unstyled page passes. 'Nobody can look before this ships' is given as a reason, but the builder can read the rig's screenshots; what nobody can do is hear or drum.

**Fix.** Add a short design section to B04: tokens taken from today's css/style.css and the kit's LED colours, one component sheet, inline SVG icons, focus ring, reduced-motion rule, favicon and theme-color. Add a visual gate to B04-B08, B12, B13 and B16: the builder opens every screenshot (1280x800 and 375x812; empty, loading, filled and error states) and checks a written list: nothing overlaps or is clipped, contrast, one primary action per screen, focus visible, long titles ellipsed, popovers inside the window.

### [serious] Sound, hit delay and Spotify ship untried, and the owner has no way to report what happened

**Problem.** B09 (synth), B14 (hit delay) and B15 (Spotify) are tested against stand-ins only, and per the README even today's mic scoring has not met a real room. The owner is the test, but the spec gives him only a 'not yet tried' line. When something is off he can only say it does not work, and the builder gets no numbers. B16's 'Not verified' list also leaves out mic scoring and sync by ear in a real room.

**Fix.** Setup gets 'Check my setup' (lines that turn green: test sound played, mic heard a hit, hit delay found, Spotify answered) and 'Copy report': version, browser, prefs, own.micDelay and the last fits with their counts, mic threshold, last 20 pass verdicts, sound.dropped, output latency, last Spotify statuses and reasons, last errors; never tokens or the client ID. README gets a ten-minute first-session script for the real kit. Add mic scoring and by-ear in a room to 'Not verified'.

### [minor] Spotify plays a song the site cannot match: lookup does not help

**Problem.** 'No drum part for {song}' offers 'Find another song'. If the chart exists under another spelling, the user finds it by lookup and presses 'Play along with Spotify', and the hand-off compares artist|title again: 'Spotify is playing X. Following that.' and then No drum part again. A loop with no exit.

**Fix.** On #/play/live, when an expectation is set and a different or unmatched track is playing, offer 'Use {expected title}'s drum part for this track': it stores pick.{spotify id} = md5 and the slim version on the entry. The Spotify search step in the lookup fix makes the match by track id in the other direction.

### [minor] Progress data: level missing from part keys, nothing can be undone or removed

**Problem.** Parts are stored under md5|partId while the level is one global setting and bests are per md5|level: a part ticked on Easy shows as learned on Expert. A judged tick cannot be removed (only marks by hand have Undo), a song cannot be taken out of Recent, and one song's progress cannot be reset; only 'Forget my songs' for everything. 300 unliked songs are kept although Recent shows 30.

**Fix.** Key parts md5|level|partId now (the key has never shipped; later it is a migration). Song page: 'Reset progress for this song' and 'Not learned' on a part row. Recent rows: 'Remove' (library.forget already exists). Cap unliked songs at 100.

### [minor] Screens and moments the spec does not define

**Problem.** (a) #/learn/{md5} when every part is already learned, or with a part id that does not exist. (b) #/play/live opened with Spotify not linked. (c) The play screen under 900 px. (d) A Spotify song with no chart filed in Recent or liked from the Home bar: a row that opens to nothing. (e) The run card after a followed song and the Undo toasts have no key, so they need the mouse. (f) Whether Left and Right in Learn step through learned parts too.

**Fix.** (a) Show the 'All parts learned' overlay with 'Play the whole song' and the part list to practise again; an unknown id falls back to the first unlearned part with a toast. (b) Overlay 'Spotify is not linked' with Setup and 'Find a song'. (c) Below 900 px the chips fold into More and the dock wraps; never a broken header. (d) File only songs with at least one version; a liked song without a chart shows 'No drum part yet' and 'Look again'. (e) On #/play/live Enter opens Details; G pressed again undoes a hand mark. (f) Yes, all parts.

### [minor] B12/B14: Auto blames the player when the hit delay is wrong

**Problem.** Once own.micDelay is fitted it is trusted for good. If the fit landed a beat division off, or the mic or speaker moved, passes score under 60% although the learner is playing, Auto drops the tempo towards 50% and says 'Again'. The 'lots of hits, few on the notes' guard exists only in B13's results, not in Learn.

**Fix.** Apply the same guard per Learn pass: under 30% matched with at least half as many unmatched hits as notes means no verdict and no step; run fitDelay again on that pass and say 'Re-checking your kit's delay'. A new value replaces the stored one only when two passes agree within 20 ms.

### [minor] B06 'saves are queued outside the frame' against the unchanged library test

**Problem.** tests\library_check.mjs writes, calls lib.reload() and reads back at once, and counts onChange calls synchronously. A save deferred with setTimeout makes 'it all survives a reload' fail, and a like made just before the tab closes can be lost.

**Fix.** Queue only the storage write: listeners still fire at once, and reload() plus a pagehide/visibilitychange handler flush the pending write. Say so in B06.

### [minor] Small things a finished app has

**Problem.** The mic is off again on every visit. Nothing tells the returning owner what changed or where the five pages went. The artist name is not a link to that artist's songs. A starter-list click only fills the search box instead of opening the song. 'Title artist' queries (starter list, hand-off, what people type) get no exact-match boost, so a cover can rank first. An untaught mic credits every drum written at a moment, so a 'learned' tick certifies the rhythm only and nothing says so.

**Fix.** prefs.micOn: turn the mic on at the first Enter when permission is already granted. A one-time toast 'New: search, Liked, Learn. The five pages are now the view switch (V)'. Artist links to #/search/{artist}. A starter click opens the song page when title and artist both match one song, else shows results. Rank a song first when the query's words equal its title plus artist words. In Learn with an untaught mic, one line on Ready: 'Teach your drums in Setup to have the right drum checked too'.

### [minor] Parts of build_now that cost more than they give

**Problem.** B13's timing sentence and Fix it, and B15's slower polling (both above). B03's acceptance by grep ('no document.getElementById in session.js') and the MutationObserver write count test style, not behaviour. B05's 56 px row carries a busy word, four dots, two badges, a caution label, version count, grade, heart and play button, plus a tooltip nobody at a drum kit will hover.

**Fix.** Drop or shrink these and spend the time on the blocker and on the sound and Spotify items: session.js is proven by the pin list alone; rows show title, artist, length, one badge, heart and play, with the rest on the song page.
