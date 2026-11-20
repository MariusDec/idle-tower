import { describe, expect, it } from 'vitest';
import { regionByIndex } from '../src/content/regions';
import { RIFTS, RIFT_BY_ID } from '../src/content/rifts';
import { TRIALS } from '../src/content/trials';
import { newProfile, type Profile } from '../src/meta/profile';
import { bankRun, PLATEAU, trophyAt } from '../src/meta/results';
import { buildRunConfig, heldBeat, riftConfig } from '../src/meta/runConfig';
import { chooseTrial, trialPrize, winTrial } from '../src/meta/trials';
import { createRun } from '../src/sim/run';
import type { RunState } from '../src/sim/state';
import { tickRifts } from '../src/sim/systems/rifts';
import { startWave } from '../src/sim/systems/waves';
import { plateauLine } from '../src/ui/results';
import { I6_LATE, lateWindow, worstGapIn } from '../tools/pacing';

/**
 * R2 (plans/review-risks.md): reveals where the bot found none. §1 tells a
 * Trial's win and an overtime trophy in the run; §2–3 hold one rift a region
 * back for the middle of its plateau; §4 shows what moved on a run short of
 * the best; §5 reads I6's later clause from 2 h to the Blight.
 */

/** Past the Gatekeeper and the first draft, Trials open, frontier at `region`. */
function profileAt(region: number): Profile {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  p.tutorial.firstRift = true;
  p.records.runs = 20;
  p.bosses.gatekeeper = { kills: 1, fastest: 60 };
  p.forge = { 'might-damage': 1, scattershot: 1, 'chain-lightning': 1 };
  p.regions['1'] = { bestWave: 20, runs: 10 };
  p.regions['2'] = { bestWave: 12, runs: 2 };
  p.region = region;
  return p;
}

/** Wave `n` starts by hand, and its rift (if any) is given time to appear and shut. */
function waveByHand(run: RunState, n: number): void {
  const region = regionByIndex(run.regionId);
  run.time = n * 100;
  startWave(run, region, n);
  for (let i = 0; i < 3; i++) {
    tickRifts(run, region);
    run.time += 60;
  }
}

describe('R2 §1: a Trial and a trophy are told in the run', () => {
  it('trialPrize says what winTrial will pay, and pays nothing itself', () => {
    for (const t of TRIALS.filter((x) => x.region === 1)) {
      const p = profileAt(1);
      const before = JSON.stringify(p);
      const prize = trialPrize(p, t.id);
      expect(JSON.stringify(p)).toBe(before);
      expect(prize).toEqual(winTrial(p, t.id));
      expect(trialPrize(p, t.id)).toBeNull();
    }
  });

  it('a relic already at its peak is named so, before and after', () => {
    const t = TRIALS.find((x) => x.reward.kind === 'relic')!;
    const p = profileAt(1);
    if (t.reward.kind === 'relic') p.relics[t.reward.relic] = 3;
    expect(trialPrize(p, t.id)!.line).toMatch(/already at its peak/);
    expect(winTrial(p, t.id)!.line).toMatch(/already at its peak/);
  });

  it('trophyAt names the trophy a wave earns, and bankRun pays the same', () => {
    const p = profileAt(1);
    const run = createRun(buildRunConfig(p), 1);
    run.shards = 0;
    expect(trophyAt(p, run, 24)).toBeNull();
    const t = trophyAt(p, run, 25);
    expect(t?.overtime).toBe(5);
    run.wave = 25;
    const s = bankRun(p, run);
    expect(s.trophies).toEqual([t]);
    // Held now: the next run's wave 25 earns nothing.
    expect(trophyAt(p, createRun(buildRunConfig(p), 2), 25)).toBeNull();
  });

  it('no trophy in a Daily Omen run, which is no region’s', () => {
    const p = profileAt(1);
    const run = createRun(buildRunConfig(p), 1);
    expect(trophyAt(p, { ...run, omen: { day: 1, practice: false } } as unknown as RunState, 25)).toBeNull();
  });

  it('a Trial run is still won and paid at its results', () => {
    const p = profileAt(1);
    const t = TRIALS.find((x) => x.region === 1)!;
    expect(chooseTrial(p, t.id)).toBe(true);
    const prize = trialPrize(p, t.id);
    const run = createRun(buildRunConfig(p), 1);
    expect(run.trial).toBe(t.id);
    run.boss = { ...(run.boss ?? {}), killedIn: 30 } as RunState['boss'];
    const s = bankRun(p, run);
    expect(s.trial?.paid).toEqual(prize);
  });
});

