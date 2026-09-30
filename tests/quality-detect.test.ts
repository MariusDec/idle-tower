/**
 * The quality auto-detect: `initialQualityTier` is a function of `navigator`
 * and `matchMedia`, both mockable here.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { initialQualityTier, readStoredQuality } from '../src/render/quality';
import { QUALITY } from '../src/render/quality';

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

  it('an 8-core desktop with a fine pointer is high', () => {
    setHardware(8, 2, false);
    expect(initialQualityTier()).toBe('high');
  });

  it('a 6-core desktop with a fine pointer falls to medium', () => {
    setHardware(6, 2, false);
    expect(initialQualityTier()).toBe('medium');
  });

  it('a 2-core phone with a coarse pointer is low', () => {
    setHardware(2, 2, true);
    expect(initialQualityTier()).toBe('low');
  });

  it('a 4-core phone with a coarse pointer is medium (not high)', () => {
    // A coarse pointer needs 16 cores to qualify for high — the dpr rule
    // keeps 3x phone buffers out of the high tier.
    setHardware(4, 2, true);
    expect(initialQualityTier()).toBe('medium');
  });

  it('a coarse pointer at dpr > 2 demotes high one notch to medium', () => {
    // 16 cores + coarse + dpr > 2 picks high on cores alone, then the dpr
    // rule demotes. This is the only branch that uses dpr at all.
    setHardware(16, 3, true);
    expect(initialQualityTier()).toBe('medium');
  });

  it('a coarse pointer at dpr 2 is not demoted (the rule is "dpr > 2")', () => {
    setHardware(16, 2, true);
    expect(initialQualityTier()).toBe('high');
  });

  it('a fine pointer at dpr 3 stays high on cores alone', () => {
    setHardware(8, 3, false);
    expect(initialQualityTier()).toBe('high');
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
