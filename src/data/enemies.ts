import type { BossPattern, Enemy, EnemyType } from '../types';
import type { IconId } from './icons';
import { ARENA_RANGE_CAP, entity, world } from './arena';
import {
  bossEncounterWeight,
  bossEscortCountForWave,
  bossHPForWave,
  enemyHPForWave,
  goldDropForWave,
} from './formulas';

/**
 * Body shapes the renderer knows how to paint.
 *
 * A closed union on purpose: `Renderer.paintEnemyBody` switches over it with a
 * `never` default, so a new enemy given a shape nobody draws is a compile
 * error rather than an invisible enemy (gameplay plan §2.5).
 */
export type EnemyShape = 'circle' | 'diamond' | 'winged' | 'square' | 'hex' | 'mound';

/**
 * Short display names, title-cased and singular-ish.
 *
 * A third naming table would have been one too many: `CONTRACT_ENEMY_LABELS`
 * is plural and lower-case for sentence copy ("kill 30 thieves") and the
 * milestone strip's entries are plural headings. This one is for *counted*
 * readouts — "3 Siege · 1 Warden" in the §7.3 threat preview — and it lives
 * here, next to the defs, because that is where anything else that needs a
 * name will look first. A `Record` over the union, so a new type cannot ship
 * nameless.
 */
export const ENEMY_LABELS: Record<EnemyType, string> = {
  normal: 'Grunt',
  fast: 'Runner',
  tank: 'Tank',
  flying: 'Flier',
  healer: 'Healer',
  splitter: 'Splitter',
  shielded: 'Shielded',
  siege: 'Siege',
  thief: 'Thief',
  blinker: 'Blinker',
  warden: 'Warden',
  burrower: 'Burrower',
  boss: 'Boss',
};

export interface EnemyDef {
  type: EnemyType;
  /** Panel/threat-preview icon. Purely UI — the canvas silhouette is `shape`. */
  icon: IconId;
  baseHP: number;
  baseSpeed: number;
  armor: number;
  magicResist: number;
  baseDamage: number;
  fireRate: number;
  baseGold: number;
  unlockWave: number;
  radius: number;
  color: string;
  borderColor: string;
  shape: EnemyShape;
  shieldCharges?: number;     // Shielded
  healRange?: number;         // Healer
  healFraction?: number;      // Healer: % of maxHP healed
  healCooldown?: number;      // Healer: seconds between heals
  splitChildren?: number;     // Splitter: children spawned on death
  splitHpFraction?: number;   // Splitter child HP fraction
  splitSpeedMultiplier?: number;
  rpChance?: number;          // 0-1, chance to drop 1 RP on kill
}

/**
 * How a type *moves* (UI plan §4.2). Presentation only.
 *
 * Before this, exactly two enemies in the game animated at all — the flier
 * bobbed and the boss and splitter breathed — so a wave of two hundred read as
 * a point cloud sliding across the floor. A cheap per-type gait fixes that for
 * two `Math.sin` calls per enemy per frame, and it does a second job for free:
 * a Runner scurrying at 15 rad/s and a Tank lumbering at 3.4 are *told apart by
 * their motion* before their silhouettes are close enough to resolve.
 *
 * The phase is `time × freq + id`, so two enemies of the same type standing
 * next to each other are never in step. A `Record` over the union, so a new
 * type cannot ship as a sliding sprite.
 */
export const ENEMY_GAIT: Record<EnemyType, {
  /** Radians per second of the gait cycle. Fast things scurry, heavy things do not. */
  freq: number;
  /** Peak vertical travel, in drawn pixels. */
  bob: number;
  /** Peak squash, as a fraction of the body radius. Stretched up, pinched across. */
  squash: number;
  /** True for something that hovers (a smooth float) rather than steps (a hop). */
  float: boolean;
}> = {
  normal: { freq: 7, bob: entity(1.2), squash: 0.05, float: false },
  fast: { freq: 15, bob: entity(2.2), squash: 0.1, float: false },
  tank: { freq: 3.4, bob: entity(0.8), squash: 0.035, float: false },
  flying: { freq: 5, bob: entity(3), squash: 0.03, float: true },
  healer: { freq: 5.5, bob: entity(1.4), squash: 0.05, float: false },
  boss: { freq: 2.6, bob: entity(1.6), squash: 0.06, float: false },
  splitter: { freq: 4.5, bob: entity(1.6), squash: 0.11, float: false },
  shielded: { freq: 4.5, bob: entity(0.9), squash: 0.04, float: false },
  // A machine on treads. It has a gait so it is not frozen, and almost none so
  // it never reads as something that runs at you.
  siege: { freq: 3, bob: entity(0.4), squash: 0.02, float: false },
  thief: { freq: 16, bob: entity(2.4), squash: 0.09, float: false },
  // Drifting rather than walking — it does not run, it arrives.
  blinker: { freq: 2, bob: entity(1.6), squash: 0.06, float: true },
  warden: { freq: 3.2, bob: entity(2), squash: 0.02, float: true },
  burrower: { freq: 8, bob: entity(0.9), squash: 0.09, float: false },
};

/**
 * Tuning for the behavioural roster (gameplay plan §2.1/§2.2).
 *
 * Every cadence here is measured in *simulation* seconds and consumed inside
 * `Game.simulate`'s fixed substeps, so a 3 s reload is 3 s of game time at
 * `dt = 1/120` and at 6.5x speed alike.
 */
