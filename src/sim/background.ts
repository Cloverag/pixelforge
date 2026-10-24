/**
 * The colour of the empty world behind the materials, picked by the player.
 *
 * Presentation only: it changes how pixels are drawn and never a cell, so it
 * is not in the snapshot, the fingerprint or a room - each player in a room
 * sees their own. The worker draws the frame, so it is told through a
 * presentation Req (not a NetInput); the main thread keeps its own copy for
 * the renderers, the 3D views and the eraser chip. Both threads read the one
 * live `BG` object below, so there is exactly one source for the colour.
 *
 * Presets only, no free picker: fire, glow and bloom are additive light built
 * for a dark world, and a bright free colour would wash them out.
 */

export interface Background {
  id: string;
  /** one word, shown as BACKGROUND: <name> */
  name: string;
  r: number;
  g: number;
  b: number;
}

const bg = (id: string, name: string, hex: number): Background => ({
  id,
  name,
  r: (hex >> 16) & 255,
  g: (hex >> 8) & 255,
  b: hex & 255,
});

/** NIGHT is the colour the game has always had: #0b0b14. */
export const BACKGROUNDS: readonly Background[] = [
  bg('night', 'NIGHT', 0x0b0b14),
  bg('ocean', 'OCEAN', 0x08142c),
  bg('violet', 'VIOLET', 0x180c2c),
  bg('forest', 'FOREST', 0x0a1a10),
  bg('dusk', 'DUSK', 0x2a1426),
  bg('ember', 'EMBER', 0x22100a),
  bg('slate', 'SLATE', 0x1c2128),
  bg('fog', 'FOG', 0x545c6c),
];

export const DEFAULT_BACKGROUND = BACKGROUNDS[0];

/** the preset with this id; anything unknown is NIGHT */
export function backgroundById(id: unknown): Background {
  return BACKGROUNDS.find((b) => b.id === id) ?? DEFAULT_BACKGROUND;
}

/** The preset `d` steps along from `id`, wrapping (+1 next, -1 previous). */
export function stepBackground(id: string, d: number): Background {
  const i = BACKGROUNDS.findIndex((b) => b.id === id);
  const n = BACKGROUNDS.length;
  return BACKGROUNDS[(((Math.max(i, 0) + d) % n) + n) % n];
}

/** ABGR, as the frame buffers hold it (little-endian RGBA bytes) */
export function packAbgr(b: Background): number {
  return ((255 << 24) | (b.b << 16) | (b.g << 8) | b.r) >>> 0;
}

/** The live colour. Mutated in place by setBackground; read wherever empty space is drawn. */
export const BG = {
  id: DEFAULT_BACKGROUND.id,
  r: DEFAULT_BACKGROUND.r,
  g: DEFAULT_BACKGROUND.g,
  b: DEFAULT_BACKGROUND.b,
  /** ABGR */
  u32: packAbgr(DEFAULT_BACKGROUND),
};

/** Make `id` the live background (unknown ids are NIGHT). Returns the preset now live. */
export function setBackground(id: unknown): Background {
  const p = backgroundById(id);
  BG.id = p.id;
  BG.r = p.r;
  BG.g = p.g;
  BG.b = p.b;
  BG.u32 = packAbgr(p);
  return p;
}

/** `#rrggbb` of the live colour (CSS, the 2D canvas) */
export function bgCss(): string {
  return `#${((BG.r << 16) | (BG.g << 8) | BG.b).toString(16).padStart(6, '0')}`;
}

/** How far the live colour sits above NIGHT, per channel and never below 0: what the bloom threshold must clear. */
export function bgLift(): [number, number, number] {
  return [
    Math.max(0, BG.r - DEFAULT_BACKGROUND.r) / 255,
    Math.max(0, BG.g - DEFAULT_BACKGROUND.g) / 255,
    Math.max(0, BG.b - DEFAULT_BACKGROUND.b) / 255,
  ];
}

/**
 * A scene colour that sits at a fixed offset from the world's background: the
 * 3D views keep their own, slightly darker shades, so another background moves
 * them by the same amount NIGHT is from it (NIGHT itself gives `hex` back).
 */
export function bgShifted(hex: number): number {
  const ch = (shift: number, now: number, night: number) => Math.max(0, Math.min(255, ((hex >> shift) & 255) + now - night));
  return (ch(16, BG.r, DEFAULT_BACKGROUND.r) << 16) | (ch(8, BG.g, DEFAULT_BACKGROUND.g) << 8) | ch(0, BG.b, DEFAULT_BACKGROUND.b);
}

const KEY = 'pf-bg';

/** The saved choice; storage blocked, missing or garbage -> NIGHT. */
export function loadBackgroundId(): string {
  try {
    return backgroundById(localStorage.getItem(KEY)).id;
  } catch {
    return DEFAULT_BACKGROUND.id;
  }
}

export function saveBackgroundId(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* private mode: the choice just will not persist */
  }
}
