import { describe, expect, it } from 'vitest';
import { createRun, step } from '../src/sim/run';
import { buildRunConfig } from '../src/meta/runConfig';
import { newProfile, type Profile } from '../src/meta/profile';
import { SIM_DT } from '../src/app/loop';
import { ABYSS_INDEX, FLOOR_WAVES, abyssFloor, abyssStarlight, floorStart } from '../src/content/abyss';
import { BALANCE } from '../src/content/balance';
import { BOSSES, BOSS_BY_ID } from '../src/content/bosses';
import { STRATA, stratumOf, strataCurve, waypointLevel, waypoints } from '../src/content/strata';
import { Rng } from '../src/core/rng';
import { abyssStart, chooseWaypoint, selectedRegion } from '../src/meta/collection';
import { recordStratum } from '../src/meta/pacts';
import { bankRun } from '../src/meta/results';
import { migrate } from '../src/meta/save/migrate';
import { foldRules, ruleLoad } from '../src/sim/strata';
import { tickEnemies } from '../src/sim/systems/enemies';
import { rollWave, spawnEnemy, startWave, waveHp } from '../src/sim/systems/waves';
import { phasesOf } from '../src/sim/systems/boss';
import type { RunState } from '../src/sim/state';

/** A profile with every Act 1 boss down: Act 2 is open. */
function act2Profile(): Profile {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  for (const b of BOSSES) if (!b.abyss) p.bosses[b.id] = { kills: 1, fastest: 60 };
  return p;
}

function abyssRun(startFloor = 1, seed = 1): RunState {
  const p = act2Profile();
  p.region = ABYSS_INDEX;
  return createRun({ ...buildRunConfig(p), startFloor }, seed);
}

