import { BALANCE } from '../content/balance';
import { EVOLUTION_BY_ID, EVOLUTION_OF } from '../content/evolutions';
import { FUSION_BY_ID } from '../content/fusions';
import { ENEMY_BY_ID } from '../content/enemies';
import { PASSIVE_BY_ID } from '../content/passives';
import { WEAPON_BY_ID } from '../content/weapons';
import type { EnemyId, EvolutionId, PassiveId, WeaponId } from '../content/types';
import type { Card, RunState, TowerStats, WeaponState } from './state';
import { allMods, resolveStats } from './stats';
import { armed, evolveAt, slotsUsed } from './systems/arms';
import { landedShare } from './systems/damage';
import { localWave, runRegion, waveDamage, waveHp } from './systems/waves';

/**
 * The draft scorer (§4.5, §13). One scorer powers both the card the game
 * highlights (and takes when the timer runs out) and the bot in `tools/`, so
 * a better bot is better idle play.
 *
 * Every card is valued as a fraction of the build's current strength:
 *
 *   offence   its DPS gain, from the same armed numbers the sim fires
 *   defence   its survival gain, weighted by how much danger the tower is in
 *   counters  a new weapon that answers what walks in this region (§4.3),
 *             less what blunts it there
 *   recipes   a step toward a *known* evolution: its partner, or its last
 *             levels. Unknown recipes are found by chance, as a player would
 *   slots     a new weapon in an empty slot is a second line of fire
 *
 * The weights are rough on purpose; the pacing report and the I4 check
 * (`tests/arsenal.test.ts`) keep them honest.
 */

/*
 * The damage constants below are fitted to the sim (T2: `npm run calibrate`
 * measures each weapon on a frontier-like crowd and fails past 25% drift).
 */
/** How much of a cone's pellets land, on average; and a Dragonbreath burn's worth, as a share of its full burn. */
const CONE_HIT_RATE = 0.95;
/** The share of a cone's pellets that land point-blank (S5): it fires at the nearest body. */
const CONE_CLOSE_SHARE = 0.6;
const DRAGON_BURN_SHARE = 0.02;
/** Each leap of a chain is this much likelier to find no one than the last: fields are thin. */
const CHAIN_FADE = 0.55;
/** A homing bolt's pierce finds another body this often. */
const HOMING_PIERCE_VALUE = 0.9;
/** Bodies a pulse catches, on average, per 100 units of radius; and what its slow is worth. */
const PULSE_BODIES_PER_100 = 1;
const SLOW_VALUE = 1;
/** Bodies a shell's blast catches, beyond the one it is aimed at, per unit of radius; and a bomblet's share of a body. */
const LOB_BODIES_PER_UNIT = 1 / 60;
const BOMBLET_HIT_RATE = 0.2;
/** Bodies in the blades' band at once, per unit of blade width, beyond the first; and what Halo's sweep adds. */
const ORBIT_BODIES_PER_UNIT = 1 / 20;
const HALO_VALUE = 0.88;
/** Seconds a beam holds one target, on average: how hot it runs. */
const BEAM_HOLD = 3;
/** A beam that burns through its line catches this many more; Judgment's forks, per split. */
const BEAM_PIERCE_VALUE = 0.1;
const JUDGMENT_SPLIT_VALUE = 0.07;
/** Hive's drones, called by kills: what they add to the swarm's damage. */
const HIVE_VALUE = 1.9;
/** What a freeze and its shatter are worth over a slow (Absolute Zero). */
const FREEZE_VALUE = 0.6;
/** Value of +XP, of a shard windfall and of +shards, in "fraction of build" units. */
const XP_VALUE = 0.4;
const SHARD_VALUE = 0.01;
const GREED_VALUE = 0.15;
/** Projectile speed lands more of what misses; a little. */
const SPEED_VALUE = 0.1;
/** Bodies the first crescent of a throw cuts on each of its two passes, and each further one. */
const CRESCENT_BODIES = 2.2;
const CRESCENT_EXTRA = 0.8;
/** A rune that bursts on one body catches this many more per unit of radius; and how many laid runes burst before they fade. */
const RUNE_BODIES_PER_UNIT = 1 / 45;
const RUNE_TRIP_RATE = 0.8;
/**
 * Bodies in a slug's line, on average, and more per unit of its width: it
 * aims down the most crowded line (U14). A second slug finds this share fresh.
 */
