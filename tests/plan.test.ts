import { describe, expect, it } from 'vitest';
import { ABYSS_INDEX } from '../src/content/abyss';
import { RUSH_INDEX } from '../src/content/rush';
import { FORGE } from '../src/content/forge';
import { REGIONS } from '../src/content/regions';
import { marchOn } from '../src/meta/automation';
import { frontier, regionUnlocked } from '../src/meta/collection';
import { ensureBoard, fitBoard, placeOf, reroll, takeContract } from '../src/meta/contracts';
import { explainersFor } from '../src/meta/explainers';
import { hubGoal } from '../src/meta/goals';
import {
  FREE_REGIONS, act2Playable, clampToPlan, hubUnlocksFor, planAllows, playableFrontier, regionPaid, regionPlayable, sealedRegion,
} from '../src/meta/plan';
import { newProfile, type Profile } from '../src/meta/profile';
import type { RunSummary } from '../src/meta/results';
import { chooseTrial } from '../src/meta/trials';

/** A profile with Regions 1–`upTo` cleared, some play in each, and the weapon nodes owned. */
function cleared(upTo: number): Profile {
  const p = newProfile(1_700_000_000_000 + upTo);
  p.records.runs = 20;
  for (const r of REGIONS) {
    if (r.index > upTo) break;
    p.bosses[r.boss] = { kills: 3, fastest: 40 + r.index * 10 };
    p.regions[r.index] = { bestWave: 26 - r.index, runs: 3 };
  }
  p.regions[upTo + 1] ??= { bestWave: 12, runs: 3 };
  for (const n of FORGE) if (n.effects.some((e) => e.kind === 'unlockCard')) p.forge[n.id] = 1;
  p.relics = { 'mothers-tear': 1, 'gatekeepers-seal': 2 };
  p.farm = [120, 140, 160];
  return p;
}

/** A first boss kill, as `marchOn` reads a summary. */
const firstKill = { boss: { first: true } } as unknown as RunSummary;

describe('the plan (plans/monetization.md §2.1)', () => {
  it('frees Regions 1–3 and charges for everything past them, the Abyss and Boss Rush included', () => {
    expect(FREE_REGIONS).toBe(3);
    for (const r of REGIONS) expect(regionPaid(r.index), r.name).toBe(r.index > 3);
    // No special case: the Abyss and Boss Rush sit past the gate by index.
    expect(ABYSS_INDEX).toBeGreaterThan(FREE_REGIONS);
    expect(RUSH_INDEX).toBeGreaterThan(FREE_REGIONS);
    expect(regionPaid(ABYSS_INDEX)).toBe(true);
    expect(regionPaid(RUSH_INDEX)).toBe(true);
    expect(planAllows('full', ABYSS_INDEX)).toBe(true);
  });

  it('is earned and allowed: the Prism down earns Ember Rift, and only the full plan plays it', () => {
    const p = cleared(3);
    expect(regionUnlocked(p, 4)).toBe(true);
    expect(regionPlayable(p, 4, 'full')).toBe(true);
    expect(regionPlayable(p, 4, 'free')).toBe(false);
    for (const i of [1, 2, 3]) expect(regionPlayable(p, i, 'free')).toBe(true);
    // Not earned is not playable on any plan.
    expect(regionPlayable(cleared(1), 3, 'full')).toBe(false);
  });

  it('stops the frontier at the gate on free, and leaves `frontier` itself alone', () => {
    const p = cleared(3);
    expect(frontier(p).index).toBe(4);
    expect(playableFrontier(p, 'full').index).toBe(4);
    expect(playableFrontier(p, 'free').index).toBe(3);
    expect(playableFrontier(cleared(1), 'free').index).toBe(2);
  });

  it('names the sealed region only on free, and only once the Prism has fallen', () => {
    expect(sealedRegion(cleared(2), 'free')).toBeNull();
    expect(sealedRegion(cleared(3), 'free')?.name).toBe('Ember Rift');
    expect(sealedRegion(cleared(3), 'full')).toBeNull();
    // A refunded player deep in the game still sees one door: Ember Rift.
    expect(sealedRegion(cleared(6), 'free')?.index).toBe(4);
  });

  it('keeps Act 2 and the Constellations behind the purchase', () => {
    const p = cleared(6);
    expect(act2Playable(p, 'full')).toBe(true);
    expect(act2Playable(p, 'free')).toBe(false);
    expect(hubUnlocksFor(p, 'full').stars).toBe(true);
    expect(hubUnlocksFor(p, 'free').stars).toBe(false);
    expect(hubUnlocksFor(p, 'free').map).toBe(true);
  });
});

