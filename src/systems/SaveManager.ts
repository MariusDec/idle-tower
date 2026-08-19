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
} from '../types';
import { MAX_RUN_HISTORY } from '../types';
import { enemyHPForWave, bossHPForWave, goldDropForWave, spawnCountForWave, isBossWave } from '../data/formulas';
import { ENEMY_DEFS } from '../data/enemies';
import { PASSIVE_ABILITIES } from '../data/passiveAbilities';
import { xpPerKill, xpToLevel, talentPointsAtLevel, passiveXpForLevel } from '../data/xpTables';

const STORAGE_KEY = 'the-tower-save';
const SAVE_VERSION = 9;

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
const OFFLINE_CAP_SECONDS = 7 * 24 * 60 * 60;
const OFFLINE_EFFICIENCY = 0.5;
const AVG_WAVE_DURATION = 18;
/**
 * Ceiling on how many waves the offline walk simulates in one absence. Seven
 * days at a quarter of `AVG_WAVE_DURATION` is ~134k waves; the cap keeps a
 * long absence from turning into a long loop for a result nobody can read.
 */
const MAX_OFFLINE_WAVES = 5000;
/** Offline XP is worth half a kill, matching the pre-existing 0.5 factor. */
const OFFLINE_XP_EFFICIENCY = 0.5;

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
}

export interface OfflineResult {
  elapsedSeconds: number;
  capped: boolean;
  effectiveDPS: number;
  goldEarned: number;
  wavesCleared: number;
  /** Wave the offline simulation ended on, so the report can show real progress. */
  endWave: number;
  rpEarned: number;
  researchElapsed: number;
  xpEarned: number;
}

