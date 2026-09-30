/**
 * The quality knob. Presentation only: nothing here may reach a value the
 * sim reads. Ported from the legacy `data/quality.ts` plus the auto-detect
 * that used to live in `Game.ts`.
 */
export type QualityTier = 'high' | 'medium' | 'low';

export interface QualityProfile {
  /** Multiplier on every emitter's particle count. */
  particleScale: number;
  /** Ceiling on the live particle pool. */
  maxParticles: number;
  /** Whether the additive glow pass runs as `lighter`. */
  additive: boolean;
  /** Cap handed to the camera's `min(devicePixelRatio, cap)`. */
  dprCap: number;
  /** Cached drop shadows under entities. */
  shadows: boolean;
}

export const QUALITY: Record<QualityTier, QualityProfile> = {
  high:   { particleScale: 1.00, maxParticles: 600, additive: true,  dprCap: 2.0, shadows: true  },
  medium: { particleScale: 0.50, maxParticles: 360, additive: true,  dprCap: 1.5, shadows: true  },
  low:    { particleScale: 0.25, maxParticles: 200, additive: false, dprCap: 1.0, shadows: false },
};

export const DEFAULT_QUALITY: QualityTier = 'high';

/** Same key as the legacy game, so a player's explicit choice carries over. */
export const QUALITY_PREF_KEY = 'the-tower-quality';

export function isQualityTier(value: unknown): value is QualityTier {
  return value === 'high' || value === 'medium' || value === 'low';
}

/**
 * The tier a device starts on when the preference is `'auto'`. Core count
 * decides the band; a touch device needs twice the cores for `high`, and a
 * >2× phone buffer is demoted to `medium` because its fill-rate cost is real.
 */
export function initialQualityTier(): QualityTier {
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const highThreshold = coarse ? 16 : 8;
  let t: QualityTier = cores >= highThreshold ? 'high' : cores >= 4 ? 'medium' : 'low';
  if (coarse && dpr > 2 && t === 'high') t = 'medium';
  return t;
}

/** The stored preference. Anything unrecognised reads as `'auto'`. */
export function readStoredQuality(): 'auto' | QualityTier {
  try {
    if (typeof localStorage === 'undefined') return 'auto';
    const raw = localStorage.getItem(QUALITY_PREF_KEY);
    return raw === 'auto' || isQualityTier(raw) ? raw : 'auto';
  } catch {
    return 'auto';
  }
}

export function resolveQuality(): QualityTier {
  const pref = readStoredQuality();
  return pref === 'auto' ? initialQualityTier() : pref;
}
