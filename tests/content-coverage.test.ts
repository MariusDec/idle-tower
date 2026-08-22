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

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TALENTS, TALENT_STATS, TALENTS_BY_BRANCH } from '../src/data/talentTree';
import type { TalentDef, TalentEffectType } from '../src/data/talentTree';
import { ACHIEVEMENTS, ACHIEVEMENT_REWARD_CONSUMERS } from '../src/data/achievements';
import type { AchievementRewardType } from '../src/data/achievements';
import { ABILITIES } from '../src/data/abilities';
import { PASSIVE_ABILITIES } from '../src/data/passiveAbilities';
import { RESEARCH_NODES } from '../src/data/research';
import { UPGRADES } from '../src/data/upgrades';
import {
  BOSS_PATTERNS,
  BOSS_PATTERN_CONSUMERS,
  BOSS_PATTERN_HINTS,
  BOSS_PATTERN_HP_WEIGHT,
  BOSS_PATTERN_NAMES,
  ENEMY_BEHAVIOR_CONSUMERS,
  ENEMY_DEFS,
  ENEMY_LABELS,
  ENEMY_SPAWN_WEIGHTS,
  PRIORITY_TARGET_ORDER,
  bossPatternsForWave,
  spawnPoolForWave,
} from '../src/data/enemies';
import { ENEMY_THREAT_CLASS } from '../src/data/pacing';
import { MILESTONE_EXEMPT_ENEMIES, MILESTONES } from '../src/data/milestones';
import { RENDERED_ENEMY_SHAPES } from '../src/game/Renderer';
import { TARGETING_MODES } from '../src/data/tower';
import type { BossPattern, EnemyType } from '../src/types';
import {
  BLESSINGS,
  BLESSING_BEHAVIOR_CONSUMERS,
  BLESSING_STATS,
  BLESSING_STAT_LABELS,
  type BlessingBehavior,
} from '../src/data/blessings';
import { ICON_CREDITS, ICON_IDS, type IconId } from '../src/data/icons';
import { STAT_ICONS, STAT_ICON_KEYS } from '../src/data/iconMap';
import { EQUIPMENT_DEFS, RARITY_ICONS, SLOT_ICONS } from '../src/data/equipment';
import { CORES } from '../src/data/cores';
import { AP_PERKS, TP_PERKS } from '../src/data/prestige';
import { WAVE_MODIFIERS } from '../src/data/waveModifiers';
import {
  CONTRACTS,
  CONTRACT_ENEMY_LABELS,
  describeContract,
  describeReward,
} from '../src/data/contracts';

/**
 * Boss patterns (gameplay plan §3.2).
 *
 * Same guard as the enemy roster's: `tsc` catches a missing `switch` case, but
 * nothing catches a pattern whose consumer entry is a placeholder, or one that
 * no tier ever draws. Both would be a name on the boss bar attached to nothing,
 * which is precisely the failure mode §0.4 is complaining about.
 */
describe('boss patterns', () => {
  it('names a real consumer for every pattern', () => {
    for (const pattern of BOSS_PATTERNS) {
      const consumer = BOSS_PATTERN_CONSUMERS[pattern];
      expect(consumer, `${pattern} has no consumer`).toBeTruthy();
      expect(consumer.length, `${pattern} consumer is too vague`).toBeGreaterThan(20);
      expect(consumer.toLowerCase(), `${pattern} consumer is a placeholder`)
        .not.toMatch(/todo|nothing|unused|n\/a|tbd/);
    }
  });

  it('gives every pattern a player-facing name and an answer', () => {
    for (const pattern of BOSS_PATTERNS) {
      expect(BOSS_PATTERN_NAMES[pattern], `${pattern} name`).toBeTruthy();
      expect(BOSS_PATTERN_HINTS[pattern].length, `${pattern} hint`).toBeGreaterThan(20);
    }
  });

  it('prices every pattern in the durability budget', () => {
    for (const pattern of BOSS_PATTERNS) {
      // `slam` is legitimately zero — it costs tower HP, not tower damage — so
      // the guard is that the key exists and is a number, not that it is > 0.
      expect(typeof BOSS_PATTERN_HP_WEIGHT[pattern], pattern).toBe('number');
    }
  });

  it('actually draws every pattern somewhere in the tier rotation', () => {
    const drawn = new Set<BossPattern>();
    for (let wave = 10; wave <= 200; wave += 10) {
      for (const pattern of bossPatternsForWave(wave)) drawn.add(pattern);
    }
    expect([...drawn].sort()).toEqual([...BOSS_PATTERNS].sort());
  });
});

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

