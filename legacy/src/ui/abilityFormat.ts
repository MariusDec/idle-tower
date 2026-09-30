import type { AbilityDef, EffectiveAbilityStats } from '../data/abilities';
import {
  AbilityEffectType,
  AutoCastCondition,
  CHAIN_DECAY,
  METEOR_SPLASH_FRACTION,
  ROCKET_SPLASH_RADIUS,
  ROCKET_SPLASH_FRACTION,
  chainBounces,
  executeBossFrac,
  frostBrittle,
  precisionCritMultiplier,
  vampiricRegen,
} from '../data/abilities';
import { WORLD_SCALE } from '../data/arena';
import { formatInt } from '../utils/bigNumber';

/**
 * Plan §7.1. The "Damage" row is reserved for abilities whose `effectValue`
 * is a multiplier on tower damage — the row is supposed to read "16 damage
 * at L1, 18 at L2", which only makes sense when `effectValue` is the
 * multiplier. Buff/slow/execute effects already get a meaningful number in
 * the Effect row (`2x`, `50%`, `12%`) and do *not* need a Damage row, so
 * adding one would be misleading (a `+30% crit` doesn't translate into a
 * fixed-damage number).
 */
const DAMAGE_EFFECTS: ReadonlySet<AbilityEffectType> = new Set([
  'aoe_damage',
  'single_target_damage',
  'chain_damage',
  'rocket_barrage',
]);

/**
 * Per-effect label for the Effect row (e.g. "Damage", "Slow", "Crit chance").
 *
 * Kept here so the existing accessibility tree (tests, the panel's
 * `data-stat` attribute) doesn't have to change when an ability is renamed
 * or a new effect type is added.
 */
export const EFFECT_LABELS: Record<AbilityEffectType, string> = {
  aoe_damage: 'Damage',
  slow: 'Slow',
  fire_rate_buff: 'Fire rate',
  gold_buff: 'Gold',
  single_target_damage: 'Damage',
  chain_damage: 'Damage',
  crit_buff: 'Crit chance',
  lifesteal_buff: 'Lifesteal',
  execute_damage: 'Threshold',
  rocket_barrage: 'Rockets',
};

/**
 * Plan §7.2: every caller of `renderAbilityTooltip` builds the same context.
 * Centralising it makes the "→ next level" arrow column impossible to
 * mismatch: `next` is always the manager-sourced, multiplier-respected
 * EffectiveAbilityStats, not a re-derived table value.
 *
 * - `stats` / `next` — fully multiplied `EffectiveAbilityStats` for the
 *   current / next level. `next === null` when `stats.isMaxed`.
 * - `cost` — gold cost of the next upgrade (0 if maxed; callers also gate on
 *   `showCost`).
 * - `canAfford` — whether the player can afford the next upgrade *right now*.
 * - `showCost` — whether to render the gold-cost row. The popover sets this
 *   to `false` while maxed because the upgrade button is also hidden.
 * - `towerDamage` — base damage from the last `update()` snapshot. Used to
 *   ground the Damage row in something the player can read. `0` hides the
 *   Damage row entirely, which is what the popover does — it has no live
 *   state and Damage without a base is meaningless.
 * - `xp` / `xpNeeded` — ability XP toward `stats.level + 1`. The popover
 *   passes 0 / 0 because it's an upgrade dialog, not a progression check.
 */
export interface AbilityTooltipContext {
  stats: EffectiveAbilityStats;
  next: EffectiveAbilityStats | null;
  cost: number;
  canAfford: boolean;
  showCost: boolean;
  towerDamage: number;
  xp: number;
  xpNeeded: number;
}

/**
 * Per-ability extras shown below the standard stat rows (plan §7.2 table).
 *
 * Returns `Array<[label, value]>` with both already formatted for display.
 * The renderer calls this twice — once with `level` and once with
 * `level + 1` — and pairs the results into the arrow column. Static values
 * (no arrow) look identical on both calls.
 */
