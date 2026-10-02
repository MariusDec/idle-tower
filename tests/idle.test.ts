import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/content/balance';
import { newProfile, type Profile } from '../src/meta/profile';
import {
  TACTICS_ALL, autoUlt, draftSeconds, marchOn, maxSpeed, priorityList, tacticsKey,
} from '../src/meta/automation';
import { offlineEarnings, offlineTier } from '../src/meta/offline';
import { buildRunConfig } from '../src/meta/runConfig';
import { bankRun } from '../src/meta/results';
import { MemorySaveStore } from '../src/meta/save/stores/SaveStore';
import { loadRunSnapshot, saveRunSnapshot, snapshotRun } from '../src/meta/save';
import { MIGRATIONS, migrate } from '../src/meta/save/migrate';
import { isProfile } from '../src/meta/save/schema';
import { createRun, step } from '../src/sim/run';
import type { Card, RunState } from '../src/sim/state';
import { suggest } from '../src/sim/suggest';
import { autoUltWanted, enemiesInRange } from '../src/sim/systems/ultimate';
import { SIM_DT } from '../src/app/loop';
import { botInput } from '../tools/bot';
import { playRun } from '../tools/play';

/** A profile owning these Forge nodes, with these bosses down. */
function owning(nodes: string[], bosses: string[] = []): Profile {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  for (const id of nodes) p.forge[id] = 1;
  for (const id of bosses) p.bosses[id] = { kills: 1, fastest: 60 };
  return p;
}

const BOLT: Card = { kind: 'weapon', id: 'arcane-bolt', level: 2 };
const POWER: Card = { kind: 'passive', id: 'power', level: 1 };
const FORTIFY: Card = { kind: 'passive', id: 'fortify', level: 1 };

describe('Engineering automation (§6.2)', () => {
  it('speed ×3 needs Overclock; ×2 needs Overdrive', () => {
    expect(maxSpeed(owning([]))).toBe(1);
    expect(maxSpeed(owning(['speed-2']))).toBe(2);
    expect(maxSpeed(owning(['speed-2', 'speed-3']))).toBe(3);
  });

  it('the highest Night Watch owned sets the offline tier', () => {
    expect(offlineTier(owning([]))).toBeNull();
    expect(offlineTier(owning(['offline']))).toEqual(BALANCE.offline.tiers[0]);
    expect(offlineTier(owning(['offline', 'offline-2']))).toEqual(BALANCE.offline.tiers[1]);
    expect(offlineTier(owning(['offline', 'offline-2', 'offline-3']))).toEqual(BALANCE.offline.tiers[2]);
  });

  it('a higher tier pays more and caps later (§6.3)', () => {
    const one = owning(['offline']);
    const two = owning(['offline', 'offline-2']);
    one.farm = [60];
    two.farm = [60];
    const away = 5 * 3600;
    const a = offlineEarnings(one, away)!;
    const b = offlineEarnings(two, away)!;
    expect(a.paid).toBe(2 * 3600);
    expect(b.paid).toBe(4 * 3600);
    expect(b.shards).toBe(Math.floor(60 * 240 * 0.4));
    expect(b.shards).toBeGreaterThan(a.shards);
  });

  it('the Autocaster needs its node and the HUD switch on', () => {
    const p = owning(['auto-ult']);
    expect(autoUlt(owning([]))).toBe(false);
    expect(autoUlt(p)).toBe(true);
    p.settings.autoUlt = false;
    expect(autoUlt(p)).toBe(false);
  });

  it('drafts wait less once the Tactician writes the suggestion', () => {
    expect(draftSeconds(owning([]))).toBe(BALANCE.draft.seconds);
    expect(draftSeconds(owning(['tactician']))).toBe(BALANCE.automation.tacticianSeconds);
  });
});

describe('the Autocaster rule', () => {
  const charged = (): RunState => {
    const run = createRun(buildRunConfig(owning([])), 3);
    run.ult.charge = 1;
    return run;
  };

  it('waits for a charge, then casts into a crowd', () => {
    const run = charged();
    run.ult.charge = 0.5;
    expect(autoUltWanted(run, 0)).toBe(false);
    run.ult.charge = 1;
    expect(enemiesInRange(run)).toBe(0);
    expect(autoUltWanted(run, 1)).toBe(false);
    expect(autoUltWanted(run, 0)).toBe(true);
  });

  it('casts at a standing boss, but not one under the water', () => {
    const run = charged();
    run.boss = {
      id: 'gatekeeper', enemy: 1, phase: 0, arrivedAt: 0, timers: [], windup: 0, submerged: false,
      enraged: false, windupPattern: -1, staggeredUntil: 0, facet: 0, crown: 0, plates: 0, minHp: 1, killedIn: null, wave: 20,
    };
    expect(autoUltWanted(run, 99)).toBe(true);
    run.boss.submerged = true;
    expect(autoUltWanted(run, 99)).toBe(false);
  });
});

