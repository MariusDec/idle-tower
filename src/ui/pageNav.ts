/**
 * The identity's page change (docs/visual-identity/GUIDELINES.md, Motion):
 * a push lays the new page over the old one like a card, a back lifts the
 * top card off. The CSS lives in main.css under "Page change"; this only
 * says which way, and runs the swap inside a View Transition.
 */
export type NavDirection = 'forward' | 'backward';

/** The transition in flight, so a finished one never clears a newer one's direction. */
let running: ViewTransition | null = null;

/**
 * Run `swap` (the DOM change from one page to the next) as a page change.
 * The root snapshot carries the whole stage, the ground's gradient and the
 * backdrop tower included, so each sliding layer is opaque for free. With
 * motion reduced, or no View Transitions (older WebViews, tests), it is an
 * instant swap, run at once.
 */
export function navigate(dir: NavDirection, swap: () => void): void {
  const root = document.documentElement;
  if (typeof document.startViewTransition !== 'function' || root.dataset.motion === 'reduce') {
    swap();
    return;
  }
  root.dataset.nav = dir;
  let swapped = false;
  // A rapid second navigation skips the first: never two leaving pages stacked.
  const t = document.startViewTransition(() => {
    swapped = true;
    swap();
  });
  running = t;
  // The snapshot waits on a rendered frame. A WebView that renders none for a
  // while (throttled, or busy) must not leave the old page up: skip the slide,
  // which still runs the swap.
  window.setTimeout(() => {
    if (!swapped) t.skipTransition();
  }, 500);
  // A skipped transition rejects `ready`; that is expected, not an error.
  t.ready.catch(() => {});
  const done = (): void => {
    if (running !== t) return;
    running = null;
    delete root.dataset.nav;
  };
  t.finished.then(done, done);
}

/**
 * The same page change inside a panel (Settings' Options and Stats), where a
 * View Transition would carry the whole screen: `leaving` (the old page,
 * already off the DOM's live tree or about to be) becomes a still layer in
 * `box` while `entering` (the live new page, already in `box`) slides. The
 * sheet behind them is glass, so neither layer paints a ground: the page
 * underneath is clipped where the top one covers it instead (main.css).
 */
export function turnPage(box: HTMLElement, leaving: HTMLElement, entering: HTMLElement, dir: NavDirection): void {
  if (document.documentElement.dataset.motion === 'reduce') return;
  const ENTER = ['page-enter--forward', 'page-enter--backward'];
  // The page being left may itself have been mid-slide in: it leaves from where it is drawn now.
  leaving.classList.remove(...ENTER);
  leaving.classList.add('page-leaving', `page-exit--${dir}`);
  leaving.setAttribute('aria-hidden', 'true');
  leaving.inert = true;
  entering.classList.add(`page-enter--${dir}`);
  box.classList.add('is-turning');
  box.append(leaving);
  const end = (e: AnimationEvent): void => {
    if (e.target !== entering) return;
    entering.removeEventListener('animationend', end);
    entering.classList.remove(...ENTER);
    leaving.remove();
    box.classList.remove('is-turning');
  };
  entering.addEventListener('animationend', end);
}

/**
 * The first paint after launch: a plain fade, no slide. The class goes once
 * the fade is over, so it doesn't replay on the next show.
 */
export function firstPaint(el: HTMLElement): void {
  el.classList.add('page-first-paint');
  // A child's own animation bubbles here too; only the fade's end counts.
  const end = (e: AnimationEvent): void => {
    if (e.target !== el) return;
    el.classList.remove('page-first-paint');
    el.removeEventListener('animationend', end);
  };
  el.addEventListener('animationend', end);
}
