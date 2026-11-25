import { Rng } from '../../core/rng';
import { SpatialGrid } from '../../core/spatialGrid';
import { BALANCE } from '../../content/balance';
import { AURA_BY_ID, ENEMIES, ENEMY_BY_ID } from '../../content/enemies';
import { BOSS_BY_ID } from '../../content/bosses';
import type { EnemyVerb } from '../../content/types';
import type { Enemy, RunState } from '../state';
import { inLight } from '../../content/arena';
import { hurtTower } from './tower';
import { runRegion, spawnEnemy, swallow, waveHp } from './waves';
import { ruleLoad, turnable } from '../strata';
import { damageEnemy } from './combat';
import { giantSize, laneStep, orbitShare, orbitStep, tollFactor, towPartner, untow, wakeRule } from './wake';

/**
 * Rebuilt from scratch every step, so it carries nothing between steps and
 * is not part of the run's state.
 */
const grid = new SpatialGrid<Enemy>(64);
const nearCells: (readonly Enemy[])[] = [];
/**
 * Squared distances past `(r1 + r2)² × this` cannot overlap: a cheap test
 * ahead of `Math.hypot`, far wider than any rounding gap between the two, so
 * the pairs that reach the exact test, and its answers, are unchanged.
 */
const OVERLAP_SLACK = 1 + 1e-9;
/** The largest body radius, so a small body's query still finds a big neighbour. */
const MAX_RADIUS = Math.max(...ENEMIES.map((d) => d.radius)) * BALANCE.elites.scale;
/** The types that trample (plans/late-game/12 §4.4): every step looks for them, so the look is one set lookup a body. */
const TRAMPLERS: ReadonlySet<string> = new Set(ENEMIES.filter((d) => d.verb.kind === 'trample').map((d) => d.id));
/** The types that never slide or tow: a Floe (plans/late-game/12 §4.3). */
const SLABS: ReadonlySet<string> = new Set(ENEMIES.filter((d) => d.verb.kind === 'slab').map((d) => d.id));
/** The types that ride a host (a Tick, §4.4). */
const RIDERS: ReadonlySet<string> = new Set(ENEMIES.filter((d) => d.verb.kind === 'ride').map((d) => d.id));

/** True while a body is out of reach: under the water, phased out, under the ground, or riding a giant. */
export function isHidden(run: RunState, e: Enemy): boolean {
  return e.hiddenUntil > run.time || e.under || e.riding > 0;
}

/** Where a body stops walking: the wall, a ranged body's standoff, or a boss's (and its court's) post. */
function stopDistance(run: RunState, e: Enemy): number {
  const wall = run.stats.radius + e.radius;
  const boss = e.boss ?? (e.court && run.boss ? run.boss.id : null);
  if (boss) return run.boss?.enraged ? wall : Math.max(wall, BOSS_BY_ID[boss].standoff);
  const verb = ENEMY_BY_ID[e.type].verb;
  switch (verb.kind) {
    case 'ranged':
    case 'summon':
    case 'silence':
    case 'ward':
    case 'tide':
    case 'conduct':
    case 'squall':
      return Math.max(wall, verb.standoff);
    default:
      return wall;
  }
}

/** True while a slowed body is held by Anchor Stone (§9): it can neither charge nor blink. */
function anchored(run: RunState, e: Enemy): boolean {
  return (run.behaviours.anchor ?? 0) > 0 && e.slowUntil > run.time && e.slow > 0;
}

/**
 * Elite auras (§4.3), recomputed each step: Haste speeds it and its
 * neighbours, Regen heals them, Shield halves the damage its neighbours take.
 * A Wardstone's ward (§9) shields its neighbours the same way.
 */
