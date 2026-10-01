import { BALANCE } from '../../content/balance';
import { frameById } from '../../content/frames';
import type { Enemy, RunState } from '../state';
import { damageEnemy } from './combat';
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
  const amount = mitigate(raw, run.stats.armor);
  t.hp -= amount;
  t.hurtTick = run.tick;
  if (run.firstHurtWave === null) run.firstHurtWave = run.wave;
  run.events.push({ kind: 'towerHit', amount, x, y });
  // Thorns (§11.4): the wall bites back at what touches it.
  if (source && run.behaviours.thorns) damageEnemy(run, source, amount * BALANCE.behaviours.thorns, false, 'thorns');
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
