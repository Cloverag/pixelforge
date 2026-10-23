import './styles.css';
import { Input, PointerEvt } from './core/input';
import { BLOCK_SIZES, Renderer, SimRenderer } from './render/renderer';
import { GLRenderer, tryWebGL2 } from './render/glrenderer';
import type { Voxel3D } from './render/voxel3d';
import type { PG3D } from './render/pg3d';
import { Sfx } from './game/audio';
import { Juice } from './game/juice';
import { Hud } from './ui/hud';
import { showMenu } from './ui/menu';
import { hideOverlay, showResult, toast } from './ui/widgets';
import { Mat } from './sim/materials';
import { MpSession, newRoomCode, roomFromUrl, roomUrl, type MpHooks } from './net/mp';
import type { NetInput, Snapshot } from './sim/protocol';
import { RoomPill } from './ui/roompill';
import { CursorLayer, REACT_MS } from './ui/cursors';
import { confirmDialog, isDialogOpen, nameDialog } from './ui/dialog';
import { EmoteLayer } from './ui/emotes';
import { EMOTES, PING } from './net/presence';
import { myIdentity, saveIdentity } from './net/presence';
import { Mode, PaintKind, Req, Res, SIM_H, SIM_W, SimEvents, Stats } from './sim/protocol';
import { CHALLENGES } from './sim/challenges';
import { recordStars } from './game/progress';
import { readSave, rleDecode, rleEncode, storeSave } from './game/rle';
import { decodeShare, encodeShare, shareUrl, takeUrlCode } from './game/share';
import { showSharePanel } from './ui/share-panel';
import { applyWallpaper, loadBgIndex, WALLPAPER_NAMES } from './game/wallpapers';
import { initHelp, toggleHelp } from './ui/help';
import { initImmersive, isImmersive, setImmersive, toggleImmersive } from './ui/immersive';
import { initMusic } from './game/music';
import { applyTheme, cycleTheme, loadTheme } from './ui/theme';
import type { ModeController, ModeCtx } from './modes/types';
import { SandMode } from './modes/sand';
import { PlaygroundMode } from './modes/playground';

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

// Without this a worker throw is swallowed: the sim silently stops stepping
// and the page looks frozen rather than broken. Surface it instead.
worker.onerror = (e): void => {
  console.error('[pixelforge] sim worker error', e.message, e.filename, e.lineno);
  inFlight = false;
  toast('SIM ERROR - RELOAD THE PAGE', true);
};

// ---- buffers: master goes to the worker forever; stepBuf ping-pongs ----
const masterBuf = new ArrayBuffer(SIM_W * SIM_H * 4);
let stepBuf: ArrayBuffer | null = null;
let inFlight = false;

// ---- app state ----
let screen: 'menu' | 'game' = 'menu';
let paused = false;
let brush = 6;
let paintKind: PaintKind = 'brush';
let view3d: Voxel3D | null = null;
let view3dOn = false;

/** What the modes may use; they never reach into main.ts otherwise. */
const modeCtx: ModeCtx = {
  hud,
  sfx,
  post,
  send,
  toast,
  brush: () => brush,
  paintKind: () => paintKind,
  setPaintKind,
  nudge: () => {
    if (paused && !inFlight) sendStep();
  },
};
const sandbox = new SandMode(modeCtx);
const playground = new PlaygroundMode(modeCtx);
/** each world's free-play screen; a challenge is a SandMode of its own */
const MODE_CTRL: Record<Mode, ModeController> = { sand: sandbox, playground };
/** the screen being played (the menu keeps the last one) */
let current: ModeController = sandbox;

/**
 * three.js is ~150 kB gzipped and the 3D view is off by default, so it is
 * pulled in on the first toggle rather than shipped in the entry chunk that
 * every player downloads. `loading` guards a double-click during the fetch.
 */
let view3dLoading = false;

/** The playground's 3D view: a lit scene, not the sandbox diorama. */
let pgView: PG3D | null = null;

