import { describe, expect, it } from 'vitest';
import { newProfile, type Profile } from '../src/meta/profile';
import { buildRunConfig } from '../src/meta/runConfig';
import { bankRun } from '../src/meta/results';
import { claimFeat } from '../src/meta/feats';
import { inRush, regionUnlocked } from '../src/meta/collection';
import { recordRush, runPacts, setPactRank } from '../src/meta/pacts';
import { fusionBook } from '../src/meta/recipes';
import { STAR_WEB, skyWhole } from '../src/meta/stars';
import { createRun, step } from '../src/sim/run';
import { applyCard, candidateCards, fusionCards } from '../src/sim/systems/draft';
import { damageEnemy } from '../src/sim/systems/combat';
import { armed, newWeapon, slotsUsed } from '../src/sim/systems/arms';
import { bossBody } from '../src/sim/systems/boss';
import { isBossWave, regionAt, startWave, waveHp } from '../src/sim/systems/waves';
import { suggest } from '../src/sim/suggest';
import { abyssFloor } from '../src/content/abyss';
import { BALANCE } from '../src/content/balance';
import { BOSSES, BOSS_BY_ID } from '../src/content/bosses';
import { FEATS } from '../src/content/feats';
import { FUSIONS, FUSION_BY_ID } from '../src/content/fusions';
import { PACT_BY_ID } from '../src/content/pacts';
import { RUSH_BOSSES, RUSH_INDEX, RUSH_STAGES, rushStage, rushStarlight } from '../src/content/rush';
import { STARS } from '../src/content/stars';
import { SIM_DT } from '../src/app/loop';
import type { FusionId, WeaponId } from '../src/content/types';
import type { RunState } from '../src/sim/state';
import { body } from './helpers/body';

/** A profile with every Act 1 boss down: Act 2 is open. */
function act2Profile(): Profile {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  for (const b of BOSSES) if (!b.abyss) p.bosses[b.id] = { kills: 1, fastest: 60 };
  return p;
}

/** …and the Deepwarden down: Boss Rush is open. */
function rushProfile(): Profile {
  const p = act2Profile();
  p.bosses.deepwarden = { kills: 1, fastest: 60 };
  p.region = RUSH_INDEX;
  return p;
}

/** Fell the run's standing boss, and let the beat after it pass. */
function fell(run: RunState): void {
  damageEnemy(run, bossBody(run)!, 1e15, false);
  for (let i = 0; i < (BALANCE.waves.afterBoss + 0.5) / SIM_DT && !run.outcome; i++) step(run, SIM_DT);
}

describe("Act 2's economy (S7, B7)", () => {
  it('Act 2 feats pay Starlight on top of their shards; Act 1 feats only shards', () => {
    const p = act2Profile();
    p.feats.kindled = 'done';
    p.feats['first-light'] = 'done';
    const kindled = FEATS.find((f) => f.id === 'kindled')!;
    expect(claimFeat(p, 'kindled')).toBe(kindled.reward);
    expect(p.starlight).toBe(kindled.starlight);
    claimFeat(p, 'first-light');
    expect(p.starlight).toBe(kindled.starlight);
    for (const f of FEATS) {
      if (f.after === 'blight') expect(f.starlight).toBeGreaterThanOrEqual(5);
      else expect(f.starlight).toBeUndefined();
    }
  });

  it('Vigour is graded finer (D-7): a quarter a rank, over nine, to the same top', () => {
    const v = PACT_BY_ID.vigour;
    expect(v.ranks).toBe(9);
    expect(v.effect).toEqual({ kind: 'hp', mult: 1.25 });
    expect(Math.pow(1.25, 9)).toBeCloseTo(Math.pow(1.5, 5), 0);
  });

  it("the Abyss's guardians are lighter than a floor's other bosses (S7.5)", () => {
    const run = createRun({ ...buildRunConfig(act2Profile()), regionId: 7 }, 1);
    const hpOf = (floor: number): number => {
      const region = abyssFloor(floor);
      startWave(run, region, floor * 10);
      const b = bossBody(run)!;
      const share = b.maxHp / (waveHp(region, floor * 10) * BOSS_BY_ID[region.boss].hp);
      b.alive = false;
      return share;
    };
    expect(hpOf(4)).toBeCloseTo(BALANCE.abyss.bossHp);
    expect(hpOf(5)).toBeCloseTo(BALANCE.abyss.guardianHp);
  });

  it('Firmament asks for every star', () => {
    expect(FEATS.find((f) => f.id === 'firmament')!.goal).toEqual({ kind: 'stars', n: STARS.length });
  });
});

