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
} from '../types';
import { MAX_RUN_HISTORY } from '../types';
import { enemyHPForWave, goldDropForWave } from '../data/formulas';
import { ENEMY_DEFS } from '../data/enemies';
import { PASSIVE_ABILITIES } from '../data/passiveAbilities';

const STORAGE_KEY = 'the-tower-save';
const SAVE_VERSION = 6;

function defaultWaveModifier() {
  return { active: null, choiceForNextWave: null, pendingChoiceForWave: null, goldSnapshot: null };
}
const AUTO_SAVE_INTERVAL = 30;
const OFFLINE_CAP_SECONDS = 7 * 24 * 60 * 60;
const OFFLINE_EFFICIENCY = 0.7;
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

  if (data.version !== SAVE_VERSION && data.version !== 5 && data.version !== 4 && data.version !== 3 && data.version !== 2) return false;

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
      out[id] = { level: passives[id].level, xp: passives[id].xp };
    }
    return out;
  }

  private snapshotAbilities(abilities: Record<string, AbilityState>): Record<string, AbilityState> {
    const out: Record<string, AbilityState> = {};
    for (const id of Object.keys(abilities)) {
      const a = abilities[id];
      out[id] = { level: a.level, cooldown: 0, active: false, activeTimer: 0 };
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
      };
    }
    const dps = estimateDPS(persisted.tower);
    const effectiveDPS = dps * OFFLINE_EFFICIENCY;
    const wave = Math.max(1, persisted.wave.number);
    const goldPerDmg = estimateGoldPerDamage(wave);
    const goldEarned = Math.max(0, Math.floor(effectiveDPS * elapsed * goldPerDmg));
    const wavesCleared = Math.max(0, Math.floor(elapsed / AVG_WAVE_DURATION));
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
    };
  }

  applyOfflineProgress(state: GameState, result: OfflineResult): void {
    if (result.goldEarned > 0) {
      state.resources.gold += result.goldEarned;
      state.resources.lifetimeGold += result.goldEarned;
      state.stats.goldEarned += result.goldEarned;
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