function isStorageAvailable(): boolean {
  try {
    const probe = '__the_tower_probe__';
    localStorage.setItem(probe, probe);
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function estimateDPS(tower: TowerState): number {
  const expectedHit = tower.baseDamage * (1 + tower.critChance * (tower.critMultiplier - 1));
  return Math.max(0, expectedHit * tower.fireRate);
}

function averageKillXPForWave(wave: number): number {
  if (isBossWave(wave)) return xpPerKill('boss', wave);
  const available: EnemyType[] = ['normal'];
  if (wave >= 3) available.push('fast');
  if (wave >= 5) available.push('tank');
  if (wave >= 8) available.push('flying');
  if (wave >= 12) available.push('splitter');
  if (wave >= 15) available.push('healer');
  if (wave >= 20) available.push('shielded');
  const weights: Record<EnemyType, number> = {
    normal: 6, fast: 3, tank: 2, flying: 2, healer: 1, splitter: 2, shielded: 1, boss: 0,
  };
  let totalWeight = 0;
  let weightedXp = 0;
  for (const t of available) {
    totalWeight += weights[t];
    weightedXp += weights[t] * xpPerKill(t, wave);
  }
  return totalWeight > 0 ? weightedXp / totalWeight : 0;
}

function averageKillGoldForWave(wave: number): number {
  if (isBossWave(wave)) return goldDropForWave(ENEMY_DEFS.boss.baseGold, wave);
  const available: EnemyType[] = ['normal'];
  if (wave >= 3) available.push('fast');
  if (wave >= 5) available.push('tank');
  if (wave >= 8) available.push('flying');
  if (wave >= 12) available.push('splitter');
  if (wave >= 15) available.push('healer');
  if (wave >= 20) available.push('shielded');
  const weights: Record<EnemyType, number> = {
    normal: 6, fast: 3, tank: 2, flying: 2, healer: 1, splitter: 2, shielded: 1, boss: 0,
  };
  let totalWeight = 0;
  let weightedGold = 0;
  for (const t of available) {
    totalWeight += weights[t];
    weightedGold += weights[t] * goldDropForWave(ENEMY_DEFS[t].baseGold, wave);
  }
  return totalWeight > 0 ? weightedGold / totalWeight : 0;
}

function averageKillHPForWave(wave: number): number {
  if (isBossWave(wave)) return bossHPForWave(ENEMY_DEFS.boss.baseHP, wave);
  const available: EnemyType[] = ['normal'];
  if (wave >= 3) available.push('fast');
  if (wave >= 5) available.push('tank');
  if (wave >= 8) available.push('flying');
  if (wave >= 12) available.push('splitter');
  if (wave >= 15) available.push('healer');
  if (wave >= 20) available.push('shielded');
  const weights: Record<EnemyType, number> = {
    normal: 6, fast: 3, tank: 2, flying: 2, healer: 1, splitter: 2, shielded: 1, boss: 0,
  };
  let totalWeight = 0;
  let weightedHp = 0;
  for (const t of available) {
    totalWeight += weights[t];
    weightedHp += weights[t] * enemyHPForWave(ENEMY_DEFS[t].baseHP, wave);
  }
  return totalWeight > 0 ? weightedHp / totalWeight : 0;
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
  data.towerXp = data.towerXp ?? { xp: 0, level: 0, unspentTalentPoints: 0, totalXpEarned: 0 };
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
    const basePerLevel = 0.25;
    if (lvl >= 10) sum += 5.0;
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

function validate(data: unknown): data is PersistentState {
  if (!isObject(data)) return false;

  if (data.version !== SAVE_VERSION && data.version !== 8 && data.version !== 7 && data.version !== 6 && data.version !== 5 && data.version !== 4 && data.version !== 3 && data.version !== 2) return false;

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

  return true;
}

export class SaveManager {
  private saveTimer = 0;
  private readonly busListener: (payload: unknown) => void;
  private readonly getRP: () => number;

  constructor(
    bus: { on: (event: string, h: (payload: unknown) => void) => void },
    opts: { getRP?: () => number } = {},
  ) {
    this.busListener = (payload) => {
      const p = payload as { success: boolean };
      if (p && p.success === false) {
        console.warn('[SaveManager] save reported failure');
      }
    };
    bus.on('save_failed', this.busListener);
    this.getRP = opts.getRP ?? (() => 0);
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

  save(state: GameState): boolean {
    if (!isStorageAvailable()) {
      return false;
    }
    try {
      const snap = this.snapshot(state);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
      this.saveTimer = 0;
      return true;
    } catch (err) {
      console.warn('[SaveManager] save failed:', err);
      return false;
    }
  }

  load(): PersistentState | null {
    if (!isStorageAvailable()) return null;
    let raw: string | null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      console.warn('[SaveManager] load failed (read):', err);
      return null;
    }
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
    if (!isStorageAvailable()) return;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  hasSave(): boolean {
    if (!isStorageAvailable()) return false;
    try {
      return localStorage.getItem(STORAGE_KEY) !== null;
    } catch {
      return false;
    }
  }

  /**
   * Estimate what the tower did while the tab was closed (plan §4.4/§4.5).
   *
   * The wave count used to be `elapsed / AVG_WAVE_DURATION` — a clock reading
   * with no connection to whether the tower could actually kill anything —
   * while gold came from a single wave's gold-per-damage ratio held constant
   * for the whole absence. Both are now derived from one wave-by-wave walk at
   * the tower's estimated DPS, so a tower parked at its wall clears nothing
   * and a tower with headroom climbs back up.
   *
   * The walk stops advancing at the player's deepest wave and farms there
   * instead: offline play catches you up, it does not set records. Nothing
   * here models the tower *dying*, so letting it push past its best would
   * hand out depth the player never earned.
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
    const capped = rawElapsed > OFFLINE_CAP_SECONDS;
    const elapsed = Math.min(rawElapsed, OFFLINE_CAP_SECONDS);
    let wave = Math.max(1, persisted.wave.number);
    if (isBossWave(wave)) --wave;
    if (elapsed <= 0) {
      return {
        elapsedSeconds: 0,
        capped,
        effectiveDPS: 0,
        goldEarned: 0,
        wavesCleared: 0,
        endWave: wave,
        rpEarned: 0,
        researchElapsed: 0,
        xpEarned: 0,
      };
    }
    const dps = estimateDPS(persisted.tower);
    const effectiveDPS = dps * OFFLINE_EFFICIENCY;
    // The ceiling is *this run's* deepest wave, not the lifetime best: after an
    // ascension the lifetime figure can be far beyond anything the current
    // tower has faced, and while the DPS walk would gate most of that, nothing
    // here models the tower taking damage. Catching the run back up to where
    // it already was is the claim this estimate can actually support.
    const ceiling = Math.max(wave, persisted.wave.highestWave ?? wave);

    let remaining = elapsed;
    let gold = 0;
    let xp = 0;
    let wavesCleared = 0;
    const goldScale = Math.max(0, goldMultiplier);
    while (remaining > 0 && effectiveDPS > 0 && wavesCleared < MAX_OFFLINE_WAVES) {
      const count = Math.max(1, Math.floor(spawnCountForWave(wave)));
      const avgHp = averageKillHPForWave(wave);
      const waveHp = avgHp * count;
      if (waveHp <= 0) break;
      // A wave cannot finish faster than its enemies spawn, so a tower that
      // vastly out-damages the wave is still paced by the spawn cadence.
      const waveSeconds = Math.max(waveHp / effectiveDPS, AVG_WAVE_DURATION * 0.25);
      const avgGold = averageKillGoldForWave(wave);
      const avgXp = averageKillXPForWave(wave);
      if (waveSeconds > remaining) {
        // Ran out of time partway through: pay out the fraction of the wave's
        // HP that was actually chewed through.
        const fraction = remaining / waveSeconds;
        gold += avgGold * count * fraction * goldScale;
        xp += avgXp * count * fraction * OFFLINE_XP_EFFICIENCY;
        break;
      }
      gold += avgGold * count * goldScale;
      xp += avgXp * count * OFFLINE_XP_EFFICIENCY;
      remaining -= waveSeconds;
      wavesCleared += 1;
      if (wave < ceiling) wave += 1;
    }

    const goldEarned = Math.max(0, Math.floor(gold));
    const xpEarned = Math.max(0, Math.floor(xp));
    const lifetimeWave = persisted.stats.lifetimeHighestWave ?? 1;
    const rpGainMultiplier = computeRPGainMultiplier(persisted.research ?? {});
    const baseRPRate = 0.05 * lifetimeWave / 60;
    const rpEarned = Math.max(0, Math.floor(baseRPRate * (1 + rpGainMultiplier) * elapsed));
    return {
      elapsedSeconds: elapsed,
      capped,
      effectiveDPS,
      goldEarned,
      wavesCleared,
      endWave: wave,
      rpEarned,
      researchElapsed: elapsed,
      xpEarned,
    };
  }

  applyOfflineProgress(state: GameState, result: OfflineResult): void {
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
    // Grant passive ability XP for each estimated wave cleared
    if (result.wavesCleared > 0) {
      let wave = Math.max(1, state.wave.number);
      if (isBossWave(wave)) --wave;
      for (let w = wave; w < wave + result.wavesCleared; w++) {
        const enemyCount = Math.max(1, Math.floor(spawnCountForWave(w)));
        for (const def of PASSIVE_ABILITIES) {
          const pa = state.passiveAbilities[def.id];
          if (!pa || !pa.unlocked || pa.level >= def.maxLevel) continue;
          pa.xp += (def.xpPerKill * enemyCount + def.xpPerWave) * 0.1;
          while (pa.level < def.maxLevel) {
            const needed = passiveXpForLevel(pa.level + 1);
            if (pa.xp < needed) break;
            pa.xp -= needed;
            pa.level += 1;
          }
        }
      }
    }
  }

  tick(dt: number, state: GameState, onSave: (state: GameState) => boolean): void {
    this.saveTimer += dt;
    if (this.saveTimer >= AUTO_SAVE_INTERVAL) {
      this.saveTimer = 0;
      onSave(state);
    }
  }
}