describe('Boss Rush (N8)', () => {
  it('opens once the Deepwarden falls; no pacts, no Trial, and no first kill there', () => {
    const p = act2Profile();
    expect(regionUnlocked(p, RUSH_INDEX)).toBe(false);
    p.region = RUSH_INDEX;
    expect(inRush(p)).toBe(false);
    p.bosses.deepwarden = { kills: 1, fastest: 60 };
    expect(regionUnlocked(p, RUSH_INDEX)).toBe(true);
    expect(inRush(p)).toBe(true);
    setPactRank(p, 'hordes', 2);
    expect(runPacts(p)).toEqual({});
    const config = buildRunConfig(p);
    expect(config.regionId).toBe(RUSH_INDEX);
    expect(config.trial).toBeNull();
    expect(config.firstKill).toBe(false);
  });

  it('every wave is a boss, in order, each sized like an Abyss guardian', () => {
    for (let n = 1; n <= RUSH_STAGES; n++) {
      const stage = regionAt(RUSH_INDEX, n);
      expect(stage).toBe(rushStage(n));
      expect(stage.boss).toBe(RUSH_BOSSES[n - 1]);
      expect(isBossWave(stage, n)).toBe(true);
      expect(stage.rule).toBeNull();
      const floor = BALANCE.rush.floors[n - 1];
      expect(waveHp(stage, n)).toBeCloseTo(waveHp(abyssFloor(floor), floor * 10));
    }
    const run = createRun(buildRunConfig(rushProfile()), 1);
    startWave(run, rushStage(1), 1);
    const b = bossBody(run)!;
    expect(b.maxHp).toBeCloseTo(waveHp(rushStage(1), 1) * BOSS_BY_ID.gatekeeper.hp * BALANCE.abyss.guardianHp);
  });

  it('the tower starts high, with its drafts banked', () => {
    const run = createRun(buildRunConfig(rushProfile()), 1);
    expect(run.level).toBe(BALANCE.rush.level);
    expect(run.pendingDrafts).toBe(BALANCE.rush.level - 1);
  });

  it('the last boss down wins the run; the record pays Starlight and keeps no boss records', () => {
    const p = rushProfile();
    const run = createRun(buildRunConfig(p), 1);
    run.pendingDrafts = 0;
    for (let n = 1; n <= RUSH_STAGES; n++) {
      if (n === 1) startWave(run, rushStage(1), 1);
      expect(run.wave).toBe(n);
      expect(run.boss?.id).toBe(RUSH_BOSSES[n - 1]);
      fell(run);
    }
    expect(run.outcome?.kind).toBe('cleared');
    expect(run.felled).toEqual(RUSH_BOSSES);
    const kills = { ...p.bosses };
    const s = bankRun(p, run);
    expect(s.outcome).toBe('cleared');
    expect(s.rush).toEqual({ stages: RUSH_STAGES, time: run.outcome!.time });
    expect(s.rushRecord?.starlight).toBe(rushStarlight(RUSH_STAGES, run.outcome!.time));
    expect(p.rush).toEqual({ best: RUSH_STAGES, time: run.outcome!.time });
    expect(p.bosses).toEqual(kills);
    expect(s.boss).toBeNull();
  });

  it('is deterministic: the same seed and the suggestion give the same rush, fusions and all', () => {
    const p = rushProfile();
    p.forge = { alchemy: 1 };
    p.stars = Object.fromEntries(STARS.map((n) => [n.id, n.maxLevel]));
    const play = (): string => {
      const run = createRun(buildRunConfig(p), 9);
      for (let i = 0; i < 90 / SIM_DT && !run.outcome; i++) step(run, SIM_DT, run.draft ? { takeAll: true } : {});
      const { events: _events, ...rest } = run;
      return JSON.stringify(rest);
    };
    const a = play();
    expect(play()).toBe(a);
    expect(JSON.parse(a).boss.id).toBe('gatekeeper');
  });

  it('a record is more stages, or a faster full clear; it pays the difference on the curve', () => {
    const p = rushProfile();
    expect(recordRush(p, 3, 200)?.starlight).toBe(3 * BALANCE.rush.starlight.perStage);
    expect(recordRush(p, 2, 100)).toBeNull();
    const full = recordRush(p, RUSH_STAGES, 600)!;
    expect(full.now).toEqual({ stages: RUSH_STAGES, time: 600 });
    expect(full.starlight).toBe(rushStarlight(RUSH_STAGES, 600) - rushStarlight(3, null));
    expect(recordRush(p, RUSH_STAGES, 700)).toBeNull();
    expect(recordRush(p, RUSH_STAGES, 300)?.starlight).toBe(rushStarlight(RUSH_STAGES, 300) - rushStarlight(RUSH_STAGES, 600));
    expect(rushStarlight(RUSH_STAGES, 150) - rushStarlight(RUSH_STAGES, 300))
      .toBeLessThan(rushStarlight(RUSH_STAGES, 300) - rushStarlight(RUSH_STAGES, 1e9));
  });
});

