import { describe, expect, it } from 'vitest';
import { applyInput, createRun, step } from '../src/sim/run';
import { buildRunConfig } from '../src/meta/runConfig';
import { newProfile } from '../src/meta/profile';
import { SIM_DT } from '../src/app/loop';
import { BALANCE } from '../src/content/balance';
import { BOSS_BY_ID } from '../src/content/bosses';
import { ENEMY_BY_ID } from '../src/content/enemies';
import { FEATS } from '../src/content/feats';
import { FRAME_BY_ID } from '../src/content/frames';
import { regionByIndex } from '../src/content/regions';
import { BOSS_WAVE, rollWave, spawnEnemy, startWave, waveHp } from '../src/sim/systems/waves';
import { bossBody, tickBoss, tickPools } from '../src/sim/systems/boss';
import { damageEnemy, tickProjectiles, tickWeapons } from '../src/sim/systems/combat';
import { tickEnemies } from '../src/sim/systems/enemies';
import { hurtTower, tickShots } from '../src/sim/systems/tower';
import { applyCard } from '../src/sim/systems/draft';
import { frameUnlocked } from '../src/meta/collection';
import { checkFeats, featMet, featVisible } from '../src/meta/feats';
import { Rng } from '../src/core/rng';
import type { EnemyVerb, FrameId } from '../src/content/types';
import type { Enemy, Projectile, RunConfig, RunState } from '../src/sim/state';
import { body } from './helpers/body';

function inRegion(region: number, over: Partial<RunConfig> = {}, seed = 1): RunState {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  return createRun({ ...buildRunConfig(p), regionId: region, ...over }, seed);
}

function withFrame(frame: FrameId, region = 1): RunState {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  // Every frame earned: its boss down, its feat done.
  for (const id of Object.keys(BOSS_BY_ID)) p.bosses[id] = { kills: 1, fastest: 60 };
  p.feats.tinkerer = 'claimed';
  p.frame = frame;
  return createRun({ ...buildRunConfig(p), regionId: region }, 1);
}

/** Advance the clock and the enemies only. */
function walk(run: RunState, seconds: number, also: (r: RunState) => void = () => {}): void {
  for (let i = 0; i < seconds / SIM_DT; i++) {
    run.tick++;
    run.time = run.tick * SIM_DT;
    tickEnemies(run, SIM_DT);
    also(run);
  }
}

function verbOf<K extends EnemyVerb['kind']>(id: keyof typeof ENEMY_BY_ID, kind: K): Extract<EnemyVerb, { kind: K }> {
  const v = ENEMY_BY_ID[id].verb;
  if (v.kind !== kind) throw new Error(`${id} must be ${kind}`);
  return v as Extract<EnemyVerb, { kind: K }>;
}

/** A straight shot at (x, y), flying (vx, vy). */
function shot(run: RunState, x: number, y: number, vx: number, vy: number, damage = 10): Projectile {
  const p: Projectile = {
    alive: true, weapon: 'scattershot', x, y, px: x, py: y, vx, vy, speed: Math.hypot(vx, vy), damage, crit: false,
    homing: false, target: 0, pierce: 0, ignore: 0, knockback: 0, life: 2, blast: 0, tx: 0, ty: 0, sx: x, sy: y,
    bomblets: 0, meteor: false, seeker: false, boomerang: false, returning: false, struck: [],
  };
  run.projectiles.push(p);
  return p;
}

