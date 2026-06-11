import { evalFormula } from './data/formulas';

export type EnemyType = 'normal' | 'fast' | 'tank' | 'flying' | 'healer' | 'boss' | 'splitter' | 'shielded';

export type AuraType = 'haste' | 'thorns' | 'greed' | 'vitality' | 'retribution';

export type DamageType = 'physical' | 'magic';

export type TargetingMode = 'nearest' | 'lowest_hp' | 'first' | 'strongest' | 'boss' | 'flying' | 'last';

export type UpgradeCategory = 'tower' | 'defense' | 'economy' | 'utility';

export type UpgradeEffectType = 'add' | 'mult';

export interface UpgradeScaling {
  base: number;
  perLevel: number;
  effectType: UpgradeEffectType;
  cap?: { min?: number; max?: number };
  step?: number;
  unit?: string;
}

export type AbilityId =
  | 'rain_of_arrows'
  | 'frost_nova'
  | 'berserk'
  | 'gold_rush'
  | 'meteor_strike'
  | 'precision_shot'
  | 'chain_lightning'
  | 'vampiric_aura'
  | 'execute'
  | 'multishot';

export type PanelTab = 'upgrades' | 'research' | 'abilities' | 'prestige' | 'transcendence' | 'achievements' | 'stats' | 'settings' | 'talents' | 'passives' | 'equipment';

export type PrestigeLayer = 'ascension' | 'transcendence';

export interface TowerState {
  x: number;
  y: number;
  baseDamage: number;
  fireRate: number;
  range: number;
  critChance: number;
  critMultiplier: number;
  damageType: DamageType;
  cooldown: number;
  targetingMode: TargetingMode;
  hp: number;
  maxHp: number;
  healthRegen: number;
  defense: number;
  armor: number;
  knockbackForce: number;
  shockwaveSize: number;
  shockwaveCooldown: number;
  shockwaveTimer: number;
  lifesteal: number;
  thorns: number;
  landMineDamage: number;
  landMineFrequency: number;
  landMineTimer: number;
  wallHp: number;
  wallMaxHp: number;
  shieldMaxCharges: number;
  shieldCurrentCharges: number;
  shieldRechargeTimer: number;
  shieldRechargeTime: number;
}

export interface Enemy {
  id: number;
  type: EnemyType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  speed: number;
  armor: number;
  magicResist: number;
  goldValue: number;
  damage: number;
  fireRate: number;
  attackCooldown: number;
  attacking: boolean;
  alive: boolean;
  // Healer AI
  healCooldown?: number;
  // Shielded charges (each absorbs one hit)
  shieldCharges?: number;
  // Splitter recursion guard
  isSplitChild?: boolean;
  // Boss enrage (Phase 2)
  enraged?: boolean;
  enrageTriggered?: boolean;
  // Elite enemies
  elite?: boolean;
  aura?: AuraType | null;
  retributionTimer?: number;
}

export interface Projectile {
  id: number;
  x: number;
  y: number;
  targetId: number | null;
  vx: number;
  vy: number;
  damage: number;
  damageType: DamageType;
  isCrit: boolean;
  alive: boolean;
  // Homing (optional — present for homing projectiles)
  homingTargetId?: number;
  turnRate?: number;
  lifetime?: number;
  age?: number;
}

export interface ResourceState {
  gold: number;
  mana: number;
  maxMana: number;
  manaRegen: number;
  ascensionPoints: number;
  apThisTranscendence: number;
  transcendencePoints: number;
  lifetimeAP: number;
  lifetimeGold: number;
}

// Tower XP / Leveling (permanent across ascension/transcendence)
export interface TowerXpState {
  xp: number;
  level: number;
  unspentTalentPoints: number;
  totalXpEarned: number;
}

// Talent System
export type TalentBranch = 'offense' | 'defense' | 'utility' | 'magic';
export type TalentId = string;
export interface TalentState {
  allocated: Record<TalentId, number>;
}

// Passive Abilities
export type PassiveAbilityId =
  | 'passive_markmanship' | 'passive_fortitude' | 'passive_mana_spring'
  | 'passive_scavenger' | 'passive_thorns_aura' | 'passive_precision'
  | 'passive_haste' | 'passive_life_steal';

export interface PassiveAbilityState {
  level: number;
  xp: number;
}

// Equipment
export type EquipmentSlot = 'weapon' | 'armor' | 'accessory_1' | 'accessory_2'
  | 'relic' | 'boots' | 'helmet' | 'ring';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type EquipmentStatType =
  | 'damage_pct' | 'fire_rate_pct' | 'crit_chance_pct' | 'crit_damage_pct'
  | 'range_pct' | 'max_hp_pct' | 'defense_pct' | 'armor_pct'
  | 'gold_mult_pct' | 'mana_regen_pct' | 'lifesteal_pct' | 'thorns_pct'
  | 'knockback_pct' | 'all_damage_pct';

