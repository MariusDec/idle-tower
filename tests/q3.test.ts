import { describe, expect, it } from 'vitest';
import { newProfile, type Profile } from '../src/meta/profile';
import { buildRunConfig } from '../src/meta/runConfig';
import { bankRun } from '../src/meta/results';
import { activeSets, setRank, trophyCount } from '../src/meta/collection';
import { foremanBuy, togglePin } from '../src/meta/automation';
import { levelOf, towerTier } from '../src/meta/forge';
import { chooseTrial, selectedTrial, trims, trialWon } from '../src/meta/trials';
import { applyInput, createRun, step } from '../src/sim/run';
import { candidateCards, gainXp, tickDraft } from '../src/sim/systems/draft';
import { damageEnemy } from '../src/sim/systems/combat';
import { bossBody } from '../src/sim/systems/boss';
import { BOSS_WAVE, isChampionWave, rollWave, spawnEnemy, startWave } from '../src/sim/systems/waves';
import { regionByIndex } from '../src/content/regions';
import { eliteRelics } from '../src/content/relics';
import { FORGE } from '../src/content/forge';
import { BALANCE } from '../src/content/balance';
import { Rng } from '../src/core/rng';
import { SIM_DT } from '../src/app/loop';
import type { Card, RunState } from '../src/sim/state';

/** Past the first draft, with these Forge levels and these bosses down. */
function profile(forge: Record<string, number> = {}, bosses: string[] = []): Profile {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  p.forge = { ...forge };
  for (const b of bosses) p.bosses[b] = { kills: 1, fastest: 50 };
  return p;
}

/** Level the run up and open its draft, without playing. */
function levelUp(run: RunState): void {
  gainXp(run, run.xpNext / run.stats.xpMult + 1e-9);
  tickDraft(run);
}

/** Fell the boss of the run's region, and bank. */
function winBoss(p: Profile, run: RunState): ReturnType<typeof bankRun> {
  startWave(run, regionByIndex(run.regionId), BOSS_WAVE);
  for (let i = 0; i < 30; i++) step(run, SIM_DT);
  damageEnemy(run, bossBody(run)!, 1e12, false);
  run.outcome = { kind: 'retreat', wave: run.wave, time: run.time };
  return bankRun(p, run);
}

const isNew = (run: RunState, c: Card): boolean =>
  (c.kind === 'weapon' && !run.weapons.some((w) => w.id === c.id)) || (c.kind === 'passive' && !run.passives.some((x) => x.id === c.id));

describe('Banish (N1)', () => {
  const owned = { 'fortune-shards': 1, reroll: 1, choice: 1, banish: 2, scattershot: 1, 'chain-lightning': 1, 'might-damage': 1 };

  it('a charge per owned level; a banished item leaves the pool and its card is replaced', () => {
    const run = createRun(buildRunConfig(profile(owned)), 4);
    expect(run.banishes).toBe(2);
    levelUp(run);
    const i = run.draft!.cards.findIndex((c) => isNew(run, c));
    expect(i).toBeGreaterThanOrEqual(0);
    const struck = run.draft!.cards[i] as Extract<Card, { kind: 'weapon' | 'passive' }>;
    const size = run.draft!.cards.length;
    applyInput(run, { banish: i });
    expect(run.banishes).toBe(1);
    expect(run.banished).toEqual([struck.id]);
    expect(run.draft!.cards).toHaveLength(size);
    expect(run.draft!.cards.some((c) => c.kind === struck.kind && c.id === struck.id)).toBe(false);
    expect(candidateCards(run).some((c) => (c.kind === 'weapon' || c.kind === 'passive') && c.id === struck.id)).toBe(false);
  });

  it('never strikes what the tower carries, and does nothing without a charge', () => {
    const run = createRun(buildRunConfig(profile({ ...owned, banish: 0 })), 4);
    levelUp(run);
    const before = run.draft;
    applyInput(run, { banish: 0 });
    expect(run.draft).toBe(before);
    const armed = createRun(buildRunConfig(profile(owned)), 4);
    levelUp(armed);
    const mine = armed.draft!.cards.findIndex((c) => c.kind === 'weapon' && c.id === 'arcane-bolt');
    if (mine >= 0) {
      applyInput(armed, { banish: mine });
      expect(armed.banishes).toBe(2);
    }
  });

  it('the Tactician\'s Never list spends charges by itself (U7)', () => {
    const p = profile({ ...owned, tactician: 1, offline: 1, 'speed-2': 1, 'auto-restart': 1 }, ['gatekeeper']);
    p.tactics.all = [];
    p.tacticsNever.all = ['scattershot', 'chain-lightning', 'power', 'haste', 'fortify', 'precision', 'mending', 'insight'];
    const run = createRun(buildRunConfig(p), 9);
    for (let k = 0; k < 4 && run.banishes > 0; k++) {
      levelUp(run);
      applyInput(run, { pick: run.draft!.suggested });
    }
    expect(run.banished.length).toBeGreaterThan(0);
    expect(run.banished.every((id) => p.tacticsNever.all.includes(id))).toBe(true);
  });
});

