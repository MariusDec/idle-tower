import {
  CONTRACTS,
  CONTRACT_BY_ID,
  CONTRACT_SLOTS,
  CONTRACT_TUNING,
  describeContract,
  describeReward,
  type ContractDef,
  type ContractGoal,
  type ContractGoalKind,
  type ContractReward,
} from '../data/contracts';
import type { ActiveContractState, ContractRunState, EnemyType } from '../types';

/**
 * The slice of `EventBus` this manager needs.
 *
 * Structural rather than the class, so `sim/model.ts` can drive the *real*
 * manager with a three-line stub instead of the model growing its own copy of
 * the draw rules and the AP cap.
 */
export interface ContractEmitter {
  emit: (event: string, payload?: unknown) => void;
}

/**
 * Everything that can move a contract forward.
 *
 * A closed union fed from `Game`'s event-bus subscriptions rather than polled:
 * with ten goal kinds, a per-frame scan would be ten predicates times three
 * slots times 60 Hz for a value that changes a few dozen times a run.
 */
export type ContractEvent =
  | { kind: 'enemy_killed'; type: EnemyType }
  | { kind: 'wave_cleared'; wave: number; flawless: boolean; mutatorActive: boolean }
  /** One boss *encounter* (the whole `2 + tier` pack), and how long it took. */
  | { kind: 'boss_encounter'; seconds: number }
  | { kind: 'orb_collected' }
  | { kind: 'ability_cast' }
  | { kind: 'gold_spent'; amount: number };

/** A contract in a live slot, with its target already resolved for the band. */
export interface ActiveContract {
  def: ContractDef;
  /** Instance id — a def can be drawn again later, the tracker keys on this. */
  uid: number;
  goal: ContractGoal;
  target: number;
  progress: number;
  drawnAtWave: number;
}

export interface CompletedContract {
  defId: string;
  name: string;
  wave: number;
}

/**
 * How each goal kind consumes an event.
 *
 * **This `Record` is the point of the whole file** (plan §5.5 and cross-cutting
 * rule 3). It is a `Record` over `ContractGoalKind`, so a goal kind added to
 * the union without a consumer does not compile — it is not a documentation
 * table that can drift from the code, it *is* the progress implementation.
 *
 * Each entry returns the contract's **new progress value**, not a delta, so
 * monotonic goals (`reach_wave`) and accumulating ones (`kill_count`) can share
 * one shape.
 */
const CONTRACT_PROGRESS: Record<
  ContractGoalKind,
  (c: ActiveContract, ev: ContractEvent) => number
> = {
  kill_type: (c, ev) => {
    if (ev.kind !== 'enemy_killed') return c.progress;
    if (c.goal.kind !== 'kill_type' || ev.type !== c.goal.type) return c.progress;
    return c.progress + 1;
  },
  kill_count: (c, ev) => (ev.kind === 'enemy_killed' ? c.progress + 1 : c.progress),
  clear_waves: (c, ev) => (ev.kind === 'wave_cleared' ? c.progress + 1 : c.progress),
  flawless_waves: (c, ev) =>
    ev.kind === 'wave_cleared' && ev.flawless ? c.progress + 1 : c.progress,
  boss_under: (c, ev) => {
    if (ev.kind !== 'boss_encounter') return c.progress;
    if (c.goal.kind !== 'boss_under') return c.progress;
    // Scored per *encounter*, never per boss: a wave-40 pack is six bosses and
    // paying this out six times would make "under 30 s" mean "under 30 s, six
    // times over" (see the Part 3 status block in the plan).
    return ev.seconds <= c.goal.seconds ? c.progress + 1 : c.progress;
  },
  collect_orbs: (c, ev) => (ev.kind === 'orb_collected' ? c.progress + 1 : c.progress),
  cast_abilities: (c, ev) => (ev.kind === 'ability_cast' ? c.progress + 1 : c.progress),
  reach_wave: (c, ev) =>
    ev.kind === 'wave_cleared' ? Math.max(c.progress, ev.wave) : c.progress,
  survive_mutator: (c, ev) =>
    ev.kind === 'wave_cleared' && ev.mutatorActive ? c.progress + 1 : c.progress,
  spend_gold: (c, ev) =>
    ev.kind === 'gold_spent' ? c.progress + Math.max(0, ev.amount) : c.progress,
};

export interface ContractManagerDeps {
  bus?: ContractEmitter;
  /** The wave a contract is drawn at / measured against. */
  currentWave: () => number;
  /** Gold one wave is worth right now — `Game.estimateWaveGold`. */
  waveGold: (wave: number) => number;
  rng?: () => number;
}

/**
 * The run's three live contracts (gameplay plan §5).
 *
 * Two invariants this class exists to hold:
 *   1. **Three slots, always.** Completing one immediately draws its
 *      replacement, so the tracker is never a short list or an empty one.
 *   2. **The AP bonus is capped.** `apBonusPct` grants are clamped in
 *      aggregate at `CONTRACT_TUNING.apBonusCap`, here rather than at the
 *      reader, so `PrestigeManager` cannot be handed an uncapped figure by a
 *      future caller.
 */
