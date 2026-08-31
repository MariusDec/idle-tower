import type { EquipmentSlot, Rarity, EquipmentDef, Equipment, EquipmentStat, EquipmentStatType } from '../types';
import type { IconId } from './icons';
import { RARITY } from './palette';

// ── Rarity Configuration ──────────────────────────────

/**
 * Every stat gear can roll. Shared with the equipment contributor in the stat
 * pipeline so the two cannot drift apart.
 */
export const EQUIPMENT_STAT_TYPES: readonly EquipmentStatType[] = [
  'damage_pct', 'fire_rate_pct', 'crit_chance_pct', 'crit_damage_pct',
  'range_pct', 'max_hp_pct', 'defense_pct', 'armor_pct',
  'gold_mult_pct', 'mana_regen_pct', 'lifesteal_pct', 'thorns_pct',
  'knockback_pct', 'all_damage_pct',
];

export const RARITY_WEIGHTS: Record<Rarity, number> = {
  common: 50,
  uncommon: 30,
  rare: 15,
  epic: 4,
  legendary: 1,
};

/**
 * The rarity ladder's colours. Re-exported from `palette.ts` rather than typed
 * again here: the same five colours also frame blessing cards and are declared
 * as `--rarity-*` in `tokens.css`, and three independent copies of "what colour
 * is epic" is how a palette drifts.
 */
export const RARITY_COLORS: Record<Rarity, string> = RARITY;

/** Rarity ladder, weakest first. `upgradeRarity` walks it. */
export const RARITY_ORDER: readonly Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

/**
 * Bump a rolled rarity up the ladder, clamped at `legendary`.
 *
 * Used by the swift-kill boss reward (gameplay plan §3.4): the roll is the
 * normal one, so gear still tracks the wave, and the reward is that it lands
 * one tier better than it would have.
 */
export function upgradeRarity(rarity: Rarity, steps = 1): Rarity {
  const index = RARITY_ORDER.indexOf(rarity);
  if (index < 0) return rarity;
  return RARITY_ORDER[Math.min(RARITY_ORDER.length - 1, index + Math.max(0, steps))];
}

export const RARITY_NAMES: Record<Rarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
};

/**
 * Slot icons (UI plan §6.2).
 *
 * The slot is what an empty socket shows, so it has to read as the *kind* of
 * thing that goes there rather than as any one item — a crossbow for the
 * turret, a plain shield for the bulwark.
 */
export const SLOT_ICONS: Record<EquipmentSlot, IconId> = {
  turret: 'crossbow',
  bulwark: 'shield',
  arsenal: 'quiver',
  brazier: 'fire-bowl',
  vault: 'locked-chest',
  machinery: 'gears',
  banner: 'vertical-banner',
  core: 'crystal-shine',
};

/**
 * Rarity icons. The *frame* carries the tier colour (`.icon-frame[data-rarity]`
 * in `main.css`); this ladder is for the places that name a tier in text —
 * legends, filters, the drop toast — and escalates in ornament, not in hue.
 */
export const RARITY_ICONS: Record<Rarity, IconId> = {
  common: 'flat-star',
  uncommon: 'round-star',
  rare: 'beveled-star',
  epic: 'barbed-star',
  legendary: 'star-formation',
};

let _nextEquipmentId = 1;
function nextEquipmentId(): string {
  return `eq_${_nextEquipmentId++}_${Date.now()}`;
}

// ── Equipment Definitions ─────────────────────────────

