import type {
  GameState,
  TowerState,
  ResourceState,
  WaveState,
  AbilityState,
  PrestigeState,
  GameStats,
  RunRecord,
  TowerXpState,
  TalentState,
  PassiveAbilityState,
  Equipment,
  EquipmentSlot,
  EnemyType,
  BlessingRunState,
  BossRunState,
  ContractRunState,
  CoreRunState,
  PacingState,
  WatchState,
  WaveTimingState,
  DeploymentState,
} from '../types';
import { MAX_RUN_HISTORY, DEPLOY_CHECKPOINT_LIMIT } from '../types';
import {
  bossEscortCountForWave,
  crowdCompression,
  goldDropForWave,
  spawnCountForWave,
  isBossWave,
} from '../data/formulas';
import {
  ENEMY_DEFS,
  bossGoldForWave,
  spawnPoolForWave,
} from '../data/enemies';
import { DEFAULT_CORE } from '../data/cores';
import { MAX_RISK_CEILING } from '../data/pacing';
import { xpPerKill, xpToLevel, talentPointsAtLevel, TOWER_LEVEL_CAP, TOWER_XP_TABLE } from '../data/xpTables';
import { passiveXpPerKill, passiveXpPerWaveClear } from '../data/xpTables';
import { PASSIVE_ABILITIES } from '../data/passiveAbilities';
import { ABILITIES } from '../data/abilities';
import { UPGRADE_BY_ID } from '../data/upgrades';
import { AP_PERK_BY_ID, TP_PERK_BY_ID } from '../data/prestige';
import type { PassiveAbilityManager } from './PassiveAbilityManager';
import { getSaveStore, readLegacySave } from './storage';
import { xpPerWaveClear } from '../data/xpTables';
import { intermissionSecondsForWave } from '../data/pacing';
import {
  defaultWaveTiming,
  offlineWaveTarget,
  UNMEASURED_WAVE_PENALTY,
} from '../data/waveTiming';

const STORAGE_KEY = 'the-tower-save';
const SAVE_VERSION = 25;

function defaultWaveModifier() {
  return {
    active: null,
    choiceForNextWave: null,
    pendingChoiceForWave: null,
    goldSnapshot: null,
    wavesRemaining: 0,
    wavesCleared: 0,
  };
}
const AUTO_SAVE_INTERVAL = 30;

/**
 * Minimum wall-clock gap between event-driven writes (plan §5.7).
 *
 * Nine different events used to write the whole state synchronously —
 * including every purchase and every wave start. With auto-buy on a 3 s timer
 * and bulk buying, that is a `JSON.stringify` of the entire save several times
 * a second on the main thread. Events now only mark the state dirty; the flush
 * happens here, at most once per this many seconds, with the 30 s timer as the
 * backstop for a quiet session.
 */
const SAVE_DEBOUNCE_SECONDS = 5;
/**
 * Pre-perk floor for the offline cap (plan §10.1).
 *
 * Was 7 * 24 * 60 * 60 (seven days) as a constant the walk read directly. The
 * cap is now derived — `BASE_IDLE_TIME_SECONDS` plus 8h per level of the
 * `ap_idle_time` AP perk — so this file's job is only to name the default the
 * manager starts from when nothing has been purchased. `getIdleCapSeconds`,
 * wired in the constructor, supplies the live figure.
 */
const DEFAULT_OFFLINE_CAP_SECONDS = 8 * 60 * 60;

/**
 * The offline fraction (plans/economy.md §2).
 *
 * One dial, applied to every offline payout: gold, tower XP and passive XP.
 * It replaces four separate discounts (a 0.5 DPS efficiency, a 0.5 XP factor
 * and a 0.20 passive-XP rate, all stacked on a wave count paced by an 18 s
 * average) with a claim the player can read off the Welcome Back card: an
 * absence pays a quarter of what playing that same wave for that long would.
 */
const OFFLINE_YIELD_FRACTION = 0.25;

/**
 * Numeric guard on the repeat count, not a balance lever. Four days (the
 * maximum idle cap) at the `MIN_WAVE_SECONDS` floor is 69k repeats; this stops
 * a corrupt timing block from producing an unbounded number.
 */
const MAX_OFFLINE_WAVE_REPEATS = 100_000;

export interface PersistentState {
  version: number;
  savedAt: number;
  tower: TowerState;
  resources: ResourceState;
  upgrades: Record<string, number>;
  research: Record<string, number>;
  researchInProgress?: { id: string; elapsed: number; targetLevel: number } | null;
  rp?: number;
  abilities: Record<string, AbilityState>;
  prestige: PrestigeState;
  wave: WaveState;
  stats: GameStats;
  achievements: string[];
  /** v3+: last MAX_RUN_HISTORY run summaries (ring buffer, oldest first). */
  runHistory?: RunRecord[];
  /** v3+: wall-clock time the current run started; reset on ascend/transcend. */
  runStartedAt?: number;
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
  /** v10+: the run's blessing draft (plan §1.5). */
  blessings?: BlessingRunState;
  /** v12+: the run's three live contracts (plan §5.5). */
  contracts?: ContractRunState;
  /** v13+: unlocked cores and the run's selection (plan §6.3). */
  cores?: CoreRunState;
  /** v14+: the risk dial, early-call momentum and the kill combo (plan §7.7). */
  pacing?: PacingState;
  /**
   * Deliberately absent: **loot orbs** (gameplay plan §4.1/§4.4).
   *
   * Live enemies and projectiles are not persisted either — a load starts with
   * an empty field and `WaveManager` restarts the wave — so an orb would have
   * nothing to drift toward. `Game.tryLoadSave` calls `LootManager.clear()`
   * for exactly this reason. Persisting them would also let a player bank a
   * boss pack's drops across a reload and click them all at full value later,
   * which is the one way the 40%/100% split could be gamed.
   */

  /** v11+: run-scoped boss encounter rewards (plan §3.4). */
  bossRun?: BossRunState;
  /** v19+: the Long Watch campaign (permanent; survives both resets). */
  watch?: WatchState;
  /** v23+: measured wave-clear times (economy §2). Run-scoped; reset on ascend. */
  waveTiming?: WaveTimingState;
  /** v25+: deployment checkpoints (progress.md §6). */
  deployment: DeploymentState;
}

export interface OfflineResult {
  elapsedSeconds: number;
  capped: boolean;
  /** The cap in effect for this absence, so the report can name it (plan §10.1). */
  maxIdleSeconds: number;
  /** The wave the absence farmed: the last one completed. Offline never advances. */
  wave: number;
  /** Simulation seconds one clear of `wave` was priced at. */
  waveSeconds: number;
  /** How many times that wave was completed. Fractional: 1.5 pays 1.5 waves. */
  waveRepeats: number;
  /** False when `waveSeconds` is an estimate rather than a measurement. */
  measured: boolean;
  goldEarned: number;
  rpEarned: number;
  researchElapsed: number;
  xpEarned: number;
  /** Passive-ability XP, already scaled by `OFFLINE_YIELD_FRACTION`. */
  passiveXpEarned: number;
}

/**
 * Wave averages for offline progress.
 *
 * All three read `spawnPoolForWave`, the same table `WaveManager` spawns from,
 * so a re-weighting of the pool (gameplay plan §2.4) moves the offline estimate
 * with it instead of leaving three hand-copied weight maps to drift.
 *
 * The caller multiplies these by `spawnCountForWave`, so on a boss wave — one
 * boss plus `bossEscortCountForWave` trash — they have to be the average over
 * that whole roster, not the boss's own figure. `bossWaveAverage` is that
 * mean: the boss's value plus the escort's, over the bodies on the wave.
 */
