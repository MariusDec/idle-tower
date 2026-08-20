import type { EnemyType } from '../types';
import { ENEMY_DEFS } from './enemies';

/**
 * Plural display names for contract text.
 *
 * A `Record` over `EnemyType` rather than a lookup with a fallback, so a new
 * enemy type cannot reach a contract row as `kill 30 burrower`. `EnemyDef` has
 * no name field — the milestone strip carries its own copy for the eleven types
 * it introduces — and adding one there would have meant touching every def for
 * a string only this file and the strip need.
 */
export const CONTRACT_ENEMY_LABELS: Record<EnemyType, string> = {
  normal: 'grunts',
  fast: 'runners',
  tank: 'tanks',
  flying: 'fliers',
  healer: 'healers',
  splitter: 'splitters',
  shielded: 'shielded enemies',
  siege: 'siege engines',
  thief: 'thieves',
  blinker: 'blinkers',
  warden: 'wardens',
  burrower: 'burrowers',
  boss: 'bosses',
};

/**
 * Contracts — the mid-run's short-horizon goals (gameplay plan §5).
 *
 * Three are live at all times, they are run-scoped, and they are tiered by the
 * player's current wave band so a wave-8 tower is never handed "kill a wave-60
 * boss". The rewards are deliberately small and frequent: a slice of a wave's
 * gold, a blessing reroll, a point or three of RP, or a +3% slice of the run's
 * ascension AP.
 */

/**
 * What a contract asks for.
 *
 * A closed union, and `CONTRACT_PROGRESS` in `ContractManager` is a `Record`
 * over its `kind` — so a goal kind nothing tracks is a compile error rather
 * than a contract that sits at 0/40 forever.
 *
 * Two fields differ from plan §5.1, both because the plan's version cannot be
 * tiered:
 *   - `reach_wave` carries `ahead` (waves beyond where it was drawn), not an
 *     absolute `wave`. An absolute target in a static table is exactly the
 *     "reach wave 60 at wave 8" failure the same section forbids.
 *   - `spend_gold` carries `goldWaves` (waves of income), not a flat `amount`,
 *     for the same reason gold *rewards* are sized off `estimateWaveGold`:
 *     a literal number is either trivial at wave 80 or impossible at wave 8.
 */
export type ContractGoal =
  | { kind: 'kill_type'; type: EnemyType; count: number }
  | { kind: 'kill_count'; count: number }
  | { kind: 'clear_waves'; count: number }
  /** Waves cleared without the tower losing HP. */
  | { kind: 'flawless_waves'; count: number }
  /** Boss *encounters* (the whole `2 + tier` pack) cleared inside `seconds`. */
  | { kind: 'boss_under'; seconds: number; count: number }
  | { kind: 'collect_orbs'; count: number }
  | { kind: 'cast_abilities'; count: number }
  | { kind: 'reach_wave'; ahead: number }
  | { kind: 'survive_mutator'; waves: number }
  | { kind: 'spend_gold'; goldWaves: number };

export type ContractGoalKind = ContractGoal['kind'];

/**
 * A contract's payout.
 *
 * `goldWaves` rather than plan §5.1's flat `gold`: §5.2 says the figure is
 * "~2 waves' income at the current wave", which is a *ratio*, and storing the
 * ratio is the only way one table can serve wave 6 and wave 160. It is
 * resolved against `Game.estimateWaveGold` at display and at payout, so a
 * contract carried across ten waves pays what those ten waves are worth.
 */
export interface ContractReward {
  /** Gold, in waves of current income. */
  goldWaves?: number;
  /** Blessing reroll tokens (`BlessingManager.grantRerollToken`). */
  rerolls?: number;
  /** Research points. */
  rp?: number;
  /** Run-scoped ascension-AP bonus, as a fraction. Capped in aggregate. */
  apBonusPct?: number;
}

