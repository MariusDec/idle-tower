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
import { spawnPointOnEllipse } from '../data/arena';
import { ENEMY_BEHAVIOR, ENEMY_DEFS, spawnPoolForWave } from '../data/enemies';
import {
  BASE_INTERMISSION_SECONDS,
  EARLY_CALL_DELAY_SECONDS,
  EARLY_CALL_WINDOW_SECONDS,
  ENEMY_THREAT_CLASS,
} from '../data/pacing';
import type { EnemyManager } from './EnemyManager';
import { eliteChanceForWave } from './EnemyManager';
import { randomBetween } from '../utils/math';
import { EventBus } from '../game/EventBus';

const ALL_AURAS: AuraType[] = ['haste', 'thorns', 'greed', 'vitality', 'retribution'];

/**
 * Base intermission, in seconds. Scaled by `intermissionMultiplier`, which
 * carries both the Efficient Deployment research node and the wave-depth
 * shortening from plan §7.6 — see `data/pacing.ts`.
 */
export const WAVE_INTERMISSION = BASE_INTERMISSION_SECONDS;

/**
 * One enemy the wave is committed to spawning (gameplay plan §7.3).
 *
 * Rolling the roster up front rather than at each spawn tick is what makes the
 * threat preview *truthful*: "3 Siege · 1 Elite (Haste)" is what the wave will
 * actually contain, not an expectation derived from the weight table that the
 * dice may not honour. It also gives the canvas real lane markers instead of
 * decorative ones.
 */
export interface WavePlanEntry {
  type: EnemyType;
  x: number;
  y: number;
  elite: boolean;
  aura: AuraType | null;
}

/**
 * Distance within which two spawn points count as the same lane, and the most
 * lanes the preview will ever name. Both are readability limits, not
 * simulation ones — the roster still spawns wherever it rolled.
 */
const WAVE_PREVIEW_LANE_MERGE = 150;
const WAVE_PREVIEW_MAX_LANES = 8;

/** What the next wave holds, for the intermission readout and lane markers. */
export interface WavePreview {
  wave: number;
  count: number;
  isBoss: boolean;
  /** Types worth naming (`ENEMY_THREAT_CLASS`), most numerous first. */
  threats: Array<{ type: EnemyType; count: number }>;
  /** Elites by aura, most numerous first. */
  elites: Array<{ aura: AuraType; count: number }>;
  /** Distinct spawn edges the wave will use. */
  lanes: Array<{ x: number; y: number }>;
}

export class WaveManager {
  private state: WaveState;
  private readonly bus: EventBus;
  private readonly enemies: EnemyManager;
  private width: number;
  private height: number;
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
  /**
   * The current wave's remaining roster, consumed one entry per `spawnOne`.
   *
   * Refilled lazily if it runs dry, which is what makes a save load — where
   * the wave is restored mid-spawn with no plan — behave exactly as it did
   * before the roster was pre-rolled.
   */
  private spawnQueue: WavePlanEntry[] = [];
  /** The next wave's roster, rolled at the top of the intermission. */
  private plannedWave: { wave: number; entries: WavePlanEntry[] } | null = null;
  /**
   * Seconds left on the §7.1 early-call window, 0 when it is not running.
   *
   * Opened while the wave is still live — `EARLY_CALL_DELAY_SECONDS` in, once
   * the roster has finished spawning — so it ticks down across the tail of the
   * wave as well as the pause after it. Deliberately not part of `WaveState`:
   * a window that survived a reload would pay for a wave fought in a previous
   * session, so a restored wave simply opens its own on schedule.
   */
  private earlyCallWindow = 0;
  /** Whether this wave's window has already opened — it opens once, not again. */
  private earlyCallOpened = false;

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
  private pickEnemyType(wave: number, thiefUsed: boolean): EnemyType {
    // A boss wave is no longer "every slot is a boss": `buildRoster` places the
    // one boss itself and fills the rest of the roster from this pool, so the
    // escort rolls exactly like a normal wave's enemies do.
    const pool = spawnPoolForWave(wave);
    let total = 0;
    for (const { type, weight } of pool) {
      if (type === 'thief' && thiefUsed) continue;
      total += weight;
    }
    if (total <= 0) return 'normal';
    let r = Math.random() * total;
    for (const { type, weight } of pool) {
      if (type === 'thief' && thiefUsed) continue;
      r -= weight;
      if (r <= 0) return type;
    }
    return 'normal';
  }

