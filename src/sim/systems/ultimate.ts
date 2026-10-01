import { BALANCE } from '../../content/balance';
import { frameById } from '../../content/frames';
import { weaponParams } from '../../content/weapons';
import type { RunState } from '../state';
import { staggerBoss } from './boss';
import { damageEnemy, knockBack } from './combat';

/**
 * The frame's ultimate (§4.4): charged by kills (see `kill`), fired on the
 * player's tap. Each cast makes the next charge longer.
 */
export function castUltimate(run: RunState): boolean {
  const u = run.ult;
  if (u.charge < 1) return false;
  const frame = frameById(run.frameId);
  const ult = frame.ultimate;
  switch (ult.id) {
    case 'nova': {
      const level = run.weapons.find((w) => w.id === frame.startingWeapon)?.level ?? 1;
      const damage = weaponParams(frame.startingWeapon, level).damage * ult.damage * run.stats.damageMult;
      const r2 = run.stats.range * run.stats.range;
      // A Nova into a boss's wind-up staggers it (§4.3).
      staggerBoss(run);
      for (const e of run.enemies) {
        if (!e.alive || e.x * e.x + e.y * e.y > r2) continue;
        damageEnemy(run, e, damage, false, 'nova');
        if (e.alive && !e.boss) knockBack(e, ult.knockback);
      }
      run.events.push({ kind: 'nova', radius: run.stats.range });
      break;
    }
    case 'aegis':
      run.tower.invulnUntil = run.time + ult.seconds;
      run.events.push({ kind: 'aegis', seconds: ult.seconds });
      break;
    default: {
      const exhaustive: never = ult;
      return exhaustive;
    }
  }
  u.charge = 0;
  u.casts++;
  u.need *= BALANCE.ultimate.growth;
  return true;
}
