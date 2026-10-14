import './styles.css';
import { Input, PointerEvt } from './core/input';
import { BLOCK_SIZES, Renderer, SimRenderer } from './render/renderer';
import { GLRenderer, tryWebGL2 } from './render/glrenderer';
import type { Voxel3D } from './render/voxel3d';
import { Sfx } from './game/audio';
import { Juice } from './game/juice';
import { Hud, PgTool } from './ui/hud';
import { showMenu } from './ui/menu';
import { hideOverlay, showResult, toast } from './ui/widgets';
import { Mat } from './sim/materials';
import { Mode, PaintKind, Req, Res, SIM_H, SIM_W, SimEvents, Stats } from './sim/protocol';
import { CHALLENGES } from './sim/challenges';
import { recordStars } from './game/progress';
import { readSave, rleDecode, rleEncode, storeSave } from './game/rle';
import { decodeShare, encodeShare, shareUrl, takeUrlCode } from './game/share';
import { showSharePanel } from './ui/share-panel';
import { applyWallpaper, loadBgIndex, WALLPAPER_NAMES } from './game/wallpapers';
import { initHelp, toggleHelp } from './ui/help';
import { initMusic } from './game/music';

const STEP_MS = 1000 / 60;

let canvas = document.getElementById('screen') as HTMLCanvasElement;
const topbar = document.getElementById('topbar')!;
const toolbar = document.getElementById('toolbar')!;
const overlay = document.getElementById('overlay')!;

/**
 * WebGL2 gets the GPU fluid; the 2D canvas is the fallback and still does
 * trails and glow, just without flowing dye. A canvas only ever gets one
 * context type, so this is decided once, here, and never revisited.
 */
function buildRenderer(): SimRenderer {
  const gl = tryWebGL2(canvas);
  if (!gl) return new Renderer(canvas);
  try {
    return new GLRenderer(canvas, gl);
  } catch (e) {
    // a driver that advertises float render targets but cannot actually make
    // one leaves the whole view blank, so fall back rather than ship a black
    // screen; the 2D path still does trails and glow
    console.warn('[pixelforge] WebGL renderer unavailable, falling back to 2D:', e);
    return null as unknown as SimRenderer;
  }
}

let renderer = buildRenderer();
let hasFluid = renderer instanceof GLRenderer;
if (!renderer) {
  // getContext already handed out a webgl2 context, so this canvas cannot go
  // back to 2D - replace the element and retry
  const fresh = canvas.cloneNode(false) as HTMLCanvasElement;
  canvas.replaceWith(fresh);
  canvas = fresh;
  renderer = new Renderer(canvas);
  hasFluid = false;
}
const sfx = new Sfx();
// the flash sits over the screen inside the cabinet, so it shakes with it
const flashEl = document.createElement('div');
flashEl.id = 'blast-flash';
document.getElementById('screen-wrap')!.appendChild(flashEl);
const juice = new Juice(document.getElementById('bezel') ?? canvas, flashEl);
const hud = new Hud(topbar, toolbar);

const worker = new Worker(new URL('./sim/worker.ts', import.meta.url), {
  type: 'module',
});

// ---- buffers: master goes to the worker forever; stepBuf ping-pongs ----
const masterBuf = new ArrayBuffer(SIM_W * SIM_H * 4);
let stepBuf: ArrayBuffer | null = null;
let inFlight = false;

// ---- app state ----
let screen: 'menu' | 'game' = 'menu';
let mode: Mode = 'sand';
let paused = false;
let selMat: number = Mat.SAND;
let brush = 6;
let pgTool: PgTool = 'fountain';
let paintKind: PaintKind = 'brush';
let view3d: Voxel3D | null = null;
let view3dOn = false;

/**
 * three.js is ~150 kB gzipped and the 3D view is off by default, so it is
 * pulled in on the first toggle rather than shipped in the entry chunk that
 * every player downloads. `loading` guards a double-click during the fetch.
 */