export class ContractManager {
  private readonly deps: ContractManagerDeps;
  private readonly rng: () => number;
  private active: ActiveContract[] = [];
  private history: CompletedContract[] = [];
  private apBonus = 0;
  private completedCount = 0;
  private uidSeq = 0;

  constructor(deps: ContractManagerDeps) {
    this.deps = deps;
    this.rng = deps.rng ?? Math.random;
  }

  // ── queries ──

  get list(): readonly ActiveContract[] {
    return this.active;
  }

  get completed(): number {
    return this.completedCount;
  }

  get recent(): readonly CompletedContract[] {
    return this.history;
  }

  /** The run's contract AP bonus, already capped. */
  get apBonusPct(): number {
    return this.apBonus;
  }

  get isApCapped(): boolean {
    return this.apBonus >= CONTRACT_TUNING.apBonusCap - 1e-9;
  }

  /** Gold a contract's reward is worth right now (0 when it pays no gold). */
  goldValue(c: ActiveContract): number {
    if (!c.def.reward.goldWaves) return 0;
    return Math.max(1, Math.floor(this.deps.waveGold(this.deps.currentWave()) * c.def.reward.goldWaves));
  }

  label(c: ActiveContract): string {
    return describeContract(c.goal, c.target);
  }

  rewardLabel(c: ActiveContract): string {
    return describeReward(c.def.reward, this.goldValue(c));
  }

  // ── drawing ──

  /**
   * Defs drawable at `wave`: inside the band, not already in a live slot.
   *
   * The band is the tiering mechanism plan §5.1 asks for — `maxWave` retires a
   * contract the player has outgrown, `minWave` keeps one out of reach of a
   * tower that cannot attempt it. `goalAvailableFromWave` is the correctness
   * floor underneath both, pinned by the tests.
   */
  eligible(wave: number): ContractDef[] {
    const held = new Set(this.active.map(c => c.def.id));
    const out: ContractDef[] = [];
    for (const def of CONTRACTS) {
      if (held.has(def.id)) continue;
      if (wave < def.minWave) continue;
      if (def.maxWave !== undefined && wave > def.maxWave) continue;
      out.push(def);
    }
    return out;
  }

  /** Fill empty slots up to `CONTRACT_SLOTS`. Safe to call at any time. */
  refill(): void {
    const wave = Math.max(1, Math.floor(this.deps.currentWave()));
    let guard = CONTRACT_SLOTS * 4;
    while (this.active.length < CONTRACT_SLOTS && guard-- > 0) {
      const pool = this.eligible(wave);
      if (pool.length === 0) break;
      const def = this.pick(pool);
      const contract = this.instantiate(def, wave);
      this.active.push(contract);
      this.deps.bus?.emit('contract_drawn', {
        uid: contract.uid,
        id: def.id,
        name: def.name,
        label: this.label(contract),
      });
    }
  }

  private pick(pool: ContractDef[]): ContractDef {
    let total = 0;
    for (const def of pool) total += Math.max(0.0001, def.weight);
    let r = this.rng() * total;
    for (const def of pool) {
      r -= Math.max(0.0001, def.weight);
      if (r <= 0) return def;
    }
    return pool[pool.length - 1];
  }

  private instantiate(def: ContractDef, wave: number): ActiveContract {
    return {
      def,
      uid: ++this.uidSeq,
      goal: def.goal,
      target: this.resolveTarget(def.goal, wave),
      progress: 0,
      drawnAtWave: wave,
    };
  }

  /**
   * Turn a def's goal into an absolute target for the wave it was drawn at.
   *
   * Only two kinds actually need it — `reach_wave` and `spend_gold` — but the
   * switch is exhaustive so a future scaling goal cannot be added without a
   * decision here.
   */
  private resolveTarget(goal: ContractGoal, wave: number): number {
    switch (goal.kind) {
      case 'reach_wave':
        return wave + goal.ahead;
      case 'spend_gold':
        return Math.max(1, Math.floor(this.deps.waveGold(wave) * goal.goldWaves));
      case 'kill_type':
      case 'kill_count':
      case 'clear_waves':
      case 'flawless_waves':
      case 'collect_orbs':
      case 'cast_abilities':
        return goal.count;
      case 'boss_under':
        return goal.count;
      case 'survive_mutator':
        return goal.waves;
    }
  }

  /** `reach_wave` measures an absolute wave, so its bar starts part-full. */
  fillFraction(c: ActiveContract): number {
    if (c.goal.kind === 'reach_wave') {
      const span = Math.max(1, c.target - c.drawnAtWave);
      return clamp01((c.progress - c.drawnAtWave) / span);
    }
    return clamp01(c.progress / Math.max(1, c.target));
  }

