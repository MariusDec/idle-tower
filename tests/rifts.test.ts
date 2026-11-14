import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../src/app/loop';
import { BALANCE } from '../src/content/balance';
import { EVOLUTION_OF } from '../src/content/evolutions';
import { regionByIndex } from '../src/content/regions';
import { RIFTS } from '../src/content/rifts';
import type { RiftId } from '../src/content/types';
import { hashString } from '../src/core/rng';
import { riftJournal, collectionPages } from '../src/meta/collection';
import { featMet } from '../src/meta/feats';
import { newProfile, type Profile } from '../src/meta/profile';
import { bankRun } from '../src/meta/results';
import { buildRunConfig, riftConfig } from '../src/meta/runConfig';
import { applyInput, createRun, step } from '../src/sim/run';
import type { RiftConfig, RunConfig, RunState } from '../src/sim/state';
import { gainXp, tickDraft } from '../src/sim/systems/draft';
import { riftLegal, tickRifts } from '../src/sim/systems/rifts';
import { startWave } from '../src/sim/systems/waves';
import { botInput } from '../tools/bot';

/** A profile past the Gatekeeper and the first draft, with a little Forge. */
function gatePast(): Profile {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  p.bosses.gatekeeper = { kills: 1, fastest: 60 };
  p.forge = { 'might-damage': 1, scattershot: 1, 'chain-lightning': 1 };
  return p;
}

const ON: RiftConfig = { first: false, known: [], act2: false };

function config(rifts: RiftConfig | null = ON, regionId = 1): RunConfig {
  return { ...buildRunConfig(gatePast()), regionId, rifts };
}

function stateHash(run: RunState, omitRifts = false): number {
  const { events: _events, ...rest } = run;
  if (!omitRifts) return hashString(JSON.stringify(rest));
  const { riftCfg: _c, rift: _r, riftRoll: _o, riftLog: _l, streams, ...core } = rest;
  const { rifts: _s, riftFx: _f, ...others } = streams;
  return hashString(JSON.stringify({ ...core, streams: others }));
}

/** Drive wave starts by hand: wave `n` starts, and its rift (if any) is given time to appear and shut. */
function waveByHand(run: RunState, n: number): void {
  const region = regionByIndex(run.regionId);
  run.time = n * 100;
  startWave(run, region, n);
  tickRifts(run, region);
  run.time += 60;
  tickRifts(run, region);
  run.time += 60;
  tickRifts(run, region);
}

/** A run with `id` shown on the field, ready to tap. */
function withRift(id: RiftId, cfg: RunConfig = config()): RunState {
  const run = createRun(cfg, 3);
  run.wave = 5;
  run.rift = { id, x: 0, y: -100, at: 0, closesAt: 1e9, wave: 5, phase: 'shown' };
  return run;
}

describe('rifts: when they open (plans/late-game/02 §3)', () => {
  it('none before the Gatekeeper, in a Trial or in Boss Rush; the First Tear is owed until opened', () => {
    expect(riftConfig(newProfile(0), false)).toBeNull();
    const p = gatePast();
    expect(riftConfig(p, true)).toBeNull();
    expect(riftConfig(p, false)?.first).toBe(true);
    p.tutorial.firstRift = true;
    expect(riftConfig(p, false)?.first).toBe(false);
    p.rifts.wager = { glimpsed: 1, seen: 0, taken: [] };
    expect(riftConfig(p, false)?.known).toEqual(['wager']);
  });

  it('the First Tear opens at wave 4, waits 20 s, and is the run\'s only rift', () => {
    const run = createRun(config({ first: true, known: [], act2: false }), 5);
    const opened: number[] = [];
    for (let n = 1; n <= 19; n++) {
      waveByHand(run, n);
      for (const e of run.events) if (e.kind === 'riftAppear') opened.push(n);
      run.events.length = 0;
    }
    expect(opened).toEqual([4]);
    expect(run.riftLog).toEqual([{ id: 'first-tear', wave: 4, choice: null, tapped: false }]);
  });

  it('a sure chance shows the cap and the gap: waves 4 and 8, one more in overtime, none on the boss wave', () => {
    const run = createRun(config({ ...ON, rate: 50 }), 7);
    for (let n = 1; n <= 30; n++) waveByHand(run, n);
    expect(run.riftLog.map((e) => e.wave)).toEqual([4, 8, 21]);
    expect(run.riftLog.every((e) => e.wave !== 20)).toBe(true);
  });

  it('the same seed gives the same rifts by wave', () => {
    const a = createRun(config(), 11);
    const b = createRun(config(), 11);
    for (let n = 1; n <= 30; n++) {
      waveByHand(a, n);
      waveByHand(b, n);
    }
    expect(a.riftLog).toEqual(b.riftLog);
  });

  it('about two a run to wave 20, from wave 4, and only rifts that may open in the region', () => {
    let total = 0;
    const seeds = 200;
    for (let s = 1; s <= seeds; s++) {
      const run = createRun(config(), s);
      for (let n = 1; n <= 19; n++) waveByHand(run, n);
      total += run.riftLog.length;
      for (const e of run.riftLog) {
        expect(e.wave).toBeGreaterThanOrEqual(BALANCE.rifts.from);
        const def = RIFTS.find((r) => r.id === e.id)!;
        expect(def.rarity).toBe('common');
        if (def.where.regions) expect(def.where.regions).toContain(1);
      }
    }
    expect(total / seeds).toBeGreaterThan(1.5);
    expect(total / seeds).toBeLessThan(2.5);
  });
});

