import { bossCountForWave, goldDropForWave } from './formulas';
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
   * Orbs a boss *encounter* pays, not a boss.
   *
   * §4.1 says "bosses (always, 3-5)", written — like the rest of the plan
   * before Part 3 corrected it — as if a boss wave had one boss. It has
   * `bossCountForWave` = `2 + tier`: three at wave 10, twelve at wave 100.
   * Read per boss, a wave-100 pack would carpet the field with sixty orbs and
   * blow straight through the forty-orb cap. So the budget is per encounter
   * and `bossOrbShare` divides it across the pack.
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
 * Orbs one boss of a wave-`wave` pack drops.
 *
 * The encounter budget (3-5) divided by the pack size, with the fractional
 * remainder taken as a probability — so a three-boss wave-10 pack pays about
 * four orbs in total and so does a twelve-boss wave-100 pack, instead of the
 * latter paying four times the cap.
 */
export function bossOrbShare(wave: number, rng: () => number = Math.random): number {
  const span = LOOT_TUNING.bossOrbsMax - LOOT_TUNING.bossOrbsMin;
  const encounterTotal = LOOT_TUNING.bossOrbsMin + Math.floor(rng() * (span + 1));
  const share = encounterTotal / Math.max(1, bossCountForWave(wave));
  const whole = Math.floor(share);
  return whole + (rng() < share - whole ? 1 : 0);
}

/** Gold an orb dropped on `wave` is worth at full (clicked) value. */
export function orbGoldValue(wave: number): number {
  return Math.max(
    1,
    Math.floor(goldDropForWave(ENEMY_DEFS.normal.baseGold, wave) * LOOT_TUNING.goldKillsWorth),
  );
}
