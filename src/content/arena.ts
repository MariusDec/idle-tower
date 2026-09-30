/**
 * The arena: a fixed world the sim runs in, whatever the screen looks like.
 *
 * The legacy game sized its world from the viewport, which made the sim depend
 * on the window. The rebuild's sim is deterministic (§12.3), so the world is a
 * constant: a portrait ellipse with the tower at the origin (§4.1, D4). The
 * camera fits this rectangle into whatever box it is given; surplus shows as
 * extra floor, never as extra arena.
 *
 * Units are world units. At 375 CSS px wide the arena spans ~0.35 CSS px per
 * unit, which is where the body radii and strokes below were chosen to read.
 */
export const ARENA = {
  /** Half-width of the playable ellipse. The short axis on a phone. */
  halfWidth: 520,
  /** Half-height of the playable ellipse. */
  halfHeight: 800,
  /**
   * Spawn ellipse, as a multiple of the playable half-extents. Just over 1:
   * enemies appear at the rim and walk in.
   */
  spawnRingScale: 1.05,
  /**
   * Margin the camera keeps around the playable ellipse so a body at the
   * spawn ring is visible rather than clipped by the screen edge.
   */
  viewMargin: 1.08,
  /** Ceiling on `devicePixelRatio`; the quality tier can lower it further. */
  maxDevicePixelRatio: 2,
} as const;

/** Half-extents of the world rectangle the camera fits to the screen. */
export const VIEW_HALF_WIDTH = ARENA.halfWidth * ARENA.viewMargin;
export const VIEW_HALF_HEIGHT = ARENA.halfHeight * ARENA.viewMargin;

/** A point on the spawn ellipse at angle `a` radians (0 = right, π/2 = down). */
export function spawnPoint(angle: number): { x: number; y: number } {
  return {
    x: Math.cos(angle) * ARENA.halfWidth * ARENA.spawnRingScale,
    y: Math.sin(angle) * ARENA.halfHeight * ARENA.spawnRingScale,
  };
}
