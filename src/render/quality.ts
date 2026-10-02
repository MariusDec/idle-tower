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
 * The tier a device starts on when the preference is `'auto'`. Only a very
 * weak device (under 4 cores) starts at `low`; everything else starts at
 * `high` and the scaler, which watches real frames, settles it from there.
 */
export function initialQualityTier(): QualityTier {
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  return cores >= 4 ? 'high' : 'low';
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

/** Store the player's choice; `'auto'` hands the tier back to the device guess and the scaler. */
export function storeQuality(pref: 'auto' | QualityTier): void {
  try {
    localStorage.setItem(QUALITY_PREF_KEY, pref);
  } catch {
    // Private mode or a full disk: the choice holds for this session only.
  }
}

const TIERS: readonly QualityTier[] = ['low', 'medium', 'high'];

/** The mean frame in ms over a window that demotes a tier: 60 fps with a little slack. */
const FRAME_BUDGET_MS = 17;
/**
 * The mean ms inside `Renderer.render` under which a tier may climb. The next
 * tier up costs roughly twice the fill (1.5× → 2× DPR is 1.8× the pixels,
 * twice the particles), so this leaves that doubled cost inside the budget.
 */
const PROMOTE_DRAW_MS = 6;
/** Frames discarded after a (re)start or a tier change: JIT warm-up, the rebakes. */
const WARMUP_FRAMES = 30;
/** Seconds of frames per verdict. */
const WINDOW_SECONDS = 2;
/** Consecutive windows with headroom before a climb. */
const PROMOTE_WINDOWS = 3;
/** Measured seconds before a tier that failed may be tried again; doubles per failure. */
const RETRY_SECONDS = 30;

/**
 * The dynamic quality scaler (see docs/performance.md). While the preference
 * is `'auto'`, it averages two-second windows of real frames: a window over
 * the frame budget drops one tier; three windows in a row that hold it with
 * draw-time headroom climb one. A tier that was dropped from may not be
 * retried for 30 measured seconds, then 60, 120…, so a device on the edge of
 * a tier settles below it instead of oscillating (each change rebakes sprites).
 */
export class QualityScaler {
  private warmup = WARMUP_FRAMES;
  private frames = 0;
  private time = 0;
  private draw = 0;
  private steady = 0;
  /** Measured seconds so far: the clock the retry backoff runs on. */
  private clock = 0;
  private readonly failures: Record<QualityTier, number> = { low: 0, medium: 0, high: 0 };
  private readonly retryAt: Record<QualityTier, number> = { low: 0, medium: 0, high: 0 };

  /**
   * Feed one frame: its wall seconds and the ms spent drawing it. Returns
   * the tier to move to when a window settles on a change; null otherwise.
   */
  tick(realDt: number, drawMs: number, tier: QualityTier): QualityTier | null {
    if (this.warmup > 0) {
      this.warmup--;
      return null;
    }
    this.frames++;
    this.time += realDt;
    this.draw += drawMs;
    this.clock += realDt;
    if (this.time < WINDOW_SECONDS) return null;
    const frameMean = (this.time * 1000) / this.frames;
    const drawMean = this.draw / this.frames;
    this.frames = 0;
    this.time = 0;
    this.draw = 0;
    const i = TIERS.indexOf(tier);
    if (frameMean > FRAME_BUDGET_MS) {
      this.steady = 0;
      if (i === 0) return null;
      this.failures[tier]++;
      this.retryAt[tier] = this.clock + RETRY_SECONDS * 2 ** (this.failures[tier] - 1);
      this.reset();
      return TIERS[i - 1];
    }
    if (drawMean > PROMOTE_DRAW_MS || i === TIERS.length - 1) {
      this.steady = 0;
      return null;
    }
    const up = TIERS[i + 1];
    if (++this.steady < PROMOTE_WINDOWS || this.clock < this.retryAt[up]) return null;
    this.reset();
    return up;
  }

  /**
   * Drop the window under way and warm up again: after a tier change, or
   * when the frames stop being real (hidden, paused, another tier chosen).
   * The retry backoff is kept: what failed on this device stays failed.
   */
  reset(): void {
    this.warmup = WARMUP_FRAMES;
    this.frames = 0;
    this.time = 0;
    this.draw = 0;
    this.steady = 0;
  }
}
