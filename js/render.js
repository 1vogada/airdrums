// Draws the game pages on a canvas.
//   'tab'   - the main page: the drum part written out like a tab, one line
//             per drum, scrolling under a play line.
//   'kit'   - the drums page: your kit laid out like the manual's picture,
//             a ring closes in on each drum and you hit when it lands.
//   'lanes' - the colors page: six lanes in the stick's LED colours, notes
//             fall and you hit them on the line.
//   'taiko' - the taiko page: one track, notes ride in from the right and
//             you hit them on the circle.

import { PADS, PAD, LANES } from './kit.js';

const JUDGE_COLOR = { perfect: '#ffffff', good: '#c9f2d6', ok: '#b8bcc8', wrong: '#f5a742', miss: '#f0606a' };
const FLASH = 0.22;       // seconds a pad stays lit after a hit
const POP = 0.55;         // seconds a judgement word stays up

// Where each drum sits on the kit page, as fractions of the stage.
const KIT_AT = {
  crash: [0.22, 0.2], tom: [0.5, 0.18], ride: [0.78, 0.2],
  hihat: [0.22, 0.56], snare: [0.5, 0.54], floor: [0.78, 0.56],
  pedal: [0.33, 0.89], kick: [0.67, 0.89],
};
// The tab page's lines, top to bottom, the way drum notation stacks them.
const TAB_ROWS = ['crash', 'ride', 'hihat', 'tom', 'snare', 'floor', 'kick'];
const RINGS = 3;          // rings shown per drum at once: more is a blur on a fast hi-hat
const STICKS = PADS.filter((p) => !p.foot).map((p) => p.id);   // the six stick zones, in the kit's order
const FLY = 0.32;         // seconds a hit note takes to fly to its drum's name on the taiko page
const BURST = 0.26;       // seconds the ring off a hit lasts there
const TAU = Math.PI * 2;

export class Stage {
  constructor(canvas, mode) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.mode = mode;
    this.lit = {};          // pad id -> { at, name }
    this.pops = [];         // { at, name, pad }
    this.seen = 0;          // game events already taken
    this.game = null;
    this.resize();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.w = Math.max(320, r.width);
    this.h = Math.max(240, r.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // A pad lit by hand (a key or a sound with no note under it).
  flash(pad, at, name = 'tap') {
    this.lit[pad] = { at, name };
  }

  take(game) {
    if (game !== this.game) { this.game = game; this.seen = 0; }
    if (!game) return;
    if (game.events.length < this.seen) this.seen = 0;      // the game was reset
    for (; this.seen < game.events.length; this.seen++) {
      const e = game.events[this.seen];
      for (const pad of e.pads) this.lit[pad] = { at: e.at, name: e.name };
      this.pops.push({ at: e.at, name: e.name, pad: e.pads[0] });
    }
    if (this.pops.length > 40) this.pops.splice(0, this.pops.length - 40);
  }

  draw(game, pos, now) {
    const { g, w, h } = this;
    this.take(game);
    g.clearRect(0, 0, w, h);
    if (this.mode === 'tab') this.tab(game, pos, now);
    else if (this.mode === 'kit') this.kit(game, pos, now);
    else if (this.mode === 'taiko') this.taiko(game, pos, now);
    else this.lanes(game, pos, now);
    this.pops = this.pops.filter((p) => now - p.at < POP);
  }

  // The notes on screen: from just behind `pos` to `lead` seconds ahead.
  *visible(game, pos, lead, behind = 0.25) {
    if (!game) return;
    const notes = game.notes;
    let lo = 0, hi = notes.length;
    const from = pos - behind - game.offset;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (notes[mid].t < from) lo = mid + 1; else hi = mid;
    }
    for (let i = lo; i < notes.length; i++) {
      const dt = notes[i].t + game.offset - pos;
      if (dt > lead) break;
      yield [notes[i], dt];
    }
  }

