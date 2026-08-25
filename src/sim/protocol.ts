export type Mode = 'sand' | 'playground';

export const SIM_W = 640;
export const SIM_H = 360;
export const CHUNK = 8;
export const CHUNK_SHIFT = 3;
export const CHUNKS_X = SIM_W / CHUNK;
export const CHUNKS_Y = SIM_H / CHUNK;

export type PgToolKind =
  | 'fountain'
  | 'firework'
  | 'attractor'
  | 'repulsor'
  | 'vortex'
  | 'erase';

export interface PgToolMsg {
  kind: PgToolKind;
  x: number;
  y: number;
  phase: 'down' | 'move' | 'up';
}

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
  | { t: 'mode'; mode: Mode }
  | { t: 'paint'; pts: number[]; mat: number; size: number; kind?: 'brush' | 'flood' }
  | { t: 'pg'; tool: PgToolMsg }
  | { t: 'pgGravity'; on: boolean }
  | { t: 'watch3d'; on: boolean }
  | { t: 'step'; buf: ArrayBuffer }
  | { t: 'clear' }
  | { t: 'loadChallenge'; id: string }
  | { t: 'toSandbox' }
  | { t: 'save' }
  | { t: 'load'; data: SaveData };

export interface SaveData {
  w: number;
  h: number;
  cells: Uint8Array;
  meta: Uint8Array;
  frame: number;
}

export interface Res {
  t: 'ready' | 'frame' | 'state';
  buf?: ArrayBuffer;
  counts?: number[];
  used?: number[];
  budget?: (number | null)[];
  shake?: number;
  result?: ChallengeResult | null;
  save?: SaveData | null;
  /** downsampled material map for the 3D view (transferable) */
  snap?: ArrayBuffer;
  snapW?: number;
  snapH?: number;
}
