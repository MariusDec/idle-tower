import type { EnemyType, AuraType, WaveState } from '../types';
import {
  enemyCountForWave,
  spawnCountForWave,
  isBossWave,
  spawnIntervalForWave,
} from '../data/formulas';
import { ENEMY_DEFS } from '../data/enemies';
import type { EnemyManager } from './EnemyManager';
import { eliteChanceForWave } from './EnemyManager';
import { randomBetween } from '../utils/math';
import { EventBus } from '../game/EventBus';

const ALL_AURAS: AuraType[] = ['haste', 'thorns', 'greed', 'vitality', 'retribution'];

export const WAVE_INTERMISSION = 5;

export class WaveManager {
  private state: WaveState;
  private readonly bus: EventBus;
  private readonly enemies: EnemyManager;
  private readonly width: number;
  private readonly height: number;
  private readonly onWaveCleared: (wave: number) => void;
  private readonly onWaveStarted: (wave: number) => void;
  private waveSkipChance = 0;
  private intermissionMultiplier = 1;
  /** Multiplier applied to enemiesToSpawn on the next startWave (default 1). */
  private enemyCountMult = 1;
  /** Pause flag for the intermission timer (used by the wave modifier modal). */
  private intermissionPaused = false;
  /** Pause flag for enemy spawning (used when a boss wave modifier modal is open). */
  private spawnPaused = false;

  constructor(
    bus: EventBus,
    enemies: EnemyManager,
    width: number,
    height: number,
    onWaveCleared: (wave: number) => void,
    onWaveStarted: (wave: number) => void,
  ) {
    this.bus = bus;
    this.enemies = enemies;
    this.width = width;
    this.height = height;
    this.onWaveCleared = onWaveCleared;
    this.onWaveStarted = onWaveStarted;
    this.state = this.makeInitialState();
  }

  setWaveSkipChance(chance: number): void {
    this.waveSkipChance = Math.max(0, Math.min(1, chance));
  }

  setIntermissionMultiplier(mult: number): void {
    this.intermissionMultiplier = Math.max(0.1, Math.min(1, mult));
  }

  /**
   * Pause the intermission timer (used while a modal is open so the player
   * has time to read the choices). Spawning and combat are unaffected.
   */
  pauseIntermission(): void {
    this.intermissionPaused = true;
  }

  /** Pause enemy spawning (used when a boss wave modifier modal is open). */
  pauseSpawning(): void {
    this.spawnPaused = true;
  }

  /** Resume enemy spawning after a boss wave modifier modal is closed. */
  resumeSpawning(): void {
    this.spawnPaused = false;
  }

  resumeIntermission(): void {
    this.intermissionPaused = false;
  }

  isIntermissionPaused(): boolean {
    return this.intermissionPaused;
  }

  /**
   * Multiplier applied to the next wave's enemy count. Used by the
   * wave modifier system (e.g. Swarm = 3×). Set to 1 to reset.
   */
  setEnemyCountMult(mult: number): void {
    this.enemyCountMult = Math.max(0.1, mult);
  }

  get snapshot(): WaveState {
    return this.state;
  }

  get currentWave(): number {
    return this.state.number;
  }

  private makeInitialState(): WaveState {
    return {
      number: 1,
      highestWave: 1,
      spawning: true,
      enemiesSpawned: 0,
      enemiesToSpawn: enemyCountForWave(1),
      spawnInterval: spawnIntervalForWave(1),
      spawnTimer: 0.5,
      intermission: false,
      intermissionTimer: 0,
      autoProgress: true,
      waveModifier: { active: null, choiceForNextWave: null, pendingChoiceForWave: null, goldSnapshot: null },
    };
  }

