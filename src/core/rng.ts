/**
 * The seeded RNG (plan §12.3). The only source of randomness `sim/` may use.
 *
 * sfc32 over a 128-bit state: fast, small, and good enough for a game. The
 * state is a plain array so a `RunState` holding an `Rng` stays serialisable
 * for the run snapshot (§12.4).
 *
 * **Splittable.** `split(label)` derives an independent stream from this one's
 * seed and a label, without advancing this stream. Systems that draw a
 * variable number of values (spawn jitter, crit rolls) each get their own
 * stream, so adding a draw in one system never reshuffles another — a
 * tuning change to crits cannot move where wave 7 spawns.
 */

export interface RngState {
  /** The four 32-bit words of sfc32 state. */
  s: [number, number, number, number];
  /** The seed this stream was created from; `split` derives children from it. */
  seed: number;
}

/** 32-bit string hash (FNV-1a), for mixing labels into seeds. */
export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** splitmix32: spreads a 32-bit seed into well-mixed state words. */
function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    return t >>> 0;
  };
}

export class Rng {
  readonly state: RngState;

  constructor(seed: number | RngState) {
    if (typeof seed === 'number') {
      const mix = splitmix32(seed);
      this.state = { s: [mix(), mix(), mix(), mix()], seed: seed >>> 0 };
      // Discard the first few outputs; sfc32 wants a short warm-up.
      for (let i = 0; i < 12; i++) this.nextU32();
    } else {
      this.state = { s: [...seed.s] as RngState['s'], seed: seed.seed };
    }
  }

  /**
   * An `Rng` that draws from `state` in place, so the owner of the state (a
   * `RunState`) sees every advance. The constructor copies; this does not.
   */
  static wrap(state: RngState): Rng {
    const r = Object.create(Rng.prototype) as Rng;
    (r as { state: RngState }).state = state;
    return r;
  }

  /** A child stream keyed by `label`. Does not advance this stream. */
  split(label: string): Rng {
    return new Rng((this.state.seed ^ hashString(label)) >>> 0);
  }

  nextU32(): number {
    const s = this.state.s;
    let a = s[0], b = s[1], c = s[2], d = s[3];
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    s[0] = a; s[1] = b; s[2] = c; s[3] = d;
    return t >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max], inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** Index into `weights`, chosen proportionally. */
  weighted(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r < 0) return i;
    }
    return weights.length - 1;
  }
}