function bossWaveAverage(wave: number, boss: number, escort: (type: EnemyType) => number): number {
  const escortCount = bossEscortCountForWave(wave);
  const total = boss + escortCount * poolAverage(wave, escort);
  return total / (1 + escortCount);
}

export function averageKillXPForWave(wave: number): number {
  if (isBossWave(wave)) {
    return bossWaveAverage(wave, xpPerKill('boss', wave), t => xpPerKill(t, wave));
  }
  return poolAverage(wave, t => xpPerKill(t, wave));
}

/** Weighted mean of `value` across the wave's spawn pool. */
function poolAverage(wave: number, value: (type: EnemyType) => number): number {
  const pool = spawnPoolForWave(wave);
  let totalWeight = 0;
  let weighted = 0;
  for (const { type, weight } of pool) {
    totalWeight += weight;
    weighted += weight * value(type);
  }
  return totalWeight > 0 ? weighted / totalWeight : 0;
}

export function averageKillGoldForWave(wave: number): number {
  if (isBossWave(wave)) {
    return bossWaveAverage(
      wave,
      bossGoldForWave(wave),
      t => goldDropForWave(ENEMY_DEFS[t].baseGold, wave),
    );
  }
  // The caller multiplies by `spawnCountForWave`, which is capped, so the
  // per-body figure has to carry the compression or an offline wave at depth
  // pays a fraction of what the same wave pays live.
  return poolAverage(wave, t => goldDropForWave(ENEMY_DEFS[t].baseGold, wave))
    * crowdCompression(wave);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function migrateToV3(data: Record<string, unknown>): void {
  if (!Array.isArray(data.runHistory)) {
    data.runHistory = [];
  }
  if (typeof data.runStartedAt !== 'number') {
    const s = data.stats as Record<string, unknown> | undefined;
    data.runStartedAt = typeof s?.startedAt === 'number' ? s.startedAt : Date.now();
  }
  const s = data.stats as Record<string, unknown> | undefined;
  if (s && typeof s.runStartedAt !== 'number') {
    s.runStartedAt = typeof s.startedAt === 'number' ? s.startedAt : Date.now();
  }
}

function migrateV3toV4(data: Record<string, unknown>): void {
  if (Array.isArray(data.research)) {
    const newResearch: Record<string, number> = {};
    for (const id of data.research as string[]) {
      newResearch[id] = 1;
    }
    data.research = newResearch;
  }
  if (typeof data.rp !== 'number') {
    data.rp = 0;
  }
  if (isObject(data.researchInProgress)) {
    const ip = data.researchInProgress as Record<string, unknown>;
    if (typeof ip.targetLevel !== 'number') {
      ip.targetLevel = 1;
    }
  }
}

function migrateV4toV5(data: Record<string, unknown>): void {
  const wave = data.wave as Record<string, unknown> | undefined;
  if (wave && !isObject(wave.waveModifier)) {
    wave.waveModifier = defaultWaveModifier();
  }
}

function migrateV5toV6(data: Record<string, unknown>): void {
  data.towerXp = data.towerXp ?? { xp: 0, level: 1, unspentTalentPoints: 1, totalXpEarned: 0 };
  data.talents = data.talents ?? { allocated: {} };
  data.passiveAbilities = data.passiveAbilities ?? {};
  data.equipment = data.equipment ?? [];
  data.equipped = data.equipped ?? {};
  // Initialize all passive entries
  for (const def of PASSIVE_ABILITIES) {
    const pa = data.passiveAbilities as Record<string, unknown>;
    if (!pa[def.id]) pa[def.id] = { level: 0, xp: 0 };
  }
}

function migrateV6toV7(data: Record<string, unknown>): void {
  const pa = data.passiveAbilities as Record<string, Record<string, unknown>> | undefined;
  if (!pa) return;
  for (const key of Object.keys(pa)) {
    const entry = pa[key];
    if (entry && entry.unlocked === undefined) {
      entry.unlocked = false;
    }
  }
}

const SLOT_RENAME_MAP: Record<string, string> = {
  weapon: 'turret',
  armor: 'bulwark',
  accessory_1: 'arsenal',
  accessory_2: 'brazier',
  relic: 'vault',
  boots: 'machinery',
  helmet: 'banner',
  ring: 'core',
};

const EQUIP_ID_RENAME_MAP: Record<string, string> = {
  crystal_staff: 'arcane_focus',
  leather_vest: 'stone_revetment',
  plate_armor: 'iron_plating',
  ring_of_power: 'enchanted_quiver',
  moon_pendant: 'moonlit_brazier',
  swift_boots: 'swift_gears',
  guardian_crown: 'guardian_banner',
  emerald_band: 'emerald_core',
};

function migrateV7toV8(data: Record<string, unknown>): void {
  const inventory = data.equipment as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(inventory)) {
    for (const item of inventory) {
      if (typeof item.slot === 'string' && SLOT_RENAME_MAP[item.slot]) {
        item.slot = SLOT_RENAME_MAP[item.slot];
      }
      if (typeof item.defId === 'string' && EQUIP_ID_RENAME_MAP[item.defId]) {
        item.defId = EQUIP_ID_RENAME_MAP[item.defId];
      }
    }
  }
  const equipped = data.equipped as Record<string, Record<string, unknown>> | undefined;
  if (equipped && typeof equipped === 'object') {
    const newEquipped: Record<string, Record<string, unknown>> = {};
    for (const [oldSlot, item] of Object.entries(equipped)) {
      const newSlot = SLOT_RENAME_MAP[oldSlot] ?? oldSlot;
      if (item && typeof item === 'object') {
        if (typeof item.slot === 'string' && SLOT_RENAME_MAP[item.slot]) {
          item.slot = SLOT_RENAME_MAP[item.slot];
        }
        if (typeof item.defId === 'string' && EQUIP_ID_RENAME_MAP[item.defId]) {
          item.defId = EQUIP_ID_RENAME_MAP[item.defId];
        }
      }
      newEquipped[newSlot] = item;
    }
    data.equipped = newEquipped;
  }
}

function computeRPGainMultiplier(research: Record<string, number>): number {
  let sum = 0;
  for (const [id, level] of Object.entries(research)) {
    if (id !== 'rp_gain') continue;
    const lvl = level;
    if (lvl <= 0) continue;
    const basePerLevel = 0.12;
    if (lvl >= 10) sum += 2.0;
    else sum += basePerLevel * lvl;
  }
  return sum;
}

/**
 * v9 (plan §3): per-ability auto-cast toggles, auto-buy strategy/reserve, and
 * the multi-wave mutator fields. All are additive, so the migration is a set of
 * defaults rather than a transform.
 */
function migrateV8toV9(data: Record<string, unknown>): void {
  const prestige = data.prestige as Record<string, unknown> | undefined;
  if (prestige && typeof prestige === 'object') {
    if (!isObject(prestige.autoCastEnabled)) prestige.autoCastEnabled = {};
    if (typeof prestige.autoBuyStrategy !== 'string') prestige.autoBuyStrategy = 'balanced';
    if (typeof prestige.autoBuyReserve !== 'number') prestige.autoBuyReserve = 0;
  }
  const wave = data.wave as Record<string, unknown> | undefined;
  const wm = wave?.waveModifier as Record<string, unknown> | undefined;
  if (wm && typeof wm === 'object') {
    if (typeof wm.wavesRemaining !== 'number') wm.wavesRemaining = wm.active ? 1 : 0;
    if (typeof wm.wavesCleared !== 'number') wm.wavesCleared = 0;
  }
}

