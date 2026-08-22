import type { UpgradeDef } from '../types';
import { world } from './arena';

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
  | 'pierce_amp'
  | 'range_damage'
  | 'revive'
  | 'shield_fast_recharge'
  | 'shockwave_slow'
  | 'wave_gold_scaling';

export const EVOLUTION_EFFECT_IDS: readonly EvolutionEffectId[] = [
  'armor_pen', 'berserk_fire_bonus', 'crit_ignore_armor', 'crit_splash',
  'double_shot', 'enlightenment', 'golden_tide', 'hp_threshold_damage',
  'instant_kill', 'kill_streak_gold', 'mana_full_gold', 'mana_shield',
  'mine_split', 'pierce_amp', 'range_damage', 'revive',
  'shield_fast_recharge', 'shockwave_slow',
  'wave_gold_scaling',
];

/**
 * Splash geometry for the `splash` upgrade (revamp §5.2).
 *
 * The radius derives from the *level*, exactly like the shockwave fix in
 * §6.2.5 — an `UpgradeDef` carries one `scaling` block and `splash` spends it
 * on the damage fraction, so the disc size lives here where both the stat
 * contributor and `sim/model.ts` read the same numbers rather than each
 * re-deriving them.
 */
export const SPLASH_TUNING = { radiusBase: 40, radiusPerLevel: 3 } as const;

