/**
 * The big red button's 3-2-1: big digits over the screen, a beep each, then
 * `fire` and a BOOM. A second press while it counts does nothing; leaving the
 * mode cancels it.
 */
let timer = 0;

/** Starts the count; false if one is already running. */
export function countdown(beep: () => void, fire: () => void): boolean {
  if (timer) return false;
  const wrap = document.getElementById('screen-wrap');
  if (!wrap) {
    fire();
    return true;
  }
  const el = document.createElement('div');
  el.setAttribute('aria-live', 'assertive');
  wrap.append(el);
  let n = 3;
  const tick = () => {
    const last = n === 0;
    el.textContent = last ? 'BOOM' : String(n);
    // a fresh class each beat restarts the pop
    el.className = 'countdown';
    void el.offsetWidth;
    el.className = last ? 'countdown boom' : 'countdown pop';
    if (last) {
      fire();
      timer = window.setTimeout(() => {
        el.remove();
        timer = 0;
      }, 500);
      return;
    }
    beep();
    n--;
    timer = window.setTimeout(tick, 600);
  };
  tick();
  return true;
}

export function cancelCountdown(): void {
  window.clearTimeout(timer);
  timer = 0;
  document.querySelector('#screen-wrap > .countdown')?.remove();
}