describe('Ascended minors (N10)', () => {
  const minor = STARS.find((n) => n.id === 'smith-damage')!;

  it('a percentage minor goes on past its last level only once every star is lit', () => {
    const p = act2Profile();
    p.starlight = 1e6;
    p.stars = { 'smith-moonblade': 1, 'smith-damage': minor.maxLevel };
    expect(STAR_WEB.isBuyable(p, minor.id)).toBe(false);
    for (const n of STARS) p.stars[n.id] = Math.max(1, p.stars[n.id] ?? 0);
    p.stars[minor.id] = minor.maxLevel;
    expect(skyWhole(p)).toBe(true);
    expect(STAR_WEB.isBuyable(p, minor.id)).toBe(true);
    const before = p.starlight;
    expect(STAR_WEB.buy(p, minor.id)).toBe(true);
    const plain = Math.round(minor.cost * Math.pow(1.5, minor.maxLevel));
    expect(before - p.starlight).toBe(Math.round(plain * BALANCE.ascend.cost));
    // An add-stat minor (armour) stays capped.
    const plate = STARS.find((n) => n.id === 'warden-armor')!;
    p.stars[plate.id] = plate.maxLevel;
    expect(STAR_WEB.isBuyable(p, plate.id)).toBe(false);
  });

  it('each ascended level is a compounding multiplier', () => {
    const mods = STAR_WEB.statMods(minor, minor.maxLevel + 2);
    expect(mods).toContainEqual({ key: 'damage', pct: 0.2 * minor.maxLevel });
    expect(mods).toContainEqual({ key: 'damage', mult: Math.pow(1 + 0.2 * BALANCE.ascend.share, 2) });
    const p = act2Profile();
    for (const n of STARS) p.stars[n.id] = n.maxLevel;
    const plain = createRun(buildRunConfig(p), 1).stats.damageMult;
    p.stars[minor.id] = minor.maxLevel + 2;
    const ascended = createRun(buildRunConfig(p), 1).stats.damageMult;
    expect(ascended / plain).toBeCloseTo(Math.pow(1 + 0.2 * BALANCE.ascend.share, 2));
  });
});

