import { Rng } from '../../core/rng';
import { BALANCE } from '../../content/balance';
import { ENEMY_BY_ID } from '../../content/enemies';
import { BOSS_BY_ID } from '../../content/bosses';
import type { BossPattern, EnemyVerb, RegionDef, RegionRule } from '../../content/types';
import type { Enemy, RunState, WakeState } from '../state';
import { pactLoad, ruleSurge } from '../pacts';
import { melt, runRegion, waveDamage } from './waves';
import { bossBody, phasesOf } from './boss';
import { damageEnemy, targetable } from './combat';
import { hurtTower } from './tower';

/**
 * The Wake's rules (plans/late-game/12 §4): their clocks, ticked once a step
 * after the boss acts and before bodies move, and the small read helpers the
 * other systems ask. Outside a Wake region `run.wake` is null and nothing
 * here does anything, so Act 1 plays exactly as before.
 */

/** The rule clocks a run starts with in `region` (§3.2): only the one matching its rule; null outside the Wake. */
export function initWake(region: RegionDef): WakeState | null {
  const rule = region.rule?.effect;
  if (!rule) return null;
  switch (rule.kind) {
    case 'toll':
      return { toll: { next: BALANCE.waves.firstWaveDelay, last: -1e9, pace: 1, interval: rule.every }, orbit: null, storm: null };
    case 'orbit':
      return { toll: null, orbit: { spin: 1, wave: 0 }, storm: null };
    case 'storm':
      return { toll: null, orbit: null, storm: { next: rule.every } };
    case 'glide':
    case 'giants':
    case 'stat':
    case 'areaDamage':
    case 'cinders':
    case 'echoes':
    case 'blight':
      return null;
    default: {
      const exhaustive: never = rule;
      return exhaustive;
    }
  }
}

/** The run's Wake rule of `kind`, with its Blight Surge rank, or null. */
export function wakeRule<K extends RegionRule['kind']>(run: RunState, kind: K): { rule: Extract<RegionRule, { kind: K }>; surge: number } | null {
  const region = runRegion(run);
  const rule = region.rule?.effect;
  if (!rule || rule.kind !== kind) return null;
  return { rule: rule as Extract<RegionRule, { kind: K }>, surge: ruleSurge(pactLoad(run.pacts), region) };
}

/**
 * The Giants rule as it holds in `region` (§4.4): each body's size and HP
 * multipliers with the Blight Surge folded in, and its pay; null outside Giants.
 */
export function giantsOf(run: RunState, region: RegionDef): { size: number; hp: number; reward: number } | null {
  const rule = region.rule?.effect;
  if (rule?.kind !== 'giants') return null;
  const grow = Math.pow(BALANCE.wake.giants.surge, ruleSurge(pactLoad(run.pacts), region));
  return { size: rule.size * grow, hp: rule.hp * grow, reward: rule.reward };
}

/** How much larger the run's bodies grow (§4.4): 1 outside Giants. Neighbour searches widen by it. */
export function giantSize(run: RunState): number {
  return giantsOf(run, runRegion(run))?.size ?? 1;
}

/** A Sledge's load, or a load's Sledge (plans/late-game/12 §4.3); null when it tows nothing and nothing tows it. */
export function towPartner(run: RunState, e: Enemy): Enemy | null {
  const id = e.towing !== 0 ? e.towing : e.towedBy;
  if (id === 0) return null;
  for (const o of run.enemies) if (o.id === id) return o;
  return null;
}

/** Part a Sledge from its load (§4.3): both let go, and the load walks on as any body. */
export function untow(run: RunState, e: Enemy): void {
  const other = towPartner(run, e);
  if (other) {
    other.towing = 0;
    other.towedBy = 0;
  }
  e.towing = 0;
  e.towedBy = 0;
}

/** True when the run wears a Wake relic with a clock of its own (§8.9): the Clapper or the Thunderhead Core. */
export function wakeRelics(run: RunState): boolean {
  return (run.behaviours.clapper ?? 0) > 0 || (run.behaviours['thunder-core'] ?? 0) > 0;
}