describe('rifts: the untouched rift (plans/late-game/02 §5)', () => {
  it('a rift never tapped changes nothing outside its own fields and streams', () => {
    const off = createRun(config(null), 21);
    const on = createRun(config(), 21);
    const pick = (run: RunState) => (run.draft ? { pick: run.draft.suggested } : {});
    let waves = 0;
    let shown = 0;
    for (let i = 0; i < Math.round(600 / SIM_DT) && !off.outcome && !on.outcome; i++) {
      step(off, SIM_DT, pick(off));
      step(on, SIM_DT, pick(on));
      shown += on.events.filter((e) => e.kind === 'riftAppear').length;
      off.events.length = 0;
      on.events.length = 0;
      if (on.wave > waves) {
        waves = on.wave;
        expect(stateHash(on, true)).toBe(stateHash(off, true));
      }
    }
    expect(waves).toBeGreaterThan(8);
    expect(shown).toBeGreaterThan(0);
  });
});

describe('rifts: tapping and choosing', () => {
  it('a tap does nothing with a draft open; leaving logs it as seen', () => {
    const run = withRift('wager');
    gainXp(run, run.xpNext / run.stats.xpMult + 1e-9);
    tickDraft(run);
    expect(run.draft).not.toBeNull();
    applyInput(run, { tapRift: true });
    expect(run.rift?.phase).toBe('shown');
    applyInput(run, { pick: 0 });
    applyInput(run, { tapRift: true });
    expect(run.rift?.phase).toBe('choosing');
    applyInput(run, { chooseRift: -1 });
    expect(run.rift).toBeNull();
    expect(run.riftLog).toEqual([{ id: 'wager', wave: 5, choice: null, tapped: true }]);
  });

  it('no draft opens while a rift is being chosen', () => {
    const run = withRift('glimmer-cache');
    applyInput(run, { tapRift: true });
    gainXp(run, run.xpNext / run.stats.xpMult + 1e-9);
    tickDraft(run);
    expect(run.draft).toBeNull();
    applyInput(run, { chooseRift: 0 });
    tickDraft(run);
    expect(run.draft).not.toBeNull();
  });

  it('hurt never drops HP below the floor', () => {
    const run = withRift('open-flame');
    run.tower.hp = run.stats.maxHp * 0.2;
    applyInput(run, { tapRift: true, chooseRift: 0 });
    expect(run.tower.hp).toBeCloseTo(run.stats.maxHp * BALANCE.rifts.hurtFloor);
    expect(run.pendingDrafts).toBe(2);
  });

  it('shards pay into their own share; a stat span expires on the right wave', () => {
    const run = withRift('ashfall');
    const range = run.stats.range;
    const damage = run.stats.damageMult;
    applyInput(run, { tapRift: true, chooseRift: 0 });
    expect(run.stats.range).toBeCloseTo(range * 0.8);
    expect(run.stats.damageMult).toBeCloseTo(damage * 1.1);
    // Taken in wave 5: the rest of it and two more, so through wave 7.
    for (let n = 6; n <= 7; n++) waveByHand(run, n);
    expect(run.stats.range).toBeCloseTo(range * 0.8);
    waveByHand(run, 8);
    expect(run.stats.range).toBeCloseTo(range);
    expect(run.stats.damageMult).toBeCloseTo(damage * 1.1);

    const cache = withRift('glimmer-cache');
    applyInput(cache, { tapRift: true, chooseRift: 0 });
    expect(cache.shardsFrom.rifts).toBeGreaterThan(0);
    expect(cache.shards).toBe(cache.shardsFrom.rifts);
  });

  it('Old Coin kept pays at wave 20, and is greyed out past it', () => {
    const run = withRift('old-coin');
    applyInput(run, { tapRift: true, chooseRift: 1 });
    expect(run.shardsFrom.rifts).toBe(0);
    for (let n = 6; n <= 19; n++) waveByHand(run, n);
    expect(run.shardsFrom.rifts).toBe(0);
    waveByHand(run, 20);
    expect(run.shardsFrom.rifts).toBeGreaterThan(0);
    const late = withRift('old-coin');
    late.wave = 22;
    expect(riftLegal(late, 1)).not.toBeNull();
    expect(riftLegal(late, 0)).toBeNull();
  });

  it('Cracked Mirror takes from the strongest and gives to the others', () => {
    const run = withRift('cracked-mirror');
    run.weapons[0].level = 4;
    applyInput(run, { tapRift: true });
    // One weapon: nobody else to level.
    expect(riftLegal(run, 0)).not.toBeNull();
    applyInput(run, { chooseRift: 0 });
    expect(run.rift?.phase).toBe('choosing');
  });

  it('Split Sky swells the boss as it arrives', () => {
    const run = withRift('split-sky', config(ON, 3));
    applyInput(run, { tapRift: true, chooseRift: 0 });
    expect(run.weapons[0].level).toBe(2);
    for (let n = 6; n <= 19; n++) waveByHand(run, n);
    waveByHand(run, 20);
    const boss = run.enemies.find((e) => e.id === run.boss?.enemy)!;
    const plain = createRun(config(ON, 3), 3);
    for (let n = 1; n <= 20; n++) waveByHand(plain, n);
    const other = plain.enemies.find((e) => e.id === plain.boss?.enemy)!;
    expect(boss.maxHp).toBeCloseTo(other.maxHp * 1.5);
  });

  it('a forged hand offers the evolution of a weapon at level 3, partner or not', () => {
    const cfg = config(ON, 2);
    const run = withRift('blood-price', { ...cfg, behaviours: { ...cfg.behaviours, alchemy: 1 } });
    run.weapons[0].level = 3;
    applyInput(run, { tapRift: true, chooseRift: 0 });
    tickDraft(run);
    expect(run.draft!.cards).toContainEqual({ kind: 'evolution', id: EVOLUTION_OF[run.weapons[0].id].id });
    expect(run.forgedHand).toBe(false);
  });

  it('a snapshot taken while choosing resumes to the same run', () => {
    const run = createRun(config({ ...ON, rate: 50 }), 31);
    let i = 0;
    while (run.rift?.phase !== 'shown' && i++ < 1e5) {
      step(run, SIM_DT, run.draft ? { pick: run.draft.suggested } : {});
      run.events.length = 0;
    }
    applyInput(run, { tapRift: true });
    expect(run.rift?.phase).toBe('choosing');
    const copy = JSON.parse(JSON.stringify({ ...run, events: [] })) as RunState;
    for (const r of [run, copy]) {
      applyInput(r, { chooseRift: 0 });
      for (let k = 0; k < 600; k++) step(r, SIM_DT, botInput(r, 'active'));
      r.events.length = 0;
    }
    expect(stateHash(copy)).toBe(stateHash(run));
  });
});

