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
const SAVE_VERSION = 8;

function defaultWaveModifier() {
  return { active: null, choiceForNextWave: null, pendingChoiceForWave: null, goldSnapshot: null };
}
const AUTO_SAVE_INTERVAL = 30;
const OFFLINE_CAP_SECONDS = 7 * 24 * 60 * 60;
const OFFLINE_EFFICIENCY = 0.5;
const AVG_WAVE_DURATION = 18;

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

function estimateGoldPerDamage(wave: number): number {
  const def = ENEMY_DEFS.normal;
  const hp = enemyHPForWave(def.baseHP, wave);
  const gold = goldDropForWave(def.baseGold, wave);
  if (hp <= 0) return 0;
  return gold / hp;
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

function validate(data: unknown): data is PersistentState {
  if (!isObject(data)) return false;

  if (data.version !== SAVE_VERSION && data.version !== 7 && data.version !== 6 && data.version !== 5 && data.version !== 4 && data.version !== 3 && data.version !== 2) return false;

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

  // Ensure fallback fields exist (applies to all versions)
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.runHistory)) d.runHistory = [];
  if (typeof d.runStartedAt !== 'number') d.runStartedAt = Date.now();
  if (typeof d.rp !== 'number') d.rp = 0;
  const wave = d.wave as Record<string, unknown> | undefined;
  if (wave && !isObject(wave.waveModifier)) wave.waveModifier = defaultWaveModifier();

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

  computeOfflineProgress(persisted: PersistentState, now: number = Date.now()): OfflineResult {
    const rawElapsed = Math.max(0, (now - persisted.savedAt) / 1000);
    const capped = rawElapsed > OFFLINE_CAP_SECONDS;
    const elapsed = Math.min(rawElapsed, OFFLINE_CAP_SECONDS);
    if (elapsed <= 0) {
      return {
        elapsedSeconds: 0,
        capped,
        effectiveDPS: 0,
        goldEarned: 0,
        wavesCleared: 0,
        rpEarned: 0,
        researchElapsed: 0,
        xpEarned: 0,
      };
    }
    const dps = estimateDPS(persisted.tower);
    const effectiveDPS = dps * OFFLINE_EFFICIENCY;
    let wave = Math.max(1, persisted.wave.number);
    if (isBossWave(wave)) --wave;

    const goldPerDmg = estimateGoldPerDamage(wave);
    const goldEarned = Math.max(0, Math.floor(effectiveDPS * elapsed * goldPerDmg));
    const wavesCleared = Math.max(0, Math.floor(elapsed / AVG_WAVE_DURATION));
    const avgXp = averageKillXPForWave(wave);
    const avgHp = averageKillHPForWave(wave);
    const xpPerDmg = avgHp > 0 ? avgXp / avgHp : 0;
    const xpEarned = Math.max(0, Math.floor(effectiveDPS * elapsed * xpPerDmg)) * 0.5;
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
      while (state.towerXp.level < newLevel) {
        state.towerXp.level += 1;
        const expectedPoints = talentPointsAtLevel(state.towerXp.level);
        const currentTotal = state.towerXp.level - 1 + state.towerXp.unspentTalentPoints;
        if (expectedPoints > currentTotal) {
          state.towerXp.unspentTalentPoints += expectedPoints - currentTotal;
        } else {
          state.towerXp.unspentTalentPoints += 1;
        }
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
