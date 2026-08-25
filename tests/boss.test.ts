/**
 * Boss encounters (gameplay plan §3.7).
 *
 * Every test here exists because the corresponding mechanic is silent when it
 * breaks. A phase that fires twice looks like a stutter; a bulwark that heals
 * when it should not looks like a tanky boss; a slam that ignores mitigation
 * looks like bad luck. None of it is visible on screen and none of it is
 * visible to the type system.
 *
 * The whole machine runs inside `Game.simulate`'s fixed substeps, so every test
 * drives the *real* `EnemyManager` at a fixed `dt` — and the substep-invariance
 * test drives it at both ends of the range the game actually uses.
 */

import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/game/EventBus';
import { EnemyManager } from '../src/systems/EnemyManager';
import { ResourceManager } from '../src/systems/ResourceManager';
import { PrestigeManager } from '../src/systems/PrestigeManager';
import { BlessingManager } from '../src/systems/BlessingManager';
import {
  BOSS_ENCOUNTER,
  BOSS_PATTERNS,
  bossEncounterOutcome,
  bossEnrageStacksFor,
  bossMaxHpForWave,
  bossNameForWave,
  bossPatternForPhase,
  bossPatternsForWave,
  bossPhaseForHpFraction,
  bossPhaseHpFactor,
  bossSummonCountForWave,
  isTargetable,
} from '../src/data/enemies';
import { bossHPForWave, bossCountForWave } from '../src/data/formulas';
import { RARITY_ORDER, rollDrop, upgradeRarity } from '../src/data/equipment';
import type { BossPattern, Enemy, GameStats, PrestigeState, ResourceState } from '../src/types';

/** One substep at the game's fixed rate — `Game.update`'s floor. */
const DT = 1 / 120;
/**
 * The substep the loop actually runs at maximum game speed.
 *
 * `Game.update` takes `ceil(gameDt / 1/60)` substeps capped at 6, so a 60 Hz
 * frame at 6.5x speed is `0.1083 / 6`. This is the *coarsest* step the boss
 * machine ever sees, and the plan requires it to behave identically at both.
 */
const DT_FAST = (6.5 / 60) / 6;

const TOWER_X = 400;
const TOWER_Y = 300;

interface Harness {
  bus: EventBus;
  mgr: EnemyManager;
  mana: () => number;
  events: Array<{ name: string; payload: unknown }>;
  run: (seconds: number, dt?: number) => void;
}

function harness(mana = 0): Harness {
  const bus = new EventBus();
  const state: ResourceState = {
    gold: 0,
    mana,
    maxMana: Math.max(100, mana),
    manaRegen: 0,
    ascensionPoints: 0,
    apThisTranscendence: 0,
    transcendencePoints: 0,
    lifetimeAP: 0,
    lifetimeGold: 0,
  };
  const resources = new ResourceManager(state, { goldEarned: 0 } as unknown as GameStats, bus);
  const mgr = new EnemyManager(bus, resources);
  mgr.setBounds(800, 600);
  const events: Array<{ name: string; payload: unknown }> = [];
  for (const name of [
    'boss_spawned', 'boss_phase', 'boss_shield_up', 'boss_shield_broken',
    'boss_bulwark_held', 'boss_summon', 'boss_slam', 'boss_slam_telegraph',
    'boss_enrage_stack', 'tower_damaged',
  ]) {
    bus.on(name, (payload) => events.push({ name, payload }));
  }
  return {
    bus,
    mgr,
    mana: () => state.mana,
    events,
    run: (seconds, dt = DT, towerRange: number = 2000) => {
      const steps = Math.max(1, Math.round(seconds / dt));
      for (let i = 0; i < steps; i++) mgr.tick(dt, TOWER_X, TOWER_Y, towerRange);
    },
  };
}

/** Spawn a boss well outside contact range so it does not melee mid-test. */
function spawnBoss(h: Harness, wave: number): Enemy {
  return h.mgr.spawn('boss', wave, TOWER_X + 2000, TOWER_Y);
}

function phaseEvents(h: Harness): number[] {
  return h.events.filter(e => e.name === 'boss_phase').map(e => (e.payload as { phase: number }).phase);
}

// ── §3.2 pattern assignment ────────────────────────────────────────────────

