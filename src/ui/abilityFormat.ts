import type { AbilityDef, EffectiveAbilityStats } from '../data/abilities';
import { computeEffectiveStats } from '../data/abilities';
import { formatInt } from '../utils/bigNumber';

export const EFFECT_LABELS: Record<AbilityDef['effectType'], string> = {
  aoe_damage: 'Damage',
  slow: 'Slow',
  fire_rate_buff: 'Fire rate',
  gold_buff: 'Gold',
  single_target_damage: 'Damage',
  chain_damage: 'Damage',
  crit_buff: 'Crit chance',
  lifesteal_buff: 'Lifesteal',
  execute_damage: 'Threshold',
};

export function renderAbilityTooltip(
  def: AbilityDef,
  currentStats: EffectiveAbilityStats,
  cost: number,
  canAfford: boolean,
): string {
  const next = computeEffectiveStats(def, currentStats.level + 1);
  const manaCostStr = formatInt(currentStats.manaCost);
  const nextManaCostStr = formatInt(next.manaCost);
  const cooldownStr = currentStats.cooldown.toFixed(1);
  const nextCooldownStr = next.cooldown.toFixed(1);
  const durationStr = currentStats.displayDuration || `${currentStats.duration.toFixed(1)}s`;
  const nextDurationStr = next.displayDuration || `${next.duration.toFixed(1)}s`;
  const effectLabel = EFFECT_LABELS[def.effectType];
  const curEff = currentStats.displayEffectValue;
  const nextEff = next.displayEffectValue;
  const affCls = canAfford ? 'can-afford' : 'cannot-afford';
  return `
    <div class="tooltip-header">${def.name} &mdash; Level ${currentStats.level} &rarr; ${currentStats.level + 1}</div>
    <div class="tooltip-row"><span>${effectLabel}</span><span>${curEff} <span class="arrow">&rarr;</span> <span class="up-val">${nextEff}</span></span></div>
    <div class="tooltip-row"><span>Mana cost</span><span>${manaCostStr} <span class="arrow">&rarr;</span> <span class="up-val">${nextManaCostStr}</span></span></div>
    <div class="tooltip-row"><span>Cooldown</span><span>${cooldownStr}s <span class="arrow">&rarr;</span> <span class="up-val">${nextCooldownStr}s</span></span></div>
    <div class="tooltip-row"><span>Duration</span><span>${durationStr} <span class="arrow">&rarr;</span> <span class="up-val">${nextDurationStr}</span></span></div>
    <div class="tooltip-cost ${affCls}">Cost: ${formatInt(cost)}g</div>
  `;
}
