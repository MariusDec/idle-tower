/**
 * Headless balance model (plan §7.1).
 *
 * Imports the *real* data tables from `src/data` so a balance change is
 * measured, never guessed. The model is deliberately coarse — it answers
 * "how long does a run take and where does it wall", not "what happens in
 * frame 12" — but every number it consumes (HP curve, gold curve, upgrade
 * cost/effect, enemy mix, spawn cadence) is the one the game ships.
 *
 * Deliberate simplifications, all of which make the model *pessimistic*
 * rather than optimistic, so a run that clears here clears in game:
 *   - no abilities, talents, research, equipment, passives or evolutions
 *   - no elites, no wave mutators, no wave-skip
 *   - enemies are treated as a single HP pool per wave; travel time and
 *     overkill are folded into `ENGAGEMENT_EFFICIENCY`
 */

import {
  enemyHPForWave,
  bossHPForWave,
  goldDropForWave,
  spawnCountForWave,
  spawnIntervalForWave,
  isBossWave,
  upgradeCost,
  enrageThresholdSeconds,
  ENRAGE_STACK_INTERVAL,
} from '../src/data/formulas.ts';
import {
  ENEMY_BEHAVIOR,
  ENEMY_DEFS,
  bossMaxHpForWave,
  bossPhaseHpFactor,
  spawnPoolForWave,
} from '../src/data/enemies.ts';
import { LOOT_TUNING, orbGoldValue } from '../src/data/loot.ts';
import { UPGRADES } from '../src/data/upgrades.ts';
import { MANUAL_AIM, TOWER_BASE } from '../src/data/tower.ts';
import { computeUpgradeValue } from '../src/types.ts';
import type { EnemyType, UpgradeDef } from '../src/types.ts';
import { WAVE_INTERMISSION } from '../src/systems/WaveManager.ts';
import { BlessingManager } from '../src/systems/BlessingManager.ts';
import type { BlessingBehavior, BlessingDef } from '../src/data/blessings.ts';

/** Fraction of wall-clock time the tower actually spends shooting a live target. */
const ENGAGEMENT_EFFICIENCY = 0.85;

/** Upgrades the greedy buyer is allowed to spend on (the offence/economy core). */
const BUYABLE = ['damage', 'fireRate', 'critChance', 'critDamage', 'goldMulti'] as const;
type BuyableId = (typeof BUYABLE)[number];

const UPGRADE_BY_ID: Record<string, UpgradeDef> = Object.fromEntries(
  UPGRADES.map(u => [u.id, u]),
);

/**
 * Enemy-type spawn weights, read from the shipping table (`ENEMY_SPAWN_WEIGHTS`).
 *
 * It used to be a hand-written copy of `WaveManager.pickEnemyType`, which is
 * how a re-weighting lands in the game but not in the model that is supposed to
 * be measuring it. Both now read one table.
 */
function typeMix(wave: number): Array<{ type: EnemyType; weight: number }> {
  if (isBossWave(wave)) return [{ type: 'boss', weight: 1 }];
  return spawnPoolForWave(wave);
}

/**
 * Effective-HP multiplier per type: how much more damage the tower must
 * actually put out than the enemy's bar says (gameplay plan §2.6).
 *
 * A `Record` over the union for the same reason `BEHAVIOR_DPS_CREDIT` is one —
 * a behavioural type the model silently scores at 1.0 is a type whose balance
 * was never checked.
 *
 * Every figure is deliberately conservative, because the model has no
 * positions, no tower HP and no player attention to spend:
 *   - `splitter` 2.0: two half-HP children, exactly as before.
 *   - `shielded` 1.35: three charges eat a hit each, and now rebuild one every
 *     6 s after 3 s of quiet — slightly worse than the old flat 1.3.
 *   - `warden` 2.2: its own bar plus the 15%-of-maxHp pools it refreshes onto
 *     up to five allies every 4 s. Well under the worst case, because the
 *     default targeting mode is now `priority`, which shoots the warden first
 *     and collapses every pool it was maintaining.
 *   - `burrower` 1.25: untouchable until 120 px out, so most of the approach
 *     corridor the model assumes the tower is shooting into is wasted on it.
 *   - `blinker` 1.1: covers ground the tower does not get to shoot across.
 *   - `siege` 1.0: it costs tower HP, not DPS — see `SIEGE_GOLD_DRAG`.
 *   - `thief` 1.0 on HP; its cost is economic, see `THIEF_GOLD_DRAG`.
 *   - `boss` 1.0 *here*: a boss's cost is priced per wave instead, by
 *     `bossPhaseHpFactor` in `data/enemies.ts`, because it depends on which
 *     three patterns its tier draws — and the boss's bar is shrunk by the same
 *     factor, so the product is the pre-Part-3 figure.
 */
