import { describe, expect, it } from 'vitest';
import { newProfile, type Profile } from '../src/meta/profile';
import {
  equippedRelics, gainRelic, hubUnlocks, regionUnlocked, relicSlots, selectedFrame, selectedRegion, toggleRelic,
} from '../src/meta/collection';
import { buildRunConfig } from '../src/meta/runConfig';
import { buyNode, isBuyable, nodeStates } from '../src/meta/forge';
import { claimAll, claimFeat, checkFeats, featMet } from '../src/meta/feats';
import { farmRate, offlineEarnings, recordFarm } from '../src/meta/offline';
import { bankRun } from '../src/meta/results';
import { hubGoal } from '../src/meta/goals';
import { createRun, step } from '../src/sim/run';
import { damageEnemy } from '../src/sim/systems/combat';
import { bossBody } from '../src/sim/systems/boss';
import { BOSS_WAVE, startWave } from '../src/sim/systems/waves';
import { regionByIndex } from '../src/content/regions';
import { BALANCE } from '../src/content/balance';
import { FEATS } from '../src/content/feats';
import { FORGE } from '../src/content/forge';
import { SIM_DT } from '../src/app/loop';

function killed(...bosses: string[]): Profile {
  const p = newProfile(0);
  for (const b of bosses) p.bosses[b] = { kills: 1, fastest: 50 };
  return p;
}

describe('unlocks (§5.2, §7.1)', () => {
  it('Region 2, the Map, Feats and relic slot 1 open with the Gatekeeper', () => {
    const fresh = newProfile(0);
    expect(regionUnlocked(fresh, 2)).toBe(false);
    expect(hubUnlocks(fresh)).toEqual({ forge: false, map: false, collection: false, feats: false, stars: false });
    expect(relicSlots(fresh)).toBe(0);
    const p = killed('gatekeeper');
    expect(regionUnlocked(p, 2)).toBe(true);
    expect(hubUnlocks(p).map && hubUnlocks(p).feats).toBe(true);
    expect(relicSlots(p)).toBe(1);
    expect(relicSlots(killed('gatekeeper', 'bog-mother'))).toBe(2);
  });

  it('runs go to the chosen region and frame only once unlocked', () => {
    const p = newProfile(0);
    p.region = 2;
    p.frame = 'bastion';
    expect(selectedRegion(p).index).toBe(1);
    expect(selectedFrame(p).id).toBe('arcanist');
    expect(buildRunConfig(p).regionId).toBe(1);
    p.bosses = { gatekeeper: { kills: 1, fastest: 1 }, 'bog-mother': { kills: 1, fastest: 1 } };
    expect(buildRunConfig(p).regionId).toBe(2);
    expect(buildRunConfig(p).frameId).toBe('bastion');
  });

  it('the Collection opens on the third enemy type seen', () => {
    const p = newProfile(0);
    p.seenEnemies = ['grunt', 'runner'];
    expect(hubUnlocks(p).collection).toBe(false);
    p.seenEnemies.push('brute');
    expect(hubUnlocks(p).collection).toBe(true);
  });
});

describe('sealed Forge nodes (§5.1)', () => {
  it('show as sealed beside an owned node, and open with their boss', () => {
    const p = newProfile(0);
    p.shards = 1e9;
    for (const n of FORGE) if (!n.sealed) p.forge[n.id] = n.maxLevel;
    const sealed = FORGE.find((n) => n.sealed === 'gatekeeper')!;
    expect(nodeStates(p).get(sealed.id)).toBe('sealed');
    expect(isBuyable(p, sealed.id)).toBe(false);
    expect(buyNode(p, sealed.id)).toBe(false);
    p.bosses.gatekeeper = { kills: 1, fastest: 1 };
    expect(nodeStates(p).get(sealed.id)).toBe('open');
    expect(buyNode(p, sealed.id)).toBe(true);
  });
});

describe('relics (§5.3)', () => {
  it('a new relic is worn if a slot is free; duplicates rank it to III', () => {
    const p = killed('gatekeeper');
    expect(gainRelic(p, 'cracked-lens')).toBe(1);
    expect(p.equipped).toEqual(['cracked-lens']);
    expect(gainRelic(p, 'tallow-candle')).toBe(1);
    expect(p.equipped).toEqual(['cracked-lens']);
    expect(gainRelic(p, 'cracked-lens')).toBe(2);
    expect(gainRelic(p, 'cracked-lens')).toBe(3);
    expect(gainRelic(p, 'cracked-lens')).toBe(0);
  });

  it('wearing is limited to the slots, and only worn relics reach the run', () => {
    const p = killed('gatekeeper');
    gainRelic(p, 'cracked-lens');
    gainRelic(p, 'hunters-tally');
    expect(toggleRelic(p, 'hunters-tally')).toBe(false);
    expect(toggleRelic(p, 'cracked-lens')).toBe(true);
    expect(toggleRelic(p, 'hunters-tally')).toBe(true);
    expect(equippedRelics(p).map((x) => x.relic.id)).toEqual(['hunters-tally']);
    expect(buildRunConfig(p).behaviours.tally).toBe(1);
  });

  it('a relic at rank II applies its per-rank effects once more', () => {
    const p = killed('gatekeeper');
    gainRelic(p, 'cracked-lens');
    const one = createRun(buildRunConfig(p), 1).stats.critMult;
    gainRelic(p, 'cracked-lens');
    const two = createRun(buildRunConfig(p), 1).stats.critMult;
    expect(two - one).toBeCloseTo(0.5);
  });

  it("Gatekeeper's Seal starts the run a level up, its draft banked", () => {
    const p = killed('gatekeeper');
    p.tutorial.firstDraft = true;
    gainRelic(p, 'gatekeepers-seal');
    const run = createRun(buildRunConfig(p), 1);
    expect(run.level).toBe(2);
    expect(run.pendingDrafts).toBe(1);
  });
});