const RAIL_BODIES = 1.45;
const RAIL_BODIES_PER_UNIT = 1 / 9;
const RAIL_EXTRA_SLUG = 0.37;
/** Midas Lance's mark: the share of its vulnerability that lands before the gilded body falls. */
const MIDAS_VALUE = 0.16;
/** Waves a typical run lasts, overtime included: how long a passive that grows with the waves has to grow. */
const RUN_WAVES = 24;
/** What a weapon lands on a body it is weak against, as a share of its hit. */
const WEAK_LANDED = 0.25;
/** A new weapon that answers the region, per share of its enemy pool it counters. */
const COUNTER_VALUE = 0.35;
/** A new weapon into an empty slot: another line of fire, worth this much beyond its DPS. */
const SLOT_VALUE = 0.15;
/** A step toward an evolution, scaled by how close the weapon is to evolving. */
const RECIPE_VALUE = 0.6;
/** An evolution on offer: its spike, and this much for the new pattern. */
const EVOLUTION_VALUE = 1;

/**
 * What a hit meets this wave (S2): each type in the region's pool by now,
 * its armour, and its weight as a share of the wave's HP. Armour lives on
 * the big bodies, so it is weighted by where the HP is, not by head count.
 */
export type Foes = readonly { readonly enemy: EnemyId; readonly armor: number; readonly share: number }[];

export function foesOf(run: RunState): Foes {
  const region = runRegion(run);
  const wave = Math.max(1, run.wave);
  const hp = waveHp(region, wave);
  const live = region.pool.filter((p) => p.from <= Math.max(1, localWave(region, wave)));
  const total = live.reduce((a, p) => a + p.weight * ENEMY_BY_ID[p.enemy].hp, 0) || 1;
  return live.map((p) => ({ enemy: p.enemy, armor: hp * ENEMY_BY_ID[p.enemy].armor, share: (p.weight * ENEMY_BY_ID[p.enemy].hp) / total }));
}

/**
 * The share of a hit of `raw` from weapon `id` that lands on `foes`: through
 * their armour, and only `WEAK_LANDED` of it on a type the weapon is weak
 * against (a shield turns a shot from the front). All of it with no foes.
 */
export function landedOn(foes: Foes | undefined, raw: number, id?: WeaponId): number {
  if (!foes) return 1;
  const weak = id ? WEAPON_BY_ID[id].weakAgainst ?? [] : [];
  let out = 0;
  for (const f of foes) out += f.share * landedShare(raw, f.armor) * (weak.includes(f.enemy) ? WEAK_LANDED : 1);
  return out;
}

/**
 * Rough sustained value of one weapon, in DPS: its damage (`damageDps`)
 * times what its control is worth (`utility`). An estimate, not the sim.
 * With `foes`, what lands through their armour (S2): a weapon of small hits
 * is worth less where the bodies are plated.
 */
export function weaponDps(w: Pick<WeaponState, 'id' | 'level' | 'evolved'>, stats: TowerStats, foes?: Foes): number {
  return damageDps(w, stats, foes) * utility(w, stats);
}

/** How hot a beam runs on average over its hold. */
function beamHeat(p: { rampCap: number; ramp: number }): number {
  return (1 + Math.min(p.rampCap, 1 + p.ramp * BEAM_HOLD)) / 2;
}

/**
 * What a weapon's control is worth on top of its damage, as a multiplier:
 * knockback, stuns, slows and freezes, and the parts of an evolution that
 * pay off in kills or at the wall rather than in damage (Hive's drones,
 * Bulwark Runes, Lifebloom's mending).
 */
export function utility(w: Pick<WeaponState, 'id' | 'level' | 'evolved'>, stats: TowerStats): number {
  const p = armed(stats, w);
  const pattern = WEAPON_BY_ID[w.id].pattern;
  switch (pattern) {
    case 'cone':
      return 1 + p.knockback / 100;
    case 'chain':
      return 1 + p.stun * 2;
    case 'pulse':
      return (1 + p.slow * SLOW_VALUE) * (w.evolved ? 1 + FREEZE_VALUE : 1);
    case 'mine':
      return (1 + p.stun) * (w.evolved ? 1.4 : 1);
    case 'tether':
      return w.evolved ? 1.3 : 1;
    case 'homing':
    case 'drone':
    case 'lob':
    case 'beam':
    case 'orbit':
    case 'boomerang':
    case 'rail':
      return 1;
    default: {
      const exhaustive: never = pattern;
      return exhaustive;
    }
  }
}