const EFFECTIVE_HP_FACTOR: Record<EnemyType, number> = {
  normal: 1,
  fast: 1,
  tank: 1,
  flying: 1,
  healer: 1,
  boss: 1,
  splitter: 2,
  shielded: 1.35,
  siege: 1,
  thief: 1,
  blinker: 1.1,
  warden: 2.2,
  burrower: 1.25,
};

/**
 * Gold a thief walks off with, as a fraction of a wave's income, averaged.
 *
 * One thief per wave at most, stealing up to 6% of *current* gold; the greedy
 * buyer spends most of its balance the instant it can afford anything, so the
 * pot a thief finds is usually small — and a competent tower kills it and gets
 * double back. Modelled as a flat small drag rather than simulated, because the
 * model has no positions and cannot decide whether the thief got away.
 */
const THIEF_GOLD_DRAG = 0.02;

/**
 * Full-value gold the wave's loot orbs are worth (gameplay plan §4.1).
 *
 * Orbs are a gold faucet, so the model has to know about them or every balance
 * number below it is measuring a game that no longer exists. Deliberately
 * conservative in three ways, all of which understate the faucet:
 *   - **elites are not modelled at all** (a pre-existing simplification), so
 *     their guaranteed 1-2 orbs are missing;
 *   - **mana orbs are worth nothing here**, because the model has no abilities
 *     to spend mana on;
 *   - **reroll orbs are worth nothing here**, for the same reason the draft's
 *     rerolls are only modelled as offer rerolls.
 * What is left is the gold channel, which is the one that moves the curve.
 */
export function orbGoldForWave(wave: number): number {
  const boss = isBossWave(wave);
  // The boss budget is per *encounter*, not per boss — see `bossOrbShare`.
  const orbs = boss
    ? (LOOT_TUNING.bossOrbsMin + LOOT_TUNING.bossOrbsMax) / 2
    : spawnCountForWave(wave) * LOOT_TUNING.commonDropChance;
  const rerollShare = boss ? LOOT_TUNING.rerollChance : 0;
  // Mana orbs only start rolling once mana itself is unlocked, which is the
  // same wave `AbilityManager` gates on.
  const manaShare = wave >= 10 ? LOOT_TUNING.manaShare : 0;
  return orbs * (1 - rerollShare) * (1 - manaShare) * orbGoldValue(wave);
}

export interface WaveProfile {
  count: number;
  /** Total effective HP the tower must chew through. */
  totalHp: number;
  /** Mean armor across the wave (physical damage is reduced flat per hit). */
  avgArmor: number;
  /** Gold the wave pays out at a 1x multiplier. */
  baseGold: number;
  /** Seconds before the last enemy has even spawned. */
  spawnDuration: number;
}

