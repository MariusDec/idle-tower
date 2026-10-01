import { BALANCE } from '../content/balance';
import { PACT_BY_ID } from '../content/pacts';
import type { BossDef, BossPhase, PactId, RegionDef, StatMod } from '../content/types';

/**
 * What the pacts a run is under do to it (§9), resolved once per pacts
 * object. `PactEffect`'s one consumer: the rest of the sim asks here.
 */
export interface PactLoad {
  /** Heat: every rank of every pact. */
  heat: number;
  /** Bodies per wave multiply by this (Hordes). */
  count: number;
  /** Every body's HP multiplies by this (Vigour). */
  hp: number;
  /** Every body's speed multiplies by this (Haste). */
  speed: number;
  /** Elites added to every elite wave (Elites). */
  elites: number;
  /** Cards added to every draft; negative (Scarcity). */
  choices: number;
  /** Phases a boss gains (Tyranny)… */
  tyranny: number;
  /** …and its HP multiplier. */
  bossHp: number;
  /** Blight Surge's ranks. */
  surge: number;
  /** Tower stat tolls (Frailty), as contributions. */
  mods: StatMod[];
}

const LOADS = new WeakMap<object, PactLoad>();

/** Shards rise with heat (§9: × (1 + 0.1 × heat)). */
export function heatShardMult(heat: number): number {
  return 1 + BALANCE.pacts.shardsPerHeat * heat;
}

export function pactLoad(pacts: Readonly<Partial<Record<PactId, number>>>): PactLoad {
  const hit = LOADS.get(pacts);
  if (hit) return hit;
  const out: PactLoad = { heat: 0, count: 1, hp: 1, speed: 1, elites: 0, choices: 0, tyranny: 0, bossHp: 1, surge: 0, mods: [] };
  for (const [id, rank] of Object.entries(pacts) as [PactId, number][]) {
    const def = PACT_BY_ID[id];
    if (!def || !(rank > 0)) continue;
    const r = Math.min(rank, def.ranks);
    out.heat += r;
    const e = def.effect;
    switch (e.kind) {
      case 'count':
        out.count += e.pct * r;
        break;
      case 'hp':
        out.hp *= Math.pow(e.mult, r);
        break;
      case 'speed':
        out.speed += e.pct * r;
        break;
      case 'elites':
        out.elites += e.n * r;
        break;
      case 'stat':
        out.mods.push(scaleMod(e.mod, r));
        break;
      case 'choices':
        out.choices += e.n * r;
        break;
      case 'tyranny':
        out.tyranny += r;
        out.bossHp += e.hp * r;
        break;
      case 'surge':
        out.surge += r;
        break;
      default: {
        const exhaustive: never = e;
        return exhaustive;
      }
    }
  }
  if (out.heat > 0) out.mods.push({ key: 'shardGain', mult: heatShardMult(out.heat) });
  LOADS.set(pacts, out);
  return out;
}

/** A stat contribution `n` times over: the same as `n` copies to the resolver. */
export function scaleMod(m: StatMod, n: number): StatMod {
  return {
    key: m.key,
    ...(m.add !== undefined ? { add: m.add * n } : {}),
    ...(m.pct !== undefined ? { pct: m.pct * n } : {}),
    ...(m.mult !== undefined ? { mult: Math.pow(m.mult, n) } : {}),
  };
}

/** Blight Surge's ranks that harshen this region's own rule (Mist, Echoes, the Blight); 0 elsewhere. */
export function ruleSurge(load: PactLoad, region: RegionDef): number {
  return region.surge.effect.kind === 'rule' ? load.surge : 0;
}

/** Blight Surge's toll on the tower where the rule favours it or there is none: its stat, per rank. */
export function surgeMods(load: PactLoad, region: RegionDef): StatMod[] {
  const e = region.surge.effect;
  return e.kind === 'stat' && load.surge > 0 ? [scaleMod(e.mod, load.surge)] : [];
}

const PHASES = new Map<string, readonly BossPhase[]>();

/**
 * A boss's phases under Tyranny (§9): each rank adds one more at the end,
 * below the last, replaying its phases from the first.
 */
export function bossPhases(def: BossDef, tyranny: number): readonly BossPhase[] {
  if (tyranny <= 0) return def.phases;
  const key = `${def.id}:${tyranny}`;
  const hit = PHASES.get(key);
  if (hit) return hit;
  const last = def.phases[def.phases.length - 1].below;
  const extra: BossPhase[] = [];
  for (let k = 1; k <= tyranny; k++) {
    const from = def.phases[(k - 1) % def.phases.length];
    extra.push({
      below: last * (1 - k / (tyranny + 1)),
      line: `Tyranny: it rises again. ${from.line}`,
      patterns: from.patterns,
      ...(from.armor !== undefined ? { armor: from.armor } : {}),
    });
  }
  const out = [...def.phases, ...extra];
  PHASES.set(key, out);
  return out;
}
