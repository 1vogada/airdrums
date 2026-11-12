// The site's own clock: tempo, looping, the count of passes, and the stretches sounds are scheduled from.
//   node tests/clock_check.mjs
import { OwnClock, RATES } from '../js/clock.js';

let fake = 100;                                             // seconds; time only moves when the test says so
let reads = 0;                                              // how often the clock looked at the timer
globalThis.performance = { now: () => { reads++; return fake * 1000; } };

let failed = 0;
const near = (a, b, by = 1e-6) => Math.abs(a - b) < by;
function check(what, ok, got) {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : `: got ${JSON.stringify(got)}`}`);
}
// a random number generator that gives the same numbers every run
function seeded(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

// ---- the basics ----------------------------------------------------------------------------------------------------
{
  const c = new OwnClock({});
  check('it says what it is and what it can do', c.kind === 'own' && c.can.rate === true && c.can.loop === true && c.can.seek === true && c.can.sound === true, [c.kind, c.can]);
  check('stands still until started', near(c.position(), 0) && !c.playing);
  c.play();
  fake += 4;
  check('runs at the song\'s tempo', near(c.position(), 4), c.position());
  c.setRate(0.5);
  fake += 4;
  check('half tempo: 4 s is 2 s of song', near(c.position(), 6), c.position());
  c.pause();
  fake += 10;
  check('paused: stays put', near(c.position(), 6), c.position());

  c.setRate(1);
  c.setLoop(10, 14);
  check('a loop elsewhere starts the song at its beginning', near(c.position(), 10), c.position());
  c.play();
  fake += 3;
  check('inside the loop', near(c.position(), 13) && c.lap() === 0, [c.position(), c.lap()]);
  fake += 2;
  check('comes round after its end', near(c.position(), 11) && c.lap() === 1, [c.position(), c.lap()]);
  fake += 8;
  check('and again', near(c.position(), 11) && c.lap() === 3, [c.position(), c.lap()]);

  // the count of passes: starting, stopping and the tempo keep it; putting the song somewhere starts it over
  const epoch = c.epoch;
  c.pause();
  check('the count of passes is kept by pause()', c.lap() === 3 && near(c.position(), 11), [c.lap(), c.position()]);
  fake += 30;
  c.play();
  check('... by play()', c.lap() === 3 && near(c.position(), 11), [c.lap(), c.position()]);
  c.toggle(); c.toggle();
  check('... by toggle() twice', c.lap() === 3 && c.playing, c.lap());
  c.setRate(0.5);
  check('... by a change of tempo', c.lap() === 3 && near(c.position(), 11), [c.lap(), c.position()]);
  fake += 6;                                                 // 3 s of song: 11 -> 14 = the loop's end
  check('and it goes on counting afterwards', c.lap() === 4 && near(c.position(), 10), [c.lap(), c.position()]);
  check('none of those put the song somewhere (epoch)', c.epoch === epoch, [epoch, c.epoch]);
  fake += 1;
  check('lapStart() is the moment the loop last came round', near(c.lapStart(), fake - 1), [c.lapStart(), fake - 1]);
  c.setRate(1);

  c.seekTo(13.5);
  check('a jump starts the count over', c.lap() === 0 && c.epoch === epoch + 1 && near(c.position(), 13.5), [c.lap(), c.epoch - epoch]);
  check('lapStart() in the first lap is the moment the song was put there', near(c.lapStart(), fake), [c.lapStart(), fake]);
  c.setRate(0.5);
  const spans = c.span(fake, fake + 3);                      // 1.5 s of song from 13.5: to 14, then 10 to 11
  check('a stretch over the loop end splits in two', spans.length === 2
    && near(spans[0].from, 13.5) && spans[0].to === 14 && spans[0].at === fake
    && spans[1].from === 10 && near(spans[1].to, 11) && near(spans[1].at, fake + 1), spans);
  check('nothing to schedule when paused', (c.pause(), c.span(fake, fake + 1).length === 0));

  c.clearLoop();
  check('clearing the loop keeps the place', near(c.position(), 13.5), c.position());
  c.setLoop(12, 20);
  check('a loop around where the song is keeps the place', near(c.position(), 13.5), c.position());
  check('a loop too short to be one is no loop', c.setLoop(5, 5.1) === false && c.loop === null, c.loop);
  check('a loop without an end, or backwards, is no loop and says so', c.setLoop(5, undefined) === false && c.setLoop(14, 10) === false && c.loop === null, c.loop);
  check('a real loop says so', c.setLoop(10, 14) === true);
  c.setRate(NaN); c.setRate(undefined); c.seekTo(NaN); c.set(undefined, true); c.cue(NaN, 1);
  check('a tempo or a place that is no number is ignored', c.rate === 0.5 && Number.isFinite(c.position()) && !c.playing, [c.rate, c.position()]);
}

// ---- the scene from the review: every way the count of passes could be lost ----------------------------------------
{
  fake = 500;
  const c = new OwnClock({});
  const seen = [];
  c.setLoop(10, 14);
  c.play();
  fake += 9; seen.push(c.lap());                             // 2
  c.pause(); seen.push(c.lap());                             // 2
  c.play(); fake += 4; seen.push(c.lap());                   // 3
  c.setRate(0.5); seen.push(c.lap());                        // 3
  fake += 8; seen.push(c.lap());                             // 4
  c.seekTo(12); seen.push(c.lap());                          // 0
  fake += 8; seen.push(c.lap());                             // 12 + 4 = 16: once round
  c.setLoop(20, 24); seen.push(c.lap());                     // 0
  c.clearLoop(); seen.push(c.lap());                         // 0
  check('9 s | pause | play 4 s | half tempo | 8 s | seek | 8 s | another loop | no loop', seen.join(' ') === '2 2 3 3 4 0 1 0 0', seen);

  // the detector the session uses, through a busy scene: it must see every real wrap and nothing else
  fake = 900;
  const d = new OwnClock({});
  d.setLoop(10, 14);
  d.play();
  let seenEpoch = d.epoch, seenLap = d.lap(), wraps = 0, real = 0, lastPos = d.position();
  const rnd = seeded(7);
  for (let i = 0; i < 40000; i++) {
    fake += (4 + Math.floor(rnd() * 30)) / 1000;
    const roll = rnd();
    let put = false;
    if (roll < 0.002) { d.pause(); fake += 0.5; d.play(); }
    else if (roll < 0.004) d.setRate(RATES[Math.floor(rnd() * RATES.length)]);
    else if (roll < 0.005) { d.seekTo(10 + rnd() * 3.9); put = true; }
    else if (roll < 0.006) { d.setLoop(10, 14); d.play(); d.setRate(d.rate); }   // calls that change nothing
    const lap = d.lap();
    const pos = d.position();
    if (!put && pos < lastPos - 1) real++;                   // the place fell back: the loop really came round
    lastPos = pos;
    if (d.epoch !== seenEpoch) { seenEpoch = d.epoch; seenLap = lap; }
    else if (lap > seenLap) { wraps += lap - seenLap; seenLap = lap; }
  }
  check(`the session's detector sees every wrap and nothing else (${real} wraps, pauses, tempo changes and jumps in between)`, wraps === real && real > 100, [wraps, real]);
}