/** A fresh, empty blessing run — the v10 default. */
function defaultBlessings(): BlessingRunState {
  return {
    held: {},
    picksTaken: 0,
    rerolls: 0,
    pendingOfferForWave: null,
    wavesClearedThisRun: 0,
  };
}

/** A fresh boss-reward run — the v11 default. */
function defaultBossRun(): BossRunState {
  return { apBonusPct: 0, swiftKills: 0, flawlessKills: 0 };
}

/**
 * A fresh contract run — the v12 default.
 *
 * Deliberately *empty* rather than pre-drawn: the draw needs the run's current
 * wave and `Game.estimateWaveGold`, neither of which the save layer has.
 * `ContractManager.restore` refills the slots the moment the game wires itself
 * up, so a v11 save loads straight into three live contracts.
 */
function defaultContracts(): ContractRunState {
  return { active: [], completed: [], completedCount: 0, apBonusPct: 0, uidSeq: 0 };
}

/**
 * v10 (gameplay plan §1.5): the blessing draft.
 *
 * Purely additive — a pre-v10 save simply had no blessings, so the migration
 * seeds an empty run rather than transforming anything. Nothing is dropped.
 */
function migrateV9toV10(data: Record<string, unknown>): void {
  if (!isObject(data.blessings)) {
    data.blessings = defaultBlessings();
  }
}

/**
 * v11 (gameplay plan §3.4): boss encounter rewards.
 *
 * Additive, like v10. Only the *earned* half of an encounter is stored — the
 * flawless AP bonus and the two counters. Mid-fight state (phase, pattern
 * timers, the bulwark shield) is deliberately absent: live enemies have never
 * been part of the save format, so a load starts the wave's roster empty and
 * `WaveManager` clears the wave rather than resuming half a boss.
 */
function migrateV10toV11(data: Record<string, unknown>): void {
  if (!isObject(data.bossRun)) {
    data.bossRun = defaultBossRun();
  }
}

/**
 * v12 (gameplay plan §5.5): contracts.
 *
 * Additive, like v10 and v11. A pre-v12 save is a run that simply has not been
 * handed any contracts yet, so the migration seeds an empty block and the
 * manager draws three on load. Nothing is transformed and nothing is dropped.
 */
function migrateV11toV12(data: Record<string, unknown>): void {
  if (!isObject(data.contracts)) {
    data.contracts = defaultContracts();
  }
}

/**
 * A fresh core block — the v13 default.
 *
 * The default core is the only one a pre-v13 save can have owned, and it is
 * also the one every run before this feature was actually playing: the shot
 * behavior a v12 tower had is `marksman`'s, so seeding it is a restatement of
 * what the save already meant rather than a grant.
 */
function defaultCores(): CoreRunState {
  return { unlocked: [DEFAULT_CORE], preferred: DEFAULT_CORE, selected: DEFAULT_CORE };
}

/**
 * v13 (gameplay plan §6.3): tower cores.
 *
 * Additive, like v10-v12. Nothing is transformed: a pre-v13 save is a run on
 * the default core that has never been offered a choice, which is exactly what
 * the seeded block says.
 *
 * §6.3 says "bump to v12". It was written before Part 3 took v11 and Part 5
 * took v12, so the number in the plan is two behind; the ladder decides, not
 * the plan.
 */
function migrateV12toV13(data: Record<string, unknown>): void {
  if (!isObject(data.cores)) {
    data.cores = defaultCores();
  }
}

/** A fresh pacing block — the v14 default: risk 0, no momentum, no combo. */
function defaultPacing(): PacingState {
  return { risk: 0, committedRisk: 0, momentum: 0, momentumWaves: 0, comboBest: 0 };
}

/**
 * v14 (gameplay plan §7.7): pacing — the risk dial and early-call momentum.
 *
 * Additive, like v10-v13. A pre-v14 save is a run at risk 0 with no momentum
 * banked, which is exactly what the seeded block says: §7.8's requirement is
 * that risk 0 reproduces the current curve, so the migration is a restatement
 * of what the save already meant rather than a grant.
 *
 * §7.7 says "bump to v13". It was written before Part 6 took v13 — the fourth
 * consecutive part whose save version in the plan was stale. The ladder
 * decides, not the plan.
 */
function migrateV13toV14(data: Record<string, unknown>): void {
  if (!isObject(data.pacing)) {
    data.pacing = defaultPacing();
  }
}

/**
 * v15 (gameplay plan §10.1): the offline cap became derived.
 *
 * Unlike every migration before it, this one has **nothing to seed**. The cap
 * used to be a constant in this file; it is now `BASE_IDLE_TIME_SECONDS` plus
 * 8h per level of `ap_idle_time`, and the perk's level already lives in
 * `prestige.apSpent`, a free-form map every save has carried since v1. A
 * pre-v15 save with no points in the perk therefore *already means* "8h cap",
 * so the migration is a restatement of what the save already meant rather
 * than a grant — same rule as v13 and v14. The function exists only so the
 * ladder stays one-step-per-version and the number never silently skips.
 */
function migrateV14toV15(_data: Record<string, unknown>): void {
  // no-op: the cap is computed, never persisted.
}

/**
 * v16: the `multishot` ability became `rocket_barrage`.
 *
 * A rename, not a transform: the ability's saved state and its auto-cast
 * toggle keep their exact values under the new key. Both live in free-form
 * maps, so each container is guarded for absence or a shape mismatch before
 * it is touched.
 */
function migrateV15toV16(data: Record<string, unknown>): void {
  const abilities = data.abilities as Record<string, unknown> | undefined;
  if (isObject(abilities) && abilities.multishot !== undefined) {
    abilities.rocket_barrage = abilities.multishot;
    delete abilities.multishot;
  }
  const prestige = data.prestige as Record<string, unknown> | undefined;
  if (!isObject(prestige)) return;
  const autoCast = prestige.autoCastEnabled;
  if (isObject(autoCast) && autoCast.multishot !== undefined) {
    autoCast.rocket_barrage = autoCast.multishot;
    delete autoCast.multishot;
  }
}

/**
 * v17: the levelling redesign.
 *
 * Three things change at once and all three have to be reconciled here:
 *
 *  - `level` becomes 1-based (a fresh save is level 1, not level 0);
 *  - the XP requirement curve is a different, far steeper function, so the
 *    stored `xp` no longer denotes the same level it did;
 *  - every talent id is new, so nothing can carry over.
 *
 * The level is treated as the thing worth preserving — it is what the player
 * spent months on — so the XP is *restated* onto the new curve rather than
 * re-interpreted. Progress within the level is dropped (it is at most one
 * level's worth), and every point is refunded so the player re-spends into the
 * new tree with a clean slate.
 */
