import { BALANCE } from '../content/balance';
import { EVOLUTION_BY_ID, EVOLUTION_OF } from '../content/evolutions';
import { regionByIndex } from '../content/regions';
import { WEAPON_BY_ID } from '../content/weapons';
import type { PassiveId, WeaponId } from '../content/types';
import type { Card, RunState, TowerStats, WeaponState } from './state';
import { allMods, resolveStats } from './stats';
import { armed, evolveAt } from './systems/arms';
import { waveDamage } from './systems/waves';

/**
 * The draft scorer (§4.5, §13). One scorer powers both the card the game
 * highlights (and takes when the timer runs out) and the bot in `tools/`, so
 * a better bot is better idle play.
 *
 * Every card is valued as a fraction of the build's current strength:
 *
 *   offence   its DPS gain, from the same armed numbers the sim fires
 *   defence   its survival gain, weighted by how much danger the tower is in
 *   counters  a new weapon that answers what walks in this region (§4.3)
 *   recipes   a step toward a *known* evolution: its partner, or its last
 *             levels. Unknown recipes are found by chance, as a player would
 *   slots     a new weapon in an empty slot is a second line of fire
 *
 * The weights are rough on purpose; the pacing report and the I4 check
 * (`tests/arsenal.test.ts`) keep them honest.
 */

/** How much of a cone's pellets land, on average, and how much a leap is worth. */
const CONE_HIT_RATE = 0.55;
const CHAIN_LEAP_VALUE = 0.7;
/** Bodies a pulse catches, on average, per 100 units of radius; and what its slow is worth. */
const PULSE_BODIES_PER_100 = 1.4;
const SLOW_VALUE = 1;
/** Bodies a shell's blast catches, beyond the one it is aimed at, per unit of radius. */
const LOB_BODIES_PER_UNIT = 1 / 40;
/** Bodies in the blades' band at once, per unit of blade width, beyond the first. */
const ORBIT_BODIES_PER_UNIT = 1 / 14;
/** Seconds a beam holds one target, on average: how hot it runs. */
const BEAM_HOLD = 3;
/** A beam that burns through its line catches this many more. */
const BEAM_PIERCE_VALUE = 0.8;
/** What a freeze and its shatter are worth over a slow (Absolute Zero). */
const FREEZE_VALUE = 0.6;
/** Value of +XP, of a shard windfall and of +shards, in "fraction of build" units. */
const XP_VALUE = 0.4;
const SHARD_VALUE = 0.01;
const GREED_VALUE = 0.15;
/** Projectile speed lands more of what misses; a little. */
const SPEED_VALUE = 0.1;
/** A new weapon that answers the region, per share of its enemy pool it counters. */
const COUNTER_VALUE = 0.35;
/** A new weapon into an empty slot: another line of fire, worth this much beyond its DPS. */
const SLOT_VALUE = 0.15;
/** A step toward an evolution, scaled by how close the weapon is to evolving. */
const RECIPE_VALUE = 0.6;
/** An evolution on offer: its spike, and this much for the new pattern. */
const EVOLUTION_VALUE = 1;

