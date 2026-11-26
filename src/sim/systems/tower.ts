import { ABYSS_INDEX } from '../../content/abyss';
import { BALANCE } from '../../content/balance';
import { BOSS_BY_ID } from '../../content/bosses';
import { frameById } from '../../content/frames';
import type { Enemy, HurtBy, RunState } from '../state';
import { damageEnemy, targetable, wallRune } from './combat';
import { mitigate } from './damage';
import { runRegion, waveDamage } from './waves';

/**
 * Everything that hurts the tower comes through here: contact hits, Spitter
 * shots and boss shockwaves. `source` is the body that struck it in contact,
 * for Thorns and Aegis's reflection; null for anything at range. `by` is
 * what kind of harm it was, for the results' tally (U5).
 */
/** How much harder a stalled wave's horde hits (`BALANCE.overtime.stallAfter`): 1 until it enrages. */
export function hordeFury(run: RunState): number {
  const cur = run.current;
  if (!cur?.stalled || cur.heldSince === undefined) return 1;
  const O = BALANCE.overtime;
  return Math.pow(O.stallGrowth, Math.floor((run.time - cur.heldSince - O.stallAfter) / O.stallEvery) + 1);
}

/**
 * How much harder the boss's body strikes than its unenraged hit: 1 until it
 * enrages. `tickBoss` folds the enrage into `e.damage` (fresh: it runs before
 * bodies act), so this is that over the boss's base hit, as `peal` reads it.
 */
function bossRage(run: RunState, source: Enemy): number {
  const b = run.boss;
  if (!source.boss || !b || source.id !== b.enemy) return 1;
  const base = waveDamage(runRegion(run), b.wave) * BOSS_BY_ID[b.id].damage;
  return base > 0 ? Math.max(1, source.damage / base) : 1;
}

export function hurtTower(run: RunState, raw: number, x: number, y: number, source: Enemy | null, by: HurtBy): number {
  const t = run.tower;
  if (run.time < t.invulnUntil) {
    // Aegis (§11.6): the hit is turned away, and a contact hit goes back.
    run.events.push({ kind: 'blocked', x, y });
    const ult = frameById(run.frameId).ultimate;
    if (source && ult.id === 'aegis') damageEnemy(run, source, raw * ult.reflect, false, 'reflect');
    return 0;
  }
  let amount = mitigate(raw * hordeFury(run), run.stats.armor);
  // Grounding Wire (plans/late-game/12 §8.9): lightning and hostile shots land lighter.
  const wire = run.behaviours.grounding ?? 0;
  if (wire > 0 && (by === 'storm' || by === 'shots')) amount *= 1 - BALANCE.relics.grounding[Math.min(wire, BALANCE.relics.grounding.length) - 1];
  // Rampart (§11.4): no contact hit takes more than a slice of the wall. The
  // cap holds the hit before rage grows it (the horde's fury, the boss's
  // enrage), and the growth still lands, so a raging fight still ends.
  if (source && run.behaviours.rampart) {
    const rage = hordeFury(run) * bossRage(run, source);
    amount = Math.min(amount, run.stats.maxHp * BALANCE.behaviours.rampartCap * rage);
  }
  // Thorns answer the blow, shield or not.
  const struck = amount;
  // Bulwark Mastery (plans/mastery-capstones.md): the shield takes the hit first.
  const c = run.capstones;
  if (c.shield > 0) {
    const absorbed = Math.min(c.shield, amount);
    c.shield -= absorbed;
    amount -= absorbed;
  }
  // Warding Salt (§11.5): what strikes the wall is slowed.
  const salt = run.behaviours.salt ?? 0;
  if (source && salt > 0 && !source.boss) {
    const R = BALANCE.relics;
    source.slow = Math.max(source.slowUntil > run.time ? source.slow : 0, R.salt[Math.min(salt, R.salt.length) - 1]);
    source.slowUntil = run.time + R.saltSeconds;
  }
  run.takenBy[by] = (run.takenBy[by] ?? 0) + Math.min(amount, Math.max(0, t.hp));
  t.hp -= amount;
  t.hurtTick = run.tick;
  t.hurtAt = run.time;
  if (run.firstHurtWave === null) run.firstHurtWave = run.wave;
  // Steady Hand reads the low point here, before Second Wind can lift it.
  const b = run.boss;
  if (b && b.killedIn === null) b.minHp = Math.min(b.minHp, Math.max(0, t.hp) / run.stats.maxHp);
  run.events.push({ kind: 'towerHit', amount, x, y });
  // Thorns (§11.4): the wall bites back at what touches it. Fortress
  // (the keystone) brings its own thorns, three times as sharp.
  const B = BALANCE.behaviours;
  const fortress = (run.behaviours.fortress ?? 0) > 0;
  if (source && (run.behaviours.thorns || fortress)) {
    damageEnemy(run, source, struck * B.thorns * (fortress ? B.fortressThorns : 1), false, 'thorns');
  }
  // Bulwark Runes (§9): what strikes the wall sets off a rune where it stands.
  if (source && source.alive) wallRune(run, source);
  return amount;
}

