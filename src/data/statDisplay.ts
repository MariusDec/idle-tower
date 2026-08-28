import type { StatKey } from '../stats/keys';
import type { IconId } from './icons';
import { CODEX_BY_STAT } from './codex';
import { formatInt, formatWithOptionalDecimal } from '../utils/bigNumber';

/** How a resolved number is turned into a string. */
export type StatFormat =
  | 'flat'      // 12.4
  | 'int'       // 12
  | 'pct'       // 12.4%   (value is a 0-1 fraction)
  | 'pctAdd'    // +12%    (a bonus fraction; sign is always shown)
  | 'mult'      // x1.24
  | 'perSec'    // 12.4/s
  | 'seconds'   // 12.4s
  | 'world';    // 300  (world units — range, radius)

export interface StatRowDef {
  key: StatKey;
  label: string;
  format: StatFormat;
  /**
   * Hide the row when the resolved value equals this. Omit to always show.
   * Use the key's STAT_BASES value for anything the player only ever adds to,
   * so an untouched build shows a short list and a stacked one shows a long one.
   */
  hideAt?: number;
  /** Codex entry id, for the row's "?" affordance. */
  codexId?: string;
}

export type StatGroupId = 'offense' | 'defense' | 'kit' | 'economy' | 'magic' | 'meta';

export interface StatGroupDef {
  id: StatGroupId;
  label: string;
  icon: IconId;
  rows: readonly StatRowDef[];
}

type RawRow = Omit<StatRowDef, 'codexId'>;
type RawGroup = Omit<StatGroupDef, 'rows'> & { rows: ReadonlyArray<RawRow> };

const codexForKey = (key: StatKey): string | undefined => CODEX_BY_STAT[key]?.[0];