  /** `12 / 40`-style readout for the tracker row. */
  progressLabel(c: ActiveContract): string {
    if (c.goal.kind === 'reach_wave') {
      return `${Math.max(c.drawnAtWave, Math.floor(c.progress))} / ${c.target}`;
    }
    if (c.goal.kind === 'spend_gold') {
      return `${compact(c.progress)} / ${compact(c.target)}`;
    }
    return `${Math.floor(c.progress)} / ${c.target}`;
  }

  // ── progress ──

  /**
   * Feed one event to every live slot, completing and replacing what it fills.
   *
   * Completion is resolved inside the same call so the tracker never shows a
   * finished contract sitting at 40/40 waiting for a tick.
   */
  note(ev: ContractEvent): void {
    if (this.active.length === 0) return;
    let completedAny = false;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const c = this.active[i];
      const next = CONTRACT_PROGRESS[c.goal.kind](c, ev);
      if (next === c.progress) continue;
      c.progress = next;
      if (c.progress < c.target) continue;
      this.active.splice(i, 1);
      this.complete(c);
      completedAny = true;
    }
    if (completedAny) this.refill();
  }

  private complete(c: ActiveContract): void {
    const wave = Math.max(1, Math.floor(this.deps.currentWave()));
    this.completedCount += 1;
    this.history.push({ defId: c.def.id, name: c.def.name, wave });
    if (this.history.length > CONTRACT_TUNING.historyLimit) {
      this.history.splice(0, this.history.length - CONTRACT_TUNING.historyLimit);
    }
    const reward = this.grantReward(c);
    this.deps.bus?.emit('contract_completed', {
      uid: c.uid,
      id: c.def.id,
      name: c.def.name,
      label: this.label(c),
      wave,
      reward,
    });
  }

  /**
   * Resolve a completion's payout, applying the AP cap.
   *
   * The returned `apBonusPct` is what was *actually* banked, which is zero once
   * the run is at the cap — the caller pays what this says rather than what the
   * def asked for, so the ceiling cannot be routed around.
   */
  private grantReward(c: ActiveContract): Required<ContractReward> {
    const r = c.def.reward;
    let ap = 0;
    if (r.apBonusPct) {
      ap = Math.min(r.apBonusPct, Math.max(0, CONTRACT_TUNING.apBonusCap - this.apBonus));
      this.apBonus = Math.min(CONTRACT_TUNING.apBonusCap, this.apBonus + ap);
    }
    return {
      goldWaves: r.goldWaves ?? 0,
      rerolls: r.rerolls ?? 0,
      rp: r.rp ?? 0,
      apBonusPct: ap,
    };
  }

  // ── lifecycle ──

  /** Contracts are run-scoped: ascension and transcendence both wipe them. */
  reset(): void {
    this.active = [];
    this.history = [];
    this.apBonus = 0;
    this.completedCount = 0;
    this.uidSeq = 0;
    this.refill();
  }

  snapshot(): ContractRunState {
    return {
      active: this.active.map(c => ({
        defId: c.def.id,
        uid: c.uid,
        target: c.target,
        progress: c.progress,
        drawnAtWave: c.drawnAtWave,
      })),
      completed: this.history.map(h => h.defId),
      completedCount: this.completedCount,
      apBonusPct: this.apBonus,
      uidSeq: this.uidSeq,
    };
  }

  restore(state: ContractRunState | null | undefined): void {
    this.active = [];
    this.history = [];
    this.completedCount = Math.max(0, Math.floor(state?.completedCount ?? 0));
    this.apBonus = Math.min(
      CONTRACT_TUNING.apBonusCap,
      Math.max(0, state?.apBonusPct ?? 0),
    );
    this.uidSeq = Math.max(0, Math.floor(state?.uidSeq ?? 0));
    for (const entry of state?.active ?? []) {
      const restored = this.restoreOne(entry);
      if (restored) this.active.push(restored);
    }
    for (const defId of state?.completed ?? []) {
      const def = CONTRACT_BY_ID[defId];
      if (def) this.history.push({ defId, name: def.name, wave: 0 });
    }
    // A save written before a def was removed from the pool loses that slot;
    // the refill puts the tracker back to three rather than leaving a hole.
    this.refill();
  }

  private restoreOne(entry: ActiveContractState): ActiveContract | null {
    const def = CONTRACT_BY_ID[entry.defId];
    if (!def) return null;
    const target = Math.max(1, Math.floor(entry.target));
    const drawnAtWave = Math.max(1, Math.floor(entry.drawnAtWave));
    const uid = Math.max(1, Math.floor(entry.uid));
    if (uid > this.uidSeq) this.uidSeq = uid;
    return {
      def,
      uid,
      goal: def.goal,
      target,
      // A restored contract can be at its target already only if the save was
      // written mid-completion; clamping keeps it below so the next event
      // resolves it through the normal path.
      progress: Math.max(0, Math.min(entry.progress, target - 1)),
      drawnAtWave,
    };
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function compact(v: number): string {
  const n = Math.floor(v);
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}
