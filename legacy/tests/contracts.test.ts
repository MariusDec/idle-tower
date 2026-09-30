/**
 * Contracts (gameplay plan §5.5).
 *
 * Every rule here is one the player cannot see failing. A goal kind with no
 * consumer reads as bad luck; a slot that never refills reads as "I guess I
 * finished them"; an AP cap that does not bind reads as generosity right up
 * until the prestige curve is wrong. So each gets an explicit case, driven
 * through the real manager with a seeded RNG.
 */

import { describe, expect, it } from 'vitest';
import { ContractManager, type ContractEvent } from '../src/systems/ContractManager';
import {
  CONTRACTS,
  CONTRACT_BY_ID,
  CONTRACT_SLOTS,
  CONTRACT_TUNING,
  goalAvailableFromWave,
  type ContractGoal,
  type ContractGoalKind,
} from '../src/data/contracts';
import { ENEMY_DEFS } from '../src/data/enemies';

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

interface Harness {
  mgr: ContractManager;
  wave: number;
  completions: Array<{ id: string; reward: { goldWaves: number; rerolls: number; rp: number; apBonusPct: number } }>;
  setWave: (w: number) => void;
}

function harness(startWave = 1, seed = 0x5eed): Harness {
  const state = { wave: startWave };
  const completions: Harness['completions'] = [];
  const mgr = new ContractManager({
    bus: {
      emit: (event: string, payload?: unknown) => {
        if (event !== 'contract_completed') return;
        const p = payload as Harness['completions'][number];
        completions.push({ id: p.id, reward: p.reward });
      },
    },
    currentWave: () => state.wave,
    // A flat, wave-independent figure: the tests are about the mechanism, and
    // the real curve is `sim/balance.ts`'s problem.
    waveGold: () => 100,
    rng: seeded(seed),
  });
  mgr.refill();
  return {
    mgr,
    get wave() { return state.wave; },
    completions,
    setWave: (w: number) => { state.wave = w; },
  };
}

/**
 * One event of each kind, enough to satisfy any goal if repeated.
 *
 * A `Record` over the union here too, for the same reason the manager has one:
 * this test is only meaningful if it can actually *drive* every goal kind, and
 * a kind it silently has no event for would pass vacuously.
 */
const DRIVER: Record<ContractGoalKind, (goal: ContractGoal, step: number) => ContractEvent> = {
  kill_type: (goal) => ({
    kind: 'enemy_killed',
    type: goal.kind === 'kill_type' ? goal.type : 'normal',
  }),
  kill_count: () => ({ kind: 'enemy_killed', type: 'normal' }),
  clear_waves: (_g, step) => ({ kind: 'wave_cleared', wave: step, flawless: false, mutatorActive: false }),
  flawless_waves: (_g, step) => ({ kind: 'wave_cleared', wave: step, flawless: true, mutatorActive: false }),
  boss_under: (goal) => ({
    kind: 'boss_encounter',
    seconds: goal.kind === 'boss_under' ? goal.seconds - 1 : 0,
  }),
  collect_orbs: () => ({ kind: 'orb_collected' }),
  cast_abilities: () => ({ kind: 'ability_cast' }),
  reach_wave: (_g, step) => ({ kind: 'wave_cleared', wave: step, flawless: false, mutatorActive: false }),
  survive_mutator: (_g, step) => ({ kind: 'wave_cleared', wave: step, flawless: false, mutatorActive: true }),
  spend_gold: () => ({ kind: 'gold_spent', amount: 1_000_000 }),
};

const ALL_KINDS = Object.keys(DRIVER) as ContractGoalKind[];

/**
 * Feed one live contract until it completes, and return its uid.
 *
 * `wave_cleared` carries an absolute wave, so `reach_wave` needs a step that
 * actually climbs — hence the counter rather than a constant.
 */
function drive(h: Harness, target: { uid: number; goal: ContractGoal }): number {
  const uid = target.uid;
  for (let step = 1; step <= 2000; step++) {
    if (!h.mgr.list.some(c => c.uid === uid)) return uid;
    h.mgr.note(DRIVER[target.goal.kind](target.goal, h.wave + step));
  }
  throw new Error(`contract ${uid} (${target.goal.kind}) never completed`);
}