export interface EquipmentStat { type: EquipmentStatType; value: number; }
export interface Equipment {
  id: string; defId: string; slot: EquipmentSlot;
  rarity: Rarity; level: number; stats: EquipmentStat[];
}
export interface EquipmentDef {
  id: string; name: string; description: string; slot: EquipmentSlot;
  baseStats: Partial<Record<Rarity, EquipmentStat[]>>;
  maxLevel: number; upgradeCostGrowth: number;
  sprite: string; color: string; minWave: number; bossOnly?: boolean;
}

// Homing Projectile (extends Projectile)
export interface HomingProjectile extends Projectile {
  homingTargetId: number;
  turnRate: number;
  lifetime: number;
  age: number;
}

export interface WaveModifierState {
  /** The modifier currently active for `wave.number` (set when boss wave starts). */
  active: WaveModifierSnapshot | null;
  /** Up to 3 choices offered to the player for the upcoming boss wave. */
  choiceForNextWave: WaveModifierSnapshot[] | null;
  /** Boss wave number the `choiceForNextWave` belongs to. */
  pendingChoiceForWave: number | null;
  /** Gold earned snapshot taken when the modifier was picked, used to compute gold multiplier bonus on wave clear. */
  goldSnapshot: number | null;
}

export interface WaveModifierSnapshot {
  id: string;
  name: string;
  description: string;
  detail: string;
  glyph: string;
  color: string;
  /** ap/tp = flat reward on clear; gold = multiplier × gold earned from enemies during the wave (deferred to wave_cleared). */
  reward: { ap: number; gold: number; tp: number };
  effects: {
    hpMult: number;
    speedMult: number;
    damageToTowerMult: number;
    countMult: number;
    goldAdditive: number;
    playerDamageMult: number;
  };
}

export interface WaveState {
  number: number;
  highestWave: number;
  spawning: boolean;
  enemiesSpawned: number;
  enemiesToSpawn: number;
  spawnInterval: number;
  spawnTimer: number;
  intermission: boolean;
  intermissionTimer: number;
  autoProgress: boolean;
  /** v5+: per-wave modifier system. */
  waveModifier: WaveModifierState;
}

export const GAME_SPEEDS: readonly number[] = [0.5, 1.0];

export const DEFAULT_SPEED_INDEX = GAME_SPEEDS.indexOf(1.0);
export const MAX_SPEED_INDEX = GAME_SPEEDS.length - 1;

export interface AbilityState {
  level: number;
  cooldown: number;
  active: boolean;
  activeTimer: number;
}

export interface PrestigeState {
  apSpent: Record<string, number>;
  tpSpent: Record<string, number>;
  automationFlags: {
    autoBuy: boolean;
    autoAbilities: boolean;
    autoAscend: boolean;
    autoTranscend: boolean;
  };
  targetAscendWave: number;
}

export interface GameStats {
  enemiesKilled: number;
  bossesKilled: number;
  goldEarned: number;
  damageDealt: number;
  shotsFired: number;
  lifetimeHighestWave: number;
  abilitiesCast: number;
  ascensions: number;
  lifetimeAscensions: number;
  transcendences: number;
  totalUpgradesPurchased: number;
  startedAt: number;
  /** Per-run timer. Reset on ascend/transcend; records when this run started. */
  runStartedAt: number;
}

export interface RunRecord {
  /** Wall-clock time the run was recorded (at end). */
  endedAt: number;
  /** Type of run completion. */
  kind: 'ascension' | 'transcendence';
  /** Highest wave reached in the run. */
  highestWave: number;
  /** Run duration in seconds. */
  durationSeconds: number;
  /** Total gold earned during the run. */
  goldEarned: number;
  /** Total enemies killed during the run. */
  enemiesKilled: number;
  /** Total ability casts during the run. */
  abilitiesCast: number;
  /** Currency gained: AP for ascension runs, TP for transcendence. */
  currencyGained: number;
  /** Research points gained this run (ascension only). */
  rpGained: number;
  /** True if this run set a new lifetime highest wave. */
  newRecordWave: boolean;
  /** True if this run set a new lifetime best gold. */
  newRecordGold: boolean;
}

export const MAX_RUN_HISTORY = 20;

export interface UpgradeEvolution {
  level: number;
  name: string;
  description: string;
  effectId: string;
  effectValue: number;
}

export interface UpgradeDef {
  id: string;
  name: string;
  description: string;
  baseCost: number;
  costGrowth: number | string;
  effectPerLevel: number | string;
  effectType: UpgradeEffectType;
  maxLevel: number;
  category: UpgradeCategory;
  hideUpgradeScale: boolean;
  baseEffect?: number;
  scaling?: UpgradeScaling;
  evolutions?: UpgradeEvolution[];
  startLevel?: number;
}

