import { SpatialGrid } from '../../core/spatialGrid';
import { BALANCE } from '../../content/balance';
import type { Enemy, RunState } from '../state';
import { mitigate } from './damage';

/**
 * Rebuilt from scratch every step, so it carries nothing between steps and
 * is not part of the run's state.
 */
const grid = new SpatialGrid<Enemy>(64);
const near: Enemy[] = [];

/**
 * Enemies walk straight at the tower, stop at its wall, and hit it on their
 * attack interval (§4.2). A stunned body does neither. Contact damage is
 * the only way a Region 1 enemy hurts the tower.
 */
export function tickEnemies(run: RunState, dt: number): void {
  const reach = run.stats.radius;
  for (const e of run.enemies) {
    e.px = e.x;
    e.py = e.y;
    if (!e.alive || e.stunnedUntil > run.time) continue;
    const d = Math.hypot(e.x, e.y);
    const stop = reach + e.radius;
    if (d > stop) {
      const stepLen = Math.min(e.speed * dt, d - stop);
      e.x -= (e.x / d) * stepLen;
      e.y -= (e.y / d) * stepLen;
      e.inContact = d - stepLen <= stop + 1e-6;
      // The first hit lands a beat after arrival, not on the arrival frame.
      if (e.inContact) e.attackTimer = e.attackInterval * 0.5;
      continue;
    }
    e.inContact = true;
    e.attackTimer -= dt;
    if (e.attackTimer <= 0) {
      e.attackTimer += e.attackInterval;
      const amount = mitigate(e.damage, run.stats.armor);
      run.tower.hp -= amount;
      run.tower.hurtTick = run.tick;
      run.events.push({ kind: 'towerHit', amount, x: e.x, y: e.y });
    }
  }
}

/**
 * Bodies push apart so a crowd reads as a crowd, not one blob. At the wall
 * the push is tangential only: bodies spread around the ring but never leave
 * it, so separation changes how a wave looks, not how hard it hits.
 */
export function separateEnemies(run: RunState): void {
  const strength = BALANCE.separation;
  grid.rebuild(run.enemies);
  const reach = run.stats.radius;
  for (const e of run.enemies) {
    if (!e.alive) continue;
    near.length = 0;
    grid.query(e.x, e.y, e.radius * 2.2, near);
    let fx = 0;
    let fy = 0;
    for (const o of near) {
      if (o === e) continue;
      let dx = e.x - o.x;
      let dy = e.y - o.y;
      let d = Math.hypot(dx, dy);
      const min = e.radius + o.radius;
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