  /**
   * Roll a wave's whole roster up front (plan §7.3).
   *
   * Same dice as the old per-tick roll — the weighted pool, the thief cap, the
   * `fast` pack expansion and the elite roll are all unchanged, they simply
   * happen earlier. `total` is exactly how many enemies come out, so a pack
   * that would overrun the wave's budget is truncated here rather than at the
   * spawn tick.
   */
  private buildRoster(wave: number, total: number, thiefUsed = false): WavePlanEntry[] {
    const entries: WavePlanEntry[] = [];
    let thief = thiefUsed;
    // The boss goes in first so it is the first thing through the portal: it
    // carries the whole encounter, and an escort that arrives ahead of it is a
    // wave the player fights twice rather than an entrance.
    if (isBossWave(wave)) {
      const { x, y } = this.randomSpawnPoint();
      entries.push({ type: 'boss', x, y, elite: false, aura: null });
    }
    while (entries.length < total) {
      const type = this.pickEnemyType(wave, thief);
      if (type === 'thief') thief = true;
      const { x, y } = this.randomSpawnPoint();
      // Plan §2.2: `fast` arrives in threes from one shared spawn point, so it
      // reads as a rush rather than a trickle. The pack counts against the
      // wave's budget in full — it takes slots, it does not add them.
      const remaining = total - entries.length;
      const packSize = type === 'fast'
        ? Math.max(1, Math.min(ENEMY_BEHAVIOR.fastPackSize, remaining))
        : 1;
      for (let i = 0; i < packSize; i++) {
        const spread = packSize > 1 ? ENEMY_BEHAVIOR.fastPackSpread : 0;
        // Elite roll: wave >= 21, not bosses, linear 2%→20% chance. Rolled per
        // pack member, so packing `fast` does not change the elite rate.
        const elite = wave >= 21 && type !== 'boss' && Math.random() < eliteChanceForWave(wave);
        entries.push({
          type,
          x: x + (spread > 0 ? randomBetween(-spread, spread) : 0),
          y: y + (spread > 0 ? randomBetween(-spread, spread) : 0),
          elite,
          aura: elite ? ALL_AURAS[Math.floor(Math.random() * ALL_AURAS.length)] : null,
        });
      }
    }
    return entries;
  }

  /** How many enemies the given wave will spawn under the current mutator. */
  private plannedCountFor(wave: number): number {
    return Math.max(1, Math.floor(spawnCountForWave(wave) * this.enemyCountMult));
  }

  /**
   * Roll the roster for the wave the intermission is counting down to.
   *
   * Called at the two points a wave becomes "next": a normal clear and a
   * wave-skip roll. If the count changes before the wave actually starts — the
   * only mover is a mutator chosen from the boss-wave offer, which triples it
   * — `startWave` throws the plan away and rolls fresh, so the preview is
   * never a promise the wave breaks.
   */
  private planNextWave(): void {
    const next = this.state.number + (this.state.autoProgress || isBossWave(this.state.number) ? 1 : 0);
    this.plannedWave = { wave: next, entries: this.buildRoster(next, this.plannedCountFor(next)) };
  }

