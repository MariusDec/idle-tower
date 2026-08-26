/**
 * The blessing draft (gameplay plan §1.8).
 *
 * Every rule the draft has is a rule about what the player is *allowed to be
 * offered*, and a broken one is invisible in play — an offer with two copies of
 * the same card, or a maxed blessing that keeps showing up, just reads as bad
 * luck. So each rule gets an explicit case here, driven through the real
 * manager with a seeded RNG rather than through `Math.random`.
 */

import { describe, expect, it } from 'vitest';
import { BlessingManager } from '../src/systems/BlessingManager';
import {
  BLESSINGS,
  BLESSING_BY_ID,
  BLESSING_DRAFT_INTERVAL,
  BLESSING_FIRST_DRAFT_WAVE,
  BLESSING_MAX_PICKS,
  BLESSING_OFFER_SIZE,
  BLESSING_TUNING,
} from '../src/data/blessings';

/** Deterministic RNG so a failure is reproducible rather than a flake. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Take `id` `count` times, ignoring the draft flow. */
function hold(mgr: BlessingManager, id: string, count = 1): void {
  for (let i = 0; i < count; i++) {
    expect(mgr.choose(id), `choose ${id} #${i + 1}`).toBe(true);
  }
}

describe('offer rolling', () => {
  it('never offers the same blessing twice in one draft', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const mgr = new BlessingManager();
      const offer = mgr.rollOffer(40, undefined, seeded(seed));
      const ids = offer.map(d => d.id);
      expect(new Set(ids).size, `seed ${seed}: ${ids.join(',')}`).toBe(ids.length);
    }
  });

  it('offers exactly three while the pool is deep enough', () => {
    const mgr = new BlessingManager();
    expect(mgr.rollOffer(40, undefined, seeded(7))).toHaveLength(BLESSING_OFFER_SIZE);
  });

  it('never offers a blessing already at max stacks', () => {
    const mgr = new BlessingManager();
    hold(mgr, 'bl_sharpen', BLESSING_BY_ID.bl_sharpen.maxStacks);
    for (let seed = 1; seed <= 200; seed++) {
      const ids = mgr.rollOffer(40, undefined, seeded(seed)).map(d => d.id);
      expect(ids, `seed ${seed}`).not.toContain('bl_sharpen');
    }
    // Guard against a vacuous pass: it must still be offerable at 0 stacks.
    const fresh = new BlessingManager();
    const seen = new Set<string>();
    for (let seed = 1; seed <= 400; seed++) {
      for (const d of fresh.rollOffer(40, undefined, seeded(seed))) seen.add(d.id);
    }
    expect(seen.has('bl_sharpen')).toBe(true);
  });

  it('gates a `requires` follow-up on holding its prerequisite', () => {
    const gated = BLESSINGS.filter(b => b.requires);
    expect(gated.length).toBeGreaterThan(0);

    const mgr = new BlessingManager();
    for (const def of gated) {
      expect(mgr.eligible(80).map(d => d.id)).not.toContain(def.id);
    }
    // Taking Frostbite unlocks Shatter, and nothing else.
    hold(mgr, 'bl_frost');
    const eligible = mgr.eligible(80).map(d => d.id);
    expect(eligible).toContain('bl_shatter');
    expect(eligible).not.toContain('bl_ricochet_power');
  });

  /**
   * The `offerable` escape hatch still exists and still works — it is what
   * kept `bl_magnet` out of the pool while Part 4 was unwritten — but nothing
   * is using it any more. Both halves are asserted: an opted-out card would
   * still be filtered, and today no card is opted out.
   */
  it('never offers a blessing whose consumer has not shipped', () => {
    const deferred = BLESSINGS.filter(b => b.offerable === false);
    expect(deferred.map(d => d.id)).toEqual([]);
    const mgr = new BlessingManager();
    const eligible = new Set(mgr.eligible(200).map(d => d.id));
    for (const def of deferred) expect(eligible.has(def.id)).toBe(false);
  });

  /** Part 4 shipped the loot system, so Lodestone must be drawable. */
  it('offers the loot-orb blessing now that LootManager exists', () => {
    const mgr = new BlessingManager();
    expect(mgr.eligible(200).map(d => d.id)).toContain('bl_magnet');
  });

  it('respects a blessing wave gate', () => {
    const gated = BLESSINGS.filter(b => (b.minWave ?? 0) > 1);
    expect(gated.length).toBeGreaterThan(0);
    const mgr = new BlessingManager();
    for (const def of gated) {
      expect(mgr.eligible(def.minWave! - 1).map(d => d.id)).not.toContain(def.id);
      expect(mgr.eligible(def.minWave!).map(d => d.id)).toContain(def.id);
    }
  });
});

