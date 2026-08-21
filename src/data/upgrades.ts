import type { UpgradeDef } from '../types';

/**
 * Every evolution effect an upgrade can unlock. Closed so the evolutions
 * contributor in the stat pipeline can switch on it exhaustively — an
 * evolution nothing consumes fails `tsc` rather than shipping as flavour text.
 */
export type EvolutionEffectId =
  | 'armor_pen'
  | 'berserk_fire_bonus'
  | 'crit_ignore_armor'
  | 'crit_splash'
  | 'double_shot'
  | 'enlightenment'
  | 'golden_tide'
  | 'hp_threshold_damage'
  | 'instant_kill'
  | 'kill_streak_gold'
  | 'mana_full_gold'
  | 'mana_shield'
  | 'mine_split'
  | 'revive'
  | 'shield_fast_recharge'
  | 'shockwave_slow'
  | 'wave_gold_scaling';

export const EVOLUTION_EFFECT_IDS: readonly EvolutionEffectId[] = [
  'armor_pen', 'berserk_fire_bonus', 'crit_ignore_armor', 'crit_splash',
  'double_shot', 'enlightenment', 'golden_tide', 'hp_threshold_damage',
  'instant_kill', 'kill_streak_gold', 'mana_full_gold', 'mana_shield',
  'mine_split', 'revive', 'shield_fast_recharge', 'shockwave_slow',
  'wave_gold_scaling',
];

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'damage',
    name: 'Sharper Arrows',
    icon: 'broadhead-arrow',
    description: 'Increases the base damage',
    baseCost: 15,
    costGrowth: 1.22,
    effectPerLevel: '3.2 * Math.pow(1.1, {level} - 1)',
    baseEffect: 4,
    startLevel: 1,
    effectType: 'add',
    maxLevel: 999,
    category: 'tower',
    hideUpgradeScale: true,
    evolutions: [
      { level: 25, name: 'Keen Arrows', description: '+10% armor penetration', effectId: 'armor_pen', effectValue: 0.10 },
      { level: 75, name: 'Vorpal Arrows', description: '3% instant kill on non-bosses', effectId: 'instant_kill', effectValue: 0.03 },
    ],
  },
  {
    id: 'fireRate',
    name: 'Quick Draw',
    icon: 'fast-arrow',
    description: 'Increases the rate of fire',
    baseCost: 60,
    costGrowth: 1.26,
    effectPerLevel: 0.06,
    effectType: 'add',
    maxLevel: 100,
    category: 'tower',
    hideUpgradeScale: true,
    evolutions: [
      { level: 25, name: 'Rapid Fire', description: 'Every 5th shot fires double', effectId: 'double_shot', effectValue: 5 },
      { level: 50, name: 'Machine Gun', description: '+50% fire rate during Berserk', effectId: 'berserk_fire_bonus', effectValue: 0.5 },
    ],
  },
  {
    id: 'range',
    name: 'Longbow',
    icon: 'bow-arrow',
    description: 'Increases tower shooting range',
    baseCost: 100,
    costGrowth: 1.32,
    /*
     * 5 -> 3 with the camera (UI plan §1.2).
     *
     * `range` is the one world-space stat the zoom-out deliberately does *not*
     * multiply — that is what shrinks the ring against the arena. Left at 5,
     * the flat max would have been base 300 + 300 = 600, i.e. the upgrade
     * alone doubling the tower's reach and landing a stacked build straight on
     * `ARENA_RANGE_CAP` with talents and blessings contributing nothing
     * visible. At 3 the flat max is 300 + 180 = 480 — 0.51 of the short
     * half-extent — which leaves the cap as somewhere a *built* tower gets to
     * rather than somewhere every tower starts.
     */
    effectPerLevel: 3,
    effectType: 'add',
    maxLevel: 60,
    category: 'tower',
    hideUpgradeScale: true,
  },
  {
    id: 'critChance',
    name: 'Eagle Eye',
    icon: 'dead-eye',
    description: 'Increases crit chance',
    baseCost: 140,
    costGrowth: 1.42,
    effectPerLevel: 0.01,
    effectType: 'add',
    maxLevel: 95,
    category: 'tower',
    hideUpgradeScale: true,
    evolutions: [
      { level: 25, name: 'Hawk Eye', description: 'Crits deal 20% AoE splash', effectId: 'crit_splash', effectValue: 0.20 },
      { level: 75, name: 'True Sight', description: 'Critical hits ignore armor', effectId: 'crit_ignore_armor', effectValue: 1 },
    ],
  },
  {
    id: 'critDamage',
    name: 'Heavy Quiver',
    icon: 'barbed-arrow',
    description: 'Increases crit damage',
    baseCost: 170,
    costGrowth: 1.36,
    effectPerLevel: 0.12,
    effectType: 'add',
    maxLevel: 999,
    category: 'tower',
    hideUpgradeScale: true,
  },
  {
    id: 'landMines',
    name: 'Land Mines',
    icon: 'land-mine',
    description: 'Spawns mines that detonate on contact',
    baseCost: 500,
    costGrowth: 1.32,
    effectPerLevel: 0,
    effectType: 'mult',
    maxLevel: 999,
    category: 'tower',
    scaling: { base: 0.5, perLevel: 0.25, effectType: 'mult' },
    hideUpgradeScale: true,
    evolutions: [
      { level: 25, name: 'Cluster Mines', description: 'Mines split into 2 smaller mines on detonation', effectId: 'mine_split', effectValue: 2 },
    ],
  },
  {
    id: 'doubleShotChance',
    name: 'Double Tap',
    icon: 'striking-arrows',
    description: 'Chance to fire an extra projectile per shot',
    baseCost: 120,
    costGrowth: 1.45,
    effectPerLevel: 0.02,
    baseEffect: 0.02,
    effectType: 'add',
    maxLevel: 35,
    category: 'tower',
    hideUpgradeScale: true,
  },
  {
    id: 'quickShotChance',
    name: 'Adrenaline Rush',
    icon: 'energy-arrow',
    description: 'Chance to temporarily double your fire rate',
    baseCost: 250,
    costGrowth: 1.55,
    effectPerLevel: 0.01,
    baseEffect: 0.01,
    effectType: 'add',
    maxLevel: 50,
    category: 'tower',
    hideUpgradeScale: true,
  },
  {
    id: 'quickShotTime',
    name: 'Adrenaline Surge',
    icon: 'extra-time',
    description: 'Increases the duration of Adrenaline Rush',
    baseCost: 100,
    costGrowth: 1.4,
    effectPerLevel: 0,
    effectType: 'add',
    maxLevel: 9,
    category: 'tower',
    scaling: { base: 3, perLevel: 1, effectType: 'add', unit: 's' },
    hideUpgradeScale: true,
  },
  {
    id: 'goldMulti',
    name: 'Greed',
    icon: 'shiny-purse',
    description: 'Increases gold gained from kills',
    baseCost: 110,
    costGrowth: 1.4,
    effectPerLevel: 0.04,
    effectType: 'mult',
    maxLevel: 999,
    category: 'economy',
    hideUpgradeScale: true,
    evolutions: [
      // Plan §7.2: the combo meter now pays for a kill streak too, so Avarice
      // pays less for the same streak and the *combined* ceiling is unchanged.
      // Derived, not guessed: the deepest streak a wave can actually sustain is
      // its own enemy count, ~50 around the wall, where Avarice used to be
      // worth `0.05 x 49 = +245%` and the combo's third tier now supplies +12%
      // of it — `(2.45 - 0.12) / 49 = 0.0476`, rounded *down* so the combined
      // figure lands just under the old one rather than just over.
      { level: 25, name: 'Avarice', description: 'Kill streaks: +4.7% gold per consecutive kill', effectId: 'kill_streak_gold', effectValue: 0.047 },
      { level: 50, name: "Dragon's Hoard", description: '+1% gold per wave survived this run', effectId: 'wave_gold_scaling', effectValue: 0.01 },
    ],
  },
  {
    id: 'manaRegen',
    name: 'Meditation',
    icon: 'prayer',
    description: 'Increases mana regeneration',
    baseCost: 300,
    costGrowth: 1.55,
    effectPerLevel: 0.25,
    effectType: 'add',
    maxLevel: 999,
    category: 'utility',
    hideUpgradeScale: true,
    evolutions: [
      { level: 25, name: 'Inner Peace', description: 'Full mana: +10% gold for 5s', effectId: 'mana_full_gold', effectValue: 0.10 },
    ],
  },
  {
    id: 'maxMana',
    name: 'Arcane Reserves',
    icon: 'crystal-cluster',
    description: 'Increases max mana',
    baseCost: 230,
    costGrowth: 1.5,
    effectPerLevel: 5,
    effectType: 'add',
    maxLevel: 40,
    category: 'utility',
    hideUpgradeScale: true,
    evolutions: [
      { level: 15, name: 'Mana Shield', description: 'Full mana: 10% damage reduction', effectId: 'mana_shield', effectValue: 0.10 },
    ],
  },
  {
    id: 'waveGold',
    name: 'Wave Mastery',
    icon: 'open-treasure-chest',
    description: 'Gain flat gold on wave clear',
    baseCost: 380,
    costGrowth: 1.4,
    effectPerLevel: 0,
    effectType: 'add',
    maxLevel: 999,
    category: 'economy',
    scaling: { base: 3, perLevel: 2, effectType: 'add' },
    hideUpgradeScale: true,
    evolutions: [
      { level: 25, name: 'Golden Tide', description: 'Wave clear gold +25%', effectId: 'golden_tide', effectValue: 0.25 },
    ],
  },
  {
    id: 'xpGain',
    name: 'Wisdom',
    icon: 'wisdom',
    description: 'Increases XP gain',
    baseCost: 350,
    costGrowth: 1.5,
    effectPerLevel: 0.03,
    effectType: 'mult',
    maxLevel: 50,
    category: 'utility',
    hideUpgradeScale: true,
    evolutions: [
      { level: 25, name: 'Enlightenment', description: '+1 talent point every 10 waves', effectId: 'enlightenment', effectValue: 1 },
    ],
  },
  {
    id: 'upgradeDiscount',
    name: 'Merchant',
    icon: 'shop',
    description: 'Reduces upgrade costs',
    baseCost: 150,
    costGrowth: 1.4,
    effectPerLevel: -0.01,
    effectType: 'add',
    maxLevel: 50,
    category: 'economy',
    hideUpgradeScale: true,
  },
  {
    id: 'abilityCostReduction',
    name: 'Mana Efficiency',
    icon: 'standing-potion',
    description: 'Reduces ability mana costs',
    baseCost: 160,
    costGrowth: 1.5,
    effectPerLevel: -0.02,
    effectType: 'add',
    maxLevel: 25,
    category: 'utility',
    hideUpgradeScale: true,
  },
  {
    id: 'goldOnKill',
    name: 'Bounty Hunter',
    icon: 'wanted-reward',
    description: 'Gain flat gold per kill',
    baseCost: 290,
    costGrowth: 1.4,
    effectPerLevel: 0,
    effectType: 'add',
    maxLevel: 999,
    category: 'economy',
    scaling: { base: 1, perLevel: 1, effectType: 'add' },
    hideUpgradeScale: true,
  },
  {
    id: 'critGold',
    name: 'Fortune',
    icon: 'coinflip',
    description: 'Increases bonus gold on crit kills',
    baseCost: 120,
    costGrowth: 1.45,
    effectPerLevel: 0.5,
    effectType: 'mult',
    maxLevel: 20,
    category: 'economy',
    hideUpgradeScale: true,
  },
  {
    id: 'health',
    name: 'Health',
    icon: 'heart-tower',
    description: 'Increases max health',
    baseCost: 40,
    costGrowth: 1.25,
    effectPerLevel: '4.2 * Math.pow(1.1, {level} - 1)',
    baseEffect: 5,
    startLevel: 1,
    effectType: 'add',
    maxLevel: 999,
    category: 'defense',
    hideUpgradeScale: true,
    evolutions: [
      { level: 25, name: 'Fortified Core', description: '+15% damage when above 80% HP', effectId: 'hp_threshold_damage', effectValue: 0.15 },
      { level: 100, name: "Titan's Heart", description: 'Revive once per ascension at 25% HP', effectId: 'revive', effectValue: 0.25 },
    ],
  },
  {
    id: 'healthRegen',
    name: 'Health Regen',
    icon: 'regeneration',
    description: 'Restores health every second',
    baseCost: 130,
    costGrowth: 1.3,
    effectPerLevel: 0,
    effectType: 'add',
    maxLevel: 150,
    category: 'defense',
    scaling: { base: 0.005, perLevel: 0.001, effectType: 'mult', cap: { max: 0.5 } },
    hideUpgradeScale: true,
  },
  {
    id: 'defense',
    name: 'Defense',
    icon: 'bordered-shield',
    description: 'Reduces incoming damage',
    baseCost: 120,
    costGrowth: 1.32,
    effectPerLevel: 0,
    effectType: 'add',
    maxLevel: 999,
    category: 'defense',
    scaling: { base: 0.5, perLevel: 0.35, effectType: 'add' },
    hideUpgradeScale: true,
  },
  {
    id: 'armor',
    name: 'Armor',
    icon: 'breastplate',
    description: 'Reduces incoming damage by a percentage of damage taken',
    baseCost: 140,
    costGrowth: 1.23,
    effectPerLevel: 0,
    effectType: 'mult',
    maxLevel: 200,
    category: 'defense',
    scaling: { base: 0.01, perLevel: 0.005, effectType: 'mult', cap: { max: 0.75 } },
    hideUpgradeScale: true,
  },
  {
    id: 'shockwave',
    name: 'Shockwave',
    icon: 'echo-ripples',
    description: 'Periodically releases a ring that pushes nearby enemies away. Leveling increases the radius and reduces the time between pulses.',
    baseCost: 250,
    costGrowth: 1.25,
    effectPerLevel: 0,
    effectType: 'add',
    maxLevel: 50,
    category: 'defense',
    hideUpgradeScale: true,
    scaling: { base: 30, perLevel: -0.5, effectType: 'add', cap: { min: 3 }, unit: 's' },
    evolutions: [
      { level: 15, name: 'Tremor', description: 'Shockwaved enemies slowed 30% for 2s', effectId: 'shockwave_slow', effectValue: 0.30 },
    ],
  },
  {
    id: 'thorns',
    name: 'Thorns',
    icon: 'spikes',
    description: 'Deals back part of the attacker\'s damage back to them',
    baseCost: 220,
    costGrowth: 1.37,
    effectPerLevel: 0,
    effectType: 'mult',
    maxLevel: 999,
    category: 'defense',
    scaling: { base: 0.05, perLevel: 0.01, effectType: 'mult' },
    hideUpgradeScale: true,
  },
  {
    id: 'lifesteal',
    name: 'Lifesteal',
    icon: 'heart-drop',
    description: 'Restores part of the damage dealt as health',
    baseCost: 250,
    costGrowth: 1.4,
    effectPerLevel: 0,
    effectType: 'mult',
    maxLevel: 999,
    category: 'defense',
    scaling: { base: 0.002, perLevel: 0.0006, effectType: 'mult' },
    hideUpgradeScale: true,
  },
  {
    id: 'defenseShield',
    name: 'Defense Shield',
    icon: 'energy-shield',
    description: 'Absorbs hits before breaking. Leveling increases the number of charges and lower recharge time.',
    baseCost: 500,
    costGrowth: 1.35,
    effectPerLevel: 0,
    effectType: 'add',
    maxLevel: 55,
    category: 'defense',
    scaling: { base: 60, perLevel: -1, effectType: 'add', cap: { min: 7 }, unit: 's' },
    hideUpgradeScale: true,
    evolutions: [
      { level: 25, name: 'Prismatic Shield', description: 'Shield recharges 25% faster', effectId: 'shield_fast_recharge', effectValue: 0.25 },
    ],
  },
  {
    id: 'wall',
    name: 'Wall',
    icon: 'brick-wall',
    description: 'Builds an outer barrier with its own health pool.',
    baseCost: 650,
    costGrowth: 1.37,
    effectPerLevel: 0,
    effectType: 'mult',
    maxLevel: 40,
    category: 'defense',
    scaling: { base: 0.2, perLevel: 0.02, effectType: 'mult' },
    hideUpgradeScale: true,
  },
];

/**
 * `id -> def` lookup (plan §5.8).
 *
 * `UpgradeManager` resolves an upgrade by id on every cost, max, affordability
 * and evolution query, several of which run per frame from `Game.update`; a
 * linear `UPGRADES.find` over 28 entries for each of those is pure waste.
 */
export const UPGRADE_BY_ID: Record<string, UpgradeDef> = (() => {
  const map: Record<string, UpgradeDef> = {};
  for (const u of UPGRADES) map[u.id] = u;
  return map;
})();