describe('boss patterns (plan §3.2)', () => {
  it('teaches bulwark alone at tier 1', () => {
    expect(bossPatternsForWave(10)).toEqual(['bulwark', 'bulwark', 'bulwark']);
  });

  it('adds summon at tier 2 and slam at tier 3', () => {
    expect(bossPatternsForWave(20)).toEqual(['bulwark', 'summon', 'bulwark']);
    expect(bossPatternsForWave(30)).toEqual(['bulwark', 'summon', 'slam']);
  });

  it('gives every tier-4+ boss three distinct patterns', () => {
    for (let wave = 40; wave <= 300; wave += 10) {
      const patterns = bossPatternsForWave(wave);
      expect(patterns).toHaveLength(3);
      expect(new Set(patterns).size, `wave ${wave}`).toBe(3);
    }
  });

  it('rotates so every pattern reaches every phase slot across four tiers', () => {
    for (let phase = 1; phase <= 3; phase++) {
      const seen = new Set<BossPattern>();
      for (let tier = 4; tier < 8; tier++) seen.add(bossPatternForPhase(tier, phase));
      expect(seen.size, `phase ${phase}`).toBe(BOSS_PATTERNS.length);
    }
  });

  it('names a boss after its tier', () => {
    expect(bossNameForWave(10)).toBe('Wave 10 Sentinel');
    expect(bossNameForWave(20)).toBe('Wave 20 Overseer');
    expect(bossNameForWave(40)).toBe('Wave 40 Devourer');
    // Never borrows the name of an enemy type.
    expect(bossNameForWave(20)).not.toContain('Warden');
  });

  it('divides a summon batch across the boss pack rather than per boss', () => {
    // The plan's "4 adds" is the figure for a lone boss; a wave fields
    // `2 + tier` of them and the batch is shared out, so the per-boss figure
    // falls as the pack grows and never rises above the plan's number.
    let previous = Infinity;
    for (const wave of [10, 40, 100]) {
      const perBoss = bossSummonCountForWave(wave);
      expect(perBoss, `wave ${wave}`).toBeGreaterThanOrEqual(1);
      expect(perBoss, `wave ${wave}`).toBeLessThanOrEqual(BOSS_ENCOUNTER.summonCount);
      expect(perBoss, `wave ${wave}`).toBeLessThanOrEqual(previous);
      previous = perBoss;
    }
    // A deep wave's pack is bigger than the batch, so each boss adds one.
    expect(bossCountForWave(100)).toBeGreaterThan(BOSS_ENCOUNTER.summonCount);
    expect(bossSummonCountForWave(100)).toBe(1);
  });
});

// ── §3.7 the bar shrinks by exactly what the machine holds ─────────────────

describe('boss durability budget (plan §3.7)', () => {
  it('keeps a boss wave costing the same total damage it did before phases', () => {
    for (const wave of [10, 20, 40, 70, 130]) {
      const effective = bossMaxHpForWave(wave) * bossPhaseHpFactor(wave);
      expect(effective, `wave ${wave}`).toBeCloseTo(bossHPForWave(120, wave), 6);
    }
  });

  it('makes the tier-1 teaching boss the one that leans hardest on its shield', () => {
    // Three bulwark phases, so the most of its durability sits outside the bar.
    expect(bossPhaseHpFactor(10)).toBeGreaterThan(bossPhaseHpFactor(50));
  });
});

// ── §3.1 phases ────────────────────────────────────────────────────────────