// ---- calls that change nothing ------------------------------------------------------------------------------------
{
  fake = 2000;
  const c = new OwnClock({});
  c.setLoop(10, 14);
  c.play();
  fake += 9;
  const before = [c.at, c.moved, c.epoch, c.lap(), c.position()];
  c.play(); c.setRate(1); c.setLoop(10, 14);
  const after = [c.at, c.moved, c.epoch, c.lap(), c.position()];
  check('play() while playing, the same tempo and the same loop change nothing at all', before.join() === after.join(), [before, after]);
  c.pause();
  const paused = [c.at, c.moved];
  c.pause(); c.stop();
  check('pause() and stop() while paused change nothing', paused.join() === [c.at, c.moved].join());
  const d = new OwnClock({});
  const still = [d.at, d.moved];
  fake += 1;
  d.clearLoop();
  check('clearLoop() without a loop changes nothing', still.join() === [d.at, d.moved].join());

  // every change reads the timer once, so the place cannot slip between two readings
  const e = new OwnClock({});
  const counts = [];
  for (const call of [() => e.play(), () => e.setRate(0.7), () => e.setLoop(3, 9), () => e.seekTo(4), () => e.toggle(), () => e.toggle(),
    () => e.set(5, true), () => e.cue(3, 0.2), () => e.clearLoop(), () => e.pause()]) {
    const r = reads;
    call();
    counts.push(reads - r);
  }
  check('every change reads the timer exactly once', counts.every((n) => n === 1), counts);
}