describe('the Tactician (§6.2)', () => {
  it('has no list before it is owned; one shared list with Tactician I', () => {
    expect(tacticsKey(owning([]))).toBeNull();
    const p = owning(['tactician']);
    expect(tacticsKey(p)).toBe(TACTICS_ALL);
    expect(priorityList(p)).toBeNull();
    p.tactics[TACTICS_ALL] = ['fortify', 'power'];
    expect(priorityList(p)).toEqual(['fortify', 'power']);
  });

  it('Tactician II keeps a list per frame, starting from the shared one', () => {
    const p = owning(['tactician', 'tactician-2'], ['bog-mother']);
    p.tactics[TACTICS_ALL] = ['power'];
    expect(tacticsKey(p)).toBe('arcanist');
    expect(priorityList(p)).toEqual(['power']);
    p.tactics.arcanist = ['fortify'];
    expect(priorityList(p)).toEqual(['fortify']);
    p.frame = 'bastion';
    expect(tacticsKey(p)).toBe('bastion');
    expect(priorityList(p)).toEqual(['power']);
  });

  it('the run config keeps only listed items the pool can offer', () => {
    const p = owning(['tactician']);
    p.tactics[TACTICS_ALL] = ['sunlance', 'fortify'];
    expect(buildRunConfig(p).priority).toEqual(['fortify']);
    p.tactics[TACTICS_ALL] = ['sunlance'];
    expect(buildRunConfig(p).priority).toBeNull();
  });

  it('the suggestion takes the highest-listed card; unlisted ones fall to the scorer', () => {
    const p = owning(['tactician']);
    const scored = createRun(buildRunConfig(p), 1);
    const free = suggest(scored, [BOLT, POWER, FORTIFY]);
    p.tactics[TACTICS_ALL] = ['fortify', 'power'];
    const listed = createRun(buildRunConfig(p), 1);
    expect(suggest(listed, [BOLT, POWER, FORTIFY])).toBe(2);
    expect(suggest(listed, [BOLT, POWER])).toBe(1);
    // Nothing on offer is listed: the scorer decides, as without a list.
    p.tactics[TACTICS_ALL] = ['mending'];
    const other = createRun(buildRunConfig(p), 1);
    expect(suggest(other, [BOLT, POWER, FORTIFY])).toBe(free);
  });

  it('an evolution outranks the list', () => {
    const p = owning(['tactician']);
    p.tactics[TACTICS_ALL] = ['power'];
    const run = createRun(buildRunConfig(p), 1);
    expect(suggest(run, [POWER, { kind: 'evolution', id: 'seeker-swarm' }])).toBe(1);
  });
});

describe('Frontier March (§6.2)', () => {
  const felled = (p: Profile) => {
    const run = createRun(buildRunConfig(p), 1);
    run.boss = {
      id: 'gatekeeper', enemy: 1, phase: 0, arrivedAt: 0, timers: [], windup: 0, submerged: false,
      enraged: false, windupPattern: -1, staggeredUntil: 0, facet: 0, crown: 0, plates: 0, minHp: 1, killedIn: 30, wave: 20,
    };
    run.outcome = { kind: 'fell', wave: 21, time: 600 };
    return bankRun(p, run);
  };

  it('moves the next run to the new frontier after a first boss kill', () => {
    const p = owning(['frontier-march']);
    expect(marchOn(p, felled(p))).toBe(true);
    expect(p.region).toBe(2);
  });

  it('does nothing without the node, or on a repeat kill', () => {
    const p = owning([]);
    expect(marchOn(p, felled(p))).toBe(false);
    expect(p.region).toBe(1);
    const q = owning(['frontier-march'], ['gatekeeper']);
    expect(marchOn(q, felled(q))).toBe(false);
    expect(q.region).toBe(1);
  });
});

describe('save v6 and the kill-safe snapshot (§12.4)', () => {
  it('walks a v5 profile to v6: no lists, the Autocaster on, the sound kept', () => {
    const out = migrate({ version: 5, createdAt: 5, shards: 50, records: {}, forge: {}, settings: { speed: 2, sound: false } }, MIGRATIONS, 6);
    expect(out.version).toBe(6);
    expect(out.tactics).toEqual({});
    expect(out.settings).toEqual({ speed: 2, sound: false, autoUlt: true });
    expect(isProfile(out)).toBe(true);
  });

  it('a snapshot whose clear never landed is not paid twice', async () => {
    const store = new MemorySaveStore();
    const profile = owning([]);
    const run = createRun(buildRunConfig(profile), 5);
    while (run.wave < 3) step(run, SIM_DT, botInput(run, 'active'));
    await saveRunSnapshot(snapshotRun(run, profile), store);
    expect(await loadRunSnapshot(profile, store)).not.toBeNull();
    await saveRunSnapshot(snapshotRun(run, profile), store);
    // The run is banked and the profile saved; the app dies before the clear.
    run.outcome = { kind: 'retreat', wave: run.wave, time: run.time };
    bankRun(profile, run);
    expect(await loadRunSnapshot(profile, store)).toBeNull();
  });

  it('killed at any step, a run comes back within one wave', async () => {
    const profile = owning([]);
    for (const killAt of [700, 2900, 6100, 9000]) {
      const store = new MemorySaveStore();
      const run = createRun(buildRunConfig(profile), 11);
      let wave = 0;
      while (!run.outcome && run.tick < killAt) {
        step(run, SIM_DT, botInput(run, 'active'));
        run.events.length = 0;
        // The app snapshots on the step a wave starts.
        if (run.wave > wave) {
          wave = run.wave;
          await saveRunSnapshot(snapshotRun(run, profile), store);
        }
      }
      const back = await loadRunSnapshot(profile, store);
      expect(back).not.toBeNull();
      expect(run.wave - back!.wave).toBeLessThanOrEqual(1);
      expect(back!.tick).toBeLessThanOrEqual(run.tick);
    }
  });
});

describe('the idle bot (§13)', () => {
  it('lets a draft run its timer out at slow motion, then takes the suggestion', () => {
    const p = owning([]);
    const run = createRun(buildRunConfig(p), 2);
    let drafts = 0;
    const out = playRun(p, run, { policy: 'idle', speed: 2, onDraft: () => { drafts++; } });
    expect(drafts).toBeGreaterThan(2);
    // Every draft holds the arena at 15% for its ten wall seconds: the wall
    // clock runs that much past the sim's own time at this speed.
    const D = BALANCE.draft;
    const overhead = out.wall - run.time / 2;
    expect(overhead).toBeCloseTo(drafts * D.seconds * (1 - D.slowMotion), -1);
  });
});
