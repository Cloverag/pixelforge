import type { PointerEvt } from '../core/input';
import { Mat } from '../sim/materials';
import { PG_BUMPER } from '../sim/particles';
import { PRESET_INFO } from '../sim/presets';
import type { PgToolMsg, Res } from '../sim/protocol';
import { planSurprise } from '../sim/surprise';
import type { PgTool } from '../ui/hud';
import { Stroke } from './stroke';
import type { CursorLook, ModeController, ModeCtx } from './types';

/** Tools that keep emitting while the button is held, even standing still. */
const HELD_TOOLS = new Set<PgTool>(['fountain', 'sparkler', 'hose', 'fireflies']);

/** The particle playground: emitters, forces, portals, bumpers and scenes. */
export class PlaygroundMode implements ModeController {
  readonly id = 'playground';
  readonly label = 'PARTICLE PLAYGROUND';
  readonly roomName = 'PLAYGROUND';
  readonly cinematic = true;
  // deliberately throwaway: no save, no autosave
  readonly saveable = false;
  readonly view3d = 'scene';
  readonly challengeId = null;
  readonly keys: Record<string, () => void> = {
    g: () => this.setGravity(!this.gravityOn),
    q: () => this.setSlowmo(!this.slowmo),
    x: () => this.clear(),
    r: () => this.surprise(),
  };
  private tool: PgTool = 'fountain';
  private held = false;
  private last = { x: 240, y: 128 };
  /** the hose's spray direction, worked out here: the simulation is shared */
  private hoseFrom = { x: 0, y: 0 };
  private hoseDir = { x: 0, y: -1 };
  private gravityOn = true;
  private slowmo = false;
  private stroke: Stroke;

  constructor(private ctx: ModeCtx) {
    this.stroke = new Stroke(ctx);
  }

  start(): void {
    this.ctx.post({ t: 'input', inp: { k: 'mode', m: 'playground' } });
  }

  buildUI(): void {
    const hud = this.ctx.hud;
    this.tool = 'fountain';
    hud.buildPgPalette('fountain', this.ctx.brush(), {
      onTool: (t) => {
        this.tool = t;
        this.ctx.sfx.ui();
      },
      onGravity: () => this.setGravity(!this.gravityOn),
      onSlowmo: () => this.setSlowmo(!this.slowmo),
      onClear: () => this.clear(),
      presets: PRESET_INFO.map((p) => [p.id, p.label, p.tip]),
      onPreset: (id) => this.loadPreset(id),
      onSurprise: () => this.surprise(),
    });
    hud.setGravityLamp(this.gravityOn);
    hud.setSlowmoLamp(this.slowmo);
  }

  onPointer(e: PointerEvt): void {
    const tool: PgTool = e.button === 2 ? 'erase' : this.tool;
    if (e.phase === 'up') {
      this.held = false;
      return;
    }
    this.last = { x: e.x, y: e.y };
    if (tool === 'wall' || tool === 'bumper') {
      this.stroke.at(e, tool === 'bumper' ? PG_BUMPER : Mat.WALL);
      return;
    }
    const kind = tool === 'attract' ? 'attractor' : tool === 'repel' ? 'repulsor' : tool;
    this.held = HELD_TOOLS.has(tool);
    const msg: PgToolMsg = { kind, x: e.x, y: e.y, phase: e.phase };
    if (kind === 'hose') {
      // the spray follows the drag; held still, it keeps its last direction
      if (e.phase === 'down') this.hoseFrom = { x: e.x, y: e.y };
      const dx = e.x - this.hoseFrom.x;
      const dy = e.y - this.hoseFrom.y;
      const d = Math.hypot(dx, dy);
      if (d > 2) {
        this.hoseDir = { x: dx / d, y: dy / d };
        this.hoseFrom = { x: e.x, y: e.y };
      }
      msg.dx = this.hoseDir.x;
      msg.dy = this.hoseDir.y;
    }
    this.ctx.send({ k: 'pg', tool: msg });
    if (tool === 'firework' && e.phase === 'down') this.ctx.sfx.fireworkLaunch();
    this.ctx.nudge();
  }

  leave(): void {
    this.stroke.end();
    this.held = false;
  }

  tick(frameNo: number): void {
    if (!this.held || !HELD_TOOLS.has(this.tool)) return;
    // fireflies trickle out; the jets fire every step
    const kind = this.tool as 'fountain' | 'sparkler' | 'hose' | 'fireflies';
    if (kind === 'fireflies' && frameNo % 8 !== 0) return;
    const tool: PgToolMsg = { kind, x: this.last.x, y: this.last.y, phase: 'move' };
    if (kind === 'hose') {
      tool.dx = this.hoseDir.x;
      tool.dy = this.hoseDir.y;
    }
    this.ctx.send({ k: 'pg', tool });
  }

  /** the world's gravity and speed, so every player's lamps agree */
  onFrame(r: Res): void {
    if (r.pgGravity !== undefined && r.pgGravity !== this.gravityOn) {
      this.gravityOn = r.pgGravity;
      this.ctx.hud.setGravityLamp(this.gravityOn);
    }
    if (r.pgTime !== undefined && r.pgTime < 1 !== this.slowmo) {
      this.slowmo = r.pgTime < 1;
      this.ctx.hud.setSlowmoLamp(this.slowmo);
    }
  }

  onBoom(pan: number): void {
    this.ctx.sfx.crackleTail(pan);
  }

  cursor(): CursorLook {
    const t = this.tool;
    return { m: t === 'wall' ? Mat.WALL : t === 'bumper' ? PG_BUMPER : 0, k: t === 'erase' ? 'e' : 'b' };
  }

  /**
   * SURPRISE ME: a brand-new generated scene. The seed goes to the worker,
   * which builds the same plan; this reads the plan only for name and gravity.
   */
  surprise(): void {
    const seed = (Math.random() * 0x7fffffff) | 0;
    const plan = planSurprise(seed);
    this.ctx.send({ k: 'pgSurprise', seed });
    this.setGravity(plan.gravity, true);
    this.ctx.sfx.ui();
    this.ctx.toast(`SURPRISE: ${plan.name}`);
  }

  /** Replace the playground with a demo scene; it sets its own gravity. */
  private loadPreset(id: string): void {
    const p = PRESET_INFO.find((q) => q.id === id);
    if (!p) return;
    this.ctx.send({ k: 'pgPreset', id });
    this.setGravity(p.gravity, true);
    this.ctx.sfx.ui();
    this.ctx.toast(`SCENE: ${p.label}`);
  }

  private setGravity(on: boolean, quiet = false): void {
    this.gravityOn = on;
    this.ctx.send({ k: 'pgGravity', on });
    this.ctx.hud.setGravityLamp(on);
    if (quiet) return;
    this.ctx.sfx.ui();
    this.ctx.toast(`GRAVITY ${on ? 'ON' : 'OFF'}`);
  }

  private setSlowmo(on: boolean): void {
    this.slowmo = on;
    this.ctx.send({ k: 'pgTime', scale: on ? 0.33 : 1 });
    this.ctx.hud.setSlowmoLamp(on);
    this.ctx.sfx.slowmo(on);
  }

  private clear(): void {
    this.ctx.send({ k: 'pgClear' });
    this.ctx.sfx.ui();
  }
}