let view3dLoading = false;

async function toggle3d(): Promise<void> {
  sfx.ui();
  if (view3dOn) {
    view3dOn = false;
    view3d?.hide();
    document.getElementById('screen')!.style.visibility = 'visible';
    hud.set3dToggled(false);
    post({ t: 'watch3d', on: false });
    return;
  }
  if (view3dLoading) return;
  if (!view3d) {
    view3dLoading = true;
    try {
      const { Voxel3D } = await import('./render/voxel3d');
      view3d = new Voxel3D(document.getElementById('view3d')!, SIM_W >> 1, SIM_H >> 1);
    } catch {
      toast('3D VIEW FAILED TO LOAD', true);
      return;
    } finally {
      view3dLoading = false;
    }
  }
  view3dOn = true;
  view3d.show();
  document.getElementById('screen')!.style.visibility = 'hidden';
  hud.set3dToggled(true);
  post({ t: 'watch3d', on: true });
}

const SOFT_KEY = 'pf.soft';

/**
 * SOFT is on by default. The hard-pixel look is the original arcade skin and
 * still one keypress away, but "smooth like sandspiel" is what the game is
 * being asked for, so that is what a new player should see first.
 */
function toggleSoft(): void {
  applySoft(!renderer.isSoft());
  try {
    localStorage.setItem(SOFT_KEY, renderer.isSoft() ? '1' : '0');
  } catch {
    /* private mode: the setting just will not persist */
  }
  toast(renderer.isSoft() ? 'SOFT PARTICLES ON' : 'SOFT PARTICLES OFF');
  sfx.ui();
}

function applySoft(on: boolean): void {
  renderer.setSoft(on);
  hud.setSoftToggled(on);
  // the material map is only worth streaming when something consumes it
  if (hasFluid) post({ t: 'watchFluid', on });
}

function restoreSoft(): void {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(SOFT_KEY);
  } catch {
    /* ignore */
  }
  applySoft(saved !== '0');
}

const GRID_KEY = 'pf.grid';

/** Steps through the block sizes and back to the plain pixel view. */
function toggleGrid(): void {
  const cur = renderer.getBlockSize();
  const i = cur === null ? -1 : BLOCK_SIZES.indexOf(cur as (typeof BLOCK_SIZES)[number]);
  const next = i + 1 >= BLOCK_SIZES.length ? null : BLOCK_SIZES[i + 1];
  applyGrid(next);
  try {
    if (next === null) localStorage.removeItem(GRID_KEY);
    else localStorage.setItem(GRID_KEY, String(next));
  } catch {
    /* private mode: the setting just will not persist */
  }
  toast(next === null ? 'GRID OFF' : `GRID ${next}PX BLOCKS`);
  sfx.ui();
}

function applyGrid(n: number | null): void {
  renderer.setBlockSize(n);
  hud.setGridSize(n);
}

/** Restores the saved block size once the HUD buttons exist. */
function restoreGrid(): void {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(GRID_KEY);
  } catch {
    /* ignore */
  }
  const n = saved === null ? NaN : Number(saved);
  applyGrid(BLOCK_SIZES.includes(n as (typeof BLOCK_SIZES)[number]) ? n : null);
}
let challengeId: string | null = null;
let pgHeld = false;
let lastPg = { x: 240, y: 128 };
let strokeLast: { x: number; y: number } | null = null;
let resultOpen = false;
let lastResultKey = '';

/** Sim events -> sound and screen feedback. Positions pan across stereo. */
function playEvents(ev: SimEvents): void {
  const b = ev.booms;
  for (let k = 0; k < b.length; k += 3) {
    const pan = (b[k] / SIM_W) * 2 - 1;
    sfx.boom(b[k + 2], pan);
    juice.boom(b[k], b[k + 1], b[k + 2]);
  }
  if (ev.fuses) sfx.fuse();
  if (ev.sizzles) sfx.sizzle(ev.sizzles);
  if (ev.zaps) sfx.zap();
  if (ev.ignites) sfx.ignite(ev.ignites);
}

