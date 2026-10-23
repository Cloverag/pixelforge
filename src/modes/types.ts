import type { PointerEvt } from '../core/input';
import type { Sfx } from '../game/audio';
import type { Mode, NetInput, PaintKind, Req, Res } from '../sim/protocol';
import type { Hud } from '../ui/hud';

/** What a mode may use from the app: main.ts owns the loop, rooms and views. */
export interface ModeCtx {
  readonly hud: Hud;
  readonly sfx: Sfx;
  post(msg: Req): void;
  /** a player action: a room input when playing together, else straight to the worker */
  send(inp: NetInput): void;
  toast(text: string, bad?: boolean): void;
  brush(): number;
  /** BRUSH / BUCKET / WIND, shared by every mode's brush column */
  paintKind(): PaintKind;
  setPaintKind(k: PaintKind): void;
  /** paused: step once, so an action still shows */
  nudge(): void;
  /** what this screen's music adapts to (the chem lab: reactions per second) */
  musicAdapt(v: number): void;
}

/** Cursor fields a room shares: material colour and tool mark. */
export interface CursorLook {
  m: number;
  k: 'b' | 'e' | 'w' | 'f';
}

/**
 * One kind of game screen. main.ts asks the current mode instead of
 * branching on which one it is, so a new mode is a new file plus one entry
 * in the registry.
 */
export interface ModeController {
  /** the world the worker runs for it */
  readonly id: Mode;
  /** the HUD's mode label */
  readonly label: string;
  /** what a room switch toast calls it: THE ROOM IS NOW IN THE ... */
  readonly roomName: string;
  /** film-look renderer (bloom, tone mapping) */
  readonly cinematic: boolean;
  /** SAVE / LOAD / SHARE and the autosave */
  readonly saveable: boolean;
  /** which 3D view the 3 key opens */
  readonly view3d: 'voxel' | 'scene';
  /** set while this is a challenge: rooms never switch out of one */
  readonly challengeId: string | null;
  /** keys this mode answers in game, after the global ones */
  readonly keys: Record<string, () => void>;
  /** solo: give the worker this mode's fresh world */
  start(): void;
  /** build this mode's palette; the world is not touched (a room switch) */
  buildUI(): void;
  onPointer(e: PointerEvt): void;
  /** back to the menu: drop any stroke or held tool */
  leave(): void;
  /** after each step is sent: tools that keep emitting while held */
  tick?(frameNo: number): void;
  /** every frame from the worker */
  onFrame?(r: Res): void;
  /** ESC in game: true if the mode used it (closed a panel of its own) */
  onEscape?(): boolean;
  /** a blast at this stereo pan, for mode-specific sound */
  onBoom?(pan: number): void;
  cursor(pointerDown: boolean, button: number): CursorLook;
}
