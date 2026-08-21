/**
 * Tower cores (gameplay plan §6.4).
 *
 * The five things §6.4 asks to be pinned are the five things that would
 * otherwise be provable only by playing: that each stat block *resolves* (a
 * core with no consumer is the twenty-inert-talents bug again), that each shot
 * behavior actually fires, that the unlock is paid for, that the selection
 * survives a reload, and that `corePreference` biases the draft without ever
 * closing a card off.
 */

import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/game/EventBus';
import { Tower } from '../src/systems/Tower';
import { EnemyManager } from '../src/systems/EnemyManager';
import { ResourceManager } from '../src/systems/ResourceManager';
import { ProjectileManager } from '../src/systems/ProjectileManager';
import { CoreManager } from '../src/systems/CoreManager';
import { PrestigeManager } from '../src/systems/PrestigeManager';
import { BlessingManager } from '../src/systems/BlessingManager';
import { AbilityManager } from '../src/systems/AbilityManager';
import { BuffRegistry } from '../src/stats/BuffRegistry';
import { SaveManager } from '../src/systems/SaveManager';
import { resolveStats, emptyStatContext, type StatContext } from '../src/stats';
import { TOWER_BASE } from '../src/data/tower';
import {
  CORES,
  CORE_BY_ID,
  CORE_BEHAVIOR_CONSUMERS,
  CORE_IDS,
  CORE_TUNING,
  DEFAULT_CORE,
  describeCoreStats,
  isCoreId,
  type CoreBehavior,
  type CoreId,
} from '../src/data/cores';
import { BLESSINGS, CORE_PREFERENCE_WEIGHT } from '../src/data/blessings';
import { ABILITY_BY_ID } from '../src/data/abilities';
import type {
  AbilityState,
  GameStats,
  GameState,
  PrestigeState,
  ResourceState,
  TowerState,
} from '../src/types';

const ctx = (patch: Partial<StatContext> = {}): StatContext => ({
  ...emptyStatContext(),
  ...patch,
});

function combatHarness() {
  const bus = new EventBus();
  const resources: ResourceState = {
    gold: 0, lifetimeGold: 0, mana: 100, maxMana: 100, manaRegen: 0,
    ascensionPoints: 0, lifetimeAP: 0, apThisTranscendence: 0, transcendencePoints: 0,
  } as unknown as ResourceState;
  const stats = { goldEarned: 0, enemiesKilled: 0 } as unknown as GameStats;
  const resourceMgr = new ResourceManager(resources, stats, bus);
  const enemies = new EnemyManager(bus, resourceMgr);
  const towerState = {
    x: 100, y: 300, hp: 100, maxHp: 100, baseDamage: 100, fireRate: 1, range: 2000,
    critChance: 0, critMultiplier: 1, healthRegen: 0, damageType: 'physical',
    knockbackForce: 0,
  } as unknown as TowerState;
  const tower = new Tower(towerState);
  const projectiles = new ProjectileManager(bus, tower, enemies);
  projectiles.setBounds(1280, 720);
  const cores = new CoreManager(bus);
  projectiles.setCore(cores);
  return { bus, enemies, tower, towerState, projectiles, cores, resourceMgr, resources };
}

/** A core manager with everything unlocked and `id` selected. */
function runningCore(id: CoreId): CoreManager {
  const cores = new CoreManager();
  for (const c of CORES) cores.unlock(c.id);
  cores.select(id);
  return cores;
}

// ────────────────────────────────────────────────────────────────────────────

