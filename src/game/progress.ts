const KEY = 'pixelforge.progress';

export type Progress = Record<string, number>;

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as Progress;
    return typeof p === 'object' && p !== null ? p : {};
  } catch {
    return {};
  }
}

export function recordStars(id: string, stars: number): void {
  if (stars <= 0) return;
  const p = loadProgress();
  p[id] = Math.max(p[id] ?? 0, stars);
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage full / private mode - ignore */
  }
}

export function isUnlocked(index: number, order: string[], p: Progress): boolean {
  if (index === 0) return true;
  return (p[order[index - 1]] ?? 0) >= 1;
}
