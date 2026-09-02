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
  bossEscortCountForWave,
  crowdCompression,
  goldDropForWave,
  spawnCountForWave,
  spawnIntervalForWave,
  isBossWave,
  upgradeCost,
  enrageThresholdSeconds,
  ENRAGE_STACK_INTERVAL,
} from '../src/data/formulas.ts';
import {
  armorDamageMultiplier,
  ENEMY_BEHAVIOR,
  ENEMY_DEFS,
  bossGoldForWave,
  bossMaxHpForWave,
  bossPhaseHpFactor,
  spawnPoolForWave,
} from '../src/data/enemies.ts';
import { effectiveMaxLevel } from '../src/data/upgradeCaps.ts';
import { LOOT_TUNING, orbGoldValue } from '../src/data/loot.ts';
import {
  COMBO_WINDOW_SECONDS,
  MOMENTUM_CAP,
  OVERKILL_CARRY_BASE,
  comboBonus,
  comboTierIndex,
  intermissionSecondsForWave,
  riskGoldMult,
  riskHpMult,
} from '../src/data/pacing.ts';
import { UPGRADES, splashRadiusForLevel } from '../src/data/upgrades.ts';
// Namespace import on purpose: it is what lets the sim pick up
// `PRESTIGE_PROJECTILE_TUNING` (revamp §7) through the indexed lookup below.
import * as PRESTIGE_DATA from '../src/data/prestige.ts';
import { MANUAL_AIM, TOWER_BASE } from '../src/data/tower.ts';
import { computeUpgradeValue } from '../src/types.ts';
import type { EnemyType, UpgradeDef } from '../src/types.ts';
import { BlessingManager } from '../src/systems/BlessingManager.ts';
import { BLESSING_TUNING, type BlessingBehavior, type BlessingDef } from '../src/data/blessings.ts';
import { ContractManager } from '../src/systems/ContractManager.ts';
import { CORE_BY_ID, CORE_TUNING, DEFAULT_CORE, type CoreId } from '../src/data/cores.ts';
import { STAT_BASES } from '../src/stats/keys.ts';

/** Fraction of wall-clock time the tower actually spends shooting a live target. */
const ENGAGEMENT_EFFICIENCY = 0.85;

/**
 * Adrenaline Rush's multiplier, mirroring `QUICK_SHOT_FIRE_RATE` in `Game.ts`.
 *
 * A literal because the game's copy is a module-private const rather than data;
 * if the buff ever moves into `src/data`, this reads it instead.
 */
const QUICK_SHOT_FIRE_RATE = 2;

/**
 * Effective-DPS credit for the baseline overkill carry (gameplay plan §7.5).
 *
 * `ENGAGEMENT_EFFICIENCY` has always folded overkill in as *waste*; §7.5 hands
 * 10% of that waste back as damage on another body. Sized off the blessing's
 * own credit, which was 0.03 for a 25% carry — so a 10% carry is 0.012, and the
 * card keeps the 0.018 step it now actually represents. Applied to every run,
 * idle and active alike, which is why it is the one line of Part 7 that could
 * move the *baseline* curve rather than only the reward side of it.
 */
const OVERKILL_BASE_DPS_CREDIT = 0.03 * (OVERKILL_CARRY_BASE / 0.25);

/**
 * Average gold multiplier the §7.2 combo pays over one wave.
 *
 * Not a constant, and not an assumed uptime: the combo is built by kills and
 * broken by a 2 s gap between them, so the model computes both from the wave
 * it is actually simulating. A wave whose mean inter-kill gap exceeds the
 * window never chains at all, which is why early waves — five enemies spread
 * over twenty seconds — see none of this.
 *
 * When the chain does hold, the bonus is *integrated over the wave* rather than
 * taken at its peak: the tier climbs as the wave is cleared, so a 50-kill wave
 * spends nine kills at +0%, fifteen at +5% and the rest at +12-25%. Reading the
 * peak would have credited the mechanic with two to three times what it pays.
 *
 * The step at the window boundary deliberately errs high — this figure is an
 * input to a *drift* check, and the dangerous direction is to under-credit a
 * faucet and then not see it move the curve.
 */
export function comboGoldMult(count: number, activeSec: number): number {
  const kills = Math.max(1, Math.round(count));
  if (activeSec / kills >= COMBO_WINDOW_SECONDS) return 1;
  let sum = 0;
  for (let k = 1; k <= kills; k++) sum += comboBonus(comboTierIndex(k)).gold;
  return 1 + sum / kills;
}

/**
 * Every upgrade id whose effect this model actually resolves (revamp §13.1).
 *
 * The list used to be six ids long, which meant the greedy buyer could not
 * spend on twenty-one of the twenty-seven lines and the sim was measuring a
 * much narrower game than the one that ships: *a purchasable effect the sim
 * cannot see is an effect nobody is balancing*. Everything here moves DPS or
 * gold and has a term below —
 *
 *   - offence: `damage`, `fireRate`, `critChance`, `critDamage`,
 *     `doubleShotChance`, `quickShotChance`, `quickShotTime`;
 *   - coverage: `pierce`, `splash` (see `effectiveTargets`);
 *   - economy: `goldMulti`, `prospecting`, `goldOnKill`, `critGold`,
 *     `waveGold`;
 *   - `manaRegen`, which moves neither for four of the five cores (its
 *     `gain / cost` is then exactly zero and it is never bought) but feeds the
 *     arcane proc through `manaRegenPerSec`.
 *
 * `pierce`, `splash` and `prospecting` do not exist in `UPGRADES` yet — they
 * arrive with revamp task 4. That is why `BUYABLE` is *derived* from the
 * shipping table rather than written out: the ids are picked up automatically
 * on the commit that adds them, with no second edit here to forget.
 *
 * Deliberately absent: `landMines` (damage the model has no positions to place
 * — it fires at the tower's feet, and crediting it would be inventing a number
 * rather than measuring one), `range`, `xpGain`, `abilityCostReduction` and the
 * whole defense category, none of which move DPS or gold in a model with no
 * tower HP.
 */
const MODELLED_UPGRADE_IDS = new Set([
  'damage', 'fireRate', 'critChance', 'critDamage', 'manaRegen',
  'doubleShotChance', 'quickShotChance', 'quickShotTime',
  'pierce', 'splash',
  'goldMulti', 'prospecting', 'goldOnKill', 'critGold', 'waveGold',
]);

const BUYABLE: string[] = UPGRADES
  .filter(u => MODELLED_UPGRADE_IDS.has(u.id))
  .map(u => u.id);
type BuyableId = string;

/**
 * The six ids the buyer could reach before revamp §13 widened the list.
 *
 * Kept, and only ever selected through `RunOptions.legacyBuyable`, because the
 * revamp's entire §1 baseline was measured with this buyer: **wall 39, 21 min,
 * 82 AP**. Widening the list moves that baseline — a buyer with more real
 * options builds a stronger tower — so the old figure has to stay reproducible
 * or there is no way to tell a re-tune apart from the instrumentation that
 * measured it. See the provenance line under the §13 report.
 */