describe('goal kinds all have a consumer', () => {
  /**
   * The `Record` is the subject (plan §5.5 and cross-cutting rule 3).
   *
   * `CONTRACT_PROGRESS` inside the manager is private and is what actually
   * enforces this at compile time; what a runtime test can add is proof that
   * each entry *does something* rather than merely existing.
   */
  it('every goal kind moves a contract it is fed', () => {
    for (const kind of ALL_KINDS) {
      const def = CONTRACTS.find(c => c.goal.kind === kind);
      expect(def, `no contract def uses goal kind ${kind}`).toBeDefined();
      const h = harness(def!.minWave, 99);
      // Drive the manager until this def is in a slot, then feed it.
      let found = h.mgr.list.find(c => c.def.id === def!.id);
      for (let attempt = 0; attempt < 200 && !found; attempt++) {
        // Complete whatever is live, which draws a replacement.
        for (const kindToPush of ALL_KINDS) {
          for (let i = 0; i < 40; i++) {
            h.mgr.note(DRIVER[kindToPush](CONTRACTS[0].goal, 1000 + attempt));
          }
        }
        found = h.mgr.list.find(c => c.def.id === def!.id);
      }
      expect(found, `${def!.id} never reached a slot`).toBeDefined();
      const before = found!.progress;
      h.mgr.note(DRIVER[kind](found!.goal, found!.drawnAtWave + 1));
      const after = h.mgr.list.find(c => c.uid === found!.uid);
      // Either it advanced, or it advanced far enough to complete and vanish.
      const advanced = after === undefined || after.progress > before;
      expect(advanced, `${def!.id} (${kind}) did not advance`).toBe(true);
    }
  });

  it('every goal kind appears in the shipping pool', () => {
    const used = new Set(CONTRACTS.map(c => c.goal.kind));
    for (const kind of ALL_KINDS) {
      expect(used.has(kind), `no contract uses ${kind}`).toBe(true);
    }
  });
});

describe('the tracker never drops below three', () => {
  it('starts with exactly three', () => {
    const h = harness();
    expect(h.mgr.list.length).toBe(CONTRACT_SLOTS);
  });

  it('draws a replacement the moment one completes', () => {
    const h = harness(20, 7);
    const seen = new Set(h.mgr.list.map(c => c.uid));
    // Kills alone will finish anything counting kills; a hundred waves of
    // every event kind finishes the rest.
    for (let step = 0; step < 200; step++) {
      for (const kind of ALL_KINDS) {
        h.mgr.note(DRIVER[kind](h.mgr.list[0]?.goal ?? CONTRACTS[0].goal, 20 + step));
      }
      expect(h.mgr.list.length, `slot count after step ${step}`).toBe(CONTRACT_SLOTS);
      for (const c of h.mgr.list) seen.add(c.uid);
    }
    expect(h.completions.length).toBeGreaterThan(5);
    // Replacements are genuinely new instances, not the same object re-used:
    // exactly one instance id was handed out per slot plus one per completion.
    expect(h.mgr.snapshot().uidSeq).toBe(CONTRACT_SLOTS + h.completions.length);
    expect(seen.size).toBeGreaterThan(CONTRACT_SLOTS);
  });

  it('never holds two copies of the same def at once', () => {
    const h = harness(45, 11);
    for (let step = 0; step < 300; step++) {
      for (const kind of ALL_KINDS) {
        h.mgr.note(DRIVER[kind](h.mgr.list[0]?.goal ?? CONTRACTS[0].goal, 45 + step));
      }
      const ids = h.mgr.list.map(c => c.def.id);
      expect(new Set(ids).size, `duplicate slot at step ${step}: ${ids.join(',')}`).toBe(ids.length);
    }
  });
});

