// The Fresh 'n Rebel Air Drums kit: six stick zones (2 rows x 3 columns) plus
// the two foot pedals. Colours are the stick LED colours from the manual.
//
// Feet (manual, page 2): the right foot is the bass drum (raise it, then put
// it down flat). The left foot is the hi-hat pedal: putting it down plays the
// hi-hat cymbal, and where it rests picks the sticks' hi-hat sound - flat is
// closed, raised is open. Charts only write bass drum hits, so the left foot
// has no notes of its own yet.

export const PADS = [
  { id: 'crash', name: 'Crash',      short: 'CR', color: '#6ec6f5', row: 0, col: 0, key: 'q', cymbal: true },
  { id: 'tom',   name: 'Tom 2',      short: 'T2', color: '#f06bb0', row: 0, col: 1, key: 'w' },
  { id: 'ride',  name: 'Ride',       short: 'RD', color: '#f59a3c', row: 0, col: 2, key: 'e', cymbal: true },
  { id: 'hihat', name: 'Hi-Hat',     short: 'HH', color: '#35b558', row: 1, col: 0, key: 'a', cymbal: true },
  { id: 'snare', name: 'Snare',      short: 'SN', color: '#f5d90a', row: 1, col: 1, key: 's' },
  { id: 'floor', name: 'Floor Drum', short: 'FL', color: '#7a80f0', row: 1, col: 2, key: 'd' },
  { id: 'kick',  name: 'Bass drum',  short: 'BD', color: '#e9e9ee', row: 2, col: 1, key: ' ', foot: 'right foot' },
];

export const PAD = Object.fromEntries(PADS.map((p) => [p.id, p]));

// Left to right on the note highway: each stick column, lower zone then upper.
export const LANES = ['hihat', 'crash', 'snare', 'tom', 'floor', 'ride'];

export const KEY_TO_PAD = Object.fromEntries(PADS.map((p) => [p.key, p.id]));
