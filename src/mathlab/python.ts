import type { Stroke } from './drawings';

/** What a Python run gives back: the lines drawn, what it printed, or what went wrong. */
export interface PyResult {
  strokes: Stroke[];
  prints: string[];
  error?: string;
}

/** a run that takes longer than this is stopped (an endless loop, most likely) */
const TIMEOUT_MS = 15000;

/**
 * Runs MATH LAB's Python in its own worker (py.worker.ts), made on the first
 * RUN. A run that does not finish in time ends the worker; the next RUN makes
 * a new one.
 */
export class PyRunner {
  private worker: Worker | null = null;

  run(code: string, status: (text: string) => void): Promise<PyResult> {
    this.worker ??= new Worker(new URL('./py.worker.ts', import.meta.url), { type: 'module' });
    const w = this.worker;
    return new Promise((resolve) => {
      let timer = 0;
      const finish = (r: PyResult) => {
        window.clearTimeout(timer);
        w.onmessage = null;
        resolve(r);
      };
      // the clock starts once Python is loaded: the first download can take a while
      const arm = () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          w.terminate();
          this.worker = null;
          finish({ strokes: [], prints: [], error: `stopped after ${TIMEOUT_MS / 1000} s - is there a loop that never ends?` });
        }, TIMEOUT_MS);
      };
      w.onmessage = (e: MessageEvent) => {
        const m = e.data;
        if (m.t === 'status') {
          status(m.text);
          if (m.text.startsWith('running')) arm();
        } else if (m.t === 'done') {
          finish({
            prints: m.prints,
            strokes: (m.strokes as [number, number, number, number, string, number, number][]).map(([x1, y1, x2, y2, col, wd, line]) => ({ x1, y1, x2, y2, col, w: wd, line })),
          });
        } else if (m.t === 'error') finish({ strokes: [], prints: m.prints, error: m.error });
      };
      w.onerror = () => {
        this.worker = null;
        finish({ strokes: [], prints: [], error: 'Python could not load - is the internet on?' });
      };
      w.postMessage({ code });
    });
  }
}
