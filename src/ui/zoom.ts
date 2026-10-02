/**
 * Manual zoom's gestures on the arena (plans/camera-and-fog.md §5.4): a
 * two-finger pinch on a phone; the wheel and a trackpad pinch on desktop.
 * The camera is always centred on the tower, so a pinch's midpoint and a
 * wheel's pointer position are ignored: only the ratio matters.
 */
export interface ZoomTarget {
  /** Zoom by `factor` (>1 in), tracking the gesture without easing or snapping. */
  zoomBy(factor: number): void;
  /** The gesture ended: snap to fully out if it is nearly there. */
  settle(): void;
  /** False while no run is on screen: the gestures do nothing. */
  active(): boolean;
}

/** Zoom per wheel pixel: a mouse notch (~100 px) is ~16%; a trackpad pinch reports finer, ctrl-flagged deltas. */
const WHEEL_RATE = 0.0015;
const PINCH_WHEEL_RATE = 0.01;
/** Pixels per wheel line, for a `deltaMode` of lines (Firefox's mouse wheel). */
const LINE_PX = 16;
/** A wheel gesture has ended once no tick has come for this long. */
const WHEEL_SETTLE_MS = 250;

/** Bind the gestures on `el` (the canvas); returns the unbind. */
export function bindZoom(el: HTMLElement, target: ZoomTarget): () => void {
  const pointers = new Map<number, { x: number; y: number }>();
  let spread = 0;
  let wheelTimer: ReturnType<typeof setTimeout> | null = null;

  const distance = (): number => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const onWheel = (ev: WheelEvent): void => {
    if (!target.active()) return;
    // The page must not zoom, nor scroll, under a trackpad pinch (ctrl + wheel).
    ev.preventDefault();
    const dy = ev.deltaMode === 1 ? ev.deltaY * LINE_PX : ev.deltaMode === 2 ? ev.deltaY * 400 : ev.deltaY;
    const rate = ev.ctrlKey ? PINCH_WHEEL_RATE : WHEEL_RATE;
    target.zoomBy(Math.exp(-dy * rate));
    if (wheelTimer !== null) clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
      wheelTimer = null;
      target.settle();
    }, WHEEL_SETTLE_MS);
  };

  const onDown = (ev: PointerEvent): void => {
    if (ev.pointerType === 'mouse') return;
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size === 2) spread = distance();
  };

  const onMove = (ev: PointerEvent): void => {
    const p = pointers.get(ev.pointerId);
    if (!p) return;
    p.x = ev.clientX;
    p.y = ev.clientY;
    if (pointers.size !== 2 || spread <= 0 || !target.active()) return;
    const now = distance();
    if (now <= 0) return;
    target.zoomBy(now / spread);
    spread = now;
  };

  const onUp = (ev: PointerEvent): void => {
    if (!pointers.delete(ev.pointerId)) return;
    // The pinch ends when a finger of the two lifts.
    if (pointers.size === 1 && spread > 0) target.settle();
    spread = pointers.size === 2 ? distance() : 0;
  };

  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  return () => {
    if (wheelTimer !== null) clearTimeout(wheelTimer);
    el.removeEventListener('wheel', onWheel);
    el.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  };
}
