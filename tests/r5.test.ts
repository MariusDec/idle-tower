import { afterEach, describe, expect, it, vi } from 'vitest';
import { capGate, Loop, SIM_DT } from '../src/app/loop';
import { FRAME_BUDGET_MS, frameBudget, QualityScaler } from '../src/render/quality';
import { ScreenAwake, type WakeLockApi } from '../src/platform/awake';
import { newProfile, PROFILE_VERSION } from '../src/meta/profile';
import { MIGRATIONS, migrate } from '../src/meta/save/migrate';

/** Drawn frames per second when a display of `hz` runs under a cap of `fps`, over 10 s. */
function drawnPerSecond(hz: number, fps: number, jitterMs = 0): number {
  const interval = 1000 / fps;
  let last = 0;
  let drawn = 0;
  for (let i = 1; i <= hz * 10; i++) {
    const now = (i * 1000) / hz + (i % 2 === 0 ? jitterMs : -jitterMs);
    const stamp = capGate(now, last, interval);
    if (stamp !== null) {
      last = stamp;
      drawn++;
    }
  }
  return drawn / 10;
}

describe('R5 §2: the frame cap', () => {
  it('holds the cap on displays faster than it, multiple or not', () => {
    expect(drawnPerSecond(120, 60)).toBeCloseTo(60, 0);
    expect(drawnPerSecond(90, 60)).toBeCloseTo(60, 0);
    expect(drawnPerSecond(144, 60)).toBeCloseTo(60, 0);
    expect(drawnPerSecond(60, 30)).toBeCloseTo(30, 0);
    expect(drawnPerSecond(120, 30)).toBeCloseTo(30, 0);
  });

  it('never drops a frame of a display at the cap, jitter and all', () => {
    expect(drawnPerSecond(60, 60, 0.8)).toBe(60);
    expect(drawnPerSecond(30, 60)).toBe(30);
  });

  it('a 120 Hz frame a hair early does not rewind the rhythm', () => {
    expect(drawnPerSecond(120, 60, 0.05)).toBeCloseTo(60, 0);
  });

  describe('the loop under a cap', () => {
    let queued: ((t: number) => void) | null = null;
    afterEach(() => vi.unstubAllGlobals());

    it('pays the same sim steps capped or not: only drawing is skipped', () => {
      const run = (cap: number | null): { steps: number; draws: number } => {
        vi.stubGlobal('requestAnimationFrame', (fn: (t: number) => void) => { queued = fn; return 1; });
        vi.stubGlobal('cancelAnimationFrame', () => undefined);
        vi.spyOn(performance, 'now').mockReturnValue(0);
        let steps = 0;
        let draws = 0;
        const loop = new Loop({ step: () => steps++, render: () => draws++, speed: () => 1 });
        loop.setFrameCap(cap);
        loop.start();
        for (let i = 1; i <= 120 * 5; i++) queued?.((i * 1000) / 120);
        loop.stop();
        vi.restoreAllMocks();
        return { steps, draws };
      };
      const free = run(null);
      const capped = run(30);
      expect(free.draws).toBe(600);
      expect(capped.draws).toBeCloseTo(150, -1);
      // 5 s at 60 steps a second, whatever is drawn.
      expect(Math.abs(capped.steps - free.steps)).toBeLessThanOrEqual(2);
      expect(free.steps).toBeCloseTo(5 / SIM_DT, -1);
    });
  });
});

