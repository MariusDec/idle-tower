import { describe, expect, it } from 'vitest';
import { applyInput, createRun, step, twinSpares } from '../src/sim/run';
import { buildRunConfig } from '../src/meta/runConfig';
import { newProfile } from '../src/meta/profile';
import { SIM_DT } from '../src/app/loop';
import { BALANCE } from '../src/content/balance';
import { BOSSES } from '../src/content/bosses';
import { regionByIndex } from '../src/content/regions';
import type { BehaviourId, WeaponId } from '../src/content/types';
import { WEAPON_BY_ID } from '../src/content/weapons';
import { damageEnemy, kill, knockBack, tickProjectiles, tickWeapons } from '../src/sim/systems/combat';
import { newWeapon } from '../src/sim/systems/arms';
import { gainXp, pickCard, tickDraft } from '../src/sim/systems/draft';
import { tickEnemies } from '../src/sim/systems/enemies';
import { tickWake } from '../src/sim/systems/wake';
import { hurtTower } from '../src/sim/systems/tower';
import type { Projectile, RunState } from '../src/sim/state';
import { body } from './helpers/body';

function withForge(forge: Record<string, number>, seed = 1): RunState {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  p.forge = forge;
  return createRun(buildRunConfig(p), seed);
}

const behaviour = (id: BehaviourId, n = 1): RunState => {
  const run = withForge({});
  run.behaviours[id] = n;
  return run;
};

describe('shards (§8.3)', () => {
  it('kills drop the region rate times the enemy weight, times shard gain', () => {
    const run = withForge({ 'fortune-shards': 2 });
    const e = body(run, { shards: 3 });
    damageEnemy(run, e, 1e6, false);
    expect(run.shards).toBeCloseTo(3 * (1 + 0.1 * 2));
    expect(run.shardsFrom.kills).toBeCloseTo(run.shards);
  });

  it('reaching wave n + 1 pays waveShards × n', () => {
    const run = withForge({});
    const region = regionByIndex(1);
    while (run.wave < 3 && !run.outcome) {
      step(run, SIM_DT);
      run.events.length = 0;
    }
    expect(run.shardsFrom.waves).toBeCloseTo(region.waveShards * (1 + 2));
  });
});

describe('Forge behaviours (§11.4)', () => {
  it('Overkill carries excess damage to the nearest enemy, once', () => {
    const run = behaviour('overkill');
    const a = body(run, { hp: 10, maxHp: 10 });
    const b = body(run, { x: 260 });
    const c = body(run, { x: 330 });
    damageEnemy(run, a, 50, false);
    expect(a.alive).toBe(false);
    expect(b.hp).toBeCloseTo(60);
    expect(c.hp).toBe(100);
  });

  it('without Overkill, the excess is lost', () => {
    const run = withForge({});
    const a = body(run, { hp: 10, maxHp: 10 });
    const b = body(run, { x: 260 });
    damageEnemy(run, a, 50, false);
    expect(b.hp).toBe(100);
  });

  it('Executioner finishes a body under its threshold', () => {
    const run = behaviour('executioner');
    const e = body(run, { hp: 100 * BALANCE.behaviours.executeBelow - 1 });
    damageEnemy(run, e, 1, false);
    expect(e.alive).toBe(false);
  });

  it('Thorns hits back the body that hit the tower', () => {
    const run = behaviour('thorns');
    const e = body(run, { x: run.stats.radius + 20, inContact: true, attackTimer: 0 });
    tickEnemies(run, SIM_DT);
    const dealt = e.damage;
    expect(e.hp).toBeCloseTo(100 - dealt * BALANCE.behaviours.thorns);
  });

  it('Second Wind turns one fall into a rise', () => {
    const run = withForge({});
    run.revives = 1;
    run.tower.hp = -5;
    step(run, SIM_DT);
    expect(run.outcome).toBeNull();
    expect(run.tower.hp).toBeGreaterThan(run.stats.maxHp * 0.49);
    run.tower.hp = -5;
    step(run, SIM_DT);
    expect(run.outcome?.kind).toBe('fell');
  });

  it('Last Stand speeds up the weapons when the tower is low', () => {
    const fire = (low: boolean): number => {
      const run = behaviour('last-stand');
      body(run, { hp: 1e12, maxHp: 1e12, x: 150 });
      if (low) run.tower.hp = run.stats.maxHp * 0.1;
      let shots = 0;
      for (let i = 0; i < 600; i++) {
        run.tower.hp = low ? run.stats.maxHp * 0.1 : run.stats.maxHp;
        run.current = { n: 99, startedAt: 0, spawns: [], next: 0, doneAt: null, alive: 1 };
        step(run, SIM_DT);
        shots += run.events.filter((e) => e.kind === 'fire').length;
        run.events.length = 0;
      }
      return shots;
    };
    expect(fire(true) / fire(false)).toBeCloseTo(1 + BALANCE.behaviours.lastStandSpeed, 1);
  });

  it('Choice adds a card; Reroll replaces the hand and is spent', () => {
    const run = withForge({ 'might-damage': 1, scattershot: 1, choice: 1, reroll: 1 });
    gainXp(run, run.xpNext);
    step(run, SIM_DT);
    expect(run.draft!.cards).toHaveLength(BALANCE.draft.choices + 1);
    const before = run.draft;
    applyInput(run, { reroll: true });
    expect(run.draft).not.toBe(before);
    expect(run.rerolls).toBe(0);
    const again = run.draft;
    applyInput(run, { reroll: true });
    expect(run.draft).toBe(again);
  });
});

