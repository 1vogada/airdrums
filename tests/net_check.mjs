// The paced line to the chart site: spacing, one at a time, calling off, second tries, the 30 s wait.
//   node tests/net_check.mjs
// Nothing here touches the network or waits real seconds: the queue gets a
// made-up chart site and a clock that is moved forward by hand.
import { createQueue, post, chartSite, API, isAbort } from '../js/net.js';

let failed = 0;
function check(what, ok, got) {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : `: got ${JSON.stringify(got)}`}`);
}

const settle = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r)); };

// A clock that only moves when told to; timers fire in order as it passes them.
function fakeClock() {
  let now = 0, seq = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { id, at: now + Math.max(0, ms), fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async advance(ms) {
      const end = now + ms;
      await settle();
      for (;;) {
        let next = null;
        for (const t of timers.values()) {
          if (t.at <= end && (!next || t.at < next.at || (t.at === next.at && t.id < next.id))) next = t;
        }
        if (!next) break;
        timers.delete(next.id);
        now = next.at;
        next.fn();
        await settle();
      }
      now = end;
      await settle();
    },
  };
}

// A made-up chart site. plan(n, url, init) says how request number n is answered:
// { status, body, after: ms, error: true (no connection), hang: true (never answers) }.
function fakeSite(clock, plan = () => ({})) {
  const log = [];
  let flying = 0, most = 0;
  const fetch = (url, init = {}) => new Promise((resolve, reject) => {
    const n = log.length;
    const entry = { n, at: clock.now(), url, body: init.body, aborted: false, open: true };
    log.push(entry);
    flying++;
    most = Math.max(most, flying);
    const how = plan(n, url, init) || {};
    const close = (then) => { if (entry.open) { entry.open = false; flying--; then(); } };
    init.signal?.addEventListener('abort', () => close(() => {
      entry.aborted = true;
      const e = new Error('aborted');
      e.name = 'AbortError';
      reject(e);
    }));
    if (how.hang) return;
    const answer = () => close(() => {
      if (how.error) reject(new TypeError('fetch failed'));
      else resolve({ status: how.status ?? 201, json: async () => how.body ?? { answer: n } });
    });
    if (how.after) clock.setTimeout(answer, how.after); else answer();
  });
  return { fetch, log, times: () => log.map((e) => e.at), most: () => most };
}

function rig(plan, options = {}) {
  const clock = fakeClock();
  const site = fakeSite(clock, plan);
  const queue = createQueue({ fetch: site.fetch, now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, ...options });
  return { clock, site, queue };
}

// What became of a call: { value } or { error }, once it is over.
function watch(promise) {
  const seen = { over: false };
  promise.then((value) => { seen.over = true; seen.value = value; }, (error) => { seen.over = true; seen.error = error; });
  return seen;
}
const gaps = (times) => times.slice(1).map((t, i) => t - times[i]);

// ---- spacing and one at a time ----------------------------------------------
{
  const { clock, site, queue } = rig();
  const calls = [1, 2, 3, 4, 5].map((i) => watch(queue.send(`u${i}`)));
  await clock.advance(10000);
  check('five calls at once leave 700 ms apart', site.times().join() === '0,700,1400,2100,2800', site.times());
  check('...in the order they were made, each with its own answer',
    site.log.map((e) => e.url).join() === 'u1,u2,u3,u4,u5' && calls.every((c, i) => c.value?.answer === i), calls);
}
{
  const { clock, site, queue } = rig(() => ({ after: 1000 }));
  const calls = [1, 2, 3].map((i) => watch(queue.send(`u${i}`)));
  await clock.advance(10000);
  check('a slow site: the next request waits for the answer before it', site.times().join() === '0,1000,2000', site.times());
  check('...so only one request is ever in the air', site.most() === 1 && calls.every((c) => c.value), site.most());
}
{
  const { clock, site, queue } = rig(() => ({ after: 300 }));
  for (let i = 0; i < 20; i++) queue.send(`u${i}`).catch(() => {});
  await clock.advance(60000);
  check('20 calls in a burst: all sent, never two closer than 700 ms, never two in the air',
    site.log.length === 20 && Math.min(...gaps(site.times())) >= 700 && site.most() === 1, [site.log.length, Math.min(...gaps(site.times())), site.most()]);
}
{
  const { clock, site, queue } = rig();
  queue.send('first');
  await clock.advance(5000);
  queue.send('later');
  await clock.advance(0);
  check('after a quiet spell a call leaves at once', site.times().join() === '0,5000', site.times());
}

// ---- calling off --------------------------------------------------------------
{
  // search as you type: each new search calls the one before it off
  const { clock, site, queue } = rig(() => ({ after: 400 }));
  const calls = [];
  let last = null;
  for (let i = 0; i < 20; i++) {
    last?.abort();
    last = new AbortController();
    calls.push(watch(queue.send(`type${i}`, { signal: last.signal })));
  }
  await clock.advance(10000);
  check('20 searches in one burst, each calling off the one before: two requests, 700 ms apart',
    site.log.map((e) => e.url).join() === 'type0,type19' && site.times().join() === '0,700', site.log.map((e) => [e.url, e.at]));
  check('...the first was cut off in the air, the last one answered',
    site.log[0].aborted && Boolean(calls[19].value) && calls.slice(0, 19).every((c) => isAbort(c.error)), calls.map((c) => c.error?.name || 'answered'));
}
{
  const { clock, site, queue } = rig(() => ({ after: 400 }));
  const calls = [];
  let last = null;
  for (let i = 0; i < 20; i++) {
    last?.abort();
    last = new AbortController();
    calls.push(watch(queue.send(`type${i}`, { signal: last.signal })));
    await clock.advance(50);
  }
  await clock.advance(10000);
  check('20 searches typed 50 ms apart with no pause before searching: still never two requests closer than 700 ms',
    site.log.length <= 3 && Math.min(...gaps(site.times())) >= 700 && site.most() === 1 && Boolean(calls[19].value)
    && site.log[site.log.length - 1].url === 'type19', site.log.map((e) => [e.url, e.at]));
}
{
  const { clock, site, queue } = rig();
  const gone = new AbortController();
  gone.abort();
  const dead = watch(queue.send('dead', { signal: gone.signal }));
  queue.send('a');
  const ac = new AbortController();
  const b = watch(queue.send('b', { signal: ac.signal }));
  const c = watch(queue.send('c'));
  await clock.advance(100);
  ac.abort();
  await clock.advance(5000);
  check('a call that was already called off is never sent', isAbort(dead.error) && !site.log.some((e) => e.url === 'dead'), dead);
  check('a call called off while it waits is never sent, and the one behind it moves up',
    isAbort(b.error) && site.log.map((e) => e.url).join() === 'a,c' && site.times().join() === '0,700' && Boolean(c.value), site.log.map((e) => [e.url, e.at]));
}
{
  const { clock, site, queue } = rig((n) => (n === 0 ? { hang: true } : {}));
  const ac = new AbortController();
  const a = watch(queue.send('a', { signal: ac.signal }));
  const b = watch(queue.send('b'));
  await clock.advance(100);
  ac.abort();
  await clock.advance(0);
  check('a call called off in the air: the request itself is cut', site.log[0].aborted && isAbort(a.error), [site.log[0], a]);
  await clock.advance(5000);
  check('...and the next one still keeps 700 ms from it', site.times().join() === '0,700' && Boolean(b.value), site.times());
}

// ---- no answer, or a 5xx: once more after 1 s ---------------------------------
{
  const { clock, site, queue } = rig((n) => (n === 0 ? { status: 500, after: 200 } : { after: 200 }));
  const a = watch(queue.send('a'));
  const b = watch(queue.send('b'));
  await clock.advance(1199);
  check('a 500: nothing more is sent for 1 s', site.log.length === 1 && !a.over, site.times());
  await clock.advance(10000);
  check('...then the same request once more, and its answer counts', site.log.map((e) => e.url).join() === 'a,a,b' && site.times()[1] === 1200 && a.value?.answer === 1, [site.times(), a]);
  check('...the call behind it waited its turn', site.times()[2] === 1900 && Boolean(b.value), site.times());
}
{
  const { clock, site, queue } = rig((n) => (n < 2 ? { status: 500 } : {}));
  const a = watch(queue.send('a'));
  await clock.advance(10000);
  check('a 500 twice: given up after exactly two requests, as "the chart site didn\'t answer"',
    site.log.length === 2 && a.error?.kind === 'down' && a.error.status === 500 && /didn't answer/.test(a.error.message), [site.log.length, a.error?.kind, a.error?.message]);
  const b = watch(queue.send('b'));
  await clock.advance(10000);
  check('...and the queue goes on with the next call', Boolean(b.value) && site.log.length === 3, b);
}
{
  const { clock, site, queue } = rig((n) => (n === 0 ? { error: true } : {}));
  const a = watch(queue.send('a'));
  await clock.advance(10000);
  check('no connection once: tried once more after 1 s', site.times().join() === '0,1000' && Boolean(a.value), [site.times(), a]);
}
{
  const { clock, site, queue } = rig(() => ({ error: true }));
  const a = watch(queue.send('a'));
  await clock.advance(10000);
  check('no connection twice: given up', site.log.length === 2 && a.error?.kind === 'down', [site.log.length, a.error?.kind]);
}
{
  const { clock, site, queue } = rig((n) => (n === 0 ? { hang: true } : {}));
  const a = watch(queue.send('a'));
  await clock.advance(19999);
  check('a request with no answer is still waited for at 19.9 s', !site.log[0].aborted && !a.over, site.log[0]);
  await clock.advance(1);
  check('...cut at 20 s', site.log[0].aborted && site.log.length === 1, site.log);
  await clock.advance(1000);
  check('...and tried once more 1 s later', site.times().join() === '0,21000' && Boolean(a.value), [site.times(), a]);
}
{
  const { clock, site, queue } = rig((n) => (n === 0 ? { status: 500 } : {}));
  const ac = new AbortController();
  const a = watch(queue.send('a', { signal: ac.signal }));
  const b = watch(queue.send('b'));
  await clock.advance(500);
  ac.abort();
  await clock.advance(10000);
  check('called off while waiting for its second try: no second try, the next call goes',
    isAbort(a.error) && site.log.map((e) => e.url).join() === 'a,b' && site.times()[1] === 700 && Boolean(b.value), site.log.map((e) => [e.url, e.at]));
}
{
  const { clock, site, queue } = rig(() => ({ status: 400 }));
  const a = watch(queue.send('a'));
  await clock.advance(10000);
  check('a 400 is not tried again', site.log.length === 1 && a.error?.kind === 'refused' && a.error.status === 400, [site.log.length, a.error?.kind]);
}
{
  const clock = fakeClock();
  let sent = 0;
  const notJson = async () => { sent++; return { status: 201, json: async () => { throw new SyntaxError('not JSON'); } }; };
  const queue = createQueue({ fetch: notJson, now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  const a = watch(queue.send('a'));
  await clock.advance(10000);
  check('an answer that is not JSON counts as no answer', a.error?.kind === 'down' && sent === 2, [a.error?.kind, sent]);
}

// ---- 429 or 503: 30 s of silence, then once more -------------------------------
for (const status of [429, 503]) {
  const { clock, site, queue } = rig((n) => (n === 0 ? { status } : {}));
  const told = [];
  queue.onBusy((s) => told.push(s.busyUntil));
  const a = watch(queue.send('a'));
  const b = watch(queue.send('b'));
  await clock.advance(10000);
  check(`a ${status}: the queue says busy until 30 s from then, counting down`,
    queue.busyUntil === 30000 && queue.busyLeft() === 20 && told.join() === '30000', [queue.busyUntil, queue.busyLeft(), told]);
  await clock.advance(19999);
  check('...and nothing at all is sent for 30 s, not even the other call', site.log.length === 1 && !a.over && !b.over, site.times());
  await clock.advance(1);
  check('...then that request goes once more, and its answer counts', site.log.map((e) => e.url).join() === 'a,a' && site.times()[1] === 30000 && a.value?.answer === 1, [site.times(), a]);
  check('...the queue says the wait is over', queue.busyUntil === 0 && queue.busyLeft() === 0 && told.join() === '30000,0', told);
  await clock.advance(5000);
  check('...and the other call follows 700 ms behind', site.times()[2] === 30700 && Boolean(b.value), site.times());
}
{
  const { clock, site, queue } = rig((n) => (n < 2 ? { status: 429 } : {}));
  const a = watch(queue.send('a'));
  const b = watch(queue.send('b'));
  await clock.advance(30000);
  check('a 429 again after the wait: that call is given up as busy', site.log.length === 2 && a.error?.kind === 'busy' && a.error.status === 429, [site.log.length, a.error?.kind]);
  check('...and the 30 s start again', queue.busyUntil === 60000 && !b.over, queue.busyUntil);
  await clock.advance(29999);
  const before = site.log.length;
  await clock.advance(1);
  check('...after which the next call goes', before === 2 && site.times()[2] === 60000 && Boolean(b.value), site.times());
}
{
  const { clock, site, queue } = rig((n) => (n === 0 ? { status: 429 } : {}));
  const ac = new AbortController();
  const a = watch(queue.send('a', { signal: ac.signal }));
  await clock.advance(1000);
  ac.abort();
  const b = watch(queue.send('b'));
  await clock.advance(28999);
  const before = site.log.length;
  await clock.advance(1);
  check('calling the busy call off does not end the 30 s: the next call waits them out',
    isAbort(a.error) && before === 1 && site.log.map((e) => e.url).join() === 'a,b' && site.times()[1] === 30000 && Boolean(b.value), site.log.map((e) => [e.url, e.at]));
}
{
  const { clock, site, queue } = rig((n) => (n === 0 ? { status: 500 } : n === 1 ? { status: 429 } : {}));
  const a = watch(queue.send('a'));
  await clock.advance(60000);
  check('a 500, then a 429 on the second try: one more try after the 30 s', site.times().join() === '0,1000,31000' && Boolean(a.value), [site.times(), a]);
}
{
  const { clock, site, queue } = rig((n) => (n === 0 ? { status: 429 } : {}));
  queue.set({ busyWait: 2000 });
  const a = watch(queue.send('a'));
  await clock.advance(2000);
  check('the browser tests can shorten the 30 s', site.times().join() === '0,2000' && Boolean(a.value), site.times());
}

// ---- the real queue's helper ----------------------------------------------------
{
  const kept = globalThis.fetch;
  let seen = null;
  globalThis.fetch = async (url, init) => { seen = { url, init }; return { status: 201, json: async () => ({ found: 0, data: [] }) }; };
  const body = await post('/search', { search: 'x', page: 1 });
  globalThis.fetch = kept;
  check('post() sends JSON to the chart site and answers with the parsed body',
    seen.url === `${API}/search` && seen.init.method === 'POST' && seen.init.headers['Content-Type'] === 'application/json'
    && seen.init.body === '{"search":"x","page":1}' && body.found === 0 && chartSite.busyUntil === 0, seen);
}

console.log(failed ? `${failed} FAILED` : 'all good');
process.exit(failed ? 1 : 0);
