import { BALANCE } from '../content/balance';
import { WEAPON_BY_ID, weaponParams } from '../content/weapons';
import type { WeaponId } from '../content/types';
import type { Card, RunState, TowerStats, WeaponState } from './state';
import { allMods, resolveStats } from './stats';

/**
 * The draft scorer (§4.5, §13). One scorer powers both the card the game
 * highlights (and takes when the timer runs out) and the bot in `tools/`, so
 * a better bot is better idle play.
 *
 * Every card is valued as a fraction of the build's current strength: an
 * offensive card by its DPS gain, a defensive one by its survival gain
 * weighted by how much danger the tower is in. The weights are rough on
 * purpose; P5 brings the better scorer.
 */

/** How much of a cone's pellets land, on average, and how much a leap is worth. */
const CONE_HIT_RATE = 0.55;
const CHAIN_LEAP_VALUE = 0.7;
/** Value of +XP, and of a shard windfall, in "fraction of build" units. */
const XP_VALUE = 0.4;
const SHARD_VALUE = 0.01;

/** Rough sustained DPS of one weapon: an estimate, not the sim. */
export function weaponDps(id: WeaponId, level: number, stats: TowerStats): number {
  const p = weaponParams(id, level);
  const crit = 1 + stats.critChance * (stats.critMult - 1);
  const perAttack = p.damage * stats.damageMult * crit;
  const rate = p.fireRate * stats.fireRateMult;
  const pattern = WEAPON_BY_ID[id].pattern;
  switch (pattern) {
    case 'homing':
      return perAttack * rate * p.count * (1 + 0.5 * p.pierce);
    case 'cone':
      return perAttack * rate * p.count * CONE_HIT_RATE * (1 + p.knockback / 100);
    case 'chain':
      return perAttack * rate * (1 + (p.jumps - 1) * CHAIN_LEAP_VALUE) * (1 + p.stun * 2);
    default: {
      const exhaustive: never = pattern;
      return exhaustive;
    }
  }
}

export function buildDps(weapons: readonly Pick<WeaponState, 'id' | 'level'>[], stats: TowerStats): number {
  let dps = 0;
  for (const w of weapons) dps += weaponDps(w.id, w.level, stats);
  return dps;
}

/** How much a point of survival is worth now: more as HP drops. */
function danger(run: RunState): number {
  const frac = Math.max(0, run.tower.hp) / run.stats.maxHp;
  return 0.35 + (1 - frac);
}

export function scoreCard(run: RunState, card: Card): number {
  const before = buildDps(run.weapons, run.stats);
  switch (card.kind) {
    case 'weapon': {
      const weapons = run.weapons.filter((w) => w.id !== card.id).concat({ id: card.id, level: card.level } as WeaponState);
      return buildDps(weapons, run.stats) / Math.max(1e-9, before) - 1;
    }
    case 'passive': {
      const passives = run.passives.filter((p) => p.id !== card.id).concat({ id: card.id, level: card.level });
      const stats = resolveStats(allMods(run.mods, passives));
      const offence = buildDps(run.weapons, stats) / Math.max(1e-9, before) - 1;
      const hp = stats.maxHp / run.stats.maxHp - 1;
      // Ten seconds of regen, as a fraction of Max HP.
      const sustain = ((stats.regen / stats.maxHp) - (run.stats.regen / run.stats.maxHp)) * 10;
      const xp = (stats.xpMult / run.stats.xpMult - 1) * XP_VALUE;
      return offence + (hp + sustain) * danger(run) + xp;
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

/** Index of the best card; the first on a tie. */
export function suggest(run: RunState, cards: readonly Card[]): number {
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
