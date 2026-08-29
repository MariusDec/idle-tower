/**
 * Pacing: the risk dial, momentum, the combo meter and overkill (plan §7.8).
 *
 * Every mechanic here is silent when it breaks. A momentum counter that never
 * resets looks like a generous game; a combo that decays on the wrong clock
 * looks fine at 1x and pays nothing at 6.5x; a risk dial that raises gold but
 * not HP looks like a balanced difficulty setting until someone notices free
 * ascension points. None of it is visible on screen and none of it is visible
 * to the type system.
 *
 * Everything is driven through the *real* managers at a fixed `dt`, and the
 * combo's decay is driven at both ends of the substep range the game actually
 * uses, because "on the simulation clock" is a claim a test has to make.
 */

import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/game/EventBus';
import { EnemyManager } from '../src/systems/EnemyManager';
import { ResourceManager } from '../src/systems/ResourceManager';
import { ProjectileManager } from '../src/systems/ProjectileManager';
import { WaveManager } from '../src/systems/WaveManager';
import { Tower } from '../src/systems/Tower';
import { PacingManager } from '../src/systems/PacingManager';
import { BlessingManager } from '../src/systems/BlessingManager';
import { PrestigeManager } from '../src/systems/PrestigeManager';
import { resolveStats, emptyStatContext, type StatContext } from '../src/stats';
import { BLESSING_TUNING } from '../src/data/blessings';
import { enemyHPForWave } from '../src/data/formulas';
import { ENEMY_DEFS } from '../src/data/enemies';
import {
  COMBO_TIERS,
  COMBO_WINDOW_SECONDS,
  EARLY_CALL_DELAY_SECONDS,
  EARLY_CALL_GOLD_PER_SECOND,
  MAX_RISK,
  MOMENTUM_CAP,
  OVERKILL_CARRY_BASE,
  RISK_GOLD_PER_STEP,
  RISK_HP_PER_STEP,
  RISK_SPEED_PER_STEP,
  comboTierIndex,
  intermissionFactorForWave,
  intermissionSecondsForWave,
  riskApBonus,
} from '../src/data/pacing';
import type {
  GameStats,
  PrestigeState,
  ResourceState,
  TowerState,
} from '../src/types';

/** One substep at the game's fixed rate — `Game.update`'s floor. */
const DT = 1 / 120;
/** The coarsest substep the loop ever runs: a 60 Hz frame at 6.5x speed. */
const DT_FAST = (6.5 / 60) / 6;

const ARENA_W = 800;
const ARENA_H = 600;
const TOWER_X = 400;
const TOWER_Y = 300;

function makeResources(gold = 0): ResourceManager {
  const state: ResourceState = {
    gold,
    mana: 0,
    maxMana: 100,
    manaRegen: 0,
    ascensionPoints: 0,
    apThisTranscendence: 0,
    transcendencePoints: 0,
    lifetimeAP: 0,
    lifetimeGold: 0,
  } as unknown as ResourceState;
  const stats = { goldEarned: 0, enemiesKilled: 0 } as unknown as GameStats;
  return new ResourceManager(state, stats, new EventBus());
}


/**
 * Run a wave to its intermission with no tower on the field.
 *
 * Two things this has to do that a naive loop does not. Enemies are cleared
 * every step, because the harness has nothing that shoots. And spawning is
 * resumed after every `startWave`: a wave rolls a 4% mutator offer (and every
 * boss wave rolls one outright), which pauses spawning until a modal that does
 * not exist here closes it — the 4%-per-run flake Part 3 found in
 * `enemies.test.ts`.
 */
function clearToIntermission(waves: WaveManager, enemies: EnemyManager, steps = 20_000): void {
  waves.resumeSpawning();
  for (let i = 0; i < steps && !waves.snapshot.intermission; i++) {
    enemies.reset();
    waves.tick(DT);
    waves.resumeSpawning();
  }
}

// ────────────────────────────────────────────────────────────────────────────
// §7.1 Call the wave early
// ────────────────────────────────────────────────────────────────────────────

