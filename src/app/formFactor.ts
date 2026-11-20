/**
 * The form factor (plans/large-screens.md §3): one classification of the
 * screen the game has, taken from a CSS box rather than the user agent, so a
 * desktop window dragged narrow plays like a phone and half a split-screen
 * tablet plays like whatever it is.
 *
 *   compact   short side < 600, or a landscape box under 500 tall: every
 *             phone, a narrow or short window, a folded foldable
 *   medium    short side ≥ 600, portrait (h ≥ w): a tablet held upright,
 *             an unfolded book-style foldable
 *   expanded  short side ≥ 600, landscape (w > h): a tablet on its side,
 *             a desktop, a Chromebook
 *
 * `formOf` is pure, so the camera can classify the stage it draws on and
 * the arena's shape (`stageOval`) can never disagree with it. The rest of
 * the app reads `currentForm()`, which `watchFormFactor` keeps up to date
 * and mirrors onto `<html data-form>` for the CSS.
 */

export type FormFactor = 'compact' | 'medium' | 'expanded';

/** The short side, CSS px, from which a screen is no longer a phone's. */
export const FORM_MIN_SHORT = 600;
/** A landscape box shorter than this is `compact` however wide it is. */
export const FORM_MIN_LANDSCAPE_HEIGHT = 500;

/** The class of a CSS box `width` × `height`. */
export function formOf(width: number, height: number): FormFactor {
  const w = Number.isFinite(width) ? width : 0;
  const h = Number.isFinite(height) ? height : 0;
  if (Math.min(w, h) < FORM_MIN_SHORT) return 'compact';
  if (h >= w) return 'medium';
  return h < FORM_MIN_LANDSCAPE_HEIGHT ? 'compact' : 'expanded';
}

let form: FormFactor = 'compact';
const listeners = new Set<(form: FormFactor) => void>();

/** The class as last measured: `compact` until `watchFormFactor` has run. */
export function currentForm(): FormFactor {
  return form;
}

/** Call `fn` whenever the class changes. Returns the unsubscribe. */
export function onFormChange(fn: (form: FormFactor) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function set(next: FormFactor, root: HTMLElement): void {
  if (root.dataset.form !== next) root.dataset.form = next;
  if (next === form) return;
  form = next;
  for (const fn of listeners) fn(next);
}

/**
 * Measure `host` (the `#app` box, which is the viewport the stage may grow
 * to) now and on every resize, and keep `<html data-form>` in step.
 */
export function watchFormFactor(host: HTMLElement, root: HTMLElement = document.documentElement): () => void {
  const measure = (): void => {
    const r = host.getBoundingClientRect();
    set(formOf(r.width, r.height), root);
  };
  measure();
  if (typeof ResizeObserver !== 'function') {
    addEventListener('resize', measure);
    return () => removeEventListener('resize', measure);
  }
  const observer = new ResizeObserver(measure);
  observer.observe(host);
  return () => observer.disconnect();
}