/**
 * The Wake's clocks, once a step (§4): the toll, the orbit's spin, the storm,
 * and the Wake relics'.
 */
export function tickWake(run: RunState, region: RegionDef, dt: number): void {
  meltFloes(run);
  if (!run.wake && !wakeRelics(run)) return;
  const wake = run.wake;
  if (wake?.toll) tickToll(run, wake.toll);
  if (wake?.orbit && wake.orbit.wave !== run.wave) {
    // §4.2: a fresh spin each wave, on the Wake's own stream.
    wake.orbit.spin = Rng.wrap(run.streams.wake).chance(0.5) ? 1 : -1;
    wake.orbit.wave = run.wave;
  }
  if (wake?.storm) tickStorm(run, region, wake.storm);
  if ((run.behaviours.clapper ?? 0) > 0) tickClapper(run, dt);
  if ((run.behaviours['thunder-core'] ?? 0) > 0) tickThunderCore(run, dt);
}

/**
 * The Leviathan's cracked Floes are terrain (D-28): nothing aims at one, so
 * each melts at its `meltAt` (set as it cracks), with no kill and no pay.
 * A wave's Floe has none and stays an ordinary body.
 */
function meltFloes(run: RunState): void {
  for (const e of run.enemies) if (e.alive && e.meltAt !== undefined && run.time >= e.meltAt) melt(run, e);
}

/** The Thunderhead's tempest (§7.1): its current phase's `tempest` pattern while it stands, else null. */
export function bossTempest(run: RunState): Extract<BossPattern, { kind: 'tempest' }> | null {
  const b = run.boss;
  if (!b || b.killedIn !== null || !bossBody(run)) return null;
  const p = phasesOf(run, BOSS_BY_ID[b.id])[b.phase].patterns.find((q) => q.kind === 'tempest');
  return p?.kind === 'tempest' ? p : null;
}

/**
 * The storm's clock (§4.5): every `every` s (sooner per Blight Surge rank,
 * and at the tempest's pace), a strike. A Squallcaller's shot pulls `next` in.
 */
function tickStorm(run: RunState, region: RegionDef, st: NonNullable<WakeState['storm']>): void {
  if (run.time < st.next) return;
  const storm = wakeRule(run, 'storm');
  if (!storm) return;
  const tempest = bossTempest(run);
  const pace = Math.pow(BALANCE.wake.storm.surge, storm.surge) * (tempest?.pace ?? 1);
  st.next = run.time + storm.rule.every * pace;
  strike(run, region, storm.rule, tempest?.forks ?? 1);
}

/** True while a Conductor stands (§4.5): alive and in the open, not under or phased out. */
function conducting(run: RunState): boolean {
  for (const e of run.enemies) {
    if (!e.alive || e.boss || e.court || e.hiddenUntil > run.time || e.under || e.riding > 0) continue;
    if (ENEMY_BY_ID[e.type]?.verb.kind === 'conduct') return true;
  }
  return false;
}

/**
 * Up to `n` bodies the lightning can find (§4.5): targetable, never a boss,
 * its court or plates (D-19), never grounded; the most HP left first, then
 * the nearest the tower, then the oldest.
 */
export function stormTargets(run: RunState, n: number): Enemy[] {
  const out: { e: Enemy; d: number }[] = [];
  for (const e of run.enemies) {
    if (e.boss || e.court || e.plate || e.grounded || !targetable(run, e)) continue;
    if (ENEMY_BY_ID[e.type]?.verb.kind === 'grounded') continue;
    out.push({ e, d: e.x * e.x + e.y * e.y });
  }
  out.sort((a, b) => b.e.hp - a.e.hp || a.d - b.d || a.e.id - b.e.id);
  return out.slice(0, n).map((o) => o.e);
}

/**
 * A strike (§4.5): with a Conductor up it lands on the tower, `wall` × the
 * wave's hit (forks don't multiply it); else on up to `forks` bodies, each
 * for `damage` of its Max HP.
 */