const LEGACY_BUYABLE: string[] = [
  'damage', 'fireRate', 'critChance', 'critDamage', 'goldMulti', 'manaRegen',
];

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
  if (!isBossWave(wave)) return spawnPoolForWave(wave);
  // A boss wave is one boss and `bossEscortCountForWave` trash from the wave's
  // own pool, so the mix has to be both — weighted by how many bodies of each
  // are actually on the field, because `waveProfile` averages across the mix
  // and then multiplies by `spawnCountForWave`.
  const pool = spawnPoolForWave(wave);
  const poolWeight = pool.reduce((a, e) => a + e.weight, 0);
  const escort = bossEscortCountForWave(wave);
  if (poolWeight <= 0 || escort <= 0) return [{ type: 'boss', weight: 1 }];
  return [
    { type: 'boss' as EnemyType, weight: 1 },
    ...pool.map(e => ({ type: e.type, weight: escort * (e.weight / poolWeight) })),
  ];
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
  // The deep roster (progress-steps A.1):
  //   - `harbinger` 1.6: it is not durable itself, but the 2 s it takes the
  //     field away every 6 s is a third of the tower's uptime against whatever
  //     it is escorting. Priced on the escort's behalf, conservatively.
  //   - `leech` 1.4: converts the mana bar into absorb on itself. The model
  //     has no mana economy, so this is the only place its cost can land.
  //   - `chorus` 1.0: three voices sharing one pool is exactly three bodies'
  //     worth of HP, and `EnemyManager.spawn` already multiplies the bar by
  //     `chorusVoices`. Anything above 1.0 here would count it twice.
  harbinger: 1.6,
  leech: 1.4,
  chorus: 1,
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
/**
 * Orbs a wave actually drops, collected or not.
 *
 * Split out of `orbGoldForWave` because contracts count *orbs*, not their
 * value: a mana orb pays the model nothing and still ticks `collect_orbs`.
 */
export function orbCountForWave(wave: number): number {
  return isBossWave(wave)
    ? (LOOT_TUNING.bossOrbsMin + LOOT_TUNING.bossOrbsMax) / 2
    : spawnCountForWave(wave) * LOOT_TUNING.commonDropChance;
}

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
  /** Mean armor across the wave (physical damage keeps `K/(K+armor)` of a hit). */
  avgArmor: number;
  /** Mean magic resist — what the arcane proc is reduced by instead of armour. */
  avgMagicResist: number;
  /** Gold the wave pays out at a 1x multiplier. */
  baseGold: number;
  /** Seconds before the last enemy has even spawned. */
  spawnDuration: number;
}

/**
 * @param risk the §7.4 dial, 0-5. Raises enemy HP and the wave's payout.
 *
 * Enemy *speed* is not modelled, because the model has no positions — which
 * means the dial's cost is understated here and its reward is exact. That is
 * the safe direction for a check whose question is "is risk free gold?".
 */
export function waveProfile(wave: number, risk = 0): WaveProfile {
  const count = spawnCountForWave(wave);
  const mix = typeMix(wave);
  const weightSum = mix.reduce((a, e) => a + e.weight, 0);

  let hpPer = 0;
  let armorPer = 0;
  let magicResistPer = 0;
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
    const effectiveHp = share * hp * EFFECTIVE_HP_FACTOR[type] * phaseFactor;
    hpPer += effectiveHp;
    // Armour and resist are weighted by **HP share**, not body share: a hit is
    // reduced by the armour of whatever it lands on, and the number of hits a
    // type absorbs is proportional to how much HP it is. Body-weighted was
    // close enough while a wave was one kind of thing — every enemy on a boss
    // wave was a boss — but a boss wave is one armour-6 boss and an escort of
    // armour-1 trash now, and averaging those per *body* hands the tower the
    // trash's armour on the boss's HP and prices the encounter ~15% cheaper
    // than it is.
    armorPer += effectiveHp * def.armor;
    magicResistPer += effectiveHp * def.magicResist;
    goldPer += share * (type === 'boss'
      ? bossGoldForWave(wave)
      : goldDropForWave(def.baseGold, wave));
    if (type === 'thief') thiefShare = share;
  }
  if (hpPer > 0) {
    armorPer /= hpPer;
    magicResistPer /= hpPer;
  }

  // Plan §2.1: a thief that gets away takes gold with it. Capped by the same
  // per-wave ceiling the game enforces, so this can never dominate the curve.
  const theftDrag = thiefShare > 0
    ? Math.min(ENEMY_BEHAVIOR.thiefWaveTheftCap, THIEF_GOLD_DRAG)
    : 0;

  // `count` is the capped roster and `compression` is what each surviving body
  // carries, so `count * compression` is the natural body count and both
  // totals below are unchanged by the cap — which is the invariant
  // `tests/enemies.test.ts` holds.
  const compression = crowdCompression(wave);
  return {
    count,
    totalHp: hpPer * count * compression * riskHpMult(risk),
    avgArmor: armorPer,
    avgMagicResist: magicResistPer,
    baseGold: goldPer * count * compression * (1 - theftDrag) * riskGoldMult(risk),
    spawnDuration: spawnIntervalForWave(wave, count) * (count - 1),
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
  // Plan §7.5 made a 10% carry the *baseline*, so the card is only worth the
  // step from 10% to 25% now. `OVERKILL_BASE_DPS_CREDIT` carries the rest, on
  // every run rather than only on a blessed one.
  overkill_carry: 0.018,
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
   * Targeted ability placement (plan §I.4 / abilities plan), as an additive
   * fraction of total DPS.
   *
   * The model has no abilities at all, so this cannot be derived — it is an
   * estimate. Five of ten abilities are now targeted rather than three; the
   * focus bonus is `PLACEMENT_FOCUS_DAMAGE_BONUS` (0.25) across the whole disc
   * rather than 0.6 across a sub-disc; and a placed disc that misses now costs
   * real coverage (auto-cast fills only the cluster it can see). The gap
   * between perfect placement and the auto-placer is genuinely wider than the
   * old estimate, so the credit rises.
   */
  targetedCastDps: 0.06,
} as const;

/**
 * Manual aim and the charged shot come straight from `MANUAL_AIM`, the table
 * the game itself reads, so the multiplier can only be cut in one place.
 */
const CHARGE_CYCLE = MANUAL_AIM.chargeSeconds + MANUAL_AIM.chargeCooldown;

// ────────────────────────────────────────────────────────────────────────────
// Tower cores (gameplay plan §6.4)
// ────────────────────────────────────────────────────────────────────────────

/**
 * What each core is worth in the channels this model has no simulation for.
 *
 * The *stat blocks* are not here — they are read straight out of `CORE_BY_ID`
 * by `hitDamage` / `fireRate` / `goldMultiplier`, so a re-tune in
 * `src/data/cores.ts` is measured rather than guessed. This record covers only
 * what the model genuinely cannot see, and a `Record` over `CoreId` for the
 * same reason `BEHAVIOR_DPS_CREDIT` is one: a core the model silently scores at
 * zero is a core whose balance was never checked.
 *
 * `enrageSurvivalMult` deserves a note, because it is the only survivability
 * lever the model has and it is not a fudge. The wall is
 * `activeSec > enrageThreshold + enrageSurvivalSeconds` — literally "how long
 * the tower lasts once a wave overruns" — so a core that raises effective HP
 * raises exactly that number and nothing else. Without it, `bloodforge` is
 * "-20% gold and nothing", which is what a DPS-only model always says about a
 * defensive build.
 */
