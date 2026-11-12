# Version 2: how it looks

One look for every screen. B04 builds it (tokens, components, icons); every later screen uses it and adds no
second style. If a screen needs something that is not here, add it to the shared sheet, not to the screen.

## The idea

A dark, calm instrument panel. The six LED colours of the sticks are the only strong colours on the site and
they always mean a drum. The chrome around them is neutral, with one accent for "this is the thing to press".
The notes get the room: on the play screen the chrome is thin and quiet. A player stands a metre or two away
with sticks in both hands, so anything that matters while playing is big, high-contrast and reachable by one key.

## Tokens (CSS custom properties on `:root`, in `css/style.css`)

Colour. The page background stays `#12141b`: the canvas pages draw on that colour.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#12141b` | page |
| `--panel` | `#1a1d27` | cards, bars, popovers |
| `--panel-2` | `#222634` | hover, pressed, selected rows |
| `--line` | `#2b3040` | hairlines, borders |
| `--line-strong` | `#3a4054` | borders on hover, dividers that must show |
| `--text` | `#e7e9f0` | text |
| `--soft` | `#9aa0b4` | secondary text |
| `--faint` | `#6b7188` | hints, placeholders, disabled |
| `--accent` | `#f5d90a` | the primary action, focus ring, "on" |
| `--accent-ink` | `#14151a` | text on the accent |
| `--good` | `#35b558` | done, clean, linked |
| `--warn` | `#f5a742` | not synced, needs attention |
| `--bad` | `#f0606a` | missed, failed; the filled heart |
| `--crash` `--tom` `--ride` `--hihat` `--snare` `--floor` `--kick` | `#6ec6f5` `#f06bb0` `#f59a3c` `#35b558` `#f5d90a` `#7a80f0` `#e9e9ee` | drums only (same values as `js/kit.js`) |

Type: `system-ui, -apple-system, "Segoe UI", sans-serif`. Sizes 12, 13, 14, 16 (body), 20, 28, 40. Weights 400,
600, 700. Numbers that change use `font-variant-numeric: tabular-nums`. Headings are sentence case.

Space: 4, 8, 12, 16, 24, 32, 48. Radius: 8 controls, 12 cards and popovers, 16 large panels, 999 chips.
Borders are 1 px `--line`. No shadows except on popovers, dialogs and toasts
(`0 12px 32px rgb(0 0 0 / 0.45)`).

Motion: 120 to 160 ms ease-out on hover, press, popover and toast. `prefers-reduced-motion: reduce` turns all
of it off. Nothing on the play screen animates except the canvas.

## Components (class names)

- `.btn`: 36 px high, 12 px side padding, `--panel` on `--line`. `.btn.primary`: accent fill, `--accent-ink`
  text, weight 600; at most one per screen. `.btn.ghost`: no border until hover. `.btn.icon`: 36 px square.
  `.btn.big`: 48 px high for the start buttons. States: hover (`--line-strong` border), pressed (`--panel-2`),
  disabled (45% opacity), `.on` (accent). A key hint inside a button is a `<kbd>`.
- `.chip`: 28 px high pill, a 8 px status dot plus words. Dot colours: `--faint` off, `--good` on, `--warn`
  attention, `--bad` failed. Chips that open something show a small caret.
- `.seg`: segmented control (the view switch, the level, tabs): a `--panel` track, the chosen segment
  `--panel-2` with `--text`, the others `--soft`.
- `.field`: the search field: 36 px, a search icon inside at the left, placeholder in `--faint`, a `/` hint at
  the right while empty and not focused.
- `.row`: a song row, 56 px: 48 px tile or cover, two lines of text (title 16/600, artist 14 `--soft`), one
  badge at most, length in tabular numbers, heart, play button. Hover and keyboard highlight are `--panel-2`
  with a 2 px accent bar at the left for the highlight. The whole row is one link; the heart and the play
  button are separate buttons inside it.
- `.tile`: a square with the first letter of the title, tinted with one of the six drum colours at 18%
  (picked from a hash of the title), so a list without covers still has rhythm. The cover fades in over it.
- `.badge`: 20 px high, 12 px text, `--panel-2`. Caution labels (Live, Cover) use the `--warn` text colour.
- `.card`: `--panel`, 12 px radius, 16 px padding.
- `.popover` (the native `popover` attribute) and `dialog`: `--panel`, 12 px radius, the shadow, 16 px padding,
  never wider than the window minus 16 px.
- `.toast`: bottom centre, `--panel-2`, 12 px radius, one line and at most one action.
- `.skeleton`: a row-shaped block pulsing between `--panel` and `--panel-2` (still under reduced motion).
- `.empty`: an icon, one line, one action, centred in the space the list would take.
- `.meter`, `.kbd`: as today.
- The focus ring is 2 px `--accent` with a 2 px offset on everything focusable, never removed.

Icons: inline SVG, 20 px, 1.75 px stroke, `currentColor`, round caps, in one `js/icons.js` (name to SVG
string): search, heart (outline and filled), play, pause, back, more, mic, mic-off, check, check-outline,
loop, click, speaker, headphones, close, external. No icon font, no pictures.

Favicon and `theme-color`: an inline SVG favicon (the six zones as two rows of three dots in the LED colours on
`#12141b`), `<meta name="theme-color" content="#12141b">`.

## Layout

- Top bar: 48 px, `--bg` with a 1 px `--line` bottom border; the wordmark at the left (weight 700), the search
  field taking the middle (up to 480 px), links and chips at the right. It does not scroll away.
- Content: max width 960 px, centred, 24 px side gutters (16 px under 720 px), 24 px between sections.
- Section headings: 20/700. Screen titles: 28/700. The Home hero line on a first run: 40/700, at most two lines.
- Under 720 px everything is one column and the top bar keeps the wordmark, the search field and a More button.
- The play screen: header 48, part strip 28, lyric and score strip 44, the stage, dock 44. No borders between
  the strip and the stage; the header and the dock have a 1 px line.

## Words

Plain, short, sentence case. No exclamation marks. Say what will happen ("Play with site drums"), not what
the thing is called inside the code. No raw status codes. One word per thing: song, version, level, part, pass,
tempo, drums, guide drums, click, sync, like, Play, Learn, Setup. The site is a practice and play-along tool.

## The visual checklist (every builder, on every screenshot it makes)

Open each screenshot (1280x800 and 375x812; empty, loading, filled and error states) and check:

1. Nothing overlaps, is clipped or runs off the window; no sideways scroll.
2. Text is readable: `--soft` or brighter on `--bg` / `--panel`; nothing below 12 px.
3. One primary (accent) action per screen at most, and it is the thing most people want next.
4. The keyboard focus is visible in the shot when something is focused.
5. Long titles end in an ellipsis instead of pushing the layout.
6. Popovers and dialogs sit inside the window.
7. Spacing follows the scale; edges line up; no element looks like a browser default (unstyled select, blue link).
8. Drum colours appear only on drum things.
9. The screen is not empty: a first-time user sees what to do next.

If a shot fails a point, fix it before the item is called done, and say in the report which shots were checked.
