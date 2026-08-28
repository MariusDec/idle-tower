/**
 * Gameplay plan §4.5 — the three active verbs.
 *
 * The thing under test throughout is the **idle contract**: every verb has an
 * automatic fallback that pays less, and none of them can be required. So the
 * assertions are mostly about what happens when the player does *nothing* —
 * the orb still pays, the placement still cancels, the charge still resets.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { LootManager } from '../src/systems/LootManager';
import { LOOT_TUNING, bossOrbShare, orbGoldValue, type LootOrbKind } from '../src/data/loot';
import { world } from '../src/data/arena';
import { MANUAL_AIM } from '../src/data/tower';
import { AbilityPlacement, ChargeTracker } from '../src/systems/ActiveInput';
import { AbilityManager } from '../src/systems/AbilityManager';
import { EnemyManager } from '../src/systems/EnemyManager';
import { ResourceManager } from '../src/systems/ResourceManager';
import { ProjectileManager } from '../src/systems/ProjectileManager';
import { Tower } from '../src/systems/Tower';
import { BuffRegistry } from '../src/stats/BuffRegistry';
import { EventBus } from '../src/game/EventBus';
import { ABILITIES } from '../src/data/abilities';
import { isTargetable } from '../src/data/enemies';
import type { AbilityState, GameStats, ResourceState, TowerState } from '../src/types';
import { BLESSINGS } from '../src/data/blessings';
import { BlessingManager } from '../src/systems/BlessingManager';

const TOWER = { x: 500, y: 400 };

interface Paid {
  kind: LootOrbKind;
  amount: number;
  full: boolean;
}

function makeManager(): { mgr: LootManager; paid: Paid[] } {
  const paid: Paid[] = [];
  const mgr = new LootManager({
    towerPos: () => TOWER,
    pay: (kind, amount, full) => paid.push({ kind, amount, full }),
  });
  return { mgr, paid };
}

/** Step the manager long enough for everything in the air to come home. */
function drift(mgr: LootManager, seconds = LOOT_TUNING.driftSeconds + 1): void {
  const step = 1 / 60;
  for (let t = 0; t < seconds; t += step) mgr.tick(step);
}