function applyAuras(run: RunState, dt: number): void {
  for (const e of run.enemies) {
    e.buffSpeed = 1;
    e.buffShield = 1;
    // The Wake's per-step auras (plans/late-game/12 §6).
    e.buffOrbit = 1;
    e.braced = false;
    e.grounded = false;
  }
  const E = BALANCE.elites;
  for (const src of run.enemies) {
    if (!src.alive || src.boss || src.court) continue;
    const verb = ENEMY_BY_ID[src.type].verb;
    // A Herdkeeper (plans/late-game/12 §4.4) wards as it walks, as a Wardstone does from its post.
    if ((verb.kind !== 'ward' && verb.kind !== 'herd') || src.hiddenUntil > run.time) continue;
    const r2 = verb.radius * verb.radius;
    for (const e of run.enemies) {
      if (e === src || !e.alive || (e.x - src.x) ** 2 + (e.y - src.y) ** 2 > r2) continue;
      e.buffShield = Math.min(e.buffShield, verb.shield);
    }
  }
  for (const src of run.enemies) {
    if (!src.alive || !src.aura) continue;
    const aura = src.aura;
    // A Wraith (N3) phases on its own clock, like a Phantom's.
    if (aura === 'wraith') {
      src.auraTimer -= dt;
      if (src.auraTimer <= 0) {
        src.auraTimer += E.wraith.cycle;
        src.hiddenUntil = run.time + E.wraith.hidden;
      }
    }
    const r2 = AURA_BY_ID[aura].radius ** 2;
    if (r2 === 0) continue;
    for (const e of run.enemies) {
      if (!e.alive || (e.x - src.x) ** 2 + (e.y - src.y) ** 2 > r2) continue;
      switch (aura) {
        case 'haste':
          e.buffSpeed = Math.max(e.buffSpeed, E.haste);
          break;
        case 'regen':
          e.hp = Math.min(e.maxHp, e.hp + e.maxHp * E.regen * dt);
          break;
        case 'shield':
          if (e !== src) e.buffShield = Math.min(e.buffShield, E.shield);
          break;
        case 'split':
        case 'vengeful':
        case 'fog':
        case 'mirrored':
        case 'molten':
        case 'wraith':
        case 'hungering':
          break;
        // The Wake's own (plans/late-game/12 §6).
        case 'resonant':
          e.buffSpeed = Math.max(e.buffSpeed, E.resonant);
          break;
        case 'tidal':
          e.buffOrbit = Math.max(e.buffOrbit, E.tidal);
          break;
        case 'anchored':
          e.braced = true;
          break;
        case 'charged':
          e.grounded = true;
          break;
        case 'towering':
          // Radius 0: it acts on hits, in `damageEnemy`.
          break;
        default: {
          const exhaustive: never = aura;
          return exhaustive;
        }
      }
    }
  }
}

/**
 * Enemies walk straight at the tower, stop at its wall (or their standoff),
 * and act: walkers hit the wall on their attack interval, Spitters lob shots,
 * Menders heal (§4.3). A stunned or submerged body does nothing.
 */