export const EQUIPMENT_DEFS: EquipmentDef[] = [
  // Turret
  {
    id: 'iron_bow',
    name: 'Iron Bow',
    description: 'A sturdy bow with reliable power.',
    slot: 'turret',
    baseStats: {
      common: [{ type: 'damage_pct', value: 5 }],
      uncommon: [{ type: 'damage_pct', value: 8 }],
      rare: [{ type: 'damage_pct', value: 12 }, { type: 'crit_chance_pct', value: 3 }],
      epic: [{ type: 'damage_pct', value: 18 }, { type: 'crit_chance_pct', value: 5 }],
      legendary: [{ type: 'damage_pct', value: 25 }, { type: 'crit_chance_pct', value: 8 }, { type: 'fire_rate_pct', value: 5 }],
    },
    maxLevel: 20,
    upgradeCostGrowth: 1.5,
    icon: 'pocket-bow',
    color: '#888888',
    minWave: 1,
  },
  {
    id: 'arcane_focus',
    name: 'Arcane Focus',
    description: 'Channels arcane energy into powerful strikes.',
    slot: 'turret',
    baseStats: {
      common: [{ type: 'damage_pct', value: 4 }],
      uncommon: [{ type: 'damage_pct', value: 7 }],
      rare: [{ type: 'damage_pct', value: 10 }, { type: 'all_damage_pct', value: 3 }],
      epic: [{ type: 'damage_pct', value: 15 }, { type: 'all_damage_pct', value: 5 }],
      legendary: [{ type: 'damage_pct', value: 22 }, { type: 'all_damage_pct', value: 8 }, { type: 'mana_regen_pct', value: 5 }],
    },
    maxLevel: 20,
    upgradeCostGrowth: 1.5,
    icon: 'orb-wand',
    color: '#9b59b6',
    minWave: 10,
  },
  // Bulwark
  {
    id: 'stone_revetment',
    name: 'Stone Revetment',
    description: 'Basic protection for the tower.',
    slot: 'bulwark',
    baseStats: {
      common: [{ type: 'max_hp_pct', value: 5 }],
      uncommon: [{ type: 'max_hp_pct', value: 8 }],
      rare: [{ type: 'max_hp_pct', value: 12 }, { type: 'defense_pct', value: 3 }],
      epic: [{ type: 'max_hp_pct', value: 18 }, { type: 'defense_pct', value: 5 }],
      legendary: [{ type: 'max_hp_pct', value: 25 }, { type: 'defense_pct', value: 8 }, { type: 'thorns_pct', value: 5 }],
    },
    maxLevel: 20,
    upgradeCostGrowth: 1.5,
    icon: 'stone-wall',
    color: '#888888',
    minWave: 1,
  },
  {
    id: 'iron_plating',
    name: 'Iron Plating',
    description: 'Heavy metal plating for maximum defense.',
    slot: 'bulwark',
    baseStats: {
      common: [{ type: 'defense_pct', value: 5 }],
      uncommon: [{ type: 'defense_pct', value: 8 }],
      rare: [{ type: 'defense_pct', value: 12 }, { type: 'max_hp_pct', value: 5 }],
      epic: [{ type: 'defense_pct', value: 18 }, { type: 'max_hp_pct', value: 8 }],
      legendary: [{ type: 'defense_pct', value: 25 }, { type: 'max_hp_pct', value: 12 }, { type: 'armor_pct', value: 5 }],
    },
    maxLevel: 20,
    upgradeCostGrowth: 1.5,
    icon: 'metal-plate',
    color: '#5d6d7e',
    minWave: 15,
  },
  // Arsenal
  {
    id: 'enchanted_quiver',
    name: 'Enchanted Quiver',
    description: 'A ring crackling with raw energy.',
    slot: 'arsenal',
    baseStats: {
      common: [{ type: 'all_damage_pct', value: 3 }],
      uncommon: [{ type: 'all_damage_pct', value: 5 }],
      rare: [{ type: 'all_damage_pct', value: 8 }, { type: 'crit_damage_pct', value: 5 }],
      epic: [{ type: 'all_damage_pct', value: 12 }, { type: 'crit_damage_pct', value: 8 }],
      legendary: [{ type: 'all_damage_pct', value: 18 }, { type: 'crit_damage_pct', value: 12 }, { type: 'fire_rate_pct', value: 5 }],
    },
    maxLevel: 15,
    upgradeCostGrowth: 1.6,
    icon: 'arrow-flights',
    color: '#f1c40f',
    minWave: 5,
  },
  {
    id: 'moonlit_brazier',
    name: 'Moonlit Brazier',
    description: 'Grants enhanced mana regeneration.',
    slot: 'brazier',
    baseStats: {
      common: [{ type: 'mana_regen_pct', value: 5 }],
      uncommon: [{ type: 'mana_regen_pct', value: 8 }],
      rare: [{ type: 'mana_regen_pct', value: 12 }, { type: 'max_hp_pct', value: 3 }],
      epic: [{ type: 'mana_regen_pct', value: 18 }, { type: 'max_hp_pct', value: 5 }],
      legendary: [{ type: 'mana_regen_pct', value: 25 }, { type: 'max_hp_pct', value: 8 }, { type: 'all_damage_pct', value: 5 }],
    },
    maxLevel: 15,
    upgradeCostGrowth: 1.6,
    icon: 'lantern-flame',
    color: '#5b8def',
    minWave: 10,
  },
  // Vault
  {
    id: 'ancient_relic',
    name: 'Ancient Relic',
    description: 'A mysterious artifact of immense power.',
    slot: 'vault',
    baseStats: {
      common: [{ type: 'gold_mult_pct', value: 5 }],
      uncommon: [{ type: 'gold_mult_pct', value: 8 }],
      rare: [{ type: 'gold_mult_pct', value: 12 }, { type: 'lifesteal_pct', value: 2 }],
      epic: [{ type: 'gold_mult_pct', value: 18 }, { type: 'lifesteal_pct', value: 3 }],
      legendary: [{ type: 'gold_mult_pct', value: 25 }, { type: 'lifesteal_pct', value: 5 }, { type: 'knockback_pct', value: 10 }],
    },
    maxLevel: 15,
    upgradeCostGrowth: 1.6,
    icon: 'glowing-artifact',
    color: '#e67e22',
    minWave: 15,
    bossOnly: true,
  },
  // Machinery
  {
    id: 'swift_gears',
    name: 'Swift Gears',
    description: 'Precision gears that increase attack speed.',
    slot: 'machinery',
    baseStats: {
      common: [{ type: 'fire_rate_pct', value: 3 }],
      uncommon: [{ type: 'fire_rate_pct', value: 5 }],
      rare: [{ type: 'fire_rate_pct', value: 8 }, { type: 'range_pct', value: 3 }],
      epic: [{ type: 'fire_rate_pct', value: 12 }, { type: 'range_pct', value: 5 }],
      legendary: [{ type: 'fire_rate_pct', value: 18 }, { type: 'range_pct', value: 8 }, { type: 'crit_chance_pct', value: 3 }],
    },
    maxLevel: 15,
    upgradeCostGrowth: 1.6,
    icon: 'clockwork',
    color: '#3498db',
    minWave: 8,
  },
  // Banner
  {
    id: 'guardian_banner',
    name: 'Guardian Banner',
    description: 'A banner that bolsters tower defenses.',
    slot: 'banner',
    baseStats: {
      common: [{ type: 'max_hp_pct', value: 4 }],
      uncommon: [{ type: 'max_hp_pct', value: 6 }],
      rare: [{ type: 'max_hp_pct', value: 10 }, { type: 'armor_pct', value: 3 }],
      epic: [{ type: 'max_hp_pct', value: 15 }, { type: 'armor_pct', value: 5 }],
      legendary: [{ type: 'max_hp_pct', value: 22 }, { type: 'armor_pct', value: 8 }, { type: 'thorns_pct', value: 5 }],
    },
    maxLevel: 15,
    upgradeCostGrowth: 1.6,
    icon: 'knight-banner',
    color: '#f1c40f',
    minWave: 12,
  },
  // Core
  {
    id: 'emerald_core',
    name: 'Emerald Core',
    description: 'A core pulsing with natural energy.',
    slot: 'core',
    baseStats: {
      common: [{ type: 'crit_chance_pct', value: 2 }],
      uncommon: [{ type: 'crit_chance_pct', value: 3 }],
      rare: [{ type: 'crit_chance_pct', value: 5 }, { type: 'crit_damage_pct', value: 5 }],
      epic: [{ type: 'crit_chance_pct', value: 8 }, { type: 'crit_damage_pct', value: 8 }],
      legendary: [{ type: 'crit_chance_pct', value: 12 }, { type: 'crit_damage_pct', value: 12 }, { type: 'all_damage_pct', value: 5 }],
    },
    maxLevel: 15,
    upgradeCostGrowth: 1.6,
    icon: 'floating-crystal',
    color: '#2ecc71',
    minWave: 18,
    bossOnly: true,
  },
];

