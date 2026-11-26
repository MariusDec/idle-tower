import { describe, expect, it } from 'vitest';
import { FORGE, FORGE_BY_ID } from '../src/content/forge';
import { BALANCE } from '../src/content/balance';
import { lintContent } from '../src/content/lint';
import { CONTENT } from '../src/content';
import type { ContentEntry, ForgeNodeDef } from '../src/content/types';
import { newProfile, PROFILE_VERSION, type Profile } from '../src/meta/profile';
import {
  buyNode, canRefund, canSwitch, forgingWait, freshWeapons, isBuyable, isSwitchedOff, nextGoal, nodeCost, nodeStates,
  refundNode, spentOn, toggleKeystone,
} from '../src/meta/forge';
import { buildRunConfig } from '../src/meta/runConfig';
import { automations, maxSpeed, runSpeed } from '../src/meta/automation';
import { bankRun } from '../src/meta/results';
import { createRun } from '../src/sim/run';
import { MIGRATIONS, migrate } from '../src/meta/save/migrate';

function rich(shards = 1e6): Profile {
  const p = newProfile(0);
  p.shards = shards;
  return p;
}

/** Mark `weapon` as tried: carried in enough runs that it is no longer fresh (plans/forge-weapon-pacing.md). */
function tried(p: Profile, weapon: string): void {
  p.recipes.carried[weapon] = BALANCE.debut.runs;
}

describe('Forge: fog and adjacency (§5.1)', () => {
  it('a fresh Forge shows exactly three nodes, the root-linked ones', () => {
    const states = nodeStates(newProfile(0));
    const open = FORGE.filter((n) => states.get(n.id) === 'open').map((n) => n.id);
    expect(open.sort()).toEqual(['bulwark-hp', 'fortune-shards', 'might-damage']);
    expect(FORGE.filter((n) => n.links.length === 0)).toHaveLength(3);
  });

  it('the ring beyond the open nodes is fog, and the rest is hidden', () => {
    const states = nodeStates(newProfile(0));
    expect(states.get('might-speed')).toBe('fog');
    expect(states.get('scattershot')).toBe('fog');
    expect(states.get('chain-lightning')).toBe('hidden');
    expect(states.get('speed-2')).toBe('hidden');
  });

  it('buying a node opens its neighbours and fogs the next ring', () => {
    const p = rich();
    expect(isBuyable(p, 'scattershot')).toBe(false);
    expect(buyNode(p, 'scattershot')).toBe(false);
    expect(buyNode(p, 'might-damage')).toBe(true);
    const states = nodeStates(p);
    expect(states.get('might-damage')).toBe('owned');
    expect(states.get('scattershot')).toBe('open');
    expect(states.get('chain-lightning')).toBe('fog');
  });
});

describe('Forge: costs and buying', () => {
  it('each level costs ×levelGrowth the last', () => {
    const n = FORGE_BY_ID['might-damage'];
    expect(nodeCost(n, 0)).toBe(n.cost);
    expect(nodeCost(n, 2)).toBe(Math.round(n.cost * BALANCE.forge.levelGrowth ** 2));
  });

  it('spends shards, stops at max level, and refuses what it cannot afford', () => {
    const p = rich(nodeCost(FORGE_BY_ID['might-damage'], 0));
    expect(buyNode(p, 'might-damage')).toBe(true);
    expect(p.shards).toBe(0);
    expect(buyNode(p, 'might-damage')).toBe(false);
    const q = rich();
    for (let i = 0; i < 10; i++) buyNode(q, 'might-damage');
    expect(q.forge['might-damage']).toBe(FORGE_BY_ID['might-damage'].maxLevel);
  });
});