describe('the AP bonus caps at +50%', () => {
  it('stops granting once the cap is reached', () => {
    const h = harness(45, 3);
    for (let step = 0; step < 2000; step++) {
      for (const kind of ALL_KINDS) {
        h.mgr.note(DRIVER[kind](h.mgr.list[0]?.goal ?? CONTRACTS[0].goal, 45 + step));
      }
      if (h.mgr.isApCapped) break;
    }
    expect(h.mgr.isApCapped, 'never reached the cap').toBe(true);
    expect(h.mgr.apBonusPct).toBeCloseTo(CONTRACT_TUNING.apBonusCap, 10);

    const granted = h.completions.reduce((a, c) => a + c.reward.apBonusPct, 0);
    // What was *paid* equals what was banked — the cap is applied to the
    // payout, not merely to the running total, so a caller that trusts the
    // event cannot over-pay.
    expect(granted).toBeCloseTo(CONTRACT_TUNING.apBonusCap, 10);

    // Keep going: further AP-granting contracts pay zero rather than pushing
    // the total past the ceiling.
    const before = h.completions.length;
    for (let step = 0; step < 400; step++) {
      for (const kind of ALL_KINDS) {
        h.mgr.note(DRIVER[kind](h.mgr.list[0]?.goal ?? CONTRACTS[0].goal, 2000 + step));
      }
    }
    expect(h.completions.length).toBeGreaterThan(before);
    expect(h.mgr.apBonusPct).toBeCloseTo(CONTRACT_TUNING.apBonusCap, 10);
    const paidAfter = h.completions.slice(before).reduce((a, c) => a + c.reward.apBonusPct, 0);
    expect(paidAfter).toBe(0);
  });

  it('never pays more than a single step at once', () => {
    const h = harness(45, 21);
    for (let step = 0; step < 600; step++) {
      for (const kind of ALL_KINDS) {
        h.mgr.note(DRIVER[kind](h.mgr.list[0]?.goal ?? CONTRACTS[0].goal, 45 + step));
      }
    }
    for (const c of h.completions) {
      expect(c.reward.apBonusPct).toBeLessThanOrEqual(CONTRACT_TUNING.apBonusStep + 1e-9);
    }
  });
});

describe('run scoping', () => {
  it('reset clears progress, history and the AP bonus, and redraws three', () => {
    const h = harness(45, 5);
    for (let step = 0; step < 400; step++) {
      for (const kind of ALL_KINDS) {
        h.mgr.note(DRIVER[kind](h.mgr.list[0]?.goal ?? CONTRACTS[0].goal, 45 + step));
      }
    }
    expect(h.mgr.completed).toBeGreaterThan(0);
    expect(h.mgr.apBonusPct).toBeGreaterThan(0);

    h.mgr.reset();
    expect(h.mgr.completed).toBe(0);
    expect(h.mgr.apBonusPct).toBe(0);
    expect(h.mgr.recent.length).toBe(0);
    expect(h.mgr.list.length).toBe(CONTRACT_SLOTS);
    for (const c of h.mgr.list) expect(c.progress).toBe(0);
  });

  it('a reset at a deeper wave draws from the deeper band', () => {
    const h = harness(1, 5);
    for (const c of h.mgr.list) expect(c.def.minWave).toBeLessThanOrEqual(1);
    h.setWave(80);
    h.mgr.reset();
    for (const c of h.mgr.list) expect(c.def.minWave).toBeLessThanOrEqual(80);
    // Band A is retired by wave 80, so nothing from it can still be drawn.
    for (const c of h.mgr.list) {
      expect(c.def.maxWave === undefined || c.def.maxWave >= 80).toBe(true);
    }
  });
});

