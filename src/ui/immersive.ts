/**
 * Immersive mode: the canvas fills the window and every panel gets out of
 * the way.
 *
 * The panels are not removed, only slid off-screen, and come back as dark
 * glass when the pointer reaches their edge - the left rail for tools, the
 * top for the controls, the bottom for the status strip. The page also asks
 * the browser for real fullscreen; if it is refused (or the player leaves it
 * with the browser's own Esc), immersive mode follows rather than leaving a
 * half state behind.
 */

/** how close to an edge, in CSS px, the pointer has to come to call a panel */
const EDGE = 24;
/** how far past an open panel the pointer may wander before it closes */
const SLACK = 28;

let on = false;
let listener: ((on: boolean) => void) | null = null;

export function isImmersive(): boolean {
  return on;
}

/** Turn immersive mode on, off, or over. Returns the new state. */
export function setImmersive(want: boolean): boolean {
  if (want === on) return on;
  on = want;
  const body = document.body;
  body.classList.toggle('immersive', on);
  // the dark token set, whatever the theme: glass panels, toasts and
  // dialogs over a dark canvas (toasts live outside #app, so on body)
  body.classList.toggle('force-dark', on);
  if (!on) body.classList.remove('reveal-top', 'reveal-left', 'reveal-bottom');
  const root = document.documentElement;
  if (on && !document.fullscreenElement && root.requestFullscreen) {
    root.requestFullscreen().catch(() => {
      /* refused (iframe, phone browser): immersive works without it */
    });
  } else if (!on && document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
  // the canvas sizes itself on window resize; a class change is not one
  window.dispatchEvent(new Event('resize'));
  listener?.(on);
  return on;
}

export function toggleImmersive(): boolean {
  return setImmersive(!on);
}

/** Wire the edge reveals and the fullscreen hand-off. Call once at boot. */
export function initImmersive(onChange: (on: boolean) => void): void {
  listener = onChange;
  document.addEventListener('fullscreenchange', () => {
    // the browser's Esc left fullscreen: leave immersive with it
    if (on && !document.fullscreenElement) setImmersive(false);
  });
  window.addEventListener('pointermove', (e) => {
    if (!on || e.pointerType === 'touch') return;
    const body = document.body;
    const reveal = (cls: string, near: boolean, within: boolean) => {
      const open = body.classList.contains(cls);
      body.classList.toggle(cls, open ? within : near);
    };
    const rail = document.getElementById('toolbar')?.getBoundingClientRect();
    const top = document.getElementById('topbar')?.getBoundingClientRect();
    const status = document.getElementById('statusbar')?.getBoundingClientRect();
    reveal('reveal-left', e.clientX <= EDGE, !!rail && e.clientX <= rail.width + SLACK);
    reveal('reveal-top', e.clientY <= EDGE, !!top && e.clientY <= top.height + SLACK);
    reveal(
      'reveal-bottom',
      e.clientY >= window.innerHeight - EDGE,
      !!status && e.clientY >= window.innerHeight - status.height - SLACK,
    );
  });
}
