import {
  comboBonus,
  comboTierLabel,
  riskGoldMult,
  riskHpMult,
  riskSpeedMult,
  intermissionFactorForWave,
  intermissionSecondsForWave,
} from '../../data/pacing';
import type { StatAccumulator } from '../accumulator';
import type { StatContext } from '../context';

/**
 * Pacing (gameplay plan §7): the risk dial, early-call momentum, the combo
 * meter and the wave-scaled intermission.
 *
 * All four are stats, not pokes: they resolve through the same pipeline as
 * every other source, so the risk dial *composes with* a wave mutator's own
 * enemy multipliers rather than one of them silently winning, the combo's gold
 * shows up in the Stats panel breakdown as a named source, and the shortened
 * intermission multiplies the Efficient Deployment research node instead of
 * racing it.
 *
 * There is no switch here because there is no content union to be exhaustive
 * over — risk is a number, the combo tier is an index into a table, and the
 * intermission is a function of the wave. What `COMBO_TIERS` and
 * `ENEMY_THREAT_CLASS` guard is in `data/pacing.ts`.
 */
export function contributePacing(ctx: StatContext, acc: StatAccumulator): void {
  const p = ctx.pacing;

  // ── §7.4 the risk dial ──
  // `activeRisk`, not the setting: the dial takes effect at the *next* wave,
  // so what resolves here is what the live wave is actually running.
  if (p.risk > 0) {
    const a = acc.source('pacing', `Risk ${p.risk}`);
    a.mult('enemyHpMult', riskHpMult(p.risk));
    a.mult('enemySpeedMult', riskSpeedMult(p.risk));
    a.mult('goldMultiplier', riskGoldMult(p.risk));
  }

  // ── §7.1 call the wave early ──
  // A multiplier rather than an additive share, because momentum is meant to
  // read as a headline number on the HUD ("+27% gold") and an additive share
  // dropped into a pool that already sums to +300% would read as +7%.
  if (p.momentum > 0) {
    acc.source('pacing', 'Momentum').mult('goldMultiplier', 1 + p.momentum);
  }

  // ── §7.2 the combo meter ──
  if (p.comboTier > 0) {
    const bonus = comboBonus(p.comboTier);
    const a = acc.source('pacing', `Combo — ${comboTierLabel(p.comboTier) ?? ''}`);
    a.mult('goldMultiplier', 1 + bonus.gold);
    a.mult('xpGainMultiplier', 1 + bonus.xp);
  }

  // ── §7.6 intermission length responds to depth ──
  const factor = intermissionFactorForWave(ctx.wave);
  if (factor < 1) {
    acc
      .source('pacing', `Intermission ${intermissionSecondsForWave(ctx.wave)}s`)
      .mult('intermissionMultiplier', factor);
  }
}
