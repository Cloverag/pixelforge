/// <reference lib="webworker" />
import { CHUNKS_X, CHUNKS_Y, HASH_EVERY, SIM_H, SIM_W, Req, Res, SaveData } from './protocol';
import { World } from './world';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let world: World | null = null;
/** worker-side authoritative pixel buffer */
let master: Uint32Array | null = null;
let forceFull = true;
let watch3d = false;
/** the playground's walls changed since the 3D view last got a mask */
let pgWallsDirty = true;
let watchFluid = false;
/** true while the wind field still needs sending after it goes still */
let windDirty = false;

function respond(res: Res, transfer?: ArrayBuffer[]): void {
  ctx.postMessage(res, transfer ?? []);
}

/**
 * An uncaught error in a worker reaches the page as an ErrorEvent with no
 * message, file or line ("sim worker error undefined undefined undefined").
 * Catch it here and send the real message and stack instead.
 */
ctx.onmessage = (e: MessageEvent<Req>) => {
  try {
    handle(e);
  } catch (err) {
    const x = err as Error;
    respond({ t: 'error', error: `${x?.message ?? x} | while handling '${e.data?.t}'\n${x?.stack ?? ''}` });
    throw err;
  }
};

function handle(e: MessageEvent<Req>): void {
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
      pgWallsDirty = true;
      break;

    case 'pg':
      w.parts?.tool(msg.tool);
      if (msg.tool.kind === 'erase') pgWallsDirty = true;
      break;

    case 'pgTime':
      if (w.parts) w.parts.timeScale = msg.scale;
      break;

    case 'netSnap':
      respond({ t: 'netSnap', snapshot: w.snapshot() });
      break;

    case 'netRestore':
      w.restore(msg.snap);
      forceFull = true;
      break;

    case 'pgPreset':
      if (w.loadPreset(msg.id)) {
        forceFull = true;
        pgWallsDirty = true;
      }
      break;

    case 'pgSurprise':
      w.loadSurprise(msg.seed);
      forceFull = true;
      pgWallsDirty = true;
      break;

    case 'pgClear':
      w.clearPlayground();
      forceFull = true; // wipe the trails too
      pgWallsDirty = true; // and the 3D view's walls
      break;

    case 'pgGravity':
      if (w.parts) w.parts.gravityOn = msg.on;
      break;

    case 'watch3d':
      watch3d = msg.on;
      pgWallsDirty = true;
      break;

    case 'watchFluid':
      watchFluid = msg.on;
      windDirty = true;
      break;

    case 'step': {
      const pix = new Uint32Array(msg.buf);
      let hashes: number[] | undefined;
      if (msg.inputs) {
        for (const batch of msg.inputs) {
          for (const inp of batch) w.applyInput(inp);
          w.step();
          if (w.f % HASH_EVERY === 0) (hashes ??= []).push(w.f, w.hash(), ...w.hashParts());
        }
      } else {
        w.step();
      }
      if (w.mode === 'playground' && w.parts && master) {
        // trails are authoritative on master; copy the finished frame out
        w.parts.draw(master, forceFull, w.f);
        pix.set(master);
      } else if (master) {
        // Sand mode is authoritative on master for the same reason playground
        // is. renderInto only paints dirty chunks and clears the flag as it
        // goes, but the frame buffers ping-pong: rendering straight into `pix`
        // meant each change reached exactly ONE of the two buffers, and the
        // other kept its previous content for that chunk forever. Settled
        // material therefore strobed at 30 Hz between its last two states -
        // a one-pixel shimmer over every pile that had stopped moving.
        w.renderInto(master, forceFull);
        w.drawDebris(master);
        pix.set(master);
      } else {
        w.renderInto(pix, forceFull);
        w.drawDebris(pix);
      }
      forceFull = false;
      const st = w.stats();
      const res: Res = {
        hashes,
        f: w.f,
        mode: w.mode,
        pgGravity: w.mode === 'playground' ? w.parts?.gravityOn : undefined,
        pgTime: w.mode === 'playground' ? w.parts?.timeScale : undefined,
        t: 'frame',
        buf: msg.buf,
        counts: st.counts,
        used: st.used,
        budget: st.budget,
        shake: w.shake,
        events: w.takeEvents(),
        parts: w.mode === 'playground' ? w.parts?.count : undefined,
        pgStats: w.mode === 'playground' ? w.parts?.takeStats() : undefined,
        result: w.challenge && w.challenge.done ? w.challenge.result : null,
      };
      const transfer = [msg.buf];
      if (watch3d && w.mode === 'playground' && w.parts) {
        const pg = new Float32Array(Math.max(6, w.parts.count * 6));
        res.pgN = w.parts.pack3d(pg);
        res.pg3d = pg.buffer;
        res.pgForces = w.parts.packForces();
        transfer.push(pg.buffer);
        if (pgWallsDirty) {
          pgWallsDirty = false;
          const mw = SIM_W >> 1;
          const mh = SIM_H >> 1;
          const mask = new Uint8Array(mw * mh);
          const cells = w.grid.cells;
          for (let y = 0; y < mh; y++)
            for (let x = 0; x < mw; x++) {
              const i = y * 2 * SIM_W + x * 2;
              if (cells[i] || cells[i + 1] || cells[i + SIM_W] || cells[i + SIM_W + 1]) mask[y * mw + x] = 1;
            }
          res.pgWalls = mask.buffer;
          transfer.push(mask.buffer);
        }
      }
      if (watchFluid) {
        // The fluid advects dye through the CPU wind field, so it needs the
        // field every frame - but only while it is actually moving. A still
        // field is sent once so the GPU copy zeroes out, then not again.
        const moving = w.wind.isMoving;
        if (moving || windDirty) {
          const wind = new Float32Array(CHUNKS_X * CHUNKS_Y * 2);
          w.wind.copyInto(wind);
          res.wind = wind.buffer;
          transfer.push(wind.buffer);
          windDirty = moving;
        }
      }
      if ((watch3d && w.f % 3 === 0) || watchFluid) {
        // downsampled material map for the 3D voxel view
        const sw = SIM_W >> 1;
        const sh = SIM_H >> 1;
        const snap = new Uint8Array(sw * sh);
        const cells = w.grid.cells;
        // Take the first non-empty cell of each 2x2 block rather than a fixed
        // corner: point-sampling made one-cell-wide streams (wire runs, water
        // trickles) flicker in and out of the diorama on alternate columns.
        for (let y = 0; y < sh; y++) {
          const r0 = (y * 2) * SIM_W;
          const r1 = r0 + SIM_W;
          const dst0 = y * sw;
          for (let x = 0; x < sw; x++) {
            const c0 = x * 2;
            const c1 = c0 + 1;
            snap[dst0 + x] =
              cells[r0 + c0] || cells[r0 + c1] || cells[r1 + c0] || cells[r1 + c1];
          }
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
        w.debris.length = 0;
        w.challenge = null;
        w.mode = 'sand';
        forceFull = true;
      }
      break;
    }

    default:
      break;
  }
}

function recount(w: World): void {
  const counts = w.grid.counts;
  counts.fill(0);
  for (let i = 0; i < w.grid.cells.length; i++) counts[w.grid.cells[i]]++;
}

export {};