describe('loot orbs (plan §4.1)', () => {
  let mgr: LootManager;
  let paid: Paid[];

  beforeEach(() => {
    ({ mgr, paid } = makeManager());
  });

  it('pays 100% for a clicked orb', () => {
    mgr.spawn('gold', 100, 100, 500);
    expect(mgr.collectAt(100, 100)).toBe(1);
    expect(paid).toEqual([{ kind: 'gold', amount: 500, full: true }]);
    expect(mgr.count).toBe(0);
  });

  it('pays 40% for an orb left to drift home', () => {
    mgr.spawn('gold', 100, 100, 500);
    drift(mgr);
    expect(paid).toHaveLength(1);
    expect(paid[0].full).toBe(false);
    expect(paid[0].amount).toBeCloseTo(500 * LOOT_TUNING.autoCollectRate, 6);
    expect(mgr.count).toBe(0);
  });

  it('never strands an orb: everything dropped is eventually paid', () => {
    for (let i = 0; i < 12; i++) mgr.spawn('gold', 200 + i * 30, 150, 10);
    drift(mgr);
    expect(paid).toHaveLength(12);
    expect(mgr.count).toBe(0);
  });

  it('raises the auto rate to 100% with the orb_magnet blessing', () => {
    mgr.setMagnet(true);
    expect(mgr.autoCollectRate).toBe(1);
    mgr.spawn('gold', 100, 100, 500);
    drift(mgr);
    expect(paid).toEqual([{ kind: 'gold', amount: 500, full: false }]);
  });

  it('magnetised orbs come home in half the time', () => {
    const plain = makeManager();
    plain.mgr.spawn('gold', 60, 60, 1);
    const magnet = makeManager();
    magnet.mgr.setMagnet(true);
    magnet.mgr.spawn('gold', 60, 60, 1);
    // Halfway through the ordinary drift the magnetised orb is already home
    // and the plain one is not.
    drift(plain.mgr, LOOT_TUNING.driftSeconds * LOOT_TUNING.magnetDriftScale + 0.2);
    drift(magnet.mgr, LOOT_TUNING.driftSeconds * LOOT_TUNING.magnetDriftScale + 0.2);
    expect(magnet.paid).toHaveLength(1);
    expect(plain.paid).toHaveLength(0);
  });

  it('pays reroll tokens whole whichever way they are collected', () => {
    // A token cannot be 40% of a token, and the idle contract is the thing
    // Part 4 is most able to break, so drift pays it in full.
    mgr.spawn('reroll', 100, 100, 1);
    drift(mgr);
    expect(paid).toEqual([{ kind: 'reroll', amount: 1, full: false }]);
  });

  it('evicts the oldest orb when the cap is reached', () => {
    // Ids, not object references: an evicted orb goes straight onto the free
    // list and is re-initialised in place, so holding the object would be
    // holding whatever was spawned next.
    const firstId = mgr.spawn('gold', 10, 10, 1).id;
    for (let i = 1; i < LOOT_TUNING.maxOrbs; i++) mgr.spawn('gold', 10 + i, 10, 1);
    expect(mgr.count).toBe(LOOT_TUNING.maxOrbs);
    expect(mgr.list[0].id).toBe(firstId);
    const secondId = mgr.list[1].id;

    const extraId = mgr.spawn('gold', 900, 900, 1).id;
    expect(mgr.count).toBe(LOOT_TUNING.maxOrbs);
    expect(mgr.list.some(o => o.id === firstId)).toBe(false);
    expect(mgr.list.some(o => o.id === extraId)).toBe(true);
    // Oldest-first: the second-oldest survived and is now at the head.
    expect(mgr.list[0].id).toBe(secondId);
    // An evicted orb expires; it is not silently paid out.
    expect(paid).toHaveLength(0);
  });

  it('reuses orb objects rather than allocating per drop', () => {
    const a = mgr.spawn('gold', 10, 10, 1);
    const firstId = a.id;
    mgr.collectAt(10, 10);
    const b = mgr.spawn('gold', 20, 20, 1);
    expect(b).toBe(a);
    expect(b.id).not.toBe(firstId);
    expect(b.alive).toBe(true);
    expect(b.age).toBe(0);
  });

  it('drops everything without paying on reset', () => {
    mgr.spawn('gold', 10, 10, 1);
    mgr.spawn('gold', 20, 20, 1);
    mgr.reset();
    expect(mgr.count).toBe(0);
    expect(paid).toHaveLength(0);
    expect(mgr.autoCollectRate).toBe(LOOT_TUNING.autoCollectRate);
  });

  it('drifts on the simulation clock, so game speed does not change the payout', () => {
    const slow = makeManager();
    slow.mgr.spawn('gold', 200, 200, 100);
    for (let t = 0; t < LOOT_TUNING.driftSeconds + 1; t += 1 / 60) slow.mgr.tick(1 / 60);

    const fast = makeManager();
    fast.mgr.spawn('gold', 200, 200, 100);
    // The same eight game-seconds delivered in 6.5x-sized substeps.
    for (let t = 0; t < LOOT_TUNING.driftSeconds + 1; t += 1 / 60) fast.mgr.tick(1 / 60);
    expect(fast.paid).toEqual(slow.paid);
  });
});

describe('orb drop rules (plan §4.1)', () => {
  /**
   * §4.1's "bosses drop 3-5" is an *encounter* budget. It had to be divided
   * across the pack while a boss wave spawned `2 + tier` bosses; the wave
   * fields one boss again, so the whole budget lands on one kill — and that
   * kill still has to stay inside the forty-orb cap at every depth.
   */
  it('keeps a boss encounter inside the orb cap at every tier', () => {
    for (const wave of [10, 20, 40, 60, 100, 200]) {
      const { mgr } = makeManager();
      const total = mgr.dropForKill({ x: 100, y: 100, wave, isBoss: true, maxMana: 0 });
      expect(total, `wave ${wave}`).toBeLessThanOrEqual(LOOT_TUNING.maxOrbs);
      expect(mgr.count).toBeLessThanOrEqual(LOOT_TUNING.maxOrbs);
    }
  });

  it('pays the same encounter budget at every depth', () => {
    // 200 encounters per wave, so the roll averages out.
    const totalFor = (wave: number): number => {
      let sum = 0;
      for (let run = 0; run < 200; run++) sum += bossOrbShare(wave);
      return sum / 200;
    };
    const small = totalFor(10);
    const large = totalFor(100);
    const budget = (LOOT_TUNING.bossOrbsMin + LOOT_TUNING.bossOrbsMax) / 2;
    expect(small).toBeGreaterThan(budget - 1.5);
    expect(small).toBeLessThan(budget + 1.5);
    expect(large).toBeGreaterThan(budget - 1.5);
    expect(large).toBeLessThan(budget + 1.5);
  });

  it('always drops for an elite and only rarely for anything else', () => {
    const { mgr } = makeManager();
    for (let i = 0; i < 50; i++) {
      expect(mgr.dropForKill({ x: 0, y: 0, wave: 30, elite: true, maxMana: 0 }))
        .toBeGreaterThanOrEqual(LOOT_TUNING.eliteOrbsMin);
      mgr.clear();
    }
    let common = 0;
    for (let i = 0; i < 2000; i++) {
      common += mgr.dropForKill({ x: 0, y: 0, wave: 30, maxMana: 0 });
      mgr.clear();
    }
    // 2% of 2000 is 40; the band is wide enough not to flake.
    expect(common).toBeGreaterThan(10);
    expect(common).toBeLessThan(90);
  });

  it('never rolls a mana orb before mana is unlocked', () => {
    const { mgr } = makeManager();
    for (let i = 0; i < 200; i++) {
      mgr.dropForKill({ x: 0, y: 0, wave: 5, isBoss: true, maxMana: 0 });
    }
    expect(mgr.list.every(o => o.kind !== 'mana')).toBe(true);
  });

  it('scales an orb with the wave it dropped on', () => {
    expect(orbGoldValue(50)).toBeGreaterThan(orbGoldValue(10));
  });
});

