import { SIM_H, SIM_W } from '../sim/protocol';

/**
 * Screen feedback for explosions: shake, kick and flash.
 *
 * The old shake picked a fresh random offset every frame, which reads as a
 * glitch rather than an impact - the eye sees teleporting, not motion. This
 * follows the usual game-feel recipe instead:
 *
 * - **trauma**, not offset, is what blasts add. It decays linearly and the
 *   shake is trauma squared, so small pops barely move the screen while a big
 *   chain really rattles it, and the tail eases out instead of stopping dead.
 * - the motion is **smooth noise** (summed incommensurate sines), so the frame
 *   travels between positions instead of jumping to them.
 * - a **kick** pushes the cabinet away from where the blast happened and a
 *   spring pulls it back, which is what gives a blast a direction.
 * - a **flash** is a radial glow pinned to the blast's position on screen.
 *
 * Everything runs on the main thread from sim events; nothing here touches
 * the simulation.
 */

/** max shake translation in CSS px at trauma 1 */
const MAX_SHIFT = 10;
/** max shake rotation in degrees at trauma 1 */
const MAX_ROT = 1.1;
/** trauma lost per second */
const DECAY = 1.5;
/** kick spring: stiffness and damping per second */
const K = 260;
const DAMP = 17;
/**
 * Kick limits. Without them a chain stacked one impulse per blast and threw
 * the cabinet 44 px across the screen (measured) - a chain should rattle
 * harder via trauma, not travel further.
 */
const MAX_KICK = 9;
const MAX_KICK_V = 260;

export class Juice {
  private trauma = 0;
  private t = 0;
  private kx = 0;
  private ky = 0;
  private vx = 0;
  private vy = 0;
  private flash = 0;
  private fx = 50;
  private fy = 50;
  private last = performance.now();
  private reduced: MediaQueryList;
  private resting = true;

  constructor(
    private shakeEl: HTMLElement,
    private flashEl: HTMLElement,
  ) {
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
  }

  /**
   * A blast at sim cell (x, y) with radius r. Several in one frame (a chain)
   * stack trauma but share one kick direction - the biggest wins.
   */
  boom(x: number, y: number, r: number): void {
    const size = Math.min(1, r / 9);
    this.trauma = Math.min(1, this.trauma + 0.22 + size * 0.32);
    // kick away from the blast, measured from the screen centre
    const dx = x / SIM_W - 0.5;
    const dy = y / SIM_H - 0.5;
    const len = Math.hypot(dx, dy) || 1;
    const push = (6 + size * 10) * 20;
    const clampV = (v: number) => Math.max(-MAX_KICK_V, Math.min(MAX_KICK_V, v));
    this.vx = clampV(this.vx - (dx / len) * push);
    this.vy = clampV(this.vy - (dy / len) * push);
    if (size * 0.7 >= this.flash * 0.8) {
      this.fx = (x / SIM_W) * 100;
      this.fy = (y / SIM_H) * 100;
    }
    this.flash = Math.min(1, this.flash + 0.35 + size * 0.45);
    this.resting = false;
  }

  /** Call once per animation frame. Cheap no-op once everything has settled. */
  frame(): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.resting) return;

    this.t += dt;
    this.trauma = Math.max(0, this.trauma - DECAY * dt);
    this.flash = Math.max(0, this.flash - 4.5 * dt);

    // damped spring back to centre
    this.vx += (-K * this.kx - DAMP * this.vx) * dt;
    this.vy += (-K * this.ky - DAMP * this.vy) * dt;
    this.kx = Math.max(-MAX_KICK, Math.min(MAX_KICK, this.kx + this.vx * dt));
    this.ky = Math.max(-MAX_KICK, Math.min(MAX_KICK, this.ky + this.vy * dt));

    const reduced = this.reduced.matches;
    const s = reduced ? 0 : this.trauma * this.trauma;
    const t = this.t * 38;
    const nx = Math.sin(t * 1.0) * 0.6 + Math.sin(t * 2.31 + 1.7) * 0.4;
    const ny = Math.sin(t * 1.13 + 4.1) * 0.6 + Math.sin(t * 2.67 + 0.3) * 0.4;
    const nr = Math.sin(t * 0.87 + 2.2);
    const kick = reduced ? 0 : 1;
    const tx = nx * MAX_SHIFT * s + this.kx * kick;
    const ty = ny * MAX_SHIFT * s + this.ky * kick;
    const rot = nr * MAX_ROT * s;
    this.shakeEl.style.transform =
      `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) rotate(${rot.toFixed(3)}deg)`;

    const f = reduced ? this.flash * 0.4 : this.flash;
    this.flashEl.style.opacity = f.toFixed(3);
    this.flashEl.style.setProperty('--fx', `${this.fx.toFixed(1)}%`);
    this.flashEl.style.setProperty('--fy', `${this.fy.toFixed(1)}%`);

    const still = this.trauma === 0 && this.flash === 0 &&
      Math.abs(this.kx) + Math.abs(this.ky) + Math.abs(this.vx) + Math.abs(this.vy) < 0.05;
    if (still) {
      this.kx = this.ky = this.vx = this.vy = 0;
      this.shakeEl.style.transform = '';
      this.flashEl.style.opacity = '0';
      this.resting = true;
    }
  }

  reset(): void {
    this.trauma = this.flash = 0;
    this.kx = this.ky = this.vx = this.vy = 0;
    this.shakeEl.style.transform = '';
    this.flashEl.style.opacity = '0';
    this.resting = true;
  }
}