export interface ContractDef {
  id: string;
  name: string;
  goal: ContractGoal;
  /** Earliest wave this may be drawn. */
  minWave: number;
  /** Last wave it stays relevant; omitted means evergreen. */
  maxWave?: number;
  /** Draw weight within the eligible set. */
  weight: number;
  reward: ContractReward;
}

/** Contracts live at once (plan §5.1). */
export const CONTRACT_SLOTS = 3;

export const CONTRACT_TUNING = {
  /** Each `apBonusPct` grant, as a fraction (plan §5.2: +3%). */
  apBonusStep: 0.03,
  /**
   * Ceiling on the run's total contract AP bonus (plan §5.2: +50%).
   *
   * The point of the cap is that contracts stay a *texture* on the run rather
   * than the reason to do the run. It is enforced in `ContractManager`, which
   * is the only writer, so nothing downstream has to remember it.
   */
  apBonusCap: 0.50,
  /** Entries kept in the completed-contract history (the Progression list). */
  historyLimit: 40,
} as const;

/**
 * The pool.
 *
 * Three overlapping wave bands, which is the whole tiering mechanism:
 *   - **1–24** — small counts, no gating on anything past wave 12.
 *   - **12–59** — the mid-run, where the plan says the game currently has
 *     nothing to offer.
 *   - **40+** — evergreen, sized for a tower that clears a wave in seconds.
 *
 * Every `minWave` is at or past whatever the goal actually needs to exist:
 * `kill_type` past its enemy's `unlockWave`, `cast_abilities` and `boss_under`
 * past wave 10 (mana and the first boss), `survive_mutator` past the first
 * mutator offer, which is also wave 10. `tests/contracts.test.ts` pins that.
 */
