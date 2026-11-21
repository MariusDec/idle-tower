import { describe, expect, it } from 'vitest';
import { createRun, step } from '../src/sim/run';
import { buildRunConfig } from '../src/meta/runConfig';
import { newProfile } from '../src/meta/profile';
import { SIM_DT } from '../src/app/loop';
import { ABYSS_INDEX } from '../src/content/abyss';
import { BALANCE } from '../src/content/balance';
import { EVOLUTION_OF } from '../src/content/evolutions';
import { FEATS } from '../src/content/feats';
import type { BehaviourId } from '../src/content/types';
import { Rng } from '../src/core/rng';
import { capstoneRanks, featProgress } from '../src/meta/feats';
import { armed, newWeapon } from '../src/sim/systems/arms';
import { damageEnemy } from '../src/sim/systems/combat';
import { applyCard, evolutionCards, fallbackCards, rollOffer } from '../src/sim/systems/draft';
import { healTower, hurtTower, tickBulwark, windMark } from '../src/sim/systems/tower';
import { castUltimate, tickUltimate } from '../src/sim/systems/ultimate';
import { scoreCard } from '../src/sim/suggest';
import type { RunState } from '../src/sim/state';
import { body } from './helpers/body';

/**
 * The mastery capstones (plans/mastery-capstones.md): each rank a rule that
 * turns what the game throws away into power.
 */

function plainRun(seed = 1): RunState {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  return createRun(buildRunConfig(p), seed);
}

function withRanks(ranks: Partial<Record<BehaviourId, number>>, seed = 1): RunState {
  const run = plainRun(seed);
  Object.assign(run.behaviours, ranks);
  return run;
}

const C = BALANCE.capstones;

describe('Might Mastery: the bank', () => {
  it('rank 1: overkill with nowhere to go is banked, and the next weapon hit spends it', () => {
    const run = withRanks({ 'might-capstone': 1 });
    const a = body(run, { hp: 10, maxHp: 10 });
    damageEnemy(run, a, 50, false, 'homing');
    expect(a.alive).toBe(false);
    expect(run.capstones.bank).toBeCloseTo(40);
    const b = body(run);
    damageEnemy(run, b, 10, false, 'homing');
    expect(b.hp).toBeCloseTo(50);
    expect(run.capstones.bank).toBe(0);
  });

  it('the bank holds at most twice the last weapon hit', () => {
    const run = withRanks({ 'might-capstone': 1 });
    damageEnemy(run, body(run, { hp: 10, maxHp: 10 }), 15, false, 'homing');
    expect(run.capstones.bank).toBeCloseTo(5);
    // A kill by anything else banks too, but the cap is the last weapon hit's.
    damageEnemy(run, body(run, { hp: 10, maxHp: 10 }), 1000, false, 'thorns');
    expect(run.capstones.bank).toBeCloseTo(C.bankCap * 15);
  });

  it('a hit from anything but a weapon neither spends the bank nor sets its cap', () => {
    const run = withRanks({ 'might-capstone': 1 });
    run.capstones.bank = 30;
    run.capstones.lastHit = 20;
    const b = body(run);
    damageEnemy(run, b, 10, false, 'thorns');
    expect(b.hp).toBeCloseTo(90);
    expect(run.capstones.bank).toBe(30);
    expect(run.capstones.lastHit).toBe(20);
  });

  it('without a rank, nothing is banked', () => {
    const run = plainRun();
    damageEnemy(run, body(run, { hp: 10, maxHp: 10 }), 50, false, 'homing');
    expect(run.capstones.bank).toBe(0);
  });

  it('rank 2: overkill chains, three leaps in all, and what is left after is banked', () => {
    const run = withRanks({ 'might-capstone': 2, overkill: 1 });
    const chain = [200, 270, 340, 410].map((x) => body(run, { x, hp: 10, maxHp: 10 }));
    const last = body(run, { x: 480 });
    damageEnemy(run, chain[0], 500, false, 'homing');
    expect(chain.every((e) => !e.alive)).toBe(true);
    expect(last.hp).toBe(100);
    expect(run.capstones.bank).toBeCloseTo(460);
  });

  it('rank 3: a banked kill runs Executioner on the bodies around it', () => {
    const run = withRanks({ 'might-capstone': 3, executioner: 1 });
    run.capstones.bank = 50;
    run.capstones.lastHit = 50;
    const a = body(run, { hp: 10, maxHp: 10 });
    const low = body(run, { x: 260, hp: 5 });
    const high = body(run, { x: 260, y: 40, hp: 50 });
    const far = body(run, { x: 600, hp: 5 });
    damageEnemy(run, a, 5, false, 'homing');
    expect(a.alive).toBe(false);
    expect(low.alive).toBe(false);
    expect(high.alive).toBe(true);
    expect(far.alive).toBe(true);
  });

  it('rank 3 without Executioner doubles the bank cap instead', () => {
    const run = withRanks({ 'might-capstone': 3 });
    run.capstones.lastHit = 10;
    damageEnemy(run, body(run, { hp: 10, maxHp: 10 }), 1000, false, 'thorns');
    expect(run.capstones.bank).toBeCloseTo(C.bankCap * C.bankCapNoExecute * 10);
  });
});

