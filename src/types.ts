import type { EvolutionEffectId } from './data/upgrades';
import type { LootOrbKind } from './data/loot';
import { evalFormula } from './data/formulas';

/**
 * Every enemy in the game (gameplay plan §2.1).
 *
 * The last five are *behavioural* types: each one has its own branch in
 * `EnemyManager.tick` and asks a different question of the tower's build, which
 * is the whole point of them. A type added here with no branch is a stat block
 * wearing a new colour — see `ENEMY_BEHAVIOR_CONSUMERS` in `data/enemies.ts`,
 * which is the closed record that keeps that honest.
 */
export type EnemyType =
  | 'normal' | 'fast' | 'tank' | 'flying' | 'healer' | 'boss' | 'splitter' | 'shielded'
  | 'siege' | 'thief' | 'blinker' | 'warden' | 'burrower';

export type AuraType = 'haste' | 'thorns' | 'greed' | 'vitality' | 'retribution';

/**
 * What a boss is doing during a phase (gameplay plan §3.2).
 *
 * A closed union with a `Record` consumer table (`BOSS_PATTERN_CONSUMERS` in
 * `data/enemies.ts`) and an exhaustive switch in `EnemyManager.tickBossPattern`,
 * so a pattern nobody runs is a compile error rather than a name on a bar.
 *
 * Declared here rather than in `data/enemies.ts` because `Enemy` carries the
 * active pattern and `types.ts` is the module everything else imports *from*.
 */
export type BossPattern = 'bulwark' | 'summon' | 'slam' | 'siphon';

export type DamageType = 'physical' | 'magic';

/**
 * Targeting strategies (gameplay plan §2.3).
 *
 * `'priority'` is the default: with the behavioural types on the field,
 * "nearest" actively loses runs, because the enemy that matters — a warden
 * shielding the line, a thief walking off with the bank — is rarely the closest
 * one. The old `'first'` mode was a dead alias of `'nearest'` and is gone;
 * `Game.applyPersistedState` migrates it.
 */
export type TargetingMode = 'priority' | 'nearest' | 'lowest_hp' | 'strongest' | 'boss' | 'flying' | 'last';

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

export type PanelTab = 'upgrades' | 'research' | 'abilities' | 'prestige' | 'transcendence' | 'achievements' | 'progression' | 'stats' | 'settings' | 'talents' | 'equipment';

export type PrestigeLayer = 'ascension' | 'transcendence';

export interface TowerState {
  x: number;
  y: number;
  baseDamage: number;
  fireRate: number;
  range: number;
  critChance: number;
  critMultiplier: number;
  doubleShotChance: number;
  quickShotChance: number;
  quickShotTime: number;
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

  // ── Behavioural types (gameplay plan §2.1/§2.2) ────────────────────────
  //
  // All optional and all absent on the types that do not use them, so an
  // ordinary enemy costs no extra field and the hot loops pay one `undefined`
  // check rather than carrying dead state.

  /** Wave the enemy spawned on. Drives the thief's per-wave theft ceiling. */
  spawnWave?: number;
  /** Seconds since this enemy last took damage. Drives shielded regeneration. */
  undamagedFor?: number;
  /** Seconds of remaining untargetable-and-immune spawn protection (splitter children). */
  spawnProtection?: number;
  /** Outward scatter velocity, live while `scatterTimer > 0` (splitter children). */
  scatterVx?: number;
  scatterVy?: number;
  scatterTimer?: number;
  /** Shielded: seconds until the next charge is restored. */
  shieldRegenTimer?: number;
  /** Siege: seconds until the next lob. */
  siegeCooldown?: number;
  /** Siege: true while halted at standoff range (drives the range ring). */
  siegeHalted?: boolean;
  /** Thief: gold carried. Non-zero means it has stolen and is running. */
  stolenGold?: number;
  /** True while the enemy is running away from the tower (thief, wounded healer). */
  fleeing?: boolean;
  /** Blinker: seconds until the next teleport. */
  blinkTimer?: number;
  /** Blinker: seconds of knockback/mine immunity left from the last blink. */
  blinkImmunity?: number;
  /** Blinker: where it was before the last blink, for the after-image trail. */
  afterImageX?: number;
  afterImageY?: number;
  afterImageAge?: number;
  /** Warden: seconds until it re-projects its shields. */
  wardTimer?: number;
  /** Absorb pool granted by a warden; soaks damage before HP does. */
  absorbShield?: number;
  absorbMax?: number;
  /** Id of the warden maintaining `absorbShield`; the pool dies with it. */
  wardenId?: number;
  /** Burrower: true while underground — invulnerable and untargetable. */
  burrowed?: boolean;
  /** Burrower: seconds of surfacing telegraph left (it cannot act during it). */
  surfacing?: number;