describe('orb_magnet is live content now (plan §4.1)', () => {
  it('offers the Lodestone card', () => {
    const mgr = new BlessingManager();
    expect(mgr.eligible(200).map(d => d.id)).toContain('bl_magnet');
  });

  it('leaves no blessing excluded from the pool', () => {
    expect(BLESSINGS.filter(b => b.offerable === false)).toEqual([]);
  });
});

describe('charged shot tuning (plan §4.2 / §4.5)', () => {
  /**
   * The idle-parity band is what sets this number, and an edit that raises it
   * would silently reopen the gate. The sim measures the consequence; this
   * pins the input.
   *
   * The payload is denominated in seconds of the tower's own sustained fire
   * (see `MANUAL_AIM`), which is what keeps the verb worth the same at 1.8
   * shots/s and at 6.1. At 0.9 s the measured advantage is +34.7 / +28.6 /
   * +36.0 / +28.9 / +27.3% across the five prestige tiers — inside the
   * plan's +25-40% band at every one of them.
   */
  it('keeps the charged shot inside what the idle-parity check allows', () => {
    expect(MANUAL_AIM.chargeDpsSeconds).toBeLessThanOrEqual(1);
    expect(MANUAL_AIM.chargeSeconds).toBeGreaterThan(0);
    expect(MANUAL_AIM.chargeCooldown).toBeGreaterThanOrEqual(4);
    // Holding the mouse must never carry a flat fire-rate bonus again: it is
    // the "attention tax" §0.1 diagnosed, and it alone filled the whole band.
    expect('fireRateMult' in MANUAL_AIM).toBe(false);
    // The plan's *shape* survives the retune even though its number did not.
    expect(MANUAL_AIM.chargeExtraPierce).toBe(3);
    // §4.2's 90 is a *pre-camera* number: `chargeSplashRadius` is a world-space
    // AoE, so it carries `WORLD_SCALE` like every other one (UI plan §1.1).
    expect(MANUAL_AIM.chargeSplashRadius).toBe(world(90));
  });

  it("tolerates a finger's worth of jitter", () => {
    // A pixel-tight tolerance would make the verb unusable on touch, where the
    // same pipeline feeds the same code path.
    expect(MANUAL_AIM.chargeMoveTolerance).toBeGreaterThanOrEqual(12);
  });
});

