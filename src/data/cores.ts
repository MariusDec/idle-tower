/**
 * Tower cores — the run's identity, chosen before the first blessing lands
 * (gameplay plan §6).
 *
 * Blessings made two runs at the same power level *diverge*; cores decide what
 * they diverge from. A core is picked at the start of a run, changes what the
 * tower's shots actually do, and biases the blessing draft toward the cards
 * that build on it — so "this is a frost run" is a decision the player makes
 * on wave 1 rather than something the draft happens to hand them on wave 15.
 *
 * Two closed unions carry the content, and both have a compile-time consumer:
 * `CoreId` is switched exhaustively in `stats/contributors/core.ts`, and
 * `CoreBehavior` is keyed exhaustively by `CORE_BEHAVIOR_CONSUMERS` below. A
 * core with no stat block, or a behavior nothing reads, is a type error rather
 * than a purchase that changes no number.
 *
 * ## Why every number here is a throughput number
 *
 * §6.1's first draft priced two cores against *one shot*: artillery at
 * "−40% fire rate, +150% damage" and arcane at "every 5th shot at 250%".
 * The follow-up to Part 4 had already established why that is the wrong unit —
 * a bonus denominated in one shot shrinks against every fire-rate purchase the
 * player will ever make — but artillery's version fails in the other direction:
 * −40% fire rate with +150% damage is `0.6 x 2.5 = 1.5x` sustained output, half
 * again what any other core delivers, before the splash is counted at all.
 *
 * So the rule for this table: **a core's stat block is priced at throughput
 * parity, and what the core is actually *for* is its shot behavior.** Artillery
 * trades fire rate for damage at close to break-even and gets paid in splash;
 * frostwork trades the other way and gets paid in chill; arcane's proc is a
 * *share* of shots (every 5th), which is throughput-proportional by
 * construction, so it survives a fire-rate purchase intact.
 */

import type { AbilityId } from '../types';
import type { IconId } from './icons';
import { world } from './arena';

/** Every core, in picker order. `marksman` leads because it is the default. */
export const CORE_IDS = ['marksman', 'artillery', 'frostwork', 'bloodforge', 'arcane'] as const;
export type CoreId = typeof CORE_IDS[number];

/**
 * The core a run has before any choice is made.
 *
 * §6.2: a new player is on this one and never sees the picker. The first
 * ascension is the earliest a player has any information to choose *with*, so
 * it is the earliest the choice is offered.
 */
export const DEFAULT_CORE: CoreId = 'marksman';

/**
 * Shot behaviors, queried by id the way blessing behaviors are.
 *
 * Read per shot and per kill, so `CoreManager` keeps a rebuilt lookup set
 * rather than comparing core id strings in the combat path.
 */
export type CoreBehavior =
  | 'splash_shots'      // artillery: every shot carries a blast radius
  | 'chill_shots'       // frostwork: hits chill
  | 'nova_extended'     // frostwork: slow abilities last twice as long
  | 'kill_heal'         // bloodforge: kills restore a slice of max HP
  | 'desperate_tempo'   // bloodforge: below half HP, fire faster
  | 'mana_shot';        // arcane: every Nth shot spends mana and lands as magic

/**
 * Where each behavior is actually read.
 *
 * A `Record` over the union rather than a comment, so adding a behavior without
 * deciding where it is consumed does not compile.
 * `tests/content-coverage.test.ts` asserts the entries are non-empty.
 */
export const CORE_BEHAVIOR_CONSUMERS: Record<CoreBehavior, string> = {
  splash_shots: 'Game.simulate (fire options) → ProjectileManager.applyBlastSplash',
  chill_shots: 'ProjectileManager (on hit) → EnemyManager.applyChill',
  nova_extended: 'AbilityManager.getEffectiveDuration (slow abilities)',
  kill_heal: 'Game enemy_killed handler',
  desperate_tempo: 'stats/contributors/core (reads ctx.hpFraction)',
  mana_shot: 'Game.simulate (shot cadence) → ResourceManager.spendMana',
};

/**
 * The stat channels a core may move.
 *
 * Deliberately a small, named block rather than a free `Record<StatKey, …>`:
 * a core is a *character*, and five or six legible numbers is what makes one
 * readable on a picker card. Everything here is a fraction.
 */
export interface CoreStatBlock {
  damagePct?: number;
  fireRatePct?: number;
  rangePct?: number;
  /** Additive on crit chance, not a multiplier. */
  critChanceAdd?: number;
  maxHpPct?: number;
  /** Additive on lifesteal. */
  lifestealAdd?: number;
  goldPct?: number;
  manaRegenPct?: number;
  abilityDamagePct?: number;
  abilityAreaPct?: number;
}

