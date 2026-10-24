# Spec: redesign R3 - the in-game screens

Status: **assigned to the coder session** (branch `feat/redesign-r3-ingame`).
Raghav decided (2026-10-24): **always dark** and **ESC opens a pause menu**.
Maintainer: session `chem-lab-playground-refactor` - reviews, merges, deploys.
Read `docs/specs/redesign-roadmap.md` and `redesign-r1-title.md` first: R3
carries R1's language (the title screen) into the game itself.

## What is wrong today (measured on the live site, 1920x1080)

Screenshots: sandbox, playground, chem lab - all three share one shell.

- **The shell is a beige web app around a dark game.** The title screen is
  dark; pressing ENTER drops you into a cream panel with a bevelled bezel.
  It is the "AI slop" Raghav named: a settings page, not a game.
- **Topbar: 16 buttons in 4 captioned groups** (`RUN` `FILE` `VIEW` `SOUND`
  in ~9px letter-spaced caps), 7 of them with an LED dot. Nobody reads it;
  everyone needs only PAUSE and MENU.
- **Rail: tiny letter-spaced labels** (~10px Silkscreen at 0.2em) next to a
  14px chip, section headers with hairlines, "WHEEL OR [ ] TO RESIZE" as
  permanent text. Long names truncate ("SPARKL...", "BLACK H...").
- **Status bar: 5 segments** (`RUNNING` lamp, material + note, `TOOL BRUSH 6`,
  `CELLS 0`, `60 FPS`), all small caps, mostly repeating what the rail shows.

## The rule set (applies to everything below)

1. **One look, always dark.** The game screens use the title screen's dark
   palette in every theme. **The light theme is removed** (`THEME` option,
   `T` key, `ui/theme.ts`, every `[data-theme='light']` and
   `prefers-color-scheme: light` rule). One palette, one set of tokens.
2. **One frame.** Every panel (rail, pause menu, dialogs, the canvas) uses
   the same pixel frame: a 2px solid `--frame` border plus a hard 4px
   offset shadow in near-black. No gradients, no bevels, no inner glows,
   no rounded corners, no `#bezel` chrome, no `#led`.
3. **No LEDs.** A toggle shows its state by fill: on = accent background,
   dark text; off = transparent, `--ink-dim` text. Delete `.led`,
   `.has-led`, `.sb-lamp` and their CSS.
4. **Type floor.** Nothing in the game screens below **14px**. Letter-
   spacing at most `0.04em`. `--font-display` only for buttons and the few
   headings (>= 16px); names and descriptions in `--font-read`. Text never
   truncates with an ellipsis: if a name does not fit, the tile grows or
   the name wraps to two lines.
5. **Fewer words.** A word that repeats what is on screen goes. Keyboard
   hints live in CONTROLS (the help overlay), not on the HUD.

## Layout (desktop)

```
+--------+------------------------------------------------------+
| SAND   |                                                      |
| ▓▓ ▓▓  |                                                      |
| ▓▓ ▓▓  |                    THE GAME (canvas)                 |
| ...    |                                                      |
|        |                                                      |
| BRUSH  |                                                      |
| ● ● ●  |                                                      |
+--------+------------------------------------------------------+
| ▓ SAND  powder - falls and piles up            ❚❚   MENU     |
+---------------------------------------------------------------+
```

- **The topbar goes.** Its job splits in two: PAUSE and MENU move to the
  bottom bar (big, right-aligned); everything else moves into the **pause
  menu** (below).
- **The canvas** takes the freed height (it is a 16:9 sim; letterbox in
  the dark background, no bezel).
- **Bottom bar**, one line, 48px tall: the picked material's chip, its name
  (`--font-display` 16px), its note (`--font-read` 15px, `--ink-dim`); on
  the right the count (`12,408 cells` / `particles`, chem lab's
  `REACTIONS 14/s` + `NOW` note keep their place here), then the
  PAUSE button (`❚❚` / `▶`, 44px square) and MENU. Drop `RUNNING`, `TOOL
  BRUSH 6` and `FPS` (FPS moves to a CONTROLS-documented `F` key that
  toggles a small corner readout, off by default).
- **PAUSED** shows as a badge on the canvas (top-centre, display font,
  blinking at 1 Hz in hard steps like R1's PRESS START; still under reduced
  motion).

## The rail (all three modes; `buildPalette` stays the one builder)