describe('the table (plan §6.1)', () => {
  it('has one def per id, in picker order, with the default first', () => {
    expect(CORES.map(c => c.id)).toEqual([...CORE_IDS]);
    expect(CORES[0].id).toBe(DEFAULT_CORE);
    expect(new Set(CORE_IDS).size).toBe(CORE_IDS.length);
    for (const id of CORE_IDS) expect(CORE_BY_ID[id].id).toBe(id);
  });

  it('gives every core a stat block or a shot behavior', () => {
    // A core with neither is a picker card that changes nothing — the exact
    // failure the closed unions exist to prevent.
    for (const def of CORES) {
      const hasStats = Object.keys(def.stats).length > 0;
      expect(hasStats || def.behaviors.length > 0, `${def.id} does nothing`).toBe(true);
      expect(describeCoreStats(def).length + def.behaviors.length).toBeGreaterThan(0);
    }
  });

  it('names a consumer for every behavior, and uses every named behavior', () => {
    const declared = new Set<CoreBehavior>();
    for (const def of CORES) for (const b of def.behaviors) declared.add(b);
    for (const [behavior, consumer] of Object.entries(CORE_BEHAVIOR_CONSUMERS)) {
      expect(consumer.length, `${behavior} has no consumer`).toBeGreaterThan(8);
      expect(declared.has(behavior as CoreBehavior), `${behavior} is on no core`).toBe(true);
    }
    expect(declared.size).toBe(Object.keys(CORE_BEHAVIOR_CONSUMERS).length);
  });

  it('prices only the default at zero AP', () => {
    for (const def of CORES) {
      if (def.id === DEFAULT_CORE) expect(def.apCost).toBe(0);
      else expect(def.apCost).toBeGreaterThan(0);
    }
  });

  it('recognises exactly the five ids', () => {
    for (const id of CORE_IDS) expect(isCoreId(id)).toBe(true);
    expect(isCoreId('marksmen')).toBe(false);
    expect(isCoreId(undefined)).toBe(false);
    expect(isCoreId(3)).toBe(false);
  });
});

describe('stat blocks resolve (plan §6.4)', () => {
  /**
   * Pinned literals, not re-derived from the table: a test that recomputes the
   * formula it is testing passes whatever the formula becomes.
   */
  it('marksman: +6% crit, +20% range', () => {
    const { stats } = resolveStats(ctx({ core: 'marksman' }));
    expect(stats.critChance).toBeCloseTo(TOWER_BASE.critChance + 0.06, 10);
    expect(stats.range).toBeCloseTo(360, 10);
  });

  it('artillery: -40% fire rate, +65% damage', () => {
    const { stats } = resolveStats(ctx({ core: 'artillery', upgrades: { damage: 10 } }));
    const base = resolveStats(ctx({ core: 'marksman', upgrades: { damage: 10 } })).stats;
    expect(stats.fireRate).toBeCloseTo(TOWER_BASE.fireRate * 0.6, 10);
    expect(stats.baseDamage / base.baseDamage).toBeCloseTo(1.65, 10);
  });

  it('frostwork: +30% fire rate, -18% damage', () => {
    const { stats } = resolveStats(ctx({ core: 'frostwork', upgrades: { damage: 10 } }));
    const base = resolveStats(ctx({ core: 'marksman', upgrades: { damage: 10 } })).stats;
    expect(stats.fireRate).toBeCloseTo(TOWER_BASE.fireRate * 1.3, 10);
    expect(stats.baseDamage / base.baseDamage).toBeCloseTo(0.82, 10);
  });

  it('bloodforge: +60% max HP, +8% lifesteal, -20% gold', () => {
    const { stats } = resolveStats(ctx({ core: 'bloodforge' }));
    expect(stats.maxHp).toBeCloseTo(TOWER_BASE.maxHp * 1.6, 10);
    expect(stats.lifesteal).toBeCloseTo(0.08, 10);
    expect(stats.goldMultiplier).toBeCloseTo(0.8, 10);
  });

  it('arcane: -18% damage, +100% mana regen, +50% ability damage', () => {
    const { stats } = resolveStats(ctx({ core: 'arcane', upgrades: { damage: 10 } }));
    const base = resolveStats(ctx({ core: 'marksman', upgrades: { damage: 10 } })).stats;
    expect(stats.baseDamage / base.baseDamage).toBeCloseTo(0.82, 10);
    expect(stats.manaRegen).toBeCloseTo(2, 10);
    expect(stats.abilityDamageMultiplier).toBeCloseTo(1.5, 10);
  });

  it('attributes every core contribution to the core source', () => {
    const { breakdown } = resolveStats(ctx({ core: 'bloodforge' }), { breakdown: true });
    const sources = (breakdown.maxHp ?? []).map(c => c.source);
    expect(sources).toContain('core');
    expect((breakdown.maxHp ?? []).find(c => c.source === 'core')?.label)
      .toBe(CORE_BY_ID.bloodforge.name);
  });

  it('composes with blessings instead of overwriting them', () => {
    const both = resolveStats(ctx({
      core: 'artillery',
      upgrades: { damage: 10 },
      blessings: { stats: { damagePct: 0.5 }, behaviors: [] },
    })).stats;
    const coreOnly = resolveStats(ctx({ core: 'artillery', upgrades: { damage: 10 } })).stats;
    expect(both.baseDamage / coreOnly.baseDamage).toBeCloseTo(1.5, 10);
  });
});

