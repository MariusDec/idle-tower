/**
 * Golden stat tests (plan §7.2).
 *
 * "Given a fixed `StatContext`, assert the resolved damage/gold/fire-rate.
 * These would have caught every bug in Part 1." That is exactly what this file
 * does: each case builds a literal context, resolves it, and pins the number.
 *
 * The reason this can be written at all is Part 6 — before the pipeline there
 * was no single function to assert against, only 300 lines of `TowerState`
 * mutation spread across eight systems.
 */

import { describe, expect, it } from 'vitest';
import { TOWER_BASE } from '../src/data/tower';
import { UPGRADES } from '../src/data/upgrades';
import { computeUpgradeValue } from '../src/types';
import {
  emptyStatContext,
  goldSourceEntries,
  resolveStats,
  STAT_BASES,
  STAT_KEYS,
  type StatContext,
} from '../src/stats';

const ctx = (patch: Partial<StatContext> = {}): StatContext => ({ ...emptyStatContext(), ...patch });

const upgradeValue = (id: string, level: number) => {
  const def = UPGRADES.find((u) => u.id === id);
  if (!def) throw new Error(`no upgrade ${id}`);
  return computeUpgradeValue(def, level);
};

describe('baseline', () => {
  it('resolves the bare tower to its base stats', () => {
    const { stats } = resolveStats(ctx());
    // Damage floors at 1 — the base is 0 because the damage upgrade starts at
    // level 1, and a zero-damage tower could never kill anything.
    expect(stats.baseDamage).toBe(1);
    expect(stats.fireRate).toBe(TOWER_BASE.fireRate);
    expect(stats.range).toBe(TOWER_BASE.range);
    expect(stats.critChance).toBe(TOWER_BASE.critChance);
    expect(stats.maxHp).toBe(TOWER_BASE.maxHp);
    expect(stats.goldMultiplier).toBe(1);
  });

  it('produces a finite value for every key', () => {
    const { stats } = resolveStats(ctx());
    for (const key of STAT_KEYS) {
      expect(Number.isFinite(stats[key]), `${key} is not finite`).toBe(true);
    }
  });

  it('has a base for every key and a key for every base', () => {
    expect(new Set(STAT_KEYS).size).toBe(STAT_KEYS.length);
    expect(Object.keys(STAT_BASES).sort()).toEqual([...STAT_KEYS].sort());
  });
});