describe('boss phases (plan §3.1)', () => {
  it('maps HP fractions onto the 66/33 thresholds', () => {
    expect(bossPhaseForHpFraction(1)).toBe(1);
    expect(bossPhaseForHpFraction(0.67)).toBe(1);
    expect(bossPhaseForHpFraction(0.66)).toBe(2);
    expect(bossPhaseForHpFraction(0.34)).toBe(2);
    expect(bossPhaseForHpFraction(0.33)).toBe(3);
    expect(bossPhaseForHpFraction(0)).toBe(3);
  });

  it('fires each crossing exactly once as the boss is chipped down', () => {
    const h = harness();
    const boss = spawnBoss(h, 40);
    const chip = boss.maxHp * 0.02;
    for (let i = 0; i < 2000 && boss.alive; i++) {
      h.mgr.tick(DT, TOWER_X, TOWER_Y, 2000);
      h.mgr.damage(boss, chip, false);
    }
    expect(boss.alive).toBe(false);
    expect(phaseEvents(h)).toEqual([2, 3]);
  });

  it('is idempotent when a substep sits on the threshold and the next re-enters', () => {
    const h = harness();
    const boss = spawnBoss(h, 40);
    // Land just under 66% and stay there for a hundred substeps.
    boss.hp = boss.maxHp * 0.6599;
    h.run(100 * DT);
    expect(phaseEvents(h)).toEqual([2]);

    // A bulwark heal (or a vitality aura) can push it back above the line. The
    // crossing must not fire a second time when it drops through again.
    boss.hp = boss.maxHp * 0.9;
    h.run(50 * DT);
    boss.hp = boss.maxHp * 0.5;
    h.run(50 * DT);
    expect(phaseEvents(h)).toEqual([2]);
    expect(boss.bossPhase).toBe(2);
  });

  it('runs both crossings in order when one hit skips a whole phase', () => {
    const h = harness();
    const boss = spawnBoss(h, 40);
    boss.hp = boss.maxHp * 0.1;
    h.run(DT);
    expect(phaseEvents(h)).toEqual([2, 3]);
    expect(boss.bossPhase).toBe(3);
  });

  it('makes the boss untargetable and unhittable during the flash', () => {
    const h = harness();
    const boss = spawnBoss(h, 40);
    boss.hp = boss.maxHp * 0.5;
    h.run(DT);

    expect(boss.bossInvulnerable).toBeGreaterThan(0);
    // The one predicate every target-selection site consults (plan §2.8 note 3).
    expect(isTargetable(boss)).toBe(false);
    const before = boss.hp;
    expect(h.mgr.damage(boss, boss.maxHp * 10, false)).toBe(false);
    expect(boss.hp).toBe(before);

    h.run(BOSS_ENCOUNTER.phaseInvulnerability + 0.1);
    expect(isTargetable(boss)).toBe(true);
  });

  it('counts the same phases at 1/120 and at the 6.5x substep', () => {
    // Same simulated seconds and the same damage per second at both step
    // sizes: if any of the machine were frame-driven rather than integrated,
    // these would diverge.
    const run = (dt: number): { phases: number[]; alive: boolean } => {
      const h = harness();
      const boss = spawnBoss(h, 40);
      // Comfortably lethal: the point of the test is that both step sizes see
      // the same phases and the same outcome, not that it is a close-run thing.
      const dpsRate = boss.maxHp / 10;
      const steps = Math.round(40 / dt);
      for (let i = 0; i < steps && boss.alive; i++) {
        h.mgr.tick(dt, TOWER_X, TOWER_Y, 2000);
        h.mgr.damage(boss, dpsRate * dt, false);
      }
      return { phases: phaseEvents(h), alive: boss.alive };
    };
    const slow = run(DT);
    const fast = run(DT_FAST);
    expect(slow.phases).toEqual([2, 3]);
    expect(fast.phases).toEqual(slow.phases);
    expect(fast.alive).toBe(slow.alive);
  });
});

// ── §3.2 bulwark ───────────────────────────────────────────────────────────