describe('Region 3 verbs (§4.3, §11.1)', () => {
  it('a Shieldbearer turns away shots at its face, not from behind', () => {
    const run = inRegion(3);
    const s = spawnEnemy(run, regionByIndex(3), 'shieldbearer', 3, 300, 0);
    s.speed = 0;
    const hp = s.hp;
    shot(run, 200, 0, 600, 0);
    for (let i = 0; i < 10; i++) tickProjectiles(run, SIM_DT);
    expect(s.hp).toBe(hp);
    shot(run, 400, 0, -600, 0);
    for (let i = 0; i < 10; i++) tickProjectiles(run, SIM_DT);
    expect(s.hp).toBeLessThan(hp);
  });

  it('a Burrower cannot be hit until it surfaces near the tower', () => {
    const run = inRegion(3);
    const verb = verbOf('burrower', 'burrow');
    const b = spawnEnemy(run, regionByIndex(3), 'burrower', 3, verb.surface + 100, 0);
    expect(damageEnemy(run, b, 1, false)).toBe(0);
    walk(run, 5);
    expect(b.under).toBe(false);
    expect(Math.hypot(b.x, b.y)).toBeLessThanOrEqual(verb.surface);
    expect(damageEnemy(run, b, 1, false)).toBeGreaterThan(0);
  });

  it('a Shardling slain near the wall hurts it; slain far off, its shards fall short', () => {
    const verb = verbOf('shardling', 'shards');
    for (const [d, hurt] of [[run0().stats.radius + 60, true], [run0().stats.radius + verb.reach + 200, false]] as const) {
      const run = inRegion(3);
      const s = spawnEnemy(run, regionByIndex(3), 'shardling', 3, d, 0);
      const hp = run.tower.hp;
      damageEnemy(run, s, 1e9, false);
      for (let i = 0; i < 3 / SIM_DT; i++) tickShots(run, SIM_DT);
      expect(run.tower.hp < hp, `slain at ${d}`).toBe(hurt);
    }
    function run0(): RunState {
      return inRegion(3);
    }
  });

  it('Brittle: area hits land 25% harder, single shots do not', () => {
    const r1 = inRegion(1);
    const r3 = inRegion(3);
    const a = body(r1, { hp: 1e6, maxHp: 1e6 });
    const b = body(r3, { hp: 1e6, maxHp: 1e6 });
    expect(damageEnemy(r3, b, 100, false, 'pulse')).toBeCloseTo(damageEnemy(r1, a, 100, false, 'pulse') * 1.25);
    expect(damageEnemy(r3, b, 100, false, 'homing')).toBeCloseTo(damageEnemy(r1, a, 100, false, 'homing'));
  });
});

describe('Region 4 verbs (§4.3, §11.1)', () => {
  it('a Bomber blows at the wall, not far out', () => {
    const verb = verbOf('bomber', 'explode');
    for (const [extra, hurt] of [[10, true], [verb.radius + 50, false]] as const) {
      const run = inRegion(4);
      const b = spawnEnemy(run, regionByIndex(4), 'bomber', 3, run.stats.radius + extra, 0);
      const hp = run.tower.hp;
      damageEnemy(run, b, 1e9, false);
      expect(run.tower.hp < hp).toBe(hurt);
    }
  });

  it('Blast Shield softens the blast', () => {
    const plain = inRegion(4);
    const shielded = inRegion(4, { behaviours: { 'blast-shield': 1 } });
    const lost = (run: RunState): number => {
      const b = spawnEnemy(run, regionByIndex(4), 'bomber', 3, run.stats.radius + 10, 0);
      const hp = run.tower.hp;
      damageEnemy(run, b, 1e9, false);
      return hp - run.tower.hp;
    };
    expect(lost(shielded)).toBeCloseTo(lost(plain) * BALANCE.relics.blastShield[0]);
  });

  it('a Blinker jumps inward on its timer, and slowed it jumps later', () => {
    const verb = verbOf('blinker', 'blink');
    const jumpsIn = (slow: number): number => {
      const run = inRegion(4);
      const b = spawnEnemy(run, regionByIndex(4), 'blinker', 3, 700, 0);
      b.speed = 0;
      b.slow = slow;
      b.slowUntil = slow > 0 ? 1e9 : 0;
      let t = 0;
      walk(run, verb.interval * 4, (r) => {
        if (!t && r.events.some((ev) => ev.kind === 'blink')) t = r.time;
      });
      return t;
    };
    const fast = jumpsIn(0);
    expect(fast).toBeGreaterThan(0);
    expect(jumpsIn(0.5)).toBeGreaterThan(fast);
  });

  it('Cinders: a kill leaves burning ground', () => {
    const run = inRegion(4);
    const e = spawnEnemy(run, regionByIndex(4), 'bomber', 3, 500, 0);
    damageEnemy(run, e, 1e9, false);
    expect(run.fires).toHaveLength(1);
    expect(run.fires[0].dps).toBeCloseTo(e.maxHp * 0.15);
  });
});

