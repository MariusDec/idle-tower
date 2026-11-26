import { beforeAll, describe, expect, it } from 'vitest';
import { createRun, step } from '../src/sim/run';
import { buildRunConfig } from '../src/meta/runConfig';
import { newProfile, type Profile } from '../src/meta/profile';
import { bankRun } from '../src/meta/results';
import { SIM_DT } from '../src/app/loop';
import { BALANCE } from '../src/content/balance';
import { ABYSS_INDEX, FLOOR_WAVES, floorWave } from '../src/content/abyss';
import { RUSH_INDEX, RUSH_STAGES } from '../src/content/rush';
import { BOSSES } from '../src/content/bosses';
import { BOSS_WAVE, isBossWave, isKeeperWave, regionAt, runRegion, startWave, tickWaves, waveBonus } from '../src/sim/systems/waves';
import type { RunConfig, RunState } from '../src/sim/state';
import { body } from './helpers/body';

const O = BALANCE.overtime;
const LAST = BOSS_WAVE + O.maxWaves;

/** A profile past the Forgeheart (so the Long Night is on the list), playing Region 1. */
function profile(): Profile {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  p.bosses.forgeheart = { kills: 1, fastest: 60 };
  p.region = 1;
  return p;
}

/** A tower nothing hurts and nothing outlasts. */
function strong(p: Profile, over: Partial<RunConfig> = {}): RunConfig {
  const config = buildRunConfig(p);
  return {
    ...config,
    mods: [...config.mods, { key: 'damage', mult: 1e6 }, { key: 'attackSpeed', mult: 3 }, { key: 'maxHp', mult: 1e9 }],
    ...over,
  };
}

/** A fallen boss on `run`, killed `ago` seconds before now. */
function bossFell(run: RunState, ago: number): void {
  // Its body is gone (no enemy has id −1): only its id and its times are read.
  run.boss = { id: 'gatekeeper', enemy: -1, arrivedAt: run.time - ago - 30, killedIn: 30 } as unknown as RunState['boss'];
}

describe('overtime has an end (D-26)', () => {
  let p: Profile;
  let run: RunState;
  /** Shards (all, and the waves' share) just before the step that ended the run. */
  let before = { shards: 0, waves: 0 };

  beforeAll(() => {
    p = profile();
    run = createRun(strong(p), 3);
    const cap = Math.round(30 * 60 / SIM_DT);
    while (!run.outcome && run.tick < cap) {
      before = { shards: run.shards, waves: run.shardsFrom.waves };
      step(run, SIM_DT);
      run.events.length = 0;
    }
  });

  it('a region run with a tower that never falls ends cleared at the last overtime wave, paid for holding it', () => {
    expect(run.outcome?.kind).toBe('cleared');
    expect(run.outcome?.wave).toBe(LAST);
    expect(run.wave).toBe(LAST);
    expect(run.draft).toBeNull();
    const bonus = waveBonus(runRegion(run), LAST) * run.stats.shardMult;
    expect(run.shardsFrom.waves - before.waves).toBeCloseTo(bonus);
    expect(run.shards - before.shards).toBeGreaterThanOrEqual(bonus - 1e-6);
    // Within the time limit too: the wave cap ended it, not the clock.
    expect(run.time - (run.boss!.arrivedAt + run.boss!.killedIn!)).toBeLessThan(O.maxSeconds);
  });

  it('banks wave 40 as the best, pays the +15 trophy once, and earns the Long Night', () => {
    const q = structuredClone(p);
    const s = bankRun(q, structuredClone(run));
    expect(s.outcome).toBe('cleared');
    expect(q.regions[1]?.bestWave).toBe(LAST);
    expect(s.trophies.map((t) => t.overtime)).toContain(15);
    expect(s.feats.map((f) => f.id)).toContain('long-night');
    const again = bankRun(q, structuredClone(run));
    expect(again.trophies).toEqual([]);
    expect(again.feats.map((f) => f.id)).not.toContain('long-night');
  });

  it('a field held full in overtime ends cleared, at the wave it is on, once maxSeconds have passed since the boss fell', () => {
    const r = createRun(strong(profile()), 1);
    const n = BOSS_WAVE + 3;
    startWave(r, runRegion(r), n);
    // Bodies that can neither die nor hurt: the wave's spawns are held for good.
    for (let i = 0; i < BALANCE.maxEnemies; i++) body(r, { hp: 1e300, maxHp: 1e300, damage: 0, x: 400 });
    const fall = r.time;
    bossFell(r, 0);
    const ticks = (s: number): number => Math.round(s / SIM_DT);
    // Just short of the limit: the run goes on.
    r.tick = ticks(fall + O.maxSeconds) - 2;
    r.current!.startedAt = r.tick * SIM_DT - 1;
    step(r, SIM_DT);
    expect(r.outcome).toBeNull();
    expect(r.wave).toBe(n);
    const waves = r.shardsFrom.waves;
    step(r, SIM_DT);
    expect(r.outcome?.kind).toBe('cleared');
    expect(r.outcome?.wave).toBe(n);
    expect(r.time - fall).toBeGreaterThanOrEqual(O.maxSeconds);
    expect(r.time - fall).toBeLessThanOrEqual(O.maxSeconds + SIM_DT * 1.5);
    expect(r.shardsFrom.waves - waves).toBeCloseTo(waveBonus(runRegion(r), n) * r.stats.shardMult);
    // Nothing moves after the end.
    const t = r.tick;
    step(r, SIM_DT);
    expect(r.tick).toBe(t);
  });

  it('never ends the Abyss: a descent past global wave 40 goes on, whatever the clock', () => {
    const p2 = newProfile(0);
    p2.tutorial.firstDraft = true;
    for (const b of BOSSES) if (!b.abyss) p2.bosses[b.id] = { kills: 1, fastest: 60 };
    const r = createRun({ ...strong(p2), regionId: ABYSS_INDEX }, 1);
    // A plain floor wave past 40, neither the floor's first nor its last.
    let n = LAST + 1;
    while (floorWave(n) === 1 || floorWave(n) >= FLOOR_WAVES - 1) n++;
    const region = regionAt(ABYSS_INDEX, n);
    expect(isBossWave(region, n) || isKeeperWave(region, n)).toBe(false);
    r.time = O.maxSeconds * 3;
    startWave(r, region, n);
    bossFell(r, O.maxSeconds * 2);
    const cur = r.current!;
    cur.next = cur.spawns.length;
    cur.doneAt = r.time - 100;
    cur.alive = 0;
    r.time += 1;
    tickWaves(r, region);
    expect(r.outcome).toBeNull();
    expect(r.wave).toBe(n + 1);
  });

  it('never ends Boss Rush early: a stage whose boss fell long ago leads to the next', () => {
    const p3 = newProfile(0);
    p3.tutorial.firstDraft = true;
    for (const b of BOSSES) p3.bosses[b.id] = { kills: 1, fastest: 60 };
    const r = createRun({ ...strong(p3), regionId: RUSH_INDEX }, 1);
    expect(RUSH_STAGES).toBeGreaterThan(1);
    r.time = O.maxSeconds * 3;
    startWave(r, regionAt(RUSH_INDEX, 1), 1);
    bossFell(r, O.maxSeconds * 2);
    r.time += 1;
    tickWaves(r, runRegion(r));
    expect(r.outcome).toBeNull();
    expect(r.wave).toBe(2);
  });
});