  /**
   * The composition of the coming wave, or null outside an intermission.
   *
   * Threat types are named and trash is only counted — see
   * `ENEMY_THREAT_CLASS` for why the classification is a `Record` over the
   * enemy union rather than a list.
   */
  previewNextWave(): WavePreview | null {
    if (!this.state.intermission || !this.plannedWave) return null;
    const { wave, entries } = this.plannedWave;
    const byType = new Map<EnemyType, number>();
    const byAura = new Map<AuraType, number>();
    const lanes: Array<{ x: number; y: number }> = [];
    for (const e of entries) {
      byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
      if (e.elite && e.aura) byAura.set(e.aura, (byAura.get(e.aura) ?? 0) + 1);
      // One marker per spawn *cluster*, capped: entries in a pack share an
      // origin, and a 43-enemy wave produced nineteen arrows in browser, which
      // rings the arena in noise rather than telling the player where to look.
      if (
        lanes.length < WAVE_PREVIEW_MAX_LANES
        && !lanes.some(l => Math.hypot(l.x - e.x, l.y - e.y) < WAVE_PREVIEW_LANE_MERGE)
      ) {
        lanes.push({ x: e.x, y: e.y });
      }
    }
    const threats = [...byType.entries()]
      .filter(([type]) => ENEMY_THREAT_CLASS[type] === 'threat')
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
    const elites = [...byAura.entries()]
      .map(([aura, count]) => ({ aura, count }))
      .sort((a, b) => b.count - a.count || a.aura.localeCompare(b.aura));
    return { wave, count: entries.length, isBoss: isBossWave(wave), threats, elites, lanes };
  }

  /**
   * Where one enemy comes in, on the spawn **ellipse** (UI plan §1.4).
   *
   * This used to pick one of four edges and a uniform point along it, which
   * quietly made the arena unfair to itself: a corner spawn is ~1.4x as far
   * from the tower as an edge spawn, so a wave's length depended on how many
   * of its rolls landed in a corner, and no player could see why. An ellipse
   * matched to the viewport half-extents removes the asymmetry, works at any
   * aspect including portrait, and gives Part 3's rifts a defined place to
   * open. The `spawnLanes` threat preview reads these points unchanged — it
   * simply points at portals now.
   */
  private randomSpawnPoint(): { x: number; y: number } {
    return spawnPointOnEllipse(
      this.width / 2,
      this.height / 2,
      this.width / 2,
      this.height / 2,
      Math.random() * Math.PI * 2,
    );
  }

  /**
   * The world rectangle changed shape (a resize, a rotation).
   *
   * Only the spawn ellipse reads it, and only at roster-build time, so a
   * resize mid-intermission simply plans the next wave against the new arena.
   * `Game` rescales anything already on the field.
   */
  setBounds(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  startWave(wave: number): void {
    this.state.number = wave;
    this.thiefSpawnedThisWave = false;
    this.spawnQueue = [];
    // A new wave has enemies still to come, so the previous window is over
    // whether or not it ran out — `spawnOne` opens the next one.
    this.earlyCallWindow = 0;
    this.earlyCallOpened = false;
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
      this.planNextWave();
      // A skipped wave spawns nothing, so its last spawn is now: the call
      // window opens on the same beat it would have if the roster had run out.
      this.openEarlyCallWindow();
      this.bus.emit('toast', { kind: 'milestone', text: `Wave ${wave} skipped!`, life: 2 });
      return;
    }

    this.state.enemiesToSpawn = this.plannedCountFor(wave);
    this.state.enemiesSpawned = 0;
    // Plan §7.3: the roster the intermission promised, if the promise still
    // holds. A mutator chosen from the boss-wave offer changes the count after
    // the plan was made, and a plan of the wrong size is not this wave's.
    const planned = this.plannedWave;
    this.spawnQueue = planned
      && planned.wave === wave
      && planned.entries.length === this.state.enemiesToSpawn
      ? planned.entries.slice()
      : this.buildRoster(wave, this.state.enemiesToSpawn);
    this.plannedWave = null;
    this.thiefSpawnedThisWave = this.spawnQueue.some(e => e.type === 'thief');
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
    this.earlyCallWindow = 0;
    this.earlyCallOpened = false;
    this.enemyCountMult = 1;
    this.thiefSpawnedThisWave = false;
    this.spawnQueue = [];
    this.plannedWave = null;
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
    this.earlyCallWindow = 0;
    this.earlyCallOpened = false;
    this.enemyCountMult = 1;
    this.thiefSpawnedThisWave = false;
    this.spawnQueue = [];
    this.plannedWave = null;
    this.enemies.beginWave(target);
    this.bus.emit('wave_started', this.state.number);
    this.onWaveStarted(this.state.number);
  }

