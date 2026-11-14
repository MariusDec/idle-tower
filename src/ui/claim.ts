/**
 * Claiming a thing in the arena with a tap (plans/late-game/02 §2, shared
 * with plan 03's reliquaries): a one-finger tap within `CLAIM_SLOP` CSS
 * pixels of a target, kept apart from a pinch (`ui/zoom.ts` owns those) and
 * from a drag. When two targets are up, the nearer one takes the tap. The
 * HUD chip beside the ultimate is the other path, and the accessible one.
 */
export interface ClaimTarget<K extends string = string> {
  kind: K;
  /** Which one, when several of a kind may be up at once (reliquaries). */
  id?: number;
  /** Where it is, in world units. */
  x: number;
  y: number;
}

export interface ClaimHost<K extends string = string> {
  /** False while nothing may be claimed (no run on screen, a stopped arena). */
  active(): boolean;
  /** What is up to be claimed now. */
  targets(): readonly ClaimTarget<K>[];
  /** World point → CSS pixel, relative to the canvas's top-left corner. */
  toScreen(x: number, y: number): { x: number; y: number };
  claim(target: ClaimTarget<K>): void;
}

/** How far from a target a tap still lands on it, in CSS pixels (the 44 px touch floor). */
export const CLAIM_SLOP = 44;
/** A press that travels further than this is a drag, not a tap. */
const TAP_MOVE = 12;
/** A press held longer than this is not a tap. */
const TAP_MS = 500;

/** The target a tap at (x, y) lands on, or null: the nearest within the slop. */
export function nearestClaim<K extends string>(
  targets: readonly ClaimTarget<K>[], x: number, y: number, toScreen: ClaimHost<K>['toScreen'],
): ClaimTarget<K> | null {
  let best: ClaimTarget<K> | null = null;
  let bestD = CLAIM_SLOP;
  for (const t of targets) {
    const p = toScreen(t.x, t.y);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

/** Bind the tap on `el` (the canvas); returns the unbind. */
export function bindClaim<K extends string>(el: HTMLElement, host: ClaimHost<K>): () => void {
  const down = new Map<number, { x: number; y: number; at: number }>();
  /** A second finger came down during this gesture: it is a pinch, not a tap. */
  let pinched = false;

  const onDown = (ev: PointerEvent): void => {
    down.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, at: ev.timeStamp });
    if (down.size > 1) pinched = true;
  };

  const onUp = (ev: PointerEvent): void => {
    const start = down.get(ev.pointerId);
    down.delete(ev.pointerId);
    const wasPinch = pinched;
    if (down.size === 0) pinched = false;
    if (!start || wasPinch || !host.active()) return;
    if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > TAP_MOVE || ev.timeStamp - start.at > TAP_MS) return;
    const rect = el.getBoundingClientRect();
    const hit = nearestClaim(host.targets(), ev.clientX - rect.left, ev.clientY - rect.top, host.toScreen);
    if (hit) host.claim(hit);
  };

  const onCancel = (ev: PointerEvent): void => {
    down.delete(ev.pointerId);
    if (down.size === 0) pinched = false;
  };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);
  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onCancel);
  };
}
