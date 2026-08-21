import type { RenderSnapshot, Enemy, HostileShot, Projectile, Particle, DamageNumber, Shockwave, Mine, AuraType, LootOrb } from '../types';
import { LOOT_ORB_COLORS, LOOT_TUNING, type LootOrbKind } from '../data/loot';
import { ARENA, ARENA_RANGE_CAP, ENTITY_SCALE, entity, world } from '../data/arena';
import type { Camera } from './Camera';
import { TOWER_VISUAL } from '../data/tower';
import { CORE_BY_ID, DEFAULT_CORE, isCoreId, type CoreId } from '../data/cores';
import { FX, INK, withAlpha } from '../data/palette';
import { BOSS_ENCOUNTER, ENEMY_BEHAVIOR, ENEMY_DEFS } from '../data/enemies';
import type { EnemyDef, EnemyShape } from '../data/enemies';
import { isBossWave } from '../data/formulas';
import { formatInt } from '../utils/bigNumber';
import { ELITE_AURA_COLORS, AURA_RADIUS } from '../systems/EnemyManager';

/** How much larger an elite renders than a normal enemy of the same type. */
const ELITE_RADIUS_SCALE = 1.25;

/** Frame step every animation in this file advances on. See `Renderer.time`. */
const FRAME_DT = 1 / 60;

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
/** Body colour of a boss below its enrage threshold. */
const ENRAGED_BOSS_COLOR = '#ff2020';
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

