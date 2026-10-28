/**
 * The title screen's arcade motion, where CSS runs out: a list's rows step in
 * one after another when it opens, and a pick that leaves the menu blinks
 * like a coin going in while the other rows drop away - and only then is the
 * mode started, so the blink is seen. Stepped eases, not smooth ones: the
 * screen is drawn in pixels, and its blinking arrow and bobbing logo already
 * move in steps.
 *
 * Reduced motion: no entrance, and a pick goes at once.
 */

const reduced = matchMedia('(prefers-reduced-motion: reduce)');

/**
 * GSAP is fetched at once but kept out of the entry chunk (28 kB gzipped, a
 * quarter of it): the first list a player sees comes after PRESS ENTER, long
 * after it has landed. Until then the menu works without motion.
 */
let gsap: typeof import('gsap').gsap | null = null;
void import('gsap').then((m) => (gsap = m.gsap));

/** A list just opened: its rows step in, top first. */
export function enterRows(items: HTMLElement[]): void {
  if (!gsap || reduced.matches || !items.length) return;
  gsap.from(items, { autoAlpha: 0, x: -24, duration: 0.18, ease: 'steps(3)', stagger: 0.03, clearProps: 'all' });
}

/**
 * A pick that leaves the menu: it blinks three times while the other rows drop
 * away from it, then `go` runs. If the menu is still up after (the pick opened
 * a dialog instead), the rows come back.
 */
export function launch(items: HTMLElement[], picked: number, go: () => void, stillUp: () => boolean): void {
  if (!gsap || reduced.matches || !items[picked]) return go();
  // an entrance still stepping in finishes first: killed halfway, it left the pick invisible to blink
  for (const t of gsap.getTweensOf(items)) t.progress(1);
  const tl = gsap.timeline({
    onComplete: () => {
      go();
      if (stillUp()) tl.revert();
    },
  });
  // six steps of 0.06s, ending lit: on, off, on, off, on, off, on
  tl.to(items[picked], { autoAlpha: 0, duration: 0.06, ease: 'steps(1)', repeat: 5, yoyo: true }, 0);
  const others = items.filter((_, k) => k !== picked);
  if (others.length)
    tl.to(others, { autoAlpha: 0, y: 14, duration: 0.2, ease: 'steps(4)', stagger: { each: 0.02, from: Math.min(picked, others.length - 1) } }, 0);
}
