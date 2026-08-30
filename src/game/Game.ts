import type { AbilityId, BossPattern, GameState, TowerState, AbilityState, ResourceState, PrestigeState, GameStats, Mine, StatsInfo, TargetingMode, RunRecord, WaveModifierSnapshot, EnemyType, EquipmentSlot, EquipmentStatType, Equipment, AutoBuyStrategy, GoldSourceEntry } from '../types';
import { GAME_SPEEDS, DEFAULT_SPEED_INDEX, MAX_SPEED_INDEX, MAX_RUN_HISTORY } from '../types';

/**
 * Fixed simulation substep, and the ceiling on substeps per frame (plan §5.2).
 *
 * One step is a 60 Hz frame, so at 1x speed nothing changes: `dt` is already
 * about 1/60 and the loop runs once. The cap bounds the worst case — a frame
 * hitch at maximum game speed — at six times the per-frame simulation cost
 * rather than an unbounded spiral; when it bites, steps grow instead of time
 * being dropped, so the game never runs slow-motion under load.
 */
const FIXED_STEP = 1 / 60;
const MAX_SUBSTEPS = 6;
import { HOMING, MANUAL_AIM, TOWER_BASE, TOWER_HIT_RADIUS, TOWER_VISUAL } from '../data/tower';
import { CORES, CORE_BY_ID, CORE_TUNING, DEFAULT_CORE, isCoreId, type CoreId } from '../data/cores';
import { CoreManager } from '../systems/CoreManager';
import {
  BOSS_ENCOUNTER,
  BOSS_PATTERN_HINTS,
  BOSS_PATTERN_NAMES,
  ENEMY_BEHAVIOR,
  ENEMY_DEFS,
  bossEncounterOutcome,
  bossNameForWave,
  ignoresGroundEffects,
  isTargetable,
} from '../data/enemies';
import { ABILITIES, ABILITY_BY_ID, isTargeted } from '../data/abilities';
import { RESEARCH_BY_ID } from '../data/research';
import { world } from '../data/arena';
import { nextId } from '../utils/math';
import { EventBus } from './EventBus';
import { Renderer } from './Renderer';
import { Camera, type CameraResize } from './Camera';
import { Tower } from '../systems/Tower';
import { EnemyManager } from '../systems/EnemyManager';
import { ProjectileManager, type ShotVariant } from '../systems/ProjectileManager';
import { WaveManager } from '../systems/WaveManager';
import { ResourceManager } from '../systems/ResourceManager';
import { UpgradeManager } from '../systems/UpgradeManager';
import { EffectsManager } from '../systems/EffectsManager';
import { DEFAULT_QUALITY, QUALITY, isQualityTier, type QualityTier } from '../data/quality';
import { NotificationManager } from '../systems/NotificationManager';
import { AbilityManager } from '../systems/AbilityManager';
import { PrestigeManager } from '../systems/PrestigeManager';
import { ResearchTree } from '../systems/ResearchTree';
import { AutomationManager } from '../systems/AutomationManager';
import { SaveManager, type PersistentState, type OfflineResult } from '../systems/SaveManager';
import { AchievementManager } from '../systems/AchievementManager';
import { UIManager } from '../ui/UIManager';
import type { BossBarData } from '../ui/BossBar';
import type { EnemyWatchLine, WatchChapterView, WatchInfo } from '../ui/UIManager';
import {
  avariceStreakGoldBonus,
  bossEncounterWeight,
  GOLD_GROWTH,
  isBossWave,
  goldDropForWave,
  spawnCountForWave,
  waveMasteryChainMultiplier,
} from '../data/formulas';
import type { AutomationKey } from '../data/prestige';
import type { ShotSplash } from '../data/prestige';
import {
  DEFAULT_AUTO_ASCEND_WAVE,
  PRESTIGE_PROJECTILE_TUNING,
  TP_AOE_SPLASH_RADIUS,
  composeShotSplash,
} from '../data/prestige';
import { AudioManager } from '../systems/AudioManager';
import { TowerXpManager } from '../systems/TowerXpManager';
import { TalentManager } from '../systems/TalentManager';
import { PassiveAbilityManager } from '../systems/PassiveAbilityManager';
import { EquipmentManager } from '../systems/EquipmentManager';
import { formatInt } from '../utils/bigNumber';
import {
  pickRandomModifiers,
  snapshotFromDef,
  MUTATOR_DURATION_WAVES,
  waveModifierRewardMultiplier,
} from '../data/waveModifiers';
import { TALENT_STATS, TALENT_TUNING, type TalentStat } from '../data/talentTree';
import { PASSIVE_ABILITIES } from '../data/passiveAbilities';
import { ACHIEVEMENT_REWARD_CONSUMERS, type AchievementRewardType } from '../data/achievements';
import { EVOLUTION_EFFECT_IDS, type EvolutionEffectId } from '../data/upgrades';
import { EQUIPMENT_STAT_TYPES } from '../data/equipment';
import {
  BuffRegistry,
  goldSourceEntries,
  resolveStats,
  type ResolvedStats,
  type StatContext,
} from '../stats';
import { WaveModifierModal } from '../ui/WaveModifierModal';
import { BlessingDraftModal } from '../ui/BlessingDraftModal';
import { CorePickerModal } from '../ui/CorePickerModal';
import type { CorePanelState } from '../ui/PrestigePanel';
import type { UpgradeShotPreview, ShotPreview } from '../ui/UpgradePanel';
import type { PacingHudData } from '../ui/PacingOverlay';
import { BlessingManager } from '../systems/BlessingManager';
import { LootManager } from '../systems/LootManager';
import { ContractManager } from '../systems/ContractManager';
import { PacingManager } from '../systems/PacingManager';
import { CONTRACT_SLOTS, CONTRACT_TUNING } from '../data/contracts';
import {
  COMBO_TIERS,
  EARLY_CALL_DELAY_SECONDS,
  EARLY_CALL_GOLD_PER_SECOND,
  MAX_RISK,
  MAX_RISK_CEILING,
  MOMENTUM_CAP,
  RISK_GOLD_PER_STEP,
  RISK_HP_PER_STEP,
  RISK_SPEED_PER_STEP,
  clampRisk,
  intermissionSecondsForWave,
  riskApBonus,
} from '../data/pacing';
import { WatchManager, type WatchMetrics } from '../systems/WatchManager';
import {
  WATCH_CHAPTERS,
  WATCH_UNLOCKS,
  describeGoal,
  goalTarget,
  type WatchUnlockId,
} from '../data/watch';
import { AbilityPlacement, ChargeTracker } from '../systems/ActiveInput';
import { FX, INK, lighten, mix, withAlpha } from '../data/palette';
import { LOOT_ORB_COLORS, type LootOrbKind } from '../data/loot';
import {
  BLESSING_BY_ID,
  BLESSING_FREE_REROLLS,
  BLESSING_MAX_PICKS,
  BLESSING_OFFER_SIZE,
  BLESSING_TUNING,
  describeBlessing,
  type BlessingBehavior,
  type BlessingDef,
} from '../data/blessings';
import {
  computeTowerMarks, TOWER_MARK_BY_ID, DEFAULT_TOWER_MARKS,
  type TowerMarkId, type TowerMarks,
} from '../data/towerMarks';

/** Multiplier a gold-luck proc pays out at. */
const GOLD_LUCK_MULTIPLIER = 3;
/** HP fraction restored on each passive revive (plan §7.3). */
const PASSIVE_REVIVE_FRACTION = 0.5;
/** Fire-rate multiplier while the player holds the mouse to aim manually. */
/** Fire-rate multiplier granted by a quick-shot proc. */
const QUICK_SHOT_FIRE_RATE = 2;
/** localStorage key for the `autoCastAutoAim` preference (plan §A.2 / §H.2). */
const AUTO_AIM_KEY = 'the-tower-autocast-aim';
/**
 * Legacy key from before the abilities redesign (plan §H.2). The old
 * `instantCast` flag meant "auto-aim my own presses" — its value still
 * reads correctly as "auto-aim", so it is carried over into `AUTO_AIM_KEY`
 * once and removed. Kept as a constant (rather than inlined at the one
 * call site) so a grep finds the migration path.
 */
const LEGACY_INSTANT_CAST_KEY = 'the-tower-instant-cast';
const BUFF_QUICK_SHOT = 'tower:quickShot';
/**
 * Minimum away-time before the Welcome Back report is shown. Offline progress
 * is still applied below this, it just doesn't warrant a modal — otherwise
 * every brief tab switch pops one.
 */
const MIN_OFFLINE_REPORT_SECONDS = 60;
const WAVE_MILESTONES = new Set([10, 25, 50, 100, 200, 500]);
/**
 * Blessing draft timeouts, in **wall-clock** seconds (plan §1.1).
 *
 * With auto-pick on, the draft resolves itself after 20 s so an idle session
 * never parks on a modal. With auto-pick off the player has asked to decide,
 * so the deadline is long — but it still exists, because "nothing blocks on a
 * modal forever" is a rule, not a preference, and a player who walks away
 * mid-draft is the exact case it is there for.
 */
const BLESSING_AUTO_PICK_SECONDS = 10;
const BLESSING_SAFETY_TIMEOUT_SECONDS = 120;
/**
 * Core-picker timeout, in **wall-clock** seconds (plan §6.2).
 *
 * Longer than the blessing draft's because there are five cards to read and
 * the decision lasts a whole run rather than until the next draft. Timing out
 * keeps the current selection, which `CoreManager.resetRun` has already set to
 * the player's preference — so an auto-ascending run that nobody is watching
 * keeps the identity the player last chose, rather than reverting to the
 * default every time.
 */
const CORE_PICKER_TIMEOUT_SECONDS = 45;

/**
 * Tower-HP fractions that change a resolved stat, ascending.
 *
 * One list rather than three scattered comparisons, because the cost of
 * getting it wrong is silent: a threshold missing here is an effect that
 * arms late, which looks exactly like an effect that does not work.
 * `tests/cores.test.ts` and `tests/stats.test.ts` pin the effects themselves;
 * this is only the *when*.
 */
const HP_STAT_THRESHOLDS: readonly number[] = [
  BLESSING_TUNING.lastStandHpFraction,   // last_stand blessing (plan §1.3)
  CORE_TUNING.desperateHpFraction,       // bloodforge (plan §6.1)
  0.8,                                   // hp_threshold_damage evolution
];
/** localStorage key for the `autoPickBlessings` preference. */
const AUTO_PICK_BLESSINGS_KEY = 'the-tower-auto-pick-blessings';
/**
 * localStorage key for the quality preference (UI plan §9.D).
 *
 * Holds `'auto'` or one of the three tier ids. `'auto'` means the game may
 * still demote based on its 2-second probe; an explicit value is never
 * overridden until the player changes it back.
 */
const QUALITY_PREF_KEY = 'the-tower-quality';

/**
 * The first-run guess for the quality tier (UI plan §9.D).
 *
 * Two heuristics, applied in order:
 *  - Eight hardware-concurrency threads is the historical desktop/notebook
 *    split — a four-core mobile SoC does not run this game at 60 fps with
 *    200 enemies on `high`, and the auto-detect is the path the player
 *    actually wants to be on. A coarse pointer (phone-class device) drops
 *    that threshold one notch: even a fast phone is paying 2.25x fill-rate
 *    tax for a 3x buffer nobody can see at arm's length.
 *  - The high-DPR rule catches the *remaining* path: a desktop with a 3x
 *    monitor (rare but real) and a coarse pointer (e.g. a kiosk) would
 *    otherwise stay on `high`. Demote one step.
 *
 * Pure: a node test can call it with mocked `navigator`/`matchMedia` values.
 */
export function initialQualityTier(): QualityTier {
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const highThreshold = coarse ? 16 : 8;
  let t: QualityTier = cores >= highThreshold ? 'high' : cores >= 4 ? 'medium' : 'low';
  if (coarse && dpr > 2 && t === 'high') t = 'medium';
  return t;
}

/**
 * The value read out of `localStorage` on startup. `'auto'` is the default; an
 * explicit `'high' | 'medium' | 'low'` is respected until the player changes
 * it. Anything else (a stale value, a different build's key) is treated as
 * `'auto'` and falls through to `initialQualityTier`.
 */
export function readStoredQuality(): 'auto' | QualityTier {
  if (typeof localStorage === 'undefined') return 'auto';
  const raw = localStorage.getItem(QUALITY_PREF_KEY);
  if (raw === 'high' || raw === 'medium' || raw === 'low' || raw === 'auto') return raw;
  return 'auto';
}

function persistQuality(value: 'auto' | QualityTier): void {
  if (typeof localStorage === 'undefined') return;
  if (value === 'auto') localStorage.removeItem(QUALITY_PREF_KEY);
  else localStorage.setItem(QUALITY_PREF_KEY, value);
}

function makeInitialState(): GameState {
  const tower: TowerState = {
    ...TOWER_BASE,
    cooldown: 0,
  };
  const resources: ResourceState = {
    gold: 0,
    mana: 0,
    maxMana: 100,
    manaRegen: 2,
    ascensionPoints: 0,
    apThisTranscendence: 0,
    transcendencePoints: 0,
    lifetimeAP: 0,
    lifetimeGold: 0,
  };
  const abilities: Record<string, AbilityState> = {};
  for (const def of ABILITIES) {
    abilities[def.id] = { level: 1, cooldown: 0, active: false, activeTimer: 0, xp: 0 };
  }
  const prestige: PrestigeState = {
    apSpent: {},
    tpSpent: {},
    automationFlags: {
      autoBuy: false,
      autoAbilities: false,
      autoAscend: false,
      autoTranscend: false,
    },
    targetAscendWave: DEFAULT_AUTO_ASCEND_WAVE,
    autoCastEnabled: {},
    autoBuyStrategy: 'balanced',
    autoBuyReserve: 0,
  };
  const stats: GameStats = {
    enemiesKilled: 0,
    bossesKilled: 0,
    goldEarned: 0,
    damageDealt: 0,
    shotsFired: 0,
    lifetimeHighestWave: 1,
    abilitiesCast: 0,
    ascensions: 0,
    lifetimeAscensions: 0,
    transcendences: 0,
    totalUpgradesPurchased: 0,
    startedAt: Date.now(),
    runStartedAt: Date.now(),
  };
  return {
    timestamp: Date.now(),
    tower,
    enemies: [],
    projectiles: [],
    resources,
    upgrades: {},
    research: {},
    researchInProgress: null,
    abilities,
    prestige,
    wave: {
      number: 1,
      highestWave: 1,
      spawning: true,
      enemiesSpawned: 0,
      enemiesToSpawn: 0,
      spawnInterval: 1.5,
      spawnTimer: 0.5,
      intermission: false,
      intermissionTimer: 0,
      autoProgress: true,
      waveModifier: { active: null, choiceForNextWave: null, pendingChoiceForWave: null, goldSnapshot: null, wavesRemaining: 0, wavesCleared: 0 },
      elapsed: 0,
      enrageStacks: 0,
    },
    stats,
    achievements: [],
    runHistory: [],
    runStartedAt: Date.now(),
    towerXp: { xp: 0, level: 1, unspentTalentPoints: 1, totalXpEarned: 0 },
    talents: { allocated: {} },
    passiveAbilities: {},
    equipment: [],
    equipped: {},
    blessings: {
      held: {},
      picksTaken: 0,
      rerolls: 0,
      pendingOfferForWave: null,
      wavesClearedThisRun: 0,
    },
    bossRun: { apBonusPct: 0, swiftKills: 0, flawlessKills: 0 },
    contracts: { active: [], completed: [], completedCount: 0, apBonusPct: 0, uidSeq: 0 },
    cores: { unlocked: [DEFAULT_CORE], preferred: DEFAULT_CORE, selected: DEFAULT_CORE },
    pacing: { risk: 0, committedRisk: 0, momentum: 0, momentumWaves: 0, comboBest: 0 },
    watch: {
      completed: [],
      counters: {
        killsByType: {},
        flawlessWaves: 0,
        swiftBosses: 0,
        contractsDone: 0,
        blessingPicks: 0,
        mutatorWaves: 0,
        riskWaves: new Array(MAX_RISK_CEILING + 1).fill(0),
      },
    },
  };
}

