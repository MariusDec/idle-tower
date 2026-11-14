import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../src/app/loop';
import { ANOMALIES } from '../src/content/anomalies';
import { BALANCE } from '../src/content/balance';
import { explainerOpen } from '../src/meta/explainers';
import { newProfile, type Profile } from '../src/meta/profile';
import { bankRun } from '../src/meta/results';
import { anomalyChance, buildRunConfig } from '../src/meta/runConfig';
import { createRun, step } from '../src/sim/run';
import type { Card, RunState } from '../src/sim/state';
import { newWeapon } from '../src/sim/systems/arms';
import { tickWeapons } from '../src/sim/systems/combat';
import {
  applyCard, banishable, candidateCards, evolutionCards, forgedOffer, holdsAnomaly, pickCard, rerollDraft, takeSuggested, tickDraft,
} from '../src/sim/systems/draft';
import { Rng } from '../src/core/rng';
import { body } from './helpers/body';

/**
 * Anomalies (plans/late-game/04): a rare card that breaks a weapon's rule.
 * Never suggested, so never taken for the player; once a run; it forbids
 * the weapon's evolution and its fusions.
 */

/** Past the first draft, with a recipe found: the gate is open. */
function opened(): Profile {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  p.recipes.found = ['absolute-zero'];
  return p;
}

/** A run that holds an anomaly (`chance` 1, no wait), carrying Frost Ring at `level`. */
function holding(seed = 1, level = 3): RunState {
  const run = createRun({ ...buildRunConfig(opened()), anomaly: { chance: 1 } }, seed);
  run.anomaly!.delay = 0;
  run.weapons.push(newWeapon('frost-ring', level));
  return run;
}

/** Bank a draft and open it. */
function open(run: RunState): void {
  run.pendingDrafts++;
  tickDraft(run);
}

const anomalyAt = (cards: readonly Card[]): number => cards.findIndex((c) => c.kind === 'anomaly');

describe('the rate (plans/late-game/04 §3)', () => {
  it('is shut before the first recipe, sure until the first offer, then the base plus the dry ramp', () => {
    const fresh = newProfile(0);
    expect(anomalyChance(fresh, false)).toBe(0);
    expect(buildRunConfig(fresh).anomaly).toBeNull();
    const p = opened();
    expect(anomalyChance(p, false)).toBe(BALANCE.anomalies.first);
    p.anomalies.glimpsed = ['whiteout'];
    expect(anomalyChance(p, false)).toBeCloseTo(BALANCE.anomalies.chance);
    p.anomalies.dry = 3;
    expect(anomalyChance(p, false)).toBeCloseTo(BALANCE.anomalies.chance + 3 * BALANCE.anomalies.dryStep);
    p.anomalies.dry = 1000;
    expect(anomalyChance(p, false)).toBeCloseTo(BALANCE.anomalies.dryCap);
  });

  it('is 0 in a Trial', () => {
    expect(anomalyChance(opened(), true)).toBe(0);
  });

  it('rolls on its own stream: a run with none draws its waves and hands as before', () => {
    const p = opened();
    const a = createRun({ ...buildRunConfig(p), anomaly: null }, 7);
    const b = createRun({ ...buildRunConfig(p), anomaly: { chance: 1 } }, 7);
    expect(b.streams.draft).toEqual(a.streams.draft);
    expect(b.streams.waves).toEqual(a.streams.waves);
    expect(b.rng).toEqual(a.rng);
  });
});

