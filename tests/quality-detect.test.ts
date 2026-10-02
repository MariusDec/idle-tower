/**
 * The quality auto-detect: `initialQualityTier` is a function of `navigator`
 * and `matchMedia`, both mockable here.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { initialQualityTier, readStoredQuality } from '../src/render/quality';
import { QUALITY, QualityScaler, type QualityTier } from '../src/render/quality';

describe('initialQualityTier', () => {
  const originalNavigator = globalThis.navigator;
  const originalMatchMedia = globalThis.matchMedia;
  const originalWindow = (globalThis as unknown as { window?: unknown }).window;
  const originalLocalStorage = globalThis.localStorage;

  const setHardware = (cores: number, dpr: number, coarse: boolean): void => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { hardwareConcurrency: cores },
      configurable: true,
      writable: true,
    });
    (globalThis as unknown as { window: { devicePixelRatio: number } }).window = { devicePixelRatio: dpr };
    globalThis.matchMedia = ((q: string) =>
      ({ matches: coarse && q.includes('coarse') } as MediaQueryList)) as typeof matchMedia;
  };

  beforeEach(() => {
    // Defaults: a desktop-class 8-core, dpr 2, fine pointer.
    setHardware(8, 2, false);
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
    globalThis.matchMedia = originalMatchMedia;
    if (originalWindow === undefined) {
      delete (globalThis as unknown as { window?: unknown }).window;
    } else {
      (globalThis as unknown as { window: unknown }).window = originalWindow;
    }
    (globalThis as unknown as { localStorage?: Storage }).localStorage = originalLocalStorage;
  });

  it('an 8-core desktop is high', () => {
    setHardware(8, 2, false);
    expect(initialQualityTier()).toBe('high');
  });

  it('an 8-core phone at dpr > 2 is high: the scaler, not the guess, demotes it', () => {
    setHardware(8, 3, true);
    expect(initialQualityTier()).toBe('high');
  });

  it('a 4-core device is high', () => {
    setHardware(4, 2, true);
    expect(initialQualityTier()).toBe('high');
  });

  it('a 2-core device is low', () => {
    setHardware(2, 2, true);
    expect(initialQualityTier()).toBe('low');
  });
});

describe('readStoredQuality', () => {
  const originalLocalStorage = globalThis.localStorage;
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => { store[k] = v; },
      removeItem: (k) => { delete store[k]; },
      clear: () => { store = {}; },
      key: () => null,
      get length() { return Object.keys(store).length; },
    } as Storage;
  });

  afterEach(() => {
    (globalThis as unknown as { localStorage?: Storage }).localStorage = originalLocalStorage;
  });

  it('returns "auto" when nothing is stored', () => {
    expect(readStoredQuality()).toBe('auto');
  });

  it('returns the stored tier verbatim', () => {
    store['the-tower-quality'] = 'low';
    expect(readStoredQuality()).toBe('low');
    store['the-tower-quality'] = 'high';
    expect(readStoredQuality()).toBe('high');
  });

  it('returns "auto" for any unrecognised value', () => {
    store['the-tower-quality'] = 'ultra';
    expect(readStoredQuality()).toBe('auto');
  });
});

describe('the high-tier cap matches the historic camera cap', () => {
  // The historic ARENA.maxDevicePixelRatio is the value the game shipped with
  // before §9.D. If the quality table ever drifts from it, every player
  // whose preference is stored as `high` will see a different frame cost
  // than they used to — a silent regression no other test catches.
  it('QUALITY.high.dprCap equals ARENA.maxDevicePixelRatio', async () => {
    const { ARENA } = await import('../src/content/arena');
    expect(QUALITY.high.dprCap).toBe(ARENA.maxDevicePixelRatio);
  });
});

describe('the quality scaler', () => {
  /** Feed `seconds` of frames; returns the first change, or null. */
  const run = (scaler: QualityScaler, frameMs: number, drawMs: number, tier: QualityTier, seconds = 4): QualityTier | null => {
    const frames = 30 + Math.ceil((seconds * 1000) / frameMs);
    for (let i = 0; i < frames; i++) {
      const out = scaler.tick(frameMs / 1000, drawMs, tier);
      if (out) return out;
    }
    return null;
  };

  it('holds a tier that keeps 60 fps without headroom', () => {
    expect(run(new QualityScaler(), 16.7, 10, 'high', 20)).toBeNull();
    expect(run(new QualityScaler(), 16.7, 10, 'medium', 20)).toBeNull();
  });

  it('drops one tier when a window is over budget', () => {
    const s = new QualityScaler();
    expect(run(s, 25, 12, 'high')).toBe('medium');
    expect(run(s, 25, 12, 'medium')).toBe('low');
    expect(run(s, 40, 12, 'low', 20)).toBeNull();
  });

  it('climbs after three steady windows with draw-time headroom', () => {
    const s = new QualityScaler();
    expect(run(s, 16.7, 3, 'low', 5)).toBeNull();
    expect(run(new QualityScaler(), 16.7, 3, 'low', 7)).toBe('medium');
    expect(run(new QualityScaler(), 8.3, 3, 'medium', 7)).toBe('high');
  });

  it('backs off before retrying a tier it dropped from, longer each time', () => {
    const s = new QualityScaler();
    expect(run(s, 25, 12, 'high')).toBe('medium');
    // Headroom at medium, but high failed: 30 measured seconds first.
    expect(run(s, 16.7, 3, 'medium', 20)).toBeNull();
    expect(run(s, 16.7, 3, 'medium', 20)).toBe('high');
    expect(run(s, 25, 12, 'high')).toBe('medium');
    // The second failure doubles the wait to 60 s.
    expect(run(s, 16.7, 3, 'medium', 40)).toBeNull();
    expect(run(s, 16.7, 3, 'medium', 30)).toBe('high');
  });

  it('ignores the warm-up frames, and drops the window on reset', () => {
    const s = new QualityScaler();
    for (let i = 0; i < 30; i++) expect(s.tick(1, 50, 'high')).toBeNull();
    for (let i = 0; i < 100; i++) s.tick(0.025, 12, 'high');
    s.reset();
    // The slow window was dropped; fast frames after the warm-up hold.
    expect(run(s, 16.7, 10, 'high')).toBeNull();
  });
});