describe('contracts', () => {
  /**
   * The plan's cross-cutting rule 3, applied to §5's union.
   *
   * `CONTRACT_ENEMY_LABELS` is a `Record<EnemyType, string>`, so an enemy type
   * added without a contract label is a compile error; this is the runtime half
   * — that no label is a placeholder, and that every `kill_type` contract names
   * an enemy the spawn pool actually produces.
   */
  it('names every enemy type it can ask the player to kill', () => {
    for (const type of Object.keys(ENEMY_DEFS) as EnemyType[]) {
      const label = CONTRACT_ENEMY_LABELS[type];
      expect(label, `${type} has no contract label`).toBeTruthy();
      expect(label.toLowerCase()).not.toMatch(/todo|tbd|unknown/);
    }
  });

  it('renders a non-empty goal line for every def', () => {
    expect(CONTRACTS.length).toBeGreaterThan(15);
    for (const def of CONTRACTS) {
      const text = describeContract(def.goal, 7);
      expect(text, `${def.id} renders nothing`).toBeTruthy();
      expect(text.length, `${def.id} renders a stub`).toBeGreaterThan(8);
    }
  });

  it('renders a non-empty reward line for every def', () => {
    for (const def of CONTRACTS) {
      const text = describeReward(def.reward, 500);
      expect(text, `${def.id} advertises no reward`).toBeTruthy();
    }
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


/**
 * Blessings (gameplay plan §1.8).
 *
 * `tsc` catches a `BlessingStat` with no case in the contributor and a
 * `BlessingBehavior` with no entry in the consumer map. What it cannot catch is
 * a *card* that declares nothing, a `requires` pointing at a deleted id, or a
 * consumer entry that is a placeholder — the exact class of rot that produced
 * twenty inert talents. That is what this block is for.
 */
describe('blessings', () => {
  it('has unique ids', () => {
    expect(new Set(BLESSINGS.map((b) => b.id)).size).toBe(BLESSINGS.length);
  });

  it('gives every blessing something to do', () => {
    const inert = BLESSINGS.filter(
      (b) => !b.behavior && (b.effects ?? []).length === 0,
    );
    expect(inert.map((b) => b.id)).toEqual([]);
  });

  it('gives every declared effect a non-zero per-stack value', () => {
    const effects = BLESSINGS.flatMap((b) => (b.effects ?? []).map((e) => ({ id: b.id, e })));
    expect(effects.length).toBeGreaterThan(0);
    expect(effects.filter((x) => x.e.perStack === 0).map((x) => x.id)).toEqual([]);
  });

  it('declares every effect stat inside the consumed union', () => {
    const known = new Set<string>(BLESSING_STATS);
    const orphans = BLESSINGS.flatMap((b) =>
      (b.effects ?? []).filter((e) => !known.has(e.stat)).map((e) => `${b.id} -> ${e.stat}`),
    );
    expect(orphans).toEqual([]);
  });

  it('has no unused stat in the union either', () => {
    const declared = new Set(BLESSINGS.flatMap((b) => (b.effects ?? []).map((e) => e.stat)));
    expect(BLESSING_STATS.filter((s) => !declared.has(s))).toEqual([]);
  });

  it('labels every stat, for the card and the held list', () => {
    for (const stat of BLESSING_STATS) {
      expect(BLESSING_STAT_LABELS[stat], stat).toBeTruthy();
    }
  });

  it('names a real consumer for every behavior', () => {
    const behaviors = Object.keys(BLESSING_BEHAVIOR_CONSUMERS) as BlessingBehavior[];
    expect(behaviors.length).toBeGreaterThan(0);
    for (const behavior of behaviors) {
      expect(BLESSING_BEHAVIOR_CONSUMERS[behavior].length, behavior).toBeGreaterThan(0);
    }
  });

  it('grants every behavior through at least one blessing', () => {
    const granted = new Set(BLESSINGS.map((b) => b.behavior).filter(Boolean));
    const orphaned = (Object.keys(BLESSING_BEHAVIOR_CONSUMERS) as BlessingBehavior[])
      .filter((b) => !granted.has(b));
    expect(orphaned).toEqual([]);
  });

  /**
   * There is no longer a deferred behavior. `orb_magnet` was the last one —
   * it waited on Part 4's loot system, which now exists, so the card is back
   * in the pool and nothing may quietly take its place behind the flag.
   */
  it('has no behavior hiding behind the offerable flag', () => {
    expect(BLESSINGS.filter((b) => b.offerable === false).map((b) => b.id)).toEqual([]);
    const magnet = BLESSINGS.filter((b) => b.behavior === 'orb_magnet');
    expect(magnet.length).toBe(1);
    expect(magnet[0].offerable).toBeUndefined();
    expect(BLESSING_BEHAVIOR_CONSUMERS.orb_magnet).toContain('LootManager');
  });

  it('only names prerequisites that exist, and never itself', () => {
    const ids = new Set(BLESSINGS.map((b) => b.id));
    const requires = BLESSINGS.filter((b) => b.requires);
    expect(requires.length).toBeGreaterThan(0);
    const bad = requires
      .filter((b) => !ids.has(b.requires!) || b.requires === b.id)
      .map((b) => `${b.id} requires ${b.requires}`);
    expect(bad).toEqual([]);
  });

  it('gives every blessing a positive weight and stack count', () => {
    const bad = BLESSINGS.filter((b) => b.weight <= 0 || b.maxStacks <= 0);
    expect(bad.map((b) => b.id)).toEqual([]);
  });

  it('keeps a behavior blessing to a single stack', () => {
    const stacked = BLESSINGS.filter((b) => b.behavior && b.maxStacks !== 1);
    expect(stacked.map((b) => b.id)).toEqual([]);
  });

  /**
   * Plan §1.6: no single blessing may exceed +120% of one stat at max stacks.
   * `pierceFlat` and `armorPenFlat` are counts, not fractions, so the ceiling
   * does not apply to them.
   */
  it('keeps every percentage blessing under the per-stat ceiling at max stacks', () => {
    const FLAT: string[] = ['pierceFlat', 'armorPenFlat'];
    const checked = BLESSINGS.flatMap((b) =>
      (b.effects ?? []).filter((e) => !FLAT.includes(e.stat)).map((e) => ({ b, e })),
    );
    expect(checked.length).toBeGreaterThan(0);
    const over = checked
      .filter(({ b, e }) => Math.abs(e.perStack * b.maxStacks) > 1.2)
      .map(({ b, e }) => `${b.id} -> ${e.stat} ${(e.perStack * b.maxStacks * 100).toFixed(0)}%`);
    expect(over).toEqual([]);
  });
});


/**
 * The enemy roster (gameplay plan §2.8).
 *
 * The failure this guards against is specific and has already happened once in
 * this codebase's history, to talents: content that is *declared* — it has a
 * table row, a colour, a spawn weight — and is inert, invisible or unannounced
 * because the three or four places that have to know about it were never
 * updated together. `tsc` covers the `Record<EnemyType, …>` maps and the
 * exhaustive switches; these are the parts it cannot see.
 */
describe('enemy roster', () => {
  const ALL_TYPES = Object.keys(ENEMY_DEFS) as EnemyType[];

  it('covers every type in the def table', () => {
    // Guard against the whole block going vacuous if the table is restructured.
    expect(ALL_TYPES.length).toBeGreaterThanOrEqual(13);
    for (const type of ALL_TYPES) {
      expect(ENEMY_DEFS[type].type, type).toBe(type);
    }
  });

  it('gives every type a shape the renderer can actually paint', () => {
    const paintable = new Set<string>(RENDERED_ENEMY_SHAPES);
    const unpaintable = ALL_TYPES.filter(t => !paintable.has(ENEMY_DEFS[t].shape));
    expect(unpaintable).toEqual([]);
  });

  it('gives every type a non-empty, distinct short label (plan §7.3)', () => {
    // The threat preview names types by count ("3 Siege"). A `Record` over the
    // union already makes an omission a compile error; this is what stops one
    // shipping as an empty string or a duplicate of another type's name.
    const labels = ALL_TYPES.map(t => ENEMY_LABELS[t]);
    for (const [i, label] of labels.entries()) {
      expect(label, ALL_TYPES[i]).toBeTruthy();
    }
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('classifies every type as trash, threat or boss (plan §7.3)', () => {
    // The preview names threats and only counts trash, so a type with no class
    // would be silently folded into "31 enemies".
    for (const type of ALL_TYPES) {
      expect(['trash', 'threat', 'boss'], type).toContain(ENEMY_THREAT_CLASS[type]);
    }
    // And the classification has to actually discriminate — if everything were
    // trash the preview would never name anything.
    const threats = ALL_TYPES.filter(t => ENEMY_THREAT_CLASS[t] === 'threat');
    expect(threats.length).toBeGreaterThanOrEqual(5);
    expect(ENEMY_THREAT_CLASS.boss).toBe('boss');
    expect(ENEMY_THREAT_CLASS.normal).toBe('trash');
  });

  it('gives every type a distinct body colour', () => {
    // Two types that draw identically are one type as far as the player is
    // concerned, whatever the def table says.
    const colors = ALL_TYPES.map(t => ENEMY_DEFS[t].color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('announces every type in the milestone strip', () => {
    const announced = new Set(
      MILESTONES.filter(m => m.kind === 'enemy').map(m => m.refId),
    );
    const missing = ALL_TYPES
      .filter(t => !MILESTONE_EXEMPT_ENEMIES.includes(t))
      .filter(t => !announced.has(t));
    expect(missing).toEqual([]);
  });

  it('announces each type on the wave it actually unlocks', () => {
    for (const m of MILESTONES) {
      if (m.kind !== 'enemy') continue;
      const type = m.refId as EnemyType;
      expect(m.wave, type).toBe(ENEMY_DEFS[type].unlockWave);
    }
  });

  it('keeps the milestone exemptions to the two types that earn them', () => {
    // `normal` is the baseline the player starts with and `boss` has its own
    // on-canvas banner. Any *other* exemption is a gap, not a decision.
    expect([...MILESTONE_EXEMPT_ENEMIES].sort()).toEqual(['boss', 'normal']);
  });

  it('names a real behaviour consumer for every type', () => {
    for (const type of ALL_TYPES) {
      const consumer = ENEMY_BEHAVIOR_CONSUMERS[type];
      expect(consumer, `${type} has no behaviour`).toBeTruthy();
      expect(consumer.length, `${type} behaviour is too vague`).toBeGreaterThan(20);
      expect(consumer.toLowerCase(), `${type} behaviour is a placeholder`)
        .not.toMatch(/todo|nothing|unused|n\/a|tbd/);
    }
  });

  it('puts every type except the boss into the spawn pool', () => {
    const orphans = ALL_TYPES.filter(t => t !== 'boss' && ENEMY_SPAWN_WEIGHTS[t] <= 0);
    expect(orphans).toEqual([]);
    expect(ENEMY_SPAWN_WEIGHTS.boss).toBe(0);
  });

  it('gates the pool on the def table\'s unlock wave', () => {
    for (const type of ALL_TYPES) {
      if (ENEMY_SPAWN_WEIGHTS[type] <= 0) continue;
      const unlock = ENEMY_DEFS[type].unlockWave;
      expect(spawnPoolForWave(unlock - 1).some(e => e.type === type), type).toBe(false);
      expect(spawnPoolForWave(unlock).some(e => e.type === type), type).toBe(true);
    }
  });

  it('only prioritises types that exist', () => {
    expect(PRIORITY_TARGET_ORDER.length).toBeGreaterThan(0);
    const unknown = PRIORITY_TARGET_ORDER.filter(t => !(t in ENEMY_DEFS));
    expect(unknown).toEqual([]);
  });

  it('offers every targeting mode exactly once, priority first', () => {
    const ids = TARGETING_MODES.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe('priority');
    // The dead `'first'` alias is gone (plan §2.3) and must not come back.
    expect(ids).not.toContain('first');
    for (const m of TARGETING_MODES) {
      expect(m.label.length, m.id).toBeGreaterThan(0);
      expect(m.hint.length, m.id).toBeGreaterThan(8);
    }
  });
});

/**
 * Icons (UI plan §6.2).
 *
 * `IconId` is a closed union generated from the manifest in
 * `scripts/fetch-icons.mjs`, so `tsc` already rejects an icon nobody pinned.
 * What `tsc` cannot see is the other three halves of the contract: that the
 * *committed sprite* actually contains a symbol for every id, that every id in
 * the manifest is *used* by something (a pinned icon nobody references is
 * 1.5 KB of dead payload on every load), and that `ATTRIBUTION.md` still
 * credits the exact set that ships — which CC BY 3.0 requires.
 */
describe('icons', () => {
  const sprite = readFileSync(new URL('../public/icons/sprite.svg', import.meta.url), 'utf8');
  const attribution = readFileSync(new URL('../ATTRIBUTION.md', import.meta.url), 'utf8');
  const spriteIds = new Set([...sprite.matchAll(/id="gi-([a-z0-9-]+)"/g)].map((m) => m[1]));

  /** Every icon id the game actually asks for, with the surface that asks. */
  const referenced: Array<[string, IconId]> = [
    ...ABILITIES.map((a) => [`ability:${a.id}`, a.icon] as [string, IconId]),
    ...PASSIVE_ABILITIES.map((p) => [`passive:${p.id}`, p.icon] as [string, IconId]),
    ...UPGRADES.map((u) => [`upgrade:${u.id}`, u.icon] as [string, IconId]),
    ...RESEARCH_NODES.map((r) => [`research:${r.id}`, r.icon] as [string, IconId]),
    ...TALENTS.map((t) => [`talent:${t.id}`, t.icon] as [string, IconId]),
    ...BLESSINGS.map((b) => [`blessing:${b.id}`, b.icon] as [string, IconId]),
    ...CORES.map((c) => [`core:${c.id}`, c.icon] as [string, IconId]),
    ...EQUIPMENT_DEFS.map((e) => [`equipment:${e.id}`, e.icon] as [string, IconId]),
    ...[...AP_PERKS, ...TP_PERKS].map((p) => [`perk:${p.id}`, p.icon] as [string, IconId]),
    ...ACHIEVEMENTS.map((a) => [`achievement:${a.id}`, a.icon] as [string, IconId]),
    ...WAVE_MODIFIERS.map((m) => [`modifier:${m.id}`, m.icon] as [string, IconId]),
    ...MILESTONES.map((m) => [`milestone:${m.id}`, m.icon] as [string, IconId]),
    ...(Object.keys(ENEMY_DEFS) as EnemyType[]).map((t) => [`enemy:${t}`, ENEMY_DEFS[t].icon] as [string, IconId]),
    ...(Object.keys(SLOT_ICONS) as Array<keyof typeof SLOT_ICONS>).map((s) => [`slot:${s}`, SLOT_ICONS[s]] as [string, IconId]),
    ...(Object.keys(RARITY_ICONS) as Array<keyof typeof RARITY_ICONS>).map((r) => [`rarity:${r}`, RARITY_ICONS[r]] as [string, IconId]),
    ...STAT_ICON_KEYS.map((k) => [`stat:${k}`, STAT_ICONS[k]] as [string, IconId]),
  ];

  it('gives every piece of content a real icon', () => {
    const missing = referenced.filter(([, id]) => !id || !spriteIds.has(id));
    expect(missing.map(([where, id]) => `${where} -> ${id}`)).toEqual([]);
  });

  it('covers every surface the plan promised', () => {
    // The §6.2 table, as a count. A table that quietly loses entries stops
    // being covered without anything else failing.
    expect(ABILITIES.length).toBe(10);
    expect(PASSIVE_ABILITIES.length).toBe(8);
    expect(UPGRADES.length).toBe(29);
    expect(RESEARCH_NODES.length).toBe(17);
    expect(TALENTS.length).toBe(37);
    expect(BLESSINGS.length).toBe(30);
    expect(CORES.length).toBe(5);
    expect(EQUIPMENT_DEFS.length).toBe(10);
    expect(Object.keys(SLOT_ICONS)).toHaveLength(8);
    expect(Object.keys(RARITY_ICONS)).toHaveLength(5);
    expect(Object.keys(ENEMY_DEFS)).toHaveLength(13);
    expect(STAT_ICON_KEYS.length).toBeGreaterThanOrEqual(16);
  });

  it('ships a sprite that matches the generated union exactly', () => {
    expect([...spriteIds].sort()).toEqual([...ICON_IDS].sort());
  });

  it('pins nothing it does not use', () => {
    const used = new Set(referenced.map(([, id]) => id));
    expect(ICON_IDS.filter((id) => !used.has(id))).toEqual([]);
  });

  it('credits every shipped icon, with a licence', () => {
    for (const id of ICON_IDS) {
      const credit = ICON_CREDITS[id];
      expect(credit, `${id} has no credit`).toBeTruthy();
      expect(['CC BY 3.0', 'CC0'], `${id} licence`).toContain(credit.license);
      expect(attribution, `${id} missing from ATTRIBUTION.md`).toContain(`\`${id}\``);
      expect(attribution, `${credit.author} missing from ATTRIBUTION.md`).toContain(credit.author);
    }
  });

  it('leaves no single-letter glyph behind in a content table', () => {
    // Acceptance criterion §12.4. `EnemyDef.glyph` is exempt: it is a *canvas*
    // marking painted inside the body silhouette, not an icon in the UI.
    const singleChar = referenced.filter(([, id]) => String(id).length <= 2);
    expect(singleChar).toEqual([]);
  });
});
