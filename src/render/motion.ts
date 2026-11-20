/**
 * Enemy motion curves (plans/enemy-animation.md §3.1). Pure and DOM-free, so
 * every curve is testable in Node. Presentation only: inputs are the wall
 * clock, an id-derived phase and render-side state, never the sim's RNG.
 *
 * Step 0 lands the curves and the wiring; the painter starts reading them
 * from step 1 on.
 */

export type GaitStyle = 'hop' | 'waddle' | 'slither' | 'float' | 'skitter';

/**
 * What runs (§2): `full` on `high` and `medium`, `lite` on `low`, and
 * `reduced` under reduced motion, which wins over any tier.
 */
export type MotionLevel = 'full' | 'lite' | 'reduced';

/** Reused per body, never allocated per frame. World units and scale factors. */
export interface BodyMotion {
  dx: number;
  dy: number;
  sx: number;
  sy: number;
}

/** Every tunable in one table. */
export const MOTION = {
  /** Most squash a gait may add, before crowd damping (§4.1). */
  gaitSquash: 0.12,
  /** `sx` and `sy` stay inside this band whatever adds up (§3.1). */
  minScale: 0.85,
  maxScale: 1.18,
  /** Below this height (0..1 of the hop), a hop lands and flattens. */
  hopLand: 0.25,
  /** Skitter's flutter in `sy`. */
  skitterFlutter: 0.04,
  /** Waddle's footfall squash, as a fraction of `gaitSquash`. */
  waddleSquash: 0.4,
  /** Hit squish (§5.1): peak, its `lite` peak, decay and period (s), and the re-arm gap. */
  squishAmp: 0.16,
  squishAmpLite: 0.08,
  squishDecay: 0.05,
  squishPeriod: 0.16,
  squishRearm: 0.2,
  /** Seconds a time-driven pop takes (§5.2). */
  popSeconds: 0.22,
  /** Crowd damping (§3.1): full motion up to `crowdFrom` bodies, `crowdFloor` of it at `crowdTo`. */
  crowdFrom: 60,
  crowdTo: 300,
  crowdFloor: 0.5,
} as const;

const TAU = Math.PI * 2;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

const smoothstep = (t: number): number => {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
};

/** The level from the setting and the tier's profile: derived once per change, never per body. */
export function motionLevel(reduced: boolean, tierMotion: 'full' | 'lite'): MotionLevel {
  return reduced ? 'reduced' : tierMotion;
}

/** Every amplitude's scale at `alive` bodies on the field: 1 up to 60, 0.5 at 300 and beyond. */
export function crowdDamping(alive: number): number {
  const t = clamp((alive - MOTION.crowdFrom) / (MOTION.crowdTo - MOTION.crowdFrom), 0, 1);
  return 1 - (1 - MOTION.crowdFloor) * t;
}

/**
 * One signed squash amount `q` as area-preserving scales: `sy = 1 − q`,
 * `sx = 1 / (1 − q)`, each held to `[minScale, maxScale]`. Positive `q`
 * flattens, negative stretches.
 */
export function applySquash(out: BodyMotion, q: number): void {
  const sy = clamp(1 - q, MOTION.minScale, MOTION.maxScale);
  out.sy = sy;
  out.sx = clamp(1 / sy, MOTION.minScale, MOTION.maxScale);
}

/**
 * A body's gait this frame, written into `out`. `phase` is
 * `time·freq + seed`; `weight` (0..1) eases the gait in and out; `heading`
 * is the unit vector toward the tower. Under `reduced` it is today's plain
 * bob (D-1): `dy = sin(phase)·amp·weight`, nothing else.
 */