describe('Twin Mount avoids the region\'s blockers (Q1, I3)', () => {
  const shielded = (id: WeaponId): boolean => (WEAPON_BY_ID[id].weakAgainst ?? []).includes('shieldbearer');
  const twin = (region: number, unlocks: string[], seed: number): RunState => {
    const p = newProfile(0);
    p.tutorial.firstDraft = true;
    p.forge = { 'twin-mount': 1, scattershot: 1, ...Object.fromEntries(unlocks.map((id) => [id, 1])) };
    return createRun({ ...buildRunConfig(p), regionId: region }, seed);
  };

  it('in Region 3, the second weapon is never one shields blunt while a spare gets round them', () => {
    // Scattershot (blunted) and Chain Lightning (not): every seed takes the chain.
    const seen = new Set<WeaponId>();
    for (let seed = 1; seed <= 40; seed++) {
      const run = twin(3, ['chain-lightning'], seed);
      expect(run.twinOffer).not.toBeNull();
      expect(shielded(run.twinOffer!)).toBe(false);
      seen.add(run.twinOffer!);
    }
    expect([...seen]).toEqual(['chain-lightning']);
  });

  it('prefers a spare that counters the opening', () => {
    // Mortar counters Shieldbearers; Chain Lightning and Frost Ring are only not blunted.
    expect(twinSpares(['scattershot', 'chain-lightning', 'frost-ring', 'mortar'], regionByIndex(3))).toEqual(['mortar']);
    expect(twin(3, ['chain-lightning', 'frost-ring', 'mortar'], 1).twinOffer).toBe('mortar');
  });

  it('falls back to the uniform draw when every spare is blunted, and is deterministic', () => {
    expect(twinSpares(['scattershot'], regionByIndex(3))).toEqual(['scattershot']);
    expect(twin(3, [], 7).twinOffer).toBe('scattershot');
    const a = twin(1, ['chain-lightning', 'frost-ring'], 9);
    const b = twin(1, ['chain-lightning', 'frost-ring'], 9);
    expect(a.twinOffer).toBe(b.twinOffer);
  });

  it('starts with the frame\'s weapon alone, and the first draft is sure to offer the twin', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const run = twin(4, ['chain-lightning', 'frost-ring', 'mortar'], seed);
      expect(run.weapons).toHaveLength(1);
      const id = run.twinOffer!;
      gainXp(run, run.xpNext);
      tickDraft(run);
      expect(run.draft!.cards).toContainEqual({ kind: 'weapon', id, level: 1 });
      pickCard(run, run.draft!.cards.findIndex((c) => !(c.kind === 'weapon' && c.id === id)));
      expect(run.twinOffer).toBeNull();
    }
  });
});