/**
 * The damage one weapon lands per second, on average, over a mid-wave crowd
 * (T2: `npm run calibrate` checks it against the sim's own tally). With
 * `foes`, through their armour.
 */
export function damageDps(w: Pick<WeaponState, 'id' | 'level' | 'evolved'>, stats: TowerStats, foes?: Foes): number {
  const p = armed(stats, w);
  const E = BALANCE.evolutions;
  const crit = 1 + stats.critChance * (stats.critMult - 1);
  const perAttack = p.damage * stats.damageMult * crit;
  const rate = p.fireRate * stats.fireRateMult;
  const pattern = WEAPON_BY_ID[w.id].pattern;
  // A beam's hits grow with its heat: the armour meets the hot hit.
  const landed = landedOn(foes, pattern === 'beam' ? perAttack * beamHeat(p) : perAttack, w.id);
  return landed * rawDamage();

  function rawDamage(): number {
    switch (pattern) {
      case 'homing': {
        const seekers = w.evolved ? 1 + stats.critChance * E['seeker-swarm'].seekers * E['seeker-swarm'].seekerDamage : 1;
        return perAttack * rate * p.count * (1 + HOMING_PIERCE_VALUE * p.pierce) * seekers;
      }
      case 'cone': {
        const D = E.dragonbreath;
        const burn = w.evolved ? 1 + D.burn * D.burnSeconds * stats.durationMult * DRAGON_BURN_SHARE : 1;
        const close = WEAPON_BY_ID[w.id].pointBlank ?? 1;
        return perAttack * rate * p.count * CONE_HIT_RATE * (1 + CONE_CLOSE_SHARE * (close - 1)) * (1 + 0.5 * p.pierce) * burn;
      }
      case 'chain': {
        const storms = w.evolved ? 1 + E['storm-crown'].storms * 0.6 : 1;
        // 1 + f + f² + …: each leap is likelier to find no one.
        const bodies = (1 - Math.pow(CHAIN_FADE, p.jumps)) / (1 - CHAIN_FADE);
        return perAttack * rate * bodies * storms;
      }
      case 'pulse':
        return perAttack * rate * (p.radius / 100) * PULSE_BODIES_PER_100;
      case 'lob': {
        const bodies = 1 + p.radius * LOB_BODIES_PER_UNIT;
        const bomblets = 1 + p.bomblets * BALANCE.weapons.bombletDamage * BOMBLET_HIT_RATE;
        const M = E.meteorfall;
        const meteors = w.evolved ? (perAttack * M.meteor * (1 + M.radius * LOB_BODIES_PER_UNIT)) / M.every : 0;
        return perAttack * rate * p.count * bodies * bomblets + meteors;
      }
      case 'beam': {
        const judgment = w.evolved ? 1 + E.judgment.splits * JUDGMENT_SPLIT_VALUE : 1;
        return perAttack * rate * beamHeat(p) * (p.pierce > 0 ? 1 + BEAM_PIERCE_VALUE : 1) * judgment;
      }
      case 'orbit': {
        const passes = (p.count * p.spin * stats.fireRateMult) / (Math.PI * 2);
        const bodies = 1 + p.blade * ORBIT_BODIES_PER_UNIT;
        // Halo sweeps the whole field instead of the ring at the wall.
        return perAttack * passes * bodies * (w.evolved ? HALO_VALUE : 1);
      }
      case 'drone':
        return perAttack * rate * p.count * (1 + HOMING_PIERCE_VALUE * p.pierce) * (w.evolved ? HIVE_VALUE : 1);
      case 'boomerang': {
        const ring = w.evolved ? 1 + (E['crescent-storm'].ring / Math.max(1, p.count)) * 0.5 : 1;
        return perAttack * rate * 2 * (CRESCENT_BODIES + (p.count - 1) * CRESCENT_EXTRA) * ring;
      }
      case 'mine':
        return perAttack * rate * (1 + p.radius * RUNE_BODIES_PER_UNIT) * RUNE_TRIP_RATE;
      case 'tether':
        return perAttack * rate * p.count;
      case 'rail': {
        const midas = w.evolved ? 1 + E['midas-lance'].vulnerable * MIDAS_VALUE : 1;
        const slugs = 1 + (p.count - 1) * RAIL_EXTRA_SLUG;
        return perAttack * rate * slugs * (RAIL_BODIES + p.radius * RAIL_BODIES_PER_UNIT) * midas;
      }
      default: {
        const exhaustive: never = pattern;
        return exhaustive;
      }
    }
  }
}

