/**
 * The one long-press helper (UI plan §9.C).
 *
 * Part 7 built hold-to-inspect inside `AbilityBar`; §8.C.3 then grew a second,
 * touch-event-only copy inside `EquipmentPanel`. §9.C says every hover-only
 * affordance needs a touch route and that the route must *reuse* the Part 7
 * helper rather than add a third copy — so the Part 7 behaviour lives here and
 * the call sites bind to it.
 *
 * Why pointer events and not touch events: one code path for finger, mouse and
 * pen. A `touchstart`-only version leaves a pen or a trackpad press with no
 * route at all, and leaves the desktop hold — the gesture a mouse user reaches
 * for once they have learnt it on a phone — dead.
 *
 * `pointermove` / `pointerup` are bound to the **window**, not the element: a
 * finger that slides off the target still has to cancel the hold, and a release
 * that lands outside still has to clear the timer.
 */

/** How long a press has to last before it counts as a hold. */
export const LONG_PRESS_MS = 380;

/**
 * A hold that wanders further than this is a scroll or a drag, not an inspect.
 * Matched to `EquipmentPanel`'s 5 px drag threshold so a press that becomes a
 * drag cancels the inspect on exactly the same pixel.
 */
export const LONG_PRESS_SLOP_PX = 8;

export interface LongPressOptions {
  /**
   * Optional delegation selector. When given, the press must land inside a
   * descendant matching it and that descendant — not the host — is what the
   * callbacks receive. Lets one binding cover a list that re-renders.
   */
  selector?: string;
  /** Fires when the hold survives `holdMs` without exceeding the slop. */
  onLongPress: (target: HTMLElement, ev: PointerEvent) => void;
  /**
   * Fires when a fired hold is released (or cancelled after firing). Call sites
   * that show a transient surface tear it down here.
   */
  onRelease?: (target: HTMLElement) => void;
  /** Return false to ignore this press entirely (a drag is in flight, …). */
  shouldStart?: (target: HTMLElement, ev: PointerEvent) => boolean;
  holdMs?: number;
  slopPx?: number;
  /**
   * Swallow the `click` the browser sends after the hold (default true). A hold
   * that both inspects *and* fires the tile's primary action is the bug Part 7
   * fixed on the ability bar; every other call site wants the same.
   */
  suppressClick?: boolean;
}

/** How long the post-hold click suppressor waits for a click that may never come. */
const CLICK_SUPPRESS_WINDOW_MS = 700;

/**
 * Marks a host as a hold-to-inspect surface so the stylesheet can turn off the
 * browser's *own* long-press gestures on it.
 *
 * This is the helper's job, not each call site's. Chrome on Android answers a
 * long press on selectable text by starting a text selection, and starting one
 * fires `pointercancel` — which lands in `reset()` and destroys the hold before
 * it can fire. The ability dock never hit this because its targets are
 * `<button>`s and the base stylesheet already makes buttons unselectable; the
 * equipment cards are `div`s full of text, so a hold selected the item name and
 * the popup never came. Anything bound here needs the same treatment, including
 * call sites that do not exist yet, so the class goes on from inside `bind`.
 */
const HOLD_TARGET_CLASS = 'is-hold-surface';

/**
 * Binds hold-to-inspect on `host` and returns the unbind.
 *
 * On fire the target gains `is-long-press`; the class survives until release so
 * a `click` handler can check it and suppress the click the browser sends after
 * the hold. The class is removed on release, after `onRelease` has run.
 */
export function bindLongPress(host: HTMLElement, opts: LongPressOptions): () => void {
  const holdMs = opts.holdMs ?? LONG_PRESS_MS;
  const slop = opts.slopPx ?? LONG_PRESS_SLOP_PX;

  let timer: number | null = null;
  let target: HTMLElement | null = null;
  let fired = false;
  let startX = 0;
  let startY = 0;

  const clearTimer = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  const reset = (): void => {
    clearTimer();
    const el = target;
    target = null;
    if (!el) return;
    if (fired) {
      fired = false;
      opts.onRelease?.(el);
      el.classList.remove('is-long-press');
    }
  };

  /**
   * The click that follows a hold has to die before it reaches anyone, and the
   * hold's own element is not necessarily where it lands (a finger that lifts
   * one pixel outside still produces a click on the parent). So the suppressor
   * is a one-shot capture listener on the window, torn down either by the click
   * it eats or by a timeout when no click arrives at all.
   */
  const armClickSuppressor = (): void => {
    let expiry: number | null = null;
    const swallow = (ev: Event): void => {
      ev.stopPropagation();
      ev.preventDefault();
      if (expiry !== null) window.clearTimeout(expiry);
      window.removeEventListener('click', swallow, true);
    };
    window.addEventListener('click', swallow, true);
    expiry = window.setTimeout(() => {
      window.removeEventListener('click', swallow, true);
    }, CLICK_SUPPRESS_WINDOW_MS);
  };

  const onDown = (ev: PointerEvent): void => {
    reset();
    const from = ev.target as HTMLElement | null;
    if (!from) return;
    const el = opts.selector
      ? (from.closest(opts.selector) as HTMLElement | null)
      : host;
    if (!el) return;
    if (opts.shouldStart && !opts.shouldStart(el, ev)) return;
    target = el;
    startX = ev.clientX;
    startY = ev.clientY;
    timer = window.setTimeout(() => {
      timer = null;
      if (!target) return;
      fired = true;
      target.classList.add('is-long-press');
      if (opts.suppressClick !== false) armClickSuppressor();
      opts.onLongPress(target, ev);
    }, holdMs);
  };

  const onMove = (ev: PointerEvent): void => {
    if (target === null || timer === null) return;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (dx * dx + dy * dy > slop * slop) reset();
  };

  const onEnd = (): void => reset();

  host.classList.add(HOLD_TARGET_CLASS);
  host.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onEnd);
  window.addEventListener('pointercancel', onEnd);
  window.addEventListener('blur', onEnd);

  return () => {
    reset();
    host.classList.remove(HOLD_TARGET_CLASS);
    host.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onEnd);
    window.removeEventListener('pointercancel', onEnd);
    window.removeEventListener('blur', onEnd);
  };
}