  // ── Boss encounter (gameplay plan §3) ──────────────────────────────────
  //
  // The whole state machine is per-boss rather than per-wave, because a boss
  // wave spawns `bossCountForWave(wave)` = 2 + tier of them and each one
  // phases on its own bar.

  /** Boss: 1, 2 or 3. Only ever increases, which is what makes crossings idempotent. */
  bossPhase?: number;
  /** Boss: seconds of phase-transition invulnerability left (`isTargetable` reads it). */
  bossInvulnerable?: number;
  /** Boss: the pattern this phase is running. */
  bossPattern?: BossPattern;
  /** Boss: seconds this boss has been on the field. Drives the §3.3 enrage timer. */
  bossElapsed?: number;
  /** Boss: §3.3 enrage stacks, `+15%` damage and `+10%` speed each. */
  bossEnrageStacks?: number;
  /** Boss: how many bosses the wave spawned, so patterns can scale with the pack. */
  bossPackSize?: number;
  /** `bulwark`: absorb pool in front of HP; spent before `hp` in `damage`. */
  bossShield?: number;
  /** `bulwark`: what a full shield is worth, for the bar overlay. */
  bossShieldMax?: number;
  /**
   * `bulwark`: seconds until the shield resolves. While the shield is up this
   * is the heal countdown; while it is broken it is the re-arm delay.
   */
  bossShieldTimer?: number;
  /** `summon`: seconds until the next batch of adds. */
  bossSummonTimer?: number;
  /** `slam`: seconds until the next telegraph begins. */
  bossSlamTimer?: number;
  /** `slam`: seconds of telegraph left. `> 0` means the ring is growing. */
  bossSlamTelegraph?: number;
  /** `slam`: set the moment the boss is slowed or shoved during a telegraph. */
  bossSlamMitigated?: boolean;
}

/**
 * A shot fired *at* the tower by a `siege` enemy (gameplay plan §2.1).
 *
 * Deliberately not a `Projectile`: every loop in `ProjectileManager` assumes
 * tower ownership — damage multipliers, pierce, crit, ricochet, the blessing
 * behaviours — and none of that has any meaning for an incoming shell. This is
 * the whole model: a position, a velocity, a fuse, and a damage number that is
 * handed to the existing `tower_damaged` mitigation chain on arrival.
 */
export interface HostileShot {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Damage delivered on arrival, already multiplied by the enemy channels. */
  damage: number;
  /** Seconds left in flight. */
  remaining: number;
  /** Total flight time, so the renderer can place the arc. */
  travel: number;
  /** Launch point, so the renderer can draw the trajectory. */
  originX: number;
  originY: number;
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
  // Homing (optional — present for homing projectiles)
  homingTargetId?: number;
  turnRate?: number;
  lifetime?: number;
  age?: number;
  /**
   * Blast radius on impact, in pixels. Set by the `mortar` blessing's every-8th
   * shot; absent on an ordinary projectile so the hot path costs one undefined
   * check rather than a radius query.
   */
  splashRadius?: number;
  /** Fraction of the landed hit everything else in `splashRadius` takes. */
  splashFraction?: number;
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
  unlocked: boolean;
}

// Equipment
export type EquipmentSlot = 'turret' | 'bulwark' | 'arsenal' | 'brazier'
  | 'vault' | 'machinery' | 'banner' | 'core';
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
  /** The modifier currently running (plan §3.3: it now spans several waves). */
  active: WaveModifierSnapshot | null;
  /** Up to 3 choices offered to the player for the upcoming boss wave. */
  choiceForNextWave: WaveModifierSnapshot[] | null;
  /** First wave the active modifier applies to (also the wave the offer was made for). */
  pendingChoiceForWave: number | null;
  /** Gold earned snapshot taken at the start of the current modifier wave. */
  goldSnapshot: number | null;
  /**
   * Waves the active modifier still applies to, including the current one
   * (plan §3.3). 0 = no modifier running.
   */
  wavesRemaining: number;
  /** Waves already cleared under the active modifier; drives the escalating reward. */
  wavesCleared: number;
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

/**
 * v10+: the run's blessing draft (plan §1.5).
 *
 * Run-scoped by design — cleared on ascension *and* transcendence — because
 * being wiped is what makes a run distinct rather than a continuation.
 */
export interface BlessingRunState {
  /** Blessing id → stacks held. */
  held: Record<string, number>;
  /** Picks taken this run, against the 30-pick cap. */
  picksTaken: number;
  /** Banked reroll tokens (Part 5 grants them); the free per-draft reroll is not persisted. */
  rerolls: number;
  /** Wave a draft was open for when the state was captured, or null. */
  pendingOfferForWave: number | null;
  /** Waves cleared this run — the Greed Engine blessing scales on it. */
  wavesClearedThisRun: number;
}