describe('Bulwark Mastery: the overflow shield', () => {
  it('rank 1: healing at full HP becomes a shield, capped, that fades and is struck first', () => {
    const run = withRanks({ 'bulwark-capstone': 1 });
    const max = run.stats.maxHp;
    healTower(run, max);
    expect(run.tower.hp).toBe(max);
    expect(run.capstones.shield).toBeCloseTo(max * C.shieldCap);
    tickBulwark(run, 1);
    expect(run.capstones.shield).toBeCloseTo(max * C.shieldCap * (1 - C.shieldDecay));
    const shield = run.capstones.shield;
    const taken = hurtTower(run, 5 + run.stats.armor, 0, 0, null, 'shots');
    expect(taken).toBe(0);
    expect(run.tower.hp).toBe(max);
    expect(run.capstones.shield).toBeLessThan(shield);
  });

  it('without a rank, overflow healing is lost, as before', () => {
    const run = plainRun();
    healTower(run, run.stats.maxHp);
    expect(run.capstones.shield).toBe(0);
  });

  it('rank 2: a full shield bursts on everything in range, ranged or not, and empties', () => {
    const run = withRanks({ 'bulwark-capstone': 2 });
    const max = run.stats.maxHp;
    const near = body(run, { x: 100, hp: 1e6, maxHp: 1e6 });
    const out = body(run, { x: run.stats.range + 100, hp: 1e6, maxHp: 1e6 });
    healTower(run, max);
    expect(run.capstones.shield).toBe(0);
    expect(1e6 - near.hp).toBeCloseTo(max * C.shieldCap);
    expect(out.hp).toBe(1e6);
    expect(run.damageBy.burst).toBeCloseTo(max * C.shieldCap);
  });

  it('rank 3: Second Wind comes back every ten waves, or three Abyss floors', () => {
    const run = withRanks({ 'bulwark-capstone': 3, 'second-wind': 1 });
    run.revives = 0;
    run.wave = 9;
    tickBulwark(run, SIM_DT);
    expect(run.revives).toBe(0);
    run.wave = 10;
    tickBulwark(run, SIM_DT);
    expect(run.revives).toBe(1);
    run.revives = 0;
    tickBulwark(run, SIM_DT);
    expect(run.revives).toBe(0);
    expect(windMark(ABYSS_INDEX, 999, 2)).toBe(0);
    expect(windMark(ABYSS_INDEX, 999, 3)).toBe(1);
  });
});

describe('Arsenal Mastery: Overlevels', () => {
  /** A tower with nothing left to draft: its one weapon maxed, no pool. */
  function spent(rank: number): RunState {
    const run = withRanks({ 'arsenal-capstone': rank });
    run.pool = [];
    run.weapons[0].level = BALANCE.maxLevel;
    return run;
  }

  it('rank 1: an Overlevel takes Windfall’s place, and Mend stays', () => {
    const run = spent(1);
    const hand = rollOffer(run, new Rng(1), 3);
    expect(hand.map((c) => c.kind)).toEqual(['fallback', 'overlevel']);
    expect(hand[0]).toEqual({ kind: 'fallback', id: 'heal' });
    expect(hand.some((c) => c.kind === 'fallback' && c.id === 'shards')).toBe(false);
    expect(fallbackCards(spent(0)).map((c) => c.kind === 'fallback' && c.id)).toEqual(['heal', 'shards']);
  });

  it('Windfall stays for a tower with no weapon at its last level', () => {
    const run = withRanks({ 'arsenal-capstone': 1 });
    expect(fallbackCards(run)).toEqual([{ kind: 'fallback', id: 'heal' }, { kind: 'fallback', id: 'shards' }]);
  });

  it('one Overlevel per eligible weapon, never two alike', () => {
    const run = spent(1);
    run.weapons.push({ ...newWeapon('frost-ring', BALANCE.maxLevel) });
    const keys = fallbackCards(run, new Rng(3)).filter((c) => c.kind === 'overlevel').map((c) => c.kind === 'overlevel' && c.id);
    expect(new Set(keys).size).toBe(2);
  });

  it('an Overlevel stacks +25% damage; from rank 2 a bolt more too, and the scorer values it', () => {
    const run = spent(2);
    const w = run.weapons[0];
    const before = armed(run.stats, w);
    expect(scoreCard(run, { kind: 'overlevel', id: w.id })).toBeGreaterThan(0);
    applyCard(run, { kind: 'overlevel', id: w.id });
    applyCard(run, { kind: 'overlevel', id: w.id });
    const after = armed(run.stats, w);
    expect(w.overlevel).toBe(2);
    expect(w.overcount).toBe(2);
    const cap = BALANCE.caps.bolts;
    const count = before.count + 2;
    // Past the cap, a body becomes damage (§12.5).
    expect(after.count).toBe(Math.min(cap, count));
    expect(after.damage).toBeCloseTo(before.damage * (1 + 2 * C.overlevelDamage) * Math.max(1, count / cap) / Math.max(1, before.count / cap));
  });

  it('rank 3: a weapon evolves with its partner passive at level 3', () => {
    const run = spent(3);
    run.behaviours.alchemy = 1;
    const evo = EVOLUTION_OF[run.weapons[0].id];
    run.passives = [{ id: evo.passive, level: C.passiveAt }];
    expect(evolutionCards(run)).toEqual([{ kind: 'evolution', id: evo.id }]);
    run.behaviours['arsenal-capstone'] = 2;
    expect(evolutionCards(run)).toEqual([]);
  });
});

