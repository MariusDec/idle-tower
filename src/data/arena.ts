/**
 * The arena: how big the world is, and how big the things in it are.
 *
 * Before this module the canvas *was* the world — `index.html` hard-coded a
 * 1280x720 backing store, `Game` seated the tower at its centre, and both
 * managers took those same two numbers as their bounds. The tower's base
 * `range` of 300 therefore covered 83% of the vertical half-extent on the
 * very first wave, so every enemy was in range from the frame it spawned and
 * `range` as a stat had no visible meaning (UI plan §0.2).
 *
 * The fix is a zoom-out, and it is cheap for one specific reason: enemies in
 * this game do not *pass through* the tower's range. `EnemyManager.tick` walks
 * them to their contact radius and parks them there until they die. So "time
 * in range" is not a window a bigger arena would shrink — the only thing a
 * bigger arena costs is walk-in dead time before the first shot. Which gives:
 *
 * > Multiply every world-space **distance and speed** by the same factor and
 * > every timing in the game is unchanged. Leave **range** out of that
 * > multiplication, and the range ring shrinks relative to the arena by
 * > exactly that factor.
 *
 * Hence two scales, applied at *data-definition time* so the ~40 call sites
 * downstream never learn either number exists:
 *
 * | Scale | Applies to | Why |
 * |---|---|---|
 * | `WORLD_SCALE` | positions, speeds, bounds, spawn ring, AoE/splash radii, knockback | keeps every timing identical |
 * | `ENTITY_SCALE` | body radii, sprite padding, drawn orb size | the actual zoom-out you see |
 * | *neither* | `range` | the whole point — the ring shrinks against the arena |
 *
 * `ENTITY_SCALE < WORLD_SCALE` is deliberate: it is what makes this read as a
 * zoom-out rather than a resolution change. The cost is that an enemy is a
 * ~35% smaller *target* in world terms, which is paid back by
 * `PROJECTILE_HIT_PAD` below.
 *
 * See `docs/camera-system.md`.
 */

/** Positions, speeds, bounds, AoE radii — everything that must keep its timing. */
export const WORLD_SCALE = 2.6;

/** Body radii and drawn sizes. Smaller than `WORLD_SCALE`; that gap *is* the zoom-out. */
export const ENTITY_SCALE = 1.7;

/** Scale a world-space distance, speed or radius. */
export function world(value: number): number {
  return value * WORLD_SCALE;
}

/** Scale a drawn body radius, sprite padding or particle size. */
export function entity(value: number): number {
  return value * ENTITY_SCALE;
}

/**
 * The half-extent the old 16:9 canvas had along its short axis, in old units.
 * Every arena dimension is derived from this so the relationship to the
 * pre-camera game stays legible.
 */
const LEGACY_HALF_EXTENT = 360;

export const ARENA = {
  /**
   * World units guaranteed visible from the tower along the **short** viewport
   * axis. `360 x 2.6` — i.e. exactly the old canvas, zoomed out by
   * `WORLD_SCALE`. At 16:9 the world is 3328 x 1872, which is the old
   * 1280 x 720 times 2.6 on both axes.
   */
  minHalfExtent: world(LEGACY_HALF_EXTENT),
  /**
   * Viewport aspect (width / height) is clamped into this band before the
   * long-axis half-extent is derived from it, so an ultrawide monitor is not
   * handed a telescope and a very tall phone does not get a sliver of a field.
   * Every realistic viewport — 16:9, 16:10, 4:3, 3:2, phone portrait inside
   * the HUD chrome — sits inside the band, where the clamp is a no-op.
   */
  aspectClamp: [0.62, 2.20] as const,
  /**
   * Spawn ellipse, as a multiple of the matching half-extent.
   *
   * Just over 1: enemies materialise a touch off-screen on the short axis and
   * *just* on-screen on the long one. That is intentional — the spawn-lane
   * arrows already tell the player where a wave is coming from, and Part 3's
   * rift animation wants a well-defined place to open.
   */
  spawnRingScale: 1.04,
  /** Hard ceiling on resolved `range`, as a fraction of `minHalfExtent`. */
  maxRangeFraction: 0.70,
  /**
   * Ceiling on `devicePixelRatio`.
   *
   * A 3x phone buffer is a 2.25x fill-rate tax over a 2x one for a difference
   * nobody can see at arm's length, and this game's frame budget is spent on
   * 200+ enemies rather than on pixels.
   */
  maxDevicePixelRatio: 2,
} as const;

