import type { RenderSnapshot, Enemy, HostileShot, Projectile, Particle, ParticleLayer, DamageNumber, Shockwave, Mine, AuraType, LootOrb, BossIntroView } from '../types';
import { LOOT_ORB_COLORS, LOOT_TUNING, type LootOrbKind } from '../data/loot';
import { ARENA, ARENA_RANGE_CAP, entity, world } from '../data/arena';
import type { Camera } from './Camera';
import { TOWER_VISUAL } from '../data/tower';
import { DEFAULT_TOWER_MARKS, type TowerMarks } from '../data/towerMarks';
import { CORE_BY_ID, DEFAULT_CORE, isCoreId, type CoreId } from '../data/cores';
import { FX, INK, lighten, mix, withAlpha } from '../data/palette';
import { DEFAULT_QUALITY, QUALITY, type QualityProfile, type QualityTier } from '../data/quality';
import { BOSS_ENCOUNTER, ENEMY_BEHAVIOR, ENEMY_DEFS, ENEMY_GAIT, bossTierForWave } from '../data/enemies';
import type { EnemyDef, EnemyShape } from '../data/enemies';
import { isBossWave } from '../data/formulas';
import { formatWithOptionalDecimal } from '../utils/bigNumber';
import { ELITE_AURA_COLORS, AURA_RADIUS } from '../systems/EnemyManager';

/** How much larger an elite renders than a normal enemy of the same type. */
const ELITE_RADIUS_SCALE = 1.25;

/** Frame step every animation in this file advances on. See `Renderer.time`. */
const FRAME_DT = 1 / 60;

/**
 * The Part 2 display face, as one string, kept byte-identical to
 * `--font-display` in `src/styles/tokens.css`. Damage numbers are exactly what
 * a condensed face was self-hosted for; the canvas cannot read a custom
 * property, so the stack is declared once here rather than at every `ctx.font`.
 */
const DISPLAY_FONT_STACK =
  "'Oswald', 'Arial Narrow', 'Roboto Condensed', 'Helvetica Neue Condensed', " +
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, " +
  "'Helvetica Neue', Arial, sans-serif";

/** Damage-number type sizes in CSS pixels, by `damageTier()` bucket (§5.B). */
const DMG_SIZE_BY_TIER = [15, 18, 22, 28];
/**
 * The tower's own numbers, and gold pickups, are pinned to a flatter ramp: a
 * chip off the tower must never out-shout the damage the player is dealing.
 */
const DMG_SIZE_BY_TIER_SELF = [15, 15, 17, 19];
const DMG_CRIT_SIZE_SCALE = 1.28;
/** Seconds spent growing, then seconds easing back to rest. */
const DMG_POP = 0.09;
const DMG_SETTLE = 0.13;

/** The standard `easeOutBack`, overshoot 1.70158, written out. */
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

/** 0.62 → ~1.15 → 1.00: the pop, then the settle. */
function popScale(age: number): number {
  if (age < DMG_POP) return 0.62 + 0.53 * easeOutBack(age / DMG_POP);
  if (age < DMG_POP + DMG_SETTLE) return 1.15 - 0.15 * ((age - DMG_POP) / DMG_SETTLE);
  return 1.0;
}

// ── §3.1 ground ───────────────────────────────────────────────────────────────

/** Edge of the concentric-arc lattice: just past the furthest range can reach. */
const LATTICE_OUTER = ARENA_RANGE_CAP * 1.18;
/** Spacing of the lattice arcs, in world units. */
const LATTICE_STEP = world(90);
/** Radial spokes in the lattice. */
const LATTICE_SPOKES = 12;
/** Embers and stars scattered across the far field, per million device pixels. */
const STAR_DENSITY = 46;
/** Side of the seeded noise tile the terrain is built from, in device pixels. */
const NOISE_TILE = 128;
/** Cracks radiating out of the tower's footing. */
const CRACK_COUNT = 13;

// ── §3.2 range ring ───────────────────────────────────────────────────────────

/** Radius the normalised falloff sprite is baked at, in pixels. */
const RANGE_SPRITE_RADIUS = 256;
/** Seconds the ring takes to ease to a new `range`. */
const RANGE_EASE_TIME = 0.4;
/** Seconds the "your range just changed" bloom lives for. */
const RANGE_BLOOM_TIME = 0.75;
/** Radians per second the rim's highlight sweep travels. */
const RANGE_SWEEP_SPEED = 0.5;
/** Trailing segments behind the sweep head. */
const RANGE_SWEEP_SEGMENTS = 7;

// ── §3.4 spawn portals ────────────────────────────────────────────────────────

/** Seconds an enemy's rift emergence plays for. */
const EMERGENCE_TIME = 0.4;
/** Ceiling on concurrent emergences. Pooled, like every other effect here. */
const EMERGENCE_CAP = 64;
/** Seconds a rift takes to open, and to close once the lane list empties. */
const PORTAL_OPEN_TIME = 0.45;
/**
 * How close to the spawn ellipse an enemy has to appear for it to count as
 * having come through a rift.
 *
 * Splitter children and summoned adds appear mid-field; they did not walk out
 * of a portal and giving them one would teach the player that a rift means
 * nothing. Measured in the ellipse's own normalised radius, where 1.04 is the
 * spawn ring itself (`ARENA.spawnRingScale`).
 */
const EMERGENCE_MIN_ELLIPSE = 0.88;
/** Slack around a body sprite so its outline stroke is not clipped. */
const SPRITE_PADDING = entity(6);
/**
 * Shapes this renderer knows how to paint (gameplay plan §2.5).
 *
 * Exported so `content-coverage.test.ts` can assert that every `EnemyType`'s
 * declared shape is one of them — `tsc` already rejects a missing case in
 * `paintEnemyBody`, but nothing else stops a type being given a shape string
 * that compiles and draws nothing.
 */
export const RENDERED_ENEMY_SHAPES: readonly EnemyShape[] =
  ['circle', 'diamond', 'winged', 'square', 'hex', 'mound'];

/** Seconds a blinker's after-image lingers at the position it left. */
const AFTER_IMAGE_LIFE = 0.45;

// ── §4.2 motion and reaction ──────────────────────────────────────────────────

/** Seconds an enemy's hit flash lives. */
const HIT_FLASH_TIME = 0.06;
/** Seconds a death dissolve plays for. */
const DEATH_TIME = 0.36;
/** Ceiling on concurrent death dissolves. Pooled, like every other effect here. */
const DEATH_CAP = 40;
/** Shards flung out of one death. */
const DEATH_SHARDS = 4;
/** Gait multiplier while an enemy is chilled or slowed. */
const SLOWED_GAIT = 0.4;

/**
 * Per-enemy presentation state, keyed by enemy id.
 *
 * Everything here is *derived from the snapshot*, never pushed into it: a hit
 * is "this enemy's `hp` is lower than it was last frame", exactly the way the
 * turret learns it fired from the projectile list rather than from a
 * presentation field bolted onto the simulation.
 */
interface EnemyTrack {
  hp: number;
  /** Seconds of hit flash left. */
  flash: number;
  /** Frame stamp, so a vanished enemy can be spotted in one pass. */
  seen: number;
  x: number;
  y: number;
  /** Last body sprite drawn for it, so its death has something to dissolve. */
  sprite: HTMLCanvasElement | null;
  color: string;
  r: number;
}

// ── §4.3 projectiles and impacts ──────────────────────────────────────────────

/** Seconds a ground decal takes to fade out. */
const DECAL_TIME = 2;
/** Seconds the spark cone at an impact lives. */
const SPARK_TIME = 0.18;
/** Sparks thrown out of one impact. */
const SPARK_COUNT = 7;
/** Radius the ground decal is baked at. Drawn scaled, never re-baked. */
const DECAL_BAKE_RADIUS = entity(46);

/**
 * How a core's shots look (§4.3).
 *
 * A core is the run's identity — it is chosen before the first blessing and it
 * changes what every shot the tower fires actually *does* — and until Part 3
 * the only place it appeared during play was the crystal's tint. The shots
 * themselves were one gold arrowhead and one violet blob for the whole game.
 *
 * There are six core behaviours and five cores, and the mapping is not one to
 * one, because three of the six are not about a shot at all:
 *
 * | Behaviour | Where it shows |
 * |---|---|
 * | `splash_shots` (artillery) | the shell head, and a wide scorch on impact — read off the projectile's own `splashRadius`, so a Mortar blessing shot gets it too |
 * | `chill_shots` (frostwork) | the frost shard and its rime trail |
 * | `mana_shot` (arcane) | the proc lands as `damageType: 'magic'`, so it is painted by the magic path — every fifth shot is visibly a different shot |
 * | `kill_heal`, `desperate_tempo` (bloodforge) | the blood-lit bolt and its ember drip |
 * | `nova_extended` (frostwork) | nothing: it doubles an *ability's* duration and has no shot |
 *
 * A `Record` over `CoreId`, so a new core cannot ship firing the default bolt
 * by omission.
 */
const SHOT_STYLES: Record<CoreId, {
  /** Head shape. `bolt` is fletched, `shell` is blunt and heavy, `shard` is a crystal. */
  head: 'bolt' | 'shell' | 'shard';
  /** Trail length as a multiple of the head's length. */
  trail: number;
  /** The colour the trail burns in. The head is always the core's own colour. */
  glow: string;
}> = {
  marksman: { head: 'bolt', trail: 3.4, glow: FX.gold },
  artillery: { head: 'shell', trail: 2.6, glow: FX.ember },
  frostwork: { head: 'shard', trail: 3.8, glow: FX.frost },
  bloodforge: { head: 'bolt', trail: 3, glow: FX.blood },
  arcane: { head: 'bolt', trail: 3.6, glow: FX.arcane },
};

/** Length of a projectile head, before the per-core shape stretches it. */
const BOLT_LENGTH = entity(9);

// ── §4.4 muzzle and tracers ───────────────────────────────────────────────────

/**
 * Shots per second above which tracers take over.
 *
 * Below this the bolts themselves are individually legible and a tracer would
 * be a second line drawn over one you can already see. Above it they blur into
 * a stream, and the tracer is what makes the stream read as *shots* rather than
 * as a smear — which is the whole point of §4.4: a maxed tower should feel
 * maxed. Base `fireRate` is 1.0, so this is a genuinely invested build.
 */
const TRACER_FIRE_RATE = 5;
/** Seconds a tracer lives. Two frames at 60 fps, so a dropped frame does not eat it. */
const TRACER_TIME = 0.035;
/** Ceiling on live tracers. A Rocket Barrage fan is a handful; this is the safety net. */
const TRACER_CAP = 16;
/** How far a tracer reaches from the muzzle, in world units. */
const TRACER_LENGTH = world(230);

// ── §5.C the combo flourish ───────────────────────────────────────────────────

/**
 * Eased intensity target per combo tier (0..4).
 *
 * The tiers themselves are `COMBO_TIERS` in `src/data/pacing.ts`; this is only
 * how loud each one is allowed to be on the battlefield.
 */
const COMBO_INTENSITY = [0, 0.28, 0.5, 0.75, 1];
/** Embers spawned per second at full glow. */
const EMBER_RATE = 14;
/** Peak alpha of the baked edge glow, at `comboGlow === 1`. */
const COMBO_EDGE_ALPHA = 0.22;

/** A drifting ember thrown off by a running combo (§5.C). Pooled at the quality profile's `embers`. */
interface ComboEmber {
  x: number;
  y: number;
  /** World units per second, negative: embers rise. */
  vy: number;
  age: number;
  life: number;
  size: number;
}

/** A one-frame line of fire from the muzzle (§4.4). Pooled. */
interface Tracer {
  angle: number;
  age: number;
}

/** An impact: a ground decal that fades over 2 s and a spark cone that does not. */
interface Impact {
  x: number;
  y: number;
  /** Direction of travel at the moment of the hit; the sparks cone back along it. */
  angle: number;
  age: number;
  /** Blast radius the shot carried, in world units. 0 for an ordinary hit. */
  splash: number;
  magic: boolean;
}

/** A shot the renderer is watching, so it can tell a hit from a bounds cull. */
interface ShotTrack {
  x: number;
  y: number;
  vx: number;
  vy: number;
  splash: number;
  magic: boolean;
  seen: number;
}

/** A body coming apart along the killing blow's vector (§4.2). Pooled. */
interface Death {
  x: number;
  y: number;
  /** Unit vector the body and its shards travel along. */
  vx: number;
  vy: number;
  age: number;
  sprite: HTMLCanvasElement | null;
  color: string;
  r: number;
}

/**
 * Everything that makes one baked body sprite different from another (§4.1).
 *
 * The cache key is built from exactly these fields, so anything that varies per
 * enemy *instance* rather than per variant must not be in here — it belongs in
 * the live pass (see `docs/performance.md`'s sprite-cache invariant).
 */
interface BodyVariant {
  enraged: boolean;
  buried: boolean;
  elite: boolean;
  aura: AuraType | null;
  /** Index into `BOSS_PROFILES`; 0 and unused for everything that is not a boss. */
  silhouette: number;
}

/**
 * Boss silhouettes, one family per boss tier, cycled (§4.1).
 *
 * A boss was `shape: 'circle'` with `radius` 30 and a red aura — which is to
 * say a big circle, wave 10 through wave 200. It still declares `'circle'`
 * because `RENDERED_ENEMY_SHAPES` is the contract every *type* is held to, but
 * it is painted from here instead: a radius function sampled around the body,
 * so five genuinely different outlines cost one painter and five cache entries.
 *
 * Every profile stays inside `radius`, so a new silhouette can never quietly
 * change how big a boss looks relative to its hitbox.
 */
const BOSS_PROFILES: ReadonlyArray<{
  samples: number;
  sx: number;
  sy: number;
  radius: (i: number, n: number) => number;
}> = [
  // Sentinel — a six-point spiked shell.
  { samples: 12, sx: 1, sy: 1, radius: (i) => (i % 2 === 0 ? 1 : 0.72) },
  // Overseer — a round carapace carrying four horns.
  { samples: 16, sx: 1, sy: 0.98, radius: (i) => (i % 4 === 2 ? 1 : 0.8) },
  // Colossus — a wide, flat slab. Broader than it is tall, and it reads heavy.
  { samples: 8, sx: 1.16, sy: 0.8, radius: () => 1 },
  // Devourer — a ragged, asymmetric maw. Deterministic, not random: the same
  // tier must bake the same outline every time.
  {
    samples: 18,
    sx: 1,
    sy: 1,
    radius: (i) => 0.62 + 0.38 * (((Math.imul(i + 1, 2654435761) >>> 0) % 1000) / 1000),
  },
  // Harbinger — a three-lobed crest.
  {
    samples: 24,
    sx: 0.94,
    sy: 1.06,
    radius: (i, n) => 0.7 + 0.3 * Math.abs(Math.cos(((i / n) * Math.PI * 2 - Math.PI / 2) * 1.5)),
  },
];

/** Solid crown colours, one per aura (the aura fills are translucent). */
const ELITE_CROWN_COLORS: Record<AuraType, string> = {
  haste: FX.frost,
  thorns: FX.ember,
  greed: FX.gold,
  vitality: FX.nature,
  retribution: FX.arcane,
};

/**
 * A tiny deterministic PRNG (mulberry32).
 *
 * The ground is *seeded*, not random: the same viewport and the same core must
 * bake the same stars, the same blotching and the same cracks every time, or a
 * resize would silently redraw the world into a different one. `Math.random`
 * cannot do that, and a full noise library is four hundred lines for the four
 * calls this file makes.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap string hash, so a core id can seed the ground. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** `t` in 0..1 → eased. Fast at the start, settled at the end. */
function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

/** A rift an enemy is coming through (§3.4). Pooled — never allocated per frame. */
interface Emergence {
  x: number;
  y: number;
  age: number;
  /** Direction the enemy is heading, so the rift faces the right way. */
  angle: number;
}

/** Per-frame presentation extras `Game` hands the renderer. */
interface RenderOptions {
  screenFlash?: number;
  towerFlash?: number;
  wallFlash?: number;
  shieldFlash?: number;
  vignette?: number;
  chainPaths?: { points: { x: number; y: number }[]; age: number; life: number }[];
}


