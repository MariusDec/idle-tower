import { CORE_BY_ID, CORE_TUNING, type CoreDef, type CoreId } from '../../data/cores';
import type { SourceHandle, StatAccumulator } from '../accumulator';
import type { StatContext } from '../context';

/**
 * The run's tower core (plan §6).
 *
 * The switch is exhaustive over `CoreId` with a `never` default: adding a core
 * to `CORE_IDS` without deciding what it does to the tower does not compile.
 * That is the same guard `contributors/talents.ts` and `contributors/blessings.ts`
 * carry, and it is the reason a core cannot ship as a picker card that changes
 * no number.
 *
 * Most cases are one call, because a core's *stat block* is data and belongs in
 * `data/cores.ts` where it can be re-tuned in one line. The switch earns its
 * keep on the case that is not data: `bloodforge`'s tempo step is gated on live
 * tower HP, which is exactly the shape `last_stand` has — off `ctx.hpFraction`,
 * so the one pass that recomputes everything else recomputes it too, rather
 * than some system writing `TowerState` behind the pipeline's back.
 */
export function contributeCore(ctx: StatContext, acc: StatAccumulator): void {
  const id: CoreId = ctx.core;
  const def = CORE_BY_ID[id];
  const a = acc.source('core', def.name);

  switch (id) {
    case 'marksman':
      applyStatBlock(a, def);
      break;
    case 'artillery':
      applyStatBlock(a, def);
      break;
    case 'frostwork':
      applyStatBlock(a, def);
      break;
    case 'bloodforge':
      applyStatBlock(a, def);
      // The comeback half of the core. It reads as a shot behavior on the
      // picker card, but it is a stat gated on live HP, so it resolves here
      // rather than being poked into the tower from a combat hook.
      if (ctx.hpFraction < CORE_TUNING.desperateHpFraction) {
        a.mult('fireRate', 1 + CORE_TUNING.desperateFireRate, 'Bloodforge — desperate');
      }
      break;
    case 'arcane':
      applyStatBlock(a, def);
      break;
    default: {
      const exhaustive: never = id;
      void exhaustive;
    }
  }
}

/**
 * Write one core's declared stat block into the accumulator.
 *
 * Percentages are multiplicative and the two "additive by nature" channels
 * (crit chance, lifesteal) are additive, matching how every other contributor
 * treats the same keys — so a core composes with upgrades and blessings instead
 * of racing them.
 */
function applyStatBlock(a: SourceHandle, def: CoreDef): void {
  const s = def.stats;
  if (s.damagePct !== undefined) a.mult('baseDamage', 1 + s.damagePct);
  if (s.fireRatePct !== undefined) a.mult('fireRate', 1 + s.fireRatePct);
  if (s.rangePct !== undefined) a.mult('range', 1 + s.rangePct);
  if (s.critChanceAdd !== undefined) a.add('critChance', s.critChanceAdd);
  if (s.maxHpPct !== undefined) a.mult('maxHp', 1 + s.maxHpPct);
  if (s.lifestealAdd !== undefined) a.add('lifesteal', s.lifestealAdd);
  if (s.manaRegenPct !== undefined) a.mult('manaRegen', 1 + s.manaRegenPct);
  if (s.abilityDamagePct !== undefined) a.mult('abilityDamageMultiplier', 1 + s.abilityDamagePct);
  if (s.abilityAreaPct !== undefined) a.mult('abilityAreaMultiplier', 1 + s.abilityAreaPct);
  // Additive, so a core's gold composes with prestige, research and blessings
  // the way every other additive gold source does (plan §1.1).
  if (s.goldPct !== undefined) a.add('goldAdditive', s.goldPct);
}