/**
 * The hard ceiling a resolved `range` is clamped to (`STAT_CLAMPS.range.max`).
 *
 * 655 world units — 70% of the short half-extent. A range-stacked build (the
 * 480 flat max, +30% from talents, one `Reach` blessing) reaches it, and the
 * stats breakdown surfaces an `Arena cap` row when it does, so it is never a
 * silent dead stat.
 */
export const ARENA_RANGE_CAP = ARENA.minHalfExtent * ARENA.maxRangeFraction;

/**
 * Additive pad on the projectile-vs-enemy collision radius, in world units.
 *
 * `ENTITY_SCALE < WORLD_SCALE` means an enemy occupies `1.7 / 2.6` = 0.65 of
 * the world it used to, while projectile speed and enemy speed both scaled by
 * the full `WORLD_SCALE` — so the lead error on a moving target grew faster
 * than the target did, and hit rate would regress for exactly the enemies that
 * are hardest to hit already.
 *
 * The old test was `radius + 6`. Restoring the old *fraction of the world*
 * needs `radius x (WORLD_SCALE - ENTITY_SCALE) + 6 x WORLD_SCALE`; taking the
 * spawn-weighted mean radius (13.0 in pre-scale units) for the first term
 * makes that a constant, which is what keeps this a pad rather than a second
 * scale factor nobody can reason about.
 */
export const PROJECTILE_HIT_PAD = Math.round(
  world(6) + (WORLD_SCALE - ENTITY_SCALE) * 13,
);

export interface ArenaExtents {
  /** Half-width of the world rectangle, in world units. */
  halfWidth: number;
  /** Half-height of the world rectangle, in world units. */
  halfHeight: number;
}

/**
 * The world rectangle a viewport of this shape gets.
 *
 * Only the *shape* matters — pass CSS pixels, device pixels or arbitrary
 * units, the result is the same. The short axis always gets exactly
 * `ARENA.minHalfExtent`; the long axis is that times the clamped aspect.
 */
export function arenaExtents(viewWidth: number, viewHeight: number): ArenaExtents {
  const w = viewWidth > 0 ? viewWidth : 1;
  const h = viewHeight > 0 ? viewHeight : 1;
  const [minAspect, maxAspect] = ARENA.aspectClamp;
  const aspect = Math.min(maxAspect, Math.max(minAspect, w / h));
  return aspect >= 1
    ? { halfWidth: ARENA.minHalfExtent * aspect, halfHeight: ARENA.minHalfExtent }
    : { halfWidth: ARENA.minHalfExtent, halfHeight: ARENA.minHalfExtent / aspect };
}

/**
 * A point on the spawn ellipse, at angle `t` radians.
 *
 * Pulled out of `WaveManager` and made pure so the shape is testable without a
 * bus, an enemy manager or a roll of the dice. The rectangle it replaces made
 * a corner spawn take ~1.4x as long to walk in as an edge spawn, which is a
 * meaningful difference in wave length that no player could see the cause of.
 */
export function spawnPointOnEllipse(
  centerX: number,
  centerY: number,
  halfWidth: number,
  halfHeight: number,
  angle: number,
): { x: number; y: number } {
  return {
    x: centerX + Math.cos(angle) * halfWidth * ARENA.spawnRingScale,
    y: centerY + Math.sin(angle) * halfHeight * ARENA.spawnRingScale,
  };
}