export function waveProfile(wave: number): WaveProfile {
  const count = spawnCountForWave(wave);
  const mix = typeMix(wave);
  const weightSum = mix.reduce((a, e) => a + e.weight, 0);

  let hpPer = 0;
  let armorPer = 0;
  let goldPer = 0;
  let thiefShare = 0;
  for (const { type, weight } of mix) {
    const def = ENEMY_DEFS[type];
    const share = weight / weightSum;
    // A boss's *bar* is `bossMaxHpForWave`; what the tower actually has to put
    // out is that times what the phase machine holds outside it. The two
    // multiply back to the pre-Part-3 figure by construction (see
    // `bossMaxHpForWave`), which is the whole point — Part 3 changed what a
    // boss *does*, not how much damage a boss wave costs.
    const hp = type === 'boss' ? bossMaxHpForWave(wave) : enemyHPForWave(def.baseHP, wave);
    const phaseFactor = type === 'boss' ? bossPhaseHpFactor(wave) : 1;
    hpPer += share * hp * EFFECTIVE_HP_FACTOR[type] * phaseFactor;
    armorPer += share * def.armor;
    goldPer += share * goldDropForWave(def.baseGold, wave);
    if (type === 'thief') thiefShare = share;
  }

  // Plan §2.1: a thief that gets away takes gold with it. Capped by the same
  // per-wave ceiling the game enforces, so this can never dominate the curve.
  const theftDrag = thiefShare > 0
    ? Math.min(ENEMY_BEHAVIOR.thiefWaveTheftCap, THIEF_GOLD_DRAG)
    : 0;

  return {
    count,
    totalHp: hpPer * count,
    avgArmor: armorPer,
    baseGold: goldPer * count * (1 - theftDrag),
    spawnDuration: spawnIntervalForWave(wave) * (count - 1),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Blessings (gameplay plan §1.6)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Effective-DPS credit for each behavior blessing, as an additive fraction.
 *
 * A `Record` over the union, so a behavior added to the game without a balance
 * estimate does not compile here either — the sim is the only thing that can
 * say whether a new card moved the curve, and a card it silently scores as zero
 * is a card whose balance was never checked.
 *
 * These are estimates, and deliberately conservative ones: the model has no
 * enemy positions, so anything that depends on a crowd (ricochet, splash,
 * chains) is credited well below its best case.
 */
const BEHAVIOR_DPS_CREDIT: Record<BlessingBehavior, number> = {
  ricochet: 0.09,
  ricochet_power: 0.11,
  mortar: 0.05,
  crit_chain: 0.07,
  frost_shots: 0.015,
  shatter: 0.07,
  split_on_kill: 0.04,
  homing: 0.02,
  overkill_carry: 0.03,
  siphon: 0,
  executioner: 0.04,
  // Conditional on being at low HP, which a healthy run rarely is.
  last_stand: 0.02,
  greed_engine: 0,
  // Pays in gold, not damage, and not as a flat percentage either: it raises
  // the orb collect rate from 40% to 100%, which `simulateRun` applies to the
  // orb channel directly. Zero here is correct, not unmeasured.
  orb_magnet: 0,
};

/** Gold credit for behaviors that pay in economy rather than damage. */
const BEHAVIOR_GOLD_CREDIT: Partial<Record<BlessingBehavior, number>> = {
  // +2% per wave cleared, uncapped: averaged over the second half of a run,
  // where most of the gold is earned.
  greed_engine: 0.3,
};

/**
 * What perfect active play is worth, channel by channel (gameplay plan §4.5).
 *
 * The idle-parity check is the gate this part can actually fail, so every
 * figure here is derived from the shipping constant rather than guessed, and
 * the one figure that *is* an estimate says so.
 */
export const ACTIVE_PLAY = {
  /**
   * How many times a charged shot's damage actually lands.
   *
   * `+3` pierce lets one shot pass through up to four bodies, and the 90 px
   * splash pays 60% to everything near each of those hits. Against a lone
   * boss that is exactly 1; down the throat of a packed lane it is well over
   * 4. Two is the run-average estimate — and note which direction is the safe
   * one here: this is a *gate* on active play being too strong, so the
   * cautious error is to over-credit the verb, not to under-credit it.
   */
  chargeCrowdFactor: 2,
  /**
   * Aimed DPS while the cursor is held still to build a charge.
   *
   * Charging is not free even for a perfect player: for 1.2 s of every cycle
   * the cursor cannot track, so ordinary shots go at a fixed point while the
   * enemies walk through it. Half of them landing is the estimate. This is
   * what makes charging a *choice* — see the strategy comparison in `dps`.
   */
  chargeAimPenalty: 0.5,
  /**
   * Targeted ability placement (§4.3), as an additive fraction of total DPS.
   *
   * The model has no abilities at all, so this cannot be derived — it is an
   * estimate, and a small one: the focus bonus is +60% inside the disc on two
   * of ten abilities plus a chosen epicentre on a third, and abilities are a
   * minority of a run's damage to begin with.
   */
  targetedCastDps: 0.02,
} as const;

/**
 * Manual aim and the charged shot come straight from `MANUAL_AIM`, the table
 * the game itself reads, so the multiplier can only be cut in one place.
 */
const CHARGE_CYCLE = MANUAL_AIM.chargeSeconds + MANUAL_AIM.chargeCooldown;

/** The blessing state a `Loadout` carries, already summed across stacks. */
export interface BlessingLoadout {
  damagePct: number;
  fireRatePct: number;
  critChanceAdd: number;
  critDamageAdd: number;
  goldPct: number;
  /** Flat armour ignored (Sunder). */
  armorPenFlat: number;
  /** Behaviors plus enemy-HP reduction, as one effective-DPS multiplier. */
  dpsPct: number;
  /** Lodestone: orbs drift home at full value (plan §4.1). */
  orbMagnet: boolean;
}

function emptyBlessings(): BlessingLoadout {
  return {
    damagePct: 0,
    fireRatePct: 0,
    critChanceAdd: 0,
    critDamageAdd: 0,
    goldPct: 0,
    armorPenFlat: 0,
    dpsPct: 0,
    orbMagnet: false,
  };
}

/**
 * How attractive a card looks to the drafting player.
 *
 * Used only to decide which of three offers to take — never to compute the
 * effect, which comes from the real `BlessingManager`. Defensive stats get a
 * partial credit rather than zero, so the model does not take Glass Cannon
 * every single time a fresh tower is offered it.
 */
function draftAppeal(def: BlessingDef): number {
  let score = def.behavior ? BEHAVIOR_DPS_CREDIT[def.behavior] : 0;
  if (def.behavior) score += BEHAVIOR_GOLD_CREDIT[def.behavior] ?? 0;
  // Lodestone's worth is "the orb channel, times 1.5" — a few percent of total
  // income, discounted like any other gold card.
  if (def.behavior === 'orb_magnet') score += 0.04;
  for (const e of def.effects ?? []) {
    const v = e.perStack;
    switch (e.stat) {
      case 'damagePct':
      case 'fireRatePct':
        score += v;
        break;
      // Crit is worth roughly its expected-hit contribution at a mid-run
      // loadout (~25% chance, ~4x multiplier).
      case 'critChancePct':
        score += v * 1.7;
        break;
      case 'critDamagePct':
        score += v * 0.14;
        break;
      case 'goldPct':
        // Gold buys future DPS, but only after a delay — the same 0.5 discount
        // the greedy upgrade buyer uses.
        score += v * 0.5;
        break;
      case 'enemyHpPct':
        score += 1 / (1 + v) - 1;
        break;
      case 'armorPenFlat':
        score += v * 0.02;
        break;
      case 'pierceFlat':
        score += v * 0.06;
        break;
      // Survivability and utility: real value to a player, none to a model
      // that never tracks tower HP. Credited partially so the draft behaves
      // like a person rather than a damage maximiser.
      case 'maxHpPct':
        score += v * 0.30;
        break;
      case 'lifestealPct':
        score += v * 1.2;
        break;
      // Faster or harder-hitting enemies are a cost, not a benefit.
      case 'enemySpeedPct':
      case 'enemyDamagePct':
        score -= v * 0.30;
        break;
      case 'rangePct':
        score += v * 0.10;
        break;
      case 'manaRegenPct':
      case 'abilityDamagePct':
        score += v * 0.05;
        break;
    }
  }
  return score;
}

/** Read the manager's composed totals into the model's channels. */
function readBlessings(mgr: BlessingManager): BlessingLoadout {
  const totals = mgr.getStatTotals();
  const out = emptyBlessings();
  out.damagePct = totals.damagePct ?? 0;
  out.fireRatePct = totals.fireRatePct ?? 0;
  out.critChanceAdd = totals.critChancePct ?? 0;
  out.critDamageAdd = totals.critDamagePct ?? 0;
  out.goldPct = totals.goldPct ?? 0;
  out.armorPenFlat = totals.armorPenFlat ?? 0;
  out.orbMagnet = mgr.has('orb_magnet');
  const enemyHp = totals.enemyHpPct ?? 0;
  out.dpsPct = enemyHp !== 0 ? 1 / (1 + enemyHp) - 1 : 0;
  for (const behavior of Object.keys(BEHAVIOR_DPS_CREDIT) as BlessingBehavior[]) {
    if (!mgr.has(behavior)) continue;
    out.dpsPct += BEHAVIOR_DPS_CREDIT[behavior];
    out.goldPct += BEHAVIOR_GOLD_CREDIT[behavior] ?? 0;
  }
  return out;
}

/** Deterministic RNG, so a sim run is reproducible across invocations. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Loadout {
  levels: Record<string, number>;
  /** Permanent damage multiplier from prestige (lifetime AP + TP). */
  damageMult: number;
  /** Permanent gold multiplier from prestige. */
  goldMult: number;
  /** Run-scoped blessing picks (plan §1). */
  blessings: BlessingLoadout;
  /** Plan §4: perfect active play — manual aim, charged shots, clicked orbs. */
  active: boolean;
  /** Fraction of an orb's value collected: 1 clicking, 0.4 (or 1 magnet) idle. */
  orbRate: number;
}

export function freshLoadout(damageMult = 1, goldMult = 1, active = false): Loadout {
  const levels: Record<string, number> = {};
  for (const u of UPGRADES) levels[u.id] = u.startLevel ?? 0;
  return {
    levels,
    damageMult,
    goldMult,
    blessings: emptyBlessings(),
    active,
    orbRate: active ? 1 : LOOT_TUNING.autoCollectRate,
  };
}

function levelValue(id: string, level: number): number {
  const def = UPGRADE_BY_ID[id];
  if (!def || level <= 0) return 0;
  return computeUpgradeValue(def, level);
}

/** Damage of a single shot, before enemy armor. */
export function hitDamage(l: Loadout): number {
  const b = l.blessings;
  const base = (TOWER_BASE.baseDamage + levelValue('damage', l.levels.damage))
    * l.damageMult * (1 + b.damagePct);
  const crit = Math.min(
    1,
    TOWER_BASE.critChance + levelValue('critChance', l.levels.critChance) + b.critChanceAdd,
  );
  const critMult = TOWER_BASE.critMultiplier
    + levelValue('critDamage', l.levels.critDamage)
    + b.critDamageAdd;
  return Math.max(1, base) * (1 + crit * (critMult - 1));
}

export function fireRate(l: Loadout): number {
  return (TOWER_BASE.fireRate + levelValue('fireRate', l.levels.fireRate))
    * (1 + l.blessings.fireRatePct)
    // Plan §0.1 / §4.2: holding the mouse has always been worth +30% fire
    // rate. It is not new, but it *is* part of the idle-versus-active gap
    // §4.5 asks to measure, so the measurement counts it.
    * (l.active ? MANUAL_AIM.fireRateMult : 1);
}

/** Sustained DPS against an enemy with the given armor. */
export function dps(l: Loadout, armor: number): number {
  const effectiveArmor = Math.max(0, armor - l.blessings.armorPenFlat);
  const perHit = Math.max(1, hitDamage(l) - effectiveArmor);
  // Behaviors (ricochet, splash, chains, executes) and enemy-HP reduction all
  // land as extra damage the model cannot place spatially, so they are folded
  // in as one effective-DPS multiplier.
  const base = perHit * fireRate(l) * ENGAGEMENT_EFFICIENCY * (1 + l.blessings.dpsPct);
  if (!l.active) return base;
  // Plan §4.2: the charged shot does not consume the tower's cooldown, so it
  // is *added* to the volley rather than replacing part of it. Its cycle is
  // wall-clock and this model runs at 1x, which is the best case for it: at
  // 6.5x the same cycle covers 6.5x as much game time and the shot is worth a
  // sixth as much per game-second. Measuring at 1x is therefore the
  // pessimistic reading of "is active play too strong".
  //
  // An optimal player picks between two strategies, so the model does too:
  //   A. hold and track, never charge — the full manual-aim fire rate;
  //   B. hold still for 1.2 s of every 5.2 s — the charged shot, paid for with
  //      degraded tracking during the hold.
  // Taking the max is what stops the model crediting a player with the fire
  // rate of one strategy and the burst of the other.
  const chargeShare = MANUAL_AIM.chargeSeconds / CHARGE_CYCLE;
  const tracking = base * (1 - chargeShare + chargeShare * ACTIVE_PLAY.chargeAimPenalty);
  const charged = perHit
    * MANUAL_AIM.chargeDamageMult
    * ACTIVE_PLAY.chargeCrowdFactor
    * ENGAGEMENT_EFFICIENCY
    * (1 + l.blessings.dpsPct)
    / CHARGE_CYCLE;
  return Math.max(base, tracking + charged) * (1 + ACTIVE_PLAY.targetedCastDps);
}

export function goldMultiplier(l: Loadout): number {
  return (1 + levelValue('goldMulti', l.levels.goldMulti) + l.blessings.goldPct) * l.goldMult;
}

export function costOf(l: Loadout, id: BuyableId): number {
  const def = UPGRADE_BY_ID[id];
  const level = l.levels[id] ?? 0;
  if (def.maxLevel > 0 && level >= def.maxLevel) return Infinity;
  return upgradeCost(def.baseCost, def.costGrowth, level);
}

/**
 * Greedy buyer: repeatedly buy whichever affordable upgrade gives the best
 * (relative DPS gain + relative gold gain) per gold spent. This is the same
 * decision a competent player makes, and it is what the plan's baseline
 * table was produced with.
 */
export function buyGreedily(l: Loadout, gold: number, armor: number): number {
  let budget = gold;
  for (;;) {
    const baseDps = dps(l, armor);
    const baseGold = goldMultiplier(l);
    let bestId: BuyableId | null = null;
    let bestRatio = 0;
    let bestCost = 0;

    for (const id of BUYABLE) {
      const cost = costOf(l, id);
      if (!Number.isFinite(cost) || cost > budget) continue;
      l.levels[id] = (l.levels[id] ?? 0) + 1;
      // Gold income is worth roughly half a DPS point: it buys future DPS but
      // only after a delay, so it is discounted rather than counted 1:1.
      const gain = (dps(l, armor) / baseDps - 1) + 0.5 * (goldMultiplier(l) / baseGold - 1);
      l.levels[id] = (l.levels[id] ?? 0) - 1;
      const ratio = gain / cost;
      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestId = id;
        bestCost = cost;
      }
    }

    if (!bestId) break;
    budget -= bestCost;
    l.levels[bestId] = (l.levels[bestId] ?? 0) + 1;
  }
  return budget;
}