export const EQUIPMENT_DEF_BY_ID: Record<string, EquipmentDef> = EQUIPMENT_DEFS.reduce(
  (acc, d) => { acc[d.id] = d; return acc; },
  {} as Record<string, EquipmentDef>,
);

// ── Generation Functions ──────────────────────────────

/** Roll a rarity based on current wave, using weighted random. */
export function rollRarity(wave: number): Rarity {
  const t = Math.min(1, Math.max(0, (wave - 1) / 99));

  const early: Record<Rarity, number> = {
    common: 90,
    uncommon: 8,
    rare: 2,
    epic: 0,
    legendary: 0,
  };
  const late: Record<Rarity, number> = {
    common: 20,
    uncommon: 20,
    rare: 35,
    epic: 15,
    legendary: 10,
  };

  const weights: Record<Rarity, number> = {
    common: early.common + (late.common - early.common) * t,
    uncommon: early.uncommon + (late.uncommon - early.uncommon) * t,
    rare: early.rare + (late.rare - early.rare) * t,
    epic: early.epic + (late.epic - early.epic) * t,
    legendary: early.legendary + (late.legendary - early.legendary) * t,
  };

  const total = Object.values(weights).reduce((s, v) => s + v, 0);
  let roll = Math.random() * total;
  for (const [rarity, weight] of Object.entries(weights)) {
    roll -= weight;
    if (roll <= 0) return rarity as Rarity;
  }
  return 'common';
}

