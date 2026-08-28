import {
  WATCH_CHAPTERS,
  WATCH_CHAPTER_BY_ID,
  WATCH_UNLOCKS,
  goalTarget,
  type WatchChapterDef,
  type WatchGoal,
  type WatchGoalKind,
  type WatchUnlockId,
} from '../data/watch';
import type { EnemyType, WatchState } from '../types';

/** The `EventBus` slice this needs — structural, so a test can pass a stub. */
export interface WatchEmitter {
  emit: (event: string, payload?: unknown) => void;
}

/**
 * Everything an objective can be measured against, gathered once per poll.
 *
 * A flat snapshot rather than a bag of callbacks: sixteen goal kinds times one
 * poll a second is cheap either way, but a single object is what makes
 * `WATCH_PROGRESS` a pure `Record` of pure functions — which is what makes it
 * testable without a `Game`.
 */
export interface WatchMetrics {
  highestWave: number;
  kills: number;
  killsByType: Readonly<Partial<Record<EnemyType, number>>>;
  bosses: number;
  goldEarned: number;
  ascensions: number;
  transcendences: number;
  abilitiesCast: number;
  upgradesBought: number;
  towerLevel: number;
  blessingPicks: number;
  contractsDone: number;
  flawlessWaves: number;
  swiftBosses: number;
  /** Index = risk level in force when the wave was cleared. */
  riskWaves: readonly number[];
  mutatorWaves: number;
}

/**
 * How each objective kind reads the snapshot.
 *
 * **This `Record` is the point of the file.** It is a `Record` over
 * `WatchGoalKind`, so a kind added to the union without a reader does not
 * compile — the same guard `CONTRACT_PROGRESS` gives contracts. Each entry
 * returns the goal's current *absolute* progress, never a delta.
 */
const WATCH_PROGRESS: Record<WatchGoalKind, (g: WatchGoal, m: WatchMetrics) => number> = {
  reach_wave: (_g, m) => m.highestWave,
  kills: (_g, m) => m.kills,
  kills_of: (g, m) => (g.kind === 'kills_of' ? m.killsByType[g.type] ?? 0 : 0),
  bosses: (_g, m) => m.bosses,
  gold_earned: (_g, m) => m.goldEarned,
  ascensions: (_g, m) => m.ascensions,
  transcendences: (_g, m) => m.transcendences,
  abilities_cast: (_g, m) => m.abilitiesCast,
  upgrades_bought: (_g, m) => m.upgradesBought,
  tower_level: (_g, m) => m.towerLevel,
  blessing_picks: (_g, m) => m.blessingPicks,
  contracts_done: (_g, m) => m.contractsDone,
  flawless_waves: (_g, m) => m.flawlessWaves,
  swift_bosses: (_g, m) => m.swiftBosses,
  // Everything at or above the asked step counts, so raising the dial past the
  // objective's threshold never stops crediting it.
  risk_waves: (g, m) => {
    if (g.kind !== 'risk_waves') return 0;
    let total = 0;
    for (let i = g.risk; i < m.riskWaves.length; i++) total += m.riskWaves[i] ?? 0;
    return total;
  },
  mutator_waves: (_g, m) => m.mutatorWaves,
};

export interface WatchManagerDeps {
  bus?: WatchEmitter;
  state: () => WatchState;
  metrics: () => WatchMetrics;
}

/** How often the poll runs, in simulation seconds. */
const WATCH_POLL_SECONDS = 1;

/**
 * The Long Watch (plans/milestones.md).
 *
 * Two invariants this class exists to hold:
 *   1. **One chapter at a time, in order.** Chapter N+1 is not evaluated until
 *      N is complete, so the Journal always has exactly one live card.
 *   2. **At most one completion per `check()`.** A player who installs the
 *      update deep into a save has earned several chapters at once; they land
 *      one per second so each gets its own toast and modal (plan §1.6).
 */
export class WatchManager {
  private readonly deps: WatchManagerDeps;
  private timer = 0;
  /** Rebuilt from `state().completed` on every mutation. */
  private unlocks = new Set<WatchUnlockId>();