export interface RunResult {
  /** Last wave the tower cleared inside the time limit. */
  wallWave: number;
  /** Total in-game seconds to reach the wall. */
  durationSec: number;
  /** In-game seconds to reach the ascension unlock wave (Infinity if never). */
  timeToUnlockSec: number;
  /** Per-wave samples for the reporting table. */
  samples: Map<number, WaveSample>;
  /** Blessings held at the wall, and how many picks got there (plan §1.6). */
  blessings: BlessingLoadout;
  blessingPicks: number;
  /** Ids held at the wall, for a "what did this run become" readout. */
  blessingHeld: string[];
}

export interface WaveSample {
  wave: number;
  avgEnemyHp: number;
  totalHp: number;
  goldEarned: number;
  goldPerHp: number;
  clearSec: number;
  elapsedSec: number;
  dps: number;
  /** Shots per second at this wave — the charged shot's worth scales inversely. */
  fireRate: number;
}

export interface RunOptions {
  damageMult?: number;
  goldMult?: number;
  /** Wave the run is trying to reach (recorded as `timeToUnlockSec`). */
  unlockWave?: number;
  /**
   * Seconds of enrage the tower is assumed to survive before dying. Enrage
   * stacks +40% enemy damage each, so a tower that is merely a little short
   * dies within a couple of stacks; this is the model's stand-in for that.
   */
  enrageSurvivalSeconds?: number;
  maxWave?: number;
  sampleWaves?: number[];
  /** Run the blessing draft (plan §1). Off reproduces the pre-blessing curve. */
  blessings?: boolean;
  /**
   * Plan §4.5: perfect active play — manual aim held, a charged shot every
   * cycle, every orb clicked, every placeable ability aimed. Off is the fully
   * idle run, which is the curve the game is balanced around.
   */
  active?: boolean;
  /** Seed for the blessing draft's RNG, so a run is reproducible. */
  seed?: number;
}

