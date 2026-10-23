# Spec: CHEM LAB V2 - ten more elements

Status: **assigned to the coder session** (branch `feat/chem-v2-elements`).
Maintainer: session `chem-lab-playground-refactor` - reviews every commit, merges.

## Goal

Light up 10 more elements on the periodic table (20 -> 30), each with
behaviour a player can see in under a minute. Same engine, no new systems.

## Read first (in this order)

1. `README.md` -> "The chem lab" section.
2. `src/sim/reactions.ts` - the rule table and how it compiles (`RX`, mirror pass, FIRE -> flames expansion).
3. `src/sim/materials.ts` - the `// ---- CHEM LAB ----` block and the `chem()` / `flame()` helpers.
4. `src/sim/world.ts` - `chem()`, `ruleReady()`, `react()`.
5. `src/modes/chem.ts` - `LAB_ELEMENTS`, rail groups.
6. `tests/chem.test.ts`, `tests/chemscenes.test.ts`, `tests/periodic.test.ts`.

## The elements

| Sym | Name | Kind | dens | Look | Behaviour in the lab |
|-----|------|------|------|------|----------------------|
| He | HELIUM | gas | 0.05 | faint pink-white | Inert. Lightest thing in the lab: rises above hydrogen. No rules. |
| B | BORON | powder | 2.34 | dark brown-black | Flame test **bright green** (reuse `FLAME_GREEN`). |
| F | FLUORINE | gas | 0.9 | pale yellow | The most violent: reacts with almost everything, no heat needed. |
| Si | SILICON | powder | 2.33 | blue-grey metallic | With oxygen near heat -> GLASS (silica). |
| Br | BROMINE | **liquid** | 3.1 | dark red-brown | The liquid halogen: sinks under water, attacks metals and plants. |
| Ag | SILVER | powder | 10.5 | bright silver | Tarnishes slowly with sulfur. Acid does not touch it. |
| Sn | TIN | powder | 7.3 | soft grey | Slow fizz in acid. |
| Cs | CAESIUM | powder | 1.93 | pale gold | The alkali finale: **explodes** in water. Flame test blue-violet. |
| Au | GOLD | powder | 19.3 | gold | Inert: nothing in the lab attacks it. Sinks under everything but mercury. |
| Hg | MERCURY | **liquid** | 13.5 | mirror silver | Sinks under everything. Mercury + sulfur -> cinnabar (the spill clean-up trick). Amalgamates aluminium. |

Densities are on the game's scale (water 1, sand 1.6), real order kept.
Every element `acidChance: 0` unless a rule below says acid attacks it.

## Rules (starting values - tune `p`, report what you changed and why)

| a | b | outA | outB | p | needs | fx | spark | note (shown on the card) |
|---|---|------|------|---|-------|----|-------|--------------------------|
| B | FIRE | KEEP | FLAME_GREEN | 0.4 | | | | flame test: bright green |
| B | TORCH | KEEP | KEEP | 0.12 | | | FLAME_GREEN | over a torch: a bright green flame |
| F | H | ACID | EMPTY | 0.6 | | boom | | explodes with hydrogen, even cold |
| F | WATER | O | ACID | 0.2 | | fizz | | splits water into oxygen and acid |
| F | GLASS | EMPTY | EMPTY | 0.05 | | | | etches glass away |
| F | NA | SALT | EMPTY | 0.3 | | flash | FLAME_YELLOW | burns sodium into salt |
| F | WOOD | EMPTY | FIRE | 0.2 | | ignite | | sets wood alight |
| F | PLANT | KEEP | ASH | 0.1 | | | | withers plants to ash |
| Si | O | GLASS | EMPTY | 0.2 | heat | | | burns into glass |
| AL | BR | SALT | EMPTY | 0.3 | | flash | | aluminium sparks in bromine |
| K | BR | SALT | EMPTY | 0.2 | | flash | FLAME_LILAC | burns in bromine into salt |
| NA | BR | SALT | EMPTY | 0.05 | | | | slowly turns to salt in bromine |
| BR | PLANT | KEEP | ASH | 0.03 | | | | bleaches plants |
| AG | S | SULFIDE | KEEP | 0.002 | | | | tarnishes black with sulfur |
| SN | ACID | H | WATER | 0.008 | | fizz | | slowly dissolves in acid |
| CS | WATER | H | LYE | 0.5 | | boom | FLAME_BLUE | explodes in water |
| CS | FIRE | KEEP | FLAME_BLUE | 0.4 | | | | flame test: blue-violet |
| CS | TORCH | KEEP | KEEP | 0.12 | | | FLAME_BLUE | over a torch: a blue-violet flame |
| HG | S | SULFIDE | EMPTY | 0.02 | | | | turns sulfur into cinnabar |
| AL | HG | OXIDE | KEEP | 0.02 | | | | amalgam: aluminium crumbles to white oxide |