describe('rifts: the journal (plans/late-game/02 §5)', () => {
  it('bankRun records glimpsed, seen and taken; the First Tear\'s lesson; active-only pay', () => {
    const p = gatePast();
    const run = createRun(config({ first: true, known: [], act2: false }), 4);
    run.riftLog.push({ id: 'first-tear', wave: 4, choice: 0, tapped: true }, { id: 'wager', wave: 9, choice: null, tapped: false });
    run.shardsFrom.rifts = 40;
    run.shards = 40;
    const s = bankRun(p, run);
    expect(p.tutorial.firstRift).toBe(true);
    expect(p.rifts['first-tear']).toEqual({ glimpsed: 0, seen: 1, taken: [1] });
    expect(p.rifts.wager).toEqual({ glimpsed: 1, seen: 0, taken: [] });
    expect(s.activeOnly.filter((a) => a.kind === 'rift')).toHaveLength(2);
    expect(s.rifts).toHaveLength(2);
    expect(collectionPages(p).rifts).toBe(true);
    const anywhere = riftJournal(p).find((g) => g.region === 0)!;
    expect(anywhere.rows.find((r) => r.rift.id === 'wager')?.state).toBe('glimpsed');
    // Legendaries stay hidden until met.
    expect(riftJournal(p).flatMap((g) => g.rows).some((r) => r.rift.rarity === 'legendary')).toBe(false);
  });

  it('the feats read the journal', () => {
    const p = gatePast();
    expect(featMet(p, { kind: 'riftOpened', rarity: 'legendary' }, null)).toBe(false);
    p.rifts['split-sky'] = { glimpsed: 0, seen: 1, taken: [0] };
    expect(featMet(p, { kind: 'riftOpened', rarity: 'legendary' }, null)).toBe(true);
    p.rifts.wager = { glimpsed: 0, seen: 30, taken: [25] };
    expect(featMet(p, { kind: 'riftsTaken', n: 25 }, null)).toBe(true);
  });

  it('a run with none banks nothing to the journal, and no active-only reward', () => {
    const p = gatePast();
    const run = createRun(config(), 4);
    const s = bankRun(p, run);
    expect(p.rifts).toEqual({});
    expect(s.activeOnly).toEqual([]);
  });
});
