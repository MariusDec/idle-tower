/**
 * Content coverage guard (plan §7.2).
 *
 * Part 1 found twenty talents and nine achievement rewards that could be
 * bought, cost points or gold, and changed no number anywhere. The fix was an
 * exhaustive switch per stat — `tsc` catches a *missing* case, but nothing
 * catches a talent whose declared stat was never added to the union, or a
 * reward type whose consumer entry is a placeholder. That is what this file is
 * for: it is the regression test for the whole class of bug.
 */

import { describe, expect, it } from 'vitest';
import { TALENTS, TALENT_STATS, TALENTS_BY_BRANCH } from '../src/data/talentTree';
import type { TalentDef, TalentEffectType } from '../src/data/talentTree';
import { ACHIEVEMENTS, ACHIEVEMENT_REWARD_CONSUMERS } from '../src/data/achievements';
import type { AchievementRewardType } from '../src/data/achievements';
import { ABILITIES } from '../src/data/abilities';
import { PASSIVE_ABILITIES } from '../src/data/passiveAbilities';
import { RESEARCH_NODES } from '../src/data/research';
import { UPGRADES } from '../src/data/upgrades';

/** A talent's declared effects: the primary one, plus the optional second. */
const effectsOf = (t: TalentDef): TalentEffectType[] =>
  t.secondary ? [t.effect, t.secondary] : [t.effect];

describe('talents', () => {
  it('declares every effect stat in the consumed union', () => {
    const known = new Set<string>(TALENT_STATS);
    const orphans = TALENTS.flatMap((t) =>
      effectsOf(t).filter((e) => !known.has(e.stat)).map((e) => `${t.id} -> ${e.stat}`),
    );
    expect(orphans).toEqual([]);
  });

  it('has no unused stat in the union either', () => {
    const declared = new Set(TALENTS.flatMap((t) => effectsOf(t).map((e) => e.stat)));
    const unused = TALENT_STATS.filter((s) => !declared.has(s));
    expect(unused).toEqual([]);
  });

  it('gives every talent a non-zero value per point', () => {
    const dead = TALENTS.flatMap((t) =>
      effectsOf(t).filter((e) => e.perPoint === 0).map((e) => `${t.id} -> ${e.stat}`),
    );
    expect(dead).toEqual([]);
  });

  it('lets every talent actually be bought', () => {
    const unbuyable = TALENTS.filter((t) => t.maxPoints <= 0 || t.costPerPoint <= 0);
    expect(unbuyable.map((t) => t.id)).toEqual([]);
  });

  it('has unique ids', () => {
    expect(new Set(TALENTS.map((t) => t.id)).size).toBe(TALENTS.length);
  });

  it('only names prerequisites that exist', () => {
    const ids = new Set(TALENTS.map((t) => t.id));
    const all = TALENTS.flatMap((t) => t.prerequisites);
    // Guard against this test quietly becoming vacuous if the field is renamed.
    expect(all.length).toBeGreaterThan(0);
    const missing = TALENTS.flatMap((t) =>
      t.prerequisites.filter((r) => !ids.has(r)).map((r) => `${t.id} requires ${r}`),
    );
    expect(missing).toEqual([]);
  });

  it('keeps every talent reachable from its branch', () => {
    for (const [branch, talents] of Object.entries(TALENTS_BY_BRANCH)) {
      expect(talents.length, `${branch} should not be empty`).toBeGreaterThan(0);
    }
  });
});

describe('achievements', () => {
  it('names a consumer for every reward type', () => {
    const types = Object.keys(ACHIEVEMENT_REWARD_CONSUMERS) as AchievementRewardType[];
    for (const type of types) {
      const consumer = ACHIEVEMENT_REWARD_CONSUMERS[type];
      // A consumer entry has to name a real call site, not a shrug.
      expect(consumer, `${type} has no consumer`).toBeTruthy();
      expect(consumer.length, `${type} consumer is too vague`).toBeGreaterThan(8);
      expect(consumer.toLowerCase(), `${type} consumer is a placeholder`)
        .not.toMatch(/todo|nothing|unused|n\/a|tbd/);
    }
  });

  it('only grants reward types that have a consumer', () => {
    const consumed = new Set(Object.keys(ACHIEVEMENT_REWARD_CONSUMERS));
    const orphans = ACHIEVEMENTS.filter((a) => !consumed.has(a.reward.type)).map(
      (a) => `${a.id} -> ${a.reward.type}`,
    );
    expect(orphans).toEqual([]);
  });

  /**
   * The mirror of the above, and the half Part 1 did not finish.
   *
   * `all_stats` is read in three places in `Game` but granted by no
   * achievement, so those reads are permanently zero — dead in the other
   * direction from the nine unread rewards §1.5 fixed. It is pinned here
   * rather than quietly tolerated: granting it is a balance decision, so the
   * exemption stays visible until someone makes it, and any *new* ungranted
   * reward type fails immediately.
   */
  const KNOWN_UNGRANTED: AchievementRewardType[] = ['all_stats'];

  it('grants every reward type it declares a consumer for', () => {
    const granted = new Set(ACHIEVEMENTS.map((a) => a.reward.type));
    const ungranted = (Object.keys(ACHIEVEMENT_REWARD_CONSUMERS) as AchievementRewardType[])
      .filter((t) => !granted.has(t) && !KNOWN_UNGRANTED.includes(t));
    expect(ungranted).toEqual([]);
  });

  it('still has no achievement granting the known-ungranted types', () => {
    // If someone grants one, delete it from KNOWN_UNGRANTED — this test is the
    // reminder, so the exemption list cannot rot into a permanent excuse.
    const granted = new Set(ACHIEVEMENTS.map((a) => a.reward.type));
    expect(KNOWN_UNGRANTED.filter((t) => granted.has(t))).toEqual([]);
  });

  it('has unique ids and a positive reward value', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    expect(ACHIEVEMENTS.filter((a) => a.reward.value <= 0).map((a) => a.id)).toEqual([]);
  });
});

describe('content tables are internally consistent', () => {
  it('has unique ids across every table', () => {
    for (const [name, ids] of [
      ['abilities', ABILITIES.map((a) => a.id)],
      ['passives', PASSIVE_ABILITIES.map((p) => p.id)],
      ['research', RESEARCH_NODES.map((r) => r.id)],
      ['upgrades', UPGRADES.map((u) => u.id)],
    ] as const) {
      expect(new Set(ids).size, `${name} has duplicate ids`).toBe(ids.length);
    }
  });

  it('only names research prerequisites that exist', () => {
    const ids = new Set(RESEARCH_NODES.map((r) => r.id));
    const all = RESEARCH_NODES.flatMap((r) => r.prerequisites);
    // Guard against this test quietly becoming vacuous if the field is renamed.
    expect(all.length).toBeGreaterThan(0);
    const missing = RESEARCH_NODES.flatMap((r) =>
      r.prerequisites.filter((p) => !ids.has(p)).map((p) => `${r.id} requires ${p}`),
    );
    expect(missing).toEqual([]);
  });

  it('places every upgrade evolution within the upgrade level range', () => {
    const bad = UPGRADES.flatMap((u) =>
      (u.evolutions ?? [])
        .filter((e) => e.level <= 0 || (u.maxLevel > 0 && e.level > u.maxLevel))
        .map((e) => `${u.id} evolution at level ${e.level} (max ${u.maxLevel})`),
    );
    expect(bad).toEqual([]);
  });
});