function readAutoPickPreference(): boolean {
  try {
    return localStorage.getItem(AUTO_PICK_BLESSINGS_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * `autoCastAutoAim` defaults **on**, which is exactly the previous behaviour:
 * auto-cast aims at the densest cluster. A player who wants every cast to
 * land on the tower turns it off. Defaulting it off would have silently
 * changed the controls of every existing save.
 *
 * The reader carries the legacy `instantCast` value over once and removes
 * the old key, so an existing player keeps the preference they had — the
 * new key's semantics ("should auto-cast aim?") are the same as the old
 * key's, so the value is the same value.
 */
function readAutoAimPreference(): boolean {
  try {
    const next = localStorage.getItem(AUTO_AIM_KEY);
    if (next !== null) return next !== '0';
    const legacy = localStorage.getItem(LEGACY_INSTANT_CAST_KEY);
    if (legacy !== null) {
      localStorage.removeItem(LEGACY_INSTANT_CAST_KEY);
      const on = legacy !== '0';
      localStorage.setItem(AUTO_AIM_KEY, on ? '1' : '0');
      return on;
    }
  } catch {
    // private mode / SSR — fall through to the default.
  }
  return true;
}

function writeAutoAimPreference(enabled: boolean): void {
  try {
    if (enabled) localStorage.removeItem(AUTO_AIM_KEY);
    else localStorage.setItem(AUTO_AIM_KEY, '0');
  } catch {
    // ignore
  }
}

function writeAutoPickPreference(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(AUTO_PICK_BLESSINGS_KEY, '1');
    else localStorage.removeItem(AUTO_PICK_BLESSINGS_KEY);
  } catch {
    // ignore
  }
}

/**
 * The boss intro's timeline (UI plan §5.D).
 *
 * `t` is seconds elapsed *in the current phase*, on the wall clock — the intro
 * is a cinematic and must run at the same 1.8 s whatever the speed multiplier
 * is doing to the simulation underneath it.
 */
interface BossIntroState {
  phase: 'in' | 'hold' | 'out';
  t: number;
  wave: number;
  name: string;
  pattern: string | null;
}

/**
 * The three phases, in seconds. Exported for `tests/effects.test.ts`, which
 * pins the §5.G acceptance criterion that the whole cinematic lands in under
 * two seconds — a number the plan states as a budget, not as a preference.
 */
export const INTRO_IN = 0.35, INTRO_HOLD = 1.10, INTRO_OUT = 0.35;   // 1.80 s total

/** The intro's bar extension curve. Local to §5.D; the renderer has its own. */
export function introEaseOutCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return 1 - (1 - c) ** 3;
}

export interface GameDeps {
  bus: EventBus;
  ui: UIManager;
  notificationRoot: HTMLElement;
  modalRoot: HTMLElement;
}


/**
 * The four numbers a shot's damage is composed from, lifted out of a resolved
 * stat block (revamp §12.2). Kept next to its only producer so the panel and
 * the tower cannot disagree about what "one shot" means.
 */
function shotPreviewOf(stats: ResolvedStats): ShotPreview {
  return {
    damage: stats.baseDamage,
    fireRate: stats.fireRate,
    critChance: stats.critChance,
    critMultiplier: stats.critMultiplier,
  };
}

export class Game {
  private readonly camera: Camera;
  private readonly renderer: Renderer;
  /** The live quality tier (§5.F + §9.D). Presentation only. */
  private quality: QualityTier = DEFAULT_QUALITY;
  /**
   * The user-facing quality preference (§9.D). `'auto'` is the default and the
   * only state in which the 2-second probe may demote the tier. An explicit
   * value is never overridden.
   */
  private qualityPref: 'auto' | QualityTier = 'auto';
  /**
   * The 2-second probe (UI plan §9.D). Started once, on the first frame of
   * wave 1 of the session, and only when the stored preference is `'auto'`.
   * After the probe runs (or is abandoned) this is `null` and never refills —
   * promotion is the Settings control's job, not a per-load guess.
   */
  private qualityProbe: { frames: number; sum: number; elapsed: number } | null = null;
  private readonly bus: EventBus;
  private readonly ui: UIManager;

  private readonly state: GameState;
  private readonly tower: Tower;
  private readonly enemyMgr: EnemyManager;
  private readonly projectileMgr: ProjectileManager;
  private readonly waveMgr: WaveManager;
  private readonly resourceMgr: ResourceManager;
  private readonly upgradeMgr: UpgradeManager;
  /**
   * The tower's upgrade marks (`plans/tower-ui.md`).
   *
   * Rebuilt only when upgrade levels change, and handed to every snapshot as
   * the same frozen object in between, so the renderer's "has this changed"
   * check is a reference compare rather than sixty string builds a second.
   */
  private towerMarks: TowerMarks = DEFAULT_TOWER_MARKS;
  private readonly effects: EffectsManager;
  private readonly notifications: NotificationManager;
  private readonly abilityMgr: AbilityManager;
  private readonly prestigeMgr: PrestigeManager;
  private readonly researchTree: ResearchTree;
  private readonly automation: AutomationManager;
  private readonly saveMgr: SaveManager;
  private readonly achievementMgr: AchievementManager;
  private readonly audio: AudioManager;
  private readonly towerXpMgr: TowerXpManager;
  private readonly talentMgr: TalentManager;
  private readonly passiveMgr: PassiveAbilityManager;
  private readonly equipmentMgr: EquipmentManager;
  private readonly waveModModal: WaveModifierModal;
  private readonly blessingMgr: BlessingManager;
  private readonly coreMgr: CoreManager;
  private readonly blessingModal: BlessingDraftModal;
  private readonly corePicker: CorePickerModal;
  /** Loot orbs (plan §4.1). Run-scoped and never persisted. */
  private readonly lootMgr: LootManager;
  /** The run's three contracts (plan §5). Run-scoped, persisted in full. */
  private readonly contractMgr: ContractManager;
  /** Risk dial, early-call momentum and the kill combo (plan §7). */
  private readonly pacingMgr = new PacingManager();
  /**
   * The Long Watch (plans/milestones.md §5.0): chapters, unlocks, persistent
   * unlocks. Constructed after every consumer that reads it, but each
   * consumer holds a closure rather than a direct reference, so order is
   * enforced by the `this.watchMgr = ...` line in the constructor.
   */
  private readonly watchMgr: WatchManager;
  /**
   * `PacingManager.statSignature` at the last resolve.
   *
   * The same trick `hpStatBucket` uses: every pacing input is discrete, so a
   * signature comparison costs one number per substep and a resolve is paid
   * for only when something the pipeline reads actually moved. Part 6's
   * finding — three effects that read live state and armed at the *next*
   * unrelated resolve — is exactly the bug this prevents for a combo tier that
   * has to pay on the kill that earned it.
   */
  private pacingStatSignature = -1;
  /** This frame's pacing readout, resolved once in `frameUpdate`. */
  private pacingHud: PacingHudData | null = null;
  /**
   * False once the tower has actually lost HP this wave.
   *
   * The generalisation of Part 3's per-encounter flawless flag rather than a
   * second mechanism: both are set at the *same* site in the `tower_damaged`
   * handler, after the wall / shield / armour chain has run, so "flawless"
   * means the same thing for a wave as it does for a boss — HP came off the
   * bar, not merely that something hit the tower.
   */
  private waveFlawless = true;
  /**
   * `stats.lifetimeHighestWave` before the `onWaveCleared` callback updates it.
   * Captured so `addWaveClearXp` can compute the pioneer bonus against the
   * correct (pre-update) value.
   */
  private lifetimeHighestWaveBeforeClear = 1;
  /** Charged-shot hold, on the wall clock (plan §4.2). */
  private readonly charge = new ChargeTracker();
  /** Set on release, consumed by the next substep so the shot is simulated. */
  private chargeFirePending = false;
  /** Ability waiting for a click to place it (plan §4.3). */
  private readonly placement = new AbilityPlacement();
  /**
   * Player preference: should auto-cast aim at the densest cluster, or just
   * cast from the tower? Defaults on (plan §A.2). Manual presses always arm
   * placement, so this preference governs *only* the automation path; the
   * name is the new public name for the legacy `instantCast` field.
   */
  private autoCastAutoAim = true;
  /**
   * Pointer is currently over the canvas. `placementSnapshot` reads it (in
   * Phase 4) so the reticle disappears when the cursor leaves the battlefield
   * rather than sticking at the edge. The field lives on `Game` rather than
   * on the input listeners in `main.ts` because both the mouse-leave and the
   * touch paths need to keep it in sync.
   *
   * Exposed via a getter rather than left as a public field so the wire-up
   * in `main.ts` is the only path that can write to it.
   */
  private pointerOnCanvas = false;

  /** Phase 4's `placementSnapshot` reads this to hide the reticle on leave. */
  get isPointerOnCanvas(): boolean {
    return this.pointerOnCanvas;
  }
  /**
   * Player preference for auto-picking blessings. Forced on when automation is
   * running (see `blessingAutoPickForced`), because a player who has unlocked
   * auto-buy is by definition not watching the screen.
   */
  private autoPickBlessings = false;
  /**
   * Every time-varying modifier in the game. Read by `buildStatContext`, so a
   * buff composes with upgrades instead of racing them (plan §6).
   */
  private readonly buffs = new BuffRegistry();
  /**
   * The context behind the stats currently in effect. `computeStatsInfo`
   * re-resolves *this* object to build its breakdown, which is what makes
   * "displayed" and "applied" the same computation rather than two that agree
   * by inspection.
   */
  private lastStatContext: StatContext | null = null;
  /** The stat block currently written into the tower and its managers. */
  private lastResolved: ResolvedStats | null = null;
  /** `BuffRegistry.version` as of the last recompute. */
  private appliedBuffVersion = -1;

  private lastTime = 0;
  private running = false;
  private saveLoaded = false;
  private rafId: number | null = null;


  private mines: Mine[] = [];
  private announcedMilestones = new Set<number>();
  private researchAnnounced = new Set<string>();
  private transcendenceUnlockedAnnounced = false;
  /**
   * Passives whose "now buyable" notification already fired this run. Cleared
   * when a run ends, so re-crossing an unlock wave in the next run notifies
   * again — but a same-run rewind (death retry) does not re-notify.
   */
  private passiveUnlockNotified = new Set<string>();

  private mouseX = 0;
  private mouseY = 0;
  private mouseDown = false;

  // Per-run baselines (snapshotted when a run starts; used to compute deltas
  // and to record RunRecord summaries on ascend/transcend).
  private runBaselineGold = 0;
  private runBaselineKills = 0;
  private runBaselineAbilities = 0;
  private runBaselineHighestWave = 1;
  /** Lifetime best run gold (for "new record" detection). */
  private bestGoldRun = 0;
  /** Lifetime best run wave (for "new record" detection). */
  private bestWaveRun = 1;

  private speedIndex = DEFAULT_SPEED_INDEX;
  private maxSpeedIndex = MAX_SPEED_INDEX;

  // P3: Boss entry / death FX
  private slowMoRemaining = 0;
  private slowMoTotal = 0;
  private screenFlash = 0;
  private towerFlash = 0;
  private wallFlash = 0;
  private shieldFlash = 0;
  /** Low-HP vignette intensity, 0..1. Painted by the renderer in screen space. */
  private vignette = 0;

  /**
   * The boss intro (UI plan §5.D).
   *
   * A 1.8 s cinematic that **never pauses the simulation** — the boss is
   * already fighting through it, and stopping the clock would break both the
   * wave timer and the idle contract. The state machine lives here rather than
   * in the renderer because only `Game` has `realDt`, `getSpeed()` and the
   * input; `Renderer.time` advances by a fixed `FRAME_DT`, which is right for a
   * looping shimmer and wrong for a wall-clock timeline.
   */
  private bossIntro: BossIntroState | null = null;
  /**
   * `prefers-reduced-motion`, resolved once. The intro degrades to a static
   * name plate rather than to nothing: which boss showed up is information.
   */
  private readonly reducedMotion: boolean = typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
  /**
   * Whether the primary pointer is coarse (touch-class device), resolved once
   * at construction. Drives the placement-prompt copy (plan §G.1): a finger
   * drags and lifts to cast; a mouse clicks to place.
   */
  private readonly coarsePointer: boolean = typeof matchMedia === 'function'
    && matchMedia('(pointer: coarse)').matches;

  // Talent values consumed by event handlers rather than by the stat recompute.
  private talentDodgeChance = 0;
  private talentManaShieldFraction = 0;
  private talentExtraProjectileChance = 0;
  private talentMagicProcChance = 0;
  /** Wall HP restored per second, as a fraction of wallMaxHp. */
  private talentWallRegen = 0;
  private talentHeadStartWaves = 0;

  // ── Levelling redesign step 4: new talent cache fields ──
  private killFrenzyPerStack = 0;
  private bloodlustStacks = 0;
  private critFollowUpChance = 0;
  private secondWindPower = 0;
  private secondWindArmed = true;
  private juggernautArmed = true;
  private juggernautImmunity = 0;
  private windfallMultiplier = 0;
  private interestRate = 0;
  private manaOnKillFraction = 0;
  private relentlessCounter = 0;

  // Evolution state
  private revivesUsed = 0;
  private extraReviveCharges = 0;
  /**
   * True while the run-over modal is up (plan §2.3.3). The simulation is
   * frozen so the dead tower is not killed again every frame and the field
   * stays on screen as a backdrop for the decision.
   */
  private runFailed = false;
  /** Wave the stall prompt has already fired for, so it fires once per wave. */
  private stalledWave = -1;
  private killStreak = 0;
  private manaFullGoldTimer = 0;
  private shotCounter = 0;
  /**
   * Which side of every HP-gated stat threshold the tower is currently on.
   * See `refreshHpThresholdStats`. `-1` forces the first pass to resolve.
   */
  private hpStatBucket = -1;
  /** Separate cadence from `shotCounter`, so the mortar and double-shot evolutions don't share a clock. */
  private mortarShotCounter = 0;
  /** `splash` upgrade payload, rewritten by `applyResolvedStats`. */
  private shotSplash: ShotSplash = {};
  /**
   * Reentrancy guard for `split_on_kill`: the shards damage enemies, which can
   * kill them, which re-enters this handler synchronously. Without the guard a
   * dense wave turns one kill into an unbounded cascade.
   */
  private splitOnKillActive = false;
  private waveGoldBonus = 0;

  /**
   * The boss encounter in progress (gameplay plan §3.4), or null.
   *
   * The *encounter* is the unit the rewards are measured against. That used to
   * matter because a boss wave fielded `2 + tier` bosses and paying a reroll
   * token per boss would have turned "flawless" into "flawless, times six"; the
   * wave fields one boss now, but the encounter is still the unit — its adds
   * and its escort have to be dealt with before the wave is over, and the clock
   * runs across all of it.
   */
  private bossEncounter: {
    /** Simulation seconds since the first boss of this wave spawned. */
    elapsed: number;
    /** False the moment the tower actually loses HP. */
    flawless: boolean;
    /** Summed `goldValue` of the bosses killed, for the swift-kill bonus. */
    goldValue: number;
    /** Wave the encounter belongs to, so a rewind cannot resolve a stale one. */
    wave: number;
  } | null = null;

  constructor(canvas: HTMLCanvasElement, deps: GameDeps) {
    this.bus = deps.bus;
    this.ui = deps.ui;
    this.camera = new Camera(canvas);
    this.camera.onResize = (info) => this.onCameraResize(info);
    this.renderer = new Renderer(canvas, this.camera);
    this.state = makeInitialState();
    this.tower = new Tower(this.state.tower);
    this.resourceMgr = new ResourceManager(this.state.resources, this.state.stats, this.bus);
    this.researchTree = new ResearchTree(this.bus);
    this.enemyMgr = new EnemyManager(this.bus, this.resourceMgr, this.researchTree);
    this.projectileMgr = new ProjectileManager(this.bus, this.tower, this.enemyMgr);
    this.waveMgr = new WaveManager(
      this.bus,
      this.enemyMgr,
      this.camera.worldWidth,
      this.camera.worldHeight,
      (wave) => {
        this.lifetimeHighestWaveBeforeClear = this.state.stats.lifetimeHighestWave;
        if (wave > this.state.wave.highestWave) {
          this.state.wave.highestWave = wave;
        }
        if (wave > this.state.stats.lifetimeHighestWave) {
          this.state.stats.lifetimeHighestWave = wave;
        }
      },
      (wave) => {
        this.applyUpgradeEffects();

        if (wave > this.state.wave.highestWave) {
          this.state.wave.highestWave = wave;
        }
        if (wave > this.state.stats.lifetimeHighestWave) {
          this.state.stats.lifetimeHighestWave = wave;
        }
        this.checkPassiveUnlocks(wave);
      },
    );
    this.upgradeMgr = new UpgradeManager(this.bus, this.resourceMgr);
    // The draft overrides are read lazily (only on `openDraft` / `rollOffer`),
    // so the closures can capture `this.watchMgr` even though that field is
    // assigned further down — plans/milestones.md §5.3 ordering note.
    this.blessingMgr = new BlessingManager(this.bus, {
      offerSize: () => (this.watchMgr.has('wide_draft') ? BLESSING_OFFER_SIZE + 1 : BLESSING_OFFER_SIZE),
      freeRerolls: () => BLESSING_FREE_REROLLS + (this.watchMgr.has('quartermaster') ? 1 : 0),
      // Opening Gambit (prestige-abs §5) moves the first draft's *wave*, where
      // `wide_draft` moves the card count and `quartermaster` the free
      // rerolls — three separate channels, so they compose (§R1).
      firstDraftWave: () => this.prestigeMgr.getFirstDraftWave(),
    });
    this.coreMgr = new CoreManager(this.bus);
    this.lootMgr = new LootManager({
      bus: this.bus,
      towerPos: () => ({ x: this.state.tower.x, y: this.state.tower.y }),
      pay: (kind, amount, full, orb) => this.payOrb(kind, amount, full, orb.x, orb.y),
    });
    this.contractMgr = new ContractManager({
      bus: this.bus,
      currentWave: () => this.waveMgr.currentWave,
      waveGold: (wave) => this.estimateWaveGold(wave),
      // The board_expansion Watch unlock (plans/milestones.md §5.2) raises
      // the tracker to four slots. The dep reads lazily.
      slots: () => (this.watchMgr.has('board_expansion') ? CONTRACT_SLOTS + 1 : CONTRACT_SLOTS),
      // Broker (prestige-abs §5). Lazy, so a mid-run purchase is felt on the
      // next completion rather than at the next contract draw.
      rewardScale: () => this.prestigeMgr.getContractRewardMultiplier(),
    });
    // The Long Watch manager (plans/milestones.md §5.0). Constructed here so
    // the blessings / contracts / pacing / prestige deps that read it are all
    // already wired — each callback fires only when the consumer needs it.
    this.watchMgr = new WatchManager({
      bus: this.bus,
      state: () => this.state.watch,
      metrics: () => this.watchMetrics(),
    });
    // Watch raises the risk dial's ceiling (plans/milestones.md §5.5). The
    // provider reads lazily; before any chapter lands it is a no-op because
    // the default is `MAX_RISK`.
    this.pacingMgr.setMaxRiskProvider(() => this.maxRisk());
    // The impact path asks `has(behavior)` several times per hit, so it reads
    // the manager's rebuilt cache rather than scanning the pool.
    this.projectileMgr.setBlessings(this.blessingMgr);
    this.projectileMgr.setCore(this.coreMgr);
    this.waveModModal = new WaveModifierModal(deps.modalRoot);
    this.blessingModal = new BlessingDraftModal(deps.modalRoot);
    this.corePicker = new CorePickerModal(deps.modalRoot);
    this.autoPickBlessings = readAutoPickPreference();
    this.autoCastAutoAim = readAutoAimPreference();
    this.effects = new EffectsManager();
    this.effects.onShockwaveDamage = (s) => {
      // P5 boss death: damage enemies caught in the ring (single hit per ring)
      if (!s.damage) return;
      const inner = s.currentRadius - 30; // damage band just inside the wave front
      const outer = s.currentRadius + 30;
      const innerSq = Math.max(0, inner) * Math.max(0, inner);
      // The grid narrows this to the outer disc; the inner cut-off still has
      // to be applied by hand, since a ring is not a circle query.
      for (const en of this.enemyMgr.queryRadius(s.x, s.y, outer)) {
        const dx = en.x - s.x;
        const dy = en.y - s.y;
        if (dx * dx + dy * dy >= innerSq) {
          this.enemyMgr.damage(en, s.damage, false);
        }
      }
    };
    this.notifications = new NotificationManager(deps.notificationRoot, this.bus);
    this.abilityMgr = new AbilityManager({
      resources: this.resourceMgr,
      enemies: this.enemyMgr,
      tower: this.tower,
      bus: this.bus,
      projectileManager: this.projectileMgr,
      buffs: this.buffs,
      getState: (id) => this.state.abilities[id],
      onCast: () => {
        this.state.stats.abilitiesCast += 1;
        this.contractMgr.note({ kind: 'ability_cast' });
        // Archmage keystone: casting grants fire rate buff.
        if (this.talentMgr.hasBehavior('archmage')) {
          this.buffs.set({
            id: 'talent_archmage',
            stat: 'fireRate',
            kind: 'mult',
            value: 1 + TALENT_TUNING.archmageFireRateBonus,
            label: 'Archmage',
            remaining: TALENT_TUNING.archmageBuffSeconds,
          });
        }
      },
      // Plan §D.10: Gold Rush holds the loot magnet for the buff's duration.
      setGoldRushMagnet: (on) => this.lootMgr.setMagnetSource('goldRush', on),
      // Attunement (prestige-abs §5). The same offset feeds the milestone
      // strip and the progression tab, both of which derive it from
      // `state.prestige.apSpent` — one derivation, so the strip cannot
      // advertise a wave the gate no longer uses.
      unlockWaveOffset: () => this.prestigeMgr.getAbilityUnlockOffset(),
    });
    this.prestigeMgr = new PrestigeManager(this.bus, {
      resources: this.state.resources,
      stats: this.state.stats,
      prestige: this.state.prestige,
      achievementMultiplier: (type) => this.achievementMgr.getRewardMultiplier(type),
      // Watch's overseer unlock (plans/milestones.md §5.6) unlocks `autoBuy`
      // without spending an AP perk. Other keys stay perk-only.
      externalAutomation: (key) => key === 'autoBuy' && this.watchMgr.has('overseer'),
    });
    this.automation = new AutomationManager({
      upgrades: this.upgradeMgr,
      abilities: this.abilityMgr,
      prestige: this.prestigeMgr,
      research: this.researchTree,
      getState: () => this.state,
      onAscend: () => this.ascend(),
      onTranscend: () => this.transcend(),
      bus: this.bus,
      // Plan §A.2 / §F.1: auto-cast honours the player's `autoCastAutoAim`
      // preference — `'auto'` for cluster-aim, `'tower'` for the cheap
      // tower-centre fallback. Read each tick so a settings-panel change
      // is picked up on the next auto-cast, not on a reload.
      getAutoAim: () => this.autoCastAutoAim,
    });
    this.saveMgr = new SaveManager(this.bus, {
      getRP: () => this.researchTree.rp,
      getIdleCapSeconds: () => this.prestigeMgr.getIdleTimeCapSeconds(),
    });
    this.achievementMgr = new AchievementManager(this.bus, {
      getStats: () => this.state.stats,
      getAchievements: () => this.state.achievements,
      researchCount: () => Object.keys(this.state.research).length,
    });
    this.audio = new AudioManager(this.bus);
    this.towerXpMgr = new TowerXpManager(this.state.towerXp, this.bus);
    this.talentMgr = new TalentManager(this.state.talents, this.bus, {
      towerXpUnspentPoints: () => this.state.towerXp.unspentTalentPoints,
      spendTalentPoint: () => this.towerXpMgr.spendTalentPoint(),
      grantTalentPoint: () => this.towerXpMgr.grantTalentPoint(),
      spendGold: (amount) => this.resourceMgr.spendGold(amount),
    });
    this.passiveMgr = new PassiveAbilityManager(this.state.passiveAbilities, this.bus);
    this.passiveMgr.ensureInitialized();
    this.equipmentMgr = new EquipmentManager(this.state.equipment, this.state.equipped, this.bus);

    this.seatArena();
    this.state.upgrades = this.upgradeMgr.snapshot();
    this.applyUpgradeEffects();
    this.refreshTowerMarks(false);
    // A fresh game starts with three live contracts. A save load replaces them
    // in `applyPersistedState`; drawing here means the tracker is never empty,
    // including on the very first frame before any save has been read.
    this.contractMgr.refill();
    this.state.contracts = this.contractMgr.snapshot();
    this.syncUiApis();
    this.resetRunBaselines();
    // UI plan §9.D: resolve the saved quality preference into a tier before the
    // first frame. The probe is started separately, on the first frame of wave
    // 1, so a hidden tab or a 6.5x game speed cannot pollute the measurement.
    this.applyStoredQuality();

    this.bus.on('enemy_damaged', (payload: unknown) => {
      const p = payload as { enemy: { id: number; x: number; y: number; type: string; armor: number; magicResist: number; hp: number; maxHp: number; goldValue: number; alive: boolean }; amount: number; killed: boolean; isCrit?: boolean };
      const def = ENEMY_DEFS[p.enemy.type as keyof typeof ENEMY_DEFS];
      this.effects.emitHitSparks(p.enemy.x, p.enemy.y, def.color, p.killed ? 6 : 3);
      this.effects.emitDamageNumber(p.enemy.x, p.enemy.y, p.amount, !!p.isCrit, {
        maxHp: p.enemy.maxHp,
        kind: 'damage',
      });
      const ls = this.tower.effectiveLifesteal;
      if (ls > 0 && p.amount > 0) {
        const ts = this.tower.snapshot;
        const healAmt = p.amount * ls;
        ts.hp = Math.min(ts.maxHp, ts.hp + healAmt);
        this.effects.emitHealNumber(ts.x, ts.y - TOWER_VISUAL.bodyRadius - 24, healAmt);
      }
      // Research: Arcane Recovery — crits restore mana
      if (p.isCrit) {
        const critMana = this.researchTree.getCritManaRestore();
        if (critMana > 0) {
          this.resourceMgr.addMana(critMana);
        }
      }
    });
    this.bus.on('enemy_killed', (enemy) => {
      const e = enemy as { x: number; y: number; type: string; maxHp?: number; isSplitChild?: boolean; goldValue?: number; elite?: boolean };
      const def = ENEMY_DEFS[e.type as keyof typeof ENEMY_DEFS];
      this.state.stats.enemiesKilled += 1;
      this.contractMgr.note({ kind: 'enemy_killed', type: e.type as EnemyType });
      this.noteWatchKill(e.type as EnemyType);
      // Plan §3.4: an elite kill is worth showing up for — the gold multiplier
      // and RP are handled in EnemyManager; the gear roll and the toast are
      // here because they need the equipment manager and the notification bus.
      if (e.elite) {
        const eliteDrop = this.equipmentMgr.rollDrop(this.waveMgr.currentWave, 'elite');
        if (eliteDrop) {
          this.bus.emit('toast', {
            kind: 'milestone',
            text: `Elite dropped ${eliteDrop.rarity} gear!`,
            life: 4,
          });
        }
        this.effects.emitShockwaveRing(e.x, e.y, 120, withAlpha(FX.gold, 0.7), 5, 0, 0, 'magic');
      }
      if (e.type === 'boss') {
        this.state.stats.bossesKilled += 1;
        if (this.bossEncounter) this.bossEncounter.goldValue += e.goldValue ?? def.baseGold;
        // P5: Multi-stage death shockwave — 3 cascading rings that each damage enemies once.
        // Stage 1 (immediate): tight inner ring — strongest damage
        this.effects.emitShockwaveRing(e.x, e.y, 150, withAlpha(FX.blood, 0.9), 8, 0, 120, 'magic');
        // Stage 2: mid ring
        this.effects.emitShockwaveRing(e.x, e.y, 300, withAlpha(FX.ember, 0.85), 7, 0.2, 80, 'magic');
        // Stage 3: wide outer ring
        this.effects.emitShockwaveRing(e.x, e.y, 500, withAlpha(mix(FX.ember, FX.gold, 0.4), 0.8), 6, 0.4, 50, 'magic');
        // P5: Bonus x2 gold (normal gold already awarded in damage(); add 1x more)
        this.resources.addGold((e.goldValue ?? def.baseGold) * 1);
        // Achievement reward: bonus gold from boss kills.
        const achBossGold = this.achievementMgr.getRewardMultiplier('boss_gold_mult');
        if (achBossGold > 0) {
          const bonus = Math.floor((e.goldValue ?? def.baseGold) * achBossGold);
          if (bonus > 0) this.resources.addGold(bonus);
        }
        // Evolution: Headhunter — boss kills +50% gold
        if (this.upgradeMgr.hasEvolutionEffect('headhunter')) {
          const headhunterBonus = Math.floor((e.goldValue ?? def.baseGold) * this.upgradeMgr.getEvolutionEffectValue('headhunter'));
          if (headhunterBonus > 0) {
            this.resources.addGold(headhunterBonus);
          }
        }
        this.bus.emit('boss_killed', { x: e.x, y: e.y, goldValue: e.goldValue ?? def.baseGold });
        // Death slow-mo + screen flash (P3 + P5)
        this.triggerBossDeathSlowMo();
        // Equipment drop. Rolled once per *boss the wave is worth*, not once
        // per body: the pack used to pay `2 + tier` rolls a wave and the lone
        // boss inherits the whole encounter's gear budget, exactly as it
        // inherits its gold. One toast for the lot — `2 + tier` separate
        // "Equipment dropped" toasts is a wave the player cannot read.
        const eqDrops: Equipment[] = [];
        for (let i = 0; i < bossEncounterWeight(this.waveMgr.currentWave); i++) {
          const eqDrop = this.equipmentMgr.rollDrop(this.waveMgr.currentWave, 'boss');
          if (eqDrop) eqDrops.push(eqDrop);
        }
        if (eqDrops.length === 1) {
          this.bus.emit('toast', { kind: 'milestone', text: `Equipment dropped: ${eqDrops[0].rarity}!`, life: 4 });
        } else if (eqDrops.length > 1) {
          this.bus.emit('toast', {
            kind: 'milestone',
            text: `Equipment dropped: ${eqDrops.length} pieces!`,
            life: 4,
          });
        }
        if (this.state.stats.bossesKilled === 1) {
          this.bus.emit('toast', { kind: 'milestone', text: 'First boss defeated! +200g', life: 5 });
        } else {
          this.bus.emit('toast', { kind: 'milestone', text: `Boss defeated! +${formatInt((e.goldValue ?? def.baseGold) * 2)}g`, life: 6 });
        }
        // `enemy_killed` fires from inside `damage`, before the dead are
        // filtered out — but `alive` is already false, so this counts what is
        // genuinely still standing.
        if (this.enemyMgr.bossAliveCount() === 0) this.resolveBossEncounter();
      }

      // Splitter: on death spawn 2 child splitters (unless this is a child itself)
      if (e.type === 'splitter' && !e.isSplitChild) {
        const wave = this.waveMgr.currentWave;
        // Find the dead splitter in the list to get full enemy props
        const parent = this.enemyMgr.list.find(en => !en.alive && en.x === e.x && en.y === e.y && en.type === 'splitter');
        if (parent) {
          // Opposed scatter angles, so the pair visibly splits apart rather
          // than drifting off in the same direction (plan §2.2).
          const angle = Math.random() * Math.PI * 2;
          this.enemyMgr.spawnSplitterChild(parent, wave, e.x - world(6), e.y, angle);
          this.enemyMgr.spawnSplitterChild(parent, wave, e.x + world(6), e.y, angle + Math.PI);
        }
        this.effects.emitSplitBurst(e.x, e.y);
      }

      // Plan §4.1: bosses and elites always leave something to pick up, and
      // any kill can. Rolled here rather than in EnemyManager because the drop
      // needs the wave, the mana pool and the blessing state, all of which
      // live on this side.
      this.dropOrbsFor(e.x, e.y, e.type === 'boss', !!e.elite);

      // Tower XP & passive ability XP
      this.towerXpMgr.addKillXp(e.type as EnemyType, this.waveMgr.currentWave);
      this.passiveMgr.addKillXp(e.type as EnemyType, this.waveMgr.currentWave);

      this.effects.emitDeathBurst(e.x, e.y, def.color, def.radius);

      // Plan §7.2: the combo meter. Registered before the evolution below so
      // the two read the same kill, and *after* the gold for this kill has
      // already been paid — like `kill_streak_gold`, a tier crossing pays from
      // the next kill onward rather than retroactively.
      this.pacingMgr.noteKill();

      // Evolution: kill_streak_gold
      if (this.upgradeMgr.hasEvolutionEffect('kill_streak_gold')) {
        this.killStreak += 1;
        const perKill = this.upgradeMgr.getEvolutionEffectValue('kill_streak_gold');
        // Revamp §6.2.1: hard cap. A deep wave sustains a streak as long as its
        // own enemy count (~50 near the wall), so uncapped this was worth over
        // +200% gold on its own — the largest single term in the 1.185x/wave
        // income growth the revamp bounds.
        this.enemyMgr.setKillStreakGoldBonus(
          avariceStreakGoldBonus(this.killStreak, perKill),
        );
      }

      // ── blessing behaviors on kill (plan §1.3) ──
      if (this.blessingMgr.has('siphon')) {
        this.resourceMgr.addMana(
          this.state.resources.maxMana * BLESSING_TUNING.siphonManaFraction,
        );
      }
      if (this.blessingMgr.has('split_on_kill')) this.fireSplitShards(e.x, e.y);

      // ── core behaviors on kill (plan §6.1) ──
      // Bloodforge pays for its own aggression. Applied here rather than in
      // `EnemyManager` for the same reason the orb drop is: it needs the tower's
      // max HP, which lives on this side.
      if (this.coreMgr.has('kill_heal')) {
        const ts = this.tower.snapshot;
        if (ts.maxHp > 0 && ts.hp < ts.maxHp) {
          ts.hp = Math.min(ts.maxHp, ts.hp + ts.maxHp * CORE_TUNING.killHealFraction);
        }
      }

      // Research: Chain Reaction — kills deal AoE to nearby enemies
      const chainAoE = this.researchTree.getChainKillAoE();
      if (chainAoE > 0 && e.maxHp) {
        const aoeDamage = Math.max(1, Math.floor(e.maxHp * chainAoE));
        const chainRadius = 70;
        for (const target of this.enemyMgr.queryRadius(e.x, e.y, chainRadius)) {
          this.enemyMgr.damage(target, aoeDamage, false);
        }
        this.effects.emitShockwaveRing(e.x, e.y, chainRadius);
      }

      // ── Levelling redesign step 7: talent mechanics on kill ──

      // Bloodlust: stacking damage buff on kill.
      if (this.killFrenzyPerStack > 0) {
        this.bloodlustStacks = Math.min(TALENT_TUNING.bloodlustMaxStacks, this.bloodlustStacks + 1);
        this.buffs.set({
          id: 'talent_bloodlust',
          stat: 'baseDamage',
          kind: 'mult',
          value: 1 + this.killFrenzyPerStack * this.bloodlustStacks,
          label: 'Bloodlust',
          remaining: TALENT_TUNING.bloodlustSeconds,
        });
      }

      // Soul Harvest: mana on kill.
      if (this.manaOnKillFraction > 0) {
        this.resourceMgr.addMana(this.state.resources.maxMana * this.manaOnKillFraction);
      }
    });

    // Plan §6.2: the run-summary CTA opens the picker. `UIManager` emits this
    // when the debrief is dismissed; the decision about whether a picker is due
    // stays here, with the state it depends on.
    this.bus.on('run_summary_dismissed', () => {
      this.openCorePickerIfDue();
    });

    this.bus.on('shield_break', (payload: unknown) => {
      const p = payload as { x: number; y: number };
      this.effects.emitEnemyShieldBreak(p.x, p.y);
    });

    // ── behavioural roster feedback (gameplay plan §2.1/§2.5) ──
    //
    // Every one of these is presentation only: the mechanics live in
    // `EnemyManager`, which emits the event from inside the fixed substep. What
    // is here is the part that has to *read* — a theft the player does not
    // notice is a bug report, not a mechanic.
    this.bus.on('shield_restored', (payload: unknown) => {
      const p = payload as { x: number; y: number };
      this.effects.emitEnemyShieldBreak(p.x, p.y);
    });
    this.bus.on('ward_absorbed', (payload: unknown) => {
      const p = payload as { x: number; y: number; amount: number };
      this.effects.emitShieldAbsorb(p.x, p.y);
    });
    this.bus.on('ward_projected', (payload: unknown) => {
      const p = payload as { x: number; y: number };
      this.effects.emitShockwaveRing(p.x, p.y, 90, withAlpha(FX.frost, 0.5), 2);
    });
    this.bus.on('siege_impact', (payload: unknown) => {
      const p = payload as { x: number; y: number; ownerId?: number };
      this.effects.emitMineExplosion(p.x, p.y);
      // Retaliation keystone: thorns damage the shot's owner.
      if (this.talentMgr.hasBehavior('retaliation') && p.ownerId !== undefined) {
        const ts = this.tower.snapshot;
        if (ts.thorns > 0) {
          const owner = this.enemyMgr.findById(p.ownerId);
          if (owner && owner.alive) {
            const thornDmg = Math.floor(owner.maxHp * ts.thorns);
            // Not reflectable, for the same reason Bastion's knockback thorns
            // are not: this is a slice of the siege's own bar.
            if (thornDmg > 0) this.enemyMgr.damage(owner, thornDmg, false, false);
          }
        }
      }
    });
    this.bus.on('burrower_surfaced', (payload: unknown) => {
      const p = payload as { x: number; y: number };
      this.effects.emitShockwaveRing(p.x, p.y, 70, withAlpha(mix(FX.gold, INK['300'], 0.35), 0.75), 4);
      this.effects.emitDeathBurst(p.x, p.y, mix(FX.gold, INK['700'], 0.55), 14, 10);
    });
    this.bus.on('enemy_blinked', (payload: unknown) => {
      const p = payload as { x: number; y: number };
      this.effects.emitShockwaveRing(p.x, p.y, 34, withAlpha(FX.mana, 0.6), 2);
    });
    this.bus.on('gold_stolen', (payload: unknown) => {
      const p = payload as { x: number; y: number; amount: number };
      this.effects.emitShockwaveRing(p.x, p.y, 60, withAlpha(FX.gold, 0.8), 3);
      this.bus.emit('toast', {
        kind: 'warning',
        text: `A thief stole ${formatInt(p.amount)}g — kill it before it escapes!`,
        life: 5,
      });
    });
    this.bus.on('gold_recovered', (payload: unknown) => {
      const p = payload as { x: number; y: number; amount: number };
      this.effects.emitShockwaveRing(p.x, p.y, 90, withAlpha(FX.gold, 0.85), 5);
      this.bus.emit('toast', {
        kind: 'milestone',
        text: `Thief intercepted — recovered ${formatInt(p.amount)}g.`,
        life: 5,
      });
    });
    this.bus.on('gold_escaped', (payload: unknown) => {
      const p = payload as { amount: number };
      this.bus.emit('toast', {
        kind: 'warning',
        text: `A thief escaped with ${formatInt(p.amount)}g.`,
        life: 5,
      });
    });

    // ── boss encounters (gameplay plan §3) ──
    //
    // Same split as the behavioural roster above: `EnemyManager` owns the state
    // machine inside the fixed substep and emits; everything here is the part
    // that has to read on screen. A phase the player cannot see change is a
    // longer bar with extra steps.
    this.bus.on('boss_spawned', (payload: unknown) => {
      const p = payload as { wave: number };
      if (this.bossEncounter && this.bossEncounter.wave === p.wave) return;
      this.bossEncounter = { elapsed: 0, flawless: true, goldValue: 0, wave: p.wave };
      // §5.D: the cinematic, layered on the entry beat that already fires here.
      this.beginBossIntro(p.wave, bossNameForWave(p.wave), this.leadBossPatternName());
    });
    this.bus.on('boss_phase', (payload: unknown) => {
      const p = payload as { x: number; y: number; phase: number; pattern: BossPattern };
      // The plan asks for the entry beat again on every crossing: the slow-mo
      // is what makes a phase change land as an event rather than a stat blip.
      this.triggerBossEntrySlowMo();
      this.screenFlash = 0.12;
      this.effects.emitBossEntryPulse(p.x, p.y);
      this.effects.emitShockwaveRing(p.x, p.y, 180, withAlpha(FX.ember, 0.8), 5);
      this.bus.emit('toast', {
        kind: 'warning',
        text: `Phase ${p.phase} — ${BOSS_PATTERN_NAMES[p.pattern]}. ${BOSS_PATTERN_HINTS[p.pattern]}`,
        life: 4.5,
      });
    });
    this.bus.on('boss_shield_up', (payload: unknown) => {
      const p = payload as { x: number; y: number };
      this.effects.emitShockwaveRing(p.x, p.y, 110, withAlpha(FX.frost, 0.7), 3);
    });
    this.bus.on('boss_shield_broken', (payload: unknown) => {
      const p = payload as { x: number; y: number };
      this.effects.emitEnemyShieldBreak(p.x, p.y);
      this.effects.emitShockwaveRing(p.x, p.y, 150, withAlpha(lighten(FX.frost, 0.35), 0.85), 4);
    });
    this.bus.on('boss_bulwark_held', (payload: unknown) => {
      const p = payload as { x: number; y: number; amount: number };
      if (p.amount > 0) this.effects.emitHealNumber(p.x, p.y - 40, p.amount);
      this.effects.emitShockwaveRing(p.x, p.y, 190, withAlpha(FX.nature, 0.7), 4);
      this.bus.emit('toast', {
        kind: 'warning',
        text: 'Bulwark held — the boss healed the shield back.',
        life: 3.5,
      });
    });
    this.bus.on('boss_summon', (payload: unknown) => {
      const p = payload as { x: number; y: number };
      this.effects.emitShockwaveRing(p.x, p.y, 130, withAlpha(FX.arcane, 0.7), 3);
    });
    this.bus.on('boss_slam', (payload: unknown) => {
      const p = payload as { x: number; y: number; mitigated: boolean };
      const ts = this.tower.snapshot;
      if (p.mitigated) {
        this.effects.emitShockwaveRing(p.x, p.y, 120, withAlpha(FX.frost, 0.6), 4);
        return;
      }
      this.effects.emitShockwaveRing(p.x, p.y, 260, withAlpha(FX.ember, 0.9), 7);
      this.effects.emitAttackSlash(p.x, p.y, ts.x, ts.y, FX.ember);
      this.triggerCanvasShake();
      this.screenFlash = 0.18;
    });
    this.bus.on('boss_enrage_stack', (payload: unknown) => {
      const p = payload as { stacks: number };
      if (p.stacks !== 1) return;
      this.bus.emit('toast', {
        kind: 'warning',
        text: 'The boss is enraging — it grows stronger every 10s it survives.',
        life: 5,
      });
    });

    this.bus.on('thorns_reflected', (amount: unknown) => {
      // Capped against the tower's own bar before it enters the mitigation
      // chain. The reflection is a share of a hit priced against *enemy* HP,
      // which outgrows tower HP by orders of magnitude — so the raw figure is
      // the wrong unit to spend the player's health in. A ceiling of
      // `thornsReflectMaxTowerHpFraction` per hit keeps a thorns elite a
      // sustained drain the player can read and answer, instead of a death
      // that lands from across the map with nothing near the tower.
      const maxHp = this.tower.snapshot.maxHp;
      const cap = maxHp > 0
        ? Math.floor(maxHp * ENEMY_BEHAVIOR.thornsReflectMaxTowerHpFraction)
        : 0;
      const dmg = cap > 0 ? Math.min(amount as number, cap) : (amount as number);
      if (dmg > 0) {
        this.bus.emit('tower_damaged', dmg);
      }
    });

    this.bus.on('enemy_healed', (payload: unknown) => {
      const p = payload as { healer: { x: number; y: number }; target: { x: number; y: number }; amount: number };
      this.effects.emitHealParticles(p.healer.x, p.healer.y, p.target.x, p.target.y);
      this.effects.emitDamageNumber(p.target.x, p.target.y - 10, p.amount, false, { kind: 'heal' });
    });
    this.bus.on('tower_damaged', (amount: unknown) => {
      let raw = Math.max(0, amount as number);
      if (raw <= 0) return;
      // Talent: Evasion — fully avoid the hit.
      if (this.talentDodgeChance > 0 && Math.random() < this.talentDodgeChance) {
        this.effects.emitDamageNumber(
          this.tower.snapshot.x,
          this.tower.snapshot.y - TOWER_VISUAL.bodyRadius - 24,
          0,
          false,
          { kind: 'self' },
        );
        return;
      }
      // Research: Reinforced Structure reduces incoming damage
      const towerDef = this.researchTree.getTowerDefense();
      if (towerDef > 0) raw = Math.floor(raw * (1 - towerDef));
      if (raw <= 0) return;
      // Evolution: Mana Shield — 10% DR when mana is full
      if (this.upgradeMgr.hasEvolutionEffect('mana_shield') && this.state.resources.mana >= this.state.resources.maxMana) {
        raw = Math.floor(raw * (1 - this.upgradeMgr.getEvolutionEffectValue('mana_shield')));
        if (raw <= 0) return;
      }
      const ts = this.tower.snapshot;
      if (ts.wallHp > 0) {
        raw = Math.floor(raw * 0.8);
        const absorbed = Math.min(ts.wallHp, raw);
        ts.wallHp -= absorbed;
        raw -= absorbed;
        this.effects.emitDamageNumber(
          ts.x,
          ts.y - TOWER_VISUAL.bodyRadius - 40,
          absorbed,
          false,
          { maxHp: ts.wallMaxHp, kind: 'self' },
        );

        if (ts.wallHp <= 0) {
          this.enemyMgr.setWallContactExtra(0);
          // Juggernaut keystone: immunity when wall breaks.
          if (this.juggernautArmed && this.talentMgr.hasBehavior('juggernaut')) {
            this.juggernautArmed = false;
            this.juggernautImmunity = TALENT_TUNING.juggernautImmunitySeconds;
            this.effects.emitShieldAbsorb(ts.x, ts.y);
            this.bus.emit('toast', {
              kind: 'milestone',
              text: 'Juggernaut! Immune for 4s.',
              life: 3,
            });
          }
        }

        if (raw <= 0) return;
      }
      if (ts.shieldCurrentCharges > 0) {
        ts.shieldCurrentCharges--;
        this.effects.emitShieldAbsorb(ts.x, ts.y);
        return;
      }
      const afterArmor = raw * (1 - ts.armor);
      const afterDefense = Math.max(0, afterArmor - ts.defense);
      let dmg = Math.floor(afterDefense);
      if (dmg <= 0) return;
      // Juggernaut keystone: 30% damage reduction while wall is up.
      if (this.talentMgr.hasBehavior('juggernaut') && ts.wallHp > 0) {
        dmg = Math.floor(dmg * (1 - TALENT_TUNING.juggernautDamageReduction));
        if (dmg <= 0) return;
      }
      // Juggernaut keystone: immunity after wall breaks.
      if (this.juggernautImmunity > 0) {
        return; // immune — damage is zeroed
      }
      // Talent: Mana Shield — spend mana to absorb part of the hit.
      if (this.talentManaShieldFraction > 0 && this.state.resources.mana > 0) {
        const absorbed = Math.floor(
          Math.min(this.state.resources.mana, dmg * this.talentManaShieldFraction),
        );
        if (absorbed > 0) {
          this.resourceMgr.spendMana(absorbed);
          dmg -= absorbed;
          if (dmg <= 0) return;
        }
      }
      ts.hp = Math.max(0, ts.hp - dmg);
      // Plan §3.4: "flawless" means the tower lost HP, not that it was hit —
      // a shot the wall or a shield charge ate cost the player nothing. Plan
      // §5.1's `flawless_waves` wants exactly the same rule at wave scope, so
      // it is the same site rather than a second mechanism that could disagree.
      if (this.bossEncounter) this.bossEncounter.flawless = false;
      this.waveFlawless = false;
      // Plan §7.1: momentum is a reward for being *ahead*, so it dies at the
      // same line the two flawless flags do — after the whole mitigation
      // chain, so a hit the wall ate does not break the streak either.
      this.pacingMgr.noteTowerDamaged();
      this.effects.emitDamageNumber(
        ts.x,
        ts.y - TOWER_VISUAL.bodyRadius - 24,
        dmg,
        false,
        { maxHp: ts.maxHp, kind: 'self' },
      );
      // Second Wind: heal and damage buff when HP drops below threshold.
      const frac = ts.maxHp > 0 ? ts.hp / ts.maxHp : 1;
      if (this.secondWindArmed && this.secondWindPower > 0
          && frac < TALENT_TUNING.secondWindThreshold) {
        this.secondWindArmed = false;
        ts.hp = Math.min(ts.maxHp, ts.hp + ts.maxHp * this.secondWindPower);
        this.buffs.set({
          id: 'talent_second_wind',
          stat: 'baseDamage',
          kind: 'mult',
          value: 1 + this.secondWindPower * TALENT_TUNING.secondWindDamageRatio,
          label: 'Second Wind',
          remaining: TALENT_TUNING.secondWindSeconds,
        });
        this.effects.emitShockwaveRing(ts.x, ts.y, 120, withAlpha(FX.nature, 0.6), 3);
        this.bus.emit('toast', { kind: 'milestone', text: 'Second Wind!', life: 3 });
      }
      if (ts.hp <= 0) {
        // Revive: evolution (Titan's Heart) + passive charges (plan §7.3).
        // The evolution is consumed first; passive charges stack on top.
        const evoRevive = this.upgradeMgr.hasEvolutionEffect('revive');
        const totalCharges = (evoRevive ? 1 : 0) + this.extraReviveCharges;
        if (this.revivesUsed < totalCharges) {
          const fraction = evoRevive && this.revivesUsed === 0
            ? Math.max(PASSIVE_REVIVE_FRACTION, this.upgradeMgr.getEvolutionEffectValue('revive'))
            : PASSIVE_REVIVE_FRACTION;
          ts.hp = Math.floor(ts.maxHp * fraction);
          this.revivesUsed += 1;
          this.bus.emit('toast', {
            kind: 'milestone',
            text: `Revived at ${Math.round(fraction * 100)}% HP! (${this.revivesUsed}/${totalCharges})`,
            life: 4,
          });
          return;
        }
        // Plan §2.3.3: once ascension is available a death is the *end of the
        // run*, not a one-wave rewind. Offer the ascension there and then so
        // the player has a decision to make instead of a wall to re-grind.
        if (this.prestigeMgr.canAscend(this.state.wave.highestWave)) {
          this.runFailed = true;
          this.bus.emit('run_failed', {
            wave: this.waveMgr.currentWave,
            highestWave: this.state.wave.highestWave,
            apPreview: this.prestigeMgr.previewAP(this.state.wave.highestWave),
            enrageStacks: this.state.wave.enrageStacks,
            goldEarned: Math.max(0, this.state.stats.goldEarned - this.runBaselineGold),
          });
          return;
        }
        this.bus.emit('toast', {
          kind: 'warning',
          text: `Tower destroyed! Restarting at wave ${this.waveMgr.currentWave - 1}.`,
          life: 4,
        });
        this.restartCurrentWave();
      }
    });
    // Plan §4.3: enrage already ends a stalled run eventually, but the player
    // deserves to be told the moment the wall is reached rather than watching
    // an unwinnable wave grind out. Only prompt once per wave, and only when
    // ascending is actually an option.
    this.bus.on('wave_enraged', (payload: unknown) => {
      const p = payload as { wave: number; stacks: number };
      if (p.stacks < 1) return;
      if (this.stalledWave === p.wave) return;
      if (!this.prestigeMgr.canAscend(this.state.wave.highestWave)) return;
      this.stalledWave = p.wave;
      this.bus.emit('run_stalled', {
        wave: p.wave,
        apPreview: this.prestigeMgr.previewAP(this.state.wave.highestWave),
      });
    });
    // ── contracts (gameplay plan §5.2) ──
    //
    // The manager decides *what* was earned — including applying the +50% AP
    // cap — and this pays it. The split matters: the cap lives with the only
    // writer of the running total, so a future second payer cannot route
    // around it by reading the def's reward directly.
    this.bus.on('contract_completed', (payload: unknown) => {
      const p = payload as {
        uid: number;
        name: string;
        label: string;
        reward: { goldWaves: number; rerolls: number; rp: number; apBonusPct: number };
      };
      const parts: string[] = [];
      if (p.reward.goldWaves > 0) {
        const gold = Math.max(
          1,
          Math.floor(this.estimateWaveGold(this.waveMgr.currentWave) * p.reward.goldWaves),
        );
        this.resourceMgr.addGold(gold);
        parts.push(`${formatInt(gold)}g`);
      }
      if (p.reward.rerolls > 0) {
        this.blessingMgr.grantRerollToken(p.reward.rerolls);
        this.state.blessings = this.blessingMgr.snapshot();
        parts.push(`${p.reward.rerolls} reroll${p.reward.rerolls === 1 ? '' : 's'}`);
      }
      if (p.reward.rp > 0) {
        this.researchTree.addRP(p.reward.rp);
        parts.push(`${p.reward.rp} RP`);
      }
      if (p.reward.apBonusPct > 0) {
        // Set rather than add: the manager owns the capped running total, so
        // this channel always mirrors it exactly (see `PrestigeManager`).
        this.prestigeMgr.setRunApBonus(this.contractMgr.apBonusPct, 'contract');
        parts.push(`+${Math.round(p.reward.apBonusPct * 100)}% AP`);
      }
      this.state.contracts = this.contractMgr.snapshot();
      this.state.watch.counters.contractsDone += 1;
      const rewardText = parts.join(' · ');
      this.bus.emit('contract_reward', { uid: p.uid, rewardText });
      const ts = this.tower.snapshot;
      this.effects.emitShockwaveRing(ts.x, ts.y, 200, withAlpha(FX.nature, 0.7), 5);
      this.bus.emit('toast', {
        kind: 'milestone',
        text: rewardText
          ? `Contract complete — ${p.name}: ${rewardText}`
          : `Contract complete — ${p.name}`,
        life: 5,
      });
      this.saveMgr.requestSave();
    });

    // The replacement is drawn after the payout, so the persisted block is
    // restated here rather than only on the completion.
    this.bus.on('contract_drawn', () => {
      this.state.contracts = this.contractMgr.snapshot();
    });

    this.bus.on('wave_started', (wave: unknown) => {
      this.stalledWave = -1;
      // Plan §4.3: a placement prompt must not outlive the situation it was
      // opened for. A wave transition is exactly that — whatever the player
      // was about to drop the meteor on is gone.
      this.cancelPlacement();
      const ts = this.tower.snapshot;
      if (ts.wallMaxHp > 0) {
        ts.wallHp = ts.wallMaxHp;
      }
      // Reset kill streak each wave
      this.killStreak = 0;
      this.enemyMgr.setKillStreakGoldBonus(0);
      // UI plan §9.D: start the 2-second frame-time probe on the first wave
      // of the session, and only when the player has left the game on Auto.
      // A wave boundary is a stable moment — the simulation is fresh, the
      // background is baked, and the player is looking at the field.
      const probeWave = wave as { number: number };
      if (typeof probeWave?.number === 'number' && probeWave.number === 1) this.startQualityProbe();
      // Plan §5.1: a wave is flawless until it isn't.
      this.waveFlawless = true;
      // Levelling redesign step 4: reset per-wave talent arms.
      this.secondWindArmed = true;
      this.juggernautArmed = true;
      // Levelling redesign step 7: Interest — earn gold on savings at wave start.
      if (this.interestRate > 0) {
        const wNum = (wave as { number?: number }).number ?? (wave as number);
        const cap = TALENT_TUNING.interestCapBase * Math.pow(GOLD_GROWTH, Math.max(0, wNum - 1));
        const payout = Math.floor(Math.min(this.state.resources.gold, cap) * this.interestRate);
        if (payout > 0) this.resourceMgr.addGold(payout);
      }
      // Plan §7.1/§7.4: the risk dial catches up and the momentum streak
      // settles. A wave that was *not* called early breaks the streak, which
      // covers the full intermission the plan names and every other way a wave
      // can begin — a rewind, a manual skip, a load, a wave-skip roll.
      this.pacingMgr.noteWaveStarted();
      this.prestigeMgr.setRiskApBonus(riskApBonus(this.pacingMgr.activeRisk));
      // Resolve now rather than waiting for the substep check, so the wave's
      // first spawn already carries the risk dial's enemy HP multiplier.
      this.refreshPacingStats();
      // Restated once per wave rather than once per frame: everything in the
      // block moves on a wave boundary except `comboBest`, which is a readout.
      this.state.pacing = this.pacingMgr.snapshot();

      const w = wave as number;
      // An encounter that never resolved — the run rewound a wave, or the
      // player stepped the wave manually — is dropped rather than left ticking
      // against a boss that is no longer on the field.
      if (this.bossEncounter && this.bossEncounter.wave !== w) this.bossEncounter = null;
      // Boss entry effects on boss waves
      if (isBossWave(w)) {
        this.triggerBossEntrySlowMo();
        this.effects.emitBossEntryPulse(ts.x, ts.y);
        this.beginBossIntro(w, bossNameForWave(w), this.leadBossPatternName());
      }
      if (WAVE_MILESTONES.has(w) && !this.announcedMilestones.has(w)) {
        this.announcedMilestones.add(w);
        const kind = isBossWave(w) ? 'milestone' : 'info';
        const text = isBossWave(w)
          ? `Wave ${w} — BOSS INCOMING`
          : `Wave ${w} reached`;
        this.bus.emit('toast', { kind, text, life: 4 });
      }

      // Apply (or clear) the wave modifier for this wave.
      this.applyActiveWaveModifier();
    });
    this.bus.on('wave_cleared', (wave: unknown) => {
      const cleared = wave as number;
      const wms = this.state.wave.waveModifier;
      // Plan §3.3: a mutator now spans MUTATOR_DURATION_WAVES waves and pays
      // out after each of them, with the reward escalating each time — so
      // surviving the third wave under Fortress is worth twice the first.
      if (wms.active && wms.wavesRemaining > 0 && wms.pendingChoiceForWave !== null
        && cleared >= wms.pendingChoiceForWave) {
        const escalation = waveModifierRewardMultiplier(wms.wavesCleared);
        const goldMult = wms.active.reward.gold;
        if (goldMult > 0 && wms.goldSnapshot != null) {
          const waveGold = this.state.stats.goldEarned - wms.goldSnapshot;
          if (waveGold > 0) {
            const bonus = Math.floor(waveGold * goldMult * escalation);
            if (bonus > 0) {
              this.state.resources.gold += bonus;
              this.state.resources.lifetimeGold += bonus;
              this.state.stats.goldEarned += bonus;
              this.bus.emit('gold_changed', this.state.resources.gold);
            }
          }
        }
        const apReward = Math.floor(wms.active.reward.ap * escalation);
        if (apReward > 0) {
          this.state.resources.ascensionPoints += apReward;
          this.state.resources.apThisTranscendence += apReward;
          this.state.resources.lifetimeAP += apReward;
        }
        const tpReward = Math.floor(wms.active.reward.tp * escalation);
        if (tpReward > 0) {
          this.state.resources.transcendencePoints += tpReward;
        }

        wms.wavesCleared += 1;
        wms.wavesRemaining -= 1;
        if (wms.wavesRemaining <= 0) {
          const name = wms.active.name;
          wms.active = null;
          wms.pendingChoiceForWave = null;
          wms.goldSnapshot = null;
          wms.wavesCleared = 0;
          this.bus.emit('toast', {
            kind: 'milestone',
            text: `${name} survived — mutator ended.`,
            life: 3.5,
          });
        } else {
          // Fresh baseline so the next wave's gold reward measures that wave.
          wms.goldSnapshot = this.state.stats.goldEarned;
          this.bus.emit('toast', {
            kind: 'info',
            text: `${wms.active.name}: ${wms.wavesRemaining} wave${wms.wavesRemaining === 1 ? '' : 's'} left · next reward ×${waveModifierRewardMultiplier(wms.wavesCleared).toFixed(1)}`,
            life: 3,
          });
        }
        this.applyUpgradeEffects();
      }
      // Wave Mastery: flat gold on wave clear
      if (this.waveGoldBonus > 0) {
        // Revamp §6.2.3: capped at x3 (20 waves x 0.1), applied *before*
        // Golden Tide. Was `1 + cleared * 0.5` — x21 by wave 40.
        let multiplier = waveMasteryChainMultiplier(cleared);
        if (this.upgradeMgr.hasEvolutionEffect('golden_tide')) {
          multiplier *= 1 + this.upgradeMgr.getEvolutionEffectValue('golden_tide');
        }
        const bonus = Math.floor(this.waveGoldBonus * multiplier);
        if (bonus > 0) {
          this.state.resources.gold += bonus;
          this.state.resources.lifetimeGold += bonus;
          this.state.stats.goldEarned += bonus;
          this.bus.emit('gold_changed', this.state.resources.gold);
        }
      }
      // Levelling redesign step 7: Windfall — periodic gold chest.
      if (this.windfallMultiplier > 0 && cleared % TALENT_TUNING.windfallInterval === 0) {
        // Reuse the wave-clear gold that was already computed above.
        const waveClearGold = this.waveGoldBonus > 0
          ? Math.floor(this.waveGoldBonus * waveMasteryChainMultiplier(cleared))
          : 0;
        const chest = Math.floor(waveClearGold * this.windfallMultiplier);
        if (chest > 0) {
          this.state.resources.gold += chest;
          this.state.resources.lifetimeGold += chest;
          this.state.stats.goldEarned += chest;
          this.bus.emit('gold_changed', this.state.resources.gold);
        }
        if (this.windfallMultiplier >= TALENT_TUNING.windfallEquipmentThreshold) {
          this.equipmentMgr.rollDrop(cleared, 'milestone', { guaranteed: true });
        }
        const ts = this.tower.snapshot;
        this.effects.emitGoldRushSparkle(ts.x, ts.y);
      }
      // Tower XP & passive ability XP from wave clear
      this.towerXpMgr.addWaveClearXp(cleared, this.lifetimeHighestWaveBeforeClear);
      this.passiveMgr.addWaveClearXp(cleared);

      // Blessings (plan §1.1). The Greed Engine's value is a function of waves
      // cleared, so its stat total moves every wave and the block is restated.
      const hadGreed = this.blessingMgr.has('greed_engine');
      this.blessingMgr.noteWaveCleared();
      this.state.blessings = this.blessingMgr.snapshot();
      if (hadGreed) this.applyUpgradeEffects();
      this.maybeOfferBlessingDraft(cleared);

      // Contracts (plan §5.1). One event carries every wave-scoped goal kind —
      // `clear_waves`, `flawless_waves`, `reach_wave` and `survive_mutator` —
      // so a cleared wave is one call rather than four subscriptions racing
      // each other for the same tick.
      this.contractMgr.note({
        kind: 'wave_cleared',
        wave: cleared,
        flawless: this.waveFlawless,
        mutatorActive: this.state.wave.waveModifier.active !== null,
      });
      this.state.contracts = this.contractMgr.snapshot();
      this.noteWatchWave();
    });
    this.bus.on('wave_modifier_offer', (nextWave: unknown) => {
      const w = nextWave as number;
      // Storm Caller (plans/milestones.md §5.7) offers one extra mutator; the
      // modal's grid is `auto-fit minmax(180px, 1fr)` so four cards still fit.
      const choices = pickRandomModifiers(this.watchMgr.has('storm_caller') ? 4 : 3);
      this.state.wave.waveModifier.choiceForNextWave = choices.map(snapshotFromDef);
      this.state.wave.waveModifier.pendingChoiceForWave = w;
      this.waveMgr.pauseSpawning();
      const projected: Record<string, { gold: number; ap: number; tp: number }> = {};
      for (const snapshot of this.state.wave.waveModifier.choiceForNextWave) {
        projected[snapshot.id] = this.projectWaveModifierReward(snapshot, w);
      }
      this.waveModModal.show(
        {
          wave: w,
          waves: this.mutatorDuration(),
          choices: this.state.wave.waveModifier.choiceForNextWave,
          projected,
        },
        {
          onChoose: (snapshot: WaveModifierSnapshot) => {
            this.waveMgr.resumeSpawning();
            this.chooseWaveModifier(snapshot);
          },
          onSkip: () => {
            this.waveMgr.resumeSpawning();
            this.skipWaveModifier();
          },
        },
      );
    });
    this.bus.on('upgrades_changed', (levels: Record<string, number>) => {
      this.state.upgrades = { ...(levels as Record<string, number>) };
      this.applyUpgradeEffects();
      // Silent: this event also fires on reset and on load.
      this.refreshTowerMarks(false);
    });
    // The purchase counter belongs on the purchase event, not on
    // `upgrades_changed` — the latter also fires on reset/load, and a bulk buy
    // is worth every level it bought rather than one.
    this.bus.on('upgrade_purchased', (payload: unknown) => {
      const p = payload as { levelsGained?: number; goldSpent?: number };
      this.state.stats.totalUpgradesPurchased += Math.max(1, p.levelsGained ?? 1);
      if (p.goldSpent && p.goldSpent > 0) {
        this.contractMgr.note({ kind: 'gold_spent', amount: p.goldSpent });
      }
      // The only path that earns the toast and the forge flourish.
      this.refreshTowerMarks(true);
    });
    this.bus.on('upgrade_evolved', (payload: unknown) => {
      const p = payload as { id: string; level: number; evolution: { name: string; description: string } };
      this.bus.emit('toast', {
        kind: 'milestone',
        text: `Evolution! ${p.evolution.name} — ${p.evolution.description}`,
        life: 5,
      });
    });
    this.bus.on('equipment_equipped', () => {
      this.applyUpgradeEffects();
    });
    this.bus.on('equipment_unequipped', () => {
      this.applyUpgradeEffects();
    });
    this.bus.on('talent_allocated', () => {
      this.applyUpgradeEffects();
    });
    this.bus.on('talent_refunded', () => {
      this.applyUpgradeEffects();
    });
    this.bus.on('research_unlocked', (payload: unknown) => {
      const p = payload as { id: string; level: number };
      this.state.research = this.researchTree.getLevelsSnapshot();
      this.applyUpgradeEffects();
      const key = `${p.id}:${p.level}`;
      if (!this.researchAnnounced.has(key)) {
        this.researchAnnounced.add(key);
        const name = RESEARCH_BY_ID[p.id]?.name ?? 'Research';
        this.bus.emit('toast', {
          kind: 'milestone',
          text: `${name}${p.level > 1 ? ` Lv.${p.level}` : ''} complete!`,
          life: 3.5,
        });
      }
    });
    this.bus.on('automation_unlocked', (payload: unknown) => {
      const p = payload as { key: AutomationKey };
      const names: Record<AutomationKey, string> = {
        autoBuy: 'Auto-Upgrade',
        autoAbilities: 'Auto-Cast',
        autoAscend: 'Auto-Ascend',
        autoTranscend: 'Auto-Transcend',
      };
      this.bus.emit('toast', {
        kind: 'milestone',
        text: `${names[p.key]} unlocked — toggle it in Prestige → Automation.`,
        life: 5,
      });
    });
    // The Long Watch's only side effect at the call site. Everything else
    // (the modal, the toast, the unlock) is wired here so the bus is the
    // single source of truth — the manager's poll cannot disagree with the
    // UI about whether a chapter landed (plans/milestones.md §5.0).
    this.bus.on('watch_chapter_completed', (payload) => {
      const p = payload as { name: string; unlockId: WatchUnlockId; unlockName: string };
      this.applyWatchUnlock(p.unlockId);
      // Two unlocks need an immediate consumer reaction, otherwise the reward
      // sits invisible until the next contract completion / next chapter.
      if (p.unlockId === 'board_expansion') this.contractMgr.refill();
      if (p.unlockId === 'overseer') this.prestigeMgr.setAutomationEnabled('autoBuy', true);
      this.syncUiApis();
      this.saveMgr.requestSave();
      this.bus.emit('toast', {
        kind: 'milestone',
        text: `Chapter complete: ${p.name} — ${p.unlockName} unlocked`,
        life: 8,
      });
      const ts = this.tower.snapshot;
      this.effects.emitShockwaveRing(ts.x, ts.y, 320, withAlpha(FX.gold, 0.75), 6);
    });
    this.bus.on('ability_visual', (payload: unknown) => {
      // Plan §E.2: the payload now carries the ability's effective disc radius
      // (0 for non-targeted abilities) and a placement target when the cast
      // was aimed. The AoE / slow visuals use the placement target + radius so
      // the burst matches the disc the player just dropped; everything tower-
      // centred is unchanged.
      const p = payload as {
        id: AbilityId;
        def: { effectType: string };
        target?: { x: number; y: number } | null;
        radius?: number;
      };
      const t = this.tower.snapshot;
      const tx = p.target?.x ?? t.x;
      const ty = p.target?.y ?? t.y;
      const r = p.radius ?? 0;
      switch (p.def.effectType) {
        case 'aoe_damage':
          this.effects.emitRainOfArrows(tx, ty, r);
          break;
        case 'slow':
          this.effects.emitFrostNovaRing(tx, ty, r);
          break;
        case 'fire_rate_buff':
          this.effects.emitBerserkPulse(t.x, t.y);
          break;
        case 'gold_buff':
          this.effects.emitGoldRushSparkle(t.x, t.y);
          break;
        case 'single_target_damage':
          this.effects.emitMeteor(tx, ty, t.x, t.y);
          this.effects.emitShockwaveRing(tx, ty, r, withAlpha(FX.ember, 0.8), 5);
          this.triggerCanvasShake();
          break;
        case 'chain_damage':
          this.effects.emitHitSparks(tx, ty, FX.mana, 6);
          break;
        case 'crit_buff':
          this.effects.emitPrecisionGlow(t.x, t.y);
          break;
        case 'lifesteal_buff':
          this.effects.emitVampiricAura(t.x, t.y);
          break;
        case 'execute_damage':
          this.effects.emitExecuteSlash(tx, ty);
          break;
        case 'rocket_barrage':
          // The rockets themselves are the visual; all the tower gets is a
          // quick burst as the volley leaves it.
          this.effects.emitHitSparks(t.x, t.y, FX.ember, 8);
          break;
      }
    });
    // Rocket Barrage rounds — and mortar-blessed shots, which carry the same
    // splashRadius — pop a small ring where they land. These rings are
    // DECORATIVE: the damage went through the normal impact path already, so
    // they carry no damage payload and stay inside the effects-system quality
    // knob rather than becoming a second, untracked damage channel.
    this.bus.on('projectile_exploded', (payload: unknown) => {
      const p = payload as { x: number; y: number; radius: number };
      this.effects.emitShockwaveRing(p.x, p.y, Math.min(p.radius, world(40)), withAlpha(FX.ember, 0.75), 4);
      this.effects.emitHitSparks(p.x, p.y, FX.ember, 5);
    });
    this.bus.on('chain_lightning', (payload: unknown) => {
      const p = payload as { path: { x: number; y: number }[] };
      if (p.path && p.path.length >= 2) {
        this.effects.emitChainLightning(p.path);
      }
    });

    this.bus.on('enemy_attack', (payload: unknown) => {
      const p = payload as { x: number; y: number; type: string };
      const def = ENEMY_DEFS[p.type as keyof typeof ENEMY_DEFS];
      const ts = this.tower.snapshot;
      this.effects.emitAttackSlash(p.x, p.y, ts.x, ts.y, def.color);
      if (ts.shieldCurrentCharges > 0) {
        this.shieldFlash = 0.12;
      } else if (ts.wallHp > 0) {
        this.wallFlash = 0.12;
      } else {
        this.towerFlash = 0.12;
      }
    });

    // Plan §5.7: these are frequent (a purchase, a wave start, an ability
    // upgrade) and the state they change is not worth a synchronous
    // `JSON.stringify` of the whole save each time. Mark it dirty and let
    // `SaveManager.tick` coalesce; the tab-hidden handler flushes immediately.
    const saveOnEvent = () => {
      this.saveMgr.requestSave();
    };
    this.bus.on('upgrade_purchased', saveOnEvent);
    this.bus.on('ap_spent', saveOnEvent);
    this.bus.on('tp_spent', saveOnEvent);
    this.bus.on('achievement_unlocked', saveOnEvent);
    this.bus.on('research_started', saveOnEvent);
    this.bus.on('research_unlocked', saveOnEvent);
    this.bus.on('research_cancelled', saveOnEvent);
    this.bus.on('wave_started', saveOnEvent);
    this.bus.on('ability_upgraded', saveOnEvent);
    this.bindVisibilityEvents();
  }

  /**
   * Move the run to the wave the offline walk ended on (plan §4.4).
   *
   * `WaveManager.startAtWave` replaces its wave state wholesale, so the
   * snapshot has to be re-bound afterwards — the same handshake the
   * head-start path uses.
   */
  private applyOfflineWave(endWave: number): void {
    if (endWave <= this.state.wave.number) return;
    this.waveMgr.startAtWave(endWave);
    this.state.wave = this.waveMgr.snapshot;
  }

  private bindVisibilityEvents(): void {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // The frame loop stops while hidden, so a draft left open here would
        // freeze the intermission until the player came back — and the offline
        // walk would then resume from a wave that never started. Resolve it
        // now: a hidden tab is by definition an unattended one (plan §1.1).
        if (this.blessingModal.isVisible()) this.autoPickBlessing();
        // Same argument for the core picker: a hidden tab is unattended,
        // and the run has already started underneath it.
        if (this.corePicker.isVisible()) this.closeCorePicker();
        this.saveMgr.save(this.state);
        this.stop();
      } else {
        const persisted = this.saveMgr.load();
        if (persisted) {
          const result = this.saveMgr.computeOfflineProgress(persisted, this.computeGoldMultiplier());
          if (result.elapsedSeconds > 0) {
            const startWave = this.state.wave.number;
            this.saveMgr.applyOfflineProgress(this.state, result, this.passiveMgr);
            this.applyOfflineWave(result.endWave);
            if (result.rpEarned > 0) this.researchTree.addRP(result.rpEarned);
            if (this.researchTree.advanceResearch(result.researchElapsed)) {
              this.state.research = this.researchTree.getLevelsSnapshot();
            }
            this.state.researchInProgress = this.researchTree.inProgress
              ? { id: this.researchTree.inProgress.id, elapsed: this.researchTree.inProgress.elapsed, targetLevel: this.researchTree.inProgress.targetLevel }
              : null;
            this.applyUpgradeEffects();
            this.state.upgrades = this.upgradeMgr.snapshot();
            const endWave = this.state.wave.number;
            if (result.elapsedSeconds >= MIN_OFFLINE_REPORT_SECONDS) {
              this.bus.emit('welcome_back', { result, startWave, endWave });
            }
            this.saveMgr.save(this.state);
          }
        }
        this.start();
      }
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    if (!this.saveLoaded) {
      this.waveMgr.reset();
    }
    // AudioContext: try to start (will resume on user gesture if blocked)
    this.audio.ensureContext();
    this.audio.resume();
    this.loop();
  }

  /**
   * Called by main.ts on first user interaction to satisfy Chrome autoplay policy.
   */
  initAudio(): void {
    this.audio.ensureContext();
    this.audio.resume();
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }


  /**
   * The quality knob (UI plan §5.F + §9.D).
   *
   * Part 5 owns the table and the per-frame wiring; Part 9 owns the Settings
   * control, the auto-detect and the camera's DPR cap, and only has to call
   * this. Purely presentational: no consumer of a quality profile is read by
   * the simulation, and the damaging shockwave rings are never scaled by it.
   *
   * The four fan-outs match the four owners the §9.D table names:
   *  - `effects.setQuality`     — particle scale + pool trim
   *  - `renderer.setQuality`    — decals, embers, additive, bg layers, shadows
   *  - `camera.setDprCap`       — backing-store size, leaves world extents
   *                               alone (the §9.D rescale guard)
   */
  setQuality(tier: QualityTier): void {
    this.quality = tier;
    const profile = QUALITY[tier];
    this.effects.setQuality(tier);
    this.renderer.setQuality(tier);
    this.camera.setDprCap(profile.dprCap);
    // The camera only fires its resize when the cap actually moved, and the
    // renderer only rebakes when `bgLayers`/`shadows` moved — so drop the bake
    // here unconditionally rather than relying on either to have done it.
    this.renderer.invalidateBackground();
  }

  /**
   * Read the player's stored quality preference and apply it (UI plan §9.D).
   * Called once at construction, before the first frame. The Settings panel
   * calls `setQualityPreference` from then on, which goes through the same
   * path and persists the result.
   */
  private applyStoredQuality(): void {
    this.qualityPref = readStoredQuality();
    const tier = this.qualityPref === 'auto' ? initialQualityTier() : this.qualityPref;
    this.setQuality(tier);
  }

  /**
   * The Settings control's callback. `'auto'` clears the stored value so the
   * next session re-derives from hardware; an explicit value is persisted and
   * the probe is abandoned (it can never override a player's choice).
   */
  setQualityPreference(pref: 'auto' | QualityTier): void {
    if (pref !== 'auto' && !isQualityTier(pref)) return;
    this.qualityPref = pref;
    if (pref !== 'auto') {
      this.setQuality(pref);
      this.qualityProbe = null;        // explicit choice: never probe again
    } else {
      this.setQuality(initialQualityTier());
      this.qualityProbe = null;        // probe is started by startProbe below
    }
    persistQuality(pref);
  }

  /** What the Settings panel reads back to render the segmented control. */
  get qualityPreference(): 'auto' | QualityTier {
    return this.qualityPref;
  }

  /**
   * Start the 2-second probe (UI plan §9.D).
   *
   * Called once, on the first frame of wave 1 of the session, and only when
   * the stored preference is `'auto'`. A hidden tab throttles rAF to 1 Hz —
   * the measurement there is the throttling, not the device — and a 6.5x
   * game speed is not the frame cost the player will live with, so both
   * abandon the probe rather than mis-measure.
   */
  startQualityProbe(): void {
    if (this.qualityPref !== 'auto') return;
    if (this.qualityProbe) return;
    this.qualityProbe = { frames: 0, sum: 0, elapsed: 0 };
  }

  /**
   * One step of the probe. Called from `frameUpdate` on `realDt` — the
   * wall clock, not the simulation clock.
   */
  private tickQualityProbe(realDt: number): void {
    const p = this.qualityProbe;
    if (!p) return;
    if (typeof document !== 'undefined' && document.hidden) {
      this.qualityProbe = null;
      return;
    }
    if (this.getSpeed() > 1) {
      this.qualityProbe = null;
      return;
    }
    if (++p.frames <= 30) return;   // skip JIT warm-up and the first background bake
    p.sum += realDt;
    p.elapsed += realDt;
    if (p.elapsed < 2) return;
    // Use the **mean**, not the worst frame. A single 40 ms hitch from a save
    // write or a sprite bake is not a reason to drop a desktop to `low`.
    // 22 ms = 45 fps floor for `low`; 17 ms = 60 fps target for everything else.
    const meanMs = (p.sum / (p.frames - 30)) * 1000;
    const budget = this.quality === 'low' ? 22 : 17;
    if (meanMs > budget) this.demoteQuality();
    this.qualityProbe = null;       // once per session, never again
  }

  /** Drop one tier, clamping at `low`. The probe never auto-promotes. */
  private demoteQuality(): void {
    if (this.quality === 'high') this.setQuality('medium');
    else if (this.quality === 'medium') this.setQuality('low');
  }

  /** The tier currently in force, for Part 9's Settings control to read back. */
  get qualityTier(): QualityTier {
    return this.quality;
  }

  /**
   * Put the tower at the centre of the world and tell everything else how big
   * the world is.
   *
   * The three managers do not share a notion of "the arena" beyond these two
   * numbers, which is deliberate — they were the canvas's backing-store
   * dimensions before the camera existed and they are the camera's world
   * rectangle now, and neither manager had to learn anything for that to be
   * true.
   */
  private seatArena(): void {
    const w = this.camera.worldWidth;
    const h = this.camera.worldHeight;
    this.tower.setPosition(w / 2, h / 2);
    this.projectileMgr.setBounds(w, h);
    // A fleeing thief needs to know where the edge of the world is (plan §2.1).
    this.enemyMgr.setBounds(w, h);
    this.waveMgr.setBounds(w, h);
  }

  /**
   * The viewport changed shape.
   *
   * Everything on the field is rescaled *proportionally* about the arena
   * centre rather than clamped into the new rectangle. Clamping is what a
   * naive implementation does and it is wrong in a way that is easy to miss:
   * rotating a phone mid-wave would stack every enemy that fell outside the
   * new bounds onto the same edge, and a fleeing thief pushed inside the
   * escape margin would suddenly be un-escaped. Proportional rescaling keeps
   * relative positions, and therefore every in-flight approach, intact.
   */
  private onCameraResize(info: CameraResize): void {
    const sx = info.previousWorldWidth > 0 ? info.worldWidth / info.previousWorldWidth : 1;
    const sy = info.previousWorldHeight > 0 ? info.worldHeight / info.previousWorldHeight : 1;
    if (sx !== 1 || sy !== 1) {
      for (const e of this.enemyMgr.list) {
        e.x *= sx;
        e.y *= sy;
        if (e.afterImageX !== undefined) e.afterImageX *= sx;
        if (e.afterImageY !== undefined) e.afterImageY *= sy;
      }
      // Positions moved, so the lazily-rebuilt broadphase index is stale.
      this.enemyMgr.markGridStale();
      for (const p of this.projectileMgr.list) {
        p.x *= sx;
        p.y *= sy;
      }
      for (const shot of this.enemyMgr.hostileShotList) {
        shot.x *= sx;
        shot.y *= sy;
        shot.originX *= sx;
        shot.originY *= sy;
        shot.vx *= sx;
        shot.vy *= sy;
      }
      for (const orb of this.lootMgr.list) {
        orb.x *= sx;
        orb.y *= sy;
      }
      for (const mine of this.mines) {
        mine.x *= sx;
        mine.y *= sy;
      }
      this.seatArena();
    }
    // The background is baked at backing-store resolution, so it is stale
    // after any resize, shape change or not.
    this.renderer.invalidateBackground();
  }

  /**
   * The element whose CSS box the camera measures.
   *
   * `main.ts` finds it after construction, so the camera starts out measuring
   * the canvas and switches to the wrap here.
   */
  setCanvasWrap(el: HTMLElement | null): void {
    this.camera.setHost(el);
  }

  /** CSS pixel relative to the canvas's top-left corner → world point. */
  screenToWorld(x: number, y: number): { x: number; y: number } {
    return this.camera.screenToWorld(x, y);
  }

  /** World point → CSS pixel, for DOM overlays that must track a world point. */
  worldToScreen(x: number, y: number): { x: number; y: number } {
    return this.camera.worldToScreen(x, y);
  }

  /**
   * Screen shake, as a camera translate rather than a CSS animation.
   *
   * `.canvas-wrap.is-shaking` translated the *element*, which meant the boss
   * bar, the contract tracker, the milestone strip and every other DOM overlay
   * pinned to the same box jittered along with the battlefield — the one thing
   * on screen that was supposed to be shaking was the only thing that could
   * not shake on its own. The call sites are unchanged; only where it lands
   * has moved. `Camera.shake` is a no-op under `prefers-reduced-motion`.
   */
  private triggerCanvasShake(): void {
    this.camera.shake();
  }

  /**
   * Pay out the encounter that just ended (gameplay plan §3.4).
   *
   * Two rewards, each answering a different question the player can only ask
   * once they can *see* the fight: "can I kill it fast?" and "can I kill it
   * clean?". Both are deliberately small and immediate — a reroll token and a
   * gold/gear bump — rather than a permanent unlock, because the point is to
   * give a boss wave a score, not a gate.
   */
  private resolveBossEncounter(): void {
    const encounter = this.bossEncounter;
    this.bossEncounter = null;
    if (!encounter) return;

    const { swift, flawless } = bossEncounterOutcome(encounter.elapsed, !encounter.flawless);
    // Plan §5.1's `boss_under` is scored per *encounter*, which is what this
    // whole method is: one boss, its adds and its escort resolve to one
    // outcome.
    this.contractMgr.note({ kind: 'boss_encounter', seconds: encounter.elapsed });
    if (swift) {
      this.state.bossRun.swiftKills += 1;
      this.state.watch.counters.swiftBosses += 1;
      const bonus = Math.floor(encounter.goldValue * BOSS_ENCOUNTER.swiftKillGoldBonus);
      if (bonus > 0) this.resourceMgr.addGold(bonus);
      // The roll is the normal one; the reward is that it cannot miss and it
      // lands a tier better than it rolled.
      const drop = this.equipmentMgr.rollDrop(encounter.wave, 'boss', {
        guaranteed: true,
        rarityBoost: BOSS_ENCOUNTER.swiftKillRarityBoost,
      });
      const ts = this.tower.snapshot;
      this.effects.emitShockwaveRing(ts.x, ts.y, 320, withAlpha(FX.gold, 0.75), 6);
      this.bus.emit('toast', {
        kind: 'milestone',
        text: drop
          ? `Swift kill! +${formatInt(bonus)}g and ${drop.rarity} gear.`
          : `Swift kill! +${formatInt(bonus)}g.`,
        life: 5,
      });
    }

    if (flawless) {
      this.state.bossRun.flawlessKills += 1;
      this.state.bossRun.apBonusPct += BOSS_ENCOUNTER.flawlessApBonus;
      this.prestigeMgr.setRunApBonus(this.state.bossRun.apBonusPct);
      // First consumer of the token budget Part 1 built and nothing spent.
      this.blessingMgr.grantRerollToken(BOSS_ENCOUNTER.flawlessRerollTokens);
      this.state.blessings = this.blessingMgr.snapshot();
      const ts = this.tower.snapshot;
      this.effects.emitShockwaveRing(ts.x, ts.y, 280, withAlpha(FX.frost, 0.75), 6);
      this.bus.emit('toast', {
        kind: 'milestone',
        text: `Flawless! +1 blessing reroll · +${Math.round(this.state.bossRun.apBonusPct * 100)}% AP this run.`,
        life: 6,
      });
    }
  }

  /**
   * Resolve the boss bar's readout from the lead boss (plan §3.5).
   *
   * Presentation, so it runs once per frame in `frameUpdate` rather than in the
   * substep loop. Returns null the instant no boss is alive, which is what
   * hides the bar.
   */
  private bossBarSnapshot(): BossBarData | null {
    const boss = this.enemyMgr.leadBoss();
    if (!boss) return null;
    const elapsed = boss.bossElapsed ?? 0;
    const stacks = boss.bossEnrageStacks ?? 0;
    const nextStackAt = stacks === 0
      ? BOSS_ENCOUNTER.enrageDelay
      : BOSS_ENCOUNTER.enrageDelay + stacks * BOSS_ENCOUNTER.enrageInterval;
    return {
      name: bossNameForWave(boss.spawnWave ?? this.waveMgr.currentWave),
      hp: boss.hp,
      maxHp: boss.maxHp,
      shield: boss.bossShield ?? 0,
      shieldMax: boss.bossShieldMax ?? 0,
      shieldTimer: Math.max(0, boss.bossShieldTimer ?? 0),
      phase: boss.bossPhase ?? 1,
      pattern: boss.bossPattern ?? null,
      slamRemaining: boss.bossSlamTelegraph ?? 0,
      slamTotal: BOSS_ENCOUNTER.slamTelegraph,
      slamMitigated: boss.bossSlamMitigated === true,
      invulnerable: (boss.bossInvulnerable ?? 0) > 0,
      enrageStacks: stacks,
      enrageIn: nextStackAt - elapsed,
      elapsed: this.bossEncounter?.elapsed ?? elapsed,
      count: this.enemyMgr.bossAliveCount(),
      swiftWindow: (this.bossEncounter?.elapsed ?? elapsed) < BOSS_ENCOUNTER.swiftKillSeconds,
    };
  }

  /**
   * The lead boss's pattern, player-facing, or null when nothing is on the
   * field yet — a wave-start trigger runs before the first boss spawns.
   */
  private leadBossPatternName(): string | null {
    const pattern = this.enemyMgr.leadBoss()?.bossPattern;
    return pattern ? BOSS_PATTERN_NAMES[pattern] : null;
  }

  /**
   * Open the boss intro (UI plan §5.D).
   *
   * Layered *on top of* the existing entry slow-mo and `emitBossEntryPulse` at
   * the same sites, not a replacement for them.
   */
  private beginBossIntro(wave: number, name: string, pattern: string | null): void {
    if (this.bossIntro && this.bossIntro.wave === wave) return;  // once per encounter
    if (this.getSpeed() > 2) return;                             // idle contract: no cinematic at speed
    if (this.reducedMotion) { this.bossIntro = { phase: 'hold', t: 0, wave, name, pattern }; return; }
    this.bossIntro = { phase: 'in', t: 0, wave, name, pattern };
    this.camera.zoomPunch();
  }

  /**
   * Advance the intro on the wall clock. Never on `gameDt`: a 6.5× run would
   * flash the whole 1.8 s timeline in 0.28 s.
   */
  private tickBossIntro(realDt: number): void {
    const s = this.bossIntro;
    if (!s) return;
    if (this.getSpeed() > 2) { this.bossIntro = null; return; }   // speed raised mid-intro
    s.t += realDt;
    const cap = s.phase === 'in' ? INTRO_IN : s.phase === 'hold' ? INTRO_HOLD : INTRO_OUT;
    if (s.t < cap) return;
    s.t -= cap;
    if (s.phase === 'in') s.phase = 'hold';
    else if (s.phase === 'hold') s.phase = 'out';
    else this.bossIntro = null;
  }

  /**
   * Skip the intro from input (§5.D). Jumps to the retract rather than cutting:
   * a hard cut is jarring, a 0.35 s retract is not. Returns true when the press
   * or key was consumed, so `main.ts` can stop it also firing an ability.
   */
  skipBossIntro(): boolean {
    const s = this.bossIntro;
    if (!s || s.phase === 'out') return false;
    s.phase = 'out';
    s.t = 0;
    return true;
  }

  /** The renderer's view of the intro: a single 0..1 bar extension. */
  private bossIntroSnapshot(): { progress: number; name: string; pattern: string | null; wave: number } | null {
    const s = this.bossIntro;
    if (!s) return null;
    const p = s.phase === 'in' ? introEaseOutCubic(s.t / INTRO_IN)
      : s.phase === 'hold' ? 1
        : 1 - introEaseOutCubic(s.t / INTRO_OUT);
    return { progress: p, name: s.name, pattern: s.pattern, wave: s.wave };
  }

  private triggerBossEntrySlowMo(): void {
    this.slowMoRemaining = 0.8;
    this.slowMoTotal = 0.8;
    this.triggerCanvasShake();
  }

  private triggerBossDeathSlowMo(): void {
    this.slowMoRemaining = 0.3;
    this.slowMoTotal = 0.3;
    this.screenFlash = 0.15;
  }

  /**
   * Update low-HP vignette intensity on the canvas wrap element.
   * Called from update() each frame. Writes are cached so DOM is only mutated
   * when the value actually changes (e.g. when crossing the 30% HP threshold
   * or as intensity changes by a noticeable amount).
   */
  private updateVignette(): void {
    const t = this.tower.snapshot;
    const ratio = t.maxHp > 0 ? t.hp / t.maxHp : 0;
    // 0 at 30% HP, 1 at 0%. Handed to the renderer, which paints it in screen
    // space — it used to be a CSS class on the same element the shake
    // animation was translating.
    this.vignette = ratio > 0 && ratio <= 0.3 ? (0.3 - ratio) / 0.3 : 0;
  }

  get upgradeManager(): UpgradeManager {
    return this.upgradeMgr;
  }

  get resources(): ResourceManager {
    return this.resourceMgr;
  }

  get waves(): WaveManager {
    return this.waveMgr;
  }

  get enemies(): EnemyManager {
    return this.enemyMgr;
  }

  get projectiles(): ProjectileManager {
    return this.projectileMgr;
  }

  /**
   * The effects pool, for the §10.B budget harness.
   *
   * Read-only in spirit: the harness saturates the pool through the real
   * emitters so the render path is exercised the way a busy wave exercises it.
   */
  get effectsManager(): EffectsManager {
    return this.effects;
  }

  /**
   * The arena rectangle, in world units — what `seatArena` hands the managers.
   * The §10.B harness needs it to scatter its enemies where real ones spawn.
   */
  get worldExtents(): { width: number; height: number } {
    return { width: this.camera.worldWidth, height: this.camera.worldHeight };
  }

  get towerSystem(): Tower {
    return this.tower;
  }

  get abilities(): AbilityManager {
    return this.abilityMgr;
  }

  get prestige(): PrestigeManager {
    return this.prestigeMgr;
  }

  get research(): ResearchTree {
    return this.researchTree;
  }

  get audioMgr(): AudioManager {
    return this.audio;
  }

  /**
   * Cast an ability from the hotkey or the ability bar (plan §A.1).
   *
   * A manual press *always* aims: a targeted ability arms placement and the
   * next canvas press drops it. Auto-aim is what automation does, not what a
   * player who reached for the keyboard asked for. Pressing the same hotkey
   * again cancels, which is why re-arming the pending ability is a toggle.
   */
  castAbility(id: AbilityId): boolean {
    if (isTargeted(id)) return this.beginPlacement(id);
    return this.abilityMgr.tryCast(id, this.state.wave.highestWave);
  }

  upgradeAbility(id: AbilityId): boolean {
    const def = ABILITIES.find(a => a.id === id);
    if (!def) return false;
    if (this.state.wave.highestWave < def.unlockWave) return false;
    return this.abilityMgr.upgradeAbility(id);
  }

  canUpgradeAbility(id: AbilityId): boolean {
    return this.abilityMgr.canUpgrade(id, this.state.wave.highestWave);
  }

  unlockPassive(id: string): boolean {
    if (!this.passiveMgr.canUnlock(id, this.state.stats.lifetimeHighestWave)) return false;
    const cost = this.passiveMgr.getUnlockCost(id);
    if (cost <= 0 || this.state.resources.gold < cost) return false;
    this.state.resources.gold -= cost;
    this.passiveMgr.unlock(id);
    this.applyUpgradeEffects();
    this.bus.emit('gold_changed', this.state.resources.gold);
    return true;
  }

  upgradePassive(id: string): boolean {
    const cost = this.passiveMgr.getUpgradeCost(id);
    if (cost <= 0 || this.state.resources.gold < cost) return false;
    this.state.resources.gold -= cost;
    const spent = this.passiveMgr.upgrade(id);
    if (spent <= 0) {
      this.state.resources.gold += cost;
      return false;
    }
    this.applyUpgradeEffects();
    this.bus.emit('gold_changed', this.state.resources.gold);
    return true;
  }

  /**
   * The player viewed an inventory item's tooltip (or tapped it on mobile):
   * it is no longer "new". The UI recomputes the badge from `seen` flags, so
   * this only flips the bit and marks the save dirty.
   */
  markEquipmentSeen(id: string): void {
    const item = this.state.equipment.find(e => e.id === id);
    if (!item || item.seen === true) return;
    item.seen = true;
    this.saveMgr.requestSave();
  }

  /**
   * Wave-advance hook: badge the UI for any passive whose unlock wave the run
   * has just *cleared* — the badge fires when the wave after `unlockWave`
   * starts. Once per passive per run — a death rewind replays the same wave
   * without re-notifying, but the set clears at run end.
   */
  private checkPassiveUnlocks(wave: number): void {
    for (const def of PASSIVE_ABILITIES) {
      if (wave <= def.unlockWave) continue;
      if (this.passiveMgr.isUnlocked(def.id)) continue;
      if (this.passiveUnlockNotified.has(def.id)) continue;
      this.passiveUnlockNotified.add(def.id);
      this.ui.notifyPassiveAvailable(def.id);
    }
  }

  /**
   * Rewind to the previous wave with a fresh tower. Used both by the
   * pre-ascension death path and by the run-over modal's "retry" option.
   */
  restartCurrentWave(): void {
    const ts = this.tower.snapshot;
    this.enemyMgr.reset();
    this.projectileMgr.reset();
    this.mines = [];
    ts.shieldCurrentCharges = ts.shieldMaxCharges;
    ts.shieldRechargeTimer = 0;
    ts.hp = TOWER_BASE.hp;
    ts.maxHp = TOWER_BASE.maxHp;
    this.waveMgr.startAtWave(Math.max(1, this.waveMgr.currentWave - 1));
    this.state.wave = this.waveMgr.snapshot;
    this.applyUpgradeEffects();
  }

  /**
   * Resolve the run-over prompt: bank the run as an ascension, or rewind a
   * wave and keep pushing. Either way the simulation resumes.
   */
  resolveRunFailure(action: 'ascend' | 'retry'): void {
    if (!this.runFailed) return;
    this.runFailed = false;
    if (action === 'ascend') {
      this.ascend();
      return;
    }
    this.restartCurrentWave();
  }

  ascend(): number {
    if (!this.prestigeMgr.canAscend(this.state.wave.highestWave)) return 0;
    const { ap } = this.prestigeMgr.performAscension(this.state);
    if (ap <= 0) return 0;
    const record = this.finalizeRun('ascension', ap, 0);
    this.applySavedStateReset();
    this.resetRunBaselines();
    this.saveMgr.save(this.state);
    this.syncUiApis();
    this.bus.emit('toast', {
      kind: 'milestone',
      text: `Ascension! +${ap} AP. Your run has been reset.`,
      life: 6,
    });
    this.bus.emit('run_ended', {
      record,
      previous: this.getPreviousRun(),
      corePickerNext: this.isCorePickerDue(),
    });
    return ap;
  }

  transcend(): number {
    const ascensionPoints = this.state.resources.apThisTranscendence;
    if (!this.prestigeMgr.canTranscend(ascensionPoints)) return 0;
    const { tp } = this.prestigeMgr.performTranscendence(this.state);
    if (tp <= 0) return 0;
    const record = this.finalizeRun('transcendence', tp, 0);
    this.applyFullTranscendenceReset();
    this.resetRunBaselines();
    this.saveMgr.save(this.state);
    this.syncUiApis();
    this.bus.emit('toast', {
      kind: 'milestone',
      text: `Transcendence! +${tp} TP. Gear and talents carry over; passives reset.`,
      life: 7,
    });
    this.bus.emit('run_ended', {
      record,
      previous: this.getPreviousRun(),
      corePickerNext: this.isCorePickerDue(),
    });
    return tp;
  }

  /**
   * Returns the run immediately preceding the most recent one (for delta display).
   * Since `finalizeRun` always pushes a new record at the end, the previous one
   * is at `length - 2`.
   */
  private getPreviousRun(): RunRecord | null {
    const h = this.state.runHistory;
    if (h.length < 2) return null;
    return h[h.length - 2] ?? null;
  }

  spendAP(perkId: string): boolean {
    const ok = this.prestigeMgr.spendPerk(perkId);
    if (ok) {
      this.applyUpgradeEffects();
      this.syncUiApis();
    }
    return ok;
  }

  /**
   * Refund the AP tree (prestige-abs §6.1).
   *
   * Everything the widened tier-1 shelf buys is a decision, and a decision the
   * player cannot walk back is one they will not take. The manager owns the
   * refund arithmetic and the automation-flag re-derivation; `Game` owns the
   * recompute, the save and the toast — a reforge changes the resolved stats
   * (auto-buy, start gold, the magnet), so it cannot wait for the next tick.
   */
  reforgeAP(): number {
    const refunded = this.prestigeMgr.reforge();
    if (refunded <= 0) return 0;
    this.state.prestige = { ...this.state.prestige };
    this.applyUpgradeEffects();
    this.syncUiApis();
    this.saveMgr.save(this.state);
    this.bus.emit('toast', {
      kind: 'milestone',
      text: `Reforged. ${refunded} AP returned.`,
      life: 5,
    });
    return refunded;
  }

  /** AP a reforge would return right now. Drives the panel's confirm copy. */
  reforgeValue(): number {
    return this.prestigeMgr.reforgeValue();
  }

  startResearch(id: string): boolean {
    const ok = this.researchTree.startResearch(id);
    if (ok) {
      this.state.researchInProgress = this.researchTree.inProgress ? { ...this.researchTree.inProgress } : null;
      this.syncUiApis();
    }
    return ok;
  }

  cancelResearch(): boolean {
    const ok = this.researchTree.cancelResearch();
    if (ok) {
      this.state.researchInProgress = null;
      this.syncUiApis();
    }
    return ok;
  }

  setAutomationEnabled(key: AutomationKey, enabled: boolean): boolean {
    const ok = this.prestigeMgr.setAutomationEnabled(key, enabled);
    if (ok) this.syncUiApis();
    return ok;
  }

  /**
   * Plan §3.1: opt an ability out of auto-cast. Stored as an explicit `false`
   * so an unseen key keeps meaning "auto-cast this".
   */
  setAutoCastEnabled(id: AbilityId, enabled: boolean): void {
    if (enabled) {
      delete this.state.prestige.autoCastEnabled[id];
    } else {
      this.state.prestige.autoCastEnabled[id] = false;
    }
    this.syncUiApis();
  }

  /** Plan §3.6: which upgrades auto-buy reaches for first. */
  setAutoBuyStrategy(strategy: AutoBuyStrategy): void {
    this.state.prestige.autoBuyStrategy = strategy;
    // The panel reads its values from the pushed API snapshot, so a setter that
    // does not re-push leaves the control showing the old choice.
    this.syncUiApis();
  }

  /** Plan §3.6: fraction of gold auto-buy will not spend (0-0.9). */
  setAutoBuyReserve(fraction: number): void {
    this.state.prestige.autoBuyReserve = Math.max(0, Math.min(0.9, fraction));
    this.syncUiApis();
  }

  setTargetAscendWave(wave: number): void {
    this.state.prestige.targetAscendWave = Math.max(
      this.prestigeMgr.ascensionUnlockWave(),
      Math.floor(wave),
    );
    this.syncUiApis();
    this.bus.emit('toast', {
      kind: 'info',
      text: `Auto-Ascend target set to wave ${this.state.prestige.targetAscendWave}`,
      life: 2.5,
    });
  }

  private computeSpeedForIndex(index: number): number {
    if (index < GAME_SPEEDS.length) return GAME_SPEEDS[index];
    const last = GAME_SPEEDS.length - 1;
    return GAME_SPEEDS[last] + (index - last) * 0.5;
  }

  getSpeed(): number {
    return this.computeSpeedForIndex(this.speedIndex);
  }

  getSpeedIndex(): number {
    return this.speedIndex;
  }

  getMaxSpeedIndex(): number {
    return this.maxSpeedIndex;
  }

  getAvailableSpeeds(): readonly number[] {
    const result: number[] = [];
    for (let i = 0; i <= this.maxSpeedIndex; i++) {
      result.push(this.computeSpeedForIndex(i));
    }
    return result;
  }

  setSpeedIndex(index: number): boolean {
    const clamped = Math.max(0, Math.min(this.maxSpeedIndex, Math.floor(index)));
    if (clamped === this.speedIndex) return false;
    this.speedIndex = clamped;
    this.syncUiApis();
    this.bus.emit('toast', {
      kind: 'info',
      text: `Game speed: ${this.formatSpeedLabel(this.speedIndex)}`,
      life: 1.5,
    });
    return true;
  }

  cycleSpeed(direction: 1 | -1): boolean {
    const next = this.speedIndex + direction;
    if (next < 0 || next > this.maxSpeedIndex) return false;
    return this.setSpeedIndex(next);
  }

  setMaxSpeedIndex(index: number): void {
    this.maxSpeedIndex = Math.max(0, Math.floor(index));
    if (this.speedIndex > this.maxSpeedIndex) {
      this.speedIndex = this.maxSpeedIndex;
    }
  }

  private formatSpeedLabel(index: number): string {
    const v = this.computeSpeedForIndex(index);
    return Number.isInteger(v) ? `${v}x` : `${v}x`;
  }

  restartWave(): boolean {
    const ok = this.waveMgr.restartWave();
    if (ok) {
      this.mines = [];
      this.bus.emit('toast', { kind: 'info', text: `Restarted wave ${this.waveMgr.currentWave}`, life: 1.5 });
    }
    return ok;
  }

  /**
   * Cursor/finger state, fed by the canvas listeners in `main.ts`.
   *
   * This is also where the charged-shot hold is tracked (plan §4.2): a press
   * anchors the charge, a move far enough from the anchor restarts it, and a
   * release with a full ring queues the shot for the next substep. Nothing
   * here fires anything itself — a DOM event is not a simulation step.
   *
   * Plan §B.1: the cursor position is tracked whether or not the button is
   * down, so the placement reticle has something to follow during a hover.
   * Every other consumer of `mouseX` / `mouseY` is already gated on
   * `mouseDown` (the charge snapshot, the manual-aim ring, the
   * `fireChargedShot` path), so widening the tracking is safe.
   */
  setMouseInput(x: number, y: number, isDown: boolean): void {
    if (this.charge.setPointer(x, y, isDown)) this.chargeFirePending = true;
    this.mouseX = x;
    this.mouseY = y;
    // Manual aim begins: drop the lock-on so releasing the hold re-acquires
    // fresh rather than resuming a commitment made before the player took over.
    // A consumed press (orb, placement) never raises `isDown`, so clicking
    // something does not disturb the lock.
    if (isDown && !this.mouseDown) this.tower.clearTargetLock();
    this.mouseDown = isDown;
  }

  /**
   * Pointer released (plan §B.2).
   *
   * `mouseup` / `touchend` used to call `setMouseInput(0, 0, false)`, which
   * snapped the stored point to the world origin and made the next placement
   * reticle draw at (0, 0) for the frame it took the move listener to catch
   * up. A dedicated release keeps the last position — only the button state
   * changes.
   */
  releasePointer(): void {
    if (this.charge.setPointer(this.mouseX, this.mouseY, false)) this.chargeFirePending = true;
    this.mouseDown = false;
  }

  /**
   * Track whether the cursor is currently over the canvas (plan §B.2).
   *
   * `placementSnapshot` will read this in Phase 4 so the reticle disappears
   * when the cursor leaves the battlefield rather than sticking at the edge.
   * Set `true` on `mouseenter` / every `touchstart` / every `touchmove`,
   * `false` on `mouseleave`. Touch does not call `false` on `touchend` —
   * the finger has gone, but the placement may have just resolved there.
   */
  setPointerOnCanvas(on: boolean): void {
    this.pointerOnCanvas = on;
  }

  /**
   * Drop the armed ability wherever the pointer currently is (plan §B.3).
   *
   * Touch pipeline only: a mouse click already routes through
   * `castPlacedAbility` from `handleCanvasPress` (the click is the press),
   * but a touch wants a *release* to commit so the player can drag to aim.
   * Returns false when nothing is armed, so the touch pipeline can decide
   * not to consume the event.
   */
  commitPlacementAtPointer(): boolean {
    if (!this.placement.isPlacing) return false;
    return this.castPlacedAbility(this.mouseX, this.mouseY);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Part 4 — the three active verbs
  // ────────────────────────────────────────────────────────────────────────

  /**
   * A press on the canvas, before it becomes a manual-aim hold (plan §4.1).
   *
   * Order matters and is the whole point of the routing: **orbs first**, then
   * a pending ability placement, and only then does the press fall through to
   * aiming. Returns true when the press was consumed, so `main.ts` knows the
   * click meant something other than "aim here".
   */
  handleCanvasPress(x: number, y: number): boolean {
    if (this.lootMgr.collectAt(x, y) > 0) return true;
    if (this.placement.isPlacing) {
      this.castPlacedAbility(x, y);
      return true;
    }
    return false;
  }

  /** Deliver one collected orb. Exhaustive over `LootOrbKind` by construction. */
  private payOrb(kind: LootOrbKind, amount: number, full: boolean, x: number, y: number): void {
    switch (kind) {
      case 'gold': {
        const gold = Math.max(1, Math.floor(amount * this.computeGoldMultiplier()));
        this.resourceMgr.addGold(gold);
        // `full` (the pickup was collected at full value) used to be passed as
        // `isCrit`, which is why gold popped in the crit colour. It still drives
        // the spark count below; it is not a crit.
        this.effects.emitDamageNumber(x, y - 12, gold, false, { kind: 'gold' });
        break;
      }
      case 'mana': {
        this.resourceMgr.addMana(amount);
        this.effects.emitDamageNumber(x, y - 12, amount, false, { kind: 'mana' });
        break;
      }
      case 'reroll': {
        this.blessingMgr.grantRerollToken(1);
        this.state.blessings = this.blessingMgr.snapshot();
        this.bus.emit('toast', { kind: 'milestone', text: 'Reroll token recovered!', life: 4 });
        break;
      }
      default: {
        const never: never = kind;
        return never;
      }
    }
    this.effects.emitHitSparks(x, y, LOOT_ORB_COLORS[kind].core, full ? 6 : 3);
    // Plan §5.1's `collect_orbs` counts orbs, not value, so a drifted orb that
    // paid 40% still counts — the idle contract (cross-cutting rule 1) applies
    // to contract progress as much as to the orb itself.
    this.contractMgr.note({ kind: 'orb_collected' });
  }

  /** Roll loot for a kill. Called from the `enemy_killed` handler. */
  private dropOrbsFor(x: number, y: number, isBoss: boolean, elite: boolean): void {
    this.lootMgr.dropForKill({
      x,
      y,
      wave: this.waveMgr.currentWave,
      isBoss,
      elite,
      // Zero until mana is unlocked, which is what stops a wave-4 player
      // being handed an orb whose currency does not exist yet.
      maxMana: this.abilityMgr.isManaUnlocked(this.state.wave.highestWave)
        ? this.state.resources.maxMana
        : 0,
    });
  }

  /**
   * Fire the charged shot (plan §4.2).
   *
   * Runs inside `simulate`, so the projectile it creates is stepped by the
   * same fixed substep as every other shot. Deliberately additive: it does
   * not consume the tower's cooldown, spend mana, or interrupt the ordinary
   * volley, so a player who never holds still loses nothing at all.
   */
  private fireChargedShot(): void {
    const ts = this.tower.snapshot;
    const shot = this.tower.rollShot();
    const damage = shot.damage * ts.fireRate * MANUAL_AIM.chargeDpsSeconds;
    this.projectileMgr.fire(null, ts, {
      rawDamage: damage,
      damageType: ts.damageType,
      isCrit: shot.isCrit,
      targetId: null,
      aimX: this.mouseX,
      aimY: this.mouseY,
      extraPierce: MANUAL_AIM.chargeExtraPierce,
      splashRadius: MANUAL_AIM.chargeSplashRadius,
      splashFraction: MANUAL_AIM.chargeSplashFraction,
      // Seeker Shots applies to the charged shot as well, but weakly on
      // purpose: a long straight lead-out and 60% of the turn rate, so the
      // pierce line the player aimed still goes where they aimed it and the
      // homing only sweeps up what it passes near. Its extra pierce plus the
      // "never re-target a body I already went through" rule is what makes it
      // walk down a column instead of orbiting the first thing it hits.
      isHoming: this.blessingMgr.has('homing'),
      turnRate: HOMING.turnRate * HOMING.chargedTurnScale,
      homingDelay: HOMING.chargedDelay,
    });
    this.state.stats.shotsFired += 1;
    this.state.stats.damageDealt += damage;
    this.charge.consume();
    this.effects.emitShockwaveRing(ts.x, ts.y, 70, withAlpha(FX.frost, 0.8), 4);
    this.bus.emit('charged_shot', { x: this.mouseX, y: this.mouseY, damage });
  }

  /** Charge-ring state for the renderer, or null when there is nothing to draw. */
  private chargeSnapshot(): { x: number; y: number; progress: number; cooldown: number; ready: boolean } | null {
    if (!this.charge.isDown) return null;
    if (this.charge.onCooldown) {
      return {
        x: this.mouseX,
        y: this.mouseY,
        progress: 0,
        cooldown: this.charge.cooldownFraction,
        ready: false,
      };
    }
    const progress = this.charge.progress;
    if (progress <= 0) return null;
    return { x: this.mouseX, y: this.mouseY, progress, cooldown: 0, ready: this.charge.ready };
  }

  /** Placement preview for the renderer, or null when not placing. */
  private placementSnapshot(): { x: number; y: number; radius: number; label: string; color: string; valid: boolean; count: number } | null {
    const id = this.placement.pending;
    if (!id) return null;
    if (!this.pointerOnCanvas && !this.mouseDown) return null;
    const def = ABILITY_BY_ID[id];
    const radius = this.abilityMgr.getEffectiveRadius(id);
    // `queryRadius` returns a fresh array by default — allocating one here per
    // frame while the reticle is up is fine (plan §E.3).
    const inDisc = this.enemyMgr.queryRadius(this.mouseX, this.mouseY, radius);
    let count = 0;
    for (const e of inDisc) if (isTargetable(e)) count++;
    return {
      x: this.mouseX,
      y: this.mouseY,
      radius,
      label: def?.name ?? '',
      color: def?.color ?? '#ffffff',
      valid: count > 0,
      count,
    };
  }

  /**
   * Enter placement mode for a targeted ability (plan §4.3 / §B.4).
   *
   * Refuses when the ability could not be cast anyway, so the player never
   * gets a prompt for a cast that was never going to happen.
   *
   * If a *different* targeted ability is already armed, the old one is
   * cancelled first and the prompt is cleared — the new arming then writes
   * its own prompt. `AbilityPlacement.toggle` would overwrite the pending
   * id on its own, but doing the cancel here keeps the lifecycle visible in
   * one place and makes sure no stale prompt text survives a re-arm.
   */
  private beginPlacement(id: AbilityId): boolean {
    const wave = this.state.wave.highestWave;
    if (this.placement.pending !== null && this.placement.pending !== id) {
      this.placement.cancel();
      this.ui.setPlacementPrompt(null);
    }
    const outcome = this.placement.toggle(id, this.abilityMgr.canCast(id, wave));
    if (outcome !== 'begin') {
      this.ui.setPlacementPrompt(null);
      if (outcome === 'rejected') {
        const reason = this.abilityMgr.reasonBlocked(id, wave);
        if (reason) this.bus.emit('toast', { kind: 'warning', text: reason, life: 2 });
      }
      return false;
    }
    const def = ABILITIES.find(a => a.id === id);
    // Plan §G.1: drop the hotkey from the prompt — it is on the tile and in
    // the keybinds overlay already, and the string was already long on a
    // phone. Touch devices get a drag-and-lift variant instead.
    const name = def?.name ?? 'ability';
    const prompt = this.coarsePointer
      ? `Drag to aim ${name}, lift to cast — tap the tile to cancel`
      : `Click to place ${name} — Esc to cancel`;
    this.ui.setPlacementPrompt(prompt);
    return true;
  }

  /** Leave placement mode without casting. Safe to call when not placing. */
  cancelPlacement(): boolean {
    if (!this.placement.cancel()) return false;
    this.ui.setPlacementPrompt(null);
    return true;
  }

  /** True while the press is being treated as a manual-aim hold. */
  isMouseHeld(): boolean {
    return this.mouseDown;
  }

  /** True while a click would place an ability. */
  isPlacing(): boolean {
    return this.placement.isPlacing;
  }

  /** The ability awaiting placement, for tests and the HUD. */
  get pendingPlacement(): AbilityId | null {
    return this.placement.pending;
  }

  /**
   * Resolve a placement click. A failed cast — most often mana drained between
   * the hotkey and the click — cancels cleanly rather than leaving the prompt
   * up over an ability that is now on cooldown or broke.
   */
  private castPlacedAbility(x: number, y: number): boolean {
    const wave = this.state.wave.highestWave;
    // Plan §G.2: refuse a whiff before spending mana. A non-targeted ability
    // (no disc) skips this check — there is no "empty field" to detect.
    const pendingId = this.placement.pending;
    if (pendingId !== null && isTargeted(pendingId)) {
      const radius = this.abilityMgr.getEffectiveRadius(pendingId);
      const inDisc = this.enemyMgr.queryRadius(x, y, radius);
      let hasTarget = false;
      for (const e of inDisc) {
        if (isTargetable(e)) { hasTarget = true; break; }
      }
      if (!hasTarget) {
        this.placement.cancel();
        this.ui.setPlacementPrompt(null);
        this.bus.emit('toast', {
          kind: 'info',
          text: 'No target there',
          life: 1.5,
        });
        return false;
      }
    }
    let failed: AbilityId | null = null;
    const ok = this.placement.place((id) => {
      const cast = this.abilityMgr.tryCast(id, wave, { x, y });
      if (!cast) failed = id;
      return cast;
    });
    this.ui.setPlacementPrompt(null);
    if (failed !== null) {
      const reason = this.abilityMgr.reasonBlocked(failed, wave);
      this.bus.emit('toast', {
        kind: 'warning',
        text: reason ? `Cast failed: ${reason}` : 'Cast failed',
        life: 2,
      });
    }
    return ok;
  }

  /**
   * Player preference: should auto-cast aim at the densest cluster, or
   * just cast from the tower? Plan §A.2.
   *
   * Note the removed `if (enabled) this.cancelPlacement()` line — the
   * setting no longer has anything to do with placement mode. Manual
   * presses always arm placement, so a player cannot end up stuck in it
   * because of this setting either way.
   */
  setAutoCastAutoAim(enabled: boolean): void {
    this.autoCastAutoAim = enabled;
    writeAutoAimPreference(enabled);
    this.ui.setAutoCastAutoAimState(enabled);
  }

  /**
   * The getter `AutomationManager.getAutoAim` reads, so the manager can
   * branch on the preference without growing its own cached copy.
   */
  get autoCastAutoAimEnabled(): boolean {
    return this.autoCastAutoAim;
  }

  /** Live loot orbs, for the renderer and for tests. */
  get loot(): LootManager {
    return this.lootMgr;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Pacing (plan §7)
  // ────────────────────────────────────────────────────────────────────────

  /** Risk dial, momentum and combo state. */
  get pacing(): PacingManager {
    return this.pacingMgr;
  }

  /**
   * True while any modal has the player's attention.
   *
   * The §7.1 `Space` binding is gated on this. Parts 1, 3, 4 and 6 each added
   * a modal, so the check asks each owner rather than sniffing the DOM: three
   * of them are owned here and four by `UIManager`, and a modal that forgot to
   * answer would be a wave called out from under a decision the player was
   * still making.
   */
  isModalOpen(): boolean {
    return this.runFailed
      || this.waveModModal.isVisible()
      || this.blessingModal.isVisible()
      || this.corePicker.isVisible()
      || this.ui.isModalOpen();
  }

  /** True when `callWaveEarly` would actually start the next wave. */
  canCallWaveEarly(): boolean {
    return !this.isModalOpen() && this.waveMgr.canCallEarly();
  }

  /**
   * Plan §7.1: start the next wave now and bank the momentum it earns.
   *
   * The momentum is banked *before* the wave starts, because `startWave`
   * resolves the new wave's stats and the gold bonus is meant to apply to the
   * wave the player just bought — not to the one after it.
   */
  callWaveEarly(): boolean {
    if (!this.canCallWaveEarly()) return false;
    // Plan §7.1: the momentum is the *window's* remainder, not the
    // intermission's — the window opened when this wave's last enemy spawned.
    const banked = this.waveMgr.earlyCallRemaining();
    this.pacingMgr.noteWaveCalledEarly(banked);
    this.waveMgr.callWaveEarly();
    this.state.wave = this.waveMgr.snapshot;
    this.state.pacing = this.pacingMgr.snapshot();
    this.effects.emitBossEntryPulse(this.state.tower.x, this.state.tower.y);
    this.bus.emit('toast', {
      kind: 'milestone',
      text: `Wave called — momentum +${Math.round(this.pacingMgr.momentumBonus * 100)}% gold`,
      life: 2,
    });
    this.syncUiApis();
    return true;
  }

  /** Plan §7.4: move the risk dial. Takes effect at the next wave. */
  setRisk(level: number): number {
    const previous = this.pacingMgr.riskLevel;
    const next = this.pacingMgr.setRisk(level);
    if (next !== previous) {
      this.state.pacing = this.pacingMgr.snapshot();
      this.saveMgr.requestSave();
      this.syncUiApis();
      this.bus.emit('toast', {
        kind: next > previous ? 'warning' : 'info',
        text: next === 0
          ? 'Risk 0 — the standard curve.'
          : `Risk ${next} from the next wave: `
            + `+${Math.round(RISK_HP_PER_STEP * next * 100)}% enemy HP, `
            + `+${Math.round(RISK_SPEED_PER_STEP * next * 100)}% speed, `
            + `+${Math.round(RISK_GOLD_PER_STEP * next * 100)}% gold, `
            + `+${Math.round(riskApBonus(next) * 100)}% AP`,
        life: 4,
      });
    }
    return next;
  }

  /** Everything the HUD and the pacing overlay read, resolved once per frame. */
  private pacingHudSnapshot(): PacingHudData {
    const preview = this.waveMgr.previewNextWave();
    const combo = this.pacingMgr.combo;
    return {
      risk: this.pacingMgr.riskLevel,
      activeRisk: this.pacingMgr.activeRisk,
      riskPending: this.pacingMgr.riskPending,
      // Watch raises the ceiling (plans/milestones.md §5.5); the HUD reflects
      // the same number the `PacingManager` provider clamps against.
      maxRisk: this.maxRisk(),
      momentum: this.pacingMgr.momentumBonus,
      momentumStreak: this.pacingMgr.momentumStreak,
      momentumCap: MOMENTUM_CAP,
      canCallEarly: this.canCallWaveEarly(),
      callBonus: this.waveMgr.earlyCallRemaining() * EARLY_CALL_GOLD_PER_SECOND,
      earlyCallRemaining: this.waveMgr.earlyCallRemaining(),
      earlyCallWindow: this.waveMgr.earlyCallWindowLength(),
      earlyCallDelay: EARLY_CALL_DELAY_SECONDS,
      intermissionRemaining: this.waveMgr.intermissionRemaining(),
      intermissionLength: intermissionSecondsForWave(this.waveMgr.currentWave),
      combo,
      comboTier: this.pacingMgr.comboTierIndex,
      comboTierCount: COMBO_TIERS.length,
      comboLabel: this.pacingMgr.comboLabel,
      comboNext: this.pacingMgr.comboNext,
      comboFraction: this.pacingMgr.comboFraction,
      comboGold: this.pacingMgr.comboBonus.gold,
      preview,
    };
  }

  isAutoProgress(): boolean {
    return this.waveMgr.getAutoProgress();
  }

  setAutoProgress(enabled: boolean): void {
    this.waveMgr.setAutoProgress(enabled);
    this.syncUiApis();
    this.bus.emit('toast', {
      kind: 'info',
      text: enabled ? 'Auto-Progress: ON' : 'Auto-Progress: OFF (repeats the same wave)',
      life: 2,
    });
  }

  toggleAutoProgress(): boolean {
    const next = !this.isAutoProgress();
    this.setAutoProgress(next);
    return next;
  }


  reasonResearchBlocked(id: string): string | null {
    return this.researchTree.reasonBlocked(id);
  }

  hasSave(): boolean {
    return this.saveMgr.hasSave();
  }

  tryLoadSave(): OfflineResult | null {
    const persisted = this.saveMgr.load();
    if (!persisted) return null;
    this.saveLoaded = true;
    this.applyPersistedState(persisted);
    // The persisted tower position was captured against the world size at
    // save time. If the viewport/aspect changed (rotation, window resize,
    // device swap), that point is no longer the centre of the new world and
    // the tower renders off-axis until the next resize. `applyPersistedState`
    // ran before the bounds were re-set, so re-seat now — the tower is a
    // cosmetic anchor that never moves in gameplay, so snapping it to the
    // current world centre is always the correct intent.
    this.seatArena();
    // Plan §4.4: orbs are **not** persisted. Live enemies never were either
    // (`WaveManager` clears the wave on load), so orbs that were in the air
    // when the tab closed have nothing left to drift toward and are dropped.
    // The alternative — persisting them — would let a player bank a boss
    // pack's drops across a save/reload and collect them at full value later.
    this.lootMgr.clear();
    const result = this.saveMgr.computeOfflineProgress(persisted, this.computeGoldMultiplier());
    if (result.elapsedSeconds > 0) {
      const startWave = this.state.wave.number;
      this.saveMgr.applyOfflineProgress(this.state, result, this.passiveMgr);
      this.applyOfflineWave(result.endWave);
      if (result.rpEarned > 0) this.researchTree.addRP(result.rpEarned);
      this.researchTree.setSpeedMultiplier(this.prestigeMgr.getResearchSpeedMultiplier());
      if (this.researchTree.advanceResearch(result.researchElapsed)) {
        this.state.research = this.researchTree.getLevelsSnapshot();
      }
      this.state.researchInProgress = this.researchTree.inProgress
        ? { id: this.researchTree.inProgress.id, elapsed: this.researchTree.inProgress.elapsed, targetLevel: this.researchTree.inProgress.targetLevel }
        : null;
      this.applyUpgradeEffects();
      this.state.upgrades = this.upgradeMgr.snapshot();
      const endWave = this.state.wave.number;
      if (result.elapsedSeconds >= MIN_OFFLINE_REPORT_SECONDS) {
        this.bus.emit('welcome_back', {
          result,
          startWave,
          endWave,
        });
      }
      this.saveMgr.save(this.state);
    } else {
      this.applyUpgradeEffects();
      this.state.upgrades = this.upgradeMgr.snapshot();
    }
    this.syncUiApis();
    return result;
  }

  manualSave(): boolean {
    return this.saveMgr.save(this.state);
  }

  /** Fill the save cache from the backend. Awaited once, before `tryLoadSave`. */
  hydrateSave(): Promise<void> {
    return this.saveMgr.hydrate();
  }

  /** Resolves once every pending save write has reached the backend. */
  flushSave(): Promise<void> {
    return this.saveMgr.flushNow();
  }

  clearSave(): void {
    this.saveMgr.clear();

    const fresh = makeInitialState();

    Object.assign(this.state.tower, fresh.tower);
    Object.assign(this.state.resources, fresh.resources);
    Object.assign(this.state.prestige, fresh.prestige);
    Object.assign(this.state.stats, fresh.stats);
    this.state.achievements.length = 0;
    for (const id of Object.keys(this.state.abilities)) {
      Object.assign(this.state.abilities[id], fresh.abilities[id]);
    }

    this.waveMgr.reset();
    this.state.wave = this.waveMgr.snapshot;
    this.saveLoaded = false;

    this.upgradeMgr.reset();
    this.resourceMgr.reset();
    this.enemyMgr.reset();
    this.projectileMgr.reset();
    this.abilityMgr.reset();
    this.tower.clearTargetLock();
    this.effects.reset();
    this.automation.reset();
    this.researchTree.replaceLevels({}, 0, null);
    this.notifications.reset();
    this.mines = [];
    this.announcedMilestones.clear();
    this.researchAnnounced.clear();
    this.achievementMgr.reset();

    // v6+: Reset RPG state to fresh defaults
    Object.assign(this.state.towerXp, fresh.towerXp);
    this.state.talents.allocated = {};
    const pa = this.state.passiveAbilities;
    for (const k of Object.keys(pa)) delete pa[k];
    this.passiveMgr.ensureInitialized();
    this.state.equipment.length = 0;
    const eqMap = this.state.equipped;
    for (const k of Object.keys(eqMap)) delete (eqMap as Record<string, Equipment>)[k];
    this.blessingModal.hide();
    this.blessingMgr.reset();
    this.state.blessings = this.blessingMgr.snapshot();
    // A full wipe un-buys the cores too — they cost AP, and this is the path
    // that takes the AP away.
    this.corePicker.hide();
    this.coreMgr.resetAll();
    this.state.cores = this.coreMgr.snapshot();

    this.seatArena();
    this.applyUpgradeEffects();
    this.state.upgrades = this.upgradeMgr.snapshot();
    this.state.research = {};
    this.state.researchInProgress = null;
    this.state.runHistory = [];
    this.bestGoldRun = 0;
    this.bestWaveRun = 1;
    this.resetRunBaselines();
    this.syncUiApis();

    this.saveMgr.save(this.state);
  }

  get eventBus(): EventBus {
    return this.bus;
  }

  get gameState(): GameState {
    return this.state;
  }

  private resetRunBaselines(): void {
    this.runBaselineGold = this.state.stats.goldEarned;
    this.runBaselineKills = this.state.stats.enemiesKilled;
    this.runBaselineAbilities = this.state.stats.abilitiesCast;
    this.runBaselineHighestWave = this.state.wave.highestWave;
    this.state.runStartedAt = Date.now();
    this.state.stats.runStartedAt = this.state.runStartedAt;
    // Per-run "passive available" notifications: a new run notifies afresh.
    this.passiveUnlockNotified.clear();
  }

  /**
   * Build a RunRecord from current state + deltas since the last reset,
   * push it into the run history ring buffer, and reset run-scoped state
   * (baselines + runStartedAt + lifetime record-tracking flags).
   */
  private finalizeRun(kind: 'ascension' | 'transcendence', currencyGained: number, rpGained: number): RunRecord {
    const now = Date.now();
    const stats = this.state.stats;
    const goldEarned = Math.max(0, stats.goldEarned - this.runBaselineGold);
    const enemiesKilled = Math.max(0, stats.enemiesKilled - this.runBaselineKills);
    const abilitiesCast = Math.max(0, stats.abilitiesCast - this.runBaselineAbilities);
    const highestWave = Math.max(this.state.wave.highestWave, this.runBaselineHighestWave);
    const newRecordGold = goldEarned > this.bestGoldRun;
    const newRecordWave = highestWave > this.bestWaveRun;
    if (newRecordGold) this.bestGoldRun = goldEarned;
    if (newRecordWave) this.bestWaveRun = highestWave;
    const record: RunRecord = {
      endedAt: now,
      kind,
      highestWave,
      durationSeconds: Math.max(0, Math.floor((now - this.state.runStartedAt) / 1000)),
      goldEarned,
      enemiesKilled,
      abilitiesCast,
      currencyGained,
      rpGained,
      newRecordGold,
      newRecordWave,
    };
    const hist = this.state.runHistory ?? [];
    hist.push(record);
    while (hist.length > MAX_RUN_HISTORY) hist.shift();
    this.state.runHistory = hist;
    return record;
  }

  /**
   * The one place gold multipliers are composed. Every source contributes
   * exactly once: additive sources are summed and scaled by the research/TP
   * multipliers (matching the historical `1 + additive` shape), then the
   * remaining sources multiply on top. Both `applyUpgradeEffects` (what is
   * applied) and `computeStatsInfo` (what is displayed) call this, so the two
   * can never disagree.
   */
  /**
   * Passive RP gain multiplier: research nodes plus the achievement reward.
   * Kept in one place so every read (HUD, research panel, the actual gain)
   * agrees.
   */
  private rpGainMultiplier(): number {
    return this.researchTree.getRPGainMultiplier()
      + this.achievementMgr.getRewardMultiplier('rp_gain_mult');
  }

  /**
   * The composed gold multiplier currently in effect — the exact number
   * `EnemyManager` is multiplying drops by, not a second computation of it.
   */
  private computeGoldMultiplier(): number {
    return this.lastResolved?.goldMultiplier ?? 1;
  }

  /**
   * The same multiplier plus its per-source attribution (plan §4.2).
   *
   * Built by re-resolving the *same context* the applied stats came from, with
   * breakdown collection turned on. There is no second formula to drift, so a
   * tooltip that disagrees with the applied number is not expressible.
   */
  private computeGoldBreakdown(): { multiplier: number; sources: GoldSourceEntry[] } {
    const ctx = this.lastStatContext;
    if (!ctx) return { multiplier: 1, sources: [] };
    const { stats, breakdown } = resolveStats(ctx, { breakdown: true });
    return { multiplier: stats.goldMultiplier, sources: goldSourceEntries(breakdown) };
  }

  /**
   * What the tower's shot would look like after buying `levels` of `id`
   * (revamp §12.1–2), so the upgrade panel can name the change instead of
   * quoting a raw per-level constant.
   *
   * Re-resolves the *same context* the applied stats came from with one
   * upgrade level swapped, exactly like `computeGoldBreakdown` — there is no
   * second damage formula to drift. Evolution effects are not previewed: they
   * come from `StatContext.evolutions`, which `UpgradeManager` owns, and the
   * panel already announces them on their own milestone line.
   *
   * The panel memoises on its own level/stat version, so this runs on a
   * purchase or a wave change, not per frame.
   */
  previewUpgradeShot(id: string, levels: number): UpgradeShotPreview | null {
    const ctx = this.lastStatContext;
    const base = this.lastResolved;
    if (!ctx || !base) return null;
    const before = shotPreviewOf(base);
    if (levels <= 0) return { before, after: before };
    const current = ctx.upgrades[id] ?? 0;
    const { stats } = resolveStats({
      ...ctx,
      upgrades: { ...ctx.upgrades, [id]: current + levels },
    });
    return { before, after: shotPreviewOf(stats) };
  }

  private computeStatsInfo(): StatsInfo {
    const t = this.tower.snapshot;
    const r = this.state.resources;
    const gold = this.computeGoldBreakdown();
    const effectiveCritChance = this.tower.effectiveCritChance;
    const effectiveCritDamage = this.tower.effectiveCritMultiplier;
    const effectiveLs = this.tower.effectiveLifesteal;
    const expectedHit = t.baseDamage * (1 + effectiveCritChance * (effectiveCritDamage - 1));
    const dps = expectedHit * t.fireRate;
    return {
      damage: t.baseDamage,
      dps,
      hp: t.hp,
      maxHp: t.maxHp,
      healthRegen: this.tower.effectiveHealthRegen,
      critChance: effectiveCritChance,
      critDamage: effectiveCritDamage,
      range: t.range,
      fireRate: t.fireRate,
      defense: t.defense,
      armor: t.armor,
      lifesteal: effectiveLs,
      thorns: t.thorns,
      manaRegen: r.manaRegen,
      maxMana: r.maxMana,
      goldMultiplier: gold.multiplier,
      goldSources: gold.sources,
      rpGainRate: this.researchTree.getPassiveRPRate(
        this.state.stats.lifetimeHighestWave,
        this.rpGainMultiplier(),
      ),
      resolved: this.lastResolved,
      targetingMode: t.targetingMode,
    };
  }

  private syncUiApis(): void {
    this.ui.setStatsInfo(this.computeStatsInfo());
    this.ui.setPrestigeAPI({
      canAscend: (wave) => this.prestigeMgr.canAscend(wave),
      canTranscend: (ap) => this.prestigeMgr.canTranscend(ap),
      previewAP: (wave) => this.prestigeMgr.previewAP(wave),
      previewTP: (lap) => this.prestigeMgr.previewTP(lap),
      canSpend: (perkId, ap, tp) => this.prestigeMgr.canSpendAP(perkId) && ap >= 1 || this.prestigeMgr.canSpendTP(perkId) && tp >= 1,
      isAutomationUnlocked: (key) => this.prestigeMgr.isAutomationUnlocked(key),
      isAutomationEnabled: (key) => this.prestigeMgr.getAutomationEnabled(key),
      meetsPrerequisites: (perkId) => this.prestigeMgr.meetsPrerequisites(perkId),
      isExcluded: (perkId) => this.prestigeMgr.isExcluded(perkId),
      perkBlockedReason: (perkId) => this.prestigeMgr.perkBlockedReason(perkId),
      coreState: this.corePanelState(),
      ascendUnlockWave: this.prestigeMgr.ascensionUnlockWave(),
      transcendUnlockAP: this.prestigeMgr.transcendenceUnlockAP(),
      targetAscendWave: this.state.prestige.targetAscendWave,
      autoBuyStrategy: this.state.prestige.autoBuyStrategy,
      autoBuyReserve: this.state.prestige.autoBuyReserve,
      setAutoBuyStrategy: (strategy) => this.setAutoBuyStrategy(strategy),
      setAutoBuyReserve: (fraction) => this.setAutoBuyReserve(fraction),
    });
    this.ui.setResearchAPI({
      rp: this.researchTree.rp,
      levels: this.researchTree.getLevelsSnapshot(),
      unlocked: this.researchTree.unlocked,
      reasonBlocked: (id) => this.researchTree.reasonBlocked(id),
      inProgress: this.researchTree.inProgress,
      researchSpeedMultiplier: this.prestigeMgr.getResearchSpeedMultiplier(),
      rpGainRate: this.researchTree.getPassiveRPRate(
        this.state.stats.lifetimeHighestWave,
        this.rpGainMultiplier(),
      ),
    });
    this.maxSpeedIndex = MAX_SPEED_INDEX + this.prestigeMgr.getGameSpeedBonus();
    this.ui.setSpeedAPI({
      speeds: this.getAvailableSpeeds(),
      currentIndex: this.getSpeedIndex(),
      maxIndex: this.getMaxSpeedIndex(),
    });
    this.ui.setWaveControlAPI({
      autoProgress: this.waveMgr.getAutoProgress(),
      currentWave: this.waveMgr.currentWave,
      isIntermission: this.state.wave.intermission,
    });
    this.ui.setEnemyAPI({
      getWaveMultipliers: () => this.enemyMgr.getWaveMultipliers(),
    });
    // Plan §7: the codex mastery track is a per-enemy list of chapters that
    // have a `kills_of` goal for the type. Read once per UI tick by
    // `pushEnemyStats`; cheap because the snapshot it consumes is the same
    // one `watchInfo()` already builds, with no second metric pass.
    this.ui.setEnemyWatchAPI({
      getWatchLines: () => this.watchEnemyLines(),
    });
    this.ui.setAbilityAPI({
      canCast: (id, wave) => this.abilityMgr.canCast(id, wave),
      reasonBlocked: (id, wave) => this.abilityMgr.reasonBlocked(id, wave),
      canUpgrade: (id, wave) => this.abilityMgr.canUpgrade(id, wave),
      isMaxed: (id) => this.abilityMgr.isMaxed(id),
      getUpgradeCost: (id) => this.abilityMgr.getUpgradeCost(id),
      getEffectiveStats: (id) => this.abilityMgr.getEffectiveStats(id),
      getXp: (id) => this.abilityMgr.getXp(id),
      isAutoCastUnlocked: () => this.prestigeMgr.isAutomationUnlocked('autoAbilities'),
      isAutoCastEnabled: (id) => this.state.prestige.autoCastEnabled[id] !== false,
      onToggleAutoCast: (id, enabled) => this.setAutoCastEnabled(id, enabled),
      // Plan §G.3: the bar's `is-arming` class reads the current placement
      // pending id through the API so the UI never reaches into Game state.
      getPendingPlacement: () => this.placement.pending,
    });
    this.ui.setTalentAPI({
      allocated: this.state.talents.allocated,
      unspentPoints: () => this.state.towerXp.unspentTalentPoints,
      level: () => this.towerXpMgr.level,
      xpProgress: () => this.towerXpMgr.getProgressToNextLevel(),
      atLevelCap: () => this.towerXpMgr.atCap,
      canAllocate: (id) => this.talentMgr.canAllocate(id),
      blockedReason: (id) => this.talentMgr.blockedReason(id),
      allocate: (id) => this.talentMgr.allocate(id),
      pointsInBranch: (branch) => this.talentMgr.pointsInBranch(branch),
      refundBranch: (branch) => this.talentMgr.refundBranch(branch),
      refundAll: () => this.talentMgr.refundAll(),
      branchRespecCost: (branch) => this.talentMgr.branchRespecCost(branch),
      fullRespecCost: () => this.talentMgr.fullRespecCost(),
      gold: () => this.state.resources.gold,
    });
    this.ui.setPassiveAPI({
      getLevel: (id: string) => this.passiveMgr.getLevel(id),
      getXp: (id: string) => this.passiveMgr.getXp(id),
      getXpForNextLevel: (id: string) => this.passiveMgr.getXpForNextLevel(id),
      highestWave: () => this.state.stats.lifetimeHighestWave,
      unlockedCount: () => this.passiveMgr.unlockedCount,
      totalLevels: () => this.passiveMgr.totalLevels,
      isUnlocked: (id: string) => this.passiveMgr.isUnlocked(id),
      isMaxed: (id: string) => this.passiveMgr.isMaxed(id),
      canUnlock: (id: string) => this.passiveMgr.canUnlock(id, this.state.stats.lifetimeHighestWave),
      getUnlockCost: (id: string) => this.passiveMgr.getUnlockCost(id),
      onUnlock: (id: string) => this.unlockPassive(id),
      getFullUpgradeCost: (id: string) => this.passiveMgr.getFullUpgradeCost(id),
      getUpgradeCost: (id: string) => this.passiveMgr.getUpgradeCost(id),
      getXpDiscount: (id: string) => this.passiveMgr.getXpDiscount(id),
      canUpgrade: (id: string) => this.passiveMgr.canUpgrade(id, this.state.resources.gold),
      onUpgrade: (id: string) => this.upgradePassive(id),
    });
    this.ui.setAutoPickBlessingsState(
      this.blessingAutoPickActive(),
      this.blessingAutoPickForced(),
    );
    this.ui.setBlessingAPI(() => ({
      held: this.blessingMgr.heldList(),
      picksTaken: this.blessingMgr.picks,
      rerolls: this.blessingMgr.rerollsAvailable,
      nextDraftWave: this.nextBlessingDraftWave(),
    }));
    // Contracts (plan §5.3). One API drives both the corner tracker and the
    // Progression section, so the two can never disagree about what is live.
    this.ui.setContractAPI(() => ({
      live: this.contractMgr.list.map(c => ({
        uid: c.uid,
        name: c.def.name,
        label: this.contractMgr.label(c),
        progress: this.contractMgr.progressLabel(c),
        fill: this.contractMgr.fillFraction(c),
        reward: this.contractMgr.rewardLabel(c),
      })),
      history: this.contractMgr.recent.map(h => ({
        name: h.name,
        wave: h.wave,
        gold: h.gold,
        rerolls: h.reward.rerolls,
        rp: h.reward.rp,
        apBonusPct: h.reward.apBonusPct,
      })),
      completed: this.contractMgr.completed,
      apBonusPct: this.contractMgr.apBonusPct,
      apCapPct: CONTRACT_TUNING.apBonusCap,
    }));
    // The Long Watch (plan §6.2): one closure, called once per UI tick by
    // the Journal panel — the view walks all twelve chapters and every goal,
    // so caching the snapshot at the top of `watchInfo` keeps this cheap.
    this.ui.setWatchAPI(() => this.watchInfo());
    this.ui.setEquipmentAPI({
      inventory: this.state.equipment,
      equipped: this.state.equipped,
      equip: (slot: EquipmentSlot, id: string) => this.equipmentMgr.equip(slot, id),
      unequip: (slot: EquipmentSlot) => this.equipmentMgr.unequip(slot),
      getSellValue: (id: string) => this.equipmentMgr.getSellValue(id),
      onItemViewed: (id: string) => this.markEquipmentSeen(id),
      onSell: (id: string) => {
        const gold = this.equipmentMgr.sell(id);
        if (gold > 0) {
          this.state.resources.gold += gold;
          this.state.resources.lifetimeGold += gold;
          this.state.stats.goldEarned += gold;
          this.bus.emit('gold_changed', this.state.resources.gold);
        }
      },
    });
  }

  private migrateUpgrades(levels: Record<string, number>): void {
    const oldSize = levels['shockwaveSize'] ?? 0;
    const oldCooldown = levels['shockwaveCooldown'] ?? 0;
    if (oldSize > 0 || oldCooldown > 0) {
      const merged = Math.max(oldSize, oldCooldown);
      levels['shockwave'] = Math.min(50, merged);
    }
    delete levels['shockwaveSize'];
    delete levels['shockwaveCooldown'];
  }

  /**
   * Recompute every stat from scratch and write the result.
   *
   * This is the only path in the game that may change a tower stat. It
   * snapshots each system's contribution into an immutable `StatContext`, runs
   * the single composition pass in `resolveStats`, and writes the result out.
   * Because no system touches `TowerState` itself, the order they contribute
   * in cannot change the answer — which is what the old 300-line version got
   * wrong six different ways (plan §1.1, §1.2, §6).
   */
  private applyUpgradeEffects(): void {
    const ctx = this.buildStatContext();
    const { stats } = resolveStats(ctx);
    this.lastStatContext = ctx;
    this.lastResolved = stats;
    this.appliedBuffVersion = this.buffs.version;
    this.applyResolvedStats(stats);
    // The Stats popup replays a cached copy of this block every frame, so it
    // has to be handed the new one here — this is the only path that changes
    // a tower stat.
    this.ui?.setResolvedStats(stats, stats.goldMultiplier);
    this.state.research = this.researchTree.getLevelsSnapshot();
  }

  /**
   * Recompute the tower's upgrade marks, and announce any that stepped up.
   *
   * `announce` is false on every path that is not a purchase — a save load, an
   * ascension reset, a `replaceLevels` — because those move every mark at once
   * and a wall of ten toasts on page load is not a reward, it is noise. The
   * purchase path is the only one that earns the flourish.
   *
   * Reads `upgradeMgr.snapshot()` rather than `state.upgrades` so it is correct
   * whichever of the two level events called it: `UpgradeManager` emits
   * `upgrade_purchased` *before* `upgrades_changed`, so `state.upgrades` is one
   * event stale at the moment the announcement has to be made.
   */
  private refreshTowerMarks(announce: boolean): void {
    const next = computeTowerMarks(this.upgradeMgr.snapshot());
    if (next.key === this.towerMarks.key) return;
    const prev = this.towerMarks;
    this.towerMarks = next;
    if (!announce) return;
    const t = this.tower.snapshot;
    let flourished = false;
    for (const id of Object.keys(next.steps) as TowerMarkId[]) {
      const step = next.steps[id];
      if (step <= prev.steps[id]) continue;
      const def = TOWER_MARK_BY_ID[id];
      this.bus.emit('tower_mark_changed', { id, step, def });
      this.bus.emit('toast', {
        kind: 'milestone',
        text: `${def.part}: ${def.announce[step - 1]}.`,
        life: 4,
      });
      // One flourish per purchase, however many marks a bulk buy crossed —
      // ten overlapping rings is a smear, not a moment.
      if (!flourished) {
        this.effects.emitTowerForge(t.x, t.y, TOWER_VISUAL.plinthRadius);
        flourished = true;
      }
    }
  }

  /**
   * Recompute only if a buff has started or expired since the last pass. Called
   * once per simulation substep, so a buff edge costs one resolve rather than a
   * resolve every frame.
   */
  private refreshBuffedStats(): void {
    if (this.buffs.version === this.appliedBuffVersion) return;
    // Bloodlust decay: reset stacks when the buff expires.
    if (this.bloodlustStacks > 0 && !this.buffs.has('talent_bloodlust')) {
      this.bloodlustStacks = 0;
    }
    this.applyUpgradeEffects();
  }

  /**
   * Recompute when tower HP crosses a threshold some contributor reads.
   *
   * Three effects are gated on `StatContext.hpFraction` — the `hp_threshold_damage`
   * evolution, the `last_stand` blessing, and bloodforge's `desperate_tempo`
   * — and until Part 6 nothing recomputed when HP moved. They took effect at
   * the *next* resolve for another reason (a purchase, a buff edge, a wave
   * clear), which for a comeback mechanic is the wrong moment by definition:
   * the whole point of "+40% fire rate below half HP" is that it arms the
   * instant you drop below half, not a wave later.
   *
   * Bucketed rather than compared every substep, so a tower sitting at 29% HP
   * costs zero resolves; only an actual crossing pays for one.
   */
  private refreshHpThresholdStats(): void {
    const t = this.tower.snapshot;
    const fraction = t.maxHp > 0 ? t.hp / t.maxHp : 1;
    let bucket = 0;
    for (const threshold of HP_STAT_THRESHOLDS) {
      if (fraction > threshold) bucket += 1;
    }
    if (bucket === this.hpStatBucket) return;
    this.hpStatBucket = bucket;
    this.applyUpgradeEffects();
  }

  /**
   * Recompute when a pacing input moves (plan §7).
   *
   * Same shape and the same reason as `refreshHpThresholdStats`: risk, the
   * combo tier and momentum are all read by `contributors/pacing.ts`, and all
   * three are discrete, so a signature comparison per substep buys a resolve
   * exactly when one of them changes. Without it a combo tier reached at kill
   * 25 would start paying at the next purchase — which is the bug Part 6 found
   * three instances of, in a mechanic whose entire point is immediacy.
   */
  private refreshPacingStats(): void {
    const signature = this.pacingMgr.statSignature();
    if (signature === this.pacingStatSignature) return;
    this.pacingStatSignature = signature;
    this.applyUpgradeEffects();
  }

  /**
   * Snapshot every contributor into the pipeline's input.
   *
   * Nothing here computes: each field is one system's own answer about its own
   * contribution. Composition happens exactly once, in `resolveStats`.
   */
  private buildStatContext(): StatContext {
    const t = this.tower.snapshot;

    const evolutions: Partial<Record<EvolutionEffectId, number>> = {};
    for (const id of EVOLUTION_EFFECT_IDS) {
      // Presence-only evolutions (Crits Ignore Armor) carry no magnitude, so
      // they contribute as 1 rather than dropping out as 0.
      const value = this.upgradeMgr.getEvolutionEffectValue(id)
        || (this.upgradeMgr.hasEvolutionEffect(id) ? 1 : 0);
      if (value !== 0) evolutions[id] = value;
    }

    const achievements: Partial<Record<AchievementRewardType, number>> = {};
    for (const type of Object.keys(ACHIEVEMENT_REWARD_CONSUMERS) as AchievementRewardType[]) {
      const value = this.achievementMgr.getRewardMultiplier(type);
      if (value !== 0) achievements[type] = value;
    }

    const talentValues = this.talentMgr.getAllEffectValues();
    const talents: Partial<Record<TalentStat, number>> = {};
    for (const stat of TALENT_STATS) {
      const value = talentValues.get(stat) ?? 0;
      if (value !== 0) talents[stat] = value;
    }

    const passives = this.passiveMgr.getStatTotals();

    const equipped = this.equipmentMgr.getEquippedBonuses();
    const equipment: Partial<Record<EquipmentStatType, number>> = {};
    for (const stat of EQUIPMENT_STAT_TYPES) {
      const value = equipped[stat] ?? 0;
      if (value !== 0) equipment[stat] = value;
    }

    const lifetime = this.prestigeMgr.getLifetimeAPBonus();
    return {
      wave: this.waveMgr.currentWave,
      core: this.coreMgr.current,
      hpFraction: t.maxHp > 0 ? t.hp / t.maxHp : 1,
      upgrades: this.upgradeMgr.snapshot(),
      evolutions,
      prestige: {
        lifetimeDamage: lifetime.damage,
        lifetimeGold: lifetime.gold,
        apDamage: this.prestigeMgr.getAPDamageBonus(),
        apGold: this.prestigeMgr.getAPGoldBonus(),
        apFireRate: this.prestigeMgr.getAPFireRateMultiplier(),
        apPierce: this.prestigeMgr.getAPPierceBonus(),
        apUpgradeDiscount: this.prestigeMgr.getAPUpgradeDiscount(),
        apXpGain: this.prestigeMgr.getAPXpMultiplier(),
        apRpDrop: this.prestigeMgr.getAPRpDropBonus(),
        apReviveCharges: this.prestigeMgr.getAPReviveCharges(),
        tpDamage: this.prestigeMgr.getTPDamageMultiplicative(),
        tpFireRate: this.prestigeMgr.getTPFireRateMultiplier(),
        tpManaRegen: this.prestigeMgr.getTPManaRegenMultiplier(),
        tpResource: this.prestigeMgr.getTPResourceMultiplicative(),
        tpCritDamage: this.prestigeMgr.getTPCritDamageBonus(),
        tpPierce: this.prestigeMgr.getTPPierceBonus(),
        orbGoldMultiplier: this.prestigeMgr.getOrbGoldMultiplier(),
        abilityManaCostReduction: this.prestigeMgr.getAbilityManaCostReduction(),
        abilityCdr: this.prestigeMgr.getAbilityCDR(),
        treasureChance: this.prestigeMgr.getTreasureChance(),
        waveSkipChance: this.prestigeMgr.getWaveSkipChance(),
        hasExecuteDamage: this.prestigeMgr.hasExecuteDamage(),
        executeDamageMultiplier: this.prestigeMgr.getExecuteDamageMultiplier(),
      },
      research: {
        goldMultiplicative: this.researchTree.getGoldMultiplicative(),
        manaRegenMultiplicative: this.researchTree.getManaRegenMultiplicative(),
        abilityCostReduction: this.researchTree.getAbilityCostReduction(),
        abilityPowerBonus: this.researchTree.getAbilityPowerBonus(),
        abilityAreaBonus: this.researchTree.getAbilityAreaBonus(),
        pierceCount: this.researchTree.getPierceCount(),
        goldLuckChance: this.researchTree.getGoldLuckChance(),
        intermissionSpeedReduction: this.researchTree.getIntermissionSpeedReduction(),
        enemyHpReduction: this.researchTree.getEnemyHPReduction(),
        rpDropChanceBonus: this.researchTree.getRPDropChanceBonus(),
      },
      achievements,
      talents,
      passives,
      equipment,
      blessings: {
        // Already summed across stacks by the manager's rebuilt cache, so the
        // context stays plain data and the contributor stays a switch.
        stats: this.blessingMgr.getStatTotals(),
        behaviors: this.blessingBehaviors(),
      },
      waveModifier: this.activeWaveModifierInputs(),
      pacing: {
        // The *committed* risk, not the dial: §7.4 says a change takes effect
        // at the next wave, and this is the one place that could quietly break
        // that promise.
        risk: this.pacingMgr.activeRisk,
        momentum: this.pacingMgr.momentumBonus,
        comboTier: this.pacingMgr.comboTierIndex,
      },
      buffs: this.buffs.entries,
      manaFraction: this.state.resources.maxMana > 0
        ? this.state.resources.mana / this.state.resources.maxMana
        : 1,
      talentBehaviors: [...this.talentMgr.behaviors()],
    };
  }

  /** The next wave whose clear earns a draft, or null once the cap is hit. */
  private nextBlessingDraftWave(): number | null {
    if (this.blessingMgr.isCapped) return null;
    const current = this.waveMgr.currentWave;
    let wave = Math.max(this.blessingMgr.firstDraftWave, current);
    while (!this.blessingMgr.isDraftDue(wave)) wave += 1;
    return wave;
  }

  /** Behaviors held, for the two that resolve as stats rather than hooks. */
  private blessingBehaviors(): BlessingBehavior[] {
    const out: BlessingBehavior[] = [];
    if (this.blessingMgr.has('last_stand')) out.push('last_stand');
    return out;
  }

  /**
   * The wave mutator's tower-side effects, or null when none is running on the
   * current wave. Its enemy-side effects are applied separately, in
   * `applyActiveWaveModifier`.
   */
  private activeWaveModifierInputs(): { goldAdditive: number; playerDamageMult: number } | null {
    const wms = this.state.wave.waveModifier;
    const active = wms.active;
    if (!active || wms.wavesRemaining <= 0 || wms.pendingChoiceForWave === null) return null;
    if (this.waveMgr.currentWave < wms.pendingChoiceForWave) return null;
    return {
      goldAdditive: active.effects.goldAdditive,
      playerDamageMult: active.effects.playerDamageMult,
    };
  }

  /**
   * Write one resolved stat block out to the tower and every manager that
   * caches a derived number.
   *
   * The three places that need memory across recomputes — current HP, shield
   * charges and wall HP — are handled here rather than in the resolver, since
   * they depend on live run state the context deliberately does not carry.
   */
  private applyResolvedStats(stats: ResolvedStats): void {
    const t = this.tower.snapshot;
    const oldMaxHp = t.maxHp;
    const oldHp = t.hp;

    t.baseDamage = stats.baseDamage;
    t.fireRate = stats.fireRate;
    t.range = stats.range;
    t.critChance = stats.critChance;
    t.critMultiplier = stats.critMultiplier;
    t.healthRegen = stats.healthRegen;
    t.defense = stats.defense;
    t.armor = stats.armor;
    t.knockbackForce = stats.knockbackForce;
    t.lifesteal = stats.lifesteal;
    t.thorns = stats.thorns;
    t.shockwaveSize = stats.shockwaveSize;
    t.shockwaveCooldown = stats.shockwaveCooldown;
    t.landMineDamage = stats.landMineDamage;
    t.landMineFrequency = stats.landMineFrequency;
    t.shieldRechargeTime = stats.shieldRechargeTime;
    t.doubleShotChance = stats.doubleShotChance;
    t.quickShotChance = stats.quickShotChance;
    t.quickShotTime = stats.quickShotTime;

    // HP keeps its fraction of max when max rises, so buying Fortify heals
    // proportionally rather than leaving a debt; a drop just clamps.
    t.maxHp = stats.maxHp;
    if (oldMaxHp <= 0) {
      t.hp = t.maxHp;
    } else if (t.maxHp > oldMaxHp && oldHp > 0) {
      t.hp = Math.min(t.maxHp, oldHp * (t.maxHp / oldMaxHp));
    } else if (t.hp > t.maxHp) {
      t.hp = t.maxHp;
    }

    const oldCharges = t.shieldMaxCharges;
    t.shieldMaxCharges = stats.shieldMaxCharges;
    if (t.shieldMaxCharges > oldCharges) {
      t.shieldCurrentCharges += t.shieldMaxCharges - oldCharges;
    }
    t.shieldCurrentCharges = Math.max(0, Math.min(t.shieldCurrentCharges, t.shieldMaxCharges));

    const oldWallMax = t.wallMaxHp;
    const newWallMax = stats.wallFraction > 0
      ? Math.max(1, Math.floor(t.maxHp * stats.wallFraction))
      : 0;
    if (newWallMax <= 0) {
      t.wallHp = 0;
    } else if (oldWallMax <= 0) {
      t.wallHp = newWallMax;
    } else if (newWallMax > oldWallMax && t.wallHp > 0) {
      t.wallHp = Math.min(
        newWallMax,
        t.wallHp + Math.floor((newWallMax - oldWallMax) * (t.wallHp / oldWallMax)),
      );
    } else if (t.wallHp > newWallMax) {
      t.wallHp = newWallMax;
    }
    t.wallMaxHp = newWallMax;

    this.state.resources.manaRegen = stats.manaRegen;
    this.state.resources.maxMana = stats.maxMana;

    this.enemyMgr.setGoldMultiplier(stats.goldMultiplier);
    this.enemyMgr.setThorns(stats.thorns);
    this.enemyMgr.setGoldLuck(stats.goldLuckChance, GOLD_LUCK_MULTIPLIER);
    this.enemyMgr.setGoldOnKillBonus(stats.goldOnKill);
    this.enemyMgr.setCritGoldBonus(stats.critGold);
    this.enemyMgr.setDoubleGoldChance(stats.doubleGoldChance);
    this.enemyMgr.setHPReduction(stats.enemyHpReduction);
    this.enemyMgr.setRPDropChanceBonus(stats.rpDropChanceBonus);
    this.enemyMgr.setWallContactExtra(stats.wallContactExtra);
    // Blessing trade-off cards and the §7.4 risk dial move the *enemies*, not
    // the tower — but they still resolve through the pipeline, so they compose
    // with each other and with the wave mutator's own multipliers instead of
    // one silently winning (plan §1.4, §7.4).
    this.enemyMgr.setStatSpeedMult(stats.enemySpeedMult);
    this.enemyMgr.setStatHpMult(stats.enemyHpMult);
    this.enemyMgr.setStatDamageMult(stats.enemyDamageMult);
    // Plan §D.9: the `orb_magnet` blessing is one of the ref-counted magnet
    // sources (the other is Gold Rush, owned by `AbilityManager`). Set from
    // the same recompute as everything else, so taking the card is felt on
    // the next orb and losing it on ascension is felt immediately.
    this.lootMgr.setMagnetSource('blessing', this.blessingMgr.has('orb_magnet'));
    // Lodestone (prestige-abs §3.1) is the third magnet source and the only
    // permanent one. It is a boolean rather than a `StatKey` because the
    // accumulator is numeric-by-contract; `setMagnetSource` is ref-counted and
    // early-returns when the composed answer is unchanged, so setting it from
    // every recompute costs nothing.
    this.lootMgr.setMagnetSource('prestige', this.prestigeMgr.hasOrbMagnet());

    this.abilityMgr.setAbilityCostMultiplier(stats.abilityCostMultiplier);
    this.abilityMgr.setCooldownMultiplier(stats.abilityCooldownMultiplier);
    this.abilityMgr.setDamageMultiplier(stats.abilityDamageMultiplier);
    this.abilityMgr.setAreaMultiplier(stats.abilityAreaMultiplier);
    this.abilityMgr.setBerserkFireBonus(stats.berserkFireBonus);
    this.abilityMgr.setChainBounceBonus(stats.chainBounceBonus);
    this.abilityMgr.setSlowStrengthBonus(stats.slowStrengthBonus);
    this.abilityMgr.setMeteorDamageBonus(stats.meteorDamageBonus);
    this.abilityMgr.setBuffDurationBonus(stats.buffDurationBonus);
    // Core: Frostwork — slow abilities run twice as long (plan §6.1).
    this.abilityMgr.setSlowDurationMult(
      this.coreMgr.has('nova_extended') ? CORE_TUNING.novaDurationMult : 1,
    );

    this.projectileMgr.setDamageMultipliers(0, 1);
    this.projectileMgr.setArmorPen(stats.armorPen);
    this.projectileMgr.setArmorPenFlat(stats.armorPenFlat);
    this.projectileMgr.setPierceExtra(stats.pierceExtra);
    // Revamp §5.2: the `splash` upgrade's disc, held here rather than on
    // `TowerState` because the only consumer is the volley composed below.
    this.shotSplash = stats.shotSplashRadius > 0 && stats.shotSplashFraction > 0
      ? { splashRadius: stats.shotSplashRadius, splashFraction: stats.shotSplashFraction }
      : {};
    this.projectileMgr.setExecuteBonus(stats.executeThreshold, stats.executeMultiplier);
    this.projectileMgr.setTalentExecuteBonus(stats.talentExecuteBonus);
    this.projectileMgr.setEvolutionShotBonuses(
      this.upgradeMgr.getEvolutionEffectValue('range_damage'),
      this.upgradeMgr.getEvolutionEffectValue('pierce_amp'),
    );
    this.projectileMgr.setEvolutionCombatEffects(
      stats.instantKillChance,
      stats.critSplash,
      stats.critIgnoreArmor > 0,
    );

    this.towerXpMgr.setXpGainMultiplier(stats.xpGainMultiplier);
    this.passiveMgr.setXpGainMultiplier(stats.xpGainMultiplier);
    this.upgradeMgr.setCostDiscount(stats.upgradeCostDiscount);
    this.equipmentMgr.setFindChanceBonus(stats.equipmentFindChance);
    this.automation.setAutoBuyIntervalReduction(stats.autoBuyIntervalReduction);
    this.waveMgr.setWaveSkipChance(stats.waveSkipChance);
    this.waveMgr.setIntermissionMultiplier(stats.intermissionMultiplier);

    this.waveGoldBonus = stats.waveGold;
    this.talentDodgeChance = stats.dodgeChance;
    this.talentManaShieldFraction = stats.manaShieldFraction;
    this.talentExtraProjectileChance = stats.extraProjectileChance;
    this.talentMagicProcChance = stats.magicProcChance;
    this.talentWallRegen = stats.wallRegen;
    this.talentHeadStartWaves = stats.headStartWaves;

    // ── Levelling redesign step 4: new talent stat cache ──
    this.killFrenzyPerStack = stats.killFrenzyPerStack;
    this.critFollowUpChance = stats.critFollowUpChance;
    this.secondWindPower = stats.secondWindPower;
    this.windfallMultiplier = stats.windfallMultiplier;
    this.interestRate = stats.interestRate;
    this.manaOnKillFraction = stats.manaOnKillFraction;
    this.extraReviveCharges = stats.reviveCharges;
    // ── Levelling redesign step 7: wire talent stats to managers ──
    this.projectileMgr.setFocusStackBonus(stats.focusStackBonus);
    this.projectileMgr.setBossDamageBonus(stats.bossDamageBonus);
    this.projectileMgr.setChilledDamageBonus(stats.chilledDamageBonus);
    this.projectileMgr.setEvolutionShotBonuses(
      this.upgradeMgr.getEvolutionEffectValue('range_damage') + stats.overwatchDamage,
      this.upgradeMgr.getEvolutionEffectValue('pierce_amp'),
    );
    this.abilityMgr.setEchoChance(stats.abilityEchoChance);
    this.lootMgr.setValueBonus(stats.orbValueBonus);
    this.lootMgr.setGoldMultiplier(stats.orbGoldMultiplier);
    this.pacingMgr.setMomentumBonus(stats.momentumGainBonus, Math.min(MOMENTUM_CAP * 2, stats.momentumGainBonus / 20));
    this.enemyMgr.setThornsOnKnockback(stats.knockbackForce > TOWER_BASE.knockbackForce);
    this.automation.setQuartermasterReserve(
      this.talentMgr.hasBehavior('quartermaster') ? TALENT_TUNING.quartermasterGoldReserve : 0,
    );
  }

  private buildShotVariants(): ShotVariant[] {
    const variants: ShotVariant[] = [{}];
    const extra = this.prestigeMgr.getExtraShots()
      + Math.floor(this.achievementMgr.getRewardMultiplier('extra_projectile'));
    for (let i = 0; i < extra; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const lane = Math.floor(i / 2) + 1;
      variants.push({
        posOffsetX: 0,
        posOffsetY: side * 10 * lane,
        damageScale: PRESTIGE_PROJECTILE_TUNING.extraDamageScale,
      });
    }
    const scatter = this.prestigeMgr.getScatterShots();
    for (let lvl = 0; lvl < scatter; lvl++) {
      const angle = Math.min((30 + 15 * lvl) * Math.PI / 180, 75 * Math.PI / 180);
      const scatterScale = PRESTIGE_PROJECTILE_TUNING.scatterDamageScale;
      variants.push({ angleOffset: -angle, damageScale: scatterScale });
      variants.push({ angleOffset: angle, damageScale: scatterScale });
    }
    const back = this.prestigeMgr.getBackShots();
    for (let i = 0; i < back; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const lane = Math.floor(i / 2) + (i != 1 ? 1 : 0);
      variants.push({
        angleOffset: Math.PI,
        posOffsetY: side * 10 * lane,
        damageScale: PRESTIGE_PROJECTILE_TUNING.rearDamageScale,
      });
    }
    return variants;
  }

  private applySavedStateReset(): void {
    this.upgradeMgr.reset();
    this.resourceMgr.reset();
    this.enemyMgr.reset();
    this.projectileMgr.reset();
    this.abilityMgr.reset();
    // The `long_memory` Watch unlock (plans/milestones.md §5.11) keeps the
    // player's ability levels across ascensions / transcendences. The base
    // reset wipes levels because they were historically run-scoped.
    if (!this.watchMgr.has('long_memory')) this.abilityMgr.resetLevels();
    this.effects.reset();
    // Plan §2.6: passives and equipment are *character* progression, like
    // talents and tower XP — they persist through an ascension and are only
    // wiped by a transcendence. Wiping the inventory every run made the whole
    // loot system per-run, and since gear only drops from bosses at a 15% base
    // chance most runs generated two to four items and then deleted them.
    this.mines = [];
    this.revivesUsed = 0;
    this.runFailed = false;
    this.killStreak = 0;
    this.manaFullGoldTimer = 0;
    this.shotCounter = 0;
    this.mortarShotCounter = 0;
    // Plan §6.2: the core *selection* is run-scoped; the unlocks are not. It
    // resets to the player's preference rather than to the default, because an
    // auto-ascending idle game would otherwise strip the chosen identity from
    // every run without ever asking. The picker is what changes the preference.
    this.corePicker.hide();
    this.coreMgr.resetRun();
    this.state.cores = this.coreMgr.snapshot();
    // Blessings are run-scoped by design (plan §1.5): being wiped is what makes
    // one run distinct from the next rather than a continuation of it. This
    // path is shared by ascension and transcendence.
    this.blessingModal.hide();
    this.waveMgr.resumeIntermission();
    // The `heirloom` Watch unlock (plans/milestones.md §5.8) keeps the player's
    // best-rarity blessing through an ascension, so one of the previous run's
    // cards does not vanish at the moment the new run's identity is forming.
    this.blessingMgr.reset({ carryBest: this.watchMgr.has('heirloom') });
    // Field Kit (prestige-abs §5) banks reroll *tokens*, a separate field from
    // the per-draft free rerolls `quartermaster` grants, so the two stack.
    this.blessingMgr.grantRerollToken(this.prestigeMgr.getStartingRerollTokens());
    this.state.blessings = this.blessingMgr.snapshot();
    // Orbs are run-scoped *and* frame-scoped: they are never persisted, and a
    // run that ends drops whatever was still in the air (docs/loot-system.md).
    this.lootMgr.reset();
    this.cancelPlacement();
    this.charge.reset();
    this.chargeFirePending = false;
    // Boss rewards are run-scoped for the same reason (plan §3.4): the flawless
    // AP bonus is banked against *this* run's ascension, and the ascension that
    // pays it out is the one that ends the run.
    this.bossEncounter = null;
    this.waveFlawless = true;
    this.state.bossRun = { apBonusPct: 0, swiftKills: 0, flawlessKills: 0 };
    this.prestigeMgr.setRunApBonus(0, 'boss');
    this.prestigeMgr.setRunApBonus(0, 'contract');
    // Plan §7: momentum and the combo are run-scoped; the risk *dial* is not.
    // Resetting it to 0 on every ascension would silently un-set a preference
    // an auto-ascending run reaches several times an hour — the same trap
    // Part 6 found in the core selection.
    this.pacingMgr.reset();
    this.pacingStatSignature = -1;
    this.prestigeMgr.setRiskApBonus(riskApBonus(this.pacingMgr.activeRisk));
    this.state.pacing = this.pacingMgr.snapshot();
    this.buffs.reset();
    const t = this.tower.snapshot;
    t.cooldown = 0;
    t.hp = TOWER_BASE.hp;
    t.maxHp = TOWER_BASE.maxHp;
    t.shieldCurrentCharges = 0;
    t.shieldRechargeTimer = 0;
    // The enemy list is re-rolled below; the lock-on must not carry a stale
    // enemy object across the run boundary.
    this.tower.clearTargetLock();

    const startWave = Math.max(
      this.researchTree.getStartWave(),
      this.prestigeMgr.getWaveStartBonus(),
      this.talentHeadStartWaves > 0 ? this.talentHeadStartWaves + 1 : 0,
      // The `veteran_start` Watch unlock (plans/milestones.md §5.9) starts
      // each run at wave 6. Research and talents can still pull higher.
      this.watchMgr.has('veteran_start') ? 6 : 0,
    );
    if (startWave > 1) {
      this.waveMgr.startAtWave(startWave);
      this.state.wave.highestWave = startWave;
    } else {
      this.waveMgr.reset();
    }
    this.state.wave = this.waveMgr.snapshot;
    if (startWave > 1) {
      const startGold = Math.max(50, Math.floor(Math.pow(1.1, startWave - 1) * 60));
      this.state.resources.gold += startGold;
    }

    const headStartGold = this.prestigeMgr.getStartGold()
      + this.achievementMgr.getRewardMultiplier('start_gold');
    if (headStartGold > 0) {
      this.state.resources.gold += headStartGold;
    }

    this.applyUpgradeEffects();
    this.state.upgrades = this.upgradeMgr.snapshot();
    // Contracts are run-scoped (plan §5.1) and re-drawn *last*, once the wave
    // and the gold multiplier are the new run's: the draw is banded on the
    // current wave and `spend_gold` targets are sized off `estimateWaveGold`,
    // both of which read the state this method has just rewritten.
    this.contractMgr.reset();
    this.state.contracts = this.contractMgr.snapshot();
  }

  /**
   * Apply the active wave modifier to enemy + tower systems for the current
   * wave. If no modifier is active, reset all multipliers to 1.
   */
  private applyActiveWaveModifier(): void {
    const wms = this.state.wave.waveModifier;
    const active = wms.active;
    // Plan §3.3: the modifier applies to a *range* of waves now, not one.
    const matchesWave = wms.wavesRemaining > 0
      && wms.pendingChoiceForWave !== null
      && this.waveMgr.currentWave >= wms.pendingChoiceForWave;
    if (!active || !matchesWave) {
      this.state.wave.waveModifier.active = null;
      this.waveMgr.setEnemyCountMult(1);
      this.enemyMgr.setSpeedMult(1);
      this.enemyMgr.setDamageToTowerMult(1);
      this.enemyMgr.setHPMult(1);
      this.applyUpgradeEffects();
      return;
    }
    const e = active.effects;
    this.waveMgr.setEnemyCountMult(e.countMult);
    this.enemyMgr.setSpeedMult(e.speedMult);
    this.enemyMgr.setDamageToTowerMult(e.damageToTowerMult);
    this.enemyMgr.setHPMult(e.hpMult);
    // playerDamageMult + goldAdditive go through the upgrade-effects pipeline
    // so they compose with prestige / research multipliers.
    this.applyUpgradeEffects();
    this.bus.emit('wave_modifier_active', active);
  }

  /**
   * Plan §3.3: rough gold a wave is worth right now, used to turn a mutator's
   * "×4 gold" into a number the player can compare against. Deliberately a
   * heuristic — normal-enemy drop x spawn count x the composed gold multiplier —
   * because the exact figure depends on which enemy types roll.
   */
  private estimateWaveGold(wave: number): number {
    const perEnemy = goldDropForWave(ENEMY_DEFS.normal.baseGold, wave);
    const count = spawnCountForWave(wave);
    return Math.max(0, perEnemy * count * this.computeGoldMultiplier());
  }

  /** Total reward a mutator is projected to pay across its full run. */
  private projectWaveModifierReward(
    snapshot: WaveModifierSnapshot,
    startWave: number,
  ): { gold: number; ap: number; tp: number } {
    let gold = 0;
    let ap = 0;
    let tp = 0;
    for (let i = 0; i < this.mutatorDuration(); i++) {
      const escalation = waveModifierRewardMultiplier(i);
      const wave = startWave + i;
      if (snapshot.reward.gold > 0) {
        // The mutator's own gold bonus applies to the wave it is measuring.
        const waveGold = this.estimateWaveGold(wave) * (1 + Math.max(-0.9, snapshot.effects.goldAdditive));
        gold += Math.floor(waveGold * snapshot.reward.gold * escalation);
      }
      ap += Math.floor(snapshot.reward.ap * escalation);
      tp += Math.floor(snapshot.reward.tp * escalation);
    }
    return { gold, ap, tp };
  }

  private chooseWaveModifier(snapshot: WaveModifierSnapshot): void {
    this.state.wave.waveModifier.active = snapshot;
    this.state.wave.waveModifier.choiceForNextWave = null;
    this.state.wave.waveModifier.wavesRemaining = this.mutatorDuration();
    this.state.wave.waveModifier.wavesCleared = 0;
    // Snapshot gold earned so far — the modifier's gold multiplier bonus
    // is computed from gold earned during the wave and awarded on wave_cleared.
    this.state.wave.waveModifier.goldSnapshot = this.state.stats.goldEarned;
    // Apply non-stateful multipliers now so that the upcoming startWave()
    // uses the correct enemy count and the active enemies spawned during
    // this intermission window would (if any) carry the new speeds.
    const e = snapshot.effects;
    this.waveMgr.setEnemyCountMult(e.countMult);
    this.enemyMgr.setSpeedMult(e.speedMult);
    this.enemyMgr.setDamageToTowerMult(e.damageToTowerMult);
    this.enemyMgr.setHPMult(e.hpMult);
    // Recompute tower stats so the new wave starts with the modifier's
    // playerDamageMult / goldAdditive baked in.
    this.applyUpgradeEffects();
    this.bus.emit('wave_modifier_chosen', {
      id: snapshot.id,
      name: snapshot.name,
      reward: snapshot.reward,
    });
    this.bus.emit('toast', {
      kind: 'milestone',
      text: `${snapshot.name} active for ${this.mutatorDuration()} waves`,
      life: 4,
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // Tower cores (plan §6)
  // ────────────────────────────────────────────────────────────────────────

  get cores(): CoreManager {
    return this.coreMgr;
  }

  /** The run's core id — read by the Stats panel and the in-browser harness. */
  get coreId(): CoreId {
    return this.coreMgr.current;
  }

  /**
   * Whether the run-start picker has a question worth asking.
   *
   * `CoreManager.isPickerAvailable` owns §6.2's two conditions (the player has
   * ascended at least once, and owns more than one core); this adds the third,
   * which is about the modal rather than the content — do not stack a second
   * modal on top of one that is already open.
   */
  isCorePickerDue(): boolean {
    if (this.corePicker.isVisible()) return false;
    return this.coreMgr.isPickerAvailable(this.state.stats.lifetimeAscensions);
  }

  /**
   * Open the picker if one is due. Called from the run-summary dismissal, which
   * is what makes the debrief's CTA the picker rather than a second prompt.
   */
  openCorePickerIfDue(): boolean {
    if (!this.isCorePickerDue()) return false;
    this.showCorePicker();
    return true;
  }

  private showCorePicker(): void {
    this.corePicker.show(
      {
        // Unlocked cores only — the picker is a choice between what the run
        // can be, and a core that is not owned is not one of those choices.
        // `isPickerAvailable` guarantees at least two make the list.
        cores: CORES.filter(def => this.coreMgr.isUnlocked(def.id)).map(def => ({
          def,
          current: this.coreMgr.current === def.id,
        })),
        startWave: this.waveMgr.currentWave,
        timeoutSeconds: CORE_PICKER_TIMEOUT_SECONDS,
      },
      {
        onSelect: (id) => this.selectCore(id),
        onDismiss: () => this.closeCorePicker(),
      },
    );
  }

  /**
   * Run a core for the rest of this run.
   *
   * Public because the in-browser harness uses it. In the game itself the only
   * caller is the run-start picker: the active core changes on a run restart,
   * never mid-run.
   */
  selectCore(id: CoreId | string): boolean {
    if (!isCoreId(id)) return false;
    if (!this.coreMgr.select(id)) return false;
    this.corePicker.hide();
    this.state.cores = this.coreMgr.snapshot();
    // A core is an input to the same recompute as everything else, so the
    // choice is felt on the very next shot.
    this.applyUpgradeEffects();
    this.syncUiApis();
    this.saveMgr.requestSave();
    this.bus.emit('toast', {
      kind: 'milestone',
      text: `${CORE_BY_ID[id].name}: ${CORE_BY_ID[id].tagline}`,
      life: 4,
    });
    return true;
  }

  /** Buy a core with AP. Permanent — an ascension never takes it back. */
  unlockCore(id: CoreId | string): boolean {
    if (!isCoreId(id)) return false;
    if (!this.prestigeMgr.spendOnCore(id, this.coreMgr.isUnlocked(id))) return false;
    this.coreMgr.unlock(id);
    this.state.cores = this.coreMgr.snapshot();
    this.syncUiApis();
    this.saveMgr.save(this.state);
    this.bus.emit('toast', {
      kind: 'milestone',
      text: `${CORE_BY_ID[id].name} unlocked. Choose it at the start of a run.`,
      life: 5,
    });
    return true;
  }

  /** The core snapshot the Prestige panel renders (plan §6.2). */
  corePanelState(): CorePanelState {
    return {
      selected: this.coreMgr.current,
      unlocked: this.coreMgr.unlockedIds(),
      pickerAvailable: this.coreMgr.isPickerAvailable(this.state.stats.lifetimeAscensions),
    };
  }

  private closeCorePicker(): void {
    this.corePicker.hide();
    this.state.cores = this.coreMgr.snapshot();
  }

  // ────────────────────────────────────────────────────────────────────────
  // Blessings (plan §1)
  // ────────────────────────────────────────────────────────────────────────

  get blessings(): BlessingManager {
    return this.blessingMgr;
  }

  /**
   * Auto-pick is forced whenever the player has demonstrably stopped watching:
   * once auto-buy is unlocked the run is an idle run, and a modal that waits
   * for a click would silently cap progress at the next draft.
   */
  private blessingAutoPickForced(): boolean {
    return this.prestigeMgr.isAutomationUnlocked('autoBuy');
  }

  private blessingAutoPickActive(): boolean {
    return this.autoPickBlessings || this.blessingAutoPickForced();
  }

  /** Player preference; the forced cases override it upward, never downward. */
  setAutoPickBlessings(enabled: boolean): void {
    this.autoPickBlessings = enabled;
    writeAutoPickPreference(enabled);
    this.syncUiApis();
  }

  isAutoPickBlessings(): boolean {
    return this.blessingAutoPickActive();
  }

  isAutoPickBlessingsForced(): boolean {
    return this.blessingAutoPickForced();
  }

  /**
   * Decide whether clearing `cleared` earns a draft, and open one if so.
   *
   * The draft pauses **only** the intermission timer — spawning, projectiles,
   * enemies and abilities all keep running underneath it. Every exit path
   * (`chooseBlessing`, `skipBlessing`, the auto-pick) goes through
   * `closeBlessingDraft`, which owns the un-pause, so the obligation
   * `docs/wave-modifier-system.md` spells out cannot be forgotten at one of
   * four call sites.
   */
  private maybeOfferBlessingDraft(cleared: number): void {
    if (this.blessingModal.isVisible()) return;
    if (!this.blessingMgr.isDraftDue(cleared)) return;
    const offer = this.blessingMgr.openDraft(cleared, this.coreMgr.current);
    if (offer.length === 0) {
      // Everything eligible is maxed — close it out silently rather than
      // pausing the run for an empty picker.
      this.blessingMgr.skip();
      return;
    }
    this.waveMgr.pauseIntermission();
    this.state.blessings = this.blessingMgr.snapshot();
    this.showBlessingDraft(cleared);
  }

  private showBlessingDraft(wave: number): void {
    const auto = this.blessingAutoPickActive();
    this.blessingModal.show(
      {
        wave,
        offers: this.blessingMgr.offer,
        held: this.blessingMgr.heldList(),
        picksTaken: this.blessingMgr.picks,
        maxPicks: BLESSING_MAX_PICKS,
        rerolls: this.blessingMgr.rerollsAvailable,
        autoPick: auto,
        autoPickForced: this.blessingAutoPickForced(),
        timeoutSeconds: auto ? BLESSING_AUTO_PICK_SECONDS : BLESSING_SAFETY_TIMEOUT_SECONDS,
      },
      {
        onChoose: (id) => this.chooseBlessing(id),
        onSkip: () => this.skipBlessing(),
        onReroll: () => this.rerollBlessings(),
        onAutoPick: () => this.autoPickBlessing(),
        onToggleAutoPick: (enabled) => this.setAutoPickBlessings(enabled),
      },
    );
  }

  /** Take a blessing and resume the intermission clock. */
  chooseBlessing(id: string): boolean {
    const def: BlessingDef | undefined = BLESSING_BY_ID[id];
    const ok = this.blessingMgr.choose(id);
    this.closeBlessingDraft();
    if (!ok || !def) return false;
    this.state.watch.counters.blessingPicks += 1;
    const stacks = this.blessingMgr.stacks(id);
    // A blessing is an input to the same recompute as everything else, so the
    // pick is felt on the very next shot rather than at the next purchase.
    this.applyUpgradeEffects();
    this.syncUiApis();
    this.saveMgr.requestSave();
    this.bus.emit('toast', {
      kind: 'milestone',
      text: `Blessing: ${def.name}${stacks > 1 ? ` ×${stacks}` : ''} — ${describeBlessing(def, stacks)}`,
      life: 4,
    });
    return true;
  }

  /** Spend a reroll and redraw. Leaves the draft open. */
  rerollBlessings(): boolean {
    const wave = this.blessingMgr.offerWave;
    if (wave === null) return false;
    const rolled = this.blessingMgr.reroll(this.coreMgr.current);
    if (!rolled) return false;
    this.state.blessings = this.blessingMgr.snapshot();
    this.showBlessingDraft(wave);
    return true;
  }

  /** Decline the offer. No pick is spent; the run continues. */
  skipBlessing(): void {
    this.blessingMgr.skip();
    this.closeBlessingDraft();
    this.bus.emit('toast', { kind: 'info', text: 'Blessing declined.', life: 2.5 });
  }

  /**
   * Resolve an unattended draft by taking the highest-weight offer.
   *
   * Highest weight means the *commonest* card, which is deliberate: those are
   * the plain stat gains with no trade-off attached, and an unattended run
   * should not be handed Glass Cannon.
   */
  private autoPickBlessing(): void {
    const offers = this.blessingMgr.offer;
    if (offers.length === 0) {
      this.skipBlessing();
      return;
    }
    let best = offers[0];
    for (const def of offers) {
      if (def.weight > best.weight) best = def;
    }
    this.chooseBlessing(best.id);
  }

  /**
   * The single un-pause point. Every way out of the draft goes through here,
   * which is what keeps the intermission from staying frozen after a modal is
   * dismissed by a path nobody thought about.
   */
  private closeBlessingDraft(): void {
    this.blessingModal.hide();
    this.waveMgr.resumeIntermission();
    this.state.blessings = this.blessingMgr.snapshot();
  }

  // ── The Long Watch (plans/milestones.md §4) ─────────────────────────────
  //
  // The seven lifetime counters and the per-poll metrics snapshot. The
  // manager itself is not constructed here yet — that lands in Step 6
  // (plan §5) along with the unlock consumer wiring. For now the helpers
  // are pure writers so the per-site changes are minimal and reversible.

  /** One lifetime per-type kill. Called from the `enemy_killed` handler. */
  private noteWatchKill(type: EnemyType): void {
    const byType = this.state.watch.counters.killsByType;
    byType[type] = (byType[type] ?? 0) + 1;
  }

  /**
   * The three wave-scoped Watch counters, from the one `wave_cleared` handler.
   *
   * Deliberately reads the same two facts the contract note reads — the
   * flawless flag and the mutator flag — at the same point in the handler, so
   * a wave can never be flawless for a contract and not for a chapter.
   */
  private noteWatchWave(): void {
    const c = this.state.watch.counters;
    if (this.waveFlawless) c.flawlessWaves += 1;
    if (this.state.wave.waveModifier.active !== null) c.mutatorWaves += 1;
    // Every wave is bucketed, risk 0 included, so `riskWaves` is a complete
    // histogram. `risk_waves` objectives simply never ask for index 0. The
    // `riskWaves` array is sized to `MAX_RISK_CEILING + 1`, so a `maxRisk()`
    // of 7 still writes in-bounds (plans/milestones.md §5.5).
    const risk = clampRisk(this.pacingMgr.activeRisk, this.maxRisk());
    c.riskWaves[risk] = (c.riskWaves[risk] ?? 0) + 1;
  }

  /**
   * The flat snapshot `WatchManager` reads once a second.
   *
   * Most fields are read-throughs into `state.stats`; the seven `WatchCounters`
   * are surfaced directly because the manager owns progress computation
   * against the closed `WATCH_PROGRESS` record. Cheap to build: this runs
   * once a poll, not per frame.
   *
   * Non-`private` so the `WatchManager` dep closure (`metrics: () => this.watchMetrics()`)
   * can call it through `this` without a `private`-method suppression comment —
   * the closure is constructed in Step 6 (plan §5) when the manager is wired.
   */
  watchMetrics(): WatchMetrics {
    const s = this.state.stats;
    const c = this.state.watch.counters;
    return {
      highestWave: s.lifetimeHighestWave,
      kills: s.enemiesKilled,
      killsByType: c.killsByType,
      bosses: s.bossesKilled,
      goldEarned: s.goldEarned,
      ascensions: s.lifetimeAscensions,
      transcendences: s.transcendences,
      abilitiesCast: s.abilitiesCast,
      upgradesBought: s.totalUpgradesPurchased,
      towerLevel: this.state.towerXp.level,
      blessingPicks: c.blessingPicks,
      contractsDone: c.contractsDone,
      flawlessWaves: c.flawlessWaves,
      swiftBosses: c.swiftBosses,
      riskWaves: c.riskWaves,
      mutatorWaves: c.mutatorWaves,
    };
  }

  /**
   * The view model the Journal tab consumes (plan §6.2).
   *
   * Walks `WATCH_CHAPTERS` once with a single `watchMetrics()` snapshot at the
   * top — the panel polls at ~10 Hz and per-goal snapshots would be 36 wasted
   * metric builds. Locked chapters still fill in their goals: the counters are
   * lifetime, and "you are already 60% of the way into chapter 7" is exactly
   * the pull the panel exists to surface.
   *
   * `activeIndex` is the index of the live chapter in `chapters`, or -1 once
   * every chapter is complete.
   */
  watchInfo(): WatchInfo {
    const m = this.watchMetrics();
    const completedSet = new Set(this.state.watch.completed);
    const chapters: WatchChapterView[] = WATCH_CHAPTERS.map((ch) => {
      const unlock = WATCH_UNLOCKS[ch.reward];
      let state: WatchChapterView['state'];
      if (completedSet.has(ch.id)) state = 'done';
      else if (this.watchMgr.activeChapter?.id === ch.id) state = 'active';
      else state = 'locked';
      const goals: WatchChapterView['goals'] = ch.goals.map((goal) => {
        const target = goalTarget(goal);
        const current = this.watchMgr.progress(goal, m);
        const capped = Math.min(target, current);
        return {
          label: describeGoal(goal),
          progress: `${capped.toLocaleString()} / ${target.toLocaleString()}`,
          fill: this.watchMgr.fill(goal, m),
          met: this.watchMgr.isGoalMet(goal, m),
        };
      });
      return {
        id: ch.id,
        number: ch.number,
        name: ch.name,
        flavour: ch.flavour,
        icon: ch.icon,
        color: ch.color,
        state,
        goals,
        reward: {
          id: unlock.id,
          name: unlock.name,
          description: unlock.description,
          icon: unlock.icon,
        },
      };
    });
    const activeIdx = chapters.findIndex((c) => c.state === 'active');
    return {
      chapters,
      completed: this.watchMgr.completedCount,
      total: WATCH_CHAPTERS.length,
      activeIndex: activeIdx,
    };
  }

  /**
   * The mastery track surfaced in the codex enemy detail pane (plan §7.1).
   *
   * Walks `WATCH_CHAPTERS` once with a single `watchMetrics()` snapshot at the
   * top and groups every `kills_of` goal under the enemy it names. Chapters
   * with no `kills_of` goal contribute nothing; types nobody names are simply
   * absent from the record, so the codex can render an empty section simply
   * by reading `entry.watch` (which the caller derives from this map).
   *
   * The view is sorted by chapter order so the masteries a player unlocks
   * first stay on top; "Blood and Iron" precedes "Storm Caller" no matter
   * which one the player happens to be hunting.
   */
  watchEnemyLines(): Partial<Record<EnemyType, EnemyWatchLine[]>> {
    const m = this.watchMetrics();
    const out: Partial<Record<EnemyType, EnemyWatchLine[]>> = {};
    for (const ch of WATCH_CHAPTERS) {
      for (const goal of ch.goals) {
        if (goal.kind !== 'kills_of') continue;
        const target = goalTarget(goal);
        const current = Math.min(target, this.watchMgr.progress(goal, m));
        const line: EnemyWatchLine = {
          chapterName: ch.name,
          progress: `${current.toLocaleString()} / ${target.toLocaleString()}`,
          fill: Math.min(1, Math.max(0, this.watchMgr.fill(goal, m))),
          met: this.watchMgr.isGoalMet(goal, m),
        };
        (out[goal.type] ??= []).push(line);
      }
    }
    return out;
  }

  /**
   * Perform the side effect of an unlock, if it has one.
   *
   * Idempotent by construction: `CoreManager.unlock` is a `Set.add`. Called
   * once on the completion event and once per earned unlock on save load, so
   * the granted cores can never drift from the completed chapters
   * (plans/milestones.md §5.1).
   */
  private applyWatchUnlock(id: WatchUnlockId): void {
    switch (id) {
      case 'cold_forge':
        this.coreMgr.unlock('frostwork');
        this.state.cores = this.coreMgr.snapshot();
        break;
      case 'sanctum':
        this.coreMgr.unlock('arcane');
        this.state.cores = this.coreMgr.snapshot();
        break;
      default:
        // Every other unlock is read by its consumer through `watchMgr.has()`;
        // there is nothing to perform. Listed exhaustively rather than
        // defaulted so a new unlock forces a decision here.
        break;
    }
  }

  /** Replay every earned unlock's side effect. Called at the end of save load. */
  private applyWatchUnlocksOnLoad(): void {
    this.watchMgr.rebuildUnlocks();
    for (const id of this.watchMgr.earnedUnlocks()) this.applyWatchUnlock(id);
  }

  /**
   * The risk dial's ceiling, including Watch unlocks (plans/milestones.md §5.5).
   *
   * `riskbearer` adds a sixth step, `deep_watch` adds a seventh. Read by the
   * UI (`pacingHudSnapshot`) and by the `PacingManager` provider so the
   * 6-or-7 cap is enforced everywhere a level is written or read.
   */
  maxRisk(): number {
    if (this.watchMgr.has('deep_watch')) return 7;
    if (this.watchMgr.has('riskbearer')) return 6;
    return MAX_RISK;
  }

  /**
   * Waves a mutator runs for, including the Storm Caller unlock.
   *
   * The Watch's `storm_caller` chapter (plans/milestones.md §5.7) adds one
   * wave to the run, so a single helper reads in one place rather than every
   * site hardcoding `MUTATOR_DURATION_WAVES + 1`.
   */
  private mutatorDuration(): number {
    return MUTATOR_DURATION_WAVES + (this.watchMgr.has('storm_caller') ? 1 : 0);
  }

  /**
   * Splinter: a kill throws two shards at the nearest survivors.
   *
   * Applied as direct damage rather than as projectiles so the reentrancy
   * guard can be airtight — `EnemyManager.damage` emits `enemy_killed`
   * synchronously, and shards that spawn shards would cascade without bound in
   * a dense wave.
   */
  private fireSplitShards(x: number, y: number): void {
    if (this.splitOnKillActive) return;
    const ts = this.tower.snapshot;
    const damage = Math.max(1, Math.floor(ts.baseDamage * BLESSING_TUNING.splitShardDamage));
    const candidates = this.enemyMgr
      .queryRadius(x, y, BLESSING_TUNING.splitShardRange)
      .filter(e => e.alive)
      .slice(0, BLESSING_TUNING.splitShardCount);
    if (candidates.length === 0) return;
    this.splitOnKillActive = true;
    try {
      for (const target of candidates) {
        this.effects.emitHitSparks(target.x, target.y, lighten(FX.frost, 0.3), 4);
        this.enemyMgr.damage(target, damage, false);
        this.bus.emit('tower_damage_dealt', { amount: damage });
      }
    } finally {
      this.splitOnKillActive = false;
    }
  }

  private skipWaveModifier(): void {
    this.state.wave.waveModifier.active = null;
    this.state.wave.waveModifier.choiceForNextWave = null;
    this.state.wave.waveModifier.pendingChoiceForWave = null;
    this.state.wave.waveModifier.wavesRemaining = 0;
    this.state.wave.waveModifier.wavesCleared = 0;
    this.bus.emit('toast', {
      kind: 'info',
      text: 'Skipped mutator this wave.',
      life: 2.5,
    });
  }

  private applyFullTranscendenceReset(): void {
    this.automation.reset();
    // Passives are progression *inside* one transcendence cycle: they survive
    // every Ascension (that is what makes an ascension cheap to take) and are
    // wiped here, alongside the AP layer they were bought with. Equipment is
    // not — gear is a slow, low-drop-rate collection, and deleting it at the one
    // moment the player is asked to give everything else up made transcending
    // read as a punishment.
    this.applySavedStateReset();
    this.passiveMgr.reset();
    this.state.prestige.apSpent = {};
    this.state.prestige.automationFlags = {
      autoBuy: false,
      autoAbilities: false,
      autoAscend: false,
      autoTranscend: false,
    };
    this.state.resources.ascensionPoints = 0;
    this.state.resources.apThisTranscendence = 0;
    this.state.stats.ascensions = 0;
  }

  private applyPersistedState(persisted: PersistentState): void {
    const r = this.state.resources;
    r.gold = persisted.resources.gold;
    r.mana = persisted.resources.mana;
    r.maxMana = persisted.resources.maxMana;
    r.manaRegen = persisted.resources.manaRegen;
    r.ascensionPoints = persisted.resources.ascensionPoints;
    r.apThisTranscendence = persisted.resources.apThisTranscendence;
    r.transcendencePoints = persisted.resources.transcendencePoints ?? 0;
    r.lifetimeAP = persisted.resources.lifetimeAP ?? 0;
    r.lifetimeGold = persisted.resources.lifetimeGold;

    const s = this.state.stats;
    s.enemiesKilled = persisted.stats.enemiesKilled;
    s.bossesKilled = persisted.stats.bossesKilled;
    s.goldEarned = persisted.stats.goldEarned;
    s.damageDealt = persisted.stats.damageDealt;
    s.shotsFired = persisted.stats.shotsFired;
    s.lifetimeHighestWave = persisted.stats.lifetimeHighestWave;
    s.abilitiesCast = persisted.stats.abilitiesCast;
    s.ascensions = persisted.stats.ascensions;
    s.lifetimeAscensions = persisted.stats.lifetimeAscensions ?? 0;
    s.transcendences = persisted.stats.transcendences;
    s.totalUpgradesPurchased = persisted.stats.totalUpgradesPurchased ?? 0;
    s.startedAt = persisted.stats.startedAt;
    s.runStartedAt = persisted.stats.runStartedAt ?? persisted.runStartedAt ?? persisted.stats.startedAt;

    this.state.achievements = [...((persisted as any).achievements ?? [])];
    this.state.runHistory = Array.isArray(persisted.runHistory) ? [...persisted.runHistory] : [];
    this.state.runStartedAt = persisted.runStartedAt ?? s.runStartedAt;
    // Seed lifetime "best run" tracking from the saved history (best so far).
    this.bestGoldRun = 0;
    this.bestWaveRun = 1;
    for (const r of this.state.runHistory) {
      if (r.goldEarned > this.bestGoldRun) this.bestGoldRun = r.goldEarned;
      if (r.highestWave > this.bestWaveRun) this.bestWaveRun = r.highestWave;
    }

    this.state.upgrades = { ...persisted.upgrades };
    this.migrateUpgrades(this.state.upgrades);
    this.state.research = { ...(persisted.research ?? {}) };
    this.researchTree.replaceLevels(
      this.state.research,
      persisted.rp ?? 0,
      persisted.researchInProgress ?? null,
    );
    this.state.researchInProgress = persisted.researchInProgress ?? null;

    const p = this.state.prestige;
    p.apSpent = { ...persisted.prestige.apSpent };
    p.tpSpent = { ...(persisted.prestige.tpSpent ?? {}) };
    p.automationFlags = persisted.prestige.automationFlags ?? {
      autoBuy: false,
      autoAbilities: false,
      autoAscend: false,
      autoTranscend: false,
    };
    p.targetAscendWave = persisted.prestige.targetAscendWave ?? DEFAULT_AUTO_ASCEND_WAVE;
    p.autoCastEnabled = { ...(persisted.prestige.autoCastEnabled ?? {}) };
    p.autoBuyStrategy = persisted.prestige.autoBuyStrategy ?? 'balanced';
    p.autoBuyReserve = persisted.prestige.autoBuyReserve ?? 0;

    this.state.wave = { ...persisted.wave };
    this.waveMgr.setState(this.state.wave);

    this.state.abilities = {};
    for (const id of Object.keys(persisted.abilities)) {
      const a = persisted.abilities[id];
      this.state.abilities[id] = { level: a.level, cooldown: 0, active: false, activeTimer: 0, xp: a.xp ?? 0 };
    }
    for (const def of ABILITIES) {
      if (!this.state.abilities[def.id]) {
        this.state.abilities[def.id] = { level: 1, cooldown: 0, active: false, activeTimer: 0, xp: 0 };
      }
    }

    const t = this.tower.snapshot;
    t.x = persisted.tower.x;
    t.y = persisted.tower.y;
    t.cooldown = 0;
    t.damageType = persisted.tower.damageType;
    // Migration: old saves stored 'first', a dead alias that behaved identically
    // to 'nearest'. Gameplay plan §2.3 deleted the mode; a save carrying it keeps
    // the behaviour it actually had rather than being silently moved to the new
    // 'priority' default, which would change how an existing run plays.
    const persistedMode = persisted.tower.targetingMode as string;
    const validModes: TargetingMode[] = ['priority', 'nearest', 'lowest_hp', 'strongest', 'boss', 'flying', 'last'];
    t.targetingMode = persistedMode === 'first'
      ? 'nearest'
      : (validModes as string[]).includes(persistedMode)
        ? (persistedMode as TargetingMode)
        : TOWER_BASE.targetingMode;
    t.hp = persisted.tower.hp ?? TOWER_BASE.hp;
    t.maxHp = persisted.tower.maxHp ?? TOWER_BASE.maxHp;
    t.wallHp = persisted.tower.wallHp ?? 0;
    t.wallMaxHp = persisted.tower.wallMaxHp ?? 0;

    this.upgradeMgr.replaceLevels(this.state.upgrades);
    this.abilityMgr.reset();

    // v6+: Restore RPG state
    Object.assign(this.state.towerXp, persisted.towerXp ?? { xp: 0, level: 1, unspentTalentPoints: 1, totalXpEarned: 0 });
    this.state.talents.allocated = { ...(persisted.talents?.allocated ?? {}) };

    // Clear and repopulate passiveAbilities (manager holds reference)
    const pa = this.state.passiveAbilities;
    for (const k of Object.keys(pa)) delete pa[k];
    if (persisted.passiveAbilities) {
      for (const [id, v] of Object.entries(persisted.passiveAbilities)) {
        pa[id] = { level: v.level, xp: v.xp, unlocked: v.unlocked ?? false };
      }
    }
    this.passiveMgr.ensureInitialized();

    // Clear and repopulate equipment (manager holds reference)
    this.state.equipment.length = 0;
    if (persisted.equipment) {
      for (const eq of persisted.equipment) {
        // Pre-feature items have no `seen` flag: default to seen so upgrading
        // a save doesn't mark the whole inventory as NEW.
        this.state.equipment.push({ ...eq, stats: [...eq.stats], seen: eq.seen !== false });
      }
    }

    // v10+: the run's blessings. `restore` drops any draft that was open when
    // the save was written — the offer itself is not persisted, and rolling a
    // fresh one on load would hand back a different choice than the player was
    // looking at.
    this.blessingMgr.restore(persisted.blessings ?? null);
    this.state.blessings = this.blessingMgr.snapshot();

    // v11+: boss rewards banked this run. The encounter itself is not
    // persisted — see `BossRunState` — so a load that lands mid-boss-wave
    // clears the wave rather than resuming a boss with no phase state.
    this.state.bossRun = {
      apBonusPct: persisted.bossRun?.apBonusPct ?? 0,
      swiftKills: persisted.bossRun?.swiftKills ?? 0,
      flawlessKills: persisted.bossRun?.flawlessKills ?? 0,
    };
    this.bossEncounter = null;
    this.waveFlawless = true;
    this.prestigeMgr.setRunApBonus(this.state.bossRun.apBonusPct, 'boss');

    // v12+: the run's contracts. Unlike the blessing *offer*, live slots are
    // persisted in full — a contract is not a choice, so there is nothing that
    // re-rolling on load would silently take away. `restore` refills any slot
    // whose def no longer exists, which is also what gives a pre-v12 save its
    // first three contracts.
    this.contractMgr.restore(persisted.contracts ?? null);
    this.state.contracts = this.contractMgr.snapshot();
    this.prestigeMgr.setRunApBonus(this.contractMgr.apBonusPct, 'contract');

    // v13+: unlocked cores (permanent) and the run's selection (run-scoped).
    // A save that predates cores restores as `marksman`, which is what every
    // pre-v13 tower was actually shooting like.
    this.coreMgr.restore(persisted.cores ?? null);
    this.state.cores = this.coreMgr.snapshot();

    // v15+: The Long Watch (plans/milestones.md §5.0). Restore the unlock set
    // *and* replay every earned unlock's side effect — the cold forge must
    // grant `frostwork` on a v15+ load even though `coreMgr.restore` is the
    // canonical source for the previously-unlocked cores.
    this.applyWatchUnlocksOnLoad();

    // v14+: the risk dial (permanent), momentum and the combo (run-scoped).
    // A save that predates pacing restores at risk 0 with nothing banked,
    // which is exactly the curve it was playing.
    this.pacingMgr.restore(persisted.pacing ?? null);
    this.state.pacing = this.pacingMgr.snapshot();
    this.prestigeMgr.setRiskApBonus(riskApBonus(this.pacingMgr.activeRisk));
    this.pacingStatSignature = -1;

    // Clear and repopulate equipped (manager holds reference)
    const eqMap = this.state.equipped;
    for (const k of Object.keys(eqMap)) delete (eqMap as Record<string, Equipment>)[k];
    if (persisted.equipped) {
      for (const [slot, eq] of Object.entries(persisted.equipped)) {
        if (eq && typeof eq !== 'string') {
          (eqMap as Record<string, Equipment>)[slot] = eq;
        }
      }
    }
  }

  private loop = (): void => {
    if (!this.running) return;
    const now = performance.now();
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > 0.05) dt = 0.05;

    const speed = this.getSpeed();
    // Apply slow-mo factor on top of user speed (does not replace it)
    let slowMo = 1;
    if (this.slowMoRemaining > 0) {
      this.slowMoRemaining = Math.max(0, this.slowMoRemaining - dt);
      const t = this.slowMoTotal > 0 ? 1 - this.slowMoRemaining / this.slowMoTotal : 1;
      // Ramp from 0.3 (entry) or 0.2 (death) up to 1.0
      const startFactor = this.slowMoTotal <= 0.35 ? 0.2 : 0.3;
      slowMo = startFactor + t * (1 - startFactor);
    }
    if (this.screenFlash > 0) {
      this.screenFlash = Math.max(0, this.screenFlash - dt);
    }
    if (this.towerFlash > 0) {
      this.towerFlash = Math.max(0, this.towerFlash - dt);
    }
    if (this.wallFlash > 0) {
      this.wallFlash = Math.max(0, this.wallFlash - dt);
    }
    if (this.shieldFlash > 0) {
      this.shieldFlash = Math.max(0, this.shieldFlash - dt);
    }
    const gameDt = dt * speed * slowMo;
    if (!this.runFailed) this.update(gameDt, dt);
    // Wall-clock systems run whether or not the simulation is paused for the
    // run-over prompt: research continues to progress, the modal's
    // auto-resolve countdown keeps moving, and the player's saved state stays
    // current. See `tickWallClockSystems` for what is and isn't included.
    this.tickWallClockSystems(dt);
    this.draw();
    this.state.wave = this.waveMgr.snapshot;
    this.ui.update(this.state);

    this.rafId = requestAnimationFrame(this.loop);
  };

  /**
   * @param dt      simulation delta (scaled by game speed and slow-mo)
   * @param realDt  wall-clock delta, for systems that must not speed up with
   *                the game (real-time research timers, auto-save cadence)
   */
  private update(dt: number, realDt: number): void {
    // Plan §5.2: the simulation runs in fixed substeps. `dt` here can reach
    // 0.05 s (the frame-hitch clamp) times 6.5 (max Accelerator speed) =
    // 0.325 s, and a single step that long makes enemy movement, attack
    // cadence and projectile travel wrong in ways the player reads as the
    // game cheating. Substepping makes high speed cost what it should — more
    // simulation — instead of quietly producing a different, coarser game.
    const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dt / FIXED_STEP)));
    const step = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.simulate(step);
    }
    this.frameUpdate(dt, realDt);
  }

  /**
   * One fixed simulation substep: waves, combat, movement, projectiles, mines.
   *
   * Everything here is time-integrated or cadence-driven, so it has to see the
   * small step. Presentation and bookkeeping live in `frameUpdate`, which runs
   * once per frame with the full delta.
   */
  private simulate(dt: number): void {
    // Buffs age on the simulation clock, and a buff that started or expired
    // means the whole stat block is restated — once, here, rather than by each
    // system poking at `TowerState`.
    this.buffs.tick(dt);
    this.refreshBuffedStats();
    this.refreshHpThresholdStats();
    // Juggernaut immunity timer.
    if (this.juggernautImmunity > 0) {
      this.juggernautImmunity = Math.max(0, this.juggernautImmunity - dt);
    }
    // Plan §7.2: the combo window is a **simulation**-clock quantity. Kills are
    // simulation events, so the interval between two of them is simulation
    // time; on the wall clock a 2 s window would be 0.3 s at 6.5x speed and no
    // combo would ever chain. Contrast the two timers that deliberately run on
    // `realDt` in `frameUpdate` — the draft countdown and the charge hold —
    // both of which measure a person rather than the field.
    this.pacingMgr.tickCombo(dt);
    this.refreshPacingStats();

    this.waveMgr.tick(dt);
    // The boss encounter clock is a *simulation* clock (plan §3.7): a swift
    // kill has to mean 30 s of game time, so that 6.5x speed makes the reward
    // easier to hit in wall-clock terms and no easier in game terms.
    if (this.bossEncounter) this.bossEncounter.elapsed += dt;
    this.resourceMgr.tick(dt, this.waveMgr.currentWave);
    this.abilityMgr.tick(dt);

    // Evolution: mana_full_gold — gold bonus while mana is full
    if (this.upgradeMgr.hasEvolutionEffect('mana_full_gold')) {
      if (this.resourceMgr.mana >= this.resourceMgr.state.maxMana) {
        this.manaFullGoldTimer = 5;
      }
      if (this.manaFullGoldTimer > 0) {
        this.manaFullGoldTimer -= dt;
        const bonus = this.upgradeMgr.getEvolutionEffectValue('mana_full_gold');
        this.enemyMgr.setManaFullGoldBonus(bonus);
      } else {
        this.enemyMgr.setManaFullGoldBonus(0);
      }
    }

    const ts = this.tower.snapshot;
    const regenRate = this.tower.effectiveHealthRegen;
    if (ts.hp < ts.maxHp && regenRate > 0) {
      ts.hp = Math.min(ts.maxHp, ts.hp + (ts.maxHp * regenRate) * dt);
    }

    // Talent: Wall Regen — rebuild the outer wall over time.
    if (this.talentWallRegen > 0 && ts.wallMaxHp > 0 && ts.wallHp < ts.wallMaxHp) {
      ts.wallHp = Math.min(ts.wallMaxHp, ts.wallHp + ts.wallMaxHp * this.talentWallRegen * dt);
      if (ts.wallHp > 0) this.enemyMgr.setWallContactExtra(36);
    }

    // Manual aim: holding the mouse aims at the cursor. It carries no fire-rate
    // bonus — see the note in MANUAL_AIM. Holding costs you auto-targeting and
    // pays in the charged shot, so it is a trade rather than a tax.
    if (this.mouseDown) {
      this.tower.setAimTarget(this.mouseX, this.mouseY);
    }

    if (this.tower.tickCooldown(dt)) {
      const target = this.mouseDown ? null : this.tower.acquireTarget(this.enemyMgr.list);

      if (this.mouseDown || target) {
        const shot = this.tower.rollShot();
        const variants = this.buildShotVariants();

        // Talent: Barrage — chance for one extra projectile in this volley.
        if (this.talentExtraProjectileChance > 0 && Math.random() < this.talentExtraProjectileChance) {
          variants.push({ posOffsetX: 0, posOffsetY: -12 });
        }

        // Talent: Enchant Weapons — chance for the volley to land as magic
        // damage, which is resisted by magicResist instead of flat armor.
        const shotDamageType = this.talentMagicProcChance > 0 && Math.random() < this.talentMagicProcChance
          ? 'magic'
          : ts.damageType;

        // Evolution: double_shot — every Nth shot fires double
        if (this.upgradeMgr.hasEvolutionEffect('double_shot')) {
          this.shotCounter += 1;
          const interval = this.upgradeMgr.getEvolutionEffectValue('double_shot');
          if (this.shotCounter % interval === 0) {
            variants.push({ posOffsetX: 0, posOffsetY: 12 });
          }
        }

        // Quick shot chance — activate temporary 2x fire rate
        if (ts.quickShotTime > 0 && Math.random() < ts.quickShotChance) {
          this.buffs.set({
            id: BUFF_QUICK_SHOT,
            stat: 'fireRate',
            kind: 'mult',
            value: QUICK_SHOT_FIRE_RATE,
            label: 'Quick shot',
            remaining: ts.quickShotTime,
          });
        }

        // Blessing: Mortar Round — every 8th shot leaves as a shell. The
        // cadence is counted here, in the fixed substep, so it does not drift
        // with frame rate or game speed.
        let mortarShot = false;
        if (this.blessingMgr.has('mortar')) {
          this.mortarShotCounter += 1;
          mortarShot = this.mortarShotCounter % BLESSING_TUNING.mortarInterval === 0;
        }
        // Core: what this shot does (plan §6.1). The cadence lives in
        // `CoreManager` so it advances in the fixed substep, exactly like the
        // mortar's, and so it can be driven from a test without a canvas.
        const corePlan = this.coreMgr.planShot(
          (amount) => this.resourceMgr.spendMana(amount),
        );
        // Blessing: Seeker Shots — the shot does its own targeting now, so a
        // clicked volley homes too: the cursor sets the launch heading,
        // `HOMING.manualDelay` holds it long enough to read as "it went where I
        // pointed", and then the shot hunts the nearest enemy from wherever it
        // has got to. `target` is null while the mouse is down, which is
        // exactly the case that used to be excluded here.
        const homing = this.blessingMgr.has('homing');
        const shotDamage = (mortarShot
          ? shot.damage * BLESSING_TUNING.mortarDamageMult
          : shot.damage) * corePlan.damageMult;
        // Artillery's blast and the Mortar blessing's are the same channel, so
        // the bigger one wins rather than the two stacking: two splash payloads
        // on one impact is one impact's worth of splash charged twice, which is
        // not what either promises.
        const blessingShot = {
          isHoming: homing,
          homingDelay: this.mouseDown ? HOMING.manualDelay : 0,
          // Plan §9.1: Annihilation is the third source on this one channel,
          // and it composes the same way the other two do — max radius, summed
          // fraction to the cap — rather than re-damaging the enemy from the
          // `enemy_damaged` handler, which fired off a hit the projectile had
          // already resolved and never reached a killing blow's neighbours.
          ...composeShotSplash(
            composeShotSplash(
              {
                splashRadius: mortarShot ? BLESSING_TUNING.mortarRadius : corePlan.splashRadius,
                splashFraction: mortarShot
                  ? BLESSING_TUNING.mortarSplashFraction
                  : corePlan.splashFraction,
              },
              // Revamp §5.2: Fragmenting Arrows is the fourth source on this
              // one channel and composes exactly like the other three.
              this.shotSplash,
            ),
            this.prestigeMgr.hasAoESplash()
              ? {
                splashRadius: TP_AOE_SPLASH_RADIUS,
                splashFraction: this.prestigeMgr.getAoESplashFraction(),
              }
              : {},
          ),
        };
        const resolvedDamageType = corePlan.damageType ?? shotDamageType;

        // Relentless keystone: every Nth shot fires 3 projectiles at reduced damage.
        if (this.talentMgr.hasBehavior('relentless')) {
          this.relentlessCounter += 1;
          if (this.relentlessCounter >= TALENT_TUNING.relentlessShotInterval) {
            this.relentlessCounter = 0;
            const relentlessVariants: ShotVariant[] = [
              { angleOffset: -0.18, damageScale: TALENT_TUNING.relentlessDamage },
              { angleOffset: 0,     damageScale: TALENT_TUNING.relentlessDamage },
              { angleOffset: 0.18,  damageScale: TALENT_TUNING.relentlessDamage },
            ];
            if (variants.length > 1) {
              // Append to existing AP multi-shot variants.
              variants.push(...relentlessVariants);
            } else {
              // Replace the single default variant.
              variants.length = 0;
              variants.push(...relentlessVariants);
            }
          }
        }

        this.projectileMgr.fire(target, ts, {
          rawDamage: shotDamage,
          damageType: resolvedDamageType,
          isCrit: shot.isCrit,
          targetId: target?.id ?? null,
          variants,
          aimX: this.mouseDown ? this.mouseX : undefined,
          aimY: this.mouseDown ? this.mouseY : undefined,
          ...blessingShot,
        });
        this.tower.consumeCooldown();
        this.state.stats.shotsFired += 1;
        this.state.stats.damageDealt += shotDamage;

        // Killing Spree: crit follow-up shot (non-crit, reduced damage).
        if (shot.isCrit && this.critFollowUpChance > 0 && Math.random() < this.critFollowUpChance) {
          this.projectileMgr.fire(target, ts, {
            rawDamage: shotDamage * TALENT_TUNING.critFollowUpDamage,
            damageType: resolvedDamageType,
            isCrit: false,
            targetId: target?.id ?? null,
            variants,
            aimX: this.mouseDown ? this.mouseX : undefined,
            aimY: this.mouseDown ? this.mouseY : undefined,
            ...blessingShot,
          });
        }

        // Double shot chance — fire all projectiles a second time
        if (Math.random() < ts.doubleShotChance) {
          this.projectileMgr.fire(target, ts, {
            rawDamage: shotDamage,
            damageType: resolvedDamageType,
            isCrit: shot.isCrit,
            targetId: target?.id ?? null,
            variants,
            aimX: this.mouseDown ? this.mouseX : undefined,
            aimY: this.mouseDown ? this.mouseY : undefined,
            ...blessingShot,
          });
          this.state.stats.shotsFired += 1;
          this.state.stats.damageDealt += shotDamage;
        }
      }
    }

    // Plan §4.2: the release was recorded by a DOM event; the *shot* happens
    // here, inside the fixed substep, so it travels and collides like any
    // other projectile at every game speed.
    if (this.chargeFirePending) {
      this.chargeFirePending = false;
      this.fireChargedShot();
    }

    this.projectileMgr.tick(dt);
    this.enemyMgr.tick(dt, ts.x, ts.y, ts.range);
    // Orb drift is on the *simulation* clock (plan §4.1): eight game-seconds
    // to come home, whatever speed the player is running.
    this.lootMgr.tick(dt);

    if (ts.shockwaveSize > 0 && ts.shockwaveCooldown > 0) {
      ts.shockwaveTimer -= dt;
      if (ts.shockwaveTimer <= 0) {
        ts.shockwaveTimer = ts.shockwaveCooldown;
        this.enemyMgr.applyShockwave(ts.shockwaveSize, ts.x, ts.y);
        this.effects.emitShockwaveRing(ts.x, ts.y, ts.shockwaveSize);
        // Evolution: shockwave_slow — slow enemies hit by shockwave
        if (this.upgradeMgr.hasEvolutionEffect('shockwave_slow')) {
          const slowAmount = this.upgradeMgr.getEvolutionEffectValue('shockwave_slow');
          this.enemyMgr.applySlow(1 - slowAmount, 2);
        }
      }
    }

    if (ts.landMineDamage > 0 && ts.landMineFrequency > 0) {
      ts.landMineTimer -= dt;
      if (ts.landMineTimer <= 0) {
        ts.landMineTimer = ts.landMineFrequency;
        const angle = Math.random() * Math.PI * 2;
        const minDist = TOWER_HIT_RADIUS + world(45);
        const dist = minDist + Math.random() * Math.max(0, ts.range - minDist);
        const mx = ts.x + Math.cos(angle) * dist;
        const my = ts.y + Math.sin(angle) * dist;
        if (this.mines.length >= 15) {
          this.mines.shift();
        }
        this.mines.push({
          id: nextId(),
          x: mx,
          y: my,
          damage: ts.baseDamage * ts.landMineDamage,
          explosionRadius: world(50),
          alive: true,
          isSplit: false,
        });
      }
    }

    for (let i = this.mines.length - 1; i >= 0; i--) {
      const mine = this.mines[i];
      if (!mine.alive) continue;
      // Trigger set and damage set are the same disc, so one radius query
      // answers both — this used to be a nested scan of the whole enemy list
      // per mine, per frame (plan §5.4).
      // Plan §2.2: mines are on the *ground*. A flying enemy never trips one,
      // and a blinker mid-teleport is not standing where the trigger is — so
      // both are filtered out of the trigger set as well as the damage set.
      const caught = this.enemyMgr
        .queryRadius(mine.x, mine.y, mine.explosionRadius)
        .filter(e => isTargetable(e) && !ignoresGroundEffects(e));
      if (caught.length === 0) continue;
      mine.alive = false;
      for (const target of caught) {
        this.enemyMgr.damage(target, mine.damage, false);
      }
      this.effects.emitMineExplosion(mine.x, mine.y);
      // Evolution: mine_split — spawn child mines on detonation
      if (!mine.isSplit && this.upgradeMgr.hasEvolutionEffect('mine_split')) {
        const count = this.upgradeMgr.getEvolutionEffectValue('mine_split');
        for (let c = 0; c < count; c++) {
          const childAngle = Math.random() * Math.PI * 2;
          const childDist = world(25) + Math.random() * world(25);
          this.mines.push({
            id: nextId(),
            x: mine.x + Math.cos(childAngle) * childDist,
            y: mine.y + Math.sin(childAngle) * childDist,
            damage: mine.damage * 0.5,
            explosionRadius: world(30),
            alive: true,
            isSplit: true,
          });
        }
      }
    }
    this.mines = this.mines.filter(m => m.alive);

    if (ts.shieldMaxCharges > 0 && ts.shieldCurrentCharges < ts.shieldMaxCharges) {
      ts.shieldRechargeTimer -= dt;
      if (ts.shieldRechargeTimer <= 0) {
        ts.shieldRechargeTimer = ts.shieldRechargeTime;
        ts.shieldCurrentCharges = Math.min(ts.shieldMaxCharges, ts.shieldCurrentCharges + 1);
      }
    }
  }

  /**
   * Once-per-frame work: visuals, UI, automation, real-time systems.
   *
   * None of these need substepping — particles and toasts are presentation,
   * automation and achievements are polled rather than integrated, and
   * research and auto-save deliberately run on wall-clock time.
   *
   * @param dt      full simulation delta for this frame (all substeps summed)
   * @param realDt  wall-clock delta
   */
  private frameUpdate(dt: number, realDt: number): void {
    this.ui.setBossBarData(this.bossBarSnapshot());
    // Plan §7: one snapshot per frame, shared by the HUD controls, the pacing
    // overlay and the canvas lane markers, so the three cannot disagree about
    // what the coming wave holds.
    this.pacingHud = this.pacingHudSnapshot();
    this.ui.setPacingData(this.pacingHud);
    this.effects.tick(dt);
    this.effects.tickChainLightning(dt);
    this.notifications.tick(dt);
    this.automation.tick(dt);

    // HUD display tweening (every frame, before throttled UI update)
    this.ui.tickDisplayHud(dt, this.state);
    this.waveModModal.tick(dt);
    // Wall-clock, not simulation time: at 6.5x a 20 s game-time deadline is
    // three real seconds, which is not long enough to read three cards.
    this.blessingModal.tick(realDt);
    this.corePicker.tick(realDt, CORE_BY_ID[this.coreMgr.current].name);
    // Wall-clock too: a screen shake that ran six times faster at 6.5x speed
    // would be a flicker, and one that ran on the simulation clock during a
    // slow-mo boss death would outlast the death.
    this.camera.update(realDt);
    // §5.D: wall clock, so the 1.8 s cinematic is 1.8 s at any speed.
    this.tickBossIntro(realDt);
    // §9.D: wall clock too. The probe must measure the frame time the player
    // will actually live with, not whatever 6.5x a hidden tab rAFs at.
    this.tickQualityProbe(realDt);

    // Plan §4.2, same reasoning: the charge timer measures a person holding
    // still, so it runs on `realDt`. A 1.2 s hold is 1.2 seconds of the
    // player's life at 1x and at 6.5x alike, and the 4 s cooldown is four real
    // seconds rather than 0.6 — which is what keeps the verb from becoming
    // six times stronger the moment the Accelerator is unlocked.
    this.charge.tick(realDt, !this.isPlacing());

    this.checkTranscendenceUnlockToast();
    this.saveMgr.tick(realDt, this.state, (s) => this.saveMgr.save(s));
    this.achievementMgr.tick(dt);
    // The Long Watch polls lifetime counters once a second (plans/milestones.md
    // §5.0). Completion is observed through the bus, not the return value, so
    // the modal, the toast and the unlock share a single source of truth.
    this.watchMgr.tick(dt);
    this.audio.tick(dt);
    this.updateVignette();
  }

  /**
   * Wall-clock systems that must keep ticking even when the simulation is
   * frozen for the run-over prompt. Called from `loop` unconditionally —
   * `if (!this.runFailed) this.update(...)` is the gate that pauses the
   * simulation; this method sits outside it.
   *
   * What lives here:
   *  - The run-failed modal's 20 s countdown must advance on the player's
   *    clock whether or not the wave is still moving.
   *  - Research progress + passive RP gain. Both are real-time systems — they
   *    must not accelerate when the player raises the game speed — and a
   *    player who walks away from the run-over prompt should still come back
   *    to in-progress research, not a frozen one.
   *
   * What deliberately does not: `saveMgr` / `achievementMgr` / `audio` ticks
   * are still inside `update` because the save cadence and achievement audio
   * cues make sense only while the player is engaged with the run, and the
   * auto-save that follows a research completion is already covered by
   * `applyUpgradeEffects` → dirty-state path when the simulation is running.
   *
   * @param realDt  wall-clock delta in seconds (already clamped to 0.05 s)
   */
  private tickWallClockSystems(realDt: number): void {
    // The run-failed modal has its own countdown so a player who walks away
    // comes back to a live game, not a frozen one. Tick it first so an
    // auto-resolve fires before the research block reads state in the same
    // frame. `RunFailedModal` is owned by `UIManager`, so we proxy through it.
    this.ui.tickRunFailedModal(realDt);

    this.researchTree.setSpeedMultiplier(this.prestigeMgr.getResearchSpeedMultiplier());
    this.researchTree.addPassiveRP(
      realDt,
      this.state.stats.lifetimeHighestWave,
      this.rpGainMultiplier(),
    );
    if (this.researchTree.tick(realDt)) {
      this.state.research = this.researchTree.getLevelsSnapshot();
      this.state.researchInProgress = null;
      this.applyUpgradeEffects();
      this.syncUiApis();
    } else {
      this.state.researchInProgress = this.researchTree.inProgress
        ? { ...this.researchTree.inProgress }
        : null;
      this.ui.setResearchAPI({
        rp: this.researchTree.rp,
        levels: this.researchTree.getLevelsSnapshot(),
        unlocked: this.researchTree.unlocked,
        reasonBlocked: (id) => this.researchTree.reasonBlocked(id),
        inProgress: this.researchTree.inProgress,
        researchSpeedMultiplier: this.prestigeMgr.getResearchSpeedMultiplier(),
        rpGainRate: this.researchTree.getPassiveRPRate(
          this.state.stats.lifetimeHighestWave,
          this.rpGainMultiplier(),
        ),
      });
    }
  }

  private checkTranscendenceUnlockToast(): void {
    if (this.transcendenceUnlockedAnnounced) return;
    if (this.prestigeMgr.canTranscend(this.state.resources.apThisTranscendence)) {
      this.transcendenceUnlockedAnnounced = true;
      this.bus.emit('toast', {
        kind: 'milestone',
        text: 'Transcendence available! Open the Prestige tab.',
        life: 6,
      });
    }
  }

  private draw(): void {
    this.renderer.draw({
      tower: this.tower.snapshot,
      enemies: this.enemyMgr.list,
      projectiles: this.projectileMgr.list,
      wave: this.waveMgr.snapshot,
      resources: this.state.resources,
      abilities: this.state.abilities,
      particles: this.effects.particleList,
      damageNumbers: this.effects.damageList,
      shockwaves: this.effects.shockwaveList,
      mines: this.mines,
      hostileShots: this.enemyMgr.hostileShotList,
      aimLine: this.mouseDown ? { x: this.mouseX, y: this.mouseY } : null,
      orbs: this.lootMgr.list,
      charge: this.chargeSnapshot(),
      placement: this.placementSnapshot(),
      spawnLanes: this.pacingHud?.preview?.lanes ?? null,
      // Presentation only (UI plan §3.3): the core tints the crystal and the
      // range ring, the level drives the tower's detail tier. Both were
      // invisible on the battlefield before Part 3.
      coreId: this.coreMgr.current,
      towerLevel: this.state.towerXp.level,
      // Presentation only (`plans/tower-ui.md`): upgrade levels, as a tower.
      towerMarks: this.towerMarks,
      // Presentation only (UI plan §5.C): the kill combo's only expression was
      // the HUD meter; this is what puts it on the battlefield.
      combo: this.pacingHud
        ? { tier: this.pacingHud.comboTier, fraction: this.pacingHud.comboFraction }
        : undefined,
      // Presentation only (UI plan §5.D): the boss intro's bar extension.
      bossIntro: this.bossIntroSnapshot(),
    }, {
      screenFlash: this.screenFlash,
      towerFlash: this.towerFlash,
      wallFlash: this.wallFlash,
      shieldFlash: this.shieldFlash,
      vignette: this.vignette,
      chainPaths: this.effects.activeChainPaths,
    });
  }
}
