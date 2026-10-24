/** Every world the simulation can run. A mode's index is its byte in a
 *  packed snapshot, so append new modes - never reorder. */
export const MODES = ['sand', 'playground', 'chem'] as const;
export type Mode = (typeof MODES)[number];

/** What a brush stroke does: place material, flood a region, or blow air. */
export type PaintKind = 'brush' | 'flood' | 'wind';

export const SIM_W = 640;
export const SIM_H = 360;
export const CHUNK = 8;
export const CHUNK_SHIFT = 3;
export const CHUNKS_X = SIM_W / CHUNK;
export const CHUNKS_Y = SIM_H / CHUNK;

export type PgToolKind =
  | 'fountain'
  | 'firework'
  | 'sparkler'
  | 'hose'
  | 'fireflies'
  | 'attractor'
  | 'repulsor'
  | 'vortex'
  | 'blackhole'
  | 'portal'
  | 'erase';

export type PgToolMsg = {
  kind: PgToolKind;
  x: number;
  y: number;
  phase: 'down' | 'move' | 'up';
  /** hose: spray direction, worked out by the player's own game - the
   *  simulation is shared, so it cannot keep one player's last position */
  dx?: number;
  dy?: number;
};

export interface Stats {
  counts: number[];
  used: number[];
  budget: (number | null)[];
}

export interface ChallengeResult {
  id: string;
  status: 'win' | 'lose';
  reason: string;
  stars: number;
  timeFrames: number;
}

export type Req =
  | { t: 'init'; w: number; h: number; buf: ArrayBuffer }
  /** a player action, alone: the same NetInput a room applies at a frame,
   *  so playing solo and playing together run one code path */
  | { t: 'input'; inp: NetInput }
  | { t: 'watch3d'; on: boolean }
  | { t: 'watchFluid'; on: boolean }
  /** presentation only, never a NetInput: the colour the empty world is drawn in */
  | { t: 'bg'; id: string }
  /** draw the current frame again without stepping (a paused world after a presentation change) */
  | { t: 'redraw'; buf: ArrayBuffer }
  /**
   * Step the world. In multiplayer `inputs` holds one batch per frame: each
   * is applied before its step, so a guest that fell behind catches up
   * several frames in one message (one render at the end).
   */
  | { t: 'step'; buf: ArrayBuffer; inputs?: NetInput[][] }
  /** multiplayer: send back a full snapshot (for a joiner) */
  | { t: 'netSnap' }
  /** multiplayer: become this snapshot */
  | { t: 'netRestore'; snap: Snapshot }
  | { t: 'loadChallenge'; id: string }
  | { t: 'toSandbox' }
  | { t: 'save' }
  | { t: 'load'; data: SaveData };

/**
 * Everything the sandbox simulation steps from, for multiplayer: a peer
 * restored from this and fed the same inputs stays identical to the one
 * that took it. (SaveData is only what a player's save needs.)
 */
export interface Snapshot {
  f: number;
  rng: number;
  shadeSeed: number;
  cells: Uint8Array;
  meta: Uint8Array;
  clock: Uint8Array;
  shade: Uint8Array;
  wake: Uint8Array;
  wind: Float32Array;
  /** TNT debris in flight (World.debris); absent in older snapshots */
  debris?: Float64Array;
  /** which world this is; the playground also carries its particle system */
  mode?: Mode;
  pg?: Uint8Array;
}

/** multiplayer: peers compare world fingerprints every this many frames */
export const HASH_EVERY = 60;
/** numbers per fingerprint report: frame, hash, 7 parts */
export const HASH_STRIDE = 10;

/** A player action that changes the shared world, applied at an exact frame. */
export type NetInput =
  | { k: 'paint'; pts: number[]; mat: number; size: number; kind: PaintKind }
  | { k: 'clear' }
  // the playground, shared the same way: every action at an exact frame
  | { k: 'pg'; tool: PgToolMsg }
  | { k: 'pgPreset'; id: string }
  | { k: 'pgSurprise'; seed: number }
  | { k: 'pgClear' }
  | { k: 'pgGravity'; on: boolean }
  | { k: 'pgTime'; scale: number }
  /** the host switches everyone between sandbox and playground */
  | { k: 'mode'; m: Mode }
  /** the chem lab: replace the bench with a ready-made experiment */
  | { k: 'chemScene'; id: string };

export interface SaveData {
  w: number;
  h: number;
  cells: Uint8Array;
  meta: Uint8Array;
  frame: number;
}

/**
 * Things the sim did since the last frame message, for sound and screen
 * effects. Counts, not per-cell records: a burning forest ignites hundreds of
 * cells a second and the listener only needs "how much".
 */
export interface SimEvents {
  /** flat [x, y, radius] triples in sim cells */
  booms: number[];
  ignites: number;
  sizzles: number;
  /** wire pulses fired (leading edges) */
  zaps: number;
  /** TNT cells newly lit */
  fuses: number;
}

export function emptyEvents(): SimEvents {
  return { booms: [], ignites: 0, sizzles: 0, zaps: 0, fuses: 0 };
}

export interface Res {
  t: 'ready' | 'frame' | 'state' | 'netSnap' | 'error';
  /** t 'error': what the worker threw, with its stack */
  error?: string;
  /** multiplayer: a full snapshot, for t 'netSnap' */
  snapshot?: Snapshot;
  /** multiplayer: groups of HASH_STRIDE numbers - frame, fingerprint, then
   *  its 8 parts (World.hashParts) - for frames that are multiples of
   *  HASH_EVERY, so peers can compare worlds and say what differs */
  hashes?: number[];
  /** the world's frame after this step (multiplayer keeps clocks honest) */
  f?: number;
  /** the world's mode: in a room the host can switch everyone */
  mode?: Mode;
  /** playground: gravity on and time scale, so every player's lamps agree */
  pgGravity?: boolean;
  pgTime?: number;
  buf?: ArrayBuffer;
  counts?: number[];
  used?: number[];
  budget?: (number | null)[];
  shake?: number;
  events?: SimEvents;
  /** live particle count, playground only */
  parts?: number;
  /** 3D playground: packed particles (x, y, z, r, g, b) x pgN, transferable */
  pg3d?: ArrayBuffer;
  pgN?: number;
  /** 3D playground: force markers as [kind, x, y] triples */
  pgForces?: number[];
  /** 3D playground: wall mask at half resolution, sent only when it changes */
  pgWalls?: ArrayBuffer;
  /** CHEM LAB only: rules fired since the last frame reported, sparse as
   *  [ruleIndex, count, ...]; absent when nothing fired. Display only. */
  rx?: number[];
  /** playground activity this frame, for the sound design */
  pgStats?: import('./particles').PgStats;
  result?: ChallengeResult | null;
  save?: SaveData | null;
  /** downsampled material map for the 3D view and the fluid (transferable) */
  snap?: ArrayBuffer;
  snapW?: number;
  snapH?: number;
  /** wind field as interleaved RG float pairs, chunk resolution */
  wind?: ArrayBuffer;
}