function strike(run: RunState, region: RegionDef, rule: Extract<RegionRule, { kind: 'storm' }>, forks: number): void {
  if (conducting(run)) {
    hurtTower(run, rule.wall * waveDamage(region, run.wave), 0, 0, null, 'storm');
    run.events.push({ kind: 'strike', x: 0, y: 0, tower: true });
    return;
  }
  for (const e of stormTargets(run, forks)) {
    damageEnemy(run, e, e.maxHp * rule.damage, false, 'storm');
    run.events.push({ kind: 'strike', x: e.x, y: e.y, tower: false });
  }
}

/**
 * Thunderhead Core (§8.9): every `thunderCoreEvery` s, a strike of the tower's
 * own on the toughest body the storm could find. Never the tower, never a boss.
 */
function tickThunderCore(run: RunState, dt: number): void {
  const R = BALANCE.relics;
  if (run.time <= 0 || !crossed(run, R.thunderCoreEvery, dt)) return;
  const rank = run.behaviours['thunder-core'] ?? 0;
  const share = R.thunderCore[Math.min(rank, R.thunderCore.length) - 1];
  for (const e of stormTargets(run, 1)) {
    damageEnemy(run, e, e.maxHp * share, false, 'storm');
    run.events.push({ kind: 'strike', x: e.x, y: e.y, tower: false });
  }
}

/** True when a `every`-second boundary of the run's clock falls in this step. */
function crossed(run: RunState, every: number, dt: number): boolean {
  return Math.floor(run.time / every) !== Math.floor((run.time - dt) / every);
}

/**
 * Carillon's Clapper (§8.9): every `clapperEvery` s a toll of the tower's own
 * stuns every body in range that isn't a boss's.
 */
function tickClapper(run: RunState, dt: number): void {
  const R = BALANCE.relics;
  if (run.time <= 0 || !crossed(run, R.clapperEvery, dt)) return;
  const rank = run.behaviours.clapper ?? 0;
  const until = run.time + R.clapper[Math.min(rank, R.clapper.length) - 1];
  const range2 = run.stats.range * run.stats.range;
  for (const e of run.enemies) {
    if (e.boss || e.court || e.plate || !targetable(run, e)) continue;
    if (e.x * e.x + e.y * e.y > range2) continue;
    e.stunnedUntil = Math.max(e.stunnedUntil, until);
  }
  run.events.push({ kind: 'toll', x: 0, y: 0, relic: true });
}

/** The bell (§4.1): on each toll, the next interval, quickened by the Ringers alive and the Carillon. */
function tickToll(run: RunState, t: NonNullable<WakeState['toll']>): void {
  if (run.time < t.next) return;
  const toll = wakeRule(run, 'toll');
  if (!toll) return;
  // The Ringers, read once per toll, never per step.
  let hasten = 1;
  for (const e of run.enemies) {
    if (!e.alive || e.hiddenUntil > run.time || e.boss || e.court) continue;
    const verb = ENEMY_BY_ID[e.type]?.verb;
    if (verb?.kind === 'ring') hasten *= verb.hasten;
  }
  hasten = Math.max(BALANCE.wake.toll.floor, hasten);
  const minI = toll.rule.window * BALANCE.wake.toll.minInterval;
  t.interval = Math.max(minI, toll.rule.every * hasten * t.pace);
  t.last = run.time;
  t.next = run.time + t.interval;
  run.events.push({ kind: 'toll' });
  peal(run);
}

/**
 * The Carillon's peal (§7.1): while its phase has a `peal`, each toll rolls a
 * shockwave from the boss at the wall, as a slam's does. `e.damage` is the
 * boss's contact hit with its fury in (fresh: `tickBoss` runs first), so
 * `damage × e.damage / def.damage` is the peal's share of the wave's hit, furied.
 */
function peal(run: RunState): void {
  const b = run.boss;
  const e = bossBody(run);
  if (!b || !e || e.hiddenUntil > run.time) return;
  const def = BOSS_BY_ID[b.id];
  for (const p of phasesOf(run, def)[b.phase].patterns) {
    if (p.kind !== 'peal') continue;
    run.rings.push({ x: e.x, y: e.y, radius: e.radius, speed: p.speed, damage: p.damage * (e.damage / def.damage), hit: false });
    run.events.push({ kind: 'slam', x: e.x, y: e.y });
  }
}

