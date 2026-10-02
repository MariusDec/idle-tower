import { BALANCE } from '../../content/balance';
import { EVOLUTION_OF } from '../../content/evolutions';
import { WEAPON_BY_ID, weaponParams } from '../../content/weapons';
import type { FusionId, WeaponId, WeaponParams, WeaponPattern } from '../../content/types';
import type { RunState, TowerStats, WeaponState } from '../state';

/**
 * A weapon as the tower fields it (§4.4): its level's numbers, its
 * evolution's spike and its fusion's (N9), the tower's area, duration, projectile-speed and pierce
 * stats, and the count caps (§12.5). The sim fires these numbers and the
 * draft scorer estimates from them, so the two never disagree on a weapon.
 */

/** What a pattern puts on screen in numbers, and its cap; Infinity for none. */
export function countCap(pattern: WeaponPattern): number {
  const C = BALANCE.caps;
  switch (pattern) {
    case 'homing':
      return C.bolts;
    case 'orbit':
      return C.blades;
    case 'drone':
      return C.drones;
    case 'boomerang':
      return C.crescents;
    case 'mine':
      return C.runes;
    case 'tether':
      return C.tethers;
    case 'rail':
      return C.slugs;
    case 'cone':
    case 'chain':
    case 'pulse':
    case 'lob':
    case 'beam':
      return Infinity;
    default: {
      const exhaustive: never = pattern;
      return exhaustive;
    }
  }
}

/** Patterns whose shots are bodies in flight: pierce and projectile speed reach them. */
function shoots(pattern: WeaponPattern): boolean {
  return pattern === 'homing' || pattern === 'cone' || pattern === 'drone';
}

/** Patterns that fly but cut everything they cross: projectile speed reaches them, pierce has nothing to add. */
function sweeps(pattern: WeaponPattern): boolean {
  return pattern === 'boomerang';
}

/** The evolution's damage spike, once evolved. */
export function evolutionSpike(id: WeaponId, evolved: boolean): number {
  return evolved ? BALANCE.evolutions[EVOLUTION_OF[id].id].damage : 1;
}

export function armed(stats: TowerStats, w: Pick<WeaponState, 'id' | 'level' | 'evolved'> & { fusion?: FusionId | null }): WeaponParams {
  const base = weaponParams(w.id, w.level);
  const pattern = WEAPON_BY_ID[w.id].pattern;
  // A fusion (N9): both halves hit harder.
  const fused = w.fusion ? BALANCE.fusions.damage : 1;
  let damage = base.damage * evolutionSpike(w.id, w.evolved) * fused;
  let count = base.count;
  // Past the cap, every extra body becomes damage on the ones that fly (§12.5).
  const cap = countCap(pattern);
  if (count > cap) {
    damage *= count / cap;
    count = cap;
  }
  const flies = shoots(pattern);
  return {
    ...base,
    damage,
    count,
    // An orbit's reach is where it circles, not how wide it cuts: area widens the blades.
    radius: pattern === 'orbit' ? base.radius : base.radius * stats.areaMult,
    blade: base.blade * stats.areaMult,
    slowSeconds: base.slowSeconds * stats.durationMult,
    stun: base.stun * stats.durationMult,
    ramp: base.ramp * stats.durationMult,
    projectileSpeed: flies || pattern === 'lob' || sweeps(pattern) ? base.projectileSpeed * stats.projectileSpeedMult : base.projectileSpeed,
    pierce: flies ? base.pierce + stats.pierce : base.pierce,
  };
}

/** The level an evolution unlocks at: the last, or Specialist's earlier one (§11.4). */
export function evolveAt(specialist: boolean): number {
  return specialist ? BALANCE.behaviours.specialistEvolveAt : BALANCE.evolutions.evolveAt;
}

/** A weapon freshly mounted. */
export function newWeapon(id: WeaponId, level: number): WeaponState {
  return {
    id, level, cooldown: 0, aim: -Math.PI / 2, evolved: false, fusion: null, joined: false,
    spin: 0, beamTarget: 0, heat: 1, meteor: 0, drones: [], silencedUntil: 0, dampedUntil: 0, tethers: [],
  };
}

/** Weapon slots in use: a fusion's second half rides on its partner's mount (N9). */
export function slotsUsed(run: Pick<RunState, 'weapons'>): number {
  return run.weapons.filter((w) => !w.joined).length;
}
