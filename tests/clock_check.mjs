// The site's own clock: tempo, looping, and the stretches sounds are scheduled from.
//   node tests/clock_check.mjs
import { OwnClock } from '../js/clock.js';

let fake = 100;
globalThis.performance = { now: () => fake * 1000 };       // time only moves when the test says so

let failed = 0;
const near = (a, b) => Math.abs(a - b) < 1e-6;
function check(what, ok, got) {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : `: got ${JSON.stringify(got)}`}`);
}

const c = new OwnClock({});
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

c.seekTo(13.5);
c.setRate(0.5);
const spans = c.span(fake, fake + 3);                        // 1.5 s of song from 13.5: to 14, then 10 to 11
check('a stretch over the loop end splits in two', spans.length === 2
  && near(spans[0].from, 13.5) && near(spans[0].to, 14) && near(spans[0].at, fake)
  && near(spans[1].from, 10) && near(spans[1].to, 11) && near(spans[1].at, fake + 1), spans);
check('nothing to schedule when paused', (c.pause(), c.span(fake, fake + 1).length === 0));

c.clearLoop();
check('clearing the loop keeps the place', near(c.position(), 13.5), c.position());
c.setLoop(12, 20);
check('a loop around where the song is keeps the place', near(c.position(), 13.5), c.position());
c.setLoop(5, 5.1);
check('a loop too short to be one is no loop', c.loop === null, c.loop);

console.log(failed ? `${failed} FAILED` : 'the clock is right');
process.exitCode = failed ? 1 : 0;
