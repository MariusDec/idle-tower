import type { StatAccumulator } from '../accumulator';
import type { StatContext } from '../context';

/**
 * Timed buffs from the `BuffRegistry`. They land in the same two buckets as
 * everything else, so a buff and a purchase made during it compose instead of
 * cancelling — the failure behind §1.3 (Berserk) and §1.8 (Vampiric Aura).
 */
export function contributeBuffs(ctx: StatContext, acc: StatAccumulator): void {
  for (const buff of ctx.buffs) {
    if (buff.kind === 'add') acc.add(buff.stat, buff.value, 'buff', buff.label);
    else acc.mult(buff.stat, buff.value, 'buff', buff.label);
  }
}