He and Au get **no rules**. The card already says "Inert here" for an
element with none - check it reads right for both.

## Hard constraints (a review will send work back for any of these)

1. **Append `Mat` ids after `FLAME_WHITE` (66 and up). Never renumber.**
   Ids travel in room snapshots.
2. **`CHEM` membership:** `reactions.ts` marks `Mat.H .. Mat.NEON_GLOW` by
   range. New ids sit after the flames, so mark them explicitly. Flames must
   stay out of `CHEM` (they run `fire()`).
3. **Determinism (rooms run in lockstep):** every chance is rolled on
   `this.rng` inside the world. No `Math.random`, no clock, nothing read
   from `events`. Do not gate anything the world keeps (cells, meta, wind)
   on `this.events` - it is cleared once per worker message and a guest steps
   many frames per message. `tests/chem.test.ts` has a test for exactly this;
   it must stay green.
4. `placeable: false` for every new material (sandbox rail must not change;
   a test checks it).
5. Liquids (Br, Hg) are `Cat.LIQUID` with a `disp` (Br 3, Hg 2) and run
   `liquid()` - nothing new in the engine.
6. No new dependencies. No changes to `src/net/`, the playground, or the
   sandbox's materials.
7. Fluid emission (`render/glrenderer.ts` `emissionTable`): F `0xe8e070`
   at 0.08; leave the rest at default except He (`0.03`).

## Where things go

- `src/sim/materials.ts` - ids + `chem(...)` defs in the CHEM LAB block.
- `src/sim/reactions.ts` - rules, grouped under the existing headings
  (halogens, metals in acid, flame tests...), `CHEM` marking.
- `src/modes/chem.ts` - `LAB_ELEMENTS` (symbols exactly as in
  `src/data/elements.json`), rail groups: He and F in GASES; Cs, Ag, Sn, Au
  in METALS; B, Si in NON-METALS; a new **LIQUIDS** group for Br and Hg
  placed after NON-METALS.
- `README.md` - element count (20 -> 30), rule count, a few new table rows
  (Cs, F, Hg + S). Do not touch other sections.
- `src/ui/periodic.ts` - nothing should need to change. If something
  does, say why in the commit message.

## Tests (each one mutation-checked - break the code, see it red, restore)

- The generic tests already cover new rules: every rule fires on contact,
  conditional rules don't fire without their condition. Extend
  "an element alone in a box reacts with nothing" to loop over the new
  element ids too (skip only those that react with the box itself - say
  which and why).
- `tests/periodic.test.ts`: `LAB_ELEMENTS.size` 20 -> 30.
- New, in `tests/chem.test.ts`:
  - caesium in water makes a boom (a `booms` event) and hydrogen;
  - gold in acid is still all there after 600 frames, and so is silver;
  - mercury ends up **under** water (and gold sinks through water);
  - fluorine etches glass (glass count drops);
  - helium rises above hydrogen.
- Report the mutants you ran and that each one went red.

Run tests pinned (from the worktree root):
`npx vitest run --root $PWD --dir $PWD/tests`

## Workflow

- Work in a git worktree, never in `/home/clover/CODEX/pixelforge` itself
  (the maintainer works there):
  ```
  git -C /home/clover/CODEX/pixelforge worktree add /home/clover/CODEX/pixelforge-chemv2 -b feat/chem-v2-elements
  cd /home/clover/CODEX/pixelforge-chemv2
  ln -s ../pixelforge/node_modules node_modules
  ```
- One verified change per commit (e.g. materials + rules for one group,
  then UI, then tests, then README). Typecheck + full suite green on every
  commit.
- Browser check before saying done: `npx vite --port 5182`, drive it with
  agent-browser **muted** (`agent-browser --args "--mute-audio" open ...` -
  close any running browser first or `--args` is ignored). Show: caesium
  in water, mercury pooling under water, fluorine on glass. Headless FPS is
  a software renderer - do not report it as performance.
- CPU budget: a chem scene's `World.step` median must stay under 6 ms
  (bundle a small bench with `npx esbuild ... --bundle --platform=node`,
  not vite-node, which inflates timings ~4x).
- **Do not push, do not merge, do not touch `main`.** When done, message
  the maintainer session (`chem-lab-playground-refactor`) with: the commit
  list, test count before/after, the mutants and results, any `p` you
  changed and why, and anything in this spec you disagreed with.