/** Pick a random equipment definition filtered by slot and minWave. */
export function rollEquipmentDef(slot?: EquipmentSlot, minWave?: number): EquipmentDef {
  let pool = EQUIPMENT_DEFS;
  if (slot) pool = pool.filter(d => d.slot === slot);
  if (minWave) pool = pool.filter(d => d.minWave <= minWave);
  if (pool.length === 0) pool = EQUIPMENT_DEFS;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Generate the stat array for a def + rarity. Rarity is already expressed by
 * the per-rarity `baseStats` entry, so the only adjustment here is ±20% roll
 * variance between two items of the same name and rarity.
 */
function rollStats(def: EquipmentDef, rarity: Rarity): EquipmentStat[] {
  const baseStats = def.baseStats[rarity] ?? [];
  return baseStats.map(s => ({
    type: s.type,
    value: Math.round(s.value * (1 + (Math.random() * 0.4 - 0.2)) * 10) / 10,
  }));
}

/** Create a fully generated Equipment instance from a defId and rarity. */
export function generateEquipment(defId: string, rarity: Rarity): Equipment {
  const def = EQUIPMENT_DEF_BY_ID[defId];
  if (!def) throw new Error(`Unknown equipment def: ${defId}`);
  return {
    id: nextEquipmentId(),
    defId,
    slot: def.slot,
    rarity,
    level: 1,
    stats: rollStats(def, rarity),
    seen: false,
  };
}

/**
 * Attempt to roll a random equipment drop (returns null if roll fails).
 *
 * Plan §3.4 adds the `elite` source: elites are far more common than bosses, so
 * they roll on a much shallower curve (4% + 0.1%/wave, capped at 15%) — enough
 * that a deep run builds a set from elites, not so much that gear stops
 * mattering.
 */
/**
 * Overrides for a single drop roll (gameplay plan §3.4).
 *
 * `guaranteed` skips the chance gate; `rarityBoost` bumps the *rolled* rarity
 * rather than replacing the roll, so the reward still tracks the wave.
 */
export interface DropOptions {
  guaranteed?: boolean;
  rarityBoost?: number;
}

/**
 * Base drop chance for an *elite* kill (plans/economy.md §3).
 *
 * Flat in wave. It used to be `min(0.15, 0.04 + wave * 0.001 + bonus)`, which
 * ramped with depth on top of an elite population that itself grows with depth
 * — ~9.7 elites walk into a wave-65 wave, so the two ramps multiplied into
 * more than a piece of gear per wave before the boss even spawned.
 */
export const ELITE_DROP_CHANCE = 0.12;
export const ELITE_DROP_CHANCE_CAP = 0.25;

/** Base drop chance for a *boss* kill. Also flat; also capped. */
export const BOSS_DROP_CHANCE = 0.30;
export const BOSS_DROP_CHANCE_CAP = 0.60;

/** A milestone chest is the guaranteed source; it is not a chance roll. */
export const MILESTONE_DROP_CHANCE = 1.0;

export function rollDrop(
  wave: number,
  source: 'boss' | 'elite' | 'milestone',
  bonusChance = 0,
  options: DropOptions = {},
): Equipment | null {
  const boost = Math.max(0, options.rarityBoost ?? 0);
  const guaranteed = options.guaranteed === true;
  const bonus = Math.max(0, bonusChance);

  const chance = source === 'elite'
    ? Math.min(ELITE_DROP_CHANCE_CAP, ELITE_DROP_CHANCE + bonus)
    : source === 'boss'
      ? Math.min(BOSS_DROP_CHANCE_CAP, BOSS_DROP_CHANCE + bonus)
      : MILESTONE_DROP_CHANCE;

  if (!guaranteed && Math.random() > chance) return null;

  const rarity = upgradeRarity(rollRarity(wave), boost);
  // Only items whose minWave has been reached can drop; boss-only items are
  // additionally restricted to boss kills.
  let dropPool = EQUIPMENT_DEFS.filter(d => d.minWave <= wave);
  if (source !== 'boss') dropPool = dropPool.filter(d => !d.bossOnly);
  if (dropPool.length === 0) return null;
  const def = dropPool[Math.floor(Math.random() * dropPool.length)];
  return generateEquipment(def.id, rarity);
}
