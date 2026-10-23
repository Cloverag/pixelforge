# Redesign roadmap (2026-10-24)

Raghav: "my main motive is to redesign the frontend, fix the sandbox
visuals, make it more appealing - it feels like AI slop - make the menu
like literal game menus, add music, recreate the sound design".

His picks:
- **Look: arcade title screen.** Like a real arcade/console game: a huge
  logo, a vertical menu with a moving selection cursor (arrows + Enter),
  PRESS START, the live game running behind.
- **Audio: CC0 packs + adaptive music.** Recorded/produced SFX from free
  CC0 packs (Kenney.nl), plus a procedural soundtrack that changes with the
  mode.
- Visual polish 2 (attract mode, merged @bf46e8d) is the title screen's
  backdrop.

Three batches, in this order, each its own spec, review and deploy:

| # | Batch | What |
|---|-------|------|
| R1 | Title screen | Replace the card-and-panel menu with an arcade title screen: PRESS START, a cursor-driven vertical menu, CHALLENGES and OPTIONS as submenus, keyboard + mouse + touch. Spec: `redesign-r1-title.md`. |
| R2 | Audio | Kenney CC0 SFX in place of the synthesized UI/impact sounds where they are better; an adaptive procedural soundtrack per mode (title, sandbox, playground, chem lab); master / music / SFX volumes in OPTIONS. |
| R3 | In-game screens | The sandbox / playground / chem lab HUD in the same arcade language: what reads as "AI slop" today is the beige panels, tiny letter-spaced labels on everything, LED lamps and bevels on every key. Fewer words, bigger targets, one consistent pixel frame. |

R2 and R3 are written after R1 lands, so they build on what R1 actually
became rather than on a guess.
