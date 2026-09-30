import type { StatAccumulator } from '../accumulator';
import type { StatContext } from '../context';

/**
 * The active wave mutator. Its enemy-side effects (count, speed, HP, damage to
 * the tower) go straight to `WaveManager`/`EnemyManager`; only the two that
 * touch tower stats belong in the pipeline, so the mutator's gold bonus
 * composes with prestige and research instead of replacing them (plan §1.1).
 */
export function contributeWaveModifier(ctx: StatContext, acc: StatAccumulator): void {
  const mod = ctx.waveModifier;
  if (!mod) return;
  const a = acc.source('waveModifier', 'Wave mutator');
  a.add('goldAdditive', mod.goldAdditive);
  a.mult('baseDamage', mod.playerDamageMult);
}
