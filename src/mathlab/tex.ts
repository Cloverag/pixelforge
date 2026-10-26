/**
 * Formulas typeset with KaTeX, loaded the first time MATH LAB shows one so
 * no other mode pays for it. Renders in call order: a later formula never
 * lands under an earlier one that was still loading.
 */

type Katex = typeof import('katex').default;
let loading: Promise<Katex> | null = null;

function katex(): Promise<Katex> {
  loading ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => m.default);
  return loading;
}

/** Typeset `tex` into `el` (display style). A formula KaTeX cannot read is shown as its source, in red. */
export function renderTex(el: HTMLElement, tex: string): void {
  void katex().then((k) => k.render(tex, el, { displayMode: true, throwOnError: false, output: 'html' }));
}
