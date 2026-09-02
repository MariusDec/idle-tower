import type { UpgradeDef } from '../types';

/**
 * The upgrade level ceiling, and the prestige purchases that raise it.
 *
 * ## Why this exists
 *
 * `damage.maxLevel = 200` is worth exactly 200 waves of enemy HP growth
 * (`0.2904 * 1.11^(L-2)` per level against `ENEMY_HP_GROWTH = 1.11`), so it is
 * also the ceiling on what *gold* can ever buy. Measured with `npm run sim`, a
 * run handed an unlimited gold multiplier still walls at wave 219 — and every
 * gold system in the game (Fortune, Tycoon, Golden Age, the combo meter, the
 * risk dial's payout, contract gold, loot orbs, gear sales) is inert past that
 * depth. See `plans/progress.md` §1.2.
 *
 * The fix is not a bigger literal. A literal moves the wall once; a *bought*
 * extension keeps gold live at every depth, because the ceiling now rises with
 * the player rather than with the table.
 *
 * ## Why a fraction, not a flat number
 *
 * Every line's cap is sized against its own curve — `damage` 200 against
 * `1.11`, `critDamage` 50 against a much flatter payout, `pierce` 6 against
 * `3.2^L` costs. A flat "+50 levels" is nothing to `damage` and breaks
 * `pierce`. A fraction preserves the relative shape the tables were tuned with.
 *
 * ## Why only some lines
 *
 * `fireRate` is capped *on purpose* (`src/data/upgrades.ts`: "two compounding
 * DPS axes multiply into a runaway"), and `pierce` / `splash` /
 * `doubleShotChance` / `quickShotChance` are coverage axes whose ceilings are
 * set by the arena's geometry rather than by the economy. Extending those is
 * the runaway the original caps were written to prevent. Only the *scalar*
 * lines below are extended; everything else keeps its table ceiling forever.
 *
 * ## Why module-level state
 *
 * The value is written once per stat recompute by `Game.applyResolvedStats`
 * and read by `UpgradeManager`, `UpgradePanel` and `sim/model.ts`. Threading a
 * new dependency through the panel to deliver one number would be three
 * indirections for a value that is global by nature. `setUpgradeCapExtension`
 * is the only writer; everything else reads through `effectiveMaxLevel`.
 */

/**
 * The upgrade ids the cap extension applies to.
 *
 * A `Set` of ids rather than a flag on `UpgradeDef`, so the exclusion list is
 * legible in one place and a new upgrade is excluded by default — which is the
 * safe direction for a mechanism whose failure mode is a runaway.
 */
export const CAP_EXTENDABLE_UPGRADES: ReadonlySet<string> = new Set([
  'damage',
  'critDamage',
  'health',
  'defense',
  'armor',
  'thorns',
  'lifesteal',
  'goldMulti',
  'waveGold',
  'goldOnKill',
  'manaRegen',
  'xpGain',
]);

/**
 * Hard ceiling on the extension fraction, whatever the perk levels say.
 *
 * 6.0 takes `damage` from 200 to 1400 levels — comfortably past what the gold
 * curve can reach at any depth the ladder reports — and it exists so a future
 * perk re-tune cannot silently produce a level count that overflows the cost
 * formula (`8 * 1.18^L` is ~1e102 at L1400, still finite, and `bigNumber.ts`
 * formats it).
 */
export const MAX_CAP_EXTENSION = 6.0;

let capExtension = 0;

/**
 * Set the live extension fraction. Called once per stat recompute from
 * `Game.applyResolvedStats`; `sim/model.ts` calls it directly when it wants to
 * measure a hypothetical.
 */
export function setUpgradeCapExtension(fraction: number): void {
  if (!Number.isFinite(fraction) || fraction <= 0) {
    capExtension = 0;
    return;
  }
  capExtension = Math.min(MAX_CAP_EXTENSION, fraction);
}

/** The live extension fraction. Read by the panel's copy, never by a formula. */
export function getUpgradeCapExtension(): number {
  return capExtension;
}

/**
 * The level ceiling `def` actually has right now.
 *
 * `maxLevel <= 0` means "no ceiling" in the existing tables and keeps that
 * meaning here — the extension never turns an unbounded line into a bounded
 * one.
 */
export function effectiveMaxLevel(def: Pick<UpgradeDef, 'id' | 'maxLevel'>): number {
  if (def.maxLevel <= 0) return def.maxLevel;
  if (capExtension <= 0) return def.maxLevel;
  if (!CAP_EXTENDABLE_UPGRADES.has(def.id)) return def.maxLevel;
  return def.maxLevel + Math.round(def.maxLevel * capExtension);
}

/** Reset to the un-extended state. Used by tests and by the sim between runs. */
export function resetUpgradeCapExtension(): void {
  capExtension = 0;
}