export function simulateRun(opts: RunOptions = {}): RunResult {
  const {
    damageMult = 1,
    goldMult = 1,
    unlockWave = 30,
    enrageSurvivalSeconds = ENRAGE_STACK_INTERVAL * 3,
    maxWave = 400,
    sampleWaves = [1, 10, 30, 50, 100],
    blessings = true,
    seed = 0x5eed,
    active = false,
  } = opts;

  const loadout = freshLoadout(damageMult, goldMult, active);
  const samples = new Map<number, WaveSample>();
  // The draft is driven through the *real* manager, so the offer rules (no
  // duplicates, no maxed cards, `requires` gating, the 30-pick cap) are the
  // shipping ones rather than a second implementation that can drift.
  const blessingMgr = new BlessingManager();
  const rng = mulberry32(seed);
  let gold = 0;
  let elapsed = 0;
  let timeToUnlock = Infinity;
  let wave = 1;

  for (; wave <= maxWave; wave++) {
    const profile = waveProfile(wave);
    gold = buyGreedily(loadout, gold, profile.avgArmor);

    const waveDps = dps(loadout, profile.avgArmor);
    // A wave cannot finish faster than its enemies spawn.
    const killSec = profile.totalHp / waveDps;
    const activeSec = Math.max(killSec, profile.spawnDuration);
    const clearSec = activeSec + WAVE_INTERMISSION;

    // Plan §2.3.3: a wave that overruns starts enraging, and the tower dies a
    // short way into that. This — not an arbitrary patience limit — is the
    // wall, and it is why runs now end instead of stalling forever.
    if (activeSec > enrageThresholdSeconds(wave) + enrageSurvivalSeconds) break;

    // Plan §4.1: orbs are a gold faucet, and a faucet the model cannot see is
    // a faucet nobody is balancing. Idle collects 40% of it by drifting home;
    // clicking collects all of it; Lodestone raises the idle rate to 100%.
    const orbRate = loadout.blessings.orbMagnet ? 1 : loadout.orbRate;
    const earned = (profile.baseGold + orbGoldForWave(wave) * orbRate) * goldMultiplier(loadout);
    gold += earned;
    elapsed += clearSec;
    if (wave >= unlockWave && !Number.isFinite(timeToUnlock)) timeToUnlock = elapsed;

    // The wave is cleared: advance the greed clock and take a draft if one is
    // due. A player takes the best of the three they are shown, so the model
    // does too — `draftAppeal` is only the ordering, never the effect.
    if (blessings) {
      blessingMgr.noteWaveCleared();
      if (blessingMgr.isDraftDue(wave)) {
        const offer = blessingMgr.openDraft(wave, undefined, rng);
        if (offer.length > 0) {
          let best = offer[0];
          for (const def of offer) {
            if (draftAppeal(def) > draftAppeal(best)) best = def;
          }
          blessingMgr.choose(best.id);
          loadout.blessings = readBlessings(blessingMgr);
        } else {
          blessingMgr.skip();
        }
      }
    }

    if (sampleWaves.includes(wave)) {
      samples.set(wave, {
        wave,
        avgEnemyHp: profile.totalHp / profile.count,
        totalHp: profile.totalHp,
        goldEarned: earned,
        goldPerHp: earned / profile.totalHp,
        clearSec,
        elapsedSec: elapsed,
        dps: waveDps,
        fireRate: fireRate(loadout),
      });
    }
  }

  return {
    wallWave: wave - 1,
    durationSec: elapsed,
    timeToUnlockSec: timeToUnlock,
    samples,
    blessings: loadout.blessings,
    blessingPicks: blessingMgr.picks,
    blessingHeld: blessingMgr.heldIds,
  };
}