- **Material tiles, not list rows.** A tile is a 56px square filled with
  the material's 4-colour ramp (`rampGradient`, already there), the name
  under it in `--font-read` 14px, no caps transform. 3 tiles per row in a
  ~220px rail (rail width may grow to ~240px; measure). The chem lab's
  periodic tiles keep their symbol / number design at the same 56px.
- **Selected** = a 3px accent pixel outline plus R1's `▶` marker left of
  the name. No glow.
- **Section headers**: the group word (`POWDER`, `LIFE`, `EMITTERS`,
  `METALS`...) in `--font-display` 14px, `--ink-dim`, no hairline, 16px
  above the group.
- **Buttons in the rail** (scenes, experiments, SURPRISE ME, GRAVITY,
  SLOW-MO, CLEAR, PERIODIC TABLE) use the one frame, `--font-display` 14px,
  full width when alone, never truncated.
- **Brush**: five sizes as five dots of growing size in one row (click
  one; the selected one gets the accent outline); `[` / `]` and the wheel
  keep working and move the selection. BUCKET and WIND become two tiles in
  the TOOLS group beside ERASE (they are tools, not brush options). Delete
  the slider, the number, the preview square and the hint text.
- The rail scrolls on its own if a mode has more than fits (chem lab);
  the brush row stays pinned at the bottom (as `.toolcol` is today).

## The pause menu (ESC in game)

Games pause on ESC. Today ESC goes straight to the title screen; R3 puts a
pause menu in between, built from R1's pieces (`menucursor.ts` for the
cursor, the same list styling, sounds `uiMove/uiSelect/uiBack`).

```
          PAUSED
      >  RESUME       <
         SAVE
         LOAD
         SHARE
         VIEW     ▸
         OPTIONS  ▸
         CONTROLS
         QUIT TO TITLE
```

- Over the frozen game with R1's vignette; the list centred.
- **Solo**: opening it pauses the sim; RESUME (or ESC again) restores the
  pause state from before it opened (if the player had paused with SPACE,
  it stays paused).
- **In a room**: it does **not** pause (the room is shared and
  host-sequenced); the header reads `MENU` instead of `PAUSED`. QUIT TO
  TITLE keeps today's leave-confirm.
- SAVE / LOAD / SHARE: as today's buttons, including their disabled state
  (playground and chem lab have no save; show them dim and `uiDeny` on
  confirm, as R1 does for locked challenges).
- **VIEW ▸**: `IMMERSE`, `SOFT`, `CRT`, `GRID`, `3D`, `BACKDROP` - each a
  value item (`SOFT: ON`), changed with Enter or Left/Right, like R1's
  OPTIONS. Their keys (`I S C B 3`) keep working in game.
- **OPTIONS ▸** opens R1's OPTIONS screen (the volumes, backdrop, CRT,
  controls) - the same screen, not a copy.
- **CONTROLS** opens the help overlay.
- **QUIT TO TITLE** = today's `requestMenu()`.
- The room pill, emotes and the challenge result screen are unchanged;
  ESC while a dialog or the result screen is open closes that first, as
  today.
- `SPACE` still freezes / unfreezes the sim without a menu (it is a
  building tool, not a pause menu); `N` still steps.

## Background colour (Raghav, 2026-10-24: "add sandbox color for customization")

The colour of the empty world behind the materials, picked by the player.

- A **VIEW** item `BACKGROUND: NIGHT`, cycled with Enter / Left / Right
  like the other values, plus the same item in R1's OPTIONS. Presets only
  (no free colour picker - a bright free colour would wash out fire, glow
  and bloom, which are built for a dark world): about 6-8 named presets,
  starting with `NIGHT` = today's `#0b0b14`, then e.g. deep blue, deep
  purple, forest, dusk, ember, slate, and **at most one** light-ish preset
  if fire, lava and the fluid glints still read on it (measure; drop it if
  not). Name each in one word.
- **Presentation only.** It changes how pixels are drawn, never a cell:
  not in the snapshot, not in the fingerprint, not sent to a room. Each
  player in a room sees their own. Persist in localStorage (one key,
  parsed defensively, unknown value -> NIGHT).