export interface CoreModelEntry {
  /** Effective-DPS credit for shot behaviors the model cannot place spatially. */
  dpsPct: number;
  /** Share of shots that are the core's proc (0 for cores without one). */
  procShare: number;
  procMult: number;
  /** True when the proc's damage type bypasses flat armour. */
  procIgnoresArmor: boolean;
}

/**
 * How survivability converts into wall wave.
 *
 * The wall is `activeSec > enrageThreshold + enrageSurvivalSeconds` — literally
 * "how long the tower lasts once a wave overruns" — so a core that raises
 * effective HP raises exactly that and nothing else.
 *
 * It is **derived from the shipping stat block** rather than being a per-core
 * constant, which matters more than it looks: a hand-set multiplier would mean
 * re-tuning `bloodforge`'s `maxHpPct` moved nothing in the very table that is
 * supposed to be measuring the re-tune.
 */
const CORE_SURVIVAL = {
  /** Effective-HP multiple per point of lifesteal, at a run's average uptime. */
  lifestealEhp: 2,
  /** Effective-HP bump from a heal on every kill. */
  killHealEhp: 0.10,
  /**
   * Enrage damage compounds (+40% per stack, every 8 s), so survival *time*
   * grows sub-linearly in effective HP. Doubling EHP does not double the
   * seconds survived; this is the discount that says so.
   */
  enrageDiscount: 0.6,
} as const;

/**
 * Seconds-of-enrage multiplier for a core, from its own numbers.
 *
 * `desperate_tempo` (+40% fire rate below half HP) is credited at **zero**
 * here, deliberately: it fires exactly during the window this function is
 * pricing, so it is real, but the model has no tower HP to know how long the
 * tower spends under the threshold. Zero is the reading that does not flatter
 * the core.
 */
export function coreSurvivalMult(core: CoreId): number {
  const def = CORE_BY_ID[core];
  const hp = 1 + (def.stats.maxHpPct ?? 0);
  const sustain = 1
    + (def.stats.lifestealAdd ?? 0) * CORE_SURVIVAL.lifestealEhp
    + (def.behaviors.includes('kill_heal') ? CORE_SURVIVAL.killHealEhp : 0);
  return 1 + CORE_SURVIVAL.enrageDiscount * (hp * sustain - 1);
}

export const CORE_MODEL: Record<CoreId, CoreModelEntry> = {
  // The reference core. Everything it does — crit chance, range — is either
  // already in the stat pipeline or invisible to a model with no positions.
  marksman: {
    dpsPct: 0,
    procShare: 0,
    procMult: 1,
    procIgnoresArmor: false,
  },
  // Every shot carries a blast at 50%. Scaled off the mortar blessing's
  // measured credit (0.05 for one shot in eight, at the mortar's own radius
  // and full fraction): 8x the frequency, half the fraction, and the ratio of
  // the two areas.
  //
  // The denominator reads `BLESSING_TUNING.mortarRadius` rather than the
  // literal 90 it was measured at, because both radii carry the camera's
  // `WORLD_SCALE` now (UI plan §1.1) — left as a literal, the zoom-out alone
  // would have inflated artillery's modelled DPS 6.8x without a single line of
  // combat code changing.
  artillery: {
    dpsPct: 0.05 * 8 * CORE_TUNING.splashFraction
      * (CORE_TUNING.splashRadius / BLESSING_TUNING.mortarRadius) ** 2,
    procShare: 0,
    procMult: 1,
    procIgnoresArmor: false,
  },
  // Chill is worth more than the blessing's 0.015 (harder, longer, and on
  // every hit rather than as one card among thirty) but still small in a model
  // with no enemy positions: what a slow buys is time in the firing corridor,
  // which is folded into `ENGAGEMENT_EFFICIENCY` here rather than simulated.
  // The Frost Nova half is worth nothing at all — the model has no abilities.
  frostwork: {
    dpsPct: 0.04,
    procShare: 0,
    procMult: 1,
    procIgnoresArmor: false,
  },
  // Everything bloodforge does is survivability, which the model prices through
  // `coreSurvivalMult` off the shipping stat block rather than as a credit
  // here. Its DPS credit is genuinely zero.
  bloodforge: {
    dpsPct: 0,
    procShare: 0,
    procMult: 1,
    procIgnoresArmor: false,
  },
  // The proc is handled structurally, in `procPerShot`, because it is a share
  // of shots rather than a flat percentage. `dpsPct` here is the *ability*
  // half of the core (+50% ability damage), which the model has no abilities
  // to spend — the same estimate `ACTIVE_PLAY.targetedCastDps` is, and small
  // for the same reason: abilities are a minority of a run's damage even
  // after the abilities plan makes five of ten targeted.
  arcane: {
    dpsPct: 0.04,
    procShare: 1 / CORE_TUNING.manaShotInterval,
    procMult: CORE_TUNING.manaShotDamageMult,
    procIgnoresArmor: true,
  },
};

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

// ────────────────────────────────────────────────────────────────────────────
// Contracts (gameplay plan §5)
// ────────────────────────────────────────────────────────────────────────────

/**
 * What the model assumes about the channels it has no simulation for.
 *
 * Contracts are a gold faucet and an AP faucet, so a model that cannot see
 * them is measuring a game that no longer exists — the same argument orbs got
 * in Part 4. But four of the ten goal kinds ask about systems this model
 * deliberately does not have (abilities, mutators, tower HP), and a contract
 * that can never progress would sit in a slot forever and *understate* the
 * faucet. Each figure below is therefore the assumption that makes the faucet
 * look **larger**, which is the safe direction for a check whose job is to
 * catch contracts moving the curve.
 */
export const CONTRACT_MODEL = {
  /**
   * Ability casts credited per wave once mana is unlocked.
   *
   * The model has no abilities at all. Two per wave is roughly what auto-cast
   * manages across the nine of them at mid-run cooldowns.
   */
  castsPerWave: 2,
  /**
   * Waves after each boss wave that count as running under a mutator.
   *
   * `WaveManager` offers a mutator on every boss wave and one runs for
   * `MUTATOR_DURATION_WAVES`, so a player who always accepts is under one for
   * three waves in every ten.
   */
  mutatorWavesPerCycle: 3,
  /**
   * Whether a cleared wave counts as flawless.
   *
   * The model has no tower HP, so it cannot know. `true` is the assumption
   * that makes `flawless_waves` complete fastest.
   */
  flawless: true,
} as const;

/**
 * Where a completion's gold goes, set for the duration of one wave's events.
 *
 * A module-level hook rather than a closure on the manager because the manager
 * announces completions on an event bus, and the sim's bus stub is the thing
 * that has to route them somewhere.
 */
let contractPayout: ((goldWaves: number) => void) | null = null;

/** The three-line bus the sim hands `ContractManager`. */
function contractBus() {
  return {
    emit: (event: string, payload?: unknown) => {
      if (event !== 'contract_completed' || !contractPayout) return;
      const p = payload as { reward: { goldWaves: number } };
      contractPayout(p.reward.goldWaves);
    },
  };
}