export const ENEMY_BEHAVIOR = {
  /**
   * Siege halts just inside the arena range cap, so it is outside a short
   * build's reach but inside a fully range-stacked one's. Was 260 world units
   * — a touch *above* the cap — which meant no build could ever acquire one
   * automatically; range and target priority are the answer (plan §2.1).
   */
  siegeStandoff: ARENA_RANGE_CAP - 15,
  /** Seconds between siege lobs. */
  siegeReload: 3,
  /** Seconds a siege shell spends in the air (the telegraph). */
  siegeShellTravel: 1.2,
  /** Shell damage as a multiple of the siege enemy's melee damage. */
  siegeShellDamageMult: 3,

  /** Fraction of *current* gold a thief lifts on contact. */
  thiefStealFraction: 0.06,
  /** Hard ceiling on one theft, as a multiple of a normal enemy's wave drop. */
  thiefStealWaveGoldMult: 30,
  /** Ceiling on everything stolen during a single wave, as a fraction of current gold. */
  thiefWaveTheftCap: 0.15,
  /** Payout multiplier when a loaded thief is killed before it escapes. */
  thiefRecoveryMult: 2,
  /** Speed multiplier while a loaded thief is running for the edge. */
  thiefFleeSpeedMult: 1.35,

  /** Seconds between blinks. */
  blinkInterval: 3,
  /** Distance covered by one blink, in pixels. */
  blinkDistance: world(140),
  /** Seconds of knockback/mine immunity a blink grants. */
  blinkImmunity: 0.3,

  /** Absorb pool a warden projects, as a fraction of its own max HP. */
  wardShieldFraction: 0.15,
  /** Allies a single warden can shield. */
  wardMaxTargets: 5,
  /** Radius the warden looks for allies in. */
  wardRange: world(190),
  /** Seconds between shield refreshes. */
  wardRefresh: 4,

  /** Speed multiplier while burrowed. */
  burrowSpeedMult: 1.6,
  /** Distance from the tower at which a burrower breaks the surface. */
  burrowSurfaceDistance: world(120),
  /** Seconds the surfacing telegraph lasts (the burrower cannot act during it). */
  burrowTelegraph: 1,

  /** HP fraction below which a healer turns and runs. */
  healerFleeThreshold: 0.4,
  /** Speed multiplier for a fleeing healer. */
  healerFleeSpeedMult: 1.15,
  /** How far from the arena edge a fleeing healer stops, so it never leaves the field. */
  healerFleeEdgeMargin: world(40),
  /** Max-HP fraction a fleeing healer restores to itself per second. */
  healerSelfHealPerSecond: 0.12,

  /** Enemies in one `fast` spawn pack. */
  fastPackSize: 3,
  /** Radius the pack is scattered over at its shared spawn point. */
  fastPackSpread: world(26),

  /** Seconds a splitter child is untargetable and immune after the split. */
  splitterSpawnProtection: 1,
  /** Seconds a splitter child spends scattering outwards before it turns in. */
  splitterScatterTime: 0.6,
  /** Speed multiplier applied to that scatter. */
  splitterScatterSpeedMult: 1.6,

  /** Seconds of taking no damage before a shielded enemy starts rebuilding. */
  shieldCalmBeforeRegen: 3,
  /** Seconds per restored shield charge, once calm. */
  shieldRegenInterval: 6,

  /**
   * Ceiling on one thorns reflection, as a fraction of the tower's max HP.
   *
   * A thorns elite reflects a share of every hit it takes, and the hits it
   * takes are priced against *enemy* HP — an elite carries 2.5x a wave's bar,
   * which outgrows the tower's own by orders of magnitude. Uncapped, a single
   * execute or percent-of-max-HP proc on a thorns elite reflected more than the
   * tower's whole bar and killed it outright, from wherever the elite happened
   * to be standing. The cap keeps the aura a tax on ignoring it rather than a
   * one-shot: the punishment scales with how long you leave it alive, not with
   * how hard you hit it.
   */
  thornsReflectMaxTowerHpFraction: 0.05,
} as const;

/**
 * Boss encounter tuning (gameplay plan §3).
 *
 * Simulation seconds throughout, like `ENEMY_BEHAVIOR`: the whole state machine
 * runs inside `Game.simulate`'s fixed substeps, so a 2 s telegraph is 2 s of
 * game time at `dt = 1/120` and at 6.5x speed alike.
 */
export const BOSS_ENCOUNTER = {
  /** HP fractions the boss crosses into phase 2 and phase 3 at (§3.1). */
  phaseThresholds: [0.66, 0.33] as const,
  /** Seconds of untargetable flash on each crossing. */
  phaseInvulnerability: 0.7,

  /** `bulwark` shield, as a fraction of the boss's max HP. */
  bulwarkShieldFraction: 0.20,
  /** Seconds the player has to break it before the boss heals it back. */
  bulwarkWindow: 10,

  /** Adds per `summon` batch, for a *lone* boss — divided across the pack. */
  summonCount: 4,
  /** Seconds between batches. */
  summonInterval: 6,
  /**
   * Ceiling on the field while a summon phase is running.
   *
   * A boss wave spawns `bossCountForWave` bosses, so an unthrottled 4-adds-per
   * -boss-per-6 s would bury a wave-100 encounter in trash faster than any
   * build clears it. The batch is divided across the pack *and* capped here.
   */
  summonMaxAlive: 40,

  /** Seconds of growing ground ring before a `slam` lands. */
  slamTelegraph: 2,
  /** Seconds from the start of one telegraph to the start of the next. */
  slamInterval: 9,
  /** Slam damage, as a multiple of the boss's melee damage. */
  slamDamageMult: 8,
  /** Fraction of that which lands when the boss was controlled during the telegraph. */
  slamMitigatedFraction: 0.20,

  /** Mana drained per second while a `siphon` phase runs. */
  siphonManaPerSecond: 8,
  /**
   * HP the boss heals per second of *full* drain, as a fraction of its max HP.
   *
   * Deliberately expressed per second-of-drain rather than per point of mana:
   * mana pools grow across a run by a couple of orders of magnitude, and a heal
   * priced per point would be a rounding error at wave 10 and half the boss's
   * bar at wave 150. Pro-rated by how much mana was actually available, so a
   * player who spent theirs feeds it nothing — which is the answer the pattern
   * is asking for.
   */
  siphonHealFractionPerSecond: 0.005,

  /** Seconds a boss may live before the §3.3 enrage timer starts. */
  enrageDelay: 60,
  /** Seconds per additional enrage stack after that. */
  enrageInterval: 10,
  /** Damage added per boss-enrage stack. */
  enrageDamagePerStack: 0.15,
  /** Speed added per boss-enrage stack. */
  enrageSpeedPerStack: 0.10,

  /** Encounter cleared inside this many seconds counts as a swift kill (§3.4). */
  swiftKillSeconds: 30,
  /** Extra boss gold a swift kill pays. */
  swiftKillGoldBonus: 0.5,
  /** Rarity tiers a swift kill's guaranteed drop is bumped by. */
  swiftKillRarityBoost: 1,
  /** AP-preview bonus a flawless encounter banks for the rest of the run. */
  flawlessApBonus: 0.10,
  /** Blessing reroll tokens a flawless encounter grants. */
  flawlessRerollTokens: 1,
} as const;

/** Every boss pattern, in teaching order. */
export const BOSS_PATTERNS: readonly BossPattern[] = ['bulwark', 'summon', 'slam', 'siphon'];

/**
 * Where each pattern is actually run.
 *
 * A `Record` over the union for the same reason `ENEMY_BEHAVIOR_CONSUMERS` is
 * one (cross-cutting rule 3): a pattern that only exists as a name on the boss
 * bar is exactly the kind of inert content the closed-union rule exists to
 * catch. `content-coverage.test.ts` rejects a placeholder.
 */
export const BOSS_PATTERN_CONSUMERS: Record<BossPattern, string> = {
  bulwark: 'EnemyManager.tickBossPattern — 20% max-HP shield that heals the boss back if it survives 10 s',
  summon: 'EnemyManager.tickBossPattern — a batch of wave-scaled adds every 6 s, divided across the boss pack',
  slam: 'EnemyManager.tickBossPattern — 2 s telegraph, then damage x8 through tower_damaged, x0.2 if controlled',
  siphon: 'EnemyManager.tickBossPattern — drains 8 mana/s from the player and heals the boss for it',
};