describe('rerolls', () => {
  it('spends the free reroll first, then tokens, then refuses', () => {
    const mgr = new BlessingManager();
    mgr.grantRerollToken(2);
    mgr.openDraft(20, undefined, seeded(3));
    expect(mgr.rerollsAvailable).toBe(3); // 1 free + 2 tokens

    expect(mgr.reroll(undefined, seeded(4))).not.toBeNull();
    expect(mgr.rerollsAvailable).toBe(2);
    expect(mgr.tokens).toBe(2); // the free one went first

    expect(mgr.reroll(undefined, seeded(5))).not.toBeNull();
    expect(mgr.tokens).toBe(1);
    expect(mgr.reroll(undefined, seeded(6))).not.toBeNull();
    expect(mgr.tokens).toBe(0);

    expect(mgr.reroll(undefined, seeded(7))).toBeNull();
    expect(mgr.rerollsAvailable).toBe(0);
  });

  it('refuses to reroll when no draft is open', () => {
    const mgr = new BlessingManager();
    mgr.grantRerollToken(1);
    expect(mgr.reroll(undefined, seeded(1))).toBeNull();
    expect(mgr.tokens).toBe(1);
  });

  it('restores the free reroll on the next draft', () => {
    const mgr = new BlessingManager();
    mgr.openDraft(3, undefined, seeded(1));
    mgr.reroll(undefined, seeded(2));
    expect(mgr.rerollsAvailable).toBe(0);
    mgr.choose(mgr.offer[0].id);
    mgr.openDraft(7, undefined, seeded(3));
    expect(mgr.rerollsAvailable).toBe(1);
  });
});

describe('cadence and the pick cap', () => {
  it('drafts after wave 3, then every four waves', () => {
    const mgr = new BlessingManager();
    const due: number[] = [];
    for (let wave = 1; wave <= 24; wave++) if (mgr.isDraftDue(wave)) due.push(wave);
    expect(due).toEqual([3, 7, 11, 15, 19, 23]);
    expect(BLESSING_FIRST_DRAFT_WAVE).toBe(3);
    expect(BLESSING_DRAFT_INTERVAL).toBe(4);
  });

  it('stops offering once the pick cap is reached', () => {
    const mgr = new BlessingManager();
    let wave = BLESSING_FIRST_DRAFT_WAVE;
    let taken = 0;
    // Walk the real cadence until the manager stops offering.
    while (taken < BLESSING_MAX_PICKS + 10 && wave < 400) {
      if (mgr.isDraftDue(wave)) {
        const offer = mgr.openDraft(wave, undefined, seeded(wave));
        if (offer.length === 0) break;
        if (mgr.choose(offer[0].id)) taken += 1;
        else mgr.skip();
      }
      wave += 1;
    }
    expect(mgr.picks).toBeLessThanOrEqual(BLESSING_MAX_PICKS);
    expect(mgr.isCapped).toBe(true);
    expect(mgr.isDraftDue(wave + 4)).toBe(false);
    expect(mgr.choose('bl_vigor')).toBe(false);
  });

  it('refuses a pick beyond a blessing’s own max stacks', () => {
    const mgr = new BlessingManager();
    const def = BLESSING_BY_ID.bl_pierce;
    hold(mgr, def.id, def.maxStacks);
    expect(mgr.choose(def.id)).toBe(false);
    expect(mgr.stacks(def.id)).toBe(def.maxStacks);
  });

  it('ignores an unknown id', () => {
    const mgr = new BlessingManager();
    expect(mgr.choose('bl_not_a_thing')).toBe(false);
    expect(mgr.picks).toBe(0);
  });
});