describe('wave-band tiering', () => {
  /**
   * The plan's own example: a wave-8 player must never draw "kill a wave-60
   * boss". `minWave` is the tuning knob; `goalAvailableFromWave` is the
   * correctness floor, and this is what stops the two drifting apart.
   */
  it('no def is drawable before its goal exists', () => {
    expect(CONTRACTS.length).toBeGreaterThan(15);
    for (const def of CONTRACTS) {
      expect(
        def.minWave,
        `${def.id} is drawable at wave ${def.minWave} but its goal needs wave ${goalAvailableFromWave(def.goal)}`,
      ).toBeGreaterThanOrEqual(goalAvailableFromWave(def.goal));
    }
  });

  it('a kill_type contract never names an enemy that has not unlocked', () => {
    const killType = CONTRACTS.filter(c => c.goal.kind === 'kill_type');
    expect(killType.length).toBeGreaterThan(3);
    for (const def of killType) {
      const goal = def.goal as Extract<ContractGoal, { kind: 'kill_type' }>;
      expect(def.minWave, def.id).toBeGreaterThanOrEqual(ENEMY_DEFS[goal.type].unlockWave);
    }
  });

  it('offers only in-band contracts at every wave from 1 to 200', () => {
    for (let wave = 1; wave <= 200; wave++) {
      const h = harness(wave, wave * 17 + 3);
      expect(h.mgr.list.length, `wave ${wave} drew ${h.mgr.list.length}`).toBe(CONTRACT_SLOTS);
      for (const c of h.mgr.list) {
        expect(c.def.minWave, `${c.def.id} at wave ${wave}`).toBeLessThanOrEqual(wave);
        expect(
          c.def.maxWave === undefined || wave <= c.def.maxWave,
          `${c.def.id} retired before wave ${wave}`,
        ).toBe(true);
        expect(goalAvailableFromWave(c.goal)).toBeLessThanOrEqual(wave);
      }
    }
  });

  it('a reach_wave target is always ahead of where it was drawn', () => {
    for (const wave of [1, 8, 30, 60, 140]) {
      const h = harness(wave, wave * 31);
      // Force the def into a slot by completing everything else repeatedly.
      for (let attempt = 0; attempt < 60; attempt++) {
        const reach = h.mgr.list.find(c => c.goal.kind === 'reach_wave');
        if (reach) {
          expect(reach.target).toBeGreaterThan(wave);
          // Never more than a couple of dozen waves out of reach.
          expect(reach.target - wave).toBeLessThanOrEqual(12);
          break;
        }
        for (const kind of ALL_KINDS) {
          for (let i = 0; i < 30; i++) {
            h.mgr.note(DRIVER[kind](h.mgr.list[0]?.goal ?? CONTRACTS[0].goal, wave));
          }
        }
      }
    }
  });
});

describe('snapshot / restore', () => {
  it('round-trips live slots, progress and the AP bonus', () => {
    const h = harness(30, 13);
    for (let step = 0; step < 60; step++) {
      h.mgr.note({ kind: 'enemy_killed', type: 'normal' });
      h.mgr.note({ kind: 'orb_collected' });
    }
    const snap = h.mgr.snapshot();
    expect(snap.active.length).toBe(CONTRACT_SLOTS);

    const other = harness(30, 999);
    other.mgr.restore(snap);
    const restored = other.mgr.snapshot();
    expect(restored.active.map(a => a.defId)).toEqual(snap.active.map(a => a.defId));
    expect(restored.active.map(a => a.progress)).toEqual(snap.active.map(a => a.progress));
    expect(restored.active.map(a => a.uid)).toEqual(snap.active.map(a => a.uid));
    expect(restored.apBonusPct).toBe(snap.apBonusPct);
    expect(restored.completedCount).toBe(snap.completedCount);
  });

  it('refills a slot whose def no longer exists', () => {
    const h = harness(30, 4);
    const snap = h.mgr.snapshot();
    snap.active[0].defId = 'ct_removed_in_a_later_patch';
    const other = harness(30, 4);
    other.mgr.restore(snap);
    expect(other.mgr.list.length).toBe(CONTRACT_SLOTS);
    for (const c of other.mgr.list) expect(CONTRACT_BY_ID[c.def.id]).toBeDefined();
  });

  it('clamps a restored AP bonus to the cap', () => {
    const h = harness();
    const snap = h.mgr.snapshot();
    snap.apBonusPct = 9;
    h.mgr.restore(snap);
    expect(h.mgr.apBonusPct).toBe(CONTRACT_TUNING.apBonusCap);
  });
});

/**
 * The completed-contract log (the Progression tab's history).
 *
 * The payout is recorded at completion and persisted, rather than re-derived
 * from the def on read — a contract's gold is denominated in waves of income
 * at the wave it completed on, and its AP grant is whatever the cap left. Both
 * are facts about a moment, and neither can be recovered later.
 */
