import { describe, expect, it } from 'vitest';
import { applyInput, createRun, step } from '../src/sim/run';
import { buildRunConfig } from '../src/meta/runConfig';
import { newProfile, type Profile } from '../src/meta/profile';
import { SIM_DT } from '../src/app/loop';
import { ABYSS_INDEX, FLOOR_WAVES, NATIVES, abyssFloor, abyssStarlight, floorBoss, floorOf, floorTemplate, floorWave } from '../src/content/abyss';
import { BALANCE } from '../src/content/balance';
import { BOSSES, BOSS_BY_ID } from '../src/content/bosses';
import { ENEMY_BY_ID } from '../src/content/enemies';
import { FEATS } from '../src/content/feats';
import { FORGE_BY_ID } from '../src/content/forge';
import { FRAME_BY_ID } from '../src/content/frames';
import { MAX_HEAT, PACTS } from '../src/content/pacts';
import { RELICS, abyssRelics } from '../src/content/relics';
import { REGIONS, regionByIndex } from '../src/content/regions';
import { STARS } from '../src/content/stars';
import { EVOLUTIONS } from '../src/content/evolutions';
import { formatNumber } from '../src/core/format';
import { Rng } from '../src/core/rng';
import type { EnemyVerb, PactId, WeaponId } from '../src/content/types';
import { act2Open, bestiary, frameUnlocked, inAbyss, listedRelics, regionUnlocked, relicSlots } from '../src/meta/collection';
import { checkFeats, featVisible } from '../src/meta/feats';
import { FORGE_WEB, buyNode, isSealed, nodeCost } from '../src/meta/forge';
import { bestHeat, heat, heatShards, heatStarlight, recordFloor, recordHeat, recordStarlight, runPacts, setPactRank } from '../src/meta/pacts';
import { recipeBook } from '../src/meta/recipes';
import { bankRun } from '../src/meta/results';
import { STAR_WEB, starGifts } from '../src/meta/stars';
import { bossPhases, pactLoad } from '../src/sim/pacts';
import { damageEnemy, tickProjectiles, tickRunes, tickWeapons } from '../src/sim/systems/combat';
import { draftChoices, evolutionCards } from '../src/sim/systems/draft';
import { tickEnemies } from '../src/sim/systems/enemies';
import { hurtTower } from '../src/sim/systems/tower';
import { castUltimate, tickUltimate } from '../src/sim/systems/ultimate';
import { isBossWave, isEliteWave, regionMods, rollWave, spawnEnemy, startWave, waveHp } from '../src/sim/systems/waves';
import { newWeapon } from '../src/sim/systems/arms';
import type { Enemy, RunConfig, RunState } from '../src/sim/state';
import { body } from './helpers/body';

/** A profile with every Act 1 boss down: Act 2 is open. */
function act2Profile(): Profile {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  for (const b of BOSSES) if (!b.abyss) p.bosses[b.id] = { kills: 1, fastest: 60 };
  return p;
}

function runIn(region: number, over: Partial<RunConfig> = {}, seed = 1): RunState {
  const p = act2Profile();
  return createRun({ ...buildRunConfig(p), regionId: region, ...over }, seed);
}

function verbOf<K extends EnemyVerb['kind']>(id: keyof typeof ENEMY_BY_ID, kind: K): Extract<EnemyVerb, { kind: K }> {
  const v = ENEMY_BY_ID[id].verb;
  if (v.kind !== kind) throw new Error(`${id} must be ${kind}`);
  return v as Extract<EnemyVerb, { kind: K }>;
}

/** Advance the clock and the enemies only. */
function walk(run: RunState, seconds: number): void {
  for (let i = 0; i < seconds / SIM_DT; i++) {
    run.tick++;
    run.time = run.tick * SIM_DT;
    tickEnemies(run, SIM_DT);
  }
}

/** Advance the clock, the weapons and what they put in the air. */
function fight(run: RunState, seconds: number): void {
  for (let i = 0; i < seconds / SIM_DT; i++) {
    run.tick++;
    run.time = run.tick * SIM_DT;
    tickWeapons(run, SIM_DT);
    tickProjectiles(run, SIM_DT);
    tickRunes(run);
  }
}

function arm(run: RunState, id: WeaponId, level = 1, evolved = false): void {
  const w = newWeapon(id, level);
  w.evolved = evolved;
  run.weapons = [w];
}