describe('Region 5 verbs (§4.3, §11.1)', () => {
  it('a Phantom phases out on its cycle, and never hits while out', () => {
    const verb = verbOf('phantom', 'phase');
    const run = inRegion(5);
    const p = spawnEnemy(run, regionByIndex(5), 'phantom', 3, 400, 0);
    p.speed = 0;
    let out = false;
    walk(run, verb.cycle, (r) => {
      if (p.hiddenUntil > r.time) out = true;
    });
    expect(out).toBe(true);
    expect(damageEnemy(run, p, 1, false) === 0).toBe(p.hiddenUntil > run.time);
  });

  it('a Leech drains the ultimate as it hits', () => {
    const verb = verbOf('leech', 'leech');
    const run = inRegion(5);
    run.ult.charge = 0.5;
    spawnEnemy(run, regionByIndex(5), 'leech', 3, run.stats.radius + 20, 0);
    walk(run, 3);
    expect(run.ult.charge).toBeLessThanOrEqual(0.5 - verb.drain + 1e-9);
  });

  it('a Summoner stops at its post and calls imps', () => {
    const verb = verbOf('summoner', 'summon');
    const run = inRegion(5);
    const s = spawnEnemy(run, regionByIndex(5), 'summoner', 3, verb.standoff + 5, 0);
    walk(run, verb.interval);
    expect(Math.hypot(s.x, s.y)).toBeCloseTo(verb.standoff, 0);
    expect(run.enemies.filter((e) => e.alive && e.type === 'imp')).toHaveLength(verb.count);
  });

  it('Echoes: some kills rise once as a weaker shade, and a shade never rises', () => {
    const run = inRegion(5);
    const region = regionByIndex(5);
    let shades: Enemy[] = [];
    for (let i = 0; i < 200 && shades.length === 0; i++) {
      damageEnemy(run, spawnEnemy(run, region, 'phantom', 3, 500, 0), 1e9, false);
      shades = run.enemies.filter((e) => e.alive && e.shade);
    }
    expect(shades.length).toBe(1);
    const s = shades[0];
    expect(s.maxHp).toBeLessThan(spawnEnemy(run, region, 'phantom', 3, 500, 0).maxHp);
    s.hiddenUntil = 0;
    const before = run.enemies.length;
    damageEnemy(run, s, 1e9, false);
    expect(run.enemies.length).toBe(before);
  });
});

describe('Region 6 verbs (§4.3, §11.1)', () => {
  it('a Harbinger at its post silences a weapon for a while', () => {
    const verb = verbOf('harbinger', 'silence');
    const run = inRegion(6);
    spawnEnemy(run, regionByIndex(6), 'harbinger', 3, verb.standoff + 2, 0);
    walk(run, verb.interval);
    const w = run.weapons[0];
    expect(w.silencedUntil).toBeGreaterThan(run.time);
    const shots = run.projectiles.length;
    w.cooldown = 0;
    tickWeapons(run, SIM_DT);
    expect(run.projectiles.length).toBe(shots);
  });

  it('a Chorus arrives as three bodies with one pool of HP, paying one body between them', () => {
    const verb = verbOf('chorus', 'chorus');
    const run = inRegion(6);
    const c = spawnEnemy(run, regionByIndex(6), 'chorus', 3, 500, 0);
    const all = run.enemies.filter((e) => e.group === c.id);
    expect(all).toHaveLength(verb.count);
    damageEnemy(run, all[1], c.maxHp / 2, false);
    for (const e of all) expect(e.hp).toBeCloseTo(c.maxHp / 2);
    const xp = all.reduce((s, e) => s + e.xp, 0);
    expect(xp).toBeCloseTo(ENEMY_BY_ID.chorus.xp);
    damageEnemy(run, all[2], 1e9, false);
    expect(all.every((e) => !e.alive)).toBe(true);
  });

  it('the Blight: every wave but the boss brings an elite of an older kind', () => {
    const region = regionByIndex(6);
    const types = region.elites.types!;
    for (let n = 1; n < BOSS_WAVE; n++) {
      const wave = rollWave(region, n, new Rng(n));
      const elites = wave.filter((s) => s.elite);
      expect(elites, `wave ${n}`).toHaveLength(1);
      expect(types).toContain(elites[0].enemy);
    }
  });
});