/** Rough sustained DPS of one weapon: an estimate, not the sim. */
export function weaponDps(w: Pick<WeaponState, 'id' | 'level' | 'evolved'>, stats: TowerStats): number {
  const p = armed(stats, w);
  const E = BALANCE.evolutions;
  const crit = 1 + stats.critChance * (stats.critMult - 1);
  const perAttack = p.damage * stats.damageMult * crit;
  const rate = p.fireRate * stats.fireRateMult;
  const pattern = WEAPON_BY_ID[w.id].pattern;
  switch (pattern) {
    case 'homing': {
      const seekers = w.evolved ? 1 + stats.critChance * E['seeker-swarm'].seekers * E['seeker-swarm'].seekerDamage : 1;
      return perAttack * rate * p.count * (1 + 0.5 * p.pierce) * seekers;
    }
    case 'cone': {
      const D = E.dragonbreath;
      const burn = w.evolved ? 1 + D.burn * D.burnSeconds * stats.durationMult * 0.5 : 1;
      return perAttack * rate * p.count * CONE_HIT_RATE * (1 + p.knockback / 100) * (1 + 0.5 * p.pierce) * burn;
    }
    case 'chain': {
      const storms = w.evolved ? 1 + E['storm-crown'].storms * 0.6 : 1;
      return perAttack * rate * (1 + (p.jumps - 1) * CHAIN_LEAP_VALUE) * (1 + p.stun * 2) * storms;
    }
    case 'pulse': {
      const freeze = w.evolved ? 1 + FREEZE_VALUE : 1;
      return perAttack * rate * (p.radius / 100) * PULSE_BODIES_PER_100 * (1 + p.slow * SLOW_VALUE) * freeze;
    }
    case 'lob': {
      const bodies = 1 + p.radius * LOB_BODIES_PER_UNIT;
      const W = BALANCE.weapons;
      const bomblets = 1 + p.bomblets * W.bombletDamage * 0.5;
      const M = E.meteorfall;
      const meteors = w.evolved ? (perAttack * M.meteor * (1 + M.radius * LOB_BODIES_PER_UNIT)) / M.every : 0;
      return perAttack * rate * p.count * bodies * bomblets + meteors;
    }
    case 'beam': {
      const heat = (1 + Math.min(p.rampCap, 1 + p.ramp * BEAM_HOLD)) / 2;
      const judgment = w.evolved ? 1 + E.judgment.splits * 0.5 : 1;
      return perAttack * rate * heat * (p.pierce > 0 ? 1 + BEAM_PIERCE_VALUE : 1) * judgment;
    }
    case 'orbit': {
      const passes = (p.count * p.spin * stats.fireRateMult) / (Math.PI * 2);
      const bodies = 1 + p.blade * ORBIT_BODIES_PER_UNIT;
      // Halo sweeps the whole field instead of the ring at the wall.
      return perAttack * passes * bodies * (w.evolved ? 2 : 1);
    }
    case 'drone': {
      const hive = w.evolved ? 1.4 : 1;
      return perAttack * rate * p.count * (1 + 0.5 * p.pierce) * hive;
    }
    default: {
      const exhaustive: never = pattern;
      return exhaustive;
    }
  }
}

export function buildDps(weapons: readonly Pick<WeaponState, 'id' | 'level' | 'evolved'>[], stats: TowerStats): number {
  let dps = 0;
  for (const w of weapons) dps += weaponDps(w, stats);
  return dps;
}

/** How much a point of survival is worth now: more as HP drops. */
function danger(run: RunState): number {
  const frac = Math.max(0, run.tower.hp) / run.stats.maxHp;
  return 0.35 + (1 - frac);
}

/** The share of this region's enemy pool a weapon counters (§11.2's "strong against"). */
function counterShare(run: RunState, id: WeaponId): number {
  const pool = regionByIndex(run.regionId).pool;
  const counters = WEAPON_BY_ID[id].counters;
  return pool.filter((p) => counters.includes(p.enemy)).length / Math.max(1, pool.length);
}

/** How close a weapon is to evolving, 0–1 by level. */
function readiness(run: RunState, level: number): number {
  return Math.min(1, level / evolveAt((run.behaviours.specialist ?? 0) > 0));
}

/** True when the profile has found this weapon's recipe, so the suggestion may steer for it. */
function knows(run: RunState, id: WeaponId): boolean {
  return run.recipes.includes(EVOLUTION_OF[id].id);
}

/** A passive that completes a carried weapon's known recipe is worth more the closer that weapon is. */
function recipeBonus(run: RunState, passive: PassiveId): number {
  let best = 0;
  for (const w of run.weapons) {
    if (w.evolved || !knows(run, w.id) || EVOLUTION_OF[w.id].passive !== passive) continue;
    best = Math.max(best, readiness(run, w.level));
  }
  return best * RECIPE_VALUE;
}

function evolved(weapons: readonly WeaponState[], id: WeaponId): WeaponState[] {
  return weapons.map((w) => (w.id === id ? { ...w, evolved: true } : w));
}