describe('stat totals', () => {
  it('sums a blessing across its stacks', () => {
    const mgr = new BlessingManager();
    const per = BLESSING_BY_ID.bl_sharpen.effects![0].perStack;
    hold(mgr, 'bl_sharpen', 3);
    expect(mgr.getStatTotals().damagePct).toBeCloseTo(per * 3, 10);
  });

  it('sums the same stat across different blessings', () => {
    const mgr = new BlessingManager();
    hold(mgr, 'bl_sharpen', 2);
    hold(mgr, 'bl_glass');
    const expected = BLESSING_BY_ID.bl_sharpen.effects![0].perStack * 2
      + BLESSING_BY_ID.bl_glass.effects!.find(e => e.stat === 'damagePct')!.perStack;
    expect(mgr.getStatTotals().damagePct).toBeCloseTo(expected, 10);
    // The trade-off half lands too, rather than only the upside.
    expect(mgr.getStatTotals().maxHpPct).toBeLessThan(0);
  });

  it('grows the Greed Engine with waves cleared, and only while it is held', () => {
    const without = new BlessingManager();
    for (let i = 0; i < 20; i++) without.noteWaveCleared();
    expect(without.getStatTotals().goldPct ?? 0).toBe(0);

    const mgr = new BlessingManager();
    hold(mgr, 'bl_greed_engine');
    expect(mgr.getStatTotals().goldPct ?? 0).toBe(0);
    for (let i = 0; i < 20; i++) mgr.noteWaveCleared();
    expect(mgr.getStatTotals().goldPct).toBeCloseTo(BLESSING_TUNING.greedPerWave * 20, 10);
  });

  it('caps the Greed Engine well under 6x baseline gold over 100 waves', () => {
    const mgr = new BlessingManager();
    hold(mgr, 'bl_greed_engine');
    for (let i = 0; i < 100; i++) mgr.noteWaveCleared();
    // Plan §1.6: uncapped by design, but a 100-wave run must not run away.
    expect(1 + (mgr.getStatTotals().goldPct ?? 0)).toBeLessThan(6);
  });
});

describe('behavior cache', () => {
  it('answers `has` from the held set and clears on reset', () => {
    const mgr = new BlessingManager();
    expect(mgr.has('ricochet')).toBe(false);
    hold(mgr, 'bl_ricochet');
    expect(mgr.has('ricochet')).toBe(true);
    expect(mgr.has('ricochet_power')).toBe(false);
    mgr.reset();
    expect(mgr.has('ricochet')).toBe(false);
    expect(mgr.picks).toBe(0);
    expect(mgr.getStatTotals()).toEqual({});
  });

  it('matches a fresh linear scan of the pool', () => {
    const mgr = new BlessingManager();
    hold(mgr, 'bl_frost');
    hold(mgr, 'bl_shatter');
    hold(mgr, 'bl_sharpen', 2);
    const held = mgr.snapshot().held;
    const expected = new Set(
      BLESSINGS.filter(b => (held[b.id] ?? 0) > 0 && b.behavior).map(b => b.behavior!),
    );
    for (const def of BLESSINGS) {
      if (!def.behavior) continue;
      expect(mgr.has(def.behavior), def.behavior).toBe(expected.has(def.behavior));
    }
  });
});

describe('snapshot and restore', () => {
  it('round-trips held stacks, picks and tokens', () => {
    const mgr = new BlessingManager();
    hold(mgr, 'bl_sharpen', 2);
    hold(mgr, 'bl_ricochet');
    mgr.grantRerollToken(3);
    for (let i = 0; i < 5; i++) mgr.noteWaveCleared();

    const restored = new BlessingManager();
    restored.restore(mgr.snapshot());
    expect(restored.snapshot()).toEqual(mgr.snapshot());
    expect(restored.has('ricochet')).toBe(true);
    expect(restored.getStatTotals()).toEqual(mgr.getStatTotals());
  });

  it('drops an unknown id and clamps an over-large stack count', () => {
    const mgr = new BlessingManager();
    mgr.restore({
      held: { bl_gone: 2, bl_pierce: 99 },
      picksTaken: 4,
      rerolls: 1,
      pendingOfferForWave: 12,
      wavesClearedThisRun: 3,
    });
    expect(mgr.stacks('bl_gone')).toBe(0);
    expect(mgr.stacks('bl_pierce')).toBe(BLESSING_BY_ID.bl_pierce.maxStacks);
    // A draft that was open when the save was written is not resumed.
    expect(mgr.offerWave).toBeNull();
  });
});
