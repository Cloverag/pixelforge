import { MATS } from '../sim/materials';
import { RULES } from '../sim/reactions';

/**
 * The CHEM LAB readout's maths, kept pure: it is handed the time, never reads
 * a clock. Reaction deltas (the worker's Res.rx, [rule, count, ...]) go in; a
 * rolling window of the last second comes out, so the number does not jump
 * with every frame. Display only - nothing here touches the simulation.
 */

interface Sample {
  t: number;
  rx: number[];
}

export class RxWindow {
  private samples: Sample[] = [];

  constructor(private readonly spanMs = 1000) {}

  /** Record what fired at time `now` (ms). An empty list is nothing. */
  add(now: number, rx: number[]): void {
    if (rx.length) this.samples.push({ t: now, rx });
  }

  /**
   * How many rules fired in the window ending at `now`, and which rule fired
   * most (the lowest index on a tie; null when nothing fired). A sample exactly
   * `spanMs` old has left the window.
   */
  read(now: number): { rate: number; top: number | null } {
    while (this.samples.length && this.samples[0].t <= now - this.spanMs) this.samples.shift();
    const per = new Map<number, number>();
    let rate = 0;
    for (const s of this.samples)
      for (let i = 0; i < s.rx.length; i += 2) {
        per.set(s.rx[i], (per.get(s.rx[i]) ?? 0) + s.rx[i + 1]);
        rate += s.rx[i + 1];
      }
    let top: number | null = null;
    let best = 0;
    for (const [rule, n] of per) if (n > best || (n === best && top !== null && rule < top)) (top = rule), (best = n);
    return { rate, top };
  }
}

/** The line for a rule: "sodium: fizzes in water ...". The rule's own A side only. */
export function readoutNote(rule: number): string {
  const r = RULES[rule];
  return `${MATS[r.a].name.toLowerCase()}: ${r.note}`;
}