export function tickEnemies(run: RunState, dt: number): void {
  applyAuras(run, dt);
  // The Toll (plans/late-game/12 §4.1), read once a step; null outside the Bell Marches.
  const toll = run.wake?.toll ? wakeRule(run, 'toll') : null;
  // The Orbit (§4.2), likewise; null outside the Orrery.
  const orbit = run.wake?.orbit ? wakeRule(run, 'orbit') : null;
  const lockRank = run.behaviours['tidal-lock'] ?? 0;
  const lock = lockRank > 0 ? 1 - BALANCE.relics.tidalLock[Math.min(lockRank, BALANCE.relics.tidalLock.length) - 1] : 1;
  const lockR2 = (run.stats.range / 2) ** 2;
  // Glide (§4.3), likewise; null outside the Frozen Sea.
  const glide = wakeRule(run, 'glide');
  // Indexed: what a Summoner calls this step walks from the next.
  const n = run.enemies.length;
  for (let i = 0; i < n; i++) {
    const e = run.enemies[i];
    // A plate rides on its boss (`boss.ts` moves it); it neither walks nor acts.
    if (e.plate) continue;
    e.px = e.x;
    e.py = e.y;
    e.moving = false;
    if (!e.alive) continue;
    // On the ice (§4.3) a pushed body slides, stunned or not, and neither walks nor hits until it stops.
    if (glide && (e.slideX !== 0 || e.slideY !== 0)) {
      slide(run, e, glide.rule.friction, dt);
      continue;
    }
    // A Sledge's load is pushed, not walked: `placeTowed` sets it down ahead of its Sledge.
    if (e.towedBy !== 0) continue;
    if (e.stunnedUntil > run.time) continue;
    // A submerged boss holds still; a phased or buried body walks on.
    if (e.boss && isHidden(run, e)) continue;
    const verb = e.boss || e.court ? null : ENEMY_BY_ID[e.type].verb;
    if (verb && e.heading > 0) before(run, e, verb, dt);
    // A Tick on its host neither walks nor acts: `seatRiders` carries it (plans/late-game/12 §4.4).
    if (e.riding > 0) continue;
    // Walking out (plans/late-game/08): a fleeing Lurker, an inverted body, one a Tidecaller turned.
    if (e.heading < 0) {
      walkOut(run, e, verb, dt);
      continue;
    }

    const d = Math.hypot(e.x, e.y);
    const stop = stopDistance(run, e);
    // An enraged boss walks through frost too: a fight it can't lose must still end (§4.3).
    const furious = e.boss !== null && run.boss?.enraged === true;
    const slow = e.slowUntil > run.time && !furious ? 1 - e.slow : 1;
    // A Ram mid-charge (§9) runs at its charge's pace.
    const dash = verb?.kind === 'charge' && e.dashUntil > run.time ? verb.speed : 1;
    if (d > stop + 1e-6) {
      // Between tolls it stands where it is: mid-field, never the wall's branch.
      const bell = toll ? tollFactor(run, e, verb, toll) : 1;
      if (bell === 0) continue;
      // Tidal Lock (plans/late-game/12 §8.9): close in, it wades.
      const held = lock < 1 && !e.boss && !e.court && e.x * e.x + e.y * e.y <= lockR2 ? lock : 1;
      const len = e.speed * e.buffSpeed * e.fury * slow * dash * bell * held * dt;
      // A Moon laps its lane before it closes in (§4.2).
      if (verb?.kind === 'lane' && laneStep(run, e, verb, len, d)) {
        e.moving = len > 0;
        e.inContact = false;
        continue;
      }
      const lane = verb?.kind === 'lane' && e.lane < verb.sweep ? Math.max(stop, verb.radius) : stop;
      // The Orbit (§4.2) turns the step sideways; elsewhere `k` is 0 and it walks straight in.
      const stepLen = orbitStep(run, e, orbit ? orbitShare(run, e, verb, orbit) : 0, len, d, lane);
      e.moving = stepLen > 0;
      const wall = run.stats.radius + e.radius;
      e.inContact = stop <= wall && d - stepLen <= stop + 1e-6;
      // The first hit lands a beat after arrival, not on the arrival frame.
      if (e.inContact) e.attackTimer = e.attackInterval * 0.5;
      continue;
    }
    // A Squallcaller (plans/late-game/12 §4.5) lobs shots as a Spitter does, and each brings the storm sooner.
    if (verb?.kind === 'ranged' || verb?.kind === 'squall') {
      e.actTimer -= dt;
      if (e.actTimer <= 0) {
        e.actTimer += verb.interval;
        const k = verb.shotSpeed / (d || 1);
        run.shots.push({ x: e.x, y: e.y, px: e.x, py: e.y, vx: -e.x * k, vy: -e.y * k, damage: e.damage * e.fury, life: BALANCE.shots.life });
        run.events.push({ kind: 'shot', x: e.x, y: e.y });
        if (verb.kind === 'squall' && run.wake?.storm) run.wake.storm.next -= verb.hasten;
      }
      continue;
    }
    if (verb?.kind === 'summon') {
      summon(run, e, verb, dt);
      continue;
    }
    if (verb?.kind === 'silence') {
      silence(run, e, verb, dt);
      continue;
    }
    // A Wardstone stands off and wards, a Tidecaller turns the tide; neither touches the wall.
    if (verb?.kind === 'ward' || verb?.kind === 'tide') continue;
    // A Conductor stands and conducts (plans/late-game/12 §4.5): it never touches the wall.
    if (verb?.kind === 'conduct') continue;
    if (e.court) continue;
    if (e.boss && !run.boss?.enraged) continue;
    // Phased out, it can't touch the wall either.
    if (e.hiddenUntil > run.time) continue;
    if (!e.inContact) {
      // Reached the wall without walking there (shoved by the crowd): the
      // first hit still waits a beat, as it does for a body that walked in.
      e.inContact = true;
      e.attackTimer = e.attackInterval * 0.5;
    }
    e.attackTimer -= dt;
    if (e.attackTimer <= 0) {
      e.attackTimer += e.attackInterval;
      hurtTower(run, e.damage * e.fury, e.x, e.y, e, 'contact');
      if (verb?.kind === 'leech' && run.ult.charge > 0) {
        run.ult.charge = Math.max(0, run.ult.charge - verb.drain);
        run.events.push({ kind: 'drain', x: e.x, y: e.y });
      }
    }
  }
  placeTowed(run);
  seatRiders(run);
}

