import { BALANCE } from '../../content/balance';
import { FRAMES } from '../../content/frames';
import { weaponParams } from '../../content/weapons';
import type { RunState } from '../state';
import { damageEnemy, knockBack } from './combat';

/**
 * The frame's ultimate (§4.4): charged by kills (see `kill`), fired on the
 * player's tap. Each cast makes the next charge longer.
 */
export function castUltimate(run: RunState): boolean {
  const u = run.ult;
  if (u.charge < 1) return false;
  const frame = FRAMES.find((f) => f.id === run.frameId) ?? FRAMES[0];
  const ult = frame.ultimate;
  switch (ult.id) {
    case 'nova': {
      const level = run.weapons.find((w) => w.id === frame.startingWeapon)?.level ?? 1;
      const damage = weaponParams(frame.startingWeapon, level).damage * ult.damage * run.stats.damageMult;
      const r2 = run.stats.range * run.stats.range;
      for (const e of run.enemies) {
        if (!e.alive || e.x * e.x + e.y * e.y > r2) continue;
        damageEnemy(run, e, damage, false);
        if (e.alive) knockBack(e, ult.knockback);
      }
      run.events.push({ kind: 'nova', radius: run.stats.range });
      break;
    }
    default: {
      const exhaustive: never = ult.id;
      return exhaustive;
    }
  }
  u.charge = 0;
  u.casts++;
  u.need *= BALANCE.ultimate.growth;
  return true;
}