describe('damage composition', () => {
  it('adds upgrade levels before applying any multiplier', () => {
    const { stats } = resolveStats(ctx({ upgrades: { damage: 10 } }));
    expect(stats.baseDamage).toBeCloseTo(TOWER_BASE.baseDamage + upgradeValue('damage', 10), 6);
  });

  /**
   * §1.2's shape: six systems each wrote damage with `=`, so only the last
   * applicable one survived. Every source below must be present in the answer.
   */
  it('composes prestige, achievements, talents, passives and equipment together', () => {
    const base = TOWER_BASE.baseDamage + upgradeValue('damage', 10);
    const { stats } = resolveStats(ctx({
      upgrades: { damage: 10 },
      prestige: { ...emptyStatContext().prestige, lifetimeDamage: 0.5, apDamage: 0.5, tpDamage: 2 },
      achievements: { damage_mult: 0.1, all_damage: 0.1 },
      talents: { base_damage_pct: 0.2 },
      passives: { damage_pct: 25 },
      equipment: { damage_pct: 30 },
    }));
    // (base + upgrades) x AP x TP x achievements x talent x passive x equipment
    const expected = base * 2 * 2 * 1.2 * 1.2 * 1.25 * 1.3;
    expect(stats.baseDamage).toBeCloseTo(expected, 6);
  });

  it('sums achievement damage types into one factor rather than compounding', () => {
    const base = TOWER_BASE.baseDamage + upgradeValue('damage', 10);
    const both = resolveStats(ctx({
      upgrades: { damage: 10 },
      achievements: { damage_mult: 0.1, all_damage: 0.1 },
    }));
    expect(both.stats.baseDamage).toBeCloseTo(base * 1.2, 6);
    expect(both.stats.baseDamage).not.toBeCloseTo(base * 1.1 * 1.1, 6);
  });

  it('applies the wave mutator damage penalty on top of everything', () => {
    const base = TOWER_BASE.baseDamage + upgradeValue('damage', 10);
    const { stats } = resolveStats(ctx({
      upgrades: { damage: 10 },
      talents: { base_damage_pct: 1 },
      waveModifier: { goldAdditive: 0, playerDamageMult: 0.5 },
    }));
    expect(stats.baseDamage).toBeCloseTo(base * 2 * 0.5, 6);
  });

  it('never drops below 1 damage', () => {
    const { stats } = resolveStats(ctx({
      waveModifier: { goldAdditive: 0, playerDamageMult: 0.000001 },
    }));
    expect(stats.baseDamage).toBe(1);
  });

  it('is independent of the order sources are listed in', () => {
    const a = resolveStats(ctx({
      talents: { base_damage_pct: 0.2, all_damage_pct: 0.3 },
      passives: { damage_pct: 10 },
      equipment: { all_damage_pct: 40 },
    }));
    const b = resolveStats(ctx({
      equipment: { all_damage_pct: 40 },
      passives: { damage_pct: 10 },
      talents: { all_damage_pct: 0.3, base_damage_pct: 0.2 },
    }));
    expect(a.stats.baseDamage).toBeCloseTo(b.stats.baseDamage, 9);
  });
});

describe('fire rate', () => {
  /**
   * §1.3: the Berserk buff was written by `AbilityManager` and overwritten one
   * line later, every frame, by the manual-aim boost. As buff entries they
   * multiply.
   */
  it('multiplies every buff source instead of letting the last one win', () => {
    const { stats } = resolveStats(ctx({
      buffs: [
        { id: 'ability', stat: 'fireRate', kind: 'mult', value: 3, label: 'Berserk', remaining: null },
        { id: 'aim', stat: 'fireRate', kind: 'mult', value: 1.3, label: 'Aim', remaining: null },
        { id: 'quick', stat: 'fireRate', kind: 'mult', value: 2, label: 'Quick shot', remaining: 1 },
      ],
    }));
    expect(stats.fireRate).toBeCloseTo(TOWER_BASE.fireRate * 3 * 1.3 * 2, 6);
  });

  it('composes upgrades additively with prestige and gear multiplicatively', () => {
    const { stats } = resolveStats(ctx({
      upgrades: { fireRate: 5 },
      prestige: { ...emptyStatContext().prestige, tpFireRate: 1.5 },
      achievements: { fire_rate_mult: 0.2 },
      talents: { fire_rate_pct: 0.1 },
      equipment: { fire_rate_pct: 25 },
    }));
    const base = TOWER_BASE.fireRate + upgradeValue('fireRate', 5);
    expect(stats.fireRate).toBeCloseTo(base * 1.5 * 1.2 * 1.1 * 1.25, 6);
  });
});