describe('Act 2 opens with the Blight (§9)', () => {
  it('pacts, the Abyss and the Stars wait for the finale', () => {
    const p = newProfile(0);
    expect(act2Open(p)).toBe(false);
    expect(setPactRank(p, 'hordes', 1)).toBe(false);
    expect(regionUnlocked(p, ABYSS_INDEX)).toBe(false);
    const q = act2Profile();
    expect(act2Open(q)).toBe(true);
    expect(setPactRank(q, 'hordes', 1)).toBe(true);
    expect(regionUnlocked(q, ABYSS_INDEX)).toBe(true);
  });

  it("Act 1's lists keep Act 2's entries out until then", () => {
    const p = newProfile(0);
    const natives = new Set<string>(NATIVES.map((n) => n.enemy));
    expect(bestiary(p).some((r) => natives.has(r.id))).toBe(false);
    expect(bestiary(p).some((r) => BOSS_BY_ID[r.id as keyof typeof BOSS_BY_ID]?.abyss)).toBe(false);
    expect(listedRelics(p).some((r) => r.source.kind === 'abyss')).toBe(false);
    expect(recipeBook(p)).toHaveLength(8);
    const q = act2Profile();
    expect(bestiary(q).filter((r) => natives.has(r.id))).toHaveLength(4);
    expect(listedRelics(q)).toHaveLength(RELICS.length);
    expect(recipeBook(q)).toHaveLength(EVOLUTIONS.length);
  });

  it("Act 2's feats surface only after the Blight", () => {
    const kindled = FEATS.find((f) => f.id === 'kindled')!;
    expect(featVisible(newProfile(0), kindled)).toBe(false);
    expect(featVisible(act2Profile(), kindled)).toBe(true);
  });
});

describe('pacts and heat (§9)', () => {
  it('heat is the sum of the ranks, clamped to each pact', () => {
    const p = act2Profile();
    expect(MAX_HEAT).toBe(PACTS.reduce((s, x) => s + x.ranks, 0));
    setPactRank(p, 'hordes', 2);
    setPactRank(p, 'vigour', 1);
    expect(heat(p)).toBe(3);
    expect(setPactRank(p, 'haste', 9)).toBe(false);
    expect(heatShards(10)).toBeCloseTo(2);
  });

  it('the Abyss runs under no pacts', () => {
    const p = act2Profile();
    setPactRank(p, 'hordes', 3);
    expect(runPacts(p)).toEqual({ hordes: 3 });
    p.region = ABYSS_INDEX;
    expect(inAbyss(p)).toBe(true);
    expect(runPacts(p)).toEqual({});
    expect(buildRunConfig(p).pacts).toEqual({});
  });

  it('each pact moves the run as it says', () => {
    const load = pactLoad({ hordes: 2, vigour: 2, haste: 1, elites: 1, frailty: 2, scarcity: 1, tyranny: 1, surge: 2 });
    expect(load.heat).toBe(12);
    expect(load.count).toBeCloseTo(1.6);
    expect(load.hp).toBeCloseTo(1.5625);
    expect(load.speed).toBeCloseTo(1.15);
    expect(load.elites).toBe(1);
    expect(load.choices).toBe(-1);
    expect(load.tyranny).toBe(1);
    expect(load.bossHp).toBeCloseTo(1.25);
    expect(load.surge).toBe(2);
    // Frailty, and the heat's shards.
    expect(load.mods).toContainEqual({ key: 'maxHp', pct: -0.3 });
    expect(load.mods).toContainEqual({ key: 'shardGain', mult: heatShards(12) });
  });

  it('Hordes, Vigour and Haste reach the bodies; Scarcity the hand', () => {
    const plain = runIn(1);
    const hard = runIn(1, { pacts: { hordes: 3, vigour: 2, haste: 2, scarcity: 1 } });
    const r = regionByIndex(1);
    expect(rollWave(r, 8, new Rng(3), 1, { count: pactLoad(hard.pacts).count, elites: 0 }).length)
      .toBeGreaterThan(rollWave(r, 8, new Rng(3)).length);
    const a = spawnEnemy(plain, r, 'grunt', 5, 300, 0);
    const b = spawnEnemy(hard, r, 'grunt', 5, 300, 0);
    expect(b.maxHp / a.maxHp).toBeCloseTo(1.5625);
    expect(b.speed / a.speed).toBeCloseTo(1.3);
    expect(draftChoices(hard)).toBe(Math.max(BALANCE.draft.minChoices, draftChoices(plain) - 1));
    expect(hard.stats.shardMult).toBeCloseTo(plain.stats.shardMult * heatShards(8));
  });

  it('Tyranny gives a boss more phases, below its last, and more HP', () => {
    const def = BOSS_BY_ID.gatekeeper;
    const phases = bossPhases(def, 2);
    expect(phases).toHaveLength(def.phases.length + 2);
    for (let i = 1; i < phases.length; i++) expect(phases[i].below).toBeLessThan(phases[i - 1].below);
    const plain = runIn(1);
    const tyrant = runIn(1, { pacts: { tyranny: 2 } });
    startWave(plain, regionByIndex(1), 20);
    startWave(tyrant, regionByIndex(1), 20);
    const hp = (r: RunState): number => r.enemies.find((e) => e.boss)!.maxHp;
    expect(hp(tyrant) / hp(plain)).toBeCloseTo(1.5);
  });

  it("Blight Surge harshens a hazard rule, and tolls the tower where the rule helps", () => {
    const mire = regionByIndex(2);
    expect(regionMods(mire, 2)).toEqual([{ key: 'range', pct: -0.15 * 3 }]);
    const plain = runIn(2);
    const surged = runIn(2, { pacts: { surge: 2 } });
    expect(surged.stats.range).toBeLessThan(plain.stats.range);
    // The Wastes' Brittle favours the tower: the surge slows its attacks instead.
    const glass = runIn(3, { pacts: { surge: 1 } });
    expect(glass.stats.fireRateMult).toBeCloseTo(runIn(3).stats.fireRateMult - 0.1);
    // The Blight Heart: one more elite in every wave per rank.
    const heart = runIn(6, { pacts: { surge: 2 } });
    startWave(heart, regionByIndex(6), 3);
    expect(heart.current!.spawns.filter((s) => s.elite)).toHaveLength(3);
  });
});