describe('Champions and trophies (N4)', () => {
  it('every fifth overtime wave brings a Champion; the Abyss never does', () => {
    const r = regionByIndex(2);
    expect(isChampionWave(r, BOSS_WAVE + 5)).toBe(true);
    expect(isChampionWave(r, BOSS_WAVE + 4)).toBe(false);
    expect(isChampionWave(r, 15)).toBe(false);
    const spawns = rollWave(r, BOSS_WAVE + 5, new Rng(3));
    expect(spawns.filter((s) => s.elite?.champion)).toHaveLength(1);
  });

  it('a Champion is a tougher elite, sure to drop one of its region\'s relics', () => {
    const p = profile({}, ['gatekeeper', 'bog-mother']);
    p.region = 2;
    const run = createRun(buildRunConfig(p), 2);
    const r = regionByIndex(2);
    const elite = spawnEnemy(run, r, 'splitter', 25, 300, 0, { elite: { aura: null } });
    const champ = spawnEnemy(run, r, 'splitter', 25, 300, 40, { elite: { aura: null, champion: true } });
    expect(champ.maxHp).toBeCloseTo(elite.maxHp * BALANCE.champions.hp);
    expect(champ.champion).toBe(true);
    damageEnemy(run, champ, 1e12, false);
    expect(run.relics).toHaveLength(1);
    expect(eliteRelics(2)).toContain(run.relics[0]);
  });

  it('overtime +5 and +10 each pay once, and light the tower', () => {
    const p = profile({}, ['gatekeeper']);
    const run = createRun(buildRunConfig(p), 1);
    run.outcome = { kind: 'fell', wave: BOSS_WAVE + 11, time: 600 };
    const s = bankRun(p, run);
    expect(s.trophies.map((t) => t.overtime)).toEqual([5, 10]);
    expect(s.trophies.every((t) => t.shards > 0)).toBe(true);
    expect(trophyCount(p)).toBe(2);
    expect(bankRun(p, run).trophies).toEqual([]);
  });
});

describe('the Foreman (N7)', () => {
  const p0 = (): Profile => profile({ 'fortune-shards': 1, 'fortune-xp': 1, 'speed-2': 1, foreman: 1 });

  it('pins only once owned, and at most five', () => {
    const bare = profile();
    expect(togglePin(bare, 'might-damage')).toBe(false);
    const p = p0();
    const ids = ['might-damage', 'might-speed', 'opening-salvo', 'bulwark-hp', 'reroll', 'choice'];
    expect(ids.map((id) => togglePin(p, id))).toEqual([true, true, true, true, true, false]);
    expect(togglePin(p, 'might-damage')).toBe(true);
    expect(p.wishlist).not.toContain('might-damage');
  });

  it('buys in order, waits on what it can\'t reach, and stops to save for what it can\'t afford', () => {
    const p = p0();
    p.wishlist = ['might-speed', 'might-damage', 'bulwark-hp'];
    p.shards = 30;
    // Quick Hands hangs from Sharpened: it waits until Sharpened is bought.
    const bought = foremanBuy(p);
    expect(bought[0]).toBe('might-damage');
    expect(bought).toContain('might-speed');
    expect(levelOf(p, 'might-damage')).toBeGreaterThan(0);
    // It stopped at the first it could not afford: nothing after it was bought out of order.
    p.shards = 0;
    expect(foremanBuy(p)).toEqual([]);
  });

  it('a node at its last level comes off the list', () => {
    const p = p0();
    p.wishlist = ['opening-salvo'];
    p.forge['might-damage'] = 1;
    p.shards = 1e6;
    expect(foremanBuy(p)).toEqual(['opening-salvo']);
    expect(p.wishlist).toEqual([]);
  });
});

describe('tower tiers (N2)', () => {
  it('one tier per Forge ring completed in turn, keystones aside', () => {
    expect(towerTier(newProfile(0))).toBe(1);
    const p = newProfile(0);
    for (const n of FORGE.filter((x) => x.ring === 1)) p.forge[n.id] = 1;
    expect(towerTier(p)).toBe(2);
    for (const n of FORGE.filter((x) => x.ring === 3 && x.type !== 'keystone')) p.forge[n.id] = 1;
    expect(towerTier(p)).toBe(2);
    for (const n of FORGE.filter((x) => x.ring === 2)) p.forge[n.id] = 1;
    expect(towerTier(p)).toBe(4);
  });
});