  // Whether the left foot should be up (open hi-hat) right now: what the next
  // hi-hat note says. null when the chart doesn't say open from closed.
  footUp(game, pos) {
    if (!game?.knowsOpen) return null;
    for (const [n, dt] of this.visible(game, pos, 2, 0.12)) {
      if (n.pad === 'hihat' && dt > -0.12) return n.open;
    }
    return false;
  }

  glow(pad, now) {
    const l = this.lit[pad];
    if (!l) return 0;
    const age = now - l.at;
    return age >= 0 && age < FLASH ? 1 - age / FLASH : 0;
  }

  word(p, x, y, now) {
    const { g } = this;
    const age = (now - p.at) / POP;
    g.globalAlpha = 1 - age;
    g.fillStyle = JUDGE_COLOR[p.name] || '#fff';
    g.font = '600 15px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(p.name, x, y - 14 * age);
    g.globalAlpha = 1;
  }

  // ---- tab page -------------------------------------------------------------

  // The drum part written out like a tab: one line per drum, time running
  // left to right, scrolling under a play line. A cross is a cymbal, a dot is
  // a drum, a small ring over a hi-hat cross means open (left foot up).
  tab(game, pos, now) {
    const { g, w, h } = this;
    const gutter = Math.min(150, Math.max(96, w * 0.13));
    const rowH = Math.max(30, Math.min(62, (h - 110) / TAB_ROWS.length));
    const top = Math.max(30, (h - rowH * TAB_ROWS.length - 50) / 2);
    const bottom = top + rowH * TAB_ROWS.length;
    const playX = gutter + (w - gutter) * 0.2;
    const pps = Math.max(150, (w - gutter) / 4.4);           // pixels per second
    const xOf = (dt) => playX + dt * pps;
    const yOf = (id) => top + (TAB_ROWS.indexOf(id) + 0.5) * rowH;
    const r = Math.min(12, rowH * 0.25);

    g.save();
    g.beginPath();
    g.rect(gutter, 0, w - gutter, h);
    g.clip();

    g.lineWidth = 1;
    g.strokeStyle = '#2b3040';
    for (const id of TAB_ROWS) {
      g.beginPath();
      g.moveTo(gutter, yOf(id));
      g.lineTo(w, yOf(id));
      g.stroke();
    }

    if (game) {
      const shift = game.offset - pos;
      g.strokeStyle = '#222634';
      for (const t of game.beats || []) {
        const x = xOf(t + shift);
        if (x < gutter || x > w) continue;
        g.beginPath();
        g.moveTo(x, top + rowH * 0.5);
        g.lineTo(x, bottom - rowH * 0.5);
        g.stroke();
      }
      g.font = '500 12px system-ui, sans-serif';
      g.textAlign = 'left';
      (game.bars || []).forEach((t, i) => {
        const x = xOf(t + shift);
        if (x < gutter - 40 || x > w) return;
        g.strokeStyle = '#4a5068';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x, top + rowH * 0.2);
        g.lineTo(x, bottom - rowH * 0.2);
        g.stroke();
        g.fillStyle = '#7d8398';
        g.fillText(String(i + 1), x + 5, top + 2);
      });
    }

    const shown = [...this.visible(game, pos, (w - playX) / pps, (playX - gutter) / pps + 0.1)];

    // notes hit together are joined by a stem, like on a staff
    const stems = new Map();
    for (const [n, dt] of shown) {
      if (!TAB_ROWS.includes(n.pad)) continue;
      const y = yOf(n.pad);
      const s = stems.get(n.group);
      if (s) { s.a = Math.min(s.a, y); s.b = Math.max(s.b, y); } else stems.set(n.group, { x: xOf(dt), a: y, b: y, past: dt < 0 });
    }
    g.lineWidth = 1.5;
    for (const s of stems.values()) {
      if (s.a === s.b) continue;
      g.strokeStyle = s.past ? '#2f3445' : '#6b7188';
      g.beginPath();
      g.moveTo(s.x, s.a);
      g.lineTo(s.x, s.b);
      g.stroke();
    }