describe('R2 §2–3: each region holds one rift back for its middle', () => {
  const held = RIFTS.filter((d) => d.where.held !== undefined);

  it('Regions 2–6 each hold exactly one, a rare of their own', () => {
    for (const r of [2, 3, 4, 5, 6]) {
      const mine = held.filter((d) => d.where.regions?.length === 1 && d.where.regions[0] === r);
      expect(mine.length, `region ${r}`).toBe(1);
      expect(mine[0].rarity).toBe('rare');
    }
    expect(held.length).toBe(5);
  });

  it('is owed from the region’s run number `held` on, until met', () => {
    const beat = RIFT_BY_ID['sunken-shrine'];
    const p = profileAt(2);
    p.regions['2'].runs = beat.where.held! - 2;
    expect(heldBeat(p)).toBeNull();
    expect(riftConfig(p, false)?.beat).toBeUndefined();
    p.regions['2'].runs = beat.where.held! - 1;
    expect(heldBeat(p)).toBe('sunken-shrine');
    expect(riftConfig(p, false)?.beat).toBe('sunken-shrine');
    // Met once (glimpsed counts): owed no more.
    p.rifts['sunken-shrine'] = { glimpsed: 1, seen: 0, taken: [] };
    expect(heldBeat(p)).toBeNull();
    // Never in a Trial: rifts are off there.
    delete p.rifts['sunken-shrine'];
    expect(riftConfig(p, true)).toBeNull();
  });

  it('a run that owes it opens with it, at the First Tear’s wave', () => {
    const p = profileAt(2);
    p.regions['2'].runs = RIFT_BY_ID['sunken-shrine'].where.held!;
    for (const seed of [1, 2, 3, 4]) {
      const run = createRun(buildRunConfig(p), seed);
      for (let n = 1; n <= 8; n++) waveByHand(run, n);
      expect(run.riftLog[0]?.id, `seed ${seed}`).toBe('sunken-shrine');
      expect(run.riftLog.filter((e) => e.id === 'sunken-shrine').length).toBe(1);
    }
  });

  it('is never drawn before it is met, nor by a config that does not know it', () => {
    const p = profileAt(2);
    p.regions['2'].runs = 1;
    for (let seed = 1; seed <= 40; seed++) {
      const run = createRun(buildRunConfig(p), seed);
      for (let n = 1; n <= 19; n++) waveByHand(run, n);
      expect(run.riftLog.some((e) => RIFT_BY_ID[e.id].where.held !== undefined), `seed ${seed}`).toBe(false);
    }
  });

  it('is banked into the journal like any rift, which releases it to the draw', () => {
    const p = profileAt(2);
    p.regions['2'].runs = RIFT_BY_ID['sunken-shrine'].where.held!;
    const run = createRun(buildRunConfig(p), 1);
    for (let n = 1; n <= 6; n++) waveByHand(run, n);
    bankRun(p, run);
    expect(p.rifts['sunken-shrine']).toBeDefined();
    expect(riftConfig(p, false)?.known).toContain('sunken-shrine');
    expect(heldBeat(p)).toBeNull();
  });
});