export function buildDps(weapons: readonly Pick<WeaponState, 'id' | 'level' | 'evolved'>[], stats: TowerStats, foes?: Foes): number {
  let dps = 0;
  for (const w of weapons) dps += weaponDps(w, stats, foes);
  return dps;
}

/** How much a point of survival is worth now: more as HP drops. */
function danger(run: RunState): number {
  const frac = Math.max(0, run.tower.hp) / run.stats.maxHp;
  return 0.35 + (1 - frac);
}

/**
 * The share of this region's enemy pool a weapon counters (§11.2's "strong
 * against"), less the share that blunts it.
 */
function counterShare(run: RunState, id: WeaponId): number {
  const pool = runRegion(run).pool;
  const { counters, weakAgainst = [] } = WEAPON_BY_ID[id];
  const strong = pool.filter((p) => counters.includes(p.enemy)).length;
  const weak = pool.filter((p) => weakAgainst.includes(p.enemy)).length;
  return (strong - weak) / Math.max(1, pool.length);
}

/** How close a weapon is to evolving, 0–1 by level. */
function readiness(w: Pick<WeaponState, 'signature'>, level: number): number {
  return Math.min(1, level / evolveAt(w));
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
    best = Math.max(best, readiness(w, w.level));
  }
  return best * RECIPE_VALUE;
}

/**
 * How a card fits the build (U4), from the scorer's own terms: a step toward
 * a known recipe (or the one that completes it), a new weapon that answers
 * this region, and a new item into an empty slot.
 */
export type CardBadge =
  | { readonly kind: 'recipe'; readonly evolution: EvolutionId; readonly completes: boolean }
  | { readonly kind: 'counter' }
  | { readonly kind: 'slot'; readonly slot: number; readonly of: number };

export function cardBadges(run: RunState, card: Card): CardBadge[] {
  const out: CardBadge[] = [];
  switch (card.kind) {
    case 'weapon': {
      const owned = run.weapons.find((w) => w.id === card.id);
      const evo = EVOLUTION_OF[card.id];
      if (owned && !owned.evolved && knows(run, card.id) && run.passives.some((p) => p.id === evo.passive)) {
        out.push({ kind: 'recipe', evolution: evo.id, completes: card.level >= evolveAt(owned) });
      }
      if (!owned) {
        if (counterShare(run, card.id) > 0) out.push({ kind: 'counter' });
        out.push({ kind: 'slot', slot: slotsUsed(run) + 1, of: run.weaponSlots });
      }
      return out;
    }
    case 'passive': {
      if (card.level === 1) {
        for (const w of run.weapons) {
          const evo = EVOLUTION_OF[w.id];
          if (w.evolved || !knows(run, w.id) || evo.passive !== card.id) continue;
          out.push({ kind: 'recipe', evolution: evo.id, completes: w.level >= evolveAt(w) });
          break;
        }
        out.push({ kind: 'slot', slot: run.passives.length + 1, of: run.passiveSlots });
      }
      return out;
    }
    case 'evolution':
    case 'fusion':
    case 'fallback':
      return out;
    default: {
      const exhaustive: never = card;
      return exhaustive;
    }
  }
}

function evolved(weapons: readonly WeaponState[], id: WeaponId): WeaponState[] {
  return weapons.map((w) => (w.id === id ? { ...w, evolved: true } : w));
}

