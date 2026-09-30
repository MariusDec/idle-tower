/**
 * The quality knob (UI plan §5.F).
 *
 * Part 5 owns the table and the wiring; Part 9 owns the Settings control and
 * the auto-detect, and only has to call `setQuality` on the three consumers.
 * The default is `high`, so nothing changes until someone turns the knob.
 *
 * Everything here is **presentation only**. Nothing in this table may reach a
 * value the simulation reads — in particular the damaging shockwave rings in
 * `EffectsManager` are never scaled, because they are gameplay objects wearing
 * a visual's clothes.
 */
export type QualityTier = 'high' | 'medium' | 'low';

export interface QualityProfile {
  /** Multiplier on every emitter's particle count. */
  particleScale: number;
  /** Ceiling on the live particle pool. */
  maxParticles: number;
  /** Whether the §5.A additive pass runs as `lighter`. */
  additive: boolean;
  /** Ground-impact decals (Part 4.3) kept alive. */
  decals: number;
  /** §5.C combo embers kept alive. */
  embers: number;
  /** Cap handed to the camera's `min(devicePixelRatio, cap)`. */
  dprCap: number;
  /** Background layers baked: 3 = far field + terrain + lattice, 2 drops the terrain noise. */
  bgLayers: 2 | 3;
  /** Cached drop shadows under entities. */
  shadows: boolean;
}

export const QUALITY: Record<QualityTier, QualityProfile> = {
  high:   { particleScale: 1.00, maxParticles: 600, additive: true,  decals: 48, embers: 48, dprCap: 2.0, bgLayers: 3, shadows: true  },
  medium: { particleScale: 0.50, maxParticles: 360, additive: true,  decals: 24, embers: 24, dprCap: 1.5, bgLayers: 3, shadows: true  },
  low:    { particleScale: 0.25, maxParticles: 200, additive: false, decals: 0,  embers: 0,  dprCap: 1.0, bgLayers: 2, shadows: false },
};

/** The tier everything starts on until Part 9's setting says otherwise. */
export const DEFAULT_QUALITY: QualityTier = 'high';

export function isQualityTier(value: unknown): value is QualityTier {
  return value === 'high' || value === 'medium' || value === 'low';
}
