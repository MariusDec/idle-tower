/**
 * The arena: the oval of light the tower holds, and the dark beyond it
 * (plans/camera-and-fog.md).
 *
 * The light has a size and a shape. Its size, `L`, is game logic: it grows
 * with the tower's range so that what the tower can hit is always lit (§2
 * of the note). Its shape is an oval fitted to the stage the run started
 * on, taken once at run start and kept in the run (`RunState.arena`), so a
 * run stays deterministic whatever the window does afterwards; headless
 * tools use a phone's (`PHONE_OVAL`). `L` is the oval's short half-axis;
 * the long one is longer by what the stage's aspect adds at `L_base`
 * (`rimAxes`), so the extra walk on the long axis stays the same as the
 * light grows. Enemies spawn just past the rim, in the soft edge of the
 * dark, and walk in.
 *
 * On a large stage the oval squares off into a superellipse
 * (plans/large-screens.md §5): `|x/a|ⁿ + |y/b|ⁿ = 1`, `n` its squareness.
 * `n = 2` is the ellipse every phone plays, and that path is today's
 * arithmetic exactly, so phone runs and replays don't move by a bit.
 *
 * Units are world units, tower at the origin. Body radii in `enemies.ts`
 * were chosen to read at ~0.35 CSS px per unit on a phone.
 */

/** A superellipse's exponent: 2 is an ellipse, 4 a squircle. Whole numbers keep `inLight` free of `pow`. */
export type Squareness = 2 | 3 | 4;

/** How the light stretches on each axis: 1 on the short axis, the stage's aspect on the long one. */
export interface Oval {
  readonly sx: number;
  readonly sy: number;
  /** Squareness: 2 is an ellipse (every phone), up to 4 on a large stage (plans/large-screens.md §5.1). */
  readonly n: Squareness;
}

export const ARENA = {
  /** The light's least short half-axis, `L_base`. */
  lightBase: 500,
  /** The light always reaches this far past range: `L ≥ range + margin`. */
  lightMargin: 70,
  /**
   * The soft edge of the dark past the rim, as a multiple of the rim: fully
   * dark from here out. A body walks out of it.
   */
  darkScale: 1.07,
  /**
   * Where enemies appear, as a multiple of the rim: just under it, in the
   * soft edge of the dark, where they show faintly and can already be hit.
   * The old arena's 1.05: nearer costs the active bot's farm rate (I5).
   */
  spawnScale: 1.05,
  /** The longest the oval stretches: a phone's tall stage, a wide monitor. */
  maxAspect: 2.4,
  /** Ceiling on `devicePixelRatio`; the quality tier can lower it further. */
  maxDevicePixelRatio: 2,
} as const;

/** A phone's portrait stage under the HUD: the shape the game was tuned on (the old 500 × 960 arena). */
export const PHONE_OVAL: Oval = { sx: 1, sy: 1.92, n: 2 };

/** An oval with a long/short ratio of `aspect`, tall or wide, of squareness `n`. Clamped to [1, `maxAspect`]. */
export function ovalOf(aspect: number, tall: boolean, n: Squareness = 2): Oval {
  const a = Math.min(ARENA.maxAspect, Math.max(1, Number.isFinite(aspect) ? aspect : 1));
  return tall ? { sx: 1, sy: a, n } : { sx: a, sy: 1, n };
}

/** The ends of a tall light's short axis: level with the tower, left and right. */
const TALL_ENDS: readonly number[] = [0, Math.PI];
/** The ends of a wide light's short axis: above and below the tower. */
const WIDE_ENDS: readonly number[] = [Math.PI / 2, -Math.PI / 2];

/**
 * The angles at the ends of the light's short axis, where the rim is
 * nearest the tower: where the run's opening and each boss come from, so
 * they arrive as soon on a landscape stage as on a phone
 * (plans/large-screens.md §5.5). A tall light's, and a phone's, are 0 and π.
 */
export function shortEnds(oval: Oval): readonly number[] {
  return shortEndsOf(oval.sx > oval.sy);
}

/** `shortEnds` for a light known only to be wide or tall. */
export function shortEndsOf(wide: boolean): readonly number[] {
  return wide ? WIDE_ENDS : TALL_ENDS;
}

/**
 * The light's short half-axis for a tower range: never less than `L_base`,
 * always past range by the margin. `dim` is the Fog-caller's (N3): it
 * closes the light in.
 */
export function lightRadius(range: number, dim = 1): number {
  return Math.max(ARENA.lightBase * dim, range + ARENA.lightMargin);
}

/**
 * The rim's half-axes for a light `light`: the short one is `L`; the long
 * one adds a constant, the aspect's stretch at `L_base` (500 × 960 on a
 * phone). Growing the long axis by the aspect instead would lengthen the
 * long walk by ~2× every gain in range.
 */