describe('Fusions (N9)', () => {
  /** An Act 2 run with fusion `id`'s star lit and both its weapons evolved. */
  function ready(id: FusionId, lit = true): RunState {
    const p = act2Profile();
    p.forge = { alchemy: 1 };
    if (lit) p.stars = { [`smith-${id}`]: 1 };
    const run = createRun(buildRunConfig(p), 1);
    run.weaponSlots = 3;
    run.weapons = FUSION_BY_ID[id].weapons.map((w: WeaponId) => ({ ...newWeapon(w, BALANCE.maxLevel), evolved: true }));
    return run;
  }

  it('every fusion has its star; a fusion is offered only once lit and both halves are evolved', () => {
    for (const f of FUSIONS) expect(STARS.some((n) => n.effects.some((e) => e.kind === 'fusion' && e.id === f.id))).toBe(true);
    expect(fusionCards(ready('blizzard', false))).toEqual([]);
    const run = ready('blizzard');
    expect(fusionCards(run)).toEqual([{ kind: 'fusion', id: 'blizzard' }]);
    run.weapons[1].evolved = false;
    expect(fusionCards(run)).toEqual([]);
  });

  it('taken, the pair shares one mount, a slot is freed, both hit harder, and it is suggested', () => {
    const run = ready('dawnstar');
    const cards = candidateCards(run);
    expect(cards[0]).toEqual({ kind: 'fusion', id: 'dawnstar' });
    expect(suggest(run, cards)).toBe(0);
    const before = armed(run.stats, run.weapons[0]).damage;
    expect(slotsUsed(run)).toBe(2);
    applyCard(run, { kind: 'fusion', id: 'dawnstar' });
    expect(run.fused).toEqual(['dawnstar']);
    expect(run.weapons.map((w) => w.fusion)).toEqual(['dawnstar', 'dawnstar']);
    expect(run.weapons[1].joined).toBe(true);
    expect(slotsUsed(run)).toBe(1);
    expect(armed(run.stats, run.weapons[0]).damage).toBeCloseTo(before * BALANCE.fusions.damage);
    expect(fusionCards(run)).toEqual([]);
    expect(run.events.some((e) => e.kind === 'fuse')).toBe(true);
  });

  it('Blizzard: lightning freezes what it strikes, and strikes the frozen for double', () => {
    const run = ready('blizzard');
    applyCard(run, { kind: 'fusion', id: 'blizzard' });
    const e = body(run, { hp: 1e6, maxHp: 1e6 });
    damageEnemy(run, e, 100, false, 'chain');
    expect(e.maxHp - e.hp).toBeCloseTo(100);
    expect(e.frozenUntil).toBeGreaterThan(run.time);
    const hp = e.hp;
    damageEnemy(run, e, 100, false, 'chain');
    expect(hp - e.hp).toBeCloseTo(100 * BALANCE.fusions.blizzard.frozen);
  });

  it('Firestorm: shells set alight, and burning bodies take more from them', () => {
    const run = ready('firestorm');
    applyCard(run, { kind: 'fusion', id: 'firestorm' });
    const e = body(run, { hp: 1e6, maxHp: 1e6 });
    damageEnemy(run, e, 100, false, 'lob');
    expect(e.burnUntil).toBeGreaterThan(run.time);
    const hp = e.hp;
    damageEnemy(run, e, 100, false, 'lob');
    expect(hp - e.hp).toBeCloseTo(100 * BALANCE.fusions.firestorm.burning);
  });

  it('Dawnstar: bolts strike the beam’s body harder', () => {
    const run = ready('dawnstar');
    applyCard(run, { kind: 'fusion', id: 'dawnstar' });
    const e = body(run, { hp: 1e6, maxHp: 1e6 });
    const o = body(run, { hp: 1e6, maxHp: 1e6, y: 100 });
    run.weapons.find((w) => w.id === 'sunlance')!.beamTarget = e.id;
    damageEnemy(run, e, 100, false, 'homing');
    damageEnemy(run, o, 100, false, 'homing');
    expect(e.maxHp - e.hp).toBeCloseTo(100 * BALANCE.fusions.dawnstar.marked);
    expect(o.maxHp - o.hp).toBeCloseTo(100);
  });

  it('Sky Hive: a blade kill calls a drone', () => {
    const run = ready('sky-hive');
    applyCard(run, { kind: 'fusion', id: 'sky-hive' });
    const drones = run.weapons.find((w) => w.id === 'sentinel-drones')!;
    const before = drones.drones.length;
    damageEnemy(run, body(run, { hp: 1, maxHp: 1 }), 10, false, 'orbit');
    expect(drones.drones.length).toBe(before + 1);
  });

  it('banked, a new fusion is found and shows on the Book’s second page', () => {
    const p = act2Profile();
    p.stars = { 'smith-sky-hive': 1 };
    expect(fusionBook(p).find((f) => f.fusion.id === 'sky-hive')).toMatchObject({ found: false, lit: true });
    const run = ready('sky-hive');
    applyCard(run, { kind: 'fusion', id: 'sky-hive' });
    run.outcome = { kind: 'retreat', wave: 1, time: 1 };
    expect(bankRun(p, run).newFusions).toEqual(['sky-hive']);
    expect(p.fusions).toEqual(['sky-hive']);
    expect(fusionBook(p).find((f) => f.fusion.id === 'sky-hive')!.found).toBe(true);
  });
});
