/// <reference lib="webworker" />
import { SIM_H, SIM_W, Req, Res, SaveData } from './protocol';
import { World } from './world';
import { PG_BG } from './particles';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let world: World | null = null;
/** worker-side authoritative pixel buffer */
let master: Uint32Array | null = null;
let forceFull = true;
let watch3d = false;

function respond(res: Res, transfer?: ArrayBuffer[]): void {
  ctx.postMessage(res, transfer ?? []);
}

ctx.onmessage = (e: MessageEvent<Req>) => {
  const msg = e.data;
  if (!world) {
    if (msg.t !== 'init') return;
    world = new World(1337);
    master = new Uint32Array(msg.buf);
    forceFull = true;
    respond({ t: 'ready' });
    return;
  }
  const w = world;

  switch (msg.t) {
    case 'init':
      break;

    case 'mode': {
      w.mode = msg.mode;
      if (msg.mode === 'playground') {
        w.challenge = null;
        w.clear();
        w.parts?.reset();
      } else {
        w.parts?.reset();
      }
      forceFull = true;
      break;
    }

    case 'paint':
      w.paint(msg.pts, msg.mat, msg.size, msg.kind ?? 'brush');
      break;

    case 'pg':
      w.parts?.tool(msg.tool);
      break;

    case 'pgGravity':
      if (w.parts) w.parts.gravityOn = msg.on;
      break;

    case 'watch3d':
      watch3d = msg.on;
      break;

    case 'step': {
      const pix = new Uint32Array(msg.buf);
      w.step();
      if (w.mode === 'playground' && w.parts && master) {
        // trails are authoritative on master; copy the finished frame out
        if (forceFull) master.fill(PG_BG);
        w.parts.fullRender(master, false, w.f);
        pix.set(master);
      } else {
        w.renderInto(pix, forceFull);
      }
      forceFull = false;
      const st = w.stats();
      const res: Res = {
        t: 'frame',
        buf: msg.buf,
        counts: st.counts,
        used: st.used,
        budget: st.budget,
        shake: w.shake,
        result: w.challenge && w.challenge.done ? w.challenge.result : null,
      };
      const transfer = [msg.buf];
      if (watch3d && w.f % 3 === 0) {
        // downsampled material map for the 3D voxel view
        const sw = SIM_W >> 1;
        const sh = SIM_H >> 1;
        const snap = new Uint8Array(sw * sh);
        const cells = w.grid.cells;
        for (let y = 0; y < sh; y++) {
          const src0 = (y * 2) * SIM_W;
          const dst0 = y * sw;
          for (let x = 0; x < sw; x++) snap[dst0 + x] = cells[src0 + x * 2];
        }
        res.snap = snap.buffer;
        res.snapW = sw;
        res.snapH = sh;
        transfer.push(snap.buffer);
      }
      respond(res, transfer);
      break;
    }

    case 'clear':
      w.clear();
      forceFull = true;
      break;

    case 'loadChallenge':
      if (w.loadChallenge(msg.id)) forceFull = true;
      break;

    case 'toSandbox':
      w.toSandbox();
      forceFull = true;
      break;

    case 'save': {
      const g = w.grid;
      const save: SaveData = {
        w: SIM_W,
        h: SIM_H,
        cells: g.cells.slice(),
        meta: g.meta.slice(),
        frame: w.f,
      };
      respond({ t: 'state', save });
      break;
    }

    case 'load': {
      const d = msg.data;
      if (d.w === SIM_W && d.h === SIM_H) {
        w.grid.cells.set(d.cells);
        w.grid.meta.set(d.meta);
        w.grid.clock.fill(0);
        recount(w);
        w.grid.rebuildEternals();
        w.grid.chunks.wakeAll();
        w.challenge = null;
        w.mode = 'sand';
        forceFull = true;
      }
      break;
    }

    default:
      break;
  }
};

function recount(w: World): void {
  const counts = w.grid.counts;
  counts.fill(0);
  for (let i = 0; i < w.grid.cells.length; i++) counts[w.grid.cells[i]]++;
}

export {};
