import type { EnemyType, AuraType, WaveState } from '../types';
import {
  enemyCountForWave,
  spawnCountForWave,
  isBossWave,
  spawnIntervalForWave,
  enrageStacksFor,
  ENRAGE_DAMAGE_PER_STACK,
  ENRAGE_SPEED_PER_STACK,
  ENRAGE_STACK_INTERVAL,
} from '../data/formulas';
import { ENEMY_BEHAVIOR, ENEMY_DEFS, spawnPoolForWave } from '../data/enemies';
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
  /** Plan §2.4: at most one thief per wave. */
  private thiefSpawnedThisWave = false;

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
      waveModifier: { active: null, choiceForNextWave: null, pendingChoiceForWave: null, goldSnapshot: null, wavesRemaining: 0, wavesCleared: 0 },
      elapsed: 0,
      enrageStacks: 0,
    };
  }

  /**
   * Roll one enemy type from the weighted pool (plan §2.4).
   *
   * The weights live in `ENEMY_SPAWN_WEIGHTS` rather than here, because the
   * offline-progress estimates in `SaveManager` and the balance model in
   * `sim/model.ts` have to draw from the same table — three hand-copied weight
   * maps is how a balance change lands in the game but not in the model that is
   * supposed to be measuring it.
   *
   * The one exception is the thief: capped at one per wave, because two thieves
   * is a tax on the treasury rather than a threat to answer.
   */
  private pickEnemyType(wave: number): EnemyType {
    if (isBossWave(wave)) {
      return 'boss';
    }

    const pool = spawnPoolForWave(wave);
    let total = 0;
    for (const { type, weight } of pool) {
      if (type === 'thief' && this.thiefSpawnedThisWave) continue;
      total += weight;
    }
    if (total <= 0) return 'normal';
    let r = Math.random() * total;
    for (const { type, weight } of pool) {
      if (type === 'thief' && this.thiefSpawnedThisWave) continue;
      r -= weight;
      if (r <= 0) return type;
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
    this.thiefSpawnedThisWave = false;
    // Resets the wave's 15% theft ceiling as well as the manager's notion of
    // which wave is running (plan §2.6).
    this.enemies.beginWave(wave);

    if (!isBossWave(wave) && this.waveSkipChance > 0 && Math.random() < this.waveSkipChance) {
      this.state.enemiesToSpawn = 0;
      this.state.enemiesSpawned = 0;
      this.state.spawnInterval = 0;
      this.state.spawnTimer = 0;
      this.state.spawning = false;
      this.state.intermission = true;
      this.state.intermissionTimer = WAVE_INTERMISSION * this.intermissionMultiplier;
      this.state.elapsed = 0;
      this.state.enrageStacks = 0;
      this.clearEnrage();
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
    this.state.elapsed = 0;
    this.state.enrageStacks = 0;
    this.clearEnrage();
    this.onWaveStarted(wave);
    this.bus.emit('wave_started', wave);
    // Plan §3.3: a mutator runs for several waves now, so no new offer while one
    // is still running — otherwise the picker would interrupt its own streak.
    if (this.state.waveModifier.wavesRemaining > 0) return;
    // Every boss wave offers a mutator. It used to be a 50% roll, which meant
    // the one recurring decision point in a run showed up on no schedule the
    // player could anticipate; a guaranteed offer every tenth wave turns it
    // into a rhythm.
    if (isBossWave(wave)) {
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
    this.thiefSpawnedThisWave = false;
    this.enemies.beginWave(this.state.number);
    this.clearEnrage();
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
      waveModifier: { active: null, choiceForNextWave: null, pendingChoiceForWave: null, goldSnapshot: null, wavesRemaining: 0, wavesCleared: 0 },
      elapsed: 0,
      enrageStacks: 0,
    };
    this.clearEnrage();
    this.enemyCountMult = 1;
    this.thiefSpawnedThisWave = false;
    this.enemies.beginWave(target);
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
    this.state = { ...s, elapsed: s.elapsed ?? 0, enrageStacks: s.enrageStacks ?? 0 };
    this.applyEnrage();
  }

  /** Drop any enrage buff currently applied to the field. */
  private clearEnrage(): void {
    this.enemies.setEnrage(1, 1);
  }

  /** Push the current stack count onto the enemy manager. */
  private applyEnrage(): void {
    const stacks = this.state.enrageStacks;
    this.enemies.setEnrage(
      1 + ENRAGE_DAMAGE_PER_STACK * stacks,
      1 + ENRAGE_SPEED_PER_STACK * stacks,
    );
  }

  /**
   * Advance the wave clock and escalate enrage when the wave overruns
   * (plan §2.3.3). Enrage is what converts an unwinnable wave from an
   * endless stall into a decisive loss.
   */
  private tickEnrage(dt: number): void {
    this.state.elapsed += dt;
    const stacks = enrageStacksFor(
      this.state.number,
      this.state.elapsed,
      this.state.enemiesToSpawn,
    );
    if (stacks === this.state.enrageStacks) return;
    const wasCalm = this.state.enrageStacks === 0;
    this.state.enrageStacks = stacks;
    this.applyEnrage();
    if (wasCalm && stacks > 0) {
      this.bus.emit('wave_enraged', { wave: this.state.number, stacks });
      this.bus.emit('toast', {
        kind: 'warning',
        text: `Wave ${this.state.number} is enraging — enemies grow stronger every ${ENRAGE_STACK_INTERVAL}s.`,
        life: 5,
      });
    } else {
      this.bus.emit('wave_enraged', { wave: this.state.number, stacks });
    }
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

    this.tickEnrage(dt);

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
      this.state.elapsed = 0;
      this.state.enrageStacks = 0;
      this.clearEnrage();
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
    if (type === 'thief') this.thiefSpawnedThisWave = true;

    // Plan §2.2: `fast` arrives in threes from one shared spawn point, so it
    // reads as a rush rather than a trickle. The pack counts against
    // `enemiesToSpawn` in full — it takes slots, it does not add them, so total
    // wave HP is unchanged.
    const remaining = this.state.enemiesToSpawn - this.state.enemiesSpawned;
    const packSize = type === 'fast'
      ? Math.max(1, Math.min(ENEMY_BEHAVIOR.fastPackSize, remaining))
      : 1;

    for (let i = 0; i < packSize; i++) {
      const spread = packSize > 1 ? ENEMY_BEHAVIOR.fastPackSpread : 0;
      const px = x + (spread > 0 ? randomBetween(-spread, spread) : 0);
      const py = y + (spread > 0 ? randomBetween(-spread, spread) : 0);
      // Elite roll: wave >= 21, not bosses, linear 2%→20% chance. Rolled per
      // pack member, so packing `fast` does not change the elite rate.
      if (wave >= 21 && type !== 'boss' && Math.random() < eliteChanceForWave(wave)) {
        const aura = ALL_AURAS[Math.floor(Math.random() * ALL_AURAS.length)];
        this.enemies.spawnElite(type, wave, px, py, aura);
      } else {
        this.enemies.spawn(type, wave, px, py);
      }
      this.state.enemiesSpawned += 1;
    }

    if (this.state.enemiesSpawned >= this.state.enemiesToSpawn) {
      this.state.spawning = false;
    }
  }
}

export function getEnemyColor(type: EnemyType): string {
  return ENEMY_DEFS[type].color;
}
