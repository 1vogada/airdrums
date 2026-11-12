// Small settings store: everything stays in this browser (localStorage).

const PREFIX = 'airdrums.';

export function get(key, fallback = null) {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function set(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch { /* storage full or blocked: the setting just isn't kept */ }
}

export function del(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch { /* nothing to do */ }
}