/**
 * One step of a slide (plans/late-game/12 §4.3): the body coasts on its
 * velocity, which decays at the rule's friction and ends below
 * `glide.min`. It never slides inside its stop.
 */
function slide(run: RunState, e: Enemy, friction: number, dt: number): void {
  e.x += e.slideX * dt;
  e.y += e.slideY * dt;
  const keep = Math.exp(-friction * dt);
  e.slideX *= keep;
  e.slideY *= keep;
  if (Math.hypot(e.slideX, e.slideY) < BALANCE.wake.glide.min) {
    e.slideX = 0;
    e.slideY = 0;
  }
  const d = Math.hypot(e.x, e.y) || 1;
  const stop = stopDistance(run, e);
  if (d < stop) {
    e.x = (e.x / d) * stop;
    e.y = (e.y / d) * stop;
    e.slideX = 0;
    e.slideY = 0;
  }
  e.moving = true;
  e.inContact = false;
}

/**
 * A Sledge latches (§4.3): the nearest body just ahead of it, between it and
 * the tower, within `reach` of touching, that nothing tows or rides.
 */
function latch(run: RunState, s: Enemy, reach: number): void {
  const ds = s.x * s.x + s.y * s.y;
  let best: Enemy | null = null;
  let bestD = Infinity;
  for (const o of run.enemies) {
    if (o === s || !turnable(o) || o.towedBy !== 0 || o.towing !== 0 || o.riding !== 0 || o.heading < 0) continue;
    if (SLABS.has(o.type) || RIDERS.has(o.type) || isHidden(run, o)) continue;
    if (o.x * o.x + o.y * o.y >= ds) continue;
    const gap = s.radius + o.radius + reach;
    const d = (o.x - s.x) ** 2 + (o.y - s.y) ** 2;
    if (d > gap * gap || d >= bestD) continue;
    bestD = d;
    best = o;
  }
  if (!best) return;
  s.towing = best.id;
  best.towedBy = s.id;
  best.inContact = false;
}

/**
 * Each load ahead of its Sledge (§4.3), touching it on the tower's side. A
 * load whose Sledge is gone, or that has reached its own stop, is let go and
 * walks on, hits and is shoved as any body.
 */
function placeTowed(run: RunState): void {
  for (const o of run.enemies) {
    if (o.towedBy === 0 || !o.alive) continue;
    const s = towPartner(run, o);
    if (!s || !s.alive) {
      untow(run, o);
      continue;
    }
    const sd = Math.hypot(s.x, s.y) || 1;
    const want = sd - (s.radius + o.radius);
    const stop = stopDistance(run, o);
    const at = Math.max(want, stop);
    o.x = (s.x / sd) * at;
    o.y = (s.y / sd) * at;
    o.moving = s.moving;
    if (want <= stop + 1e-6) untow(run, o);
  }
}

/**
 * Glide's impacts (plans/late-game/12 §4.3): a sliding body that touches
 * another hits both, by its speed, its mass and its wave's HP, and hands on
 * part of its velocity. A Floe takes no velocity and hits back `shatter` ×
 * as hard. One impact per slider per cooldown. Called after
 * `separateEnemies`, whose grid it reuses.
 */
