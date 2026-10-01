import { BALANCE } from '../../content/balance';
import { frameById } from '../../content/frames';
import type { Enemy, RunState } from '../state';
import { damageEnemy, wallRune } from './combat';
import { mitigate } from './damage';

/**
 * Everything that hurts the tower comes through here: contact hits, Spitter
 * shots and boss shockwaves. `source` is the body that struck it in contact,
 * for Thorns and Aegis's reflection; null for anything at range.
 */
export function hurtTower(run: RunState, raw: number, x: number, y: number, source: Enemy | null): number {
  const t = run.tower;
  if (run.time < t.invulnUntil) {
    // Aegis (§11.6): the hit is turned away, and a contact hit goes back.
    run.events.push({ kind: 'blocked', x, y });
    const ult = frameById(run.frameId).ultimate;
    if (source && ult.id === 'aegis') damageEnemy(run, source, raw * ult.reflect, false, 'reflect');
    return 0;
  }
  let amount = mitigate(raw, run.stats.armor);
  // Rampart (§11.4): no contact hit takes more than a slice of the wall.
  if (source && run.behaviours.rampart) amount = Math.min(amount, run.stats.maxHp * BALANCE.behaviours.rampartCap);
  // Warding Salt (§11.5): what strikes the wall is slowed.
  const salt = run.behaviours.salt ?? 0;
  if (source && salt > 0 && !source.boss) {
    const R = BALANCE.relics;
    source.slow = Math.max(source.slowUntil > run.time ? source.slow : 0, R.salt[Math.min(salt, R.salt.length) - 1]);
    source.slowUntil = run.time + R.saltSeconds;
  }
  t.hp -= amount;
  t.hurtTick = run.tick;
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
    damageEnemy(run, source, amount * B.thorns * (fortress ? B.fortressThorns : 1), false, 'thorns');
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
      hurtTower(run, s.damage, s.x, s.y, null);
      continue;
    }
    if (s.life > 0) run.shots[w++] = s;
  }
  run.shots.length = w;
}
