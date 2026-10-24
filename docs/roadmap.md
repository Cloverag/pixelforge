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
| 2026-10-24 | NUCLEAR in the chem lab: uranium, plutonium, neutrons, boron rods; CRITICAL MASS + REACTOR experiments |
| 2026-10-24 | MATH LAB: YOUR CURVE formulas, MATH FLOWERS, PYTHON with turtle, 3D view, design links |
| 2026-10-24 | MATH LAB 3D GRAPHS: rose surface, ripple, saddle, waves (drag to turn); menu previews for SANDBOX + MATH LAB |
| 2026-10-24 | MATH LAB: heart, butterfly, rosette, sphere, tree drawn stroke by stroke beside their code, with sliders |
| 2026-10-24 | ASCII Garden: flowers, EYE OF WORDS, 3D LILY as coloured text; title-screen preview; ASCII lamp in every mode; README with new GIFs |

## Next

1. **Garden 2** - share a garden as a link (done); next: falling petals, a
   vase, draw your own bouquet shape, play together in a garden room.
2. **Make it educational** - MATH LAB is the first step (drawings with their
   code and sliders). Next: more drawings (spirograph, Fibonacci spiral,
   Lissajous), a chem-lab "what happened" card per reaction, simple lessons.
3. **Lighting tune-up** - from real-device FPS: quality levels for RAY
   (rays per texel, resolution), light from the playground's particles,
   coloured shadows through glass.

## Later

- Challenges audit and new challenges built for the light engine (light a
  cave, cross the river at night).
- Molecule cards in the chem lab.
- Performance of very large reactive scenes (a 61k-cell soup takes ~15 ms a step).
- Phone polish pass on every mode.