  /**
   * Replay the wave currently on the field. Replaces the old prev/next step
   * controls: going backwards re-farmed earlier waves and going forwards
   * skipped past ones the run never survived, so the only wave jump the HUD
   * offers now is "this one, again".
   */
  restartWave(): boolean {
    this.enemies.reset();
    this.startWave(this.state.number);
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


  setState(s: WaveState): void {
    this.state = { ...s, elapsed: s.elapsed ?? 0, enrageStacks: s.enrageStacks ?? 0 };
    // See `earlyCallWindow`: a restored wave has no last-spawn moment to date
    // the window from. An intermission restored mid-run therefore pays nothing
    // until the next wave's roster runs out.
    this.earlyCallWindow = 0;
    this.earlyCallOpened = false;
    // A restored wave has no roster: live enemies were never persisted, so
    // whatever is left to spawn is rolled fresh by `spawnOne`.
    this.spawnQueue = [];
    this.plannedWave = null;
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
    // The window spans the wave's tail *and* the intermission, so it is decayed
    // before either branch rather than inside one of them.
    if (this.earlyCallWindow > 0 && !this.intermissionPaused) {
      this.earlyCallWindow = Math.max(0, this.earlyCallWindow - dt);
    }

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

    this.maybeOpenEarlyCallWindow();

    if (
      !this.state.spawning &&
      this.state.enemiesSpawned >= this.state.enemiesToSpawn &&
      this.enemies.aliveCount() === 0
    ) {
      this.concludeWave(true);
    }
  }

  /**
   * Credit the running wave as cleared and roll what comes next.
   *
   * `openIntermission` is false on the one path that does not want the pause:
   * an early call made while the wave's stragglers are still on the field,
   * which starts the next wave on the same frame. The wave is credited there
   * even though enemies are alive — the leftovers carry into the next wave and
   * still have to be killed, so the call buys tempo at the price of fighting
   * two rosters at once, which is the whole trade being offered.
   */
  private concludeWave(openIntermission: boolean): void {
    const clearedWave = this.state.number;
    this.onWaveCleared(clearedWave);
    this.bus.emit('wave_cleared', clearedWave);
    this.state.elapsed = 0;
    this.state.enrageStacks = 0;
    this.clearEnrage();
    if (openIntermission) {
      this.state.intermission = true;
      this.state.intermissionTimer = WAVE_INTERMISSION * this.intermissionMultiplier;
      // A wave killed faster than `EARLY_CALL_DELAY_SECONDS` never reached the
      // unlock, and it would be a strange reward for a fast clear if the call
      // paid nothing. An empty field cannot be exploited by calling, so the
      // window simply opens here instead.
      this.openEarlyCallWindow();
    }
    // Plan §7.3: the intermission is a preparation window, so what it is
    // preparing for has to exist by the time it opens.
    this.planNextWave();
  }

  // ── §7.1 Call the wave early ──────────────────────────────────────────────

  /** Intermission seconds still to run, or 0 when a wave is live. */
  intermissionRemaining(): number {
    if (!this.state.intermission) return 0;
    return Math.max(0, this.state.intermissionTimer);
  }

  /** Start the early-call window. Opens once per wave, and never re-opens. */
  private openEarlyCallWindow(): void {
    if (this.earlyCallOpened) return;
    this.earlyCallOpened = true;
    this.earlyCallWindow = EARLY_CALL_WINDOW_SECONDS;
  }

  /**
   * Open the window when the wave has run `EARLY_CALL_DELAY_SECONDS` *and* has
   * nothing left to spawn — see `EARLY_CALL_DELAY_SECONDS` for why both.
   */
  private maybeOpenEarlyCallWindow(): void {
    if (this.earlyCallOpened) return;
    if (this.state.spawning) return;
    if (this.state.enemiesSpawned < this.state.enemiesToSpawn) return;
    if (this.state.elapsed < EARLY_CALL_DELAY_SECONDS) return;
    this.openEarlyCallWindow();
  }

  /**
   * Seconds left on the early-call window — the size of the momentum a call
   * would bank, in seconds.
   *
   * Runs down to 0 on its own; a call after that still starts the wave, it
   * just pays nothing.
   */
  earlyCallRemaining(): number {
    return Math.max(0, this.earlyCallWindow);
  }

  /** The window's full length, for the readouts that draw it as a bar. */
  earlyCallWindowLength(): number {
    return EARLY_CALL_WINDOW_SECONDS;
  }

  /**
   * Whether `callWaveEarly` would do anything right now.
   *
   * Two ways in. During the intermission it is the old behaviour: skip the
   * pause. During a *live* wave it is open from the moment the window unlocks
   * — the point of the change, since a button that only lights up once the
   * field is empty is a button nobody has time to press.
   *
   * A paused intermission is excluded on purpose, and so is a paused spawner:
   * both pauses exist because a draft or a mutator offer is on screen, and a
   * keypress that skipped the decision the pause was protecting would be the
   * opposite of what the pause is for. A live boss is excluded too — the
   * encounter owns the wave it belongs to, and calling out from under it would
   * leave its bar attached to a wave that has already been credited.
   */
  canCallEarly(): boolean {
    if (this.intermissionPaused) return false;
    if (this.state.intermission) return this.state.intermissionTimer > 0;
    if (!this.earlyCallOpened || this.spawnPaused) return false;
    return this.enemies.bossAliveCount() === 0;
  }

  /**
   * Start the next wave now, returning the seconds of window it banked.
   *
   * Returns 0 and does nothing when the call is not available. The caller banks
   * the momentum *before* calling, because `startWave` resolves the new wave's
   * stats and the bonus is meant to apply to the wave it bought.
   */
  callWaveEarly(): number {
    if (!this.canCallEarly()) return 0;
    const banked = this.earlyCallRemaining();
    // Called mid-wave the current wave never reaches the clear check, so it is
    // credited here — with its stragglers left on the field, which is the
    // price of the tempo (`concludeWave`).
    if (!this.state.intermission) this.concludeWave(false);
    this.state.intermissionTimer = 0;
    const forceAdvance = isBossWave(this.state.number);
    this.startWave(this.state.number + (this.state.autoProgress || forceAdvance ? 1 : 0));
    return banked;
  }

  private spawnOne(): void {
    if (this.state.enemiesSpawned >= this.state.enemiesToSpawn) {
      this.state.spawning = false;
      return;
    }
    const wave = this.state.number;
    if (this.spawnQueue.length === 0) {
      // The queue only runs dry on a path that never called `startWave` — a
      // save restored mid-spawn. Rolling the remainder here keeps that path
      // identical to what it was before the roster was pre-rolled.
      this.spawnQueue = this.buildRoster(
        wave,
        this.state.enemiesToSpawn - this.state.enemiesSpawned,
        this.thiefSpawnedThisWave,
      );
    }
    const entry = this.spawnQueue.shift();
    if (!entry) {
      this.state.spawning = false;
      return;
    }
    if (entry.type === 'thief') this.thiefSpawnedThisWave = true;
    if (entry.elite && entry.aura) {
      this.enemies.spawnElite(entry.type, wave, entry.x, entry.y, entry.aura);
    } else {
      this.enemies.spawn(entry.type, wave, entry.x, entry.y);
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
