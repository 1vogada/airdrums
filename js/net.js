// One polite line to the chart site (api.enchor.us). It is somebody else's
// free service with a limit of 50 requests per 30 seconds that a web page
// cannot read, and it answers 500 now and then. So every request to it goes
// through this queue:
//
// - one request in the air at a time, and at least 700 ms between two sends;
// - every call can be called off (an AbortSignal), sent or not;
// - no answer, or a 5xx: tried once more after 1 s;
// - a 429 or 503: nothing at all is sent for 30 s, then that request is tried
//   once more. Screens read `busyUntil` / `busyLeft()` for the countdown.
//
// Range requests for the notes files (files.enchor.us) do not come through here.
// No DOM: runs in Node, and the tests hand it their own fetch, clock and timers.

export const API = 'https://api.enchor.us';

// Why a request gave up. `kind`:
//   'down'    no answer, or a 5xx, twice           -> "The chart site didn't answer" + Retry
//   'busy'    429 or 503 again after the 30 s wait  -> the queue is paused again; see busyUntil
//   'refused' any other answer that is not a 2xx    -> not retried (the request itself is wrong)
export class ChartSiteError extends Error {
  constructor(kind, message, status = 0) {
    super(message);
    this.name = 'ChartSiteError';
    this.kind = kind;
    this.status = status;
  }
}

function calledOff() {
  const e = new Error('The request was called off');
  e.name = 'AbortError';
  return e;
}

export const isAbort = (e) => e?.name === 'AbortError';

export function createQueue(options = {}) {
  const o = {
    fetch: (...a) => globalThis.fetch(...a),
    now: () => Date.now(),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id),
    gap: 700,              // ms between two sends
    retryWait: 1000,       // ms before the second try after no answer or a 5xx
    busyWait: 30000,       // ms of silence after a 429 or 503
    timeout: 20000,        // ms before a request with no answer counts as "no answer"
    ...options,
  };
  const waiting = [];      // calls not sent yet, oldest first
  let head = null;         // the call at the front: in the air, or waiting for its second try
  let flying = false;      // a request is in the air
  let lastSend = -Infinity;
  let busyUntil = 0;       // on the `now()` clock; 0 when the site has not said "wait"
  let wake = null;         // the one timer that sends the next request
  let busyTimer = null;
  const listeners = new Set();

  const busyLeft = () => (busyUntil ? Math.max(0, Math.ceil((busyUntil - o.now()) / 1000)) : 0);
  const state = () => ({ busyUntil, busyLeft: busyLeft(), waiting: waiting.length + (head ? 1 : 0) });
  function tell() {
    const s = state();
    for (const fn of listeners) fn(s);
  }

  function settle(job, how, value) {
    if (job.done) return;
    job.done = true;
    job.signal?.removeEventListener('abort', job.onAbort);
    job[how](value);
  }

  function cancel(job) {
    if (job.done) return;
    settle(job, 'reject', calledOff());
    const i = waiting.indexOf(job);
    if (i >= 0) waiting.splice(i, 1);
    else if (job === head) {
      if (flying) job.stop?.();              // the front is freed when the request lets go
      else head = null;                      // it was waiting for its second try
    }
    pump();
  }

  function pause() {
    busyUntil = o.now() + o.busyWait;
    if (busyTimer !== null) o.clearTimeout(busyTimer);
    busyTimer = o.setTimeout(() => { busyTimer = null; busyUntil = 0; tell(); }, o.busyWait);
    tell();
  }

  // Send the next request when its time has come, else set the alarm for it.
  function pump() {
    if (wake !== null) { o.clearTimeout(wake); wake = null; }
    if (flying) return;
    const job = head || waiting[0];
    if (!job) return;
    const wait = Math.max(lastSend + o.gap, busyUntil, job.notBefore) - o.now();
    if (wait > 0) {
      wake = o.setTimeout(() => { wake = null; pump(); }, wait);
      return;
    }
    if (!head) head = waiting.shift();
    attempt(head);
  }

  async function attempt(job) {
    flying = true;
    lastSend = o.now();
    const ac = new AbortController();
    job.stop = () => ac.abort();
    const timer = o.timeout > 0 ? o.setTimeout(() => ac.abort(), o.timeout) : null;
    let out;
    try {
      const res = await o.fetch(job.url, { ...job.init, signal: ac.signal });
      if (res.status === 429 || res.status === 503) out = { busy: res.status };
      else if (res.status >= 500) out = { failed: res.status };
      else if (res.status < 200 || res.status >= 300) out = { refused: res.status };
      else out = { value: await res.json() };
    } catch {
      out = { failed: 0 };                   // no answer: offline, cut off, too slow, or not JSON
    }
    if (timer !== null) o.clearTimeout(timer);
    job.stop = null;
    flying = false;

    if ('busy' in out) pause();              // the site said wait, whoever asked
    if (job.done) {                          // called off while in the air
      head = null;
    } else if ('value' in out) {
      head = null;
      settle(job, 'resolve', out.value);
    } else if ('refused' in out) {
      head = null;
      settle(job, 'reject', new ChartSiteError('refused', `The chart site said ${out.refused}`, out.refused));
    } else if ('busy' in out) {
      if (job.busied++ >= 1) {
        head = null;
        settle(job, 'reject', new ChartSiteError('busy', 'The chart site is busy', out.busy));
      }                                      // else it stays at the front and goes again when the wait is over
    } else if (job.failed++ >= 1) {
      head = null;
      settle(job, 'reject', new ChartSiteError('down', "The chart site didn't answer", out.failed));
    } else {
      job.notBefore = o.now() + o.retryWait;
    }
    pump();
  }

  return {
    // Like fetch(url, init) but paced, retried as above, and answering with
    // the parsed JSON body. Rejects with a ChartSiteError, or with an error
    // named 'AbortError' when init.signal called it off.
    send(url, init = {}) {
      const { signal, ...rest } = init;
      return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(calledOff()); return; }
        const job = { url, init: rest, signal, resolve, reject, failed: 0, busied: 0, notBefore: -Infinity, done: false, stop: null, onAbort: null };
        if (signal) {
          job.onAbort = () => cancel(job);
          signal.addEventListener('abort', job.onAbort, { once: true });
        }
        waiting.push(job);
        pump();
      });
    },
    // Call `fn({ busyUntil, busyLeft, waiting })` when the site says "wait" and when the wait is over. Returns how to stop.
    onBusy(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get busyUntil() { return busyUntil; },   // on the Date.now() clock, 0 when not waiting
    busyLeft,                                // whole seconds until requests go again, 0 when not waiting
    state,
    // Change the waits (the browser tests shorten the 30 s): { gap, retryWait, busyWait, timeout } in ms.
    set(waits) {
      for (const k of ['gap', 'retryWait', 'busyWait', 'timeout']) {
        if (Number.isFinite(waits?.[k])) o[k] = waits[k];
      }
    },
  };
}

// The one queue every request to api.enchor.us goes through.
export const chartSite = createQueue();

// POST a JSON body to the chart site, e.g. post('/search', {...}, { signal }). Answers with the parsed body.
export function post(path, body, { signal } = {}) {
  return chartSite.send(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}