/**
 * How far a body walks this step under the Toll (§4.1), as a factor on its
 * step: 1 where the Toll doesn't hold for it, 0 outside its window, and the
 * lurch inside it, sized so its average pace stays `average` of its own.
 */
export function tollFactor(run: RunState, e: Enemy, verb: EnemyVerb | null, toll = run.wake?.toll ? wakeRule(run, 'toll') : null): number {
  const t = run.wake?.toll;
  if (!t || !toll) return 1;
  if (e.boss || e.court || e.plate) return 1;
  if (verb?.kind === 'sleepwalk') return verb.pace;
  if (verb?.kind === 'charge' && e.dashUntil > run.time) return 1;
  const start = verb?.kind === 'offbeat' ? t.last + t.interval / 2 : t.last;
  if (run.time < start || run.time >= start + toll.rule.window) return 0;
  const surge = Math.pow(BALANCE.wake.toll.surge, toll.surge);
  return (t.interval / toll.rule.window) * BALANCE.wake.toll.average * surge;
}

/**
 * The sideways share of a body's step under the Orbit (§4.2): the rule's
 * tangent, grown by the Blight Surge and a Tidal neighbour, capped below 1 so
 * the path stays a spiral. 0 where the Orbit doesn't hold for it: bosses,
 * their court and plates, a Comet, a body underground, blinking or phased out,
 * and anything walking out.
 */
export function orbitShare(run: RunState, e: Enemy, verb: EnemyVerb | null, orbit = run.wake?.orbit ? wakeRule(run, 'orbit') : null): number {
  if (!orbit || e.boss || e.court || e.plate || e.heading < 0) return 0;
  switch (verb?.kind) {
    case 'streak':
    case 'blink':
      return 0;
    case 'burrow':
      if (e.under) return 0;
      break;
    case 'phase':
      if (e.hiddenUntil > run.time) return 0;
      break;
    default:
      break;
  }
  const W = BALANCE.wake.orbit;
  const k = orbit.rule.tangent * Math.pow(W.surge, orbit.surge) * e.buffOrbit;
  return Math.min(W.max, k);
}

/**
 * One step of `len` toward `stop` (§4.2): straight in when `k` is 0, else a
 * spiral whose sideways part is `k` of its inward part, turning the way the
 * field spins. The inward part keeps the walker's pace (× `orbit.pace`, D-29),
 * the sideways part rides on top, and it never passes the stop. Returns how
 * far in it came.
 */
export function orbitStep(run: RunState, e: Enemy, k: number, len: number, d: number, stop: number): number {
  const rx = -e.x / d;
  const ry = -e.y / d;
  const inward = Math.min(len * BALANCE.wake.orbit.pace, d - stop);
  if (k === 0) {
    e.x += rx * inward;
    e.y += ry * inward;
    return inward;
  }
  const spin = run.wake?.orbit?.spin ?? 1;
  const side = inward * k;
  e.x += rx * inward - ry * spin * side;
  e.y += ry * inward + rx * spin * side;
  // The sideways part pushes it out a hair: land exactly on the radius it walked to.
  const nd = Math.hypot(e.x, e.y) || 1;
  const want = d - inward;
  e.x *= want / nd;
  e.y *= want / nd;
  return inward;
}

/**
 * A Moon's lane (§4.2): once at its lane's radius, it circles there, purely
 * sideways, until it has swept its `sweep`; then it walks in as any body.
 * Returns true while it laps (it took its step here).
 */
export function laneStep(run: RunState, e: Enemy, verb: Extract<EnemyVerb, { kind: 'lane' }>, len: number, d: number): boolean {
  if (e.lane >= verb.sweep || d > verb.radius + 1) return false;
  const spin = run.wake?.orbit?.spin ?? 1;
  const turn = len / d;
  const a = Math.atan2(e.y, e.x) + spin * turn;
  e.x = Math.cos(a) * d;
  e.y = Math.sin(a) * d;
  e.lane += turn;
  return true;
}