    for (const [n, dt] of shown) {
      if (!TAB_ROWS.includes(n.pad)) continue;
      const p = PAD[n.pad];
      const x = xOf(dt), y = yOf(n.pad);
      const missed = n.state === 'miss';
      const done = n.state && n.state !== 'skip' && !missed;
      g.globalAlpha = missed ? 0.6 : done || n.state === 'skip' ? 0.28 : 1;
      const color = missed ? JUDGE_COLOR.miss : p.color;
      g.strokeStyle = color;
      g.fillStyle = color;
      if (p.cymbal) {
        const d = r * 0.82;
        g.lineWidth = 3.5;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(x - d, y - d); g.lineTo(x + d, y + d);
        g.moveTo(x + d, y - d); g.lineTo(x - d, y + d);
        g.stroke();
        g.lineCap = 'butt';
        if (n.open) {                                         // open hi-hat: left foot up
          g.lineWidth = 2;
          g.beginPath();
          g.arc(x, y - r * 1.65, r * 0.42, 0, Math.PI * 2);
          g.stroke();
        }
      } else {
        g.beginPath();
        g.arc(x, y, n.pad === 'kick' ? r * 1.08 : r, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 1;
    g.restore();

    // the play line, with a target on every drum's line
    g.strokeStyle = '#e7e9f0';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(playX, top - 6);
    g.lineTo(playX, bottom + 6);
    g.stroke();
    for (const id of TAB_ROWS) {
      const p = PAD[id];
      const glow = this.glow(id, now);
      const missed = this.lit[id]?.name === 'miss';
      g.lineWidth = 2.5;
      g.strokeStyle = missed && glow ? JUDGE_COLOR.miss : p.color;
      g.fillStyle = glow && !missed ? mix(p.color, 0.3 + 0.7 * glow) : '#12141b';
      g.beginPath();
      g.arc(playX, yOf(id), r * 1.45, 0, Math.PI * 2);
      g.fill();
      g.stroke();

      // the drum's name, in its LED colour
      g.fillStyle = glow && !missed ? '#ffffff' : mix(p.color, 0.92);
      g.font = `600 ${Math.max(12, Math.min(15, rowH * 0.3))}px system-ui, sans-serif`;
      g.textAlign = 'right';
      g.textBaseline = 'middle';
      g.fillText(p.name, gutter - 14, yOf(id));
      g.textBaseline = 'alphabetic';
    }

    this.pedalPill(gutter + (w - gutter) / 2, bottom + 14, Math.min(340, w - gutter - 24), this.footUp(game, pos), now);

    for (const p of this.pops) {
      if (TAB_ROWS.includes(p.pad)) this.word(p, playX, yOf(p.pad) - r * 1.9, now);
    }
  }

  // ---- taiko page -----------------------------------------------------------

  // One track, like a taiko game: notes ride in from the right and you hit
  // them as they cross the circle. The sticks are on the big track, the bass
  // drum on the thin one under it. Drums hit together share one note, split
  // into their colours. A note you hit flies up to its drum's name.
  taiko(game, pos, now) {
    const { g, w, h } = this;
    const gutter = Math.min(150, Math.max(84, w * 0.13));
    const trackH = Math.max(90, Math.min(170, h * 0.27));
    const footH = trackH * 0.42;
    const pps = Math.max(260, (w - gutter) / 1.7);            // pixels per second
    const R = Math.min(trackH * 0.34, 40, pps * 0.11);        // small enough that a fast run stays readable
    const FR = footH * 0.34;
    const legendH = 46;
    const top = Math.max(8, (h - (legendH + trackH + 10 + footH + 44)) / 2) + legendH;
    const cy = top + trackH / 2;
    const footTop = top + trackH + 10;
    const fy = footTop + footH / 2;
    const hitX = gutter + R * 1.7;
    const xOf = (dt) => hitX + dt * pps;
    const chipW = (w - gutter) / STICKS.length;
    const chipAt = (id) => [gutter + (STICKS.indexOf(id) + 0.5) * chipW, top - legendH / 2 - 2];

    // the two tracks
    g.fillStyle = '#171a22';
    g.fillRect(gutter, top, w - gutter, trackH);
    g.fillStyle = '#14171e';
    g.fillRect(gutter, footTop, w - gutter, footH);
    g.strokeStyle = '#2b3040';
    g.lineWidth = 1;
    for (const y of [top, top + trackH, footTop, footTop + footH]) {
      g.beginPath();
      g.moveTo(gutter, y);
      g.lineTo(w, y);
      g.stroke();
    }

    // what is on the way: sticks hit together become one note
    const groups = new Map();                                 // group -> { dt, wait, miss }
    const kicks = [];
    const flying = [];
    const behind = Math.max((hitX - gutter) / pps + 0.1, FLY + 0.2);
    for (const [n, dt] of this.visible(game, pos, (w - hitX) / pps + 0.1, behind)) {
      if (n.state === 'skip' || PAD[n.pad].free) continue;
      const hit = n.state && n.state !== 'miss';
      if (n.pad === 'kick') { if (!hit) kicks.push([n, dt]); continue; }
      if (hit) { if (now - n.hitAt < FLY) flying.push(n); continue; }
      let s = groups.get(n.group);
      if (!s) groups.set(n.group, s = { dt, wait: [], miss: [] });
      (n.state === 'miss' ? s.miss : s.wait).push(n);
    }

    g.save();
    g.beginPath();
    g.rect(gutter, top, w - gutter, footTop + footH - top);
    g.clip();

    if (game) {                                               // bar lines, as on a taiko track
      const shift = game.offset - pos;
      g.strokeStyle = '#3a4054';
      g.lineWidth = 2;
      for (const t of game.bars || []) {
        const x = xOf(t + shift);
        if (x < gutter || x > w) continue;
        g.beginPath();
        g.moveTo(x, top);
        g.lineTo(x, top + trackH);
        g.moveTo(x, footTop);
        g.lineTo(x, footTop + footH);
        g.stroke();
      }
    }

    // the circle to hit on: lit in the colour of the drum just hit
    let lit = null, most = 0;
    for (const id of STICKS) {
      const glow = this.glow(id, now);
      if (glow > most) { most = glow; lit = id; }
    }
    const missed = lit && this.lit[lit].name === 'miss';
    g.lineWidth = 3;
    g.strokeStyle = missed ? JUDGE_COLOR.miss : '#e7e9f0';
    g.fillStyle = lit && !missed ? mix(PAD[lit].color, 0.2 + 0.6 * most) : '#12141b';
    g.beginPath();
    g.arc(hitX, cy, R * 1.1, 0, TAU);
    g.fill();
    g.stroke();
    g.lineWidth = 1.5;
    g.strokeStyle = '#4a5068';
    g.beginPath();
    g.arc(hitX, cy, R * 0.66, 0, TAU);
    g.stroke();

    const kickGlow = this.glow('kick', now);
    const kickMissed = this.lit.kick?.name === 'miss';
    g.lineWidth = 2.5;
    g.strokeStyle = kickMissed && kickGlow ? JUDGE_COLOR.miss : '#e7e9f0';
    g.fillStyle = kickGlow && !kickMissed ? mix(PAD.kick.color, 0.2 + 0.6 * kickGlow) : '#12141b';
    g.beginPath();
    g.arc(hitX, fy, FR * 1.25, 0, TAU);
    g.fill();
    g.stroke();

    // the notes, last one first so the next one to hit is on top
    for (const [n, dt] of kicks.reverse()) {
      g.globalAlpha = n.state === 'miss' ? 0.3 : 1;
      this.disc(xOf(dt), fy, FR, ['kick'], n.state === 'miss', false);
    }
    for (const s of [...groups.values()].reverse()) {
      const x = xOf(s.dt);
      if (s.miss.length) {
        g.globalAlpha = 0.35;
        this.disc(x, cy, R, s.miss.map((n) => n.pad), true);
      }
      if (!s.wait.length) continue;
      g.globalAlpha = 1;
      this.disc(x, cy, R, s.wait.map((n) => n.pad));
      if (s.wait.some((n) => n.open)) {                       // open hi-hat: left foot up
        g.lineWidth = 2.5;
        g.strokeStyle = PAD.hihat.color;
        g.beginPath();
        g.arc(x, cy - R * 1.24, R * 0.17, 0, TAU);
        g.stroke();
      }
    }
    g.globalAlpha = 1;
    g.restore();

    // the drums' names over the track: what each colour and code is
    const named = chipW >= 124;
    g.textBaseline = 'middle';
    for (const id of STICKS) {
      const p = PAD[id];
      const [x, y] = chipAt(id);
      const glow = this.glow(id, now);
      g.font = '600 13px system-ui, sans-serif';
      const text = named ? g.measureText(p.name).width + 8 : 0;
      const cx = x - text / 2;
      this.disc(cx, y, 14 + 3 * glow, [id]);
      if (named) {
        g.fillStyle = glow ? '#ffffff' : mix(p.color, 0.92);
        g.font = '600 13px system-ui, sans-serif';
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        g.fillText(p.name, cx + 22, y);
      }
    }

    // a note you hit flies up to its name
    for (const n of flying) {
      const f = (now - n.hitAt) / FLY;
      const [x, y] = chipAt(n.pad);
      const ease = 1 - (1 - f) * (1 - f);
      g.globalAlpha = 1 - f * 0.8;
      this.disc(hitX + (x - hitX) * ease, cy + (y - cy) * ease, R + (14 - R) * ease, [n.pad]);
    }
    g.globalAlpha = 1;

    // the drum on the left: your combo
    const D = Math.min(gutter * 0.38, trackH * 0.44);
    g.lineWidth = 3;
    g.strokeStyle = '#4a5068';
    g.fillStyle = '#12141b';
    g.beginPath();
    g.arc(gutter / 2, cy, D, 0, TAU);
    g.fill();
    g.stroke();
    g.fillStyle = lit && !missed ? mix(PAD[lit].color, 0.15 + 0.5 * most) : '#1d212c';
    g.beginPath();
    g.arc(gutter / 2, cy, D * 0.78, 0, TAU);
    g.fill();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (game && game.combo > 1) {
      g.fillStyle = '#ffffff';
      g.font = `700 ${Math.round(D * 0.58)}px system-ui, sans-serif`;
      g.fillText(String(game.combo), gutter / 2, cy - D * 0.08);
      g.fillStyle = '#b8bcc8';
      g.font = `500 ${Math.max(9, Math.round(D * 0.22))}px system-ui, sans-serif`;
      g.fillText('combo', gutter / 2, cy + D * 0.4);
    }
    g.fillStyle = kickGlow && !kickMissed ? '#ffffff' : mix(PAD.kick.color, 0.9);
    g.font = '600 12px system-ui, sans-serif';
    g.textAlign = 'right';
    g.fillText(PAD.kick.name, gutter - 12, fy - 7);
    g.fillStyle = '#7d8398';
    g.font = '500 11px system-ui, sans-serif';
    g.fillText(PAD.kick.foot, gutter - 12, fy + 8);
    g.textBaseline = 'alphabetic';

    this.pedalPill(gutter + (w - gutter) / 2, footTop + footH + 12, Math.min(340, w - gutter - 24), this.footUp(game, pos), now);

    // a ring bursts out of the circle on a hit; only the newest judgement of
    // each track is written, or a fast run stacks them into a smear
    const newest = {};
    for (const p of this.pops) {
      const foot = p.pad === 'kick';
      if (foot) newest.foot = p; else newest.hand = p;
      const age = (now - p.at) / BURST;
      if (p.name === 'miss' || age >= 1) continue;
      g.globalAlpha = (1 - age) * 0.8;
      g.strokeStyle = PAD[p.pad].color;
      g.lineWidth = 4;
      g.beginPath();
      g.arc(hitX, foot ? fy : cy, (foot ? FR * 1.25 : R * 1.1) * (1 + age * 0.7), 0, TAU);
      g.stroke();
      g.globalAlpha = 1;
    }
    if (newest.hand) this.word(newest.hand, hitX, cy - R * 1.12, now);
    if (newest.foot) this.word(newest.foot, hitX, fy + 5, now);
  }

  // A taiko note: a white-rimmed disc with one slice per drum hit together,
  // each in its drum's colour with its short name.
  disc(x, y, r, pads, missed = false, label = true) {
    const { g } = this;
    const ids = [...pads].sort((a, b) => PAD[a].col - PAD[b].col || PAD[a].row - PAD[b].row);
    const inner = r * 0.84;
    const n = ids.length;
    g.fillStyle = missed ? '#5b6072' : '#f4f5f8';
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
    ids.forEach((id, i) => {
      g.fillStyle = missed ? mix(JUDGE_COLOR.miss, 0.75) : PAD[id].color;
      g.beginPath();
      if (n === 1) {
        g.arc(x, y, inner, 0, TAU);
      } else {                                                // slices start at the bottom, the first one on the left
        g.moveTo(x, y);
        g.arc(x, y, inner, Math.PI / 2 + (i * TAU) / n, Math.PI / 2 + ((i + 1) * TAU) / n);
        g.closePath();
      }
      g.fill();
    });
    if (!label || r < 12) return;
    g.fillStyle = '#10131a';
    g.font = `700 ${Math.round(r * (n === 1 ? 0.6 : n === 2 ? 0.42 : 0.34))}px system-ui, sans-serif`;
    g.textAlign = 'center';
    const base = g.textBaseline;
    g.textBaseline = 'middle';
    ids.forEach((id, i) => {
      const a = Math.PI / 2 + ((i + 0.5) * TAU) / n;
      const d = n === 1 ? 0 : inner * 0.52;
      g.fillText(PAD[id].short, x + Math.cos(a) * d, y + Math.sin(a) * d + 1);
    });
    g.textBaseline = base;
  }

  // The left foot has no notes of its own: it sets the hi-hat open or closed.
  pedalPill(x, y, width, up, now) {
    const { g } = this;
    const pedal = PAD.pedal;
    const glow = this.glow('pedal', now);
    g.lineWidth = 2;
    g.strokeStyle = mix(pedal.color, 0.8);
    g.fillStyle = glow ? mix(pedal.color, 0.3 + 0.7 * glow) : up ? mix(pedal.color, 0.4) : '#12141b';
    roundRect(g, x - width / 2, y, width, 26, 13);
    g.fill();
    g.stroke();
    g.fillStyle = glow ? '#10131a' : up ? '#ffffff' : mix(pedal.color, 0.9);
    g.font = '600 12px system-ui, sans-serif';
    g.textAlign = 'center';
    const state = up === null ? '' : up ? ' UP: open hi-hat' : ' down: closed hi-hat';
    g.fillText(`${pedal.name} · ${pedal.foot}${state}`, x, y + 17);
  }

  // ---- drums page -----------------------------------------------------------

  kit(game, pos, now) {
    const { g, w, h } = this;
    const R = Math.min(w / 10, h / 7.6);
    const LEAD = 0.9;
    const at = (id) => [KIT_AT[id][0] * w, KIT_AT[id][1] * h];
    const up = this.footUp(game, pos);

    for (const p of PADS) {
      const [x, y] = at(p.id);
      const glow = this.glow(p.id, now);
      const missed = this.lit[p.id]?.name === 'miss';
      const lifted = p.id === 'pedal' && up;
      g.lineWidth = 4;
      g.strokeStyle = p.color;
      g.fillStyle = glow && !missed ? mix(p.color, 0.25 + 0.6 * glow) : lifted ? mix(p.color, 0.4) : '#171a22';
      if (p.foot) {                                          // the pedals are pills, under the kit
        roundRect(g, x - R * 1.3, y - R * 0.38, R * 2.6, R * 0.76, R * 0.38);
      } else {
        g.beginPath();
        g.arc(x, y, R, 0, Math.PI * 2);
      }
      g.fill();
      g.stroke();
      if (p.cymbal) {                                         // the bell, so a cymbal doesn't look like a drum
        g.lineWidth = 2;
        g.beginPath();
        g.arc(x, y, R * 0.22, 0, Math.PI * 2);
        g.stroke();
      }
      if (missed && glow) {
        g.strokeStyle = JUDGE_COLOR.miss;
        g.globalAlpha = glow;
        g.lineWidth = 6;
        g.beginPath();
        if (p.foot) roundRect(g, x - R * 1.3, y - R * 0.38, R * 2.6, R * 0.76, R * 0.38);
        else g.arc(x, y, R, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }
      g.fillStyle = glow && !missed ? '#10131a' : '#e7e9f0';
      g.font = `600 ${Math.max(12, R * 0.26)}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(p.name, x, p.cymbal ? y + R * 0.55 : p.foot ? y - R * 0.1 : y);
      if (p.foot) {                                          // which foot plays it
        g.font = `500 ${Math.max(10, R * 0.17)}px system-ui, sans-serif`;
        const foot = p.id === 'pedal' && up !== null ? `${p.foot} ${up ? 'UP: open' : 'down: closed'}` : p.foot;
        g.fillText(foot, x, y + R * 0.17);
      }
      g.textBaseline = 'alphabetic';
    }

    const rings = {};
    for (const [n, dt] of this.visible(game, pos, LEAD, 0)) {
      if (n.state && n.state !== 'skip') continue;
      rings[n.pad] = (rings[n.pad] || 0) + 1;
      if (rings[n.pad] > RINGS) continue;
      const p = PAD[n.pad];
      const [x, y] = at(n.pad);
      const f = Math.max(0, dt) / LEAD;                       // 1 far away, 0 now
      g.strokeStyle = p.color;
      g.globalAlpha = (1 - f * 0.75) / rings[n.pad];
      g.lineWidth = 4;
      g.beginPath();
      if (p.foot) {
        const s = 1 + f * 0.9;
        roundRect(g, x - R * 1.3 * s, y - R * 0.38 * s, R * 2.6 * s, R * 0.76 * s, R * 0.38 * s);
      } else {
        g.arc(x, y, R * (1 + f * 0.95), 0, Math.PI * 2);
      }
      if (n.open) g.setLineDash([R * 0.16, R * 0.12]);        // open hi-hat: left foot up
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    }

    for (const p of this.pops) {
      const [x, y] = at(p.pad);
      this.word(p, x, y - (PAD[p.pad].foot ? R * 0.6 : R * 1.15), now);
    }
  }

  // ---- colors page ----------------------------------------------------------

  lanes(game, pos, now) {
    const { g, w, h } = this;
    const LEAD = 1.8;
    const width = Math.min(w - 24, 780);
    const x0 = (w - width) / 2;
    const lane = width / LANES.length;
    const hitY = h - Math.max(100, h * 0.18);
    const laneX = (id) => x0 + LANES.indexOf(id) * lane;
    const yOf = (dt) => hitY - (dt / LEAD) * hitY;

    LANES.forEach((id, i) => {
      g.fillStyle = mix(PAD[id].color, i % 2 ? 0.07 : 0.11);
      g.fillRect(x0 + i * lane, 0, lane, h);
    });

    const noteH = Math.max(12, Math.min(20, lane * 0.2));
    const shown = [...this.visible(game, pos, LEAD)];
    for (const [n, dt] of shown) {                            // bass first, under the rest
      if (n.pad !== 'kick' || (n.state && n.state !== 'miss')) continue;
      g.globalAlpha = n.state === 'miss' ? 0.25 : 0.9;
      g.fillStyle = PAD.kick.color;
      roundRect(g, x0 + 4, yOf(dt) - 4, width - 8, 8, 4);
      g.fill();
    }
    for (const [n, dt] of shown) {
      if (n.pad === 'kick' || (n.state && n.state !== 'miss')) continue;
      g.globalAlpha = n.state === 'miss' ? 0.25 : 1;
      roundRect(g, laneX(n.pad) + lane * 0.11, yOf(dt) - noteH / 2, lane * 0.78, noteH, noteH / 2);
      if (n.open) {                                           // open hi-hat: hollow, left foot up
        g.fillStyle = '#12141b';
        g.fill();
        g.lineWidth = 3;
        g.strokeStyle = PAD[n.pad].color;
        g.stroke();
      } else {
        g.fillStyle = PAD[n.pad].color;
        g.fill();
      }
    }
    g.globalAlpha = 1;

    // the line to hit on, with each lane's target
    const kickGlow = this.glow('kick', now);
    g.fillStyle = kickGlow ? mix(PAD.kick.color, 0.3 + 0.7 * kickGlow) : mix(PAD.kick.color, 0.3);
    g.fillRect(x0, hitY - 2, width, 4);
    for (const id of LANES) {
      const p = PAD[id];
      const x = laneX(id);
      const glow = this.glow(id, now);
      const missed = this.lit[id]?.name === 'miss';
      g.lineWidth = 3;
      g.strokeStyle = missed && glow ? JUDGE_COLOR.miss : p.color;
      g.fillStyle = glow && !missed ? mix(p.color, 0.3 + 0.7 * glow) : '#12141b';
      roundRect(g, x + lane * 0.08, hitY - noteH * 0.9, lane * 0.84, noteH * 1.8, noteH * 0.9);
      g.fill();
      g.stroke();
      g.fillStyle = mix(p.color, 0.9);
      g.font = '600 12px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(p.name, x + lane / 2, hitY + noteH * 0.9 + 20);
    }
    // the two feet, under the lanes: left the hi-hat pedal, right the bass drum
    const footY = hitY + noteH * 0.9 + 32;
    const footX = { pedal: x0 + width * 0.25, kick: x0 + width * 0.75 };
    const up = this.footUp(game, pos);
    for (const id of ['pedal', 'kick']) {
      const p = PAD[id];
      const glow = this.glow(id, now);
      const lifted = id === 'pedal' && up;
      g.lineWidth = 2;
      g.strokeStyle = mix(p.color, 0.8);
      g.fillStyle = glow ? mix(p.color, 0.3 + 0.7 * glow) : lifted ? mix(p.color, 0.4) : '#12141b';
      roundRect(g, footX[id] - width * 0.22, footY, width * 0.44, 24, 12);
      g.fill();
      g.stroke();
      g.fillStyle = glow ? '#10131a' : lifted ? '#ffffff' : mix(p.color, 0.9);
      g.font = '600 12px system-ui, sans-serif';
      g.textAlign = 'center';
      const state = id === 'kick' ? ' · the wide bar' : up === null ? '' : up ? ' UP: open hi-hat' : ' down: closed hi-hat';
      g.fillText(`${p.name} · ${p.foot}${state}`, footX[id], footY + 16);
    }

    for (const p of this.pops) {
      const foot = PAD[p.pad].foot;
      const x = p.pad === 'kick' ? w / 2 : foot ? footX[p.pad] : laneX(p.pad) + lane / 2;
      this.word(p, x, foot && p.pad !== 'kick' ? footY - 4 : hitY - noteH * 1.6, now);
    }
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

// A colour at part strength over the dark stage.
function mix(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const bg = [18, 20, 27];
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v, i) => Math.round(bg[i] + (v - bg[i]) * amount));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