// ---- before 0:00 --------------------------------------------------------------------------------------------------
{
  fake = 3000;
  const c = new OwnClock({});
  c.setLoop(-2, 8);
  check('a loop may start before 0:00 (the song, standing at 0:00 inside it, stays there)', c.loop.from === -2 && c.position() === 0, [c.loop, c.position()]);
  c.seekTo(-2);
  check('and the song can be put on its start', c.position() === -2, c.position());
  c.play();
  const s = c.span(fake + 1.5, fake + 2.5);
  check('the song runs through 0:00 in one piece', s.length === 1 && near(s[0].from, -0.5) && near(s[0].to, 0.5), s);
  fake += 11;
  check('and comes round to before 0:00 again', near(c.position(), -1) && c.lap() === 1, [c.position(), c.lap()]);
  c.seekTo(-5);
  check('a jump stops at the start of such a loop', c.position() === -2, c.position());
  c.clearLoop();
  c.seekTo(-5);
  check('without a loop a jump stops at 0:00', c.position() === 0, c.position());
  c.setLoop(10, 14);
  c.seekTo(-1);
  check('with a loop that starts later it stops at 0:00 too', c.position() === 0, c.position());
  c.seekTo(20);
  check('a jump past the loop\'s end lands inside it, with the count at 0', near(c.position(), 12) && c.lap() === 0, [c.position(), c.lap()]);

  // the start of a pass: a lead in real time before the place, at any tempo, with no lower limit
  c.setLoop(-2, 8);
  c.setRate(0.5);
  c.cue(-2, 0.25);
  check('cue() puts the song a lead of real time before the place', near(c.position(), -2.125) && c.lap() === 0, c.position());
  const lead = c.span(fake, fake + 0.5);
  check('and the first sound of the pass is then 0.25 s away', lead.length === 1 && near(lead[0].at + (-2 - lead[0].from) / c.rate, fake + 0.25), lead);
  fake += 0.25 + 10 / 0.5 - 0.001;
  const end = [c.lap(), c.position()];
  fake += 0.002;
  check('the lead is played once: after it the loop comes round to its own start', end[0] === 0 && near(end[1], 7.9995) && c.lap() === 1 && near(c.position(), -1.9995), [end, c.lap(), c.position()]);
}

// ---- stretches meet exactly ----------------------------------------------------------------------------------------
// Frames on whole milliseconds, a look-ahead of 140 ms, notes on whole milliseconds: the worst case for rounding.
function tiles(rate, from, to, seed) {
  fake = 4000;
  const c = new OwnClock({});
  if (to !== null) c.setLoop(from, to);
  c.setRate(rate);
  c.play();
  const rnd = seeded(seed);
  let exact = 0, gap = 0, overlap = 0, bad = 0, prev = null, until = fake, ms = Math.round(fake * 1000);
  for (let i = 0; i < 10000; i++) {
    ms += 4 + Math.floor(rnd() * 37);
    const next = ms / 1000 + 0.14;
    const s = c.span(until, next);
    until = next;
    for (let j = 0; j < s.length; j++) {
      const piece = s[j];
      if (!(piece.to > piece.from)) bad++;                                  // empty or backwards
      if (to !== null && (piece.from < Math.min(from, 0) || piece.to > to)) bad++;
      if (j && !(s[j - 1].to === to && piece.from === from)) bad++;         // inside one answer only the loop's end may separate two
    }
    if (s.length) {
      if (prev) {
        if (s[0].from === prev.to || (prev.to === to && s[0].from === from)) exact++;
        else if (s[0].from > prev.to) gap++;
        else overlap++;
      }
      prev = { to: s[s.length - 1].to };
    }
  }
  return { exact, gap, overlap, bad };
}
{
  const cases = [];
  for (const rate of RATES) {
    for (const [from, to] of [[10, 14], [61.3713, 75.9127], [30, 30.25], [0.3, 1.1], [-2, 8.15], [0, null]]) cases.push([rate, from, to]);
  }
  let worst = null;
  for (const [rate, from, to] of cases) {
    const r = tiles(rate, from, to, 11 + cases.length);
    if (r.gap || r.overlap || r.bad || r.exact !== 9999) worst = { rate, from, to, ...r };
  }
  check(`stretches asked one after the other meet on the same number (${cases.length} cases of 10 000 frames, tempo 50 to 100%)`, worst === null, worst);
}