export interface CoreDef {
  id: CoreId;
  name: string;
  /** One line, on the picker card. */
  tagline: string;
  /** What the shot behavior does, in the player's terms. */
  shotText: string;
  icon: IconId;
  color: string;
  /** AP to unlock. `marksman` is 0 — it is the default, not a purchase. */
  apCost: number;
  stats: CoreStatBlock;
  behaviors: readonly CoreBehavior[];
}

/**
 * Every tunable a core behavior needs, in one place, so the combat code reads
 * as intent and a re-tune is a one-line diff here.
 */
export const CORE_TUNING = {
  // ── artillery ──
  /** Blast radius carried by every artillery shot. */
  splashRadius: world(70),
  /** What everything else in the blast takes, as a fraction of the landed hit. */
  splashFraction: 0.5,

  // ── frostwork ──
  /** Speed multiplier applied to a chilled enemy (0.75 = −25% speed). */
  chillFactor: 0.75,
  chillDuration: 2,
  /** Slow abilities (Frost Nova) last this many times as long. */
  novaDurationMult: 2,

  // ── bloodforge ──
  /** Fraction of max HP restored per kill. */
  killHealFraction: 0.01,
  /** HP fraction below which the tempo step arms. */
  desperateHpFraction: 0.5,
  /** Fire rate multiplier while below that fraction. */
  desperateFireRate: 0.4,

  // ── arcane ──
  /** Every Nth shot is the arcane proc. */
  manaShotInterval: 5,
  /** Mana the proc spends. Out of mana → an ordinary shot, never a dead one. */
  manaShotCost: 3,
  /** Damage multiple the proc lands for, as magic damage. */
  manaShotDamageMult: 2.5,
} as const;

/**
 * Abilities whose duration `nova_extended` doubles.
 *
 * Keyed off the ability's *effect type* rather than its id at the call site, so
 * a second slow ability inherits the behavior; this list is only here to make
 * the docs and the picker card honest about what is affected today.
 */
export const CORE_EXTENDED_ABILITIES: readonly AbilityId[] = ['frost_nova'];