describe("the Bell Marches' relics (plans/late-game/12 §8.9)", () => {
  const R = BALANCE.relics;

  it("Carillon's Clapper: on its clock, a toll stuns every body in range but the boss's", () => {
    for (const rank of [0, 1]) {
      const run = behaviour('clapper', rank);
      const near = body(run, { x: 150 });
      const far = body(run, { x: run.stats.range + 100 });
      const boss = body(run, { x: 150, y: 40, boss: 'carillon' });
      run.time = R.clapperEvery + SIM_DT / 2;
      tickWake(run, regionByIndex(1), SIM_DT);
      if (rank === 0) {
        expect(near.stunnedUntil).toBe(0);
        expect(run.events).toEqual([]);
        continue;
      }
      expect(near.stunnedUntil).toBeCloseTo(run.time + R.clapper[0]);
      expect(far.stunnedUntil).toBe(0);
      expect(boss.stunnedUntil).toBe(0);
      expect(run.events).toContainEqual({ kind: 'toll', x: 0, y: 0, relic: true });
      // Off its clock, nothing.
      near.stunnedUntil = 0;
      run.time += 1;
      tickWake(run, regionByIndex(1), SIM_DT);
      expect(near.stunnedUntil).toBe(0);
    }
  });

  it('Tuning Fork: stunned and frozen bodies take more; rank 0 changes nothing', () => {
    const plain = behaviour('tuning-fork', 0);
    const fork = behaviour('tuning-fork', 1);
    const hits: number[] = [];
    for (const run of [plain, fork]) {
      run.time = 10;
      const free = body(run);
      const stunned = body(run, { stunnedUntil: 11 });
      const frozen = body(run, { frozenUntil: 11 });
      hits.push(...[free, stunned, frozen].map((e) => damageEnemy(run, e, 10, false)));
    }
    expect(hits.slice(0, 3)).toEqual([10, 10, 10]);
    expect(hits[3]).toBeCloseTo(10);
    expect(hits[4]).toBeCloseTo(10 * (1 + R.tuningFork[0]));
    expect(hits[5]).toBeCloseTo(10 * (1 + R.tuningFork[0]));
  });

  it('Metronome: a step more for every stretch unhurt, up to its cap, and a hit resets it', () => {
    const plain = behaviour('metronome', 0);
    plain.time = 35;
    expect(damageEnemy(plain, body(plain), 10, false)).toBeCloseTo(10);
    const run = behaviour('metronome', 1);
    run.time = 35;
    expect(damageEnemy(run, body(run), 10, false)).toBeCloseTo(10 * (1 + 3 * R.metronome[0]));
    run.time = 500;
    expect(damageEnemy(run, body(run), 10, false)).toBeCloseTo(10 * (1 + R.metronomeSteps * R.metronome[0]));
    hurtTower(run, 1, 0, 0, null, 'contact');
    expect(run.tower.hurtAt).toBe(500);
    expect(damageEnemy(run, body(run), 10, false)).toBeCloseTo(10);
  });

  it('Muffled Bell: slows, stuns and burns last longer', () => {
    const p = newProfile(0);
    p.tutorial.firstDraft = true;
    const base = createRun(buildRunConfig(p), 1).stats.durationMult;
    // A relic slot: a boss that opens one, down.
    for (const b of BOSSES) if (b.relicSlot) p.bosses[b.id] = { kills: 1, fastest: 60 };
    p.relics = { 'muffled-bell': 1 };
    p.equipped = ['muffled-bell'];
    expect(createRun(buildRunConfig(p), 1).stats.durationMult).toBeCloseTo(base * 1.2);
  });

  // ── Giants' Rest's ──
  it('Colossus Heart: bodies above half their health take more; rank 0 changes nothing', () => {
    const plain = behaviour('colossus', 0);
    expect(damageEnemy(plain, body(plain, { hp: 100 }), 10, false)).toBeCloseTo(10);
    const run = behaviour('colossus', 1);
    expect(damageEnemy(run, body(run, { hp: 100 }), 10, false)).toBeCloseTo(10 * (1 + R.colossus[0]));
    expect(damageEnemy(run, body(run, { hp: 50 }), 10, false)).toBeCloseTo(10);
  });

  it('Tick Bite: a crit marks its body, and a marked body takes more; rank 0 marks nothing', () => {
    const plain = behaviour('tick-bite', 0);
    const p = body(plain, { hp: 1e6, maxHp: 1e6 });
    damageEnemy(plain, p, 10, true);
    expect(p.marked).toBe(false);
    const run = behaviour('tick-bite', 1);
    const e = body(run, { hp: 1e6, maxHp: 1e6 });
    expect(damageEnemy(run, e, 10, false)).toBeCloseTo(10);
    damageEnemy(run, e, 10, true);
    expect(e.marked).toBe(true);
    expect(damageEnemy(run, e, 10, false)).toBeCloseTo(10 * (1 + R.tickBite[0]));
  });

  it('Herd Bell: a large body pays more shards, a small one the same; rank 0 changes nothing', () => {
    const paid = (rank: number, radius: number): number => {
      const run = behaviour('herd-bell', rank);
      kill(run, body(run, { radius, shards: 10 }));
      return run.shards;
    };
    const base = paid(0, 50);
    expect(paid(0, 20)).toBeCloseTo(base);
    expect(paid(1, 50)).toBeCloseTo(base * (1 + R.herdBell[0]));
    expect(paid(1, R.herdBellRadius - 1)).toBeCloseTo(base);
  });

  it("Giant's Toe: Sunlance keeps part of its heat-up on a new target; rank 0 starts cold", () => {
    const turned = (rank: number): { before: number; after: number } => {
      const run = behaviour('giants-toe', rank);
      run.weapons = [newWeapon('sunlance', 1)];
      run.stats = { ...run.stats, critChance: 0 };
      const tough = { hp: 1e9, maxHp: 1e9, radius: 14 };
      const a = body(run, { x: 150, y: 0, ...tough });
      const tick = (): void => {
        run.tick++;
        run.time = run.tick * SIM_DT;
        tickWeapons(run, SIM_DT);
      };
      for (let i = 0; i < 2.5 / SIM_DT; i++) tick();
      const before = run.weapons[0].heat;
      a.alive = false;
      body(run, { x: -150, y: 0, ...tough });
      tick();
      return { before, after: run.weapons[0].heat };
    };
    const cold = turned(0);
    expect(cold.before).toBeGreaterThan(1.5);
    expect(cold.after).toBeLessThan(1.1);
    const warm = turned(1);
    const kept = 1 + (warm.before - 1) * R.giantsToe[0];
    expect(warm.after).toBeGreaterThanOrEqual(kept);
    expect(warm.after).toBeLessThan(kept + 0.1);
  });
});

