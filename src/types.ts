import { evalFormula } from './data/formulas';

export type EnemyType = 'normal' | 'fast' | 'tank' | 'flying' | 'healer' | 'boss' | 'splitter' | 'shielded';

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
  | 'execute';

export type PanelTab = 'upgrades' | 'research' | 'abilities' | 'prestige' | 'transcendence' | 'achievements' | 'settings';

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
}

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
  research: string[];
  researchInProgress: { id: string; elapsed: number } | null;
  abilities: Record<string, AbilityState>;
  prestige: PrestigeState;
  wave: WaveState;
  stats: GameStats;
  achievements: string[];
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
