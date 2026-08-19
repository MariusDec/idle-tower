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
import { ENEMY_DEFS } from '../src/data/enemies.ts';
import { UPGRADES } from '../src/data/upgrades.ts';
import { TOWER_BASE } from '../src/data/tower.ts';
import { computeUpgradeValue } from '../src/types.ts';
import type { EnemyType, UpgradeDef } from '../src/types.ts';
import { WAVE_INTERMISSION } from '../src/systems/WaveManager.ts';

/** Fraction of wall-clock time the tower actually spends shooting a live target. */
const ENGAGEMENT_EFFICIENCY = 0.85;

/** Upgrades the greedy buyer is allowed to spend on (the offence/economy core). */
const BUYABLE = ['damage', 'fireRate', 'critChance', 'critDamage', 'goldMulti'] as const;
type BuyableId = (typeof BUYABLE)[number];

const UPGRADE_BY_ID: Record<string, UpgradeDef> = Object.fromEntries(
  UPGRADES.map(u => [u.id, u]),
);

/** Enemy-type spawn weights, mirroring `WaveManager.pickEnemyType`. */
function typeMix(wave: number): Array<{ type: EnemyType; weight: number }> {
  if (isBossWave(wave)) return [{ type: 'boss', weight: 1 }];
  const entries: Array<{ type: EnemyType; weight: number }> = [{ type: 'normal', weight: 6 }];
  if (wave >= 3) entries.push({ type: 'fast', weight: 3 });
  if (wave >= 5) entries.push({ type: 'tank', weight: 2 });
  if (wave >= 8) entries.push({ type: 'flying', weight: 2 });
  if (wave >= 12) entries.push({ type: 'splitter', weight: 2 });
  if (wave >= 15) entries.push({ type: 'healer', weight: 1 });
  if (wave >= 20) entries.push({ type: 'shielded', weight: 1 });
  return entries;
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
  for (const { type, weight } of mix) {
    const def = ENEMY_DEFS[type];
    const share = weight / weightSum;
    const hp = type === 'boss' ? bossHPForWave(def.baseHP, wave) : enemyHPForWave(def.baseHP, wave);
    // Splitters leave two half-HP children behind, so they cost 2x their bar.
    const hpFactor = type === 'splitter' ? 2 : 1;
    // Shielded enemies eat 3 hits outright; approximated as +30% effective HP.
    const shieldFactor = type === 'shielded' ? 1.3 : 1;
    hpPer += share * hp * hpFactor * shieldFactor;
    armorPer += share * def.armor;
    goldPer += share * goldDropForWave(def.baseGold, wave);
  }

  return {
    count,
    totalHp: hpPer * count,
    avgArmor: armorPer,
    baseGold: goldPer * count,
    spawnDuration: spawnIntervalForWave(wave) * (count - 1),
  };
}

export interface Loadout {
  levels: Record<string, number>;
  /** Permanent damage multiplier from prestige (lifetime AP + TP). */
  damageMult: number;
  /** Permanent gold multiplier from prestige. */
  goldMult: number;
}

export function freshLoadout(damageMult = 1, goldMult = 1): Loadout {
  const levels: Record<string, number> = {};
  for (const u of UPGRADES) levels[u.id] = u.startLevel ?? 0;
  return { levels, damageMult, goldMult };
}

function levelValue(id: string, level: number): number {
  const def = UPGRADE_BY_ID[id];
  if (!def || level <= 0) return 0;
  return computeUpgradeValue(def, level);
}

/** Damage of a single shot, before enemy armor. */
export function hitDamage(l: Loadout): number {
  const base = (TOWER_BASE.baseDamage + levelValue('damage', l.levels.damage)) * l.damageMult;
  const crit = Math.min(1, TOWER_BASE.critChance + levelValue('critChance', l.levels.critChance));
  const critMult = TOWER_BASE.critMultiplier + levelValue('critDamage', l.levels.critDamage);
  return Math.max(1, base) * (1 + crit * (critMult - 1));
}

export function fireRate(l: Loadout): number {
  return TOWER_BASE.fireRate + levelValue('fireRate', l.levels.fireRate);
}

/** Sustained DPS against an enemy with the given armor. */
export function dps(l: Loadout, armor: number): number {
  const perHit = Math.max(1, hitDamage(l) - armor);
  return perHit * fireRate(l) * ENGAGEMENT_EFFICIENCY;
}

export function goldMultiplier(l: Loadout): number {
  return (1 + levelValue('goldMulti', l.levels.goldMulti)) * l.goldMult;
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
}

export function simulateRun(opts: RunOptions = {}): RunResult {
  const {
    damageMult = 1,
    goldMult = 1,
    unlockWave = 30,
    enrageSurvivalSeconds = ENRAGE_STACK_INTERVAL * 3,
    maxWave = 400,
    sampleWaves = [1, 10, 30, 50, 100],
  } = opts;

  const loadout = freshLoadout(damageMult, goldMult);
  const samples = new Map<number, WaveSample>();
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

    const earned = profile.baseGold * goldMultiplier(loadout);
    gold += earned;
    elapsed += clearSec;
    if (wave >= unlockWave && !Number.isFinite(timeToUnlock)) timeToUnlock = elapsed;

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
      });
    }
  }

  return {
    wallWave: wave - 1,
    durationSec: elapsed,
    timeToUnlockSec: timeToUnlock,
    samples,
  };
}