export function glideImpacts(run: RunState): void {
  const glide = wakeRule(run, 'glide');
  if (!glide) return;
  const G = BALANCE.wake.glide;
  const region = runRegion(run);
  // Widened by a small body's radius, for the separation's push since the grid was built.
  const reach = 2 * MAX_RADIUS;
  const n = run.enemies.length;
  for (let i = 0; i < n; i++) {
    const s = run.enemies[i];
    if (!s.alive || (s.slideX === 0 && s.slideY === 0) || run.time - s.impactAt < G.cooldown || isHidden(run, s)) continue;
    const o = struck(run, s, reach);
    if (!o) continue;
    const speed = Math.min(Math.hypot(s.slideX, s.slideY), G.cap);
    const hit = glide.rule.impact * (speed / 100) * s.mass * waveHp(region, s.wave);
    const verb = ENEMY_BY_ID[o.type].verb;
    const slab = verb.kind === 'slab';
    damageEnemy(run, o, hit, false, 'impact');
    damageEnemy(run, s, verb.kind === 'slab' ? hit * verb.shatter : hit, false, 'impact');
    if (!slab && !o.braced) {
      o.slideX += s.slideX * G.transfer;
      o.slideY += s.slideY * G.transfer;
      o.inContact = false;
    }
    s.slideX *= 1 - G.transfer;
    s.slideY *= 1 - G.transfer;
    s.impactAt = run.time;
    run.events.push({ kind: 'impact', x: (s.x + o.x) / 2, y: (s.y + o.y) / 2, shatter: slab });
  }
}

/**
 * The first body a slider `s` overlaps ahead of it (§4.3): a slider strikes
 * only what lies the way it slides, so what it just hit never strikes back.
 * Never a boss's body, a rider, one out of reach, or its own Sledge or load.
 */
function struck(run: RunState, s: Enemy, reach: number): Enemy | null {
  nearCells.length = 0;
  grid.cellsNear(s.x, s.y, s.radius + reach, nearCells);
  for (const cell of nearCells) {
    for (const o of cell) {
      if (o === s || !o.alive || o.boss || o.court || o.plate || o.riding > 0 || isHidden(run, o)) continue;
      if (o.id === s.towing || o.id === s.towedBy) continue;
      const dx = o.x - s.x;
      const dy = o.y - s.y;
      const min = s.radius + o.radius;
      if (dx * dx + dy * dy >= min * min || dx * s.slideX + dy * s.slideY <= 0) continue;
      return o;
    }
  }
  return null;
}

/**
 * Ticks on their hosts (plans/late-game/12 §4.4): each sits on its host's
 * tower-facing side; when the host is gone it leaps off where the host stood,
 * and from then on walks as any body.
 */
function seatRiders(run: RunState): void {
  for (const e of run.enemies) {
    if (!e.alive || e.riding <= 0) continue;
    const host = run.enemies.find((o) => o.id === e.riding);
    if (!host || !host.alive) {
      e.riding = -1;
      if (host) {
        e.x = e.px = host.x;
        e.y = e.py = host.y;
      }
      e.inContact = false;
      run.events.push({ kind: 'hop', x: e.x, y: e.y });
      continue;
    }
    const seat = host.radius * BALANCE.wake.giants.seat;
    const d = Math.hypot(host.x, host.y) || 1;
    e.px = host.px - (host.px / (Math.hypot(host.px, host.py) || 1)) * seat;
    e.py = host.py - (host.py / (Math.hypot(host.px, host.py) || 1)) * seat;
    e.x = host.x - (host.x / d) * seat;
    e.y = host.y - (host.y / d) * seat;
    e.moving = host.moving;
  }
}

/** A Tick looking for a ride (§4.4): the nearest giant within reach that no other Tick rides. */
function mount(run: RunState, e: Enemy, reach: number): void {
  const r2 = reach * reach;
  const min = BALANCE.wake.giants.host;
  let best: Enemy | null = null;
  let bestD = r2;
  for (const o of run.enemies) {
    if (!o.alive || o === e || o.boss || o.court || o.plate || o.radius < min || RIDERS.has(o.type) || isHidden(run, o)) continue;
    const d = (o.x - e.x) ** 2 + (o.y - e.y) ** 2;
    if (d > bestD) continue;
    if (run.enemies.some((t) => t.alive && t.riding === o.id)) continue;
    bestD = d;
    best = o;
  }
  if (best) e.riding = best.id;
}

/**
 * Titans trample (plans/late-game/12 §4.4): each swallows any smaller body
 * it overlaps, and grows by its HP. No kill, no pay. Called after
 * `separateEnemies`, whose grid it reuses (positions a push old at most).
 */