describe('bulwark (plan §3.2)', () => {
  it('puts up a shield worth 20% of max HP on phase entry', () => {
    const h = harness();
    const boss = spawnBoss(h, 10);
    expect(boss.bossPattern).toBe('bulwark');
    expect(boss.bossShield).toBe(Math.floor(boss.maxHp * BOSS_ENCOUNTER.bulwarkShieldFraction));
    expect(boss.bossShieldTimer).toBe(BOSS_ENCOUNTER.bulwarkWindow);
  });

  it('spends the shield before HP', () => {
    const h = harness();
    const boss = spawnBoss(h, 10);
    const shield = boss.bossShield!;
    const hp = boss.hp;
    h.mgr.damage(boss, shield - 1, false);
    expect(boss.hp).toBe(hp);
    expect(boss.bossShield).toBe(1);
    // The hit that breaks it bleeds the remainder through to HP.
    h.mgr.damage(boss, 101, false);
    expect(boss.bossShield).toBe(0);
    expect(boss.hp).toBe(hp - 100);
  });

  it('heals the shield back when the window expires unbroken', () => {
    const h = harness();
    const boss = spawnBoss(h, 10);
    boss.hp = boss.maxHp * 0.8;
    const shield = boss.bossShield!;
    const before = boss.hp;

    h.run(BOSS_ENCOUNTER.bulwarkWindow + 0.2);

    expect(boss.hp).toBeCloseTo(before + shield, 3);
    expect(h.events.some(e => e.name === 'boss_bulwark_held')).toBe(true);
    // And it recycles, so the check comes round again.
    expect(boss.bossShield).toBeGreaterThan(0);
    expect(boss.bossShieldTimer).toBeGreaterThan(BOSS_ENCOUNTER.bulwarkWindow - 1);
  });

  it('does not heal when the shield was broken, and does not re-arm', () => {
    const h = harness();
    const boss = spawnBoss(h, 10);
    boss.hp = boss.maxHp * 0.8;
    const before = boss.hp;
    h.mgr.damage(boss, boss.bossShield!, false);
    expect(boss.bossShield).toBe(0);
    expect(h.events.some(e => e.name === 'boss_shield_broken')).toBe(true);

    h.run(BOSS_ENCOUNTER.bulwarkWindow * 1.5);

    expect(boss.hp).toBe(before);
    expect(h.events.some(e => e.name === 'boss_bulwark_held')).toBe(false);
    // A broken bulwark stays broken for the phase — re-arming it would make
    // the pattern a treadmill rather than a check (see `bossMaxHpForWave`).
    expect(boss.bossShield).toBe(0);
  });

  it('resolves on the same schedule at both substep sizes', () => {
    const healAt = (dt: number): number => {
      const h = harness();
      const boss = spawnBoss(h, 10);
      boss.hp = boss.maxHp * 0.8;
      h.run(BOSS_ENCOUNTER.bulwarkWindow - 0.5, dt);
      const early = h.events.filter(e => e.name === 'boss_bulwark_held').length;
      h.run(1, dt);
      const late = h.events.filter(e => e.name === 'boss_bulwark_held').length;
      expect(early).toBe(0);
      return late;
    };
    expect(healAt(DT)).toBe(1);
    expect(healAt(DT_FAST)).toBe(1);
  });
});

// ── §3.2 summon ────────────────────────────────────────────────────────────

describe('summon (plan §3.2)', () => {
  it('adds wave-scaled trash on its interval and never bosses', () => {
    const h = harness();
    const boss = h.mgr.spawn('boss', 20, TOWER_X + 2000, TOWER_Y);
    // Tier 2 phase 2 is `summon`.
    boss.hp = boss.maxHp * 0.5;
    h.run(DT);
    expect(boss.bossPattern).toBe('summon');

    const before = h.mgr.list.length;
    // The interval plus the phase flash it spent not running its pattern.
    h.run(BOSS_ENCOUNTER.summonInterval + BOSS_ENCOUNTER.phaseInvulnerability + 0.5);
    const added = h.mgr.list.filter(e => e.id !== boss.id);
    expect(h.mgr.list.length).toBeGreaterThan(before);
    expect(added.every(e => e.type !== 'boss')).toBe(true);
    expect(h.events.some(e => e.name === 'boss_summon')).toBe(true);
  });

  it('stops adding once the field is at the cap', () => {
    const h = harness();
    const boss = h.mgr.spawn('boss', 20, TOWER_X + 2000, TOWER_Y);
    boss.hp = boss.maxHp * 0.5;
    h.run(DT);
    for (let i = 0; i < BOSS_ENCOUNTER.summonMaxAlive; i++) {
      h.mgr.spawn('normal', 20, TOWER_X + 2000, TOWER_Y + i);
    }
    const before = h.mgr.list.length;
    h.run(BOSS_ENCOUNTER.summonInterval * 2 + BOSS_ENCOUNTER.phaseInvulnerability + 0.5);
    expect(h.mgr.list.length).toBe(before);
  });
});

// ── §3.2 slam ──────────────────────────────────────────────────────────────

/** Advance until this boss starts telegraphing, or give up. */
function runToTelegraph(h: Harness, boss: Enemy): void {
  for (let i = 0; i < 4000; i++) {
    if ((boss.bossSlamTelegraph ?? 0) > 0) return;
    h.mgr.tick(DT, TOWER_X, TOWER_Y, 2000);
  }
  throw new Error('boss never telegraphed a slam');
}