const upgradeValueCache = new Map<string, number>();

export function computeUpgradeValue(def: UpgradeDef, level: number): number {
  if (level <= 0) return 0;
  const cacheKey = `${def.id}:${level}`;
  const cached = upgradeValueCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let v: number;
  if (def.scaling) {
    const step = def.scaling.step ?? 0;
    const increments = step > 0 ? Math.floor(level / step) : (level - 1);
    v = def.scaling.base + def.scaling.perLevel * increments;
    if (def.scaling.cap?.min !== undefined) v = Math.max(def.scaling.cap.min, v);
    if (def.scaling.cap?.max !== undefined) v = Math.min(def.scaling.cap.max, v);
  } else if (def.baseEffect && level == 1) {
    v = def.baseEffect;
  } else if (typeof def.effectPerLevel === 'string') {
    v = def.baseEffect ?? 0;
    for (let i = 2; i <= level; i++) {
      v += evalFormula(def.effectPerLevel, i);
    }
  } else if (def.baseEffect !== undefined) {
    v = def.baseEffect + def.effectPerLevel * (level - 1);
  } else {
    v = def.effectPerLevel * level;
  }

  upgradeValueCache.set(cacheKey, v);
  return v;
}

export interface UpgradeRuntime {
  id: string;
  level: number;
}

export interface StatsInfo {
  damage: number;
  dps: number;
  hp: number;
  maxHp: number;
  healthRegen: number;
  critChance: number;
  critDamage: number;
  range: number;
  fireRate: number;
  defense: number;
  armor: number;
  lifesteal: number;
  thorns: number;
  manaRegen: number;
  maxMana: number;
  goldMultiplier: number;
  rpGainRate: number;
}

export interface EnemyWaveStatsEntry {
  type: EnemyType;
  hp: number;
  speed: number;
  armor: number;
  magicResist: number;
  damage: number;
  fireRate: number;
  gold: number;
}

export interface GameState {
  timestamp: number;
  tower: TowerState;
  enemies: Enemy[];
  projectiles: Projectile[];
  resources: ResourceState;
  upgrades: Record<string, number>;
  research: Record<string, number>;
  researchInProgress: { id: string; elapsed: number; targetLevel: number } | null;
  abilities: Record<string, AbilityState>;
  prestige: PrestigeState;
  wave: WaveState;
  stats: GameStats;
  achievements: string[];
  /** v3+: ring buffer of recent run summaries (oldest first, capped at MAX_RUN_HISTORY). */
  runHistory: RunRecord[];
  /** v3+: wall-clock time the current ascension run started. */
  runStartedAt: number;
  /** v6+: Tower XP and leveling state (permanent). */
  towerXp: TowerXpState;
  /** v6+: Talent tree allocation state (permanent). */
  talents: TalentState;
  /** v6+: Passive ability XP and levels (reset on ascend/transcend). */
  passiveAbilities: Record<string, PassiveAbilityState>;
  /** v6+: Equipment inventory (reset on ascend/transcend). */
  equipment: Equipment[];
  /** v6+: Currently equipped items keyed by slot. */
  equipped: Partial<Record<EquipmentSlot, Equipment>>;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  color: string;
}

export interface DamageNumber {
  x: number;
  y: number;
  amount: number;
  isCrit: boolean;
  isHeal?: boolean;
  age: number;
  life: number;
  vy: number;
}

export interface Mine {
  id: number;
  x: number;
  y: number;
  damage: number;
  explosionRadius: number;
  alive: boolean;
  isSplit: boolean;
}

export interface Shockwave {
  x: number;
  y: number;
  currentRadius: number;
  maxRadius: number;
  age: number;
  life: number;
  color: string;
  lineWidth: number;
  /** Optional damage dealt by this shockwave. Set to non-zero for damaging waves
   *  (e.g., boss death rings). The damage is applied once when the ring crosses
   *  each enemy — see EffectsManager.tick for details. */
  damage?: number;
  damageType?: 'physical' | 'magic' | 'true';
  /** Per-shockwave flag; flipped to true after the first damage pass so each
   *  enemy only takes one hit. */
  hasDamaged?: boolean;
}

export interface RenderSnapshot {
  tower: TowerState;
  enemies: Enemy[];
  projectiles: Projectile[];
  wave: WaveState;
  resources: ResourceState;
  abilities: Record<string, AbilityState>;
  particles: Particle[];
  damageNumbers: DamageNumber[];
  shockwaves: Shockwave[];
  mines: Mine[];
  aimLine?: { x: number; y: number } | null;
}
