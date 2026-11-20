import { BALANCE } from './balance';
import type { AuraId, BossId, EnemyId, RimColor, StratumId, StratumRule, WaveBeat } from './types';

/**
 * The Abyss's strata (plans/late-game/08): six floors each, every one with
 * its own rule, natives, guardian, ground and music. Floors 1–5 of a
 * stratum end on a Keeper; floor 6 on its guardian. Each stratum carries
 * its own HP curve (R7), and each starts where the last one ended, so a
 * boundary has no cliff: the guardian is the step.
 *
 * Strata I and II are authored. Past them the Abyss keeps today's cycle
 * behind a shim (`content/abyss.ts`), on `BALANCE.abyss`'s curve picked up
 * from the last authored wave, until III–V are built.
 */

/** Floors to a stratum. */
export const STRATUM_FLOORS = 6;

/** The Abyss's bottom (§4.5): five strata of six floors. */
export const BOTTOM = 30;

/** A stratum's voice (§5.1): the music's key and loop while a run is in it. */
export interface StratumTone {
  /** Semitones from the music's A2 root. */
  readonly shift: number;
  /** The run loop, chords as semitones over the root; absent: the run mood's own. */
  readonly loop?: readonly (readonly number[])[];
  /** Seconds a run chord holds. */
  readonly chord?: number;
  /** The run pad's lowpass cutoff, Hz. */
  readonly cutoff?: number;
  /** A low root sustained under the floor. */
  readonly drone?: boolean;
  /** A bell (a sine at +19 semitones, fast decay) tolling every second chord: the gate. */
  readonly bell?: boolean;
  /** A bass pulse in the run mood, a beat of this many seconds; 0 or absent for none. */
  readonly pulse?: number;
}

/** One floor of a stratum, authored. */
export interface FloorDef {
  /** Gate angles, radians (0 right, π/2 down); null on a floor without the Gates. */
  readonly gates: readonly number[] | null;
  /** How far the gates turn each wave, radians. */
  readonly turn?: number;
  /** Two Act 1 types the deep has taken in. */
  readonly guests: readonly [EnemyId, EnemyId];
  /** The stratum's own that walk this floor. */
  readonly natives: readonly EnemyId[];
  /** Waves 5 and 8. */
  readonly beats: Readonly<Record<number, WaveBeat>>;
  /** The Champion that ends it; null on the guardian's floor. */
  readonly keeper: EnemyId | null;
  readonly rules: readonly StratumRule[];
}

export interface StratumDef {
  readonly id: StratumId;
  /** "The Gate". */
  readonly name: string;
  /** "I". */
  readonly numeral: string;
  /** The rule, named and in one line (≤ 15 words, R4). */
  readonly rule: { readonly name: string; readonly text: string };
  /** Its natives, in the order they arrive. */
  readonly natives: readonly EnemyId[];
  /** Its guardian, on its sixth floor. */
  readonly boss: BossId;
  /** HP growth a wave inside it (R7: authored per stratum). */
  readonly hpGrowth: number;
  /** The guardian's HP multiple of its floor's last wave. */
  readonly bossHp: number;
  /** The ground's tint. */
  readonly tint: string;
  /** The rim's colour: a semantic one, so the safe palette swaps it. */
  readonly rim: RimColor;
  /** Its elites' auras, and the one its Keepers wear. */
  readonly auras: readonly AuraId[];
  readonly keeperAura: AuraId;
  readonly tone: StratumTone;
  readonly floors: readonly FloorDef[];
}

const PI = Math.PI;