/** Gold one wave is worth, matching `Game.estimateWaveGold` exactly. */
function estimateWaveGold(wave: number, l: Loadout): number {
  return goldDropForWave(ENEMY_DEFS.normal.baseGold, wave)
    * spawnCountForWave(wave)
    * goldMultiplier(l);
}

/**
 * Feed one cleared wave's worth of events to the real `ContractManager`.
 *
 * The *real* manager, for the same reason the draft runs through the real
 * `BlessingManager`: the band gating, the three-slot refill and the +50% AP cap
 * are the shipping ones rather than a second implementation that can drift.
 *
 * Returns the gold the completions paid and the AP bonus the run has banked.
 */
function runContractsForWave(
  mgr: ContractManager,
  wave: number,
  l: Loadout,
  ctx: { goldSpent: number; clearSec: number; killMix: Array<{ type: EnemyType; weight: number }> },
): number {
  let paid = 0;
  contractPayout = (goldWaves) => {
    if (goldWaves > 0) paid += estimateWaveGold(wave, l) * goldWaves;
  };

  // Kills, distributed across the wave's actual type mix so `kill_type`
  // contracts progress at the rate the spawn table implies.
  const count = spawnCountForWave(wave);
  const weightSum = ctx.killMix.reduce((a, e) => a + e.weight, 0);
  let assigned = 0;
  for (let i = 0; i < ctx.killMix.length; i++) {
    const entry = ctx.killMix[i];
    const share = i === ctx.killMix.length - 1
      ? count - assigned
      : Math.round((entry.weight / weightSum) * count);
    assigned += share;
    for (let k = 0; k < share; k++) mgr.note({ kind: 'enemy_killed', type: entry.type });
  }

  // Every orb is collected sooner or later — an uncollected one drifts home
  // and pays 40% (plan §4.1) — so the *count* a contract sees is the same idle
  // or clicked. Only the value differs, and that is `orbGoldForWave`'s job.
  const orbs = Math.round(orbCountForWave(wave));
  for (let i = 0; i < orbs; i++) mgr.note({ kind: 'orb_collected' });

  if (wave >= 10) {
    for (let i = 0; i < CONTRACT_MODEL.castsPerWave; i++) mgr.note({ kind: 'ability_cast' });
  }
  if (ctx.goldSpent > 0) mgr.note({ kind: 'gold_spent', amount: ctx.goldSpent });
  if (isBossWave(wave)) mgr.note({ kind: 'boss_encounter', seconds: ctx.clearSec });

  const inMutator = wave > 10 && (wave % 10) <= CONTRACT_MODEL.mutatorWavesPerCycle && (wave % 10) > 0;
  mgr.note({
    kind: 'wave_cleared',
    wave,
    flawless: CONTRACT_MODEL.flawless,
    mutatorActive: inMutator,
  });
  contractPayout = null;
  return paid;
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
  /** The run's tower core (plan §6). `marksman` is the default and the ruler. */
  core: CoreId;
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
  /**
   * The wave the loadout is currently fighting.
   *
   * Coverage is the one channel that is worth more against a crowd than
   * against a straggler (revamp §4), so `dps` has to know how many enemies the
   * wave has. Carried on the loadout rather than threaded through every call
   * site, because `dps(l, armor)` is the signature the whole sim and both
   * report files are written against.
   */
  wave: number;
  /** Coverage granted by prestige rather than by the gold table (revamp §13.2). */
  prestigeCoverage: PrestigeCoverage;
}

/**
 * The prestige half of coverage, as the model sees it.
 *
 * Nothing sets these yet — the AP/TP trees are revamp tasks 7 and 8, and the
 * baseline must not move before them — but the fields exist so those tasks
 * feed the *measured* number instead of adding a second coverage model.
 */
export interface PrestigeCoverage {
  /** `pierceExtra` from `ap_pierce` / `tp_pierce`. */
  pierceExtra: number;
  /** Splash fraction from `tp_aoe`, composed with the `splash` upgrade. */
  splashFraction: number;
  /** Splash radius in world pixels; composed by max, as `FireOptions` does. */
  splashRadius: number;
  /** Twin Arrows: front projectiles, each carrying `extraDamageScale`. */
  extraShots: number;
  /** Rear Guard: projectiles behind the tower, at `rearDamageScale`. */
  rearShots: number;
  /** Scatter Shot: angled lanes, each at `scatterDamageScale`. */
  scatterShots: number;
}

export function emptyPrestigeCoverage(): PrestigeCoverage {
  return {
    pierceExtra: 0,
    splashFraction: 0,
    splashRadius: 0,
    extraShots: 0,
    rearShots: 0,
    scatterShots: 0,
  };
}

export function freshLoadout(
  damageMult = 1,
  goldMult = 1,
  active = false,
  core: CoreId = DEFAULT_CORE,
): Loadout {
  const levels: Record<string, number> = {};
  for (const u of UPGRADES) levels[u.id] = u.startLevel ?? 0;
  return {
    levels,
    core,
    damageMult,
    goldMult,
    blessings: emptyBlessings(),
    active,
    orbRate: active ? 1 : LOOT_TUNING.autoCollectRate,
    wave: 1,
    prestigeCoverage: emptyPrestigeCoverage(),
  };
}

function levelValue(id: string, level: number): number {
  const def = UPGRADE_BY_ID[id];
  if (!def || level <= 0) return 0;
  return computeUpgradeValue(def, level);
}

/**
 * Damage of a single shot, before enemy armor.
 *
 * The core's stat block is read from `CORE_BY_ID`, the table the game itself
 * resolves through `stats/contributors/core.ts`, so a re-tune is measured here
 * rather than needing a second copy of the numbers.
 */
/**
 * Composed crit chance. Split out of `hitDamage` because `critGold` pays on a
 * crit *kill*, so the economy model needs the same number the damage model uses.
 */
export function critChance(l: Loadout): number {
  return Math.min(
    1,
    TOWER_BASE.critChance + levelValue('critChance', l.levels.critChance)
      + l.blessings.critChanceAdd + (CORE_BY_ID[l.core].stats.critChanceAdd ?? 0),
  );
}

export function hitDamage(l: Loadout): number {
  const b = l.blessings;
  const c = CORE_BY_ID[l.core].stats;
  const base = (TOWER_BASE.baseDamage + levelValue('damage', l.levels.damage))
    * l.damageMult * (1 + b.damagePct) * (1 + (c.damagePct ?? 0));
  const crit = critChance(l);
  const critMult = TOWER_BASE.critMultiplier
    + levelValue('critDamage', l.levels.critDamage)
    + b.critDamageAdd;
  return Math.max(1, base) * (1 + crit * (critMult - 1));
}

export function fireRate(l: Loadout): number {
  return (TOWER_BASE.fireRate + levelValue('fireRate', l.levels.fireRate))
    * (1 + l.blessings.fireRatePct)
    * (1 + (CORE_BY_ID[l.core].stats.fireRatePct ?? 0));
  // No manual-aim term: holding the mouse no longer carries a fire-rate
  // bonus (plan §4.2). The whole active-play advantage now comes from the
  // charged shot and orb collection, which is what §4.5 measures.
}

