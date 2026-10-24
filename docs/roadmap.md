# PIXELFORGE roadmap

Live: https://cloverag.github.io/pixelforge/ (deployed from `main` by CI).

## Shipped

| When | What |
|------|------|
| 2026-10 | Sandbox, particle playground, 7 challenges, multiplayer rooms (lockstep) |
| 2026-10 | Chem lab: 40 elements on a periodic table, 70 reactions, 3 experiments |
| 2026-10-24 | Redesign R1-R3: arcade title screen, CC0 sound + adaptive music, pause menu |
| 2026-10-24 | Arcade cabinet UI: marquee with modes, materials panel, control deck (VIEW, SKY, SOUND, WORLD) |
| 2026-10-24 | Pixel and light engine: crisp cells, cell shading, sun and moon shadows, day/night cycle, clear water, path-traced light (RAY) |

## Next

1. **ASCII Garden** (in progress) - a fourth playground: vector flowers
   (lilies, tulips, daisies, roses, sunflowers) drawn as coloured ASCII text,
   like the "ASCII lily bouquet" demos. Plant flowers with a click, or make a
   whole bouquet; flowers bloom and sway; ASCII on/off and glyph size on the
   panel. Solo first.
2. **Garden 2** - draw your own bouquet shape, a vase, falling petals, save and
   share a bouquet as a link, play together in a garden room.
3. **Lighting tune-up** - from real-device FPS: quality levels for RAY
   (rays per texel, resolution), light from the playground's particles,
   coloured shadows through glass.
4. **README + docs** - describe the light engine and the garden.

## Later

- Challenges audit and new challenges built for the light engine (light a
  cave, cross the river at night).
- Molecule cards in the chem lab.
- Performance of very large reactive scenes (a 61k-cell soup takes ~15 ms a step).
- Phone polish pass on every mode.
