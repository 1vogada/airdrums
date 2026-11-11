// Draws the two game pages on a canvas.
//   'kit'   - the drums page: your kit laid out like the manual's picture,
//             a ring closes in on each drum and you hit when it lands.
//   'lanes' - the colors page: six lanes in the stick's LED colours, notes
//             fall and you hit them on the line.

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
const RINGS = 3;          // rings shown per drum at once: more is a blur on a fast hi-hat

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
    if (this.mode === 'kit') this.kit(game, pos, now); else this.lanes(game, pos, now);
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

  // ---- drums page -----------------------------------------------------------

  kit(game, pos, now) {
    const { g, w, h } = this;
    const R = Math.min(w / 10, h / 7.6);
    const LEAD = 0.9;
    const at = (id) => [KIT_AT[id][0] * w, KIT_AT[id][1] * h];

    for (const p of PADS) {
      const [x, y] = at(p.id);
      const glow = this.glow(p.id, now);
      const missed = this.lit[p.id]?.name === 'miss';
      g.lineWidth = 4;
      g.strokeStyle = p.color;
      g.fillStyle = glow && !missed ? mix(p.color, 0.25 + 0.6 * glow) : '#171a22';
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
        g.fillText(p.foot, x, y + R * 0.17);
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
      g.stroke();
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
      g.fillStyle = PAD[n.pad].color;
      roundRect(g, laneX(n.pad) + lane * 0.11, yOf(dt) - noteH / 2, lane * 0.78, noteH, noteH / 2);
      g.fill();
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
    for (const id of ['pedal', 'kick']) {
      const p = PAD[id];
      const glow = this.glow(id, now);
      g.lineWidth = 2;
      g.strokeStyle = mix(p.color, 0.8);
      g.fillStyle = glow ? mix(p.color, 0.3 + 0.7 * glow) : '#12141b';
      roundRect(g, footX[id] - width * 0.22, footY, width * 0.44, 24, 12);
      g.fill();
      g.stroke();
      g.fillStyle = glow ? '#10131a' : mix(p.color, 0.9);
      g.font = '600 12px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(`${p.name} · ${p.foot}${id === 'kick' ? ' · the wide bar' : ''}`, footX[id], footY + 16);
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