/** Hostile shots fly straight at the tower and land on its wall. */
export function tickShots(run: RunState, dt: number): void {
  const R = run.stats.radius;
  let w = 0;
  for (const s of run.shots) {
    s.px = s.x;
    s.py = s.y;
    s.life -= dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    if (Math.hypot(s.x, s.y) <= R) {
      hurtTower(run, s.damage, s.x, s.y, null, 'shots');
      continue;
    }
    if (s.life > 0) run.shots[w++] = s;
  }
  run.shots.length = w;
}

/**
 * Every heal on the tower comes through here. Bulwark Mastery
 * (plans/mastery-capstones.md): what Max HP can't hold becomes a shield, up
 * to its cap; at rank 2, a shield that fills bursts on everything in range.
 */
export function healTower(run: RunState, amount: number): void {
  const t = run.tower;
  const max = run.stats.maxHp;
  const room = Math.max(0, max - t.hp);
  t.hp = Math.min(max, t.hp + amount);
  const rank = run.behaviours['bulwark-capstone'] ?? 0;
  const over = amount - room;
  if (rank === 0 || over <= 0) return;
  const C = BALANCE.capstones;
  const cap = max * C.shieldCap;
  const c = run.capstones;
  c.shield = Math.min(cap, c.shield + over);
  if (rank >= 2 && c.shield >= cap) burstShield(run);
}

/** Bulwark rank 2: the full shield's worth to every enemy in range, at range too; then it empties. */
function burstShield(run: RunState): void {
  const c = run.capstones;
  const damage = c.shield;
  c.shield = 0;
  const r2 = run.stats.range * run.stats.range;
  // Only what was there when it went off, not what its kills burst into.
  const n = run.enemies.length;
  for (let i = 0; i < n; i++) {
    const e = run.enemies[i];
    if (!targetable(run, e) || e.x * e.x + e.y * e.y > r2) continue;
    damageEnemy(run, e, damage, false, 'burst');
  }
  // Drawn as a Nova's ring: the same reach, the same shape of harm.
  run.events.push({ kind: 'nova', radius: run.stats.range });
}

/**
 * The capstones' clock on the wall, each step: the shield fades (Bulwark 1),
 * and every ten waves, or three Abyss floors, Second Wind comes back (Bulwark 3).
 */
export function tickBulwark(run: RunState, dt: number): void {
  const rank = run.behaviours['bulwark-capstone'] ?? 0;
  if (rank === 0) return;
  const c = run.capstones;
  if (c.shield > 0) c.shield *= Math.pow(1 - BALANCE.capstones.shieldDecay, dt);
  if (rank < 3) return;
  const mark = windMark(run.regionId, run.wave, run.floors);
  if (mark <= c.windMark) return;
  c.windMark = mark;
  const owned = run.behaviours['second-wind'] ?? 0;
  if (owned > 0) run.revives = Math.max(run.revives, owned);
}

/** Which stretch of ten waves (or three Abyss floors) the run is in: Second Wind recharges on each new one. */
export function windMark(regionId: number, wave: number, floors: number): number {
  const C = BALANCE.capstones;
  return regionId === ABYSS_INDEX ? Math.floor(floors / C.windFloors) : Math.floor(wave / C.windWaves);
}