export function trampleAll(run: RunState): void {
  if (!run.enemies.some((t) => t.alive && TRAMPLERS.has(t.type))) return;
  for (const t of run.enemies) {
    if (!t.alive || t.boss || t.court || !TRAMPLERS.has(t.type) || isHidden(run, t)) continue;
    const verb = ENEMY_BY_ID[t.type].verb;
    if (verb.kind !== 'trample') continue;
    const under = t.radius * verb.smaller;
    nearCells.length = 0;
    // Wider than the overlap by a small body's radius, for the separation's push since the grid was built.
    grid.cellsNear(t.x, t.y, t.radius + under + MAX_RADIUS, nearCells);
    for (const cell of nearCells) {
      for (const o of cell) {
        if (!o.alive || o === t || o.radius >= under) continue;
        if (o.boss || o.court || o.plate || o.keeper || o.riding > 0) continue;
        const min = t.radius + o.radius;
        if ((o.x - t.x) ** 2 + (o.y - t.y) ** 2 >= min * min) continue;
        swallow(run, o);
        t.hp += o.hp;
        t.maxHp += o.hp;
      }
    }
  }
}

/** What a verb does before its body walks: heal, phase, surface, blink. */
function before(run: RunState, e: Enemy, verb: EnemyVerb, dt: number): void {
  switch (verb.kind) {
    case 'heal':
      mend(run, e, verb, dt);
      return;
    case 'phase':
      e.actTimer -= dt;
      if (e.actTimer <= 0) {
        e.actTimer += verb.cycle;
        e.hiddenUntil = run.time + verb.hidden;
      }
      return;
    case 'burrow':
      // Glasswright (N6): they break the surface further out.
      if (e.under && Math.hypot(e.x, e.y) <= verb.surface * (run.behaviours['set-wastes'] ? BALANCE.sets.wastesSurface : 1)) {
        e.under = false;
        run.events.push({ kind: 'surface', x: e.x, y: e.y });
      }
      return;
    case 'blink': {
      // Slowed, its next jump comes later: frost is an answer (§11.1).
      const slow = e.slowUntil > run.time ? 1 - e.slow : 1;
      e.actTimer -= dt * slow;
      if (e.actTimer > 0 || anchored(run, e)) return;
      e.actTimer += verb.interval;
      const d = Math.hypot(e.x, e.y);
      const room = d - stopDistance(run, e) - BALANCE.foes.blinkMargin;
      if (room <= 0) return;
      const jump = Math.min(verb.distance, room);
      const fx = e.x;
      const fy = e.y;
      e.x -= (e.x / d) * jump;
      e.y -= (e.y / d) * jump;
      e.px = e.x;
      e.py = e.y;
      run.events.push({ kind: 'blink', x: fx, y: fy, tx: e.x, ty: e.y });
      return;
    }
    case 'retreat':
      // A Lurker (plans/late-game/08): hurt past `below`, it turns for the dark, once.
      if (!e.fled && e.hp < e.maxHp * verb.below) {
        e.heading = -1;
        e.inContact = false;
      }
      return;
    case 'tide':
      tide(run, e, verb, dt);
      return;
    case 'charge': {
      // Slowed, it winds up more slowly and charges less far: frost and knockback answer it (§9).
      const slow = e.slowUntil > run.time ? 1 - e.slow : 1;
      if (e.dashUntil > run.time) return;
      e.actTimer -= dt * slow;
      if (e.actTimer > 0 || anchored(run, e)) return;
      e.actTimer += verb.interval;
      e.dashUntil = run.time + verb.seconds * slow;
      run.events.push({ kind: 'charge', x: e.x, y: e.y });
      return;
    }
    case 'walker':
    case 'split':
    case 'ranged':
    case 'shield':
    case 'shards':
    case 'explode':
    case 'leech':
    case 'summon':
    case 'silence':
    case 'chorus':
    case 'carapace':
    case 'ward':
    case 'devour':
    // The Wake's (plans/late-game/12 §5): nothing before the walk.
    case 'ring':
    case 'sleepwalk':
    case 'offbeat':
    case 'streak':
    case 'lane':
    case 'slab':
    case 'trample':
    case 'herd':
    case 'grounded':
    case 'conduct':
    case 'squall':
      return;
    case 'sledge':
      // Latch the body ahead (§4.3); a load gone, it looks again.
      if (e.towing !== 0 && !towPartner(run, e)?.alive) untow(run, e);
      if (e.towing === 0) latch(run, e, verb.reach);
      return;
    case 'ride':
      // Looking for a host (§4.4); once it has ridden (−1), it walks.
      if (e.riding === 0) mount(run, e, verb.reach);
      return;
    default: {
      const exhaustive: never = verb;
      return exhaustive;
    }
  }
}

