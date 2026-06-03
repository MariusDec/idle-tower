export type EnemyType = 'normal' | 'fast' | 'tank' | 'flying' | 'healer' | 'boss';

export type DamageType = 'physical' | 'magic';

export type TargetingMode = 'nearest' | 'lowest_hp' | 'first';

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

export type AbilityId = 'rain_of_arrows' | 'frost_nova' | 'berserk' | 'gold_rush';

export type PanelTab = 'upgrades' | 'research' | 'abilities' | 'prestige' | 'transcendence';

export type PrestigeLayer = 'ascension' | 'transcendence';

export interface TowerState {
  x: number;
  y: number;
  baseDamage: number;
  fireRate: number;
  activeFireRate: number;
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
  landMineDamage: number;
  landMineFrequency: number;
  landMineTimer: number;
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
  startedAt: number;
}

export interface UpgradeDef {
  id: string;
  name: string;
  description: string;
  baseCost: number;
  costGrowth: number;
  effectPerLevel: number;
  effectType: UpgradeEffectType;
  maxLevel: number;
  category: UpgradeCategory;
  hideUpgradeScale: boolean;
  scaling?: UpgradeScaling;
}

export function computeUpgradeValue(def: UpgradeDef, level: number): number {
  if (level <= 0) return 0;
  if (def.scaling) {
    const step = def.scaling.step ?? 0;
    const increments = step > 0 ? Math.floor(level / step) : (level - 1);
    let v = def.scaling.base + def.scaling.perLevel * increments;
    if (def.scaling.cap?.min !== undefined) v = Math.max(def.scaling.cap.min, v);
    if (def.scaling.cap?.max !== undefined) v = Math.min(def.scaling.cap.max, v);
    return v;
  }
  return def.effectPerLevel * level;
}

export interface UpgradeRuntime {
  id: string;
  level: number;
}

export interface GameState {
  timestamp: number;
  tower: TowerState;
  enemies: Enemy[];
  projectiles: Projectile[];
  resources: ResourceState;
  upgrades: Record<string, number>;
  research: string[];
  abilities: Record<string, AbilityState>;
  prestige: PrestigeState;
  wave: WaveState;
  stats: GameStats;
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