describe('bloodforge: the low-HP tempo step (plan §6.1)', () => {
  const fireRateAt = (hpFraction: number) =>
    resolveStats(ctx({ core: 'bloodforge', hpFraction })).stats.fireRate;

  it('does not fire above the threshold', () => {
    expect(fireRateAt(1)).toBeCloseTo(TOWER_BASE.fireRate, 10);
    expect(fireRateAt(CORE_TUNING.desperateHpFraction)).toBeCloseTo(TOWER_BASE.fireRate, 10);
    expect(fireRateAt(CORE_TUNING.desperateHpFraction + 0.001))
      .toBeCloseTo(TOWER_BASE.fireRate, 10);
  });

  it('fires below the threshold', () => {
    const expected = TOWER_BASE.fireRate * (1 + CORE_TUNING.desperateFireRate);
    expect(fireRateAt(CORE_TUNING.desperateHpFraction - 0.001)).toBeCloseTo(expected, 10);
    expect(fireRateAt(0.1)).toBeCloseTo(expected, 10);
  });

  it('is the only core it applies to', () => {
    for (const id of CORE_IDS) {
      if (id === 'bloodforge') continue;
      const low = resolveStats(ctx({ core: id, hpFraction: 0.1 })).stats.fireRate;
      const high = resolveStats(ctx({ core: id, hpFraction: 1 })).stats.fireRate;
      expect(low, `${id} moved on HP`).toBeCloseTo(high, 10);
    }
  });
});

describe('artillery: every shot splashes (plan §6.1)', () => {
  it('plans a blast on every shot, not every Nth', () => {
    const cores = runningCore('artillery');
    for (let i = 0; i < 5; i++) {
      const plan = cores.planShot(() => true);
      expect(plan.splashRadius).toBe(CORE_TUNING.splashRadius);
      expect(plan.splashFraction).toBe(CORE_TUNING.splashFraction);
      expect(plan.manaSpent).toBe(0);
    }
  });

  it('damages every enemy inside the blast, and none outside it', () => {
    const { enemies, towerState, projectiles, cores } = combatHarness();
    for (const c of CORES) cores.unlock(c.id);
    cores.select('artillery');

    const target = enemies.spawn('normal', 1, 400, 300);
    // Three inside the 70 px blast, one comfortably outside it.
    const near = [
      enemies.spawn('normal', 1, 420, 300),
      enemies.spawn('normal', 1, 400, 340),
      enemies.spawn('normal', 1, 370, 320),
    ];
    const far = enemies.spawn('normal', 1, 400, 300 + CORE_TUNING.splashRadius + 60);
    for (const e of [target, ...near, far]) {
      e.hp = e.maxHp = 1e6;
    }

    const plan = cores.planShot(() => true);
    projectiles.fire(target, towerState, {
      rawDamage: 1000,
      damageType: 'physical',
      isCrit: false,
      targetId: target.id,
      splashRadius: plan.splashRadius,
      splashFraction: plan.splashFraction,
    });
    for (let i = 0; i < 60; i++) projectiles.tick(1 / 120);

    expect(target.hp).toBeLessThan(1e6);
    for (const e of near) expect(e.hp, `enemy at ${e.x},${e.y} was missed`).toBeLessThan(1e6);
    expect(far.hp).toBe(1e6);
    // The blast pays a *fraction* of the landed hit, not the whole of it.
    const direct = 1e6 - target.hp;
    const splash = 1e6 - near[0].hp;
    expect(splash / direct).toBeCloseTo(CORE_TUNING.splashFraction, 2);
  });

  it('does not splash on any other core', () => {
    for (const id of CORE_IDS) {
      if (id === 'artillery') continue;
      expect(runningCore(id).planShot(() => true).splashRadius).toBeUndefined();
    }
  });
});

