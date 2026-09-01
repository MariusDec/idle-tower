import type { TargetingMode, TowerState } from '../types';
import { entity, world } from './arena';
import { FX, INK } from './palette';

export const TOWER_BASE: Omit<TowerState, 'cooldown'> = {
  x: 0,
  y: 0,
  baseDamage: 0,
  /*
   * The shot-cadence rebase (`plans/firerate.md`).
   *
   * Fire rate used to pass 4 shots/s inside a day of play and cap at 5.5. The
   * cap is now 3.15 (0.9 + 45 x 0.05) and the `damage` upgrade is 1.2x to pay
   * part of it back. It is deliberately only *part*: sustained DPS lands ~30%
   * below today at high rate levels and ~8% above it on a fresh tower.
   *
   * 0.9 and not 0.45. Because `baseDamage` seeds at 0 and `fireRate` seeds at
   * this value, an exact halving of the whole curve would need the base halved
   * too — and that costs the opener two full seconds between shots. 0.9 keeps
   * the opening cadence and pays for it in late-game DPS, which is the trade
   * §0.3 of the plan measured and chose.
   */
  fireRate: 0.9,
  range: 300,
  critChance: 0.02,
  critMultiplier: 2,
  doubleShotChance: 0,
  quickShotChance: 0,
  quickShotTime: 0,
  damageType: 'physical',
  targetingMode: 'priority',
  hp: 0,
  maxHp: 0,
  healthRegen: 0,
  defense: 0,
  armor: 0,
  knockbackForce: 0,
  shockwaveSize: 0,
  shockwaveCooldown: 0,
  shockwaveTimer: 0,
  lifesteal: 0,
  thorns: 0,
  landMineDamage: 0,
  landMineFrequency: 0,
  landMineTimer: 0,
  wallHp: 0,
  wallMaxHp: 0,
  shieldMaxCharges: 0,
  shieldCurrentCharges: 0,
  shieldRechargeTimer: 0,
  shieldRechargeTime: 0,
};

export const PROJECTILE_SPEED = world(720);

/**
 * Seeker steering (`plans/homing.md`).
 *
 * A homing shot owns its own targeting: the volley's target is only its launch
 * heading, and from there it hunts the nearest enemy it is already flying at.
 * Three of these numbers exist purely so that Scatter Shot and Rear Guard stay
 * *different perks* while Seeker Shots is drafted — `spreadDelay`,
 * `spreadLaunchBoost` and `acquireCone` are what stop every lane from folding
 * onto the same enemy within three frames and turning both perks into Twin
 * Arrows.
 *
 * Sizing note: at `PROJECTILE_SPEED` (1872 u/s) a shot crosses half the arena's
 * short axis in 0.5 s, so every duration here is a fraction of a *quarter* of a
 * flight, not of a flight.
 */
export const HOMING = {
  /**
   * Default steering rate, rad/s. Halved from `Math.PI * 2.2` so a homing shot
   * traces a circle roughly twice as wide: at the old rate it could wheel back
   * onto the field and farm enemies from every angle, which made pierce far
   * stronger than the straight-line shot it is priced against.
   */
  turnRate: Math.PI * 1.1,
  /** Seconds over which the turn eases from 0 to `turnRate` once steering starts. */
  ramp: 0.28,
  /** Extra straight-flight seconds a *fully spread* lane gets before steering. */
  spreadDelay: 0.16,
  /** Launch speed multiplier of a fully spread lane. */
  spreadLaunchBoost: 1.55,
  /** `|angleOffset|` at which a lane counts as fully spread, in radians (45°). */
  spreadFullAngle: Math.PI / 4,
  /** Time constant for the launch boost bleeding back to `PROJECTILE_SPEED`. */
  speedSettle: 0.30,
  /** Radius searched for a target, world units (two thirds of the short axis). */
  seekRadius: world(620),
  /** Half-angle of the acquisition cone around the current heading (75°). */
  acquireCone: (75 * Math.PI) / 180,
  /** Seconds between opportunistic re-scans while the current target is fine. */
  retargetInterval: 0.12,
  /**
   * How much closer a rival must be to steal a *still-valid* target: squared
   * distance below `switchMargin²` of the current one. Pure hysteresis — without
   * it a shot flying between two enemies dithers and hits neither.
   */
  switchMargin: 0.75,
  /** Straight-flight seconds for a clicked (manual-aim) volley. */
  manualDelay: 0.10,
  /** Straight-flight seconds for the charged shot. */
  chargedDelay: 0.20,
  /** The charged shot steers at this fraction of `turnRate` — it stays a skill shot. */
  chargedTurnScale: 0.6,
} as const;

/**
 * Ricochet deflection (`plans/bounce.md` §3.1).
 *
 * A bounce is not a new steering mode — it re-aims an existing projectile and
 * then hands it to `steerHoming`, so everything here is about *choosing* the
 * next body and about how long the shot has to reach it.
 */
