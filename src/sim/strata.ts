import { TAU } from '../core/math';
import { BALANCE } from '../content/balance';
import { BOSS_BY_ID } from '../content/bosses';
import { ENEMY_BY_ID } from '../content/enemies';
import { floorWave } from '../content/abyss';
import type { EnemyId, EnemyVerb, RegionDef, StratumRule } from '../content/types';
import type { Enemy, RunState } from './state';
import { phasesOf } from './systems/boss';
import { runRegion, runWave } from './systems/waves';

/**
 * The strata's rules (plans/late-game/08 §4.2), folded. `ruleLoad` is the
 * one switch on `StratumRule`: it turns the floor's rules, and any rule the
 * guardian's phase wears, into one load the systems read, as `pactLoad`
 * does for pacts.
 */
export interface RuleLoad {
  /** The gates' angles now; null: bodies come from anywhere on the rim. */
  gates: readonly number[] | null;
  /** The Inversion: the share of walking bodies that start at the wall, and an escape's drain. */
  inversion: { share: number; drain: number } | null;
}

const NONE: RuleLoad = { gates: null, inversion: null };

/** Floor gates at wave `n` of `region`: its angles, turned for the floor's own wave. Null on a floor without them. */
export function floorGates(region: RegionDef, n: number): number[] | null {
  const g = region.abyss?.gates;
  if (!g) return null;
  const turn = g.turn * (floorWave(n) - 1);
  return g.angles.map((a) => a + turn);
}

/** Fold `rules` on wave `n` of `region` into one load. */
export function foldRules(region: RegionDef, n: number, rules: readonly StratumRule[]): RuleLoad {
  if (rules.length === 0) return NONE;
  let gates: number[] | null = null;
  let open = 0;
  let inversion = null as RuleLoad['inversion'];
  for (const r of rules) {
    switch (r.kind) {
      case 'gates':
        if (r.count !== undefined) open = Math.max(open, r.count);
        else gates ??= floorGates(region, n) ?? [0, Math.PI];
        break;
      case 'inversion':
        inversion = {
          share: Math.max(inversion?.share ?? 0, r.share),
          drain: Math.max(inversion?.drain ?? 0, r.drain),
        };
        break;
      default: {
        const exhaustive: never = r;
        return exhaustive;
      }
    }
  }
  // Every gate thrown open (the Deepwarden's last phase): `open` of them, evenly, from the floor's first.
  if (open > 0) {
    const a0 = floorGates(region, n)?.[0] ?? 0;
    gates = Array.from({ length: open }, (_, i) => a0 + (i / open) * TAU);
  }
  return { gates, inversion };
}

/** The rules the run is under now: its floor's, and the boss's phase's while it stands. */
export function ruleLoad(run: RunState): RuleLoad {
  const region = runRegion(run);
  const rules: StratumRule[] = [...(region.abyss?.rules ?? [])];
  const b = run.boss;
  if (b && b.killedIn === null) {
    const phase = phasesOf(run, BOSS_BY_ID[b.id])[b.phase];
    for (const p of phase?.patterns ?? []) if (p.kind === 'rule') rules.push(p.rule);
  }
  return foldRules(region, runWave(run), rules);
}

/** An angle on the rim through one of `gates`, or anywhere without them. */
export function gateAngle(gates: readonly number[] | null, rng: { pick<T>(list: readonly T[]): T; range(a: number, b: number): number }): number {
  if (!gates) return rng.range(0, TAU);
  const arc = BALANCE.strata.gates.arc;
  return rng.pick(gates) + rng.range(-arc, arc);
}

/** Verbs that walk to the wall: the bodies the Inversion and a Tidecaller turn round. */
export function walksIn(verb: EnemyVerb): boolean {
  switch (verb.kind) {
    case 'walker':
    case 'split':
    case 'shards':
    case 'explode':
    case 'leech':
    case 'carapace':
    case 'charge':
    case 'devour':
    case 'blink':
    case 'retreat':
    // The Wake's walkers (plans/late-game/12 §5).
    case 'ring':
    case 'sleepwalk':
    case 'offbeat':
    case 'streak':
    case 'lane':
    case 'slab':
    case 'sledge':
    case 'trample':
    case 'ride':
    case 'herd':
    case 'grounded':
      return true;
    case 'ranged':
    case 'heal':
    case 'shield':
    case 'burrow':
    case 'phase':
    case 'summon':
    case 'silence':
    case 'chorus':
    case 'ward':
    case 'tide':
    case 'conduct':
    case 'squall':
      return false;
    default: {
      const exhaustive: never = verb;
      return exhaustive;
    }
  }
}

/** True for a body a Tidecaller or the Inversion may turn: a plain walker, not a boss's. */
export function turnable(e: Enemy): boolean {
  return e.alive && !e.boss && !e.court && !e.plate && walksIn(ENEMY_BY_ID[e.type].verb);
}

/**
 * The Inversion (§4.2): a fresh body of `type` may start at the wall and
 * walk out, rolled on the `strata` stream at the load's share.
 */
export function inverts(type: EnemyId, share: number, chance: (p: number) => boolean): boolean {
  return walksIn(ENEMY_BY_ID[type].verb) && chance(share);
}

/** Put `e` at the wall on its own line, walking out. */
export function invert(run: RunState, e: Enemy): void {
  const d = Math.hypot(e.x, e.y) || 1;
  const at = run.stats.radius + e.radius + BALANCE.strata.inversion.gap;
  e.x = e.px = (e.x / d) * at;
  e.y = e.py = (e.y / d) * at;
  e.heading = -1;
  e.inContact = false;
}