/** Player-facing pattern names, for the boss bar. */
export const BOSS_PATTERN_NAMES: Record<BossPattern, string> = {
  bulwark: 'Bulwark',
  summon: 'Summoning',
  slam: 'Ground Slam',
  siphon: 'Mana Siphon',
};

/** One-line "what do I do about it" for the boss bar tooltip. */
export const BOSS_PATTERN_HINTS: Record<BossPattern, string> = {
  bulwark: 'Break the shield within 10s or it heals back.',
  summon: 'Clear the adds — they keep coming while this phase lasts.',
  slam: 'Slow or knock the boss back during the telegraph to blunt it.',
  siphon: 'Spend your mana — it heals for everything it drains.',
};

/**
 * Tier names, indexed by `bossTierForWave` (1-based, cycling past the table).
 *
 * A name is the cheapest possible memory hook: "the wave-40 Warden" is a thing
 * a player can talk about, "the wave-40 boss" is not.
 */
const BOSS_TIER_NAMES: readonly string[] = [
  // Deliberately no "Warden": that is an enemy *type* (§2.1), and two
  // different things called the same thing in the same HUD is a bug report.
  'Sentinel', 'Overseer', 'Colossus', 'Devourer', 'Harbinger',
  'Tyrant', 'Leviathan', 'Archon', 'Nemesis', 'Sovereign',
];

/**
 * The softening constant behind `armorDamageMultiplier`.
 *
 * Armor used to be a **flat** subtraction from every hit (`dmg -= enemy.armor`)
 * against `EnemyDef.armor` values that never scale with the wave. That is only
 * survivable while per-shot damage is large: on the pre-revamp table a boss's
 * armor 6 was ~16% of a wave-10 hit and rounding error by wave 30. The revamp's
 * §5 curve cuts early per-shot damage roughly 6x, at which point the *same*
 * flat 6 eats four fifths of every arrow and wave 10 becomes unbeatable at any
 * damage table — the constraints in §14 gates 5 and 6 go mutually exclusive.
 *
 * So armor is a *fraction* of the hit instead: `K / (K + armor)`, scale-free by
 * construction, which is what keeps it worth the same slice of an arrow at
 * wave 10 and at wave 200. K = 20 puts a boss (6) at -23%, a tank (3) at -13%
 * and a warden/siege (2) at -9% — the neighbourhood flat armor occupied on the
 * old table, without the cliff. Armor penetration still applies to the armor
 * *value* before the curve, so `armorPen`/`armorPenFlat` keep their meaning.
 */
export const ARMOR_SOFTENING = 20;

/** Fraction of a physical hit that survives `armor`. Never below `K/(K+armor)`. */
export function armorDamageMultiplier(armor: number): number {
  if (armor <= 0) return 1;
  return ARMOR_SOFTENING / (ARMOR_SOFTENING + armor);
}

/** Boss tier for a wave: `floor(wave / 10)`, never below 1. */
export function bossTierForWave(wave: number): number {
  return Math.max(1, Math.floor(wave / 10));
}

/** `Wave 40 Warden` — the name the boss bar shows. */
export function bossNameForWave(wave: number): string {
  const tier = bossTierForWave(wave);
  return `Wave ${wave} ${BOSS_TIER_NAMES[(tier - 1) % BOSS_TIER_NAMES.length]}`;
}

/**
 * The pattern a boss of this tier runs in this phase (§3.2).
 *
 * Tier 1 teaches `bulwark` alone; tier 2 adds `summon`; tier 3 adds `slam`;
 * from tier 4 the whole roster is in play, rotated by tier so successive
 * encounters are not the same fight three times.
 *
 * §3.2 says tier 4+ "draws all four, one per phase", which cannot be literal —
 * there are three phases and four patterns. The rotation is the honest reading:
 * every tier-4+ boss runs three *distinct* patterns, and across four
 * consecutive tiers every pattern appears in every phase slot. It is also
 * deterministic, which is what makes the phase-count test meaningful.
 */
export function bossPatternForPhase(tier: number, phase: number): BossPattern {
  const t = Math.max(1, Math.floor(tier));
  const p = Math.max(1, Math.min(3, Math.floor(phase)));
  const poolSize = t <= 1 ? 1 : t === 2 ? 2 : t === 3 ? 3 : 4;
  if (poolSize < 4) return BOSS_PATTERNS[(p - 1) % poolSize];
  return BOSS_PATTERNS[(t - 4 + p - 1) % BOSS_PATTERNS.length];
}

/** The three patterns a boss on this wave will run, phase 1 → 3. */
export function bossPatternsForWave(wave: number): BossPattern[] {
  const tier = bossTierForWave(wave);
  return [1, 2, 3].map(phase => bossPatternForPhase(tier, phase));
}

/**
 * Adds the boss puts on the field per `summon` batch.
 *
 * The batch used to be divided across the pack — §3.2's "4 adds" was the figure
 * for a lone boss, and a wave-100 pack of eleven each summoning one landed
 * eleven adds a batch. There is one boss now, so it summons what the pack used
 * to summon between them: the plan's four at the shallow tiers, and the
 * encounter's weight once that is the larger of the two. `summonMaxAlive` is
 * still the ceiling.
 */
export function bossSummonCountForWave(wave: number): number {
  return Math.max(BOSS_ENCOUNTER.summonCount, bossEncounterWeight(wave));
}

/**
 * Extra effective HP each pattern holds *outside* the boss's HP bar, as a
 * fraction of its max HP.
 *
 * A `Record` over the union, and the balance number the whole encounter is
 * budgeted against:
 *   - `bulwark` = the shield fraction itself. One shield per phase; it does not
 *     re-arm once broken, so this is exact rather than an average.
 *   - `summon` 0.10: `bossSummonCountForWave` adds per boss every 6 s, at trash
 *     HP against a boss bar worth ~20 of them, and the wave cannot end until
 *     they are dead.
 *   - `siphon` 0.04: 0.5% of max HP per second of drain, and only for as long
 *     as the player has mana to be taken.
 *   - `slam` 0: it costs tower HP, not tower damage.
 */
export const BOSS_PATTERN_HP_WEIGHT: Record<BossPattern, number> = {
  bulwark: BOSS_ENCOUNTER.bulwarkShieldFraction,
  summon: 0.10,
  slam: 0,
  siphon: 0.04,
};

/**
 * How much more damage a boss on this wave costs than its HP bar shows.
 *
 * Priced from the actual rotation `bossPatternForPhase` hands it, so a tier-1
 * boss — three `bulwark` phases, by §3.2's teaching rule — is correctly the
 * most expensive relative to its bar.
 */