describe('the completion log', () => {
  it('records the gold each completion actually paid', () => {
    const h = harness(1);
    const first = h.mgr.list.find(c => c.def.reward.goldWaves)!;
    // `waveGold` is a flat 100 in the harness, so the payout is the ratio x100.
    const expected = Math.max(1, Math.floor(100 * first.def.reward.goldWaves!));
    drive(h, first);
    const entry = h.mgr.recent.find(e => e.defId === first.def.id)!;
    expect(entry.gold).toBe(expected);
    expect(entry.wave).toBe(1);
  });

  it('logs what the run banked, not what the defs asked for', () => {
    const h = harness(1);
    drive(h, h.mgr.list[0]);
    drive(h, h.mgr.list[0]);
    drive(h, h.mgr.list[0]);
    const logged = h.mgr.recent.reduce((a, e) => a + e.reward.apBonusPct, 0);
    expect(logged).toBeCloseTo(h.mgr.apBonusPct, 10);
  });

  it('records a completion past the AP cap as the zero it banked', () => {
    const h = harness(45);
    for (let i = 0; i < 600 && h.mgr.apBonusPct < CONTRACT_TUNING.apBonusCap; i++) {
      drive(h, h.mgr.list[0]);
    }
    expect(h.mgr.isApCapped, 'the run never reached the cap').toBe(true);
    // Keep going *past* the ceiling. The defs still ask for +3%; every one of
    // these banked nothing, and the log has to say so rather than replaying
    // the def — which is the whole reason the payout is stored.
    const mark = h.mgr.completed;
    for (let i = 0; i < 60; i++) drive(h, h.mgr.list[0]);
    expect(h.mgr.completed).toBeGreaterThan(mark);

    const asked = h.mgr.recent.filter(e => CONTRACT_BY_ID[e.defId].reward.apBonusPct);
    expect(asked.length, 'no AP-granting def in the retained history').toBeGreaterThan(0);
    for (const entry of asked) {
      expect(entry.reward.apBonusPct, `${entry.defId} paid AP past the cap`).toBe(0);
    }
  });

  it('survives a snapshot / restore with its payouts intact', () => {
    const h = harness(1);
    drive(h, h.mgr.list[0]);
    drive(h, h.mgr.list[0]);
    const before = h.mgr.recent.map(e => ({ ...e, reward: { ...e.reward } }));
    const snap = h.mgr.snapshot();
    expect(snap.log).toHaveLength(before.length);

    const restored = harness(1);
    restored.mgr.restore(snap);
    expect(restored.mgr.recent).toEqual(before);
  });

  it('restores a save written before the log existed, without inventing rewards', () => {
    const h = harness(1);
    drive(h, h.mgr.list[0]);
    const snap = h.mgr.snapshot();
    // A v12-era block: def ids only.
    delete snap.log;

    const restored = harness(1);
    restored.mgr.restore(snap);
    expect(restored.mgr.recent).toHaveLength(1);
    const entry = restored.mgr.recent[0];
    expect(entry.wave).toBe(0);
    expect(entry.gold).toBe(0);
    expect(entry.reward.apBonusPct).toBe(0);
  });
});

describe('the pool itself', () => {
  it('has no duplicate ids', () => {
    const ids = CONTRACTS.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every def pays something', () => {
    for (const def of CONTRACTS) {
      const r = def.reward;
      const total = (r.goldWaves ?? 0) + (r.rerolls ?? 0) + (r.rp ?? 0) + (r.apBonusPct ?? 0);
      expect(total, `${def.id} pays nothing`).toBeGreaterThan(0);
    }
  });

  it('every apBonusPct grant is exactly one step', () => {
    const granting = CONTRACTS.filter(c => c.reward.apBonusPct);
    expect(granting.length).toBeGreaterThan(2);
    for (const def of granting) {
      expect(def.reward.apBonusPct, def.id).toBeCloseTo(CONTRACT_TUNING.apBonusStep, 10);
    }
  });

  it('keeps at least three drawable defs in every band', () => {
    for (let wave = 1; wave <= 200; wave++) {
      const drawable = CONTRACTS.filter(
        c => wave >= c.minWave && (c.maxWave === undefined || wave <= c.maxWave),
      );
      expect(drawable.length, `only ${drawable.length} drawable at wave ${wave}`)
        .toBeGreaterThanOrEqual(CONTRACT_SLOTS);
    }
  });
});