function post(msg: Req, transfer?: ArrayBuffer[]): void {
  worker.postMessage(msg, transfer ?? []);
}

worker.onmessage = (e: MessageEvent<Res>) => {
  const r = e.data;
  if (r.t === 'ready') {
    stepBuf = new ArrayBuffer(SIM_W * SIM_H * 4);
    // The worker discards everything that arrives before `init`, and the HUD
    // is wired up further down this file - so any watch flags set during boot
    // were dropped. Re-send them now that there is something listening.
    if (hasFluid) post({ t: 'watchFluid', on: renderer.isSoft() });
    requestAnimationFrame(loop);
    return;
  }
  if (r.t === 'frame' && r.buf) {
    stepBuf = r.buf;
    inFlight = false;
    const snap = r.snap ? new Uint8Array(r.snap) : null;
    renderer.setFluidInputs(
      snap,
      r.snapW ?? 0,
      r.snapH ?? 0,
      r.wind ? new Float32Array(r.wind) : null,
    );
    renderer.present(r.buf);
    if (snap && view3dOn && view3d) view3d.update(snap, r.snapW!, r.snapH!);
    if (r.events) playEvents(r.events);
    if (r.counts) sfx.crackle(r.counts[Mat.FIRE] + r.counts[Mat.EMBER]);
    if (r.counts && r.used && r.budget) {
      hud.updateStats({
        counts: r.counts,
        used: r.used,
        budget: r.budget,
      } as Stats);
    }
    maybeShowResult(r.result ?? null);
    fpsFrames++;
    return;
  }
  if (r.t === 'state' && r.save) {
    // a snapshot is requested for one of two reasons; the worker does not
    // care which, so the reason waits here in FIFO order
    const why = saveIntents.shift() ?? 'store';
    if (why === 'share') {
      void encodeShare(r.save.cells, r.save.meta).then((code) => {
        showSharePanel(shareUrl(code));
      });
    } else {
      const blob = rleEncode(r.save.cells, r.save.meta);
      if (storeSave(blob)) toast('GAME SAVED');
      else toast('SAVE FAILED (storage)', true);
    }
  }
};

/** Why each in-flight `save` request was made, oldest first. */
const saveIntents: ('store' | 'share')[] = [];

function requestSnapshot(why: 'store' | 'share'): void {
  saveIntents.push(why);
  post({ t: 'save' });
}

/** Drops a decoded world into the sandbox and leaves the menu. */
function adoptWorld(d: { a: Uint8Array; b: Uint8Array }): void {
  post({
    t: 'load',
    data: { w: SIM_W, h: SIM_H, cells: d.a, meta: d.b, frame: 0 },
  });
}

// ---- sim ticking ----
let acc = 0;
let lastT = performance.now();
let fpsFrames = 0;
let fpsClock = 0;

function sendStep(): void {
  if (!stepBuf || inFlight) return;
  inFlight = true;
  post({ t: 'step', buf: stepBuf }, [stepBuf]);
}

function loop(now: number): void {
  const dt = Math.min(120, now - lastT);
  lastT = now;
  acc += dt;

  if (screen === 'game' && !paused && !resultOpen) {
    let guard = 0;
    while (acc >= STEP_MS && guard < 6) {
      if (inFlight) break;
      sendStep();
      acc -= STEP_MS;
      guard++;
      if (
        mode === 'playground' &&
        pgHeld &&
        pgTool === 'fountain'
      ) {
        post({
          t: 'pg',
          tool: { kind: 'fountain', x: lastPg.x, y: lastPg.y, phase: 'move' },
        });
      }
    }
  } else {
    acc = 0;
  }

  fpsClock += dt;
  if (fpsClock >= 500) {
    hud.setFps(Math.round((fpsFrames * 1000) / fpsClock));
    fpsFrames = 0;
    fpsClock = 0;
  }
  if (view3dOn) view3d?.render();
  juice.frame();
  requestAnimationFrame(loop);
}

