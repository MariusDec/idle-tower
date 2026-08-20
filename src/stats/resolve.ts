import type { GoldSourceEntry } from '../types';
import { StatAccumulator, clampStat, type Breakdown } from './accumulator';
import type { StatContext } from './context';
import { STAT_KEYS, type StatKey } from './keys';
import { contributeUpgrades } from './contributors/upgrades';
import { contributeEvolutions } from './contributors/evolutions';
import { contributePrestige } from './contributors/prestige';
import { contributeResearch } from './contributors/research';
import { contributeAchievements } from './contributors/achievements';
import { contributeTalents } from './contributors/talents';
import { contributePassives } from './contributors/passives';
import { contributeEquipment } from './contributors/equipment';
import { contributeWaveModifier } from './contributors/waveModifier';
import { contributeBuffs } from './contributors/buffs';

export type ResolvedStats = Record<StatKey, number>;

export interface ResolveResult {
  stats: ResolvedStats;
  breakdown: Breakdown;
}

export interface ResolveOptions {
  /** Collect per-source attribution. Off by default — see `StatAccumulator`. */
  breakdown?: boolean;
}

/** Minimum shield recharge, so stacked reductions can't make it permanent. */
const MIN_SHIELD_RECHARGE = 3;

/**
 * Every contributor, in the order their attribution reads best in the Stats
 * panel. The *result* does not depend on this order — that is the point of the
 * two-bucket model — so a contributor can be added anywhere in the list.
 */
const CONTRIBUTORS = [
  contributeUpgrades,
  contributeEvolutions,
  contributePrestige,
  contributeResearch,
  contributeAchievements,
  contributeWaveModifier,
  contributeTalents,
  contributePassives,
  contributeEquipment,
  contributeBuffs,
] as const;

/**
 * One immutable context in, one derived stat block out.
 *
 * This is the single composition point the game has. Nothing else may write a
 * tower stat: systems contribute to the context, `Game.applyResolvedStats`
 * writes the result, and the two never disagree because the Stats panel reads
 * the same call.
 */
export function resolveStats(ctx: StatContext, options: ResolveOptions = {}): ResolveResult {
  const acc = new StatAccumulator(options.breakdown === true);
  for (const contribute of CONTRIBUTORS) contribute(ctx, acc);

  // The gold multiplier is the one derived key: additive sources are summed
  // and scaled by research/transcendence first (the historical `1 + sum`
  // shape), and only then do the flat multipliers apply. Folding it in here
  // rather than in a contributor keeps every source's contribution visible in
  // the breakdown.
  acc.add('goldMultiplier', acc.resolve('goldAdditive'), 'derived', 'Additive sources');

  const stats = {} as ResolvedStats;
  for (const key of STAT_KEYS) stats[key] = acc.resolve(key);

  if (stats.shieldRechargeTime > 0) {
    stats.shieldRechargeTime = Math.max(MIN_SHIELD_RECHARGE, stats.shieldRechargeTime);
  } else {
    // No recharge timer means no shield at all, so the Extra Shield talent has
    // nothing to add charges to.
    stats.shieldMaxCharges = 0;
  }
  stats.landMineFrequency = stats.landMineDamage > 0 ? stats.landMineFrequency : 0;

  return { stats, breakdown: acc.getBreakdown() };
}

/**
 * Re-clamp a single stat after the caller has adjusted it. Used where a stat's
 * final value depends on runtime state the context does not carry.
 */
export { clampStat };

/**
 * Turn the gold portion of a breakdown into the entries the Stats panel shows.
 *
 * Additive and multiplicative sources stay distinct, because attributing a
 * factor to an additive source overstates it — two `+100%` sources are `x3`,
 * not `x4`. Multiplying every entry back together reproduces the applied
 * multiplier exactly.
 */
export function goldSourceEntries(breakdown: Breakdown): GoldSourceEntry[] {
  const entries: GoldSourceEntry[] = [];
  const additive = breakdown.goldAdditive ?? [];

  let rawAdditive = 0;
  let scale = 1;
  const scaleLabels: string[] = [];
  for (const c of additive) {
    if (c.kind === 'add') rawAdditive += c.value;
    else {
      scale *= c.value;
      scaleLabels.push(c.label);
    }
  }

  for (const c of additive) {
    if (c.kind === 'add' && c.value > 0) {
      entries.push({ label: c.label, kind: 'additive', additive: c.value });
    }
  }
  if (scale !== 1 && rawAdditive > 0) {
    entries.push({
      label: scaleLabels.join(' & ') || 'Scaling',
      kind: 'additive',
      additive: rawAdditive * (scale - 1),
    });
  }

  for (const c of breakdown.goldMultiplier ?? []) {
    if (c.kind === 'mult' && c.value > 1) {
      entries.push({ label: c.label, kind: 'multiplicative', factor: c.value });
    }
  }
  return entries;
}