export function gait(
  out: BodyMotion, style: GaitStyle, amp: number, phase: number, weight: number,
  heading: { nx: number; ny: number }, level: MotionLevel, crowd: number,
): void {
  out.dx = 0;
  out.dy = 0;
  out.sx = 1;
  out.sy = 1;
  if (weight <= 0) return;
  if (level === 'reduced') {
    out.dy = Math.sin(phase) * amp * weight;
    return;
  }
  const a = amp * weight * crowd;
  const s = MOTION.gaitSquash * weight * crowd;
  let q = 0;
  switch (style) {
    case 'hop': {
      const h = Math.abs(Math.sin(phase));
      out.dy = -h * 2 * a;
      // Flatten on landing, stretch toward the apex; both are 0 at `hopLand`, so the seam doesn't jump.
      q = h < MOTION.hopLand ? s * (1 - h / MOTION.hopLand) : -0.5 * s * ((h - MOTION.hopLand) / (1 - MOTION.hopLand));
      break;
    }
    case 'waddle': {
      const step = Math.abs(Math.cos(phase));
      out.dx = Math.sin(phase) * 1.2 * a;
      out.dy = -step * 0.5 * a;
      q = s * MOTION.waddleSquash * (1 - step);
      break;
    }
    case 'slither': {
      const w = Math.sin(phase) * 1.5 * a;
      out.dx = -heading.ny * w;
      out.dy = heading.nx * w;
      break;
    }
    case 'float':
      out.dy = Math.sin(0.5 * phase) * a;
      out.dx = Math.sin(0.31 * phase + 1.7) * 0.6 * a;
      break;
    case 'skitter':
      // Smooth sums of sines, never `Math.random`: random jitter flickers between interpolated frames.
      out.dx = (Math.sin(1.7 * phase) + Math.sin(2.9 * phase + 1.3)) * 0.35 * a;
      out.dy = (Math.sin(2.3 * phase + 0.6) + Math.sin(3.1 * phase + 2.2)) * 0.35 * a;
      q = Math.sin(4.3 * phase) * MOTION.skitterFlutter * weight * crowd;
      break;
    default: {
      const exhaustive: never = style;
      return exhaustive;
    }
  }
  if (level === 'full' && q !== 0) applySquash(out, q);
}

/**
 * The signed squash `since` seconds after a hit (§5.1): a damped spring
 * that compresses, overshoots into a slight stretch and settles. 0 under
 * reduced motion and once the spring has run out.
 */
export function hitSquish(since: number, level: MotionLevel, crowd: number): number {
  if (level === 'reduced' || since < 0 || since >= MOTION.squishPeriod * 1.5) return 0;
  const amp = (level === 'lite' ? MOTION.squishAmpLite : MOTION.squishAmp) * crowd;
  return amp * Math.exp(-since / MOTION.squishDecay) * Math.cos((since * TAU) / MOTION.squishPeriod);
}

/** The part of a body's track the hit squish reads and writes (§5.1). */
export interface SquishTrack {
  /** The `e.hitTick` last answered with a squish. */
  hitSeen: number;
  /** Clock the current squish began (−∞: none yet). */
  squishAt: number;
}

/**
 * Start a squish when the body was hit since the last one began, but at most
 * once per `squishRearm`: under a beam `hitTick` changes every tick, and a
 * squish restarted every tick would sit at its peak. A hit inside the gap
 * stays pending (`hitSeen` isn't updated), so it plays once the gap ends.
 * Returns whether a squish started.
 */
export function armSquish(t: SquishTrack, hitTick: number, clock: number): boolean {
  if (hitTick < 0 || hitTick === t.hitSeen || clock - t.squishAt < MOTION.squishRearm) return false;
  t.hitSeen = hitTick;
  t.squishAt = clock;
  return true;
}

/**
 * The scale of a body walking in from the dark (§5.2.1), from its `rise`
 * (0..1): 0.82 at the rim, an overshoot of 1.08 at 0.7, settling to 1.
 * Stateless: a body walking back out plays it in reverse.
 */
export function popFromRise(rise: number): number {
  if (rise >= 1) return 1;
  if (rise <= 0) return 0.82;
  if (rise < 0.7) return 0.82 + (1.08 - 0.82) * smoothstep(rise / 0.7);
  return 1.08 + (1 - 1.08) * smoothstep((rise - 0.7) / 0.3);
}

/**
 * The scale of a body that appears inside the light (§5.2.2), `since`
 * seconds after it did: a back-out from 0.5 through 1.12 to 1.
 */
export function popFromTime(since: number): number {
  if (since >= MOTION.popSeconds) return 1;
  if (since <= 0) return 0.5;
  const t = since / MOTION.popSeconds;
  // Up to the overshoot over the first 60%, back to rest over the rest.
  if (t < 0.6) return 0.5 + (1.12 - 0.5) * smoothstep(t / 0.6);
  return 1.12 + (1 - 1.12) * smoothstep((t - 0.6) / 0.4);
}