describe("the Orrery's relics (plans/late-game/12 §8.9)", () => {
  const R = BALANCE.relics;

  it('Astrolabe Ring: Glaives turn faster; rank 0 changes nothing', () => {
    const turned = (rank: number): number => {
      const run = behaviour('astrolabe', rank);
      run.weapons = [newWeapon('glaives', 1)];
      const from = run.weapons[0].spin;
      for (let i = 0; i < 0.5 / SIM_DT; i++) {
        run.tick++;
        run.time = run.tick * SIM_DT;
        tickWeapons(run, SIM_DT);
      }
      return run.weapons[0].spin - from;
    };
    const base = turned(0);
    expect(base).toBeGreaterThan(0);
    expect(turned(1)).toBeCloseTo(base * (1 + R.astrolabe[0]), 6);
  });

  it('Star Chart: a homing bolt that lost its mark finds one farther off; rank 0 does not', () => {
    const seek = (rank: number): number => {
      const run = behaviour('star-chart', rank);
      const far = body(run, { x: 300, y: 0, hp: 1e9, maxHp: 1e9 });
      const p: Projectile = {
        alive: true, weapon: 'arcane-bolt', x: 0, y: 0, px: 0, py: 0, vx: 0, vy: -400, speed: 400, damage: 1, crit: false,
        homing: true, target: 0, pierce: 0, ignore: 0, knockback: 0, life: 2, blast: 0, tx: 0, ty: 0, sx: 0, sy: 0,
        bomblets: 0, meteor: false, seeker: false, boomerang: false, returning: false, struck: [],
      };
      run.projectiles.push(p);
      tickProjectiles(run, SIM_DT);
      return p.target === far.id ? 1 : 0;
    };
    expect(seek(0)).toBe(0);
    expect(seek(1)).toBe(1);
  });

  it('Tidal Lock: bodies within half the range walk slower, those beyond do not; rank 0 changes nothing', () => {
    const walked = (rank: number, x: number): number => {
      const run = behaviour('tidal-lock', rank);
      const e = body(run, { x, y: 0, px: x, py: 0, speed: 60 });
      tickEnemies(run, SIM_DT);
      return x - e.x;
    };
    const near = 0.4 * withForge({}).stats.range;
    const far = 0.9 * withForge({}).stats.range;
    expect(walked(0, near)).toBeCloseTo(60 * SIM_DT);
    expect(walked(1, near)).toBeCloseTo(60 * SIM_DT * (1 - R.tidalLock[0]));
    expect(walked(1, far)).toBeCloseTo(60 * SIM_DT);
  });

  it("Comet Tail: a Glaive's kill leaves burning ground, any other's none; rank 0 leaves none", () => {
    const fires = (rank: number, source: 'orbit' | 'homing'): RunState['fires'] => {
      const run = behaviour('comet-tail', rank);
      kill(run, body(run, { x: 120, y: 30, maxHp: 400, hp: 400 }), source);
      return run.fires;
    };
    expect(fires(0, 'orbit')).toHaveLength(0);
    expect(fires(1, 'homing')).toHaveLength(0);
    const f = fires(1, 'orbit');
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ x: 120, y: 30, radius: R.cometTailRadius, dps: 400 * R.cometTail[0], until: R.cometTailSeconds });
  });
});

