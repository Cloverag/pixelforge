# Spec: visual polish 1 - the rail, element tiles, flame tests, a steady top bar

Status: **assigned to the coder session** (branch `feat/visual-polish-1`).
Maintainer: session `chem-lab-playground-refactor` - reviews, merges.

Raghav: "fix the visuals as game seems bit odd". The maintainer looked at
every screen at 1920x1080 and 2560x1440, light and dark. The sandbox, the
playground and the menu look as designed. These four things do not:

| # | Problem | Measured |
|---|---------|----------|
| 1 | In the CHEM LAB the rail is taller than the screen, so BRUSH / BUCKET / WIND sit **below the bottom edge** | at 1920x1080: `.toolcol` top 1085 px, viewport 1080; `#toolbar` scrollHeight 1144 vs clientHeight 1020 |
| 2 | Element names truncate | 7 of 41 rail names end in "…" (HYDROG…, NITROG…, CHLORI…, POTASS…, MAGNES…, STRONT…, ALUMIN…, PHOSPH…) |
| 3 | FLAME TESTS reads as seven yellow cups | each cup's 20-row TORCH bed is a big yellow block and its glow tints every flame yellow; the sodium cup is hard to pick out |
| 4 | The top bar jumps between modes | playground and chem lab hide the FILE group, so RUN / VIEW shift ~200 px from where they sit in the sandbox |

## Fixes (the design is decided - build it as written)

### 1. The rail: the list scrolls, the brush block stays (every mode)

In `src/styles.css`:
- `#toolbar`: `overflow: hidden` (not `overflow-y: auto`).
- `#palette`: `flex: 1 1 auto; min-height: 0; overflow-y: auto;` plus a
  little right padding so the scrollbar does not sit on the swatches.
- `.toolcol` stays where it is (it already has `margin-top: auto`); it must
  never scroll away.

Check the phone layout (`@media` block around line 1015, "materials become
large buttons below it") still works. If it relies on `#toolbar` scrolling,
keep that inside the phone media query.

### 2. Element tiles in the CHEM LAB

Elements show as small periodic-table tiles, five to a row:

```
+-------+
|11     |   atomic number, top left, 8px var(--font-read), --ink-faint
|  Na   |   symbol, centred, 15px bold var(--font-read), --ink
|=======|   3px stripe at the bottom: the material's ramp gradient (the old chip)
+-------+
```

- `src/ui/hud.ts`: `Swatch` gains optional `sym?: string` and `z?: number`.
  `PaletteSection` (the swatches variant) gains optional `tiles?: boolean`.
  A tiles section renders `.gswatches.tiles` (5 columns) with each swatch
  as `.swatch.tile` holding `.tz` (number), `.tsym` (symbol) and `.tstripe`
  (the gradient). Keep `.swatch`, `.sel`, the `title` and the status-bar
  `info` exactly as now: tooltips (`ui/tooltips.ts`, delegated on
  `.swatch`), selection, the `1-9` keys and `hud.select()` must keep
  working unchanged.
- `src/modes/chem.ts`: GASES, METALS, NON-METALS and LIQUIDS become tiles
  sections; `sym` from `SYMBOL`, `z` from a small `Z` map you add next to
  `LAB_ELEMENTS` (atomic numbers - take them from `src/data/elements.json`
  by hand; do **not** import the JSON into chem.ts, it must stay out of the
  entry bundle). The `title` becomes `"Sodium (Na)"` style, from the
  material name. BENCH and TOOLS stay ordinary swatches (their names fit).
- Tile size: square-ish, ~38-40px wide in the 235px rail; `.sel` keeps the
  accent border + glow it has now.
- Both themes: use only existing tokens (`--ink`, `--ink-faint`,
  `--panel-deep`, `--accent`...). No new colours except the stripe, which is
  the material's own ramp.

### 3. FLAME TESTS: a thin burner

`src/sim/chemscenes.ts`, scene `flames`: the TORCH bed becomes **2 rows**
(`FLOOR-3 .. FLOOR-2`) instead of `330 .. FLOOR-2`; grains sit on the row
above it. Make the cups shorter to match (top at ~`FLOOR-70`). The test
`FLAME TESTS: every metal colours a flame` (tinted flame > 3x plain fire)
must stay green - and look at it: every cup must read as its own colour,
the sodium cup included.

### 4. A steady top bar

- `src/ui/hud.ts`: replace `setSaveVisible(v)` with `setSaveEnabled(v)`:
  the SAVE / LOAD / SHARE buttons stay in place and get `disabled` (plus a
  title "Saving is for the sandbox") when `v` is false. Update the one
  caller in `src/main.ts` (`enterGame`).
- `src/styles.css`: a disabled `.px` button is dimmed (opacity ~0.4), has no
  hover lift, and `cursor: default`. Check it in both themes.
- The RUN / FILE / VIEW / SOUND groups must sit at the same x in every
  mode (sandbox, playground, chem lab, a challenge).

## Hard constraints

1. No simulation changes except the flame-test scene coordinates. The
   reaction table, materials and engine are untouched.
2. No new dependencies. `src/data/elements.json` stays lazy (only
   `ui/periodic.ts` imports it) - check `dist/assets/index-*.js` after
   `npm run build` does not contain "Hydrogen".
3. Everything that works today keeps working: tooltips on swatches, digit
   keys, the periodic table picking into the rail (`hud.select`), challenge
   budget badges (`.swatch .budget` - a tiles section never has budgets),
   the phone layout, reduced motion.
4. Tokens only; both themes.

## Verification (send the numbers back)

Muted agent-browser on your own port, `agent-browser set viewport W H`:

- At **1920x1080** and **2560x1440**, in sandbox, playground, chem lab and
  AQUEDUCT: `.toolcol` bottom <= `innerHeight` (report each).
- Chem lab: truncated rail names = 0 (`scrollWidth > clientWidth` on
  `.nm`, and on `.tsym`).
- Top bar: the x of the RUN group label is identical in all four screens
  (report it).
- Screenshots, light and dark: chem lab rail, FLAME TESTS after ~6 s, the
  sandbox (to show it did not change). Phone layout: `agent-browser set
  device "iPhone 14"` for the chem lab and the sandbox.
- Full suite + typecheck green on every commit; build; the bundle check
  from constraint 2.

## Workflow

Same as V2:
- Use your existing worktree. Start the branch from the current main:
  `git -C /home/clover/CODEX/pixelforge-chemv2 checkout -b feat/visual-polish-1 main`.
- One verified change per commit (the rail, then the tiles, then flame
  tests, then the top bar).
- Mutants: the only sim change is the scene, already guarded by the
  flame-test test. Run one mutant that puts the 20-row bed back and confirm
  it goes red **or** say that it stays green (then the 3x threshold is too
  weak and we will talk).
- Do not push, merge or touch main. Report to `chem-lab-playground-refactor`
  with: commits, the numbers above, screenshot paths, anything you
  disagreed with.