function migrateV16toV17(data: Record<string, unknown>): void {
  const tx = data.towerXp as Record<string, unknown> | undefined;
  const oldLevel = isObject(tx) && typeof tx.level === 'number' ? Math.floor(tx.level) : 0;
  // 0-based -> 1-based, then clamp to the new cap.
  const level = Math.max(1, Math.min(TOWER_LEVEL_CAP, oldLevel + 1));
  const xp = TOWER_XP_TABLE[level];
  const oldTotal = isObject(tx) && typeof tx.totalXpEarned === 'number' ? tx.totalXpEarned : 0;
  data.towerXp = {
    level,
    xp,
    // Lifetime XP is a stat, not a currency. Scale it by the same factor the
    // curve moved so achievements and the Stats panel stay proportionate.
    totalXpEarned: Math.max(xp, Math.floor(oldTotal * (xp / Math.max(1, oldTotal || 1)))),
    unspentTalentPoints: talentPointsAtLevel(level),
  };
  // Every talent id changed; a full refund is the only honest migration.
  data.talents = { allocated: {} };
}

/**
 * v18: the passive redesign.
 *
 * Every passive id, effect, cost curve and XP curve is new, and the level cap
 * dropped from 50/30 to 25. Nothing about an old entry survives translation —
 * a level 34 `passive_markmanship` (note the typo in the old id) means nothing
 * on the new table. Rather than silently keep meaningless levels, the whole
 * track is refunded: entries are cleared and `PassiveAbilityManager`
 * re-initialises them.
 *
 * The gold is not refunded, because there is no honest figure to refund — the
 * old prices were a rounding error next to the new ones (§1.2).
 */
function migrateV17toV18(data: Record<string, unknown>): void {
  data.passiveAbilities = {};
}

/**
 * A fresh watch block — the v19 default.
 *
 * Counters begin at zero and the `riskWaves` array is sized to
 * `MAX_RISK_CEILING + 1`, so a later Watch unlock that raises the dial cannot
 * land out of bounds.
 */
function defaultWatch(): WatchState {
  return {
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
  };
}

/**
 * v19: the Long Watch.
 *
 * Purely additive. A pre-v19 save has no campaign state, so the block is
 * seeded empty and the first poll credits every chapter the player's existing
 * lifetime counters already satisfy — which is the intended behaviour, not a
 * migration shortcut (see plan §1.2). The counters that did not exist before
 * this version start at zero, so `flawless_waves`, `swift_bosses`,
 * `risk_waves`, `mutator_waves`, `contracts_done`, `blessing_picks` and every
 * per-type kill count begin accruing from the update forward. That is the one
 * place a returning player loses credit, and it is unavoidable: the data was
 * never written down.
 */
function migrateV18toV19(data: Record<string, unknown>): void {
  data.watch = defaultWatch();
}

/**
 * v20: the active-abilities redesign.
 *
 * There is no ability-state shape change — levels, XP, cooldowns and
 * `autoCastEnabled` all keep their meaning. The migration exists for one
 * reason: ability levels are run-scoped and the redesign changes what a level
 * is worth, so this clamps any level above the new `maxLevel` (no maxLevel
 * dropped in this phase, so it is a no-op safety net) and leaves everything
 * else untouched.
 */
function migrateV19toV20(data: Record<string, unknown>): void {
  const abilities = data.abilities as Record<string, Record<string, unknown>> | undefined;
  if (!isObject(abilities)) return;
  for (const def of ABILITIES) {
    const s = abilities[def.id];
    if (!isObject(s)) continue;
    if (typeof s.level === 'number') {
      s.level = Math.max(1, Math.min(def.maxLevel, s.level));
    }
  }
}

/**
 * v21 (upgrades revamp §11): the balance migration the revamp owes old saves.
 *
 * The plan wrote this as v14 -> v15, but the ladder moved on while the revamp
 * was being built and several of its bullets landed on their own along the
 * way, so only the parts that are still outstanding are done here:
 *
 *  - `upgradeDiscount` -> `prospecting` at `min(20, ceil(old / 2))`, then the
 *    old key is deleted. The retired id was already ignored on load (see
 *    `UpgradeManager.replaceLevels`, which walks `UPGRADES` rather than the
 *    saved map), so its levels were being silently dropped rather than
 *    translated — this is the translation.
 *  - Every remaining upgrade level is clamped to its new `maxLevel`; the
 *    revamp gave ceilings to lines that used to run to 999.
 *  - AP and TP perk levels are clamped to their table `maxLevel`. This covers
 *    §11's hand-written list (Twin/Rear/Scatter to 1, `ap_wave_skipper` to 15,
 *    `tp_wave_start` 8, `tp_game_speed` 6, `tp_head_start` 12, `tp_fire_rate`
 *    20, `tp_crit` 25, `tp_treasure`/`tp_mana` 15) without restating numbers
 *    that now live in `AP_PERK_BY_ID` / `TP_PERK_BY_ID`, and stays correct if
 *    §14 retunes any of them. Perks whose id no longer exists are dropped.
 *  - `tp_midas` -> `tp_salvage` at level 1 if owned, old key deleted.
 *  - `ap_warlord` / `ap_tycoon` are now exclusive: if a save holds both, the
 *    one with more spent levels is kept and the other cleared (ties keep
 *    `ap_warlord`, the first of the pair in table order).
 *
 * No refunds anywhere — gold, AP and TP all stay as they are. §11 is explicit
 * that this is a balance migration, not an accounting one.
 */
function migrateV20toV21(data: Record<string, unknown>): void {
  const upgrades = data.upgrades as Record<string, unknown> | undefined;
  if (isObject(upgrades)) {
    const discount = upgrades.upgradeDiscount;
    if (typeof discount === 'number' && discount > 0) {
      const converted = Math.min(20, Math.ceil(discount / 2));
      const existing = typeof upgrades.prospecting === 'number' ? upgrades.prospecting : 0;
      upgrades.prospecting = Math.max(existing, converted);
    }
    delete upgrades.upgradeDiscount;
    for (const [id, level] of Object.entries(upgrades)) {
      const def = UPGRADE_BY_ID[id];
      if (!def) continue;
      if (typeof level !== 'number') continue;
      upgrades[id] = Math.max(def.startLevel ?? 0, Math.min(def.maxLevel, Math.floor(level)));
    }
  }

  const prestige = data.prestige as Record<string, unknown> | undefined;
  if (!isObject(prestige)) return;

  const tpSpent = prestige.tpSpent as Record<string, unknown> | undefined;
  if (isObject(tpSpent)) {
    if (typeof tpSpent.tp_midas === 'number' && tpSpent.tp_midas > 0) {
      tpSpent.tp_salvage = 1;
    }
    delete tpSpent.tp_midas;
    clampPerkLevels(tpSpent, TP_PERK_BY_ID);
  }

  const apSpent = prestige.apSpent as Record<string, unknown> | undefined;
  if (isObject(apSpent)) {
    clampPerkLevels(apSpent, AP_PERK_BY_ID);
    const warlord = typeof apSpent.ap_warlord === 'number' ? apSpent.ap_warlord : 0;
    const tycoon = typeof apSpent.ap_tycoon === 'number' ? apSpent.ap_tycoon : 0;
    if (warlord > 0 && tycoon > 0) {
      if (tycoon > warlord) delete apSpent.ap_warlord;
      else delete apSpent.ap_tycoon;
    }
  }
}