export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly camera: Camera;
  private readonly rangeOverlay: boolean = true;
  /**
   * `prefers-reduced-motion`.
   *
   * Everything in Part 3 that *loops* — the crystal's breath, the range ring's
   * sweep, the arcane ring at detail tier 3, the rift swirl — holds still when
   * this is set. Event-driven motion (the recoil, the range bloom, a rift
   * opening) stays: it is feedback for something the player just did, and
   * removing it would remove the information rather than the motion.
   */
  private readonly reducedMotion: boolean;
  private time = 0;
  private bgCanvas: HTMLCanvasElement | null = null;
  /** World scale the background was baked at, so a zoom change re-bakes it. */
  private bgScale = 0;
  /** Core the ground was baked for; a new core re-tints the wash and the embers. */
  private bgCore: CoreId | null = null;
  /** The seeded terrain tile, baked once and tiled as a pattern. */
  private noiseTile: HTMLCanvasElement | null = null;

  // ── §3.2 range ring animation ──
  /** Radius actually drawn this frame; eases toward `rangeTo`. */
  private rangeDrawn = 0;
  private rangeFrom = 0;
  private rangeTo = 0;
  /** Ease progress, 0..1. */
  private rangeEase = 1;
  /** Bloom left on a range change, 1 → 0. */
  private rangeBloom = 0;

  // ── §3.3 turret ──
  /** Where the barrel is pointing. Chases the last shot's heading. */
  private turretAngle = -Math.PI / 2;
  /** Recoil, 1 at the instant of firing, 0 once the barrel is home. */
  private recoil = 0;
  /** Muzzle flash, 1 → 0 over `TOWER_VISUAL.muzzleTime`. */
  private muzzle = 0;
  /**
   * How many shots went into the flash currently burning down (§4.4).
   *
   * A volley of scatter and back shots — or a Rocket Barrage fan — empties
   * five or six bolts in one substep, and one flash of a fixed size for all of
   * them is the same flash a single-shot tower gets. This scales it.
   */
  private muzzleBurst = 1;
  /** Live tracers (§4.4). Pooled at `TRACER_CAP`. */
  private readonly tracers: Tracer[] = [];
  /**
   * Highest projectile id seen.
   *
   * The tower firing is not in the render snapshot and putting it there would
   * mean the simulation carrying a presentation field. Every projectile in the
   * game leaves the tower, ids come from a monotonic counter and the list is
   * append-ordered — so "is there an id above the last one I saw, starting at
   * the tower" is an exact read of "did we just fire, and where at".
   */
  private lastProjectileId = -1;

  // ── §3.4 spawn portals ──
  private readonly emergences: Emergence[] = [];
  /** Highest enemy id seen, for spotting arrivals. */
  private maxEnemyId = -1;
  /** False until the first frame has been observed, so a save load is not a wave. */
  private enemyIdSeeded = false;
  /** Rift opening, 0..1. Rises while lanes are previewed, falls after. */
  private portalOpen = 0;
  /** The last previewed lanes, kept so the rifts can close after the wave starts. */
  private portalLanes: Array<{ x: number; y: number }> = [];
  /**
   * Pre-rendered sprites (plan §5.1).
   *
   * Enemy bodies, ground shadows and every aura glow used to be built from
   * scratch on the canvas each frame — `createRadialGradient` alone ran once
   * per shadow, once per boss/healer/elite aura and once per magic
   * projectile, so a wave of 240 enemies allocated several hundred gradient
   * objects every frame before drawing anything. All of it is static per
   * (type, variant), so it is painted once into an offscreen canvas and
   * blitted afterwards.
   *
   * Only genuinely per-enemy animation stays live: the wing flap, the
   * boss/splitter pulse and the shield arcs, none of which allocate.
   */
  private readonly enemySprites = new Map<string, HTMLCanvasElement>();
  private readonly shadowSprites = new Map<string, HTMLCanvasElement>();
  private readonly auraSprites = new Map<string, HTMLCanvasElement>();
  private readonly crownSprites = new Map<string, HTMLCanvasElement>();
  /**
   * Orb bodies, one sprite per kind (gameplay plan §4.1 / §6 performance).
   *
   * An orb is a glow, a body and a glyph — three fills and a gradient each, and
   * a boss pack can put a couple of dozen on screen at once. All of it is
   * static per kind, so it is painted once and blitted with a pulse scale,
   * exactly like the enemy auras.
   */
  private readonly orbSprites = new Map<LootOrbKind, HTMLCanvasElement>();
  /**
   * Everything Part 3 bakes: the tower's plinth, drum, turret and crystal, the
   * wall's three block states, the range ring's falloff, the rift and its dust
   * ring, and the three damage flashes.
   *
   * One map with a string key rather than six typed ones, because every entry
   * has the same shape — a variant key and a painter — and the variant space is
   * tiny: at most a couple of dozen sprites for the whole battlefield, all of
   * them baked on first use and none re-baked while the run lasts.
   */
  private readonly partSprites = new Map<string, HTMLCanvasElement>();
  /**
   * Sprites whose art depends on the tower's upgrade marks
   * (`plans/tower-ui.md` §C).
   *
   * Kept apart from `partSprites` because the key space is *combinatorial*
   * while the number of keys live at any one time is exactly one per family.
   * `partSprites` never evicts — correct there, a leak here. So the whole map
   * is dropped the moment `towerSig` moves, and the five tower painters rebake
   * lazily on the next frame.
   */
  private readonly towerSprites = new Map<string, HTMLCanvasElement>();
  /**
   * The marks the tower is currently painted from. Replaced by reference at
   * the top of `draw`; the painters read it instead of threading a parameter
   * through five call sites.
   */
  private marks: TowerMarks = DEFAULT_TOWER_MARKS;
  /** `marks.key` + core + detail tier — everything the tower's art depends on. */
  private towerSig = '';
  /**
   * Tower position from the frame currently being drawn.
   *
   * Cached at the top of `draw` so the boss siphon beam has somewhere to point.
   * Read-only presentation state — the enemy loop must not reach back into the
   * simulation for it.
   */
  private towerX = 0;
  private towerY = 0;
  /**
   * Wave number from the frame being drawn.
   *
   * Only used as the fallback for a boss whose `spawnWave` is missing (an old
   * save), so its silhouette family can still be resolved.
   */
  private wave = 1;

  // ── §4.2 motion and reaction ──
  private readonly tracks = new Map<number, EnemyTrack>();
  private readonly deaths: Death[] = [];
  /** Incremented once per frame; a track not stamped with it has left the field. */
  private frameStamp = 0;

  // ── §5.C the combo flourish ──
  /** Eased combo intensity, 0..1. Never steps: see `advanceCombo`. */
  private comboGlow = 0;
  /** Seconds for the smoother to cover ~63% of a tier step. */
  private static readonly COMBO_TAU = 0.25;
  /** The baked inverse-vignettes, gold and ember, cross-faded by intensity. */
  private comboEdgeGold: HTMLCanvasElement | null = null;
  private comboEdgeEmber: HTMLCanvasElement | null = null;
  /** Live embers (§5.C). Pooled at the quality profile's `embers`. */
  private readonly embers: ComboEmber[] = [];
  /** Fractional spawn carry, so a low glow still emits at the right rate. */
  private emberDebt = 0;

  // ── §5.F the quality knob ──
  /**
   * The live quality profile. Presentation only: nothing the simulation reads
   * is derived from it, and the damaging shockwave rings are never scaled.
   */
  private profile: QualityProfile = QUALITY[DEFAULT_QUALITY];

  // ── §4.3 projectiles and impacts ──
  private readonly impacts: Impact[] = [];
  private readonly shots = new Map<number, ShotTrack>();
  /** The run's core, cached at the top of `draw` so the shot painters can read it. */
  private core: CoreId = DEFAULT_CORE;

  constructor(canvas: HTMLCanvasElement, camera: Camera) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to acquire 2D rendering context');
    this.ctx = ctx;
    this.camera = camera;
    this.reducedMotion = typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * Memoised offscreen sprite. The only way anything in Part 3 gets painted.
   *
   * The rule from §0.8: if it is static per variant it is baked once and
   * blitted afterwards. A `createRadialGradient` or a `shadowBlur` inside a
   * per-frame loop is a bug, so every gradient in this file lives inside one of
   * these painters.
   */
  private part(key: string, size: number, paint: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
    const cached = this.partSprites.get(key);
    if (cached) return cached;
    const sprite = this.makeSprite(size, paint);
    this.partSprites.set(key, sprite);
    return sprite;
  }

  /**
   * The same as `part()`, but in the evictable tower cache.
   *
   * Keys here are plain family names (`'drum'`, `'turret'`) with no variant
   * suffix: the map only ever holds sprites for the *current* signature,
   * because `syncTowerMarks` empties it when the signature moves.
   */
  private towerPart(
    key: string,
    size: number,
    paint: (g: CanvasRenderingContext2D) => void,
  ): HTMLCanvasElement {
    const cached = this.towerSprites.get(key);
    if (cached) return cached;
    const sprite = this.makeSprite(size, paint);
    this.towerSprites.set(key, sprite);
    return sprite;
  }

  /**
   * Adopt this frame's marks, and drop the baked tower if anything about its
   * art changed. One string compare and, a couple of dozen times per run, a
   * `Map.clear()`.
   */
  private syncTowerMarks(snap: RenderSnapshot): void {
    this.marks = snap.towerMarks ?? DEFAULT_TOWER_MARKS;
    const sig = `${this.marks.key}${this.core}|${this.towerTier(snap)}`;
    if (sig === this.towerSig) return;
    this.towerSig = sig;
    this.towerSprites.clear();
  }

  /** Blit a cached sprite centred on a world point. */
  private blit(ctx: CanvasRenderingContext2D, sprite: HTMLCanvasElement, x: number, y: number, scale = 1): void {
    const size = sprite.width * scale;
    ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
  }

  /** The run's core, defaulted, so an old save without one still paints. */
  private coreOf(snap: RenderSnapshot): CoreId {
    return isCoreId(snap.coreId) ? snap.coreId : DEFAULT_CORE;
  }

  /** The colour the core lends the crystal, the range ring and the ground wash. */
  private coreTint(snap: RenderSnapshot): string {
    return CORE_BY_ID[this.coreOf(snap)].color;
  }

  /** Detail tier from the tower's XP level (`TOWER_VISUAL.detailTiers`). */
  private towerTier(snap: RenderSnapshot): number {
    const level = snap.towerLevel ?? 0;
    let tier = 0;
    for (let i = 1; i < TOWER_VISUAL.detailTiers.length; i++) {
      if (level >= TOWER_VISUAL.detailTiers[i]) tier = i;
    }
    return tier;
  }

  /**
   * The barrel's drawn length this frame.
   *
   * `TOWER_VISUAL.turretLength` is the *unupgraded* length and stays a
   * constant — §D.1 grows the barrel by painting a longer one, and the muzzle
   * flash and the tracers have to be placed at the tip of what was actually
   * drawn or they detach from it.
   */
  private get drawnTurretLength(): number {
    return TOWER_VISUAL.turretLength * (1 + this.marks.steps.barrel * 0.045);
  }

  /**
   * World dimensions, not canvas dimensions.
   *
   * These used to be `canvas.width`/`canvas.height`, which is what made the
   * backing store *be* the world (UI plan §0.1). Everything below draws in
   * world units under `camera.applyWorld`; the only passes that know about
   * pixels are the background blit and the screen-space overlays.
   */
  private get width(): number {
    return this.camera.worldWidth;
  }

  private get height(): number {
    return this.camera.worldHeight;
  }

  /**
   * Mirror `EffectsManager.setQuality` for everything the renderer owns (§5.F).
   *
   * `bgLayers` and `shadows` are baked into the background and the sprite
   * cache, so a change to either has to drop the bake — otherwise the old
   * terrain noise survives a switch to `low` until the next resize.
   */
  setQuality(tier: QualityTier): void {
    const next = QUALITY[tier];
    const rebake = next.bgLayers !== this.profile.bgLayers || next.shadows !== this.profile.shadows;
    this.profile = next;
    // Trim the pools immediately rather than waiting for them to age out, so
    // turning the knob down is felt on the next frame.
    const overDecals = this.impacts.length - next.decals;
    if (overDecals > 0) this.impacts.splice(0, overDecals);
    const overEmbers = this.embers.length - next.embers;
    if (overEmbers > 0) this.embers.splice(0, overEmbers);
    if (rebake) this.invalidateBackground();
  }

  /** Drop the baked background. Called by `Game` when the camera resizes. */
  invalidateBackground(): void {
    this.bgCanvas = null;
    // The combo edge glow is baked at the same backing-store size, so it dies
    // with the background rather than keeping a sprite for the old viewport.
    this.comboEdgeGold = null;
    this.comboEdgeEmber = null;
  }

  draw(snapshot: RenderSnapshot, options?: RenderOptions): void {
    this.time += FRAME_DT;
    const ctx = this.ctx;
    const camera = this.camera;
    this.towerX = snapshot.tower.x;
    this.towerY = snapshot.tower.y;
    this.wave = snapshot.wave.number;
    this.core = this.coreOf(snapshot);
    this.syncTowerMarks(snapshot);
    this.advance(snapshot);

    // ── device space: the baked background, blitted 1:1 ──
    //
    // Baked at backing-store resolution rather than world resolution, because
    // the world is now 3328 x 1872 at 16:9 and rescaling an offscreen canvas
    // that size every frame would cost more than the gradient it replaced.
    // The tower always sits at the centre of both, so a screen-space bake is
    // exactly equivalent to a world-space one.
    camera.applyDevice(ctx);
    ctx.drawImage(this.getBackground(snapshot), 0, 0);

    // ── world space ──
    //
    // Ground furniture first, in the order it physically stacks: the range
    // wash is painted *on* the floor, the tower's shadow and plinth sit on top
    // of it, and the wall ring stands on the plinth.
    camera.applyWorld(ctx);
    if (this.rangeOverlay) this.drawRangeRing(ctx, snapshot);
    this.drawTowerBase(ctx, snapshot);
    this.drawWall(ctx, snapshot);
    this.drawMines(ctx, snapshot.mines);
    this.drawImpactDecals(ctx);
    this.drawSpawnPortals(ctx);
    this.drawParticles(ctx, snapshot.particles, 'behind');
    this.drawAimLine(ctx, snapshot);
    this.drawEnemies(ctx, snapshot.enemies);
    this.drawProjectiles(ctx, snapshot.projectiles);
    this.drawHostileShots(ctx, snapshot.hostileShots);
    this.drawParticles(ctx, snapshot.particles, 'front');
    // §5.A: everything that is *light* rather than matter, in one pass with a
    // single `globalCompositeOperation` flip for the whole frame.
    this.drawAdditivePass(ctx, snapshot, options);
    this.drawOrbs(ctx, snapshot.orbs);
    this.drawPlacement(ctx, snapshot.placement);
    this.drawChargeRing(ctx, snapshot.charge);
    this.drawTowerTop(ctx, snapshot);
    this.drawShield(ctx, snapshot, options?.shieldFlash ?? 0);

    // Tower damage flash: the tower is being hurt, so this is `critical`, the
    // one colour reserved for exactly that (docs/art-direction.md). It was a
    // fresh `createRadialGradient` every frame it was up; it is now a blit.
    const tFlash = options?.towerFlash ?? 0;
    if (tFlash > 0) {
      const t = snapshot.tower;
      const k = Math.min(1, tFlash / 0.12);
      const sprite = this.part('tower-flash', (TOWER_VISUAL.bodyRadius + entity(14)) * 2, (g) => {
        const r = TOWER_VISUAL.bodyRadius + entity(14);
        const grad = g.createRadialGradient(0, 0, r * 0.3, 0, 0, r);
        grad.addColorStop(0, withAlpha(FX.critical, 0.5));
        grad.addColorStop(1, withAlpha(FX.critical, 0));
        g.fillStyle = grad;
        g.beginPath();
        g.arc(0, 0, r, 0, Math.PI * 2);
        g.fill();
      });
      ctx.save();
      ctx.globalAlpha = k * 0.7;
      this.blit(ctx, sprite, t.x, t.y, 1 + (1 - k) * 0.5);
      ctx.restore();
    }

    // Wall damage flash: an ember ring on the segmented wall. Stone taking a
    // hit, not the tower itself, so it is warm rather than critical.
    const wFlash = options?.wallFlash ?? 0;
    if (wFlash > 0) {
      const t = snapshot.tower;
      const k = Math.min(1, wFlash / 0.12);
      ctx.save();
      ctx.strokeStyle = withAlpha(FX.ember, k * 0.5);
      ctx.lineWidth = entity(7);
      ctx.beginPath();
      ctx.arc(t.x, t.y, TOWER_VISUAL.wallRadius * (1 + (1 - k) * 0.06), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Shield absorb flash: handled per-facet inside `drawShield`; this is the
    // outer ripple the barrier sheds.
    const sFlash = options?.shieldFlash ?? 0;
    if (sFlash > 0) {
      const t = snapshot.tower;
      const k = Math.min(1, sFlash / 0.12);
      ctx.save();
      ctx.strokeStyle = withAlpha(FX.frost, k * 0.55);
      ctx.lineWidth = entity(3);
      ctx.beginPath();
      ctx.arc(t.x, t.y, TOWER_VISUAL.shieldRadius * (1 + (1 - k) * 0.22), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // ── screen space: one unit is one CSS pixel ──
    //
    // The banner, the boss-death flash and the low-HP vignette are chrome, not
    // world objects: they must not scale with the zoom, must not move with the
    // camera shake, and must fill the viewport rather than the arena.
    // §5.C: the combo edge glow, in device space because that is the
    // resolution it is baked at — an inverse vignette that warms the corners
    // of the viewport while a kill chain is running. Painted under the HUD-ish
    // chrome below so the peril vignette always wins over it.
    this.drawComboEdge(ctx);

    camera.applyScreen(ctx);
    this.drawDamageNumbers(ctx, snapshot.damageNumbers);
    this.drawWaveBanner(ctx, snapshot);
    this.drawBossIntro(ctx, snapshot.bossIntro ?? null);

    const flash = options?.screenFlash ?? 0;
    if (flash > 0) {
      ctx.save();
      ctx.fillStyle = withAlpha('#ffffff', Math.min(1, flash / 0.15));
      ctx.fillRect(0, 0, camera.cssWidth, camera.cssHeight);
      ctx.restore();
    }

    this.drawVignette(ctx, options?.vignette ?? 0);
  }

  /**
   * Advance every piece of presentation state Part 3 owns, once per frame.
   *
   * Deliberately one method rather than a timer inside each painter: these all
   * run on the same clock, they all have to run whether or not the thing they
   * animate is currently visible (a range change during an intermission still
   * has to finish easing), and a painter that mutates state is a painter that
   * breaks the moment it is called twice.
   */
  private advance(snap: RenderSnapshot): void {
    this.advanceRange(snap.tower.range);
    this.advanceTurret(snap);
    this.advancePortals(snap);
    this.advanceEnemyState(snap);
    this.advanceImpacts(snap);
    this.advanceCombo(snap);
  }

  /**
   * The combo flourish's clock (§5.C).
   *
   * The tier is a step function — it pops on the tenth kill and vanishes when
   * the drain runs out — and a full-screen glow that switched on and off with
   * it would read as a bug rather than as a reward. So the tier picks a target
   * and a frame-rate-independent smoother walks a single scalar toward it;
   * every painter downstream reads that scalar and nothing reads the tier.
   */
  private advanceCombo(snap: RenderSnapshot): void {
    const tier = snap.combo?.tier ?? 0;
    const target = COMBO_INTENSITY[Math.min(Math.max(tier, 0), 4)];
    const k = 1 - Math.exp(-FRAME_DT / Renderer.COMBO_TAU);
    this.comboGlow += (target - this.comboGlow) * k;
    // Snap to off so both passes can early-out instead of blitting a
    // transparent full-screen sprite forever after a combo ends.
    if (this.comboGlow < 0.002) this.comboGlow = 0;

    // Embers are motion, and motion is what `prefers-reduced-motion` asks us
    // to drop. The edge glow is static per frame and stays.
    if (this.reducedMotion) {
      if (this.embers.length > 0) this.embers.length = 0;
      this.emberDebt = 0;
      return;
    }

    this.emberDebt += this.comboGlow * EMBER_RATE * FRAME_DT;
    while (this.emberDebt >= 1) {
      this.emberDebt -= 1;
      this.pushEmber(snap);
    }
    for (let i = this.embers.length - 1; i >= 0; i--) {
      const e = this.embers[i];
      e.age += FRAME_DT;
      e.y += e.vy * FRAME_DT;
      if (e.age >= e.life) this.embers.splice(i, 1);
    }
  }

  /** Spawn one ember on a random point of the ring the tower covers. */
  private pushEmber(snap: RenderSnapshot): void {
    if (this.profile.embers <= 0) return;
    if (this.embers.length >= this.profile.embers) this.embers.shift();
    const a = Math.random() * Math.PI * 2;
    const r = this.rangeDrawn * 0.75;
    this.embers.push({
      x: snap.tower.x + Math.cos(a) * r,
      y: snap.tower.y + Math.sin(a) * r,
      vy: -(26 + Math.random() * 22),
      age: 0,
      life: 1.4 + Math.random() * 0.8,
      size: entity(1.2 + Math.random() * 1.4),
    });
  }

  /**
   * Spot impacts, and age the decals they leave (§4.3).
   *
   * The same watermark trick as everything else in this file: a projectile id
   * that was in the list last frame and is not now has *ended*, and its last
   * known position and velocity are the impact point and the impact normal.
   *
   * A shot ends for three reasons — it hit, it left the play field by
   * `ProjectileManager`'s 120 px margin, or it aged out at 4 s. The bounds cull
   * is excluded by testing the last position against the visible arena, which
   * is what stops every missed shot leaving a scorch mark out past the edge of
   * the world. The age cull is not excluded and does not need to be: a shot
   * crosses the whole arena in about a second, so an age-out is a shot pinned
   * on a target it can never catch, and those are rare enough to be a decal
   * nobody will attribute to anything.
   */
  private advanceImpacts(snap: RenderSnapshot): void {
    const stamp = this.frameStamp;
    let live = 0;
    for (const p of snap.projectiles) {
      if (!p.alive) continue;
      live++;
      const track = this.shots.get(p.id);
      if (track === undefined) {
        this.shots.set(p.id, {
          x: p.x, y: p.y, vx: p.vx, vy: p.vy,
          splash: p.splashRadius ?? 0, magic: p.damageType === 'magic', seen: stamp,
        });
        continue;
      }
      track.x = p.x;
      track.y = p.y;
      track.vx = p.vx;
      track.vy = p.vy;
      track.seen = stamp;
    }

    if (this.shots.size !== live) {
      const halfW = this.camera.viewHalfWidth;
      const halfH = this.camera.viewHalfHeight;
      this.shots.forEach((track, id) => {
        if (track.seen === stamp) return;
        this.shots.delete(id);
        if (Math.abs(track.x - this.towerX) > halfW) return;
        if (Math.abs(track.y - this.towerY) > halfH) return;
        this.pushImpact(track);
      });
    }

    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const im = this.impacts[i];
      im.age += FRAME_DT;
      if (im.age >= DECAL_TIME) this.impacts.splice(i, 1);
    }
  }

  /** Pooled push: the oldest decal is dropped once the cap is reached. */
  private pushImpact(track: ShotTrack): void {
    if (this.profile.decals <= 0) return;
    if (this.impacts.length >= this.profile.decals) this.impacts.shift();
    this.impacts.push({
      x: track.x,
      y: track.y,
      angle: Math.atan2(track.vy, track.vx),
      age: 0,
      splash: track.splash,
      magic: track.magic,
    });
  }

  /**
   * Hit flashes and death dissolves (§4.2), derived from the snapshot alone.
   *
   * A hit is "this enemy's `hp` is lower than it was last frame" and a death is
   * "this id was on the field last frame and is not now" — the same trick
   * `advanceTurret` uses for firing and `advancePortals` uses for arrivals. The
   * simulation carries no presentation field for either, and the renderer keeps
   * no copy of the combat rules.
   *
   * The sweep for departures only runs on a frame where something actually
   * left: every live enemy is stamped in the first loop, so
   * `tracks.size - alive` is exactly the number of deaths, and a wave where
   * nothing dies pays one subtraction.
   */
  private advanceEnemyState(snap: RenderSnapshot): void {
    const stamp = ++this.frameStamp;
    let alive = 0;
    for (const e of snap.enemies) {
      if (!e.alive) continue;
      alive++;
      const track = this.tracks.get(e.id);
      if (track === undefined) {
        this.tracks.set(e.id, {
          hp: e.hp, flash: 0, seen: stamp, x: e.x, y: e.y,
          sprite: null, color: ENEMY_DEFS[e.type].color, r: this.enemyDrawRadius(e),
        });
        continue;
      }
      // Absorb shields and boss bulwarks soak damage *before* `hp`, so a hit
      // that lands entirely on a shield does not flash the body — which is
      // correct: the shield arc is the read for that one.
      if (e.hp < track.hp) track.flash = HIT_FLASH_TIME;
      else if (track.flash > 0) track.flash = Math.max(0, track.flash - FRAME_DT);
      track.hp = e.hp;
      track.seen = stamp;
      track.x = e.x;
      track.y = e.y;
    }

    if (this.tracks.size !== alive) {
      this.tracks.forEach((track, id) => {
        if (track.seen === stamp) return;
        this.pushDeath(track);
        this.tracks.delete(id);
      });
    }

    for (let i = this.deaths.length - 1; i >= 0; i--) {
      const d = this.deaths[i];
      d.age += FRAME_DT;
      if (d.age >= DEATH_TIME) this.deaths.splice(i, 1);
    }
  }

  /**
   * Pooled push of a death dissolve, aimed along the killing blow.
   *
   * The vector is *outward from the tower*, and that is a deliberate
   * approximation rather than a shortcut: essentially all damage in this game
   * originates at the tower — its shots, its shockwaves, its mines, its
   * abilities — so the outward radial is the killing blow's direction to
   * within anything a player can perceive at this zoom. Carrying the true
   * vector would mean the simulation emitting a damage direction on every hit,
   * which is a per-hit field on the hot path for a 0.36 s effect.
   */
  private pushDeath(track: EnemyTrack): void {
    if (this.deaths.length >= DEATH_CAP) this.deaths.shift();
    const dx = track.x - this.towerX;
    const dy = track.y - this.towerY;
    const len = Math.hypot(dx, dy);
    this.deaths.push({
      x: track.x,
      y: track.y,
      vx: len > 0 ? dx / len : 1,
      vy: len > 0 ? dy / len : 0,
      age: 0,
      sprite: track.sprite,
      color: track.color,
      r: track.r,
    });
  }

  /**
   * The range ring eases to a new `range` over 400 ms and blooms (§3.2).
   *
   * The point is that buying `Longbow` should *look* like something happened.
   * Before this the ring was recomputed from `tower.range` every frame, so a
   * +3 upgrade moved a 6%-alpha dashed line by three pixels between one frame
   * and the next and no player alive would have noticed.
   */
  private advanceRange(range: number): void {
    if (this.rangeDrawn === 0) {
      this.rangeDrawn = this.rangeFrom = this.rangeTo = range;
      return;
    }
    if (Math.abs(range - this.rangeTo) > 0.5) {
      this.rangeFrom = this.rangeDrawn;
      this.rangeTo = range;
      this.rangeEase = 0;
      this.rangeBloom = 1;
    }
    if (this.rangeEase < 1) {
      this.rangeEase = Math.min(1, this.rangeEase + FRAME_DT / RANGE_EASE_TIME);
      this.rangeDrawn = this.rangeFrom
        + (this.rangeTo - this.rangeFrom) * easeOutCubic(this.rangeEase);
    } else {
      this.rangeDrawn = this.rangeTo;
    }
    if (this.rangeBloom > 0) {
      this.rangeBloom = Math.max(0, this.rangeBloom - FRAME_DT / RANGE_BLOOM_TIME);
    }
  }

  /**
   * Point the turret at whatever the tower is shooting, and recoil when it does.
   *
   * The heading comes from the projectiles themselves — see `lastProjectileId`.
   * The angle chases rather than snaps, so a target swap sweeps the barrel
   * across instead of teleporting it, and the chase is proportional so a
   * high-fire-rate tower still tracks tightly.
   */
  private advanceTurret(snap: RenderSnapshot): void {
    const t = snap.tower;
    let fired: Projectile | null = null;
    let shots = 0;
    let highest = this.lastProjectileId;
    const list = snap.projectiles;
    const seeded = this.lastProjectileId >= 0;
    // §4.4: below `TRACER_FIRE_RATE` the bolts are individually legible and a
    // tracer would just be a line drawn over one you can already see.
    const tracing = seeded && !this.reducedMotion && t.fireRate >= TRACER_FIRE_RATE;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      if (p.id <= this.lastProjectileId) break;
      if (p.id > highest) highest = p.id;
      // Anything that started at the tower came out of the barrel. A homing
      // shot that has already turned has not: it is only new once.
      if (Math.hypot(p.x - t.x, p.y - t.y) < TOWER_VISUAL.bodyRadius * 3) {
        shots++;
        if (fired === null) fired = p;
        if (tracing) this.pushTracer(Math.atan2(p.vy, p.vx));
      }
    }
    if (!seeded) {
      // First frame: adopt the id watermark without firing, so a save load does
      // not recoil the barrel for shots taken before the page existed.
      this.lastProjectileId = highest;
      fired = null;
      shots = 0;
    } else {
      this.lastProjectileId = highest;
    }

    for (let i = this.tracers.length - 1; i >= 0; i--) {
      this.tracers[i].age += FRAME_DT;
      if (this.tracers[i].age >= TRACER_TIME) this.tracers.splice(i, 1);
    }

    if (fired) {
      this.turretAngle = Math.atan2(fired.vy, fired.vx);
      this.recoil = 1;
      this.muzzle = 1;
      this.muzzleBurst = shots;
    } else if (snap.aimLine) {
      // Manual aim: the barrel follows the cursor even between shots, because
      // holding is a promise about where the next shot goes.
      this.chaseTurret(Math.atan2(snap.aimLine.y - t.y, snap.aimLine.x - t.x));
    }

    if (this.recoil > 0) this.recoil = Math.max(0, this.recoil - FRAME_DT / TOWER_VISUAL.recoilTime);
    if (this.muzzle > 0) this.muzzle = Math.max(0, this.muzzle - FRAME_DT / TOWER_VISUAL.muzzleTime);
  }

  /** Pooled push: the oldest tracer is dropped once the cap is reached. */
  private pushTracer(angle: number): void {
    if (this.tracers.length >= TRACER_CAP) this.tracers.shift();
    this.tracers.push({ angle, age: 0 });
  }

  /** Rotate the barrel toward `target` along the short way round. */
  private chaseTurret(target: number): void {
    let delta = target - this.turretAngle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.turretAngle += delta * 0.25;
  }

  /**
   * Open and close the rifts, and catch enemies coming through them (§3.4).
   *
   * `spawnLanes` is present only during an intermission, but enemies keep
   * arriving for a while after it ends — so the lane list drives the *opening*
   * and the arrivals themselves keep the rifts alive afterwards.
   */
  private advancePortals(snap: RenderSnapshot): void {
    const lanes = snap.spawnLanes;
    if (lanes && lanes.length > 0) {
      // Copy rather than hold the reference: `PacingManager` owns that array
      // and will clear it out from under us the moment the wave starts.
      this.portalLanes.length = 0;
      for (const lane of lanes) this.portalLanes.push({ x: lane.x, y: lane.y });
      this.portalOpen = Math.min(1, this.portalOpen + FRAME_DT / PORTAL_OPEN_TIME);
    } else {
      this.portalOpen = Math.max(0, this.portalOpen - FRAME_DT / PORTAL_OPEN_TIME);
      if (this.portalOpen === 0) this.portalLanes.length = 0;
    }

    // Arrivals. Enemy ids are monotonic, so anything above the watermark is new
    // this frame; the ellipse test then keeps splitter children and mid-field
    // spawns out of it.
    const halfW = this.camera.viewHalfWidth;
    const halfH = this.camera.viewHalfHeight;
    let highest = this.maxEnemyId;
    for (const e of snap.enemies) {
      if (e.id <= this.maxEnemyId) continue;
      if (e.id > highest) highest = e.id;
      if (!this.enemyIdSeeded) continue;
      const nx = (e.x - this.towerX) / halfW;
      const ny = (e.y - this.towerY) / halfH;
      if (Math.hypot(nx, ny) < EMERGENCE_MIN_ELLIPSE) continue;
      this.pushEmergence(e.x, e.y, Math.atan2(this.towerY - e.y, this.towerX - e.x));
    }
    this.maxEnemyId = highest;
    this.enemyIdSeeded = true;

    for (let i = this.emergences.length - 1; i >= 0; i--) {
      const em = this.emergences[i];
      em.age += FRAME_DT;
      if (em.age >= EMERGENCE_TIME) this.emergences.splice(i, 1);
    }
  }

  /** Pooled push: the oldest emergence is dropped once the cap is reached. */
  private pushEmergence(x: number, y: number, angle: number): void {
    if (this.emergences.length >= EMERGENCE_CAP) this.emergences.shift();
    this.emergences.push({ x, y, age: 0, angle });
  }

  /**
   * Low-HP vignette, in screen space.
   *
   * Was a `box-shadow` on `.canvas-wrap.is-critical`, which meant the most
   * urgent signal in the game was painted by the same element the shake
   * animation was translating — so at 0 HP the warning jittered along with
   * every DOM overlay pinned to the canvas. On the canvas it sits under
   * nothing and moves with nothing.
   */
  private drawVignette(ctx: CanvasRenderingContext2D, intensity: number): void {
    if (intensity <= 0) return;
    const w = this.camera.cssWidth;
    const h = this.camera.cssHeight;
    const pulse = 0.85 + 0.15 * Math.sin(this.time * 6);
    const inner = Math.min(w, h) * 0.34;
    const outer = Math.hypot(w, h) * 0.5;
    const grad = ctx.createRadialGradient(w / 2, h / 2, inner, w / 2, h / 2, outer);
    grad.addColorStop(0, withAlpha(FX.critical, 0));
    grad.addColorStop(1, withAlpha(FX.critical, Math.min(1, intensity) * 0.55 * pulse));
    ctx.save();
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  /**
   * The baked background, at backing-store resolution.
   *
   * Keyed on the backing-store size *and* the world scale: a window resize
   * changes the first, a change of aspect (and so of zoom) changes the second,
   * and either one invalidates the bake. `Game` also calls
   * `invalidateBackground` on the camera's resize so a same-size, new-shape
   * viewport cannot keep a stale grid.
   */
  /**
   * The combo edge glow (§5.C), blitted in device space.
   *
   * An inverse vignette — transparent in the middle, warm at the corners — is
   * the whole flourish: it *is* the heat tint, and a second full-screen fill
   * for a few percent more warmth would cost real fill rate at DPR 2 on a
   * phone for something nobody would name.
   *
   * Two sprites are baked (gold and ember) and cross-faded by intensity rather
   * than one sprite re-baked whenever the eased scalar moves, which is every
   * frame a combo is climbing. `FX.gold`/`FX.ember` and *not* `FX.critical` or
   * `FX.blood`: per `docs/art-direction.md` those two mean "the tower is in
   * peril" and "an enemy", and a combo is the opposite of both.
   */
  private drawComboEdge(ctx: CanvasRenderingContext2D): void {
    if (this.comboGlow === 0) return;
    const w = Math.max(1, Math.round(this.camera.transform.pixelWidth));
    const h = Math.max(1, Math.round(this.camera.transform.pixelHeight));
    if (!this.comboEdgeGold || this.comboEdgeGold.width !== w || this.comboEdgeGold.height !== h) {
      this.comboEdgeGold = this.bakeComboEdge(w, h, FX.gold);
      this.comboEdgeEmber = this.bakeComboEdge(w, h, FX.ember);
    }
    const ember = this.comboEdgeEmber;
    if (!ember) return;
    const alpha = this.comboGlow * COMBO_EDGE_ALPHA;
    this.camera.applyDevice(ctx);
    ctx.save();
    ctx.globalAlpha = alpha * (1 - this.comboGlow);
    ctx.drawImage(this.comboEdgeGold, 0, 0);
    ctx.globalAlpha = alpha * this.comboGlow;
    ctx.drawImage(ember, 0, 0);
    ctx.restore();
  }

  /** Bake one inverse vignette at backing-store size. See `drawComboEdge`. */
  private bakeComboEdge(w: number, h: number, tint: string): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    const inner = Math.min(w, h) * 0.55;
    const outer = Math.hypot(w, h) / 2;
    const grad = g.createRadialGradient(w / 2, h / 2, inner, w / 2, h / 2, outer);
    grad.addColorStop(0, withAlpha(tint, 0));
    grad.addColorStop(1, tint);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    return c;
  }

  private getBackground(snap: RenderSnapshot): HTMLCanvasElement {
    const w = Math.max(1, Math.round(this.camera.transform.pixelWidth));
    const h = Math.max(1, Math.round(this.camera.transform.pixelHeight));
    const scale = this.camera.transform.scale;
    const core = this.coreOf(snap);
    if (this.bgCanvas && this.bgCanvas.width === w && this.bgCanvas.height === h
      && this.bgScale === scale && this.bgCore === core) {
      return this.bgCanvas;
    }
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const bg = c.getContext('2d')!;
    // Everything below is baked in *backing-store pixels*, stepped in world
    // units via `scale`. It runs on a resize and on a core change, and never in
    // a frame that also has to draw two hundred enemies.
    const rand = mulberry32(hashString(`${w}x${h}|${core}`));
    this.bakeFarField(bg, w, h, scale, core, rand);
    // `bgLayers: 2` drops the terrain noise — the most expensive of the three
    // bakes and the least missed on a phone.
    if (this.profile.bgLayers >= 3) this.bakeTerrain(bg, w, h, scale, rand);
    this.bakeLattice(bg, w, h, scale, core);
    this.bgCanvas = c;
    this.bgScale = scale;
    this.bgCore = core;
    return c;
  }

  /**
   * Layer 1: the far field (§3.1).
   *
   * A tinted vignette that gives the arena a centre and a periphery, a faint
   * wash of the run's core colour around the tower, and a sparse seeded field
   * of stars and embers so the dark half of the screen is not flat paint. The
   * two-stop `INK['600'] → INK['900']` gradient this replaces was the entire
   * background, which is why the old floor read as an empty document.
   */
  private bakeFarField(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    scale: number,
    core: CoreId,
    rand: () => number,
  ): void {
    const cx = w / 2;
    const cy = h / 2;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(w, h) * 0.58);
    grad.addColorStop(0, INK['700']);
    grad.addColorStop(0.45, INK['800']);
    grad.addColorStop(1, INK['950']);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // The core's wash. Weak on purpose — it is a tint on the floor the tower
    // stands on, not a light source.
    const tint = CORE_BY_ID[core].color;
    const washR = ARENA.minHalfExtent * scale * 1.05;
    const wash = ctx.createRadialGradient(cx, cy, 0, cx, cy, washR);
    wash.addColorStop(0, withAlpha(tint, 0.07));
    wash.addColorStop(0.55, withAlpha(tint, 0.025));
    wash.addColorStop(1, withAlpha(tint, 0));
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, w, h);

    // Stars and embers. Density is per-area so a phone and an ultrawide get the
    // same *look* rather than the same count.
    const count = Math.round((w * h) / 1_000_000 * STAR_DENSITY * 12);
    for (let i = 0; i < count; i++) {
      const x = rand() * w;
      const y = rand() * h;
      const roll = rand();
      const r = (0.5 + rand() * 1.3) * world(1) * scale;
      const color = roll > 0.94 ? FX.ember : roll > 0.88 ? tint : INK['100'];
      ctx.fillStyle = withAlpha(color, 0.06 + rand() * 0.18);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * Layer 2: terrain (§3.1).
   *
   * Seeded value noise, tiled twice at two scales, plus a handful of large
   * blotches and a set of cracks radiating from the tower's footing.
   *
   * The noise is a **128 px tile filled as a pattern**, not per-pixel work over
   * the whole backing store: at 16:9 and DPR 2 that would be three and a half
   * million `ImageData` writes on every resize, for a texture nobody can
   * resolve individually anyway. Two passes at different context scales break
   * up the tile's repetition, and the alpha is low enough that the seam is not
   * findable.
   */
  private bakeTerrain(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    scale: number,
    rand: () => number,
  ): void {
    const tile = this.getNoiseTile();
    const pattern = ctx.createPattern(tile, 'repeat');
    if (pattern) {
      for (const [zoom, alpha] of [[1, 0.05], [3.3, 0.06]] as const) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.scale(zoom, zoom);
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, w / zoom, h / zoom);
        ctx.restore();
      }
    }

    // Large-scale blotching: a few soft discs of lighter and darker rock, so
    // the floor has geography rather than uniform grain.
    for (let i = 0; i < 9; i++) {
      const x = rand() * w;
      const y = rand() * h;
      const r = (0.16 + rand() * 0.3) * Math.min(w, h);
      const lighter = rand() > 0.5;
      const blob = ctx.createRadialGradient(x, y, 0, x, y, r);
      blob.addColorStop(0, withAlpha(lighter ? INK['600'] : INK['950'], lighter ? 0.3 : 0.24));
      blob.addColorStop(1, withAlpha(lighter ? INK['600'] : INK['950'], 0));
      ctx.fillStyle = blob;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // Cracks out of the tower's footing. They are what says "something heavy
    // has been standing here" — and they point at the tower from anywhere on
    // the floor, which is the same job the lattice does at a different scale.
    const cx = w / 2;
    const cy = h / 2;
    const start = TOWER_VISUAL.plinthRadius * scale;
    ctx.lineCap = 'round';
    for (let i = 0; i < CRACK_COUNT; i++) {
      const angle = (i / CRACK_COUNT) * Math.PI * 2 + rand() * 0.4;
      const length = (world(35) + rand() * world(95)) * scale;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      for (const [dy, color, alpha, width] of [
        [0, INK['950'], 0.42, 1.6],
        [-1, INK['400'], 0.14, 0.9],
      ] as const) {
        ctx.strokeStyle = withAlpha(color, alpha);
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(start, dy);
        let x = start;
        let y = dy;
        const steps = 5;
        for (let s = 1; s <= steps; s++) {
          x = start + (length * s) / steps;
          y = dy + (rand() - 0.5) * world(9) * scale;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /**
   * The seeded noise tile, baked once for the life of the page.
   *
   * Built at a quarter size and upscaled with smoothing on, which turns a field
   * of independent random pixels into soft value noise for the price of one
   * `drawImage`. A per-pixel Perlin implementation would look marginally better
   * and cost four hundred lines.
   */
  private getNoiseTile(): HTMLCanvasElement {
    if (this.noiseTile) return this.noiseTile;
    const small = document.createElement('canvas');
    const n = NOISE_TILE / 4;
    small.width = n;
    small.height = n;
    const sg = small.getContext('2d')!;
    const img = sg.createImageData(n, n);
    const rand = mulberry32(0x51ede);
    for (let i = 0; i < n * n; i++) {
      const v = Math.round(90 + rand() * 165);
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    sg.putImageData(img, 0, 0);

    const tile = document.createElement('canvas');
    tile.width = NOISE_TILE;
    tile.height = NOISE_TILE;
    const tg = tile.getContext('2d')!;
    tg.imageSmoothingEnabled = true;
    tg.drawImage(small, 0, 0, NOISE_TILE, NOISE_TILE);
    this.noiseTile = tile;
    return tile;
  }

  private drawAimLine(_ctx: CanvasRenderingContext2D, _snap: RenderSnapshot): void {
  }

  /**
   * Layer 3: the lattice (§3.1).
   *
   * The old floor was an 80 px square grid at 4% white — graph paper, aligned
   * to nothing, and it told the player nothing they did not already know. This
   * is concentric arcs and radial spokes **centred on the tower**, so the
   * geometry of the floor points at the tower from every part of the arena,
   * including the parts where the tower is off the edge of the screen.
   *
   * It fades out at `ARENA_RANGE_CAP` — the furthest any build's range can ever
   * reach — rather than at the current `range`, because a lattice that re-baked
   * every time an upgrade was bought would be a re-bake per purchase for a
   * boundary the range ring itself already draws.
   */
  private bakeLattice(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    scale: number,
    core: CoreId,
  ): void {
    const cx = w / 2;
    const cy = h / 2;
    const tint = CORE_BY_ID[core].color;
    const inner = TOWER_VISUAL.plinthRadius;
    ctx.save();
    ctx.lineWidth = 1;
    for (let r = inner + LATTICE_STEP; r < LATTICE_OUTER; r += LATTICE_STEP) {
      const fade = 1 - r / LATTICE_OUTER;
      ctx.strokeStyle = withAlpha(INK['100'], 0.14 * fade);
      ctx.beginPath();
      ctx.arc(cx, cy, r * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let i = 0; i < LATTICE_SPOKES; i++) {
      const angle = (i / LATTICE_SPOKES) * Math.PI * 2;
      const ux = Math.cos(angle);
      const uy = Math.sin(angle);
      const gradient = ctx.createLinearGradient(
        cx + ux * inner * scale,
        cy + uy * inner * scale,
        cx + ux * LATTICE_OUTER * scale,
        cy + uy * LATTICE_OUTER * scale,
      );
      gradient.addColorStop(0, withAlpha(tint, 0.16));
      gradient.addColorStop(1, withAlpha(tint, 0));
      ctx.strokeStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(cx + ux * inner * scale, cy + uy * inner * scale);
      ctx.lineTo(cx + ux * LATTICE_OUTER * scale, cy + uy * LATTICE_OUTER * scale);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Ground furniture under the tower (§3.3): the cast shadow and the plinth.
   *
   * Split from `drawTowerTop` along the line where the tower stops being part
   * of the floor and starts being an object standing on it — the shadow and the
   * footing are painted before the enemies so a mob at contact range walks over
   * them, and everything above the footing is painted after, so nothing ever
   * covers up the player's own tower.
   */
  private drawTowerBase(ctx: CanvasRenderingContext2D, snap: RenderSnapshot): void {
    const t = snap.tower;
    const lx = Math.cos(TOWER_VISUAL.lightAngle);
    const ly = Math.sin(TOWER_VISUAL.lightAngle);
    const shadow = this.part('tower-shadow', TOWER_VISUAL.shadowRadius * 2.6, (g) => {
      const r = TOWER_VISUAL.shadowRadius;
      // The shadow is cast *away* from the key light, so the tower is lit from
      // one direction and everything on it agrees about which.
      const ox = -lx * r * 0.24;
      const oy = -ly * r * 0.24;
      const grad = g.createRadialGradient(ox, oy, r * 0.35, ox, oy, r);
      grad.addColorStop(0, withAlpha(INK['950'], 0.66));
      grad.addColorStop(0.55, withAlpha(INK['950'], 0.34));
      grad.addColorStop(1, withAlpha(INK['950'], 0));
      g.fillStyle = grad;
      g.beginPath();
      g.arc(ox, oy, r, 0, Math.PI * 2);
      g.fill();
    });
    if (this.profile.shadows) this.blit(ctx, shadow, t.x, t.y);
    this.blit(ctx, this.towerPart('plinth', TOWER_VISUAL.plinthRadius * 2.7, (g) => {
      this.paintPlinth(g);
    }), t.x, t.y);
  }

  /** Stone footing: a kerb of set blocks, a lit bevel and an occlusion ring. */
  private paintPlinth(g: CanvasRenderingContext2D): void {
    const R = TOWER_VISUAL.plinthRadius;
    const light = TOWER_VISUAL.lightAngle;
    const m = this.marks.steps;
    const rand = mulberry32(0x91af7);

    // §D.9: buttresses go under the disc, so the disc's edge cuts them and
    // they read as set *into* the footing.
    this.paintButtresses(g, R, light, m.masonry);

    g.fillStyle = TOWER_VISUAL.plinth;
    g.beginPath();
    g.arc(0, 0, R, 0, Math.PI * 2);
    g.fill();

    // Kerb blocks around the rim, each one a slightly different stone.
    const blocks = 16;
    const step = (Math.PI * 2) / blocks;
    for (let i = 0; i < blocks; i++) {
      const a0 = i * step + step * 0.09;
      const a1 = (i + 1) * step - step * 0.09;
      const mid = (a0 + a1) / 2;
      const lit = 0.5 + 0.5 * Math.cos(mid - light);
      g.beginPath();
      g.arc(0, 0, R, a0, a1);
      g.arc(0, 0, R * 0.79, a1, a0, true);
      g.closePath();
      g.fillStyle = rand() > 0.5 ? TOWER_VISUAL.stoneMid : TOWER_VISUAL.stoneDark;
      g.fill();
      g.fillStyle = withAlpha(TOWER_VISUAL.rim, 0.10 * lit);
      g.fill();
      g.fillStyle = withAlpha(INK['950'], 0.34 * (1 - lit));
      g.fill();
    }

    // masonry 2+: a second, finer kerb inside the first — the footing is
    // stepped, which is the cheapest way to say "this is thicker than it was".
    if (m.masonry >= 2) {
      const inner = 24;
      const iStep = (Math.PI * 2) / inner;
      for (let i = 0; i < inner; i++) {
        const a0 = i * iStep + iStep * 0.12;
        const a1 = (i + 1) * iStep - iStep * 0.12;
        const mid = (a0 + a1) / 2;
        const lit = 0.5 + 0.5 * Math.cos(mid - light);
        g.beginPath();
        g.arc(0, 0, R * 0.77, a0, a1);
        g.arc(0, 0, R * 0.64, a1, a0, true);
        g.closePath();
        g.fillStyle = rand() > 0.5 ? TOWER_VISUAL.stoneMid : TOWER_VISUAL.stoneDark;
        g.fill();
        g.fillStyle = withAlpha(TOWER_VISUAL.rim, 0.08 * lit);
        g.fill();
        g.fillStyle = withAlpha(INK['950'], 0.3 * (1 - lit));
        g.fill();
      }
    }

    // masonry 5: a stepped second tier, drawn as a raised lip.
    if (m.masonry >= 5) {
      g.strokeStyle = withAlpha(TOWER_VISUAL.stoneLit, 0.9);
      g.lineWidth = entity(2.4);
      g.beginPath();
      g.arc(0, 0, R * 0.61, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = withAlpha(INK['950'], 0.55);
      g.lineWidth = entity(1.4);
      g.beginPath();
      g.arc(0, 0, R * 0.585, 0, Math.PI * 2);
      g.stroke();
    }

    this.paintResonator(g, R, light, m.resonator);

    // Bevel highlight on the lit side, and the occlusion ring where the drum
    // meets the footing — the two cheapest cues that this is a solid object.
    g.strokeStyle = withAlpha(TOWER_VISUAL.rim, 0.22);
    g.lineWidth = entity(2);
    g.beginPath();
    g.arc(0, 0, R * 0.9, light - 1.15, light + 1.15);
    g.stroke();

    const ao = g.createRadialGradient(0, 0, TOWER_VISUAL.bodyRadius * 0.85, 0, 0, TOWER_VISUAL.bodyRadius * 1.28);
    ao.addColorStop(0, withAlpha(INK['950'], 0.5));
    ao.addColorStop(1, withAlpha(INK['950'], 0));
    g.fillStyle = ao;
    g.beginPath();
    g.arc(0, 0, TOWER_VISUAL.bodyRadius * 1.28, 0, Math.PI * 2);
    g.fill();
  }

  /**
   * Buttresses from the `health` line (`plans/tower-ui.md` §D.9).
   *
   * The only mark that grows the tower's *footprint*, which is why the plinth
   * sprite is baked at `plinthRadius * 2.7` rather than `2.3`. It does not
   * touch `TOWER_VISUAL.plinthRadius` itself: the charge ring reads that
   * constant (`Renderer.drawChargeRing`) and moving it would drag an unrelated
   * indicator outward.
   */
  private paintButtresses(
    g: CanvasRenderingContext2D,
    R: number,
    light: number,
    step: number,
  ): void {
    if (step <= 0) return;
    const n = step >= 3 ? 8 : 4;
    const reach = R + entity(step >= 3 ? 8 : 5.5);
    const half = step >= 3 ? 0.15 : 0.19;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.PI / n;
      const lit = 0.5 + 0.5 * Math.cos(a - light);
      g.beginPath();
      g.moveTo(Math.cos(a - half) * R * 0.9, Math.sin(a - half) * R * 0.9);
      g.lineTo(Math.cos(a - half * 0.45) * reach, Math.sin(a - half * 0.45) * reach);
      g.lineTo(Math.cos(a + half * 0.45) * reach, Math.sin(a + half * 0.45) * reach);
      g.lineTo(Math.cos(a + half) * R * 0.9, Math.sin(a + half) * R * 0.9);
      g.closePath();
      g.fillStyle = TOWER_VISUAL.stoneDark;
      g.fill();
      g.fillStyle = withAlpha(TOWER_VISUAL.rim, 0.12 * lit);
      g.fill();
      g.fillStyle = withAlpha(INK['950'], 0.4 * (1 - lit));
      g.fill();
      g.strokeStyle = withAlpha(INK['950'], 0.7);
      g.lineWidth = entity(1.2);
      g.stroke();
      // step 3: a stepped shoulder on each buttress.
      if (step >= 3) {
        g.strokeStyle = withAlpha(TOWER_VISUAL.rim, 0.25 * lit);
        g.lineWidth = entity(1.1);
        g.beginPath();
        g.arc(0, 0, (R + reach) / 2, a - half * 0.7, a + half * 0.7);
        g.stroke();
      }
    }
  }

  /**
   * Emitter rings from the `shockwave` line (`plans/tower-ui.md` §D.9).
   *
   * Frost, not gold: `shockwave`'s evolution is a slow, and frost is the
   * palette's slow/chill family (`docs/art-direction.md`). It is also the one
   * mark whose step 1 is at upgrade level 1 — the line is a single deliberate
   * purchase, so buying it at all has to show.
   */
  private paintResonator(
    g: CanvasRenderingContext2D,
    R: number,
    light: number,
    step: number,
  ): void {
    if (step <= 0) return;
    const radii = step >= 3 ? [0.42, 0.52, 0.62] : step >= 2 ? [0.46, 0.58] : [0.52];
    for (const at of radii) {
      g.strokeStyle = withAlpha(INK['950'], 0.55);
      g.lineWidth = entity(3);
      g.beginPath();
      g.arc(0, 0, R * at, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = withAlpha(TOWER_VISUAL.stoneLit, 0.8);
      g.lineWidth = entity(1.6);
      g.beginPath();
      g.arc(0, 0, R * at - entity(0.6), light - 1.4, light + 1.4);
      g.stroke();
    }
    if (step < 2) return;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const x = Math.cos(a) * R * 0.57;
      const y = Math.sin(a) * R * 0.57;
      g.fillStyle = withAlpha(INK['950'], 0.7);
      g.beginPath();
      g.arc(x, y, entity(3.4), 0, Math.PI * 2);
      g.fill();
      g.fillStyle = withAlpha(TOWER_VISUAL.shield, step >= 3 ? 0.85 : 0.5);
      g.beginPath();
      g.arc(x, y, entity(2.2), 0, Math.PI * 2);
      g.fill();
      if (step >= 3) {
        const glow = g.createRadialGradient(x, y, 0, x, y, entity(7));
        glow.addColorStop(0, withAlpha(TOWER_VISUAL.shield, 0.45));
        glow.addColorStop(1, withAlpha(TOWER_VISUAL.shield, 0));
        g.fillStyle = glow;
        g.beginPath();
        g.arc(x, y, entity(7), 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  /**
   * The faceted shield barrier (§3.3).
   *
   * Was a dashed blue circle plus, for every charge, a fresh
   * `createRadialGradient` **every frame** — the exact pattern §0.8 rule 2
   * calls a bug. It is now six flat facets (paths, no gradients) and one cached
   * pip sprite, and it carries strictly more information than before: the
   * barrier's presence, its strength in the facet alpha, the charge count in
   * the pips, and an absorb as a per-facet flicker rather than a whole-ring
   * pulse.
   */
  private drawShield(ctx: CanvasRenderingContext2D, snap: RenderSnapshot, flash: number): void {
    const t = snap.tower;
    if (t.shieldMaxCharges <= 0) return;
    const ratio = t.shieldCurrentCharges / t.shieldMaxCharges;
    if (ratio <= 0) return;
    const breathe = this.reducedMotion ? 1 : 1 + Math.sin(this.time * 2) * 0.022;
    const rOut = TOWER_VISUAL.shieldRadius * breathe;
    const rIn = rOut * 0.84;
    const spin = this.reducedMotion ? 0 : this.time * 0.18;
    const hit = Math.min(1, flash / 0.12);

    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.lineJoin = 'round';
    for (let i = 0; i < 6; i++) {
      const a0 = spin + (i / 6) * Math.PI * 2;
      const a1 = spin + ((i + 1) / 6) * Math.PI * 2;
      // A deterministic per-facet offset, so an absorb lights the barrier up
      // unevenly the way a real shell would rather than as one flat pulse.
      const jitter = ((Math.imul(i + 1, 2654435761) >>> 0) % 1000) / 1000;
      const lit = hit * (0.35 + 0.65 * jitter);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a0) * rIn, Math.sin(a0) * rIn);
      ctx.lineTo(Math.cos(a0) * rOut, Math.sin(a0) * rOut);
      ctx.lineTo(Math.cos(a1) * rOut, Math.sin(a1) * rOut);
      ctx.lineTo(Math.cos(a1) * rIn, Math.sin(a1) * rIn);
      ctx.closePath();
      ctx.fillStyle = withAlpha(TOWER_VISUAL.shield, 0.03 + ratio * 0.06 + lit * 0.35);
      ctx.fill();
      ctx.strokeStyle = withAlpha(TOWER_VISUAL.shield, 0.14 + ratio * 0.22 + lit * 0.5);
      ctx.lineWidth = entity(0.9 + ratio * 0.9);
      ctx.stroke();
    }
    ctx.restore();

    // Charge pips: one per charge, so the count is countable.
    if (t.shieldCurrentCharges > 0) {
      const pip = this.part('shield-pip', entity(16), (g) => {
        const r = entity(7);
        const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
        grad.addColorStop(0, withAlpha(TOWER_VISUAL.shield, 0.9));
        grad.addColorStop(1, withAlpha(TOWER_VISUAL.shield, 0));
        g.fillStyle = grad;
        g.beginPath();
        g.arc(0, 0, r, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = INK['050'];
        g.beginPath();
        g.arc(0, 0, entity(2.4), 0, Math.PI * 2);
        g.fill();
      });
      const pipR = rOut + entity(7);
      const count = t.shieldCurrentCharges;
      const drift = this.reducedMotion ? 0 : this.time * 1.1;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + drift;
        this.blit(ctx, pip, t.x + Math.cos(a) * pipR, t.y + Math.sin(a) * pipR);
      }
    }
  }

  /**
   * The wall, as a ring of stone blocks that crumble one at a time (§3.3).
   *
   * The old wall was two stroked circles whose alpha and width tracked
   * `wallHp` — which meant the difference between a full wall and one at 30%
   * was a slightly thinner, slightly dimmer grey line, and the moment it broke
   * was not an event. Sixteen blocks give the same number a shape: they go
   * `full → cracked → rubble → gone` in order, so the wall visibly comes apart
   * and the last block falling is something the player sees happen.
   *
   * Three cached block sprites and up to sixteen blits; nothing per-frame
   * allocates.
   */
  private drawWall(ctx: CanvasRenderingContext2D, snap: RenderSnapshot): void {
    const t = snap.tower;
    if (t.wallMaxHp <= 0) return;
    const ratio = Math.max(0, t.wallHp / t.wallMaxHp);
    if (ratio <= 0) return;
    const n = TOWER_VISUAL.wallSegments;
    const span = (Math.PI * 2) / n;
    const remainingAt = ratio * n;
    // §D.10: the courses are laid thicker as `wall` is levelled. Purely a
    // drawn dimension — `TOWER_VISUAL.wallRadius` is untouched, and nothing
    // outside this renderer reads either number.
    const thickness = entity(11) * (1 + this.marks.steps.bulwark * 0.09);
    const mid = TOWER_VISUAL.wallRadius + thickness / 2;

    ctx.save();
    ctx.translate(t.x, t.y);
    for (let i = 0; i < n; i++) {
      const left = remainingAt - i;
      const state = left >= 1 ? 'full' : left > 0.4 ? 'cracked' : left > -1 ? 'rubble' : null;
      if (state === null) continue;
      const sprite = this.getWallSegment(state, span, thickness);
      ctx.save();
      ctx.rotate(-Math.PI / 2 + (i + 0.5) * span);
      ctx.drawImage(sprite, mid - sprite.width / 2, -sprite.height / 2);
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * One wall block, painted with its own middle at the sprite's centre so the
   * draw call is a rotate and a blit.
   */
  private getWallSegment(
    state: 'full' | 'cracked' | 'rubble',
    span: number,
    thickness: number,
  ): HTMLCanvasElement {
    const R = TOWER_VISUAL.wallRadius;
    const mid = R + thickness / 2;
    const size = Math.max(thickness * 3, 2 * (R + thickness) * Math.sin(span / 2)) + entity(14);
    return this.towerPart(`wall|${state}`, size, (g) => {
      g.translate(-mid, 0);
      const gap = span * 0.055;
      const inner = state === 'rubble' ? R + thickness * 0.55 : R;
      const outer = state === 'rubble' ? R + thickness : R + thickness;
      const a0 = -span / 2 + gap;
      const a1 = span / 2 - gap;
      const block = (from: number, to: number, s: number, e: number): void => {
        g.beginPath();
        g.arc(0, 0, to, s, e);
        g.arc(0, 0, from, e, s, true);
        g.closePath();
      };

      if (state === 'rubble') {
        // A broken stub: lower, shorter and with a ragged crown.
        block(inner, outer, a0 + span * 0.18, a1 - span * 0.26);
        g.fillStyle = TOWER_VISUAL.stoneDeep;
        g.fill();
        g.fillStyle = withAlpha(INK['950'], 0.35);
        g.fill();
        return;
      }

      block(inner, outer, a0, a1);
      g.fillStyle = state === 'full' ? TOWER_VISUAL.stoneLit : TOWER_VISUAL.stoneMid;
      g.fill();
      // Lit crown on the outward face, shadowed foot on the inward one: the
      // block reads as having a top and a bottom.
      g.strokeStyle = withAlpha(TOWER_VISUAL.rim, state === 'full' ? 0.45 : 0.2);
      g.lineWidth = entity(1.8);
      g.beginPath();
      g.arc(0, 0, outer - entity(0.8), a0, a1);
      g.stroke();
      g.strokeStyle = withAlpha(INK['950'], 0.55);
      g.lineWidth = entity(2);
      g.beginPath();
      g.arc(0, 0, inner + entity(1), a0, a1);
      g.stroke();

      if (state === 'cracked') {
        g.strokeStyle = withAlpha(INK['950'], 0.8);
        g.lineWidth = entity(1.5);
        for (const at of [0.34, 0.62]) {
          const a = a0 + (a1 - a0) * at;
          g.beginPath();
          g.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
          const bend = a + span * 0.08;
          g.lineTo(Math.cos(bend) * (inner + thickness * 0.5), Math.sin(bend) * (inner + thickness * 0.5));
          g.lineTo(Math.cos(a - span * 0.03) * outer, Math.sin(a - span * 0.03) * outer);
          g.stroke();
        }
      }
      const bw = this.marks.steps.bulwark;
      if (bw >= 1) {
        // A merlon crowning the block's outward face.
        g.beginPath();
        g.arc(0, 0, outer + thickness * 0.3, a0 + span * 0.3, a1 - span * 0.3);
        g.arc(0, 0, outer - entity(0.5), a1 - span * 0.3, a0 + span * 0.3, true);
        g.closePath();
        g.fillStyle = state === 'full' ? TOWER_VISUAL.stoneLit : TOWER_VISUAL.stoneMid;
        g.fill();
        g.strokeStyle = withAlpha(INK['950'], 0.7);
        g.lineWidth = entity(1);
        g.stroke();
      }
      if (bw >= 3) {
        // Iron banding across the block, and spikes on the crown.
        g.strokeStyle = withAlpha(INK['200'], 0.85);
        g.lineWidth = entity(1.6);
        for (const at of [0.3, 0.7]) {
          const a = a0 + (a1 - a0) * at;
          g.beginPath();
          g.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
          g.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
          g.stroke();
          g.fillStyle = withAlpha(TOWER_VISUAL.rim, 0.55);
          g.beginPath();
          g.arc(Math.cos(a) * (inner + thickness * 0.5), Math.sin(a) * (inner + thickness * 0.5), entity(0.9), 0, Math.PI * 2);
          g.fill();
        }
        if (state === 'full') {
          g.fillStyle = INK['200'];
          for (const at of [0.35, 0.65]) {
            const a = a0 + (a1 - a0) * at;
            const bx = Math.cos(a) * (outer + thickness * 0.3);
            const by = Math.sin(a) * (outer + thickness * 0.3);
            g.beginPath();
            g.moveTo(bx, by);
            g.lineTo(Math.cos(a) * (outer + thickness * 0.85), Math.sin(a) * (outer + thickness * 0.85));
            g.lineTo(Math.cos(a + span * 0.06) * (outer + thickness * 0.3), Math.sin(a + span * 0.06) * (outer + thickness * 0.3));
            g.closePath();
            g.fill();
          }
        }
      }
    });
  }

  /**
   * Everything above the footing (§3.3): the masonry drum and its battlements,
   * the level-tier detail, the turret, and the core crystal.
   *
   * Drawn after the enemies, so the player's own tower is never occluded by the
   * things attacking it.
   */
  private drawTowerTop(ctx: CanvasRenderingContext2D, snap: RenderSnapshot): void {
    const t = snap.tower;
    const tier = this.towerTier(snap);
    const core = this.coreOf(snap);
    const tint = CORE_BY_ID[core].color;
    const m = this.marks.steps;

    this.blit(ctx, this.towerPart('drum', (TOWER_VISUAL.bodyRadius + entity(30)) * 2, (g) => {
      this.paintDrum(g, tier);
    }), t.x, t.y);

    // §D.7 step 3: the conduits pulse. One cached sprite, one `globalAlpha`,
    // no allocation — and it holds still under `prefers-reduced-motion` and at
    // the `low` quality tier, where the additive budget is spent elsewhere.
    if (m.conduits >= 3 && this.profile.additive && !this.reducedMotion) {
      const pulse = this.towerPart('conduit-pulse', (TOWER_VISUAL.bodyRadius + entity(6)) * 2, (g) => {
        const R = TOWER_VISUAL.bodyRadius;
        g.strokeStyle = withAlpha(lighten(FX.mana, 0.4), 0.8);
        g.lineWidth = entity(2.4);
        g.lineCap = 'round';
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
          g.beginPath();
          g.moveTo(Math.cos(a) * R * 0.5, Math.sin(a) * R * 0.5);
          g.lineTo(Math.cos(a) * R * 0.66, Math.sin(a) * R * 0.66);
          g.stroke();
        }
      });
      ctx.save();
      ctx.globalAlpha = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(this.time * 2.4));
      this.blit(ctx, pulse, t.x, t.y, 1 + 0.35 * (0.5 + 0.5 * Math.sin(this.time * 2.4)));
      ctx.restore();
    }

    // Tier 3: a slow arcane ring, drawn as a rotated blit of one cached sprite.
    if (tier >= 3) {
      const ring = this.towerPart('arcane-ring', (TOWER_VISUAL.bodyRadius + entity(20)) * 2, (g) => {
        const r = TOWER_VISUAL.bodyRadius + entity(13);
        g.strokeStyle = withAlpha(tint, 0.5);
        g.lineWidth = entity(1.6);
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2;
          g.beginPath();
          g.arc(0, 0, r, a, a + Math.PI * 0.42);
          g.stroke();
        }
        g.fillStyle = withAlpha(tint, 0.75);
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2 + Math.PI * 0.42;
          g.beginPath();
          g.arc(Math.cos(a) * r, Math.sin(a) * r, entity(2.6), 0, Math.PI * 2);
          g.fill();
        }
      });
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.rotate(this.reducedMotion ? 0 : this.time * 0.5);
      ctx.drawImage(ring, -ring.width / 2, -ring.height / 2);
      ctx.restore();
    }

    // Glow, then barrel, then gem: the crystal lights the turret from behind
    // rather than washing it out from in front.
    this.drawCrystalGlow(ctx, snap, tint);
    this.drawTurret(ctx, snap, tier, core);
    this.drawCoreCrystal(ctx, snap, tint);
  }

  /** Banded masonry, battlements, and whatever level and gold have earned. */
  private paintDrum(g: CanvasRenderingContext2D, tier: number): void {
    const R = TOWER_VISUAL.bodyRadius;
    const light = TOWER_VISUAL.lightAngle;
    const m = this.marks.steps;
    const rand = mulberry32(0x2b19f + tier);

    g.fillStyle = TOWER_VISUAL.stoneDark;
    g.beginPath();
    g.arc(0, 0, R, 0, Math.PI * 2);
    g.fill();

    // Courses of masonry, laid with the joints offset. The second course is
    // the tower's first *level* reward; the third is `health`'s belt course.
    const courses: Array<[number, number, number]> = [[R * 0.74, R, 18]];
    if (tier >= 1) courses.push([R * 0.44, R * 0.7, 12]);
    if (m.masonry >= 3) courses.push([R * 0.66, R * 0.735, 24]);
    for (const [from, to, count] of courses) {
      const step = (Math.PI * 2) / count;
      for (let i = 0; i < count; i++) {
        const a0 = i * step + step * 0.08;
        const a1 = (i + 1) * step - step * 0.08;
        const mid = (a0 + a1) / 2;
        const lit = 0.5 + 0.5 * Math.cos(mid - light);
        g.beginPath();
        g.arc(0, 0, to, a0, a1);
        g.arc(0, 0, from, a1, a0, true);
        g.closePath();
        g.fillStyle = rand() > 0.62 ? TOWER_VISUAL.stoneLit : TOWER_VISUAL.stoneMid;
        g.fill();
        g.fillStyle = withAlpha(TOWER_VISUAL.rim, 0.2 * lit * lit);
        g.fill();
        g.fillStyle = withAlpha(INK['950'], 0.34 * (1 - lit));
        g.fill();
      }
      g.strokeStyle = withAlpha(TOWER_VISUAL.mortar, 0.75);
      g.lineWidth = entity(1.4);
      g.beginPath();
      g.arc(0, 0, from, 0, Math.PI * 2);
      g.stroke();
    }

    this.paintPlating(g, R, light, m.plating);
    this.paintGilding(g, R, m.gilding, tier);
    this.paintConduits(g, R, m.conduits);

    // Battlements. More merlons is the tier-1 silhouette change you can read
    // from across the arena; `masonry` 4 adds four more on top of that.
    const merlons = m.masonry >= 4 ? 16 : tier >= 1 ? 12 : 8;
    const mStep = (Math.PI * 2) / merlons;
    const outerMerlon = R + entity(5);
    for (let i = 0; i < merlons; i++) {
      const a0 = i * mStep + mStep * 0.2;
      const a1 = (i + 1) * mStep - mStep * 0.2;
      const mid = (a0 + a1) / 2;
      const lit = 0.5 + 0.5 * Math.cos(mid - light);
      g.beginPath();
      g.arc(0, 0, outerMerlon, a0, a1);
      g.arc(0, 0, R - entity(1), a1, a0, true);
      g.closePath();
      g.fillStyle = m.plating >= 3 ? INK['200'] : TOWER_VISUAL.stoneMid;
      g.fill();
      g.fillStyle = withAlpha(TOWER_VISUAL.rim, 0.18 * lit);
      g.fill();
      g.fillStyle = withAlpha(INK['950'], 0.45 * (1 - lit));
      g.fill();

      // masonry 2: a capstone slab on every merlon.
      if (m.masonry >= 2) {
        g.beginPath();
        g.arc(0, 0, outerMerlon + entity(1.4), a0 - mStep * 0.05, a1 + mStep * 0.05);
        g.arc(0, 0, outerMerlon - entity(1), a1 + mStep * 0.05, a0 - mStep * 0.05, true);
        g.closePath();
        g.fillStyle = TOWER_VISUAL.stoneLit;
        g.fill();
        g.fillStyle = withAlpha(INK['950'], 0.4 * (1 - lit));
        g.fill();
      }
      // masonry 4: an arrow slit cut through each merlon.
      if (m.masonry >= 4) {
        g.strokeStyle = withAlpha(INK['950'], 0.85);
        g.lineWidth = entity(1.4);
        g.beginPath();
        g.moveTo(Math.cos(mid) * (R + entity(0.5)), Math.sin(mid) * (R + entity(0.5)));
        g.lineTo(Math.cos(mid) * (outerMerlon - entity(0.5)), Math.sin(mid) * (outerMerlon - entity(0.5)));
        g.stroke();
      }
    }

    // masonry 5: a parapet skirt filling the crenels partway, so the crown
    // reads as a solid wall-walk rather than a row of teeth.
    if (m.masonry >= 5) {
      g.strokeStyle = withAlpha(TOWER_VISUAL.stoneMid, 0.95);
      g.lineWidth = entity(3.2);
      g.beginPath();
      g.arc(0, 0, R + entity(2.2), 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = withAlpha(TOWER_VISUAL.rim, 0.3);
      g.lineWidth = entity(1);
      g.beginPath();
      g.arc(0, 0, R + entity(3.4), light - 1.2, light + 1.2);
      g.stroke();
    }

    this.paintMast(g, R, light, m.mast);

    // Tier 2: banners. The old flag was a three-point red triangle; red is the
    // enemy's colour now (docs/art-direction.md), so the tower flies amber.
    if (tier >= 2) {
      for (const dir of [-1, 1]) {
        g.save();
        g.rotate(dir * Math.PI * 0.5);
        g.fillStyle = withAlpha(TOWER_VISUAL.banner, 0.85);
        g.beginPath();
        g.moveTo(R - entity(2), -entity(4));
        g.lineTo(R + entity(17), -entity(1));
        g.lineTo(R + entity(12), entity(3));
        g.lineTo(R + entity(17), entity(7));
        g.lineTo(R - entity(2), entity(5));
        g.closePath();
        g.fill();
        g.strokeStyle = withAlpha(INK['950'], 0.4);
        g.lineWidth = entity(1);
        g.stroke();
        // gilding 2: a fringe along the banner's trailing edge.
        if (m.gilding >= 2) {
          g.strokeStyle = withAlpha(lighten(TOWER_VISUAL.banner, 0.4), 0.9);
          g.lineWidth = entity(0.9);
          for (let i = 0; i < 5; i++) {
            const x = R + entity(13) + i * entity(1);
            g.beginPath();
            g.moveTo(x, -entity(1) + i * entity(0.3));
            g.lineTo(x + entity(2), entity(1) + i * entity(0.3));
            g.stroke();
          }
        }
        g.restore();
      }
    }

    // Rim light along the lit edge. Segmented rather than one long stroke, so
    // it falls off toward the terminator instead of ending as a hard hoop.
    g.lineWidth = entity(2);
    for (let i = -4; i <= 4; i++) {
      const a = light + i * 0.26;
      const fall = 1 - Math.abs(i) / 5;
      g.strokeStyle = withAlpha(TOWER_VISUAL.rim, 0.4 * fall * fall);
      g.beginPath();
      g.arc(0, 0, R + entity(1.4), a - 0.14, a + 0.14);
      g.stroke();
    }

    // The chamber the crystal sits in: a floor, then an occlusion falloff, so
    // the middle of the tower is a recess rather than a hole cut in the page.
    g.fillStyle = TOWER_VISUAL.stoneDeep;
    g.beginPath();
    g.arc(0, 0, R * 0.42, 0, Math.PI * 2);
    g.fill();
    const well = g.createRadialGradient(0, 0, R * 0.1, 0, 0, R * 0.46);
    well.addColorStop(0, withAlpha(INK['950'], 0.55));
    well.addColorStop(1, withAlpha(INK['950'], 0));
    g.fillStyle = well;
    g.beginPath();
    g.arc(0, 0, R * 0.46, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = withAlpha(INK['950'], 0.7);
    g.lineWidth = entity(1.6);
    g.beginPath();
    g.arc(0, 0, R * 0.42, 0, Math.PI * 2);
    g.stroke();
  }

  /**
   * Iron strapping from the `defense` + `armor` lines
   * (`plans/tower-ui.md` §D.5).
   *
   * The plate is `INK['200']` — brighter *and* colder than any of the
   * `TOWER_VISUAL.stone*` steps — because a plate that is merely a lighter
   * stone reads as a lighting change, not as a second material. The rivets are
   * `rim` gold: the plating is still something the player owns.
   */
  private paintPlating(
    g: CanvasRenderingContext2D,
    R: number,
    light: number,
    step: number,
  ): void {
    if (step <= 0) return;
    const plate = INK['200'];

    // step 2: a girdle plate under the straps, so they have something to bite.
    if (step >= 2) {
      g.strokeStyle = withAlpha(plate, 0.75);
      g.lineWidth = R * 0.16;
      g.beginPath();
      g.arc(0, 0, R * 0.59, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = withAlpha(INK['950'], 0.5);
      g.lineWidth = entity(1.2);
      g.beginPath();
      g.arc(0, 0, R * 0.67, 0, Math.PI * 2);
      g.stroke();
    }

    const straps = step >= 2 ? 8 : 4;
    const halfWidth = step >= 2 ? 0.1 : 0.13;
    for (let i = 0; i < straps; i++) {
      const a = (i / straps) * Math.PI * 2 + Math.PI * 0.25;
      const lit = 0.5 + 0.5 * Math.cos(a - light);
      g.beginPath();
      g.arc(0, 0, R + entity(2), a - halfWidth, a + halfWidth);
      g.arc(0, 0, R * 0.42, a + halfWidth, a - halfWidth, true);
      g.closePath();
      g.fillStyle = plate;
      g.fill();
      g.fillStyle = withAlpha('#ffffff', 0.12 * lit);
      g.fill();
      g.fillStyle = withAlpha(INK['950'], 0.42 * (1 - lit));
      g.fill();
      g.strokeStyle = withAlpha(INK['950'], 0.7);
      g.lineWidth = entity(1);
      g.stroke();
      // Three rivets down each strap.
      g.fillStyle = withAlpha(TOWER_VISUAL.rim, 0.5 + 0.3 * lit);
      for (const at of [0.55, 0.75, 0.94]) {
        g.beginPath();
        g.arc(Math.cos(a) * R * at, Math.sin(a) * R * at, entity(1.1), 0, Math.PI * 2);
        g.fill();
      }
    }

    // step 3: the outer course is faced in plate — sixteen flat facets with
    // lit edges, which is what turns "banded stone" into "an armoured keep".
    if (step >= 3) {
      const facets = 16;
      const fStep = (Math.PI * 2) / facets;
      for (let i = 0; i < facets; i++) {
        const a0 = i * fStep;
        const a1 = (i + 1) * fStep;
        const mid = (a0 + a1) / 2;
        const lit = 0.5 + 0.5 * Math.cos(mid - light);
        g.beginPath();
        g.moveTo(Math.cos(a0) * R, Math.sin(a0) * R);
        g.lineTo(Math.cos(a1) * R, Math.sin(a1) * R);
        g.lineTo(Math.cos(a1) * R * 0.8, Math.sin(a1) * R * 0.8);
        g.lineTo(Math.cos(a0) * R * 0.8, Math.sin(a0) * R * 0.8);
        g.closePath();
        g.fillStyle = plate;
        g.fill();
        g.fillStyle = withAlpha('#ffffff', 0.14 * lit * lit);
        g.fill();
        g.fillStyle = withAlpha(INK['950'], 0.45 * (1 - lit));
        g.fill();
        g.strokeStyle = withAlpha(INK['950'], 0.55);
        g.lineWidth = entity(0.9);
        g.stroke();
      }
    }
  }

  /**
   * Gold trim from the `goldMulti` + `prospecting` lines
   * (`plans/tower-ui.md` §D.6).
   *
   * Amber is already the player's colour, so gilding is the one mark that adds
   * no new hue — it adds *quantity* of the colour that is already there. That
   * is deliberate: a rich tower should look like the same tower with more gold
   * on it, not like a different faction's.
   */
  private paintGilding(
    g: CanvasRenderingContext2D,
    R: number,
    step: number,
    tier: number,
  ): void {
    if (step <= 0) return;
    const gold = TOWER_VISUAL.rim;

    // step 1: the mortar joints of the outer course are gilded.
    g.strokeStyle = withAlpha(gold, 0.3);
    g.lineWidth = entity(1.2);
    g.beginPath();
    g.arc(0, 0, R * 0.74, 0, Math.PI * 2);
    g.stroke();
    const joints = 18;
    for (let i = 0; i < joints; i++) {
      const a = (i / joints) * Math.PI * 2;
      g.beginPath();
      g.moveTo(Math.cos(a) * R * 0.74, Math.sin(a) * R * 0.74);
      g.lineTo(Math.cos(a) * R, Math.sin(a) * R);
      g.stroke();
    }

    if (step < 2) return;

    // step 2: filigree — a scrolled band of small arcs above the belt course.
    g.strokeStyle = withAlpha(lighten(gold, 0.3), 0.55);
    g.lineWidth = entity(1.1);
    const scrolls = tier >= 1 ? 12 : 9;
    for (let i = 0; i < scrolls; i++) {
      const a = (i / scrolls) * Math.PI * 2;
      g.beginPath();
      g.arc(Math.cos(a) * R * 0.63, Math.sin(a) * R * 0.63, entity(3.2), a - 2.2, a + 0.9);
      g.stroke();
    }

    if (step < 3) return;

    // step 3: coin studs set around the drum.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const x = Math.cos(a) * R * 0.86;
      const y = Math.sin(a) * R * 0.86;
      g.fillStyle = withAlpha(INK['950'], 0.6);
      g.beginPath();
      g.arc(x, y, entity(3.1), 0, Math.PI * 2);
      g.fill();
      g.fillStyle = gold;
      g.beginPath();
      g.arc(x, y, entity(2.4), 0, Math.PI * 2);
      g.fill();
      g.fillStyle = withAlpha(lighten(gold, 0.55), 0.8);
      g.beginPath();
      g.arc(x - entity(0.7), y - entity(0.7), entity(0.9), 0, Math.PI * 2);
      g.fill();
    }
  }

  /**
   * Mana channels from the `manaRegen` + `maxMana` lines
   * (`plans/tower-ui.md` §D.7).
   *
   * They run *inward*, to the crystal well, because that is where the tower's
   * power visibly is — a conduit that ended nowhere would be a decoration.
   * `FX.mana` is the mana pool's own colour, so a player who reads the HUD
   * bar already knows what these are.
   */
  private paintConduits(g: CanvasRenderingContext2D, R: number, step: number): void {
    if (step <= 0) return;
    const n = step >= 2 ? 6 : 3;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.PI / n;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      // The groove first, so the glow sits in a channel rather than on the face.
      g.strokeStyle = withAlpha(INK['950'], 0.7);
      g.lineWidth = entity(3.4);
      g.beginPath();
      g.moveTo(ux * R * 0.42, uy * R * 0.42);
      g.lineTo(ux * R * 0.9, uy * R * 0.9);
      g.stroke();
      g.strokeStyle = withAlpha(FX.mana, 0.55);
      g.lineWidth = entity(1.8);
      g.beginPath();
      g.moveTo(ux * R * 0.44, uy * R * 0.44);
      g.lineTo(ux * R * 0.88, uy * R * 0.88);
      g.stroke();
      // step 3: each channel forks near the rim.
      if (step >= 3) {
        for (const spread of [-0.22, 0.22]) {
          const b = a + spread;
          g.beginPath();
          g.moveTo(ux * R * 0.78, uy * R * 0.78);
          g.lineTo(Math.cos(b) * R * 0.97, Math.sin(b) * R * 0.97);
          g.stroke();
        }
      }
    }
    // step 2: a collector ring the channels feed out of.
    if (step >= 2) {
      g.strokeStyle = withAlpha(FX.mana, 0.4);
      g.lineWidth = entity(1.4);
      g.beginPath();
      g.arc(0, 0, R * 0.86, 0, Math.PI * 2);
      g.stroke();
    }
  }

  /**
   * A spotter's mast from the `range` line (`plans/tower-ui.md` §D.8).
   *
   * It leans along the key light, which at this near-top-down angle is what
   * reads as "up" — a mast drawn straight along +x would read as a spar
   * sticking sideways out of the wall. `range` is the one stat with an existing
   * battlefield expression (the ring), so this is the piece of tower that
   * *explains* the ring rather than duplicating it.
   */
  private paintMast(
    g: CanvasRenderingContext2D,
    R: number,
    light: number,
    step: number,
  ): void {
    if (step <= 0) return;
    const angles = step >= 3 ? [light, light + Math.PI] : [light];
    for (const a of angles) {
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const x0 = ux * R * 0.5;
      const y0 = uy * R * 0.5;
      const x1 = ux * (R + entity(13));
      const y1 = uy * (R + entity(13));
      // The pole, with its own shadow line so it lifts off the drum.
      g.strokeStyle = withAlpha(INK['950'], 0.6);
      g.lineWidth = entity(3);
      g.beginPath();
      g.moveTo(x0 + entity(1), y0 + entity(1.5));
      g.lineTo(x1 + entity(1), y1 + entity(1.5));
      g.stroke();
      g.strokeStyle = TOWER_VISUAL.stoneLit;
      g.lineWidth = entity(2);
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
      // The crow's nest.
      g.fillStyle = TOWER_VISUAL.stoneMid;
      g.beginPath();
      g.arc(x1, y1, entity(4), 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = withAlpha(INK['950'], 0.8);
      g.lineWidth = entity(1.2);
      g.stroke();
      g.strokeStyle = withAlpha(TOWER_VISUAL.rim, 0.5);
      g.lineWidth = entity(1);
      g.beginPath();
      g.arc(x1, y1, entity(2.4), 0, Math.PI * 2);
      g.stroke();

      if (step < 2) continue;

      // step 2: a crossbar with a pennant, and a lookout lantern.
      const px = -uy;
      const py = ux;
      g.strokeStyle = TOWER_VISUAL.stoneLit;
      g.lineWidth = entity(1.4);
      g.beginPath();
      g.moveTo(x1 - px * entity(6), y1 - py * entity(6));
      g.lineTo(x1 + px * entity(6), y1 + py * entity(6));
      g.stroke();
      g.fillStyle = withAlpha(TOWER_VISUAL.banner, 0.85);
      g.beginPath();
      g.moveTo(x1 + px * entity(6), y1 + py * entity(6));
      g.lineTo(x1 + px * entity(6) + ux * entity(6), y1 + py * entity(6) + uy * entity(6));
      g.lineTo(x1 + px * entity(1.5) + ux * entity(4), y1 + py * entity(1.5) + uy * entity(4));
      g.closePath();
      g.fill();
      const lantern = g.createRadialGradient(
        x1 - px * entity(6), y1 - py * entity(6), 0,
        x1 - px * entity(6), y1 - py * entity(6), entity(6),
      );
      lantern.addColorStop(0, withAlpha(lighten(TOWER_VISUAL.rim, 0.5), 0.9));
      lantern.addColorStop(1, withAlpha(TOWER_VISUAL.rim, 0));
      g.fillStyle = lantern;
      g.beginPath();
      g.arc(x1 - px * entity(6), y1 - py * entity(6), entity(6), 0, Math.PI * 2);
      g.fill();
    }
  }

  /**
   * The turret: it points where the tower is shooting, kicks back when it does,
   * and flashes at the muzzle (UI plan §3.3) — and it is rebuilt as `damage`,
   * `fireRate` and the crit lines are levelled (`plans/tower-ui.md` §D.1–3).
   *
   * The heading is read off the projectiles, so the barrel is aimed by the same
   * fact that aimed the shot rather than by a copy of the targeting rules.
   */
  private drawTurret(ctx: CanvasRenderingContext2D, snap: RenderSnapshot, tier: number, core: CoreId): void {
    const t = snap.tower;
    const tint = CORE_BY_ID[core].color;
    const m = this.marks.steps;
    const b = m.barrel;
    const len = this.drawnTurretLength;
    const sprite = this.towerPart('turret', (len + entity(20)) * 2, (g) => {
      const w = TOWER_VISUAL.turretWidth * (1 + b * 0.03);
      const base = entity(3);

      // §D.2: the autoloader sits under the barrel, at the breech.
      this.paintAutoloader(g, base, w, len, m.autoloader, tint);

      // Underside first, so the barrel sits on its own shadow.
      g.fillStyle = withAlpha(INK['950'], 0.55);
      g.beginPath();
      g.moveTo(base, -w * 0.5 + entity(2));
      g.lineTo(len, -w * 0.34 + entity(2));
      g.lineTo(len, w * 0.34 + entity(2.5));
      g.lineTo(base, w * 0.5 + entity(2.5));
      g.closePath();
      g.fill();

      // b >= 3: a reinforcing sleeve at the breech. Painted before the shaft so
      // the shaft's outline crosses it and the two read as one assembly.
      if (b >= 3) {
        g.fillStyle = TOWER_VISUAL.stoneMid;
        g.fillRect(base - entity(2), -w * 0.78, (len - base) * 0.36, w * 1.56);
        g.strokeStyle = withAlpha(INK['950'], 0.8);
        g.lineWidth = entity(1.4);
        g.strokeRect(base - entity(2), -w * 0.78, (len - base) * 0.36, w * 1.56);
        g.strokeStyle = withAlpha(TOWER_VISUAL.rim, 0.4);
        g.lineWidth = entity(1.2);
        g.beginPath();
        g.moveTo(base - entity(2), -w * 0.78 + entity(1));
        g.lineTo(base - entity(2) + (len - base) * 0.36, -w * 0.78 + entity(1));
        g.stroke();
      }

      g.fillStyle = TOWER_VISUAL.stoneLit;
      g.beginPath();
      g.moveTo(base, -w * 0.5);
      g.lineTo(len, -w * 0.34);
      g.lineTo(len, w * 0.34);
      g.lineTo(base, w * 0.5);
      g.closePath();
      g.fill();
      // A dark outline, because the barrel is stone on stone and needs a
      // silhouette of its own to read at this zoom.
      g.strokeStyle = withAlpha(INK['950'], 0.85);
      g.lineWidth = entity(1.6);
      g.stroke();
      // Lit top edge.
      g.strokeStyle = withAlpha(TOWER_VISUAL.rim, 0.65);
      g.lineWidth = entity(1.6);
      g.beginPath();
      g.moveTo(base, -w * 0.5 + entity(0.9));
      g.lineTo(len, -w * 0.34 + entity(0.9));
      g.stroke();

      // b >= 2: a dorsal blade along the top of the shaft. This is the first
      // change that alters the *silhouette* rather than the surface, which is
      // why it is early in the ladder.
      if (b >= 2) {
        g.fillStyle = TOWER_VISUAL.stoneMid;
        g.beginPath();
        g.moveTo(base + (len - base) * 0.24, -w * 0.5);
        g.lineTo(len - entity(3), -w * 0.5 - entity(4.5));
        g.lineTo(len - entity(3), -w * 0.34);
        g.closePath();
        g.fill();
        g.strokeStyle = withAlpha(INK['950'], 0.8);
        g.lineWidth = entity(1.1);
        g.stroke();
        g.strokeStyle = withAlpha(TOWER_VISUAL.rim, 0.5);
        g.lineWidth = entity(1);
        g.beginPath();
        g.moveTo(base + (len - base) * 0.24, -w * 0.5);
        g.lineTo(len - entity(3), -w * 0.5 - entity(4.5));
        g.stroke();
      }

      // Amber banding. More bands as the line is levelled: the barrel is
      // reinforced, not merely longer.
      const bands = b >= 5 ? [0.22, 0.4, 0.58, 0.74, 0.87]
        : b >= 3 ? [0.28, 0.5, 0.7, 0.86]
          : b >= 1 ? [0.3, 0.55, 0.8]
            : tier >= 2 ? [0.32, 0.58, 0.8] : [0.4, 0.72];
      g.fillStyle = withAlpha(TOWER_VISUAL.rim, 0.55);
      for (const at of bands) {
        const x = base + (len - base) * at;
        g.fillRect(x, -w * 0.5, entity(2.4), w);
      }

      // b >= 5: gold inlay chased along the shaft, between the bands.
      if (b >= 5) {
        g.strokeStyle = withAlpha(TOWER_VISUAL.rim, 0.45);
        g.lineWidth = entity(1);
        for (let i = 0; i < 6; i++) {
          const x = base + (len - base) * (0.16 + i * 0.13);
          g.beginPath();
          g.moveTo(x, -w * 0.34);
          g.lineTo(x + entity(4), w * 0.34);
          g.stroke();
        }
      }

      // b >= 6: a charged channel cut down the middle, fed by the core.
      if (b >= 6) {
        g.fillStyle = withAlpha(tint, 0.55);
        g.fillRect(base + entity(2), -w * 0.12, len - base - entity(4), w * 0.24);
        g.fillStyle = withAlpha(INK['050'], 0.35);
        g.fillRect(base + entity(2), -w * 0.05, len - base - entity(4), w * 0.1);
      }

      // The muzzle collar, in the core's colour, so the shot's colour is
      // announced before it leaves. It thickens at the top of the ladder.
      const collar = b >= 6 ? entity(6) : entity(3);
      g.fillStyle = withAlpha(tint, 0.85);
      g.fillRect(len - collar, -w * 0.4, collar, w * 0.8);

      // b >= 1: a muzzle brake — two notches cut across the collar.
      if (b >= 1) {
        g.fillStyle = withAlpha(INK['950'], 0.75);
        g.fillRect(len - collar - entity(3), -w * 0.5, entity(1.6), w);
        g.fillRect(len - collar - entity(7), -w * 0.5, entity(1.6), w);
      }

      // b >= 4: twin prongs, swept forward off the muzzle. The heaviest
      // silhouette change on the ladder — this is what a maxed barrel is.
      if (b >= 4) {
        g.fillStyle = TOWER_VISUAL.stoneLit;
        g.strokeStyle = withAlpha(INK['950'], 0.85);
        g.lineWidth = entity(1.2);
        for (const dir of [-1, 1]) {
          g.beginPath();
          g.moveTo(len - entity(6), dir * w * 0.34);
          g.lineTo(len + entity(8), dir * (w * 0.62 + (b >= 6 ? entity(3) : 0)));
          g.lineTo(len + entity(3), dir * w * 0.28);
          g.closePath();
          g.fill();
          g.stroke();
        }
      }

      // Tier 2+: side vanes, so a levelled *tower* has a heavier silhouette
      // too. This is the tower-XP tier, not a mark — leave it alone.
      if (tier >= 2) {
        g.fillStyle = TOWER_VISUAL.stoneDark;
        for (const dir of [-1, 1]) {
          g.beginPath();
          g.moveTo(base + entity(4), dir * w * 0.5);
          g.lineTo(base + entity(14), dir * (w * 0.5 + entity(4)));
          g.lineTo(base + entity(16), dir * w * 0.5);
          g.closePath();
          g.fill();
        }
      }

      // §D.3: the sights sit on top of everything.
      this.paintOptics(g, base, w, len, m.optics, tint);
    });

    const back = TOWER_VISUAL.recoilDistance * easeOutCubic(this.recoil);
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(this.turretAngle);
    ctx.translate(-back, 0);
    ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2);
    ctx.restore();
  }

  /**
   * Feed gear at the breech, from the `fireRate` line
   * (`plans/tower-ui.md` §D.2).
   *
   * Painted *before* the barrel so the barrel overlaps the drums' inboard
   * edges — the gear reads as bolted under the weapon rather than floating
   * beside it.
   */
  private paintAutoloader(
    g: CanvasRenderingContext2D,
    base: number,
    w: number,
    len: number,
    step: number,
    tint: string,
  ): void {
    if (step <= 0) return;
    const cx = base + (len - base) * 0.16;
    const r = entity(6.5);
    const sides: number[] = step >= 2 ? [-1, 1] : [-1];

    for (const dir of sides) {
      const cy = dir * (w * 0.62 + r * 0.6);
      g.fillStyle = TOWER_VISUAL.stoneMid;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = withAlpha(INK['950'], 0.85);
      g.lineWidth = entity(1.3);
      g.stroke();
      // Four spokes, so the drum reads as a drum and not as a dot.
      g.strokeStyle = withAlpha(INK['950'], 0.6);
      g.lineWidth = entity(1.1);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85);
        g.stroke();
      }
      g.fillStyle = withAlpha(TOWER_VISUAL.rim, 0.5);
      g.beginPath();
      g.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
      g.fill();
      // step 3: the drums are wound to the core and glow with it.
      if (step >= 3) {
        g.fillStyle = withAlpha(tint, 0.75);
        g.beginPath();
        g.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = withAlpha(INK['050'], 0.5);
        g.beginPath();
        g.arc(cx, cy, r * 0.2, 0, Math.PI * 2);
        g.fill();
      }
    }

    // step 2+: feed rails running forward along the flanks.
    if (step >= 2) {
      g.fillStyle = withAlpha(INK['200'], 0.85);
      for (const dir of [-1, 1]) {
        g.fillRect(cx, dir * w * 0.5 - (dir < 0 ? entity(1.8) : 0), (len - cx) * 0.62, entity(1.8));
      }
    }
    // step 3: a third rail over the top.
    if (step >= 3) {
      g.fillStyle = withAlpha(INK['200'], 0.7);
      g.fillRect(cx, -entity(0.9), (len - cx) * 0.5, entity(1.8));
    }
  }

  /**
   * Sights, from the two crit lines (`plans/tower-ui.md` §D.3).
   *
   * Painted last, over the barrel, because a scope is bolted on top of a
   * weapon and its silhouette has to break the barrel's outline to read as a
   * separate object. Crit is precision, so this is the one piece of the tower
   * allowed a hard white highlight (`'#ffffff'`, whitelisted).
   */
  private paintOptics(
    g: CanvasRenderingContext2D,
    base: number,
    w: number,
    len: number,
    step: number,
    tint: string,
  ): void {
    if (step <= 0) return;

    // step 1: a front sight post and a rear notch.
    g.fillStyle = TOWER_VISUAL.stoneMid;
    g.strokeStyle = withAlpha(INK['950'], 0.8);
    g.lineWidth = entity(1);
    g.beginPath();
    g.rect(len - entity(10), -w * 0.5 - entity(4), entity(1.8), entity(4));
    g.fill();
    g.stroke();
    g.beginPath();
    g.rect(base + (len - base) * 0.2, -w * 0.5 - entity(3), entity(3.4), entity(3));
    g.fill();
    g.stroke();

    if (step < 2) return;

    // step 2: a scope tube over the barrel, on two mounts.
    const x0 = base + (len - base) * 0.3;
    const x1 = base + (len - base) * 0.78;
    const cy = -w * 0.5 - entity(5.5);
    const th = entity(5);
    g.fillStyle = withAlpha(INK['200'], 0.9);
    for (const at of [x0 + entity(2), x1 - entity(4)]) {
      g.fillRect(at, cy, entity(2.2), entity(6));
    }
    g.fillStyle = TOWER_VISUAL.stoneLit;
    g.beginPath();
    g.rect(x0, cy - th / 2, x1 - x0, th);
    g.fill();
    g.strokeStyle = withAlpha(INK['950'], 0.85);
    g.lineWidth = entity(1.3);
    g.stroke();
    g.strokeStyle = withAlpha(TOWER_VISUAL.rim, 0.55);
    g.lineWidth = entity(1);
    g.beginPath();
    g.moveTo(x0 + entity(1), cy - th / 2 + entity(1));
    g.lineTo(x1 - entity(1), cy - th / 2 + entity(1));
    g.stroke();

    // The objective lens, in the core's colour.
    g.fillStyle = withAlpha(tint, 0.85);
    g.beginPath();
    g.ellipse(x1, cy, entity(1.6), th * 0.55, 0, 0, Math.PI * 2);
    g.fill();

    if (step < 3) return;

    // step 3: the lens is ground and cross-etched, and a windage drum is fitted.
    g.strokeStyle = withAlpha('#ffffff', 0.85);
    g.lineWidth = entity(0.8);
    g.beginPath();
    g.moveTo(x1, cy - th * 0.5);
    g.lineTo(x1, cy + th * 0.5);
    g.moveTo(x1 - entity(1.5), cy);
    g.lineTo(x1 + entity(1.5), cy);
    g.stroke();
    g.fillStyle = withAlpha('#ffffff', 0.55);
    g.beginPath();
    g.ellipse(x1 - entity(0.4), cy - th * 0.2, entity(0.5), th * 0.16, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = withAlpha(TOWER_VISUAL.rim, 0.8);
    g.beginPath();
    g.arc((x0 + x1) / 2, cy - th * 0.55, entity(2), 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = withAlpha(INK['950'], 0.7);
    g.lineWidth = entity(0.9);
    g.stroke();
  }

  /**
   * The muzzle flash (§4.4), lifted out of `drawTurret` so it can ride the one
   * additive pass (§5.A) instead of compositing `source-over` on the barrel.
   *
   * It rebuilds the barrel's transform rather than being drawn inside it: the
   * flash is light and paints after the world, the barrel is stone and paints
   * with it.
   */
  private drawMuzzleFlash(ctx: CanvasRenderingContext2D, snap: RenderSnapshot): void {
    if (this.muzzle <= 0) return;
    const t = snap.tower;
    const core = this.core;
    const tint = CORE_BY_ID[core].color;
    const len = this.drawnTurretLength;
    const back = TOWER_VISUAL.recoilDistance * easeOutCubic(this.recoil);
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(this.turretAngle);
    ctx.translate(-back, 0);
    const flash = this.part(`muzzle|${core}`, entity(30), (g) => {
      const r = entity(14);
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
      grad.addColorStop(0, withAlpha(INK['050'], 0.95));
      grad.addColorStop(0.35, withAlpha(tint, 0.7));
      grad.addColorStop(1, withAlpha(tint, 0));
      g.fillStyle = grad;
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.fill();
      // Four spikes, so the flash has a direction rather than being a dot.
      g.fillStyle = withAlpha(INK['050'], 0.8);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        g.save();
        g.rotate(a);
        g.beginPath();
        g.moveTo(0, -entity(2));
        g.lineTo(r * (i % 2 === 0 ? 1 : 0.55), 0);
        g.lineTo(0, entity(2));
        g.closePath();
        g.fill();
        g.restore();
      }
    });
    ctx.save();
    ctx.globalAlpha = this.muzzle;
    ctx.translate(len, 0);
    // §D.1/§D.2: a bigger barrel and a fed autoloader throw a bigger flash.
    const gear = 1 + this.marks.steps.barrel * 0.05 + this.marks.steps.autoloader * 0.07;
    const burst = (1 + Math.min(5, this.muzzleBurst - 1) * 0.16) * gear;
    const s = (0.65 + (1 - this.muzzle) * 0.6) * burst;
    ctx.drawImage(flash, -flash.width * s / 2, -flash.height * s / 2, flash.width * s, flash.height * s);
    ctx.restore();
    ctx.restore();
  }

  /**
   * Tracers (§4.4).
   *
   * At a high enough fire rate the individual bolts stop being individually
   * visible — they blur into a stream, and a stream carries no information
   * about *rate*. A one-frame line of fire from the muzzle along each shot's
    * heading is what puts the rate back: the faster the tower fires, the more
    * of the arena is criss-crossed with them, and a Rocket Barrage fan draws
    * its own.
   *
   * One cached tapered sprite, rotated and blitted, additively. Nothing here
   * allocates and the pool is capped at `TRACER_CAP`.
   */
  private drawTracers(ctx: CanvasRenderingContext2D, snap: RenderSnapshot): void {
    if (this.tracers.length === 0) return;
    const t = snap.tower;
    const core = this.core;
    const sprite = this.part(`tracer|${core}`, TRACER_LENGTH * 2.1, (g) => {
      const tint = CORE_BY_ID[core].color;
      const grad = g.createLinearGradient(0, 0, TRACER_LENGTH, 0);
      grad.addColorStop(0, withAlpha(INK['050'], 0.9));
      grad.addColorStop(0.12, withAlpha(tint, 0.6));
      grad.addColorStop(1, withAlpha(tint, 0));
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0, -entity(2.2));
      g.lineTo(TRACER_LENGTH, -entity(0.4));
      g.lineTo(TRACER_LENGTH, entity(0.4));
      g.lineTo(0, entity(2.2));
      g.closePath();
      g.fill();
    });
    const half = sprite.width / 2;
    ctx.save();
    for (const tr of this.tracers) {
      ctx.save();
      ctx.globalAlpha = 1 - tr.age / TRACER_TIME;
      ctx.translate(t.x, t.y);
      ctx.rotate(tr.angle);
      // The sprite is baked with the muzzle at its centre, so it is drawn
      // offset by half its own width rather than centred on the tower.
      ctx.translate(this.drawnTurretLength, 0);
      ctx.drawImage(sprite, -half, -half);
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * The core crystal (§3.3).
   *
   * The one piece of the tower that is not stone, and the only place a run's
   * *core* — its whole identity — shows up during play. It charges over the
   * shot cadence and discharges when the shot leaves, so a tower with fire rate
   * visibly beats faster than one without.
   */
  /**
   * How lit the crystal is this frame: it charges over the shot cadence and
   * discharges as the shot leaves.
   */
  private crystalCharge(snap: RenderSnapshot): number {
    const t = snap.tower;
    const rate = t.fireRate > 0 ? t.fireRate : 1;
    const phase = this.reducedMotion ? 0.7 : Math.max(0, Math.min(1, 1 - t.cooldown * rate));
    return 0.55 + phase * 0.45 + this.muzzle * 0.5;
  }

  private drawCrystalGlow(ctx: CanvasRenderingContext2D, snap: RenderSnapshot, tint: string): void {
    const t = snap.tower;
    const r = TOWER_VISUAL.crystalRadius;
    const charge = this.crystalCharge(snap);
    const glow = this.part(`crystal-glow|${tint}`, r * 6, (g) => {
      const gr = r * 3;
      const grad = g.createRadialGradient(0, 0, r * 0.3, 0, 0, gr);
      grad.addColorStop(0, withAlpha(tint, 0.42));
      grad.addColorStop(0.4, withAlpha(tint, 0.13));
      grad.addColorStop(1, withAlpha(tint, 0));
      g.fillStyle = grad;
      g.beginPath();
      g.arc(0, 0, gr, 0, Math.PI * 2);
      g.fill();
    });
    ctx.save();
    ctx.globalAlpha = Math.min(1, charge * 0.6);
    this.blit(ctx, glow, t.x, t.y, 0.85 + charge * 0.3);
    ctx.restore();
  }

  private drawCoreCrystal(ctx: CanvasRenderingContext2D, snap: RenderSnapshot, tint: string): void {
    const t = snap.tower;
    const r = TOWER_VISUAL.crystalRadius;
    const charge = this.crystalCharge(snap);

    const body = this.part(`crystal|${tint}`, r * 2.8, (g) => {
      // A hexagonal gem: dark facets, a bright core, one specular highlight.
      const face = (radius: number, rot: number): void => {
        g.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = rot + (i / 6) * Math.PI * 2;
          const px = Math.cos(a) * radius;
          const py = Math.sin(a) * radius * 1.12;
          if (i === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.closePath();
      };
      face(r, -Math.PI / 2);
      g.fillStyle = withAlpha(tint, 0.95);
      g.fill();
      g.strokeStyle = withAlpha(INK['950'], 0.6);
      g.lineWidth = entity(1.2);
      g.stroke();
      face(r * 0.5, -Math.PI / 2);
      g.fillStyle = withAlpha(INK['050'], 0.6);
      g.fill();
      g.fillStyle = withAlpha(INK['050'], 0.4);
      g.beginPath();
      g.ellipse(-r * 0.32, -r * 0.42, r * 0.18, r * 0.28, -0.5, 0, Math.PI * 2);
      g.fill();
    });
    this.blit(ctx, body, t.x, t.y, 0.9 + charge * 0.14);
  }

  /**
   * The range ring (§3.2).
   *
   * It is the most important non-entity element on screen, and until Part 3 it
   * was a 1 px dashed circle at 6% white — a line you could not see, marking a
   * boundary that (before Part 1) was off the edge of the canvas anyway. Four
   * things replace it:
   *
   * 1. A soft falloff annulus, so "in range" is a readable **region** and not a
   *    line. One cached sprite of a normalised disc, scaled to the radius.
   * 2. A crisp rim, drawn as a plain stroked arc so it stays 2 px whatever the
   *    range is — a scaled sprite would thicken as range grew.
   * 3. A slow highlight sweep around the rim: seven trailing arc strokes, no
   *    allocation, and it holds still under `prefers-reduced-motion`.
   * 4. A 400 ms ease and a bloom whenever `range` resolves to a new number, so
   *    buying `Longbow` has a visible payoff.
   *
   * All of it is tinted by the run's core.
   */
  private drawRangeRing(ctx: CanvasRenderingContext2D, snap: RenderSnapshot): void {
    const t = snap.tower;
    const r = this.rangeDrawn;
    if (r <= 0) return;
    const tint = this.coreTint(snap);
    const bloom = this.rangeBloom;

    const fill = this.part(`range-fill|${tint}`, RANGE_SPRITE_RADIUS * 2, (g) => {
      const R = RANGE_SPRITE_RADIUS;
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, R);
      grad.addColorStop(0, withAlpha(tint, 0));
      grad.addColorStop(0.5, withAlpha(tint, 0.022));
      grad.addColorStop(0.86, withAlpha(tint, 0.05));
      grad.addColorStop(0.97, withAlpha(tint, 0.1));
      grad.addColorStop(1, withAlpha(tint, 0));
      g.fillStyle = grad;
      g.beginPath();
      g.arc(0, 0, R, 0, Math.PI * 2);
      g.fill();
    });
    ctx.save();
    ctx.globalAlpha = 1 + bloom * 1.6;
    this.blit(ctx, fill, t.x, t.y, (r * 2) / fill.width);
    ctx.restore();

    ctx.save();
    // The rim.
    ctx.strokeStyle = withAlpha(tint, 0.45 + bloom * 0.45);
    ctx.lineWidth = entity(1.8);
    ctx.beginPath();
    ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
    ctx.stroke();
    // An inner hairline, which is what gives the rim thickness at a glance.
    ctx.strokeStyle = withAlpha(tint, 0.09 + bloom * 0.2);
    ctx.lineWidth = entity(1);
    ctx.beginPath();
    ctx.arc(t.x, t.y, r - entity(6), 0, Math.PI * 2);
    ctx.stroke();

    // §D.8 step 3: cardinal ticks on the rim, so the ring reads as *measured*
    // rather than merely drawn. Four strokes; no sprite worth baking.
    if (this.marks.steps.mast >= 3) {
      ctx.strokeStyle = withAlpha(tint, 0.5 + bloom * 0.3);
      ctx.lineWidth = entity(2.2);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const ux = Math.cos(a);
        const uy = Math.sin(a);
        ctx.beginPath();
        ctx.moveTo(t.x + ux * (r - entity(7)), t.y + uy * (r - entity(7)));
        ctx.lineTo(t.x + ux * (r + entity(5)), t.y + uy * (r + entity(5)));
        ctx.stroke();
      }
    }

    // The sweep.
    const head = this.reducedMotion ? -Math.PI / 2 : this.time * RANGE_SWEEP_SPEED;
    const segment = 0.13;
    ctx.lineWidth = entity(2.6);
    for (let i = 0; i < RANGE_SWEEP_SEGMENTS; i++) {
      const fade = 1 - i / RANGE_SWEEP_SEGMENTS;
      ctx.strokeStyle = withAlpha(tint, 0.42 * fade * fade);
      ctx.beginPath();
      ctx.arc(t.x, t.y, r, head - (i + 1) * segment, head - i * segment);
      ctx.stroke();
    }

    // The bloom: a ghost ring pushing outward from the new radius.
    if (bloom > 0) {
      ctx.strokeStyle = withAlpha(tint, bloom * 0.4);
      ctx.lineWidth = entity(1 + bloom * 4);
      ctx.beginPath();
      ctx.arc(t.x, t.y, r + (1 - bloom) * entity(26), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Loot orbs (gameplay plan §4.1).
   *
   * Nothing here allocates: the body is a cached sprite blitted at a pulse
   * scale, and the only live work is the bob offset and, once an orb is nearly
   * home, a fading "about to auto-collect" ring so the player can see the
   * clock running on the full-value click.
   */
  private drawOrbs(ctx: CanvasRenderingContext2D, orbs: LootOrb[] | undefined): void {
    if (!orbs || orbs.length === 0) return;
    ctx.save();
    for (const orb of orbs) {
      if (!orb.alive) continue;
      const sprite = this.getOrbSprite(orb.kind);
      const pulse = 1 + Math.sin(this.time * 5 + orb.id) * 0.08;
      const bob = Math.sin(this.time * 3.4 + orb.id * 0.7) * 2;
      const size = sprite.width * pulse;
      ctx.drawImage(sprite, orb.x - size / 2, orb.y + bob - size / 2, size, size);
    }
    ctx.restore();
  }

  private getOrbSprite(kind: LootOrbKind): HTMLCanvasElement {
    const cached = this.orbSprites.get(kind);
    if (cached) return cached;
    const colors = LOOT_ORB_COLORS[kind];
    const r = LOOT_TUNING.orbRadius;
    const glowR = r * 2.4;
    const sprite = this.makeSprite(glowR * 2, (g) => {
      const grad = g.createRadialGradient(0, 0, r * 0.4, 0, 0, glowR);
      grad.addColorStop(0, colors.glow);
      grad.addColorStop(1, withAlpha('#000', 0));
      g.fillStyle = grad;
      g.beginPath();
      g.arc(0, 0, glowR, 0, Math.PI * 2);
      g.fill();

      g.fillStyle = colors.core;
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = withAlpha('#ffffff', 0.75);
      g.lineWidth = entity(1.5);
      g.stroke();

      // A highlight, plus a glyph so the three kinds are told apart by shape
      // as well as by colour.
      g.fillStyle = withAlpha('#ffffff', 0.55);
      g.beginPath();
      g.arc(-r * 0.3, -r * 0.35, r * 0.28, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = colors.glyph;
      g.font = `bold ${Math.round(r * 1.2)}px sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(kind === 'gold' ? '$' : kind === 'mana' ? '\u2726' : '\u21bb', 0, r * 0.05);
    });
    this.orbSprites.set(kind, sprite);
    return sprite;
  }

  /**
   * The disc the next click will drop a targeted ability on (plan §4.3 + §E.3).
   *
   * Deliberately loud — a filled disc, a rotating dashed rim, an inner pulse
   * ring, and a crosshair — because placement mode changes what a click means,
   * and an input state the player cannot see is an input state they will fight.
   *
   * When the disc currently contains a targetable enemy, the reticle is tinted
   * in the ability's own colour; an empty disc flips to `FX.blood` so the
   * whiff the §G.2 empty-disc refusal will eat is visible *before* the click.
   * The count badge above the rim lets the player compare two candidate spots.
   */
  private drawPlacement(ctx: CanvasRenderingContext2D, p: RenderSnapshot['placement']): void {
    if (!p) return;
    const tint = p.valid ? p.color : FX.blood;
    ctx.save();
    // Filled disc first, so the ring reads as an edge rather than a floating circle.
    ctx.fillStyle = withAlpha(tint, 0.10);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fill();
    // Rotating dashed rim.
    ctx.strokeStyle = withAlpha(tint, 0.9);
    ctx.lineWidth = entity(2);
    ctx.setLineDash([entity(10), entity(7)]);
    ctx.lineDashOffset = -this.time * 40;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // Inner pulse ring — makes the size change legible when the radius grows.
    const pulse = 0.55 + 0.45 * Math.sin(this.time * 4);
    ctx.strokeStyle = withAlpha(lighten(tint, 0.5), 0.55);
    ctx.lineWidth = entity(1);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius * pulse, 0, Math.PI * 2);
    ctx.stroke();
    // Crosshair, scaled with `entity()` like every other drawn size. The old
    // raw `±10` world-unit cross was a 6-pixel mark on a 400-unit ring —
    // invisible.
    ctx.strokeStyle = withAlpha(lighten(tint, 0.55), 0.95);
    ctx.lineWidth = entity(1.5);
    ctx.beginPath();
    ctx.moveTo(p.x - entity(10), p.y);
    ctx.lineTo(p.x + entity(10), p.y);
    ctx.moveTo(p.x, p.y - entity(10));
    ctx.lineTo(p.x, p.y + entity(10));
    ctx.stroke();
    // Count badge above the rim, so a player can compare two candidate spots
    // without counting heads.
    ctx.font = `700 ${entity(14).toFixed(2)}px ${DISPLAY_FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const badgeY = p.y - p.radius - entity(10);
    ctx.lineWidth = entity(2.2);
    ctx.strokeStyle = withAlpha(INK['950'], 0.85);
    ctx.strokeText(`${p.count}`, p.x, badgeY);
    ctx.fillStyle = p.valid ? withAlpha(lighten(tint, 0.55), 0.95) : withAlpha(FX.blood, 0.95);
    ctx.fillText(`${p.count}`, p.x, badgeY);
    ctx.restore();
  }

  /**
   * Spawn rifts, and the enemies coming through them (§3.4).
   *
   * Two jobs, one pass:
   *
   * - **The threat preview** (gameplay plan §7.3). These are the *real* spawn
   *   points from the pre-rolled roster, which is what makes them worth
   *   drawing at all. The arrow read is preserved exactly — a chevron pointing
   *   the way the lane will come in — it is just now a chevron spilling out of
   *   an open rift instead of a bare triangle on an empty floor.
   * - **The arrivals themselves.** At `ARENA.spawnRingScale` = 1.04 enemies
   *   materialise *just* on-screen along the long axis, and something popping
   *   into existence in plain view reads as a bug. A 0.4 s rift flare and a
   *   ground dust ring at the point it happens is what makes it read as
   *   intentional instead.
   *
   * One cached rift sprite (rotated and scaled) and one cached dust ring; the
   * emergence list is pooled and capped at `EMERGENCE_CAP`.
   */
  private drawSpawnPortals(ctx: CanvasRenderingContext2D): void {
    if (this.portalOpen <= 0 && this.emergences.length === 0) return;
    const rift = this.getRiftSprite();
    const swirl = this.getRiftSwirlSprite();

    if (this.portalOpen > 0) {
      const open = easeOutCubic(this.portalOpen);
      // A gentle pulse rather than a static mark: the intermission is short and
      // a still shape at the edge of the arena reads as scenery.
      const pulse = this.reducedMotion ? 0.8 : 0.7 + 0.3 * Math.sin(this.time * 4);
      const spin = this.reducedMotion ? 0 : this.time * 0.9;
      ctx.save();
      for (const lane of this.portalLanes) {
        // Clamp into what is actually *visible*, not into the world rectangle:
        // the spawn ellipse sits just outside the latter, and at an aspect
        // outside `ARENA.aspectClamp` the two are not the same rectangle.
        const inset = world(10);
        const minX = this.width / 2 - this.camera.viewHalfWidth + inset;
        const maxX = this.width / 2 + this.camera.viewHalfWidth - inset;
        const minY = this.height / 2 - this.camera.viewHalfHeight + inset;
        const maxY = this.height / 2 + this.camera.viewHalfHeight - inset;
        const x = Math.max(minX, Math.min(maxX, lane.x));
        const y = Math.max(minY, Math.min(maxY, lane.y));
        const angle = Math.atan2(this.towerY - y, this.towerX - x);

        ctx.save();
        ctx.translate(x, y);
        ctx.globalAlpha = open * pulse;
        ctx.save();
        ctx.rotate(angle);
        // The rift opens as a slit and widens: scaled on its short axis only,
        // which is the whole animation.
        ctx.scale(open, 0.35 + open * 0.65);
        ctx.drawImage(rift, -rift.width / 2, -rift.height / 2);
        ctx.restore();
        ctx.save();
        ctx.rotate(spin);
        ctx.globalAlpha = open * pulse * 0.7;
        ctx.drawImage(swirl, -swirl.width / 2, -swirl.height / 2);
        ctx.restore();
        ctx.restore();

        // The threat arrow, kept: it is the only thing that says *which way*
        // this lane is coming from.
        const ux = Math.cos(angle);
        const uy = Math.sin(angle);
        ctx.globalAlpha = open * pulse;
        ctx.strokeStyle = withAlpha(FX.blood, 0.75);
        ctx.lineWidth = world(2.5);
        ctx.beginPath();
        ctx.moveTo(x + ux * world(14), y + uy * world(14));
        ctx.lineTo(x + ux * world(26), y + uy * world(26));
        ctx.stroke();
        const tipX = x + ux * world(34);
        const tipY = y + uy * world(34);
        ctx.fillStyle = withAlpha(FX.ember, 0.9);
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(x + ux * world(21) - uy * world(7), y + uy * world(21) + ux * world(7));
        ctx.lineTo(x + ux * world(21) + uy * world(7), y + uy * world(21) - ux * world(7));
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    if (this.emergences.length === 0) return;
    const dust = this.getDustRingSprite();
    ctx.save();
    for (const em of this.emergences) {
      const k = em.age / EMERGENCE_TIME;
      const fade = 1 - k;
      ctx.save();
      ctx.translate(em.x, em.y);
      ctx.globalAlpha = fade * 0.9;
      ctx.save();
      ctx.rotate(em.angle);
      // Flares wide the instant something comes through, then shuts.
      ctx.scale(0.6 + fade * 0.8, 0.25 + fade * 0.95);
      ctx.drawImage(rift, -rift.width / 2, -rift.height / 2);
      ctx.restore();
      // Ground dust, expanding and thinning.
      ctx.globalAlpha = fade * fade * 0.75;
      const s = 0.35 + k * 1.1;
      ctx.drawImage(dust, -dust.width * s / 2, -dust.height * s / 2, dust.width * s, dust.height * s);
      ctx.restore();
    }
    ctx.restore();
  }

  /** The rift itself: a torn slit with a hot edge. Cached; rotated and scaled. */
  private getRiftSprite(): HTMLCanvasElement {
    return this.part('rift', world(56), (g) => {
      const rx = world(10);
      const ry = world(26);
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, ry);
      grad.addColorStop(0, withAlpha(INK['950'], 0.95));
      grad.addColorStop(0.5, withAlpha(FX.blood, 0.72));
      grad.addColorStop(0.78, withAlpha(FX.ember, 0.6));
      grad.addColorStop(1, withAlpha(FX.ember, 0));
      g.fillStyle = grad;
      g.beginPath();
      g.ellipse(0, 0, rx * 1.9, ry, 0, 0, Math.PI * 2);
      g.fill();
      // The tear: a dark core with a bright lip, so it reads as an opening
      // rather than a stain on the floor.
      g.fillStyle = withAlpha(INK['950'], 0.92);
      g.beginPath();
      g.ellipse(0, 0, rx * 0.55, ry * 0.62, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = withAlpha(FX.ember, 0.8);
      g.lineWidth = world(1.4);
      g.stroke();
    });
  }

  /** Ember arms around the rift, rotated live so the tear looks like it turns. */
  private getRiftSwirlSprite(): HTMLCanvasElement {
    return this.part('rift-swirl', world(60), (g) => {
      g.lineCap = 'round';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        g.strokeStyle = withAlpha(i % 2 === 0 ? FX.ember : FX.blood, 0.5);
        g.lineWidth = world(2);
        g.beginPath();
        g.arc(0, 0, world(16) + (i % 3) * world(3), a, a + Math.PI * 0.5);
        g.stroke();
      }
    });
  }

  /** The dust an arrival kicks up. One sprite, scaled outward as it fades. */
  private getDustRingSprite(): HTMLCanvasElement {
    return this.part('rift-dust', world(64), (g) => {
      const r = world(30);
      const grad = g.createRadialGradient(0, 0, r * 0.55, 0, 0, r);
      grad.addColorStop(0, withAlpha(INK['300'], 0));
      grad.addColorStop(0.7, withAlpha(INK['300'], 0.4));
      grad.addColorStop(1, withAlpha(INK['300'], 0));
      g.fillStyle = grad;
      g.beginPath();
      g.ellipse(0, 0, r, r * 0.62, 0, 0, Math.PI * 2);
      g.fill();
    });
  }

  /**
   * The charged-shot ring at the cursor (plan §4.2).
   *
   * Three states in one ring: filling while the hold builds, a bright pulsing
   * ring once it is armed, and a dim draining ring while it is on cooldown.
   */
  private drawChargeRing(ctx: CanvasRenderingContext2D, charge: RenderSnapshot['charge']): void {
    if (!charge) return;
    const { x, y, progress, cooldown, ready } = charge;
    const r = 26;
    ctx.save();
    ctx.lineWidth = entity(3);
    ctx.strokeStyle = withAlpha('#ffffff', 0.12);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();

    if (cooldown > 0) {
      ctx.strokeStyle = withAlpha(INK['200'], 0.5);
      ctx.beginPath();
      ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * cooldown);
      ctx.stroke();
      ctx.restore();
      return;
    }

    const pulse = ready ? 1 + Math.sin(this.time * 12) * 0.12 : 1;
    ctx.strokeStyle = ready ? withAlpha(lighten(FX.frost, 0.25), 0.95) : withAlpha(FX.frost, 0.7);
    ctx.lineWidth = ready ? 4 : 3;
    ctx.beginPath();
    ctx.arc(x, y, r * pulse, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.stroke();
    if (ready) {
      ctx.fillStyle = withAlpha(lighten(FX.frost, 0.25), 0.16);
      ctx.beginPath();
      ctx.arc(x, y, r * pulse, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawMines(ctx: CanvasRenderingContext2D, mines: Mine[]): void {
    ctx.save();
    for (const m of mines) {
      if (!m.alive) continue;
      const pulse = 0.85 + Math.sin(this.time * 3 + m.id) * 0.15;
      ctx.fillStyle = mix(FX.ember, INK['900'], 0.25);
      ctx.beginPath();
      ctx.arc(m.x, m.y, 6 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = mix(FX.ember, FX.gold, 0.25);
      ctx.lineWidth = entity(1.5);
      ctx.beginPath();
      ctx.arc(m.x, m.y, 6 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = withAlpha(FX.ember, 0.25);
      ctx.beginPath();
      ctx.arc(m.x, m.y, 10 * pulse, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * Allocate an offscreen canvas of `size` px square with the origin moved to
   * its centre, so a painter can draw in the same coordinates it would use
   * around an enemy at (0, 0).
   */
  private makeSprite(size: number, paint: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
    return this.makeSpriteRect(size, size, paint);
  }

  /**
   * The same, but not square.
   *
   * A `drawImage` costs the *sprite's* area, not the area of what was painted
   * inside it, so a wide flat thing baked into a square canvas pays for the
   * emptiness above and below it every frame. The ground shadow is the case
   * that makes this worth having: it is an ellipse a third as tall as it is
   * wide, blitted once per enemy, up to 260 times a frame.
   */
  private makeSpriteRect(
    width: number,
    height: number,
    paint: (ctx: CanvasRenderingContext2D) => void,
  ): HTMLCanvasElement {
    const w = Math.max(2, Math.ceil(width));
    const h = Math.max(2, Math.ceil(height));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    g.translate(w / 2, h / 2);
    paint(g);
    return c;
  }

  /** Radius an enemy of this type renders at, elite scaling included. */
  private enemyDrawRadius(enemy: Enemy): number {
    return ENEMY_DEFS[enemy.type].radius * (enemy.elite ? ELITE_RADIUS_SCALE : 1);
  }

  /**
   * Which boss silhouette this boss wears (§4.1).
   *
   * A boss's *tier* is what the player already names it by — `bossNameForWave`
   * calls the wave-10 one a Sentinel and the wave-50 one a Harbinger — so the
   * tier is what the shape is keyed to. It comes off `spawnWave`, not the
   * current wave, so a boss that survives into an intermission does not change
   * shape underneath the player. Cycled over `BOSS_PROFILES`, which is what
   * keeps the cache space small.
   */
  private bossSilhouette(enemy: Enemy): number {
    const tier = bossTierForWave(enemy.spawnWave ?? this.wave);
    return (tier - 1) % BOSS_PROFILES.length;
  }

  /** Slack a type's sprite needs around its radius for details that overhang. */
  private spritePadding(type: Enemy['type']): number {
    return type === 'siege' ? entity(12) : SPRITE_PADDING;
  }

  private getEnemySprite(enemy: Enemy): HTMLCanvasElement {
    const variant: BodyVariant = {
      enraged: enemy.type === 'boss' && enemy.enraged === true,
      // A burrower reads completely differently above and below ground, so the
      // two are separate cache entries rather than one sprite plus a live tint.
      buried: enemy.burrowed === true,
      elite: enemy.elite === true,
      // The elite rim is the aura's colour, so the aura is part of the key. Five
      // auras across thirteen types is still a couple of dozen sprites at most,
      // baked on first sight and never rebuilt.
      aura: enemy.elite === true ? (enemy.aura ?? null) : null,
      silhouette: enemy.type === 'boss' ? this.bossSilhouette(enemy) : 0,
    };
    const key = `${enemy.type}|${variant.elite ? variant.aura ?? 'e' : 0}`
      + `|${variant.enraged ? 1 : 0}|${variant.buried ? 1 : 0}|${variant.silhouette}`;
    const cached = this.enemySprites.get(key);
    if (cached) return cached;
    const def = ENEMY_DEFS[enemy.type];
    const r = this.enemyDrawRadius(enemy);
    const sprite = this.makeSprite((r + this.spritePadding(enemy.type)) * 2, (g) => {
      this.paintEnemyBody(g, def, r, variant);
    });
    this.enemySprites.set(key, sprite);
    return sprite;
  }

  /**
   * Paint an enemy body centred on the origin (§4.1).
   *
   * Before Part 4 this was a flat fill and a 2 px stroke per shape: no
   * lighting, no material, no depth, and — at Part 1's zoom level, where an
   * enemy is 0.65 of the on-screen size it used to be — barely a silhouette.
   * The six shapes are kept exactly, because they are the *contract* (see
   * `RENDERED_ENEMY_SHAPES`) and they are what makes a type identifiable at a
   * glance. What changes is what happens inside one:
   *
   * 1. A two-tone fill along the **same key light the tower uses**
   *    (`TOWER_VISUAL.lightAngle`), so every object on the battlefield agrees
   *    about where the light is coming from.
   * 2. An interior contact shadow opposite that light, which is what stops a
   *    filled shape reading as a sticker.
   * 3. A rim light on the lit edge, clipped to the silhouette so it is an edge
   *    rather than a hoop.
   * 4. A per-type detail pass — the thing that says *what this is* rather than
   *    *what colour it is*.
   * 5. For an elite, a metallic sheen and an aura-coloured rim.
   *
   * All of it is baked once per variant. The added cost is one-time per cache
   * key; a frame still pays exactly one `drawImage` per enemy.
   *
   * The flying type's wings are deliberately absent — they flap, so they are
   * drawn live.
   */
  private paintEnemyBody(
    g: CanvasRenderingContext2D,
    def: EnemyDef,
    r: number,
    v: BodyVariant,
  ): void {
    const type = def.type;
    const light = TOWER_VISUAL.lightAngle;
    const lx = Math.cos(light);
    const ly = Math.sin(light);
    const span = r * 2.4;
    const trace = (): void => { this.traceEnemyShape(g, def, r, v); };

    g.save();
    trace();
    g.clip();

    // Base coat. A boss below its enrage threshold is washed hot: `critical` is
    // reserved for the tower being hurt (docs/art-direction.md), so enrage is
    // blood under ember rather than a second scarlet.
    g.fillStyle = def.color;
    g.fillRect(-span, -span, span * 2, span * 2);
    if (v.enraged) {
      g.fillStyle = withAlpha(FX.ember, 0.5);
      g.fillRect(-span, -span, span * 2, span * 2);
    }

    // Two-tone: lit toward the key light, deep on the far side.
    const tone = g.createLinearGradient(lx * r, ly * r, -lx * r, -ly * r);
    tone.addColorStop(0, withAlpha(INK['050'], 0.3));
    tone.addColorStop(0.42, withAlpha(INK['050'], 0.04));
    tone.addColorStop(0.58, withAlpha(INK['950'], 0.1));
    tone.addColorStop(1, withAlpha(INK['950'], 0.5));
    g.fillStyle = tone;
    g.fillRect(-span, -span, span * 2, span * 2);

    // Contact shadow, hugging the unlit edge from the inside.
    const cx = -lx * r * 0.8;
    const cy = -ly * r * 0.8;
    const contact = g.createRadialGradient(cx, cy, r * 0.15, cx, cy, r * 1.15);
    contact.addColorStop(0, withAlpha(INK['950'], 0.4));
    contact.addColorStop(1, withAlpha(INK['950'], 0));
    g.fillStyle = contact;
    g.fillRect(-span, -span, span * 2, span * 2);

    this.paintEnemyDetail(g, def, r, v);

    // Rim light. A fat stroke of the silhouette, still clipped to it, so only
    // the inner half survives and it falls off toward the terminator.
    const rim = g.createLinearGradient(lx * r, ly * r, -lx * r * 0.5, -ly * r * 0.5);
    rim.addColorStop(0, withAlpha(INK['050'], 0.8));
    rim.addColorStop(0.55, withAlpha(INK['050'], 0.12));
    rim.addColorStop(1, withAlpha(INK['050'], 0));
    g.strokeStyle = rim;
    g.lineWidth = entity(3.4);
    trace();
    g.stroke();

    if (v.elite) this.paintEliteSheen(g, r);
    g.restore();

    // Outline last, unclipped, so the silhouette holds against a lit floor.
    trace();
    g.strokeStyle = def.borderColor;
    g.lineWidth = entity(type === 'tank' || type === 'boss' ? 2.4 : 1.7);
    g.lineJoin = 'round';
    g.stroke();

    if (v.elite) {
      // The elite rim is the aura's own colour: "this one is dangerous" and
      // "this is the danger it carries" are the same read at a glance.
      trace();
      g.strokeStyle = withAlpha(v.aura ? ELITE_CROWN_COLORS[v.aura] : INK['050'], 0.9);
      g.lineWidth = entity(1.6);
      g.stroke();
    }
  }

  /**
   * The silhouette itself — the six-shape contract (`RENDERED_ENEMY_SHAPES`).
   *
   * A closed switch with a `never` default, so a new shape has to be drawn
   * before it can be given to an enemy. Bosses branch out before it: they carry
   * `shape: 'circle'` for the contract's sake but are painted from
   * `BOSS_PROFILES`, because "a big circle" is exactly what a boss must never
   * read as.
   */
  private traceEnemyShape(
    g: CanvasRenderingContext2D,
    def: EnemyDef,
    r: number,
    v: BodyVariant,
  ): void {
    if (def.type === 'boss') {
      this.traceBossShape(g, r, v.silhouette);
      return;
    }
    g.beginPath();
    switch (def.shape) {
      case 'circle':
        g.arc(0, 0, r, 0, Math.PI * 2);
        g.closePath();
        break;
      case 'diamond':
        g.moveTo(0, -r);
        g.lineTo(r, 0);
        g.lineTo(0, r);
        g.lineTo(-r, 0);
        g.closePath();
        break;
      // Flyer: a compact body, because the wings are what gives it its width
      // and they are drawn live.
      case 'winged':
        g.ellipse(0, 0, r * 0.82, r, 0, 0, Math.PI * 2);
        g.closePath();
        break;
      // Siege: a blunt, flat-sided chassis with the corners cut off and a
      // barrel out the front — it reads as a machine parked at range rather
      // than as something running at you. The barrel is part of the
      // *silhouette*, not a detail painted inside it: a detail would be clipped
      // at the chassis edge, and the barrel is the whole reason the type is
      // frightening from outside a short build's range.
      case 'square': {
        const w = r;
        const h = r * 0.85;
        const c = r * 0.28;
        const bh = r * 0.2;
        const bx = r * 1.42;
        g.moveTo(-w + c, -h);
        g.lineTo(w - c, -h);
        g.lineTo(w, -h + c);
        g.lineTo(w, -bh);
        g.lineTo(bx, -bh);
        g.lineTo(bx, bh);
        g.lineTo(w, bh);
        g.lineTo(w, h - c);
        g.lineTo(w - c, h);
        g.lineTo(-w + c, h);
        g.lineTo(-w, h - c);
        g.lineTo(-w, -h + c);
        g.closePath();
        break;
      }
      // Warden: a hexagon, the same shape as the ward it projects, so the
      // shield rings on its allies point straight back at the source.
      case 'hex': {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
          const px = Math.cos(a) * r;
          const py = Math.sin(a) * r;
          if (i === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.closePath();
        break;
      }
      // Burrower: a low earth mound while underground, a clawed dome once it is
      // up. Two different silhouettes on purpose — the whole point of the type
      // is that you can tell at a glance whether it can be shot.
      case 'mound':
        if (v.buried) {
          g.ellipse(0, r * 0.25, r * 1.15, r * 0.6, 0, Math.PI, Math.PI * 2);
          g.closePath();
        } else {
          g.arc(0, 0, r, 0, Math.PI * 2);
          g.closePath();
        }
        break;
      default: {
        // Closed union (cross-cutting rule 3): a new shape has to be drawn
        // before it can be given to an enemy.
        const exhaustive: never = def.shape;
        return exhaustive;
      }
    }
  }

  /** One boss silhouette, sampled off its `BOSS_PROFILES` entry. */
  private traceBossShape(g: CanvasRenderingContext2D, r: number, family: number): void {
    const profile = BOSS_PROFILES[family % BOSS_PROFILES.length];
    const n = profile.samples;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const rad = r * profile.radius(i, n);
      const px = Math.cos(a) * rad * profile.sx;
      const py = Math.sin(a) * rad * profile.sy;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
  }

  /**
   * What this thing *is* (§4.1), painted inside the clipped silhouette.
   *
   * A closed switch over `EnemyType` with a `never` default, the same
   * discipline `ENEMY_BEHAVIOR_CONSUMERS` applies to behaviour: a new type does
   * not compile until someone has decided what it looks like, which is what
   * stops the roster sliding back into thirteen coloured circles.
   */
  private paintEnemyDetail(
    g: CanvasRenderingContext2D,
    def: EnemyDef,
    r: number,
    v: BodyVariant,
  ): void {
    const light = TOWER_VISUAL.lightAngle;
    const dark = (a: number): string => withAlpha(INK['950'], a);
    const pale = (a: number): string => withAlpha(INK['050'], a);
    switch (def.type) {
      // Grunt: a visor slit and two eye glints. Deliberately the plainest of
      // the thirteen — it is the baseline everything else is read against.
      case 'normal': {
        g.fillStyle = dark(0.5);
        g.beginPath();
        g.ellipse(0, -r * 0.16, r * 0.66, r * 0.22, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = withAlpha(def.borderColor, 0.85);
        for (const dir of [-1, 1]) {
          g.beginPath();
          g.arc(dir * r * 0.3, -r * 0.16, r * 0.1, 0, Math.PI * 2);
          g.fill();
        }
        break;
      }
      // Runner: swept chevrons. Motion lines on the body itself, so a pack of
      // three reads as *moving* even standing still at contact range.
      case 'fast': {
        g.strokeStyle = dark(0.45);
        g.lineWidth = entity(1.8);
        g.lineCap = 'round';
        for (let i = 0; i < 3; i++) {
          const x = -r * 0.5 + i * r * 0.38;
          g.beginPath();
          g.moveTo(x, -r * 0.34);
          g.lineTo(x + r * 0.26, 0);
          g.lineTo(x, r * 0.34);
          g.stroke();
        }
        break;
      }
      // Tank: chitin plates, stacked toward the light with rivets along each
      // seam. Three overlapping arcs is the cheapest thing that reads as armour
      // rather than as a ring.
      case 'tank': {
        // Overlapping bands rather than strokes: a plate has a lit face and a
        // shadowed lip where the next one rides over it, and that lip is what
        // makes three arcs read as armour instead of as a signal-strength icon.
        for (const [outer, inner, w] of [[1, 0.76, 0.52], [0.76, 0.54, 0.46], [0.54, 0.3, 0.38]] as const) {
          const a0 = light - Math.PI * w;
          const a1 = light + Math.PI * w;
          g.beginPath();
          g.arc(0, 0, r * outer, a0, a1);
          g.arc(0, 0, r * inner, a1, a0, true);
          g.closePath();
          g.fillStyle = pale(0.1);
          g.fill();
          g.strokeStyle = dark(0.6);
          g.lineWidth = entity(1.6);
          g.stroke();
          // Rivets along the plate's leading edge.
          g.fillStyle = pale(0.34);
          for (const at of [-0.55, 0, 0.55]) {
            const a = light + at * Math.PI * w;
            const rad = r * (outer + inner) / 2;
            g.beginPath();
            g.arc(Math.cos(a) * rad, Math.sin(a) * rad, entity(1.3), 0, Math.PI * 2);
            g.fill();
          }
        }
        break;
      }
      // Flier: a pale underbelly and a dark carapace ridge, so the body still
      // has a top and a bottom once the wings are flapping past it.
      case 'flying': {
        g.fillStyle = pale(0.3);
        g.beginPath();
        g.ellipse(0, r * 0.32, r * 0.5, r * 0.4, 0, 0, Math.PI * 2);
        g.fill();
        // A head and two ear points at the top, so the body has a front even
        // when the wings are mid-flap and carrying the eye.
        g.fillStyle = dark(0.5);
        g.beginPath();
        g.ellipse(0, -r * 0.42, r * 0.4, r * 0.32, 0, 0, Math.PI * 2);
        g.fill();
        g.beginPath();
        g.moveTo(-r * 0.36, -r * 0.5);
        g.lineTo(-r * 0.2, -r * 0.95);
        g.lineTo(-r * 0.06, -r * 0.5);
        g.moveTo(r * 0.36, -r * 0.5);
        g.lineTo(r * 0.2, -r * 0.95);
        g.lineTo(r * 0.06, -r * 0.5);
        g.fill();
        g.fillStyle = withAlpha(FX.blood, 0.9);
        for (const dir of [-1, 1]) {
          g.beginPath();
          g.arc(dir * r * 0.17, -r * 0.42, entity(1.5), 0, Math.PI * 2);
          g.fill();
        }
        break;
      }
      // Healer: a cross sigil over a soft nature glow. This replaces the `'+'`
      // it used to render in `sans-serif` — the mark is painted now, so it
      // scales with the body and is not one font stack away from a tofu box.
      case 'healer': {
        const glow = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.9);
        glow.addColorStop(0, withAlpha(FX.nature, 0.5));
        glow.addColorStop(1, withAlpha(FX.nature, 0));
        g.fillStyle = glow;
        g.beginPath();
        g.arc(0, 0, r * 0.9, 0, Math.PI * 2);
        g.fill();
        const arm = r * 0.6;
        const bar = r * 0.22;
        g.fillStyle = pale(0.92);
        g.fillRect(-bar / 2, -arm, bar, arm * 2);
        g.fillRect(-arm, -bar / 2, arm * 2, bar);
        g.fillStyle = withAlpha(FX.nature, 0.55);
        g.fillRect(-bar / 2, -arm, bar, arm * 0.5);
        break;
      }
      // Splitter: a cracked shell with the core showing through. It is about to
      // come apart, and now it looks like it.
      case 'splitter': {
        const core = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.55);
        core.addColorStop(0, pale(0.85));
        core.addColorStop(0.5, withAlpha(def.borderColor, 0.5));
        core.addColorStop(1, withAlpha(def.borderColor, 0));
        g.fillStyle = core;
        g.beginPath();
        g.arc(0, 0, r * 0.55, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = dark(0.65);
        g.lineWidth = entity(1.9);
        g.lineCap = 'round';
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 + 0.4;
          g.beginPath();
          g.moveTo(Math.cos(a) * r * 0.18, Math.sin(a) * r * 0.18);
          g.lineTo(Math.cos(a + 0.22) * r * 0.6, Math.sin(a + 0.22) * r * 0.6);
          g.lineTo(Math.cos(a - 0.1) * r, Math.sin(a - 0.1) * r);
          g.stroke();
        }
        break;
      }
      // Shielded: a plated carapace. The orbiting charge arcs are the live
      // read; this is what the thing looks like once they are gone.
      case 'shielded': {
        g.strokeStyle = dark(0.45);
        g.lineWidth = entity(2.2);
        for (const at of [0.72, 0.44]) {
          g.beginPath();
          g.arc(0, 0, r * at, light - 1.2, light + 1.2);
          g.stroke();
        }
        g.fillStyle = pale(0.35);
        g.beginPath();
        g.arc(Math.cos(light) * r * 0.32, Math.sin(light) * r * 0.32, r * 0.16, 0, Math.PI * 2);
        g.fill();
        break;
      }
      // Siege: treads, and a barrel that is visibly smoking. The barrel points
      // along +x, which is the axis `drawEnemy` orients the chassis on.
      case 'siege': {
        g.fillStyle = dark(0.55);
        g.fillRect(-r * 0.95, -r * 0.84, r * 1.9, r * 0.28);
        g.fillRect(-r * 0.95, r * 0.56, r * 1.9, r * 0.28);
        g.strokeStyle = pale(0.22);
        g.lineWidth = entity(1.2);
        for (let i = 0; i < 5; i++) {
          const x = -r * 0.78 + i * r * 0.39;
          g.beginPath();
          g.moveTo(x, -r * 0.8);
          g.lineTo(x, -r * 0.6);
          g.moveTo(x, r * 0.6);
          g.lineTo(x, r * 0.8);
          g.stroke();
        }
        // The barrel is soot-blackened at the muzzle and still smoking — the
        // wisps are baked, the ember at the bore is what the eye catches.
        g.fillStyle = withAlpha(def.borderColor, 0.35);
        g.fillRect(r * 0.9, -r * 0.2, r * 0.55, r * 0.4);
        g.fillStyle = dark(0.8);
        g.fillRect(r * 1.16, -r * 0.2, r * 0.3, r * 0.4);
        g.fillStyle = withAlpha(FX.ember, 0.45);
        g.beginPath();
        g.arc(r * 1.34, 0, r * 0.14, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = dark(0.5);
        g.lineWidth = entity(1.4);
        g.beginPath();
        g.moveTo(r * 0.9, -r * 0.2);
        g.lineTo(r * 0.9, r * 0.2);
        g.stroke();
        break;
      }
      // Thief: a hood and a mask band with two eye slits. It used to render a
      // literal `'$'`; the coin it carries is the *behavioural* read and it is
      // still drawn, live, above the body — see `drawThiefLoot`.
      case 'thief': {
        g.fillStyle = dark(0.62);
        g.beginPath();
        g.ellipse(0, -r * 0.1, r * 0.7, r * 0.3, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = withAlpha(def.borderColor, 0.9);
        for (const dir of [-1, 1]) {
          g.beginPath();
          g.ellipse(dir * r * 0.3, -r * 0.1, r * 0.16, r * 0.09, dir * 0.3, 0, Math.PI * 2);
          g.fill();
        }
        g.strokeStyle = dark(0.45);
        g.lineWidth = entity(1.6);
        g.beginPath();
        g.arc(0, 0, r * 0.78, Math.PI * 1.1, Math.PI * 1.9);
        g.stroke();
        break;
      }
      // Blinker: a four-point star sigil and a phase ring — replacing the
      // `'✦'` character it used to print. It is the same mark, painted.
      case 'blinker': {
        const halo = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.85);
        halo.addColorStop(0, withAlpha(FX.arcane, 0.75));
        halo.addColorStop(1, withAlpha(FX.arcane, 0));
        g.fillStyle = halo;
        g.beginPath();
        g.arc(0, 0, r * 0.85, 0, Math.PI * 2);
        g.fill();
        // The sigil is near-white against the body: violet-on-violet is not a
        // mark, it is a suggestion.
        g.fillStyle = pale(0.92);
        g.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
          const rad = i % 2 === 0 ? r * 0.72 : r * 0.2;
          const px = Math.cos(a) * rad;
          const py = Math.sin(a) * rad;
          if (i === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.closePath();
        g.fill();
        g.fillStyle = withAlpha(FX.arcane, 0.9);
        g.beginPath();
        g.arc(0, 0, r * 0.17, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = withAlpha(def.borderColor, 0.45);
        g.lineWidth = entity(1.2);
        g.beginPath();
        g.arc(0, 0, r * 0.86, 0, Math.PI * 2);
        g.stroke();
        break;
      }
      // Warden: a glowing sigil inside the hex. The inner hexagon is kept
      // exactly — it is the mark the ward lattice and the ward ring both echo,
      // so killing the source of a shield is a shape match, not a guess.
      case 'warden': {
        const glow = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.8);
        glow.addColorStop(0, withAlpha(def.borderColor, 0.55));
        glow.addColorStop(1, withAlpha(def.borderColor, 0));
        g.fillStyle = glow;
        g.beginPath();
        g.arc(0, 0, r * 0.8, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = pale(0.5);
        g.lineWidth = entity(1.6);
        g.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
          const px = Math.cos(a) * r * 0.5;
          const py = Math.sin(a) * r * 0.5;
          if (i === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.closePath();
        g.stroke();
        g.strokeStyle = withAlpha(def.borderColor, 0.75);
        g.lineWidth = entity(1.3);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          g.beginPath();
          g.moveTo(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5);
          g.lineTo(Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92);
          g.stroke();
        }
        break;
      }
      // Burrower: displaced earth on the mound while it is under, claws and a
      // snout once it is up. The two states must never be confusable — one can
      // be shot and the other cannot.
      case 'burrower': {
        if (v.buried) {
          g.fillStyle = dark(0.4);
          g.beginPath();
          g.ellipse(0, r * 0.25, r * 0.5, r * 0.16, 0, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = withAlpha(def.borderColor, 0.35);
          for (let i = 0; i < 6; i++) {
            const a = Math.PI + (i / 5) * Math.PI;
            g.beginPath();
            g.arc(Math.cos(a) * r * 0.85, r * 0.25 + Math.sin(a) * r * 0.42, entity(1.7), 0, Math.PI * 2);
            g.fill();
          }
          break;
        }
        g.strokeStyle = withAlpha(def.borderColor, 0.95);
        g.lineWidth = entity(2.2);
        g.lineCap = 'round';
        for (const dir of [-1, 1]) {
          g.beginPath();
          g.moveTo(dir * r * 0.35, -r * 0.15);
          g.lineTo(dir * r * 0.95, -r * 0.75);
          g.stroke();
        }
        g.fillStyle = dark(0.5);
        g.beginPath();
        g.ellipse(0, r * 0.24, r * 0.36, r * 0.24, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = pale(0.4);
        for (const dir of [-1, 1]) {
          g.beginPath();
          g.arc(dir * r * 0.14, r * 0.2, entity(1.4), 0, Math.PI * 2);
          g.fill();
        }
        break;
      }
      // Boss: armour plates and a lit visor. The silhouette already carries the
      // tier; this is what makes it a *thing* rather than a polygon.
      case 'boss': {
        g.strokeStyle = dark(0.55);
        g.lineWidth = entity(2.6);
        for (const at of [0.78, 0.54]) {
          g.beginPath();
          g.arc(0, 0, r * at, light - 1.35, light + 1.35);
          g.stroke();
        }
        const visor = g.createLinearGradient(0, -r * 0.36, 0, -r * 0.02);
        visor.addColorStop(0, withAlpha(v.enraged ? FX.ember : def.borderColor, 0.95));
        visor.addColorStop(1, withAlpha(v.enraged ? FX.ember : def.borderColor, 0.15));
        g.fillStyle = visor;
        g.beginPath();
        g.moveTo(-r * 0.5, -r * 0.3);
        g.lineTo(r * 0.5, -r * 0.3);
        g.lineTo(r * 0.3, -r * 0.04);
        g.lineTo(-r * 0.3, -r * 0.04);
        g.closePath();
        g.fill();
        g.fillStyle = pale(0.9);
        for (const dir of [-1, 1]) {
          g.beginPath();
          g.ellipse(dir * r * 0.26, -r * 0.19, r * 0.1, r * 0.06, 0, 0, Math.PI * 2);
          g.fill();
        }
        g.strokeStyle = dark(0.45);
        g.lineWidth = entity(2);
        g.beginPath();
        g.moveTo(0, r * 0.06);
        g.lineTo(0, r * 0.8);
        g.stroke();
        break;
      }
      default: {
        // Closed union: a new enemy type has to be given a look.
        const exhaustive: never = def.type;
        return exhaustive;
      }
    }
  }

  /**
   * The elite's metallic sheen (§4.1).
   *
   * An elite used to be a `♛` and a 25% size bump, which at Part 1's zoom is
   * two enemies of nearly the same size with a small character over one of
   * them. Two hard specular bands across the body read as polished metal at any
   * size, and cost one gradient at bake time.
   */
  private paintEliteSheen(g: CanvasRenderingContext2D, r: number): void {
    const sheen = g.createLinearGradient(-r, -r, r, r);
    const stops: Array<[number, number]> = [
      [0, 0], [0.26, 0], [0.34, 0.38], [0.42, 0],
      [0.56, 0], [0.62, 0.2], [0.68, 0], [1, 0],
    ];
    for (const [at, alpha] of stops) sheen.addColorStop(at, withAlpha(INK['050'], alpha));
    g.fillStyle = sheen;
    g.fillRect(-r * 1.4, -r * 1.4, r * 2.8, r * 2.8);
  }

  /**
   * Ground shadow, keyed by radius *and* type.
   *
   * Cast away from the same key light the tower's shadow uses
   * (`TOWER_VISUAL.lightAngle`), so a mob crossing the plinth agrees with the
   * thing it is walking past about where the light is. A flier gets one too —
   * smaller, softer and thrown further along the light vector, which reads as
   * altitude; before Part 4 it had none at all, which reads as nothing.
   */
  private getShadowSprite(r: number, airborne: boolean): HTMLCanvasElement {
    const key = `${r.toFixed(1)}|${airborne ? 1 : 0}`;
    const cached = this.shadowSprites.get(key);
    if (cached) return cached;
    const alpha = airborne ? 0.22 : 0.38;
    const squash = airborne ? 0.22 : 0.3;
    const scale = airborne ? 0.7 : 1;
    const rx = r * 0.9 * scale;
    const ry = r * squash * scale;
    // Baked to the ellipse's own bounds rather than into a square: this is the
    // single most-blitted sprite in the game and the old square canvas was
    // three quarters empty space, paid for once per enemy per frame.
    const sprite = this.makeSpriteRect(rx * 2 + 2, ry * 2 + 2, (g) => {
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, rx);
      grad.addColorStop(0, withAlpha(INK['950'], alpha));
      grad.addColorStop(0.6, withAlpha(INK['950'], alpha * 0.5));
      grad.addColorStop(1, withAlpha(INK['950'], 0));
      g.save();
      g.scale(1, ry / rx);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(0, 0, rx, 0, Math.PI * 2);
      g.fill();
      g.restore();
    });
    this.shadowSprites.set(key, sprite);
    return sprite;
  }

  /**
   * A radial glow, painted once at its unpulsed size and scaled by `drawImage`
   * at draw time.
   *
   * The live version recomputed the gradient every frame so that its inner
   * stop stayed at a fixed radius while the outer one pulsed; scaling the
   * whole sprite instead moves the inner stop by the same few percent, which
   * is not visible against a +/-12% pulse on a soft gradient.
   */
  private getAuraSprite(key: string, radius: number, inner: number, stops: [number, string][]): HTMLCanvasElement {
    const cached = this.auraSprites.get(key);
    if (cached) return cached;
    const sprite = this.makeSprite(radius * 2, (g) => {
      const grad = g.createRadialGradient(0, 0, inner, 0, 0, radius);
      for (const [offset, color] of stops) grad.addColorStop(offset, color);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(0, 0, radius, 0, Math.PI * 2);
      g.fill();
    });
    this.auraSprites.set(key, sprite);
    return sprite;
  }

  /** Blit a cached glow centred on a point, scaled by the caller's pulse. */
  private drawAuraSprite(ctx: CanvasRenderingContext2D, sprite: HTMLCanvasElement, x: number, y: number, scale: number): void {
    const size = sprite.width * scale;
    ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
  }

  private drawEnemies(ctx: CanvasRenderingContext2D, enemies: Enemy[]): void {
    // Ward links are drawn first so they read as a lattice *under* the bodies
    // rather than as lines crossing over them.
    this.drawWardLinks(ctx, enemies);
    // Then the dissolving dead, under the living: a corpse must never occlude
    // the thing that is still walking at you.
    this.drawDeaths(ctx);
    for (const e of enemies) {
      if (!e.alive) continue;
      this.drawAfterImage(ctx, e);
      if (this.profile.shadows) this.drawEnemyShadow(ctx, e);
      this.drawEnemy(ctx, e);
    }
  }

  /**
   * Death, as a directional dissolve (§4.2).
   *
   * The body smears along the killing blow's vector — stretched along it,
   * pinched across it, fading — and throws four shards ahead of itself. What
   * this replaces is nothing at all: the body simply stopped being drawn, and
   * the only thing that marked a kill was a symmetric particle burst that looks
   * identical whether the enemy was shot from the front or crushed from behind.
   *
   * `EffectsManager` still owns that burst (it is Part 5's file); this is the
   * body's own exit, and pooled at `DEATH_CAP` the way every other effect here
   * is.
   */
  private drawDeaths(ctx: CanvasRenderingContext2D): void {
    if (this.deaths.length === 0) return;
    ctx.save();
    for (const d of this.deaths) {
      const k = d.age / DEATH_TIME;
      const fade = 1 - k;
      if (d.sprite) {
        const half = d.sprite.width / 2;
        ctx.save();
        ctx.globalAlpha = fade * fade * 0.8;
        ctx.translate(d.x + d.vx * k * d.r * 1.5, d.y + d.vy * k * d.r * 1.5);
        ctx.rotate(Math.atan2(d.vy, d.vx));
        ctx.scale(1 + k * 0.85, Math.max(0.05, 1 - k * 0.6));
        ctx.drawImage(d.sprite, -half, -half);
        ctx.restore();
      }
      // Shards, fanned around the vector and outrunning the body.
      ctx.save();
      ctx.globalAlpha = fade * 0.85;
      ctx.fillStyle = d.color;
      ctx.translate(d.x, d.y);
      ctx.rotate(Math.atan2(d.vy, d.vx));
      for (let i = 0; i < DEATH_SHARDS; i++) {
        const spread = (i / (DEATH_SHARDS - 1) - 0.5) * 1.5;
        const reach = d.r * (1.4 + (i % 2) * 0.9) * k;
        const size = d.r * 0.24 * fade;
        ctx.save();
        ctx.rotate(spread);
        ctx.translate(d.r * 0.4 + reach, 0);
        ctx.rotate(k * 6 * (i % 2 === 0 ? 1 : -1));
        ctx.beginPath();
        ctx.moveTo(size, 0);
        ctx.lineTo(-size * 0.7, size * 0.8);
        ctx.lineTo(-size * 0.7, -size * 0.8);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * Hexagonal lattice joining each warden to the allies it is shielding
   * (plan §2.5).
   *
   * A direct scan per warden, the same call the aura passes make: a wave holds
   * a handful of wardens, so this is O(wardens x n) and allocates nothing.
   */
  private drawWardLinks(ctx: CanvasRenderingContext2D, enemies: Enemy[]): void {
    let anyWarden = false;
    for (const w of enemies) {
      if (w.alive && w.type === 'warden') { anyWarden = true; break; }
    }
    if (!anyWarden) return;
    const pulse = 0.3 + Math.sin(this.time * 3) * 0.12;
    ctx.save();
    ctx.lineWidth = entity(1.5);
    ctx.strokeStyle = withAlpha(FX.frost, pulse);
    for (const w of enemies) {
      if (!w.alive || w.type !== 'warden') continue;
      for (const ally of enemies) {
        if (!ally.alive || ally.wardenId !== w.id) continue;
        if ((ally.absorbShield ?? 0) <= 0) continue;
        ctx.beginPath();
        ctx.moveTo(w.x, w.y);
        ctx.lineTo(ally.x, ally.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** Blinker: a fading ghost at the position it teleported away from. */
  private drawAfterImage(ctx: CanvasRenderingContext2D, enemy: Enemy): void {
    const age = enemy.afterImageAge;
    if (age === undefined || age >= AFTER_IMAGE_LIFE) return;
    if (enemy.afterImageX === undefined || enemy.afterImageY === undefined) return;
    const fade = 1 - age / AFTER_IMAGE_LIFE;
    const sprite = this.getEnemySprite(enemy);
    const half = sprite.width / 2;
    ctx.save();
    ctx.globalAlpha = fade * 0.45;
    ctx.drawImage(sprite, enemy.afterImageX - half, enemy.afterImageY - half);
    ctx.restore();
    // A short streak between the two positions, so the eye can follow the jump.
    ctx.save();
    ctx.globalAlpha = fade * 0.35;
    ctx.strokeStyle = ENEMY_DEFS.blinker.borderColor;
    ctx.lineWidth = entity(2);
    ctx.setLineDash([entity(4), entity(5)]);
    ctx.beginPath();
    ctx.moveTo(enemy.afterImageX, enemy.afterImageY);
    ctx.lineTo(enemy.x, enemy.y);
    ctx.stroke();
    ctx.restore();
  }

  private drawEnemyShadow(ctx: CanvasRenderingContext2D, enemy: Enemy): void {
    const r = ENEMY_DEFS[enemy.type].radius;
    const airborne = enemy.type === 'flying';
    const sprite = this.getShadowSprite(r, airborne);
    // Thrown away from the key light, and further for something in the air.
    const drop = r * (airborne ? 1.5 : 0.6);
    ctx.drawImage(
      sprite,
      enemy.x - Math.cos(TOWER_VISUAL.lightAngle) * r * 0.22 - sprite.width / 2,
      enemy.y + drop - sprite.height / 2,
    );
  }

  private drawEnemy(ctx: CanvasRenderingContext2D, enemy: Enemy): void {
    const r = this.enemyDrawRadius(enemy);
    const track = this.tracks.get(enemy.id);

    // ── gait (§4.2) ──
    //
    // Two `Math.sin` calls. Before this, exactly two types in the game moved at
    // all — the flier bobbed, the boss and splitter breathed — so a crowd of
    // two hundred read as a point cloud sliding across the floor. The phase is
    // `time × freq + id`, so no two neighbours are ever in step, and the
    // frequency is per type, which means a Runner and a Tank are told apart by
    // how they move before their silhouettes resolve.
    const gait = ENEMY_GAIT[enemy.type];
    let bob = 0;
    let squash = 0;
    if (!this.reducedMotion) {
      const phase = this.time * gait.freq * (enemy.slowed === true ? SLOWED_GAIT : 1)
        + enemy.id * 1.7;
      squash = Math.sin(phase) * gait.squash;
      const lift = Math.sin(phase * 0.5);
      bob = gait.float ? lift * gait.bob : -Math.abs(lift) * gait.bob;
    }

    // Elite aura (drawn behind the enemy body)
    if (enemy.elite && enemy.aura) {
      this.drawEliteAura(ctx, enemy, r, enemy.aura);
    }

    if (enemy.type === 'boss') {
      this.drawBossAura(ctx, enemy, r);
    } else if (enemy.type === 'healer') {
      this.drawHealerAura(ctx, enemy, r);
    }

    // Body: one blit of a cached sprite. The squash is a transform around the
    // enemy's centre rather than a repaint at a different size.
    const sprite = this.getEnemySprite(enemy);
    const half = sprite.width / 2;
    if (track) {
      track.sprite = sprite;
      track.r = r;
    }
    ctx.save();
    ctx.translate(enemy.x, enemy.y + bob);
    if (squash !== 0) ctx.scale(1 - squash * 0.65, 1 + squash);
    ctx.drawImage(sprite, -half, -half);

    // Hit flash (§4.2): the same sprite, blitted again additively for 60 ms.
    // A hit used to throw sparks while the body itself did not acknowledge it —
    // which meant a shot that connected and a shot that missed looked the same
    // on the thing that was shot. Additive rather than a second white
    // silhouette, so it costs no extra sprite and keeps the body's own hue.
    if (track !== undefined && track.flash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, track.flash / HIT_FLASH_TIME) * 0.9;
      ctx.drawImage(sprite, -half, -half);
    }
    ctx.restore();

    // Chill (§4.2): a rime crust on the body, and a gait already halved above.
    // `slowed` is the only status the simulation actually has — see
    // docs/enemy-system.md on why there is no burn or stun read here.
    if (enemy.slowed === true) this.drawFrostCrust(ctx, enemy, r, bob);
    // Spawn protection: a splitter child inside its 2 s of immunity looks
    // exactly like one that can be shot, which is a lie the player pays for.
    if ((enemy.spawnProtection ?? 0) > 0) this.drawSpawnWard(ctx, enemy, r, bob);

    // Wings flap, so they cannot be baked into the body sprite.
    if (ENEMY_DEFS[enemy.type].shape === 'winged') {
      this.drawWings(ctx, enemy, r, bob);
    }

    // Shielded: orbiting shield segments (arcs) when charges > 0
    if (enemy.type === 'shielded' && (enemy.shieldCharges ?? 0) > 0) {
      this.drawShieldArcs(ctx, enemy, r);
    }

    // Elite crown
    if (enemy.elite && enemy.aura) {
      this.drawEliteCrown(ctx, enemy, r, bob);
    }

    // ── behavioural reads (plan §2.5) ──
    if ((enemy.absorbShield ?? 0) > 0) this.drawWardRing(ctx, enemy, r, bob);
    if (enemy.type === 'siege' && enemy.siegeHalted) this.drawSiegeStance(ctx, enemy, r);
    if (enemy.type === 'thief' && (enemy.stolenGold ?? 0) > 0) this.drawThiefLoot(ctx, enemy, r);
    if (enemy.type === 'burrower') this.drawBurrowerState(ctx, enemy, r);
    if (enemy.type === 'boss') this.drawBossState(ctx, enemy, r);

    // Retribution buff indicator (pulsing purple border)
    if (enemy.retributionTimer && enemy.retributionTimer > 0) {
      const p = 0.4 + Math.sin(this.time * 8) * 0.3;
      ctx.save();
      ctx.strokeStyle = withAlpha(FX.arcane, p);
      ctx.lineWidth = entity(3);
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y + bob, r + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    this.drawEnemyHpBar(ctx, enemy, r, bob);
  }

  /**
   * Frost crust on a chilled body (§4.2).
   *
   * A chill is worth 25% of an enemy's speed and, before this, was completely
   * invisible: the frostwork core's entire shot behaviour and the Frostbite
   * blessing both landed with nothing to show for them. One cached sprite of
   * rime spurs per radius, blitted at a fixed rotation so it does not spin.
   */
  private drawFrostCrust(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number, bob: number): void {
    const sprite = this.part(`frost|${r.toFixed(1)}`, (r + entity(5)) * 2, (g) => {
      g.strokeStyle = withAlpha(FX.frost, 0.75);
      g.lineWidth = entity(1.5);
      g.lineCap = 'round';
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const base = r * 0.86;
        const tip = r * (i % 2 === 0 ? 1.16 : 1.04);
        g.beginPath();
        g.moveTo(Math.cos(a) * base, Math.sin(a) * base);
        g.lineTo(Math.cos(a + 0.1) * tip, Math.sin(a + 0.1) * tip);
        g.stroke();
      }
      const glaze = g.createRadialGradient(0, 0, r * 0.4, 0, 0, r);
      glaze.addColorStop(0, withAlpha(FX.frost, 0));
      glaze.addColorStop(1, withAlpha(FX.frost, 0.3));
      g.fillStyle = glaze;
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.fill();
    });
    this.blit(ctx, sprite, enemy.x, enemy.y + bob);
  }

  /**
   * The ward around something that cannot be shot yet (§4.2).
   *
   * `spawnProtection` makes a splitter child untargetable *and* immune for two
   * seconds, and it looked identical to one that could be killed — so a player
   * watching their shots pass through a child had no way to know it was
   * working as designed. A tightening ring says "not yet" and says how long is
   * left, which is the same information the boss's phase flash already carries.
   */
  private drawSpawnWard(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number, bob: number): void {
    const left = enemy.spawnProtection ?? 0;
    const ratio = Math.max(0, Math.min(1, left / ENEMY_BEHAVIOR.splitterSpawnProtection));
    ctx.save();
    ctx.strokeStyle = withAlpha(INK['050'], 0.2 + ratio * 0.4);
    ctx.lineWidth = entity(1.4);
    ctx.setLineDash([entity(4), entity(4)]);
    ctx.lineDashOffset = -this.time * 26;
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y + bob, r + entity(4) + ratio * entity(5), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Tattered wings (§4.1), drawn live because they flap.
   *
   * They used to be one flat triangle per side — a nine-pixel spike that read
   * as a fin. A scalloped membrane on two struts is barely more geometry and it
   * is the difference between "a white circle with fins" and a thing that
   * flies; the notches in the trailing edge are what make it *tattered* rather
   * than merely pointed.
   */
  private drawWings(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number, bob: number): void {
    const def = ENEMY_DEFS[enemy.type];
    const flap = this.reducedMotion ? -0.15 : Math.sin(this.time * 12 + enemy.id) * 0.45;
    const span = r * 2.1;
    ctx.save();
    ctx.translate(enemy.x, enemy.y + bob);
    for (const dir of [-1, 1]) {
      ctx.save();
      ctx.rotate(flap * dir);
      ctx.scale(dir, 1);
      // Membrane: a leading edge out to the tip, then three scallops back in.
      ctx.beginPath();
      ctx.moveTo(r * 0.5, -r * 0.15);
      ctx.quadraticCurveTo(span * 0.7, -r * 0.95, span, -r * 0.5);
      ctx.quadraticCurveTo(span * 0.82, -r * 0.05, span * 0.66, -r * 0.3);
      ctx.quadraticCurveTo(span * 0.6, r * 0.2, span * 0.42, -r * 0.1);
      ctx.quadraticCurveTo(span * 0.34, r * 0.32, r * 0.62, r * 0.12);
      ctx.closePath();
      ctx.fillStyle = withAlpha(def.borderColor, 0.92);
      ctx.fill();
      // A lit edge in the *body's* colour. The membrane is the flier's dark
      // navy `borderColor`, which on this floor is very nearly the floor —
      // without the edge the wings are geometry nobody can see.
      ctx.strokeStyle = withAlpha(def.color, 0.55);
      ctx.lineWidth = entity(1.2);
      ctx.stroke();
      // Struts.
      ctx.strokeStyle = withAlpha(def.color, 0.3);
      ctx.lineWidth = entity(1.1);
      ctx.beginPath();
      ctx.moveTo(r * 0.5, -r * 0.15);
      ctx.lineTo(span * 0.66, -r * 0.3);
      ctx.moveTo(r * 0.5, -r * 0.15);
      ctx.lineTo(span * 0.42, -r * 0.1);
      ctx.moveTo(r * 0.5, -r * 0.15);
      ctx.lineTo(span, -r * 0.5);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  private drawHealerAura(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number): void {
    const pulse = 1 + Math.sin(this.time * 2.5 + enemy.id) * 0.12;
    const sprite = this.getAuraSprite(`healer|${r}`, r * 2.0, r * 0.7, [
      [0, withAlpha(FX.nature, 0.22)],
      [0.6, withAlpha(FX.nature, 0.08)],
      [1, withAlpha('#000', 0)],
    ]);
    this.drawAuraSprite(ctx, sprite, enemy.x, enemy.y, pulse);
  }

  private drawEliteAura(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number, aura: AuraType): void {
    const color = ELITE_AURA_COLORS[aura];
    const pulse = 1 + Math.sin(this.time * 3 + enemy.id) * 0.15;
    const auraR = AURA_RADIUS * 0.6; // visual radius scaled down for display
    const sprite = this.getAuraSprite(`elite|${aura}|${r}`, auraR, r * 0.5, [
      [0, color],
      [0.7, color.replace(/[\d.]+\)$/, '0.08)')],
      [1, withAlpha('#000', 0)],
    ]);
    this.drawAuraSprite(ctx, sprite, enemy.x, enemy.y, pulse);
  }

  private drawEliteCrown(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number, bob: number): void {
    const color = ELITE_CROWN_COLORS[enemy.aura!] ?? INK['050'];
    const size = Math.max(entity(9), r * 0.7);
    const key = `${color}|${size.toFixed(1)}`;
    let sprite = this.crownSprites.get(key);
    if (!sprite) {
      // Painted, not typed. It used to be a `♛` rasterised twice — once flat
      // and once under a `shadowBlur`, which is one of the most expensive
      // things a 2D context does — and it looked like whichever font the
      // platform happened to resolve. Three merlons on a banded circlet with a
      // baked glow is the same read at a tenth of the cost and none of the
      // font dependency.
      sprite = this.makeSprite(size * 2.6, (g) => {
        const w = size * 0.62;
        const h = size * 0.5;
        const glow = g.createRadialGradient(0, 0, 0, 0, 0, size * 1.2);
        glow.addColorStop(0, withAlpha(color, 0.5));
        glow.addColorStop(1, withAlpha(color, 0));
        g.fillStyle = glow;
        g.beginPath();
        g.arc(0, 0, size * 1.2, 0, Math.PI * 2);
        g.fill();

        g.fillStyle = color;
        g.beginPath();
        g.moveTo(-w, h);
        g.lineTo(-w, -h * 0.2);
        g.lineTo(-w * 0.55, h * 0.25);
        g.lineTo(0, -h);
        g.lineTo(w * 0.55, h * 0.25);
        g.lineTo(w, -h * 0.2);
        g.lineTo(w, h);
        g.closePath();
        g.fill();
        // A dark band across the base, so the merlons read as points on a
        // circlet rather than as three unrelated spikes.
        g.fillStyle = withAlpha(INK['950'], 0.45);
        g.fillRect(-w, h * 0.35, w * 2, h * 0.3);
        g.fillStyle = withAlpha(INK['050'], 0.85);
        for (const at of [-1, 0, 1]) {
          g.beginPath();
          g.arc(at * w * 0.62, -h * (at === 0 ? 0.72 : 0.02), size * 0.1, 0, Math.PI * 2);
          g.fill();
        }
      });
      this.crownSprites.set(key, sprite);
    }
    const half = sprite.width / 2;
    ctx.drawImage(sprite, enemy.x - half, enemy.y - r - 12 + bob - half);
  }

  private drawShieldArcs(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number): void {
    const charges = enemy.shieldCharges ?? 0;
    if (charges <= 0) return;
    const total = 3; // max charges
    const segAngle = (Math.PI * 2) / total;
    const startOffset = -Math.PI / 2;
    const inner = r + 3;
    const outer = r + 9;
    ctx.save();
    ctx.translate(enemy.x, enemy.y);
    ctx.rotate(this.time * 1.4 + enemy.id);
    for (let i = 0; i < charges; i++) {
      const a0 = startOffset + i * segAngle + 0.08;
      const a1 = startOffset + (i + 1) * segAngle - 0.08;
      ctx.beginPath();
      ctx.arc(0, 0, inner, a0, a1);
      ctx.arc(0, 0, outer, a1, a0, true);
      ctx.closePath();
      ctx.fillStyle = withAlpha(FX.frost, 0.65);
      ctx.fill();
      ctx.strokeStyle = withAlpha(lighten(FX.frost, 0.4), 0.9);
      ctx.lineWidth = entity(1);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawBossAura(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number): void {
    // P5: enrage makes the aura pulse faster and brighter
    const enraged = enemy.enraged === true;
    const speed = enraged ? 7 : 3;
    const pulse = 1 + Math.sin(this.time * speed) * (enraged ? 0.22 : 0.12);
    const innerColor = enraged ? withAlpha(FX.blood, 0.55) : withAlpha(FX.blood, 0.28);
    const midColor = enraged ? withAlpha(FX.blood, 0.20) : withAlpha(mix(FX.blood, INK['950'], 0.35), 0.10);
    const sprite = this.getAuraSprite(`boss|${enraged ? 1 : 0}|${r}`, r * 2.4, r * 0.7, [
      [0, innerColor],
      [0.6, midColor],
      [1, withAlpha('#000', 0)],
    ]);
    this.drawAuraSprite(ctx, sprite, enemy.x, enemy.y, pulse);
  }

  /**
   * Warden ward: a hexagonal shell around whoever is carrying the absorb pool,
   * sized to what is left of it, so the player can watch it come off.
   */
  private drawWardRing(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number, bob: number): void {
    const max = enemy.absorbMax ?? 0;
    if (max <= 0) return;
    const ratio = Math.max(0, Math.min(1, (enemy.absorbShield ?? 0) / max));
    const radius = r + 6;
    ctx.save();
    ctx.translate(enemy.x, enemy.y + bob);
    ctx.strokeStyle = withAlpha(FX.frost, 0.35 + ratio * 0.45);
    ctx.lineWidth = entity(1.5) + ratio * 2;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2 + this.time * 0.6;
      const px = Math.cos(a) * radius;
      const py = Math.sin(a) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Siege: a dashed standoff ring and a reload arc while it is halted.
   *
   * The ring is what tells a short-range build *why* it is losing HP with
   * nothing in range — the answer the type demands is more range, and the
   * player cannot reach for it if they cannot see the problem.
   */
  private drawSiegeStance(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number): void {
    ctx.save();
    ctx.strokeStyle = withAlpha(lighten(FX.gold, 0.2), 0.28);
    ctx.lineWidth = entity(1.5);
    ctx.setLineDash([entity(7), entity(9)]);
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, r + 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // Smoke off the barrel while it is shelling. The barrel itself is baked
    // into the silhouette; the smoke is the one part that has to be live,
    // because a static puff reads as a smudge rather than as a machine that
    // just fired. Two stroked curves per halted siege, and a wave holds a
    // handful of them.
    if (!this.reducedMotion) {
      ctx.save();
      ctx.translate(enemy.x, enemy.y);
      ctx.lineCap = 'round';
      for (let i = 0; i < 2; i++) {
        const t = ((this.time * 0.55 + i * 0.5 + enemy.id * 0.13) % 1);
        ctx.globalAlpha = (1 - t) * 0.3;
        ctx.strokeStyle = withAlpha(INK['200'], 1);
        ctx.lineWidth = entity(1.6) + t * entity(3);
        ctx.beginPath();
        ctx.moveTo(r * 1.34, 0);
        ctx.quadraticCurveTo(
          r * 1.34 + t * entity(7),
          -t * entity(14),
          r * 1.34 - t * entity(4),
          -t * entity(28),
        );
        ctx.stroke();
      }
      ctx.restore();
    }

    // Reload arc: a full sweep means the next shell is about to leave.
    const reload = ENEMY_BEHAVIOR.siegeReload;
    const remaining = Math.max(0, Math.min(reload, enemy.siegeCooldown ?? reload));
    const progress = 1 - remaining / reload;
    if (progress > 0) {
      ctx.strokeStyle = withAlpha(mix(FX.ember, FX.gold, 0.5), 0.85);
      ctx.lineWidth = entity(3);
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, r + 8, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Boss encounter reads (gameplay plan §3.5).
   *
   * The bar carries the numbers; this carries the *where*. A slam telegraph in
   * particular has to be on the field — the answer to it is a cooldown aimed at
   * the boss, and a countdown at the top of the screen does not tell the player
   * which of six bosses to aim it at.
   *
   * Everything here is stroked arcs and lines: no gradients, no allocation.
   */
  private drawBossState(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number): void {
    // Phase flash: a white shell for the moment it cannot be shot.
    const invuln = enemy.bossInvulnerable ?? 0;
    if (invuln > 0) {
      const t = invuln / BOSS_ENCOUNTER.phaseInvulnerability;
      ctx.save();
      ctx.strokeStyle = withAlpha(lighten(FX.gold, 0.55), 0.35 + t * 0.5);
      ctx.lineWidth = entity(3) + t * 3;
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, r + 10 + (1 - t) * 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Bulwark: a ring whose sweep is what is left of the shield.
    const shieldMax = enemy.bossShieldMax ?? 0;
    const shield = enemy.bossShield ?? 0;
    if (shieldMax > 0 && shield > 0) {
      const ratio = Math.max(0, Math.min(1, shield / shieldMax));
      ctx.save();
      ctx.strokeStyle = withAlpha(FX.frost, 0.85);
      ctx.lineWidth = entity(4);
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, r + 7, -Math.PI / 2, -Math.PI / 2 + ratio * Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Slam: a ground ring that closes in as the telegraph runs out, so the
    // "how long have I got" read is spatial and does not need a glance away.
    const telegraph = enemy.bossSlamTelegraph ?? 0;
    if (telegraph > 0) {
      const progress = 1 - telegraph / BOSS_ENCOUNTER.slamTelegraph;
      const mitigated = enemy.bossSlamMitigated === true;
      const outer = r + 20 + (1 - progress) * 90;
      ctx.save();
      ctx.strokeStyle = mitigated
        ? withAlpha(lighten(FX.frost, 0.2), 0.5 + progress * 0.4)
        : withAlpha(FX.ember, 0.45 + progress * 0.5);
      ctx.lineWidth = entity(3) + progress * 4;
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, outer, 0, Math.PI * 2);
      ctx.stroke();
      // A filling inner disc outline, so the last half-second is unmistakable.
      ctx.lineWidth = entity(2);
      ctx.setLineDash([entity(6), entity(8)]);
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, r + 20 + progress * 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Siphon: a live beam to the tower. Drawn from state rather than from an
    // event, because the drain is continuous and per-substep events would be
    // six particle bursts a frame for one effect.
    if (enemy.bossPattern === 'siphon' && invuln <= 0) {
      const pulse = 0.35 + Math.sin(this.time * 9 + enemy.id) * 0.2;
      ctx.save();
      ctx.strokeStyle = withAlpha(FX.mana, pulse);
      ctx.lineWidth = entity(2.5);
      ctx.setLineDash([entity(10), entity(8)]);
      ctx.lineDashOffset = -this.time * 90;
      ctx.beginPath();
      ctx.moveTo(this.towerX, this.towerY);
      ctx.lineTo(enemy.x, enemy.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  /** Thief: a coin it is visibly carrying, plus an arrow along its escape route. */
  private drawThiefLoot(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number): void {
    const sprite = this.getCoinSprite();
    const half = sprite.width / 2;
    const bounce = Math.sin(this.time * 8 + enemy.id) * 2;
    ctx.drawImage(sprite, enemy.x - half, enemy.y - r - 12 + bounce - half);
    if (!enemy.fleeing) return;
    // Direction of travel, taken from the last frame's displacement rather
    // than stored on the enemy: the flee vector is simulation state and the
    // renderer has no business owning a copy of it.
    const dx = enemy.x - (enemy.afterImageX ?? enemy.x);
    const dy = enemy.y - (enemy.afterImageY ?? enemy.y);
    const angle = dx === 0 && dy === 0
      ? Math.atan2(enemy.y - this.height / 2, enemy.x - this.width / 2)
      : Math.atan2(dy, dx);
    ctx.save();
    ctx.translate(enemy.x, enemy.y);
    ctx.rotate(angle);
    ctx.fillStyle = withAlpha(lighten(FX.gold, 0.3), 0.9);
    ctx.beginPath();
    ctx.moveTo(r + 14, 0);
    ctx.lineTo(r + 4, -6);
    ctx.lineTo(r + 4, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /**
   * Burrower: a dust plume while it is underground and untouchable, and a
   * one-second expanding ring as it breaks the surface.
   */
  private drawBurrowerState(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number): void {
    if (enemy.burrowed === true) {
      const sprite = this.getAuraSprite(`burrow|${r}`, r * 2.2, r * 0.3, [
        [0, withAlpha(mix(FX.gold, INK['400'], 0.4), 0.30)],
        [0.65, withAlpha(mix(FX.gold, INK['600'], 0.5), 0.12)],
        [1, withAlpha('#000', 0)],
      ]);
      const pulse = 1 + Math.sin(this.time * 6 + enemy.id) * 0.14;
      this.drawAuraSprite(ctx, sprite, enemy.x, enemy.y + r * 0.3, pulse);
      return;
    }
    const surfacing = enemy.surfacing ?? 0;
    if (surfacing <= 0) return;
    const progress = 1 - surfacing / ENEMY_BEHAVIOR.burrowTelegraph;
    ctx.save();
    ctx.strokeStyle = withAlpha(lighten(FX.gold, 0.12), 0.75 * (1 - progress));
    ctx.lineWidth = entity(4);
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, r + 6 + progress * 42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * The coin a loaded thief carries. Cached — it is static.
   *
   * Struck rather than lettered: a rim, a lit bevel and a milled edge, so it
   * reads as a coin at eight pixels instead of as a `$` in whatever font the
   * platform resolved.
   */
  private getCoinSprite(): HTMLCanvasElement {
    const cached = this.enemySprites.get('#coin');
    if (cached) return cached;
    const r = entity(7);
    const sprite = this.makeSprite(entity(22), (g) => {
      const glow = g.createRadialGradient(0, 0, r * 0.5, 0, 0, r * 1.5);
      glow.addColorStop(0, withAlpha(FX.gold, 0.45));
      glow.addColorStop(1, withAlpha(FX.gold, 0));
      g.fillStyle = glow;
      g.beginPath();
      g.arc(0, 0, r * 1.5, 0, Math.PI * 2);
      g.fill();

      g.fillStyle = FX.gold;
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = withAlpha(INK['950'], 0.7);
      g.lineWidth = entity(1.2);
      g.stroke();
      // Milled edge: short ticks around the rim.
      g.strokeStyle = withAlpha(INK['950'], 0.35);
      g.lineWidth = entity(0.9);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        g.beginPath();
        g.moveTo(Math.cos(a) * r * 0.74, Math.sin(a) * r * 0.74);
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        g.stroke();
      }
      g.fillStyle = withAlpha(INK['050'], 0.55);
      g.beginPath();
      g.arc(-r * 0.28, -r * 0.32, r * 0.3, 0, Math.PI * 2);
      g.fill();
    });
    this.enemySprites.set('#coin', sprite);
    return sprite;
  }

  /**
   * Incoming siege shells (plan §2.1).
   *
   * Drawn as a body on a parabolic lift above the straight line it actually
   * travels, plus a ground marker at the impact point: the arc is the
   * telegraph, and the marker is what makes it obvious the tower is about to
   * be hit by something no amount of knockback will stop.
   */
  private drawHostileShots(ctx: CanvasRenderingContext2D, shots: HostileShot[]): void {
    if (shots.length === 0) return;
    ctx.save();
    for (const s of shots) {
      if (!s.alive) continue;
      const progress = s.travel > 0 ? 1 - s.remaining / s.travel : 1;
      const lift = Math.sin(Math.max(0, Math.min(1, progress)) * Math.PI) * 46;
      const dx = s.vx * s.remaining;
      const dy = s.vy * s.remaining;
      const landX = s.x + dx;
      const landY = s.y + dy;

      // Impact marker, tightening as the shell comes down.
      ctx.strokeStyle = withAlpha(FX.ember, 0.25 + progress * 0.5);
      ctx.lineWidth = entity(2);
      ctx.beginPath();
      ctx.arc(landX, landY, 6 + (1 - progress) * 26, 0, Math.PI * 2);
      ctx.stroke();

      // Ground shadow directly under the shell.
      ctx.fillStyle = withAlpha('#000', 0.30);
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, 5, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = FX.ember;
      ctx.beginPath();
      ctx.arc(s.x, s.y - lift, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = mix(FX.ember, INK['950'], 0.7);
      ctx.lineWidth = entity(1.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawEnemyHpBar(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number, bob: number): void {
    if (enemy.hp >= enemy.maxHp) return;
    const barW = Math.max(20, r * 2);
    const barH = enemy.type === 'boss' ? 6 : 4;
    const x = enemy.x - barW / 2;
    const y = enemy.y - r - 10 + bob;
    const ratio = Math.max(0, enemy.hp / enemy.maxHp);
    ctx.fillStyle = withAlpha('#000', 0.6);
    ctx.fillRect(x, y, barW, barH);
    ctx.fillStyle = ratio > 0.5 ? FX.nature : ratio > 0.25 ? FX.gold : FX.blood;
    ctx.fillRect(x, y, barW * ratio, barH);
    if (enemy.type === 'boss') {
      ctx.strokeStyle = withAlpha('#ffffff', 0.4);
      ctx.lineWidth = entity(1);
      ctx.strokeRect(x - 0.5, y - 0.5, barW + 1, barH + 1);
    }
  }

  /**
   * Shots in flight, and the sparks off the ones that just landed (§4.3).
   *
   * What this replaces: a 14 px gold arrowhead and a 16 px violet blob, the
   * same two for every core and every build in the game. Now a shot is
   * **rotated to its velocity**, carries a **cached motion trail** — a baked
   * tapered streak, not a per-frame particle spawn, which is what the plan
   * specifically rules out — and looks like the core that fired it.
   *
   * Two passes over the list rather than one, so the additive composite is set
   * twice per frame instead of twice per projectile.
   */
  private drawProjectiles(ctx: CanvasRenderingContext2D, projectiles: Projectile[]): void {
    if (projectiles.length === 0) return;
    const core = this.core;

    // Pass 1, additive: trails, magic bodies, and impact sparks. Everything
    // that is *light* rather than matter. A rocket swaps its trail for an
    // exhaust flame — same additive pass, different light.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of projectiles) {
      if (!p.alive) continue;
      const magic = p.damageType === 'magic';
      const sprite = p.visual === 'rocket'
        ? this.getRocketExhaustSprite()
        : p.visual === 'shard'
          ? this.getShardTrailSprite(core)
          : magic
            ? this.getMagicShotSprite(core)
            : this.getTrailSprite(core, (p.splashRadius ?? 0) > 0);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.atan2(p.vy, p.vx));
      ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2);
      ctx.restore();
    }
    // A bounced shot carries a halo that grows with its hop count, so a
    // ricochet chain is legible as one shot doing three things rather than as
    // three unrelated shots (`plans/bounce.md` §5.4). Ungated by
    // `profile.additive` on purpose: this pass sets `lighter` unconditionally,
    // so gating only the halo would leave it as a flat blob on `low`.
    for (const p of projectiles) {
      if (!p.alive || !p.bounces) continue;
      const halo = this.getBounceHaloSprite(core);
      const size = halo.width * (1 + Math.min(3, p.bounces) * 0.22);
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.drawImage(halo, p.x - size / 2, p.y - size / 2, size, size);
      ctx.restore();
    }
    this.drawSparks(ctx, core);
    ctx.restore();

    // Pass 2, ordinary: the physical heads. A bolt is a solid object and must
    // read as one against a bright explosion, which additive blending cannot do.
    for (const p of projectiles) {
      if (!p.alive || p.damageType === 'magic') continue;
      const sprite = p.visual === 'rocket'
        ? this.getRocketSprite()
        : p.visual === 'shard'
          ? this.getShardSprite(core)
          : this.getBoltSprite(core, (p.splashRadius ?? 0) > 0);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.atan2(p.vy, p.vx));
      ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2);
      ctx.restore();
    }
  }

  /**
   * The physical head, pointing along +x so a rotate-and-blit aims it.
   *
   * `shell` and `shard` are the artillery and frostwork variants: a core's shot
   * behaviour should be legible from the shot, not only from the picker card.
   */
  private getBoltSprite(core: CoreId, splash: boolean): HTMLCanvasElement {
    const style = SHOT_STYLES[core];
    const tint = CORE_BY_ID[core].color;
    const head = splash ? 'shell' : style.head;
    const b = this.marks.steps.barrel;
    // §E: the bolt grows with the barrel that fired it. Keyed into `part`
    // rather than `towerPart` on purpose — a bolt sprite is ~60 px square, the
    // variant space is 5 cores x 3 heads x 7 barrel steps = 105 worst case at
    // ~14 KB each, and unlike the drum these are hit tens of times a frame, so
    // a cache that empties on every threshold crossing would be the wrong
    // trade.
    const L = BOLT_LENGTH * (head === 'shell' ? 1.2 : 1) * (1 + b * 0.035);
    return this.part(`bolt|${core}|${head}|${b}`, L * 3.4, (g) => {
      g.lineJoin = 'round';
      switch (head) {
        case 'shell': {
          // Blunt and heavy: it is a thing that arrives rather than a thing
          // that pierces, and it is about to take out everything around it.
          g.fillStyle = tint;
          g.beginPath();
          g.moveTo(L, 0);
          g.quadraticCurveTo(L * 0.7, -L * 0.55, -L * 0.5, -L * 0.5);
          g.lineTo(-L * 0.5, L * 0.5);
          g.quadraticCurveTo(L * 0.7, L * 0.55, L, 0);
          g.closePath();
          g.fill();
          g.strokeStyle = withAlpha(INK['950'], 0.75);
          g.lineWidth = entity(1.2);
          g.stroke();
          g.fillStyle = withAlpha(FX.ember, 0.85);
          g.fillRect(-L * 0.5, -L * 0.5, L * 0.22, L);
          break;
        }
        case 'shard': {
          // A crystal: narrow, faceted, and cold.
          g.fillStyle = tint;
          g.beginPath();
          g.moveTo(L * 1.15, 0);
          g.lineTo(0, -L * 0.34);
          g.lineTo(-L * 0.75, 0);
          g.lineTo(0, L * 0.34);
          g.closePath();
          g.fill();
          g.strokeStyle = withAlpha(FX.frost, 0.9);
          g.lineWidth = entity(1);
          g.stroke();
          g.fillStyle = withAlpha(INK['050'], 0.7);
          g.beginPath();
          g.moveTo(L * 1.15, 0);
          g.lineTo(0, -L * 0.34);
          g.lineTo(-L * 0.2, 0);
          g.closePath();
          g.fill();
          break;
        }
        case 'bolt': {
          // Fletched: a shaft, a head and two vanes. The vanes are the whole
          // difference between "an arrow" and "a triangle".
          g.fillStyle = withAlpha(INK['700'], 0.95);
          g.fillRect(-L * 0.9, -L * 0.11, L * 1.7, L * 0.22);
          g.fillStyle = tint;
          g.beginPath();
          g.moveTo(L, 0);
          g.lineTo(L * 0.35, -L * 0.36);
          g.lineTo(L * 0.45, 0);
          g.lineTo(L * 0.35, L * 0.36);
          g.closePath();
          g.fill();
          g.strokeStyle = withAlpha(INK['950'], 0.8);
          g.lineWidth = entity(0.9);
          g.stroke();
          g.fillStyle = withAlpha(style.glow, 0.9);
          for (const dir of [-1, 1]) {
            g.beginPath();
            g.moveTo(-L * 0.9, dir * L * 0.1);
            g.lineTo(-L * 1.25, dir * L * 0.5);
            g.lineTo(-L * 0.45, dir * L * 0.12);
            g.closePath();
            g.fill();
          }
          // §E: barbs at b >= 2, a lit edge at b >= 4, a gold band at b >= 6.
          if (b >= 2) {
            g.fillStyle = tint;
            for (const dir of [-1, 1]) {
              g.beginPath();
              g.moveTo(L * 0.45, dir * L * 0.06);
              g.lineTo(L * 0.1, dir * L * 0.3);
              g.lineTo(L * 0.3, dir * L * 0.07);
              g.closePath();
              g.fill();
            }
          }
          if (b >= 4) {
            g.strokeStyle = withAlpha(INK['050'], 0.7);
            g.lineWidth = entity(0.8);
            g.beginPath();
            g.moveTo(L, 0);
            g.lineTo(L * 0.35, -L * 0.36);
            g.stroke();
          }
          if (b >= 6) {
            g.fillStyle = withAlpha(FX.gold, 0.9);
            g.fillRect(-L * 0.3, -L * 0.13, L * 0.16, L * 0.26);
          }
          break;
        }
        default: {
          const exhaustive: never = head;
          return exhaustive;
        }
      }
    });
  }

  /**
   * A Rocket Barrage round: an elongated hull with fins, pointing along +x so
   * a rotate-and-blit aims it, in the same family as the bolt heads above.
   *
   * Rockets come from an *ability* rather than the barrel, so they wear the
   * ember/gold of explosions here instead of any core's tint — whatever build
   * fired them, they must not read as one of its shots.
   */
  private getRocketSprite(): HTMLCanvasElement {
    const L = BOLT_LENGTH * 1.5;
    return this.part('rocket', L * 3.4, (g) => {
      g.lineJoin = 'round';
      // Fins first, so the hull overlaps their roots.
      g.fillStyle = withAlpha(INK['950'], 0.9);
      for (const dir of [-1, 1]) {
        g.beginPath();
        g.moveTo(-L * 0.5, dir * L * 0.12);
        g.lineTo(-L * 1.05, dir * L * 0.52);
        g.lineTo(-L * 0.1, dir * L * 0.18);
        g.closePath();
        g.fill();
      }
      // Hull: slim, dark, with an outline like every other physical head.
      g.fillStyle = withAlpha(INK['500'], 0.95);
      g.beginPath();
      g.moveTo(L * 1.05, 0);
      g.quadraticCurveTo(L * 0.4, -L * 0.26, -L * 0.9, -L * 0.22);
      g.lineTo(-L * 0.9, L * 0.22);
      g.quadraticCurveTo(L * 0.4, L * 0.26, L * 1.05, 0);
      g.closePath();
      g.fill();
      g.strokeStyle = withAlpha(INK['950'], 0.8);
      g.lineWidth = entity(1.1);
      g.stroke();
      // Ember nose cone and a gold warhead band — the accent pair.
      g.fillStyle = withAlpha(FX.ember, 0.9);
      g.beginPath();
      g.moveTo(L * 1.05, 0);
      g.quadraticCurveTo(L * 0.72, -L * 0.17, L * 0.45, -L * 0.2);
      g.lineTo(L * 0.45, L * 0.2);
      g.quadraticCurveTo(L * 0.72, L * 0.17, L * 1.05, 0);
      g.closePath();
      g.fill();
      g.fillStyle = withAlpha(FX.gold, 0.85);
      g.fillRect(L * 0.08, -L * 0.21, L * 0.14, L * 0.42);
    });
  }

  /**
   * The additive half of a rocket: a short exhaust flame pointing backwards
   * (−x after rotation), standing in for the straight-line trail a bolt gets.
   * A rocket turns hard toward its target, so a fixed streak would lag behind
   * the heading; a flame at the nozzle is always correct no matter where the
   * hull is pointed.
   */
  private getRocketExhaustSprite(): HTMLCanvasElement {
    const len = BOLT_LENGTH * 3;
    return this.part('rocket-exhaust', len * 2.2, (g) => {
      const grad = g.createLinearGradient(BOLT_LENGTH * 0.3, 0, -len, 0);
      grad.addColorStop(0, withAlpha(FX.gold, 0.85));
      grad.addColorStop(0.35, withAlpha(FX.ember, 0.5));
      grad.addColorStop(1, withAlpha(FX.ember, 0));
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(BOLT_LENGTH * 0.3, -BOLT_LENGTH * 0.34);
      g.quadraticCurveTo(-len * 0.35, -BOLT_LENGTH * 0.52, -len, 0);
      g.quadraticCurveTo(-len * 0.35, BOLT_LENGTH * 0.52, BOLT_LENGTH * 0.3, BOLT_LENGTH * 0.34);
      g.closePath();
      g.fill();
      // Hot core right at the nozzle.
      const hot = g.createRadialGradient(BOLT_LENGTH * 0.1, 0, 0, BOLT_LENGTH * 0.1, 0, BOLT_LENGTH * 0.8);
      hot.addColorStop(0, withAlpha(INK['050'], 0.9));
      hot.addColorStop(1, withAlpha(INK['050'], 0));
      g.fillStyle = hot;
      g.beginPath();
      g.arc(BOLT_LENGTH * 0.1, 0, BOLT_LENGTH * 0.8, 0, Math.PI * 2);
      g.fill();
    });
  }

  /**
   * The motion trail: one baked tapered streak, blitted behind the head.
   *
   * §4.3 asks for "a short cached polyline, **not** a per-frame particle
   * spawn", and this is stricter than that — it is a single `drawImage`.
   * Because every shot in this game travels in a straight line at a constant
   * speed (homing turns, but slowly), the streak that trails a shot is exactly
   * a fixed shape behind it, so there is nothing a stored position history
   * would add except the allocation.
   */
  private getTrailSprite(core: CoreId, splash: boolean): HTMLCanvasElement {
    const style = SHOT_STYLES[core];
    const len = BOLT_LENGTH * style.trail * (splash ? 1.3 : 1);
    return this.part(`trail|${core}|${splash ? 1 : 0}`, len * 2.4, (g) => {
      const w = BOLT_LENGTH * (splash ? 0.42 : 0.3);
      const grad = g.createLinearGradient(-len, 0, BOLT_LENGTH * 0.4, 0);
      grad.addColorStop(0, withAlpha(style.glow, 0));
      grad.addColorStop(0.65, withAlpha(style.glow, 0.28));
      grad.addColorStop(1, withAlpha(style.glow, 0.7));
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(BOLT_LENGTH * 0.4, -w);
      g.lineTo(BOLT_LENGTH * 0.4, w);
      g.lineTo(-len, 0);
      g.closePath();
      g.fill();
    });
  }

  /**
   * A Splinter shard: a short bright sliver, pointing along +x.
   *
   * Deliberately unlike the core's bolt — a shard is not a shot the tower
   * fired, and the player should be able to tell a splinter fan from a volley
   * without reading the blessing bar.
   */
  private getShardSprite(core: CoreId): HTMLCanvasElement {
    const tint = CORE_BY_ID[core].color;
    const L = BOLT_LENGTH * 0.55;
    return this.part(`shard|${core}`, L * 4, (g) => {
      g.fillStyle = lighten(tint, 0.35);
      g.beginPath();
      g.moveTo(L, 0);
      g.lineTo(-L * 0.6, -L * 0.34);
      g.lineTo(-L * 0.25, 0);
      g.lineTo(-L * 0.6, L * 0.34);
      g.closePath();
      g.fill();
      g.strokeStyle = withAlpha(INK['950'], 0.6);
      g.lineWidth = entity(0.8);
      g.stroke();
    });
  }

  /** The shard's trail: shorter and thinner than a bolt's, same construction. */
  private getShardTrailSprite(core: CoreId): HTMLCanvasElement {
    const glow = SHOT_STYLES[core].glow;
    const len = BOLT_LENGTH * 1.6;
    return this.part(`shard-trail|${core}`, len * 2.4, (g) => {
      const w = BOLT_LENGTH * 0.2;
      const grad = g.createLinearGradient(-len, 0, BOLT_LENGTH * 0.3, 0);
      grad.addColorStop(0, withAlpha(glow, 0));
      grad.addColorStop(1, withAlpha(lighten(glow, 0.4), 0.85));
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(BOLT_LENGTH * 0.3, -w);
      g.lineTo(BOLT_LENGTH * 0.3, w);
      g.lineTo(-len, 0);
      g.closePath();
      g.fill();
    });
  }

  /** Soft radial glow worn by a projectile that has ricocheted. */
  private getBounceHaloSprite(core: CoreId): HTMLCanvasElement {
    const glow = SHOT_STYLES[core].glow;
    const r = BOLT_LENGTH * 1.5;
    return this.part(`bounce-halo|${core}`, r * 2, (g) => {
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
      grad.addColorStop(0, withAlpha('#ffffff', 0.7));
      grad.addColorStop(0.35, withAlpha(lighten(glow, 0.3), 0.45));
      grad.addColorStop(1, withAlpha(glow, 0));
      g.fillStyle = grad;
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.fill();
    });
  }

  /**
   * A magic shot: core, corona and trailing wisps, all in one additive sprite.
   *
   * The wisps are baked into the same sprite as the head — they sit at fixed
   * offsets along −x, which is exactly where they would be if they were
   * simulated, because the shot travels in a straight line. One blit for the
   * whole effect, which is cheaper than the single radial blob it replaces.
   *
   * This is also `mana_shot` made visible: the arcane core's every-fifth shot
   * lands as `damageType: 'magic'`, so it is *this* that comes out of the
   * barrel instead of a bolt, and the proc is legible in flight.
   */
  private getMagicShotSprite(core: CoreId): HTMLCanvasElement {
    const tint = CORE_BY_ID[core].color;
    const r = BOLT_LENGTH * 0.62;
    const tail = BOLT_LENGTH * SHOT_STYLES[core].trail;
    return this.part(`magic|${core}`, (tail + r) * 2.2, (g) => {
      const corona = g.createRadialGradient(0, 0, 0, 0, 0, r * 2.6);
      corona.addColorStop(0, withAlpha(FX.arcane, 0.55));
      corona.addColorStop(0.4, withAlpha(tint, 0.3));
      corona.addColorStop(1, withAlpha(tint, 0));
      g.fillStyle = corona;
      g.beginPath();
      g.arc(0, 0, r * 2.6, 0, Math.PI * 2);
      g.fill();
      // Wisps: smaller and dimmer the further back they are, alternating off
      // the axis so the trail curls rather than reading as a bar.
      for (let i = 1; i <= 4; i++) {
        const t = i / 5;
        const x = -tail * t;
        const y = Math.sin(i * 1.9) * r * 0.8;
        g.fillStyle = withAlpha(tint, 0.42 * (1 - t));
        g.beginPath();
        g.arc(x, y, r * (1 - t * 0.7), 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = withAlpha(INK['050'], 0.95);
      g.beginPath();
      g.arc(0, 0, r * 0.5, 0, Math.PI * 2);
      g.fill();
    });
  }

  /**
   * Ground decals from shots that have landed (§4.3).
   *
   * Drawn with the floor rather than with the entities, so a mob walks over a
   * scorch mark instead of under it. Pooled at the quality profile's `decals` and faded over
   * `DECAL_TIME`; a splash-carrying shot leaves a wider mark, which is what
   * makes artillery's blast radius something the player can see the size of
   * rather than a number on a card.
   */
  private drawImpactDecals(ctx: CanvasRenderingContext2D): void {
    if (this.impacts.length === 0) return;
    ctx.save();
    for (const im of this.impacts) {
      const fade = 1 - im.age / DECAL_TIME;
      const sprite = this.getDecalSprite(im.magic);
      // Baked large and scaled *down* for an ordinary hit: an artillery blast
      // is `CORE_TUNING.splashRadius` = 182 world units, and upscaling a 26 px
      // smudge to that is a blur rather than a crater. A splash decal is
      // deliberately well inside its own blast — the crater a shell leaves is
      // not the width of what it killed, and a 2 s mark at the full blast
      // radius would black out a quarter of the arena.
      const size = im.splash > 0 ? Math.min(im.splash * 0.8, DECAL_BAKE_RADIUS * 2) : entity(30);
      ctx.globalAlpha = fade * fade * (im.splash > 0 ? 0.55 : 0.8);
      ctx.save();
      ctx.translate(im.x, im.y);
      ctx.rotate(im.angle);
      ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * One scorch mark, elongated along the direction of travel.
   *
   * The burn itself is near-black, which on this floor is a shadow rather than
   * a mark — so the ejecta streaks are warm (or arcane), and they are what
   * actually reads. A pure `INK['950']` decal is invisible on `INK['800']`
   * ground, which is a lesson this file has already learned once with the
   * flier's wings.
   */
  private getDecalSprite(magic: boolean): HTMLCanvasElement {
    const r = DECAL_BAKE_RADIUS;
    const burn = magic ? FX.arcane : INK['900'];
    const spray = magic ? FX.arcane : FX.ember;
    return this.part(`decal|${magic ? 1 : 0}`, r * 2.2, (g) => {
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
      grad.addColorStop(0, withAlpha(burn, magic ? 0.32 : 0.5));
      grad.addColorStop(0.55, withAlpha(burn, magic ? 0.14 : 0.22));
      grad.addColorStop(1, withAlpha(burn, 0));
      g.fillStyle = grad;
      g.beginPath();
      g.ellipse(0, 0, r, r * 0.74, 0, 0, Math.PI * 2);
      g.fill();
      // Ejecta, thrown forward along the impact vector.
      g.strokeStyle = withAlpha(spray, magic ? 0.35 : 0.42);
      g.lineWidth = r * 0.05;
      g.lineCap = 'round';
      for (let i = 0; i < 7; i++) {
        const jitter = ((Math.imul(i + 3, 2654435761) >>> 0) % 1000) / 1000;
        const a = (i - 3) * 0.34 + (jitter - 0.5) * 0.2;
        const reach = r * (0.6 + jitter * 0.4);
        g.beginPath();
        g.moveTo(Math.cos(a) * r * 0.25, Math.sin(a) * r * 0.25);
        g.lineTo(Math.cos(a) * reach, Math.sin(a) * reach);
        g.stroke();
      }
      g.fillStyle = withAlpha(spray, magic ? 0.22 : 0.3);
      g.beginPath();
      g.ellipse(0, 0, r * 0.3, r * 0.22, 0, 0, Math.PI * 2);
      g.fill();
    });
  }

  /**
   * The spark cone at a fresh impact (§4.3).
   *
   * Aligned to the impact normal — the shot's own heading — and thrown *back*
   * along it, which is the direction debris actually goes. Stroked lines, no
   * per-particle gradients, and only for the first `SPARK_TIME` of a decal's
   * life, so the pool this walks is at most a handful of entries.
   */
  private drawSparks(ctx: CanvasRenderingContext2D, core: CoreId): void {
    if (this.impacts.length === 0) return;
    const glow = SHOT_STYLES[core].glow;
    ctx.save();
    ctx.lineCap = 'round';
    for (const im of this.impacts) {
      if (im.age >= SPARK_TIME) continue;
      const k = im.age / SPARK_TIME;
      const fade = 1 - k;
      ctx.save();
      ctx.translate(im.x, im.y);
      ctx.rotate(im.angle);
      ctx.globalAlpha = fade;
      ctx.strokeStyle = im.magic ? withAlpha(FX.arcane, 0.9) : withAlpha(glow, 0.9);
      ctx.lineWidth = entity(1.6) * fade;
      const reach = entity(6) + k * entity(20) * (im.splash > 0 ? 1.8 : 1);
      for (let i = 0; i < SPARK_COUNT; i++) {
        // A cone of ±60° about the *reverse* of the shot's heading, with a
        // deterministic per-spark jitter so it is not a fan of even spokes.
        const jitter = ((Math.imul(i + 1, 2654435761) >>> 0) % 1000) / 1000;
        const a = Math.PI + (i / (SPARK_COUNT - 1) - 0.5) * 2.1 + (jitter - 0.5) * 0.3;
        const near = reach * (0.35 + jitter * 0.3);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * near, Math.sin(a) * near);
        ctx.lineTo(Math.cos(a) * reach * (0.8 + jitter * 0.5), Math.sin(a) * reach * (0.8 + jitter * 0.5));
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * The additive pass (UI plan §5.A).
   *
   * Every glow in the game used to composite `source-over` and read as flat
   * paint, and the three places that did reach for `lighter` each flipped the
   * composite mode themselves, several times a frame. This is the one routed
   * pass: everything in it is *light*, it costs a single state flip, and it
   * adds no draw calls — it only moves existing ones.
   */
  private drawAdditivePass(
    ctx: CanvasRenderingContext2D,
    snap: RenderSnapshot,
    options?: RenderOptions,
  ): void {
    ctx.save();
    // At the `low` tier the pass still runs — everything in it still has to be
    // drawn — but composites `source-over`, which is the cheap path on a GPU
    // that has to read back the destination for every `lighter` fill.
    if (this.profile.additive) ctx.globalCompositeOperation = 'lighter';
    this.drawParticles(ctx, snap.particles, 'additive');
    this.drawShockwaves(ctx, snap.shockwaves);
    this.drawChainLightning(ctx, options?.chainPaths);
    this.drawTracers(ctx, snap);
    this.drawMuzzleFlash(ctx, snap);
    this.drawComboEmbers(ctx);
    ctx.restore();
  }

  /**
   * Embers thrown off by a running combo (§5.C).
   *
   * Deliberately not routed through `EffectsManager`: this is pure decoration
   * on the renderer's own clock, and spending the shared 600-particle pool on
   * it would let a long combo evict the sparks the player is actually reading.
   */
  private drawComboEmbers(ctx: CanvasRenderingContext2D): void {
    if (this.embers.length === 0 || this.comboGlow === 0) return;
    const sprite = this.part('combo-ember', entity(14), (g) => {
      const r = entity(7);
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
      grad.addColorStop(0, withAlpha(FX.gold, 0.95));
      grad.addColorStop(0.45, withAlpha(FX.ember, 0.5));
      grad.addColorStop(1, withAlpha(FX.ember, 0));
      g.fillStyle = grad;
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.fill();
    });
    ctx.save();
    for (const e of this.embers) {
      // A sine rather than a ramp, so an ember fades in *and* out and never
      // pops into existence at full brightness.
      ctx.globalAlpha = Math.sin(Math.PI * (e.age / e.life)) * 0.5 * this.comboGlow;
      // `size` is the ember's core radius; the sprite is mostly falloff, so it
      // is blitted at four times that to keep the glow around it.
      const size = e.size * 4;
      ctx.drawImage(sprite, e.x - size / 2, e.y - size / 2, size, size);
    }
    ctx.restore();
  }

  /**
   * Particles.
   *
   * `p.size` comes from `EffectsManager`, which Part 5 owns and which has not
   * been through the `ENTITY_SCALE` pass yet — so they are scaled here at the
   * draw call instead. When Part 5 moves the emitter constants onto the arena
   * scales, this multiply comes back out.
   */
  private drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[], layer: ParticleLayer): void {
    ctx.save();
    for (const p of particles) {
      const lifeRatio = 1 - p.age / p.life;
      if (lifeRatio <= 0) continue;
      // §5.A: routed by field, not by sniffing the colour string. An emitter
      // that stamped nothing is `front`.
      if ((p.layer ?? 'front') !== layer) continue;
      // Additive over a near-black ground blows out fast, so light fades on a
      // steeper curve and never reaches full strength.
      ctx.globalAlpha = layer === 'additive' ? Math.pow(lifeRatio, 1.6) * 0.85 : lifeRatio;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, entity(p.size), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawShockwaves(ctx: CanvasRenderingContext2D, shockwaves: Shockwave[]): void {
    ctx.save();
    for (const s of shockwaves) {
      const lifeRatio = 1 - s.age / s.life;
      if (lifeRatio <= 0) continue;
      ctx.globalAlpha = lifeRatio;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.lineWidth;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.currentRadius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawChainLightning(
    ctx: CanvasRenderingContext2D,
    paths: { points: { x: number; y: number }[]; age: number; life: number }[] | undefined,
  ): void {
    if (!paths || paths.length === 0) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const path of paths) {
      const lifeRatio = 1 - path.age / path.life;
      if (lifeRatio <= 0) continue;
      const points = path.points;
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        // Outer glow stroke
        ctx.globalAlpha = lifeRatio * 0.55;
        ctx.strokeStyle = withAlpha(FX.mana, 0.85);
        ctx.lineWidth = entity(5);
        ctx.beginPath();
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const segLen = Math.sqrt(dx * dx + dy * dy);
        const jag = 5;
        ctx.moveTo(a.x, a.y);
        const steps = Math.max(2, Math.floor(segLen / 12));
        for (let s = 1; s <= steps; s++) {
          const tt = s / steps;
          const px = a.x + dx * tt;
          const py = a.y + dy * tt;
          const ox = (Math.random() - 0.5) * jag;
          const oy = (Math.random() - 0.5) * jag;
          ctx.lineTo(px + ox, py + oy);
        }
        ctx.stroke();
        // Inner bright stroke
        ctx.globalAlpha = lifeRatio;
        ctx.strokeStyle = withAlpha(lighten(FX.frost, 0.7), 1);
        ctx.lineWidth = entity(2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** The size a number is typed at, before the pop curve and the crit bump. */
  private damageSize(d: DamageNumber): number {
    const ramp = d.kind === 'self' || d.kind === 'gold' ? DMG_SIZE_BY_TIER_SELF : DMG_SIZE_BY_TIER;
    return ramp[Math.max(0, Math.min(3, d.tier))];
  }

  /** What the number means, in colour. Tokens only — never a literal (§5.E). */
  private damageFill(d: DamageNumber): string {
    switch (d.kind) {
      case 'heal':
        return FX.nature;
      case 'gold':
        return FX.gold;
      case 'mana':
        return FX.mana;
      case 'self':
        // The tower is being hurt, which is the one thing this colour means.
        return FX.critical;
      default:
        if (d.isCrit || d.tier >= 3) return FX.gold;
        if (d.tier === 2) return mix(INK['050'], FX.gold, 0.45);
        return INK['050'];
    }
  }

  /**
   * Damage numbers, in **screen space** (UI plan §5.B).
   *
   * `d.x, d.y` is a world anchor fixed at emit time; the rise is accumulated in
   * CSS pixels by `EffectsManager` and subtracted here, after projecting. That
   * is what keeps a hit legible at any zoom — in world space the type was about
   * 12 CSS px at the desktop zoom, smaller than the smallest HUD label.
   *
   * Screen space is outside the camera shake translate, so these no longer
   * shake with the world. That is deliberate: jittering text is unreadable.
   * See `docs/effects-system.md`.
   */
  private drawDamageNumbers(ctx: CanvasRenderingContext2D, numbers: DamageNumber[]): void {
    if (numbers.length === 0) return;
    const cssW = this.camera.cssWidth;
    const cssH = this.camera.cssHeight;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const d of numbers) {
      const lifeRatio = 1 - d.age / d.life;
      if (lifeRatio <= 0) continue;
      const p = this.camera.worldToScreen(d.x, d.y);
      const sy = p.y - d.riseCss;
      if (p.x < -100 || p.x > cssW + 100 || sy < -60 || sy > cssH + 60) continue;
      const scale = popScale(d.age) * (d.isCrit ? 1.25 : 1);
      const size = this.damageSize(d) * (d.isCrit ? DMG_CRIT_SIZE_SCALE : 1) * scale;
      const alpha = Math.min(1, d.age / 0.06) * Math.min(1, lifeRatio * 1.6);
      const jitterX = (1 - lifeRatio) * (d.isCrit ? 0 : ((d.amount % 7) - 3) * 0.8);
      const sx = p.x + jitterX;
      const text = formatWithOptionalDecimal(d.amount);
      ctx.globalAlpha = alpha;
      ctx.font = `${d.isCrit || d.tier >= 2 ? '700' : '600'} ${size.toFixed(1)}px ${DISPLAY_FONT_STACK}`;
      if (d.isCrit) {
        // Chromatic edge: the same glyph twice, source-over, under the fill.
        ctx.globalAlpha = alpha * 0.38;
        ctx.fillStyle = FX.critical;
        ctx.fillText(text, sx - 1.5, sy);
        ctx.fillStyle = FX.frost;
        ctx.fillText(text, sx + 1.5, sy);
        ctx.globalAlpha = alpha;
      }
      ctx.lineWidth = size * 0.16;
      ctx.strokeStyle = withAlpha(INK['950'], 0.85);
      ctx.strokeText(text, sx, sy);
      ctx.fillStyle = this.damageFill(d);
      ctx.fillText(text, sx, sy);
    }
    ctx.restore();
  }

  /**
   * The wave banner, in screen space (CSS pixels).
   *
   * It is a heads-up display element, not a world object: it pins to the top
   * of the *viewport*, and its 22 px type stays 22 px whatever the zoom is.
   * Under the old single-space renderer both facts were accidents of the
   * canvas and the world being the same rectangle.
   */
  private drawWaveBanner(ctx: CanvasRenderingContext2D, snap: RenderSnapshot): void {
    const w = this.camera.cssWidth;
    if (snap.wave.intermission) {
      ctx.save();
      ctx.fillStyle = withAlpha('#000', 0.45);
      ctx.fillRect(0, 0, w, 50);
      ctx.fillStyle = INK['050'];
      ctx.font = '600 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const secs = Math.max(0, Math.ceil(snap.wave.intermissionTimer));
      const willAdvance = snap.wave.autoProgress || isBossWave(snap.wave.number);
      ctx.fillText(`Wave ${snap.wave.number} cleared — ${willAdvance ? 'next' : 'restarting'} wave in ${secs}s`, w / 2, 25);
      ctx.restore();
    } else if (isBossWave(snap.wave.number) && !snap.bossIntro) {
      // §5.D: while the intro is up it owns the boss's title; two of them
      // stacked read as a bug.
      const pulse = 0.5 + Math.sin(this.time * 4) * 0.15;
      ctx.save();
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, withAlpha(mix(FX.blood, INK['950'], 0.5), 0));
      grad.addColorStop(0.5, withAlpha(mix(FX.blood, INK['950'], 0.35), 0.55 + pulse * 0.2));
      grad.addColorStop(1, withAlpha(mix(FX.blood, INK['950'], 0.5), 0));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, 60);
      ctx.fillStyle = mix(FX.blood, INK['050'], 0.45);
      ctx.font = '800 26px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`BOSS WAVE ${snap.wave.number}`, w / 2, 30);
      ctx.fillStyle = withAlpha(lighten(FX.blood, 0.6), 0.4 + pulse * 0.3);
      ctx.font = '600 13px sans-serif';
      ctx.fillText('A powerful enemy approaches', w / 2, 50);
      ctx.restore();
    }
  }

  /**
   * The boss intro (UI plan §5.D), in screen space.
   *
   * Everything about the timeline — the phase, the easing, the wall clock —
   * was resolved in `Game`; this paints one number. Under reduced motion the
   * bars are dropped and only the name plate is drawn: the letterbox is the
   * moving part, the name is the information.
   */
  private drawBossIntro(ctx: CanvasRenderingContext2D, intro: BossIntroView | null): void {
    if (!intro || intro.progress <= 0) return;
    const w = this.camera.cssWidth;
    const h = this.camera.cssHeight;
    const p = Math.max(0, Math.min(1, intro.progress));
    ctx.save();
    if (!this.reducedMotion) {
      const barH = h * 0.10 * p;
      ctx.fillStyle = withAlpha(INK['950'], 0.92);
      ctx.fillRect(0, 0, w, barH);
      ctx.fillRect(0, h - barH, w, barH);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = p;
    ctx.translate(w / 2, h * 0.42);
    // The name settles rather than arriving: 1.06 → 1.00 across the extension.
    ctx.scale(1.06 - 0.06 * p, 1.06 - 0.06 * p);
    ctx.fillStyle = mix(FX.blood, INK['050'], 0.5);
    ctx.font = `800 36px ${DISPLAY_FONT_STACK}`;
    ctx.fillText(intro.name, 0, 0);
    if (intro.pattern) {
      // No pattern icon: there is no cheap icon path in the canvas renderer
      // (the sprite sheet is DOM-side), so this ships as text — §5.D allows it.
      ctx.globalAlpha = 1;
      ctx.fillStyle = withAlpha(INK['100'], 0.75 * p);
      ctx.font = `600 15px ${DISPLAY_FONT_STACK}`;
      ctx.fillText(intro.pattern, 0, 30);
    }
    ctx.restore();
  }
}