/**
 * A body walking out (plans/late-game/08 §4.2, §5.1): straight away from the
 * tower, slowed by frost like any walk. Fully dark, a Lurker that has not
 * yet fled heals whole and turns back; anything else escapes.
 */
function walkOut(run: RunState, e: Enemy, verb: EnemyVerb | null, dt: number): void {
  e.inContact = false;
  const d = Math.hypot(e.x, e.y) || 1;
  const slow = e.slowUntil > run.time ? 1 - e.slow : 1;
  const pace = verb?.kind === 'retreat' ? verb.pace : 1;
  const len = e.speed * e.buffSpeed * e.fury * slow * pace * dt;
  e.x += (e.x / d) * len;
  e.y += (e.y / d) * len;
  e.moving = len > 0;
  if (inLight(e.x, e.y, e.radius, run.stats.light, run.arena)) return;
  if (verb?.kind === 'retreat' && !e.fled) {
    e.hp = e.maxHp;
    e.heading = 1;
    e.fled = true;
    return;
  }
  escape(run, e);
}

/** A body got away into the dark: gone, with no kill and no pay, and the ultimate drained. */
function escape(run: RunState, e: Enemy): void {
  e.alive = false;
  if (run.current && e.wave === run.current.n) run.current.alive--;
  const drain = ruleLoad(run).inversion?.drain ?? BALANCE.strata.inversion.drain;
  run.ult.charge = Math.max(0, run.ult.charge - drain);
  run.events.push({ kind: 'escape', x: e.x, y: e.y });
}

/** A Tidecaller's turn (plans/late-game/08 §5.2): every walking body near it heads the other way. */
function tide(run: RunState, e: Enemy, verb: Extract<EnemyVerb, { kind: 'tide' }>, dt: number): void {
  e.actTimer -= dt;
  if (e.actTimer > 0) return;
  e.actTimer += verb.interval;
  const r2 = verb.radius * verb.radius;
  let turned = false;
  for (const o of run.enemies) {
    if (o === e || !turnable(o) || isHidden(run, o)) continue;
    if ((o.x - e.x) ** 2 + (o.y - e.y) ** 2 > r2) continue;
    o.heading = -o.heading;
    o.inContact = false;
    turned = true;
  }
  if (turned) run.events.push({ kind: 'tide', x: e.x, y: e.y, radius: verb.radius });
}

/** A Summoner at its post calls its servants beside it, while the field has room. */
function summon(run: RunState, e: Enemy, verb: Extract<EnemyVerb, { kind: 'summon' }>, dt: number): void {
  e.actTimer -= dt;
  if (e.actTimer > 0) return;
  e.actTimer += verb.interval;
  const region = runRegion(run);
  for (let k = 0; k < verb.count && run.enemies.length < BALANCE.maxEnemies; k++) {
    const a = Math.atan2(e.y, e.x) + (k - (verb.count - 1) / 2) * 0.35;
    const r = e.radius * 1.5;
    spawnEnemy(run, region, verb.enemy, e.wave, e.x + Math.cos(a) * r, e.y + Math.sin(a) * r);
  }
  run.events.push({ kind: 'rise', x: e.x, y: e.y });
}

/**
 * A Harbinger at its post silences one of the tower's weapons that still
 * fires, never the last one. A tower with a single weapon (Specialist) has
 * that weapon's fire halved for as long instead.
 */
function silence(run: RunState, e: Enemy, verb: Extract<EnemyVerb, { kind: 'silence' }>, dt: number): void {
  e.actTimer -= dt;
  if (e.actTimer > 0) return;
  e.actTimer += verb.interval;
  const live = run.weapons.filter((w) => w.silencedUntil <= run.time);
  if (live.length === 0) return;
  if (run.weapons.length === 1) {
    const w = run.weapons[0];
    w.dampedUntil = run.time + verb.seconds;
    run.events.push({ kind: 'silence', x: e.x, y: e.y, weapon: w.id });
    return;
  }
  if (live.length === 1) return;
  const w = Rng.wrap(run.streams.foes).pick(live);
  w.silencedUntil = run.time + verb.seconds;
  run.events.push({ kind: 'silence', x: e.x, y: e.y, weapon: w.id });
}