// The same, counted in notes: every note on a whole millisecond is asked exactly once a lap.
{
  let wrong = null, asked = 0;
  for (const rate of RATES) {
    for (const [from, to, step] of [[10, 14, 0.125], [30, 30.25, 0.05], [-2, 8.15, 0.25], [8, 12.6, 0.1]]) {
      fake = 6000;
      const c = new OwnClock({});
      c.setLoop(from, to);
      c.seekTo(from);
      c.setRate(rate);
      c.play();
      const notes = [];
      for (let i = 0; from + i * step <= to + 1e-9; i++) notes.push(Math.round((from + i * step) * 1000) / 1000);   // the last one sits on loop.to
      const count = new Map();                                             // "lap|note" -> times asked
      const rnd = seeded(5);
      let until = fake, ms = Math.round(fake * 1000);
      const laps = 300;
      while (c.lap(until) < laps) {
        ms += 4 + Math.floor(rnd() * 37);
        const next = ms / 1000 + 0.14;
        for (const s of c.span(until, next)) {
          const lap = c.lap(s.at + (s.to - s.from) / c.rate / 2);          // the lap in the middle of this stretch
          for (const n of notes) if (n >= s.from && n < s.to) { const k = `${lap}|${n}`; count.set(k, (count.get(k) || 0) + 1); asked++; }
        }
        until = next;
      }
      for (let lap = 0; lap < laps; lap++) {
        for (const n of notes) {
          const times = count.get(`${lap}|${n}`) || 0;
          const want = n === to ? 0 : 1;                                   // a note on loop.to belongs to what comes after the loop
          if (times !== want && !wrong) wrong = { rate, from, to, lap, note: n, times };
        }
      }
    }
  }
  check(`every note is asked once a lap and the one on the loop's end never (${asked} asks over 300 laps, 24 cases)`, wrong === null, wrong);
}

// A stretch that ends a hair after the loop came round still holds the loop's first instant.
{
  fake = 7000;
  const c = new OwnClock({});
  c.setLoop(10, 14);
  c.play();
  const a = c.span(fake + 3.9, fake + 4 + 5e-10);
  const b = c.span(fake + 4 + 5e-10, fake + 4.1);
  const has = (list, x) => list.filter((s) => x >= s.from && x < s.to).length;
  check('a stretch ending within a nanosecond after the wrap holds the loop\'s first instant', has(a, 10) === 1 && has(b, 10) === 0, [a, b]);
  const d = c.span(fake + 3.9, fake + 4);
  const e = c.span(fake + 4, fake + 4.1);
  check('one ending exactly on the wrap leaves it to the next', has(d, 10) + has(e, 10) === 1 && has(d, 14) + has(e, 14) === 0, [d, e]);
  check('the first stretch starts at the moment asked for', a[0].at === fake + 3.9 && near(a[1].at, fake + 4, 1e-9), a);
  const many = c.span(fake, fake + 4 * 50 + 1);
  check('a long span gives every lap', many.length === 51 && many.every((s, i) => i === 50 || (s.from === 10 && s.to === 14)), many.length);
}

// ---- hours of looping ---------------------------------------------------------------------------------------------
{
  fake = 0;
  const c = new OwnClock({});
  c.setLoop(10, 14);
  c.setRate(0.5);
  c.play();
  const rnd = seeded(3);
  let worst = 0, outside = 0, wrongLap = 0;
  for (let i = 0; i < 20000; i++) {
    const ms = Math.floor(rnd() * 36000000);                 // some moment in ten hours, on a whole millisecond
    const raw = 10000 + ms * 0.5;                            // song time in thousandths: exact whole numbers from here
    const want = raw < 14000 ? raw : 10000 + ((raw - 10000) % 4000);
    const lap = raw < 14000 ? 0 : Math.floor((raw - 10000) / 4000);
    const p = c.position(ms / 1000);
    worst = Math.max(worst, Math.abs(p - want / 1000));
    if (p < 10 || p >= 14) outside++;
    if (c.lap(ms / 1000) !== lap) wrongLap++;
  }
  check(`ten hours round a loop: the place is right to a billionth of a second and never outside the loop (worst ${worst.toExponential(1)} s)`, worst < 1e-9 && outside === 0 && wrongLap === 0, [worst, outside, wrongLap]);

  // a busy hour: tempo changes, pauses and the loop set again must not move the place
  fake = 100;
  const d = new OwnClock({});
  d.setLoop(10, 14);
  d.play();
  let song = 0;                                              // seconds of song that really went by
  const r2 = seeded(9);
  for (let i = 0; i < 6000; i++) {
    const dt = Math.floor(r2() * 1200) / 1000;
    fake += dt;
    if (d.playing) song += dt * d.rate;
    const roll = r2();
    if (roll < 0.3) d.setRate(RATES[Math.floor(r2() * RATES.length)]);
    else if (roll < 0.4) d.toggle();
    else if (roll < 0.5) d.setLoop(10, 14);
  }
  const want = 10 + (song % 4);
  check('an hour of tempo changes and pauses does not move the place', near(d.position(), want, 1e-7) && d.lap() === Math.floor(song / 4), [d.position(), want, d.lap(), Math.floor(song / 4)]);
}

console.log(failed ? `${failed} FAILED` : 'the clock is right');
process.exitCode = failed ? 1 : 0;