describe('call the wave early (plan §7.1)', () => {
  it('banks +1% gold per second skipped and caps the momentum counter', () => {
    const p = new PacingManager();
    p.noteWaveCalledEarly(5);
    expect(p.momentumBonus).toBeCloseTo(5 * EARLY_CALL_GOLD_PER_SECOND, 6);
    expect(p.momentumStreak).toBe(1);

    // Enough consecutive calls to blow well past the ceiling.
    for (let i = 0; i < 20; i++) p.noteWaveCalledEarly(5);
    expect(p.momentumBonus).toBe(MOMENTUM_CAP);
    // The streak keeps counting even once the bonus is pinned — it is what the
    // HUD shows, and a streak that stopped at the cap would read as broken.
    expect(p.momentumStreak).toBe(21);
  });

  it('resets momentum when the tower takes damage', () => {
    const p = new PacingManager();
    p.noteWaveCalledEarly(5);
    expect(p.momentumBonus).toBeGreaterThan(0);
    p.noteTowerDamaged();
    expect(p.momentumBonus).toBe(0);
    expect(p.momentumStreak).toBe(0);
  });

  it('resets momentum when a wave runs its full intermission', () => {
    const p = new PacingManager();
    p.noteWaveCalledEarly(5);
    p.noteWaveStarted();
    // The call was consumed by that wave start, so the streak survives it.
    expect(p.momentumBonus).toBeGreaterThan(0);
    // The next wave arrived on its own — the streak is over.
    p.noteWaveStarted();
    expect(p.momentumBonus).toBe(0);
  });

  it('opens the call window mid-wave, once the roster is out and the delay is up', () => {
    const bus = new EventBus();
    const enemies = new EnemyManager(bus, makeResources());
    enemies.setBounds(ARENA_W, ARENA_H);
    const waves = new WaveManager(bus, enemies, ARENA_W, ARENA_H, () => {}, () => {});

    // Wave 40 takes ~20 s to finish spawning, and nothing kills the enemies
    // here — so the field stays full and the wave never clears on its own.
    waves.startWave(41);
    waves.resumeSpawning();
    expect(waves.canCallEarly()).toBe(false);

    for (let i = 0; i < 60 / DT && !waves.canCallEarly(); i++) waves.tick(DT);

    // The call is live with the wave still running and enemies still alive.
    expect(waves.snapshot.intermission).toBe(false);
    expect(enemies.aliveCount()).toBeGreaterThan(0);
    expect(waves.snapshot.elapsed).toBeGreaterThanOrEqual(EARLY_CALL_DELAY_SECONDS);
    expect(waves.snapshot.spawning).toBe(false);
    expect(waves.earlyCallRemaining()).toBeGreaterThan(0);

    // Calling credits the wave it abandons and starts the next one on the spot,
    // stragglers and all.
    let cleared = -1;
    bus.on('wave_cleared', (w: unknown) => { cleared = w as number; });
    const banked = waves.callWaveEarly();
    expect(banked).toBeGreaterThan(0);
    expect(cleared).toBe(41);
    expect(waves.currentWave).toBe(42);
    expect(waves.snapshot.intermission).toBe(false);
    expect(enemies.aliveCount()).toBeGreaterThan(0);
    // The new wave closes the window until it earns its own.
    expect(waves.earlyCallRemaining()).toBe(0);
  });

  it('opens a full window on a wave cleared faster than the delay', () => {
    const bus = new EventBus();
    const enemies = new EnemyManager(bus, makeResources());
    enemies.setBounds(ARENA_W, ARENA_H);
    const waves = new WaveManager(bus, enemies, ARENA_W, ARENA_H, () => {}, () => {});

    waves.startWave(3);
    clearToIntermission(waves, enemies);
    expect(waves.snapshot.intermission).toBe(true);
    // A fast clear is not punished for never reaching the mid-wave unlock, and
    // the window is far longer than the 3 s intermission it used to be worth.
    expect(waves.earlyCallRemaining()).toBe(waves.earlyCallWindowLength());
    expect(waves.earlyCallRemaining()).toBeGreaterThan(waves.intermissionRemaining());

    // It drains through the intermission, and the call banks what is left of
    // the window rather than what is left of the intermission.
    waves.tick(DT);
    const banked = waves.callWaveEarly();
    expect(banked).toBeCloseTo(waves.earlyCallWindowLength() - DT, 6);
  });

  it('is refused while the intermission is paused, which is what a modal does', () => {
    const bus = new EventBus();
    const enemies = new EnemyManager(bus, makeResources());
    enemies.setBounds(ARENA_W, ARENA_H);
    const waves = new WaveManager(bus, enemies, ARENA_W, ARENA_H, () => {}, () => {});

    // Mid-wave: nothing to call.
    expect(waves.canCallEarly()).toBe(false);
    expect(waves.callWaveEarly()).toBe(0);

    // Clear the wave into an intermission.
    waves.startWave(3);
    clearToIntermission(waves, enemies);
    expect(waves.snapshot.intermission).toBe(true);
    expect(waves.canCallEarly()).toBe(true);

    // Every modal in the game pauses the intermission before it opens; while it
    // is paused the wave cannot be called out from under the decision.
    waves.pauseIntermission();
    expect(waves.canCallEarly()).toBe(false);
    expect(waves.callWaveEarly()).toBe(0);
    expect(waves.snapshot.intermission).toBe(true);

    waves.resumeIntermission();
    const skipped = waves.callWaveEarly();
    expect(skipped).toBeGreaterThan(0);
    expect(waves.snapshot.intermission).toBe(false);
    expect(waves.currentWave).toBe(4);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// §7.2 Combo meter
// ────────────────────────────────────────────────────────────────────────────

describe('combo meter (plan §7.2)', () => {
  it('tiers at 10/25/50/100 and pays the stated gold and XP', () => {
    const p = new PacingManager();
    expect(comboTierIndex(9)).toBe(0);
    for (let i = 0; i < 9; i++) p.noteKill();
    expect(p.comboTierIndex).toBe(0);
    expect(p.comboBonus).toEqual({ gold: 0, xp: 0 });

    const seen: number[] = [];
    for (let kills = 9; kills < 100; kills++) {
      p.noteKill();
      seen.push(p.comboTierIndex);
    }
    expect(p.combo).toBe(100);
    expect(p.comboTierIndex).toBe(COMBO_TIERS.length);
    expect(new Set(seen)).toEqual(new Set([1, 2, 3, 4]));

    for (let tier = 1; tier <= COMBO_TIERS.length; tier++) {
      const fresh = new PacingManager();
      for (let i = 0; i < COMBO_TIERS[tier - 1].kills; i++) fresh.noteKill();
      expect(fresh.comboTierIndex).toBe(tier);
      expect(fresh.comboBonus.gold).toBe(COMBO_TIERS[tier - 1].gold);
      expect(fresh.comboBonus.xp).toBe(COMBO_TIERS[tier - 1].xp);
    }
  });

  /**
   * The decay window is **simulation** time. Kills are simulation events, so
   * the interval between two of them is a simulation-time quantity — and if the
   * clock were wall-clock, a 2 s window would be 0.3 s at 6.5x speed and no
   * combo would ever chain. Driving the same elapsed game time at both ends of
   * the substep range is the only way to assert that.
   */
  it.each([DT, DT_FAST])('decays on the simulation clock at dt=%s', (dt) => {
    const p = new PacingManager();
    for (let i = 0; i < 12; i++) p.noteKill();
    expect(p.comboTierIndex).toBe(1);

    // Just inside the window: still alive, and visibly draining.
    const steps = Math.floor((COMBO_WINDOW_SECONDS * 0.75) / dt);
    for (let i = 0; i < steps; i++) p.tickCombo(dt);
    expect(p.combo).toBe(12);
    expect(p.comboFraction).toBeLessThan(0.35);
    expect(p.comboFraction).toBeGreaterThan(0);

    // Past the window: gone.
    for (let i = 0; i < steps; i++) p.tickCombo(dt);
    expect(p.combo).toBe(0);
    expect(p.comboTierIndex).toBe(0);
    expect(p.comboBonus.gold).toBe(0);
  });

  it('refreshes the window on every kill', () => {
    const p = new PacingManager();
    for (let i = 0; i < 30; i++) {
      p.noteKill();
      // 1.5 s between kills — inside the 2 s window every time.
      for (let s = 0; s < Math.round(1.5 / DT); s++) p.tickCombo(DT);
    }
    expect(p.combo).toBe(30);
    expect(p.comboTierIndex).toBe(2);
  });

  it('resolves its tier into gold and XP through the stat pipeline', () => {
    const at = (comboTier: number) => resolveStats({
      ...emptyStatContext(),
      pacing: { risk: 0, momentum: 0, comboTier },
    } as StatContext).stats;

    const none = at(0);
    for (let tier = 1; tier <= COMBO_TIERS.length; tier++) {
      const t = COMBO_TIERS[tier - 1];
      const s = at(tier);
      expect(s.goldMultiplier).toBeCloseTo(none.goldMultiplier * (1 + t.gold), 6);
      expect(s.xpGainMultiplier).toBeCloseTo(none.xpGainMultiplier * (1 + t.xp), 6);
    }
  });

  it('does not survive a save round trip', () => {
    const p = new PacingManager();
    for (let i = 0; i < 40; i++) p.noteKill();
    const snap = p.snapshot();
    expect(snap.comboBest).toBe(40);

    const loaded = new PacingManager();
    loaded.restore(snap);
    // A combo decays in two seconds; a load is never inside that window.
    expect(loaded.combo).toBe(0);
    expect(loaded.comboBestThisRun).toBe(40);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// §7.4 Risk dial
// ────────────────────────────────────────────────────────────────────────────

describe('risk dial (plan §7.4)', () => {
  it('takes effect at the next wave, not immediately', () => {
    const p = new PacingManager();
    p.setRisk(3);
    expect(p.riskLevel).toBe(3);
    expect(p.activeRisk).toBe(0);
    expect(p.riskPending).toBe(true);

    p.noteWaveStarted();
    expect(p.activeRisk).toBe(3);
    expect(p.riskPending).toBe(false);
  });

  it('clamps to 0..MAX_RISK', () => {
    const p = new PacingManager();
    expect(p.setRisk(-4)).toBe(0);
    expect(p.setRisk(99)).toBe(MAX_RISK);
    expect(p.setRisk(2.7)).toBe(2);
  });

  it('applies to enemy HP and to the reward, at every step', () => {
    const base = resolveStats({
      ...emptyStatContext(),
      pacing: { risk: 0, momentum: 0, comboTier: 0 },
    } as StatContext).stats;

    for (let risk = 0; risk <= MAX_RISK; risk++) {
      const s = resolveStats({
        ...emptyStatContext(),
        pacing: { risk, momentum: 0, comboTier: 0 },
      } as StatContext).stats;
      expect(s.enemyHpMult).toBeCloseTo(1 + RISK_HP_PER_STEP * risk, 6);
      expect(s.enemySpeedMult).toBeCloseTo(1 + RISK_SPEED_PER_STEP * risk, 6);
      expect(s.goldMultiplier)
        .toBeCloseTo(base.goldMultiplier * (1 + RISK_GOLD_PER_STEP * risk), 6);
    }
  });

  it('actually scales spawned enemy HP through the same stat', () => {
    const bus = new EventBus();
    const enemies = new EnemyManager(bus, makeResources());
    enemies.setBounds(ARENA_W, ARENA_H);
    enemies.beginWave(30);
    const plain = enemies.spawn('normal', 30, 10, 10).maxHp;

    const risky = new EnemyManager(bus, makeResources());
    risky.setBounds(ARENA_W, ARENA_H);
    risky.beginWave(30);
    risky.setStatHpMult(1 + RISK_HP_PER_STEP * MAX_RISK);
    const scaled = risky.spawn('normal', 30, 10, 10).maxHp;

    expect(scaled).toBeGreaterThan(plain);
    expect(scaled / plain).toBeCloseTo(1 + RISK_HP_PER_STEP * MAX_RISK, 1);
    // And the baseline is the shared curve, so risk 0 is the untouched game.
    expect(plain).toBeCloseTo(enemyHPForWave(ENEMY_DEFS.normal.baseHP, 30), 5);
  });

  it('multiplies the AP preview without touching the banked run bonuses', () => {
    const stats = { lifetimeAscensions: 5 } as unknown as GameStats;
    const prestige = new PrestigeManager(new EventBus(), {
      resources: { ascensionPoints: 0, apThisTranscendence: 0 } as unknown as ResourceState,
      prestige: { apSpent: {}, tpSpent: {} } as unknown as PrestigeState,
      stats,
    } as never);

    const plain = prestige.previewAP(60);
    prestige.addRunApBonus(0.10, 'boss');
    const withBoss = prestige.previewAP(60);
    prestige.setRiskApBonus(riskApBonus(MAX_RISK));
    const withBoth = prestige.previewAP(60);

    expect(withBoss).toBeGreaterThan(plain);
    // Risk composes multiplicatively with the banked bonus rather than being
    // summed into it — the banked pool has a +50% cap that risk is not part of.
    expect(withBoth).toBeCloseTo(
      Math.floor(withBoss * (1 + riskApBonus(MAX_RISK))),
      -1,
    );
    // And the boss bonus is still there afterwards.
    expect(prestige.getRunApBonus()).toBeCloseTo(0.10, 6);
  });

  it('survives an ascension, because it is a preference rather than a reward', () => {
    const p = new PacingManager();
    p.setRisk(4);
    p.noteWaveCalledEarly(5);
    for (let i = 0; i < 30; i++) p.noteKill();

    p.reset();
    expect(p.riskLevel).toBe(4);
    expect(p.activeRisk).toBe(4);
    expect(p.momentumBonus).toBe(0);
    expect(p.combo).toBe(0);
    expect(p.comboBestThisRun).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// §7.5 Overkill carry
// ────────────────────────────────────────────────────────────────────────────

describe('overkill carry (plan §7.5)', () => {
  function overkillHarness(blessings?: BlessingManager) {
    const bus = new EventBus();
    const enemies = new EnemyManager(bus, makeResources());
    enemies.setBounds(1280, 720);
    const towerState = {
      x: 100, y: 300, hp: 100, maxHp: 100, baseDamage: 1, fireRate: 1, range: 2000,
      critChance: 0, critMultiplier: 1, healthRegen: 0, damageType: 'physical',
      knockbackForce: 0,
    } as unknown as TowerState;
    const projectiles = new ProjectileManager(bus, new Tower(towerState), enemies);
    projectiles.setBounds(1280, 720);
    if (blessings) projectiles.setBlessings(blessings);
    return { enemies, towerState, projectiles };
  }

  /** Kill `victim` with a shot carrying `damage`, with `bystander` nearby. */
  function fireAt(
    h: ReturnType<typeof overkillHarness>,
    victim: ReturnType<EnemyManager['spawn']>,
    damage: number,
  ): void {
    h.projectiles.fire(victim, h.towerState, {
      rawDamage: damage, damageType: 'physical', isCrit: false, targetId: victim.id,
    });
    for (let i = 0; i < 200; i++) h.projectiles.tick(DT);
  }

  it('carries 10% of the excess to the nearest other enemy', () => {
    const h = overkillHarness();
    const victim = h.enemies.spawn('normal', 1, 400, 300);
    const bystander = h.enemies.spawn('normal', 1, 440, 300);
    bystander.hp = bystander.maxHp = 1e9;
    const hpBefore = victim.hp;
    const damage = hpBefore + 10_000;

    fireAt(h, victim, damage);

    expect(victim.alive).toBe(false);
    const carried = bystander.maxHp - bystander.hp;
    // The excess is `damage - hp`, minus the enemy's flat armour on the hit.
    expect(carried).toBeGreaterThan(0);
    expect(carried).toBeCloseTo(Math.floor(10_000 * OVERKILL_CARRY_BASE), -2);
  });

  it('carries 25% when the blessing is held — one mechanism, two rates', () => {
    const blessed = new BlessingManager();
    expect(blessed.choose('bl_overkill')).toBe(true);
    const h = overkillHarness(blessed);
    const victim = h.enemies.spawn('normal', 1, 400, 300);
    const bystander = h.enemies.spawn('normal', 1, 440, 300);
    bystander.hp = bystander.maxHp = 1e9;
    fireAt(h, victim, victim.hp + 10_000);

    const carried = bystander.maxHp - bystander.hp;
    expect(carried).toBeCloseTo(Math.floor(10_000 * BLESSING_TUNING.overkillCarry), -2);
    expect(BLESSING_TUNING.overkillCarry).toBeGreaterThan(OVERKILL_CARRY_BASE);
  });

  it('never carries to a dead enemy', () => {
    const h = overkillHarness();
    const victim = h.enemies.spawn('normal', 1, 400, 300);
    const corpse = h.enemies.spawn('normal', 1, 420, 300);
    corpse.hp = corpse.maxHp = 1e9;
    h.enemies.damage(corpse, 1e9, false);
    expect(corpse.alive).toBe(false);
    const corpseHpAfterDeath = corpse.hp;

    fireAt(h, victim, victim.hp + 10_000);

    expect(victim.alive).toBe(false);
    expect(corpse.hp).toBe(corpseHpAfterDeath);
  });

  it('never carries to an untargetable enemy', () => {
    const h = overkillHarness();
    const victim = h.enemies.spawn('normal', 1, 400, 300);
    const hidden = h.enemies.spawn('normal', 1, 420, 300);
    hidden.hp = hidden.maxHp = 1e9;
    // The same flag a splitter child and a burrowed burrower carry.
    hidden.spawnProtection = 2;

    fireAt(h, victim, victim.hp + 10_000);

    expect(victim.alive).toBe(false);
    expect(hidden.hp).toBe(hidden.maxHp);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// §7.3 Threat preview / §7.6 Intermission
// ────────────────────────────────────────────────────────────────────────────

describe('next-wave threat preview (plan §7.3)', () => {
  it('describes the wave that is actually going to spawn', () => {
    const bus = new EventBus();
    const enemies = new EnemyManager(bus, makeResources());
    enemies.setBounds(ARENA_W, ARENA_H);
    const waves = new WaveManager(bus, enemies, ARENA_W, ARENA_H, () => {}, () => {});

    // No preview outside an intermission.
    waves.startWave(45);
    expect(waves.previewNextWave()).toBeNull();

    clearToIntermission(waves, enemies);
    const preview = waves.previewNextWave();
    expect(preview).not.toBeNull();
    expect(preview!.wave).toBe(46);
    expect(preview!.count).toBeGreaterThan(0);
    expect(preview!.lanes.length).toBeGreaterThan(0);
    // Every named threat is a type the roster actually holds.
    const named = preview!.threats.reduce((a, t) => a + t.count, 0);
    expect(named).toBeLessThanOrEqual(preview!.count);

    // And the promise is kept: the wave spawns exactly what was previewed.
    const spawned = new Map<string, number>();
    waves.callWaveEarly();
    waves.resumeSpawning();
    for (let i = 0; i < 20_000 && waves.snapshot.spawning; i++) {
      waves.tick(DT);
      waves.resumeSpawning();
    }
    for (const e of enemies.list) {
      spawned.set(e.type, (spawned.get(e.type) ?? 0) + 1);
    }
    expect(enemies.list.length).toBe(preview!.count);
    for (const t of preview!.threats) {
      expect(spawned.get(t.type) ?? 0).toBe(t.count);
    }
  });

  it('flags a boss wave', () => {
    const bus = new EventBus();
    const enemies = new EnemyManager(bus, makeResources());
    enemies.setBounds(ARENA_W, ARENA_H);
    const waves = new WaveManager(bus, enemies, ARENA_W, ARENA_H, () => {}, () => {});
    waves.startWave(19);
    clearToIntermission(waves, enemies);
    expect(waves.previewNextWave()!.isBoss).toBe(true);
  });
});

describe('intermission length (plan §7.6)', () => {
  it('steps at waves 20 and 50 and nowhere else', () => {
    expect(intermissionSecondsForWave(1)).toBe(5);
    expect(intermissionSecondsForWave(20)).toBe(5);
    expect(intermissionSecondsForWave(21)).toBe(3);
    expect(intermissionSecondsForWave(50)).toBe(3);
    expect(intermissionSecondsForWave(51)).toBe(2);
    expect(intermissionSecondsForWave(500)).toBe(2);
  });

  it('routes through `intermissionMultiplier` rather than a new mechanism', () => {
    for (const wave of [1, 20, 21, 50, 51, 120]) {
      const stats = resolveStats({ ...emptyStatContext(), wave } as StatContext).stats;
      expect(stats.intermissionMultiplier).toBeCloseTo(intermissionFactorForWave(wave), 6);
      expect(stats.intermissionMultiplier * 5).toBeCloseTo(intermissionSecondsForWave(wave), 6);
    }
  });

  it('composes with the research node instead of one of them winning', () => {
    const ctx = {
      ...emptyStatContext(),
      wave: 60,
      research: { ...emptyStatContext().research, intermissionSpeedReduction: 0.25 },
    } as StatContext;
    const stats = resolveStats(ctx).stats;
    // 0.4 (depth) x 0.75 (research) = 0.30, floored by the stat's own clamp.
    expect(stats.intermissionMultiplier).toBeCloseTo(0.4 * 0.75, 6);
  });

  it('shortens the actual timer the wave manager sets', () => {
    const bus = new EventBus();
    const enemies = new EnemyManager(bus, makeResources());
    enemies.setBounds(ARENA_W, ARENA_H);
    const waves = new WaveManager(bus, enemies, ARENA_W, ARENA_H, () => {}, () => {});
    // Wave 61, not 60: a boss wave pauses spawning on its mutator offer and
    // only the modal resumes it, so a headless harness on wave 60 spawns
    // nothing and never clears (the flake Part 3 found in `enemies.test.ts`).
    waves.setIntermissionMultiplier(intermissionFactorForWave(61));
    waves.startWave(61);
    clearToIntermission(waves, enemies);
    expect(waves.snapshot.intermissionTimer).toBeCloseTo(2, 1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Momentum through the pipeline
// ────────────────────────────────────────────────────────────────────────────

describe('momentum through the stat pipeline', () => {
  it('multiplies gold and nothing else', () => {
    const base = resolveStats(emptyStatContext()).stats;
    const withMomentum = resolveStats({
      ...emptyStatContext(),
      pacing: { risk: 0, momentum: MOMENTUM_CAP, comboTier: 0 },
    } as StatContext).stats;
    expect(withMomentum.goldMultiplier)
      .toBeCloseTo(base.goldMultiplier * (1 + MOMENTUM_CAP), 6);
    expect(withMomentum.baseDamage).toBe(base.baseDamage);
    expect(withMomentum.fireRate).toBe(base.fireRate);
    expect(withMomentum.enemyHpMult).toBe(base.enemyHpMult);
  });

  it('changes the stat signature exactly when a resolve is needed', () => {
    const p = new PacingManager();
    const first = p.statSignature();
    p.tickCombo(DT);
    expect(p.statSignature()).toBe(first);
    for (let i = 0; i < 9; i++) p.noteKill();
    expect(p.statSignature()).toBe(first);
    p.noteKill();
    expect(p.statSignature()).not.toBe(first);
  });
});