/**
 * v22 (prestige-abs §7): the AP tree widens from thirteen rows to nineteen.
 *
 * Almost nothing has to happen. New perk ids need no entry — absent means
 * level 0 — and the only ceiling that moved is `ap_wave_skipper` (15 -> 12),
 * which `clampPerkLevels` handles off the table rather than off a number
 * restated here.
 *
 * **`ap_auto_upgrader` 25 -> 12 is not refunded.** The precedent is
 * `migrateV20toV21`'s "no refunds anywhere — this is a balance migration, not
 * an accounting one", and §6.1's Reforge ships in the same release, so a
 * player who overpaid can respec and re-buy at the new price.
 */
function migrateV21toV22(data: Record<string, unknown>): void {
  const prestige = data.prestige as Record<string, unknown> | undefined;
  if (!isObject(prestige)) return;
  const apSpent = prestige.apSpent as Record<string, unknown> | undefined;
  if (isObject(apSpent)) clampPerkLevels(apSpent, AP_PERK_BY_ID);
}

/**
 * v23 (plans/economy.md §2): offline progress is now paced by a measured wave
 * duration instead of an 18 s average and a DPS walk. Nothing in an older save
 * carries that measurement, so the block starts empty and the first absence
 * after the update is priced from `expectedWaveSeconds` at half rate
 * (`UNMEASURED_WAVE_PENALTY`) until five waves have been cleared.
 */
function migrateV22toV23(data: Record<string, unknown>): void {
  data.waveTiming = defaultWaveTiming();
}

/**
 * v24 (plans/improvements.md): the research rebalance and the Auto-Upgrader's
 * two new levels.
 *
 * Three things need saying about what this does *not* do:
 *
 *  - **RP is not clawed back.** The faucet changes are forward-looking; a
 *    player who banked 40k RP under the old rates keeps it. Refunding would
 *    require knowing which RP came from which source, which was never written
 *    down.
 *  - **Research levels are not refunded** even though `rp_gain` and
 *    `rp_drop_chance` now grant less per level. Same rule the v21 upgrade
 *    rebalance followed: a balance migration re-prices the future, not the past.
 *  - **The `watch` block is not touched.** It was always saved correctly; the
 *    v24 fix is on the *load* side (`Game.applyPersistedState`), so an existing
 *    save's campaign comes back the first time the fixed build reads it.
 *
 * The one repair it does perform is the risk histogram: `MAX_RISK_CEILING`
 * went 7 -> 8 for the Crown of Thorns unlock, so the array gains a slot.
 * `normalizeWatch` already rebuilds it to `MAX_RISK_CEILING + 1` on every
 * load, so this is belt-and-braces for a save that skips normalization.
 */
function migrateV23toV24(data: Record<string, unknown>): void {
  const watch = data.watch as Record<string, unknown> | undefined;
  if (isObject(watch) && isObject(watch.counters)) {
    normalizeWatch(watch);
  }
  const apSpent = (data.prestige as Record<string, unknown> | undefined)?.apSpent;
  if (isObject(apSpent)) clampPerkLevels(apSpent as Record<string, unknown>, AP_PERK_BY_ID);
}

/**
 * v25 (plans/progress.md §6): deployment checkpoints.
 *
 * Seeds an empty store. Deliberately does **not** synthesise a checkpoint from
 * the save's `highestWave`: a checkpoint is a *snapshot of a tower*, and a
 * pre-v25 save has no record of what its tower looked like at wave 300. Making
 * one up would be the one thing the whole mechanism is designed not to do.
 * A returning player's first run past a 50-wave boundary writes the first real
 * one.
 */
function migrateV24toV25(data: Record<string, unknown>): void {
  data.deployment = { checkpoints: {} };
}

/**
 * Clamp a `{perkId: level}` map to the table's ceilings, dropping ids the
 * table no longer defines and entries that are not positive integers.
 */
function clampPerkLevels(
  spent: Record<string, unknown>,
  table: Record<string, { maxLevel: number }>,
): void {
  for (const [id, level] of Object.entries(spent)) {
    const def = table[id];
    if (!def) {
      delete spent[id];
      continue;
    }
    if (typeof level !== 'number' || !Number.isFinite(level) || level <= 0) {
      delete spent[id];
      continue;
    }
    spent[id] = Math.min(def.maxLevel, Math.floor(level));
  }
}

function validate(data: unknown): data is PersistentState {
  if (!isObject(data)) return false;

  if (data.version !== SAVE_VERSION && data.version !== 24 && data.version !== 23 && data.version !== 22 && data.version !== 21 && data.version !== 20 && data.version !== 19 && data.version !== 18 && data.version !== 17 && data.version !== 16 && data.version !== 15 && data.version !== 14 && data.version !== 13 && data.version !== 12 && data.version !== 11 && data.version !== 10 && data.version !== 9 && data.version !== 8 && data.version !== 7 && data.version !== 6 && data.version !== 5 && data.version !== 4 && data.version !== 3 && data.version !== 2) return false;

  if (typeof data.savedAt !== 'number') return false;
  if (!isObject(data.tower)) return false;
  if (!isObject(data.resources)) return false;
  if (!isObject(data.upgrades)) return false;
  if (!isObject(data.research)) return false;
  if (!isObject(data.abilities)) return false;
  if (!isObject(data.prestige)) return false;
  if (!isObject(data.wave)) return false;
  if (!isObject(data.stats)) return false;
  if (!Array.isArray(data.achievements)) {
    (data as Record<string, unknown>).achievements = [];
  }

  // Cascading migration ladder
  if (data.version === 2) { migrateToV3(data); data.version = 3; }
  if (data.version === 3) { migrateV3toV4(data); data.version = 4; }
  if (data.version === 4) { migrateV4toV5(data); data.version = 5; }
  if (data.version === 5) { migrateV5toV6(data); data.version = 6; }
  if (data.version === 6) { migrateV6toV7(data); data.version = 7; }
  if (data.version === 7) { migrateV7toV8(data); data.version = 8; }
  if (data.version === 8) { migrateV8toV9(data); data.version = 9; }
  if (data.version === 9) { migrateV9toV10(data); data.version = 10; }
  if (data.version === 10) { migrateV10toV11(data); data.version = 11; }
  if (data.version === 11) { migrateV11toV12(data); data.version = 12; }
  if (data.version === 12) { migrateV12toV13(data); data.version = 13; }
  if (data.version === 13) { migrateV13toV14(data); data.version = 14; }
  if (data.version === 14) { migrateV14toV15(data); data.version = 15; }
  if (data.version === 15) { migrateV15toV16(data); data.version = 16; }
  if (data.version === 16) { migrateV16toV17(data); data.version = 17; }
  if (data.version === 17) { migrateV17toV18(data); data.version = 18; }
  if (data.version === 18) { migrateV18toV19(data); data.version = 19; }
  if (data.version === 19) { migrateV19toV20(data); data.version = 20; }
  if (data.version === 20) { migrateV20toV21(data); data.version = 21; }
  if (data.version === 21) { migrateV21toV22(data); data.version = 22; }
  if (data.version === 22) { migrateV22toV23(data); data.version = 23; }
  if (data.version === 23) { migrateV23toV24(data); data.version = 24; }
  if (data.version === 24) { migrateV24toV25(data); data.version = 25; }

  // Ensure fallback fields exist (applies to all versions)
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.runHistory)) d.runHistory = [];
  if (typeof d.runStartedAt !== 'number') d.runStartedAt = Date.now();
  if (typeof d.rp !== 'number') d.rp = 0;
  const wave = d.wave as Record<string, unknown> | undefined;
  if (wave && !isObject(wave.waveModifier)) wave.waveModifier = defaultWaveModifier();
  // Enrage clock (plan §2.3.3): older saves predate it. Start the loaded wave
  // calm rather than resuming mid-enrage from a stale timestamp.
  if (wave && typeof wave.elapsed !== 'number') wave.elapsed = 0;
  if (wave && typeof wave.enrageStacks !== 'number') wave.enrageStacks = 0;
  if (!isObject(d.blessings)) d.blessings = defaultBlessings();
  if (!isObject(d.bossRun)) d.bossRun = defaultBossRun();
  if (!isObject(d.contracts)) d.contracts = defaultContracts();
  if (!isObject(d.cores)) d.cores = defaultCores();
  if (!isObject(d.pacing)) d.pacing = defaultPacing();
  if (!isObject(d.watch)) d.watch = defaultWatch();
  else normalizeWatch(d.watch as Record<string, unknown>);

  if (!isObject(d.waveTiming)) d.waveTiming = defaultWaveTiming();
  const wt = d.waveTiming as Record<string, unknown>;
  for (const key of ['lastWaveSeconds', 'avgWaveSeconds', 'sampleWave', 'samples'] as const) {
    if (typeof wt[key] !== 'number' || !Number.isFinite(wt[key])) wt[key] = 0;
  }

  return true;
}