export const CONTRACTS: ContractDef[] = [
  // ── Band A: waves 1–24 ────────────────────────────────────────────────────
  {
    id: 'ct_first_cull',
    name: 'First Cull',
    goal: { kind: 'kill_count', count: 60 },
    minWave: 1,
    maxWave: 24,
    weight: 10,
    reward: { goldWaves: 0.5 },
  },
  {
    id: 'ct_rank_and_file',
    name: 'Rank and File',
    goal: { kind: 'kill_type', type: 'normal', count: 40 },
    minWave: 1,
    maxWave: 24,
    weight: 8,
    reward: { goldWaves: 0.4 },
  },
  {
    id: 'ct_outrun',
    name: 'Outrun',
    goal: { kind: 'kill_type', type: 'fast', count: 25 },
    minWave: 3,
    maxWave: 24,
    weight: 8,
    reward: { goldWaves: 0.4 },
  },
  {
    id: 'ct_hold_the_line',
    name: 'Hold the Line',
    goal: { kind: 'clear_waves', count: 4 },
    minWave: 1,
    maxWave: 24,
    weight: 10,
    reward: { goldWaves: 0.6 },
  },
  {
    id: 'ct_untouched',
    name: 'Untouched',
    goal: { kind: 'flawless_waves', count: 2 },
    minWave: 1,
    maxWave: 24,
    weight: 7,
    reward: { rerolls: 1 },
  },
  {
    id: 'ct_scavenger',
    name: 'Scavenger',
    goal: { kind: 'collect_orbs', count: 6 },
    minWave: 1,
    maxWave: 24,
    weight: 8,
    reward: { goldWaves: 0.5 },
  },
  {
    id: 'ct_press_on',
    name: 'Press On',
    goal: { kind: 'reach_wave', ahead: 5 },
    minWave: 1,
    maxWave: 24,
    weight: 9,
    reward: { rp: 1 },
  },
  {
    id: 'ct_first_spells',
    name: 'First Spells',
    goal: { kind: 'cast_abilities', count: 8 },
    minWave: 10,
    maxWave: 24,
    weight: 8,
    reward: { rp: 1 },
  },

  // ── Band B: waves 12–59 ───────────────────────────────────────────────────
  {
    id: 'ct_culling',
    name: 'The Culling',
    goal: { kind: 'kill_count', count: 220 },
    minWave: 12,
    maxWave: 59,
    weight: 10,
    reward: { goldWaves: 0.8 },
  },
  {
    id: 'ct_breakpoint',
    name: 'Breakpoint',
    goal: { kind: 'kill_type', type: 'tank', count: 30 },
    minWave: 12,
    maxWave: 59,
    weight: 7,
    reward: { goldWaves: 0.6 },
  },
  {
    id: 'ct_sunder',
    name: 'Sunder',
    goal: { kind: 'kill_type', type: 'shielded', count: 24 },
    minWave: 20,
    maxWave: 59,
    weight: 7,
    reward: { goldWaves: 0.6 },
  },
  {
    id: 'ct_cutpurse',
    name: 'Cutpurse',
    goal: { kind: 'kill_type', type: 'thief', count: 6 },
    minWave: 32,
    maxWave: 59,
    weight: 6,
    reward: { goldWaves: 0.9 },
  },
  {
    id: 'ct_clockbreaker',
    name: 'Clockbreaker',
    goal: { kind: 'boss_under', seconds: 30, count: 1 },
    minWave: 12,
    maxWave: 59,
    weight: 7,
    reward: { rerolls: 1, apBonusPct: CONTRACT_TUNING.apBonusStep },
  },
  {
    id: 'ct_unbroken',
    name: 'Unbroken',
    goal: { kind: 'flawless_waves', count: 4 },
    minWave: 12,
    maxWave: 59,
    weight: 7,
    reward: { apBonusPct: CONTRACT_TUNING.apBonusStep },
  },
  {
    id: 'ct_arsenal',
    name: 'Arsenal',
    goal: { kind: 'cast_abilities', count: 30 },
    minWave: 12,
    maxWave: 59,
    weight: 8,
    reward: { rp: 2 },
  },
  {
    id: 'ct_reinvest',
    name: 'Reinvest',
    goal: { kind: 'spend_gold', goldWaves: 4 },
    minWave: 12,
    maxWave: 59,
    weight: 8,
    reward: { rp: 2 },
  },
  {
    id: 'ct_storm_rider',
    name: 'Storm Rider',
    goal: { kind: 'survive_mutator', waves: 3 },
    minWave: 12,
    maxWave: 59,
    weight: 6,
    reward: { apBonusPct: CONTRACT_TUNING.apBonusStep },
  },
  {
    id: 'ct_hoard',
    name: 'Hoard',
    goal: { kind: 'collect_orbs', count: 22 },
    minWave: 12,
    maxWave: 59,
    weight: 8,
    reward: { goldWaves: 0.8 },
  },
  {
    id: 'ct_deeper',
    name: 'Deeper Still',
    goal: { kind: 'reach_wave', ahead: 8 },
    minWave: 12,
    maxWave: 59,
    weight: 9,
    reward: { rp: 2 },
  },

  // ── Band C: wave 40 and beyond ────────────────────────────────────────────
  {
    id: 'ct_extermination',
    name: 'Extermination',
    goal: { kind: 'kill_count', count: 650 },
    minWave: 40,
    weight: 10,
    reward: { goldWaves: 1.0 },
  },
  {
    id: 'ct_decapitate',
    name: 'Decapitate',
    goal: { kind: 'kill_type', type: 'warden', count: 18 },
    minWave: 42,
    weight: 7,
    reward: { goldWaves: 0.9 },
  },
  {
    id: 'ct_exhume',
    name: 'Exhume',
    goal: { kind: 'kill_type', type: 'burrower', count: 24 },
    minWave: 47,
    weight: 7,
    reward: { goldWaves: 0.9 },
  },
  {
    id: 'ct_immaculate',
    name: 'Immaculate',
    goal: { kind: 'flawless_waves', count: 6 },
    minWave: 40,
    weight: 7,
    reward: { rerolls: 1, apBonusPct: CONTRACT_TUNING.apBonusStep },
  },
  {
    id: 'ct_boss_rush',
    name: 'Boss Rush',
    goal: { kind: 'boss_under', seconds: 30, count: 3 },
    minWave: 40,
    weight: 6,
    reward: { goldWaves: 1.0, apBonusPct: CONTRACT_TUNING.apBonusStep },
  },
  {
    id: 'ct_expedition',
    name: 'Expedition',
    goal: { kind: 'reach_wave', ahead: 12 },
    minWave: 40,
    weight: 9,
    reward: { rp: 3 },
  },
  {
    id: 'ct_magnate',
    name: 'Magnate',
    goal: { kind: 'spend_gold', goldWaves: 10 },
    minWave: 40,
    weight: 8,
    reward: { goldWaves: 1.2 },
  },
  {
    id: 'ct_tempest',
    name: 'Tempest',
    goal: { kind: 'survive_mutator', waves: 6 },
    minWave: 40,
    weight: 6,
    reward: { apBonusPct: CONTRACT_TUNING.apBonusStep },
  },
  {
    id: 'ct_windfall',
    name: 'Windfall',
    goal: { kind: 'collect_orbs', count: 60 },
    minWave: 40,
    weight: 8,
    reward: { goldWaves: 1.0 },
  },
];