export function bossPhaseHpFactor(wave: number): number {
  let extra = 0;
  for (const pattern of bossPatternsForWave(wave)) extra += BOSS_PATTERN_HP_WEIGHT[pattern];
  return 1 + extra;
}

/**
 * Floor on how much of the encounter's HP stays in the boss's own bar.
 *
 * The escort is deducted from the boss, and the deduction has to stop
 * somewhere: a deep wave's escort is a real slice of the budget, and a boss
 * whose bar has been eaten by its own trash is not a boss. At 0.8 the escort
 * can never be worth more than a fifth of the encounter.
 */
export const BOSS_BAR_MIN_SHARE = 0.8;

/**
 * Floor on how much of the encounter's *gold* the boss itself pays.
 *
 * The escort's share is a much bigger slice of the purse than it is of the
 * bar — trash is priced well above a boss in gold per point of HP — so this
 * floor sits far lower than `BOSS_BAR_MIN_SHARE`. It is a guard, not a knob:
 * at every depth the escort's share lands around 40% of the purse.
 */
export const BOSS_PURSE_MIN_SHARE = 0.25;

/**
 * The HP a boss actually spawns with — its *bar*, not its durability.
 *
 * Part 2 shipped under §2.6's rule that new content replaces what is already
 * there rather than adding to it, and Part 3 is held to the same rule: the
 * phase machine holds `bossPhaseHpFactor` worth of the encounter outside `hp`,
 * so the bar shrinks by exactly that much and a boss wave costs the same total
 * damage it did before phases existed.
 *
 * This is not cosmetic. Bosses were already the wall at every prestige tier —
 * `npm run sim` puts a wave-40 boss at 0.99 of its enrage budget at 100
 * lifetime AP — so an uncompensated +30% would have moved the wall a full
 * decade at every tier. What Part 3 adds is *fail states* (a bulwark that heals
 * back, adds that must be cleared, a slam that costs tower HP), not a longer
 * bar, which was the whole complaint in §0.4.
 *
 * The wave's *escort* comes out of the same bar, for the same reason: it is
 * trash the tower has to shoot on a wave whose damage budget was already
 * spent. `BOSS_BAR_MIN_SHARE` caps how much of the bar that can eat; in
 * practice the escort lands at 4-14% and the cap never binds.
 *
 * Gold and XP price the encounter, not the body (`bossGoldForWave`,
 * `xpPerKill`): the wave is worth what it always was.
 */
export function bossMaxHpForWave(wave: number): number {
  const budget = bossEncounterHpForWave(wave);
  const escort = Math.min(budget * (1 - BOSS_BAR_MIN_SHARE), bossEscortHpForWave(wave));
  return (budget - escort) / bossPhaseHpFactor(wave);
}

/**
 * Total HP a boss wave is worth — the whole encounter, boss and escort alike.
 *
 * `bossHPForWave` prices *one* boss, and a boss wave used to field
 * `bossEncounterWeight` of them; that is still what the wave costs, it is
 * simply no longer split across several bodies. Every consumer that used to
 * multiply a per-boss figure by the pack size reads this instead.
 */
export function bossEncounterHpForWave(wave: number): number {
  return bossHPForWave(ENEMY_DEFS.boss.baseHP, wave) * bossEncounterWeight(wave);
}

/**
 * HP the escort holds, priced at the wave's own trash curve.
 *
 * Taken *out* of the boss's bar rather than added on top, so the escort is a
 * redistribution of the encounter's damage budget and not a surcharge on it —
 * the same §2.6 rule the phase machine itself was held to.
 */
export function bossEscortHpForWave(wave: number): number {
  return bossEscortCountForWave(wave)
    * poolAverage(wave, t => enemyHPForWave(ENEMY_DEFS[t].baseHP, wave));
}

/**
 * Gold the lone boss pays: the encounter's purse, less what the escort pays.
 *
 * Same shape as `bossMaxHpForWave`, and for the same reason. Killing the one
 * boss has to be worth roughly what killing the pack was, or a boss wave
 * quietly becomes the worst-paying wave in the game — but the escort pays its
 * own gold on the way in, and trash is worth far more gold *per point of HP*
 * than a boss is. Paying the full pack purse on top of the escort put wave-100
 * boss gold up 66% and pushed run income growth from 1.169x to 1.197x a wave
 * against §6.3's 1.16x ceiling. The purse is the wave's; the escort's share
 * simply comes out of it.
 */
export function bossGoldForWave(wave: number): number {
  const purse = goldDropForWave(ENEMY_DEFS.boss.baseGold, wave) * bossEncounterWeight(wave);
  return Math.max(purse * BOSS_PURSE_MIN_SHARE, purse - bossEscortGoldForWave(wave));
}

/** Gold the escort pays between them, at the wave's own trash rate. */
export function bossEscortGoldForWave(wave: number): number {
  return bossEscortCountForWave(wave) * poolAverage(wave, t => goldDropForWave(ENEMY_DEFS[t].baseGold, wave));
}

/**
 * Weighted mean of `value` across the types a wave can spawn.
 *
 * The escort rolls from `spawnPoolForWave` like any other wave's enemies, so
 * anything priced across the escort is priced across that table rather than
 * against `normal` as a stand-in.
 */
function poolAverage(wave: number, value: (type: EnemyType) => number): number {
  const pool = spawnPoolForWave(wave);
  let weight = 0;
  let total = 0;
  for (const entry of pool) {
    weight += entry.weight;
    total += entry.weight * value(entry.type);
  }
  return weight > 0 ? total / weight : 0;
}

/** What a finished boss encounter earned (gameplay plan §3.4). */
export interface BossEncounterOutcome {
  swift: boolean;
  flawless: boolean;
}

/**
 * Score a finished encounter.
 *
 * A pure function rather than two comparisons inlined in `Game`, so the rule is
 * one thing the tests can hold: "under 30 *simulation* seconds" and "the tower
 * lost no HP" are both easy to get subtly wrong (wall-clock, or counting a hit
 * the wall absorbed as damage) and neither mistake is visible in play.
 */
export function bossEncounterOutcome(
  elapsedSeconds: number,
  towerHpLost: boolean,
): BossEncounterOutcome {
  return {
    swift: elapsedSeconds <= BOSS_ENCOUNTER.swiftKillSeconds,
    flawless: !towerHpLost,
  };
}

/** Boss-enrage stacks for a boss that has been alive `elapsed` seconds (§3.3). */
export function bossEnrageStacksFor(elapsed: number): number {
  if (elapsed < BOSS_ENCOUNTER.enrageDelay) return 0;
  return 1 + Math.floor((elapsed - BOSS_ENCOUNTER.enrageDelay) / BOSS_ENCOUNTER.enrageInterval);
}