  private pickEnemyType(wave: number): EnemyType {
    const available: EnemyType[] = ['normal'];
    if (wave >= 3) available.push('fast');
    if (wave >= 5) available.push('tank');
    if (wave >= 8) available.push('flying');
    if (wave >= 12) available.push('splitter');
    if (wave >= 15) available.push('healer');
    if (wave >= 20) available.push('shielded');

    if (isBossWave(wave)) {
      return 'boss';
    }

    const weights: number[] = available.map(t => {
      if (t === 'normal') return 6;
      if (t === 'fast') return 3;
      if (t === 'tank') return 2;
      if (t === 'flying') return 2;
      if (t === 'healer') return 1;
      if (t === 'splitter') return 2;
      if (t === 'shielded') return 1;
      return 1;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < available.length; i++) {
      r -= weights[i];
      if (r <= 0) return available[i];
    }
    return 'normal';
  }

  private spawnPointOnEdge(): { x: number; y: number } {
    const side = Math.floor(Math.random() * 4);
    const w = this.width;
    const h = this.height;
    if (side === 0) return { x: randomBetween(0, w), y: -20 };
    if (side === 1) return { x: w + 20, y: randomBetween(0, h) };
    if (side === 2) return { x: randomBetween(0, w), y: h + 20 };
    return { x: -20, y: randomBetween(0, h) };
  }

  startWave(wave: number): void {
    this.state.number = wave;

    if (!isBossWave(wave) && this.waveSkipChance > 0 && Math.random() < this.waveSkipChance) {
      this.state.enemiesToSpawn = 0;
      this.state.enemiesSpawned = 0;
      this.state.spawnInterval = 0;
      this.state.spawnTimer = 0;
      this.state.spawning = false;
      this.state.intermission = true;
      this.state.intermissionTimer = WAVE_INTERMISSION * this.intermissionMultiplier;
      this.onWaveCleared(wave);
      this.bus.emit('wave_cleared', wave);
      this.bus.emit('toast', { kind: 'milestone', text: `Wave ${wave} skipped!`, life: 2 });
      return;
    }

    this.state.enemiesToSpawn = Math.max(1, Math.floor(spawnCountForWave(wave) * this.enemyCountMult));
    this.state.enemiesSpawned = 0;
    this.state.spawnInterval = spawnIntervalForWave(wave);
    this.state.spawnTimer = 0.5;
    this.state.spawning = true;
    this.state.intermission = false;
    this.onWaveStarted(wave);
    this.bus.emit('wave_started', wave);
    // For boss waves, present the modifier picker now so the player sees it
    // when the stage starts rather than during the previous intermission.
    if (isBossWave(wave)) {
      if (Math.random() < 0.5) { // 50% chance for wave modifiers to appear during boss waves
        return;
      }
      this.spawnPaused = true;
      this.bus.emit('wave_modifier_offer', wave);
    } else if (Math.random() < 0.04) { // 4% chance for wave modifiers to appear during normal waves
      this.spawnPaused = true;
      this.bus.emit('wave_modifier_offer', wave);
    }
  }

  reset(): void {
    this.state = this.makeInitialState();
    this.enemyCountMult = 1;
    this.bus.emit('wave_started', this.state.number);
    this.onWaveStarted(this.state.number);
  }

  startAtWave(wave: number): void {
    const target = Math.max(1, Math.floor(wave));
    const highestWave = Math.max(this.state.highestWave, target);

    this.state = {
      number: target,
      highestWave: highestWave,
      spawning: true,
      enemiesSpawned: 0,
      enemiesToSpawn: spawnCountForWave(target),
      spawnInterval: spawnIntervalForWave(target),
      spawnTimer: 0.4,
      intermission: false,
      intermissionTimer: 0,
      autoProgress: this.state.autoProgress,
      waveModifier: { active: null, choiceForNextWave: null, pendingChoiceForWave: null, goldSnapshot: null },
    };
    this.enemyCountMult = 1;
    this.bus.emit('wave_started', this.state.number);
    this.onWaveStarted(this.state.number);
  }

  goToPrevWave(): boolean {
    if (this.state.number <= 1) return false;
    const prev = this.state.number - 1;
    this.enemies.reset();
    this.startWave(prev);
    return true;
  }

  goToNextWave(): boolean {
    this.enemies.reset();
    this.startWave(this.state.number + 1);
    return true;
  }

  setAutoProgress(enabled: boolean): void {
    this.state.autoProgress = enabled;
  }

  toggleAutoProgress(): boolean {
    this.state.autoProgress = !this.state.autoProgress;
    return this.state.autoProgress;
  }

  getAutoProgress(): boolean {
    return this.state.autoProgress;
  }

  canGoPrev(): boolean {
    return this.state.number > 1;
  }

  setState(s: WaveState): void {
    this.state = { ...s };
  }

  tick(dt: number): void {
    if (this.state.intermission) {
      if (!this.intermissionPaused) {
        this.state.intermissionTimer -= dt;
        if (this.state.intermissionTimer <= 0) {
          const forceAdvance = isBossWave(this.state.number);
          this.startWave(this.state.number + (this.state.autoProgress || forceAdvance ? 1 : 0));
        }
      }
      return;
    }

    if (this.state.spawning && !this.spawnPaused) {
      this.state.spawnTimer -= dt;
      while (this.state.spawning && this.state.spawnTimer <= 0) {
        this.spawnOne();
        this.state.spawnTimer += this.state.spawnInterval;
      }
    }

    if (
      !this.state.spawning &&
      this.state.enemiesSpawned >= this.state.enemiesToSpawn &&
      this.enemies.aliveCount() === 0
    ) {
      const clearedWave = this.state.number;
      this.onWaveCleared(clearedWave);
      this.bus.emit('wave_cleared', clearedWave);
      this.state.intermission = true;
      this.state.intermissionTimer = WAVE_INTERMISSION * this.intermissionMultiplier;
    }
  }

  private spawnOne(): void {
    if (this.state.enemiesSpawned >= this.state.enemiesToSpawn) {
      this.state.spawning = false;
      return;
    }
    const type = this.pickEnemyType(this.state.number);
    const { x, y } = this.spawnPointOnEdge();
    const wave = this.state.number;
    // Elite roll: wave >= 21, not bosses, linear 2%→8% chance
    if (wave >= 21 && type !== 'boss' && Math.random() < eliteChanceForWave(wave)) {
      const aura = ALL_AURAS[Math.floor(Math.random() * ALL_AURAS.length)];
      this.enemies.spawnElite(type, wave, x, y, aura);
    } else {
      this.enemies.spawn(type, wave, x, y);
    }
    this.state.enemiesSpawned += 1;
    if (this.state.enemiesSpawned >= this.state.enemiesToSpawn) {
      this.state.spawning = false;
    }
  }
}

export function getEnemyColor(type: EnemyType): string {
  return ENEMY_DEFS[type].color;
}