describe('Forge: tempering past the last level', () => {
  const maxed = (p: Profile): void => {
    for (let i = 0; i < FORGE_BY_ID['might-damage'].maxLevel; i++) expect(buyNode(p, 'might-damage')).toBe(true);
  };

  it('a maxed percentage minor waits for the Gatekeeper, then goes on at twice the curve', () => {
    const p = rich();
    maxed(p);
    expect(isBuyable(p, 'might-damage')).toBe(false);
    p.bosses.gatekeeper = { kills: 1, fastest: null };
    expect(isBuyable(p, 'might-damage')).toBe(true);
    const n = FORGE_BY_ID['might-damage'];
    expect(nodeCost(n, n.maxLevel)).toBe(Math.round(n.cost * BALANCE.forge.levelGrowth ** n.maxLevel * BALANCE.forge.temper.cost));
    expect(buyNode(p, 'might-damage')).toBe(true);
    expect(p.forge['might-damage']).toBe(n.maxLevel + 1);
  });

  it('a tempered level is a compounding multiplier on the stat', () => {
    const p = rich();
    maxed(p);
    p.bosses.gatekeeper = { kills: 1, fastest: null };
    const before = buildRunConfig(p).mods.filter((m) => m.key === 'damage');
    buyNode(p, 'might-damage');
    const after = buildRunConfig(p).mods.filter((m) => m.key === 'damage');
    const pct = FORGE_BY_ID['might-damage'].effects[0].kind === 'stat' ? FORGE_BY_ID['might-damage'].effects[0].mod.pct! : 0;
    expect(after.length).toBe(before.length + 1);
    expect(after[after.length - 1]?.mult).toBeCloseTo(1 + pct * BALANCE.forge.temper.share);
  });

  it('only percentage minors temper: a notable stays owned, a ×-multiplier minor stays at its last', () => {
    const p = rich(1e9);
    p.bosses.gatekeeper = { kills: 1, fastest: null };
    buyNode(p, 'might-damage');
    expect(buyNode(p, 'opening-salvo')).toBe(true);
    expect(isBuyable(p, 'opening-salvo')).toBe(false);
  });

  it('shard and XP gain stop at their last level: the pay never compounds with its own power', () => {
    const p = rich(1e9);
    p.bosses.gatekeeper = { kills: 1, fastest: null };
    for (const id of ['fortune-shards', 'fortune-xp']) {
      while (buyNode(p, id));
      expect(p.forge[id]).toBe(FORGE_BY_ID[id].maxLevel);
    }
  });

  it('past the Blight, tempered levels go on a gentler curve; Act 1 prices are untouched', () => {
    const p = rich(1e9);
    p.bosses.gatekeeper = { kills: 1, fastest: null };
    const n = FORGE_BY_ID['might-damage'];
    const g = n.growth ?? BALANCE.forge.levelGrowth;
    const T = BALANCE.forge.temper;
    const at = n.maxLevel + 3;
    const act1 = Math.round(n.cost * Math.pow(g, at) * T.cost);
    expect(nodeCost(n, at, p)).toBe(act1);
    // Below the last level, or with no profile to read, nothing changes.
    p.bosses.blight = { kills: 1, fastest: null };
    expect(nodeCost(n, at)).toBe(act1);
    expect(nodeCost(n, 1, p)).toBe(nodeCost(n, 1));
    expect(nodeCost(n, at, p)).toBe(Math.round(n.cost * Math.pow(g, n.maxLevel) * Math.pow(T.easedGrowth, 3) * T.cost));
    // And the purchase pays the eased price.
    p.forge['might-damage'] = at;
    const before = p.shards;
    expect(buyNode(p, 'might-damage')).toBe(true);
    expect(before - p.shards).toBe(nodeCost(n, at, p));
  });
});

describe('Forge: refunds (§5.1)', () => {
  it('refunds a notable in full, and never a minor', () => {
    const p = rich();
    buyNode(p, 'might-damage');
    buyNode(p, 'opening-salvo');
    const before = p.shards;
    expect(canRefund(p, 'might-damage')).toBe(false);
    expect(refundNode(p, 'opening-salvo')).toBe(true);
    expect(p.shards).toBe(before + spentOn(FORGE_BY_ID['opening-salvo'], 1));
    expect(p.forge['opening-salvo']).toBeUndefined();
  });

  it('refuses a refund that would strand an owned node', () => {
    const p = rich();
    for (const id of ['might-damage', 'scattershot']) expect(buyNode(p, id)).toBe(true);
    tried(p, 'scattershot');
    expect(buyNode(p, 'chain-lightning')).toBe(true);
    expect(canRefund(p, 'scattershot')).toBe(false);
    expect(canRefund(p, 'chain-lightning')).toBe(true);
  });
});