function lastSlam(h: Harness): { damage: number; mitigated: boolean } {
  const events = h.events.filter(e => e.name === 'boss_slam');
  expect(events.length).toBeGreaterThan(0);
  return events[events.length - 1].payload as { damage: number; mitigated: boolean };
}

describe('slam (plan §3.2)', () => {
  it('telegraphs for two seconds and then lands damage x8 through tower_damaged', () => {
    const h = harness();
    // Tier 6 phase 1 is `slam`.
    const boss = h.mgr.spawn('boss', 60, TOWER_X + 2000, TOWER_Y);
    expect(boss.bossPattern).toBe('slam');
    runToTelegraph(h, boss);
    expect(boss.bossSlamTelegraph).toBeCloseTo(BOSS_ENCOUNTER.slamTelegraph, 1);
    expect(h.events.some(e => e.name === 'boss_slam_telegraph')).toBe(true);

    h.run(BOSS_ENCOUNTER.slamTelegraph + 0.05);
    const slam = lastSlam(h);
    expect(slam.mitigated).toBe(false);
    expect(slam.damage).toBeCloseTo(boss.damage * BOSS_ENCOUNTER.slamDamageMult, 4);
    // The one mitigation chain, same as a melee hit and a siege shell.
    const damaged = h.events.filter(e => e.name === 'tower_damaged');
    expect(damaged.some(e => (e.payload as number) === slam.damage)).toBe(true);
  });

  it('is blunted to a fifth when this boss is chilled during the telegraph', () => {
    const h = harness();
    const boss = h.mgr.spawn('boss', 60, TOWER_X + 2000, TOWER_Y);
    runToTelegraph(h, boss);
    // The per-enemy chill map, not the global slow factor: the question is
    // whether *this* boss was controlled.
    h.mgr.applyChill(boss, 0.5, 0.3);
    h.run(BOSS_ENCOUNTER.slamTelegraph + 0.05);

    const slam = lastSlam(h);
    expect(slam.mitigated).toBe(true);
    expect(slam.damage).toBeCloseTo(
      boss.damage * BOSS_ENCOUNTER.slamDamageMult * BOSS_ENCOUNTER.slamMitigatedFraction,
      4,
    );
  });

  it('stays blunted even if the control wears off before the slam lands', () => {
    const h = harness();
    const boss = h.mgr.spawn('boss', 60, TOWER_X + 2000, TOWER_Y);
    runToTelegraph(h, boss);
    h.mgr.applyChill(boss, 0.5, 0.1);
    h.run(BOSS_ENCOUNTER.slamTelegraph + 0.05);
    expect(lastSlam(h).mitigated).toBe(true);
  });

  it('is blunted by a knockback during the telegraph', () => {
    const h = harness();
    const boss = h.mgr.spawn('boss', 60, TOWER_X + 2000, TOWER_Y);
    runToTelegraph(h, boss);
    h.mgr.applyKnockback(boss, 40, TOWER_X, TOWER_Y);
    h.run(BOSS_ENCOUNTER.slamTelegraph + 0.05);
    expect(lastSlam(h).mitigated).toBe(true);
  });

  it('ignores control applied after the slam has already landed', () => {
    const h = harness();
    const boss = h.mgr.spawn('boss', 60, TOWER_X + 2000, TOWER_Y);
    runToTelegraph(h, boss);
    h.run(BOSS_ENCOUNTER.slamTelegraph + 0.05);
    expect(lastSlam(h).mitigated).toBe(false);
    h.mgr.applyChill(boss, 0.5, 0.05);
    h.run(0.2);
    // Still the same, un-blunted slam.
    expect(lastSlam(h).mitigated).toBe(false);
  });

  it('lands the same number of slams at both substep sizes', () => {
    const slamsIn = (dt: number): number => {
      const h = harness();
      h.mgr.spawn('boss', 60, TOWER_X + 2000, TOWER_Y);
      h.run(30, dt);
      return h.events.filter(e => e.name === 'boss_slam').length;
    };
    // The first telegraph is deliberately staggered at random across the pack,
    // so compare the steady-state rate rather than an exact count.
    const slow = slamsIn(DT);
    const fast = slamsIn(DT_FAST);
    expect(Math.abs(slow - fast)).toBeLessThanOrEqual(1);
    expect(slow).toBeGreaterThanOrEqual(2);
  });
});

