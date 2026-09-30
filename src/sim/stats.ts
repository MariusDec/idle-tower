import { BALANCE } from '../content/balance';
import type { TowerStats } from './state';

/**
 * The tower's base stats. The resolver over ~20 keys with additive and
 * multiplicative buckets (§12.3) arrives with the draft (P2) and the Forge
 * (P3); until then a run uses the base values.
 */
export function baseTowerStats(): TowerStats {
  const t = BALANCE.tower;
  return {
    maxHp: t.maxHp,
    regen: t.regen,
    armor: t.armor,
    radius: t.radius,
    range: t.range,
    critChance: t.critChance,
    critMult: t.critMult,
    damageMult: 1,
    fireRateMult: 1,
  };
}