  constructor(deps: WatchManagerDeps) {
    this.deps = deps;
    this.rebuildUnlocks();
  }

  // ── queries ──

  /** The live chapter, or null once all twelve are done. */
  get activeChapter(): WatchChapterDef | null {
    const done = new Set(this.deps.state().completed);
    for (const c of WATCH_CHAPTERS) if (!done.has(c.id)) return c;
    return null;
  }

  get completedCount(): number {
    return this.deps.state().completed.length;
  }

  isChapterComplete(id: string): boolean {
    return this.deps.state().completed.includes(id);
  }

  /** Whether an unlock has been earned. The one query every consumer calls. */
  has(id: WatchUnlockId): boolean {
    return this.unlocks.has(id);
  }

  /** Absolute progress on one goal, clamped to its target. */
  progress(goal: WatchGoal, metrics = this.deps.metrics()): number {
    return Math.min(goalTarget(goal), Math.max(0, WATCH_PROGRESS[goal.kind](goal, metrics)));
  }

  /** 0..1 fill for the objective bar. */
  fill(goal: WatchGoal, metrics = this.deps.metrics()): number {
    const target = Math.max(1, goalTarget(goal));
    return Math.min(1, Math.max(0, this.progress(goal, metrics) / target));
  }

  isGoalMet(goal: WatchGoal, metrics = this.deps.metrics()): boolean {
    return WATCH_PROGRESS[goal.kind](goal, metrics) >= goalTarget(goal);
  }

  /** Objectives met on the live chapter, for the corner chip's `2 / 3`. */
  activeProgress(): { met: number; total: number } {
    const chapter = this.activeChapter;
    if (!chapter) return { met: 0, total: 0 };
    const metrics = this.deps.metrics();
    let met = 0;
    for (const g of chapter.goals) if (this.isGoalMet(g, metrics)) met++;
    return { met, total: chapter.goals.length };
  }

  // ── the poll ──

  tick(dt: number): void {
    this.timer += dt;
    if (this.timer < WATCH_POLL_SECONDS) return;
    this.timer = 0;
    this.check();
  }

  /**
   * Complete the active chapter if every objective is met. At most one per
   * call — the cascade rule (plan §1.6).
   *
   * Returns the chapter that completed, or null. `Game` reacts to the returned
   * value *and* to the emitted event: the event drives the UI, the return value
   * drives the unlocks that have to be applied synchronously.
   */
  check(): WatchChapterDef | null {
    const chapter = this.activeChapter;
    if (!chapter) return null;
    const metrics = this.deps.metrics();
    for (const g of chapter.goals) if (!this.isGoalMet(g, metrics)) return null;

    this.deps.state().completed.push(chapter.id);
    this.rebuildUnlocks();
    const unlock = WATCH_UNLOCKS[chapter.reward];
    this.deps.bus?.emit('watch_chapter_completed', {
      id: chapter.id,
      number: chapter.number,
      name: chapter.name,
      unlockId: unlock.id,
      unlockName: unlock.name,
      unlockDescription: unlock.description,
      icon: chapter.icon,
      color: chapter.color,
      next: this.activeChapter?.name ?? null,
    });
    return chapter;
  }

  // ── lifecycle ──

  /**
   * Rebuild the unlock set from the completed list.
   *
   * The set is **derived, never stored** — one chapter grants exactly one
   * unlock, so a second stored list could only ever disagree with the first.
   * Call after any mutation of `completed`, including a save restore.
   */
  rebuildUnlocks(): void {
    this.unlocks.clear();
    for (const id of this.deps.state().completed) {
      const def = WATCH_CHAPTER_BY_ID[id];
      if (def) this.unlocks.add(def.reward);
    }
  }

  /** Every unlock earned so far, for `Game.applyWatchUnlock` on load. */
  earnedUnlocks(): WatchUnlockId[] {
    return [...this.unlocks];
  }
}