/** Phase a boss at this HP fraction belongs in — 1, 2 or 3. */
export function bossPhaseForHpFraction(fraction: number): number {
  const [p2, p3] = BOSS_ENCOUNTER.phaseThresholds;
  if (fraction <= p3) return 3;
  if (fraction <= p2) return 2;
  return 1;
}

/**
 * Where each type's behaviour actually lives.
 *
 * A `Record` over the whole `EnemyType` union, exactly like
 * `ACHIEVEMENT_REWARD_CONSUMERS` and `BLESSING_BEHAVIOR_CONSUMERS`: a new enemy
 * type does not compile until someone has said what it *does*, and
 * `content-coverage.test.ts` rejects a placeholder. This is the mechanism that
 * stops the roster sliding back into thirteen stat blocks.
 */
export const ENEMY_BEHAVIOR_CONSUMERS: Record<EnemyType, string> = {
  normal: 'EnemyManager.tick — the baseline advance-and-melee branch, deliberately unchanged',
  fast: 'WaveManager.spawnOne — arrives in packs of three from one shared spawn point',
  tank: 'ProjectileManager.tick — body-blocks, so a shot never pierces past a tank',
  flying: 'EnemyManager.tick + Game mine loop — ignores the wall contact band and land mines',
  healer: 'EnemyManager.tick — heals allies; below 40% HP it flees to the arena edge while healing itself, then returns and never flees again',
  boss: 'EnemyManager.tickBoss — three phases at 66%/33% HP, one pattern each, plus the §3.3 enrage timer',
  splitter: 'Game enemy_killed + EnemyManager.spawnSplitterChild — children scatter under 2 s spawn protection',
  shielded: 'EnemyManager.tick — rebuilds a charge every 6 s after 3 s undamaged',
  siege: 'EnemyManager.tick — halts at 260 px and lobs hostile shells at the tower',
  thief: 'EnemyManager.tick — steals from current gold on contact, then runs for the arena edge',
  blinker: 'EnemyManager.tick — teleports 140 px every 3 s, ignoring knockback, mines and the wall',
  warden: 'EnemyManager.tick — projects a regenerating absorb shield onto up to five nearby allies',
  burrower: 'EnemyManager.tick — untargetable and invulnerable underground until it surfaces at 120 px',
};

/** Types the `priority` targeting mode reaches for, most urgent first. */
export const PRIORITY_TARGET_ORDER: readonly EnemyType[] = ['warden', 'healer', 'thief', 'siege'];

/**
 * Can the tower shoot this enemy at all?
 *
 * The single answer for every target-selection site in the game —
 * `Tower.acquireTarget`, the projectile sweep, and every picker in
 * `AbilityManager`. A burrower underground, a splitter child inside its spawn
 * protection and a boss mid-phase-transition are all *on the field* and all
 * un-hittable; routing them through one predicate is what stops a new target
 * picker quietly being able to shoot through the ground.
 *
 * The boss's phase flash goes through here rather than through a flag of its
 * own, deliberately (gameplay plan §3.1): a second invulnerability mechanism is
 * a second thing every one of the eight target-selection sites has to remember.
 */
export function isTargetable(enemy: Enemy): boolean {
  return enemy.alive
    && enemy.burrowed !== true
    && (enemy.spawnProtection ?? 0) <= 0
    && (enemy.bossInvulnerable ?? 0) <= 0;
}

/** True when land mines and knockback pass straight through this enemy. */
export function ignoresGroundEffects(enemy: Enemy): boolean {
  return enemy.type === 'flying' || (enemy.blinkImmunity ?? 0) > 0;
}

/** True when the enemy walks straight through the wall's extended contact band. */
export function ignoresWallBand(enemy: Enemy): boolean {
  return enemy.type === 'flying' || enemy.type === 'blinker';
}