export const CORES: readonly CoreDef[] = [
  {
    id: 'marksman',
    name: 'Marksman Core',
    tagline: 'The baseline, sharpened.',
    shotText: 'Ordinary single shots — no trade-offs, no surprises.',
    icon: 'archery-target',
    color: '#d9c47a',
    apCost: 0,
    // §6.1 asks for +15% crit. Measured, that moves the **idle wall wave at
    // 0 lifetime AP from 39 to 49** — a whole boss decade — because `marksman`
    // is the core every player has by default and nobody chooses. A buff with
    // no choice attached is not a core, it is a difficulty change wearing one;
    // Parts 2-5 all held idle wall-wave drift at exactly zero, and there is no
    // gameplay reason for Part 6 to spend that. +6% is the largest crit bonus
    // that leaves the curve where it was at every prestige tier, so `marksman`
    // stays the ruler §6.4 measures the other four against.
    stats: { critChanceAdd: 0.06, rangePct: 0.20 },
    behaviors: [],
  },
  {
    id: 'artillery',
    name: 'Artillery Core',
    tagline: 'Fewer shots. Nothing survives them alone.',
    shotText: `Every shot bursts for ${CORE_TUNING.splashRadius} px, dealing `
      + `${Math.round(CORE_TUNING.splashFraction * 100)}% to everything else caught in it.`,
    icon: 'cannon',
    color: '#e08c4a',
    // Fire rate is traded for damage at *slightly better* than break-even
    // (0.6 x 1.8 = 1.08), and the rest of the core's worth is the splash. §6.1
    // asked for +150%, which is 1.5x sustained output on its own — see the
    // header note on why that unit is wrong.
    apCost: 30,
    // Measured: at +80% the core sits +13% of marksman's composed DPS at 0 AP
    // and tips the wall a whole decade. +65% is throughput parity
    // (0.6 x 1.65 = 0.99), which leaves the splash as the core's actual worth
    // — which is what §6.1 was reaching for.
    stats: { fireRatePct: -0.40, damagePct: 0.65 },
    behaviors: ['splash_shots'],
  },
  {
    id: 'frostwork',
    name: 'Frostwork Core',
    tagline: 'Everything you hit slows down.',
    shotText: `Hits chill: −${Math.round((1 - CORE_TUNING.chillFactor) * 100)}% enemy speed for `
      + `${CORE_TUNING.chillDuration} s. Frost Nova lasts ${CORE_TUNING.novaDurationMult}x as long.`,
    icon: 'snowflake-2',
    color: '#5fb8e0',
    // The mirror of artillery: more shots, smaller ones. Slightly *better* than
    // break-even on paper (1.30 x 0.85 = 1.105) because more shots means more
    // damage lost to flat enemy armour and more overkill on small targets — the
    // trade is not symmetric even when the multipliers look like it.
    apCost: 45,
    // -18%, not §6.1's -15%: the extra shots each pay the enemy's flat armour
    // again, so 1.30 x 0.82 = 1.066 on paper measures as parity in practice.
    stats: { fireRatePct: 0.30, damagePct: -0.18 },
    behaviors: ['chill_shots', 'nova_extended'],
  },
  {
    id: 'bloodforge',
    name: 'Bloodforge Core',
    tagline: 'Take the hit. Get paid for it.',
    shotText: `Kills restore ${(CORE_TUNING.killHealFraction * 100).toFixed(0)}% of max HP. `
      + `Below ${Math.round(CORE_TUNING.desperateHpFraction * 100)}% HP, +`
      + `${Math.round(CORE_TUNING.desperateFireRate * 100)}% fire rate.`,
    icon: 'bloody-sword',
    color: '#c0453f',
    apCost: 60,
    stats: { maxHpPct: 0.60, lifestealAdd: 0.08, goldPct: -0.20 },
    behaviors: ['kill_heal', 'desperate_tempo'],
  },
  {
    id: 'arcane',
    name: 'Arcane Core',
    tagline: 'Spend mana. Bypass armour.',
    shotText: `Every ${CORE_TUNING.manaShotInterval}th shot spends ${CORE_TUNING.manaShotCost} mana `
      + `and lands as magic damage for ${Math.round(CORE_TUNING.manaShotDamageMult * 100)}%. `
      + 'Out of mana, it fires as an ordinary shot.',
    icon: 'crystal-ball',
    color: '#a071e8',
    // The proc is a *share* of shots, so its worth is flat across every fire
    // rate: 4 ordinary shots plus one at 2.5x averages 1.3x, which pays back
    // most of the -18% base. What is left over is the magic damage type
    // (armour-blind) and the ability half of the core.
    //
    // §6.1's -25% measured 7-16% below marksman at every tier, because the
    // proc is **mana-limited**: the drain is `fireRate / 5 x 3` and the regen
    // is not, so the payback shrinks exactly where the player has bought the
    // most fire rate. -18% holds it inside ±10% across the whole ladder, and
    // Meditation is the answer to the rest — the sim's greedy buyer takes it
    // to level 4, which is precisely full uptime (see `procShare`).
    apCost: 90,
    stats: { damagePct: -0.18, manaRegenPct: 1.0, abilityDamagePct: 0.50, abilityAreaPct: 0.25 },
    behaviors: ['mana_shot'],
  },
];

export const CORE_BY_ID: Record<CoreId, CoreDef> = Object.fromEntries(
  CORES.map(c => [c.id, c]),
) as Record<CoreId, CoreDef>;

/** True for a value that is actually one of the five ids. */
export function isCoreId(value: unknown): value is CoreId {
  return typeof value === 'string' && (CORE_IDS as readonly string[]).includes(value);
}

/**
 * The core's stat block as display lines, for the picker card and the
 * Prestige panel. One formatter so the two cannot drift.
 */
export function describeCoreStats(def: CoreDef): string[] {
  const s = def.stats;
  const pct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
  const out: string[] = [];
  if (s.damagePct !== undefined) out.push(`${pct(s.damagePct)} damage`);
  if (s.fireRatePct !== undefined) out.push(`${pct(s.fireRatePct)} fire rate`);
  if (s.critChanceAdd !== undefined) out.push(`${pct(s.critChanceAdd)} crit chance`);
  if (s.rangePct !== undefined) out.push(`${pct(s.rangePct)} range`);
  if (s.maxHpPct !== undefined) out.push(`${pct(s.maxHpPct)} max HP`);
  if (s.lifestealAdd !== undefined) out.push(`${pct(s.lifestealAdd)} lifesteal`);
  if (s.manaRegenPct !== undefined) out.push(`${pct(s.manaRegenPct)} mana regen`);
  if (s.abilityDamagePct !== undefined) out.push(`${pct(s.abilityDamagePct)} ability damage`);
  if (s.abilityAreaPct !== undefined) out.push(`${pct(s.abilityAreaPct)} ability area`);
  if (s.goldPct !== undefined) out.push(`${pct(s.goldPct)} gold`);
  return out;
}