describe('arcane: the periodic mana shot (plan §6.1)', () => {
  it('procs on exactly every Nth shot', () => {
    const cores = runningCore('arcane');
    const procs: number[] = [];
    for (let i = 1; i <= 20; i++) {
      if (cores.planShot(() => true).damageType === 'magic') procs.push(i);
    }
    expect(procs).toEqual([5, 10, 15, 20]);
  });

  it('spends mana and lands as magic at 250%', () => {
    const cores = runningCore('arcane');
    let spent = 0;
    const spend = (n: number) => {
      spent += n;
      return true;
    };
    for (let i = 0; i < 4; i++) cores.planShot(spend);
    expect(spent).toBe(0);

    const plan = cores.planShot(spend);
    expect(plan.damageType).toBe('magic');
    expect(plan.damageMult).toBeCloseTo(CORE_TUNING.manaShotDamageMult, 10);
    expect(plan.manaSpent).toBe(CORE_TUNING.manaShotCost);
    expect(spent).toBe(CORE_TUNING.manaShotCost);
  });

  it('actually debits the resource pool', () => {
    const { cores, resourceMgr, resources } = combatHarness();
    for (const c of CORES) cores.unlock(c.id);
    cores.select('arcane');
    resources.mana = 100;
    for (let i = 0; i < 5; i++) cores.planShot(n => resourceMgr.spendMana(n));
    expect(resources.mana).toBe(100 - CORE_TUNING.manaShotCost);
  });

  /**
   * Cross-cutting rule 1: a verb that costs a resource must still fire when the
   * resource runs out. Out of mana the proc degrades to an ordinary shot — it
   * is never skipped, and it never leaves the tower not shooting.
   */
  it('degrades to an ordinary shot when mana runs out', () => {
    const { cores, resourceMgr, resources } = combatHarness();
    for (const c of CORES) cores.unlock(c.id);
    cores.select('arcane');
    resources.mana = 0;
    for (let i = 0; i < 4; i++) cores.planShot(n => resourceMgr.spendMana(n));
    const plan = cores.planShot(n => resourceMgr.spendMana(n));
    expect(plan.damageType).toBeNull();
    expect(plan.damageMult).toBe(1);
    expect(plan.manaSpent).toBe(0);
  });

  it('magic damage is resisted by magicResist, not by armour', () => {
    // The half of the proc the damage multiple does not show. A `tank` carries
    // flat armour and no magic resist, so the same raw damage lands harder as
    // magic — which is what the core is buying.
    const { enemies, tower } = combatHarness();
    const tank = enemies.spawn('tank', 1, 400, 300);
    expect(tank.armor).toBeGreaterThan(0);
    expect(tank.magicResist).toBe(0);
    const physical = tower.applyResists(tank, 100, 'physical');
    const magic = tower.applyResists(tank, 100, 'magic');
    expect(magic).toBeGreaterThan(physical);
  });

  it('resets its cadence with the run', () => {
    const cores = runningCore('arcane');
    for (let i = 0; i < 4; i++) cores.planShot(() => true);
    cores.resetRun();
    // Without the reset this next shot would be the 5th and would proc.
    expect(cores.planShot(() => true).damageType).toBeNull();
  });
});

