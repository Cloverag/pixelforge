# Spec: redesign R1 - an arcade title screen

Status: **assigned to the coder session** (branch `feat/redesign-r1-title`).
Maintainer: session `chem-lab-playground-refactor` - reviews, merges, deploys.
Read `docs/specs/redesign-roadmap.md` first.

## Goal

The menu stops being a web page of cards and becomes a game's title screen.
A first-time player understands it in two seconds: the game is running
behind it, a big logo, one list, a cursor, ENTER.

## Screens (one overlay, four states)

```
PRESS START            MAIN                      CHALLENGES / OPTIONS
------------           ----                      --------------------
   PIXELFORGE             PIXELFORGE                CHALLENGES
                                                    > 01 AQUEDUCT     ★★☆
 PRESS ENTER           >  SANDBOX       <            02 FIRE WATCH    LOCKED
  (blinking)              PLAYGROUND                 ...
                          CHEM LAB                  
                          SURPRISE ME               route the spring into the
                          CHALLENGES  ▸             basin before the valley floods
                          PLAY WITH FRIENDS
                          OPTIONS     ▸             ESC BACK
                       paint 29 materials -
                       no rules, no timer
 LIVE: NEON WHIRLPOOL  ↑↓ SELECT  ENTER OK  ESC BACK
```

1. **PRESS START** - only the first time the menu opens in a page load
   (a fresh visit with no saved sandbox). The logo, and "PRESS ENTER" (on
   touch: "TAP TO START") blinking at 1 Hz in hard steps. Any key, click or
   tap goes on to MAIN. This is also the user gesture that unlocks audio:
   call `sfx.ensure()` here and start the music if it is on.
2. **MAIN** - the list below. Coming back from a game lands here directly.
3. **CHALLENGES** - the 7 challenges as list items: number, name, stars or
   LOCKED. Locked items are dim and cannot be confirmed (a soft "nope"
   sound, no action). ESC / BACK returns to MAIN with the cursor on
   CHALLENGES.
4. **OPTIONS** - items with values, changed with Enter or Left/Right:
   `SOUND EFFECTS: ON`, `MUSIC: ON`, `THEME: AUTO`, `BACKDROP: GRID`,
   `CRT FILTER: ON`, `CONTROLS` (opens the existing help overlay), `BACK`.
   Reuse the existing toggles in `main.ts` (`toggleMute`, `toggleMusic`,
   `nextTheme`, `cycleWallpaper`, `toggleCrt`, `toggleHelp`).

MAIN items, in this order, each with the description shown under the list
when it is selected (one description line for the whole list - not text on
every item):

| Item | Does | Description |
|------|------|-------------|
| SANDBOX | `startSandbox()` | the existing sandbox sub text |
| PLAYGROUND | `startPlayground()` | existing sub |
| CHEM LAB | `startChemLab()` | existing sub |
| SURPRISE ME | as today | existing sub |
| CHALLENGES ▸ | opens CHALLENGES | "7 puzzles - n of 21 stars" (counted) |
| PLAY WITH FRIENDS | today's PLAY TOGETHER | existing sub |
| OPTIONS ▸ | opens OPTIONS | "sound, music, theme, backdrop, controls" |

Keep `MENU` in `main.ts` as the one list of entries (it drives the hotkeys);
add what the new screen needs to it rather than a second list.

## Input (all of it must work)

- **Keyboard**: Up/Down and W/S move the cursor (wrapping); Enter/Space
  confirm; Esc/Backspace go back (from MAIN: nothing); Left/Right change an
  OPTIONS value. The existing hotkeys (P, L, R, O, ENTER for sandbox) keep
  working on MAIN.
- **Mouse**: hovering an item moves the cursor there; click confirms.
- **Touch**: tap confirms the item tapped.
- Moving the cursor onto PLAYGROUND / SURPRISE ME / CHEM LAB drives the
  attract preview (`previewAttract`), exactly as hovering a card does now.
- Accessibility: `role="menu"` / `role="menuitem"`, `aria-selected` (or
  `aria-current`) on the cursor item, focus follows the cursor, visible
  focus. Screen readers must be able to read the list.

