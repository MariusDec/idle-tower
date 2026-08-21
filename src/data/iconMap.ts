/**
 * Resource and stat icons (UI plan §6.2).
 *
 * The other icon fields live on the thing they describe — an ability owns its
 * icon the way it owns its name. Resources and stats have no def table to hang
 * one on, so they get this map, and it is a closed `Record` for the same reason
 * every other content table in `src/data/` is: a stat the HUD asks for and
 * nobody assigned is a `tsc` error, not a hole in a chip.
 *
 * Reuse across surfaces is deliberate. "Crit chance" is `dead-eye` on the
 * upgrade row, on the passive tile and in the stats breakdown, so the player
 * learns one mark per concept rather than three synonyms.
 */

import type { IconId } from './icons';

export type StatIconKey =
  // Resources
  | 'gold' | 'mana' | 'xp' | 'rp' | 'ap' | 'tp' | 'hp' | 'talentPoints'
  // Combat stats
  | 'damage' | 'fireRate' | 'range' | 'critChance' | 'critDamage' | 'dps'
  | 'armor' | 'defense'
  // Run readouts
  | 'wave' | 'time' | 'kills' | 'speed' | 'luck';

export const STAT_ICONS: Record<StatIconKey, IconId> = {
  gold: 'two-coins',
  mana: 'magic-swirl',
  xp: 'progression',
  rp: 'brain',
  ap: 'upgrade',
  tp: 'over-infinity',
  hp: 'heart-tower',
  talentPoints: 'star-medal',

  damage: 'broadhead-arrow',
  fireRate: 'fast-arrow',
  range: 'bow-arrow',
  critChance: 'dead-eye',
  critDamage: 'barbed-arrow',
  dps: 'attack-gauge',
  armor: 'breastplate',
  defense: 'bordered-shield',

  wave: 'swords-emblem',
  time: 'hourglass',
  kills: 'skull-crack',
  speed: 'fast-forward-button',
  luck: 'clover',
};

export const STAT_ICON_KEYS: readonly StatIconKey[] = Object.keys(STAT_ICONS) as StatIconKey[];
