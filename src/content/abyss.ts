import { BALANCE } from './balance';
import { REGIONS } from './regions';
import { BOTTOM, STRATA, stratumIndex, stratumOf, strataCurve, STRATUM_FLOORS, type StratumDef } from './strata';
import type { BossId, EnemyId, RegionDef, WaveBeat } from './types';

/**
 * The Abyss (§9, plans/late-game/08): Act 2's descent. Each floor is ten
 * waves. The authored strata (`content/strata.ts`) give a floor its rule,
 * natives, two Act 1 guests and a Keeper or guardian at the bottom; each
 * stratum's HP runs on its own curve, picked up from the last.
 *
 * Past the authored strata the Abyss keeps its old cycle behind a shim
 * (`shimFloor`): an Act 1 region's template, the old four natives, a boss
 * every floor and an Abyss boss every fifth, on `BALANCE.abyss`'s curve
 * from where the strata end. Wave numbers run on across floors, so floor
 * 3's first wave is wave 21. Pacts hold only in the regions.
 */

/** The Abyss's place on the Map and in a run's `regionId`: past the six regions. */
export const ABYSS_INDEX = 7;

/** The Abyss's last light (plans/visual-identity.md §2.2): a deep violet, below every region's. */
export const ABYSS_LAST_LIGHT = '#1f1a33';

/** Waves to a floor; the last is its Keeper's or its boss's. */
export const FLOOR_WAVES = 10;

/** Every type that is the Abyss's own, in the order a descent meets them: the Bestiary's Abyss page. */
export const NATIVES: readonly EnemyId[] = [
  ...new Set<EnemyId>([...STRATA.flatMap((s) => s.natives), 'husk', 'ram', 'wardstone', 'maw']),
];

/** The floor wave `wave` is on, from 1. */
export function floorOf(wave: number): number {
  return Math.floor((Math.max(1, wave) - 1) / FLOOR_WAVES) + 1;
}

/** Wave `wave`'s place on its floor, 1–10. */
export function floorWave(wave: number): number {
  return ((Math.max(1, wave) - 1) % FLOOR_WAVES) + 1;
}

/** The first global wave of floor `floor`. */
export function floorStart(floor: number): number {
  return (Math.max(1, floor) - 1) * FLOOR_WAVES + 1;
}

/** The boss at the bottom of floor `floor`: its stratum's guardian (seen only on the sixth), or the shim's. */
export function floorBoss(floor: number): BossId {
  const s = stratumOf(floor);
  return s ? s.boss : shimBoss(floor);
}

/** True for a floor whose tenth wave is a boss: a stratum's sixth, or every shim floor. */
export function bossFloor(floor: number): boolean {
  return stratumOf(floor) ? floor % STRATUM_FLOORS === 0 : true;
}

const FLOORS = new Map<number, RegionDef>();

/**
 * Floor `floor` as a region the sim can run. `waves.ts` reads `abyss` and
 * sizes every wave by its global number. Built once per floor and kept:
 * pure, so the same floor is the same region.
 */
export function abyssFloor(floor: number): RegionDef {
  const hit = FLOORS.get(floor);
  if (hit) return hit;
  const s = stratumOf(floor);
  const region = s ? strataFloor(floor, s) : shimFloor(floor);
  FLOORS.set(floor, region);
  return region;
}

/** A floor of an authored stratum (plans/late-game/08 §5). */
function strataFloor(floor: number, s: StratumDef): RegionDef {
  const A = BALANCE.abyss;
  const S = BALANCE.strata;
  const k = stratumIndex(floor);
  const f = s.floors[(floor - 1) % STRATUM_FLOORS];
  const curve = strataCurve(k);
  // A native a beat introduces walks on its own first, then joins the pool after the beat.
  const fresh = new Set<EnemyId>(Object.values(f.beats).flatMap((b) => (b.kind === 'introduce' ? [b.enemy] : [])));
  return {
    ...REGIONS[0],
    id: `abyss-${floor}`,
    index: ABYSS_INDEX,
    // Not on the Act 1 chain or the Wake's: `regionUnlocked` reads neither for 7 or 8.
    act: 1,
    after: null,
    icon: 'over-infinity',
    name: `The Abyss · Floor ${floor}`,
    text: `Floor ${floor}, in ${s.name}.`,
    shardBase: A.shardBase,
    waveShards: A.waveShards,
    hpBase: curve.hpBase,
    hpGrowth: curve.hpGrowth,
    damageBase: A.damageBase,
    damageGrowth: A.damageGrowth,
    count: A.count,
    pool: [
      ...f.guests.map((enemy) => ({ enemy, from: 1, weight: 1 })),
      ...f.natives.map((enemy) => ({ enemy, from: fresh.has(enemy) ? 6 : 1, weight: S.nativeWeight })),
    ],
    beats: f.beats,
    // A stratum's rule is no region rule: the sim reads it from `abyss.rules` (`sim/strata.ts`).
    rule: null,
    boss: s.boss,
    tint: s.tint,
    elites: { from: A.elites.from, every: A.elites.every, auras: s.auras },
    abyss: {
      floor,
      stratum: s.id,
      from: curve.from,
      keeper: f.keeper,
      rules: f.rules,
      gates: f.gates ? { angles: f.gates, turn: f.turn ?? 0 } : null,
    },
  };
}