describe('frostwork: chill and the extended nova (plan §6.1)', () => {
  it('chills through the per-enemy chill map, not a global slow', () => {
    const { enemies, towerState, projectiles, cores } = combatHarness();
    for (const c of CORES) cores.unlock(c.id);
    cores.select('frostwork');

    const hit = enemies.spawn('normal', 1, 400, 300);
    const untouched = enemies.spawn('normal', 1, 900, 300);
    hit.hp = hit.maxHp = 1e6;
    untouched.hp = untouched.maxHp = 1e6;

    projectiles.fire(hit, towerState, {
      rawDamage: 10, damageType: 'physical', isCrit: false, targetId: hit.id,
    });
    for (let i = 0; i < 60; i++) projectiles.tick(1 / 120);

    expect(enemies.isSlowed(hit)).toBe(true);
    // Per-enemy, so the one that was never hit is still at full speed. A global
    // slow would have caught it too.
    expect(enemies.isSlowed(untouched)).toBe(false);
  });

  it('does not chill on any other core', () => {
    for (const id of CORE_IDS) {
      if (id === 'frostwork') continue;
      const { enemies, towerState, projectiles, cores } = combatHarness();
      for (const c of CORES) cores.unlock(c.id);
      cores.select(id);
      const hit = enemies.spawn('normal', 1, 400, 300);
      hit.hp = hit.maxHp = 1e6;
      projectiles.fire(hit, towerState, {
        rawDamage: 10, damageType: 'physical', isCrit: false, targetId: hit.id,
      });
      for (let i = 0; i < 60; i++) projectiles.tick(1 / 120);
      expect(enemies.isSlowed(hit), `${id} chilled`).toBe(false);
    }
  });

  it('doubles the duration of slow abilities and nothing else', () => {
    const bus = new EventBus();
    const resources = {
      gold: 0, mana: 1000, maxMana: 1000, manaRegen: 0,
    } as unknown as ResourceState;
    const stats = { goldEarned: 0 } as unknown as GameStats;
    const resourceMgr = new ResourceManager(resources, stats, bus);
    const enemies = new EnemyManager(bus, resourceMgr);
    const towerState = {
      x: 100, y: 300, hp: 100, maxHp: 100, baseDamage: 10, fireRate: 1, range: 500,
      critChance: 0, critMultiplier: 1, damageType: 'physical',
    } as unknown as TowerState;
    const tower = new Tower(towerState);
    const projectiles = new ProjectileManager(bus, tower, enemies);
    const abilityStates: Record<string, AbilityState> = {};
    const abilities = new AbilityManager({
      resources: resourceMgr,
      enemies,
      tower,
      bus,
      projectileManager: projectiles,
      buffs: new BuffRegistry(),
      getState: (id) => abilityStates[id] ?? (abilityStates[id] = {
        level: 1, cooldown: 0, active: false, activeTimer: 0, xp: 0,
      } as AbilityState),
      onCast: () => {},
    });

    const novaBase = abilities.getEffectiveDuration('frost_nova');
    const berserkBase = abilities.getEffectiveDuration('berserk');
    abilities.setSlowDurationMult(CORE_TUNING.novaDurationMult);
    expect(abilities.getEffectiveDuration('frost_nova'))
      .toBeCloseTo(novaBase * CORE_TUNING.novaDurationMult, 10);
    // Keyed off the effect type, so a non-slow ability is untouched.
    expect(ABILITY_BY_ID.berserk.effectType).not.toBe('slow');
    expect(abilities.getEffectiveDuration('berserk')).toBeCloseTo(berserkBase, 10);
  });
});

describe('bloodforge: kills heal (plan §6.1)', () => {
  it('is the only core carrying the behavior', () => {
    for (const id of CORE_IDS) {
      expect(runningCore(id).has('kill_heal')).toBe(id === 'bloodforge');
      expect(runningCore(id).has('desperate_tempo')).toBe(id === 'bloodforge');
    }
  });
});

describe('unlocking is AP-gated (plan §6.2)', () => {
  function prestigeHarness(ascensionPoints: number) {
    const bus = new EventBus();
    const resources = { ascensionPoints, lifetimeAP: 0, apThisTranscendence: 0 } as ResourceState;
    const stats = { lifetimeAscensions: 1 } as GameStats;
    const prestige = { apSpent: {}, tpSpent: {}, automationFlags: {} } as unknown as PrestigeState;
    const mgr = new PrestigeManager(bus, { resources, stats, prestige });
    return { mgr, resources };
  }

  it('refuses a core the player cannot afford, and spends nothing', () => {
    const { mgr, resources } = prestigeHarness(CORE_BY_ID.artillery.apCost - 1);
    expect(mgr.canUnlockCore('artillery', false)).toBe(false);
    expect(mgr.spendOnCore('artillery', false)).toBe(false);
    expect(resources.ascensionPoints).toBe(CORE_BY_ID.artillery.apCost - 1);
  });

  it('debits exactly the listed cost', () => {
    const { mgr, resources } = prestigeHarness(100);
    expect(mgr.spendOnCore('arcane', false)).toBe(true);
    expect(resources.ascensionPoints).toBe(100 - CORE_BY_ID.arcane.apCost);
  });

  it('never charges twice for a core already owned', () => {
    const { mgr, resources } = prestigeHarness(100);
    expect(mgr.canUnlockCore('artillery', true)).toBe(false);
    expect(mgr.spendOnCore('artillery', true)).toBe(false);
    expect(resources.ascensionPoints).toBe(100);
  });

  it('never charges for the default core', () => {
    const { mgr, resources } = prestigeHarness(100);
    expect(mgr.canUnlockCore(DEFAULT_CORE, false)).toBe(false);
    expect(resources.ascensionPoints).toBe(100);
  });

  it('refuses to select a core that was never unlocked', () => {
    const cores = new CoreManager();
    expect(cores.select('arcane')).toBe(false);
    expect(cores.current).toBe(DEFAULT_CORE);
    cores.unlock('arcane');
    expect(cores.select('arcane')).toBe(true);
    expect(cores.current).toBe('arcane');
  });
});