export const ENEMY_DEFS: Record<EnemyType, EnemyDef> = {
  normal: {
    type: 'normal',
    icon: 'orc-head',
    baseHP: 6,
    baseSpeed: world(60),
    armor: 0,
    magicResist: 0,
    baseDamage: 1,
    fireRate: 0.7,
    baseGold: 1,
    unlockWave: 1,
    radius: entity(12),
    color: '#d04848',
    borderColor: '#ffffff',
    shape: 'circle',
    rpChance: 0.005,
  },
  fast: {
    type: 'fast',
    icon: 'running-ninja',
    baseHP: 4,
    baseSpeed: world(120),
    armor: 0,
    magicResist: 0,
    baseDamage: 1,
    fireRate: 1.2,
    baseGold: 2,
    unlockWave: 3,
    radius: entity(10),
    color: '#f1c40f',
    borderColor: '#7a6500',
    shape: 'diamond',
    rpChance: 0.01,
  },
  tank: {
    type: 'tank',
    icon: 'rock-golem',
    baseHP: 20,
    baseSpeed: world(30),
    armor: 3,
    magicResist: 0,
    baseDamage: 1,
    fireRate: 0.85,
    baseGold: 3,
    unlockWave: 5,
    radius: entity(18),
    color: '#2c5b8f',
    borderColor: '#9aa7b5',
    shape: 'circle',
    rpChance: 0.015,
  },
  flying: {
    type: 'flying',
    icon: 'bat',
    baseHP: 7,
    baseSpeed: world(90),
    armor: 0,
    magicResist: 0,
    baseDamage: 2,
    fireRate: 1.5,
    baseGold: 3,
    unlockWave: 8,
    radius: entity(11),
    color: '#ecf0f1',
    borderColor: '#2c3e50',
    shape: 'winged',
    rpChance: 0.02,
  },
  healer: {
    type: 'healer',
    icon: 'healing',
    baseHP: 12,
    baseSpeed: world(50),
    armor: 0,
    magicResist: 0,
    baseDamage: 2,
    fireRate: 1.1,
    baseGold: 4,
    unlockWave: 15,
    radius: entity(14),
    color: '#27ae60',
    borderColor: '#0e3a1d',
    shape: 'circle',
    healRange: world(150),
    healFraction: 0.15,
    healCooldown: 2.5,
    rpChance: 0.025,
  },
  boss: {
    type: 'boss',
    icon: 'crowned-skull',
    baseHP: 120,
    baseSpeed: world(40),
    armor: 6,
    magicResist: 0.15,
    baseDamage: 5,
    fireRate: 0.8,
    baseGold: 10,
    unlockWave: 10,
    radius: entity(30),
    color: '#7b1f1f',
    borderColor: '#ff5050',
    shape: 'circle',
    rpChance: 0.075,
  },
  splitter: {
    type: 'splitter',
    icon: 'transparent-slime',
    baseHP: 16,
    baseSpeed: world(55),
    armor: 0,
    magicResist: 0,
    baseDamage: 1,
    fireRate: 0.9,
    baseGold: 3,
    unlockWave: 12,
    radius: entity(16),
    color: '#9b59ff',
    borderColor: '#d3b3ff',
    shape: 'diamond',
    splitChildren: 2,
    splitHpFraction: 0.5,
    splitSpeedMultiplier: 1.4,
    rpChance: 0.015,
  },
  shielded: {
    type: 'shielded',
    icon: 'surrounded-shield',
    baseHP: 10,
    baseSpeed: world(40),
    armor: 0,
    magicResist: 0.3,
    baseDamage: 1,
    fireRate: 1.0,
    baseGold: 5,
    unlockWave: 20,
    radius: entity(14),
    color: '#5dade2',
    borderColor: '#1a5276',
    shape: 'circle',
    shieldCharges: 3,
    rpChance: 0.025,
  },
  // ── Behavioural roster (gameplay plan §2.1) ─────────────────────────────
  //
  // HP budgets are deliberately close to the existing mix's weighted mean: the
  // plan's §2.6 rule is that these types *replace* slots in the spawn table
  // rather than adding to `enemyCountForWave`, so total wave HP must not rise.
  // What each one costs the player is a wrong *build*, not a bigger bar.
  siege: {
    type: 'siege',
    icon: 'catapult',
    baseHP: 12,
    baseSpeed: world(42),
    armor: 2,
    magicResist: 0,
    baseDamage: 2,
    fireRate: 0.6,
    baseGold: 2,
    unlockWave: 25,
    radius: entity(15),
    color: '#a9752f',
    borderColor: '#f0d3a0',
    shape: 'square',
    rpChance: 0.025,
  },
  thief: {
    type: 'thief',
    icon: 'robber-mask',
    baseHP: 7,
    baseSpeed: world(135),
    armor: 0,
    magicResist: 0.1,
    baseDamage: 1,
    fireRate: 1.0,
    baseGold: 3,
    unlockWave: 30,
    radius: entity(11),
    color: '#d4af37',
    borderColor: '#3a2c00',
    shape: 'diamond',
    rpChance: 0.03,
  },
  blinker: {
    type: 'blinker',
    icon: 'teleport',
    baseHP: 9,
    baseSpeed: world(28),
    armor: 0,
    magicResist: 0.25,
    baseDamage: 2,
    fireRate: 1.0,
    baseGold: 2,
    unlockWave: 35,
    radius: entity(12),
    color: '#7f5af0',
    borderColor: '#ded1ff',
    shape: 'circle',
    rpChance: 0.03,
  },
  warden: {
    type: 'warden',
    icon: 'nested-hexagons',
    baseHP: 14,
    baseSpeed: world(44),
    armor: 2,
    magicResist: 0.2,
    baseGold: 3,
    baseDamage: 2,
    fireRate: 0.8,
    unlockWave: 40,
    radius: entity(16),
    color: '#1f7a8c',
    borderColor: '#9fe8f5',
    shape: 'hex',
    rpChance: 0.035,
  },
  burrower: {
    type: 'burrower',
    icon: 'mole',
    baseHP: 9,
    baseSpeed: world(52),
    armor: 1,
    magicResist: 0,
    baseDamage: 3,
    fireRate: 1.1,
    baseGold: 2,
    unlockWave: 45,
    radius: entity(13),
    color: '#7a5a30',
    borderColor: '#d8b578',
    shape: 'mound',
    rpChance: 0.03,
  },
};

/**
 * One bullet in an enemy codex page.
 *
 * `name` is the short heading the modal prints in a coloured pill (e.g.
 * `Pack`, `Armour`, `Enrage`); `text` is the player-facing sentence. Numbers
 * in `text` are interpolated from `ENEMY_BEHAVIOR` / `BOSS_ENCOUNTER` /
 * `ENEMY_DEFS` via template literals — never typed as literals — so a balance
 * change lands in the page in the same commit it lands in the simulation.
 */
export interface EnemyEffectLine {
  name: string;
  text: string;
}

/**
 * One page in the enemy bestiary (plans/stats.md Part D).
 *
 * - `tagline` — single sentence the player sees on first open. Moved verbatim
 *   from `ENEMY_INTRO_MILESTONES` for the eleven types that have a milestone
 *   entry; written fresh for `normal` (no milestone) and `boss` (boss-wave
 *   banner covers the announcement, this is the page-level summary).
 * - `description` — one or two sentences on what the enemy *is*. Written fresh.
 * - `answer` — the tactic the player needs to bring. Written fresh.
 * - `effects` — the mechanics bullets, in teaching order. Numbers come from the
 *   tuning constants so a balance change reaches the modal automatically.
 */
export interface EnemyCodexEntry {
  tagline: string;
  description: string;
  answer: string;
  effects: readonly EnemyEffectLine[];
}

/**
 * The enemy bestiary — one entry per `EnemyType` (plans/stats.md Part D).
 *
 * `Record<EnemyType, …>` so adding a new type cannot ship without copy: tsc
 * catches the missing key, and `content-coverage.test.ts` rejects an empty
 * tagline or a placeholder answer.
 */