// ── The shim: today's cycle, past the authored strata ──────────────────

/** The template a shim floor wears, in turn. */
const ORDER: readonly number[] = [1, 3, 2, 5, 4, 6];

/** The old four natives: by the shim's floors, every one has arrived. */
const SHIM_NATIVES: readonly EnemyId[] = ['husk', 'ram', 'wardstone', 'maw'];

/** The Abyss bosses the shim's every fifth floor holds, in turn. */
const SHIM_GUARDIANS: readonly BossId[] = ['deepwarden', 'hunger'];

function shimTemplate(floor: number): RegionDef {
  const index = ORDER[(floor - 1) % ORDER.length];
  return REGIONS.find((r) => r.index === index) ?? REGIONS[0];
}

/** True for a shim floor one of the Abyss's own bosses holds: every fifth. */
export function shimGuardianFloor(floor: number): boolean {
  return floor % 5 === 0;
}

function shimBoss(floor: number): BossId {
  if (shimGuardianFloor(floor)) return SHIM_GUARDIANS[(floor / 5 - 1) % SHIM_GUARDIANS.length];
  return shimTemplate(floor).boss;
}

/**
 * A floor past the authored strata (plans/late-game/08 §8 step 1): a
 * region's template, its rule and look, the old natives and its boss, on
 * `BALANCE.abyss`'s curve from the strata's last wave.
 */
function shimFloor(floor: number): RegionDef {
  const A = BALANCE.abyss;
  const base = shimTemplate(floor);
  const curve = strataCurve(stratumIndex(floor));
  const beats: Record<number, WaveBeat> = { 5: { kind: 'swarm', countMult: 1.3 }, 8: { kind: 'swarm', countMult: 1.5 } };
  return {
    ...base,
    id: `abyss-${floor}`,
    index: ABYSS_INDEX,
    // Not on the Act 1 chain or the Wake's: `regionUnlocked` reads neither for 7 or 8.
    act: 1,
    after: null,
    name: `The Abyss · Floor ${floor}`,
    text: `Floor ${floor}, on the ${base.name}'s pattern.`,
    shardBase: A.shardBase,
    waveShards: A.waveShards,
    hpBase: curve.hpBase,
    hpGrowth: curve.hpGrowth,
    damageBase: A.damageBase,
    damageGrowth: A.damageGrowth,
    count: A.count,
    pool: [
      ...base.pool.map((p) => ({ enemy: p.enemy, from: 1, weight: p.weight })),
      ...SHIM_NATIVES.map((enemy) => ({ enemy, from: 1, weight: A.nativeWeight })),
    ],
    beats,
    boss: shimBoss(floor),
    elites: { ...base.elites, from: A.elites.from, every: A.elites.every },
    abyss: { floor, stratum: null, from: curve.from, keeper: null, rules: [], gates: null },
  };
}

/**
 * The Starlight a best floor of `floor` has paid in all (S7): per floor down
 * to the bottom, less past it. A guardian's lump is paid apart, on its first
 * fall in the strata (`meta/pacts.ts#recordStratum`).
 */
export function abyssStarlight(floor: number): number {
  if (floor <= 0) return 0;
  const S = BALANCE.strata.starlight;
  return S.perFloor * Math.min(floor, BOTTOM) + S.below * Math.max(0, floor - BOTTOM);
}