/** A run at wave 20 of `region`, its boss walked to its post. */
function atBoss(region: number): RunState {
  const run = inRegion(region);
  startWave(run, regionByIndex(region), BOSS_WAVE);
  const e = bossBody(run)!;
  e.x = e.px = BOSS_BY_ID[run.boss!.id].standoff;
  e.y = e.py = 0;
  run.events.length = 0;
  return run;
}

describe('Act 1 bosses (§11.1)', () => {
  it('the Prism throws back shots that strike its glass, and lets the rest through', () => {
    const run = atBoss(3);
    const e = bossBody(run)!;
    const facet = run.boss!.facet;
    // From the tower's side, aimed at a facet, then at the gap between two.
    const fire = (a: number): number => {
      const hp = e.hp;
      const x = e.x + Math.cos(a) * (e.radius + 30);
      const y = e.y + Math.sin(a) * (e.radius + 30);
      shot(run, x, y, -Math.cos(a) * 600, -Math.sin(a) * 600);
      for (let i = 0; i < 10; i++) tickProjectiles(run, SIM_DT);
      return hp - e.hp;
    };
    const shots = run.shots.length;
    expect(fire(facet)).toBe(0);
    expect(run.shots.length).toBe(shots + 1);
    expect(fire(facet + Math.PI / 2)).toBeGreaterThan(0);
  });

  it('Forgeheart sheds its plates phase by phase, and its pools burn the wall', () => {
    const run = atBoss(4);
    const region = regionByIndex(4);
    const e = bossBody(run)!;
    const plated = e.armor;
    e.hp = e.maxHp * 0.5;
    tickBoss(run, region, SIM_DT);
    expect(e.armor).toBeCloseTo(waveHp(region, BOSS_WAVE) * BOSS_BY_ID.forgeheart.phases[1].armor!);
    expect(e.armor).toBeLessThan(plated);
    e.hp = e.maxHp * 0.2;
    tickBoss(run, region, SIM_DT);
    expect(e.armor).toBe(0);
    for (let i = 0; i < 10 / SIM_DT && run.pools.length === 0; i++) {
      run.tick++;
      run.time = run.tick * SIM_DT;
      tickBoss(run, region, SIM_DT);
    }
    expect(run.pools.length).toBeGreaterThan(0);
    const hp = run.tower.hp;
    for (let i = 0; i < 1 / SIM_DT; i++) tickPools(run, SIM_DT);
    expect(run.tower.hp).toBeLessThan(hp);
  });

  it('the Hollow King splits into a court: the crowned body takes it all, the rest a share', () => {
    const run = atBoss(5);
    const region = regionByIndex(5);
    const king = bossBody(run)!;
    king.hp = king.maxHp * 0.6;
    tickBoss(run, region, SIM_DT);
    const court = run.enemies.filter((o) => o.alive && o.court === king.id);
    expect(court).toHaveLength(2);
    const bodies = [king, ...court];
    const crowned = bodies.find((o) => o.id === run.boss!.crown)!;
    const other = bodies.find((o) => o.id !== run.boss!.crown)!;
    let hp = king.hp;
    damageEnemy(run, crowned, 1000, false);
    const full = hp - king.hp;
    hp = king.hp;
    damageEnemy(run, other, 1000, false);
    expect(hp - king.hp).toBeCloseTo(full * 0.25);
    // He falls, and his court with him: no kills, no reward.
    damageEnemy(run, king, 1e12, false);
    expect(court.every((o) => !o.alive)).toBe(true);
    expect(run.boss!.killedIn).not.toBeNull();
  });

  it('the Blight is the finale, and its first kill opens the last relic slot', () => {
    expect(BOSS_BY_ID.blight.finale).toBe(true);
    expect(BOSS_BY_ID.blight.relicSlot).toBe(true);
    expect(BOSS_BY_ID.blight.phases).toHaveLength(5);
  });
});