export function rimAxes(light: number, oval: Oval): { x: number; y: number } {
  return {
    x: light + ARENA.lightBase * (oval.sx - 1),
    y: light + ARENA.lightBase * (oval.sy - 1),
  };
}

/**
 * How far a body's radius grows the shape's axes in `inLight`, per unit of
 * radius. Axes + r is not an offset curve: an ellipse is off on the safe
 * side (it grows a little less than r along its flanks), but a squircle's
 * corner would move out by 2^(1/2 − 1/n)·r and accept a body past the dark.
 * Growing by 2^(1/n − 1/2)·r instead is exact on the diagonal and safe on
 * the axes (plans/large-screens.md §5.3).
 */
const GROW: Readonly<Record<Squareness, number>> = { 2: 1, 3: 2 ** (1 / 3 - 1 / 2), 4: 2 ** (1 / 4 - 1 / 2) };

/** |t|ⁿ for a whole n in 2..4, by multiplication. */
function powN(t: number, n: Squareness): number {
  const a = Math.abs(t);
  return n === 2 ? a * a : n === 3 ? a * a * a : (a * a) * (a * a);
}

/**
 * True when a body of radius `r` at (x, y) shows: it touches the light or
 * the soft edge of the dark past it, anywhere short of fully dark. What the
 * tower may hit. (The dark is drawn in the oval's stretched units, so its
 * opaque edge is this same shape scaled by `darkScale`.)
 */
export function inLight(x: number, y: number, r: number, light: number, oval: Oval): boolean {
  const n = oval.n;
  // `rimAxes` written out: every targeting loop asks this, many times a step.
  if (n === 2) {
    // A phone's ellipse: kept to the letter, so phone runs replay bit for bit.
    const ax = (light + ARENA.lightBase * (oval.sx - 1)) * ARENA.darkScale + r;
    const ay = (light + ARENA.lightBase * (oval.sy - 1)) * ARENA.darkScale + r;
    return (x / ax) ** 2 + (y / ay) ** 2 <= 1;
  }
  const g = r * GROW[n];
  const ax = (light + ARENA.lightBase * (oval.sx - 1)) * ARENA.darkScale + g;
  const ay = (light + ARENA.lightBase * (oval.sy - 1)) * ARENA.darkScale + g;
  return powN(x / ax, n) + powN(y / ay, n) <= 1;
}

/**
 * The point on the rim at angle `t` (0 = right, π/2 = down), scaled by `k`.
 * Everything placed on the rim comes through here, so spawns, gates and the
 * drawn rim agree. The angle is the shape's own parameter, as on the ellipse
 * (`cos t · a, sin t · b`); for n > 2 it is the same family,
 * `a · sgn(cos t)·|cos t|^(2/n)`, which is the ellipse's at n = 2 and lands
 * on the axes' ends at 0, ±π/2 and π for every n.
 */
export function rimPoint(t: number, light: number, oval: Oval, k = 1): { x: number; y: number } {
  const rim = rimAxes(light, oval);
  const c = Math.cos(t);
  const s = Math.sin(t);
  if (oval.n === 2) return { x: c * rim.x * k, y: s * rim.y * k };
  const e = 2 / oval.n;
  return {
    x: Math.sign(c) * Math.abs(c) ** e * rim.x * k,
    y: Math.sign(s) * Math.abs(s) ** e * rim.y * k,
  };
}

/**
 * How far out (x, y) is, in rims: 1 on the rim, the shape's own "radius"
 * `(|x/ax|ⁿ + |y/ay|ⁿ)^(1/n)` for half-axes (ax, ay). For drawing, not the sim.
 */
export function rimRadius(x: number, y: number, ax: number, ay: number, n: Squareness): number {
  if (n === 2) return Math.hypot(x / ax, y / ay);
  return (powN(x / ax, n) + powN(y / ay, n)) ** (1 / n);
}

/** Where bodies spawn at angle `a` radians (0 = right, π/2 = down): `spawnScale` times the rim. */
export function spawnPoint(angle: number, light: number, oval: Oval): { x: number; y: number } {
  return rimPoint(angle, light, oval, ARENA.spawnScale);
}

/**
 * The rim's mean distance from the tower over a uniform spawn angle, at
 * `light`: roughly a spawned body's walk before range. 256 samples.
 */
export function meanRim(light: number, oval: Oval): number {
  const N = 256;
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const p = rimPoint(((i + 0.5) / N) * Math.PI * 2, light, oval);
    sum += Math.hypot(p.x, p.y);
  }
  return sum / N;
}