describe('the offer (plans/late-game/04 §3)', () => {
  it('is dealt at the end of the hand once a weapon reaches level 3, and never suggested', () => {
    const run = holding();
    open(run);
    const cards = run.draft!.cards;
    expect(cards[cards.length - 1]).toEqual({ kind: 'anomaly', id: 'whiteout' });
    expect(cards[run.draft!.suggested].kind).not.toBe('anomaly');
    expect(run.events.some((e) => e.kind === 'anomalyOffer')).toBe(true);
  });

  it('waits for a weapon at level 3', () => {
    const run = holding(1, 2);
    open(run);
    expect(holdsAnomaly(run.draft!.cards)).toBe(false);
    expect(run.anomaly!.offered).toBeNull();
  });

  it('waits its rolled delay in eligible drafts', () => {
    const run = holding();
    run.anomaly!.delay = 2;
    for (let i = 0; i < 2; i++) {
      open(run);
      expect(holdsAnomaly(run.draft!.cards)).toBe(false);
      pickCard(run, run.draft!.suggested);
      run.weapons.find((w) => w.id === 'frost-ring')!.level = 3;
    }
    open(run);
    expect(holdsAnomaly(run.draft!.cards)).toBe(true);
  });

  it('is never suggested over many hands, the Tactician’s list naming its weapon first', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const run = holding(seed);
      if (seed % 2 === 0) run.priority = ['frost-ring'];
      open(run);
      const d = run.draft!;
      expect(anomalyAt(d.cards)).toBeGreaterThanOrEqual(0);
      expect(d.suggested).not.toBe(anomalyAt(d.cards));
    }
  });

  it('is never a deck card, and comes once a run, taken or not', () => {
    const run = holding();
    expect(candidateCards(run).some((c) => c.kind === 'anomaly')).toBe(false);
    open(run);
    pickCard(run, run.draft!.suggested);
    for (let i = 0; i < 10; i++) {
      open(run);
      expect(holdsAnomaly(run.draft!.cards)).toBe(false);
      pickCard(run, run.draft!.suggested);
    }
  });

  it('survives a reroll; Banish can’t strike it', () => {
    const run = holding();
    run.rerolls = 1;
    open(run);
    const i = anomalyAt(run.draft!.cards);
    expect(banishable(run, run.draft!.cards[i])).toBe(false);
    rerollDraft(run);
    expect(run.rerolls).toBe(0);
    expect(holdsAnomaly(run.draft!.cards)).toBe(true);
    expect(run.draft!.cards[run.draft!.suggested].kind).not.toBe('anomaly');
  });

  it('stops Take-all at a later hand that deals one; a second Take-all takes it (the player has seen it)', () => {
    const run = holding();
    run.anomaly!.delay = 1;
    run.pendingDrafts = 3;
    tickDraft(run);
    expect(holdsAnomaly(run.draft!.cards)).toBe(false);
    expect(takeSuggested(run)).toBe(1);
    expect(holdsAnomaly(run.draft!.cards)).toBe(true);
    expect(takeSuggested(run)).toBe(2);
    expect(run.anomaly!.taken).toBeNull();
  });

  it('comes in a forged hand (Blood Price) whenever none has been taken, held or not', () => {
    const run = holding();
    run.anomaly!.held = false;
    run.forgedHand = true;
    open(run);
    expect(holdsAnomaly(run.draft!.cards)).toBe(true);
  });
});