describe('Starlight (§9)', () => {
  it('a new heat record pays each level past the old one, once, by the heat and not the region (D-8)', () => {
    const p = act2Profile();
    expect([1, 4, 5, 9, 10, 29].map(heatStarlight)).toEqual([1, 1, 2, 2, 3, 6]);
    expect(recordHeat(p, 6, 3)?.starlight).toBe(3);
    expect(recordHeat(p, 6, 3)).toBeNull();
    expect(recordHeat(p, 6, 6)?.starlight).toBe(1 + 2 + 2);
    expect(recordHeat(p, 1, 6)?.starlight).toBe(recordStarlight(act2Profile(), 6, 6));
    expect(bestHeat(p, 6)).toBe(6);
    expect(p.starlight).toBe(16);
  });

  it('a new deepest floor pays per floor, and more for each guardian (S7, D-6)', () => {
    const p = act2Profile();
    expect(abyssStarlight(4)).toBe(8);
    expect(abyssStarlight(5)).toBe(20);
    expect(abyssStarlight(10)).toBe(40);
    expect(recordFloor(p, 3)?.starlight).toBe(abyssStarlight(3));
    expect(recordFloor(p, 7)?.starlight).toBe(abyssStarlight(7) - abyssStarlight(3));
    expect(recordFloor(p, 2)).toBeNull();
  });

  it('every star can be lit (B7): every region at the top heat, floor 75 and the feats pay past the sky', () => {
    const p = act2Profile();
    const heatAll = REGIONS.reduce((s, r) => s + recordStarlight(p, r.index, MAX_HEAT), 0);
    const feats = FEATS.reduce((s, f) => s + (f.starlight ?? 0), 0);
    const sky = STARS.reduce((s, n) => s + STAR_WEB.spentOn(n, n.maxLevel), 0);
    expect(heatAll + abyssStarlight(30) + feats).toBeGreaterThanOrEqual(sky);
  });

  it('the Stargazers grow every payout', () => {
    const p = act2Profile();
    p.starlight = 100;
    expect(STAR_WEB.buy(p, 'deep-star')).toBe(true);
    expect(starGifts(p).starlight).toBeCloseTo(1.25);
    const before = p.starlight;
    recordHeat(p, 6, 2);
    expect(p.starlight - before).toBe(Math.round(2 * 1.25));
  });

  it('a boss felled under heat banks the record; one that stands banks nothing', () => {
    const p = act2Profile();
    p.region = 1;
    setPactRank(p, 'scarcity', 2);
    const run = createRun(buildRunConfig(p), 1);
    run.boss = {
      id: 'gatekeeper', enemy: 1, phase: 0, arrivedAt: 0, timers: [], windup: 0, submerged: false, enraged: false,
      windupPattern: -1, staggeredUntil: 0, facet: 0, crown: 0, plates: 0, minHp: 1, killedIn: 40, wave: 20,
    };
    run.outcome = { kind: 'fell', wave: 22, time: 500 };
    const s = bankRun(p, run);
    expect(s.heat).toBe(2);
    expect(s.heatRecord).toEqual({ old: 0, now: 2, starlight: 2 });
    expect(checkFeats(p, null).map((f) => f.id)).not.toContain('kindled');
    expect(p.feats.kindled).toBe('done');
  });
});