describe("the Frozen Sea's relics (plans/late-game/12 §8.9)", () => {
  const R = BALANCE.relics;

  it('Leviathan Scale: knockback shoves farther, a heavy body as if light; rank 0 is the old shove', () => {
    const shoved = (rank: number, mass: number): number => {
      const run = behaviour('leviathan', rank);
      const e = body(run, { x: 200, y: 0, mass });
      knockBack(run, e, 16);
      return e.x - 200;
    };
    expect(shoved(0, 4)).toBe(16 / 4);
    expect(shoved(1, 4)).toBeCloseTo((16 * (1 + R.leviathan[0])) / R.leviathanMass, 9);
    // A light body keeps its own mass: only the heavy are lightened.
    expect(shoved(1, 1)).toBeCloseTo(16 * (1 + R.leviathan[0]), 9);
  });

  it('Skate Blade: a body knocked back takes more for a while; rank 0 changes nothing', () => {
    const hit = (rank: number, wait: number): number => {
      const run = behaviour('skate-blade', rank);
      const e = body(run, { x: 200, hp: 1e6, maxHp: 1e6 });
      knockBack(run, e, 16);
      run.time += wait;
      return damageEnemy(run, e, 100, false);
    };
    expect(hit(0, 0)).toBeCloseTo(100, 9);
    expect(hit(1, 0)).toBeCloseTo(100 * (1 + R.skateBlade[0]), 9);
    expect(hit(1, R.skateSeconds + 0.1)).toBeCloseTo(100, 9);
  });

  it('Floe Shard: a body slain while slowed chills those near it; unslowed, or rank 0, nothing', () => {
    const chilled = (rank: number, slowed: boolean): number => {
      const run = behaviour('floe-shard', rank);
      const dead = body(run, { x: 200, y: 0, slow: slowed ? 0.5 : 0, slowUntil: slowed ? 5 : 0 });
      const near = body(run, { x: 200 + R.floeShardRadius - 10, y: 0 });
      body(run, { x: 200 + R.floeShardRadius + 40, y: 0 });
      kill(run, dead);
      return near.slowUntil > run.time ? near.slow : 0;
    };
    expect(chilled(0, true)).toBe(0);
    expect(chilled(1, false)).toBe(0);
    expect(chilled(1, true)).toBe(R.floeShard[0]);
    const run = behaviour('floe-shard', 1);
    const dead = body(run, { x: 200, slow: 0.5, slowUntil: 5 });
    const far = body(run, { x: 200 + R.floeShardRadius + 40 });
    kill(run, dead);
    expect(far.slowUntil).toBe(0);
  });

  it('Anchor Chain: +20% Max HP at rank I', () => {
    const p = newProfile(0);
    p.tutorial.firstDraft = true;
    // A relic slot: a boss that opens one, down.
    for (const b of BOSSES) if (b.relicSlot) p.bosses[b.id] = { kills: 1, fastest: 60 };
    const base = createRun(buildRunConfig(p), 1).stats.maxHp;
    p.relics = { 'anchor-chain': 1 };
    p.equipped = ['anchor-chain'];
    const worn = createRun(buildRunConfig(p), 1).stats.maxHp;
    expect(worn / base).toBeCloseTo(1.2, 6);
  });
});