describe('taking one (plans/late-game/04 §3, §5)', () => {
  it('marks the weapon, which keeps levelling but never evolves or fuses', () => {
    const run = holding();
    open(run);
    pickCard(run, anomalyAt(run.draft!.cards));
    const w = run.weapons.find((x) => x.id === 'frost-ring')!;
    expect(w.anomaly).toBe('whiteout');
    expect(run.anomaly!.taken).toBe('whiteout');
    expect(run.events.some((e) => e.kind === 'anomaly')).toBe(true);
    // Level 5, its partner at 5, Alchemy owned: still no evolution card, forged or not.
    w.level = 5;
    run.behaviours.alchemy = 1;
    run.passives.push({ id: 'bulwark', level: 5 });
    expect(evolutionCards(run)).toEqual([]);
    expect(forgedOffer(run, new Rng(1)).some((c) => c.kind === 'evolution' && c.id === 'absolute-zero')).toBe(false);
    applyCard(run, { kind: 'evolution', id: 'absolute-zero' });
    expect(w.evolved).toBe(false);
    // Still a weapon card to level.
    w.level = 4;
    expect(candidateCards(run).some((c) => c.kind === 'weapon' && c.id === 'frost-ring' && c.level === 5)).toBe(true);
  });

  it('banks as found, active-only (I9), and the feat; let go, it is glimpsed', () => {
    const p = opened();
    const run = holding();
    open(run);
    pickCard(run, anomalyAt(run.draft!.cards));
    run.outcome = { kind: 'retreat', wave: run.wave, time: run.time };
    const s = bankRun(p, run);
    expect(s.anomaly).toEqual({ id: 'whiteout', taken: true, fresh: true });
    expect(s.activeOnly.some((a) => a.kind === 'anomaly')).toBe(true);
    expect(p.anomalies.found).toEqual(['whiteout']);
    expect(p.anomalies.dry).toBe(0);
    expect(s.feats.some((f) => f.id === 'anomalous')).toBe(true);
    expect(explainerOpen(p, 'anomalies')).toBe(true);

    const q = opened();
    const missed = holding(2);
    open(missed);
    pickCard(missed, missed.draft!.suggested);
    const t = bankRun(q, missed);
    expect(t.anomaly).toEqual({ id: 'whiteout', taken: false, fresh: true });
    expect(t.activeOnly.some((a) => a.kind === 'anomaly')).toBe(false);
    expect(q.anomalies.glimpsed).toEqual(['whiteout']);
    expect(q.anomalies.found).toEqual([]);

    // A run that could deal one and didn't is a dry run.
    const dry = createRun({ ...buildRunConfig(q), anomaly: { chance: 0.01 } }, 3);
    dry.anomaly!.held = false;
    bankRun(q, dry);
    expect(q.anomalies.dry).toBe(1);
  });
});

describe('a run that lets its anomaly go plays as one that had none (plans/late-game/04 §6)', () => {
  it('timed out, wave for wave', () => {
    const p = opened();
    const config = { ...buildRunConfig(p), startingWeapon: 'frost-ring' as const, pool: [...buildRunConfig(p).pool, 'frost-ring' as const] };
    const play = (chance: number): RunState => {
      const run = createRun({ ...config, anomaly: chance > 0 ? { chance } : null }, 11);
      // Eligible from the first draft, so the offer surely comes (and the check isn't vacuous).
      run.weapons[0].level = 3;
      for (let i = 0; i < Math.round(900 / SIM_DT) && !run.outcome; i++) {
        step(run, SIM_DT, run.draft ? { pick: run.draft.suggested } : {});
        run.events.length = 0;
      }
      return run;
    };
    const a = play(0);
    const b = play(1);
    expect(b.anomaly!.offered).not.toBeNull();
    expect(b.anomaly!.taken).toBeNull();
    expect({ wave: b.wave, level: b.level, kills: b.kills, shards: b.shards }).toEqual({ wave: a.wave, level: a.level, kills: a.kills, shards: a.shards });
  });
});

describe('each shipped anomaly fires, credited to its weapon (T1)', () => {
  for (const a of ANOMALIES) {
    it(a.name, () => {
      const run = createRun({ ...buildRunConfig(opened()), anomaly: null }, 1);
      run.weapons = [{ ...newWeapon(a.weapon, 3), anomaly: a.id }];
      for (const [x, y] of [[150, 0], [170, 30], [0, 180], [-160, 40]]) body(run, { x, y, px: x, py: y, hp: 1e6, maxHp: 1e6 });
      for (let i = 0; i < Math.round(4 / SIM_DT); i++) {
        run.tick++;
        run.time = run.tick * SIM_DT;
        tickWeapons(run, SIM_DT);
        // Shells in flight land on their own step.
        for (const p of run.projectiles) {
          if (!p.alive) continue;
          p.life -= SIM_DT;
        }
      }
      if (a.id === 'creeping-barrage') {
        expect(run.projectiles.length).toBeGreaterThanOrEqual(BALANCE.anomalies['creeping-barrage'].blasts);
      } else {
        expect(run.damageBy[a.weapon] ?? 0).toBeGreaterThan(0);
      }
    });
  }
});
