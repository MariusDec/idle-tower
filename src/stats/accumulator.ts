import { STAT_BASES, STAT_CLAMPS, STAT_KEYS, type StatKey, type StatSource } from './keys';

export interface Contribution {
  source: StatSource;
  label: string;
  kind: 'add' | 'mult';
  value: number;
}

export type Breakdown = Partial<Record<StatKey, Contribution[]>>;

/** The two buckets a contributor may write into, pre-bound to one source. */
export interface SourceHandle {
  /** Additive bucket: summed with the stat's base before any multiplier. */
  add(stat: StatKey, value: number, label?: string): void;
  /** Multiplicative bucket: multiplied into the total after every add. */
  mult(stat: StatKey, factor: number, label?: string): void;
}

/**
 * Collects contributions into one additive and one multiplicative bucket per
 * stat, so `(base + sum) * product` is the only composition rule in the game.
 *
 * Order of contribution is irrelevant by construction — which is the whole
 * point. The old pipeline's result depended on the order eight systems
 * happened to run in, and six of them used `=` where they meant `*=`.
 *
 * `trackBreakdown` is opt-in because the resolve runs on every purchase, every
 * buff edge and every wave transition, while the attribution is only needed
 * when the Stats panel is actually rendering.
 */
export class StatAccumulator {
  private readonly adds: Record<StatKey, number>;
  private readonly mults: Record<StatKey, number>;
  private readonly breakdown: Breakdown | null;

  constructor(trackBreakdown = false) {
    this.adds = {} as Record<StatKey, number>;
    this.mults = {} as Record<StatKey, number>;
    for (const key of STAT_KEYS) {
      this.adds[key] = 0;
      this.mults[key] = 1;
    }
    this.breakdown = trackBreakdown ? {} : null;
  }

  source(source: StatSource, defaultLabel: string): SourceHandle {
    return {
      add: (stat, value, label) => this.add(stat, value, source, label ?? defaultLabel),
      mult: (stat, factor, label) => this.mult(stat, factor, source, label ?? defaultLabel),
    };
  }

  add(stat: StatKey, value: number, source: StatSource, label: string): void {
    if (!Number.isFinite(value) || value === 0) return;
    this.adds[stat] += value;
    this.record(stat, { source, label, kind: 'add', value });
  }

  mult(stat: StatKey, factor: number, source: StatSource, label: string): void {
    if (!Number.isFinite(factor) || factor === 1) return;
    this.mults[stat] *= factor;
    this.record(stat, { source, label, kind: 'mult', value: factor });
  }

  /** Sum of the additive bucket only, before multipliers — used by derived keys. */
  additive(stat: StatKey): number {
    return STAT_BASES[stat] + this.adds[stat];
  }

  /** Product of the multiplicative bucket only. */
  multiplier(stat: StatKey): number {
    return this.mults[stat];
  }

  /** `(base + adds) * mults`, then the stat's clamp. */
  resolve(stat: StatKey): number {
    const raw = (STAT_BASES[stat] + this.adds[stat]) * this.mults[stat];
    return clampStat(stat, raw);
  }

  getBreakdown(): Breakdown {
    return this.breakdown ?? {};
  }

  contributions(stat: StatKey): Contribution[] {
    return this.breakdown?.[stat] ?? [];
  }

  private record(stat: StatKey, entry: Contribution): void {
    if (!this.breakdown) return;
    const list = this.breakdown[stat];
    if (list) list.push(entry);
    else this.breakdown[stat] = [entry];
  }
}

export function clampStat(stat: StatKey, value: number): number {
  const clamp = STAT_CLAMPS[stat];
  let out = Number.isFinite(value) ? value : STAT_BASES[stat];
  if (clamp) {
    if (clamp.min !== undefined && out < clamp.min) out = clamp.min;
    if (clamp.max !== undefined && out > clamp.max) out = clamp.max;
    if (clamp.integer) out = Math.floor(out);
  }
  return out;
}
