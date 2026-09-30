import { describe, expect, it } from 'vitest';
import { createRun, step } from '../src/sim/run';
import { buildRunConfig } from '../src/meta/runConfig';
import { newProfile } from '../src/meta/profile';
import { SIM_DT } from '../src/app/loop';
import { BALANCE } from '../src/content/balance';
import { REGIONS, regionByIndex } from '../src/content/regions';
import { ENEMY_BY_ID } from '../src/content/enemies';
import { hashString, Rng } from '../src/core/rng';
import { mitigate } from '../src/sim/systems/damage';
import { rollWave, shouldAdvance } from '../src/sim/systems/waves';
import type { RunState, WaveState } from '../src/sim/state';

const config = () => buildRunConfig(newProfile(0));

function runFor(seed: number, seconds: number): RunState {
  const run = createRun(config(), seed);
  const ticks = Math.round(seconds / SIM_DT);
  for (let i = 0; i < ticks && !run.outcome; i++) {
    step(run, SIM_DT);
    run.events.length = 0;
  }
  return run;
}

/** Everything but the presentation events, hashed. */
function stateHash(run: RunState): number {
  const { events: _events, ...rest } = run;
  return hashString(JSON.stringify(rest));
}

describe('determinism', () => {
  it('the same seed gives the same final state', () => {
    expect(stateHash(runFor(12345, 90))).toBe(stateHash(runFor(12345, 90)));
  });

  it('different seeds give different runs', () => {
    expect(stateHash(runFor(1, 30))).not.toBe(stateHash(runFor(2, 30)));
  });

  it('is independent of whether events are drained', () => {
    const a = runFor(77, 40);
    const b = createRun(config(), 77);
    for (let i = 0; i < Math.round(40 / SIM_DT) && !b.outcome; i++) step(b, SIM_DT);
    expect(stateHash(a)).toBe(stateHash(b));
  });
});

describe('damage and armour', () => {
  it('subtracts armour flat', () => {
    expect(mitigate(100, 30)).toBe(70);
    expect(mitigate(100, 0)).toBe(100);
  });

  it('always lets the floor through', () => {
    expect(mitigate(10, 1000)).toBeCloseTo(10 * BALANCE.damage.minFraction);
    expect(mitigate(10, 9.5)).toBeCloseTo(10 * BALANCE.damage.minFraction);
  });

  it('ignores negative armour and non-positive hits', () => {
    expect(mitigate(10, -5)).toBe(10);
    expect(mitigate(0, 5)).toBe(0);
  });

  it('makes a Brute cost more per hit than a Grunt of the same HP would', () => {
    const r = regionByIndex(1);
    const armor = r.hpBase * ENEMY_BY_ID.brute.armor;
    expect(mitigate(12, armor)).toBeLessThan(12);
    // Big hits lose proportionally less to armour — the Brute's verb.
    expect(mitigate(48, armor) / 48).toBeGreaterThan(mitigate(12, armor) / 12);
  });
});

describe('wave overlap rule (§4.2)', () => {
  const wave = (over: Partial<WaveState>): WaveState => ({
    n: 1, startedAt: 0, spawns: new Array(20).fill({ at: 0, enemy: 'grunt', angle: 0 }),
    next: 20, doneAt: 5, alive: 20, ...over,
  });

  it('never advances while still spawning', () => {
    expect(shouldAdvance(wave({ doneAt: null, alive: 0 }), 100)).toBe(false);
  });

  it('advances once the field holds 25% or less of the wave', () => {
    expect(shouldAdvance(wave({ alive: 6 }), 6)).toBe(false);
    expect(shouldAdvance(wave({ alive: 5 }), 6)).toBe(true);
  });

  it('advances after the overlap timeout whatever is alive', () => {
    const w = wave({ alive: 20, doneAt: 5 });
    expect(shouldAdvance(w, 5 + BALANCE.waves.overlapSeconds - 0.01)).toBe(false);
    expect(shouldAdvance(w, 5 + BALANCE.waves.overlapSeconds)).toBe(true);
  });

  it('a strong tower chains waves faster than a weak one', () => {
    const weak = runFor(9, 40);
    const strongCfg = {
      ...config(),
      mods: [{ key: 'damage', mult: 20 }, { key: 'attackSpeed', mult: 3 }, { key: 'maxHp', mult: 1e7 }] as const,
    };
    const strong = createRun(strongCfg, 9);
    for (let i = 0; i < Math.round(40 / SIM_DT); i++) { step(strong, SIM_DT); strong.events.length = 0; }
    expect(strong.wave).toBeGreaterThan(weak.wave);
  });
});

describe('wave templates', () => {
  it('rolls every Region 1 wave 1–19 from its pool', () => {
    const r = REGIONS[0];
    for (let n = 1; n <= 19; n++) {
      const list = rollWave(r, n, new Rng(n));
      expect(list.length).toBeGreaterThan(0);
      const allowed = new Set(r.pool.filter((p) => p.from <= n).map((p) => p.enemy));
      for (const s of list) expect(allowed.has(s.enemy), `wave ${n}: ${s.enemy}`).toBe(true);
      for (let i = 1; i < list.length; i++) expect(list[i].at).toBeGreaterThanOrEqual(list[i - 1].at);
    }
  });

  it('introduces each new type at its beat', () => {
    const r = REGIONS[0];
    for (const [n, beat] of Object.entries(r.beats)) {
      if (beat.kind !== 'introduce') continue;
      const list = rollWave(r, Number(n), new Rng(1));
      expect(list.some((s) => s.enemy === beat.enemy)).toBe(true);
    }
  });

  it('wave 1 opens with a body at t=0 from a flank', () => {
    for (let seed = 1; seed < 20; seed++) {
      const first = rollWave(REGIONS[0], 1, new Rng(seed))[0];
      expect(first.at).toBe(0);
      expect(Math.abs(Math.sin(first.angle))).toBeLessThan(1e-9);
    }
  });
});

describe('the P1 gate, measured on the real sim', () => {
  it('first kill within 3 s', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const run = createRun(config(), seed);
      let first: number | null = null;
      while (first === null && run.time < 10) {
        step(run, SIM_DT);
        if (run.events.some((e) => e.kind === 'kill')) first = run.time;
        run.events.length = 0;
      }
      expect(first, `seed ${seed}`).not.toBeNull();
      expect(first!, `seed ${seed}`).toBeLessThan(3);
    }
  });

  it('a level-1 tower with no upgrades falls around wave 4–6', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const run = runFor(seed, 600);
      expect(run.outcome?.kind, `seed ${seed}`).toBe('fell');
      expect(run.outcome!.wave, `seed ${seed}`).toBeGreaterThanOrEqual(4);
      expect(run.outcome!.wave, `seed ${seed}`).toBeLessThanOrEqual(6);
    }
  });

  it('retreat ends the run where it stands', () => {
    const run = runFor(4, 5);
    step(run, SIM_DT, { retreat: true });
    expect(run.outcome?.kind).toBe('retreat');
  });
});
