import {
  CORES,
  CORE_BY_ID,
  CORE_TUNING,
  DEFAULT_CORE,
  isCoreId,
  type CoreBehavior,
  type CoreDef,
  type CoreId,
} from '../data/cores';
import type { DamageType } from '../types';

/**
 * What the run's core does to one shot (plan §6.1).
 *
 * Returned by `planShot`, which owns the proc cadence, rather than being
 * assembled inline in `Game.simulate`. Two reasons, and the second is the one
 * that matters: the cadence is *state* (a counter), and state living in the
 * 300-line shot block is state nothing can test at `dt = 1/120` and at 6.5x
 * speed without a canvas.
 */
export interface CoreShotPlan {
  /** Multiplier on the shot's raw damage. 1 for an ordinary shot. */
  damageMult: number;
  /** Non-null when the core overrides the tower's damage type. */
  damageType: DamageType | null;
  /** Blast radius carried on impact, or undefined for a point hit. */
  splashRadius?: number;
  splashFraction?: number;
  /** Mana the shot actually spent — 0 when the proc could not afford it. */
  manaSpent: number;
}

const ORDINARY_SHOT: CoreShotPlan = {
  damageMult: 1,
  damageType: null,
  manaSpent: 0,
};
import type { CoreRunState } from '../types';
import type { EventBus } from '../game/EventBus';

/**
 * Owns which cores the player has bought, which one this run is running, and
 * the behavior lookup the combat path reads (plan §6.2).
 *
 * Three pieces of state with three different lifetimes, which is the whole
 * reason this is a class and not a field on `GameState`:
 *
 * | Field | Lifetime | Why |
 * |---|---|---|
 * | `unlocked` | permanent | bought with AP; an ascension must not un-buy it |
 * | `preferred` | permanent | the core the player keeps choosing |
 * | `selected` | **run** | §6.2 — the selection is what resets, not the unlock |
 *
 * `preferred` exists because "the selection resets with the run" and "an
 * unattended auto-ascending game silently reverts to `marksman` every run" are
 * the same sentence unless something remembers the choice. Reset restores the
 * *preference*, and the picker is what changes the preference — so an idle run
 * keeps the identity the player picked, and an attended one gets asked.
 *
 * `behaviorCache` is a rebuilt lookup set, the same shape
 * `BlessingManager.rebuildCaches` uses and for the same reason: `has()` is
 * called per shot and per kill, so the answer is computed when the selection
 * changes rather than by comparing id strings at 60 Hz x N projectiles.
 *
 * > Any new writer of `selected` must go through `select()`.
 */
export class CoreManager {
  private readonly bus: EventBus | null;
  private unlocked = new Set<CoreId>([DEFAULT_CORE]);
  private preferred: CoreId = DEFAULT_CORE;
  private selected: CoreId = DEFAULT_CORE;
  private behaviorCache = new Set<CoreBehavior>();
  /**
   * Shots fired since the run started, for the arcane proc's every-Nth cadence.
   *
   * A *share* of shots, never a wall-clock cycle — which is the whole reason
   * the proc keeps its worth as the player buys fire rate. The charged shot
   * learned that lesson the expensive way; see the follow-up note at the end of
   * `plans/gameplay-improvements.md`.
   */
  private shotIndex = 0;

  constructor(bus?: EventBus) {
    this.bus = bus ?? null;
    this.rebuildCaches();
  }

  // ── queries ──

  get current(): CoreId {
    return this.selected;
  }

  get def(): CoreDef {
    return CORE_BY_ID[this.selected];
  }

  get preferredCore(): CoreId {
    return this.preferred;
  }

  /** True when the run's core grants this behavior. */
  has(behavior: CoreBehavior): boolean {
    return this.behaviorCache.has(behavior);
  }

  isUnlocked(id: CoreId): boolean {
    return this.unlocked.has(id);
  }

  unlockedIds(): CoreId[] {
    return CORES.filter(c => this.unlocked.has(c.id)).map(c => c.id);
  }

  get unlockedCount(): number {
    return this.unlocked.size;
  }

  /**
   * Whether a core picker has anything to ask.
   *
   * §6.2 in one predicate: a player with one core has no choice to make, and a
   * player who has never ascended has no information to make one with. Both
   * answers are "do not show a modal", and keeping them in one place is what
   * stops a second call site from asking only half the question.
   */
  isPickerAvailable(lifetimeAscensions: number): boolean {
    return lifetimeAscensions > 0 && this.unlocked.size > 1;
  }

