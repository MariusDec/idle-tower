import {
  BLESSINGS,
  BLESSING_BY_ID,
  BLESSING_DRAFT_INTERVAL,
  BLESSING_FIRST_DRAFT_WAVE,
  BLESSING_FREE_REROLLS,
  BLESSING_MAX_PICKS,
  BLESSING_OFFER_SIZE,
  BLESSING_TUNING,
  type BlessingBehavior,
  type BlessingDef,
  type BlessingStat,
} from '../data/blessings';
import type { CoreId } from '../data/cores';
import type { BlessingRunState } from '../types';
import type { EventBus } from '../game/EventBus';

/**
 * Owns the run's blessing state: what is held, what the next offer looks like,
 * and how much reroll budget is left (plan §1.4).
 *
 * Two lookup caches are rebuilt on every mutation, the same shape
 * `UpgradeManager.rebuildEvolutionCache` uses and for the same reason:
 * `has(behavior)` is called several times per shot and per kill, so the answer
 * is computed when the held set changes rather than by walking the pool at
 * 60 Hz × N projectiles.
 *
 * > Any new writer of `held` must call `rebuildCaches()`.
 */
export class BlessingManager {
  private readonly bus: EventBus | null;
  private held: Record<string, number> = {};
  private picksTaken = 0;
  /** Reroll tokens banked from other systems (Part 5 grants them). */
  private rerollTokens = 0;
  /** Free rerolls left in the draft currently open. */
  private freeRerolls = 0;
  private pendingOfferForWave: number | null = null;
  private currentOffer: BlessingDef[] = [];
  /** Waves cleared since the run started — drives `greed_engine`. */
  private wavesClearedThisRun = 0;

  // ── rebuilt lookup caches ──
  private behaviorCache = new Set<BlessingBehavior>();
  private statCache: Partial<Record<BlessingStat, number>> = {};

  constructor(bus?: EventBus) {
    this.bus = bus ?? null;
    this.rebuildCaches();
  }

  // ── queries ──

  /** True when the run holds a blessing granting this behavior. */
  has(behavior: BlessingBehavior): boolean {
    return this.behaviorCache.has(behavior);
  }

  stacks(id: string): number {
    return this.held[id] ?? 0;
  }

  get heldIds(): string[] {
    return Object.keys(this.held).filter(id => (this.held[id] ?? 0) > 0);
  }

  get picks(): number {
    return this.picksTaken;
  }

  get tokens(): number {
    return this.rerollTokens;
  }

  /** Free rerolls plus banked tokens, for the modal's button. */
  get rerollsAvailable(): number {
    return this.freeRerolls + this.rerollTokens;
  }

  get offer(): readonly BlessingDef[] {
    return this.currentOffer;
  }

  get offerWave(): number | null {
    return this.pendingOfferForWave;
  }

  get wavesCleared(): number {
    return this.wavesClearedThisRun;
  }

  /**
   * The composed stat totals, already summed across stacks.
   *
   * `greed_engine` is folded in here rather than in the contributor because its
   * value is a function of run state (waves cleared) that the immutable
   * `StatContext` has no other reason to carry.
   */
  getStatTotals(): Partial<Record<BlessingStat, number>> {
    return this.statCache;
  }

  /** All held blessings with their stack counts, in table order. */
  heldList(): Array<{ def: BlessingDef; stacks: number }> {
    const out: Array<{ def: BlessingDef; stacks: number }> = [];
    for (const def of BLESSINGS) {
      const n = this.held[def.id] ?? 0;
      if (n > 0) out.push({ def, stacks: n });
    }
    return out;
  }

  // ── cadence ──

  /**
   * Plan §1.1: the first draft lands after clearing wave 3, then every 4 waves
   * (3, 7, 11, 15, …), and stops entirely at the pick cap so a long run does
   * not become an unbounded stat pile.
   */
  isDraftDue(clearedWave: number): boolean {
    if (this.picksTaken >= BLESSING_MAX_PICKS) return false;
    if (clearedWave < BLESSING_FIRST_DRAFT_WAVE) return false;
    return (clearedWave - BLESSING_FIRST_DRAFT_WAVE) % BLESSING_DRAFT_INTERVAL === 0;
  }

  get isCapped(): boolean {
    return this.picksTaken >= BLESSING_MAX_PICKS;
  }

  // ── the draft ──

  /**
   * Blessings eligible to be offered right now: not maxed, past their wave
   * gate, prerequisite held, and with a consumer that actually exists.
   */
  eligible(wave: number, core?: CoreId): BlessingDef[] {
    const out: BlessingDef[] = [];
    for (const def of BLESSINGS) {
      if (def.offerable === false) continue;
      if (def.minWave !== undefined && wave < def.minWave) continue;
      if ((this.held[def.id] ?? 0) >= def.maxStacks) continue;
      if (def.requires && (this.held[def.requires] ?? 0) <= 0) continue;
      void core;
      out.push(def);
    }
    return out;
  }

  private offerWeight(def: BlessingDef, core?: CoreId): number {
    const pref = core ? def.corePreference?.[core] ?? 1 : 1;
    return Math.max(0.0001, def.weight * pref);
  }

