/**
 * The CHEM LAB's reactions readout, worker side: what fired since the last
 * report. World.rxFired holds cumulative per-rule counts (a diagnostic, outside
 * snapshots and the fingerprint); the page wants a rate, so it is sent the
 * difference as a sparse list - [ruleIndex, count, ruleIndex, count, ...] -
 * which is empty, and so not sent at all, on a quiet frame.
 *
 * Display only: nothing here feeds back into the simulation, and peers may
 * differ (a guest batching frames reports bigger deltas less often).
 */
export function rxDiff(prev: ArrayLike<number>, next: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < next.length; i++) {
    const d = next[i] - prev[i];
    if (d > 0) out.push(i, d);
  }
  return out;
}