export function scoreCard(run: RunState, card: Card): number {
  const foes = foesOf(run);
  const before = Math.max(1e-9, buildDps(run.weapons, run.stats, foes));
  switch (card.kind) {
    case 'weapon': {
      const owned = run.weapons.find((w) => w.id === card.id);
      const next = { id: card.id, level: card.level, evolved: owned?.evolved ?? false, signature: owned?.signature } as WeaponState;
      const weapons = run.weapons.filter((w) => w.id !== card.id).concat(next);
      let score = buildDps(weapons, run.stats, foes) / before - 1;
      if (!owned) {
        score += counterShare(run, card.id) * COUNTER_VALUE + SLOT_VALUE;
      } else if (!owned.evolved && knows(run, card.id) && run.passives.some((p) => p.id === EVOLUTION_OF[card.id].passive)) {
        // Each level toward an evolution whose partner is already owned.
        score += RECIPE_VALUE * (readiness(owned, card.level) - readiness(owned, owned.level));
      }
      return score;
    }
    case 'passive': {
      // A passive that grows with the waves (Greed, S5) is worth what it will
      // be on average over the rest of a typical run (D-11).
      const owned = run.passives.find((p) => p.id === card.id);
      const ahead = PASSIVE_BY_ID[card.id].perWave ? Math.max(0, RUN_WAVES - run.wave) / 2 : 0;
      const passives = run.passives.filter((p) => p.id !== card.id).concat({ id: card.id, level: card.level, waves: (owned?.waves ?? 0) + ahead });
      const stats = resolveStats(allMods(run.mods, passives));
      const offence = buildDps(run.weapons, stats, foes) / before - 1;
      const hp = stats.maxHp / run.stats.maxHp - 1;
      // Ten seconds of regen, as a fraction of Max HP.
      const sustain = ((stats.regen / stats.maxHp) - (run.stats.regen / run.stats.maxHp)) * 10;
      // Armour as a share of a typical contact hit this wave.
      const hit = Math.max(1, waveDamage(runRegion(run), Math.max(1, run.wave)));
      const armor = Math.min(1, (stats.armor - run.stats.armor) / hit);
      const xp = (stats.xpMult / run.stats.xpMult - 1) * XP_VALUE;
      const shards = (stats.shardMult / run.stats.shardMult - 1) * GREED_VALUE;
      const speed = (stats.projectileSpeedMult / run.stats.projectileSpeedMult - 1) * SPEED_VALUE;
      const recipe = card.level === 1 ? recipeBonus(run, card.id) : 0;
      return offence + (hp + sustain + armor) * danger(run) + xp + shards + speed + recipe;
    }
    case 'evolution': {
      const id = EVOLUTION_BY_ID[card.id].weapon;
      return buildDps(evolved(run.weapons, id), run.stats, foes) / before - 1 + EVOLUTION_VALUE;
    }
    case 'fusion': {
      // A fusion (N9): both halves' spike, a slot freed, and its own step past evolution.
      const pair: readonly WeaponId[] = FUSION_BY_ID[card.id].weapons;
      const weapons = run.weapons.map((w) => (pair.includes(w.id) ? { ...w, fusion: card.id } : w));
      return buildDps(weapons, run.stats, foes) / before - 1 + EVOLUTION_VALUE + SLOT_VALUE;
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
 * Where a card stands on the Tactician's list (§6.2): a fusion or an
 * evolution ahead of everything (it is its weapons' best step), then the
 * listed items in order. Infinity for an unlisted card, which the scorer
 * ranks below the list.
 */
function rank(priority: readonly string[], card: Card): number {
  if (card.kind === 'evolution' || card.kind === 'fusion') return -1;
  if (card.kind === 'fallback') return Infinity;
  const i = priority.indexOf(card.id);
  return i < 0 ? Infinity : i;
}

/**
 * Index of the card to suggest: with a Tactician list, the best-ranked card
 * on it; otherwise, or when nothing on offer is listed, the scorer's best,
 * the first on a tie. A card on the Never list (U7) is suggested only when
 * nothing else is offered.
 */
export function suggest(run: RunState, cards: readonly Card[]): number {
  const never = run.never;
  const ruledOut = (c: Card): boolean => !!never && (c.kind === 'weapon' || c.kind === 'passive') && never.includes(c.id);
  const open = cards.some((c) => !ruledOut(c)) ? (c: Card): boolean => !ruledOut(c) : (): boolean => true;
  const priority = run.priority;
  if (priority) {
    let top = -1;
    let topRank = Infinity;
    cards.forEach((c, i) => {
      if (!open(c)) return;
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
    if (!open(c)) return;
    const s = scoreCard(run, c);
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  });
  return best;
}