export const ENEMY_CODEX: Record<EnemyType, EnemyCodexEntry> = {
  normal: {
    tagline: 'The baseline enemy — a cheap advance-and-melee unit.',
    description: 'A cheap grunts whose only job is to reach the tower and hit it once per swing. '
      + 'Every mechanic in the game was tested against this type before it was added to anything else.',
    answer: 'Anything works. Build for splash or pierce and the rest of the roster falls in line.',
    effects: [],
  },
  fast: {
    tagline: 'Quick and fragile — and they arrive three at a time.',
    description: `Quick and fragile runners. Every spawn is a pack of ${ENEMY_BEHAVIOR.fastPackSize} from one shared point, scattered over ${ENEMY_BEHAVIOR.fastPackSpread} px.`,
    answer: 'Splash or chain damage — a single-target build lets the pack leak past.',
    effects: [
      { name: 'Pack', text: `Spawns in groups of ${ENEMY_BEHAVIOR.fastPackSize} from one shared spawn point, scattered over ${ENEMY_BEHAVIOR.fastPackSpread} px.` },
    ],
  },
  tank: {
    tagline: 'Armoured and slow. Shots never pierce past one.',
    description: `Slow heavy body with ${ENEMY_DEFS.tank.armor} armour. A tank is a body-block: a shot that would pierce past a grunt dies on the tank's hide.`,
    answer: 'Multi-shot, splash or high per-hit damage — a piercing build cannot route around a wall.',
    effects: [
      { name: 'Body Block', text: 'Shots never pierce past a tank, even if they would have pierced the grunt behind it.' },
      { name: 'Armour', text: `Reduces incoming physical damage to ${(armorDamageMultiplier(ENEMY_DEFS.tank.armor) * 100).toFixed(0)}% of the hit.` },
    ],
  },
  flying: {
    tagline: 'Ignores land mines and floats straight over the wall.',
    description: 'A flier ignores the wall\'s extended contact band and is unaffected by land mines and knockback — magic is the only thing that reliably catches one.',
    answer: 'Magic damage. The Marksman and Frostwork cores pay off here; physical builds waste their bonus.',
    effects: [
      { name: 'Airborne', text: 'Ignores land mines, knockback and the wall\'s contact band. Magic damage still applies.' },
    ],
  },
  healer: {
    tagline: 'Heals the wave, and runs while healing once badly hurt.',
    description: `A support unit that heals allies in a ${ENEMY_DEFS.healer.healRange!} px radius for ${(ENEMY_DEFS.healer.healFraction! * 100).toFixed(0)}% of their max HP every ${ENEMY_DEFS.healer.healCooldown!} s. Below ${(ENEMY_BEHAVIOR.healerFleeThreshold * 100).toFixed(0)}% HP it turns and runs for the arena edge while self-healing.`,
    answer: 'Target priority — a healer left alive keeps the whole wave topped up.',
    effects: [
      { name: 'Field Heal', text: `Restores ${(ENEMY_DEFS.healer.healFraction! * 100).toFixed(0)}% of max HP to allies within ${ENEMY_DEFS.healer.healRange!} px, every ${ENEMY_DEFS.healer.healCooldown!} s.` },
      { name: 'Flee', text: `Below ${(ENEMY_BEHAVIOR.healerFleeThreshold * 100).toFixed(0)}% HP it flees at ${ENEMY_BEHAVIOR.healerFleeSpeedMult}× speed and self-heals at ${(ENEMY_BEHAVIOR.healerSelfHealPerSecond * 100).toFixed(0)}% max HP / s. Never flees twice.` },
    ],
  },
  boss: {
    tagline: 'Three phases, one pattern each, plus a timer that punishes patience.',
    description: 'The arena boss. Three phases at 66% and 33% HP, each running a different pattern from the tier\'s rotation. After the enrage delay the boss gains damage and speed every ten seconds for the rest of the fight.',
    answer: 'Learn the tier\'s patterns and bring the right counter — Damage, AoE, Slow or Magic. Never let it enrage.',
    effects: [
      { name: 'Phases', text: `Three phases at ${(BOSS_ENCOUNTER.phaseThresholds[0] * 100).toFixed(0)}% and ${(BOSS_ENCOUNTER.phaseThresholds[1] * 100).toFixed(0)}% HP. Each crossing flashes untargetable for ${BOSS_ENCOUNTER.phaseInvulnerability} s.` },
      { name: BOSS_PATTERN_NAMES.bulwark, text: BOSS_PATTERN_HINTS.bulwark },
      { name: BOSS_PATTERN_NAMES.summon, text: BOSS_PATTERN_HINTS.summon },
      { name: BOSS_PATTERN_NAMES.slam, text: BOSS_PATTERN_HINTS.slam },
      { name: BOSS_PATTERN_NAMES.siphon, text: BOSS_PATTERN_HINTS.siphon },
      { name: 'Enrage', text: `After ${BOSS_ENCOUNTER.enrageDelay} s the boss gains +${(BOSS_ENCOUNTER.enrageDamagePerStack * 100).toFixed(0)}% damage and +${(BOSS_ENCOUNTER.enrageSpeedPerStack * 100).toFixed(0)}% speed every ${BOSS_ENCOUNTER.enrageInterval} s.` },
      { name: 'Swift Kill', text: `Cleared inside ${BOSS_ENCOUNTER.swiftKillSeconds} s pays +${(BOSS_ENCOUNTER.swiftKillGoldBonus * 100).toFixed(0)}% boss gold and boosts the guaranteed drop by ${BOSS_ENCOUNTER.swiftKillRarityBoost} rarity tier.` },
      { name: 'Flawless', text: `A no-HP-lost clear banks +${(BOSS_ENCOUNTER.flawlessApBonus * 100).toFixed(0)}% AP preview and ${BOSS_ENCOUNTER.flawlessRerollTokens} blessing reroll token for the rest of the run.` },
    ],
  },
  splitter: {
    tagline: 'Bursts into two children that scatter before they can be hit.',
    description: `On death a splitter spawns ${ENEMY_DEFS.splitter.splitChildren} children at ${(ENEMY_DEFS.splitter.splitHpFraction! * 100).toFixed(0)}% HP each, scattering at ${ENEMY_DEFS.splitter.splitSpeedMultiplier}× speed for ${ENEMY_BEHAVIOR.splitterScatterTime} s before turning in. Each child is untargetable for ${ENEMY_BEHAVIOR.splitterSpawnProtection} s.`,
    answer: 'Splash or chain damage — single-target kills one and pays double for the second.',
    effects: [
      { name: 'Split', text: `On death spawns ${ENEMY_DEFS.splitter.splitChildren} children at ${(ENEMY_DEFS.splitter.splitHpFraction! * 100).toFixed(0)}% HP, moving at ${ENEMY_DEFS.splitter.splitSpeedMultiplier}× speed.` },
      { name: 'Spawn Protection', text: `Each child is untargetable for ${ENEMY_BEHAVIOR.splitterSpawnProtection} s and scatters at ${ENEMY_BEHAVIOR.splitterScatterSpeedMult}× speed for ${ENEMY_BEHAVIOR.splitterScatterTime} s before turning toward the tower.` },
    ],
  },
  shielded: {
    tagline: 'Charges block a hit each, and rebuild if you stop shooting.',
    description: `A shield absorbs up to ${ENEMY_DEFS.shielded.shieldCharges} hits. After ${ENEMY_BEHAVIOR.shieldCalmBeforeRegen} s of taking no damage it rebuilds one charge every ${ENEMY_BEHAVIOR.shieldRegenInterval} s. Also ${(ENEMY_DEFS.shielded.magicResist * 100).toFixed(0)}% magic-resistant.`,
    answer: 'Sustained damage — burst damage feeds its regen window and wastes every shot after the first.',
    effects: [
      { name: 'Charges', text: `${ENEMY_DEFS.shielded.shieldCharges} shield charges absorb a hit each.` },
      { name: 'Rebuild', text: `After ${ENEMY_BEHAVIOR.shieldCalmBeforeRegen} s undamaged, restores one charge every ${ENEMY_BEHAVIOR.shieldRegenInterval} s.` },
      { name: 'Magic Resist', text: `Reduces incoming magic damage by ${(ENEMY_DEFS.shielded.magicResist * 100).toFixed(0)}%.` },
    ],
  },
  siege: {
    tagline: 'Halts at 260px and shells the tower. Out-range it or kill it first.',
    description: `Stops just inside the arena range cap at ${ENEMY_BEHAVIOR.siegeStandoff} px and lobs a hostile shell every ${ENEMY_BEHAVIOR.siegeReload} s. The shell takes ${ENEMY_BEHAVIOR.siegeShellTravel} s to land and deals ${ENEMY_BEHAVIOR.siegeShellDamageMult}× the siege's melee damage.`,
    answer: 'Out-range it with a fully range-stacked build, or take it first — its shell will out-DPS your tower if you ignore it.',
    effects: [
      { name: 'Standoff', text: `Halts at ${ENEMY_BEHAVIOR.siegeStandoff} px and will not close the rest of the gap on its own.` },
      { name: 'Shell', text: `Lobs a hostile shell every ${ENEMY_BEHAVIOR.siegeReload} s; it travels for ${ENEMY_BEHAVIOR.siegeShellTravel} s and deals ${ENEMY_BEHAVIOR.siegeShellDamageMult}× melee damage on arrival.` },
    ],
  },
  thief: {
    tagline: 'Steals gold on contact and runs. Kill it and you get double back.',
    description: `Steals ${(ENEMY_BEHAVIOR.thiefStealFraction * 100).toFixed(0)}% of current gold on contact, capped at ${ENEMY_BEHAVIOR.thiefStealWaveGoldMult}× a normal's wave drop per hit and ${(ENEMY_BEHAVIOR.thiefWaveTheftCap * 100).toFixed(0)}% of current gold per wave. While loaded it flees at ${ENEMY_BEHAVIOR.thiefFleeSpeedMult}× speed. Killing a loaded thief pays ${ENEMY_BEHAVIOR.thiefRecoveryMult}× its cargo.`,
    answer: 'Damage — let one escape and you pay twice (the gold and the wave-clear bounty).',
    effects: [
      { name: 'Theft', text: `Steals ${(ENEMY_BEHAVIOR.thiefStealFraction * 100).toFixed(0)}% of current gold on contact, capped at ${ENEMY_BEHAVIOR.thiefStealWaveGoldMult}× a normal's wave drop per hit and ${(ENEMY_BEHAVIOR.thiefWaveTheftCap * 100).toFixed(0)}% of current gold per wave.` },
      { name: 'Flight', text: `While loaded it flees for the arena edge at ${ENEMY_BEHAVIOR.thiefFleeSpeedMult}× speed.` },
      { name: 'Recovery', text: `Killing a loaded thief pays ${ENEMY_BEHAVIOR.thiefRecoveryMult}× its cargo back as bonus gold.` },
    ],
  },
  blinker: {
    tagline: 'Teleports past knockback, mines and the wall. Answer it with damage.',
    description: `Teleports ${ENEMY_BEHAVIOR.blinkDistance} px every ${ENEMY_BEHAVIOR.blinkInterval} s, with ${ENEMY_BEHAVIOR.blinkImmunity} s of knockback and mine immunity after each blink. Also ${(ENEMY_DEFS.blinker.magicResist * 100).toFixed(0)}% magic-resistant.`,
    answer: 'Damage over time and prediction — anything that needs the enemy to stay still is wasted on a blinker.',
    effects: [
      { name: 'Blink', text: `Teleports ${ENEMY_BEHAVIOR.blinkDistance} px every ${ENEMY_BEHAVIOR.blinkInterval} s and is immune to knockback and mines for ${ENEMY_BEHAVIOR.blinkImmunity} s afterwards.` },
      { name: 'Magic Resist', text: `Reduces incoming magic damage by ${(ENEMY_DEFS.blinker.magicResist * 100).toFixed(0)}%.` },
    ],
  },
  warden: {
    tagline: 'Shields five allies at a time. Target priority is the only answer.',
    description: `Projects a regenerating absorb shield worth ${(ENEMY_BEHAVIOR.wardShieldFraction * 100).toFixed(0)}% of its own max HP onto up to ${ENEMY_BEHAVIOR.wardMaxTargets} allies in a ${ENEMY_BEHAVIOR.wardRange} px radius, refreshing every ${ENEMY_BEHAVIOR.wardRefresh} s.`,
    answer: 'Target priority — a warden left alive makes the whole wave twice as hard to kill.',
    effects: [
      { name: 'Ward', text: `Absorb shield worth ${(ENEMY_BEHAVIOR.wardShieldFraction * 100).toFixed(0)}% of its max HP onto up to ${ENEMY_BEHAVIOR.wardMaxTargets} allies in ${ENEMY_BEHAVIOR.wardRange} px. Refreshes every ${ENEMY_BEHAVIOR.wardRefresh} s.` },
    ],
  },
  burrower: {
    tagline: 'Untouchable underground until it surfaces beside the tower.',
    description: `Untargtable and invulnerable underground, moving at ${ENEMY_BEHAVIOR.burrowSpeedMult}× speed. Surfaces for ${ENEMY_BEHAVIOR.burrowTelegraph} s at ${ENEMY_BEHAVIOR.burrowSurfaceDistance} px from the tower before meleeing.`,
    answer: 'AoE at the surface point — single-target towers will miss the window while it telegraphs.',
    effects: [
      { name: 'Burrow', text: `Untargtable underground, moving at ${ENEMY_BEHAVIOR.burrowSpeedMult}× speed.` },
      { name: 'Surface', text: `Surfaces for ${ENEMY_BEHAVIOR.burrowTelegraph} s at ${ENEMY_BEHAVIOR.burrowSurfaceDistance} px from the tower, then melee attacks.` },
    ],
  },
};

