import { SANDBOX_SCENES, type SandDemo } from '../game/sanddemos';
import { readSave } from '../game/rle';
import { cancelCountdown, countdown } from '../ui/countdown';
import type { PointerEvt } from '../core/input';
import type { ChallengeDef } from '../sim/challenges';
import { Mat } from '../sim/materials';
import { materialSections } from '../ui/hud';
import { Stroke } from './stroke';
import type { CursorLook, ModeController, ModeCtx } from './types';
import { confirmDialog } from '../ui/dialog';

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
    this.keys = { f: toggle('flood'), w: toggle('wind'), x: () => void this.clear(), k: () => this.detonate(), v: () => this.replay() };
    // 1-9 pick a palette swatch (3 never gets here: it is the 3D view)
    for (let n = 1; n <= 9; n++)
      this.keys[String(n)] = () => document.querySelectorAll<HTMLElement>('#palette .swatch')[n - 1]?.click();
  }

  /** CLEAR: an empty world, after asking - a sandbox can hold hours of building. */
  async clear(): Promise<void> {
    if (this.challengeId) return;
    const ok = await confirmDialog({
      title: 'CLEAR THE WORLD?',
      body: 'Everything here goes - in a room, for everyone. Save first if you want to keep it.',
      ok: 'CLEAR',
      cancel: 'KEEP IT',
    });
    if (!ok) return;
    this.ctx.send({ k: 'clear' });
    this.ctx.sfx.ui();
  }

  /** A ready-made world in place of this one - after asking, if there is anything here to lose. */
  async loadScene(scene: SandDemo, ask = true): Promise<void> {
    if (ask && this.ctx.liveCells() > 0) {
      const ok = await confirmDialog({
        title: `LOAD ${scene.name}?`,
        body: 'It replaces what is here - in a room, for everyone. Save first if you want to keep it.',
        ok: 'LOAD IT',
        cancel: 'KEEP MINE',
      });
      if (!ok) return;
    }
    this.ctx.send({ k: 'clear' });
    for (const s of scene.strokes) this.ctx.send({ k: 'paint', pts: s.pts, mat: s.mat, size: s.size, kind: 'brush' });
    this.ctx.toast(scene.hint ?? `SCENE: ${scene.name}`);
    this.ctx.sfx.ui();
  }

  /** The big red button (K): a 3-2-1, then every charge in the world goes off. */
  detonate(): void {
    if (this.challengeId) return;
    const fired = countdown(
      () => this.ctx.sfx.ui(),
      () => {
        this.ctx.send({ k: 'detonate' });
        if (!this.ctx.inRoom()) window.setTimeout(() => this.ctx.toast('V: INSTANT REPLAY'), 1600);
      },
    );
    if (fired) this.ctx.sfx.uiSelect();
  }

  /** V: the last big red button again, at a third of the speed (V again ends it). */
  replay(): void {
    if (this.challengeId) return;
    if (this.ctx.inRoom()) return this.ctx.toast('INSTANT REPLAY IS FOR SOLO PLAY', true);
    if (this.ctx.replayState() === 0) return this.ctx.toast('NOTHING TO REPLAY YET - PRESS K TO DETONATE', true);
    this.ctx.post({ t: 'replay' });
    this.ctx.sfx.ui();
  }

  start(): void {
    const ch = this.challenge;
    if (ch) {
      this.ctx.post({ t: 'loadChallenge', id: ch.id });
      this.ctx.toast(ch.hint);
    } else {
      this.ctx.post({ t: 'toSandbox' });
      // a first sandbox is not a blank one: it opens on the charged yard
      if (!readSave() && !this.ctx.inRoom()) void this.loadScene(SANDBOX_SCENES[0], false);
    }
  }

  buildUI(): void {
    const ch = this.challenge;
    this.ctx.hud.buildPalette(
      {
        // a challenge is its level: no photo drawn over it
        sections: ch
          ? materialSections(ch.allowed)
          : [
              {
                label: 'PICTURE',
                cls: 'scenebtns',
                buttons: [{ label: 'DRAW A PHOTO', title: 'A photo drawn into the world as lines - wood to burn, stone to pour water over', onClick: () => this.ctx.picture() }],
              },
              {
                label: 'SCENES',
                cls: 'scenebtns',
                buttons: SANDBOX_SCENES.map((sc) => ({ label: sc.name, title: sc.hint ?? sc.name, onClick: () => void this.loadScene(sc) })),
              },
              {
                label: 'BOOM',
                cls: 'scenebtns',
                buttons: [
                  { label: 'DETONATE (K)', title: 'The big red button: 3-2-1, then every C4, TNT and NITRO goes off at once', onClick: () => this.detonate() },
                  { label: 'REPLAY (V)', title: 'Watch the last detonation again at a third of the speed', onClick: () => this.replay() },
                ],
              },
              ...materialSections(null),
            ],
        initial: String(ch?.allowed[0] ?? Mat.SAND),
        onPick: (id) => {
          this.selMat = Number(id);
          this.ctx.sfx.ui();
        },
        bucket: true,
        counts: 'cells',
        hint: 'Pick a material, then draw here',
      },
      this.ctx.brush(),
    );
  }

  onPointer(e: PointerEvt): void {
    this.stroke.at(e, e.button === 2 || this.selMat === -1 ? Mat.EMPTY : this.selMat);
  }

  leave(): void {
    this.stroke.end();
    cancelCountdown();
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
