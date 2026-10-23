# Spec: redesign R2 - sound and music

Status: **assigned to the coder session** (branch `feat/redesign-r2-audio`).
Maintainer: session `chem-lab-playground-refactor` - reviews, merges.
Read `docs/specs/redesign-roadmap.md` first.

Raghav's pick: **real game SFX from free CC0 packs (Kenney.nl) + a
procedural soundtrack that changes with the mode.** Neither the maintainer
nor you can listen: everything below is verified by measurement, and
**Raghav listens before it ships** (no deploy on review alone).

## Today (read these first)

- `src/game/audio.ts` (`Sfx`, ~450 lines): its own `AudioContext`, all
  sounds synthesized. Two kinds:
  - **one-shots**: `ui`, `uiMove/uiSelect/uiBack/uiDeny` (R1 placeholders),
    `place`, `boom`, `fuse`, `zap`, `ignite`, `sizzle`, `fireworkLaunch`,
    `emote`, `win`, `lose`, `star`;
  - **sim-driven voices** that follow the world: `playground(stats)` (jet
    hiss, force hum, black-hole rumble, ambient pad), `crackle(fire)`,
    `crackleTail`, bumper notes, firefly chimes, `slowmo`.
- `src/game/music.ts`: a 16-step chiptune loop on a **second**
  `AudioContext`, off by default, MUSIC toggle only.

## 1. One audio graph, three volumes

- One `AudioContext` for everything (music joins the `Sfx` context).
  Buses: `master -> destination`, `sfx -> master`, `music -> master`.
- Volumes `master`, `music`, `sfx`, each 0-10, persisted in localStorage
  (one key, JSON, parsed defensively: anything invalid falls back to the
  defaults **master 8, music 5, sfx 8**). Gain = (v/10)^2 (perceptual).