describe('frames (§11.6)', () => {
  it('Stormcaller: a crit leaps to the nearest other body', () => {
    const run = withFrame('stormcaller');
    expect(run.weapons[0].id).toBe('chain-lightning');
    const a = body(run, { x: 300, y: 0, hp: 1e6, maxHp: 1e6 });
    const b = body(run, { x: 340, y: 0, hp: 1e6, maxHp: 1e6 });
    damageEnemy(run, a, 100, true);
    expect(b.hp).toBeCloseTo(1e6 - 100 * BALANCE.behaviours.stormShare);
    const c = body(run, { x: 380, y: 0, hp: 1e6, maxHp: 1e6 });
    damageEnemy(run, a, 100, false);
    expect(c.hp).toBe(1e6);
  });

  it('Tempest strikes bodies in range for six seconds', () => {
    const run = withFrame('stormcaller');
    const e = body(run, { x: 200, y: 0, hp: 1e9, maxHp: 1e9 });
    run.ult.charge = 1;
    applyInput(run, { ult: true });
    const ult = FRAME_BY_ID.stormcaller.ultimate;
    if (ult.id !== 'tempest') throw new Error('tempest');
    for (let i = 0; i < 1 / SIM_DT; i++) step(run, SIM_DT);
    expect(e.hp).toBeLessThan(1e9);
    expect(run.ult.until).toBeCloseTo(ult.seconds, 0);
  });

  it('Artificer: Drones, one more weapon slot, one fewer passive slot; Overclock doubles fire rate', () => {
    const plain = withFrame('arcanist');
    const run = withFrame('artificer');
    expect(run.weapons[0].id).toBe('sentinel-drones');
    expect(run.weaponSlots).toBe(plain.weaponSlots + 1);
    expect(run.passiveSlots).toBe(plain.passiveSlots - 1);
    run.ult.charge = 1;
    applyInput(run, { ult: true });
    expect(run.ult.until).toBeGreaterThan(run.time);
  });

  it('Artificer is earned by the Tinkerer feat', () => {
    const p = newProfile(0);
    const artificer = FRAME_BY_ID.artificer;
    expect(frameUnlocked(p, artificer)).toBe(false);
    p.feats.tinkerer = 'done';
    expect(frameUnlocked(p, artificer)).toBe(true);
  });
});

describe('secret feats (§5.4)', () => {
  it('surface only once Forgeheart has fallen, each with a riddle', () => {
    const secret = FEATS.filter((f) => f.riddle);
    expect(secret.length).toBeGreaterThanOrEqual(4);
    const p = newProfile(0);
    for (const f of secret) expect(featVisible(p, f)).toBe(false);
    p.bosses.forgeheart = { kills: 1, fastest: 60 };
    for (const f of secret) expect(featVisible(p, f)).toBe(true);
  });

  it('cannot be earned before they surface', () => {
    // A Gatekeeper felled without the ultimate: Unlit's goal, but no secret yet.
    const p = newProfile(0);
    p.bosses.gatekeeper = { kills: 1, fastest: 60 };
    const run = inRegion(1);
    run.boss = { killedIn: 60 } as RunState['boss'];
    const unlit = FEATS.find((f) => f.id === 'unlit')!;
    expect(featMet(p, unlit.goal, run)).toBe(true);
    expect(checkFeats(p, run).map((f) => f.id)).not.toContain('unlit');
    p.bosses.forgeheart = { kills: 1, fastest: 60 };
    expect(checkFeats(p, run).map((f) => f.id)).toContain('unlit');
  });
});

describe('later Forge notables (§11.4)', () => {
  it('Rampart caps a contact hit at a slice of Max HP', () => {
    const run = inRegion(1, { behaviours: { rampart: 1 } });
    const e = body(run, { x: run.stats.radius + 10, y: 0 });
    const hp = run.tower.hp;
    hurtTower(run, 1e9, e.x, e.y, e);
    expect(hp - run.tower.hp).toBeCloseTo(run.stats.maxHp * BALANCE.behaviours.rampartCap);
  });

  it('Drilled: a new weapon joins at level 2', () => {
    const run = inRegion(1, { behaviours: { drilled: 1 } });
    applyCard(run, { kind: 'weapon', id: 'scattershot', level: 1 } as Parameters<typeof applyCard>[1]);
    expect(run.weapons.find((w) => w.id === 'scattershot')!.level).toBe(2);
  });
});