describe('Forge: one weapon at a time (plans/forge-weapon-pacing.md)', () => {
  it('a fresh profile has no fresh weapon', () => {
    expect(freshWeapons(newProfile(0))).toEqual([]);
  });

  it('a weapon bought is fresh until carried in enough runs', () => {
    const p = rich();
    buyNode(p, 'might-damage');
    buyNode(p, 'scattershot');
    expect(p.forgedAt.scattershot).toBe(0);
    expect(freshWeapons(p)).toEqual(['scattershot']);
    p.recipes.carried.scattershot = BALANCE.debut.runs - 1;
    expect(freshWeapons(p)).toEqual(['scattershot']);
    tried(p, 'scattershot');
    expect(freshWeapons(p)).toEqual([]);
  });

  it('is fresh no longer once maxRuns runs have passed, or once it is on a Never list', () => {
    const p = rich();
    buyNode(p, 'might-damage');
    buyNode(p, 'scattershot');
    p.records.runs += BALANCE.debut.maxRuns;
    expect(freshWeapons(p)).toEqual([]);
    p.records.runs -= BALANCE.debut.maxRuns;
    p.tacticsNever = { all: ['scattershot'] };
    expect(freshWeapons(p)).toEqual([]);
  });

  it('a weapon bought before the stamp existed (no forgedAt) is never fresh', () => {
    const p = rich();
    buyNode(p, 'might-damage');
    buyNode(p, 'scattershot');
    delete p.forgedAt.scattershot;
    expect(freshWeapons(p)).toEqual([]);
  });

  it('the newest of two fresh weapons comes first', () => {
    const p = rich();
    buyNode(p, 'might-damage');
    buyNode(p, 'scattershot');
    tried(p, 'scattershot');
    buyNode(p, 'chain-lightning');
    p.recipes.carried.scattershot = 0;
    p.forgedAt['chain-lightning'] = 5;
    expect(freshWeapons(p)).toEqual(['chain-lightning', 'scattershot']);
  });

  it('while one weapon is fresh the next weapon node is sealed; other nodes are not', () => {
    const p = rich();
    buyNode(p, 'might-damage');
    buyNode(p, 'scattershot');
    expect(nodeStates(p).get('chain-lightning')).toBe('sealed');
    expect(buyNode(p, 'chain-lightning')).toBe(false);
    expect(forgingWait(p, FORGE_BY_ID['chain-lightning'])).toEqual({ weapon: 'scattershot', runs: BALANCE.debut.runs });
    expect(nodeStates(p).get('passive-slot')).toBe('open');
    expect(nextGoal(p)?.node.id).not.toBe('chain-lightning');
    tried(p, 'scattershot');
    expect(nodeStates(p).get('chain-lightning')).toBe('open');
    expect(forgingWait(p, FORGE_BY_ID['chain-lightning'])).toBeNull();
    expect(buyNode(p, 'chain-lightning')).toBe(true);
  });

  it("a boss seal keeps its own reason: forgingWait waits for the boss first", () => {
    const p = rich();
    buyNode(p, 'might-damage');
    buyNode(p, 'scattershot');
    expect(forgingWait(p, FORGE_BY_ID.mortar)).toBeNull();
  });

  it('Drones are the Prism\'s prize and Glaives Forgeheart\'s (step 6): sealed until their boss falls', () => {
    const p = rich();
    p.bosses = { gatekeeper: { kills: 1, fastest: 1 }, 'bog-mother': { kills: 1, fastest: 1 } };
    for (const id of ['might-damage', 'scattershot', 'chain-lightning', 'frost-ring', 'mortar', 'sunlance'] as const) {
      expect(buyNode(p, id)).toBe(true);
      if (FORGE_BY_ID[id].effects.some((e) => e.kind === 'unlockCard')) tried(p, id);
    }
    // Lingering, the link to Drones, is itself the Prism's.
    expect(nodeStates(p).get('arsenal-duration')).toBe('sealed');
    expect(nodeStates(p).get('sentinel-drones')).not.toBe('open');
    p.bosses.prism = { kills: 1, fastest: 1 };
    expect(buyNode(p, 'arsenal-duration')).toBe(true);
    expect(nodeStates(p).get('sentinel-drones')).toBe('open');
    expect(buyNode(p, 'sentinel-drones')).toBe(true);
    tried(p, 'sentinel-drones');
    expect(nodeStates(p).get('glaives')).not.toBe('open');
    expect(buyNode(p, 'glaives')).toBe(false);
    p.bosses.forgeheart = { kills: 1, fastest: 1 };
    expect(nodeStates(p).get('glaives')).toBe('open');
    expect(buyNode(p, 'glaives')).toBe(true);
  });

  it('v27 → v28: an old save gets an empty stamp book, so nothing it owns is fresh', () => {
    expect(PROFILE_VERSION).toBeGreaterThanOrEqual(28);
    const out = migrate({ version: 27, createdAt: 5, forge: { scattershot: 1 } }, MIGRATIONS, 28);
    expect(out.version).toBe(28);
    expect(out.forgedAt).toEqual({});
    expect(out.forge).toEqual({ scattershot: 1 });
  });

  it('a refund clears the stamp', () => {
    const p = rich();
    buyNode(p, 'might-damage');
    buyNode(p, 'scattershot');
    tried(p, 'scattershot');
    buyNode(p, 'chain-lightning');
    expect(refundNode(p, 'chain-lightning')).toBe(true);
    expect(p.forgedAt['chain-lightning']).toBeUndefined();
  });

  it('the run offers the fresh weapon as its debut, never in an authored run', () => {
    const p = rich();
    buyNode(p, 'might-damage');
    buyNode(p, 'scattershot');
    expect(buildRunConfig(p).debut).toBe('scattershot');
    // The Daily Omen's and a Trial's rules come in as `extra`: authored, so no debut.
    expect(buildRunConfig(p, [{ kind: 'weapons', ids: ['arcane-bolt', 'scattershot'] }]).debut).toBeNull();
    expect(createRun(buildRunConfig(p), 1).debutOffer).toBe('scattershot');
    tried(p, 'scattershot');
    expect(buildRunConfig(p).debut).toBeNull();
  });
});