describe('R2 §4: a plateau leads with what moved', () => {
  /** Region 2 at a best of 16, with `recent` waves behind it. */
  function plateaued(recent: number[]): Profile {
    const p = profileAt(2);
    p.regions['2'] = { bestWave: 16, runs: 10, recent };
    p.shards = 0;
    return p;
  }

  it('a run short of the best is set against its last few, and the Forge’s next node', () => {
    const p = plateaued([13, 14, 15]);
    const run = createRun(buildRunConfig(p), 1);
    run.wave = 15;
    run.shards = 5;
    const s = bankRun(p, run);
    expect(s.plateau).not.toBeNull();
    expect(s.plateau!.best).toBe(16);
    expect(s.plateau!.median).toBe(14);
    expect(s.plateau!.runs).toBe(3);
    expect(p.regions['2'].recent).toEqual([13, 14, 15, 15]);
    const line = plateauLine(s)!;
    expect(line).toMatch(/Further than your last 3 runs here \(wave 14\)/);
    if (s.plateau!.forge) {
      expect(s.plateau!.forge.to).toBeGreaterThan(s.plateau!.forge.from);
      expect(line).toContain(s.plateau!.forge.name);
    }
  });

  it('keeps only the last few waves', () => {
    const p = plateaued([10, 11, 12, 13, 14]);
    const run = createRun(buildRunConfig(p), 1);
    run.wave = 12;
    bankRun(p, run);
    expect(p.regions['2'].recent).toEqual([11, 12, 13, 14, 12]);
    expect(p.regions['2'].recent!.length).toBe(PLATEAU.runs);
  });

  it('no plateau at a new best, with too few runs to compare, or in a Trial', () => {
    const best = plateaued([13, 14, 15]);
    const run = createRun(buildRunConfig(best), 1);
    run.wave = 17;
    expect(bankRun(best, run).plateau).toBeNull();

    const few = plateaued([14]);
    const r2 = createRun(buildRunConfig(few), 1);
    r2.wave = 15;
    expect(bankRun(few, r2).plateau).toBeNull();
    expect(few.regions['2'].recent).toEqual([14, 15]);

    const trial = plateaued([13, 14, 15]);
    trial.bosses['bog-mother'] = { kills: 1, fastest: 60 };
    const t = TRIALS.find((x) => x.region === 2)!;
    expect(chooseTrial(trial, t.id)).toBe(true);
    const r3 = createRun(buildRunConfig(trial), 1);
    r3.wave = 12;
    expect(bankRun(trial, r3).plateau).toBeNull();
    expect(trial.regions['2'].recent).toEqual([13, 14, 15]);
  });

  it('the line says nothing when nothing moved', () => {
    expect(plateauLine({ wave: 12, plateau: { best: 16, runs: 5, median: 14, forge: null } })).toBeNull();
    expect(plateauLine({ wave: 12, plateau: null })).toBeNull();
    expect(plateauLine({ wave: 12, plateau: { best: 16, runs: 5, median: 14, forge: { id: 'x', name: 'Riveted', from: 0.5, to: 1 } } }))
      .toBe('Riveted 50% → ready');
  });
});

describe('R2 §5: I6’s later clause reads from 2 h to the Blight', () => {
  it('the window ends at the Blight’s first fall, or the report’s end', () => {
    expect(lateWindow(6 * 3600, 4 * 3600)).toEqual({ from: I6_LATE.from, to: 4 * 3600 });
    expect(lateWindow(3 * 3600, null)).toEqual({ from: I6_LATE.from, to: 3 * 3600 });
    expect(lateWindow(14 * 3600, null)).toEqual({ from: I6_LATE.from, to: I6_LATE.to });
    expect(lateWindow(1.5 * 3600, null)).toBeNull();
  });

  it('a gap after the Blight does not count against it', () => {
    const reveals = [7300, 8500, 10_000, 12_000, 13_500, 14_400].map((at) => ({ at, what: 'x' }));
    const w = lateWindow(6 * 3600, 14_400)!;
    expect(worstGapIn(reveals, w.from, w.to).seconds).toBe(2000);
  });
});
