import { describe, expect, it } from 'vitest';
import { BOSS_MOTION, BOSS_POSE, BossAnimator, type BossInput, type BossPose } from '../src/render/bossMotion';
import type { MotionLevel } from '../src/render/motion';
import type { QualityTier } from '../src/render/quality';
import type { BossId } from '../src/content/types';

/** Boss poses (plans/enemy-animation.md §6, §9). */

const IDS = Object.keys(BOSS_MOTION) as BossId[];
const DT = 1 / 60;

function input(over: Partial<BossInput> = {}): BossInput {
  return { x: 300, y: 0, radius: 60, moving: false, hitTick: -1, windup: 0, staggered: false, enraged: false, ...over };
}

function animator(level: MotionLevel = 'full', tier: QualityTier = 'high'): BossAnimator {
  const a = new BossAnimator();
  a.setMotion(level, tier);
  return a;
}

const snap = (p: BossPose): BossPose => ({ ...p });

function withinClamps(p: BossPose): void {
  expect(Math.abs(1 - p.sx)).toBeLessThanOrEqual(BOSS_POSE.maxScale + 1e-9);
  expect(Math.abs(1 - p.sy)).toBeLessThanOrEqual(BOSS_POSE.maxScale + 1e-9);
  expect(Math.abs(p.shear)).toBeLessThanOrEqual(BOSS_POSE.maxShear + 1e-9);
}

/**
 * The scripted fight: arrive, walk in, a 1.2 s wind-up with hits, the slam,
 * a stagger, a phase change, enraged walking. Returns every frame's pose.
 */
function fight(a: BossAnimator, id: BossId): BossPose[] {
  const poses: BossPose[] = [];
  let clock = 0;
  let tick = 0;
  const step = (over: Partial<BossInput>): void => {
    clock += DT;
    tick++;
    poses.push(snap(a.update(id, input(over), clock)));
  };
  a.event('bossArrive', clock);
  for (let i = 0; i < 60; i++) step({ moving: true });
  a.event('windup', clock, 1.2);
  for (let i = 0; i < 72; i++) step({ windup: 1.2 - i * DT, hitTick: tick });
  a.event('slam', clock);
  for (let i = 0; i < 30; i++) step({});
  for (let i = 0; i < 60; i++) step({ staggered: true });
  a.event('bossPhase', clock);
  for (let i = 0; i < 40; i++) step({});
  for (let i = 0; i < 60; i++) step({ moving: true, enraged: true });
  return poses;
}

