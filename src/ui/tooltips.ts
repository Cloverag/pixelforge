/**
 * Hover tooltips for every tool, swatch and topbar button.
 *
 * Owned by MANAGER lane. Installed automatically by initHelp(); no builder
 * wiring needed. Uses event delegation on .swatch / button.px elements so it
 * keeps working when palettes are rebuilt.
 */
import { MATS } from '../sim/materials';
import { ELEMENT_NOTES } from './help';
import { h } from './widgets';

const CAT_NAMES = ['background', 'powder', 'liquid', 'gas', 'solid'];

const TOOL_NOTES: Record<string, string> = {
  FOUNTAIN: 'Hold to emit a steady stream of particles.',
  FIREWORK: 'Click to launch a rocket that bursts into sparks.',
  ATTRACT: 'Particles are pulled toward your cursor.',
  REPULSE: 'Particles are pushed away from your cursor.',
  VORTEX: 'Particles swirl around your cursor.',
  WALL: 'Paint indestructible wall blocks.',
  ERASE: 'Erase cells or particles under the brush.',
};

const BTN_NOTES: Record<string, string> = {
  SAVE: 'Store this sandbox world in this browser.',
  LOAD: 'Restore the last saved world.',
  PAUSE: 'Pause / resume the simulation. (SPACE)',
  RESUME: 'Resume the simulation. (SPACE)',
  STEP: 'Advance exactly one frame while paused. (N)',
  SFX: 'Mute / unmute sound effects. (M)',
  MUSIC: 'Toggle the background music loop.',
  CRT: 'Toggle the CRT scanline filter. (C)',
  BG: 'Cycle the background wallpaper.',
  MENU: 'Back to the main menu. (ESC)',
  BUCKET: 'Flood-fill the connected area with the selected material. (F)',
  '?': 'Open the help overlay.',
  X: 'Close this panel.',
};

let tip: HTMLElement | null = null;
let installed = false;

function describe(target: HTMLElement): { name: string; note: string } | null {
  const sw = target.closest('.swatch');
  if (sw) {
    const name = sw.querySelector('.nm')?.textContent?.trim() ?? '';
    const m = MATS.find((x) => x && x.name === name);
    if (m) {
      const cat = CAT_NAMES[m.cat] ?? 'material';
      return { name, note: `${cat} - ${ELEMENT_NOTES[name] ?? ''}` };
    }
    return { name, note: TOOL_NOTES[name] ?? '' };
  }
  const btn = target.closest('button.px');
  if (btn) {
    const name = btn.textContent?.trim() ?? '';
    return { name, note: BTN_NOTES[name] ?? '' };
  }
  return null;
}

function place(x: number, y: number): void {
  if (!tip || tip.classList.contains('hidden')) return;
  const pad = 14;
  let px = x + pad;
  let py = y + pad;
  const r = tip.getBoundingClientRect();
  if (px + r.width > window.innerWidth - 8) px = x - r.width - pad;
  if (py + r.height > window.innerHeight - 8) py = y - r.height - pad;
  tip.style.left = `${Math.max(4, px)}px`;
  tip.style.top = `${Math.max(4, py)}px`;
}

export function initTooltips(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  tip = h('div', 'pf-tip hidden');
  tip.id = 'pf-tooltip';
  document.body.appendChild(tip);

  const zoneOf = (el: EventTarget | null): HTMLElement | null => {
    if (!(el instanceof HTMLElement)) return null;
    return el.closest<HTMLElement>('.swatch, button.px');
  };

  document.addEventListener('mouseover', (e) => {
    if (!tip) return;
    const zone = zoneOf(e.target);
    if (!zone) {
      tip.classList.add('hidden');
      return;
    }
    const d = describe(zone);
    if (!d || !d.note) {
      tip.classList.add('hidden');
      return;
    }
    tip.innerHTML = '';
    tip.appendChild(h('b', '', d.name));
    tip.appendChild(document.createTextNode(d.note));
    tip.classList.remove('hidden');
    place(e.clientX, e.clientY);
  });

  document.addEventListener('mouseout', (e) => {
    const zone = zoneOf(e.target);
    const rel = e.relatedTarget instanceof HTMLElement ? zoneOf(e.relatedTarget) : null;
    if (zone && rel !== zone && tip) tip.classList.add('hidden');
  });

  window.addEventListener('pointermove', (e) => place(e.clientX, e.clientY));
}