- **Every place the background is drawn follows it.** Today it is baked
  in several copies of `#0b0b14` - find them all, make one source:
  `world.ts` `BG` (the frame fill and the wind-dust speck background),
  `particles.ts` `PG_BG` and its additive blend (`BG_R/G/B`), the
  `materials.ts` EMPTY ramp, `renderer.ts` (2D fallback fill),
  `blocks.ts` (GRID view's EMPTY compare), `voxel3d.ts` / `pg3d.ts` if they
  draw empty space, the eraser chip (`hud.ts`, `chem.ts`), and any shader
  that treats the background as "nothing" (bloom, fluid composite). The
  worker learns the colour through a presentation `Req` (not a `NetInput`).
- All modes: sandbox, challenges, chem lab and playground. Report
  how the playground's nebula and stars look on each preset; if some
  preset breaks it, say so rather than special-casing.
- Test: the chosen colour never changes a world's fingerprint (two worlds,
  same inputs, different backgrounds -> same hash) - mutation-check it by
  making the background touch a cell.
- Verification: a screenshot of the same scene (flame tests, and a lava +
  water sandbox) on every preset; the pixel colour of an empty cell read
  back from the canvas equals the preset.

## Phone (390px portrait and landscape)

- Portrait: canvas on top, the rail becomes a horizontal tile strip under
  it (one row, scrolls sideways, 56px tiles), the bottom bar below that.
  The `MORE` drop-down is deleted - the pause menu replaces it (a `❚❚`
  button opens it).
- Landscape: the desktop layout with a narrower rail (2 tiles per row).
- Tap targets >= 44px. No horizontal page scroll at 390px.
- R1's "phone portrait demo strip" note: the attract demo on the title
  screen should fill the portrait screen behind the list, not sit in a
  strip - fix it here since it is the same canvas-sizing code.

## Challenges

Challenges are a SandMode, so they get all of the above. The material
budget badge (`.budget`) sits in the tile's top-right corner in
`--font-read` 14px; an exhausted material dims (as today).

## Delete (grep each to zero in `src/`)

`#topbar` and its builder (`initTopbar` groups, `.btn-group`, `.grp-label`,
`.grp-row`, `.topbar-groups`, `.more-btn`, `.more-open`, `.brand`,
`.brand-mark`, `.mode-label`), `#bezel`, `#led`, `#glass` (if only the bezel
used it - check), `.led`, `.has-led`, `.sb-lamp`, `.sb-key` (replaced by the
new bar), the brush slider/preview/hint, `ui/theme.ts` and the light theme
CSS, the `THEME` OPTIONS item and the `T` key. Update `help.ts` (CONTROLS)
for every key that moved or went.

## Must keep working

Every mode's tools and keys; rooms (pill, emotes, ping, the mode switch,
leave-confirm); 3D view and immersive mode; the challenge result screen and
stars; save / load / share links (`#w=`); the periodic table overlay (E);
autosave; R1's title screen and OPTIONS; R2's volumes and music (the pause
menu does not stop music; it may duck it - optional, say if you do);
`prefers-reduced-motion`.

## Tests

The pause-menu state rule is a pure function: `(pausedBefore, inRoom) ->
{ freeze on open, state on resume }` - unit-test it and mutation-check
(room case must never freeze). If the menu reuses `menucursor.ts`, its
tests cover the cursor.

## Verification (send the numbers back)

Muted agent-browser (`--args "--mute-audio"`), own port, dark is the only
theme now:
- 1920x1080, 2560x1440, 1280x720, iPhone 14 portrait + landscape:
  screenshots of sandbox, playground, chem lab, a challenge, the pause menu,
  VIEW. Report: the canvas's rendered size vs today's at each size, the
  smallest computed `font-size` anywhere in the game screens (must be
  >= 14), any element with `text-overflow: ellipsis` actually clipping
  (must be none), page scrollWidth vs innerWidth on the phone.
- Keyboard-only: title -> sandbox, paint, SPACE, ESC -> pause menu ->
  VIEW -> SOFT ON -> back -> RESUME, ESC -> QUIT TO TITLE.
- A 2-browser room: ESC on the guest opens the menu without freezing either
  sim; fingerprints match for 60 s.
- Every deleted class: zero matches in `src/`.
- Full suite + typecheck on every commit; build; entry gzip before/after.

## Workflow

Branch `feat/redesign-r3-ingame` from current main (`190368b`) in your
worktree, one verified change per commit (suggested order: tokens + frame
+ light-theme removal; bottom bar + topbar removal; pause menu; rail tiles
+ brush; background colour; phone), no push, no merge. Report to
`chem-lab-playground-refactor` with the numbers, screenshot paths, and
anything you disagree with.