export function scoreCard(run: RunState, card: Card): number {
  const before = Math.max(1e-9, buildDps(run.weapons, run.stats));
  switch (card.kind) {
    case 'weapon': {
      const owned = run.weapons.find((w) => w.id === card.id);
      const next = { id: card.id, level: card.level, evolved: owned?.evolved ?? false } as WeaponState;
      const weapons = run.weapons.filter((w) => w.id !== card.id).concat(next);
      let score = buildDps(weapons, run.stats) / before - 1;
      if (!owned) {
        score += counterShare(run, card.id) * COUNTER_VALUE + SLOT_VALUE;
      } else if (!owned.evolved && knows(run, card.id) && run.passives.some((p) => p.id === EVOLUTION_OF[card.id].passive)) {
        // Each level toward an evolution whose partner is already owned.
        score += RECIPE_VALUE * (readiness(run, card.level) - readiness(run, owned.level));
      }
      return score;
    }
    case 'passive': {
      const passives = run.passives.filter((p) => p.id !== card.id).concat({ id: card.id, level: card.level });
      const stats = resolveStats(allMods(run.mods, passives));
      const offence = buildDps(run.weapons, stats) / before - 1;
      const hp = stats.maxHp / run.stats.maxHp - 1;
      // Ten seconds of regen, as a fraction of Max HP.
      const sustain = ((stats.regen / stats.maxHp) - (run.stats.regen / run.stats.maxHp)) * 10;
      // Armour as a share of a typical contact hit this wave.
      const hit = Math.max(1, waveDamage(regionByIndex(run.regionId), Math.max(1, run.wave)));
      const armor = Math.min(1, (stats.armor - run.stats.armor) / hit);
      const xp = (stats.xpMult / run.stats.xpMult - 1) * XP_VALUE;
      const shards = (stats.shardMult / run.stats.shardMult - 1) * GREED_VALUE;
      const speed = (stats.projectileSpeedMult / run.stats.projectileSpeedMult - 1) * SPEED_VALUE;
      const recipe = card.level === 1 ? recipeBonus(run, card.id) : 0;
      return offence + (hp + sustain + armor) * danger(run) + xp + shards + speed + recipe;
    }
    case 'evolution': {
      const id = EVOLUTION_BY_ID[card.id].weapon;
      return buildDps(evolved(run.weapons, id), run.stats) / before - 1 + EVOLUTION_VALUE;
    }
    case 'fallback': {
      const id = card.id;
      switch (id) {
        case 'heal': {
          const missing = 1 - Math.max(0, run.tower.hp) / run.stats.maxHp;
          return Math.min(missing, BALANCE.draft.healFraction) * danger(run);
        }
        case 'shards':
          return SHARD_VALUE;
        default: {
          const exhaustive: never = id;
          return exhaustive;
        }
      }
    }
    default: {
      const exhaustive: never = card;
      return exhaustive;
    }
  }
}

/**
 * Where a card stands on the Tactician's list (§6.2): an evolution ahead of
 * everything (it is its weapon's best step), then the listed items in order.
 * Infinity for an unlisted card, which the scorer ranks below the list.
 */
function rank(priority: readonly string[], card: Card): number {
  if (card.kind === 'evolution') return -1;
  if (card.kind === 'fallback') return Infinity;
  const i = priority.indexOf(card.id);
  return i < 0 ? Infinity : i;
}

/**
 * Index of the card to suggest: with a Tactician list, the best-ranked card
 * on it; otherwise, or when nothing on offer is listed, the scorer's best,
 * the first on a tie.
 */
export function suggest(run: RunState, cards: readonly Card[]): number {
  const priority = run.priority;
  if (priority) {
    let top = -1;
    let topRank = Infinity;
    cards.forEach((c, i) => {
      const r = rank(priority, c);
      if (r < topRank) {
        topRank = r;
        top = i;
      }
    });
    if (top >= 0) return top;
  }
  let best = 0;
  let bestScore = -Infinity;
  cards.forEach((c, i) => {
    const s = scoreCard(run, c);
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  });
  return best;
}