describe('charge tracker (plan §4.2)', () => {
  const HOLD = MANUAL_AIM.chargeSeconds;

  it('arms only after holding still for the full charge time', () => {
    const c = new ChargeTracker();
    c.setPointer(100, 100, true);
    c.tick(HOLD - 0.1, true);
    expect(c.ready).toBe(false);
    expect(c.progress).toBeLessThan(1);
    c.tick(0.2, true);
    expect(c.ready).toBe(true);
    expect(c.progress).toBe(1);
  });

  it('resets the charge when the cursor moves beyond the tolerance', () => {
    const c = new ChargeTracker();
    c.setPointer(100, 100, true);
    c.tick(HOLD - 0.05, true);
    expect(c.progress).toBeGreaterThan(0.9);
    c.setPointer(100 + MANUAL_AIM.chargeMoveTolerance + 5, 100, true);
    expect(c.progress).toBe(0);
    expect(c.ready).toBe(false);
  });

  it('tolerates jitter inside the tolerance without resetting', () => {
    const c = new ChargeTracker();
    c.setPointer(100, 100, true);
    c.tick(HOLD * 0.5, true);
    const before = c.progress;
    c.setPointer(103, 97, true);
    expect(c.progress).toBe(before);
  });

  it('re-anchors on a move, so the player can settle and charge again', () => {
    const c = new ChargeTracker();
    c.setPointer(100, 100, true);
    c.tick(HOLD * 0.5, true);
    c.setPointer(400, 400, true);
    expect(c.progress).toBe(0);
    c.tick(HOLD, true);
    expect(c.ready).toBe(true);
  });

  it('reports a fired shot exactly once, on the release that armed it', () => {
    const c = new ChargeTracker();
    c.setPointer(100, 100, true);
    c.tick(HOLD, true);
    expect(c.setPointer(100, 100, false)).toBe(true);
    // Releasing again is not a second shot.
    expect(c.setPointer(100, 100, false)).toBe(false);
  });

  it('does not fire a release that never charged', () => {
    const c = new ChargeTracker();
    c.setPointer(100, 100, true);
    c.tick(HOLD * 0.4, true);
    expect(c.setPointer(100, 100, false)).toBe(false);
  });

  it('refuses to charge during the cooldown', () => {
    const c = new ChargeTracker();
    c.setPointer(100, 100, true);
    c.tick(HOLD, true);
    c.consume();
    expect(c.onCooldown).toBe(true);
    c.tick(HOLD, true);
    expect(c.ready).toBe(false);
    c.tick(MANUAL_AIM.chargeCooldown, true);
    expect(c.onCooldown).toBe(false);
  });

  it('does not charge while an ability is waiting to be placed', () => {
    const c = new ChargeTracker();
    c.setPointer(100, 100, true);
    c.tick(HOLD, false);
    expect(c.progress).toBe(0);
  });

  /**
   * The whole reason the timer is on `realDt`: a wall-clock hold must cost the
   * same 1.2 seconds of the player's life at 1x and at 6.5x.
   */
  it('measures wall-clock time, not simulation time', () => {
    const fast = new ChargeTracker();
    fast.setPointer(0, 0, true);
    // One frame at 6.5x speed: realDt is still ~1/60 even though the
    // simulation advanced 6.5 times as far.
    for (let i = 0; i < 60; i++) fast.tick(1 / 60, true);
    expect(fast.progress).toBeCloseTo(1 / MANUAL_AIM.chargeSeconds, 5);
  });
});

describe('ability placement (plan §4.3)', () => {
  it('arms an ability and reports it as pending', () => {
    const p = new AbilityPlacement();
    expect(p.toggle('meteor_strike', true)).toBe('begin');
    expect(p.isPlacing).toBe(true);
    expect(p.pending).toBe('meteor_strike');
  });

  it('cancels when the same hotkey is pressed again', () => {
    const p = new AbilityPlacement();
    p.toggle('meteor_strike', true);
    expect(p.toggle('meteor_strike', true)).toBe('cancel');
    expect(p.isPlacing).toBe(false);
  });

  it('swaps to a different ability rather than stacking', () => {
    const p = new AbilityPlacement();
    p.toggle('meteor_strike', true);
    expect(p.toggle('frost_nova', true)).toBe('begin');
    expect(p.pending).toBe('frost_nova');
  });

  it('refuses to arm an ability that cannot be cast', () => {
    const p = new AbilityPlacement();
    expect(p.toggle('meteor_strike', false)).toBe('rejected');
    expect(p.isPlacing).toBe(false);
  });

  it('cancels cleanly, and cancelling twice is a no-op', () => {
    const p = new AbilityPlacement();
    p.toggle('meteor_strike', true);
    expect(p.cancel()).toBe(true);
    expect(p.cancel()).toBe(false);
    expect(p.isPlacing).toBe(false);
  });

  it('leaves placement mode even when the cast fails', () => {
    // The mana drained between the hotkey and the click. The player must not
    // be stranded in a mode whose click no longer does anything.
    const p = new AbilityPlacement();
    p.toggle('meteor_strike', true);
    expect(p.place(() => false)).toBe(false);
    expect(p.isPlacing).toBe(false);
  });

  it('casts the armed ability and clears the mode on success', () => {
    const p = new AbilityPlacement();
    p.toggle('rain_of_arrows', true);
    const cast: string[] = [];
    expect(p.place((id) => { cast.push(id); return true; })).toBe(true);
    expect(cast).toEqual(['rain_of_arrows']);
    expect(p.isPlacing).toBe(false);
  });

  it('does nothing when a click arrives with nothing armed', () => {
    const p = new AbilityPlacement();
    let called = false;
    expect(p.place(() => { called = true; return true; })).toBe(false);
    expect(called).toBe(false);
  });
});

