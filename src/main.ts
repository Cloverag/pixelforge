import './styles.css';
import { Input, PointerEvt } from './core/input';
import { Renderer } from './render/renderer';
import { Sfx } from './game/audio';
import { Hud, PgTool } from './ui/hud';
import { showMenu } from './ui/menu';
import { hideOverlay, showResult, toast } from './ui/widgets';
import { Mat } from './sim/materials';
import { Mode, Req, Res, SIM_H, SIM_W, Stats } from './sim/protocol';
import { CHALLENGES } from './sim/challenges';
import { recordStars } from './game/progress';
import { readSave, rleDecode, rleEncode, storeSave } from './game/rle';
import { applyWallpaper, loadBgIndex, WALLPAPER_NAMES } from './game/wallpapers';
import { initHelp, toggleHelp } from './ui/help';
import { initMusic } from './game/music';

const STEP_MS = 1000 / 60;

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const topbar = document.getElementById('topbar')!;
const toolbar = document.getElementById('toolbar')!;
const overlay = document.getElementById('overlay')!;

const renderer = new Renderer(canvas);
const sfx = new Sfx();
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
let paintKind: 'brush' | 'flood' = 'brush';
let challengeId: string | null = null;
let pgHeld = false;
let lastPg = { x: 240, y: 128 };
let strokeLast: { x: number; y: number } | null = null;
let resultOpen = false;
let lastResultKey = '';
let prevShake = 0;

function post(msg: Req, transfer?: ArrayBuffer[]): void {
  worker.postMessage(msg, transfer ?? []);
}

worker.onmessage = (e: MessageEvent<Res>) => {
  const r = e.data;
  if (r.t === 'ready') {
    stepBuf = new ArrayBuffer(SIM_W * SIM_H * 4);
    requestAnimationFrame(loop);
    return;
  }
  if (r.t === 'frame' && r.buf) {
    stepBuf = r.buf;
    inFlight = false;
    renderer.present(r.buf, r.shake ?? 0);
    if ((r.shake ?? 0) > prevShake + 4) sfx.boom();
    prevShake = r.shake ?? 0;
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
    const blob = rleEncode(r.save.cells, r.save.meta);
    if (storeSave(blob)) toast('GAME SAVED');
    else toast('SAVE FAILED (storage)', true);
  }
};

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
  document.body.classList.toggle('crt-on');
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

function setPaintKind(k: 'brush' | 'flood'): void {
  paintKind = k;
  hud.setBucketToggled(k === 'flood');
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
  onSave: () => post({ t: 'save' }),
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
    post({
      t: 'load',
      data: { w: SIM_W, h: SIM_H, cells: d.a, meta: d.b, frame: 0 },
    });
    toast('GAME LOADED');
  },
  onToggleMute: toggleMute,
  onToggleCrt: toggleCrt,
  onToggleBg: cycleWallpaper,
  onToggleMusic: toggleMusic,
  onHelp: () => toggleHelp(),
});

new Input(
  canvas,
  onPointer,
  (k) => {
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
      case 'f':
        if (screen === 'game' && mode === 'sand')
          setPaintKind(paintKind === 'brush' ? 'flood' : 'brush');
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
window.addEventListener('pf-bucket', (e) => {
  paintKind = (e as CustomEvent<boolean>).detail ? 'flood' : 'brush';
});
window.addEventListener('pf-star', (e) => {
  sfx.star((e as CustomEvent<number>).detail);
});

let pgGravityOn = true;

// ---- boot ----
overlay.classList.add('hidden');
initHelp();
applyWallpaper(bgIndex);
openMenu();
post({ t: 'init', w: SIM_W, h: SIM_H, buf: masterBuf }, [masterBuf]);
