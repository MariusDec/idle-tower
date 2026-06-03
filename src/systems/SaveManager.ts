import type {
  GameState,
  TowerState,
  ResourceState,
  WaveState,
  AbilityState,
  PrestigeState,
  GameStats,
} from '../types';
import { enemyHPForWave, goldDropForWave } from '../data/formulas';
import { ENEMY_DEFS } from '../data/enemies';

const STORAGE_KEY = 'the-tower-save';
const SAVE_VERSION = 2;
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
  research: string[];
  abilities: Record<string, AbilityState>;
  prestige: PrestigeState;
  wave: WaveState;
  stats: GameStats;
}

export interface OfflineResult {
  elapsedSeconds: number;
  capped: boolean;
  effectiveDPS: number;
  goldEarned: number;
  wavesCleared: number;
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

function validate(data: unknown): data is PersistentState {
  if (!isObject(data)) return false;
  if (data.version !== SAVE_VERSION) return false;
  if (typeof data.savedAt !== 'number') return false;
  if (!isObject(data.tower)) return false;
  if (!isObject(data.resources)) return false;
  if (!isObject(data.upgrades)) return false;
  if (!Array.isArray(data.research)) return false;
  if (!isObject(data.abilities)) return false;
  if (!isObject(data.prestige)) return false;
  if (!isObject(data.wave)) return false;
  if (!isObject(data.stats)) return false;
  return true;
}

export class SaveManager {
  private saveTimer = 0;
  private readonly busListener: (payload: unknown) => void;

  constructor(bus: { on: (event: string, h: (payload: unknown) => void) => void }) {
    this.busListener = (payload) => {
      const p = payload as { success: boolean };
      if (p && p.success === false) {
        console.warn('[SaveManager] save reported failure');
      }
    };
    bus.on('save_failed', this.busListener);
  }

  snapshot(state: GameState): PersistentState {
    return {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      tower: { ...state.tower },
      resources: { ...state.resources },
      upgrades: { ...state.upgrades },
      research: [...state.research],
      abilities: this.snapshotAbilities(state.abilities),
      prestige: this.snapshotPrestige(state.prestige),
      wave: { ...state.wave },
      stats: { ...state.stats },
    };
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
      };
    }
    const dps = estimateDPS(persisted.tower);
    const effectiveDPS = dps * OFFLINE_EFFICIENCY;
    const wave = Math.max(1, persisted.wave.number);
    const goldPerDmg = estimateGoldPerDamage(wave);
    const goldEarned = Math.max(0, Math.floor(effectiveDPS * elapsed * goldPerDmg));
    const wavesCleared = Math.max(0, Math.floor(elapsed / AVG_WAVE_DURATION));
    return {
      elapsedSeconds: elapsed,
      capped,
      effectiveDPS,
      goldEarned,
      wavesCleared,
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