// ---- helpers ----

function linePts(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number[] {
  const pts: number[] = [];
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.max(Math.abs(dx), Math.abs(dy));
  const steps = Math.max(1, Math.floor(dist / Math.max(1, brush >> 2)));
  for (let i = 1; i <= steps; i++) {
    pts.push(Math.round(x0 + (dx * i) / steps), Math.round(y0 + (dy * i) / steps));
  }
  return pts;
}

function paintAt(e: PointerEvt, forcedMat?: number): void {
  if (e.phase === 'up') {
    strokeLast = null;
    return;
  }
  const mat =
    forcedMat !== undefined
      ? forcedMat
      : e.button === 2 || selMat === -1
        ? Mat.EMPTY
        : selMat;
  let pts: number[];
  if (strokeLast && e.phase === 'move') {
    pts = linePts(strokeLast.x, strokeLast.y, e.x, e.y);
  } else {
    pts = [e.x, e.y];
  }
  if (pts.length === 0) return;
  strokeLast = { x: e.x, y: e.y };
  post({ t: 'paint', pts, mat, size: brush, kind: paintKind });
  sfx.place();
  if (paused && !inFlight) sendStep(); // visual feedback while paused
}

function pgAt(e: PointerEvt, forced?: PgTool): void {
  const tool: PgTool = forced ?? (e.button === 2 ? 'erase' : pgTool);
  if (e.phase === 'up') {
    pgHeld = false;
    return;
  }
  lastPg = { x: e.x, y: e.y };
  if (tool === 'wall') {
    paintAt(e, Mat.WALL);
    return;
  }
  const kind =
    tool === 'attract' ? 'attractor' : tool === 'repel' ? 'repulsor' : tool;
  pgHeld = tool === 'fountain';
  post({
    t: 'pg',
    tool: { kind, x: e.x, y: e.y, phase: e.phase },
  });
  if (tool === 'firework' && e.phase === 'down') sfx.fireworkLaunch();
  if (paused && !inFlight) sendStep();
}

function onPointer(e: PointerEvt): void {
  sfx.ensure();
  if (screen !== 'game') return;
  if (mode === 'sand') paintAt(e);
  else pgAt(e);
}

// ---- game flow ----

function enterGame(label: string): void {
  screen = 'game';
  paused = false;
  resultOpen = false;
  hud.setPaused(false);
  hud.showBars(true);
  hud.setModeLabel(label);
  hud.setSaveVisible(mode === 'sand' && challengeId === null);
  hideOverlay();
  renderer.resize();
  acc = 0;
}

function startSandbox(): void {
  mode = 'sand';
  challengeId = null;
  renderer.reset();
  post({ t: 'toSandbox' });
  hud.buildSandPalette(null, Mat.SAND, brush, {
    onSelect: (m) => {
      selMat = m;
      sfx.ui();
    },
  });
  enterGame('SANDBOX');
}

function startPlayground(): void {
  mode = 'playground';
  challengeId = null;
  pgTool = 'fountain';
  post({ t: 'mode', mode: 'playground' });
  hud.buildPgPalette('fountain', brush, {
    onTool: (t) => {
      pgTool = t;
      sfx.ui();
    },
  });
  enterGame('PARTICLE PLAYGROUND');
}

function startChallenge(id: string): void {
  renderer.reset();
  const def = CHALLENGES.find((c) => c.id === id);
  if (!def) return;
  mode = 'sand';
  challengeId = id;
  post({ t: 'loadChallenge', id });
  hud.buildSandPalette(def.allowed, def.allowed[0], brush, {
    onSelect: (m) => {
      selMat = m;
      sfx.ui();
    },
  });
  enterGame(`CHALLENGE: ${def.name}`);
  toast(def.hint);
}

function openMenu(): void {
  screen = 'menu';
  strokeLast = null;
  pgHeld = false;
  hud.showBars(false);
  showMenu({
    onSandbox: () => {
      sfx.ensure();
      sfx.ui();
      startSandbox();
    },
    onPlayground: () => {
      sfx.ensure();
      sfx.ui();
      startPlayground();
    },
    onChallenge: (id) => {
      sfx.ensure();
      sfx.ui();
      startChallenge(id);
    },
    onToggleMute: toggleMute,
    onToggleCrt: toggleCrt,
    onToggleBg: cycleWallpaper,
    onToggleMusic: toggleMusic,
    onHelp: () => toggleHelp(),
    onToggle3d: () => void toggle3d(),
  });
}

function closeResult(): void {
  resultOpen = false;
  hideOverlay();
}

function maybeShowResult(result: import('./sim/protocol').ChallengeResult | null): void {
  if (!result || resultOpen) return;
  const key = `${result.id}:${result.status}:${result.timeFrames}`;
  if (key === lastResultKey) return;
  lastResultKey = key;
  resultOpen = true;

  if (result.status === 'win') {
    recordStars(result.id, result.stars);
    sfx.win();
  } else {
    sfx.lose();
  }

  const def = CHALLENGES.find((c) => c.id === result.id);
  const idx = CHALLENGES.findIndex((c) => c.id === result.id);
  const nextDef = CHALLENGES[idx + 1];

  showResult({
    name: def?.name ?? result.id,
    status: result.status,
    reason: result.reason,
    stars: result.stars,
    timeSecs: result.timeFrames / 60,
    onRetry: () => {
      closeResult();
      startChallenge(result.id);
    },
    onNext: nextDef
      ? () => {
          closeResult();
          startChallenge(nextDef.id);
        }
      : undefined,
    onMenu: () => {
      closeResult();
      openMenu();
    },
  });
}

// ---- toggles ----

function togglePause(): void {
  if (screen !== 'game') return;
  paused = !paused;
  hud.setPaused(paused);
  sfx.ui();
}

function stepOnce(): void {
  if (screen === 'game' && paused) sendStep();
}

function toggleMute(): void {
  sfx.muted = !sfx.muted;
  document.body.classList.toggle('muted', sfx.muted);
  hud.setMuted(sfx.muted);
}

function toggleCrt(): void {
  hud.setCrt(document.body.classList.toggle('crt-on'));
}

const music = initMusic();

function toggleMusic(): void {
  music.toggle();
  hud.setMusicToggled(music.isOn());
}

let bgIndex = loadBgIndex();

function cycleWallpaper(): void {
  bgIndex = (bgIndex + 1) % WALLPAPER_NAMES.length;
  applyWallpaper(bgIndex);
  toast(`BG: ${WALLPAPER_NAMES[bgIndex]}`);
}

function setPaintKind(k: PaintKind): void {
  paintKind = k;
  hud.setToolKind(k);
  sfx.ui();
}

function setBrush(n: number): void {
  brush = Math.max(2, Math.min(24, n));
  hud.setBrushDisplay(brush);
}

// ---- input wiring ----

hud.initTopbar({
  onPause: togglePause,
  onStep: stepOnce,
  onMenu: () => openMenu(),
  onSave: () => requestSnapshot('store'),
  onShare: () => requestSnapshot('share'),
  onLoad: () => {
    const blob = readSave();
    if (!blob) {
      toast('NO SAVE FOUND', true);
      return;
    }
    const d = rleDecode(blob, SIM_W * SIM_H);
    if (!d) {
      toast('SAVE CORRUPTED', true);
      return;
    }
    adoptWorld(d);
    toast('GAME LOADED');
  },
  onToggleMute: toggleMute,
  onToggleCrt: toggleCrt,
  onToggleBg: cycleWallpaper,
  onToggleMusic: toggleMusic,
  onHelp: () => toggleHelp(),
  onToggle3d: () => void toggle3d(),
  onToggleGrid: toggleGrid,
  onToggleSoft: toggleSoft,
});

// the GRID and SOFT buttons exist only after initTopbar, so restore here
restoreGrid();
restoreSoft();

new Input(
  canvas,
  onPointer,
  (k) => {
    if (screen === 'menu') {
      // a focused control already handles its own Enter/Space
      const a = document.activeElement as HTMLElement | null;
      const onControl = a !== null && (a.tagName === 'BUTTON' || a.getAttribute('role') === 'button');
      if (k === 'enter' && !onControl) {
        sfx.ensure();
        sfx.ui();
        startSandbox();
        return;
      }
      if (k === 'p') {
        sfx.ensure();
        sfx.ui();
        startPlayground();
        return;
      }
    }
    switch (k) {
      case ' ':
        togglePause();
        break;
      case 'n':
        stepOnce();
        break;
      case 'm':
        toggleMute();
        break;
      case 'c':
        toggleCrt();
        break;
      case '[':
        setBrush(brush - 2);
        break;
      case ']':
        setBrush(brush + 2);
        break;
      case 'escape':
        if (screen === 'game') openMenu();
        break;
      case '3':
        if (screen === 'game') void toggle3d();
        break;
      case 'b':
        if (screen === 'game') toggleGrid();
        break;
      case 's':
        if (screen === 'game') toggleSoft();
        break;
      case 'f':
        if (screen === 'game' && mode === 'sand')
          setPaintKind(paintKind === 'flood' ? 'brush' : 'flood');
        break;
      case 'w':
        if (screen === 'game' && mode === 'sand')
          setPaintKind(paintKind === 'wind' ? 'brush' : 'wind');
        break;
      case 'g':
        if (mode === 'playground' && screen === 'game') {
          pgGravityOn = !pgGravityOn;
          post({ t: 'pgGravity', on: pgGravityOn });
          toast(`GRAVITY ${pgGravityOn ? 'ON' : 'OFF'}`);
        }
        break;
      default:
        if (/^[1-9]$/.test(k) && screen === 'game' && mode === 'sand') {
          const idx = Number(k) - 1;
          const swatches = document.querySelectorAll('#palette .swatch');
          const el = swatches[idx] as HTMLElement | undefined;
          if (el) el.click();
        }
        break;
    }
  },
  (dy) => setBrush(brush - dy),
);

window.addEventListener('pf-brush', (e) => {
  brush = (e as CustomEvent<number>).detail;
});
window.addEventListener('pf-tool', (e) => {
  paintKind = (e as CustomEvent<PaintKind>).detail;
});
window.addEventListener('pf-star', (e) => {
  sfx.star((e as CustomEvent<number>).detail);
});

let pgGravityOn = true;

// ---- boot ----
overlay.classList.add('hidden');
initHelp();
applyWallpaper(bgIndex);

// The worker drops every message that arrives before `init`, so nothing that
// talks to it may run above this line - startSandbox() posts `toSandbox`.
post({ t: 'init', w: SIM_W, h: SIM_H, buf: masterBuf }, [masterBuf]);

/**
 * A #w= link skips the menu and drops straight into the shared world.
 * Decoding is async (gzip), so the `load` is posted whenever it resolves;
 * message order to the worker is preserved either way.
 */
const urlCode = takeUrlCode();
if (urlCode) {
  startSandbox();
  void decodeShare(urlCode, SIM_W * SIM_H).then((d) => {
    if (!d) {
      toast('SHARED LINK IS CORRUPTED', true);
      return;
    }
    adoptWorld(d);
    toast('SHARED WORLD LOADED');
  });
} else {
  openMenu();
}
