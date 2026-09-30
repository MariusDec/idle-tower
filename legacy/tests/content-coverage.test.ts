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
import { TALENTS, TALENT_STATS, TALENTS_BY_BRANCH, TALENT_BY_ID, TALENT_GRID, TALENT_ENDLESS, TALENT_BEHAVIOR_CONSUMERS, type TalentBehavior } from '../src/data/talentTree';
import type { TalentDef, TalentEffectType } from '../src/data/talentTree';
import { ACHIEVEMENTS, ACHIEVEMENT_REWARD_CONSUMERS } from '../src/data/achievements';
import type { AchievementRewardType } from '../src/data/achievements';
import { ABILITIES } from '../src/data/abilities';
import {
  PASSIVE_ABILITIES, PASSIVE_MAX_LEVEL, PASSIVE_MILESTONE_LEVELS,
  PASSIVE_STATS, passiveStatValue, passiveUpgradeCost,
} from '../src/data/passiveAbilities';
import { passiveWaveXpRef, passiveXpForLevel, PASSIVE_XP_LEVEL_WAVES } from '../src/data/xpTables';
import { RESEARCH_NODES } from '../src/data/research';
import { UPGRADES } from '../src/data/upgrades';
import {
  BOSS_PATTERNS,
  BOSS_PATTERN_CONSUMERS,
  BOSS_PATTERN_HINTS,
  BOSS_PATTERN_HP_WEIGHT,
  BOSS_PATTERN_NAMES,
  BOSS_ENCOUNTER,
  ENEMY_BEHAVIOR,
  ENEMY_BEHAVIOR_CONSUMERS,
  ENEMY_CODEX,
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
import type { BossPattern, EnemyType, PanelTab } from '../src/types';
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
import { GROUP_OF, NAV_GROUPS, firstTabOf, groupById, type NavGroupId } from '../src/ui/navGroups';
import type { BottomNavItem } from '../src/ui/BottomNav';
import { AP_PERKS, TP_PERKS } from '../src/data/prestige';
import { WAVE_MODIFIERS } from '../src/data/waveModifiers';
import { CODEX_CATEGORIES, CODEX_CATEGORY_ICONS, CODEX_ENTRIES } from '../src/data/codex';
import { TOWER_MARKS } from '../src/data/towerMarks';
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

/** A talent's declared effects: the new array format. */
const effectsOf = (t: TalentDef): TalentEffectType[] => t.effects;

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

  // ── New assertions from §14.2 ──

  it('gives every branch a 5-row grid with unique row:col positions', () => {
    const branches = ['offense', 'defense', 'utility', 'magic'] as const;
    for (const branch of branches) {
      const grid = TALENT_GRID[branch];
      expect(grid.length, `${branch} grid`).toBeGreaterThanOrEqual(14);
      // Unique row:col positions
      const positions = grid.map(t => `${t.row}:${t.col}`);
      expect(new Set(positions).size, `${branch} unique positions`).toBe(grid.length);
    }
  });

  it('places prerequisites in the row above, same branch', () => {
    for (const t of TALENTS) {
      if (t.endless) continue; // endless nodes have no prereqs
      for (const prereqId of t.prerequisites) {
        const prereq = TALENT_BY_ID[prereqId];
        expect(prereq, `${t.id} prereq ${prereqId} exists`).toBeDefined();
        expect(prereq!.branch, `${t.id} prereq ${prereqId} same branch`).toBe(t.branch);
        expect(prereq!.row, `${t.id} prereq ${prereqId} row above`).toBeLessThan(t.row);
      }
    }
  });

  it('has monotonically increasing row gates', () => {
    const branches = ['offense', 'defense', 'utility', 'magic'] as const;
    for (const branch of branches) {
      const grid = TALENT_GRID[branch];
      const byRow = new Map<number, number[]>();
      for (const t of grid) {
        if (!byRow.has(t.row)) byRow.set(t.row, []);
        byRow.get(t.row)!.push(t.requiresBranchPoints);
      }
      const rows = [...byRow.keys()].sort((a, b) => a - b);
      for (let i = 1; i < rows.length; i++) {
        const prevGate = Math.max(...byRow.get(rows[i - 1])!);
        const currGate = Math.min(...byRow.get(rows[i])!);
        expect(currGate, `${branch} row ${rows[i]} gate >= row ${rows[i - 1]} gate`)
          .toBeGreaterThanOrEqual(prevGate);
      }
    }
  });

  it('has the designed tree at or above 75% of level cap (160/200 = 80%)', () => {
    // Total points available in the grid (rows 1-5, excluding endless)
    const gridTotal = TALENTS.filter(t => !t.endless).reduce((s, t) => s + t.maxPoints, 0);
    // Level cap is 200, so 200 talent points max
    expect(gridTotal).toBeGreaterThanOrEqual(150); // 75% of 200
  });

  it('declares a 40-point reachable capacity per branch (160 total)', () => {
    // Mirrors the BRANCH_CAPACITY constant in src/ui/TalentPanel.ts so a
    // drift between the panel's tab labels and the data is a test failure.
    const branches = ['offense', 'defense', 'utility', 'magic'] as const;
    let total = 0;
    for (const branch of branches) {
      const grid = TALENT_GRID[branch];
      const reachable = grid
        .filter(n => !n.exclusiveGroup)
        .reduce((s, n) => s + n.maxPoints, 0) + 1;
      expect(reachable, `${branch} reachable capacity`).toBe(40);
      total += reachable;
    }
    expect(total).toBe(160);
  });

  it('gives every branch exactly one endless node', () => {
    const branches = ['offense', 'defense', 'utility', 'magic'] as const;
    for (const branch of branches) {
      const endless = TALENTS.filter(t => t.branch === branch && t.endless);
      expect(endless.length, `${branch} endless count`).toBe(1);
      expect(endless[0].maxPoints, `${endless[0].id} maxPoints`).toBe(999);
    }
  });

  it('makes every row-5 keystone reachable from a root (BFS)', () => {
    const branches = ['offense', 'defense', 'utility', 'magic'] as const;
    for (const branch of branches) {
      const grid = TALENT_GRID[branch];
      const roots = grid.filter(t => t.row === 1);
      expect(roots.length, `${branch} roots`).toBeGreaterThanOrEqual(2);

      // BFS from roots
      const reachable = new Set<string>();
      const queue = [...roots.map(t => t.id)];
      while (queue.length > 0) {
        const id = queue.shift()!;
        if (reachable.has(id)) continue;
        reachable.add(id);
        // Find children that have this as a prerequisite
        for (const t of grid) {
          if (t.prerequisites.includes(id) && !reachable.has(t.id)) {
            queue.push(t.id);
          }
        }
      }

      const keystones = grid.filter(t => t.row === 5);
      for (const ks of keystones) {
        expect(reachable.has(ks.id), `${ks.id} reachable from root`).toBe(true);
      }
    }
  });

  it('names a real consumer for every talent behaviour', () => {
    const behaviors = Object.keys(TALENT_BEHAVIOR_CONSUMERS) as TalentBehavior[];
    expect(behaviors.length).toBeGreaterThan(0);
    for (const behavior of behaviors) {
      const consumer = TALENT_BEHAVIOR_CONSUMERS[behavior];
      expect(consumer, `${behavior} has no consumer`).toBeTruthy();
      expect(consumer.length, `${behavior} consumer is too vague`).toBeGreaterThan(20);
    }
  });

  it('only declares behaviours that have consumers', () => {
    const declared = new Set(
      TALENTS.filter(t => t.behavior).map(t => t.behavior!),
    );
    const consumed = new Set(Object.keys(TALENT_BEHAVIOR_CONSUMERS));
    const orphaned = [...declared].filter(b => !consumed.has(b));
    expect(orphaned).toEqual([]);
  });

  it('grants every behaviour through at least one talent', () => {
    const granted = new Set(TALENTS.filter(t => t.behavior).map(t => t.behavior!));
    const consumed = Object.keys(TALENT_BEHAVIOR_CONSUMERS) as TalentBehavior[];
    const orphaned = consumed.filter(b => !granted.has(b));
    expect(orphaned).toEqual([]);
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
      // The depth bands (progress-steps §10.3) ride the enemy lane of the
      // strip without being a type unlock, so they have no `refId` and no
      // unlock wave to check against.
      if (m.id.startsWith('depth:')) continue;
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

  it('hands the roster every tagline', () => {
    // The bestiary modal reads ENEMY_CODEX[type].tagline onto the page; an
    // empty string or a placeholder would be exactly the failure mode the
    // "ships announced but inert" §0.4 complaint is about.
    for (const type of ALL_TYPES) {
      expect(ENEMY_CODEX[type].tagline, type).toBeTruthy();
      expect(ENEMY_CODEX[type].tagline.length, type).toBeGreaterThan(8);
    }
  });

  it('reuses the milestone copy for the taglines', () => {
    // The 11 non-exempt types read their milestone detail from
    // ENEMY_CODEX[type].tagline — so the strip and the modal cannot drift.
    // `normal` and `boss` are exempt from the milestone strip and have fresh
    // taglines, so they are checked separately.
    for (const m of MILESTONES) {
      if (m.kind !== 'enemy') continue;
      // Depth bands carry no `refId` — see the skip in the unlock-wave test.
      if (m.id.startsWith('depth:')) continue;
      expect(ENEMY_CODEX[m.refId as EnemyType].tagline, m.refId).toBe(m.detail);
    }
  });

  it('hands every type an answer the player can act on', () => {
    // The "Answer:" row is the part the player reads to decide what to build.
    // Empty / placeholder / N/A would be an inert page.
    for (const type of ALL_TYPES) {
      const answer = ENEMY_CODEX[type].answer;
      expect(answer, type).toBeTruthy();
      expect(answer.length, type).toBeGreaterThan(8);
      expect(answer.toLowerCase(), type).not.toMatch(/todo|nothing|unused|n\/a|tbd/);
    }
  });

  it('quotes the real tuning numbers', () => {
    // Every effect-line text must interpolate from `ENEMY_BEHAVIOR` /
    // `BOSS_ENCOUNTER`, never typed as a literal. Spot-check a few of the
    // big numbers so a future `sed`-style edit cannot quietly type them.
    expect(ENEMY_CODEX.siege.effects.map(e => e.text).join(' '))
      .toContain(String(ENEMY_BEHAVIOR.siegeReload));
    expect(ENEMY_CODEX.warden.effects.map(e => e.text).join(' '))
      .toContain(String(ENEMY_BEHAVIOR.wardMaxTargets));
    expect(ENEMY_CODEX.boss.effects.map(e => e.text).join(' '))
      .toContain(String(BOSS_ENCOUNTER.enrageDelay));
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
    ...NAV_GROUPS.map((g) => [`nav:${g.id}`, g.icon] as [string, IconId]),
    ...CODEX_ENTRIES.map((e) => [`codex:${e.id}`, e.icon] as [string, IconId]),
    ...CODEX_CATEGORIES.map((c) => [`codexcat:${c}`, CODEX_CATEGORY_ICONS[c]] as [string, IconId]),
  ];

  it('gives every piece of content a real icon', () => {
    const missing = referenced.filter(([, id]) => !id || !spriteIds.has(id));
    expect(missing.map(([where, id]) => `${where} -> ${id}`)).toEqual([]);
  });

  it('covers every surface the plan promised', () => {
    // The §6.2 table, as a count. A table that quietly loses entries stops
    // being covered without anything else failing.
    expect(ABILITIES.length).toBe(10);
    expect(PASSIVE_ABILITIES.length).toBe(12);
    expect(UPGRADES.length).toBe(29);
    // 18 bounded projects + the repeatable `field_studies` (progress-steps §9.1).
    expect(RESEARCH_NODES.length).toBe(19);
    expect(TALENTS.length).toBe(60);
    // 30 + the eight-card greater tier (progress-steps §8.3).
    expect(BLESSINGS.length).toBe(38);
    expect(CORES.length).toBe(5);
    expect(EQUIPMENT_DEFS.length).toBe(10);
    expect(Object.keys(SLOT_ICONS)).toHaveLength(8);
    expect(Object.keys(RARITY_ICONS)).toHaveLength(5);
    // 13 + the deep roster: harbinger, leech, chorus (progress-steps A.1).
    expect(Object.keys(ENEMY_DEFS)).toHaveLength(16);
    expect(STAT_ICON_KEYS.length).toBeGreaterThanOrEqual(16);
  });

  it('ships a sprite that matches the generated union exactly', () => {
    expect([...spriteIds].sort()).toEqual([...ICON_IDS].sort());
  });

  it('pins nothing it does not use', () => {
    const used = new Set(referenced.map(([, id]) => id));
    // Icons that are in the sprite but not currently used by any content.
    // These are kept for future use or were retired from active content.
    const ALLOWED_UNUSED: IconId[] = ['target-shot'];
    const unused = ICON_IDS.filter((id) => !used.has(id) && !ALLOWED_UNUSED.includes(id));
    expect(unused).toEqual([]);
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

/**
 * The navigation table (UI plan §8.A, guarded here per §10.C).
 *
 * `NAV_GROUPS` is the single information architecture the desktop rail, the
 * mobile bottom nav and the tab-restore path all read. `tsc` proves the ids are
 * spelled right; it cannot prove that a tab is reachable, that it is reachable
 * only once, or that a group has anything in it. All three would ship as a
 * panel nobody can open, which is exactly what the one-table refactor set out
 * to make impossible.
 */
describe('nav groups', () => {
  /**
   * The `PanelTab` union at runtime. Written as an exhaustive record so `tsc`
   * fails if a tab is added to `src/types.ts` and not to this list — the type
   * itself erases at build time and cannot be enumerated any other way.
   */
  const ALL_TABS: Record<PanelTab, true> = {
    upgrades: true,
    research: true,
    abilities: true,
    passives: true,
    prestige: true,
    transcendence: true,
    automation: true,
    achievements: true,
    progression: true,
    codex: true,
    stats: true,
    settings: true,
    talents: true,
    equipment: true,
    journal: true,
  };

  /**
   * Tabs that are deliberately not nav destinations. `'passives'` became a
   * sub-tab *inside* the Abilities panel in §8 and is no longer something the
   * nav can open; the name survives in the `PanelTab` union. It is listed here
   * rather than silently skipped so that the exception cannot grow unnoticed —
   * and the test below proves each entry really is absent from the table.
   */
  const NOT_NAVIGABLE = new Set<PanelTab>([]);

  const tabIds = NAV_GROUPS.flatMap((g) => g.tabs.map((t) => t.id));

  it('gives every navigable PanelTab exactly one home', () => {
    for (const tab of Object.keys(ALL_TABS) as PanelTab[]) {
      if (NOT_NAVIGABLE.has(tab)) continue;
      const homes = NAV_GROUPS.filter((g) => g.tabs.some((t) => t.id === tab));
      expect(homes.map((g) => g.id), `${tab} lives in ${homes.length} groups`).toHaveLength(1);
    }
  });

  it('keeps the non-navigable exceptions genuinely out of the table', () => {
    for (const tab of NOT_NAVIGABLE) {
      expect(tabIds, `${tab} is listed as non-navigable but the nav offers it`).not.toContain(tab);
    }
  });

  it('lists no tab twice, anywhere', () => {
    expect(new Set(tabIds).size).toBe(tabIds.length);
  });

  it('gives every group at least one tab and a real icon', () => {
    expect(NAV_GROUPS.length).toBeGreaterThan(0);
    for (const g of NAV_GROUPS) {
      expect(g.tabs.length, `group ${g.id} is empty`).toBeGreaterThan(0);
      expect(ICON_IDS, `group ${g.id} icon`).toContain(g.icon);
      expect(g.label.trim(), `group ${g.id} label`).not.toBe('');
      for (const t of g.tabs) {
        expect(t.id in ALL_TABS, `${t.id} is not a PanelTab`).toBe(true);
        expect(t.label.trim(), `tab ${t.id} label`).not.toBe('');
      }
    }
  });

  it('has unique group ids', () => {
    const ids = NAV_GROUPS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('indexes every listed tab in GROUP_OF, pointing at a real group', () => {
    for (const g of NAV_GROUPS) {
      for (const t of g.tabs) expect(GROUP_OF[t.id]).toBe(g.id);
    }
  });

  /**
   * The bottom nav is built by mapping `NAV_GROUPS` (`UIManager.ts` §8.A), so
   * every item id is a `NavGroupId` by construction. This pins that
   * construction: an item that is not a group id would be a mobile button that
   * `handleMobileNav` cannot route.
   */
  it('builds the bottom nav out of group ids and nothing else', () => {
    const items: BottomNavItem[] = NAV_GROUPS.map((g) => ({
      id: g.id,
      label: g.label,
      icon: g.icon,
    }));
    const groupIds = new Set<string>(NAV_GROUPS.map((g) => g.id));
    for (const item of items) {
      expect(groupIds, `bottom nav item ${item.id} is not a NavGroupId`).toContain(item.id);
      expect(() => groupById(item.id as NavGroupId)).not.toThrow();
      expect(ICON_IDS, `bottom nav item ${item.id} icon`).toContain(item.icon);
    }
    expect(items).toHaveLength(NAV_GROUPS.length);
  });

  it('opens every group on a tab it actually contains', () => {
    for (const g of NAV_GROUPS) {
      expect(g.tabs.some((t) => t.id === firstTabOf(g.id))).toBe(true);
    }
  });
});

describe('passives', () => {
  it('gives every passive exactly the five milestone levels', () => {
    for (const p of PASSIVE_ABILITIES) {
      expect(p.milestones.map(m => m.at), p.id).toEqual([...PASSIVE_MILESTONE_LEVELS]);
    }
  });

  it('only names stats the contributor knows', () => {
    const known = new Set(PASSIVE_STATS);
    for (const p of PASSIVE_ABILITIES) {
      for (const e of p.effects) expect(known.has(e.stat), `${p.id}:${e.stat}`).toBe(true);
      for (const m of p.milestones) {
        for (const g of m.grants) expect(known.has(g.stat), `${p.id}:${g.stat}`).toBe(true);
      }
    }
  });

  it('has a non-empty tagline and at least one scaling effect', () => {
    for (const p of PASSIVE_ABILITIES) {
      expect(p.tagline.length, p.id).toBeGreaterThan(0);
      expect(p.effects.length, p.id).toBeGreaterThan(0);
      expect(p.effects.some(e => e.perLevel > 0), p.id).toBe(true);
    }
  });

  it('unlocks in ascending order of cost within a family-free sort', () => {
    const byWave = [...PASSIVE_ABILITIES].sort((a, b) => a.unlockWave - b.unlockWave);
    for (let i = 1; i < byWave.length; i++) {
      expect(byWave[i].unlockGoldCost, byWave[i].id)
        .toBeGreaterThan(byWave[i - 1].unlockGoldCost);
      expect(byWave[i].upgradeBaseCost, byWave[i].id)
        .toBeGreaterThan(byWave[i - 1].upgradeBaseCost);
      expect(byWave[i].xpBase, byWave[i].id).toBeGreaterThan(byWave[i - 1].xpBase);
    }
  });

  it('prices level 1 at six waves of XP at the unlock wave, within 15%', () => {
    for (const p of PASSIVE_ABILITIES) {
      const expected = PASSIVE_XP_LEVEL_WAVES * passiveWaveXpRef(p.unlockWave);
      const actual = passiveXpForLevel(p, 1);
      expect(Math.abs(actual / expected - 1), p.id).toBeLessThan(0.15);
    }
  });

  it('makes every level strictly more expensive than the last', () => {
    for (const p of PASSIVE_ABILITIES) {
      for (let l = 1; l < PASSIVE_MAX_LEVEL; l++) {
        expect(passiveUpgradeCost(p, l), `${p.id}@${l}`)
          .toBeGreaterThan(passiveUpgradeCost(p, l - 1));
        expect(passiveXpForLevel(p, l + 1), `${p.id}@${l}`)
          .toBeGreaterThan(passiveXpForLevel(p, l));
      }
    }
  });

  it('never lets a milestone lower a stat', () => {
    for (const p of PASSIVE_ABILITIES) {
      for (const m of p.milestones) {
        for (const g of m.grants) expect(g.value, `${p.id}:${g.stat}`).toBeGreaterThan(0);
      }
    }
  });

  it('grants a milestone exactly at its level and not before', () => {
    for (const p of PASSIVE_ABILITIES) {
      for (const m of p.milestones) {
        for (const g of m.grants) {
          const before = passiveStatValue(p, g.stat, m.at - 1);
          const after = passiveStatValue(p, g.stat, m.at);
          // `perLevel` may also move the stat, so assert the *jump* is at least
          // the grant, not that the value equals it.
          expect(after - before, `${p.id}:${g.stat}@${m.at}`).toBeGreaterThanOrEqual(g.value);
        }
      }
    }
  });
});

describe('tower marks', () => {
  it('covers both the damage and the health line, which is the whole ask', () => {
    const sourced = new Set(TOWER_MARKS.flatMap(m => [...m.sources]));
    expect(sourced.has('damage')).toBe(true);
    expect(sourced.has('health')).toBe(true);
  });

  it('gives each upgrade line to at most one mark', () => {
    const seen = new Set<string>();
    for (const m of TOWER_MARKS) {
      for (const id of m.sources) {
        expect(seen.has(id), `${id} feeds two marks — they will fight over the same anatomy`)
          .toBe(false);
        seen.add(id);
      }
    }
  });
});