describe('BossAnimator', () => {
  it('every boss has a character', () => {
    expect(IDS.length).toBe(9);
  });

  it('stays inside the clamps through a whole fight, for every boss and level', () => {
    for (const id of IDS) {
      for (const level of ['full', 'lite', 'reduced'] as const) {
        for (const p of fight(animator(level), id)) withinClamps(p);
      }
    }
  });

  it('is the identity at rest', () => {
    const a = animator();
    let p!: BossPose;
    for (let i = 1; i <= 120; i++) p = a.update('gatekeeper', input(), i * DT);
    expect(p.dx).toBeCloseTo(0, 6);
    expect(p.dy).toBeCloseTo(0, 6);
    expect(p.sx).toBeCloseTo(1, 6);
    expect(p.sy).toBeCloseTo(1, 6);
    expect(p.after).toBe(0);
  });

  it('winds up: compresses, backs off from the tower, and reports progress', () => {
    const a = animator();
    a.event('windup', 0, 1.2);
    a.update('gatekeeper', input({ windup: 1.2 }), 0);
    const p = a.update('gatekeeper', input({ windup: 0.3 }), 0.9);
    expect(p.tell).toBeCloseTo(0.75, 6);
    expect(p.sy).toBeLessThan(1);
    expect(p.sx).toBeGreaterThan(1);
    // The boss is at +x; the tower is at the origin: it backs off toward +x.
    expect(p.dx).toBeGreaterThan(0);
  });

  it('takes the wind-up total from the state when a resumed save missed the event', () => {
    const a = animator();
    a.update('hunger', input({ windup: 0.8 }), 0);
    expect(a.update('hunger', input({ windup: 0.4 }), 0.4).tell).toBeCloseTo(0.5, 6);
  });

  it('releases: a stretch and a lunge toward the tower, then settles', () => {
    const a = animator();
    a.update('hunger', input(), 0);
    a.event('slam', 0);
    const p = snap(a.update('hunger', input(), 0.05));
    expect(p.sy).toBeGreaterThan(1);
    expect(p.dx).toBeLessThan(0);
    const later = a.update('hunger', input(), 0.05 + BOSS_POSE.releaseSeconds);
    expect(later.sy).toBeCloseTo(1, 6);
    expect(later.dx).toBeCloseTo(0, 6);
  });

  it('shows the afterimage on high only', () => {
    for (const [tier, level, shows] of [['high', 'full', true], ['medium', 'full', false], ['low', 'lite', false]] as const) {
      const a = animator(level, tier);
      a.update('gatekeeper', input(), 0);
      a.event('slam', 0);
      expect(a.update('gatekeeper', input(), 0.05).after > 0).toBe(shows);
    }
  });

  it('under reduced motion, is the identity but for the wind-up compression and the stagger droop', () => {
    for (const id of IDS) {
      const a = animator('reduced');
      const poses = fight(a, id);
      for (const p of poses) {
        expect(p.dx).toBe(0);
        expect(p.dy).toBe(0);
        expect(p.shear).toBe(0);
        expect(p.after).toBe(0);
        expect(p.sy).toBeLessThanOrEqual(1);
      }
      // The wind-up still compresses, as much as the boss gives: the tell the player reads.
      const peak = BOSS_POSE.windupSquash * BOSS_MOTION[id].give;
      expect(Math.min(...poses.slice(60, 132).map((p) => p.sy))).toBeLessThan(1 - 0.9 * peak);
      // Walking, arriving, releasing and phase changes are still.
      for (const p of poses.slice(0, 60)) expect(p.sy).toBe(1);
      // (The droop eases out over the phase-change frames; by the enraged walk it is gone.)
      for (const p of poses.slice(262)) expect(p.sy).toBe(1);
    }
  });

  it('re-arms the hit squish at most every 0.25 s', () => {
    const a = animator();
    let starts = 0;
    let prev = 1;
    for (let i = 1; i <= 120; i++) {
      const p = a.update('bog-mother', input({ hitTick: i }), i * DT);
      // A fresh squish's first lobe is the only one that flattens past 2% (its later lobes are far smaller).
      if (p.sy < 0.98 && prev >= 0.98) starts++;
      prev = p.sy;
    }
    // 2 s under constant fire: about 8 pulses, never stuck at the peak.
    expect(starts).toBeGreaterThanOrEqual(6);
    expect(starts).toBeLessThanOrEqual(9);
  });

  it('sinks and rises (the Undertow), fading only under reduced motion', () => {
    const a = animator();
    a.update('undertow', input(), 0);
    a.event('submerge', 0);
    const down = snap(a.update('undertow', input(), BOSS_POSE.sinkSeconds * 0.8));
    expect(down.sink).toBeGreaterThan(0);
    expect(down.sy).toBeLessThan(0.6);
    a.event('emerge', 1);
    const up = snap(a.update('undertow', input(), 1.05));
    expect(up.fade).toBeLessThan(1);
    expect(up.sy).toBeLessThan(1);
    expect(a.update('undertow', input(), 2).fade).toBe(1);

    const r = animator('reduced');
    r.update('undertow', input(), 0);
    r.event('submerge', 0);
    const rd = r.update('undertow', input(), 0.1);
    expect(rd.sink).toBeGreaterThan(0);
    expect(rd.sy).toBe(1);
  });

  it('is deterministic: the same inputs give the same poses', () => {
    expect(fight(animator(), 'blight')).toEqual(fight(animator(), 'blight'));
  });

  it('forgets everything on reset', () => {
    const a = animator();
    a.update('gatekeeper', input(), 0);
    a.event('slam', 0);
    a.reset();
    const p = a.update('gatekeeper', input(), 0.05);
    expect(p.after).toBe(0);
    expect(p.sy).toBe(1);
  });

  it('8a: the outer parts lag a landing, then settle; never on lite or reduced', () => {
    const run = (level: MotionLevel): number[] => {
      const a = animator(level, level === 'lite' ? 'low' : 'high');
      const lags: number[] = [];
      a.update('hollow-king', input(), 0);
      a.event('bossArrive', 0);
      for (let i = 1; i <= 120; i++) lags.push(a.update('hollow-king', input(), i * DT).lag);
      return lags;
    };
    const full = run('full');
    expect(Math.max(...full.map(Math.abs))).toBeGreaterThan(0.02);
    for (const l of full) expect(Math.abs(l)).toBeLessThanOrEqual(BOSS_POSE.maxLag + 1e-9);
    expect(Math.abs(full[full.length - 1])).toBeLessThan(0.005);
    for (const l of [...run('lite'), ...run('reduced')]) expect(l).toBe(0);
  });

  it('8a: a boss with no follow-through never lags', () => {
    const a = animator();
    a.event('bossArrive', 0);
    for (let i = 1; i <= 60; i++) expect(a.update('prism', input(), i * DT).lag).toBe(0);
  });

  it('8b: looks at a near projectile, else the tower, and locks on during a wind-up', () => {
    const a = animator();
    // Boss at (300, 0): the tower is at −x. A shot just above it, within reach.
    const shot = [{ alive: true, x: 300, y: -80 }];
    let p!: BossPose;
    for (let i = 1; i <= 60; i++) p = a.update('gatekeeper', input(), i * DT, shot);
    expect(p.gy).toBeLessThan(-0.9);
    for (let i = 61; i <= 120; i++) p = a.update('gatekeeper', input(), i * DT, [{ alive: false, x: 300, y: -80 }]);
    expect(p.gx).toBeLessThan(-0.9);
    a.event('windup', 2, 1);
    for (let i = 121; i <= 150; i++) p = a.update('gatekeeper', input({ windup: 1 - (i - 120) * DT }), i * DT, shot);
    expect(p.gx).toBeLessThan(-0.9);
    expect(p.narrow).toBeGreaterThan(0.4);
  });

  it('8b: the pupils stay centred on lite and under reduced motion', () => {
    for (const [level, tier] of [['lite', 'low'], ['reduced', 'high']] as const) {
      const a = animator(level, tier);
      let p!: BossPose;
      for (let i = 1; i <= 60; i++) p = a.update('undertow', input(), i * DT, [{ alive: true, x: 300, y: -80 }]);
      expect(p.gx).toBe(0);
      expect(p.gy).toBe(0);
    }
  });

  it('8c: the tell is the wind-up progress on every level', () => {
    for (const level of ['full', 'lite', 'reduced'] as const) {
      const a = animator(level);
      a.event('windup', 0, 2);
      expect(a.update('forgeheart', input({ windup: 0.5 }), 1.5).tell).toBeCloseTo(0.75, 6);
    }
  });
});