/** Angular distance, either way round. */
function off(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

describe('the strata (plans/late-game/08)', () => {
  it('floors 1–6 are the Gate, 7–12 the Inversion; past them, the shim', () => {
    expect(stratumOf(1)?.id).toBe('gate');
    expect(stratumOf(6)?.id).toBe('gate');
    expect(stratumOf(7)?.id).toBe('inversion');
    expect(stratumOf(12)?.id).toBe('inversion');
    expect(stratumOf(13)).toBeNull();
    expect(abyssFloor(13).abyss?.stratum).toBeNull();
  });

  it('the Gate is today’s curve exactly; each boundary continues the last wave by one step', () => {
    const A = BALANCE.abyss;
    expect(waveHp(abyssFloor(3), 25)).toBeCloseTo(A.hpBase * Math.pow(A.hpGrowth, 24));
    for (let k = 1; k <= STRATA.length; k++) {
      const last = floorStart(6 * k) + FLOOR_WAVES - 1;
      const step = waveHp(abyssFloor(6 * k + 1), last + 1) / waveHp(abyssFloor(6 * k), last);
      expect(step).toBeCloseTo(strataCurve(k).hpGrowth, 9);
    }
    // II's last wave lands where the plan's table puts it.
    expect(waveHp(abyssFloor(12), 120)).toBeGreaterThan(2e7);
    expect(waveHp(abyssFloor(12), 120)).toBeLessThan(2.4e7);
  });

  it('a Gates floor sends its bodies through its gates, and floor 6’s gates turn each wave', () => {
    for (const floor of [2, 3, 5]) {
      const region = abyssFloor(floor);
      const gates = region.abyss!.gates!.angles;
      const n = floorStart(floor) + 3;
      for (const sp of rollWave(region, n, new Rng(floor))) {
        const near = Math.min(...gates.map((g) => off(sp.angle, g)));
        expect(near, `floor ${floor}`).toBeLessThanOrEqual(BALANCE.strata.gates.arc + BALANCE.waves.packSpread + 1e-9);
      }
    }
    const six = abyssFloor(6);
    const a = foldRules(six, floorStart(6), six.abyss!.rules).gates!;
    const b = foldRules(six, floorStart(6) + 1, six.abyss!.rules).gates!;
    expect(b[0] - a[0]).toBeCloseTo(Math.PI / 5);
  });

  it('a Keeper ends floors 1–5; its wave holds the next floor no longer than its hold', () => {
    const run = abyssRun();
    run.weapons = [];
    // Aegis for the whole test: nothing here is about the wall.
    run.tower.invulnUntil = 1e9;
    startWave(run, abyssFloor(1), FLOOR_WAVES);
    expect(run.current!.spawns.some((s) => s.elite?.keeper)).toBe(true);
    let keeperId = 0;
    while (run.wave === FLOOR_WAVES && run.time < 400 && !run.outcome) {
      run.tower.hp = run.stats.maxHp;
      step(run, SIM_DT);
      keeperId ||= run.enemies.find((e) => e.keeper)?.id ?? 0;
    }
    expect(run.wave).toBe(FLOOR_WAVES + 1);
    const done = run.time;
    // It held at most its hold past the wave's spawns, and the Keeper walked on.
    expect(done).toBeLessThanOrEqual(BALANCE.strata.keeper.hold + 60);
    expect(run.enemies.some((e) => e.id === keeperId && e.alive)).toBe(true);
    // The floor past its Keeper is cleared as the next begins.
    expect(run.floors).toBe(1);
  });

  it('a Keeper slain releases its floor at once', () => {
    const run = abyssRun();
    run.weapons = [];
    // Aegis for the whole test: nothing here is about the wall.
    run.tower.invulnUntil = 1e9;
    startWave(run, abyssFloor(1), FLOOR_WAVES);
    while (run.wave === FLOOR_WAVES && run.time < 400 && !run.outcome) {
      run.tower.hp = run.stats.maxHp;
      // Struck down the moment it walks in.
      for (const e of run.enemies) if (e.keeper) e.alive = false;
      step(run, SIM_DT);
    }
    expect(run.wave).toBe(FLOOR_WAVES + 1);
    expect(run.time).toBeLessThan(BALANCE.strata.keeper.hold + 30);
  });

  it('a Lurker flees once below half, heals in the dark and comes back', () => {
    const run = abyssRun();
    const e = spawnEnemy(run, abyssFloor(2), 'lurker', floorStart(2), 200, 0);
    e.hp = e.maxHp * 0.4;
    for (let i = 0; i < 2000 && !e.fled; i++) tickEnemies(run, SIM_DT);
    expect(e.fled).toBe(true);
    expect(e.hp).toBe(e.maxHp);
    expect(e.heading).toBe(1);
    e.hp = e.maxHp * 0.1;
    tickEnemies(run, SIM_DT);
    expect(e.heading).toBe(1);
  });

  it('the Inversion starts walkers at the wall, walking out; one that escapes drains the ultimate', () => {
    const run = abyssRun(7);
    expect(run.wave).toBe(0);
    let inverted = 0;
    while (run.time < 60 && inverted === 0) {
      run.tower.hp = run.stats.maxHp;
      step(run, SIM_DT);
      inverted = run.enemies.filter((e) => e.heading < 0).length;
    }
    expect(inverted).toBeGreaterThan(0);
    const e = run.enemies.find((x) => x.heading < 0)!;
    run.ult.charge = 0.5;
    run.weapons = [];
    for (let i = 0; i < 20000 && e.alive; i++) tickEnemies(run, SIM_DT);
    expect(e.alive).toBe(false);
    const drain = abyssFloor(7).abyss!.rules.find((r) => r.kind === 'inversion');
    expect(drain?.kind === 'inversion' && run.ult.charge).toBeCloseTo(0.5 - (drain?.kind === 'inversion' ? drain.drain : 0));
  });

  it('a Tidecaller turns the walking bodies near it', () => {
    const run = abyssRun(7);
    const t = spawnEnemy(run, abyssFloor(8), 'tidecaller', floorStart(8), 300, 0);
    const g = spawnEnemy(run, abyssFloor(8), 'grunt', floorStart(8), 340, 0);
    const w = spawnEnemy(run, abyssFloor(8), 'wardstone', floorStart(8), 300, 40);
    t.actTimer = 0;
    t.x = t.px = 300;
    tickEnemies(run, SIM_DT);
    expect(g.heading).toBe(-1);
    expect(w.heading).toBe(1);
  });

  it('the Deepwarden throws every gate open in its last phase', () => {
    const run = abyssRun();
    startWave(run, abyssFloor(6), 6 * FLOOR_WAVES);
    expect(ruleLoad(run).gates).toHaveLength(2);
    run.boss!.phase = phasesOf(run, BOSS_BY_ID.deepwarden).length - 1;
    expect(ruleLoad(run).gates).toHaveLength(6);
  });

  it('a waypoint run starts at its floor, grown, and opens from the flanks', () => {
    const run = abyssRun(7);
    expect(run.startWave).toBe(61);
    expect(run.floors).toBe(6);
    expect(run.level).toBe(waypointLevel(7));
    while (!run.current) step(run, SIM_DT);
    expect(run.wave).toBe(61);
    for (const sp of run.current.spawns) {
      expect(Math.min(off(sp.angle, 0), off(sp.angle, Math.PI))).toBeLessThanOrEqual(BALANCE.waves.openingArc + BALANCE.waves.packSpread + 1e-9);
    }
  });

  it('a guardian’s first fall in order pays its lump, opens a waypoint and asks for the ceremony', () => {
    const p = act2Profile();
    expect(recordStratum(p, ['undertow'])).toBeNull();
    const first = recordStratum(p, ['deepwarden']);
    expect(first?.starlight).toBe(BALANCE.strata.starlight.lump[0]);
    expect(p.abyss.felled).toBe(1);
    expect(recordStratum(p, ['deepwarden'])).toBeNull();
    expect(waypoints(p.abyss.felled)).toEqual([1, 7]);
    // Banked through a run: the ceremony is the guardian's.
    p.region = ABYSS_INDEX;
    const run = createRun(buildRunConfig(p), 1);
    run.floors = 12;
    run.felled = ['undertow'];
    run.wave = 121;
    run.outcome = { kind: 'fell', wave: 121, time: 900 };
    const s = bankRun(p, run);
    expect(s.stratumRecord?.felled).toEqual(['undertow']);
    expect(p.ceremony).toBe('undertow');
    expect(p.abyss.felled).toBe(2);
    expect(s.floorRecord?.starlight).toBe(abyssStarlight(12));
  });

  it('a waypoint is chosen only once open; the next run starts there', () => {
    const p = act2Profile();
    expect(chooseWaypoint(p, 7)).toBe(false);
    p.abyss.felled = 1;
    expect(chooseWaypoint(p, 7)).toBe(true);
    expect(abyssStart(p)).toBe(7);
    expect(selectedRegion(p).abyss?.floor).toBe(7);
    expect(buildRunConfig(p).startFloor).toBe(7);
    // A waypoint no longer open (a reset) falls back to the top.
    p.abyss.felled = 0;
    expect(abyssStart(p)).toBe(1);
  });

  it('an old save keeps its record and pays no guardian twice', () => {
    const raw = migrate({ ...JSON.parse(JSON.stringify(newProfile(0))), version: 21, abyss: { best: 9 } });
    expect(raw.abyss).toEqual({ best: 9, felled: 0, start: 1 });
  });
});