function extraRows(def: AbilityDef, level: number): Array<[string, string]> {
  switch (def.id) {
    case 'rain_of_arrows':
      return [];
    case 'frost_nova': {
      // Def description says "{brittle}% damage" — the buff lands while the
      // slow is active, so the player needs to know what they're getting on
      // top of the slow itself.
      const v = frostBrittle(level);
      return [['Brittle', `+${Math.round(v * 100)}% damage taken`]];
    }
    case 'berserk':
      return [];
    case 'gold_rush':
      return [];
    case 'meteor_strike': {
      // Splash fraction is a flat 55%, not a per-level curve — useful for the
      // player to read once even though there is no arrow.
      return [['Splash', `${Math.round(METEOR_SPLASH_FRACTION * 100)}% damage`]];
    }
    case 'precision_shot': {
      const v = precisionCritMultiplier(level);
      return [['Crit damage', `${v.toFixed(2)}×`]];
    }
    case 'chain_lightning': {
      // Two numbers the player tunes together: how many hops, how much each
      // hop loses. Showing them on one line matches the description's
      // "and arcs to nearby targets".
      const b = chainBounces(level);
      const d = Math.round(CHAIN_DECAY * 100);
      return [['Bounces', `${b} targets · ${d}% per hop`]];
    }
    case 'vampiric_aura': {
      // Effect row already shows the additive lifesteal; this is the per-
      // second HP regen that comes on top of it. The pair is what the
      // description promises ("gain lifesteal AND regenerate HP").
      const rg = vampiricRegen(level);
      return [['Regen', `${(rg * 100).toFixed(1)}% max HP/s`]];
    }
    case 'execute': {
      // Effect row carries the non-boss threshold ("12% → 14%"); the boss
      // bonus is a separate formula (5.0% + 0.8% per level).
      const boss = executeBossFrac(level);
      return [['Boss bonus', `${(boss * 100).toFixed(1)}% max HP`]];
    }
    case 'rocket_barrage': {
      // Two splash numbers (radius + fraction) and they are static, so they
      // render without an arrow.
      const r = Math.round(ROCKET_SPLASH_RADIUS / WORLD_SCALE);
      return [
        ['Splash radius', `${r} px`],
        ['Splash damage', `${Math.round(ROCKET_SPLASH_FRACTION * 100)}%`],
      ];
    }
  }
}

/** Plan §7.2: auto-cast gate description. */
function describeAutoCast(c: AutoCastCondition): string {
  const parts: string[] = [];
  if (c.minInDisc !== undefined) {
    parts.push(`≥${c.minInDisc} targetable enemy in the disc`);
  }
  if (c.minEnemies !== undefined) {
    parts.push(`≥${c.minEnemies} targetable enemy on the field`);
  }
  if (c.bossOnly) parts.push('while a boss is alive');
  if (c.bossHpBelow !== undefined) {
    parts.push(`lead boss ≤ ${Math.round(c.bossHpBelow * 100)}% HP`);
  }
  if (c.towerHpBelow !== undefined) {
    parts.push(`tower ≤ ${Math.round(c.towerHpBelow * 100)}% HP`);
  }
  if (parts.length === 0) return 'Always allowed.';
  return `Automation casts when ${parts.join(', ')}. A manual cast ignores this.`;
}

/**
 * Renders the standard stat row (`label | current → next`). `next` is the
 * raw, already-formatted string for the right-hand cell; pass `null` to
 * omit the arrow column (used when the ability is maxed).
 */
function row(label: string, current: string, next: string | null): string {
  if (next === null || next === current) {
    return `<div class="tooltip-row"><span>${label}</span><span>${current}</span></div>`;
  }
  return (
    `<div class="tooltip-row"><span>${label}</span><span>` +
    `${current} <span class="arrow">→</span> <span class="up-val">${next}</span>` +
    `</span></div>`
  );
}

/**
 * Build the absolute-damage Damage row (plan §7.2). Returns `null` when the
 * ability doesn't deal tower-damage multiplier damage, when the player has
 * no base damage to ground the number in, or when the math collapses to
 * zero (defensive).
 *
 * The number excludes enemy armour / resists, the placement-focus damage
 * bonus, and any ability-damage multiplier — those belong to the projectile
 * system, not the tooltip. The tooltip's job is to give the player a number
 * they can reason about, not a number that's "exact" in the wrong sense.
 */
function damageRow(
  def: AbilityDef,
  stats: EffectiveAbilityStats,
  next: EffectiveAbilityStats | null,
  towerDamage: number,
): string | null {
  if (!DAMAGE_EFFECTS.has(def.effectType)) return null;
  if (towerDamage <= 0) return null;
  const perHit = stats.effectValue * towerDamage;
  let total: number;
  if (def.effectType === 'rocket_barrage') {
    const count = Math.floor(stats.count ?? 0);
    total = perHit * count;
  } else {
    total = perHit;
  }
  if (total <= 0) return null;

  let nextTotal: number | null = null;
  if (next !== null) {
    const nextPerHit = next.effectValue * towerDamage;
    if (def.effectType === 'rocket_barrage') {
      const nextCount = Math.floor(next.count ?? 0);
      nextTotal = nextPerHit * nextCount;
    } else {
      nextTotal = nextPerHit;
    }
  }
  return row('Damage', formatInt(total), nextTotal !== null ? formatInt(nextTotal) : null);
}

/**
 * The full ability tooltip — header, description, stat rows, optional
 * cost / auto-cast / XP / unlock rows (plan §7.2).
 *
 * The CSS class hierarchy (`.tooltip-header`, `.tooltip-desc`, `.tooltip-row`,
 * `.tooltip-row--meta`, `.tooltip-cost`) is owned by `main.css`; this file
 * only emits the markup.
 */