describe('the picker (plan §6.2)', () => {
  it('never appears before the first ascension', () => {
    const cores = new CoreManager();
    for (const c of CORES) cores.unlock(c.id);
    // Every core owned, and still no picker: a new player has no information
    // to choose with, so they are not asked.
    expect(cores.isPickerAvailable(0)).toBe(false);
    expect(cores.isPickerAvailable(1)).toBe(true);
  });

  it('never appears when there is only one core to pick', () => {
    const cores = new CoreManager();
    expect(cores.unlockedCount).toBe(1);
    expect(cores.isPickerAvailable(5)).toBe(false);
    cores.unlock('artillery');
    expect(cores.isPickerAvailable(5)).toBe(true);
  });
});

describe('run scope (plan §6.2)', () => {
  it('resets the selection to the preference, not to the default', () => {
    // The point: an auto-ascending idle game reaches the reset without a player
    // in front of it. Reverting to `marksman` every run would strip a chosen
    // identity from an idle player without ever asking.
    const cores = runningCore('bloodforge');
    cores.resetRun();
    expect(cores.current).toBe('bloodforge');
    expect(cores.preferredCore).toBe('bloodforge');
  });

  it('keeps unlocks through a run reset and drops them on a full wipe', () => {
    const cores = runningCore('arcane');
    cores.resetRun();
    expect(cores.unlockedIds()).toEqual([...CORE_IDS]);
    cores.resetAll();
    expect(cores.unlockedIds()).toEqual([DEFAULT_CORE]);
    expect(cores.current).toBe(DEFAULT_CORE);
  });

  it('rebuilds the behavior cache on every selection change', () => {
    const cores = runningCore('artillery');
    expect(cores.has('splash_shots')).toBe(true);
    cores.select('frostwork');
    expect(cores.has('splash_shots')).toBe(false);
    expect(cores.has('chill_shots')).toBe(true);
  });

  it('agrees with a linear scan of the table for every core', () => {
    for (const id of CORE_IDS) {
      const cores = runningCore(id);
      for (const behavior of Object.keys(CORE_BEHAVIOR_CONSUMERS) as CoreBehavior[]) {
        expect(cores.has(behavior), `${id}/${behavior}`)
          .toBe(CORE_BY_ID[id].behaviors.includes(behavior));
      }
    }
  });
});

