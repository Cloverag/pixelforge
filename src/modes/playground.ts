import type { PointerEvt } from '../core/input';
import { Mat } from '../sim/materials';
import { PG_BUMPER } from '../sim/particles';
import { PRESET_INFO } from '../sim/presets';
import type { PgToolMsg, Res } from '../sim/protocol';
import { planSurprise } from '../sim/surprise';
import type { PaletteSection, PgTool, Swatch } from '../ui/hud';
import { Stroke } from './stroke';
import type { CursorLook, ModeController, ModeCtx } from './types';

/** The rail: [tool, label, chip gradient, group, tooltip]. */
const PG_TOOLS: [PgTool, string, string, string, string][] = [
  ['fountain', 'FOUNTAIN', 'linear-gradient(135deg,#7fd8ff 0 50%,#2b7fd4 50% 100%)', 'EMITTERS', 'Streams particles upward from the cursor'],
  ['firework', 'FIREWORK', 'linear-gradient(135deg,#ffe97f 0 50%,#ff9a2b 50% 100%)', 'EMITTERS', 'Launches a rocket that bursts where you click'],
  ['sparkler', 'SPARKLER', 'linear-gradient(135deg,#fff3b0 0 50%,#ffb22b 50% 100%)', 'EMITTERS', 'Hold for a crackle of gold sparks'],
  ['hose', 'HOSE', 'linear-gradient(135deg,#9fe8ff 0 50%,#3b8cff 50% 100%)', 'EMITTERS', 'Drag to spray the way you are moving'],
  ['fireflies', 'FIREFLIES', 'linear-gradient(135deg,#f4ff9f 0 50%,#9fd43b 50% 100%)', 'EMITTERS', 'Release slow, blinking fireflies'],
  ['attract', 'ATTRACT', 'linear-gradient(135deg,#9ff7ea 0 50%,#2ea996 50% 100%)', 'FORCES', 'Pulls nearby particles in'],
  ['repel', 'REPULSE', 'linear-gradient(135deg,#ffa8c6 0 50%,#d43e77 50% 100%)', 'FORCES', 'Pushes nearby particles away'],
  ['vortex', 'VORTEX', 'linear-gradient(135deg,#e0f79f 0 50%,#8fc42b 50% 100%)', 'FORCES', 'Swirls particles around the cursor'],
  ['blackhole', 'BLACK HOLE', 'radial-gradient(circle,#000 0 35%,#ffb36b 40% 55%,#3a2410 60%)', 'FORCES', 'Pulls everything in and swallows it'],
  ['wall', 'WALL', 'linear-gradient(135deg,#a0a0bc 0 50%,#5c5c72 50% 100%)', 'TOOLS', 'Draw a solid barrier'],
  ['bumper', 'BUMPER', 'linear-gradient(135deg,#c8f4ff 0 50%,#5fb0d0 50% 100%)', 'TOOLS', 'A bouncy wall that plays a note when hit - higher up, higher pitch'],
  ['portal', 'PORTAL', 'linear-gradient(135deg,#ffb066 0 50%,#4cb4ff 50% 100%)', 'TOOLS', 'Click twice to open a linked pair - what goes in one comes out the other'],
  ['erase', 'ERASE', 'linear-gradient(135deg,#ff8a8a 0 50%,#a82c2c 50% 100%)', 'TOOLS', 'Clear walls and particles'],
];

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
    this.tool = 'fountain';
    const swatches = (group: string): Swatch[] =>
      PG_TOOLS.filter((t) => t[3] === group).map(([id, label, chip, , title]) => ({
        id,
        label,
        chip,
        title,
        info: [id.toUpperCase(), '', title, chip],
      }));
    const sections: PaletteSection[] = ['EMITTERS', 'FORCES', 'TOOLS'].map((g) => ({ label: g, swatches: swatches(g) }));
    // demo scenes, one click each
    sections.push({
      label: 'SCENES',
      cls: 'scenebtns',
      buttons: [
        ...PRESET_INFO.map((p) => ({ label: p.label, title: p.tip, onClick: () => this.loadPreset(p.id) })),
        { label: 'SURPRISE ME', title: 'A brand-new generated scene, every time (R)', onClick: () => this.surprise(), cls: 'surprise' },
      ],
    });
    // world-wide actions: things that are not a brush
    sections.push({
      label: 'ACTIONS',
      cls: 'toolbtns',
      buttons: [
        { label: 'GRAVITY', title: 'Particles fall (G)', onClick: () => this.setGravity(!this.gravityOn), lamp: 'gravity', on: this.gravityOn },
        { label: 'SLOW-MO', title: 'Run the playground at a third of the speed (Q)', onClick: () => this.setSlowmo(!this.slowmo), lamp: 'slowmo', on: this.slowmo },
        { label: 'CLEAR', title: 'Remove everything: particles, forces, portals, walls and bumpers (X)', onClick: () => this.clear() },
      ],
    });
    this.ctx.hud.buildPalette(
      {
        sections,
        initial: 'fountain',
        onPick: (id) => {
          this.tool = id as PgTool;
          this.ctx.sfx.ui();
        },
        bucket: false,
        counts: 'particles',
      },
      this.ctx.brush(),
    );
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
      this.ctx.hud.setLamp('gravity', this.gravityOn);
    }
    if (r.pgTime !== undefined && r.pgTime < 1 !== this.slowmo) {
      this.slowmo = r.pgTime < 1;
      this.ctx.hud.setLamp('slowmo', this.slowmo);
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
    this.ctx.hud.setLamp('gravity', on);
    if (quiet) return;
    this.ctx.sfx.ui();
    this.ctx.toast(`GRAVITY ${on ? 'ON' : 'OFF'}`);
  }

  private setSlowmo(on: boolean): void {
    this.slowmo = on;
    this.ctx.send({ k: 'pgTime', scale: on ? 0.33 : 1 });
    this.ctx.hud.setLamp('slowmo', on);
    this.ctx.sfx.slowmo(on);
  }

  private clear(): void {
    this.ctx.send({ k: 'pgClear' });
    this.ctx.sfx.ui();
  }
}