/**
 * Mana per second, for the one core whose shot behavior spends it.
 *
 * Base plus whatever Meditation the greedy buyer decided was worth buying,
 * times the core's own regen bonus. This exists so `arcaneProcShare` has a
 * real number instead of an assumed uptime.
 */
export function manaRegenPerSec(l: Loadout): number {
  return (STAT_BASES.manaRegen + levelValue('manaRegen', l.levels.manaRegen ?? 0))
    * (1 + (CORE_BY_ID[l.core].stats.manaRegenPct ?? 0));
}

/**
 * The share of shots that actually land as the core's proc.
 *
 * For `arcane` this is mana-limited: the proc costs 3 mana every 5 shots, so
 * the drain scales with fire rate while the regen does not unless the player
 * pays for it. Out of mana the shot still fires, just as an ordinary one — so
 * the core degrades rather than stalling, and the model reads that as a reduced
 * share rather than a cliff.
 */
export function procShare(l: Loadout): number {
  const m = CORE_MODEL[l.core];
  if (m.procShare <= 0) return 0;
  if (l.core !== 'arcane') return m.procShare;
  const drain = fireRate(l) * m.procShare * CORE_TUNING.manaShotCost;
  if (drain <= 0) return m.procShare;
  const uptime = Math.min(1, manaRegenPerSec(l) / drain);
  return m.procShare * uptime;
}

/**
 * Average damage one shot lands, with the core's proc folded in.
 *
 * The proc is a *share* of shots, never a per-second cycle, which is what makes
 * it survive a fire-rate purchase intact — the lesson the charged shot cost a
 * full re-tune to learn. Magic damage is resisted by `magicResist` instead of
 * flat armour, which is the half of the arcane proc that the damage multiplier
 * does not show.
 */
function perShotDamage(l: Loadout, armor: number, magicResist: number): number {
  const raw = hitDamage(l);
  const effectiveArmor = Math.max(0, armor - l.blessings.armorPenFlat);
  const ordinary = Math.max(1, raw * armorDamageMultiplier(effectiveArmor));
  const share = procShare(l);
  if (share <= 0) return ordinary;
  const m = CORE_MODEL[l.core];
  const proc = m.procIgnoresArmor
    ? Math.max(1, raw * m.procMult * (1 - magicResist))
    : Math.max(1, raw * m.procMult * armorDamageMultiplier(effectiveArmor));
  return ordinary * (1 - share) + proc * share;
}

// ────────────────────────────────────────────────────────────────────────────
// Coverage: targets per shot, and payload per projectile (revamp §4, §13)
// ────────────────────────────────────────────────────────────────────────────

/**
 * What a point of coverage is worth, in a model with no enemy positions.
 *
 * Every figure here is deliberately **low**, and the direction matters: this is
 * the axis the revamp asks to carry the growth `damage` must not absorb, so a
 * generous credit here would show a wall the game cannot reach. Err low and the
 * sim under-reports coverage; err high and it green-lights a tuning that dies
 * on wave 10 in a browser.
 */
const COVERAGE_TUNING = {
  /**
   * Enemy count at which a lane is "full" — i.e. at which one extra pierce or
   * one splash disc finds a body every single time.
   *
   * Enemy count is `5 + floor((wave - 1) * 1.2)`: 27 at wave 20, 51 at wave 40.
   * 60 therefore keeps even a deep wave under full credit, which stands in for
   * the fact that a wave's *spawned* count is not its *alive at once* count.
   */
  densityReferenceCount: 60,
  /** Share of a pierce point that actually passes through a second body. */
  pierceCredit: 0.45,
  /** Bodies a splash disc at the reference radius covers, beyond the one hit. */
  splashTargetsAtReferenceRadius: 1.2,
  /** Radius the figure above was measured at — the mortar blessing's own. */
  splashReferenceRadius: BLESSING_TUNING.mortarRadius,
  /** Hard ceiling, so a stacked build cannot run away inside the model. */
  maxEffectiveTargets: 4,
  /** Share of shots a rear-facing projectile finds anything to hit. */
  rearCoverage: 0.30,
  /** Share of shots an angled scatter lane finds anything to hit. */
  scatterCoverage: 0.35,
} as const;

/**
 * Payload scales for the AP projectile perks (revamp §7).
 *
 * Read from `PRESTIGE_PROJECTILE_TUNING` in `src/data/prestige.ts`, so the sim
 * measures the payload that ships rather than a copy of it. The `1` fallback is
 * the pre-task-6 behaviour — every variant carrying the full `rawDamage`.
 */
interface ProjectileTuning {
  extraDamageScale: number;
  rearDamageScale: number;
  scatterDamageScale: number;
}

// Indexed through a variable rather than dotted: the namespace object carries
// the live export, and the lookup keeps the fallback honest if it is ever
// removed rather than failing the bundle.
const PROJECTILE_TUNING_KEY = 'PRESTIGE_PROJECTILE_TUNING';

const PROJECTILE_TUNING: ProjectileTuning =
  ((PRESTIGE_DATA as Record<string, unknown>)[PROJECTILE_TUNING_KEY] as
    ProjectileTuning | undefined)
  ?? { extraDamageScale: 1, rearDamageScale: 1, scatterDamageScale: 1 };

/** How full the lane is at this wave, 0-1. */
function crowdDensity(wave: number): number {
  return Math.min(1, spawnCountForWave(wave) / COVERAGE_TUNING.densityReferenceCount);
}

/** Total `pierceExtra` the loadout carries, from the gold table and prestige. */
export function pierceExtra(l: Loadout): number {
  return levelValue('pierce', l.levels.pierce ?? 0) + l.prestigeCoverage.pierceExtra;
}

/**
 * Splash, composed the way `FireOptions` composes it: **max** radius, summed
 * fraction. The `splash` upgrade spends its `scaling` block on the damage
 * fraction and derives the disc from the level, so the radius comes from the
 * shipping `splashRadiusForLevel` rather than a second copy of the geometry.
 */
export function splashCoverage(l: Loadout): { radius: number; fraction: number } {
  const def = UPGRADE_BY_ID.splash;
  const level = l.levels.splash ?? 0;
  const upgradeFraction = def ? levelValue('splash', level) : 0;
  const upgradeRadius = def ? splashRadiusForLevel(level) : 0;
  return {
    radius: Math.max(upgradeRadius, l.prestigeCoverage.splashRadius),
    fraction: upgradeFraction + l.prestigeCoverage.splashFraction,
  };
}

/**
 * Effective targets one shot lands on, ≥ 1 (revamp §13.2).
 *
 * Splash is credited at its *fraction*, not at full damage — a 25% splash on
 * two extra bodies is half an extra target, not two.
 */
export function effectiveTargets(l: Loadout): number {
  const density = crowdDensity(l.wave);
  const pierce = pierceExtra(l) * COVERAGE_TUNING.pierceCredit * density;
  const { radius, fraction } = splashCoverage(l);
  const area = radius > 0
    ? (radius / COVERAGE_TUNING.splashReferenceRadius) ** 2
      * COVERAGE_TUNING.splashTargetsAtReferenceRadius
    : 0;
  const splash = fraction * area * density * (1 + pierce);
  return Math.min(COVERAGE_TUNING.maxEffectiveTargets, 1 + pierce + splash);
}