/** Repair a `watch` block in place: missing counters, short risk array, bad numbers. */
function normalizeWatch(w: Record<string, unknown>): void {
  if (!Array.isArray(w.completed)) w.completed = [];
  if (!isObject(w.counters)) w.counters = defaultWatch().counters;
  const c = w.counters as Record<string, unknown>;
  if (!isObject(c.killsByType)) c.killsByType = {};
  for (const key of ['flawlessWaves', 'swiftBosses', 'contractsDone',
                     'blessingPicks', 'mutatorWaves'] as const) {
    if (typeof c[key] !== 'number' || !Number.isFinite(c[key])) c[key] = 0;
  }
  const risk = Array.isArray(c.riskWaves) ? (c.riskWaves as number[]) : [];
  const fixed = new Array(MAX_RISK_CEILING + 1).fill(0);
  for (let i = 0; i < fixed.length; i++) {
    const v = risk[i];
    fixed[i] = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  }
  c.riskWaves = fixed;
}

export class SaveManager {
  private saveTimer = 0;
  /** Set by `requestSave`; cleared by the next actual write. */
  private savePending = false;
  /**
   * The serialized snapshot, as it will be written. This — not the backend — is
   * what `load()`/`hasSave()` answer from, which is what lets those two stay
   * synchronous over an asynchronous store (see `plans/capacitor.md` §8.1).
   */
  private cached: string | null = null;
  /** False until `hydrate()` has run. Loading before then is a bug, not an empty save. */
  private hydrated = false;
  /** Serializes flushes so two writes can never interleave. */
  private flushQueue: Promise<void> = Promise.resolve();
  private readonly busListener: (payload: unknown) => void;
  private readonly getRP: () => number;
  /**
   * Live offline cap (plan §10.1). Injected because the cap belongs to the
   * prestige layer (`ap_idle_time`), which this class does not see.
   */
  private readonly getIdleCapSeconds: () => number;

  constructor(
    bus: { on: (event: string, h: (payload: unknown) => void) => void },
    opts: {
      getRP?: () => number;
      getIdleCapSeconds?: () => number;
    } = {},
  ) {
    this.busListener = (payload) => {
      const p = payload as { success: boolean };
      if (p && p.success === false) {
        console.warn('[SaveManager] save reported failure');
      }
    };
    bus.on('save_failed', this.busListener);
    this.getRP = opts.getRP ?? (() => 0);
    this.getIdleCapSeconds = opts.getIdleCapSeconds ?? (() => DEFAULT_OFFLINE_CAP_SECONDS);
  }

  snapshot(state: GameState): PersistentState {
    return {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      tower: { ...state.tower },
      resources: { ...state.resources },
      upgrades: { ...state.upgrades },
      research: { ...state.research },
      researchInProgress: state.researchInProgress ? { ...state.researchInProgress } : null,
      rp: Math.max(0, this.getRP()),
      abilities: this.snapshotAbilities(state.abilities),
      prestige: this.snapshotPrestige(state.prestige),
      wave: { ...state.wave },
      stats: { ...state.stats },
      achievements: [...(state.achievements ?? [])],
      runHistory: [...(state.runHistory ?? [])].slice(-MAX_RUN_HISTORY),
      runStartedAt: state.runStartedAt ?? state.stats.runStartedAt ?? Date.now(),
      towerXp: { ...state.towerXp },
      talents: { allocated: { ...state.talents.allocated } },
      passiveAbilities: this.snapshotPassives(state.passiveAbilities),
      equipment: state.equipment.map(e => ({ ...e, stats: [...e.stats] })),
      equipped: Object.fromEntries(
        Object.entries(state.equipped).map(([slot, eq]) => [slot, { ...eq!, stats: [...eq!.stats] }]),
      ) as Partial<Record<EquipmentSlot, Equipment>>,
      blessings: this.snapshotBlessings(state.blessings),
      bossRun: this.snapshotBossRun(state.bossRun),
      contracts: this.snapshotContracts(state.contracts),
      cores: this.snapshotCores(state.cores),
      pacing: this.snapshotPacing(state.pacing),
      waveTiming: { ...(state.waveTiming ?? defaultWaveTiming()) },
      watch: this.snapshotWatch(state.watch),
      deployment: this.snapshotDeployment(state.deployment),
    };
  }

  /**
   * Checkpoints are copied field by field and re-validated, for the same
   * reason blessings are: a runtime-only field must not leak into the format,
   * and a hand-edited save must not be able to hand back a tower that never
   * existed. Anything malformed is dropped rather than repaired — a missing
   * checkpoint costs the player one deploy, a repaired one is a grant nobody
   * earned.
   */
  private snapshotDeployment(d: DeploymentState | undefined): DeploymentState {
    const out: DeploymentState = { checkpoints: {} };
    if (!d || !isObject(d.checkpoints)) return out;
    const waves = Object.keys(d.checkpoints)
      .map(Number)
      .filter(w => Number.isFinite(w) && w > 0)
      .sort((a, b) => b - a)
      .slice(0, DEPLOY_CHECKPOINT_LIMIT);
    for (const w of waves) {
      const c = d.checkpoints[w];
      if (!c || !Number.isFinite(c.gold)) continue;
      out.checkpoints[w] = {
        wave: w,
        gold: Math.max(0, c.gold),
        upgradeLevels: { ...c.upgradeLevels },
        blessingHeld: { ...c.blessingHeld },
        blessingPicks: Math.max(0, Math.floor(c.blessingPicks ?? 0)),
        abilityLevels: { ...c.abilityLevels },
        recordedAt: c.recordedAt ?? 0,
      };
    }
    return out;
  }

  /**
   * Blessings are copied field by field rather than spread, so a runtime-only
   * field added to the manager later cannot leak into the save format by
   * accident.
   */
  private snapshotBlessings(b: BlessingRunState | undefined): BlessingRunState {
    if (!b) return defaultBlessings();
    return {
      held: { ...b.held },
      picksTaken: b.picksTaken,
      rerolls: b.rerolls,
      pendingOfferForWave: b.pendingOfferForWave ?? null,
      wavesClearedThisRun: b.wavesClearedThisRun ?? 0,
    };
  }