describe('gold multiplier', () => {
  /**
   * §1.1: the single biggest bug in the game. Every additive source except the
   * raw `goldMulti` upgrade was discarded 60 times a second.
   */
  it('keeps every additive source and scales them by research and transcendence', () => {
    const c = ctx({
      wave: 11,
      upgrades: { goldMulti: 4 },
      evolutions: { wave_gold_scaling: 0.05 },
      prestige: { ...emptyStatContext().prestige, lifetimeGold: 1, apGold: 0.5, tpResource: 1.25 },
      research: { ...emptyStatContext().research, goldMultiplicative: 1.5 },
      waveModifier: { goldAdditive: 2, playerDamageMult: 1 },
    });
    const additive = upgradeValue('goldMulti', 4) + 0.05 * 10 + 1 + 0.5 + 2;
    expect(resolveStats(c).stats.goldMultiplier).toBeCloseTo(1 + additive * 1.5 * 1.25, 6);
  });

  it('multiplies achievements, talents, passives and equipment on top', () => {
    const c = ctx({
      achievements: { gold_mult: 0.1 },
      talents: { gold_mult_pct: 0.2 },
      passives: { gold_mult_pct: 30 },
      equipment: { gold_mult_pct: 40 },
    });
    expect(resolveStats(c).stats.goldMultiplier).toBeCloseTo(1 * 1.1 * 1.2 * 1.3 * 1.4, 6);
  });

  it('routes the Gold Rush buff through the same multiplier', () => {
    const c = ctx({
      buffs: [{ id: 'gold', stat: 'goldMultiplier', kind: 'mult', value: 3, label: 'Gold Rush', remaining: null }],
      talents: { gold_mult_pct: 0.2 },
    });
    expect(resolveStats(c).stats.goldMultiplier).toBeCloseTo(1.2 * 3, 6);
  });

  it('reconstructs the applied multiplier from its breakdown', () => {
    const c = ctx({
      wave: 6,
      upgrades: { goldMulti: 3 },
      evolutions: { wave_gold_scaling: 0.05 },
      prestige: { ...emptyStatContext().prestige, lifetimeGold: 0.8, tpResource: 1.25 },
      research: { ...emptyStatContext().research, goldMultiplicative: 1.5 },
      achievements: { gold_mult: 0.1 },
      talents: { gold_mult_pct: 0.2 },
      passives: { gold_mult_pct: 30 },
      equipment: { gold_mult_pct: 40 },
    });
    const { stats, breakdown } = resolveStats(c, { breakdown: true });
    const parts = goldSourceEntries(breakdown);
    const rebuilt = parts.reduce(
      (acc, p) => (p.kind === 'multiplicative' ? acc * p.factor : acc + p.additive),
      1,
    );
    expect(rebuilt).toBeCloseTo(stats.goldMultiplier, 6);
  });

  it('collects no breakdown unless asked', () => {
    const c = ctx({ upgrades: { goldMulti: 2 } });
    expect(Object.keys(resolveStats(c).breakdown)).toEqual([]);
    expect(Object.keys(resolveStats(c, { breakdown: true }).breakdown).length).toBeGreaterThan(0);
  });
});

describe('resources', () => {
  /** §1.7: the Mana Spring passive used to reset maxMana to 100 flat. */
  it('keeps the max-mana upgrade when a mana passive is unlocked', () => {
    const c = ctx({
      upgrades: { maxMana: 8 },
      talents: { max_mana_flat: 30 },
      passives: { mana_regen_pct: 50 },
    });
    const { stats } = resolveStats(c);
    expect(stats.maxMana).toBeCloseTo(100 + upgradeValue('maxMana', 8) + 30, 6);
    expect(stats.manaRegen).toBeCloseTo(STAT_BASES.manaRegen * 1.5, 6);
  });

  it('composes mana regen across research, transcendence, talents and passives', () => {
    const c = ctx({
      upgrades: { manaRegen: 4 },
      research: { ...emptyStatContext().research, manaRegenMultiplicative: 1.5 },
      prestige: { ...emptyStatContext().prestige, tpManaRegen: 1.25 },
      talents: { mana_regen_pct: 0.1 },
      passives: { mana_regen_pct: 20 },
      equipment: { mana_regen_pct: 30 },
    });
    const base = STAT_BASES.manaRegen + upgradeValue('manaRegen', 4);
    expect(resolveStats(c).stats.manaRegen).toBeCloseTo(base * 1.5 * 1.25 * 1.1 * 1.2 * 1.3, 6);
  });
});