/**
 * Run-scoped rewards banked from boss encounters (gameplay plan §3.4).
 *
 * Only the *earned* half of an encounter is persisted. Mid-fight boss state —
 * phase, pattern timers, shields — deliberately is not: live enemies have never
 * been part of the save format, so a load starts the wave's roster empty and
 * `WaveManager` resolves it rather than resuming half a boss. What must survive
 * a reload is the reward the player already won, which is this.
 */
export interface BossRunState {
  /** Flawless-kill AP bonus for this run, as a fraction added to `previewAP`. */
  apBonusPct: number;
  /** Bosses killed inside the swift-kill window this run (a readout, not a multiplier). */
  swiftKills: number;
  /** Encounters cleared without losing tower HP this run. */
  flawlessKills: number;
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
  /** Seconds the current wave has been running (0 during intermission). */
  elapsed: number;
  /** Enrage stacks on the current wave (0 = wave is on schedule). */
  enrageStacks: number;
}

export const GAME_SPEEDS: readonly number[] = [0.5, 1.0, 1.5];

export const DEFAULT_SPEED_INDEX = GAME_SPEEDS.indexOf(1.0);
export const MAX_SPEED_INDEX = GAME_SPEEDS.length - 1;

export interface AbilityState {
  level: number;
  cooldown: number;
  active: boolean;
  activeTimer: number;
  xp: number;
}

/**
 * Auto-buy heuristics (plan §3.6). `cheapest` is the historical behaviour:
 * buy whatever costs least, which floods utility upgrades and never banks for
 * damage. `damage` prioritises the tower category, `balanced` keeps every
 * category within reach of each other.
 */
export type AutoBuyStrategy = 'cheapest' | 'balanced' | 'damage';

export const AUTO_BUY_STRATEGIES: readonly AutoBuyStrategy[] = ['cheapest', 'balanced', 'damage'];

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
  /**
   * Per-ability auto-cast opt-out (plan §3.1). Missing key = enabled, so new
   * abilities are auto-cast by default and old saves need no migration beyond
   * an empty object.
   */
  autoCastEnabled: Record<string, boolean>;
  /** Which upgrades auto-buy reaches for first (plan §3.6). */
  autoBuyStrategy: AutoBuyStrategy;
  /** Fraction of current gold auto-buy refuses to spend, 0-0.9 (plan §3.6). */
  autoBuyReserve: number;
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
  effectId: EvolutionEffectId;
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

/**
 * One contributor to the composed gold multiplier.
 *
 * Gold is composed in two stages: every `additive` source sums into a single
 * `1 + sum` step, and every `multiplicative` source then multiplies on top.
 * Attributing an additive source a factor of its own would overstate it — two
 * `+100%` sources make `×3`, not `×4` — so the two kinds stay distinct and the
 * display sums before it multiplies, exactly as the composition does.
 */
export type GoldSourceEntry =
  | { label: string; kind: 'additive'; additive: number }
  | { label: string; kind: 'multiplicative'; factor: number };

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
  /** Per-source attribution for `goldMultiplier` (plan §4.2). */
  goldSources: GoldSourceEntry[];
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
  /** v10+: run-scoped blessing draft (reset on ascend/transcend). */
  blessings: BlessingRunState;
  /** v11+: run-scoped boss encounter rewards (plan §3.4). */
  bossRun: BossRunState;
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

/**
 * A dropped loot orb (gameplay plan §4.1).
 *
 * Run-scoped *and* frame-scoped: orbs are never persisted, so a save load
 * starts with an empty field. See `docs/loot-system.md`.
 */
export interface LootOrb {
  id: number;
  kind: LootOrbKind;
  x: number;
  y: number;
  /** Outward pop velocity, spent over `LOOT_TUNING.popSeconds`. */
  vx: number;
  vy: number;
  /** Full (clicked) payout. Drift auto-collect pays a fraction of it. */
  value: number;
  /** Seconds since the drop, on the simulation clock. */
  age: number;
  alive: boolean;
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
  /** Incoming siege shells (gameplay plan §2.1). */
  hostileShots: HostileShot[];
  aimLine?: { x: number; y: number } | null;
  /** Live loot orbs (gameplay plan §4.1). */
  orbs?: LootOrb[];
  /** Charged-shot ring at the cursor (gameplay plan §4.2). */
  charge?: ChargeIndicator | null;
  /** Click-placement preview for a targeted ability (gameplay plan §4.3). */
  placement?: PlacementIndicator | null;
}

/** Cursor charge ring state. Presentation only — the timer lives in `Game`. */
export interface ChargeIndicator {
  x: number;
  y: number;
  /** Charge fill, 0..1. Reaches 1 when the shot is armed. */
  progress: number;
  /** Cooldown fill, 0..1. 0 when ready. */
  cooldown: number;
  ready: boolean;
}

/** Placement-mode preview: the ring the next click will drop the ability on. */
export interface PlacementIndicator {
  x: number;
  y: number;
  /** Effect radius drawn at the cursor. */
  radius: number;
  label: string;
}