describe('the Constellations (§9)', () => {
  it('five figures open from the root; nothing in them refunds', () => {
    const p = act2Profile();
    const states = STAR_WEB.states(p);
    const open = STARS.filter((n) => states.get(n.id) === 'open');
    expect(new Set(open.map((n) => n.branch)).size).toBe(5);
    p.starlight = 10;
    expect(STAR_WEB.buy(p, 'smith-moonblade')).toBe(true);
    expect(p.starlight).toBe(7);
    expect(STAR_WEB.canRefund(p, 'smith-moonblade')).toBe(false);
  });

  it('a weapon star puts its weapon in the pool; a passive star its passive, and only then', () => {
    const p = act2Profile();
    expect(buildRunConfig(p).pool).not.toContain('moonblade');
    expect(buildRunConfig(p).pool).not.toContain('zeal');
    p.stars = { 'smith-moonblade': 1, 'smith-runes': 1, 'smith-zeal': 1 };
    const pool = buildRunConfig(p).pool;
    expect(pool).toContain('moonblade');
    expect(pool).toContain('rune-traps');
    expect(pool.filter((id) => id === 'zeal')).toHaveLength(1);
  });

  it('frames, a relic slot and a fifth weapon slot come from stars', () => {
    const p = act2Profile();
    expect(frameUnlocked(p, FRAME_BY_ID.lamplighter)).toBe(false);
    const slots = relicSlots(p);
    const weapons = buildRunConfig(p).weaponSlots;
    p.stars = { 'warden-lamplighter': 1, 'lantern-1': 1, 'lantern-slot': 1, 'smith-moonblade': 1, 'smith-damage': 1, 'smith-speed': 1, 'smith-mount': 1 };
    expect(frameUnlocked(p, FRAME_BY_ID.lamplighter)).toBe(true);
    expect(relicSlots(p)).toBe(slots + 1);
    expect(buildRunConfig(p).weaponSlots).toBe(weapons + 1);
  });

  it('a mastery waits for its star, then costs ×1.2 a level and compounds without end, as one contribution', () => {
    const p = act2Profile();
    const node = FORGE_BY_ID['might-mastery'];
    expect(isSealed(p, node)).toBe(true);
    p.stars = { 'crown-might': 1 };
    expect(isSealed(p, node)).toBe(false);
    expect(nodeCost(node, 10) / nodeCost(node, 9)).toBeCloseTo(1.2, 2);
    expect(FORGE_WEB.canRefund(p, 'might-mastery')).toBe(false);
    p.forge['might-damage-6'] = 1;
    p.shards = 1e12;
    expect(buyNode(p, 'might-mastery')).toBe(true);
    p.forge['might-mastery'] = 200;
    const damage = buildRunConfig(p).mods.filter((m) => m.key === 'damage' && m.mult && Math.abs(m.mult / Math.pow(1.03, 200) - 1) < 1e-9);
    expect(damage).toHaveLength(1);
  });

  it('the Lantern lights the Abyss relic sets', () => {
    const p = act2Profile();
    p.region = ABYSS_INDEX;
    expect(buildRunConfig(p).abyssRelics).toEqual([]);
    p.stars = { 'lantern-1': 1, 'lantern-2': 1 };
    expect(buildRunConfig(p).abyssRelics).toEqual(abyssRelics([1, 2]));
    expect(abyssRelics([1, 2])).toHaveLength(6);
  });
});