/** World-space splash radius at `level`; 0 when the line is unbought. */
export function splashRadiusForLevel(level: number): number {
  if (level <= 0) return 0;
  return world(SPLASH_TUNING.radiusBase + SPLASH_TUNING.radiusPerLevel * level);
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'damage',
    name: 'Sharper Arrows',
    icon: 'broadhead-arrow',
    description: 'Increases the base damage',
    /*
     * Revamp §5.1. `V(n) = 2.2 x 1.11^(n-1)` — every level is worth exactly
     * +11%, against enemy HP at 1.11x per wave.
     *
     * The old line was `4 + Σ 3.2 x 1.1^(i-1)`, whose *marginal* growth starts
     * at +88% and only asymptotes to +10%: the first five levels were worth
     * 5.1x on their own and were all affordable inside eight waves, which is
     * the overshoot that made the tower one-shot everything from wave 4 to the
     * wall. `0.242 = 2.2 x 0.11`, so the summed form is geometric from L1.
     */
    baseCost: 10,
    costGrowth: 1.16,
    effectPerLevel: '0.242 * Math.pow(1.11, {level} - 2)',
    baseEffect: 2.2,
    startLevel: 1,
    effectType: 'add',
    maxLevel: 200,
    category: 'tower',
    hideUpgradeScale: true,
    evolutions: [
      { level: 20, name: 'Keen Arrows', description: '+10% armor penetration', effectId: 'armor_pen', effectValue: 0.10 },
      { level: 60, name: 'Vorpal Arrows', description: '1.5% instant kill on non-bosses', effectId: 'instant_kill', effectValue: 0.015 },
    ],
  },
  {
    id: 'fireRate',
    name: 'Quick Draw',
    icon: 'fast-arrow',
    description: 'Increases the rate of fire',
    /*
     * Revamp §5.1 and design rule 4: `damage` is geometric, so this axis is
     * deliberately additive and hard-capped. Two compounding DPS axes multiply
     * into a runaway — the verified candidate with both geometric walled at
     * wave 140. Composed ceiling from the upgrade alone is 7.75 shots/s.
     */
    baseCost: 40,
    costGrowth: 1.18,
    effectPerLevel: 0.15,
    effectType: 'add',
    maxLevel: 45,
    category: 'tower',
    hideUpgradeScale: true,
    evolutions: [
      { level: 12, name: 'Rapid Fire', description: 'Every 5th shot fires double', effectId: 'double_shot', effectValue: 5 },
      { level: 30, name: 'Machine Gun', description: '+30% fire rate during Berserk', effectId: 'berserk_fire_bonus', effectValue: 0.3 },
    ],
  },
  {
    id: 'range',
    name: 'Longbow',
    icon: 'bow-arrow',
    description: 'Increases tower shooting range',
    baseCost: 120,
    costGrowth: 1.30,
    /*
     * 5 -> 3 with the camera (UI plan §1.2).
     *
     * `range` is the one world-space stat the zoom-out deliberately does *not*
     * multiply — that is what shrinks the ring against the arena. Left at 5,
     * the flat max would have been base 300 + 300 = 600, i.e. the upgrade
     * alone doubling the tower's reach and landing a stacked build straight on
     * `ARENA_RANGE_CAP` with talents and blessings contributing nothing
     * visible. At 3 the flat max is 300 + 150 = 450 — about half the short
     * half-extent — which leaves the cap as somewhere a *built* tower gets to
     * rather than somewhere every tower starts.
     */
    effectPerLevel: 3,
    effectType: 'add',
    maxLevel: 50,
    category: 'tower',
    hideUpgradeScale: true,
    evolutions: [
      // Revamp §6.1. Consumed in `ProjectileManager` against the tower's own
      // composed range, so levelling `range` widens the band the bonus applies
      // in rather than diluting it.
      { level: 25, name: 'Overwatch', description: '+10% damage to enemies beyond 70% of range', effectId: 'range_damage', effectValue: 0.10 },
    ],
  },
  {
    id: 'critChance',
    name: 'Eagle Eye',
    icon: 'dead-eye',
    description: 'Increases crit chance',
    // Ceiling 25% including the 5% base, not 100% (revamp §5.3).
    baseCost: 220,
    costGrowth: 1.32,
    effectPerLevel: 0.005,
    effectType: 'add',
    maxLevel: 40,
    category: 'tower',
    hideUpgradeScale: true,
    evolutions: [
      { level: 20, name: 'Hawk Eye', description: 'Crits deal 15% AoE splash', effectId: 'crit_splash', effectValue: 0.15 },
      { level: 35, name: 'True Sight', description: 'Critical hits ignore armor', effectId: 'crit_ignore_armor', effectValue: 1 },
    ],
  },
  {
    id: 'critDamage',
    name: 'Heavy Quiver',
    icon: 'barbed-arrow',
    description: 'Increases crit damage',
    // Ceiling x6.0 on the 2.0 base. Was +0.12/level with `maxLevel 999`.
    baseCost: 260,
    costGrowth: 1.30,
    effectPerLevel: 0.08,
    effectType: 'add',
    maxLevel: 50,
    category: 'tower',
    hideUpgradeScale: true,
  },
  {
    id: 'pierce',
    name: 'Bodkin Points',
    icon: 'arrowhead',
    description: 'Shots pass through additional enemies',
    /*
     * Revamp §5.2, the coverage axis. Priced as a *milestone*, not a trickle
     * buy: 1 200 / 3 840 / 12 288 / 39 322 / 125 830 / 402 656 — six purchases
     * across a whole progression, each a visible, run-changing moment. Writes
     * `pierceExtra`, which is already clamped `{min: 0, integer: true}`.
     */
    baseCost: 1200,
    costGrowth: 3.2,
    effectPerLevel: 1,
    effectType: 'add',
    maxLevel: 6,
    category: 'tower',
    hideUpgradeScale: true,
    evolutions: [
      // Revamp §6.1: the payoff for committing to the coverage line — every
      // target after the first on the same shot takes more, so pierce stops
      // being strictly worse than raw damage on a thin wave.
      { level: 4, name: 'Skewer', description: 'Pierced targets take +15% from the same shot', effectId: 'pierce_amp', effectValue: 0.15 },
    ],
  },
  {
    id: 'splash',
    name: 'Fragmenting Arrows',
    icon: 'fragmented-meteor',
    description: 'Shots burst on impact, damaging everything nearby',
    /*
     * Revamp §5.2. The `scaling` block is the damage *fraction*; the disc
     * radius comes from `splashRadiusForLevel` above. The fraction composes
     * with the artillery core, the Mortar blessing and Annihilation through
     * `composeShotSplash` — max radius, summed fraction to
     * `SPLASH_FRACTION_CAP` — so the cap here and the key's clamp are the same
     * ceiling stated twice on purpose.
     */
    baseCost: 1500,
    costGrowth: 1.35,
    effectPerLevel: 0,
    effectType: 'mult',
    maxLevel: 25,
    category: 'tower',
    scaling: { base: 0.112, perLevel: 0.012, effectType: 'mult', cap: { max: 0.40 } },
    hideUpgradeScale: true,
  },
  {
    id: 'landMines',
    name: 'Land Mines',
    icon: 'land-mine',
    description: 'Spawns mines that detonate on contact',
    baseCost: 700,
    costGrowth: 1.34,
    effectPerLevel: 0,
    effectType: 'mult',
    maxLevel: 80,
    category: 'tower',
    scaling: { base: 0.4, perLevel: 0.15, effectType: 'mult' },
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
    // Ceiling 31%. Was `2% + 2%/level` to L35 — 72%.
    baseCost: 240,
    costGrowth: 1.36,
    effectPerLevel: 0.01,
    baseEffect: 0.02,
    effectType: 'add',
    maxLevel: 30,
    category: 'tower',
    hideUpgradeScale: true,
  },
  {
    id: 'quickShotChance',
    name: 'Adrenaline Rush',
    icon: 'energy-arrow',
    description: 'Chance to temporarily double your fire rate',
    // Ceiling 18.4%. Was `1% + 1%/level` to L50 — 51%.
    baseCost: 320,
    costGrowth: 1.38,
    effectPerLevel: 0.006,
    baseEffect: 0.01,
    effectType: 'add',
    maxLevel: 30,
    category: 'tower',
    hideUpgradeScale: true,
  },
  {
    id: 'quickShotTime',
    name: 'Adrenaline Surge',
    icon: 'extra-time',
    description: 'Increases the duration of Adrenaline Rush',
    // Ceiling 6.5 s. Was `3s + 1s/level` to L9 — 12 s.
    baseCost: 200,
    costGrowth: 1.40,
    effectPerLevel: 0,
    effectType: 'add',
    maxLevel: 10,
    category: 'tower',
    scaling: { base: 2, perLevel: 0.5, effectType: 'add', unit: 's' },
    hideUpgradeScale: true,
  },
  {
    id: 'goldMulti',
    name: 'Greed',
    icon: 'shiny-purse',
    description: 'Increases gold gained from kills',
    // Ceiling +100%. Was +4%/level with `maxLevel 999` — design rule 6 wants
    // every compounding economy source capped.
    baseCost: 220,
    costGrowth: 1.32,
    effectPerLevel: 0.02,
    effectType: 'mult',
    maxLevel: 50,
    category: 'economy',
    hideUpgradeScale: true,
    evolutions: [
      // Revamp §6.1/§6.2: both lines are now capped in code — Avarice at +75%
      // in the `enemy_killed` handler, Dragon's Hoard at +50% in the evolutions
      // contributor. Uncapped, a wave-40 streak was worth +245% and the hoard
      // another +40%, which is most of the 1.185x/wave income growth the
      // revamp exists to bound. The combo meter (plan §7.2) still pays its own
      // tier bonus on top of the streak.
      { level: 20, name: 'Avarice', description: 'Kill streaks: +2.5% gold per consecutive kill, up to +75%', effectId: 'kill_streak_gold', effectValue: 0.025 },
      { level: 40, name: "Dragon's Hoard", description: '+0.5% gold per wave survived this run, up to +50%', effectId: 'wave_gold_scaling', effectValue: 0.005 },
    ],
  },
  {
    id: 'prospecting',
    name: 'Prospecting',
    icon: 'gold-mine',
    description: 'Chance for a kill to pay double gold',
    /*
     * Revamp §5.3, replacing `upgradeDiscount`.
     *
     * A flat cost reducer is an anti-upgrade: nothing happens on screen, it
     * compounds silently with every other economy line, and it is strictly the
     * least interesting thing gold can buy. This occupies the same slot and
     * pays out as a visible double-gold pop. Routes through the existing
     * `doubleGoldChance` key, clamped `{min: 0, max: 1}`. Long-term cost
     * reduction still exists through talents and achievements, which keep
     * `upgradeCostDiscount` alive as a key.
     */
    baseCost: 240,
    costGrowth: 1.34,
    effectPerLevel: 0.015,
    effectType: 'add',
    maxLevel: 20,
    category: 'economy',
    hideUpgradeScale: true,
  },
  {
    id: 'manaRegen',
    name: 'Meditation',
    icon: 'prayer',
    description: 'Increases mana regeneration',
    baseCost: 320,
    costGrowth: 1.34,
    effectPerLevel: 0.2,
    effectType: 'add',
    maxLevel: 60,
    category: 'utility',
    hideUpgradeScale: true,
    evolutions: [
      { level: 20, name: 'Inner Peace', description: 'Full mana: +8% gold for 5s', effectId: 'mana_full_gold', effectValue: 0.08 },
    ],
  },
  {
    id: 'maxMana',
    name: 'Arcane Reserves',
    icon: 'crystal-cluster',
    description: 'Increases max mana',
    baseCost: 260,
    costGrowth: 1.30,
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
    baseCost: 600,
    costGrowth: 1.34,
    effectPerLevel: 0,
    effectType: 'add',
    maxLevel: 60,
    category: 'economy',
    scaling: { base: 3, perLevel: 2, effectType: 'add' },
    hideUpgradeScale: true,
    evolutions: [
      { level: 20, name: 'Golden Tide', description: 'Wave clear gold +20%', effectId: 'golden_tide', effectValue: 0.20 },
    ],
  },
  {
    id: 'xpGain',
    name: 'Wisdom',
    icon: 'wisdom',
    description: 'Increases XP gain',
    // Ceiling +80%. Was +3%/level to L50.
    baseCost: 400,
    costGrowth: 1.34,
    effectPerLevel: 0.02,
    effectType: 'mult',
    maxLevel: 40,
    category: 'utility',
    hideUpgradeScale: true,
    evolutions: [
      // `effectValue` is the *interval* in waves, read by the wave_cleared
      // handler in `Game.ts` — 12, not the hardcoded 10 it used to assume.
      { level: 25, name: 'Enlightenment', description: '+1 talent point every 12 waves', effectId: 'enlightenment', effectValue: 12 },
    ],
  },
  {
    id: 'abilityCostReduction',
    name: 'Mana Efficiency',
    icon: 'standing-potion',
    description: 'Reduces ability mana costs',
    // Ceiling -30%, leaving room for talents, research and TP. Was -50%.
    baseCost: 260,
    costGrowth: 1.34,
    effectPerLevel: -0.015,
    effectType: 'add',
    maxLevel: 20,
    category: 'utility',
    hideUpgradeScale: true,
  },
  {
    id: 'goldOnKill',
    name: 'Bounty Hunter',
    icon: 'wanted-reward',
    description: 'Gain flat gold per kill',
    baseCost: 400,
    costGrowth: 1.32,
    effectPerLevel: 0,
    effectType: 'add',
    maxLevel: 60,
    category: 'economy',
    scaling: { base: 1, perLevel: 1, effectType: 'add' },
    hideUpgradeScale: true,
  },
  {
    id: 'critGold',
    name: 'Fortune',
    icon: 'coinflip',
    description: 'Increases bonus gold on crit kills',
    // Ceiling x6 on crit kills. Was +0.5/level — x11.
    baseCost: 240,
    costGrowth: 1.34,
    effectPerLevel: 0.25,
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
    // Mirrors `damage` (revamp §5.3): `V(n) = 5 x 1.10^(n-1)`, a flat +10% per
    // level instead of a +48% first step.
    baseCost: 25,
    costGrowth: 1.15,
    effectPerLevel: '0.5 * Math.pow(1.10, {level} - 2)',
    baseEffect: 5,
    startLevel: 1,
    effectType: 'add',
    maxLevel: 200,
    category: 'defense',
    hideUpgradeScale: true,
    evolutions: [
      { level: 25, name: 'Fortified Core', description: '+12% damage when above 80% HP', effectId: 'hp_threshold_damage', effectValue: 0.12 },
      { level: 90, name: "Titan's Heart", description: 'Revive once per ascension at 25% HP', effectId: 'revive', effectValue: 0.25 },
    ],
  },
  {
    id: 'healthRegen',
    name: 'Health Regen',
    icon: 'regeneration',
    description: 'Restores health every second',
    // Cap 6%/s, was 50%/s — at a large max HP that deletes all incoming
    // pressure outright.
    baseCost: 200,
    costGrowth: 1.32,
    effectPerLevel: 0,
    effectType: 'add',
    maxLevel: 120,
    category: 'defense',
    scaling: { base: 0.004, perLevel: 0.0005, effectType: 'mult', cap: { max: 0.06 } },
    hideUpgradeScale: true,
  },
  {
    id: 'defense',
    name: 'Defense',
    icon: 'bordered-shield',
    description: 'Reduces incoming damage',
    baseCost: 150,
    costGrowth: 1.30,
    effectPerLevel: 0,
    effectType: 'add',
    maxLevel: 150,
    category: 'defense',
    scaling: { base: 0.5, perLevel: 0.3, effectType: 'add' },
    hideUpgradeScale: true,
  },
  {
    id: 'armor',
    name: 'Armor',
    icon: 'breastplate',
    description: 'Reduces incoming damage by a percentage of damage taken',
    baseCost: 180,
    costGrowth: 1.26,
    effectPerLevel: 0,
    effectType: 'mult',
    maxLevel: 160,
    category: 'defense',
    scaling: { base: 0.01, perLevel: 0.003, effectType: 'mult', cap: { max: 0.50 } },
    hideUpgradeScale: true,
  },
  {
    id: 'shockwave',
    name: 'Shockwave',
    icon: 'echo-ripples',
    description: 'Periodically releases a ring that pushes nearby enemies away. Leveling increases the radius and reduces the time between pulses.',
    // §5.2 / §6.2.5: `scaling` is the *cooldown*; the radius derives from the
    // level in the contributor, which is what stopped the line from paying for
    // its own downgrade.
    baseCost: 300,
    costGrowth: 1.28,
    effectPerLevel: 0,
    effectType: 'add',
    maxLevel: 60,
    category: 'defense',
    hideUpgradeScale: true,
    scaling: { base: 26, perLevel: -0.35, effectType: 'add', cap: { min: 5 }, unit: 's' },
    evolutions: [
      { level: 15, name: 'Tremor', description: 'Shockwaved enemies slowed 30% for 2s', effectId: 'shockwave_slow', effectValue: 0.30 },
    ],
  },
  {
    id: 'thorns',
    name: 'Thorns',
    icon: 'spikes',
    description: 'Deals back part of the attacker\'s damage back to them',
    baseCost: 260,
    costGrowth: 1.34,
    effectPerLevel: 0,
    effectType: 'mult',
    maxLevel: 140,
    category: 'defense',
    scaling: { base: 0.03, perLevel: 0.005, effectType: 'mult', cap: { max: 0.75 } },
    hideUpgradeScale: true,
  },
  {
    id: 'lifesteal',
    name: 'Lifesteal',
    icon: 'heart-drop',
    description: 'Restores part of the damage dealt as health',
    baseCost: 300,
    costGrowth: 1.34,
    effectPerLevel: 0,
    effectType: 'mult',
    maxLevel: 140,
    category: 'defense',
    scaling: { base: 0.003, perLevel: 0.0006, effectType: 'mult', cap: { max: 0.10 } },
    hideUpgradeScale: true,
  },
  {
    id: 'defenseShield',
    name: 'Defense Shield',
    icon: 'energy-shield',
    description: 'Absorbs hits before breaking. Leveling increases the number of charges and lower recharge time.',
    baseCost: 600,
    costGrowth: 1.32,
    effectPerLevel: 0,
    effectType: 'add',
    maxLevel: 50,
    category: 'defense',
    scaling: { base: 55, perLevel: -0.9, effectType: 'add', cap: { min: 8 }, unit: 's' },
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
    baseCost: 700,
    costGrowth: 1.34,
    effectPerLevel: 0,
    effectType: 'mult',
    maxLevel: 35,
    category: 'defense',
    scaling: { base: 0.2, perLevel: 0.02, effectType: 'mult', cap: { max: 0.90 } },
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