export const STRATA: readonly StratumDef[] = [
  {
    id: 'gate',
    name: 'The Gate',
    numeral: 'I',
    rule: { name: 'Gates', text: 'Waves come only through the floor’s gates.' },
    natives: ['husk', 'lurker', 'wardstone'],
    boss: 'deepwarden',
    hpGrowth: 1.08,
    bossHp: 0.3,
    tint: '#1d3540',
    rim: 'frost',
    auras: ['haste', 'shield', 'vengeful', 'regen'],
    keeperAura: 'shield',
    tone: {
      shift: -5,
      loop: [[0, 3, 7], [-2, 2, 5], [-4, 0, 3], [-2, 2, 5]],
      chord: 5,
      cutoff: 1000,
      drone: true,
      bell: true,
    },
    floors: [
      {
        // The short walk: the flanks, where a phone's stage is narrowest.
        gates: [0, PI], guests: ['grunt', 'runner'], natives: ['husk'],
        beats: { 5: { kind: 'swarm', countMult: 1.3 }, 8: { kind: 'swarm', countMult: 1.5 } },
        keeper: 'husk', rules: [{ kind: 'gates' }],
      },
      {
        // The long walk: top and bottom.
        gates: [-PI / 2, PI / 2], guests: ['splitter', 'spitter'], natives: ['husk', 'lurker'],
        beats: { 5: { kind: 'introduce', enemy: 'lurker', packs: 2 }, 8: { kind: 'swarm', countMult: 1.4 } },
        keeper: 'lurker', rules: [{ kind: 'gates' }],
      },
      {
        gates: [-PI / 2, PI / 6, (5 * PI) / 6], guests: ['brute', 'mender'], natives: ['husk', 'lurker'],
        beats: { 5: { kind: 'swarm', countMult: 1.3 }, 8: { kind: 'swarm', countMult: 1.5 } },
        keeper: 'husk', rules: [{ kind: 'gates' }],
      },
      {
        // One front, below.
        gates: [PI / 3, (2 * PI) / 3], guests: ['shieldbearer', 'blinker'], natives: ['husk', 'lurker', 'wardstone'],
        beats: { 5: { kind: 'introduce', enemy: 'wardstone', packs: 2 }, 8: { kind: 'swarm', countMult: 1.4 } },
        keeper: 'husk', rules: [{ kind: 'gates' }],
      },
      {
        gates: [PI / 4, (3 * PI) / 4, (-3 * PI) / 4, -PI / 4], guests: ['bomber', 'phantom'], natives: ['husk', 'lurker', 'wardstone'],
        beats: { 5: { kind: 'swarm', countMult: 1.4 }, 8: { kind: 'swarm', countMult: 1.5 } },
        keeper: 'lurker', rules: [{ kind: 'gates' }],
      },
      {
        // The gates turn a fifth of a half-turn each wave: no lane holds.
        gates: [0, PI], turn: PI / 5, guests: ['runner', 'splitter'], natives: ['husk', 'lurker', 'wardstone'],
        beats: { 5: { kind: 'swarm', countMult: 1.3 }, 8: { kind: 'swarm', countMult: 1.5 } },
        keeper: null, rules: [{ kind: 'gates' }],
      },
    ],
  },
  {
    id: 'inversion',
    name: 'The Inversion',
    numeral: 'II',
    rule: { name: 'Inversion', text: 'Some start at the wall and walk out. One that escapes drains your ultimate.' },
    natives: ['ram', 'tidecaller'],
    boss: 'undertow',
    hpGrowth: 1.07,
    bossHp: 0.3,
    tint: '#40221a',
    rim: 'ember',
    auras: ['haste', 'regen', 'split', 'vengeful'],
    keeperAura: 'haste',
    tone: {
      shift: -3,
      loop: [[0, 3, 7], [-4, 0, 3], [-7, -3, 0], [-5, -1, 2]],
      chord: 4,
      cutoff: 1200,
      pulse: 1,
    },
    floors: [
      {
        gates: null, guests: ['grunt', 'runner'], natives: ['ram'],
        beats: { 5: { kind: 'swarm', countMult: 1.3 }, 8: { kind: 'swarm', countMult: 1.5 } },
        keeper: 'ram', rules: [{ kind: 'inversion', share: 0.2, drain: 0.05 }],
      },
      {
        gates: null, guests: ['brute', 'leech'], natives: ['ram', 'tidecaller'],
        beats: { 5: { kind: 'introduce', enemy: 'tidecaller', packs: 2 }, 8: { kind: 'swarm', countMult: 1.4 } },
        keeper: 'tidecaller', rules: [{ kind: 'inversion', share: 0.2, drain: 0.05 }],
      },
      {
        gates: null, guests: ['bomber', 'shardling'], natives: ['ram', 'tidecaller'],
        beats: { 5: { kind: 'swarm', countMult: 1.3 }, 8: { kind: 'swarm', countMult: 1.5 } },
        keeper: 'ram', rules: [{ kind: 'inversion', share: 0.25, drain: 0.05 }],
      },
      {
        gates: null, guests: ['splitter', 'mender'], natives: ['ram', 'tidecaller'],
        beats: { 5: { kind: 'swarm', countMult: 1.4 }, 8: { kind: 'swarm', countMult: 1.4 } },
        keeper: 'tidecaller', rules: [{ kind: 'inversion', share: 0.3, drain: 0.05 }],
      },
      {
        gates: null, guests: ['runner', 'blinker'], natives: ['ram', 'tidecaller'],
        beats: { 5: { kind: 'swarm', countMult: 1.4 }, 8: { kind: 'swarm', countMult: 1.5 } },
        keeper: 'ram', rules: [{ kind: 'inversion', share: 0.3, drain: 0.05 }],
      },
      {
        gates: null, guests: ['brute', 'grunt'], natives: ['ram', 'tidecaller'],
        beats: { 5: { kind: 'swarm', countMult: 1.3 }, 8: { kind: 'swarm', countMult: 1.5 } },
        keeper: null, rules: [{ kind: 'inversion', share: 0.35, drain: 0.05 }],
      },
    ],
  },
];