export const CONTRACT_BY_ID: Record<string, ContractDef> = CONTRACTS.reduce(
  (acc, c) => {
    acc[c.id] = c;
    return acc;
  },
  {} as Record<string, ContractDef>,
);

/**
 * The earliest wave at which a goal's subject exists at all.
 *
 * Separate from `minWave` on purpose: `minWave` is a *tuning* choice (how deep
 * the contract is meant to be drawn), this is a *correctness* floor, and
 * `tests/contracts.test.ts` asserts the first is never below the second. Adding
 * a `kill_type` contract for an enemy that has not unlocked is otherwise a
 * silent dead slot.
 */
export function goalAvailableFromWave(goal: ContractGoal): number {
  switch (goal.kind) {
    case 'kill_type':
      return ENEMY_DEFS[goal.type].unlockWave;
    // Mana, the first ability and the first boss all arrive at wave 10, and so
    // does the first guaranteed mutator offer.
    case 'cast_abilities':
    case 'boss_under':
    case 'survive_mutator':
      return 10;
    case 'kill_count':
    case 'clear_waves':
    case 'flawless_waves':
    case 'collect_orbs':
    case 'reach_wave':
    case 'spend_gold':
      return 1;
  }
}

/** Human-readable target for the tracker row, given a resolved target value. */
export function describeContract(goal: ContractGoal, target: number): string {
  switch (goal.kind) {
    case 'kill_type':
      return `Kill ${target} ${CONTRACT_ENEMY_LABELS[goal.type]}`;
    case 'kill_count':
      return `Kill ${target} enemies`;
    case 'clear_waves':
      return `Clear ${target} waves`;
    case 'flawless_waves':
      return `Clear ${target} waves without losing HP`;
    case 'boss_under':
      return `Clear ${target} boss wave${target === 1 ? '' : 's'} in under ${goal.seconds}s`;
    case 'collect_orbs':
      return `Collect ${target} loot orbs`;
    case 'cast_abilities':
      return `Cast ${target} abilities`;
    case 'reach_wave':
      return `Reach wave ${target}`;
    case 'survive_mutator':
      return `Clear ${target} waves under a mutator`;
    case 'spend_gold':
      return `Spend gold on upgrades`;
  }
}

/** Short reward blurb for the tracker and the Progression list. */
export function describeReward(reward: ContractReward, goldAmount: number): string {
  const parts: string[] = [];
  if (reward.goldWaves) parts.push(`${Math.max(1, Math.floor(goldAmount)).toLocaleString()}g`);
  if (reward.rerolls) parts.push(`${reward.rerolls} reroll${reward.rerolls === 1 ? '' : 's'}`);
  if (reward.rp) parts.push(`${reward.rp} RP`);
  if (reward.apBonusPct) parts.push(`+${Math.round(reward.apBonusPct * 100)}% AP`);
  return parts.join(' · ');
}