/** A Mender's pulse: every other body near it is healed a share of its Max HP. */
function mend(run: RunState, e: Enemy, verb: { radius: number; interval: number; fraction: number }, dt: number): void {
  e.actTimer -= dt;
  if (e.actTimer > 0) return;
  e.actTimer += verb.interval;
  const r2 = verb.radius * verb.radius;
  let healed = false;
  for (const o of run.enemies) {
    if (o === e || !o.alive || o.hp >= o.maxHp) continue;
    if ((o.x - e.x) ** 2 + (o.y - e.y) ** 2 > r2) continue;
    o.hp = Math.min(o.maxHp, o.hp + o.maxHp * verb.fraction);
    healed = true;
  }
  if (healed) run.events.push({ kind: 'mend', x: e.x, y: e.y, radius: verb.radius });
}

/**
 * Bodies push apart so a crowd reads as a crowd, not one blob. At the wall
 * the push is tangential only: bodies spread around the ring but never leave
 * it, so separation changes how a wave looks, not how hard it hits. A boss
 * holds its ground: it shoves, but is never shoved.
 */
export function separateEnemies(run: RunState): void {
  const strength = BALANCE.separation;
  grid.rebuild(run.enemies);
  const reach = run.stats.radius;
  // Under Giants (plans/late-game/12 §4.4) every body grows, so the search widens with them.
  const biggest = Math.max(MAX_RADIUS * giantSize(run), run.boss ? BOSS_BY_ID[run.boss.id].radius : 0);
  for (const e of run.enemies) {
    if (!e.alive || e.boss || e.court || e.plate || isHidden(run, e)) continue;
    // Two bodies overlap within the sum of their radii, so look that far:
    // a Runner must feel a Brute it touches, not only the reverse. This is
    // the hottest loop in the sim, so it walks the grid's cells itself
    // rather than collecting a `query` and walking that again.
    const range = e.radius + biggest;
    const range2 = range * range;
    nearCells.length = 0;
    grid.cellsNear(e.x, e.y, range, nearCells);
    let fx = 0;
    let fy = 0;
    for (const cell of nearCells) {
      for (const o of cell) {
        if (!o.alive || o === e) continue;
        let dx = e.x - o.x;
        let dy = e.y - o.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > range2) continue;
        const min = e.radius + o.radius;
        if (d2 >= min * min * OVERLAP_SLACK || isHidden(run, o)) continue;
        let d = Math.hypot(dx, dy);
        if (d >= min) continue;
        if (d < 1e-6) {
          // Exactly stacked: split them by id so the result is deterministic.
          dx = e.id < o.id ? 1 : -1;
          dy = 0;
          d = 1;
        }
        const overlap = (min - d) / min;
        fx += (dx / d) * overlap;
        fy += (dy / d) * overlap;
      }
    }
    if (fx === 0 && fy === 0) continue;
    const dist = Math.hypot(e.x, e.y) || 1;
    const rx = e.x / dist;
    const ry = e.y / dist;
    if (e.inContact) {
      // Keep only the tangential part, then snap back onto the wall.
      const radial = fx * rx + fy * ry;
      fx -= radial * rx;
      fy -= radial * ry;
    }
    e.x += fx * e.radius * strength;
    e.y += fy * e.radius * strength;
    const stop = reach + e.radius;
    const nd = Math.hypot(e.x, e.y) || 1;
    if (e.inContact || nd < stop) {
      e.x = (e.x / nd) * stop;
      e.y = (e.y / nd) * stop;
    }
  }
}

/** Drop dead enemies from the list, keeping order (the sim's iteration order is part of determinism). */
export function sweepEnemies(run: RunState): void {
  let w = 0;
  const list = run.enemies;
  for (let i = 0; i < list.length; i++) {
    if (list[i].alive) list[w++] = list[i];
  }
  list.length = w;
}