export const STRATUM_BY_ID: Readonly<Partial<Record<StratumId, StratumDef>>> = Object.fromEntries(STRATA.map((s) => [s.id, s]));

/** The authored stratum floor `floor` is in, or null past them (the shim, and later the Below). */
export function stratumOf(floor: number): StratumDef | null {
  if (floor < 1) return null;
  return STRATA[Math.floor((floor - 1) / STRATUM_FLOORS)] ?? null;
}

/** The index of the stratum floor `floor` is in: 0 for I, … (past the authored ones, still counts on). */
export function stratumIndex(floor: number): number {
  return Math.floor((Math.max(1, floor) - 1) / STRATUM_FLOORS);
}

/** The first floor of stratum `k` (0 for I): its foot's waypoint. */
export function stratumFoot(k: number): number {
  return k * STRATUM_FLOORS + 1;
}

/** The floor stratum `k`'s guardian holds. */
export function guardianFloorOf(k: number): number {
  return (k + 1) * STRATUM_FLOORS;
}

/** The stratum whose guardian `boss` is, as an index; -1 for none. */
export function guardianStratum(boss: BossId): number {
  return STRATA.findIndex((s) => s.boss === boss);
}

/** Where a boss's home is in the strata: the floor it guards, or null for one no stratum holds. */
export function stratumHome(boss: BossId): number | null {
  const k = guardianStratum(boss);
  return k < 0 ? null : guardianFloorOf(k);
}

/** The HP curve stratum `k` runs on: wave n is `hpBase × hpGrowth^(n − from)`. Past the authored strata, `BALANCE.abyss`'s. */
export interface Curve {
  readonly from: number;
  readonly hpBase: number;
  readonly hpGrowth: number;
}

const CURVES: Curve[] = [];

/**
 * Stratum `k`'s curve. Stratum I is today's numbers exactly; each next one
 * starts a step on from the last's last wave, at its own growth, so a
 * boundary has no cliff. Past the authored strata the curve is
 * `BALANCE.abyss.hpGrowth`, picked up the same way.
 */
export function strataCurve(k: number): Curve {
  const i = Math.min(Math.max(0, k), STRATA.length);
  const hit = CURVES[i];
  if (hit) return hit;
  const waves = STRATUM_FLOORS * 10;
  let curve: Curve = { from: 1, hpBase: BALANCE.abyss.hpBase, hpGrowth: STRATA[0]?.hpGrowth ?? BALANCE.abyss.hpGrowth };
  for (let j = 1; j <= i; j++) {
    const last = curve.hpBase * Math.pow(curve.hpGrowth, waves - 1);
    const growth = STRATA[j]?.hpGrowth ?? BALANCE.abyss.hpGrowth;
    curve = { from: curve.from + waves, hpBase: last * growth, hpGrowth: growth };
  }
  CURVES[i] = curve;
  return curve;
}

/**
 * The waypoints open with `felled` guardians down in order (§4.4): floor 1,
 * then the foot below each fallen guardian.
 */
export function waypoints(felled: number): number[] {
  const out: number[] = [];
  for (let k = 0; k <= Math.max(0, felled); k++) out.push(stratumFoot(k));
  return out;
}

/** The level a run started at waypoint `floor` begins at (§4.4). */
export function waypointLevel(floor: number): number {
  const L = BALANCE.strata.waypoint.level;
  return L[Math.min(stratumIndex(floor), L.length - 1)];
}

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

/**
 * The shaft's honest end (plans/review-risks.md R3): below the last built
 * stratum, say that the strata stop there for now, so "nothing new after
 * floor 12" is something the Map said first. Null once the strata reach
 * the bottom; then the band goes.
 */
export function strataStillDug(): string | null {
  const planned = BOTTOM / STRATUM_FLOORS;
  if (STRATA.length >= planned) return null;
  const from = NUMERALS[STRATA.length];
  const to = NUMERALS[planned - 1];
  return from === to ? `Stratum ${from} is still being dug.` : `Strata ${from}–${to} are still being dug.`;
}

/** The rule line a stratum's entry banner shows. */
export function stratumTitle(s: StratumDef): string {
  return `Stratum ${s.numeral} · ${s.name}`;
}
