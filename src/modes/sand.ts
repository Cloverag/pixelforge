import type { PointerEvt } from '../core/input';
import type { ChallengeDef } from '../sim/challenges';
import { Mat } from '../sim/materials';
import { materialSections } from '../ui/hud';
import { Stroke } from './stroke';
import type { CursorLook, ModeController, ModeCtx } from './types';

/**
 * The sandbox, and each challenge: paint materials into the cellular world.
 * A challenge is the same screen with a short palette, budgets and a goal.
 */
export class SandMode implements ModeController {
  readonly id = 'sand';
  readonly roomName = 'SANDBOX';
  readonly cinematic = false;
  readonly view3d = 'voxel';
  readonly saveable: boolean;
  readonly challengeId: string | null;
  readonly keys: Record<string, () => void>;
  /** the selected material; -1 is the eraser */
  private selMat: number = Mat.SAND;
  private stroke: Stroke;

  constructor(
    private ctx: ModeCtx,
    private challenge: ChallengeDef | null = null,
  ) {
    // a challenge has its own start state; saving or sharing one would hand
    // someone a half-solved puzzle
    this.saveable = !challenge;
    this.challengeId = challenge?.id ?? null;
    this.stroke = new Stroke(ctx);
    const toggle = (k: 'flood' | 'wind') => () => ctx.setPaintKind(ctx.paintKind() === k ? 'brush' : k);
    this.keys = { f: toggle('flood'), w: toggle('wind') };
    // 1-9 pick a palette swatch (3 never gets here: it is the 3D view)
    for (let n = 1; n <= 9; n++)
      this.keys[String(n)] = () => document.querySelectorAll<HTMLElement>('#palette .swatch')[n - 1]?.click();
  }

  start(): void {
    const ch = this.challenge;
    if (ch) {
      this.ctx.post({ t: 'loadChallenge', id: ch.id });
      this.ctx.toast(ch.hint);
    } else {
      this.ctx.post({ t: 'toSandbox' });
    }
  }

  buildUI(): void {
    const ch = this.challenge;
    this.ctx.hud.buildPalette(
      {
        sections: materialSections(ch?.allowed ?? null),
        initial: String(ch?.allowed[0] ?? Mat.SAND),
        onPick: (id) => {
          this.selMat = Number(id);
          this.ctx.sfx.ui();
        },
        bucket: true,
        counts: 'cells',
      },
      this.ctx.brush(),
    );
  }

  onPointer(e: PointerEvt): void {
    this.stroke.at(e, e.button === 2 || this.selMat === -1 ? Mat.EMPTY : this.selMat);
  }

  leave(): void {
    this.stroke.end();
  }

  cursor(pointerDown: boolean, button: number): CursorLook {
    const kind = this.ctx.paintKind();
    const erasing = this.selMat === -1 || this.selMat === Mat.EMPTY || (pointerDown && button === 2);
    return {
      m: this.selMat < 0 ? 0 : this.selMat,
      k: kind === 'wind' ? 'w' : kind === 'flood' ? 'f' : erasing ? 'e' : 'b',
    };
  }
}
