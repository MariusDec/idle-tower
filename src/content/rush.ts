import { abyssFloor } from './abyss';
import { BALANCE } from './balance';
import { BOSS_BY_ID } from './bosses';
import { REGIONS } from './regions';
import type { BossId, RegionDef } from './types';

/**
 * Boss Rush (N8): Act 2's second mode past the regions, opened by the
 * Deepwarden's fall. The six Act 1 bosses back to back, then the Abyss's
 * two, each sized like the guardian of an Abyss floor
 * (`BALANCE.rush.floors`; `boss.ts` takes the guardian's share). Every
 * wave is a boss; there is no overtime, and the run is won when the last
 * one falls. The record is the stages cleared, then the time of a full
 * clear, and new records pay Starlight on a curve.
 *
 * The tower starts high (`BALANCE.rush.level`): with no waves to grow on,
 * its drafts come first. Pacts hold only in the regions.
 */

/** Boss Rush's place on the Map and in a run's `regionId`: past the Abyss. */
export const RUSH_INDEX = 8;

/** The bosses in the order they come: one a wave. */
export const RUSH_BOSSES: readonly BossId[] = [
  'gatekeeper', 'bog-mother', 'prism', 'forgeheart', 'hollow-king', 'blight', 'deepwarden', 'hunger',
];

/** Stages to a full clear. */
export const RUSH_STAGES = RUSH_BOSSES.length;

/** The region a boss's summons and look come from: its own, or the Abyss floor it holds. */
function homeOf(boss: BossId): RegionDef {
  const own = REGIONS.find((r) => r.boss === boss);
  if (own) return own;
  // An Abyss boss holds every fifth floor in turn: the first it holds.
  for (let f = 5; ; f += 5) if (abyssFloor(f).boss === boss) return abyssFloor(f);
}

const STAGES = new Map<number, RegionDef>();

/**
 * Stage `n` (wave n, 1–8) as a region the sim can run: its boss's home
 * region's enemies and look, no rule, and the numbers of the Abyss floor it
 * is sized for, flat, so `waves.ts` reads them as they are. Built once and
 * kept: pure, so the same stage is the same region.
 */
export function rushStage(n: number): RegionDef {
  const stage = Math.max(1, Math.min(RUSH_STAGES, n));
  const hit = STAGES.get(stage);
  if (hit) return hit;
  const A = BALANCE.abyss;
  const boss = RUSH_BOSSES[stage - 1];
  const home = homeOf(boss);
  // The floor's last wave, as the Abyss numbers it.
  const wave = BALANCE.rush.floors[stage - 1] * 10;
  const region: RegionDef = {
    ...home,
    id: `rush-${stage}`,
    index: RUSH_INDEX,
    name: `Boss Rush · ${BOSS_BY_ID[boss].name}`,
    text: `Stage ${stage} of ${RUSH_STAGES}.`,
    shardBase: A.shardBase * Math.pow(A.shardGrowth, wave - 1),
    waveShards: 0,
    hpBase: A.hpBase * Math.pow(A.hpGrowth, wave - 1),
    hpGrowth: 1,
    damageBase: A.damageBase * Math.pow(A.damageGrowth, wave - 1),
    damageGrowth: 1,
    rule: null,
    boss,
    abyss: undefined,
    rush: { stage },
  };
  STAGES.set(stage, region);
  return region;
}

/** True for a run in Boss Rush. */
export function isRush(regionId: number): boolean {
  return regionId === RUSH_INDEX;
}

/** The Starlight a record of `stages` cleared (and, for a full clear, `seconds`) has paid in all (N8). */
export function rushStarlight(stages: number, seconds: number | null): number {
  const S = BALANCE.rush.starlight;
  const clear = stages >= RUSH_STAGES && seconds !== null && seconds > 0
    ? Math.floor(S.clear * Math.log2(1 + S.par / seconds))
    : 0;
  return S.perStage * Math.max(0, Math.min(RUSH_STAGES, stages)) + clear;
}