describe('the Abyss (§9)', () => {
  it('floors are ten waves on a template, the tenth a boss; every fifth an Abyss boss', () => {
    expect(floorOf(1)).toBe(1);
    expect(floorOf(10)).toBe(1);
    expect(floorOf(11)).toBe(2);
    expect(floorWave(23)).toBe(3);
    const f = abyssFloor(2);
    expect(f.abyss).toEqual({ floor: 2 });
    expect(f.rule).toBe(floorTemplate(2).rule);
    expect(isBossWave(f, 20)).toBe(true);
    expect(isBossWave(f, 19)).toBe(false);
    expect(floorBoss(5)).toBe('deepwarden');
    expect(floorBoss(10)).toBe('hunger');
    expect(BOSS_BY_ID[floorBoss(3)].abyss).toBeFalsy();
    // Elites on a floor's third, sixth and ninth waves.
    expect([11, 12, 13, 16, 19, 20].map((n) => isEliteWave(abyssFloor(2), n))).toEqual([false, false, true, true, true, false]);
  });

  it('the natives join the floors one by one', () => {
    for (const n of NATIVES) {
      expect(abyssFloor(n.from).pool.some((p) => p.enemy === n.enemy)).toBe(true);
      if (n.from > 1) expect(abyssFloor(n.from - 1).pool.some((p) => p.enemy === n.enemy)).toBe(false);
    }
  });

  it('a run goes floor to floor: the boss falls, the next floor starts deeper', () => {
    const run = runIn(ABYSS_INDEX);
    expect(run.regionId).toBe(ABYSS_INDEX);
    startWave(run, abyssFloor(1), FLOOR_WAVES);
    const boss = run.enemies.find((e) => e.boss)!;
    expect(boss.boss).toBe(floorBoss(1));
    expect(run.boss!.wave).toBe(FLOOR_WAVES);
    damageEnemy(run, boss, boss.maxHp * 10, false);
    expect(run.floors).toBe(1);
    expect(run.felled).toEqual([floorBoss(1)]);
    for (let i = 0; i < 4 / SIM_DT && run.wave === FLOOR_WAVES; i++) step(run, SIM_DT);
    expect(run.wave).toBe(FLOOR_WAVES + 1);
    expect(run.enemies.every((e) => e.wave === FLOOR_WAVES || e.wave === FLOOR_WAVES + 1)).toBe(true);
  });

  it('a floor brings its own rule: the Mire floor sees less far', () => {
    const run = runIn(ABYSS_INDEX);
    const mireFloor = [1, 2, 3, 4, 5, 6].find((f) => floorTemplate(f).index === 2)!;
    const range = run.stats.range;
    startWave(run, abyssFloor(mireFloor), (mireFloor - 1) * FLOOR_WAVES + 1);
    expect(run.stats.range).toBeLessThan(range);
  });

  it('banking an Abyss run records floors, not region records, and pays Starlight', () => {
    const p = act2Profile();
    p.region = ABYSS_INDEX;
    const run = createRun(buildRunConfig(p), 1);
    expect(run.firstKill).toBe(false);
    run.floors = 3;
    run.felled = [floorBoss(1), floorBoss(2), floorBoss(3)];
    run.wave = 34;
    run.outcome = { kind: 'fell', wave: 34, time: 900 };
    const s = bankRun(p, run);
    expect(s.abyss).toEqual({ floor: 4, cleared: 3 });
    expect(s.floorRecord?.starlight).toBe(abyssStarlight(3));
    expect(p.records.bestWave).toBe(0);
    expect(p.abyss.best).toBe(3);
    expect(s.boss).toBeNull();
  });

  it('numbers scale cleanly to 10³⁰ and past (P8 gate)', () => {
    const run = runIn(ABYSS_INDEX);
    let deep = 1;
    while (waveHp(abyssFloor(floorOf(deep)), deep) < 1e30) deep += 10;
    const region = abyssFloor(floorOf(deep));
    expect(Number.isFinite(waveHp(region, deep))).toBe(true);
    const e = spawnEnemy(run, region, 'grunt', deep, 300, 0);
    expect(e.maxHp).toBeGreaterThan(1e29);
    expect(Number.isFinite(e.shards)).toBe(true);
    const before = run.shards;
    damageEnemy(run, e, e.maxHp * 2, false);
    expect(e.alive).toBe(false);
    expect(Number.isFinite(run.shards)).toBe(true);
    expect(run.shards).toBeGreaterThan(before);
    expect(formatNumber(1e30)).toBe('1.00No');
    expect(formatNumber(999.6e30)).toBe('1.00Dc');
    expect(formatNumber(4.56e45)).toBe('4.56Qad');
    expect(formatNumber(1.234e70)).toBe('1.23e70');
    expect(formatNumber(nodeCost(FORGE_BY_ID['fortune-mastery'], 250))).toMatch(/^\d+(\.\d+)?[A-Za-z]+$/);
  });
});