describe('feats (§5.4)', () => {
  it('are earned once, then paid once when claimed', () => {
    const p = newProfile(0);
    p.records.bestWave = 10;
    const done = checkFeats(p, null).map((f) => f.id);
    expect(done).toContain('first-light');
    expect(checkFeats(p, null)).toEqual([]);
    const reward = FEATS.find((f) => f.id === 'first-light')!.reward;
    expect(claimFeat(p, 'first-light')).toBe(reward);
    expect(claimFeat(p, 'first-light')).toBe(0);
    expect(p.shards).toBe(reward);
  });

  it('claim all pays every waiting feat', () => {
    const p = newProfile(0);
    p.records.bestWave = 20;
    p.records.kills = 1000;
    checkFeats(p, null);
    const total = FEATS.filter((f) => p.feats[f.id] === 'done').reduce((s, f) => s + f.reward, 0);
    expect(claimAll(p)).toBe(total);
    expect(p.shards).toBe(total);
  });

  it('run feats read the run: untouched, a lone weapon, a quick boss', () => {
    const p = newProfile(0);
    const run = createRun(buildRunConfig(p), 1);
    run.wave = 9;
    run.loneWave = 15;
    expect(featMet(p, { kind: 'untouched', wave: 8 }, run)).toBe(true);
    run.firstHurtWave = 3;
    expect(featMet(p, { kind: 'untouched', wave: 8 }, run)).toBe(false);
    expect(featMet(p, { kind: 'lone', wave: 15 }, run)).toBe(true);
    expect(featMet(p, { kind: 'bossFast', seconds: 45 }, run)).toBe(false);
  });
});

describe('offline (§6.3)', () => {
  it('is the median recent farm rate × time × efficiency, capped', () => {
    const p = newProfile(0);
    for (const s of [100, 300, 200, 50, 400, 250]) recordFarm(p, s, 60);
    expect(p.farm).toHaveLength(BALANCE.offline.runs);
    expect(farmRate(p)).toBe(250);
    expect(offlineEarnings(p, 3600)).toBeNull();
    p.forge.offline = 1;
    const tier = BALANCE.offline.tiers[0];
    expect(offlineEarnings(p, 3600)!.shards).toBe(Math.floor(250 * 60 * tier.efficiency));
    expect(offlineEarnings(p, 24 * 3600)!.paid).toBe(tier.capHours * 3600);
    expect(offlineEarnings(p, 30)).toBeNull();
  });

  it('short runs do not count toward the farm rate', () => {
    const p = newProfile(0);
    recordFarm(p, 1000, 20);
    expect(p.farm).toEqual([]);
  });
});

describe('banking a boss (§4.6, §7.3)', () => {
  it('a first kill records the trophy, pays its relic, owes the map its ceremony and lists what opened', () => {
    const p = newProfile(0);
    p.tutorial.firstDraft = true;
    const run = createRun(buildRunConfig(p), 3);
    startWave(run, regionByIndex(1), BOSS_WAVE);
    for (let i = 0; i < 30; i++) step(run, SIM_DT);
    damageEnemy(run, bossBody(run)!, 1e12, false);
    run.outcome = { kind: 'retreat', wave: run.wave, time: run.time };
    const s = bankRun(p, run);
    expect(s.boss).toEqual({ id: 'gatekeeper', killedIn: run.boss!.killedIn, first: true });
    expect(p.bosses.gatekeeper.kills).toBe(1);
    expect(p.ceremony).toBe('gatekeeper');
    expect(s.relics).toEqual([{ id: 'gatekeepers-seal', rank: 1 }]);
    expect(p.equipped).toEqual(['gatekeepers-seal']);
    expect(s.unlocks).toEqual(expect.arrayContaining(['The Map', 'Drowned Mire', 'Relic slot 1']));
    expect(s.feats.map((f) => f.id)).toContain('gatebreaker');
    const again = bankRun(p, run);
    expect(again.boss?.first).toBe(false);
    expect(again.unlocks).toEqual([]);
  });

  it('a later boss lists only the nodes its own fall unseals', () => {
    const p = killed('gatekeeper');
    p.tutorial.firstDraft = true;
    p.region = 2;
    const run = createRun(buildRunConfig(p), 3);
    startWave(run, regionByIndex(2), BOSS_WAVE);
    for (let i = 0; i < 30; i++) step(run, SIM_DT);
    damageEnemy(run, bossBody(run)!, 1e12, false);
    run.outcome = { kind: 'retreat', wave: run.wave, time: run.time };
    const n = FORGE.filter((x) => x.sealed === 'bog-mother').length;
    const s = bankRun(p, run);
    expect(s.unlocks).toContain(`${n} Forge node${n === 1 ? '' : 's'} unsealed`);
    expect(s.unlocks.filter((u) => u.includes('unsealed'))).toHaveLength(1);
  });

  it('the hub goal points at the frontier boss once nothing is affordable', () => {
    const p = newProfile(0);
    p.records.runs = 1;
    expect(hubGoal(p)?.text).toMatch(/Gatekeeper/);
  });
});