/**
 * The volley's damage as a multiple of one projectile's, after payload scaling
 * and the geometry each extra lane actually covers.
 *
 * With the whole suite bought and revamp §7's scales in place this lands near
 * **x2.0** against the x2.80 the payloads sum to — the rear lane only covers
 * what is behind the tower and the scatter lanes miss on a sparse wave.
 */
export function volleyPayload(l: Loadout): number {
  const c = l.prestigeCoverage;
  return 1
    + c.extraShots * PROJECTILE_TUNING.extraDamageScale
    + c.rearShots * PROJECTILE_TUNING.rearDamageScale * COVERAGE_TUNING.rearCoverage
    + c.scatterShots * PROJECTILE_TUNING.scatterDamageScale * COVERAGE_TUNING.scatterCoverage;
}

/**
 * Shots per second the tower *effectively* fires, with Double Tap's extra
 * projectile and Adrenaline Rush's temporary 2x folded in as expectations.
 *
 * Adrenaline is a buff refreshed on any shot that rolls it, so its uptime is
 * `1 - (1 - p)^(rate * duration)` — saturating, which is the honest shape and
 * the reason the two lines are worth buying together or not at all.
 */
export function effectiveFireRate(l: Loadout): number {
  const raw = fireRate(l);
  const doubleShot = levelValue('doubleShotChance', l.levels.doubleShotChance ?? 0);
  const chance = levelValue('quickShotChance', l.levels.quickShotChance ?? 0);
  const duration = levelValue('quickShotTime', l.levels.quickShotTime ?? 0);
  let quick = 1;
  if (chance > 0 && duration > 0) {
    const uptime = 1 - (1 - Math.min(1, chance)) ** Math.max(1, raw * duration);
    quick = 1 + uptime * (QUICK_SHOT_FIRE_RATE - 1);
  }
  return raw * (1 + Math.min(1, doubleShot)) * quick;
}

/**
 * Shots one enemy takes to die — the revamp's first-class balance metric
 * (§3.3), and the number the upgrade panel is meant to show the player.
 *
 * Deliberately **per target**, not per volley: the extra lanes Twin/Rear/
 * Scatter add are *coverage*, spent on other enemies, and folding them in here
 * would report a one-shot the player never sees against the enemy in front of
 * the tower. Double Tap and Adrenaline are likewise excluded — they are shots
 * per second, not damage per shot.
 */
export function shotsToKill(l: Loadout, hp: number, armor: number, magicResist = 0): number {
  const per = perShotDamage(l, armor, magicResist);
  return per > 0 ? hp / per : Infinity;
}

/** Sustained DPS against an enemy with the given armor. */
export function dps(l: Loadout, armor: number, magicResist = 0): number {
  const perHit = perShotDamage(l, armor, magicResist);
  const coreDps = CORE_MODEL[l.core].dpsPct;
  // Behaviors (ricochet, splash, chains, executes) and enemy-HP reduction all
  // land as extra damage the model cannot place spatially, so they are folded
  // in as one effective-DPS multiplier.
  // Revamp §4: the third axis. Coverage (pierce, splash) and the volley's
  // payload (Twin/Rear/Scatter, at their shipping damage scales) multiply the
  // per-shot channel rather than adding to it, which is exactly why they are
  // the axis that can track a *crowd*. Both are 1.0 with nothing bought, so a
  // run that owns no coverage measures precisely what it did before.
  const rate = effectiveFireRate(l) * effectiveTargets(l) * volleyPayload(l);
  const base = perHit * rate * ENGAGEMENT_EFFICIENCY
    * (1 + l.blessings.dpsPct + coreDps + OVERKILL_BASE_DPS_CREDIT);
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
    * rate
    * MANUAL_AIM.chargeDpsSeconds
    * ACTIVE_PLAY.chargeCrowdFactor
    * ENGAGEMENT_EFFICIENCY
    * (1 + l.blessings.dpsPct + coreDps + OVERKILL_BASE_DPS_CREDIT)
    / CHARGE_CYCLE;
  return Math.max(base, tracking + charged) * (1 + ACTIVE_PLAY.targetedCastDps);
}

export function goldMultiplier(l: Loadout): number {
  // The core's gold is additive, matching how `contributors/core.ts` writes it
  // into `goldAdditive` — so bloodforge's -20% composes with prestige and
  // research instead of scaling the composed total.
  const core = CORE_BY_ID[l.core].stats.goldPct ?? 0;
  return Math.max(
    0,
    1 + levelValue('goldMulti', l.levels.goldMulti) + l.blessings.goldPct + core,
  ) * l.goldMult;
}

/**
 * Expected multiplier on a *kill's* gold, over and above `goldMultiplier`.
 *
 * Two channels, both read straight off `EnemyManager.valueFor`:
 *   - the **double-gold roll** (revamp §13.4), which `prospecting` feeds
 *     through the existing `doubleGoldChance` key — a `p` chance of `x2` is an
 *     expected `1 + p`, and the key is clamped to `[0, 1]` so this is too;
 *   - `critGold`, which pays only on a crit kill, so it is worth the crit
 *     chance times the bonus and nothing more.
 *
 * Deliberately not folded into `goldMultiplier`: that function has to keep
 * matching `Game.estimateWaveGold` exactly, because contracts size their
 * payouts off it.
 */
export function killGoldMultiplier(l: Loadout): number {
  const doubleGold = Math.max(0, Math.min(1, levelValue('prospecting', l.levels.prospecting ?? 0)));
  const critBonus = levelValue('critGold', l.levels.critGold ?? 0);
  return goldMultiplier(l) * (1 + doubleGold) * (1 + critChance(l) * critBonus);
}

/**
 * Flat gold a wave pays that no multiplier touches: `goldOnKill` once per
 * enemy, `waveGold` once on clear.
 *
 * The Wave Mastery *chain* multiplier (`Game.ts:1304`) is not credited — it is
 * uncapped today and revamp §6.2 clamps it, so crediting the pre-clamp shape
 * here would bake the very bug the plan is removing into the baseline.
 */
export function flatGoldForWave(wave: number, l: Loadout): number {
  const perKill = levelValue('goldOnKill', l.levels.goldOnKill ?? 0);
  const onClear = levelValue('waveGold', l.levels.waveGold ?? 0);
  return perKill * spawnCountForWave(wave) + onClear;
}

/**
 * What a wave is worth to this loadout — the quantity the greedy buyer is
 * actually comparing when it weighs an economy line against a damage one.
 *
 * Risk is left at 0: it scales every wave's payout uniformly, so it cancels in
 * the ratio the buyer takes.
 */
export function waveIncome(l: Loadout, wave = l.wave): number {
  return waveProfile(wave).baseGold * killGoldMultiplier(l) + flatGoldForWave(wave, l);
}

export function costOf(l: Loadout, id: BuyableId): number {
  const def = UPGRADE_BY_ID[id];
  const level = l.levels[id] ?? 0;
  const cap = effectiveMaxLevel(def);
  if (cap > 0 && level >= cap) return Infinity;
  return upgradeCost(def.baseCost, def.costGrowth, level);
}