- OPTIONS (R1's submenu) replaces `SOUND EFFECTS: ON` / `MUSIC: ON` with
  `MASTER VOLUME`, `MUSIC VOLUME`, `EFFECTS VOLUME`, each shown as a 10-cell
  bar (`■■■■■□□□□□`) and changed with Left/Right (Enter steps up and wraps
  0->10 for mouse/touch users). Moving one plays a `uiMove` at the new level
  so you hear it.
- The topbar SFX and MUSIC buttons stay: they mute/unmute their bus
  (remembering the level). `M` mutes everything (master), as a game's mute
  key does.
- Hidden tab = silent, as today.

## 2. Sample one-shots (Kenney, CC0)

- Packs from https://kenney.nl (all CC0): **Interface Sounds** (UI),
  **Impact Sounds** (thuds), **Sci-Fi Sounds** (zaps, explosions,
  whooshes), **Music Jingles** (win / lose / star). Download them, open each
  `License.txt`, and **confirm it says CC0** before using a file. Commit the
  chosen files only (not whole packs) under `public/sfx/` or
  `src/assets/sfx/`, plus one `src/assets/sfx/LICENSE.md` listing every
  file, its pack, and "CC0 1.0, kenney.nl".
- Map (pick by ear-proxy: short, clean, not shrill - and say what you
  picked per slot):

  | Slot | From | Notes |
  |------|------|-------|
  | uiMove | Interface | a soft tick |
  | uiSelect | Interface | a confirm |
  | uiBack | Interface | a soft back/close |
  | uiDeny | Interface | an error buzz, quiet |
  | ui (game buttons) | Interface | a click |
  | place | Impact (light) | very soft, it fires on every brush stroke |
  | boom | Sci-Fi explosions | 2-3 sizes picked by radius |
  | fireworkLaunch | Sci-Fi | a whoosh |
  | zap | Sci-Fi | a short electric zap |
  | win / lose / star | Music Jingles | short jingles |

  Keep the **synthesized** versions of `fuse`, `ignite`, `sizzle`,
  `emote`, and all the sim-driven voices: they follow the simulation and
  are already shaped to it. If a sample does not beat the synth for a slot,
  keep the synth and say so.
- Variety: slots with several files pick one at random **without
  repeating the last**, and vary playback rate ±5%. Throttles stay as
  today (`lastBoom` etc).
- **Loading**: samples are fetched and decoded after the first user
  gesture (R1's PRESS START, or the first click/key in a restored game) -
  never in the entry bundle, never before a gesture. **A sample that fails
  to load or decode falls back to the existing synth sound for that slot**
  (Safari and old browsers must never go silent).
- Budget: all sample files together **<= 600 KB**. Prefer the packs' `.ogg`;
  if any target browser cannot decode it, the fallback rule covers it.

## 3. Adaptive procedural music

One scheduler (keep `music.ts`'s lookahead design), several **tracks**, one
per screen. A track is data: tempo, a 4-8 chord progression, and 2-4 voices
built from oscillators + filters + the existing noise buffer.

| Screen | Feel | Tempo | Notes |
|--------|------|-------|-------|
| title | slow arpeggio over a pad, hopeful | ~90 | A minor / C major |
| sandbox + challenges | calm, warm keys, soft brushed beat | ~84 | |
| playground | spacey: sparse bells and a long reverb-ish delay | free / ~70 | must sit **under** the playground's own ambient pad and hums (sfx bus) - sparse, no drums |
| chem lab | bubbly plucks, light percussion | ~100 | |

- **Crossfade** 1.5 s when the screen changes (menu -> game, mode switch,
  a room switch).
- **Adaptive**: one parameter per track, smoothed over ~2 s:
  playground = particle count opens a low-pass filter; chem lab =
  reactions/s (R1's readout already computes it) adds a percussion layer;
  sandbox = fire/explosion activity (`r.counts` FIRE+EMBER, or booms) brings
  in a low drone. Keep it subtle.
- Music is **on by default** at volume 5, starting on the first gesture.
- Off-key protection: every note comes from the track's current chord or
  its scale - no free random pitches.

## Hard constraints

1. No simulation change. Audio only listens.
2. No new npm dependency (Web Audio is enough).
3. Nothing audible before a user gesture; nothing audible from a hidden tab.
4. The entry bundle does not grow by more than ~6 kB gzip; samples load
   lazily (report the numbers).
5. Delete what the new code replaces: the second AudioContext, the old
   MUSIC on/off logic, the replaced synth one-shots (keep a synth only
   where it is a fallback or still the chosen sound).

## Tests (mutation-check each)

Pure pieces as pure functions, unit-tested:
- volume parse/clamp/defaults and the gain curve;
- the no-repeat random picker;
- the track scheduler's note choice stays inside the chord/scale for
  every step of every track (a test that would fail on an off-key note);
- the crossfade gain ramp (start, middle, end values).

## Verification (send the numbers back)

You cannot listen, so measure:
- Network: every sample file 200 and decoded (count decodes ok/failed);
  forced decode failure (a mutant) -> the synth plays for that slot.
- Gains: after OPTIONS changes, read the bus gains and report them for
  0, 5, 10.
- Crossfade: sample the two tracks' gains every 250 ms across a menu ->
  sandbox transition.
- Silence: no audio node started before the first gesture (wrap
  `AudioContext` creation / `start()` calls in the test page), and none
  while `document.hidden`.
- Bundle: entry gzip before/after; total sample bytes.
- Then **record 20 s of each screen's music** to a file (an
  `OfflineAudioContext` render of each track, or a `MediaRecorder` on the
  master bus) and put the 4 files in your scratchpad, so Raghav can listen.

## Workflow

Branch `feat/redesign-r2-audio` from current main in your worktree, one
verified change per commit (bus + volumes; samples; music engine; tracks),
no push, no merge. Report to `chem-lab-playground-refactor` with the
numbers, the per-slot choices, the 4 music recordings' paths, and anything
you disagree with.