describe('the Abyss enemies (§9)', () => {
  it('a Husk swallows its first hits whole; Husk Splinter thins the shell', () => {
    const run = runIn(ABYSS_INDEX);
    const h = spawnEnemy(run, abyssFloor(1), 'husk', 1, 300, 0);
    expect(h.shell).toBe(verbOf('husk', 'carapace').hits);
    const hits = h.shell;
    for (let i = 0; i < hits; i++) damageEnemy(run, h, 1e9, false);
    expect(h.alive).toBe(true);
    expect(h.hp).toBe(h.maxHp);
    damageEnemy(run, h, 1, false);
    expect(h.hp).toBeLessThan(h.maxHp);
    const thin = runIn(ABYSS_INDEX, { behaviours: { 'brittle-shell': 1 } });
    expect(spawnEnemy(thin, abyssFloor(1), 'husk', 1, 300, 0).shell).toBe(verbOf('husk', 'carapace').hits - BALANCE.relics.brittleShell[0]);
  });

  it('a Ram charges at many times its pace; slowed, it charges less far, and Anchor Stone holds it', () => {
    const v = verbOf('ram', 'charge');
    const run = runIn(ABYSS_INDEX);
    const r = spawnEnemy(run, abyssFloor(2), 'ram', 11, 700, 0);
    walk(run, v.interval * 0.5 + 0.05);
    expect(r.dashUntil).toBeGreaterThan(run.time);
    const x = r.x;
    walk(run, 0.1);
    expect(x - r.x).toBeGreaterThan(r.speed * 0.1 * (v.speed - 1));
    const held = runIn(ABYSS_INDEX, { behaviours: { anchor: 1 } });
    const s = spawnEnemy(held, abyssFloor(2), 'ram', 11, 700, 0);
    s.slow = 0.5;
    s.slowUntil = 1e9;
    walk(held, v.interval * 2);
    expect(s.dashUntil).toBe(0);
  });

  it('a Wardstone shields its neighbours from where it stands off, and never hits the wall', () => {
    const v = verbOf('wardstone', 'ward');
    const run = runIn(ABYSS_INDEX);
    const w = spawnEnemy(run, abyssFloor(3), 'wardstone', 21, v.standoff - 1, 0);
    const near = body(run, { x: v.standoff - 40, y: 0, hp: 1000, maxHp: 1000 });
    walk(run, 20);
    expect(near.buffShield).toBeCloseTo(v.shield);
    expect(Math.hypot(w.x, w.y)).toBeGreaterThan(v.standoff - 2);
    expect(run.tower.hp).toBe(run.stats.maxHp);
    damageEnemy(run, near, 100, false);
    expect(near.hp).toBeCloseTo(1000 - 100 * v.shield);
    const broken = runIn(ABYSS_INDEX, { behaviours: { wardbreak: 3 } });
    spawnEnemy(broken, abyssFloor(3), 'wardstone', 21, v.standoff - 1, 0);
    const other = body(broken, { x: v.standoff - 40, y: 0, hp: 1000, maxHp: 1000 });
    walk(broken, 0.1);
    damageEnemy(broken, other, 100, false);
    expect(other.hp).toBeCloseTo(900);
  });

  it('a Maw feeds on the fallen near it, healing and growing; Maw Tooth starves it', () => {
    const run = runIn(ABYSS_INDEX);
    const m = spawnEnemy(run, abyssFloor(4), 'maw', 31, 300, 0);
    m.hp = m.maxHp / 2;
    const max = m.maxHp;
    const prey = body(run, { x: 320, y: 0 });
    damageEnemy(run, prey, 1e9, false);
    expect(m.feeds).toBe(1);
    expect(m.maxHp).toBeGreaterThan(max);
    expect(m.hp).toBeGreaterThan(max / 2);
    const starved = runIn(ABYSS_INDEX, { behaviours: { starve: 1 } });
    const n = spawnEnemy(starved, abyssFloor(4), 'maw', 31, 300, 0);
    damageEnemy(starved, body(starved, { x: 320, y: 0 }), 1e9, false);
    expect(n.feeds).toBe(0);
  });
});