describe('clampToPlan (a downgrade, or boot on free)', () => {
  it('moves a next run past the gate back to the furthest free region', () => {
    for (const where of [4, 5, 6, ABYSS_INDEX, RUSH_INDEX]) {
      const p = cleared(6);
      p.region = where;
      expect(clampToPlan(p, 'free'), String(where)).toBe(true);
      expect(p.region).toBe(3);
    }
  });

  it('leaves a free region, and the full plan, alone', () => {
    const p = cleared(6);
    p.region = 2;
    expect(clampToPlan(p, 'free')).toBe(false);
    expect(p.region).toBe(2);
    p.region = ABYSS_INDEX;
    expect(clampToPlan(p, 'full')).toBe(false);
    expect(p.region).toBe(ABYSS_INDEX);
  });

  it('turns a contract detour home away from the gate too', () => {
    const p = cleared(6);
    p.region = 2;
    p.contracts.back = { region: 5, start: 1 };
    expect(clampToPlan(p, 'free')).toBe(true);
    expect(p.contracts.back).toEqual({ region: 2, start: 1 });
  });
});

describe('the doors (plans/monetization.md §2.2)', () => {
  it('Frontier March stops at the gate on free', () => {
    const p = cleared(3);
    p.forge['frontier-march'] = 1;
    p.region = 3;
    expect(marchOn(p, firstKill, 'free')).toBe(false);
    expect(p.region).toBe(3);
    expect(marchOn(p, firstKill)).toBe(true);
    expect(p.region).toBe(4);
  });

  it('a Trial past the gate is not taken on free', () => {
    const p = cleared(6);
    for (let i = 0; i < 4; i++) p.regions[i + 2] = { bestWave: 25, runs: 5 };
    expect(chooseTrial(p, 'storm-in-the-rift', 'free')).toBe(false);
    expect(p.trial).toBeNull();
    expect(chooseTrial(p, 'two-hands', 'free')).toBe(true);
    expect(p.region).toBe(3);
    expect(chooseTrial(p, 'storm-in-the-rift', 'full')).toBe(true);
    expect(p.region).toBe(4);
  });

  it('the Next goal never points past the gate on free', () => {
    const p = cleared(3);
    // Nothing affordable to crowd it out: the frontier's boss line is what's left.
    p.shards = 0;
    expect(hubGoal(p)?.text).toMatch(/Forgeheart/);
    expect(hubGoal(p, 'free')?.text ?? '').not.toMatch(/Forgeheart/);
  });

  it('the locked card’s explainer tells once the Prism falls on free, and Act 2’s wait', () => {
    expect(explainersFor(cleared(3), 'map', 'free').map((e) => e.id)).toContain('sealed');
    expect(explainersFor(cleared(3), 'map', 'full').map((e) => e.id)).not.toContain('sealed');
    expect(explainersFor(cleared(2), 'map', 'free').map((e) => e.id)).not.toContain('sealed');
    const deep = cleared(6);
    expect(explainersFor(deep, 'map', 'free').map((e) => e.id)).not.toContain('abyss');
    expect(explainersFor(deep, 'pacts', 'free')).toEqual([]);
    // The Abyss waits for the Thunderhead (plans/late-game/12 D-1), on either plan.
    expect(explainersFor(deep, 'map').map((e) => e.id)).not.toContain('abyss');
    deep.bosses.thunderhead = { kills: 1, fastest: 60 };
    expect(explainersFor(deep, 'map', 'free').map((e) => e.id)).not.toContain('abyss');
    expect(explainersFor(deep, 'map').map((e) => e.id)).toContain('abyss');
  });
});

describe('contracts on the free plan (D-6)', () => {
  it('draws the same board as before when no plan is passed', () => {
    const a = cleared(6);
    const b = structuredClone(a);
    ensureBoard(a);
    ensureBoard(b, 'full');
    expect(b.contracts.board).toEqual(a.contracts.board);
  });

  it('draws no card past the gate on free, through rerolls too', () => {
    const p = cleared(6);
    ensureBoard(p, 'free');
    for (let n = 0; n < 30; n++) {
      for (const c of [...p.contracts.board]) {
        expect(planAllows('free', placeOf(c.target)), JSON.stringify(c.target)).toBe(true);
        reroll(p, c.id, 'free');
      }
    }
  });

  it('redraws a full-plan board after a downgrade, and refuses to take a card past the gate', () => {
    const p = cleared(6);
    ensureBoard(p);
    // Find a seed whose full board reaches past the gate.
    let tries = 0;
    while (p.contracts.board.every((c) => planAllows('free', placeOf(c.target))) && tries++ < 50) {
      for (const c of [...p.contracts.board]) reroll(p, c.id);
    }
    const paid = p.contracts.board.find((c) => !planAllows('free', placeOf(c.target)))!;
    expect(paid).toBeDefined();
    expect(takeContract(p, paid.id, 'free')).toBe(false);
    expect(fitBoard(p, 'free')).toBe(true);
    for (const c of p.contracts.board) expect(planAllows('free', placeOf(c.target))).toBe(true);
    expect(fitBoard(p, 'free')).toBe(false);
  });
});
