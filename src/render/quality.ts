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

/** Store the player's choice; `'auto'` hands the tier back to the device guess and the probe. */
export function storeQuality(pref: 'auto' | QualityTier): void {
  try {
    localStorage.setItem(QUALITY_PREF_KEY, pref);
  } catch {
    // Private mode or a full disk: the choice holds for this session only.
  }
}

/** The probe's budgets: the mean frame in ms that demotes a tier (a 45 fps floor at `low`). */
const PROBE_BUDGET_MS = 17;
const PROBE_BUDGET_LOW_MS = 22;
/** Frames discarded first (JIT warm-up, the first bakes), then seconds measured. */
const PROBE_WARMUP_FRAMES = 30;
const PROBE_SECONDS = 2;

/**
 * The quality probe, ported from the legacy game (see docs/performance.md):
 * once a session, on the first run at 1× with the preference on `'auto'`,
 * it measures two seconds of real frames and may demote the tier by one.
 * It never promotes: climbing back is the settings' job.
 */
export class QualityProbe {
  private frames = 0;
  private time = 0;
  private done = false;

  /**
   * Feed one frame's wall seconds. Returns the tier to drop to when the
   * mean frame was over budget, once; null otherwise.
   */
  tick(realDt: number, tier: QualityTier): QualityTier | null {
    if (this.done) return null;
    this.frames++;
    if (this.frames <= PROBE_WARMUP_FRAMES) return null;
    this.time += realDt;
    if (this.time < PROBE_SECONDS) return null;
    this.done = true;
    const mean = (this.time * 1000) / (this.frames - PROBE_WARMUP_FRAMES);
    const budget = tier === 'low' ? PROBE_BUDGET_LOW_MS : PROBE_BUDGET_MS;
    if (mean <= budget || tier === 'low') return null;
    return tier === 'high' ? 'medium' : 'low';
  }

  /** Give up for the session: what it would measure is not a real frame (hidden, fast-forwarded). */
  abandon(): void {
    this.done = true;
  }

  get finished(): boolean {
    return this.done;
  }

  /** Started on real frames and not yet done. */
  get measuring(): boolean {
    return this.frames > 0 && !this.done;
  }
}
