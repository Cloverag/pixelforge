# Spec: quick batch 1 - halogens on flowers, and a live reactions readout

Status: **assigned to the coder session** (branch `feat/quick-batch-1`).
Maintainer: session `chem-lab-playground-refactor` - reviews, merges.

Two small things Raghav picked. Both are bounded; neither touches the
engine's behaviour beyond two new rules.

## 1. Fluorine and bromine bleach flowers too

Parked from V2 (your own note): chlorine bleaches `FLORA`, but fluorine and
bromine only bleach `PLANT`. Add, in `src/sim/reactions.ts` beside their
PLANT rules:

| a | b | outA | outB | p | note |
|---|---|------|------|---|------|
| F | FLORA | KEEP | ASH | 0.1 | withers flowers to ash |
| BR | FLORA | KEEP | ASH | 0.03 | bleaches flowers |

The generic "every rule fires" test covers them. README's rule count goes
68 -> 70 (two places: the modes table and "Some of the 68").

## 2. A live reactions readout in the CHEM LAB status bar

What the player sees, chem lab only, in the status bar:

```
| RUNNING | [chip] SODIUM  element Na - fizzes in water... | REACTIONS 1,240/s | NOW potassium bursts into lilac flame in water | ... | 60 FPS |
```

- **REACTIONS n/s**: how many rules fired in the last second, updated about
  4 times a second (a rolling one-second window, not a jumpy per-frame
  number). `0/s` when nothing is happening.
- **NOW ...**: the note of the rule that fired most in the last second, in
  the "sodium: fizzes in water" form that `reactionLines` already uses for
  the other side. If none fired in the last second, the segment is empty or
  hidden, never a stale line from minutes ago. Long lines end in an ellipsis
  inside the segment; it must not push the FPS segment off the bar at 1280 px.
- Hidden in every other mode (sandbox, playground, challenges).

### How (the design is decided)

- **No World change.** `World.rxFired` (per-rule fire counts) already exists
  and is a diagnostic, outside snapshots and the fingerprint. The worker
  keeps a copy of the counts it last reported and sends the **difference**
  each frame, as `Res.rx?: number[]` (sparse is fine: `[ruleIndex, count,
  ruleIndex, count...]`), only when `w.mode === 'chem'` and only when
  non-empty. Never reset `rxFired` itself.
- **This is display only.** It must never feed back into the simulation, and
  it is allowed to differ between players in a room (a guest batching frames
  gets bigger deltas less often - that is fine for a readout). Do not put it
  in snapshots, hashes or `NetInput`.
- `ChemMode.onFrame(r)` accumulates the deltas into a one-second window
  (timestamps from `performance.now()` are fine here: this is the main
  thread, not the simulation) and calls a HUD method about every 250 ms.
- `src/ui/hud.ts`: add a status segment for it, e.g.
  `setReadout(rate: number | null, note: string | null)`; `null` hides it.
  The other modes pass nothing and it stays hidden. Leaving the chem lab
  (any `showMode` to another mode, and the menu) must hide it.
- The note for a rule index: `RULES[i]` gives `a` and `note`; format as
  `${MATS[a].name.toLowerCase()}: ${note}`. Only the rule's own A side - no
  need to pick a side.

## Tests

- `tests/chem.test.ts`: the two new rules are covered by the generic test;
  add nothing unless the generic test misses them (say so if it does).
- A unit test for the readout's window maths, if you put it in a pure
  function (recommended: `src/modes/rxwindow.ts` or similar, taking
  `(now, deltas)` and returning `{ rate, top }`): rate over a 1 s window,
  old samples dropped, `top` is the most-fired rule in the window, empty
  window gives rate 0 and top null. Mutation-check it.
- The worker's delta logic: if you can make it a pure function too
  (`diff(prev, next) -> sparse`), test it; if not, the browser check covers it.

## Verification (send the numbers back)

- Typecheck + full suite on every commit; build.
- Browser, muted, own port, 1920x1080 and 1280x720:
  - chem lab, FLAME TESTS running: the readout shows a steady non-zero rate
    and a flame-test line; report a few sampled values.
  - chem lab, empty, nothing happening: `0/s` and no NOW line.
  - sandbox and playground: the readout is not visible.
  - 1280x720: the FPS segment is still fully on the bar (report its right
    edge vs the bar's).
  - a fluorine cloud over a flower (plant + water grows FLORA - or paint the
    ALKALI BATH's water and some seeds/plants): flowers turn to ash.
- Mutants: one for each new test, plus one that sends the raw cumulative
  counts instead of the delta (the rate should then climb forever - say
  whether a test catches it; if none can, a browser observation is enough).

## Workflow

Same as before: branch from current main
(`git -C /home/clover/CODEX/pixelforge-chemv2 checkout -b feat/quick-batch-1 main`),
one verified change per commit, no push, no merge. Report to
`chem-lab-playground-refactor`.
