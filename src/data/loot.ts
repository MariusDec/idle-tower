import { goldDropForWave } from './formulas';
import { ENEMY_DEFS } from './enemies';
import { entity, world } from './arena';

/**
 * What a loot orb pays out (gameplay plan §4.1).
 *
 * A closed union: `LootManager.payout` switches over it with a `never`
 * default, and `LOOT_ORB_CONSUMERS` names where each kind is actually spent,
 * so a kind nothing consumes is a compile error rather than an orb that pops
 * and does nothing.
 */
export type LootOrbKind = 'gold' | 'mana' | 'reroll';

export const LOOT_ORB_KINDS: readonly LootOrbKind[] = ['gold', 'mana', 'reroll'];

/** Where each kind's value is actually delivered. */
export const LOOT_ORB_CONSUMERS: Record<LootOrbKind, string> = {
  gold: 'ResourceManager.addGold (via Game.payOrb)',
  mana: 'ResourceManager.addMana (via Game.payOrb)',
  reroll: 'BlessingManager.grantRerollToken (via Game.payOrb)',
};

/** Body and glow colours, one per kind. Read by the renderer's sprite cache. */
export const LOOT_ORB_COLORS: Record<LootOrbKind, { core: string; glow: string; glyph: string }> = {
  gold: { core: '#ffd24a', glow: 'rgba(255, 200, 60, 0.55)', glyph: '#6b4a00' },
  mana: { core: '#5bc8ff', glow: 'rgba(80, 190, 255, 0.55)', glyph: '#053a55' },
  reroll: { core: '#c88cff', glow: 'rgba(190, 120, 255, 0.6)', glyph: '#2e0a4a' },
};

export const LOOT_TUNING = {
  /** Chance any ordinary kill leaves an orb behind. */
  commonDropChance: 0.02,
  /** Elites always drop, in this inclusive range. */
  eliteOrbsMin: 1,
  eliteOrbsMax: 2,
  /**
   * Orbs a boss *encounter* pays.
   *
   * §4.1's "bosses (always, 3-5)" was written as if a boss wave had one boss;
   * Part 3 gave it a pack of `2 + tier` and this budget had to be divided
   * across it, or a wave-100 pack would have carpeted the field with sixty
   * orbs and blown through the forty-orb cap. The wave has one boss again, so
   * the encounter budget and the per-kill drop are the same thing once more.
   */
  bossOrbsMin: 3,
  bossOrbsMax: 5,
  /** A gold orb is worth this many wave-normal kills. */
  goldKillsWorth: 12,
  /** A mana orb is worth this fraction of the player's max mana. */
  manaFraction: 0.12,
  /** Chance a boss orb is a reroll token instead of gold or mana. */
  rerollChance: 0.04,
  /** Chance a non-reroll orb is mana rather than gold, once mana is unlocked. */
  manaShare: 0.3,
  /** Seconds from spawn to arriving at the tower and auto-collecting. */
  driftSeconds: 8,
  /** Drift is this much shorter with the `orb_magnet` blessing. */
  magnetDriftScale: 0.5,
  /** Fraction paid by drift auto-collect. Clicking pays the whole thing. */
  autoCollectRate: 0.4,
  /** `orb_magnet` raises the auto rate to this (plan §4.1). */
  magnetCollectRate: 1,
  /** Live orbs; the oldest expires when a spawn would exceed this. */
  maxOrbs: 40,
  /**
   * Click/tap catch radius, in canvas units.
   *
   * Deliberately generous: the same handler serves a fingertip on a canvas
   * that is scaled down to phone width, where a pixel-tight hitbox would make
   * the whole verb feel broken.
   */
  clickRadius: world(34),
  /** Seconds of outward "pop" before an orb starts drifting to the tower. */
  popSeconds: 0.35,
  /** Drawn radius. */
  orbRadius: entity(9),
  /** Distance at which a drifting orb counts as having arrived. */
  arriveRadius: world(26),
} as const;

/**
 * Orbs the boss of wave `wave` drops — the whole encounter budget (3-5).
 *
 * Kept as a function of the wave, and kept taking an `rng`, because it used to
 * divide the budget across the pack and the wave is still what decides how big
 * an encounter is. `wave` is unused today; the signature is the seam that made
 * the pack change a one-line edit and would make the next one the same.
 */
export function bossOrbShare(_wave: number, rng: () => number = Math.random): number {
  const span = LOOT_TUNING.bossOrbsMax - LOOT_TUNING.bossOrbsMin;
  return LOOT_TUNING.bossOrbsMin + Math.floor(rng() * (span + 1));
}

/** Gold an orb dropped on `wave` is worth at full (clicked) value. */
export function orbGoldValue(wave: number): number {
  return Math.max(
    1,
    Math.floor(goldDropForWave(ENEMY_DEFS.normal.baseGold, wave) * LOOT_TUNING.goldKillsWorth),
  );
}
