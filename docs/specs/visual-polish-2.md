# Spec: visual polish 2 - a front page that shows what the game is

Status: **assigned to the coder session** (branch `feat/visual-polish-2`).
Maintainer: session `chem-lab-playground-refactor` - reviews, merges.

Raghav: "frontend pages seem small and less interactive, like a normal human
is unable to see what site does, what are the wallpaper things".

What the maintainer measured on the menu:
- `.screen.menu` is `min(1040px, 95vw)`: on a 2560x1440 monitor it fills
  ~40% of the width. Body text is 12-13px (`.mode-btn .sub` 12px,
  `.cdesc` 12px, `.tagline` 13px); it reads small.
- The menu is a static panel over a dark blurred overlay. Nothing on it
  moves or shows what any mode looks like; the only explanation is one
  tagline ("A falling-sand forge: powders, liquids, fire and wire.").
- WALLPAPER (menu) and BG (game topbar) cycle a picture around the game
  cabinet (`src/game/wallpapers.ts`: GRID / NEON / NEBULA / EMBER). Neither
  button says which one is on or what it changes.

## The design (decided - build it as written)

### 1. Attract mode: the game runs behind the menu

The `#overlay` already sits over the stage, and the canvas keeps its size
under it. So:

- While the menu is open, the sim keeps stepping (the loop in `main.ts`
  only steps when `screen === 'game'` today) and shows a **playground
  SURPRISE ME scene** - reuse `playground.start()` and the surprise logic,
  without its toast. A new scene every **25 s**.
- **Hover or focus a mode card -> the background previews that mode**
  after ~300 ms (so sweeping the mouse across the list doesn't thrash):
  PLAYGROUND and SURPRISE ME -> a new SURPRISE scene; CHEM LAB -> the chem
  lab running **FLAME TESTS** (`chemLab.start()` and then the `chemScene`
  input). SANDBOX and PLAY TOGETHER leave whatever is running.
- **Silent and still**: no simulation sound (`playEvents`, `sfx.playground`,
  `sfx.crackle`) and no screen shake or flash (`juice`) while
  `screen === 'menu'`. Only the menu's own click sounds play.
- **Reduced motion** (`prefers-reduced-motion: reduce`): no attract mode;
  the menu stays as it is today.
- **The menu overlay becomes see-through** so the demo shows around the
  panel: a lighter `--overlay-bg` for the menu only (alpha ~0.35-0.5, both
  themes), no blur. Dialogs, the result screen and the help keep today's
  overlay. The menu panel itself stays opaque and readable.
- A small caption under the panel or in a corner: `LIVE: <scene name>`
  (the SURPRISE name, or "FLAME TESTS"). It tells people the background is
  the game, not a video.

Must not change: autosave (it only runs when `screen === 'game'` - check
it stays that way), rooms (`openMenu` already leaves the room), the boot
paths (`#w=` link, `?room=`, restoring a saved sandbox all go straight to
the game, not through the attract mode), and the 3D views (closed in the
menu). Entering any mode from the menu starts that mode clean, as today.

### 2. Bigger and clearer

- `.screen.menu` gets wider on big screens: `min(1240px, 92vw)`.
- Text sizes: `.tagline` 16px, `.mode-name` 22px, `.mode-btn .sub` 14px,
  `.challenge-card .cname` 14px, `.challenge-card .cdesc` 14px,
  `.tip-text` 14px, `.section-title` 12px. Keep the fonts as they are.
- On a large screen scale the whole panel: `@media (min-width: 2200px)
  and (min-height: 1300px) { .screen.menu { zoom: 1.3; } }`.
- **The menu must fit without scrolling at 1920x1080**, both themes. If
  the new sizes push it over, tighten paddings/gaps before shrinking text,
  and say what you changed.
- Replace the tagline with one sentence saying what the game is: "Paint
  with 29 materials and 30 real elements that burn, flow, grow and explode -
  build light shows, run chemistry, or play with friends in one world."
  (Count the numbers from the code; do not hard-code them if the sandbox
  card already counts its materials - reuse that.)

### 3. Backdrop, named

- Menu button: `BACKDROP: GRID` (the current name, like `THEME: AUTO`),
  title "The picture around the game screen". Clicking cycles and updates
  the label.
- Game topbar `BG`: keep the short label if the bar would overflow at
  1280px, but its title becomes "Backdrop: the picture around the game
  screen", and the toast reads `BACKDROP: NEON` (not `BG: NEON`).
- `src/ui/tooltips.ts` `BTN_NOTES`: update the BG / WALLPAPER notes to match.

## Hard constraints

1. No simulation changes. Reuse existing inputs (`mode`, `pgSurprise`,
   `chemScene`); no new `NetInput`, nothing in snapshots.
2. No new dependencies, no new image assets.
3. Tokens only, both themes; reduced motion respected.
4. Everything that works today keeps working: menu hotkeys (ENTER, P, L,
   R, O), challenge rows, the help, the theme button, the result screen,
   ESC from the game back to the menu, a room's leave-confirm.

## Verification (send the numbers back)

Muted agent-browser, own port, both themes:
- 1920x1080 and 2560x1440: the menu panel's bottom <= innerHeight (no
  scroll); report the panel's width and bottom at each.
- Attract mode: in the menu, particle count > 0 and changing over 3 s
  (status bar is hidden, so read it from a frame hook or a dev global -
  remove any dev global before committing, or keep it behind
  `import.meta.env.DEV` like `__mp`).
- Hover CHEM LAB -> the background is FLAME TESTS within 1 s (screenshot);
  hover PLAYGROUND -> a SURPRISE scene.
- Silence: no `sfx.boom`/`sfx.playground` calls while in the menu (count
  them with a temporary wrapper, then remove it), and none of the juice
  shake classes applied.
- `prefers-reduced-motion: reduce` (agent-browser can emulate it, or
  set it in devtools): no attract mode.
- Enter SANDBOX from the attract menu: an empty sandbox. Reload with a
  saved sandbox: it restores straight into the game as today.
- Screenshots: the menu at 1920x1080 and 2560x1440, light and dark, with
  the attract scene visible; the menu hovered on CHEM LAB.
- Full suite + typecheck on every commit; build.

## Workflow

Same as before: branch `feat/visual-polish-2` from current main in your
worktree, one verified change per commit (attract mode; sizes; backdrop
naming), no push, no merge. Report to `chem-lab-playground-refactor`.