  /** Copied field by field, for the same reason blessings are. */
  private snapshotBossRun(b: BossRunState | undefined): BossRunState {
    if (!b) return defaultBossRun();
    return {
      apBonusPct: b.apBonusPct ?? 0,
      swiftKills: b.swiftKills ?? 0,
      flawlessKills: b.flawlessKills ?? 0,
    };
  }

  /**
   * Contracts are copied field by field for the same reason blessings are: a
   * runtime-only field on the manager must not leak into the save format.
   */
  private snapshotContracts(c: ContractRunState | undefined): ContractRunState {
    if (!c) return defaultContracts();
    return {
      active: (c.active ?? []).map(a => ({
        defId: a.defId,
        uid: a.uid,
        target: a.target,
        progress: a.progress,
        drawnAtWave: a.drawnAtWave,
      })),
      completed: [...(c.completed ?? [])],
      // The completion log (payout per completed contract). Copied entry by
      // entry like everything else here, and left off entirely when the run
      // has none rather than written as an empty array — a v12-era block has
      // no `log` at all, and `ContractManager.restore` distinguishes the two.
      ...(c.log ? {
        log: c.log.map(e => ({
          defId: e.defId,
          wave: e.wave,
          gold: e.gold,
          rerolls: e.rerolls,
          rp: e.rp,
          apBonusPct: e.apBonusPct,
        })),
      } : {}),
      completedCount: c.completedCount ?? 0,
      apBonusPct: c.apBonusPct ?? 0,
      uidSeq: c.uidSeq ?? 0,
    };
  }

  /** Copied field by field, for the same reason blessings are. */
  private snapshotCores(c: CoreRunState | undefined): CoreRunState {
    if (!c) return defaultCores();
    return {
      unlocked: [...(c.unlocked ?? [DEFAULT_CORE])],
      preferred: c.preferred ?? DEFAULT_CORE,
      selected: c.selected ?? DEFAULT_CORE,
    };
  }

  /** Copied field by field, for the same reason cores are. */
  private snapshotPacing(p: PacingState | undefined): PacingState {
    if (!p) return defaultPacing();
    return {
      risk: p.risk ?? 0,
      committedRisk: p.committedRisk ?? p.risk ?? 0,
      momentum: p.momentum ?? 0,
      momentumWaves: p.momentumWaves ?? 0,
      comboBest: p.comboBest ?? 0,
    };
  }

  /**
   * Copied field by field, for the same reason the other blocks are: a
   * runtime-only field added later cannot leak into the save format. The
   * counters object and the inner arrays are spread so the written blob does
   * not share memory with the live state.
   */
  private snapshotWatch(w: WatchState | undefined): WatchState {
    if (!w) return defaultWatch();
    const c = w.counters ?? defaultWatch().counters;
    return {
      completed: [...(w.completed ?? [])],
      counters: {
        killsByType: { ...(c.killsByType ?? {}) },
        flawlessWaves: c.flawlessWaves ?? 0,
        swiftBosses: c.swiftBosses ?? 0,
        contractsDone: c.contractsDone ?? 0,
        blessingPicks: c.blessingPicks ?? 0,
        mutatorWaves: c.mutatorWaves ?? 0,
        riskWaves: [...(c.riskWaves ?? new Array(MAX_RISK_CEILING + 1).fill(0))],
      },
    };
  }

  private snapshotPassives(passives: Record<string, PassiveAbilityState>): Record<string, PassiveAbilityState> {
    const out: Record<string, PassiveAbilityState> = {};
    for (const id of Object.keys(passives)) {
      out[id] = { level: passives[id].level, xp: passives[id].xp, unlocked: passives[id].unlocked };
    }
    return out;
  }

  private snapshotAbilities(abilities: Record<string, AbilityState>): Record<string, AbilityState> {
    const out: Record<string, AbilityState> = {};
    for (const id of Object.keys(abilities)) {
      const a = abilities[id];
      out[id] = { level: a.level, cooldown: 0, active: false, activeTimer: 0, xp: a.xp ?? 0 };
    }
    return out;
  }

  private snapshotPrestige(p: PrestigeState): PrestigeState {
    return {
      apSpent: { ...p.apSpent },
      tpSpent: { ...p.tpSpent },
      automationFlags: { ...p.automationFlags },
      targetAscendWave: p.targetAscendWave,
      autoCastEnabled: { ...(p.autoCastEnabled ?? {}) },
      autoBuyStrategy: p.autoBuyStrategy ?? 'balanced',
      autoBuyReserve: p.autoBuyReserve ?? 0,
    };
  }

