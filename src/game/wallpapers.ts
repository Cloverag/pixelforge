import bgNeon from '../assets/bg-neon.jpg';
import bgSpace from '../assets/bg-space.jpg';
import bgAbstract from '../assets/bg-abstract.jpg';

/** null = default checkerboard, then downloadable wallpapers */
export const WALLPAPERS: (string | null)[] = [
  null,
  bgNeon,
  bgSpace,
  bgAbstract,
];

export const WALLPAPER_NAMES = ['GRID', 'NEON', 'NEBULA', 'EMBER'];

const KEY = 'pixelforge.bg';

export function loadBgIndex(): number {
  try {
    const raw = localStorage.getItem(KEY);
    const n = raw === null ? NaN : Number(raw);
    if (Number.isInteger(n) && n >= 0 && n < WALLPAPERS.length) return n;
  } catch {
    /* ignore */
  }
  return 0;
}

export function applyWallpaper(index: number): void {
  const i = ((index % WALLPAPERS.length) + WALLPAPERS.length) % WALLPAPERS.length;
  try {
    localStorage.setItem(KEY, String(i));
  } catch {
    /* ignore */
  }
  const w = WALLPAPERS[i];
  document.body.classList.toggle('has-wallpaper', w !== null);
  if (w) document.body.style.setProperty('--wallpaper', `url(${w})`);
  else document.body.style.removeProperty('--wallpaper');
}