// ── §3.2 siphon ────────────────────────────────────────────────────────────

describe('siphon (plan §3.2)', () => {
  it('drains mana and heals the boss for what it took', () => {
    const h = harness(500);
    // Tier 7 phase 1 is `siphon`.
    const boss = h.mgr.spawn('boss', 70, TOWER_X + 2000, TOWER_Y);
    expect(boss.bossPattern).toBe('siphon');
    boss.hp = boss.maxHp * 0.8;
    const hp = boss.hp;

    h.run(2);

    expect(h.mana()).toBeCloseTo(500 - BOSS_ENCOUNTER.siphonManaPerSecond * 2, 3);
    expect(boss.hp).toBeCloseTo(
      hp + 2 * boss.maxHp * BOSS_ENCOUNTER.siphonHealFractionPerSecond,
      3,
    );
  });

  it('feeds the boss nothing when the player has already spent their mana', () => {
    const h = harness(0);
    const boss = h.mgr.spawn('boss', 70, TOWER_X + 2000, TOWER_Y);
    boss.hp = boss.maxHp * 0.8;
    const hp = boss.hp;
    h.run(3);
    expect(boss.hp).toBe(hp);
  });
});

// ── §3.3 enrage ────────────────────────────────────────────────────────────

describe('boss enrage timer (plan §3.3)', () => {
  it('stays calm for the first 60 seconds, then stacks every 10', () => {
    expect(bossEnrageStacksFor(0)).toBe(0);
    expect(bossEnrageStacksFor(59.9)).toBe(0);
    expect(bossEnrageStacksFor(60)).toBe(1);
    expect(bossEnrageStacksFor(69.9)).toBe(1);
    expect(bossEnrageStacksFor(70)).toBe(2);
    expect(bossEnrageStacksFor(120)).toBe(7);
  });

  it('is on the simulation clock, so the stack count is the same at any speed', () => {
    const stacksAfter = (seconds: number, dt: number): number => {
      const h = harness();
      const boss = spawnBoss(h, 40);
      h.run(seconds, dt);
      return boss.bossEnrageStacks ?? 0;
    };
    expect(stacksAfter(59, DT)).toBe(0);
    expect(stacksAfter(59, DT_FAST)).toBe(0);
    expect(stacksAfter(72, DT)).toBe(2);
    expect(stacksAfter(72, DT_FAST)).toBe(2);
  });

  it('announces the first stack once and only once', () => {
    const h = harness();
    spawnBoss(h, 40);
    h.run(75);
    const firsts = h.events
      .filter(e => e.name === 'boss_enrage_stack')
      .map(e => (e.payload as { stacks: number }).stacks);
    expect(firsts.filter(s => s === 1)).toHaveLength(1);
    expect(firsts).toEqual([1, 2]);
  });
});

// ── §3.4 rewards ───────────────────────────────────────────────────────────