  /**
   * Advance the shot cadence and say what this shot does.
   *
   * `spendMana` is injected rather than reached for, so the combat path can be
   * driven from a test with a two-line stub — and so the manager cannot reach
   * the resource pool for anything else.
   *
   * The arcane proc **degrades rather than stalling**: out of mana the shot
   * still fires, as an ordinary one. A verb that costs a resource must still
   * work when the resource runs out (cross-cutting rule 1).
   */
  planShot(spendMana: (amount: number) => boolean): CoreShotPlan {
    if (this.behaviorCache.size === 0) return ORDINARY_SHOT;
    const plan: CoreShotPlan = { damageMult: 1, damageType: null, manaSpent: 0 };

    if (this.behaviorCache.has('splash_shots')) {
      plan.splashRadius = CORE_TUNING.splashRadius;
      plan.splashFraction = CORE_TUNING.splashFraction;
    }

    if (this.behaviorCache.has('mana_shot')) {
      this.shotIndex += 1;
      if (this.shotIndex % CORE_TUNING.manaShotInterval === 0
        && spendMana(CORE_TUNING.manaShotCost)) {
        plan.damageMult *= CORE_TUNING.manaShotDamageMult;
        // Magic is resisted by `magicResist` instead of flat armour, which is
        // the half of the proc the damage multiple does not show.
        plan.damageType = 'magic';
        plan.manaSpent = CORE_TUNING.manaShotCost;
      }
    }
    return plan;
  }

  /** Run-scoped: a new run starts its proc cadence from the top. */
  resetShotCadence(): void {
    this.shotIndex = 0;
  }

  // ── mutations ──

  /**
   * Grant a core. The *payment* is `PrestigeManager.unlockCore`'s job — this
   * only records the grant, so a save restore and a purchase share one path.
   */
  unlock(id: CoreId): boolean {
    if (this.unlocked.has(id)) return false;
    this.unlocked.add(id);
    this.bus?.emit('core_unlocked', { id, def: CORE_BY_ID[id] });
    return true;
  }

  /**
   * Run this core for the rest of the run, and remember it as the preference.
   *
   * Rejects a core that is not unlocked rather than silently falling back:
   * a selection that quietly becomes something else is how a picker lies.
   */
  select(id: CoreId): boolean {
    if (!this.unlocked.has(id)) return false;
    const changed = this.selected !== id;
    this.selected = id;
    this.preferred = id;
    // A core switched mid-run starts its proc cadence fresh, so the counter
    // cannot carry a half-cycle from a core that no longer has a proc.
    this.shotIndex = 0;
    this.rebuildCaches();
    if (changed) this.bus?.emit('core_selected', { id, def: CORE_BY_ID[id] });
    return true;
  }

  /**
   * Run-scoped reset (plan §6.2): the *selection* resets, the unlocks do not.
   *
   * It resets to the player's preference rather than to `marksman`, for the
   * reason in the class comment — auto-ascend would otherwise strip a chosen
   * identity from every run of an idle game.
   */
  resetRun(): void {
    this.selected = this.unlocked.has(this.preferred) ? this.preferred : DEFAULT_CORE;
    this.shotIndex = 0;
    this.rebuildCaches();
  }

  /** Transcendence and a hard wipe: back to a single default core. */
  resetAll(): void {
    this.unlocked = new Set<CoreId>([DEFAULT_CORE]);
    this.preferred = DEFAULT_CORE;
    this.selected = DEFAULT_CORE;
    this.shotIndex = 0;
    this.rebuildCaches();
  }

  // ── persistence ──

  snapshot(): CoreRunState {
    return {
      unlocked: this.unlockedIds(),
      preferred: this.preferred,
      selected: this.selected,
    };
  }

  restore(state: CoreRunState | null | undefined): void {
    this.unlocked = new Set<CoreId>([DEFAULT_CORE]);
    for (const id of state?.unlocked ?? []) {
      if (isCoreId(id)) this.unlocked.add(id);
    }
    const preferred = state?.preferred;
    this.preferred = isCoreId(preferred) && this.unlocked.has(preferred) ? preferred : DEFAULT_CORE;
    const selected = state?.selected;
    this.selected = isCoreId(selected) && this.unlocked.has(selected) ? selected : this.preferred;
    this.rebuildCaches();
  }

  private rebuildCaches(): void {
    this.behaviorCache.clear();
    for (const behavior of CORE_BY_ID[this.selected].behaviors) {
      this.behaviorCache.add(behavior);
    }
  }
}
