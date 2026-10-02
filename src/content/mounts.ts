import type { WeaponId } from './types';

/**
 * Where each weapon sits on the tower (§4.4: each equipped weapon is drawn
 * on the tower), as multiples of the wall radius. The painter draws the
 * mounts here and the sim fires from them, so a shot leaves the barrel it
 * is drawn from. Slot 0 is the turret on the drum; the rest are pods on the
 * plinth's lower corners and its crown, so a new weapon lands somewhere the
 * eye already rests; Act 2's fifth and sixth (§9) sit at its flanks.
 */
const POD_ANGLES = [Math.PI * 0.75, Math.PI * 0.25, -Math.PI * 0.5, Math.PI, 0];
const POD_DISTANCE = 1.04;
/** Pod radius, as a multiple of the wall radius: big enough to read on a phone. */
export const POD_RADIUS = 0.52;
/** The turret's radius: it fills the drum. */
export const TURRET_RADIUS = 0.82;

/**
 * How far along its aim a weapon's shot leaves its mount, as a multiple of
 * the mount's radius: the tip of its silhouette. Weapons that fire nothing
 * from the mount (blades, drones, the pulse, runes) leave from its centre.
 */
const MUZZLE: Record<WeaponId, number> = {
  'arcane-bolt': 1,
  scattershot: 1.05,
  'chain-lightning': 0.85,
  'frost-ring': 0,
  mortar: 0.75,
  sunlance: 0.95,
  glaives: 0,
  'sentinel-drones': 0,
  moonblade: 0.5,
  'rune-traps': 0,
  'soul-tether': 1,
  'gilded-rail': 1.1,
};

/** Where weapon slot `slot` sits, for a wall radius `R`. */
export function mountOffset(slot: number, R: number): { x: number; y: number } {
  if (slot === 0) return { x: 0, y: 0 };
  const a = POD_ANGLES[(slot - 1) % POD_ANGLES.length];
  return { x: Math.cos(a) * R * POD_DISTANCE, y: Math.sin(a) * R * POD_DISTANCE };
}

/** The radius weapon slot `slot`'s mount may fill, for a wall radius `R`. */
export function mountRadius(slot: number, R: number): number {
  return R * (slot === 0 ? TURRET_RADIUS : POD_RADIUS);
}

/** Where a shot leaves weapon `id` in slot `slot`, aimed at `angle`. */
export function muzzleAt(id: WeaponId, slot: number, R: number, angle: number): { x: number; y: number } {
  const o = mountOffset(slot, R);
  const reach = mountRadius(slot, R) * MUZZLE[id];
  return { x: o.x + Math.cos(angle) * reach, y: o.y + Math.sin(angle) * reach };
}