describe('boss rewards (plan §3.4)', () => {
  it('scores a swift kill strictly inside the 30-second window', () => {
    expect(bossEncounterOutcome(29.9, false).swift).toBe(true);
    expect(bossEncounterOutcome(BOSS_ENCOUNTER.swiftKillSeconds, false).swift).toBe(true);
    expect(bossEncounterOutcome(30.1, false).swift).toBe(false);
  });

  it('scores flawless only when the tower actually lost HP', () => {
    expect(bossEncounterOutcome(10, false).flawless).toBe(true);
    expect(bossEncounterOutcome(10, true).flawless).toBe(false);
    // The two are independent: a slow clean kill still banks the reroll.
    expect(bossEncounterOutcome(120, false)).toEqual({ swift: false, flawless: true });
    expect(bossEncounterOutcome(5, true)).toEqual({ swift: true, flawless: false });
  });

  it('bumps a swift kill drop one rarity tier and never misses', () => {
    expect(upgradeRarity('common')).toBe('uncommon');
    expect(upgradeRarity('epic')).toBe('legendary');
    // Clamped at the top of the ladder rather than falling off it.
    expect(upgradeRarity('legendary')).toBe('legendary');

    for (let i = 0; i < 200; i++) {
      const drop = rollDrop(40, 'boss', 0, {
        guaranteed: true,
        rarityBoost: BOSS_ENCOUNTER.swiftKillRarityBoost,
      });
      expect(drop).not.toBeNull();
      // A boosted roll can never be the weakest tier, which is the whole reward.
      expect(RARITY_ORDER.indexOf(drop!.rarity)).toBeGreaterThan(0);
    }
  });

  it('leaves the ordinary boss drop as a chance roll', () => {
    let misses = 0;
    for (let i = 0; i < 200; i++) if (rollDrop(5, 'boss', 0) === null) misses += 1;
    expect(misses).toBeGreaterThan(0);
  });

  it('adds the flawless AP bonus to the run and clears it on ascension', () => {
    const resources: ResourceState = {
      gold: 0, mana: 0, maxMana: 100, manaRegen: 0, ascensionPoints: 0,
      apThisTranscendence: 0, transcendencePoints: 0, lifetimeAP: 0, lifetimeGold: 0,
    };
    const stats = { lifetimeAscensions: 5, ascensions: 5 } as unknown as GameStats;
    const prestige = {} as unknown as PrestigeState;
    const mgr = new PrestigeManager(new EventBus(), { resources, stats, prestige });

    const base = mgr.previewAP(60);
    mgr.addRunApBonus(BOSS_ENCOUNTER.flawlessApBonus);
    expect(mgr.previewAP(60)).toBe(Math.floor(base * (1 + BOSS_ENCOUNTER.flawlessApBonus)));
    // Two flawless encounters stack.
    mgr.addRunApBonus(BOSS_ENCOUNTER.flawlessApBonus);
    expect(mgr.getRunApBonus()).toBeCloseTo(BOSS_ENCOUNTER.flawlessApBonus * 2, 6);

    mgr.performAscension({ wave: { highestWave: 60 } } as never);
    expect(mgr.getRunApBonus()).toBe(0);
    expect(mgr.previewAP(60)).toBe(base);
  });

  it('grants a blessing reroll token, which the draft can then spend', () => {
    const mgr = new BlessingManager();
    const before = mgr.rerollsAvailable;
    mgr.grantRerollToken(BOSS_ENCOUNTER.flawlessRerollTokens);
    expect(mgr.rerollsAvailable).toBe(before + BOSS_ENCOUNTER.flawlessRerollTokens);
  });
});

// ── §3.5 what the bar reads ────────────────────────────────────────────────

describe('boss bar inputs (plan §3.5)', () => {
  it('tracks the boss closest to dying, and reports how many are left', () => {
    const h = harness();
    const a = spawnBoss(h, 40);
    const b = h.mgr.spawn('boss', 40, TOWER_X + 2100, TOWER_Y);
    expect(h.mgr.bossAliveCount()).toBe(2);

    b.hp = b.maxHp * 0.4;
    expect(h.mgr.leadBoss()?.id).toBe(b.id);
    a.hp = a.maxHp * 0.1;
    expect(h.mgr.leadBoss()?.id).toBe(a.id);

    a.alive = false;
    b.alive = false;
    expect(h.mgr.bossAliveCount()).toBe(0);
    expect(h.mgr.leadBoss()).toBeNull();
  });

  it('switches to whichever boss is telegraphing a slam', () => {
    const h = harness();
    // Two tier-6 bosses, both in a `slam` phase.
    const focused = h.mgr.spawn('boss', 60, TOWER_X + 2000, TOWER_Y);
    const other = h.mgr.spawn('boss', 60, TOWER_X + 2100, TOWER_Y);
    focused.hp = focused.maxHp * 0.2;
    expect(h.mgr.leadBoss()?.id).toBe(focused.id);

    // A telegraph outranks a low bar: it is the only thing in the encounter
    // with a deadline, and a countdown on a boss the bar is not watching is a
    // countdown the player never sees.
    other.bossSlamTelegraph = 1.5;
    expect(h.mgr.leadBoss()?.id).toBe(other.id);
    // Two at once: the one about to land wins.
    focused.bossSlamTelegraph = 0.4;
    expect(h.mgr.leadBoss()?.id).toBe(focused.id);
  });

  it('reports no boss at all when the field has none', () => {
    const h = harness();
    h.mgr.spawn('normal', 40, TOWER_X, TOWER_Y);
    expect(h.mgr.leadBoss()).toBeNull();
  });
});
