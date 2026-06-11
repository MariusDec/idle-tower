import type { EquipmentSlot, Rarity, EquipmentDef, Equipment, EquipmentStat } from '../types';

// ── Rarity Configuration ──────────────────────────────

export const RARITY_WEIGHTS: Record<Rarity, number> = {
  common: 50,
  uncommon: 30,
  rare: 15,
  epic: 4,
  legendary: 1,
};

export const RARITY_MULTIPLIERS: Record<Rarity, number> = {
  common: 1, // 1
  uncommon: 1, // 1.5
  rare: 1, // 2.2
  epic: 1, // 3.5
  legendary: 1, // 6
};

export const RARITY_COLORS: Record<Rarity, string> = {
  common: '#888888',
  uncommon: '#2ecc71',
  rare: '#3498db',
  epic: '#9b59b6',
  legendary: '#f1c40f',
};

export const RARITY_NAMES: Record<Rarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
};

let _nextEquipmentId = 1;
function nextEquipmentId(): string {
  return `eq_${_nextEquipmentId++}_${Date.now()}`;
}

// ── Equipment Definitions ─────────────────────────────

export const EQUIPMENT_DEFS: EquipmentDef[] = [
  // Weapon
  {
    id: 'iron_bow',
    name: 'Iron Bow',
    description: 'A sturdy bow with reliable power.',
    slot: 'weapon',
    baseStats: {
      common: [{ type: 'damage_pct', value: 5 }],
      uncommon: [{ type: 'damage_pct', value: 8 }],
      rare: [{ type: 'damage_pct', value: 12 }, { type: 'crit_chance_pct', value: 3 }],
      epic: [{ type: 'damage_pct', value: 18 }, { type: 'crit_chance_pct', value: 5 }],
      legendary: [{ type: 'damage_pct', value: 25 }, { type: 'crit_chance_pct', value: 8 }, { type: 'fire_rate_pct', value: 5 }],
    },
    maxLevel: 20,
    upgradeCostGrowth: 1.5,
    sprite: 'sprites/equipment/iron_bow.svg',
    color: '#888888',
    minWave: 1,
  },
  {
    id: 'crystal_staff',
    name: 'Crystal Staff',
    description: 'Channels arcane energy into powerful strikes.',
    slot: 'weapon',
    baseStats: {
      common: [{ type: 'damage_pct', value: 4 }],
      uncommon: [{ type: 'damage_pct', value: 7 }],
      rare: [{ type: 'damage_pct', value: 10 }, { type: 'all_damage_pct', value: 3 }],
      epic: [{ type: 'damage_pct', value: 15 }, { type: 'all_damage_pct', value: 5 }],
      legendary: [{ type: 'damage_pct', value: 22 }, { type: 'all_damage_pct', value: 8 }, { type: 'mana_regen_pct', value: 5 }],
    },
    maxLevel: 20,
    upgradeCostGrowth: 1.5,
    sprite: 'sprites/equipment/crystal_staff.svg',
    color: '#9b59b6',
    minWave: 10,
  },
  // Armor
  {
    id: 'leather_vest',
    name: 'Leather Vest',
    description: 'Basic protection for the tower.',
    slot: 'armor',
    baseStats: {
      common: [{ type: 'max_hp_pct', value: 5 }],
      uncommon: [{ type: 'max_hp_pct', value: 8 }],
      rare: [{ type: 'max_hp_pct', value: 12 }, { type: 'defense_pct', value: 3 }],
      epic: [{ type: 'max_hp_pct', value: 18 }, { type: 'defense_pct', value: 5 }],
      legendary: [{ type: 'max_hp_pct', value: 25 }, { type: 'defense_pct', value: 8 }, { type: 'thorns_pct', value: 5 }],
    },
    maxLevel: 20,
    upgradeCostGrowth: 1.5,
    sprite: 'sprites/equipment/leather_vest.svg',
    color: '#888888',
    minWave: 1,
  },
  {
    id: 'plate_armor',
    name: 'Plate Armor',
    description: 'Heavy metal plating for maximum defense.',
    slot: 'armor',
    baseStats: {
      common: [{ type: 'defense_pct', value: 5 }],
      uncommon: [{ type: 'defense_pct', value: 8 }],
      rare: [{ type: 'defense_pct', value: 12 }, { type: 'max_hp_pct', value: 5 }],
      epic: [{ type: 'defense_pct', value: 18 }, { type: 'max_hp_pct', value: 8 }],
      legendary: [{ type: 'defense_pct', value: 25 }, { type: 'max_hp_pct', value: 12 }, { type: 'armor_pct', value: 5 }],
    },
    maxLevel: 20,
    upgradeCostGrowth: 1.5,
    sprite: 'sprites/equipment/plate_armor.svg',
    color: '#5d6d7e',
    minWave: 15,
  },
  // Accessory 1 & 2
  {
    id: 'ring_of_power',
    name: 'Ring of Power',
    description: 'A ring crackling with raw energy.',
    slot: 'accessory_1',
    baseStats: {
      common: [{ type: 'all_damage_pct', value: 3 }],
      uncommon: [{ type: 'all_damage_pct', value: 5 }],
      rare: [{ type: 'all_damage_pct', value: 8 }, { type: 'crit_damage_pct', value: 5 }],
      epic: [{ type: 'all_damage_pct', value: 12 }, { type: 'crit_damage_pct', value: 8 }],
      legendary: [{ type: 'all_damage_pct', value: 18 }, { type: 'crit_damage_pct', value: 12 }, { type: 'fire_rate_pct', value: 5 }],
    },
    maxLevel: 15,
    upgradeCostGrowth: 1.6,
    sprite: 'sprites/equipment/ring_of_power.svg',
    color: '#f1c40f',
    minWave: 5,
  },
  {
    id: 'moon_pendant',
    name: 'Moon Pendant',
    description: 'Grants enhanced mana regeneration.',
    slot: 'accessory_2',
    baseStats: {
      common: [{ type: 'mana_regen_pct', value: 5 }],
      uncommon: [{ type: 'mana_regen_pct', value: 8 }],
      rare: [{ type: 'mana_regen_pct', value: 12 }, { type: 'max_hp_pct', value: 3 }],
      epic: [{ type: 'mana_regen_pct', value: 18 }, { type: 'max_hp_pct', value: 5 }],
      legendary: [{ type: 'mana_regen_pct', value: 25 }, { type: 'max_hp_pct', value: 8 }, { type: 'all_damage_pct', value: 5 }],
    },
    maxLevel: 15,
    upgradeCostGrowth: 1.6,
    sprite: 'sprites/equipment/moon_pendant.svg',
    color: '#5b8def',
    minWave: 10,
  },
  // Relic
  {
    id: 'ancient_relic',
    name: 'Ancient Relic',
    description: 'A mysterious artifact of immense power.',
    slot: 'relic',
    baseStats: {
      common: [{ type: 'gold_mult_pct', value: 5 }],
      uncommon: [{ type: 'gold_mult_pct', value: 8 }],
      rare: [{ type: 'gold_mult_pct', value: 12 }, { type: 'lifesteal_pct', value: 2 }],
      epic: [{ type: 'gold_mult_pct', value: 18 }, { type: 'lifesteal_pct', value: 3 }],
      legendary: [{ type: 'gold_mult_pct', value: 25 }, { type: 'lifesteal_pct', value: 5 }, { type: 'knockback_pct', value: 10 }],
    },
    maxLevel: 15,
    upgradeCostGrowth: 1.6,
    sprite: 'sprites/equipment/ancient_relic.svg',
    color: '#e67e22',
    minWave: 15,
    bossOnly: true,
  },
  // Boots
  {
    id: 'swift_boots',
    name: 'Swift Boots',
    description: 'Enchanted boots that increase attack speed.',
    slot: 'boots',
    baseStats: {
      common: [{ type: 'fire_rate_pct', value: 3 }],
      uncommon: [{ type: 'fire_rate_pct', value: 5 }],
      rare: [{ type: 'fire_rate_pct', value: 8 }, { type: 'range_pct', value: 3 }],
      epic: [{ type: 'fire_rate_pct', value: 12 }, { type: 'range_pct', value: 5 }],
      legendary: [{ type: 'fire_rate_pct', value: 18 }, { type: 'range_pct', value: 8 }, { type: 'crit_chance_pct', value: 3 }],
    },
    maxLevel: 15,
    upgradeCostGrowth: 1.6,
    sprite: 'sprites/equipment/swift_boots.svg',
    color: '#3498db',
    minWave: 8,
  },
  // Helmet
  {
    id: 'guardian_crown',
    name: 'Guardian Crown',
    description: 'A crown that bolsters tower defenses.',
    slot: 'helmet',
    baseStats: {
      common: [{ type: 'max_hp_pct', value: 4 }],
      uncommon: [{ type: 'max_hp_pct', value: 6 }],
      rare: [{ type: 'max_hp_pct', value: 10 }, { type: 'armor_pct', value: 3 }],
      epic: [{ type: 'max_hp_pct', value: 15 }, { type: 'armor_pct', value: 5 }],
      legendary: [{ type: 'max_hp_pct', value: 22 }, { type: 'armor_pct', value: 8 }, { type: 'thorns_pct', value: 5 }],
    },
    maxLevel: 15,
    upgradeCostGrowth: 1.6,
    sprite: 'sprites/equipment/guardian_crown.svg',
    color: '#f1c40f',
    minWave: 12,
  },
  // Ring
  {
    id: 'emerald_band',
    name: 'Emerald Band',
    description: 'A band pulsing with natural energy.',
    slot: 'ring',
    baseStats: {
      common: [{ type: 'crit_chance_pct', value: 2 }],
      uncommon: [{ type: 'crit_chance_pct', value: 3 }],
      rare: [{ type: 'crit_chance_pct', value: 5 }, { type: 'crit_damage_pct', value: 5 }],
      epic: [{ type: 'crit_chance_pct', value: 8 }, { type: 'crit_damage_pct', value: 8 }],
      legendary: [{ type: 'crit_chance_pct', value: 12 }, { type: 'crit_damage_pct', value: 12 }, { type: 'all_damage_pct', value: 5 }],
    },
    maxLevel: 15,
    upgradeCostGrowth: 1.6,
    sprite: 'sprites/equipment/emerald_band.svg',
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
  const waveBonus = Math.min(0.3, wave * 0.001);
  const weights: Record<Rarity, number> = {
    common: Math.max(5, RARITY_WEIGHTS.common * (1 - waveBonus)),
    uncommon: RARITY_WEIGHTS.uncommon * (1 + waveBonus),
    rare: RARITY_WEIGHTS.rare * (1 + waveBonus * 1.5),
    epic: RARITY_WEIGHTS.epic * (1 + waveBonus * 2),
    legendary: RARITY_WEIGHTS.legendary * (1 + waveBonus * 3),
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

/** Generate stat array for a given def + rarity using rarity multiplier. */
function rollStats(def: EquipmentDef, rarity: Rarity): EquipmentStat[] {
  const baseStats = def.baseStats[rarity] ?? [];
  const mult = RARITY_MULTIPLIERS[rarity];
  // Add some random variance (±20% of the base value)
  return baseStats.map(s => ({
    type: s.type,
    value: Math.round((s.value * mult + s.value * mult * (Math.random() * 0.4 - 0.2)) * 10) / 10,
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
  };
}

/** Attempt to roll a random equipment drop (returns null if roll fails). */
export function rollDrop(
  wave: number,
  source: 'boss' | 'milestone',
): Equipment | null {
  const baseChance = source === 'boss' ? 0.3 : 1.0;
  const scaledChance = Math.min(0.8, baseChance + wave * 0.005);
  if (Math.random() > scaledChance) return null;

  const rarity = rollRarity(wave);
  const dropPool = source === 'boss'
    ? EQUIPMENT_DEFS.filter(d => !d.bossOnly || d.minWave <= wave)
    : EQUIPMENT_DEFS.filter(d => !d.bossOnly);
  const def = dropPool[Math.floor(Math.random() * dropPool.length)];
  return generateEquipment(def.id, rarity);
}