async function togglePg3d(): Promise<void> {
  if (view3dOn) {
    view3dOn = false;
    pgView?.hide();
    document.getElementById('screen')!.style.visibility = 'visible';
    hud.set3dToggled(false);
    post({ t: 'watch3d', on: false });
    return;
  }
  if (view3dLoading) return;
  if (!pgView) {
    view3dLoading = true;
    try {
      const { PG3D } = await import('./render/pg3d');
      pgView = new PG3D(document.getElementById('pg3d')!, (x, y, phase, button) =>
        onPointer({ x, y, sx: 0, sy: 0, button, phase }),
      );
    } catch (err) {
      console.error(err);
      toast('3D VIEW FAILED TO LOAD', true);
      return;
    } finally {
      view3dLoading = false;
    }
  }
  view3dOn = true;
  pgView.show();
  document.getElementById('screen')!.style.visibility = 'hidden';
  hud.set3dToggled(true);
  post({ t: 'watch3d', on: true });
}

/** Leaving a mode closes whichever 3D view it had open. */
function close3d(): void {
  if (!view3dOn) return;
  view3dOn = false;
  view3d?.hide();
  pgView?.hide();
  document.getElementById('screen')!.style.visibility = 'visible';
  hud.set3dToggled(false);
  post({ t: 'watch3d', on: false });
}

