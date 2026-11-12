// Small building blocks every screen uses: elements, icons, toasts, song rows.
// Titles, artists and part names come from strangers (the chart site, Spotify):
// they always go into the page as text, never as HTML.

import { artUrl } from './catalog.js';

// h('button', { class: 'btn', onclick: fn, text: 'Play' }, child, child...)
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

// Put these into an element in place of what it holds. Pieces that are left out (null, false) are skipped:
// handed straight to replaceChildren they would show up as the words "null" and "false".
export function fill(el, ...kids) {
  el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
}

export const clockTime = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

const PATHS = {
  search: '<circle cx="9" cy="9" r="5.5"/><path d="M13.5 13.5L17 17"/>',
  heart: '<path d="M10 16.5s-6-3.6-6-8a3.4 3.4 0 016-2.2A3.4 3.4 0 0116 8.500c0 4.400-6 8-6 8z"/>',
  play: '<path d="M6.5 4.500v11l9-5.500z"/>',
  pause: '<path d="M6.500 4.500v11M13.500 4.500v11"/>',
  back: '<path d="M11.500 4.500L6 10l5.500 5.500M6 10h9"/>',
  more: '<circle cx="4.500" cy="10" r="1"/><circle cx="10" cy="10" r="1"/><circle cx="15.500" cy="10" r="1"/>',
  mic: '<rect x="7.500" y="3" width="5" height="9" rx="2.500"/><path d="M4.500 9.500a5.500 5.500 0 0011 0M10 15v2.500"/>',
  check: '<path d="M4.500 10.500l3.500 3.500 7.500-8"/>',
  loop: '<path d="M5 8a4 4 0 014-4h5l-2-2M15 12a4 4 0 01-4 4H6l2 2"/>',
  restart: '<path d="M4.500 10a5.500 5.500 0 105.500-5.500H6M8.500 2L6 4.500 8.500 7"/>',
  close: '<path d="M5 5l10 10M15 5L5 15"/>',
  prev: '<path d="M12.500 4.500L7 10l5.500 5.500"/>',
  next: '<path d="M7.500 4.500L13 10l-5.500 5.500"/>',
};

// An icon as an element; `fill` for the solid ones (a liked heart, play).
export function icon(name, fill = false) {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="icon${fill ? ' solid' : ''}" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">${PATHS[name] || ''}</svg>`;
  return t.content.firstChild;
}

// One message at the bottom of the window, with at most one thing to press.
let toastTimer = 0;
export function toast(text, action, onAction) {
  const box = document.getElementById('toast');
  fill(box, h('span', { text }), action && h('button', { class: 'btn ghost', type: 'button', text: action, onclick: () => { box.hidden = true; onAction?.(); } }));
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, 5000);
}

const DRUM_TINTS = ['#6ec6f5', '#f06bb0', '#f59a3c', '#35b558', '#f5d90a', '#7a80f0'];

// A square for a song: its first letter on a tint, and its cover over that once it has loaded.
export function tile(title, art, size = '') {
  let sum = 0;
  for (const c of title || '') sum = (sum * 31 + c.charCodeAt(0)) >>> 0;
  const box = h('span', { class: `tile ${size}`, style: `--c:${DRUM_TINTS[sum % DRUM_TINTS.length]}` }, h('b', { text: ((title || '?').trim()[0] || '?').toUpperCase() }));
  const src = artUrl(art);
  if (src) {
    const img = h('img', { alt: '', loading: 'lazy', decoding: 'async' });
    img.addEventListener('load', () => img.classList.add('in'));
    img.addEventListener('error', () => img.remove());
    img.src = src;
    box.append(img);
  }
  return box;
}

// A song in a list. `song` has title, artist, art, length; `href` is where the row leads.
//   opts: { href, liked, onLike, onPlay, badge, note, onRemove }
export function songRow(song, opts = {}) {
  const heart = h('button', { class: `btn icon ghost heart${opts.liked ? ' on' : ''}`, type: 'button', title: opts.liked ? 'Remove from Liked' : 'Like', 'aria-pressed': String(Boolean(opts.liked)),
    onclick: (e) => { e.preventDefault(); e.stopPropagation(); opts.onLike?.(); } }, icon('heart', opts.liked));
  const row = h('a', { class: 'row', href: opts.href || '#/' },
    tile(song.title, song.art),
    h('span', { class: 'row-text' }, h('b', { text: song.title }), h('span', { text: song.artist })),
    opts.badge && h('span', { class: `badge${opts.warn ? ' warn' : ''}`, text: opts.badge }),
    opts.note && h('span', { class: 'row-note', text: opts.note }),
    song.length ? h('span', { class: 'row-time', text: clockTime(song.length) }) : null,
    opts.onLike && heart,
    opts.onRemove && h('button', { class: 'btn icon ghost', type: 'button', title: 'Remove', onclick: (e) => { e.preventDefault(); e.stopPropagation(); opts.onRemove(); } }, icon('close')),
    opts.onPlay && h('button', { class: 'btn icon', type: 'button', title: 'Play', onclick: (e) => { e.preventDefault(); e.stopPropagation(); opts.onPlay(); } }, icon('play', true)));
  return row;
}

// Rows that stand in while a list loads.
export function skeleton(count = 4) {
  return Array.from({ length: count }, () => h('div', { class: 'row skeleton' }, h('span', { class: 'tile' }), h('span', { class: 'row-text' }, h('b', { text: ' ' }), h('span', { text: ' ' }))));
}

// What a list shows when it has nothing: one line and at most one thing to do.
export function empty(text, action, onAction) {
  return h('div', { class: 'empty' }, h('p', { text }), action && h('button', { class: 'btn', type: 'button', text: action, onclick: onAction }));
}