describe('Act 2 weapons (§9)', () => {
  it('a Moonblade crescent cuts a body on the way out and again on the way home', () => {
    const run = runIn(1);
    arm(run, 'moonblade');
    const e = body(run, { x: 200, y: 0, hp: 1e6, maxHp: 1e6 });
    fight(run, 3);
    // At least two cuts: one each way.
    expect(1e6 - e.hp).toBeGreaterThanOrEqual(2 * 11 * run.stats.damageMult - 1e-9);
  });

  it('a shield turns a crescent\'s edge on the way out; coming home, it cuts the shield from behind', () => {
    const run = runIn(3);
    arm(run, 'moonblade');
    const s = spawnEnemy(run, regionByIndex(3), 'shieldbearer', 3, 260, 0);
    s.speed = 0;
    s.hp = s.maxHp = 1e6;
    fight(run, 3);
    expect(s.hp).toBeLessThan(1e6);
  });

  it('Rune Traps lay runes in the path, armed after a beat, that burst under a body', () => {
    const run = runIn(1);
    arm(run, 'rune-traps');
    const e = body(run, { x: 300, y: 0, hp: 1e6, maxHp: 1e6 });
    fight(run, 0.1);
    expect(run.runes).toHaveLength(1);
    expect(run.runes[0].x).toBeCloseTo(300 * BALANCE.weapons.runeLay);
    e.x = run.runes[0].x;
    fight(run, BALANCE.weapons.runeArm + 0.05);
    expect(e.hp).toBeLessThan(1e6);
  });

  it('Soul Tether holds as many as it has threads, and Lifebloom mends the tower through them', () => {
    const run = runIn(1);
    arm(run, 'soul-tether', 1, true);
    for (let i = 0; i < 4; i++) body(run, { x: 150 + i * 30, y: 0, hp: 1e6, maxHp: 1e6 });
    run.tower.hp = run.stats.maxHp / 2;
    fight(run, 1);
    expect(run.weapons[0].tethers).toHaveLength(2);
    expect(run.tower.hp).toBeGreaterThan(run.stats.maxHp / 2);
    expect(run.enemies.filter((e) => e.hp < e.maxHp)).toHaveLength(2);
  });

  it('a Gilded Rail slug strikes everything in its line, shields or not; Midas Lance gilds and pays double', () => {
    const run = runIn(3);
    arm(run, 'gilded-rail', 1, true);
    const s = spawnEnemy(run, regionByIndex(3), 'shieldbearer', 3, 150, 0);
    s.speed = 0;
    const behind = body(run, { x: 300, y: 0, hp: 1e6, maxHp: 1e6 });
    fight(run, 0.05);
    expect(s.hp).toBeLessThan(s.maxHp);
    expect(behind.hp).toBeLessThan(1e6);
    expect(behind.gildedUntil).toBeGreaterThan(run.time);
    const plain = body(run, { x: 0, y: 300, shards: 10 });
    const gilt = body(run, { x: 0, y: -300, shards: 10, gildedUntil: 1e9 });
    const before = run.shards;
    damageEnemy(run, plain, 1e9, false);
    const once = run.shards - before;
    damageEnemy(run, gilt, 1e9, false);
    expect(run.shards - before - once).toBeCloseTo(once * BALANCE.evolutions['midas-lance'].shards);
  });

  it('each Act 2 weapon evolves with the passive Act 1 left without a partner', () => {
    const partners: Record<string, string> = { moonblade: 'velocity', 'rune-traps': 'fortify', 'soul-tether': 'mending', 'gilded-rail': 'greed' };
    for (const [w, p] of Object.entries(partners)) {
      const run = runIn(1, { behaviours: { alchemy: 1 } });
      run.weapons = [newWeapon(w as WeaponId, BALANCE.evolutions.evolveAt)];
      run.passives = [{ id: p as never, level: 1 }];
      expect(evolutionCards(run).map((c) => c.kind)).toEqual(['evolution']);
    }
  });

  it('Bulwark Runes set off a rune where a body strikes the wall', () => {
    const run = runIn(1);
    arm(run, 'rune-traps', 5, true);
    const near = body(run, { x: run.stats.radius + 20, y: 0, hp: 1e6, maxHp: 1e6 });
    hurtTower(run, 1, near.x, near.y, near, 'contact');
    expect(near.hp).toBeLessThan(1e6);
  });
});

