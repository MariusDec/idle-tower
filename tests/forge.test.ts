import { describe, expect, it } from 'vitest';
import { FORGE, FORGE_BY_ID } from '../src/content/forge';
import { BALANCE } from '../src/content/balance';
import { lintContent } from '../src/content/lint';
import { CONTENT } from '../src/content';
import type { ContentEntry, ForgeNodeDef } from '../src/content/types';
import { newProfile, type Profile } from '../src/meta/profile';
import {
  buyNode, canRefund, isBuyable, nextGoal, nodeCost, nodeStates, refundNode, spentOn,
} from '../src/meta/forge';
import { buildRunConfig } from '../src/meta/runConfig';
import { automations, maxSpeed, runSpeed } from '../src/meta/automation';
import { bankRun } from '../src/meta/results';
import { createRun } from '../src/sim/run';

function rich(shards = 1e6): Profile {
  const p = newProfile(0);
  p.shards = shards;
  return p;
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
    for (const id of ['might-damage', 'scattershot', 'chain-lightning']) expect(buyNode(p, id)).toBe(true);
    expect(canRefund(p, 'scattershot')).toBe(false);
    expect(canRefund(p, 'chain-lightning')).toBe(true);
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
    expect(c.mods.filter((m) => m.key === 'damage')).toHaveLength(3);
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