  /**
   * Draw `BLESSING_OFFER_SIZE` distinct blessings, weighted by rarity.
   *
   * Without replacement *within the offer*: seeing the same card twice in one
   * draft would turn a three-way decision into a two-way one, which is the
   * whole point of the mechanic.
   */
  rollOffer(wave: number, core?: CoreId, rng: () => number = Math.random): BlessingDef[] {
    const pool = this.eligible(wave, core);
    const out: BlessingDef[] = [];
    while (out.length < BLESSING_OFFER_SIZE && pool.length > 0) {
      let total = 0;
      for (const def of pool) total += this.offerWeight(def, core);
      let r = rng() * total;
      let idx = pool.length - 1;
      for (let i = 0; i < pool.length; i++) {
        r -= this.offerWeight(pool[i], core);
        if (r <= 0) {
          idx = i;
          break;
        }
      }
      out.push(pool.splice(idx, 1)[0]);
    }
    return out;
  }

  /** Open a draft for `wave`, seeding the free reroll budget. */
  openDraft(wave: number, core?: CoreId, rng: () => number = Math.random): BlessingDef[] {
    this.pendingOfferForWave = wave;
    this.freeRerolls = BLESSING_FREE_REROLLS;
    this.currentOffer = this.rollOffer(wave, core, rng);
    return this.currentOffer;
  }

  /**
   * Spend a reroll (free first, then a token) and redraw the offer. Returns
   * false when there is nothing left to spend, so the caller can leave the
   * button disabled rather than silently redrawing for free.
   */
  reroll(core?: CoreId, rng: () => number = Math.random): BlessingDef[] | null {
    if (this.pendingOfferForWave === null) return null;
    if (this.freeRerolls > 0) {
      this.freeRerolls -= 1;
    } else if (this.rerollTokens > 0) {
      this.rerollTokens -= 1;
    } else {
      return null;
    }
    this.currentOffer = this.rollOffer(this.pendingOfferForWave, core, rng);
    return this.currentOffer;
  }

  /** Take a blessing. Rejects anything not on the table or already maxed. */
  choose(id: string): boolean {
    const def = BLESSING_BY_ID[id];
    if (!def) return false;
    if (this.picksTaken >= BLESSING_MAX_PICKS) return false;
    if ((this.held[id] ?? 0) >= def.maxStacks) return false;
    this.held[id] = (this.held[id] ?? 0) + 1;
    this.picksTaken += 1;
    this.rebuildCaches();
    this.closeDraft();
    this.bus?.emit('blessing_chosen', { id, stacks: this.held[id], def });
    return true;
  }

  /** Decline the offer. The draft still closes; no pick is spent. */
  skip(): void {
    this.closeDraft();
  }

  private closeDraft(): void {
    this.pendingOfferForWave = null;
    this.currentOffer = [];
    this.freeRerolls = 0;
  }

  /** Part 5 pays these out; the draft spends them after its free reroll. */
  grantRerollToken(count = 1): void {
    this.rerollTokens = Math.max(0, this.rerollTokens + count);
  }

  /** Advance the greed engine's clock. Cheap enough to call unconditionally. */
  noteWaveCleared(): void {
    this.wavesClearedThisRun += 1;
    if (this.behaviorCache.has('greed_engine')) this.rebuildCaches();
  }

  // ── lifecycle ──

  /** Blessings are run-scoped: ascension and transcendence both wipe them. */
  reset(): void {
    this.held = {};
    this.picksTaken = 0;
    this.rerollTokens = 0;
    this.wavesClearedThisRun = 0;
    this.closeDraft();
    this.rebuildCaches();
  }

  snapshot(): BlessingRunState {
    return {
      held: { ...this.held },
      picksTaken: this.picksTaken,
      rerolls: this.rerollTokens,
      pendingOfferForWave: this.pendingOfferForWave,
      wavesClearedThisRun: this.wavesClearedThisRun,
    };
  }

  restore(state: BlessingRunState | null | undefined): void {
    this.held = {};
    if (state && state.held) {
      for (const [id, stacks] of Object.entries(state.held)) {
        const def = BLESSING_BY_ID[id];
        if (!def) continue;
        const n = Math.max(0, Math.min(def.maxStacks, Math.floor(stacks)));
        if (n > 0) this.held[id] = n;
      }
    }
    this.picksTaken = Math.max(0, Math.floor(state?.picksTaken ?? 0));
    this.rerollTokens = Math.max(0, Math.floor(state?.rerolls ?? 0));
    this.wavesClearedThisRun = Math.max(0, Math.floor(state?.wavesClearedThisRun ?? 0));
    // A draft that was open when the tab closed is dropped rather than
    // restored: the offer itself is not persisted, and re-rolling a fresh one
    // on load would silently hand out a different choice than the one the
    // player was looking at.
    this.closeDraft();
    this.rebuildCaches();
  }

  /**
   * Recompute the behavior set and stat totals. Called from every mutation of
   * `held` — these are read per shot and per kill.
   */
  private rebuildCaches(): void {
    this.behaviorCache.clear();
    const stats: Partial<Record<BlessingStat, number>> = {};
    for (const def of BLESSINGS) {
      const n = this.held[def.id] ?? 0;
      if (n <= 0) continue;
      if (def.behavior) this.behaviorCache.add(def.behavior);
      if (!def.effects) continue;
      for (const e of def.effects) {
        stats[e.stat] = (stats[e.stat] ?? 0) + e.perStack * n;
      }
    }
    if (this.behaviorCache.has('greed_engine')) {
      stats.goldPct = (stats.goldPct ?? 0)
        + BLESSING_TUNING.greedPerWave * this.wavesClearedThisRun;
    }
    this.statCache = stats;
  }
}