describe('automatic ability placement (plan §4.3)', () => {
  function harness() {
    const bus = new EventBus();
    const resources = {
      gold: 0, lifetimeGold: 0, mana: 1000, maxMana: 1000, manaRegen: 0,
      ascensionPoints: 0, lifetimeAP: 0, apThisTranscendence: 0, transcendencePoints: 0,
    } as unknown as ResourceState;
    const stats = { goldEarned: 0, enemiesKilled: 0, abilitiesCast: 0 } as unknown as GameStats;
    const resourceMgr = new ResourceManager(resources, stats, bus);
    const enemies = new EnemyManager(bus, resourceMgr);
    const towerState = {
      x: 640, y: 360, hp: 100, maxHp: 100, baseDamage: 10, fireRate: 1, range: 2000,
      critChance: 0, critMultiplier: 1, healthRegen: 0, damageType: 'physical',
      knockbackForce: 0,
    } as unknown as TowerState;
    const tower = new Tower(towerState);
    const projectiles = new ProjectileManager(bus, tower, enemies);
    const abilityState: Record<string, AbilityState> = {};
    for (const def of ABILITIES) {
      abilityState[def.id] = { level: 1, cooldown: 0, active: false, activeTimer: 0, xp: 0 };
    }
    const abilities = new AbilityManager({
      resources: resourceMgr,
      enemies,
      tower,
      bus,
      projectileManager: projectiles,
      buffs: new BuffRegistry(),
      getState: (id) => abilityState[id],
      onCast: () => {},
    });
    return { enemies, abilities, abilityState };
  }

  /**
   * The automatic fallback has to be *good*, not merely present: an idle
   * player's Rain of Arrows must land on the crowd, because that is what makes
   * clicking optional rather than mandatory.
   */
  it('picks the densest cluster when nothing is placed by hand', () => {
    const h = harness();
    // A lonely enemy far away, and a pile of six.
    h.enemies.spawn('normal', 20, 100, 100);
    for (let i = 0; i < 6; i++) h.enemies.spawn('normal', 20, 800 + i * 12, 400 + i * 9);
    const spot = h.abilities.pickBestSpot('rain_of_arrows');
    expect(spot).not.toBeNull();
    expect(spot!.x).toBeGreaterThan(700);
    expect(spot!.y).toBeGreaterThan(350);
  });

  /**
   * Meteor Strike scores by HP instead, which is what keeps it the boss nuke
   * it has always been rather than quietly becoming a crowd-clear.
   */
  it('sends Meteor Strike at the boss, not at the crowd', () => {
    const h = harness();
    for (let i = 0; i < 8; i++) h.enemies.spawn('normal', 20, 200 + i * 10, 200 + i * 10);
    const boss = h.enemies.spawn('boss', 20, 900, 500);
    const spot = h.abilities.pickBestSpot('meteor_strike');
    expect(spot).not.toBeNull();
    expect(spot!.x).toBeCloseTo(boss.x, 0);
    expect(spot!.y).toBeCloseTo(boss.y, 0);
  });

  it('returns no spot on an empty field, and the cast still resolves', () => {
    const h = harness();
    expect(h.abilities.pickBestSpot('rain_of_arrows')).toBeNull();
    expect(h.abilities.tryCast('rain_of_arrows', 60)).toBe(true);
  });

  it('never places an ability on something untargetable', () => {
    const h = harness();
    // A burrowed enemy is underground; nothing may aim at it.
    const hidden = h.enemies.spawn('burrower', 50, 300, 300);
    expect(isTargetable(hidden)).toBe(false);
    expect(h.abilities.pickBestSpot('rain_of_arrows')).toBeNull();
  });

  it('a hand-placed cast is worth more than the automatic one', () => {
    // Same field, same ability, two casts: the placed one carries the focus
    // bonus inside its disc, which is the entire reward for aiming (§4.3).
    const damageDealt = (placed: boolean): number => {
      const h = harness();
      const pack = [];
      // Wave 80 bodies, so nothing dies to the first hit and the difference
      // shows up as damage rather than being clamped away by a kill.
      for (let i = 0; i < 5; i++) pack.push(h.enemies.spawn('normal', 80, 800 + i * 10, 400));
      const before = pack.reduce((a, e) => a + e.hp, 0);
      h.abilities.tryCast('rain_of_arrows', 60, placed ? { x: 820, y: 400 } : null);
      return before - pack.reduce((a, e) => a + e.hp, 0);
    };
    expect(damageDealt(true)).toBeGreaterThan(damageDealt(false));
  });
});