/**
 * Greedy buyer: repeatedly buy whichever affordable upgrade gives the best
 * (relative DPS gain + relative gold gain) per gold spent. This is the same
 * decision a competent player makes, and it is what the plan's baseline
 * table was produced with.
 */
export function buyGreedily(
  l: Loadout, gold: number, armor: number, magicResist = 0, ids: string[] = BUYABLE,
): number {
  let budget = gold;
  for (;;) {
    const baseDps = dps(l, armor, magicResist);
    const baseGold = waveIncome(l);
    let bestId: BuyableId | null = null;
    let bestRatio = 0;
    let bestCost = 0;

    for (const id of ids) {
      const cost = costOf(l, id);
      if (!Number.isFinite(cost) || cost > budget) continue;
      l.levels[id] = (l.levels[id] ?? 0) + 1;
      // Gold income is worth roughly half a DPS point: it buys future DPS but
      // only after a delay, so it is discounted rather than counted 1:1.
      const gain = (dps(l, armor, magicResist) / baseDps - 1)
        + 0.5 * (waveIncome(l) / baseGold - 1);
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

/**
 * The largest composed-DPS step any single ordinary level can buy from here
 * (revamp gate 7: no ordinary level may move total DPS by more than +25%).
 *
 * Affordability is deliberately ignored — the gate is about the *shape* of the
 * curve, and a level that is worth +80% is a broken level whether or not the
 * buyer can reach it this wave.
 */
export function bestPurchase(
  l: Loadout, armor: number, magicResist = 0, ids: string[] = BUYABLE,
): { id: string; dpsDelta: number } {
  const base = dps(l, armor, magicResist);
  let id = '—';
  let dpsDelta = 0;
  if (base <= 0) return { id, dpsDelta };
  for (const candidate of ids) {
    if (!Number.isFinite(costOf(l, candidate))) continue;
    l.levels[candidate] = (l.levels[candidate] ?? 0) + 1;
    const delta = dps(l, armor, magicResist) / base - 1;
    l.levels[candidate] = (l.levels[candidate] ?? 0) - 1;
    if (delta > dpsDelta) {
      dpsDelta = delta;
      id = candidate;
    }
  }
  return { id, dpsDelta };
}

export interface RunResult {
  /** The core the run was on. */
  core: CoreId;
  /** The §7.4 risk the run was played at. */
  risk: number;
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
  /** Contracts completed by the wall, and the AP bonus they banked (plan §5). */
  contractsCompleted: number;
  contractApBonus: number;
  /** Contract gold as a fraction of everything the run earned. */
  contractGoldShare: number;
  /**
   * Geometric mean of `wave gold / previous wave gold` across the run — the
   * revamp §6.3 figure, measured at 1.185x today against a `GOLD_GROWTH` of
   * 1.08. The gap is purchased multipliers, and the target is ≤1.16x.
   */
  incomeGrowth: number;
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
  // ── Revamp §13.5: everything the instrumentation table reports ──
  /** Boss waves get their own budget row; §1.2 splits the two. */
  boss: boolean;
  /**
   * Fraction of the wave's enrage budget the wave consumed —
   * `activeSec / (enrageThresholdSeconds + enrageSurvival)`. The revamp's whole
   * complaint is that this sits at 18-34% on nine waves in ten.
   */
  budgetUse: number;
  /** Shots a same-wave `normal` takes to die (revamp gate 6). */
  shotsToKillNormal: number;
  /** Shots the wave's *average* enemy takes to die. */
  shotsToKillAverage: number;
  /** Effective targets one shot covers, and the volley's payload multiple. */
  targetsPerShot: number;
  payload: number;
  /** Levels of the lines the report tracks, at this wave. */
  levels: Record<string, number>;
  /** Waves of this wave's income the next level of each core line costs. */
  wavesOfIncome: Record<string, number>;
  /** Best single purchase available here, as a fraction of composed DPS. */
  bestPurchaseId: string;
  bestPurchaseDpsDelta: number;
}

/** Lines the §13.5 report tracks level-by-level. */
export const REPORT_LINES = ['damage', 'fireRate', 'pierce', 'goldMulti'] as const;

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
  /**
   * Run the contract tracker (plan §5). Off reproduces the pre-contract curve,
   * which is what the §5 before/after table is for.
   */
  contracts?: boolean;
  /**
   * The run's tower core (plan §6.4). `marksman` is the default *and* the
   * ruler: every other core is required to land within ±15% of its wall wave.
   */
  core?: CoreId;
  /**
   * The §7.4 risk dial, 0-5. **0 must reproduce the pre-Part-7 curve exactly**
   * — that is §7.8's gate, and the whole reason risk is a parameter here
   * rather than a constant folded into `waveProfile`.
   */
  risk?: number;
  /**
   * Run the §7.1/§7.2 pacing faucets (early-call momentum and the combo).
   * Off reproduces the pre-Part-7 income, which is what the before/after table
   * is for.
   */
  pacing?: boolean;
  /**
   * Restrict the greedy buyer to the six ids it could reach before revamp §13.
   *
   * The only reason this exists: the revamp's §1 baseline (wall 39, 21 min,
   * 82 AP) was measured with that buyer, and a widened buyer is a *different*
   * measurement rather than a drift. Off — the default — is the game as it
   * actually ships.
   */
  legacyBuyable?: boolean;
  /**
   * Gold the run opens with (prestige-abs §8.3).
   *
   * Seed Capital is the one node in the new tier-1 shelf whose base is a
   * genuine balance risk: front-loaded gold compounds through the whole
   * upgrade curve, so the model has to credit it as a permanent head start
   * rather than as a one-off. Defaults to 0, which is the pre-§3.1 curve.
   */
  startGold?: number;
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
    contracts = true,
    core = DEFAULT_CORE,
    startGold = 0,
    risk = 0,
    pacing = true,
    legacyBuyable = false,
  } = opts;
  const buyable = legacyBuyable ? LEGACY_BUYABLE : BUYABLE;

  const loadout = freshLoadout(damageMult, goldMult, active, core);
  // Plan §6.1: bloodforge buys survivability, and the wall condition below is
  // literally "seconds survived once a wave overruns" — so that is where the
  // core's HP, lifesteal and kill-heal land. See `CORE_MODEL`.
  const enrageSurvival = enrageSurvivalSeconds * coreSurvivalMult(core);
  const samples = new Map<number, WaveSample>();
  // The draft is driven through the *real* manager, so the offer rules (no
  // duplicates, no maxed cards, `requires` gating, the 30-pick cap) are the
  // shipping ones rather than a second implementation that can drift.
  const blessingMgr = new BlessingManager();
  const rng = mulberry32(seed);
  // Contracts run through the real manager too, off their **own** stream
  // derived from the same seed. Sharing `rng` would have made every contract
  // draw perturb the blessing draft, so the §1.6 table would move on a change
  // that touched no card — which is exactly the drift these tables exist to
  // detect.
  const contractRng = mulberry32(seed ^ 0x0c07);
  let contractWave = 1;
  const contractMgr = new ContractManager({
    bus: contractBus(),
    currentWave: () => contractWave,
    waveGold: (w) => estimateWaveGold(w, loadout),
    rng: contractRng,
  });
  if (contracts) contractMgr.refill();
  let contractGold = 0;
  let totalGold = 0;
  let lastEarned = 0;
  let growthSum = 0;
  let growthSteps = 0;
  let gold = startGold;
  let elapsed = 0;
  let timeToUnlock = Infinity;
  let wave = 1;

  for (; wave <= maxWave; wave++) {
    const profile = waveProfile(wave, risk);
    contractWave = wave;
    // Coverage is worth more against a crowd than against a straggler, so the
    // loadout has to know which wave it is standing in before anything prices
    // a purchase.
    loadout.wave = wave;
    const beforeBuy = gold;
    gold = buyGreedily(loadout, gold, profile.avgArmor, profile.avgMagicResist, buyable);
    const goldSpent = Math.max(0, beforeBuy - gold);

    const waveDps = dps(loadout, profile.avgArmor, profile.avgMagicResist);
    // A wave cannot finish faster than its enemies spawn.
    const killSec = profile.totalHp / waveDps;
    const activeSec = Math.max(killSec, profile.spawnDuration);
    // Plan §7.6: the intermission shortens with depth, and §7.1 lets an active
    // player skip what is left of it. Neither moves the wall — the wall
    // condition is `activeSec` against the enrage threshold, and the
    // intermission is not part of either — but both shorten a run.
    const intermission = pacing ? intermissionSecondsForWave(wave) : 5;
    const clearSec = activeSec + (pacing && loadout.active ? 0 : intermission);

    // Plan §2.3.3: a wave that overruns starts enraging, and the tower dies a
    // short way into that. This — not an arbitrary patience limit — is the
    // wall, and it is why runs now end instead of stalling forever.
    if (activeSec > enrageThresholdSeconds(wave) + enrageSurvival) break;

    // Plan §4.1: orbs are a gold faucet, and a faucet the model cannot see is
    // a faucet nobody is balancing. Idle collects 40% of it by drifting home;
    // clicking collects all of it; Lodestone raises the idle rate to 100%.
    const orbRate = loadout.blessings.orbMagnet ? 1 : loadout.orbRate;
    // Plan §7.1/§7.2: two more gold faucets the model has to see, or the drift
    // table below is measuring a game without them.
    //
    // Momentum is credited at its **cap** for an active run: perfect play calls
    // every wave early and never takes a hit, which is the strongest reading
    // and therefore the right one for a gate whose question is "is active play
    // too strong?". An idle run never calls a wave and gets none of it.
    const momentum = pacing && loadout.active ? 1 + MOMENTUM_CAP : 1;
    const combo = pacing ? comboGoldMult(profile.count, activeSec) : 1;
    // Kill gold carries the double-gold roll and `critGold` (revamp §13.4);
    // orbs are not kills, so they ride the plain multiplier; `goldOnKill` and
    // `waveGold` are flat and no multiplier touches them.
    const earned = (
      profile.baseGold * killGoldMultiplier(loadout)
      + orbGoldForWave(wave) * orbRate * goldMultiplier(loadout)
      + flatGoldForWave(wave, loadout)
    ) * momentum * combo;
    gold += earned;
    totalGold += earned;
    // Plan §5.2: contracts pay in gold sized off a wave's income, so they are a
    // faucet in exactly the way orbs are — and one the model has to see, or the
    // wall-wave table below is measuring a game without them.
    if (contracts) {
      const paid = runContractsForWave(contractMgr, wave, loadout, {
        goldSpent,
        clearSec: activeSec,
        killMix: typeMix(wave),
      });
      gold += paid;
      contractGold += paid;
      totalGold += paid;
    }
    elapsed += clearSec;
    if (wave >= unlockWave && !Number.isFinite(timeToUnlock)) timeToUnlock = elapsed;

    // The wave is cleared: advance the greed clock and take a draft if one is
    // due. A player takes the best of the three they are shown, so the model
    // does too — `draftAppeal` is only the ordering, never the effect.
    if (blessings) {
      blessingMgr.noteWaveCleared();
      if (blessingMgr.isDraftDue(wave)) {
        // The core is passed through, so `corePreference` (plan §6.2) is
        // exercised by the same manager the game uses rather than being a
        // weighting nothing measures.
        const offer = blessingMgr.openDraft(wave, core, rng);
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

    // Revamp §6.3: run income growth per wave is the number that decides
    // whether purchases stay decisions, so it is measured across the whole run
    // rather than sampled — geometrically, since it is a growth rate.
    if (earned > 0) {
      if (lastEarned > 0) {
        growthSum += Math.log(earned / lastEarned);
        growthSteps += 1;
      }
      lastEarned = earned;
    }

    if (sampleWaves.includes(wave)) {
      const budget = enrageThresholdSeconds(wave) + enrageSurvival;
      const normalHp = enemyHPForWave(ENEMY_DEFS.normal.baseHP, wave) * riskHpMult(risk);
      const best = bestPurchase(loadout, profile.avgArmor, profile.avgMagicResist, buyable);
      const levels: Record<string, number> = {};
      const wavesOfIncome: Record<string, number> = {};
      const income = earned;
      for (const id of REPORT_LINES) {
        levels[id] = loadout.levels[id] ?? 0;
        const cost = UPGRADE_BY_ID[id] ? costOf(loadout, id) : Infinity;
        wavesOfIncome[id] = income > 0 ? cost / income : Infinity;
      }
      samples.set(wave, {
        wave,
        avgEnemyHp: profile.totalHp / profile.count,
        totalHp: profile.totalHp,
        goldEarned: earned,
        goldPerHp: earned / profile.totalHp,
        clearSec,
        elapsedSec: elapsed,
        dps: waveDps,
        fireRate: effectiveFireRate(loadout),
        boss: isBossWave(wave),
        budgetUse: budget > 0 ? activeSec / budget : Infinity,
        shotsToKillNormal: shotsToKill(
          loadout, normalHp, ENEMY_DEFS.normal.armor, ENEMY_DEFS.normal.magicResist,
        ),
        shotsToKillAverage: shotsToKill(
          loadout, profile.totalHp / profile.count, profile.avgArmor, profile.avgMagicResist,
        ),
        targetsPerShot: effectiveTargets(loadout),
        payload: volleyPayload(loadout),
        levels,
        wavesOfIncome,
        bestPurchaseId: best.id,
        bestPurchaseDpsDelta: best.dpsDelta,
      });
    }
  }

  return {
    core,
    risk,
    wallWave: wave - 1,
    durationSec: elapsed,
    timeToUnlockSec: timeToUnlock,
    samples,
    blessings: loadout.blessings,
    blessingPicks: blessingMgr.picks,
    blessingHeld: blessingMgr.heldIds,
    contractsCompleted: contractMgr.completed,
    contractApBonus: contractMgr.apBonusPct,
    contractGoldShare: totalGold > 0 ? contractGold / totalGold : 0,
    incomeGrowth: growthSteps > 0 ? Math.exp(growthSum / growthSteps) : 1,
  };
}