describe('R5 §2: the quality scaler under a cap', () => {
  /** Feed `seconds` of frames at `ms` each, cheap to draw; the tier it settles on. */
  const feed = (ms: number, budget: number, seconds = 6): string => {
    const s = new QualityScaler();
    let tier: 'high' | 'medium' | 'low' = 'high';
    for (let t = 0; t < seconds * 1000; t += ms) tier = s.tick(ms / 1000, 2, tier, budget) ?? tier;
    return tier;
  };

  it('a 30 fps cap is not read as a slow device', () => {
    expect(feed(1000 / 30, frameBudget(1000 / 30))).toBe('high');
    // The old budget would have dropped it.
    expect(feed(1000 / 30, FRAME_BUDGET_MS)).not.toBe('high');
  });

  it('a 60 fps cap or none keeps the usual budget', () => {
    expect(frameBudget(0)).toBe(FRAME_BUDGET_MS);
    expect(frameBudget(1000 / 60)).toBe(FRAME_BUDGET_MS);
  });
});

/** A fake wake lock: counts requests, grants or refuses, and can drop a lock as a hidden page would. */
function fakeLock(grant = true) {
  const live: { released: boolean; fire: () => void }[] = [];
  let requests = 0;
  const api: WakeLockApi = {
    request: () => {
      requests++;
      if (!grant) return Promise.reject(new Error('NotAllowedError'));
      let onRelease = (): void => undefined;
      const lock = {
        released: false,
        fire: () => onRelease(),
        release: async () => { lock.released = true; },
        addEventListener: (_: 'release', fn: () => void) => { onRelease = fn; },
      };
      live.push(lock);
      return Promise.resolve(lock);
    },
  };
  return { api, live, requests: () => requests };
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('R5 §4: the screen kept on in runs', () => {
  it('holds one lock while wanted, however often asked, and lets it go', async () => {
    const f = fakeLock();
    const awake = new ScreenAwake(f.api, () => true);
    for (let i = 0; i < 10; i++) awake.want(true);
    await settle();
    awake.want(true);
    expect(f.requests()).toBe(1);
    expect(awake.held).toBe(true);
    awake.want(false);
    expect(awake.held).toBe(false);
    expect(f.live[0].released).toBe(true);
  });

  it('asks again on return after the browser dropped it while hidden', async () => {
    const f = fakeLock();
    let visible = true;
    const awake = new ScreenAwake(f.api, () => visible);
    awake.want(true);
    await settle();
    visible = false;
    f.live[0].fire();
    expect(awake.held).toBe(false);
    awake.want(true);
    expect(f.requests()).toBe(1);
    visible = true;
    awake.shown();
    await settle();
    expect(f.requests()).toBe(2);
    expect(awake.held).toBe(true);
  });

  it('a lock granted after it stopped being wanted is given straight back', async () => {
    const f = fakeLock();
    const awake = new ScreenAwake(f.api, () => true);
    awake.want(true);
    awake.want(false);
    await settle();
    expect(awake.held).toBe(false);
    expect(f.live[0].released).toBe(true);
  });

  it('a refusal is not asked again every frame', async () => {
    const f = fakeLock(false);
    let now = 0;
    const awake = new ScreenAwake(f.api, () => true, () => now);
    awake.want(true);
    await settle();
    for (let i = 0; i < 60; i++) awake.want(true);
    expect(f.requests()).toBe(1);
    now = 31_000;
    awake.want(true);
    expect(f.requests()).toBe(2);
  });

  it('without the API, nothing happens', () => {
    const awake = new ScreenAwake(null, () => true);
    awake.want(true);
    expect(awake.held).toBe(false);
  });
});

describe('the save', () => {
  it('a new profile caps at 60 and keeps the screen on in runs', () => {
    const p = newProfile(0);
    expect(p.settings.frameRate).toBe(60);
    expect(p.settings.keepAwake).toBe(true);
  });

  it('v26 → v27: the same defaults, and nothing the player set is overwritten', () => {
    expect(PROFILE_VERSION).toBeGreaterThanOrEqual(27);
    const out = migrate({ version: 26, createdAt: 5, settings: { speed: 2, draftTimer: 'off' } }, MIGRATIONS, 27);
    expect(out.version).toBe(27);
    expect(out.settings).toEqual({ speed: 2, draftTimer: 'off', frameRate: 60, keepAwake: true });
  });
});