describe('Forge: keystones switch off and on (§11.4)', () => {
  it('only an owned keystone switches; off, no run applies it; on again, it does', () => {
    const p = newProfile(0);
    expect(toggleKeystone(p, 'glass-cannon')).toBe(false);
    expect(toggleKeystone(p, 'might-damage')).toBe(false);
    const bare = buildRunConfig(p);
    p.forge['glass-cannon'] = 1;
    p.forge['might-damage'] = 1;
    expect(canSwitch(p, 'glass-cannon')).toBe(true);
    expect(canSwitch(p, 'might-damage')).toBe(false);
    const on = buildRunConfig(p).mods.filter((m) => m.key === 'maxHp');
    expect(on.some((m) => m.mult === 0.5)).toBe(true);
    expect(toggleKeystone(p, 'glass-cannon')).toBe(true);
    expect(isSwitchedOff(p, 'glass-cannon')).toBe(true);
    expect(p.forge['glass-cannon']).toBe(1);
    expect(buildRunConfig(p).mods.filter((m) => m.key === 'maxHp')).toEqual(bare.mods.filter((m) => m.key === 'maxHp'));
    expect(toggleKeystone(p, 'glass-cannon')).toBe(true);
    expect(isSwitchedOff(p, 'glass-cannon')).toBe(false);
  });

  it("a keystone's behaviour goes with it", () => {
    const p = newProfile(0);
    p.forge.hoarder = 1;
    expect(buildRunConfig(p).behaviours.hoarder).toBe(1);
    toggleKeystone(p, 'hoarder');
    expect(buildRunConfig(p).behaviours.hoarder).toBeUndefined();
  });

  it('a refund clears the switch: bought again, it starts on', () => {
    const p = rich();
    for (const id of ['might-damage', 'opening-salvo']) buyNode(p, id);
    p.forge['glass-cannon'] = 1;
    toggleKeystone(p, 'glass-cannon');
    expect(refundNode(p, 'glass-cannon')).toBe(true);
    expect(p.keystonesOff).toEqual([]);
  });
});

describe('the "Next:" goal (§4.6)', () => {
  it('is the cheapest buyable node, with progress toward it', () => {
    const p = newProfile(0);
    p.shards = 4;
    const g = nextGoal(p)!;
    expect(g.cost).toBe(Math.min(...['might-damage', 'bulwark-hp', 'fortune-shards'].map((id) => FORGE_BY_ID[id].cost)));
    expect(g.progress).toBeCloseTo(4 / g.cost);
  });

  it('is null once everything is bought', () => {
    const p = newProfile(0);
    for (const n of FORGE) p.forge[n.id] = n.maxLevel;
    expect(nextGoal(p)).toBeNull();
  });
});

