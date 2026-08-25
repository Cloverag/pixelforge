import { CHALLENGES } from '../sim/challenges';
import { isUnlocked, loadProgress, Progress } from '../game/progress';
import { h } from './widgets';

export interface MenuCallbacks {
  onSandbox(): void;
  onPlayground(): void;
  onChallenge(id: string): void;
  onToggleMute(): void;
  onToggleCrt(): void;
  onToggleBg(): void;
  onToggleMusic(): void;
  onHelp(): void;
  onToggle3d(): void;
}

const STARS_PER_LEVEL = 3;

function starHtml(n: number): string {
  let out = '';
  for (let i = 0; i < STARS_PER_LEVEL; i++)
    out += `<span class="${i < n ? 'on' : 'off'}">★</span>`;
  return out;
}

/** A big mode button with a one-line explanation underneath the label. */
function modeButton(label: string, sub: string, primary: boolean, onClick: () => void): HTMLElement {
  const b = h('button', 'px mode-btn' + (primary ? ' primary' : ''));
  (b as HTMLButtonElement).type = 'button';
  b.appendChild(h('span', '', label));
  b.appendChild(h('span', 'sub', sub));
  b.onclick = onClick;
  return b;
}

export function showMenu(cbs: MenuCallbacks): void {
  const overlay = document.getElementById('overlay')!;
  overlay.innerHTML = '';
  overlay.classList.remove('hidden');

  const screen = h('div', 'screen');
  screen.appendChild(h('div', 'game-title', 'PIXELFORGE'));
  screen.appendChild(h('div', 'tagline', 'A PIXEL PARTICLE SANDBOX'));
  screen.appendChild(h('div', 'title-rule'));

  const col = h('div', 'menu-col');
  col.appendChild(
    modeButton('SANDBOX', 'Paint 20 materials. No rules, no timer.', true, cbs.onSandbox),
  );
  col.appendChild(
    modeButton('PARTICLE PLAYGROUND', 'Fountains, vortices and gravity toys.', false, cbs.onPlayground),
  );
  screen.appendChild(col);

  const prog: Progress = loadProgress();
  const order = CHALLENGES.map((c) => c.id);
  const earned = CHALLENGES.reduce((sum, c) => sum + (prog[c.id] ?? 0), 0);
  const total = CHALLENGES.length * STARS_PER_LEVEL;

  const chalTitle = h('div', 'section-title');
  chalTitle.appendChild(h('span', '', 'CHALLENGES'));
  chalTitle.appendChild(h('span', 'count', `★ ${earned} / ${total}`));
  screen.appendChild(chalTitle);

  const listEl = h('div', 'challenge-list');
  CHALLENGES.forEach((c, i) => {
    const unlocked = isUnlocked(i, order, prog);
    const stars = prog[c.id] ?? 0;
    const card = h(
      'div',
      'challenge-card' + (unlocked ? '' : ' locked') + (stars > 0 ? ' cleared' : ''),
    );

    const head = h('div', 'chead');
    head.appendChild(h('span', 'cnum', String(i + 1)));
    head.appendChild(h('span', 'cname', c.name));
    card.appendChild(head);

    card.appendChild(
      h('div', 'cdesc', unlocked ? c.desc : 'LOCKED · clear the level before it'),
    );

    const starsEl = h('div', 'stars');
    starsEl.innerHTML = unlocked ? starHtml(stars) : starHtml(0);
    card.appendChild(starsEl);

    if (unlocked) {
      card.onclick = () => cbs.onChallenge(c.id);
      card.title = c.hint;
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.onkeydown = (e) => {
        const k = (e as KeyboardEvent).key;
        if (k === 'Enter' || k === ' ') {
          e.preventDefault();
          cbs.onChallenge(c.id);
        }
      };
    }
    listEl.appendChild(card);
  });
  screen.appendChild(listEl);

  const foot = h('div', 'menu-foot');
  const row = h('div', 'btn-row');
  const mute = h('button', 'px', 'SFX: ON');
  mute.onclick = () => {
    cbs.onToggleMute();
    const muted = document.body.classList.contains('muted');
    mute.textContent = muted ? 'SFX: OFF' : 'SFX: ON';
    mute.classList.toggle('toggled', muted);
  };
  const crt = h('button', 'px toggled', 'CRT: ON');
  crt.onclick = () => {
    cbs.onToggleCrt();
    const on = document.body.classList.contains('crt-on');
    crt.classList.toggle('toggled', on);
    crt.textContent = on ? 'CRT: ON' : 'CRT: OFF';
  };
  const bg = h('button', 'px', 'WALLPAPER');
  bg.onclick = () => cbs.onToggleBg();
  const help = h('button', 'px primary', '? HELP');
  help.onclick = () => cbs.onHelp();
  for (const b of [mute, crt, bg, help]) {
    (b as HTMLButtonElement).type = 'button';
    row.appendChild(b);
  }
  foot.appendChild(row);
  foot.appendChild(
    h(
      'div',
      'hint-line',
      'LEFT DRAG PAINT   ·   RIGHT DRAG ERASE   ·   WHEEL OR [ ] BRUSH SIZE\n' +
        'SPACE PAUSE   ·   N STEP   ·   M SOUND   ·   C CRT   ·   ESC MENU',
    ),
  );
  screen.appendChild(foot);

  overlay.appendChild(screen);
}