describe("Stormcrown's relics (plans/late-game/12 §8.9)", () => {
  const R = BALANCE.relics;

  it('Thunderhead Core: on its clock, it strikes the toughest non-boss body, anywhere; rank 0 strikes nothing', () => {
    for (const rank of [0, 1]) {
      // An Act 1 run: the relic's clock is its own, with no storm about.
      const run = behaviour('thunder-core', rank);
      const small = body(run, { x: 150, hp: 100, maxHp: 100 });
      const big = body(run, { x: 300, hp: 1000, maxHp: 1000 });
      const boss = body(run, { x: 200, y: 40, hp: 1e6, maxHp: 1e6, boss: 'gatekeeper' });
      const hp = run.tower.hp;
      run.time = R.thunderCoreEvery + SIM_DT / 2;
      tickWake(run, regionByIndex(1), SIM_DT);
      if (rank === 0) {
        expect(big.hp).toBe(1000);
        expect(run.events).toEqual([]);
        continue;
      }
      expect(big.hp).toBeCloseTo(1000 - 1000 * R.thunderCore[0]);
      expect(small.hp).toBe(100);
      expect(boss.hp).toBe(1e6);
      expect(run.tower.hp).toBe(hp);
      expect(run.events).toContainEqual({ kind: 'strike', x: big.x, y: big.y, tower: false });
      // Off its clock, nothing.
      const now = big.hp;
      run.time += 1;
      tickWake(run, regionByIndex(1), SIM_DT);
      expect(big.hp).toBe(now);
    }
  });

  it('Lightning Rod: Chain Lightning leaps to one more body a rank; rank 0 changes nothing', () => {
    const struck = (rank: number): number => {
      const run = behaviour('extra-leap', rank);
      run.weapons = [newWeapon('chain-lightning', 1)];
      run.stats = { ...run.stats, critChance: 0 };
      const bodies = [0, 1, 2, 3, 4, 5].map((i) => body(run, { x: 150 + i * 40, y: 0, hp: 1e6, maxHp: 1e6 }));
      for (let i = 0; i < 4 && !run.events.some((e) => e.kind === 'chain'); i++) {
        run.tick++;
        run.time = run.tick * SIM_DT;
        tickWeapons(run, SIM_DT);
      }
      return bodies.filter((b) => b.hp < 1e6).length;
    };
    const base = struck(0);
    expect(base).toBe(WEAPON_BY_ID['chain-lightning'].base.jumps);
    expect(struck(1)).toBe(base + 1);
  });

  it('Grounding Wire: lightning and hostile shots land lighter, a contact hit the same; rank 0 changes nothing', () => {
    const taken = (rank: number, by: 'storm' | 'shots' | 'contact'): number => {
      const run = behaviour('grounding', rank);
      run.stats = { ...run.stats, armor: 0 };
      run.tower.hp = 1e5;
      return hurtTower(run, 100, 0, 0, null, by);
    };
    expect(taken(0, 'storm')).toBeCloseTo(100);
    expect(taken(1, 'storm')).toBeCloseTo(100 * (1 - R.grounding[0]));
    expect(taken(1, 'shots')).toBeCloseTo(100 * (1 - R.grounding[0]));
    expect(taken(1, 'contact')).toBeCloseTo(100);
  });

  it('Static Charge: each crit charges the ultimate; rank 0 changes nothing', () => {
    for (const rank of [0, 1]) {
      const run = behaviour('static', rank);
      run.ult.charge = 0;
      const e = body(run, { hp: 1e6, maxHp: 1e6 });
      damageEnemy(run, e, 10, false);
      expect(run.ult.charge).toBe(0);
      for (let i = 0; i < 20; i++) damageEnemy(run, e, 10, true);
      expect(run.ult.charge).toBeCloseTo(rank === 0 ? 0 : 20 * R.static[0]);
    }
    // Full, it holds.
    const full = behaviour('static', 1);
    full.ult.charge = 1;
    damageEnemy(full, body(full, { hp: 1e6, maxHp: 1e6 }), 10, true);
    expect(full.ult.charge).toBe(1);
  });
});