async function toggle3d(): Promise<void> {
  sfx.ui();
  if (current.view3d === 'scene') return togglePg3d();
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
/** steps sent, for tools that emit on a slower beat than every step */
let frameNo = 0;
let resultOpen = false;
let lastResultKey = '';

/** Sim events -> sound and screen feedback. Positions pan across stereo. */
function playEvents(ev: SimEvents): void {
  const b = ev.booms;
  for (let k = 0; k < b.length; k += 3) {
    const pan = (b[k] / SIM_W) * 2 - 1;
    sfx.boom(b[k + 2], pan);
    juice.boom(b[k], b[k + 1], b[k + 2]);
    current.onBoom?.(pan);
    if (pgView?.visible) pgView.flash(b[k], b[k + 1]);
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
    if (r.pg3d && pgView?.visible) pgView.update(new Float32Array(r.pg3d), r.pgN ?? 0, r.pgForces ?? []);
    if (r.pgWalls && pgView) pgView.setWalls(new Uint8Array(r.pgWalls));
    if (r.events) playEvents(r.events);
    if (r.parts !== undefined) hud.setParticles(r.parts);
    if (r.hashes && mp) mp.hashes(r.hashes);
    if (mp && r.mode && r.mode !== current.id && current.challengeId === null) {
      // the host switched the room: rebuild this screen, the world already has
      showMode(MODE_CTRL[r.mode]);
      roomPill.setMode(r.mode);
      toast(`THE ROOM IS NOW IN THE ${current.roomName}`);
    }
    current.onFrame?.(r);
    // the host's frame clock must track its world exactly
    if (mp?.host && r.f !== undefined && r.f !== mp.host.f && !frameWarned) {
      frameWarned = true;
      console.error(`multiplayer: host clock ${mp.host.f} != world frame ${r.f}`);
    }
    // the playground's sound follows the sim; leaving it fades the voices out
    sfx.playground(r.pgStats ?? null);
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
  if (r.t === 'error') {
    console.error('[pixelforge] sim worker threw:', r.error);
    return;
  }
  if (r.t === 'netSnap' && r.snapshot) {
    snapWaiters.shift()?.(r.snapshot);
    return;
  }
  if (r.t === 'state' && r.save) {
    // a snapshot is requested for one of three reasons; the worker does not
    // care which, so the reason waits here in FIFO order
    const why = saveIntents.shift() ?? 'store';
    if (why === 'share') {
      void encodeShare(r.save.cells, r.save.meta).then((code) => {
        showSharePanel(shareUrl(code));
      });
    } else if (why === 'auto') {
      // the periodic save is silent: a toast every few seconds would be noise
      storeSave(rleEncode(r.save.cells, r.save.meta));
    } else {
      const blob = rleEncode(r.save.cells, r.save.meta);
      if (storeSave(blob)) toast('GAME SAVED');
      else toast('SAVE FAILED (storage)', true);
    }
  }
};

/** Why each in-flight `save` request was made, oldest first. */
const saveIntents: ('store' | 'share' | 'auto')[] = [];

function requestSnapshot(why: 'store' | 'share' | 'auto'): void {
  saveIntents.push(why);
  post({ t: 'save' });
}

/**
 * Autosave only covers the free sandbox: challenges have their own start state
 * and the particle playground is deliberately throwaway. Snapshotting while a
 * request is already in flight would just queue duplicate work.
 */
function autosaveEligible(): boolean {
  // a guest is playing in someone else's world: never save it over theirs
  return screen === 'game' && current.saveable && !mp?.guest;
}

function autosaveNow(): void {
  if (autosaveEligible() && !saveIntents.includes('auto')) requestSnapshot('auto');
}

/** Drops a decoded world into the sandbox and leaves the menu. */
function adoptWorld(d: { a: Uint8Array; b: Uint8Array }): void {
  // replacing the world outside the shared timeline would desync the room
  if (mp) {
    toast('NOT WHILE PLAYING TOGETHER', true);
    return;
  }
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
  // Checked before `mp`: while a room is opening `mp` is still null, and
  // gating only inside `if (mp)` let the world step through the setup, so
  // the host's frame clock started behind its world and every input landed
  // a few frames later on the host than on the guests (a real desync).
  if (mpGate) return;
  let inputs: NetInput[][] | undefined;
  if (mp) {
    if (mp.host) {
      inputs = [mp.host.advance()];
    } else {
      // a guest steps only frames the host has sent; one at a time normally,
      // many at once when it fell behind (a hidden tab, a slow moment)
      const g = mp.guest!;
      const ready = g.backlog();
      if (ready === 0) return;
      const n = ready > 6 ? Math.min(ready - 2, 90) : 1;
      inputs = [];
      for (let k = 0; k < n; k++) inputs.push(g.take());
    }
  }
  inFlight = true;
  post({ t: 'step', buf: stepBuf, inputs }, [stepBuf]);
}

// ---- playing together (net/mp.ts) ----

let mp: MpSession | null = null;
/** no stepping while a room is being opened: the host's frame clock must
 *  start from the snapshot it is about to take */
let mpGate = false;
let frameWarned = false;
const roomPill = new RoomPill(() => leaveRoom('YOU LEFT THE ROOM'));
const cursors = new CursorLayer();
const emotes = new EmoteLayer();
/** where my cursor last was on the canvas, for placing reactions */
let myCursor: { x: number; y: number } | null = null;
const me = myIdentity();
const snapWaiters: ((s: Snapshot) => void)[] = [];

function workerSnapshot(): Promise<Snapshot> {
  return new Promise((resolve) => {
    snapWaiters.push(resolve);
    post({ t: 'netSnap' });
  });
}

const mpHooks: MpHooks = {
  snapshot: workerSnapshot,
  restore: (s) => post({ t: 'netRestore', snap: s }),
  onPeople: (n) => roomPill.setPeople(n),
  onNotice: (text, bad) => toast(text, bad),
  onEnd: (reason) => leaveRoom(reason, true),
  onRoster: (peers) => {
    lastRoster = peers;
    roomPill.setRoster(me, peers);
  },
  onCursor: (id, c) => cursors.update(id, c),
  onWaiting: (on) => roomPill.setWaiting(on),
  onEmote: (e, from) => {
    // on the person: their cursor bubble and their avatar; a ping also
    // marks the spot it points at
    const emoji = e.e === PING ? '📍' : (EMOTES[e.e] ?? '❔');
    if (from) cursors.react(from, emoji);
    roomPill.react(from, emoji, REACT_MS);
    emotes.ping(e);
    if (document.hidden) emotes.noteHidden();
    else sfx.emote(e.e === PING);
  },
};

/** React at my cursor, or the middle of the canvas if it is not over it. */
function react(e: number): void {
  if (!mp) return;
  const at = myCursor ?? { x: SIM_W >> 1, y: SIM_H >> 1 };
  mp.emote(e, at.x, at.y);
}
emotes.onPick = react;

roomPill.onRename = (name) => {
  me.name = name;
  saveIdentity(me);
  mp?.announce();
  roomPill.setRoster(me, lastRoster);
  toast(`YOU ARE NOW ${name}`);
};
let lastRoster: import('./net/presence').PeerInfo[] = [];

/**
 * A host's tab remembers the room it hosts (sessionStorage: survives a
 * reload, not a closed tab), so a refresh reopens the same room from the
 * autosaved world instead of ending it. Guests wait for it meanwhile.
 */
const HOSTING_KEY = 'pf-hosting';
function rememberHosting(code: string | null): void {
  try {
    if (code) sessionStorage.setItem(HOSTING_KEY, code);
    else sessionStorage.removeItem(HOSTING_KEY);
  } catch {
    /* no resume after reload, nothing else breaks */
  }
}
function hostingCode(): string | null {
  try {
    return sessionStorage.getItem(HOSTING_KEY);
  } catch {
    return null;
  }
}

/**
 * Share my cursor while in a room: hover as well as drags (the game's own
 * input only reports drags), at most every 50 ms, hidden off the canvas.
 */
let pointerDown = false;
let pointerButton = 0;
let lastCursorAt = 0;
let cursorPending: { x: number; y: number; hidden: boolean } | null = null;
function shareCursor(x: number, y: number, hidden: boolean): void {
  if (!mp || screen !== 'game') return;
  // keep the last spot on the canvas: reacting means moving to the
  // reaction bar, and the reaction belongs where you were working
  if (!hidden) myCursor = { x, y };
  cursorPending = { x, y, hidden };
  const now = performance.now();
  if (now - lastCursorAt < 50) return;
  lastCursorAt = now;
  mp.cursor({
    ...cursorPending,
    s: brush,
    ...current.cursor(pointerDown, pointerButton),
    d: pointerDown && !hidden,
  });
  cursorPending = null;
}
addEventListener('pointermove', (e: PointerEvent) => {
  if (!mp) return;
  const c = document.getElementById('screen') as HTMLCanvasElement | null;
  if (!c) return;
  const r = c.getBoundingClientRect();
  const inside = e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom;
  shareCursor(
    Math.floor(((e.clientX - r.left) / r.width) * SIM_W),
    Math.floor(((e.clientY - r.top) / r.height) * SIM_H),
    !inside,
  );
});
addEventListener('pointerdown', (e: PointerEvent) => {
  pointerDown = true;
  pointerButton = e.button;
});
addEventListener('pointerup', () => (pointerDown = false));

/** Open a room from the current sandbox, as host, and copy its link. */
/** Ask who the player is before they appear to anyone. */
async function askName(title: string, action: string): Promise<boolean> {
  const who = await nameDialog({ title, action, me });
  if (!who) return false;
  me.name = who.name;
  me.color = who.color;
  saveIdentity(me);
  return true;
}

async function hostRoom(reuse?: string): Promise<void> {
  if (mp) return;
  // a host reopening after a refresh is already named
  if (!reuse && !(await askName('OPEN A ROOM', 'OPEN ROOM'))) return;
  mpGate = true;
  const code = reuse ?? newRoomCode();
  try {
    mp = await MpSession.host(code, mpHooks, me);
  } catch (err) {
    console.error(err);
    toast('COULD NOT OPEN A ROOM', true);
    return;
  } finally {
    mpGate = false;
  }
  history.replaceState(null, '', roomUrl(code));
  rememberHosting(code);
  roomPill.show(code, 'host');
  roomPill.setMode(current.id);
  roomPill.setRoster(me, []);
  emotes.open();
  if (reuse) toast(`ROOM ${code} REOPENED`);
  else copyRoomLink(code, 'ROOM OPEN - LINK COPIED, SEND IT TO A FRIEND');
}

async function joinRoom(code: string): Promise<void> {
  if (mp) return;
  startSandbox();
  if (!(await askName(`JOIN ROOM ${code}`, 'JOIN'))) {
    history.replaceState(null, '', location.pathname);
    toast('NOT JOINED - PLAYING SOLO');
    return;
  }
  toast(`JOINING ROOM ${code}...`);
  try {
    mp = await MpSession.join(code, mpHooks, me);
  } catch (err) {
    console.error(err);
    toast('COULD NOT JOIN THE ROOM', true);
    return;
  }
  roomPill.show(code, 'guest');
  roomPill.setMode(current.id);
  roomPill.setRoster(me, []);
  emotes.open();
}

function copyRoomLink(code: string, okText = 'LINK COPIED'): void {
  const url = roomUrl(code);
  navigator.clipboard?.writeText(url).then(
    () => toast(okText),
    () => toast(`ROOM ${code} - SHARE: ${url}`),
  );
}

function leaveRoom(reason?: string, bad = false): void {
  if (!mp) return;
  mp.leave();
  mp = null;
  rememberHosting(null);
  lastRoster = [];
  roomPill.hide();
  cursors.clear();
  emotes.close();
  myCursor = null;
  history.replaceState(null, '', location.pathname);
  if (reason) toast(reason, bad);
}
roomPill.onCopy = () => mp && copyRoomLink(mp.code);
/** The host takes the whole room to the other mode (the world starts empty). */
roomPill.onSwitchMode = async () => {
  if (!mp?.host) return;
  const next = current.id === 'sand' ? 'playground' : 'sand';
  const ok = await confirmDialog({
    title: next === 'playground' ? 'TO THE PLAYGROUND?' : 'BACK TO THE SANDBOX?',
    body: `Everyone in the room goes with you, and the ${next === 'playground' ? 'playground' : 'sandbox'} starts empty.`,
    ok: 'GO',
    cancel: 'STAY',
  });
  if (ok && mp) mp.local([{ k: 'mode', m: next }]);
};
// dev only: paint straight into this peer's own world, bypassing the room,
// to test that a desync is detected and repaired
if (import.meta.env.DEV)
  (window as unknown as { __mpCorrupt: () => void }).__mpCorrupt = () =>
    post({ t: 'input', inp: { k: 'paint', pts: [300, 150, 340, 150], mat: Mat.WATER, size: 10, kind: 'brush' } });
// dev only: lets automated two-browser tests read the session state
if (import.meta.env.DEV)
  (window as unknown as { __mp: () => unknown }).__mp = () =>
    mp && { role: mp.role, code: mp.code, f: mp.host ? mp.host.f : mp.guest!.f, backlog: mp.guest?.backlog() ?? 0, sync: mp.sync, snaps: mp.snapCount, name: me.name };

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
      current.tick?.(frameNo);
      frameNo++;
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
  if (view3dOn) {
    view3d?.render();
    pgView?.render();
  }
  juice.frame();
  requestAnimationFrame(loop);
}

// ---- helpers ----

/**
 * A player action: in a room it is an input, applied at the same frame for
 * everyone; alone it goes straight to the worker - the same input either way.
 */
function send(inp: NetInput): void {
  if (mp) mp.local([inp]);
  else post({ t: 'input', inp });
}

function onPointer(e: PointerEvt): void {
  sfx.ensure();
  if (screen !== 'game') return;
  current.onPointer(e);
}

// ---- game flow ----

function enterGame(): void {
  screen = 'game';
  paused = false;
  resultOpen = false;
  hud.setPaused(false);
  hud.showBars(true);
  hud.setModeLabel(current.label);
  hud.setSaveVisible(current.saveable);
  hideOverlay();
  renderer.resize();
  acc = 0;
}

/** Give the worker this mode's fresh world, then show its screen. */
function startMode(m: ModeController): void {
  m.start();
  showMode(m);
}

/** A mode's screen, without touching the world (a room switch). */
function showMode(m: ModeController): void {
  close3d();
  renderer.setCinematic?.(m.cinematic);
  // a mode switch would otherwise leave the last composite ghosting
  renderer.reset();
  current = m;
  m.buildUI();
  enterGame();
}

function startSandbox(): void {
  startMode(sandbox);
}

function startPlayground(): void {
  leaveRoom('YOU LEFT THE ROOM');
  startMode(playground);
}

function startChallenge(id: string): void {
  leaveRoom('YOU LEFT THE ROOM');
  const def = CHALLENGES.find((c) => c.id === id);
  if (!def) return;
  startMode(new SandMode(modeCtx, def));
}

/** ESC / MENU: in a room, make sure first - leaving takes you out of it. */
async function requestMenu(): Promise<void> {
  if (mp) {
    const host = mp.role === 'host';
    const ok = await confirmDialog({
      title: 'LEAVE THE ROOM?',
      body: host
        ? 'You are the host: the room closes for everyone when you leave.'
        : 'You can come back any time with the same link.',
      ok: 'LEAVE',
      cancel: 'STAY',
    });
    if (!ok || !mp) return;
  }
  openMenu();
}

function openMenu(): void {
  setImmersive(false);
  leaveRoom('YOU LEFT THE ROOM');
  sfx.playground(null); // no frames in the menu, so nothing else would fade it
  screen = 'menu';
  current.leave();
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
    onSurprise: () => {
      sfx.ensure();
      startPlayground();
      playground.surprise();
    },
    onPlayTogether: () => {
      sfx.ensure();
      sfx.ui();
      startSandbox();
      void hostRoom();
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
    onCycleTheme: nextTheme,
    theme: loadTheme(),
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
  // paused: no frames arrive, so fade the playground's voices explicitly
  if (paused) sfx.playground(null);
}

function stepOnce(): void {
  if (screen === 'game' && paused) sendStep();
}

function toggleMute(): void {
  sfx.muted = !sfx.muted;
  document.body.classList.toggle('muted', sfx.muted);
  hud.setMuted(sfx.muted);
}

applyTheme(loadTheme());

function nextTheme(): string {
  const t = cycleTheme();
  hud.setThemeLabel(t);
  for (const el of document.querySelectorAll<HTMLElement>('[data-role="theme-label"]'))
    el.textContent = `THEME: ${t.toUpperCase()}`;
  sfx.ui();
  toast(`THEME: ${t.toUpperCase()}`);
  return t;
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
  onMenu: () => void requestMenu(),
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
  onCycleTheme: () => void nextTheme(),
  onToggleImmersive: () => {
    sfx.ui();
    toggleImmersive();
  },
});
hud.setThemeLabel(loadTheme());

// the GRID and SOFT buttons exist only after initTopbar, so restore here
restoreGrid();
restoreSoft();

new Input(
  canvas,
  onPointer,
  (k) => {
    if (isDialogOpen()) return; // typing a name must not paint, pause or leave
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
      if (k === 'r') {
        sfx.ensure();
        startPlayground();
        playground.surprise();
        return;
      }
      if (k === 'o') {
        sfx.ensure();
        sfx.ui();
        startSandbox();
        void hostRoom();
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
      case 't':
        nextTheme();
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
        // one step back at a time: out of immersive first, then the menu
        if (isImmersive()) setImmersive(false);
        else if (screen === 'game') void requestMenu();
        break;
      case 'i':
        if (screen === 'game') toggleImmersive();
        break;
      case 'z':
        if (mp && screen === 'game') react(PING);
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
      default:
        // the rest belong to the mode being played
        if (screen === 'game') current.keys[k]?.();
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

// ---- boot ----
overlay.classList.add('hidden');
initHelp();
initImmersive((on) => {
  hud.setImmersiveToggled(on);
  if (on) toast('IMMERSIVE - EDGES FOR CONTROLS - I OR ESC TO LEAVE');
});
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
const urlRoom = roomFromUrl();
if (urlRoom && hostingCode() === urlRoom) {
  // the host reloaded: same room, from the autosaved world
  startSandbox();
  const boot = readSave();
  const bootWorld = boot ? rleDecode(boot, SIM_W * SIM_H) : null;
  if (bootWorld) adoptWorld(bootWorld);
  void hostRoom(urlRoom);
} else if (urlRoom) {
  void joinRoom(urlRoom);
} else if (urlCode) {
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
  // A returning player gets their sandbox back instead of an empty world: the
  // save used to be reachable only through the LOAD button, so any reload or
  // tab close looked like the game had reset itself.
  const boot = readSave();
  const bootWorld = boot ? rleDecode(boot, SIM_W * SIM_H) : null;
  if (bootWorld) {
    startSandbox();
    adoptWorld(bootWorld);
    toast('WORLD RESTORED');
  } else {
    openMenu();
  }
}

// ---- autosave ----
// Belt and braces: the interval covers a browser or tab that dies without
// warning, and pagehide covers the ordinary close/navigate. visibilitychange
// is the one that actually fires reliably on mobile, where pagehide is skipped.
const AUTOSAVE_MS = 15000;
setInterval(autosaveNow, AUTOSAVE_MS);
addEventListener('pagehide', autosaveNow);
addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') autosaveNow();
});