describe('Act 2 frames (§9)', () => {
  it('Daybreak slows everything in range and doubles what it takes', () => {
    const p = act2Profile();
    p.stars = { 'warden-lamplighter': 1 };
    p.frame = 'lamplighter';
    const run = createRun(buildRunConfig(p), 1);
    expect(run.frameId).toBe('lamplighter');
    const e = body(run, { x: 200, y: 0, hp: 1000, maxHp: 1000 });
    run.ult.charge = 1;
    expect(castUltimate(run)).toBe(true);
    tickUltimate(run, SIM_DT);
    expect(e.slow).toBeCloseTo(0.5);
    damageEnemy(run, e, 100, false);
    expect(e.hp).toBeCloseTo(800);
  });

  it('Eclipse takes a quarter of what each body has left, and a boss a twentieth; the Gravekeeper mends on kills', () => {
    const p = act2Profile();
    p.stars = { 'warden-lamplighter': 1, 'warden-conduit': 1, 'warden-gravekeeper': 1 };
    p.frame = 'gravekeeper';
    const run = createRun(buildRunConfig(p), 1);
    const e = body(run, { x: 200, y: 0, hp: 1000, maxHp: 1000 });
    run.ult.charge = 1;
    castUltimate(run);
    expect(e.hp).toBeCloseTo(750);
    run.tower.hp = 10;
    damageEnemy(run, e, 1e9, false);
    expect(run.tower.hp).toBeCloseTo(10 + run.stats.maxHp * BALANCE.behaviours.siphon);
  });

  it('Eclipse strikes a shared pool of HP once: a Chorus loses a quarter, not a quarter per body', () => {
    const p = act2Profile();
    p.stars = { 'warden-lamplighter': 1, 'warden-conduit': 1, 'warden-gravekeeper': 1 };
    p.frame = 'gravekeeper';
    const run = createRun({ ...buildRunConfig(p), regionId: 6 }, 1);
    const c = spawnEnemy(run, regionByIndex(6), 'chorus', 3, 200, 0);
    const all = run.enemies.filter((e) => e.group === c.id);
    expect(all.length).toBeGreaterThan(1);
    // Armour aside: the share is of what is left, and armour is the run's own sum.
    for (const e of all) e.armor = 0;
    run.ult.charge = 1;
    castUltimate(run);
    for (const e of all) expect(e.hp).toBeCloseTo(c.maxHp * 0.75);
  });
});

describe('the fight still ends (§4.3)', () => {
  it('an enraged boss walks through knockback and frost to the wall', () => {
    const run = runIn(2);
    startWave(run, regionByIndex(2), 20);
    const b = run.enemies.find((e) => e.boss)!;
    run.boss!.enraged = true;
    b.slow = 0.9;
    b.slowUntil = 1e9;
    const d = Math.hypot(b.x, b.y);
    walk(run, 1);
    expect(d - Math.hypot(b.x, b.y)).toBeGreaterThan(b.speed * 0.9);
    applyInput(run, {});
  });

  it('no Act 2 pact or rank breaks a run: a short heat-29 run steps cleanly', () => {
    const all = Object.fromEntries(PACTS.map((p) => [p.id, p.ranks])) as Record<PactId, number>;
    for (const region of [1, 2, 3, 4, 5, 6]) {
      const run = runIn(region, { pacts: all });
      for (let i = 0; i < 20 / SIM_DT && !run.outcome; i++) step(run, SIM_DT, run.draft ? { pick: run.draft.suggested } : {});
      expect(Number.isFinite(run.tower.hp)).toBe(true);
      expect(run.enemies.every((e: Enemy) => Number.isFinite(e.hp))).toBe(true);
    }
  });
});
