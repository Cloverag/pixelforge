/**
 * In-game HELP overlay.
 *
 * Owned by MANAGER lane. Exposes:
 *   initHelp()              - call once at boot
 *   toggleHelp(force?)      - wire "?" buttons / keys to this
 *
 * The overlay is self-contained: it renders controls, an element guide and
 * challenge goals straight from the game data so it never goes stale.
 */
import { MATS } from '../sim/materials';
import { CHALLENGES } from '../sim/challenges';
import { h } from './widgets';
import { initTooltips } from './tooltips';

let root: HTMLElement | null = null;
let isOpen = false;

export const ELEMENT_NOTES: Record<string, string> = {
  SAND: 'Basic powder.',
  WATER: 'Flows fast. Sparks turn it to steam.',
  OIL: 'Floats on water, burns eagerly.',
  FIRE: 'Short-lived. Ignites oil, wood, plants, powder.',
  SMOKE: 'Rises, fades away.',
  STEAM: 'Rises, condenses back to water.',
  LAVA: 'Melts ice, starts fires, dies on meltwater.',
  STONE: 'Sturdy solid. Acid eats it slowly.',
  ICE: 'Melts near heat.',
  WOOD: 'Flammable building solid.',
  PLANT: 'Grows when drinking adjacent water.',
  SEED: 'Sprouts into plants on wet ground.',  ACID: 'Dissolves almost everything.',
  POWDER: 'Gunpowder. Explodes on any ignition.',
  FUSE: 'Burns slowly along its length. Timing fuses.',
  GLASS: 'Transparent, blast-proof.',
  WALL: 'Indestructible.',
  WIRE: 'Carries spark pulses. Energized wire glows.',
  TORCH: 'Pulses sparks into touching wire.',
  CLONE: 'Copies whatever touches it first.',
  VOID: 'Deletes neighboring cells.',
};

function cssHex(u: number): string {
  const r = u & 255;
  const g = (u >>> 8) & 255;
  const b = (u >>> 16) & 255;
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function section(title: string): HTMLElement {
  const el = h('div', 'pf-help-section');
  el.appendChild(h('div', 'pf-help-heading', title));
  return el;
}

function buildContent(box: HTMLElement): void {
  // ----- controls -----
  const controls = section('CONTROLS');
  const rows: [string, string][] = [
    ['LEFT DRAG', 'paint selected material'],
    ['RIGHT DRAG', 'erase'],
    ['WHEEL / [ ]', 'brush size 2-24'],
    ['F', 'flood-fill bucket (sandbox)'],
    ['1-9', 'quick-pick palette swatch'],
    ['SPACE', 'pause / resume'],
    ['N', 'single step while paused'],
    ['G', 'toggle gravity (playground)'],
    ['M / C', 'mute sfx / CRT filter'],
    ['ESC', 'back to menu'],
  ];
  for (const [k, d] of rows) {
    const line = h('div', 'pf-help-krow');
    line.appendChild(h('span', 'pf-key', k));
    line.appendChild(h('span', 'pf-desc', d));
    controls.appendChild(line);
  }
  box.appendChild(controls);

  // ----- element guide -----
  const guide = section('ELEMENTS');
  const grid = h('div', 'pf-el-grid');
  for (const m of MATS) {
    if (!m || !m.placeable || m.id === 0) continue;
    const item = h('div', 'pf-el');
    const chip = h('span', 'pf-chip');
    chip.style.background = cssHex(m.ramp[0]);
    item.appendChild(chip);
    const txt = h('span', 'pf-el-txt');
    const b = h('b', '', m.name);
    txt.appendChild(b);
    txt.appendChild(document.createTextNode(` ${ELEMENT_NOTES[m.name] ?? ''}`));
    item.appendChild(txt);
    item.title = m.name;
    grid.appendChild(item);
  }
  guide.appendChild(grid);
  box.appendChild(guide);

  // ----- challenges -----
  const ch = section('CHALLENGES');
  CHALLENGES.forEach((c, i) => {
    const card = h('div', 'pf-chal');
    card.appendChild(
      h('div', 'pf-chal-name', `${i + 1}. ${c.name}`),
    );
    card.appendChild(h('div', 'pf-chal-desc', c.desc));
    card.appendChild(h('div', 'pf-chal-hint', `TIP: ${c.hint}`));
    ch.appendChild(card);
  });
  box.appendChild(ch);

  // ----- scoring blurb -----
  const score = section('SCORING');
  score.appendChild(
    h(
      'div',
      'pf-help-blurb',
      'Finish before the timer for up to 3 stars. Spend less material for ' +
        'better stars on rationed levels. Earn at least 1 star to unlock the ' +
        'next challenge. Stars save automatically in this browser.',
    ),
  );
  box.appendChild(score);
}

export function initHelp(): void {
  if (root) return;
  initTooltips();

  const box = h('div', 'screen pf-help-box');

  const head = h('div', 'pf-help-head');
  head.appendChild(h('h2', '', 'HOW TO PLAY'));
  const closeBtn = h('button', 'px primary', 'X') as HTMLButtonElement;
  closeBtn.title = 'Close help';
  closeBtn.onclick = () => toggleHelp(false);
  head.appendChild(closeBtn);
  box.appendChild(head);

  const cols = h('div', 'pf-help-cols');
  buildContent(cols);
  box.appendChild(cols);

  root = h('div', 'pf-help hidden');
  root.id = 'help-overlay';
  root.appendChild(box);
  // click outside the box closes
  root.addEventListener('pointerdown', (e) => {
    if (e.target === root) toggleHelp(false);
  });

  document.body.appendChild(root);

  window.addEventListener('keydown', (e) => {
    if (isOpen && e.key === 'Escape') {
      e.stopImmediatePropagation();
      toggleHelp(false);
    }
  });
}

export function toggleHelp(force?: boolean): void {
  if (!root) initHelp();
  isOpen = force ?? !isOpen;
  root!.classList.toggle('hidden', !isOpen);
}

export function isHelpOpen(): boolean {
  return isOpen;
}