describe('Engineering Mastery: the echo', () => {
  it('rank 1: the ultimate echoes 3 s later, weaker, and spends no charge', () => {
    const run = withRanks({ 'engineering-capstone': 1 });
    run.ult.charge = 1;
    const e = body(run, { x: 100, hp: 1e9, maxHp: 1e9 });
    expect(castUltimate(run)).toBe(true);
    const first = 1e9 - e.hp;
    expect(run.capstones.echoAt).toBeCloseTo(run.time + C.echoDelay);
    run.time += C.echoDelay;
    tickUltimate(run, SIM_DT);
    expect(run.capstones.echoAt).toBe(-1);
    expect(1e9 - e.hp - first).toBeCloseTo(first * C.echoShare);
    expect(run.ult.charge).toBe(0);
    expect(run.ult.casts).toBe(1);
  });

  it('without a rank, there is no echo', () => {
    const run = plainRun();
    run.ult.charge = 1;
    castUltimate(run);
    expect(run.capstones.echoAt).toBe(-1);
  });

  it('rank 2: kills during the cast refund a share of their charge once it ends', () => {
    const run = withRanks({ 'engineering-capstone': 2 });
    run.ult.charge = 1;
    const need = run.ult.need;
    body(run, { x: 100, hp: 1, maxHp: 1, xp: 10 });
    castUltimate(run);
    expect(run.ult.charge).toBeCloseTo((10 * run.stats.ultChargeMult / need) * C.refund);
  });

  it('rank 3: charge gained while full is banked, up to half a charge, and added after the next cast', () => {
    const run = withRanks({ 'engineering-capstone': 3 });
    run.ult.charge = 1;
    damageEnemy(run, body(run, { hp: 1, maxHp: 1, xp: 1e6 }), 10, false, 'homing');
    expect(run.capstones.chargeBank).toBe(C.chargeBank);
    castUltimate(run);
    expect(run.ult.charge).toBeCloseTo(C.chargeBank);
    expect(run.capstones.chargeBank).toBe(0);
  });
});

describe('capstone feats (D-4)', () => {
  it('Journeyman wants 5 capstone ranks and Grandmaster all 12; Fortune’s levels never count', () => {
    const p = newProfile(0);
    p.forge = { 'might-mastery': 3, 'bulwark-mastery': 2, 'fortune-mastery': 40 };
    expect(capstoneRanks(p)).toBe(5);
    const journeyman = FEATS.find((f) => f.id === 'mastery-10')!;
    const grandmaster = FEATS.find((f) => f.id === 'mastery-50')!;
    expect(featProgress(p, journeyman)).toBe(1);
    expect(featProgress(p, grandmaster)).toBeCloseTo(5 / 12);
  });
});

describe('determinism', () => {
  it('a run holding a bank, a shield and a charge bank survives a snapshot round-trip', () => {
    const ranks = { 'might-capstone': 3, 'bulwark-capstone': 3, 'arsenal-capstone': 3, 'engineering-capstone': 3 } as const;
    const a = withRanks(ranks, 7);
    for (let i = 0; i < 600; i++) step(a, SIM_DT);
    a.capstones.bank = 12;
    a.capstones.lastHit = 10;
    a.capstones.shield = 5;
    a.capstones.chargeBank = 0.2;
    const b = JSON.parse(JSON.stringify(a)) as RunState;
    for (let i = 0; i < 1200; i++) {
      step(a, SIM_DT);
      step(b, SIM_DT);
      a.events.length = 0;
      b.events.length = 0;
    }
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