describe('region auras (N3)', () => {
  const at = (region: number): RunState => {
    const p = profile({}, ['gatekeeper', 'bog-mother', 'prism', 'forgeheart', 'hollow-king']);
    p.region = region;
    return createRun(buildRunConfig(p), 5);
  };

  it('each region from the Mire on has one of its own', () => {
    const own = ['fog', 'mirrored', 'molten', 'wraith', 'hungering'];
    for (let k = 2; k <= 6; k++) expect(regionByIndex(k).elites.auras).toContain(own[k - 2]);
  });

  it('a Fog-caller cuts the range while it lives', () => {
    const run = at(2);
    const range = run.stats.range;
    const fog = spawnEnemy(run, regionByIndex(2), 'splitter', 5, 300, 0, { elite: { aura: 'fog' } });
    expect(run.stats.range).toBeCloseTo(range * (1 - BALANCE.elites.fog));
    damageEnemy(run, fog, 1e12, false);
    expect(run.stats.range).toBeCloseTo(range);
  });

  it('a Molten elite slain near the wall leaves a pool there; far out, none', () => {
    const run = at(4);
    const r = regionByIndex(4);
    const far = spawnEnemy(run, r, 'bomber', 5, run.stats.range * 2, 0, { elite: { aura: 'molten' } });
    damageEnemy(run, far, 1e12, false);
    expect(run.pools).toHaveLength(0);
    const near = spawnEnemy(run, r, 'bomber', 5, run.stats.radius + 40, 0, { elite: { aura: 'molten' } });
    damageEnemy(run, near, 1e12, false);
    expect(run.pools).toHaveLength(1);
  });

  it('a Wraith phases out on its own clock', () => {
    const run = at(5);
    const w = spawnEnemy(run, regionByIndex(5), 'leech', 5, 900, 0, { elite: { aura: 'wraith' } });
    let hidden = false;
    for (let i = 0; i < 300 && !hidden; i++) {
      step(run, SIM_DT);
      hidden = w.hiddenUntil > run.time;
    }
    expect(hidden).toBe(true);
  });

  it('a Hungering elite heals on what dies near it', () => {
    const run = at(6);
    const r = regionByIndex(6);
    const h = spawnEnemy(run, r, 'chorus', 5, 600, 0, { elite: { aura: 'hungering' }, single: true });
    h.hp = h.maxHp / 2;
    const prey = spawnEnemy(run, r, 'harbinger', 5, 640, 0);
    damageEnemy(run, prey, 1e12, false);
    expect(h.hp).toBeGreaterThan(h.maxHp / 2);
  });
});

describe('relic sets (N6)', () => {
  it('worn whole, a set adds its bonus; duplicates past III rank it up', () => {
    const p = profile({}, ['gatekeeper', 'bog-mother', 'forgeheart']);
    for (const id of eliteRelics(2)) p.relics[id] = 3;
    p.equipped = [...eliteRelics(2)];
    expect(activeSets(p).map((x) => x.set.region)).toEqual([2]);
    expect(buildRunConfig(p).behaviours['set-mire']).toBe(1);
    p.region = 2;
    const run = createRun(buildRunConfig(p), 1);
    run.relics.push(...Array.from({ length: BALANCE.sets.perRank }, () => eliteRelics(2)[0]));
    run.outcome = { kind: 'retreat', wave: 3, time: 60 };
    const s = bankRun(p, run);
    expect(s.relics.every((r) => r.set === 'Mire Lore')).toBe(true);
    expect(setRank(p, 2)).toBe(2);
  });
});

describe('Trials (N5)', () => {
  it('open with their region\'s boss; a chosen trial sets the region, and its rules shape the run', () => {
    const p = profile({ 'might-damage': 1, scattershot: 1, 'chain-lightning': 1, 'passive-slot': 1 }, ['gatekeeper']);
    expect(chooseTrial(p, 'still-water')).toBe(false);
    expect(chooseTrial(p, 'bare-stone')).toBe(true);
    expect(p.region).toBe(1);
    expect(selectedTrial(p)?.id).toBe('bare-stone');
    const bare = buildRunConfig(p);
    expect(bare.passiveSlots).toBe(0);
    expect(bare.trial).toBe('bare-stone');
    chooseTrial(p, 'ash-omen');
    expect(buildRunConfig(p).pacts).toEqual({ hordes: 2 });
  });

  it('a weapons trial mounts its first and offers only its own', () => {
    const p = profile({}, ['gatekeeper', 'bog-mother', 'prism', 'forgeheart']);
    chooseTrial(p, 'shell-and-beam');
    const c = buildRunConfig(p);
    expect(c.startingWeapon).toBe('mortar');
    const run = createRun(c, 1);
    expect(run.weapons.map((w) => w.id)).toEqual(['mortar']);
    expect(c.pool.filter((id) => ['arcane-bolt', 'scattershot', 'glaives'].includes(id))).toEqual([]);
    expect(c.pool).toContain('sunlance');
  });

  it('won by the boss: pays once, records no heat, and the next run is ordinary', () => {
    const p = profile({}, ['gatekeeper']);
    chooseTrial(p, 'bare-stone');
    const s = winBoss(p, createRun(buildRunConfig(p), 3));
    expect(s.trial).toEqual({ id: 'bare-stone', won: true, paid: { id: 'bare-stone', line: 'Tower trim: Ivy' } });
    expect(trialWon(p, 'bare-stone')).toBe(true);
    expect(trims(p)).toEqual(['ivy']);
    expect(p.trial).toBeNull();
    expect(s.heatRecord).toBeNull();
    expect(buildRunConfig(p).trial).toBeNull();
  });

  it('a won notable applies to every run after', () => {
    const p = profile({}, ['gatekeeper', 'bog-mother', 'prism']);
    p.trials['glass-omen'] = true;
    expect(buildRunConfig(p).behaviours['deep-arc']).toBe(1);
  });
});