/**
 * Draw weights for the non-boss spawn pool (gameplay plan §2.4).
 *
 * The single source of truth: `WaveManager.pickEnemyType`, the wave-average
 * estimates in `SaveManager` (offline progress) and `sim/model.ts` all read
 * this table. It used to be written out three times, which is exactly how a
 * balance change lands in the game and not in the model that is supposed to be
 * measuring it.
 *
 * The five behavioural types *replace* slots rather than adding them — `normal`
 * dropped 6→5 and `splitter` 2→1 to pay for them — because §2.6 requires total
 * wave HP not to rise. `boss` is 0: boss waves bypass the pool entirely.
 */
export const ENEMY_SPAWN_WEIGHTS: Record<EnemyType, number> = {
  normal: 5,
  fast: 3,
  tank: 2,
  flying: 2,
  splitter: 1,
  healer: 1,
  shielded: 1,
  siege: 2,
  thief: 1,
  blinker: 2,
  warden: 1,
  burrower: 2,
  boss: 0,
};

/** Types with a non-zero weight that have unlocked by `wave`, in table order. */
export function spawnPoolForWave(wave: number): Array<{ type: EnemyType; weight: number }> {
  const out: Array<{ type: EnemyType; weight: number }> = [];
  for (const type of Object.keys(ENEMY_SPAWN_WEIGHTS) as EnemyType[]) {
    const weight = ENEMY_SPAWN_WEIGHTS[type];
    if (weight <= 0) continue;
    if (wave < ENEMY_DEFS[type].unlockWave) continue;
    out.push({ type, weight });
  }
  return out;
}