export const BOUNCE = {
  /**
   * Half-angle of the forward cone a bounce prefers, in radians (100°).
   *
   * Wide, because a deflection is not a turn: anything roughly ahead of the
   * shot should be reachable without the ricochet reading as a U-turn.
   */
  cone: (100 * Math.PI) / 180,
  /**
   * Squared-distance penalty on a candidate *behind* the shot. 2.25 = a 1.5x
   * handicap on real distance, so a body behind is only taken when it is
   * clearly the closest thing on the field.
   */
  backPenalty: 2.25,
  /** Candidates closer than this are skipped; guards degenerate headings. */
  minDistance: world(10),
  /**
   * Steering rate a bounced shot gets, rad/s. Sharper than `HOMING.turnRate`
   * because the bounce already aimed it — this is tracking, not hunting.
   */
  turnRate: Math.PI * 2.4,
  /**
   * Seconds a bounced shot lives, measured from the bounce. The longest legal
   * bounce (1053 units with `ricochet_power`) takes 0.56 s at
   * `PROJECTILE_SPEED`, so this is flight plus a margin and never a cap the
   * player feels.
   */
  lifetime: 0.9,
} as const;

/**
 * Splinter shards (`plans/bounce.md` §3.3).
 *
 * A shard is a small, fast, hard-turning seeker with a short leash. The fan is
 * what makes it read as shrapnel: it leaves the corpse sideways and curves in,
 * rather than teleporting damage onto a neighbour.
 */
export const SHARD = {
  /** Launch and cruise speed. */
  speed: PROJECTILE_SPEED * 0.75,
  /** Steering rate, rad/s. High: it has to recover from the launch fan fast. */
  turnRate: Math.PI * 3.2,
  /** Seconds a shard lives. Covers `splitShardRange` with room to spare. */
  lifetime: 0.85,
  /** Angle between adjacent shard launch headings, in radians (34°). */
  fan: (34 * Math.PI) / 180,
} as const;

/**
 * How the tower is built, in world units and palette colours (UI plan §3.3).
 *
 * Before this the tower was a grey circle (`#5b6b7a`), a brown triangle "roof"
 * and a three-point red flag — five literal colours and three numbers. It is
 * the player's avatar and the only thing on screen that is unambiguously
 * *theirs*, and at the Part 1 zoom level it read as a token on a board.
 *
 * Three things drive every number below:
 *
 * - **One key light.** `lightAngle` is up-and-slightly-left, and every rim
 *   light, band highlight and cast shadow in `Renderer` derives from it. A
 *   consistent light is most of what separates "drawn" from "assembled from
 *   primitives".
 * - **Amber is the player.** The rim light, the banners and the turret's
 *   banding are `FX.gold`; the stone is the `INK` ramp the ground is made of.
 *   The old red flag is gone — red belongs to the enemy now
 *   (`docs/art-direction.md`).
 * - **Levelling is visible.** `detailTiers` are tower-XP levels, not upgrade
 *   counts: crossing one adds merlons, then banners, then an arcane ring, so
 *   the silhouette itself says how far into the run you are.
 */
export const TOWER_VISUAL = {
  /** The masonry drum. Also what `Game` measures floating text against. */
  bodyRadius: entity(28),
  /** Stone footing the drum stands on; wider, so the tower has a base. */
  plinthRadius: entity(37),
  /** Reach of the contact shadow the tower casts on the ground. */
  shadowRadius: entity(54),
  /** Where the segmented wall ring sits, from the tower centre. */
  wallRadius: entity(28) + world(40),
  /** Blocks in the wall ring. Each one crumbles on its own as `wallHp` drops. */
  wallSegments: 16,
  /** Radius of the faceted shield barrier. Outside the plinth, inside the wall. */
  shieldRadius: entity(47),
  /** Turret barrel: how far it reaches from the tower centre, and how wide. */
  turretLength: entity(31),
  turretWidth: entity(9),
  /** World units the barrel slides back on firing, and how long it takes. */
  recoilDistance: entity(7),
  recoilTime: 0.17,
  /** Seconds the muzzle flash lives. */
  muzzleTime: 0.075,
  /** Radius of the core crystal in the tower's mouth. */
  crystalRadius: entity(8),
  /** Key light direction, radians. Up and a little to the left. */
  lightAngle: -Math.PI * 0.62,
  /**
   * Tower-XP levels at which the silhouette gains a tier of detail. Index into
   * this is the tier: below `[1]` is tier 0, and so on.
   */
  detailTiers: [0, 10, 25, 50] as const,
  /** Stone, lit face to deep shadow. */
  stoneLit: INK['300'],
  stoneMid: INK['400'],
  stoneDark: INK['600'],
  stoneDeep: INK['700'],
  mortar: INK['800'],
  /**
   * The footing's base disc, one step lighter than the drum's shadow so the
   * gaps between its kerb blocks read as mortar rather than as holes.
   */
  plinth: INK['500'],
  /** Rim light and every piece of trim the player owns. */
  rim: FX.gold,
  /** Banner cloth at tier 2 and above. */
  banner: FX.gold,
  /** Shield barrier and its charge pips. */
  shield: FX.frost,
} as const;