describe('health regen', () => {
  /**
   * §1.8: Vampiric Aura added its regen into `tower.healthRegen` while the
   * recompute reset that field from scratch, so any purchase during the buff
   * subtracted the bonus out permanently.
   */
  it('keeps a regen buff across a recompute that also has upgrades and talents', () => {
    const c = ctx({
      upgrades: { healthRegen: 5 },
      talents: { health_regen_pct: 0.15 },
      buffs: [{ id: 'vamp', stat: 'healthRegen', kind: 'add', value: 0.01, label: 'Vampiric', remaining: null }],
    });
    const expected = (upgradeValue('healthRegen', 5) + 0.01) * 1.15;
    expect(resolveStats(c).stats.healthRegen).toBeCloseTo(expected, 6);
  });
});

describe('clamped stats', () => {
  it('caps crit chance at 1 without letting an intermediate clamp change the result', () => {
    const c = ctx({ upgrades: { critChance: 60 }, talents: { crit_chance_pct: 0.9 }, equipment: { crit_chance_pct: 100 } });
    expect(resolveStats(c).stats.critChance).toBe(1);
  });

  it('caps dodge and mana shield at their design ceilings', () => {
    const c = ctx({ talents: { dodge_chance: 5, mana_shield_pct: 500 } });
    const { stats } = resolveStats(c);
    expect(stats.dodgeChance).toBe(0.75);
    expect(stats.manaShieldFraction).toBe(0.9);
  });

  it('floors the shield recharge and drops charges with no shield', () => {
    const recharge = upgradeValue('defenseShield', 22);
    const withShield = resolveStats(ctx({
      upgrades: { defenseShield: 22 },
      evolutions: { shield_fast_recharge: 0.9 },
      talents: { shield_charges: 2 },
    })).stats;
    expect(withShield.shieldRechargeTime).toBeCloseTo(Math.max(3, recharge * 0.1), 6);
    expect(withShield.shieldMaxCharges).toBe(4);

    // A deeper reduction hits the 3 s floor rather than making the shield free.
    const floored = resolveStats(ctx({
      upgrades: { defenseShield: 22 },
      evolutions: { shield_fast_recharge: 0.99 },
    })).stats;
    expect(floored.shieldRechargeTime).toBe(3);

    const withoutShield = resolveStats(ctx({ talents: { shield_charges: 2 } })).stats;
    expect(withoutShield.shieldMaxCharges).toBe(0);
  });

  it('keeps the ability cost multiplier inside its usable band', () => {
    const c = ctx({
      research: { ...emptyStatContext().research, abilityCostReduction: -0.9 },
      prestige: { ...emptyStatContext().prestige, abilityManaCostReduction: -0.4 },
      talents: { mana_cost_reduction: 0.5 },
    });
    expect(resolveStats(c).stats.abilityCostMultiplier).toBe(0.1);
  });
});