## Look (decided)

- The live game (attract mode) fills the screen behind. Over it: a
  vignette, transparent in the middle and ~0.85 dark at the edges, plus
  the existing CRT scanlines when CRT is on. No panel, no card, no border:
  the list floats on the game.
- **Logo**: "PIXELFORGE" in `--font-display`, `clamp(40px, 7vw, 120px)`,
  filled with a vertical gradient from `--accent-hi` to `--accent`, a hard
  2-step pixel shadow (`--accent-lo` then near-black), no blur glow.
  A 2px idle bob in hard steps every 2 s (off under reduced motion).
- **List**: `--font-display`, `clamp(18px, 2vw, 30px)`, centred, line
  height ~1.9. Unselected `--ink-dim`; selected `--accent-hi` with `▶` left
  and `◀` right that blink in steps, and a 1-step `translateX` nudge - no
  layout shift, no width change.
- **Description line**: `--font-read`, `clamp(14px, 1.1vw, 18px)`,
  `--ink`, under the list, one line, fixed height so it never moves the list.
- **Footer**: control hints in small `--font` (`↑↓ SELECT · ENTER OK ·
  ESC BACK`), the `LIVE:` caption from visual polish 2 bottom-left.
- **Both themes**: the title screen is always dark (the game is dark under
  it), like the sim screen - light theme only changes the in-game panels.
- Sizes are viewport-relative (`clamp`/`vw`), so the 1240px panel and the
  `zoom: 1.3` rule from visual polish 2 go away.
- Motion: cursor moves are instant (game menus do not tween); the only
  animation is the blink, the logo bob and a 120 ms fade between screens.
  All off under `prefers-reduced-motion`.

## Sound (placeholders for R2)

Add `sfx.uiMove()`, `sfx.uiSelect()`, `sfx.uiBack()`, `sfx.uiDeny()` to
`src/game/audio.ts`, each a short synthesized blip for now (R2 swaps them
for CC0 samples). Cursor move -> uiMove, confirm -> uiSelect, back ->
uiBack, locked challenge -> uiDeny. The existing `sfx.ui()` stays for the
game's own buttons.

## Delete

The card menu: `modeButton`, `lampButton`, the challenge card list, the tip
box, the settings row, the key-chip footer, and their CSS (`.mode-btn`,
`.menu-tip`, `.challenge-card`, `.menu-settings`, `.menu-keys` ...). Leave
nothing unused behind - check with a grep for each removed class.

## Must keep working

Boot paths (`#w=`, `?room=`, a restored save -> straight into the game, no
PRESS START); ESC in game -> MAIN (with the room leave-confirm); the result
screen's MENU button -> MAIN; challenge unlock order and stars
(`progress.ts`); the help overlay; theme and backdrop persistence;
`prefers-reduced-motion` (no attract, no blink, no bob - the list still
works); the phone layout (one column, big tap targets, no horizontal
scroll at 390px).

## Tests

UI only, so mostly browser checks. If the cursor logic (wrap, skip
nothing, back stack) is a pure function, unit-test it and mutation-check.

## Verification (send the numbers back)

Muted agent-browser, own port:
- 1920x1080, 2560x1440, 1280x720, iPhone 14: screenshots of PRESS START,
  MAIN (cursor on CHEM LAB with the flame-test preview behind), CHALLENGES,
  OPTIONS. Nothing scrolls at 1920x1080 and 2560x1440; report the list's
  bottom vs innerHeight.
- Keyboard-only run: from PRESS START to a running chem lab using only keys;
  then ESC back, OPTIONS, toggle MUSIC, ESC, CHALLENGES, ENTER on AQUEDUCT.
- Mouse-only run of the same.
- The removed classes: zero matches in `src/`.
- Reduced motion: no blink/bob/attract, menu fully usable.
- Full suite + typecheck on every commit; build.

## Workflow

Branch `feat/redesign-r1-title` from current main in your worktree, one
verified change per commit, no push, no merge. Report to
`chem-lab-playground-refactor` with the numbers, screenshot paths, and
anything you disagree with.
