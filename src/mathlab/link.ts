import type { Param } from './drawings';

/**
 * A MATH LAB design as a link code: which drawing, its slider values and
 * (for YOUR CURVE) the formula. JSON in base64url. Reading one back trusts
 * nothing: an unknown drawing is refused, values are clamped to their
 * sliders, the formula is cut to a sane length.
 */

interface Designable {
  id: string;
  params: Param[];
}

export interface Design<T extends Designable> {
  item: T;
  params: Record<string, number>;
  formula?: string;
}

/** a formula, or a PYTHON program: long enough for real code, short enough for a link */
const MAX_FORMULA = 4000;

const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

export function encodeDesign(id: string, params: Record<string, number>, formula?: string): string {
  return b64url(JSON.stringify(formula === undefined ? { d: id, p: params } : { d: id, p: params, f: formula }));
}

export function decodeDesign<T extends Designable>(code: string, items: T[]): Design<T> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(unb64url(code));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const { d, p, f } = raw as { d?: unknown; p?: unknown; f?: unknown };
  const item = items.find((it) => it.id === d);
  if (!item) return null;
  const given = p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
  const params: Record<string, number> = {};
  for (const q of item.params) {
    const v = given[q.key];
    params[q.key] = typeof v === 'number' && Number.isFinite(v) ? Math.min(q.max, Math.max(q.min, v)) : q.value;
  }
  return { item, params, formula: typeof f === 'string' ? f.slice(0, MAX_FORMULA) : undefined };
}