describe('once-dead content now reaches a stat', () => {
  /**
   * §1.4/§1.5: twenty talents and nine reward types cost points and changed no
   * number. Each of these asserts the wiring, not the tuning.
   */
  it('routes every previously-inert talent stat to a resolved key', () => {
    const cases: [Partial<StatContext>['talents'], (s: Record<string, number>) => number, number][] = [
      [{ armor_penetration_pct: 0.15 }, (s) => s.armorPen, 0.15],
      [{ execution_damage_pct: 0.24 }, (s) => s.talentExecuteBonus, 0.24],
      [{ extra_projectile_chance: 0.09 }, (s) => s.extraProjectileChance, 0.09],
      [{ dodge_chance: 0.1 }, (s) => s.dodgeChance, 0.1],
      [{ wall_regen_pct: 0.3 }, (s) => s.wallRegen, 0.3],
      [{ magic_proc_chance: 0.15 }, (s) => s.magicProcChance, 0.15],
      [{ chain_bounce_count: 3 }, (s) => s.chainBounceBonus, 3],
      [{ slow_effect_pct: 0.15 }, (s) => s.slowStrengthBonus, 0.15],
      [{ meteor_damage_pct: 0.24 }, (s) => s.meteorDamageBonus, 0.24],
      [{ buff_duration_pct: 0.24 }, (s) => s.buffDurationBonus, 0.24],
      [{ double_gold_chance: 0.12 }, (s) => s.doubleGoldChance, 0.12],
      [{ equipment_find_chance: 0.15 }, (s) => s.equipmentFindChance, 0.15],
      [{ auto_buy_speed_pct: 0.15 }, (s) => s.autoBuyIntervalReduction, 0.15],
      [{ upgrade_cost_reduction: 0.09 }, (s) => s.upgradeCostDiscount, -0.09],
      [{ head_start_waves: 6 }, (s) => s.headStartWaves, 6],
    ];
    for (const [talents, read, expected] of cases) {
      const { stats } = resolveStats(ctx({ talents }));
      expect(read(stats), `talent ${JSON.stringify(talents)}`).toBeCloseTo(expected, 6);
    }
  });

  it('applies the achievement cost reduction and cooldown reward', () => {
    const { stats } = resolveStats(ctx({
      achievements: { upgrade_cost_reduction: 0.05, ability_cdr: 0.2 },
    }));
    expect(stats.upgradeCostDiscount).toBeCloseTo(-0.05, 6);
    expect(stats.abilityCooldownMultiplier).toBeCloseTo(0.8, 6);
  });

  it('stacks the upgrade, achievement and talent cost discounts', () => {
    const { stats } = resolveStats(ctx({
      upgrades: { upgradeDiscount: 5 },
      achievements: { upgrade_cost_reduction: 0.05 },
      talents: { upgrade_cost_reduction: 0.09 },
    }));
    expect(stats.upgradeCostDiscount).toBeCloseTo(upgradeValue('upgradeDiscount', 5) - 0.05 - 0.09, 6);
  });
});

describe('evolutions', () => {
  it('applies the HP-threshold damage bonus only above the threshold', () => {
    const base = TOWER_BASE.baseDamage + upgradeValue('damage', 10);
    const at = (hpFraction: number) => resolveStats(ctx({
      hpFraction,
      upgrades: { damage: 10 },
      evolutions: { hp_threshold_damage: 0.5 },
    })).stats.baseDamage;
    expect(at(0.9)).toBeCloseTo(base * 1.5, 6);
    expect(at(0.5)).toBeCloseTo(base, 6);
  });

  it("scales Dragon's Hoard with waves survived this run", () => {
    const w1 = resolveStats(ctx({ wave: 1, evolutions: { wave_gold_scaling: 0.05 } }));
    const w21 = resolveStats(ctx({ wave: 21, evolutions: { wave_gold_scaling: 0.05 } }));

    expect(w1.stats.goldMultiplier).toBeCloseTo(1, 6);
    expect(w21.stats.goldMultiplier).toBeCloseTo(1 + 0.05 * 20, 6);
  });

  it('adds evolution and talent armor penetration together', () => {
    const { stats } = resolveStats(ctx({
      evolutions: { armor_pen: 0.2 },
      talents: { armor_penetration_pct: 0.15 },
    }));
    expect(stats.armorPen).toBeCloseTo(0.35, 6);
  });
});

describe('known-dead content', () => {
  /**
   * `knockback_pct` is the mirror of §1.5's unread rewards: gear can roll it,
   * the pipeline consumes it, and it still resolves to nothing — because
   * `knockbackForce` has no additive source anywhere, so a multiplier has zero
   * to multiply. Giving the tower base knockback is a balance decision, not a
   * wiring one, so it is pinned here rather than invented.
   */
  it('still resolves knockback to zero however much gear multiplies it', () => {
    const { stats } = resolveStats(ctx({ equipment: { knockback_pct: 500 } }));
    expect(stats.knockbackForce).toBe(0);
  });
});
