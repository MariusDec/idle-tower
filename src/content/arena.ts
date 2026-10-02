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
 * Units are world units, tower at the origin. Body radii in `enemies.ts`
 * were chosen to read at ~0.35 CSS px per unit on a phone.
 */

/** How the light stretches on each axis: 1 on the short axis, the stage's aspect on the long one. */
export interface Oval {
  readonly sx: number;
  readonly sy: number;
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
export const PHONE_OVAL: Oval = { sx: 1, sy: 1.92 };

/** An oval with a long/short ratio of `aspect`, tall or wide. Clamped to [1, `maxAspect`]. */
export function ovalOf(aspect: number, tall: boolean): Oval {
  const a = Math.min(ARENA.maxAspect, Math.max(1, Number.isFinite(aspect) ? aspect : 1));
  return tall ? { sx: 1, sy: a } : { sx: a, sy: 1 };
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
 * True when a body of radius `r` at (x, y) shows: it touches the light or
 * the soft edge of the dark past it, anywhere short of fully dark. What the
 * tower may hit. (The dark is drawn in the oval's stretched units, so its
 * opaque edge is this same oval scaled by `darkScale`.)
 */
export function inLight(x: number, y: number, r: number, light: number, oval: Oval): boolean {
  const rim = rimAxes(light, oval);
  const ax = rim.x * ARENA.darkScale + r;
  const ay = rim.y * ARENA.darkScale + r;
  return (x / ax) ** 2 + (y / ay) ** 2 <= 1;
}

/** Where bodies spawn at angle `a` radians (0 = right, π/2 = down): `spawnScale` times the rim. */
export function spawnPoint(angle: number, light: number, oval: Oval): { x: number; y: number } {
  const rim = rimAxes(light, oval);
  return {
    x: Math.cos(angle) * rim.x * ARENA.spawnScale,
    y: Math.sin(angle) * rim.y * ARENA.spawnScale,
  };
}