describe('buildRunConfig from the Forge (§12.3)', () => {
  it('a fresh profile gets the frame and nothing else', () => {
    const c = buildRunConfig(newProfile(0));
    expect(c.weaponSlots).toBe(BALANCE.slots.weapon);
    expect(c.pool).not.toContain('scattershot');
    expect(c.behaviours).toEqual({});
  });

  it('applies every owned level, slots, unlocks and behaviours', () => {
    const p = newProfile(0);
    p.forge = { 'might-damage': 3, scattershot: 1, reroll: 2, 'speed-2': 1 };
    const c = buildRunConfig(p);
    // Three levels arrive as one contribution three times the size (§9: a mastery stays one line).
    expect(c.mods.filter((m) => m.key === 'damage').reduce((sum, m) => sum + (m.pct ?? 0), 0)).toBeCloseTo(0.15 * 3);
    expect(c.weaponSlots).toBe(BALANCE.slots.weapon + 1);
    expect(c.pool).toContain('scattershot');
    expect(c.behaviours.reroll).toBe(2);
    const run = createRun(c, 1);
    expect(run.stats.damageMult).toBeCloseTo(1 + 0.15 * 3);
    expect(run.rerolls).toBe(2);
  });

  it('automation is the app\'s: speed and auto-restart', () => {
    const p = newProfile(0);
    expect(maxSpeed(p)).toBe(1);
    p.settings.speed = 3;
    expect(runSpeed(p)).toBe(1);
    p.forge = { 'speed-2': 1, 'auto-restart': 1 };
    expect(runSpeed(p)).toBe(2);
    expect([...automations(p)].sort()).toEqual(['auto-restart', 'speed-2']);
  });

  it('head start and opening salvo shape the run\'s first moments', () => {
    const p = newProfile(0);
    p.tutorial.firstDraft = true;
    p.forge = { 'head-start': 1, 'opening-salvo': 1 };
    const run = createRun(buildRunConfig(p), 1);
    expect(run.level).toBe(1 + BALANCE.behaviours.headStart);
    expect(run.pendingDrafts).toBe(BALANCE.behaviours.headStart);
    expect(run.weapons[0].level).toBe(2);
  });
});

describe('banking a run (§4.6)', () => {
  it('banks whole shards, records and discoveries', () => {
    const p = newProfile(0);
    p.records.runs = 1;
    p.records.bestWave = 4;
    p.regions[1] = { bestWave: 4 };
    const run = createRun(buildRunConfig(p), 1);
    run.shards = 12.7;
    run.wave = 6;
    run.kills = 30;
    run.seen = ['grunt', 'runner'];
    run.outcome = { kind: 'fell', wave: 6, time: 90 };
    const s = bankRun(p, run, ['weapon:arcane-bolt']);
    expect(s.shards).toBe(12);
    expect(p.shards).toBe(12);
    expect(s.records.wave).toEqual({ old: 4, now: 6 });
    expect(s.newEnemies).toEqual(['grunt', 'runner']);
    expect(p.records).toMatchObject({ runs: 2, bestWave: 6, kills: 30, bestShards: 12 });
    expect(s.next).not.toBeNull();
    run.outcome = { kind: 'fell', wave: 3, time: 40 };
    expect(bankRun(p, run).newEnemies).toEqual([]);
  });

  it('wave records are the region\'s own, and past the boss they are overtime (B6)', () => {
    const p = newProfile(0);
    p.records.runs = 5;
    p.records.bestWave = 26;
    p.regions[1] = { bestWave: 26 };
    p.regions[2] = { bestWave: 12 };
    const run = createRun({ ...buildRunConfig(p), regionId: 2 }, 1);
    run.outcome = { kind: 'fell', wave: 15, time: 300 };
    expect(bankRun(p, run).records.wave).toEqual({ old: 12, now: 15 });
    run.outcome = { kind: 'fell', wave: 23, time: 600 };
    const s = bankRun(p, run);
    expect(s.records.wave).toBeNull();
    expect(s.records.overtime).toEqual({ old: 0, now: 3 });
    expect(p.records.bestWave).toBe(26);
  });
});

describe('Forge lint', () => {
  it('catches a dangling link, an unreachable node and a ring jump', () => {
    const base = FORGE_BY_ID['might-speed'];
    const bad: ForgeNodeDef[] = [
      ...FORGE,
      { ...base, id: 'orphan', links: ['nowhere'] },
      { ...base, id: 'floater', ring: 2, links: [] },
      { ...base, id: 'leaper', ring: 3, links: ['might-damage'] },
    ];
    const problems = lintContent({ ...CONTENT, forge: bad as ContentEntry[] }).map((i) => `${i.id}: ${i.problem}`);
    expect(problems).toContain('orphan: links to unknown node "nowhere"');
    expect(problems).toContain('orphan: unreachable from the root');
    expect(problems).toContain('floater: only ring 1 may hang from the root');
    expect(problems).toContain('leaper: links across rings to "might-damage"');
  });
});