/** Solid crown colours, one per aura (the aura fills are translucent). */
const ELITE_CROWN_COLORS: Record<AuraType, string> = {
  haste: '#3cb4ff',
  thorns: '#ff6420',
  greed: '#ffd700',
  vitality: '#3edc64',
  retribution: '#b432dc',
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
  private magicProjectileSprite: HTMLCanvasElement | null = null;
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
   * Tower position from the frame currently being drawn.
   *
   * Cached at the top of `draw` so the boss siphon beam has somewhere to point.
   * Read-only presentation state — the enemy loop must not reach back into the
   * simulation for it.
   */
  private towerX = 0;
  private towerY = 0;

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

  /** Drop the baked background. Called by `Game` when the camera resizes. */
  invalidateBackground(): void {
    this.bgCanvas = null;
  }

  draw(snapshot: RenderSnapshot, options?: { screenFlash?: number; towerFlash?: number; wallFlash?: number; shieldFlash?: number; vignette?: number; chainPaths?: { points: { x: number; y: number }[]; age: number; life: number }[] }): void {
    this.time += FRAME_DT;
    const ctx = this.ctx;
    const camera = this.camera;
    this.towerX = snapshot.tower.x;
    this.towerY = snapshot.tower.y;
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
    this.drawSpawnPortals(ctx);
    this.drawParticles(ctx, snapshot.particles, 'behind');
    this.drawShockwaves(ctx, snapshot.shockwaves);
    this.drawAimLine(ctx, snapshot);
    this.drawEnemies(ctx, snapshot.enemies);
    this.drawProjectiles(ctx, snapshot.projectiles);
    this.drawHostileShots(ctx, snapshot.hostileShots);
    this.drawParticles(ctx, snapshot.particles, 'front');
    this.drawOrbs(ctx, snapshot.orbs);
    this.drawPlacement(ctx, snapshot.placement);
    this.drawChargeRing(ctx, snapshot.charge);
    this.drawChainLightning(ctx, options?.chainPaths);
    this.drawDamageNumbers(ctx, snapshot.damageNumbers);
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
    camera.applyScreen(ctx);
    this.drawWaveBanner(ctx, snapshot);

    const flash = options?.screenFlash ?? 0;
    if (flash > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, flash / 0.15)})`;
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
    let highest = this.lastProjectileId;
    const list = snap.projectiles;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      if (p.id <= this.lastProjectileId) break;
      if (p.id > highest) highest = p.id;
      // Anything that started at the tower came out of the barrel. A homing
      // shot that has already turned has not: it is only new once.
      if (fired === null && Math.hypot(p.x - t.x, p.y - t.y) < TOWER_VISUAL.bodyRadius * 3) {
        fired = p;
      }
    }
    if (this.lastProjectileId < 0) {
      // First frame: adopt the id watermark without firing, so a save load does
      // not recoil the barrel for shots taken before the page existed.
      this.lastProjectileId = highest;
      fired = null;
    } else {
      this.lastProjectileId = highest;
    }

    if (fired) {
      this.turretAngle = Math.atan2(fired.vy, fired.vx);
      this.recoil = 1;
      this.muzzle = 1;
    } else if (snap.aimLine) {
      // Manual aim: the barrel follows the cursor even between shots, because
      // holding is a promise about where the next shot goes.
      this.chaseTurret(Math.atan2(snap.aimLine.y - t.y, snap.aimLine.x - t.x));
    }

    if (this.recoil > 0) this.recoil = Math.max(0, this.recoil - FRAME_DT / TOWER_VISUAL.recoilTime);
    if (this.muzzle > 0) this.muzzle = Math.max(0, this.muzzle - FRAME_DT / TOWER_VISUAL.muzzleTime);
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
    this.bakeTerrain(bg, w, h, scale, rand);
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
   * two-stop `#1c2028 → #0c0e12` gradient this replaces was the entire
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
    this.blit(ctx, shadow, t.x, t.y);
    this.blit(ctx, this.part('tower-plinth', TOWER_VISUAL.plinthRadius * 2.3, (g) => {
      this.paintPlinth(g);
    }), t.x, t.y);
  }

  /** Stone footing: a kerb of set blocks, a lit bevel and an occlusion ring. */
  private paintPlinth(g: CanvasRenderingContext2D): void {
    const R = TOWER_VISUAL.plinthRadius;
    const rand = mulberry32(0x91af7);
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
      const lit = 0.5 + 0.5 * Math.cos(mid - TOWER_VISUAL.lightAngle);
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

    // Bevel highlight on the lit side, and the occlusion ring where the drum
    // meets the footing — the two cheapest cues that this is a solid object.
    g.strokeStyle = withAlpha(TOWER_VISUAL.rim, 0.22);
    g.lineWidth = entity(2);
    g.beginPath();
    g.arc(0, 0, R * 0.9, TOWER_VISUAL.lightAngle - 1.15, TOWER_VISUAL.lightAngle + 1.15);
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
    const thickness = entity(11);
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
    const size = Math.max(thickness * 2, 2 * (R + thickness) * Math.sin(span / 2)) + entity(8);
    return this.part(`wall|${state}`, size, (g) => {
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

    this.blit(ctx, this.part(`tower-drum|${tier}`, (TOWER_VISUAL.bodyRadius + entity(24)) * 2, (g) => {
      this.paintDrum(g, tier);
    }), t.x, t.y);

    // Tier 3: a slow arcane ring, drawn as a rotated blit of one cached sprite.
    if (tier >= 3) {
      const ring = this.part(`tower-ring|${core}`, (TOWER_VISUAL.bodyRadius + entity(20)) * 2, (g) => {
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

  /** Banded masonry, battlements, and whatever the tower's level has earned. */
  private paintDrum(g: CanvasRenderingContext2D, tier: number): void {
    const R = TOWER_VISUAL.bodyRadius;
    const light = TOWER_VISUAL.lightAngle;
    const rand = mulberry32(0x2b19f + tier);

    g.fillStyle = TOWER_VISUAL.stoneDark;
    g.beginPath();
    g.arc(0, 0, R, 0, Math.PI * 2);
    g.fill();

    // Two courses of masonry, laid with the joints offset — the second course
    // only exists from tier 1, which is the first thing levelling buys you.
    const courses: Array<[number, number, number]> = [[R * 0.74, R, 18]];
    if (tier >= 1) courses.push([R * 0.44, R * 0.7, 12]);
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

    // Battlements. More merlons is the tier-1 silhouette change you can read
    // from across the arena.
    const merlons = tier >= 1 ? 12 : 8;
    const mStep = (Math.PI * 2) / merlons;
    for (let i = 0; i < merlons; i++) {
      const a0 = i * mStep + mStep * 0.2;
      const a1 = (i + 1) * mStep - mStep * 0.2;
      const mid = (a0 + a1) / 2;
      const lit = 0.5 + 0.5 * Math.cos(mid - light);
      g.beginPath();
      g.arc(0, 0, R + entity(5), a0, a1);
      g.arc(0, 0, R - entity(1), a1, a0, true);
      g.closePath();
      g.fillStyle = TOWER_VISUAL.stoneMid;
      g.fill();
      g.fillStyle = withAlpha(TOWER_VISUAL.rim, 0.18 * lit);
      g.fill();
      g.fillStyle = withAlpha(INK['950'], 0.45 * (1 - lit));
      g.fill();
    }

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
        g.restore();
      }
    }

    // Rim light along the lit edge. Segmented rather than one long stroke, so
    // it falls off toward the terminator instead of ending as a hard hoop —
    // the same trick the range ring's sweep uses, and free at bake time.
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
   * The turret: it points where the tower is shooting, kicks back when it does,
   * and flashes at the muzzle (§3.3).
   *
   * Before this, nothing anywhere on the tower reacted to firing — a maxed
   * tower emptying six shots a second looked exactly like an idle one. The
   * heading is read off the projectiles, so the barrel is aimed by the same
   * fact that aimed the shot rather than by a copy of the targeting rules.
   */
  private drawTurret(ctx: CanvasRenderingContext2D, snap: RenderSnapshot, tier: number, core: CoreId): void {
    const t = snap.tower;
    const tint = CORE_BY_ID[core].color;
    const len = TOWER_VISUAL.turretLength;
    const sprite = this.part(`turret|${tier}|${core}`, (len + entity(12)) * 2, (g) => {
      const w = TOWER_VISUAL.turretWidth;
      const base = entity(3);
      // Underside first, so the barrel sits on its own shadow.
      g.fillStyle = withAlpha(INK['950'], 0.55);
      g.beginPath();
      g.moveTo(base, -w * 0.5 + entity(2));
      g.lineTo(len, -w * 0.34 + entity(2));
      g.lineTo(len, w * 0.34 + entity(2.5));
      g.lineTo(base, w * 0.5 + entity(2.5));
      g.closePath();
      g.fill();

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

      // Amber banding, and a core-tinted collar at the muzzle so the shot's
      // colour is announced before it leaves.
      g.fillStyle = withAlpha(TOWER_VISUAL.rim, 0.55);
      for (const at of tier >= 2 ? [0.32, 0.58, 0.8] : [0.4, 0.72]) {
        const x = base + (len - base) * at;
        g.fillRect(x, -w * 0.5, entity(2.4), w);
      }
      g.fillStyle = withAlpha(tint, 0.85);
      g.fillRect(len - entity(3), -w * 0.4, entity(3), w * 0.8);

      // Tier 2+: side vanes, so a levelled turret has a heavier silhouette.
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
    });

    const back = TOWER_VISUAL.recoilDistance * easeOutCubic(this.recoil);
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(this.turretAngle);
    ctx.translate(-back, 0);
    ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2);

    if (this.muzzle > 0) {
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
      const s = 0.65 + (1 - this.muzzle) * 0.6;
      ctx.drawImage(flash, -flash.width * s / 2, -flash.height * s / 2, flash.width * s, flash.height * s);
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
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(0, 0, glowR, 0, Math.PI * 2);
      g.fill();

      g.fillStyle = colors.core;
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(255, 255, 255, 0.75)';
      g.lineWidth = entity(1.5);
      g.stroke();

      // A highlight, plus a glyph so the three kinds are told apart by shape
      // as well as by colour.
      g.fillStyle = 'rgba(255, 255, 255, 0.55)';
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
   * The disc the next click will drop a targeted ability on (plan §4.3).
   *
   * Deliberately loud — a dashed ring plus a crosshair — because placement
   * mode changes what a click means, and an input state the player cannot see
   * is an input state they will fight.
   */
  private drawPlacement(ctx: CanvasRenderingContext2D, placement: RenderSnapshot['placement']): void {
    if (!placement) return;
    const { x, y, radius } = placement;
    ctx.save();
    ctx.strokeStyle = 'rgba(120, 220, 255, 0.85)';
    ctx.lineWidth = entity(2);
    ctx.setLineDash([entity(8), entity(6)]);
    ctx.lineDashOffset = -this.time * 30;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(120, 220, 255, 0.10)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(220, 245, 255, 0.9)';
    ctx.lineWidth = entity(1.5);
    ctx.beginPath();
    ctx.moveTo(x - 10, y);
    ctx.lineTo(x + 10, y);
    ctx.moveTo(x, y - 10);
    ctx.lineTo(x, y + 10);
    ctx.stroke();
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
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();

    if (cooldown > 0) {
      ctx.strokeStyle = 'rgba(150, 170, 190, 0.5)';
      ctx.beginPath();
      ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * cooldown);
      ctx.stroke();
      ctx.restore();
      return;
    }

    const pulse = ready ? 1 + Math.sin(this.time * 12) * 0.12 : 1;
    ctx.strokeStyle = ready ? 'rgba(140, 230, 255, 0.95)' : 'rgba(110, 190, 255, 0.7)';
    ctx.lineWidth = ready ? 4 : 3;
    ctx.beginPath();
    ctx.arc(x, y, r * pulse, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.stroke();
    if (ready) {
      ctx.fillStyle = 'rgba(140, 230, 255, 0.16)';
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
      ctx.fillStyle = '#cc4422';
      ctx.beginPath();
      ctx.arc(m.x, m.y, 6 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ff8844';
      ctx.lineWidth = entity(1.5);
      ctx.beginPath();
      ctx.arc(m.x, m.y, 6 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 60, 20, 0.25)';
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
    const px = Math.max(2, Math.ceil(size));
    const c = document.createElement('canvas');
    c.width = px;
    c.height = px;
    const g = c.getContext('2d')!;
    g.translate(px / 2, px / 2);
    paint(g);
    return c;
  }

  /** Radius an enemy of this type renders at, elite scaling included. */
  private enemyDrawRadius(enemy: Enemy): number {
    return ENEMY_DEFS[enemy.type].radius * (enemy.elite ? ELITE_RADIUS_SCALE : 1);
  }

  private getEnemySprite(enemy: Enemy): HTMLCanvasElement {
    const enraged = enemy.type === 'boss' && enemy.enraged === true;
    // A burrower reads completely differently above and below ground, so the
    // two are separate cache entries rather than one sprite plus a live tint.
    const buried = enemy.burrowed === true;
    const key = `${enemy.type}|${enemy.elite ? 1 : 0}|${enraged ? 1 : 0}|${buried ? 1 : 0}`;
    const cached = this.enemySprites.get(key);
    if (cached) return cached;
    const def = ENEMY_DEFS[enemy.type];
    const r = this.enemyDrawRadius(enemy);
    const sprite = this.makeSprite((r + SPRITE_PADDING) * 2, (g) => {
      this.paintEnemyBody(g, enemy.type, def, r, enraged, buried);
    });
    this.enemySprites.set(key, sprite);
    return sprite;
  }

  /**
   * Paint an enemy body centred on the origin: fill, outline and whatever
   * static decoration the type carries. The winged type's flapping wings are
   * deliberately absent — they are animated, so they are drawn live.
   */
  private paintEnemyBody(
    ctx: CanvasRenderingContext2D,
    type: Enemy['type'],
    def: EnemyDef,
    r: number,
    enraged: boolean,
    buried: boolean = false,
  ): void {
    // Boss enrage colour shift: the body turns red below 50% HP. The check is
    // hoisted out of the shape switch on purpose — it used to live only in the
    // `diamond` branch, and since no boss uses that shape, an enraged boss
    // never actually changed colour. Applying it per body colour rather than
    // per shape means it fires whatever shape a boss is given later.
    const bodyColor = type === 'boss' && enraged ? ENRAGED_BOSS_COLOR : def.color;
    switch (def.shape) {
      case 'diamond':
        ctx.fillStyle = bodyColor;
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(r, 0);
        ctx.lineTo(0, r);
        ctx.lineTo(-r, 0);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = def.borderColor;
        ctx.lineWidth = entity(2);
        ctx.stroke();
        // Splitter gets a small inner core dot to make it stand out
        if (type === 'splitter') {
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          ctx.beginPath();
          ctx.arc(0, 0, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        if (def.glyph) {
          ctx.fillStyle = def.borderColor;
          ctx.font = `bold ${Math.round(r * 0.95)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(def.glyph, 0, 1);
        }
        break;
      case 'winged':
        ctx.fillStyle = bodyColor;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = def.borderColor;
        ctx.lineWidth = entity(2);
        ctx.stroke();
        break;
      // Siege: a blunt, flat-sided chassis with a barrel — it reads as a
      // machine parked at range rather than something running at you.
      case 'square': {
        ctx.fillStyle = bodyColor;
        ctx.fillRect(-r, -r * 0.85, r * 2, r * 1.7);
        ctx.strokeStyle = def.borderColor;
        ctx.lineWidth = entity(2.5);
        ctx.strokeRect(-r, -r * 0.85, r * 2, r * 1.7);
        ctx.fillStyle = def.borderColor;
        ctx.fillRect(-r * 0.25, -r * 1.5, r * 0.5, r * 0.8);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(-r * 0.75, -r * 0.25, r * 1.5, r * 0.5);
        break;
      }
      // Warden: a hexagon, the same shape as the ward it projects, so the
      // shield rings on its allies point straight back at the source.
      case 'hex': {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
          const px = Math.cos(a) * r;
          const py = Math.sin(a) * r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = bodyColor;
        ctx.fill();
        ctx.strokeStyle = def.borderColor;
        ctx.lineWidth = entity(2.5);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = entity(1.5);
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
          const px = Math.cos(a) * (r * 0.5);
          const py = Math.sin(a) * (r * 0.5);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
        break;
      }
      // Burrower: a low earth mound while underground, a clawed dome once it
      // is up. Two different silhouettes on purpose — the whole point of the
      // type is that you can tell at a glance whether it can be shot.
      case 'mound': {
        if (buried) {
          ctx.fillStyle = '#4a3a22';
          ctx.beginPath();
          ctx.ellipse(0, r * 0.25, r * 1.15, r * 0.6, 0, Math.PI, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(216, 181, 120, 0.5)';
          ctx.lineWidth = entity(2);
          ctx.stroke();
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.beginPath();
          ctx.ellipse(0, r * 0.25, r * 0.5, r * 0.2, 0, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        ctx.fillStyle = bodyColor;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = def.borderColor;
        ctx.lineWidth = entity(2.5);
        ctx.stroke();
        ctx.strokeStyle = def.borderColor;
        ctx.lineWidth = entity(2);
        for (const dir of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(dir * r * 0.35, -r * 0.15);
          ctx.lineTo(dir * r * 0.95, -r * 0.75);
          ctx.stroke();
        }
        break;
      }
      case 'circle': {
        ctx.fillStyle = bodyColor;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = def.borderColor;
        ctx.lineWidth = type === 'tank' ? 4 : type === 'boss' ? 3 : 2;
        ctx.stroke();
        if (def.glyph) {
          ctx.fillStyle = '#fff';
          ctx.font = `bold ${r}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(def.glyph, 0, 1);
        }
        if (type === 'tank') {
          ctx.strokeStyle = 'rgba(255,255,255,0.18)';
          ctx.lineWidth = entity(1);
          ctx.beginPath();
          ctx.arc(0, 0, r - 4, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      }
      default: {
        // Closed union (cross-cutting rule 3): a new shape has to be drawn
        // before it can be given to an enemy.
        const exhaustive: never = def.shape;
        return exhaustive;
      }
    }
  }

  /**
   * Ground shadow, keyed by radius so the eight enemy types share four or five
   * sprites between them.
   */
  private getShadowSprite(r: number): HTMLCanvasElement {
    const key = r.toFixed(1);
    const cached = this.shadowSprites.get(key);
    if (cached) return cached;
    const sprite = this.makeSprite(r * 2, (g) => {
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.9);
      grad.addColorStop(0, 'rgba(0,0,0,0.35)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.ellipse(0, 0, r * 0.85, r * 0.3, 0, 0, Math.PI * 2);
      g.fill();
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
    for (const e of enemies) {
      if (!e.alive) continue;
      this.drawAfterImage(ctx, e);
      this.drawEnemyShadow(ctx, e);
      this.drawEnemy(ctx, e);
    }
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
    ctx.strokeStyle = `rgba(90, 220, 240, ${pulse})`;
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
    if (enemy.type === 'flying') return;
    const r = ENEMY_DEFS[enemy.type].radius;
    const sprite = this.getShadowSprite(r);
    const half = sprite.width / 2;
    ctx.drawImage(sprite, enemy.x - half, enemy.y + r * 0.6 - half);
  }

  private drawEnemy(ctx: CanvasRenderingContext2D, enemy: Enemy): void {
    const r = this.enemyDrawRadius(enemy);
    let bob = 0;
    if (enemy.type === 'flying') {
      bob = Math.sin(this.time * 5 + enemy.id * 0.7) * 3;
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

    // Body: one blit of a cached sprite. The pulse is a transform around the
    // enemy's centre rather than a repaint at a different size.
    let pulse = 1;
    if (enemy.type === 'boss') pulse = 1 + Math.sin(this.time * 4) * 0.08;
    else if (enemy.type === 'splitter') pulse = 1 + Math.sin(this.time * 3 + enemy.id) * 0.05;

    const sprite = this.getEnemySprite(enemy);
    const half = sprite.width / 2;
    ctx.save();
    ctx.translate(enemy.x, enemy.y + bob);
    if (pulse !== 1) ctx.scale(pulse, pulse);
    ctx.drawImage(sprite, -half, -half);
    ctx.restore();

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
      ctx.strokeStyle = `rgba(180, 50, 220, ${p})`;
      ctx.lineWidth = entity(3);
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y + bob, r + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    this.drawEnemyHpBar(ctx, enemy, r, bob);
  }

  private drawWings(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number, bob: number): void {
    const def = ENEMY_DEFS[enemy.type];
    const wingFlap = Math.sin(this.time * 12 + enemy.id) * 0.4;
    ctx.save();
    ctx.fillStyle = def.borderColor;
    for (const dir of [-1, 1]) {
      ctx.save();
      ctx.translate(enemy.x, enemy.y + bob);
      ctx.rotate(wingFlap * dir);
      ctx.beginPath();
      ctx.moveTo(r * dir, 0);
      ctx.lineTo((r + 9) * dir, -6);
      ctx.lineTo((r + 4) * dir, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  private drawHealerAura(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number): void {
    const pulse = 1 + Math.sin(this.time * 2.5 + enemy.id) * 0.12;
    const sprite = this.getAuraSprite(`healer|${r}`, r * 2.0, r * 0.7, [
      [0, 'rgba(80, 220, 120, 0.22)'],
      [0.6, 'rgba(39, 174, 96, 0.08)'],
      [1, 'rgba(0,0,0,0)'],
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
      [1, 'rgba(0,0,0,0)'],
    ]);
    this.drawAuraSprite(ctx, sprite, enemy.x, enemy.y, pulse);
  }

  private drawEliteCrown(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number, bob: number): void {
    const color = ELITE_CROWN_COLORS[enemy.aura!] ?? '#fff';
    const size = Math.max(10, r * 0.7);
    const key = `${color}|${size.toFixed(1)}`;
    let sprite = this.crownSprites.get(key);
    if (!sprite) {
      // The glow pass is a second fillText under a shadow blur, which is one
      // of the most expensive things a 2D context does; baking it means an
      // elite costs a blit rather than two blurred glyph rasterisations.
      sprite = this.makeSprite(size * 2 + entity(16), (g) => {
        g.fillStyle = color;
        g.font = `bold ${size}px sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('♛', 0, 0);
        g.shadowColor = color;
        g.shadowBlur = 6;
        g.fillText('♛', 0, 0);
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
      ctx.fillStyle = 'rgba(93, 173, 226, 0.65)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(180, 220, 255, 0.9)';
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
    const innerColor = enraged ? 'rgba(255, 80, 80, 0.55)' : 'rgba(255, 60, 60, 0.28)';
    const midColor = enraged ? 'rgba(220, 30, 30, 0.20)' : 'rgba(160, 0, 0, 0.10)';
    const sprite = this.getAuraSprite(`boss|${enraged ? 1 : 0}|${r}`, r * 2.4, r * 0.7, [
      [0, innerColor],
      [0.6, midColor],
      [1, 'rgba(0,0,0,0)'],
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
    ctx.strokeStyle = `rgba(90, 220, 240, ${0.35 + ratio * 0.45})`;
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
    ctx.strokeStyle = 'rgba(240, 190, 110, 0.28)';
    ctx.lineWidth = entity(1.5);
    ctx.setLineDash([entity(7), entity(9)]);
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, r + 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // Reload arc: a full sweep means the next shell is about to leave.
    const reload = ENEMY_BEHAVIOR.siegeReload;
    const remaining = Math.max(0, Math.min(reload, enemy.siegeCooldown ?? reload));
    const progress = 1 - remaining / reload;
    if (progress > 0) {
      ctx.strokeStyle = 'rgba(255, 170, 60, 0.85)';
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
      ctx.strokeStyle = `rgba(255, 240, 190, ${0.35 + t * 0.5})`;
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
      ctx.strokeStyle = 'rgba(120, 210, 255, 0.85)';
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
        ? `rgba(140, 220, 255, ${0.5 + progress * 0.4})`
        : `rgba(255, 110, 50, ${0.45 + progress * 0.5})`;
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
      ctx.strokeStyle = `rgba(150, 110, 255, ${pulse})`;
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
    ctx.fillStyle = 'rgba(255, 220, 100, 0.9)';
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
        [0, 'rgba(160, 130, 80, 0.30)'],
        [0.65, 'rgba(120, 95, 55, 0.12)'],
        [1, 'rgba(0,0,0,0)'],
      ]);
      const pulse = 1 + Math.sin(this.time * 6 + enemy.id) * 0.14;
      this.drawAuraSprite(ctx, sprite, enemy.x, enemy.y + r * 0.3, pulse);
      return;
    }
    const surfacing = enemy.surfacing ?? 0;
    if (surfacing <= 0) return;
    const progress = 1 - surfacing / ENEMY_BEHAVIOR.burrowTelegraph;
    ctx.save();
    ctx.strokeStyle = `rgba(230, 180, 100, ${0.75 * (1 - progress)})`;
    ctx.lineWidth = entity(4);
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, r + 6 + progress * 42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** The coin a loaded thief carries. Cached — it is static. */
  private getCoinSprite(): HTMLCanvasElement {
    const cached = this.enemySprites.get('#coin');
    if (cached) return cached;
    const sprite = this.makeSprite(entity(20), (g) => {
      g.scale(ENTITY_SCALE, ENTITY_SCALE);
      g.fillStyle = '#ffd24a';
      g.beginPath();
      g.arc(0, 0, 7, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#7a5a00';
      g.lineWidth = 1.5;
      g.stroke();
      g.fillStyle = '#7a5a00';
      g.font = 'bold 9px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('$', 0, 1);
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
      ctx.strokeStyle = `rgba(255, 120, 50, ${0.25 + progress * 0.5})`;
      ctx.lineWidth = entity(2);
      ctx.beginPath();
      ctx.arc(landX, landY, 6 + (1 - progress) * 26, 0, Math.PI * 2);
      ctx.stroke();

      // Ground shadow directly under the shell.
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, 5, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ff8a3c';
      ctx.beginPath();
      ctx.arc(s.x, s.y - lift, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#5a2a00';
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
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x, y, barW, barH);
    ctx.fillStyle = ratio > 0.5 ? '#3ec46d' : ratio > 0.25 ? '#e8a93b' : '#d04848';
    ctx.fillRect(x, y, barW * ratio, barH);
    if (enemy.type === 'boss') {
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = entity(1);
      ctx.strokeRect(x - 0.5, y - 0.5, barW + 1, barH + 1);
    }
  }

  private drawProjectiles(ctx: CanvasRenderingContext2D, projectiles: Projectile[]): void {
    for (const p of projectiles) {
      if (!p.alive) continue;
      if (p.damageType === 'magic') {
        if (!this.magicProjectileSprite) {
          this.magicProjectileSprite = this.makeSprite(entity(16), (g) => {
            g.scale(ENTITY_SCALE, ENTITY_SCALE);
            const grad = g.createRadialGradient(0, 0, 0, 0, 0, 8);
            grad.addColorStop(0, '#e0b3ff');
            grad.addColorStop(1, 'rgba(120, 60, 200, 0)');
            g.fillStyle = grad;
            g.beginPath();
            g.arc(0, 0, 8, 0, Math.PI * 2);
            g.fill();
            g.fillStyle = '#9b59ff';
            g.beginPath();
            g.arc(0, 0, 3, 0, Math.PI * 2);
            g.fill();
          });
        }
        ctx.drawImage(this.magicProjectileSprite, p.x - entity(8), p.y - entity(8));
      } else {
        const angle = Math.atan2(p.vy, p.vx);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(angle);
        ctx.scale(ENTITY_SCALE, ENTITY_SCALE);
        ctx.fillStyle = '#f7d774';
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.lineTo(-6, 4);
        ctx.lineTo(-6, -4);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#7a5a00';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  /**
   * Particles.
   *
   * `p.size` comes from `EffectsManager`, which Part 5 owns and which has not
   * been through the `ENTITY_SCALE` pass yet — so they are scaled here at the
   * draw call instead. When Part 5 moves the emitter constants onto the arena
   * scales, this multiply comes back out.
   */
  private drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[], layer: 'behind' | 'front'): void {
    ctx.save();
    for (const p of particles) {
      const lifeRatio = 1 - p.age / p.life;
      if (lifeRatio <= 0) continue;
      if (layer === 'front' && p.color.startsWith('rgba(255, 255, 255')) continue;
      ctx.globalAlpha = lifeRatio;
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
        ctx.strokeStyle = 'rgba(120, 160, 255, 0.85)';
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
        ctx.strokeStyle = 'rgba(235, 245, 255, 1)';
        ctx.lineWidth = entity(2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawDamageNumbers(ctx: CanvasRenderingContext2D, numbers: DamageNumber[]): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const d of numbers) {
      const lifeRatio = 1 - d.age / d.life;
      if (lifeRatio <= 0) continue;
      const fadeIn = Math.min(1, d.age / 0.08);
      const alpha = Math.min(lifeRatio * 1.4, 1) * fadeIn;
      ctx.globalAlpha = alpha;
      const size = entity(d.isCrit ? 22 : 15);
      ctx.font = `${d.isCrit ? '700 ' : '600 '}${size.toFixed(1)}px sans-serif`;
      ctx.lineWidth = entity(d.isCrit ? 3.5 : 2.5);
      ctx.strokeStyle = d.isHeal ? '#0a3a1a' : '#3a0000';
      ctx.fillStyle = d.isHeal ? '#3edc81' : d.isCrit ? '#ffe27a' : '#ffffff';
      const jitterX = (1 - lifeRatio) * (d.isCrit ? 0 : ((d.amount % 7) - 3) * 0.6);
      ctx.strokeText(formatInt(d.amount), d.x + jitterX, d.y);
      ctx.fillText(formatInt(d.amount), d.x + jitterX, d.y);
      if (d.isCrit) {
        ctx.globalAlpha = alpha * 0.7;
        ctx.font = `800 ${(size + entity(4)).toFixed(1)}px sans-serif`;
        ctx.fillStyle = '#ff5050';
        ctx.fillText('!', d.x + jitterX - size * 0.9, d.y - entity(2));
      }
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
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, w, 50);
      ctx.fillStyle = '#f0f0f0';
      ctx.font = '600 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const secs = Math.max(0, Math.ceil(snap.wave.intermissionTimer));
      const willAdvance = snap.wave.autoProgress || isBossWave(snap.wave.number);
      ctx.fillText(`Wave ${snap.wave.number} cleared — ${willAdvance ? 'next' : 'restarting'} wave in ${secs}s`, w / 2, 25);
      ctx.restore();
    } else if (isBossWave(snap.wave.number)) {
      const pulse = 0.5 + Math.sin(this.time * 4) * 0.15;
      ctx.save();
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, 'rgba(120,0,0,0.0)');
      grad.addColorStop(0.5, `rgba(160, 20, 20, ${0.55 + pulse * 0.2})`);
      grad.addColorStop(1, 'rgba(120,0,0,0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, 60);
      ctx.fillStyle = '#ff8a8a';
      ctx.font = '800 26px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`BOSS WAVE ${snap.wave.number}`, w / 2, 30);
      ctx.fillStyle = `rgba(255, 200, 200, ${0.4 + pulse * 0.3})`;
      ctx.font = '600 13px sans-serif';
      ctx.fillText('A powerful enemy approaches', w / 2, 50);
      ctx.restore();
    }
  }
}