export const TOWER_HIT_RADIUS = TOWER_VISUAL.bodyRadius + entity(4);

/**
 * Targeting modes, in the order they are offered (gameplay plan §2.3).
 *
 * Shared by the HUD dropdown and the Settings panel so the two cannot drift.
 * `priority` leads because it is the default and, with the behavioural roster
 * on the field, the correct answer most of the time. Every mode locks onto its
 * chosen target until it dies or leaves range (docs/tower-system.md#lock-on).
 */
export const TARGETING_MODES: ReadonlyArray<{ id: TargetingMode; label: string; hint: string }> = [
  { id: 'priority', label: 'Priority', hint: 'Warden → Healer → Thief → Siege, then nearest' },
  { id: 'nearest', label: 'Nearest', hint: 'Closest enemy, locked on until it dies' },
  { id: 'lowest_hp', label: 'Lowest HP', hint: 'Finish wounded enemies first' },
  { id: 'strongest', label: 'Strongest', hint: 'Highest max HP in range' },
  { id: 'boss', label: 'Boss first', hint: 'Bosses before anything else' },
  { id: 'flying', label: 'Flying first', hint: 'Flying enemies before anything else' },
  { id: 'last', label: 'Furthest', hint: 'Backline first — hits them for longer' },
];

/**
 * Manual aim and the charged shot (gameplay plan §4.2).
 *
 * One table, read by `Game` *and* by `sim/model.ts`, because the idle-parity
 * check in §4.5 is only meaningful if the number the sim measures is the
 * number the game ships. It lived in two places for exactly as long as it took
 * to notice that a cut to the multiplier would have to be made twice.
 *
 * The two timers are **wall-clock** by design. A 1.2 s hold that becomes
 * 0.18 s at 6.5x speed is not "hold still", and a 4 s cooldown that becomes
 * 0.6 s would make the charged shot six times stronger the moment the
 * Accelerator perk is bought — which is the opposite of what an idle game
 * should reward.
 */
export const MANUAL_AIM = {
  /*
   * There is deliberately no `fireRateMult` here any more.
   *
   * Holding used to be worth a flat x1.3 fire rate, which the gameplay plan's
   * §0.1 named as the game's first design problem: holding was strictly better
   * than not holding, so it was a tax on attention rather than a choice. The
   * §4.5 measurement made the cost concrete — manual aim alone filled the
   * entire active-play budget (+33.9…+38.9%) before the charged shot added
   * anything, which is why §4.2 specified replacing it rather than stacking on
   * top of it.
   *
   * What holding buys now is the charge below, and it is a genuine trade: while
   * the button is down the tower fires at the cursor instead of auto-acquiring,
   * so a player who holds and never releases is *worse* off than one who never
   * touches the mouse. That is the shape a choice has.
   */
  /** Seconds the cursor must be held still to arm the shot. */
  chargeSeconds: 1.2,
  /** Seconds before another charge can be armed. */
  chargeCooldown: 4,
  /**
   * The charged shot's payload, denominated in **seconds of the tower's own
   * sustained fire**: damage = one shot x current fire rate x this.
   *
   * §4.2 specifies a flat 6x one shot, and Part 4 measured that at +127% and
   * cut it to 1x. Both numbers are answers to the wrong question. A flat
   * multiple of *one shot* is worth `1/fireRate` of the tower's output, so the
   * same constant measured +57% at a fresh tower's 1.8 shots/s and +10% at a
   * late one's 6.1 — the verb decayed into irrelevance exactly where the
   * player has the most fire rate to give up by holding still.
   *
   * Pricing the charge in seconds-of-DPS holds its worth flat across every
   * prestige tier, and it reads as what it is: holding still surrenders ~1.2 s
   * of tracked fire, and the charge pays that back with interest.
   *
   * Because it multiplies the *composed* fire rate, it also scales with
   * Berserk and quick-shot rather than being diluted by them.
   */
  chargeDpsSeconds: 0.9,
  /** Extra targets the charged shot pierces. */
  chargeExtraPierce: 3,
  /** Splash radius on impact, and what everything else in it takes. */
  chargeSplashRadius: world(90),
  chargeSplashFraction: 0.6,
  /**
   * How far the cursor may wander and still count as held still.
   *
   * Generous on purpose: the touch pipeline feeds the same path, and a
   * fingertip on a canvas scaled down to phone width jitters several canvas
   * units without the player intending to move at all.
   */
  chargeMoveTolerance: world(18),
} as const;