describe('persistence (plan §6.3)', () => {
  it('survives a snapshot/restore round trip', () => {
    const cores = runningCore('frostwork');
    const restored = new CoreManager();
    restored.restore(cores.snapshot());
    expect(restored.current).toBe('frostwork');
    expect(restored.preferredCore).toBe('frostwork');
    expect(restored.unlockedIds()).toEqual([...CORE_IDS]);
  });

  it('falls back to the default rather than trusting a corrupt block', () => {
    const cores = new CoreManager();
    cores.restore({ unlocked: ['nonsense', 'arcane'], preferred: 'nope', selected: 'nope' });
    expect(cores.unlockedIds()).toEqual([DEFAULT_CORE, 'arcane']);
    expect(cores.current).toBe(DEFAULT_CORE);
  });

  it('never restores a selection the player does not own', () => {
    const cores = new CoreManager();
    cores.restore({ unlocked: [DEFAULT_CORE], preferred: 'arcane', selected: 'arcane' });
    expect(cores.current).toBe(DEFAULT_CORE);
  });

  it('survives a full save round trip through SaveManager', () => {
    const save = new SaveManager({ on: () => {} });
    const cores = runningCore('bloodforge');
    const state = {
      tower: {}, resources: {}, upgrades: {}, research: {}, abilities: {},
      prestige: { apSpent: {}, tpSpent: {}, automationFlags: {}, autoCastEnabled: {} },
      wave: {}, stats: {}, achievements: [], runHistory: [], runStartedAt: 0,
      towerXp: {}, talents: { allocated: {} }, passiveAbilities: {},
      equipment: [], equipped: {},
      cores: cores.snapshot(),
    } as unknown as GameState;

    const persisted = save.snapshot(state);
    const roundTripped = JSON.parse(JSON.stringify(persisted));
    const restored = new CoreManager();
    restored.restore(roundTripped.cores);
    expect(roundTripped.version).toBe(14);
    expect(restored.current).toBe('bloodforge');
    expect(restored.unlockedIds()).toEqual([...CORE_IDS]);
  });
});

describe('corePreference biases the draft (plan §6.2)', () => {
  it('is 1.5x everywhere it is declared, and declared for every core', () => {
    const seen = new Set<CoreId>();
    let declarations = 0;
    for (const def of BLESSINGS) {
      for (const [core, weight] of Object.entries(def.corePreference ?? {})) {
        expect(weight, `${def.id}/${core}`).toBe(CORE_PREFERENCE_WEIGHT);
        seen.add(core as CoreId);
        declarations += 1;
      }
    }
    expect(declarations).toBeGreaterThan(10);
    // Every core has something that likes it; a core the pool ignores would
    // make its draft identical to marksman's.
    expect([...seen].sort()).toEqual([...CORE_IDS].sort());
  });

  /**
   * The requirement §6.2 is emphatic about: **never exclusive**. The weight
   * multiplies, so a card the core does not favour keeps a real draw chance —
   * cross-core builds are most of what makes a second run of the same core
   * interesting.
   */
  it('never makes any eligible card unreachable', () => {
    for (const id of CORE_IDS) {
      const mgr = new BlessingManager();
      const eligible = mgr.eligible(200, id).map(d => d.id);
      expect(eligible.length).toBeGreaterThan(20);

      const drawn = new Set<string>();
      // A deterministic sweep of the whole weight range: every card must be
      // reachable for *some* roll, whichever core is running.
      for (let i = 0; i < 4000; i++) {
        const r = (i + 0.5) / 4000;
        for (const def of mgr.rollOffer(200, id, () => r)) drawn.add(def.id);
      }
      for (const cardId of eligible) {
        expect(drawn.has(cardId), `${cardId} unreachable on ${id}`).toBe(true);
      }
    }
  });

  it('raises a favoured card\'s share and lowers nothing to zero', () => {
    // Frostbite is frostwork's card. Measured as a share of a long sequence of
    // single draws, so this asserts the *weighting*, not one lucky roll.
    const share = (core: CoreId | undefined, cardId: string) => {
      const mgr = new BlessingManager();
      let hits = 0;
      const draws = 3000;
      for (let i = 0; i < draws; i++) {
        const r = (i + 0.5) / draws;
        if (mgr.rollOffer(200, core, () => r).some(d => d.id === cardId)) hits += 1;
      }
      return hits / draws;
    };
    const neutral = share('marksman', 'bl_frost');
    const favoured = share('frostwork', 'bl_frost');
    expect(favoured).toBeGreaterThan(neutral);
    expect(neutral).toBeGreaterThan(0);
  });

  it('leaves the offer size and no-duplicate rule intact under a preference', () => {
    const mgr = new BlessingManager();
    for (let i = 0; i < 200; i++) {
      const offer = mgr.rollOffer(200, 'artillery', () => (i + 0.5) / 200);
      expect(offer).toHaveLength(3);
      expect(new Set(offer.map(d => d.id)).size).toBe(3);
    }
  });
});