const RAW_GROUPS: ReadonlyArray<RawGroup> = [
  {
    id: 'offense',
    label: 'Offense',
    icon: 'crossed-swords',
    rows: [
      { key: 'baseDamage', label: 'Damage', format: 'flat' },
      // DPS is rendered by the popup as a derived row.
      { key: 'fireRate', label: 'Fire Rate', format: 'perSec' },
      { key: 'critChance', label: 'Crit Chance', format: 'pct' },
      { key: 'critMultiplier', label: 'Crit Damage', format: 'mult' },
      { key: 'range', label: 'Range', format: 'world' },
      { key: 'armorPen', label: 'Armour Penetration', format: 'pct', hideAt: 0 },
      { key: 'armorPenFlat', label: 'Flat Armour Pen', format: 'flat', hideAt: 0 },
      { key: 'executeThreshold', label: 'Execute Threshold', format: 'pct', hideAt: 0 },
      { key: 'executeMultiplier', label: 'Execute Damage', format: 'pctAdd', hideAt: 0 },
      { key: 'talentExecuteBonus', label: 'Talent Execute Bonus', format: 'pctAdd', hideAt: 0 },
      { key: 'focusStackBonus', label: 'Focus Bonus', format: 'pctAdd', hideAt: 0 },
      { key: 'killFrenzyPerStack', label: 'Kill Frenzy', format: 'pctAdd', hideAt: 0 },
      { key: 'overwatchDamage', label: 'Overwatch Damage', format: 'pctAdd', hideAt: 0 },
      { key: 'bossDamageBonus', label: 'Boss Damage', format: 'pctAdd', hideAt: 0 },
      { key: 'critFollowUpChance', label: 'Crit Follow-Up', format: 'pct', hideAt: 0 },
      { key: 'chilledDamageBonus', label: 'Chilled Damage', format: 'pctAdd', hideAt: 0 },
      { key: 'lowHpDamageBonus', label: 'Desperation', format: 'pctAdd', hideAt: 0 },
      { key: 'instantKillChance', label: 'Instant Kill', format: 'pct', hideAt: 0 },
      { key: 'critSplash', label: 'Splash on Crit', format: 'pctAdd', hideAt: 0 },
      { key: 'critIgnoreArmor', label: 'Ignore Armour on Crit', format: 'pct', hideAt: 0 },
    ],
  },
  {
    id: 'defense',
    label: 'Defense',
    icon: 'bordered-shield',
    rows: [
      // Health (hp / maxHp) and Health Regen (maxHp * healthRegen / s) are
      // derived rows rendered by the popup; the raw `healthRegen` row is
      // superseded by the derived one and is intentionally omitted.
      { key: 'defense', label: 'Defense', format: 'flat' },
      { key: 'armor', label: 'Armour', format: 'pct' },
      { key: 'dodgeChance', label: 'Dodge', format: 'pct', hideAt: 0 },
      { key: 'thorns', label: 'Thorns', format: 'pct', hideAt: 0 },
      { key: 'lifesteal', label: 'Lifesteal', format: 'pct', hideAt: 0 },
      { key: 'manaShieldFraction', label: 'Mana Shield', format: 'pct', hideAt: 0 },
      { key: 'shieldMaxCharges', label: 'Shield Charges', format: 'int', hideAt: 0 },
      { key: 'shieldRechargeTime', label: 'Shield Recharge', format: 'seconds', hideAt: 0 },
      { key: 'shieldRechargeReduction', label: 'Shield Recharge Speed', format: 'pct', hideAt: 0 },
      { key: 'wallFraction', label: 'Wall', format: 'pct', hideAt: 0 },
      { key: 'wallRegen', label: 'Wall Regen', format: 'perSec', hideAt: 0 },
      { key: 'wallContactExtra', label: 'Wall Contact Damage', format: 'world', hideAt: 0 },
      { key: 'knockbackForce', label: 'Knockback', format: 'flat', hideAt: 0 },
      { key: 'reviveCharges', label: 'Revive Charges', format: 'int', hideAt: 0 },
      { key: 'secondWindPower', label: 'Second Wind', format: 'pctAdd', hideAt: 0 },
    ],
  },
  {
    id: 'kit',
    label: 'Shot & Kit',
    icon: 'arrow-cluster',
    rows: [
      { key: 'doubleShotChance', label: 'Double Shot', format: 'pct', hideAt: 0 },
      { key: 'extraProjectileChance', label: 'Extra Projectile', format: 'pct', hideAt: 0 },
      { key: 'quickShotChance', label: 'Quick Shot', format: 'pct', hideAt: 0 },
      { key: 'quickShotTime', label: 'Quick Shot Time', format: 'seconds', hideAt: 0 },
      { key: 'pierceExtra', label: 'Pierce', format: 'int', hideAt: 0 },
      { key: 'shotSplashRadius', label: 'Splash Radius', format: 'world', hideAt: 0 },
      { key: 'shotSplashFraction', label: 'Splash Fraction', format: 'pct', hideAt: 0 },
      { key: 'magicProcChance', label: 'Magic Proc', format: 'pct', hideAt: 0 },
      { key: 'shockwaveSize', label: 'Shockwave Size', format: 'world', hideAt: 0 },
      { key: 'shockwaveCooldown', label: 'Shockwave Cooldown', format: 'seconds', hideAt: 0 },
      { key: 'landMineDamage', label: 'Land Mine Damage', format: 'flat', hideAt: 0 },
      { key: 'landMineFrequency', label: 'Land Mine Frequency', format: 'perSec', hideAt: 0 },
    ],
  },
  {
    id: 'economy',
    label: 'Economy',
    icon: 'two-coins',
    rows: [
      { key: 'goldMultiplier', label: 'Gold Multiplier', format: 'mult' },
      { key: 'goldOnKill', label: 'Gold on Kill', format: 'flat', hideAt: 0 },
      { key: 'critGold', label: 'Crit Gold', format: 'pctAdd', hideAt: 0 },
      { key: 'waveGold', label: 'Wave Clear Gold', format: 'flat', hideAt: 0 },
      { key: 'goldLuckChance', label: 'Gold Luck', format: 'pct', hideAt: 0 },
      { key: 'doubleGoldChance', label: 'Double Gold', format: 'pct', hideAt: 0 },
      { key: 'orbValueBonus', label: 'Orb Value', format: 'pctAdd', hideAt: 0 },
      { key: 'momentumGainBonus', label: 'Momentum', format: 'pctAdd', hideAt: 0 },
      { key: 'windfallMultiplier', label: 'Windfall', format: 'mult', hideAt: 1 },
      { key: 'interestRate', label: 'Interest', format: 'pct', hideAt: 0 },
      { key: 'upgradeCostDiscount', label: 'Upgrade Discount', format: 'pct', hideAt: 0 },
      { key: 'equipmentFindChance', label: 'Equipment Find', format: 'pct', hideAt: 0 },
      { key: 'xpGainMultiplier', label: 'XP Gain', format: 'mult', hideAt: 1 },
      // RP Gain is a derived row rendered by the popup.
    ],
  },
  {
    id: 'magic',
    label: 'Magic',
    icon: 'magic-swirl',
    rows: [
      { key: 'maxMana', label: 'Max Mana', format: 'int' },
      { key: 'manaRegen', label: 'Mana Regen', format: 'perSec' },
      { key: 'abilityCostMultiplier', label: 'Ability Cost', format: 'mult', hideAt: 1 },
      { key: 'abilityCooldownMultiplier', label: 'Ability Cooldown', format: 'mult', hideAt: 1 },
      { key: 'abilityDamageMultiplier', label: 'Ability Damage', format: 'mult', hideAt: 1 },
      { key: 'abilityAreaMultiplier', label: 'Ability Area', format: 'mult', hideAt: 1 },
      { key: 'buffDurationBonus', label: 'Buff Duration', format: 'pctAdd', hideAt: 0 },
      { key: 'abilityEchoChance', label: 'Echo', format: 'pct', hideAt: 0 },
      { key: 'manaOnKillFraction', label: 'Soul Harvest', format: 'pct', hideAt: 0 },
      { key: 'berserkFireBonus', label: 'Berserk Fire Bonus', format: 'pctAdd', hideAt: 0 },
      { key: 'chainBounceBonus', label: 'Chain Bounces', format: 'int', hideAt: 0 },
      { key: 'slowStrengthBonus', label: 'Slow Strength', format: 'pctAdd', hideAt: 0 },
      { key: 'meteorDamageBonus', label: 'Meteor Damage', format: 'pctAdd', hideAt: 0 },
    ],
  },
  {
    id: 'meta',
    label: 'Run',
    icon: 'swords-emblem',
    rows: [
      // Targeting mode is a derived row rendered by the popup.
      { key: 'waveSkipChance', label: 'Wave Skip', format: 'pct', hideAt: 0 },
      { key: 'intermissionMultiplier', label: 'Intermission', format: 'mult', hideAt: 1 },
      { key: 'headStartWaves', label: 'Head Start Waves', format: 'int', hideAt: 0 },
      { key: 'enemyHpReduction', label: 'Enemy HP Reduction', format: 'pct', hideAt: 0 },
      { key: 'enemyHpMult', label: 'Enemy HP Multiplier', format: 'mult', hideAt: 1 },
      { key: 'enemySpeedMult', label: 'Enemy Speed Multiplier', format: 'mult', hideAt: 1 },
      { key: 'enemyDamageMult', label: 'Enemy Damage Multiplier', format: 'mult', hideAt: 1 },
      { key: 'rpDropChanceBonus', label: 'RP Drop Chance', format: 'pct', hideAt: 0 },
      { key: 'autoBuyIntervalReduction', label: 'Automation Speed', format: 'pct', hideAt: 0 },
    ],
  },
];

export const STAT_GROUPS: readonly StatGroupDef[] = RAW_GROUPS.map((g) => ({
  ...g,
  rows: g.rows.map((r) => ({ ...r, codexId: codexForKey(r.key) })),
}));

/** Flat lookup for the Codex's stat chips and the row "?" links. */
export const STAT_ROW_BY_KEY: Readonly<Partial<Record<StatKey, StatRowDef>>> = (() => {
  const out: Partial<Record<StatKey, StatRowDef>> = {};
  for (const g of STAT_GROUPS) for (const r of g.rows) out[r.key] = r;
  return out;
})();

export function formatStatValue(value: number, format: StatFormat): string {
  switch (format) {
    case 'flat':    return formatWithOptionalDecimal(value);
    case 'int':     return formatInt(value);
    case 'pct':     return `${(value * 100).toFixed(1)}%`;
    case 'pctAdd':  return `${value >= 0 ? '+' : ''}${Math.round(value * 100)}%`;
    case 'mult':    return `${value.toFixed(2)}x`;
    case 'perSec':  return `${formatWithOptionalDecimal(value, 2)}/s`;
    case 'seconds': return `${value.toFixed(2)}s`;
    case 'world':   return `${Math.round(value)}`;
  }
}