export function renderAbilityTooltip(
  def: AbilityDef,
  ctx: AbilityTooltipContext,
): string {
  const { stats, next, cost, canAfford, showCost, towerDamage, xp, xpNeeded } = ctx;
  // `next === null` means the ability is maxed (caller short-circuits) OR
  // `stats.isMaxed` was true when the caller built the context. Either way,
  // the arrow column should not render. The row helper treats null-and-equal
  // identically, so the cost-row's `canAfford` styling still works.
  const n = next;
  const isMaxed = stats.isMaxed;

  const manaCostStr = formatInt(stats.manaCost);
  const nextManaCostStr = n ? formatInt(n.manaCost) : null;

  const cooldownStr = `${stats.cooldown.toFixed(1)}s`;
  const nextCooldownStr = n ? `${n.cooldown.toFixed(1)}s` : null;

  // Plan §7.4: instants (duration === 0) skip the Duration row entirely so
  // the tooltip doesn't claim a five-row "0.0s → 0.0s" stat that lies about
  // whether the ability has a window at all.
  const showDuration = stats.duration > 0 || (n?.duration ?? 0) > 0;
  const durationStr = stats.displayDuration || `${stats.duration.toFixed(1)}s`;
  const nextDurationStr = n ? (n.displayDuration || `${n.duration.toFixed(1)}s`) : null;

  // Effect row: sourced from `displayEffectValue` because that's the same
  // string `computeEffectiveStats` produced — e.g. "6 @ 1.65x" for rocket
  // barrage. We deliberately do *not* reformat it here.
  const curEff = stats.displayEffectValue;
  const nextEff = n ? n.displayEffectValue : null;

  // Header: maxed shows just "— Level N"; the arrow column was the source of
  // the "we're growing" framing, so dropping it on a maxed ability is what
  // the player reads.
  const headerSubtitle = isMaxed
    ? `Level ${stats.level}`
    : `Level ${stats.level} <span class="arrow">→</span> ${stats.level + 1}`;

  // Mana row.
  const manaRow = row('Mana cost', manaCostStr, nextManaCostStr);

  // Effect row. Always emitted — even for non-damage effects (Slow / Gold /
  // Crit chance / Threshold / Lifesteal) it's the row the player tunes.
  const effectRow = row(EFFECT_LABELS[def.effectType], curEff, nextEff);

  // Damage row — only for damage-dealing effects, only when we have a base
  // damage to ground it in.
  const dmgRow = damageRow(def, stats, n, towerDamage);

  // Cooldown row.
  const cooldownRow = row('Cooldown', cooldownStr, nextCooldownStr);

  // Duration row — hidden for instants.
  const durationRow = showDuration ? row('Duration', durationStr, nextDurationStr) : '';

  // Area row — only when the ability is targeted (area > 0). The disc is
  // already pre-scaled to display pixels by the manager.
  const areaRow = stats.area > 0
    ? row('Area', stats.displayArea, n && n.area > 0 ? n.displayArea : null)
    : '';

  // Per-ability extras — current / next both go through the same function.
  // Static extras (Meteor splash, Rocket splash) produce identical strings,
  // and `row()` collapses that case to a no-arrow row.
  const currentExtras = extraRows(def, stats.level);
  const nextExtras = n ? extraRows(def, n.level) : null;
  const extrasHtml = currentExtras
    .map(([label, value], i) => {
      const nextValue = nextExtras?.[i]?.[1] ?? null;
      return row(label, value, nextValue);
    })
    .join('');

  // Cost row. The popover's header button already shows the same number; the
  // tooltip body keeps it for the hover tooltip, where there is no button.
  const affCls = canAfford ? 'can-afford' : 'cannot-afford';
  const costRow = showCost && !isMaxed
    ? `<div class="tooltip-cost ${affCls}">Cost: ${formatInt(cost)}g</div>`
    : '';

  // Auto-cast row — gated on def.autoCast existing (always present in the
  // current roster, but the gate keeps the row out if a future ability has
  // no automation conditions at all).
  const autoCastRow = def.autoCast
    ? `<div class="tooltip-row tooltip-row--meta"><span>Auto-cast</span><span>${describeAutoCast(def.autoCast)}</span></div>`
    : '';

  // XP row — gated on `!isMaxed && xpNeeded > 0`. The popover sets
  // `xpNeeded = 0` so it hides naturally; the panel passes the real curve.
  const xpRow = !isMaxed && xpNeeded > 0
    ? `<div class="tooltip-row tooltip-row--meta"><span>XP to next</span><span>${formatInt(xp)} / ${formatInt(xpNeeded)}</span></div>`
    : '';

  // Unlock row — gated on `def.unlockWave > 10`. Wave 10 is when mana unlocks;
  // the abilities with `unlockWave <= 10` are available immediately, and
  // showing them an "Unlocks at Wave N" row would be misleading.
  const unlockRow = def.unlockWave > 10
    ? `<div class="tooltip-row tooltip-row--meta"><span>Unlocks</span><span>Wave ${def.unlockWave}</span></div>`
    : '';

  return `
    <div class="tooltip-header">${def.name} &mdash; ${headerSubtitle}</div>
    <div class="tooltip-desc">${stats.displayText || def.description}</div>
    ${manaRow}
    ${effectRow}
    ${dmgRow ?? ''}
    ${cooldownRow}
    ${durationRow}
    ${areaRow}
    ${extrasHtml}
    ${costRow}
    ${autoCastRow}
    ${xpRow}
    ${unlockRow}
  `;
}