  /**
   * Fill the cache from the backend. Must be awaited once, before `load()`.
   *
   * Adopts a pre-move `localStorage` save when the backend has nothing — that is
   * the entire migration, and it runs exactly once because the adopted value is
   * written straight back to the new store.
   */
  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    const store = getSaveStore();
    let raw: string | null = null;
    try {
      raw = await store.get(STORAGE_KEY);
    } catch (err) {
      console.warn('[SaveManager] hydrate failed:', err);
    }
    if (raw === null) {
      const legacy = readLegacySave(STORAGE_KEY);
      if (legacy !== null) {
        raw = legacy;
        try {
          await store.set(STORAGE_KEY, legacy);
        } catch (err) {
          console.warn('[SaveManager] migrating the legacy save failed:', err);
        }
      }
    }
    this.cached = raw;
    this.hydrated = true;
  }

  /**
   * Resolves when every write issued so far has reached the backend. The native
   * `pause` handler awaits this; nothing in the frame loop does.
   */
  flushNow(): Promise<void> {
    return this.flushQueue;
  }

  /** Chain one write behind the last, newest payload wins. */
  private scheduleFlush(): void {
    const payload = this.cached;
    const store = getSaveStore();
    this.flushQueue = this.flushQueue
      .then(() => (payload === null ? store.remove(STORAGE_KEY) : store.set(STORAGE_KEY, payload)))
      .catch((err) => {
        console.warn('[SaveManager] flush failed:', err);
      });
  }

  /**
   * Take a snapshot and schedule it for the backend.
   *
   * Returns `false` only when *serialization* fails. A backend write that fails
   * is reported through `console.warn` from the flush instead — by then this
   * call has long since returned (`plans/capacitor.md` §8.7e).
   */
  save(state: GameState): boolean {
    let serialized: string;
    try {
      serialized = JSON.stringify(this.snapshot(state));
    } catch (err) {
      console.warn('[SaveManager] save failed:', err);
      return false;
    }
    this.cached = serialized;
    this.saveTimer = 0;
    this.savePending = false;
    this.scheduleFlush();
    return true;
  }

  load(): PersistentState | null {
    // `hydrate()` is awaited by `bootstrap` before this can be reached. If it
    // has not run, the honest answer is "unknown", and returning null would be
    // read as "new player" — which would hand someone a fresh account.
    if (!this.hydrated) {
      console.warn('[SaveManager] load() before hydrate(); returning null');
      return null;
    }
    const raw = this.cached;
    if (raw === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.warn('[SaveManager] load failed (parse):', err);
      this.clear();
      return null;
    }
    if (!validate(parsed)) {
      console.warn('[SaveManager] save data invalid; clearing');
      this.clear();
      return null;
    }

    this.saveTimer = 0;
    return parsed;
  }

  clear(): void {
    this.cached = null;
    this.scheduleFlush();
  }

  hasSave(): boolean {
    return this.cached !== null;
  }

  /**
   * What an absence earned (plans/economy.md §2).
   *
   * Offline repeats **one** wave — the last one the run actually completed —
   * for as long as the absence lasted. It does not advance: catching a run up
   * is one thing, setting its record depth while nobody is watching is
   * another, and the DPS walk this replaced (which climbed to `highestWave`,
   * farmed there, and was floored at 4.5 s a wave) is what let a night's sleep
   * out-earn a week of play by a factor of thirty.
   *
   * The wave *in progress* at save time is deliberately not the wave that is
   * farmed. It has never been finished, so neither its duration nor the
   * tower's ability to finish it is known; the last completed wave is the
   * deepest claim the run can actually support. `offlineWaveTarget` supplies
   * both halves — which wave, and how long one clear of it takes — from the
   * same measurement, so the two can never disagree.
   *
   * The duration is measured in *simulation* seconds while `elapsed` here is
   * wall-clock, which is what makes offline run at 1x whatever the game-speed
   * dial says: raising it shortens a wave on the wall clock, not in the
   * simulation, so it cannot buy offline income.
   *
   * `goldMultiplier` is the live composed multiplier (`Game.computeGoldMultiplier`).
   * Passing it is what stops offline income from being strictly worse than
   * active play by the whole multiplier stack.
   */
  computeOfflineProgress(
    persisted: PersistentState,
    goldMultiplier = 1,
    now: number = Date.now(),
  ): OfflineResult {
    const rawElapsed = Math.max(0, (now - persisted.savedAt) / 1000);
    const capSeconds = Math.max(0, this.getIdleCapSeconds());
    const capped = rawElapsed > capSeconds;
    const elapsed = Math.min(rawElapsed, capSeconds);

    // The last completed wave and the time it took, as one measurement. The
    // boss step-back lives inside `offlineWaveTarget`'s fallback branch — a
    // recorded sample is never a boss wave to begin with (`WaveManager`
    // excludes them), so there is nothing to step back off here.
    const timing: WaveTimingState = persisted.waveTiming ?? defaultWaveTiming();
    const inProgress = Math.max(0, persisted.wave.elapsed ?? 0);
    const { wave, seconds: waveSeconds, measured } =
      offlineWaveTarget(timing, persisted.wave.number, inProgress);
    const cycleSeconds = waveSeconds + intermissionSecondsForWave(wave);

    const lifetimeWave = persisted.stats.lifetimeHighestWave ?? 1;
    const rpGainMultiplier = computeRPGainMultiplier(persisted.research ?? {});
    const baseRPRate = 0.20 * Math.sqrt(Math.max(1, lifetimeWave)) / 60;
    const rpEarned = Math.max(0, Math.floor(baseRPRate * (1 + rpGainMultiplier) * elapsed));

    if (elapsed <= 0 || cycleSeconds <= 0) {
      return {
        elapsedSeconds: elapsed,
        capped,
        maxIdleSeconds: capSeconds,
        wave,
        waveSeconds,
        waveRepeats: 0,
        measured,
        goldEarned: 0,
        rpEarned: elapsed > 0 ? rpEarned : 0,
        researchElapsed: Math.max(0, elapsed),
        xpEarned: 0,
        passiveXpEarned: 0,
      };
    }

    // The fraction is deliberate: an absence of 1.5 wave-cycles pays 1.5 waves
    // of income, not 1. Truncating would make short absences pay nothing at
    // depth, where a single wave is minutes long.
    const waveRepeats = Math.min(MAX_OFFLINE_WAVE_REPEATS, elapsed / cycleSeconds);

    const count = Math.max(1, Math.floor(spawnCountForWave(wave)));
    const perWaveGold = averageKillGoldForWave(wave) * count * Math.max(0, goldMultiplier);
    // The clear payout is part of what a wave pays, so a *completed* wave has
    // to include it. The old walk paid kills only.
    const perWaveXp = averageKillXPForWave(wave) * count + xpPerWaveClear(wave);
    const perWavePassiveXp =
      passiveXpPerKill('normal', wave) * count + passiveXpPerWaveClear(wave);

    // No pioneer bonus: a repeated wave is never a record.
    const yieldFraction = OFFLINE_YIELD_FRACTION * (measured ? 1 : UNMEASURED_WAVE_PENALTY);
    const scale = waveRepeats * yieldFraction;

    return {
      elapsedSeconds: elapsed,
      capped,
      maxIdleSeconds: capSeconds,
      wave,
      waveSeconds,
      waveRepeats,
      measured,
      goldEarned: Math.max(0, Math.floor(perWaveGold * scale)),
      rpEarned,
      researchElapsed: elapsed,
      xpEarned: Math.max(0, Math.floor(perWaveXp * scale)),
      passiveXpEarned: Math.max(0, perWavePassiveXp * scale),
    };
  }

  applyOfflineProgress(
    state: GameState,
    result: OfflineResult,
    passives: PassiveAbilityManager,
  ): void {
    if (result.goldEarned > 0) {
      state.resources.gold += result.goldEarned;
      state.resources.lifetimeGold += result.goldEarned;
      state.stats.goldEarned += result.goldEarned;
    }
    if (result.xpEarned > 0) {
      state.towerXp.xp += result.xpEarned;
      state.towerXp.totalXpEarned += result.xpEarned;
      const newLevel = xpToLevel(state.towerXp.xp);
      if (newLevel > state.towerXp.level) {
      // Grant exactly the delta in total points owed between the two levels.
      // The previous reconciliation (comparing against `level - 1 + unspent`)
      // assumed one point per level and silently under-granted as soon as the
      // curve stopped being the identity.
        state.towerXp.unspentTalentPoints +=
          talentPointsAtLevel(newLevel) - talentPointsAtLevel(state.towerXp.level);
        state.towerXp.level = newLevel;
      }
    }
    // Advance ability cooldowns by elapsed time
    for (const ability of Object.values(state.abilities)) {
      ability.cooldown = Math.max(0, ability.cooldown - result.elapsedSeconds);
    }
    // Passive XP was accumulated by the offline walk itself, so it is priced at
    // the depths that walk actually reached. It used to be re-derived here by
    // walking `wavesCleared` waves *forward from the current wave with no
    // ceiling* — the walk caps at the run's deepest wave and farms there, so a
    // long absence at wave 15 was being paid as if it had cleared waves 15
    // through 5015. Since per-wave passive XP grows with the square of depth,
    // that single mismatch was worth thousands of times the real payout and
    // maxed every unlocked passive in a night.
    if (result.passiveXpEarned > 0) passives.addRawXp(result.passiveXpEarned);
  }

  /**
   * Mark the state as changed without writing it (plan §5.7). The write
   * happens in `tick`, no sooner than `SAVE_DEBOUNCE_SECONDS` after the last
   * one. Use `save` directly for anything that must survive an immediate
   * close, such as the tab going hidden.
   */
  requestSave(): void {
    this.savePending = true;
  }

  /** Whether a requested save is still waiting to be flushed. */
  get hasPendingSave(): boolean {
    return this.savePending;
  }

  tick(dt: number, state: GameState, onSave: (state: GameState) => boolean): void {
    this.saveTimer += dt;
    const due = this.savePending
      ? this.saveTimer >= SAVE_DEBOUNCE_SECONDS
      : this.saveTimer >= AUTO_SAVE_INTERVAL;
    if (!due) return;
    this.saveTimer = 0;
    this.savePending = false;
    onSave(state);
  }
}
