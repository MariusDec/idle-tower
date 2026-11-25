import { ENEMY_BY_ID } from '../../content/enemies';
import type { AuraId, EnemyDef, EnemyId } from '../../content/types';
import type { Oval } from '../../content/arena';
import type { Enemy } from '../../sim/state';
import { FX, INK, mix, withAlpha, type FxColorName } from '../palette';
import { emergence } from './arena';
import { context2dOptions } from '../canvasMode';
import {
  applySquash, armPop, armSquish, crowdDamping, gait, hitSquish, popFromRise, popFromTime,
  type BodyMotion, type GaitStyle, type MotionLevel,
} from '../motion';
import type { QualityTier } from '../quality';

/**
 * Enemy bodies, salvaged from the legacy renderer's `paintEnemyBody`: a base
 * coat, a two-tone shade toward one key light, a contact shadow, a per-type
 * detail pass that says *what this is*, a rim light and an outline.
 *
 * Each type is baked once per view scale into an offscreen canvas at device
 * resolution; a frame pays one `drawImage` per enemy.
 */

/** The one key light, up and slightly left (legacy `TOWER_VISUAL.lightAngle`). */
export const LIGHT_ANGLE = -Math.PI * 0.62;

/** Least a detail stroke may measure, in device pixels, before it dissolves. */
const MIN_STROKE_PX = 1.25;

/**
 * Per-type gait (plans/enemy-animation.md §4.1): how it moves, its bob
 * frequency (rad/s, as `sin(time·freq)`) and amplitude (world units).
 */
export const GAIT: Record<EnemyId, { style: GaitStyle; freq: number; bob: number }> = {
  grunt: { style: 'hop', freq: 7, bob: 1.2 },
  runner: { style: 'skitter', freq: 15, bob: 2 },
  brute: { style: 'waddle', freq: 3.4, bob: 0.8 },
  splitter: { style: 'hop', freq: 4.5, bob: 1.6 },
  spitter: { style: 'hop', freq: 5, bob: 1 },
  mender: { style: 'float', freq: 5.5, bob: 1.4 },
  shieldbearer: { style: 'waddle', freq: 4, bob: 0.8 },
  burrower: { style: 'slither', freq: 9, bob: 1.4 },
  shardling: { style: 'skitter', freq: 12, bob: 1.6 },
  bomber: { style: 'hop', freq: 6, bob: 1.8 },
  blinker: { style: 'float', freq: 3, bob: 2.4 },
  'siege-engine': { style: 'waddle', freq: 2.4, bob: 0.6 },
  phantom: { style: 'float', freq: 2, bob: 3 },
  leech: { style: 'slither', freq: 14, bob: 1.2 },
  summoner: { style: 'float', freq: 2.6, bob: 1.8 },
  imp: { style: 'hop', freq: 16, bob: 1.4 },
  harbinger: { style: 'float', freq: 1.6, bob: 2 },
  chorus: { style: 'hop', freq: 3.2, bob: 2.2 },
  husk: { style: 'waddle', freq: 3.8, bob: 0.8 },
  ram: { style: 'hop', freq: 6, bob: 1.2 },
  wardstone: { style: 'float', freq: 1.4, bob: 0.6 },
  maw: { style: 'waddle', freq: 4, bob: 1.6 },
  lurker: { style: 'slither', freq: 10, bob: 1 },
  tidecaller: { style: 'float', freq: 1.8, bob: 2.2 },
  // The Wake's (plans/late-game/12 §5).
  ringer: { style: 'hop', freq: 6, bob: 1.2 },
  sleepwalker: { style: 'float', freq: 1.4, bob: 1.6 },
  straggler: { style: 'skitter', freq: 10, bob: 1.4 },
  satellite: { style: 'float', freq: 3, bob: 1.2 },
  comet: { style: 'skitter', freq: 18, bob: 1 },
  moon: { style: 'float', freq: 1.2, bob: 1 },
  skater: { style: 'slither', freq: 8, bob: 1 },
  floe: { style: 'waddle', freq: 1.6, bob: 0.4 },
  sledge: { style: 'waddle', freq: 3, bob: 0.8 },
  titan: { style: 'waddle', freq: 2.6, bob: 1 },
  tick: { style: 'skitter', freq: 16, bob: 1.6 },
  herdkeeper: { style: 'waddle', freq: 3.2, bob: 0.8 },
  groundling: { style: 'hop', freq: 6, bob: 1 },
  conductor: { style: 'waddle', freq: 2.4, bob: 0.6 },
  squallcaller: { style: 'float', freq: 2.4, bob: 1.6 },
};

/** How see-through a phased-out body, and a risen shade, is drawn. */
const PHASED_ALPHA = 0.22;
const SHADE_ALPHA = 0.55;

/** Seconds of a slide's speed its streak shows (world units per unit/s), up to four radii. */
const SLIDE_STREAK = 0.12;

/** Each aura's colour on an elite's halo (§4.3); a plain elite wears gold. */
const AURA_COLOR: Record<AuraId, FxColorName> = {
  haste: 'ember',
  regen: 'nature',
  shield: 'frost',
  split: 'arcane',
  vengeful: 'blood',
  // The regions' own (N3); each shares a colour only with an aura its region lacks.
  fog: 'mana',
  mirrored: 'frost',
  molten: 'critical',
  wraith: 'mana',
  hungering: 'nature',
  // The Wake's own (plans/late-game/12 §6).
  resonant: 'gold',
  tidal: 'mana',
  anchored: 'frost',
  towering: 'critical',
  charged: 'arcane',
};

interface Sprite {
  canvas: HTMLCanvasElement;
  /** Half the sprite's size in world units; it is drawn centred. */
  half: number;
}

/**
 * The deep's mark on a floor's guests (plans/late-game/08 §2): their colours
 * lean `mix` toward the stratum's ground. Natives keep their own.
 */
export interface GuestLook {
  /** The stratum, for the sprite cache's key. */
  key: string;
  tint: string;
  mix: number;
  natives: ReadonlySet<EnemyId>;
}

/**
 * What the painter remembers of one body between frames (plans/enemy-animation.md
 * §3.3): render-side only, so the sim never holds it. Pooled, never dropped.
 */
interface Track {
  /** Last frame this id was drawn, for the sweep. */
  frame: number;
  /** Clock when first drawn. */
  seenAt: number;
  /** Clock a time-driven pop began (−∞: none). */
  popAt: number;
  /** The `e.hitTick` last read. */
  hitSeen: number;
  /** Clock the current hit squish began. */
  squishAt: number;
  /** Gait weight 0..1, eased toward `e.moving`. */
  weight: number;
  /** Last frame's `e.under` (Burrower) and `e.shade` (Echoes). */
  under: boolean;
  shade: boolean;
  /** Last drawn position, to spot a Blinker's jump. */
  lx: number;
  ly: number;
}

/** Frames between sweeps of the tracks no longer drawn. */
const SWEEP_FRAMES = 30;

/** How fast (1/s) a body eases into and out of its gait (§4.2): settled in about 150 ms. */
const WEIGHT_RATE = 8;

/** The heading toward the tower, reused per body. */
const HEADING = { nx: 0, ny: -1 };

export class EnemyPainter {
  private cache = new Map<string, Sprite>();
  private scale = 0;
  /** What runs (§2): reduced motion wins over the tier's profile. */
  private level: MotionLevel = 'full';
  private tier: QualityTier = 'high';
  /** Per-body render state by enemy id, and a free list so 300 bodies × thousands per run make no garbage. */
  private tracks = new Map<number, Track>();
  private pool: Track[] = [];
  private frame = 0;
  /**
   * True for the first frame after a reset (and the first ever): every body
   * then is one already on the field, from a resumed save or a re-attached
   * run, so none of them pops (§3.3).
   */
  private seeding = true;
  /** Whether the last `track()` call made the track: the body's first frame drawn. */
  private born = false;
  /** The wall clock at the last frame drawn, for the gait's easing. */
  private lastTime = 0;
  /** One body's motion this frame, reused per body: nothing allocated per frame. */
  private readonly m: BodyMotion = { dx: 0, dy: 0, sx: 1, sy: 1 };

  /** The motion level and the tier, set when either the setting or the tier changes, never per body. */
  setMotion(level: MotionLevel, tier: QualityTier): void {
    this.level = level;
    this.tier = tier;
  }

  get motion(): { level: MotionLevel; tier: QualityTier } {
    return { level: this.level, tier: this.tier };
  }

  /** Forget every body: the run changed, and ids restart per run. */
  reset(): void {
    for (const t of this.tracks.values()) this.pool.push(t);
    this.tracks.clear();
    this.seeding = true;
  }

  /** Bodies tracked now (tests, and the bench's eye on the pool). */
  get tracked(): number {
    return this.tracks.size;
  }

  /** The track for `e`, made (from the pool) on its first frame drawn, and stamped as seen now. */
  private track(e: Enemy, clock: number, x: number, y: number): Track {
    let t = this.tracks.get(e.id);
    this.born = !t;
    if (!t) {
      t = this.pool.pop() ?? {
        frame: 0, seenAt: 0, popAt: -Infinity, hitSeen: -1, squishAt: -Infinity, weight: 0,
        under: false, shade: false, lx: 0, ly: 0,
      };
      t.seenAt = clock;
      // A body already on the field when a run is attached or resumed never pops.
      t.popAt = -Infinity;
      t.hitSeen = e.hitTick;
      t.squishAt = -Infinity;
      t.weight = e.moving ? 1 : 0;
      t.under = e.under;
      t.shade = e.shade;
      t.lx = x;
      t.ly = y;
      this.tracks.set(e.id, t);
    }
    t.frame = this.frame;
    return t;
  }

  /** Every `SWEEP_FRAMES`, hand the tracks of bodies no longer drawn back to the pool. */
  private sweep(): void {
    if (this.frame % SWEEP_FRAMES !== 0) return;
    const stale = this.frame - SWEEP_FRAMES;
    for (const [id, t] of this.tracks) {
      if (t.frame > stale) continue;
      this.tracks.delete(id);
      this.pool.push(t);
    }
  }

  /** Drop the cache when the view scale changes; sprites rebake lazily. */
  setScale(scale: number): void {
    if (scale === this.scale) return;
    this.scale = scale;
    this.cache.clear();
  }

  /** Drop every baked sprite: the palette changed under them (`setPaletteMode`). */
  clear(): void {
    this.cache.clear();
  }

  /** A type's sprite, keyed by type and, for a stratum's guest, by stratum. */
  private sprite(type: EnemyId, guest: GuestLook | null): Sprite {
    const mixed = guest !== null && !guest.natives.has(type);
    const key = mixed ? `${type}|${guest.key}` : type;
    let s = this.cache.get(key);
    if (!s) {
      const def = ENEMY_BY_ID[type];
      s = bake(mixed ? { ...def, color: mix(def.color, guest.tint, guest.mix), borderColor: mix(def.borderColor, guest.tint, guest.mix) } : def, this.scale);
      this.cache.set(key, s);
    }
    return s;
  }

  /**
   * Draw every living enemy, interpolated `alpha` of the way from its last
   * position. `tick` is the sim tick, for the hit flash; `simTime` the run's
   * clock, for slows; `time` the wall clock, for the gait; `light` the
   * sim's light and its shape, which a body fades in from as it walks in.
   */
  draw(
    ctx: CanvasRenderingContext2D, enemies: readonly Enemy[], alpha: number, tick: number, simTime: number, time: number,
    light: number,
    oval: Oval,
    /** The region's boss colours, which a Champion wears (N4). */
    champion: { color: string; border: string } | null = null,
    /** A stratum's guests, leaning toward its ground (plans/late-game/08). */
    guest: GuestLook | null = null,
    /** The Orrery's field turns (plans/late-game/12 §9.1): on the high tier, bodies leave a short trail. */
    orbiting = false,
  ): void {
    drawChorusLinks(ctx, enemies, alpha, time);
    const trails = orbiting && this.tier === 'high';
    this.frame++;
    this.sweep();
    const level = this.level;
    // The gait's easing runs on the wall clock; a long gap (a pause, a hidden tab) just settles it.
    const dt = Math.min(0.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    const ease = 1 - Math.exp(-WEIGHT_RATE * dt);
    let alive = 0;
    for (const e of enemies) if (e.alive && !e.boss && !e.court && !e.plate) alive++;
    const crowd = crowdDamping(alive);
    const m = this.m;
    const seeding = this.seeding;
    this.seeding = false;
    // Entrances inside the light pop on `full` only (§5.2.2); walking in from the dark pops everywhere but reduced motion.
    const popArmed = level === 'full';
    // Riders (Ticks, plans/late-game/12 §9.1) on a second pass, so each sits on top of its host.
    for (let pass = 0; pass < 2; pass++) for (const e of enemies) {
      // Bosses, the Hollow King's court and Forgeheart's plates have their own painter (`bosses.ts`).
      if (!e.alive || e.boss || e.court || e.plate) continue;
      if ((e.riding > 0) !== (pass === 1)) continue;
      const bx = e.px + (e.x - e.px) * alpha;
      const by = e.py + (e.y - e.py) * alpha;
      const g = GAIT[e.type];
      // Tracked underground too, so the frame it surfaces is seen (§5.2.2).
      const t = this.track(e, time, bx, by);
      const born = this.born && !seeding;
      if (e.under) {
        armPop(t, born, true, e.shade, bx, by, e.radius, false, 0, time, popArmed);
        drawMound(ctx, bx, by, e.radius, time + e.id);
        continue;
      }
      // `full` eases into and out of the gait (§4.2); `lite` and reduced motion snap, as before.
      const target = e.moving ? 1 : 0;
      t.weight = level === 'full' ? t.weight + (target - t.weight) * ease : target;
      // Reduced motion keeps today's bob to the digit (D-1); otherwise a Chorus hops as one (D-3).
      const seed = level === 'reduced' ? e.id : e.group || e.id;
      const d = Math.hypot(bx, by) || 1;
      HEADING.nx = -bx / d;
      HEADING.ny = -by / d;
      gait(m, g.style, g.bob, time * g.freq + seed, t.weight, HEADING, level, crowd);
      // A hit squishes on top of the gait (§5.1), on the wall clock (D-2); reduced motion keeps the flash only.
      if (level !== 'reduced') {
        armSquish(t, e.hitTick, time);
        const q = hitSquish(time - t.squishAt, level, crowd);
        // The gait's own squash is `1 − sy`; the sum goes back through the same clamp.
        if (q !== 0) applySquash(m, 1 - m.sy + q);
      } else {
        // Keep up, so leaving reduced motion doesn't replay a stale hit.
        t.hitSeen = e.hitTick;
      }
      // Overlays (halos, rings, the HP bar) follow the offset, not the squash (§4.3).
      const x = bx + m.dx;
      const y = by + m.dy;
      const rise = emergence(x, y, light, oval);
      const verb = ENEMY_BY_ID[e.type].verb;
      armPop(t, born, false, e.shade, bx, by, e.radius, verb.kind === 'blink', rise, time, popArmed);
      if (rise <= 0) continue;
      // Walking in from the dark, from `rise` (stateless), times any pop inside the light, from the clock.
      const pop = level === 'reduced' ? 1 : popFromRise(rise) * (popArmed ? popFromTime(time - t.popAt) : 1);
      const fade = (e.hiddenUntil > simTime ? PHASED_ALPHA : e.shade ? SHADE_ALPHA : 1) * rise;
      ctx.globalAlpha = fade;
      // A Champion (N4) wears its region's boss colours: a second, wider halo outside its aura's.
      if (e.champion && champion) {
        drawHalo(ctx, x, y, e.radius * 1.3, champion.border, -(time + e.id));
        drawHalo(ctx, x, y, e.radius, champion.color, time + e.id);
      }
      if (e.elite) drawHalo(ctx, x, y, e.radius, FX[e.aura ? AURA_COLOR[e.aura] : 'gold'], time + e.id);
      // An Orbit trail: a short line back along its motion, so the spiral reads.
      if (trails && e.moving) {
        const mx = e.x - e.px;
        const my = e.y - e.py;
        const ml = Math.hypot(mx, my);
        if (ml > 1e-3) {
          ctx.strokeStyle = withAlpha(ENEMY_BY_ID[e.type].borderColor, 0.3);
          ctx.lineWidth = e.radius * 0.35;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - (mx / ml) * e.radius * 2.2, y - (my / ml) * e.radius * 2.2);
          ctx.stroke();
        }
      }
      // A slide on the ice (plans/late-game/12 §9.1): a frost streak behind it, as long as it is fast.
      if (e.slideX !== 0 || e.slideY !== 0) {
        const v = Math.hypot(e.slideX, e.slideY);
        const len = Math.min(e.radius * 4, v * SLIDE_STREAK);
        ctx.strokeStyle = withAlpha(FX.frost, 0.45);
        ctx.lineWidth = e.radius * 0.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - (e.slideX / v) * len, y - (e.slideY / v) * len);
        ctx.stroke();
      }
      const s = this.sprite(e.type, guest);
      // Sprites are baked at the type's radius; elites and fragments scale it.
      const k = e.radius / ENEMY_BY_ID[e.type].radius;
      const half = s.half * k;
      // Squash and pop keep the body's foot planted: the bottom of its silhouette (`e.radius` below) stays put.
      const sx = m.sx * pop;
      const sy = m.sy * pop;
      const cy = y + e.radius * (1 - sy);
      ctx.drawImage(s.canvas, x - half * sx, cy - half * sy, 2 * half * sx, 2 * half * sy);
      if (verb.kind === 'shield') drawShield(ctx, x, y, e.radius);
      // A Husk's shell (§9): plates round it while it still swallows hits, a notch per hit.
      if (e.shell > 0) drawShell(ctx, x, y, e.radius, e.shell);
      // A Wardstone's ward: a faint ring as wide as it reaches.
      if ((verb.kind === 'ward' || verb.kind === 'herd') && e.hiddenUntil <= simTime) {
        ctx.strokeStyle = withAlpha(FX.frost, 0.22);
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 8]);
        ctx.beginPath();
        ctx.arc(x, y, verb.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // A Conductor's rod (plans/late-game/12 §9.1): a rod above it and a pulsing gold ring, so it
      // reads from across the arena on a phone.
      if (verb.kind === 'conduct' && e.hiddenUntil <= simTime) {
        const beat = 0.5 + 0.5 * Math.sin(time * 4 + e.id);
        ctx.strokeStyle = withAlpha(FX.gold, 0.85);
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, y - e.radius);
        ctx.lineTo(x, y - e.radius * 2.1);
        ctx.stroke();
        ctx.strokeStyle = withAlpha(FX.gold, 0.35 + 0.45 * beat);
        ctx.lineWidth = 2 + 2 * beat;
        ctx.beginPath();
        ctx.arc(x, y, e.radius * 1.6, 0, Math.PI * 2);
        ctx.stroke();
      }
      // A Ram mid-charge: a streak behind it.
      if (e.dashUntil > simTime) {
        const d = Math.hypot(x, y) || 1;
        ctx.strokeStyle = withAlpha(FX.blood, 0.55);
        ctx.lineWidth = e.radius * 0.8;
        ctx.beginPath();
        ctx.moveTo(x + (x / d) * e.radius * 2.5, y + (y / d) * e.radius * 2.5);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      if (e.slowUntil > simTime && e.slow > 0) {
        ctx.strokeStyle = withAlpha(FX.frost, 0.7);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, e.radius + 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (e.fury > 1) {
        ctx.strokeStyle = withAlpha(FX.blood, 0.8);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, e.radius + 4, 0, Math.PI * 2);
        ctx.stroke();
      }

      const sinceHit = tick - e.hitTick;
      if (e.hitTick >= 0 && sinceHit < 5) {
        ctx.globalAlpha = 0.65 * (1 - sinceHit / 5) * rise;
        ctx.fillStyle = INK['050'];
        // The flash follows the squash too, so it covers the body as drawn (§4.3).
        ctx.beginPath();
        ctx.ellipse(x, cy, e.radius * sx, e.radius * sy, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = rise;
      }
      if (e.hp < e.maxHp) drawHpBar(ctx, x, y - e.radius - 8, e.radius, e.hp / e.maxHp);
      ctx.globalAlpha = 1;
    }
  }
}

/** A Husk's shell: one plate per hit it can still swallow, round its rim. */
function drawShell(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, plates: number): void {
  ctx.strokeStyle = withAlpha(INK['100'], 0.75);
  ctx.lineWidth = 3;
  const n = Math.min(8, plates);
  for (let i = 0; i < n; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(x, y, r + 3, a + 0.08, a + (Math.PI * 2) / 8 - 0.08);
    ctx.stroke();
  }
}

/** A Shieldbearer's shield: a bright arc on the side that faces the tower. */
function drawShield(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const face = Math.atan2(-y, -x);
  ctx.strokeStyle = withAlpha(INK['050'], 0.9);
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y, r + 5, face - 0.95, face + 0.95);
  ctx.stroke();
  ctx.strokeStyle = withAlpha(FX.frost, 0.7);
  ctx.lineWidth = 2;
  ctx.stroke();
}

/** A Burrower under the ground: a moving mound and the grit it throws up. */
function drawMound(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, t: number): void {
  ctx.fillStyle = withAlpha(INK['700'], 0.75);
  ctx.beginPath();
  ctx.ellipse(x, y, r * 0.9, r * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = withAlpha(INK['300'], 0.6);
  for (let i = 0; i < 3; i++) {
    const a = t * 6 + i * 2.1;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * r * 0.6, y - Math.abs(Math.sin(a)) * r * 0.5, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A Chorus's bodies are one: a faint thread runs between each and its leader. */
function drawChorusLinks(ctx: CanvasRenderingContext2D, enemies: readonly Enemy[], alpha: number, t: number): void {
  const leaders = new Map<number, Enemy>();
  for (const e of enemies) if (e.alive && e.group === e.id) leaders.set(e.id, e);
  if (leaders.size === 0) return;
  ctx.strokeStyle = withAlpha(FX.arcane, 0.35 + 0.15 * Math.sin(t * 3));
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const e of enemies) {
    if (!e.alive || !e.group || e.group === e.id) continue;
    const l = leaders.get(e.group);
    if (!l) continue;
    ctx.moveTo(l.px + (l.x - l.px) * alpha, l.py + (l.y - l.py) * alpha);
    ctx.lineTo(e.px + (e.x - e.px) * alpha, e.py + (e.y - e.py) * alpha);
  }
  ctx.stroke();
}

/** An elite's halo: a slow-turning dashed ring in its aura's colour. */
function drawHalo(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, t: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(t * 0.8);
  ctx.fillStyle = withAlpha(color, 0.16);
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = withAlpha(color, 0.9);
  ctx.lineWidth = 3;
  ctx.setLineDash([r * 0.5, r * 0.3]);
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawHpBar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, frac: number): void {
  const w = Math.max(20, r * 1.8);
  const h = 4;
  ctx.fillStyle = withAlpha(INK['950'], 0.7);
  ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = FX.blood;
  ctx.fillRect(x - w / 2, y, w * Math.max(0, frac), h);
}

function bake(def: EnemyDef, scale: number): Sprite {
  const r = def.radius;
  const half = r * 1.35;
  const px = Math.max(8, Math.ceil(half * 2 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const g = canvas.getContext('2d', context2dOptions())!;
  // Paint in world units about the centre.
  const k = px / (half * 2);
  g.setTransform(k, 0, 0, k, px / 2, px / 2);
  paintBody(g, def, r, (w) => Math.max(w, MIN_STROKE_PX / k));
  return { canvas, half };
}

function traceShape(g: CanvasRenderingContext2D, def: EnemyDef, r: number): void {
  g.beginPath();
  switch (def.shape) {
    case 'circle':
    case 'plated':
      g.arc(0, 0, r, 0, Math.PI * 2);
      break;
    case 'diamond':
      g.moveTo(0, -r);
      g.lineTo(r, 0);
      g.lineTo(0, r);
      g.lineTo(-r, 0);
      g.closePath();
      break;
    case 'hexagon':
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath();
      break;
    case 'triangle':
      // Point first, toward the light: a shard, or an imp's hood.
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
        if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath();
      break;
    case 'square': {
      const h = r * 0.86;
      g.rect(-h, -h, h * 2, h * 2);
      break;
    }
    default: {
      const exhaustive: never = def.shape;
      return exhaustive;
    }
  }
}

function paintBody(g: CanvasRenderingContext2D, def: EnemyDef, r: number, pen: (w: number) => number): void {
  const lx = Math.cos(LIGHT_ANGLE);
  const ly = Math.sin(LIGHT_ANGLE);
  const span = r * 2.4;

  g.save();
  traceShape(g, def, r);
  g.clip();

  g.fillStyle = def.color;
  g.fillRect(-span, -span, span * 2, span * 2);

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

  paintDetail(g, def, r, pen);

  // Rim light: a fat stroke of the silhouette, clipped, so only the inner half survives.
  const rim = g.createLinearGradient(lx * r, ly * r, -lx * r * 0.5, -ly * r * 0.5);
  rim.addColorStop(0, withAlpha(INK['050'], 0.8));
  rim.addColorStop(0.55, withAlpha(INK['050'], 0.12));
  rim.addColorStop(1, withAlpha(INK['050'], 0));
  g.strokeStyle = rim;
  g.lineWidth = pen(r * 0.35);
  traceShape(g, def, r);
  g.stroke();
  g.restore();

  // Outline last, unclipped, so the silhouette holds against a lit floor.
  traceShape(g, def, r);
  g.strokeStyle = def.borderColor;
  g.lineWidth = pen(def.shape === 'plated' ? 3 : 2);
  g.lineJoin = 'round';
  g.stroke();
}

/** What this thing *is*, painted inside the clipped silhouette. */
function paintDetail(g: CanvasRenderingContext2D, def: EnemyDef, r: number, pen: (w: number) => number): void {
  const dark = (a: number): string => withAlpha(INK['950'], a);
  const pale = (a: number): string => withAlpha(INK['050'], a);
  switch (def.id) {
    // Grunt: a visor slit and two eye glints. The plainest, on purpose.
    case 'grunt': {
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
    // Runner: swept chevrons, so a pack reads as moving even at the wall.
    case 'runner': {
      g.strokeStyle = dark(0.45);
      g.lineWidth = pen(r * 0.16);
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
    // Brute: overlapping armour plates toward the light, rivets on each seam.
    case 'brute': {
      const light = LIGHT_ANGLE;
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
        g.lineWidth = pen(r * 0.07);
        g.stroke();
        g.fillStyle = pale(0.34);
        for (const at of [-0.55, 0, 0.55]) {
          const a = light + at * Math.PI * w;
          const rad = (r * (outer + inner)) / 2;
          g.beginPath();
          g.arc(Math.cos(a) * rad, Math.sin(a) * rad, r * 0.06, 0, Math.PI * 2);
          g.fill();
        }
      }
      break;
    }
    // Splitter: a cracked shell with the core showing through: about to come apart.
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
      g.lineWidth = pen(r * 0.08);
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
    // Spitter: a swollen throat sac and a dark maw: it fights from range.
    case 'spitter': {
      g.fillStyle = withAlpha(mix(def.color, FX.nature, 0.4), 0.7);
      g.beginPath();
      g.ellipse(0, r * 0.2, r * 0.55, r * 0.42, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = dark(0.85);
      g.beginPath();
      g.ellipse(0, -r * 0.28, r * 0.32, r * 0.16, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = withAlpha(def.borderColor, 0.9);
      for (const dir of [-1, 1]) {
        g.beginPath();
        g.arc(dir * r * 0.42, -r * 0.5, r * 0.09, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    // Mender: a cross sigil over a soft nature glow.
    case 'mender': {
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
    // Shieldbearer: a tower-shield's boss and bands; the shield itself is drawn live.
    case 'shieldbearer': {
      g.strokeStyle = dark(0.55);
      g.lineWidth = pen(r * 0.1);
      g.strokeRect(-r * 0.55, -r * 0.55, r * 1.1, r * 1.1);
      g.fillStyle = pale(0.6);
      g.beginPath();
      g.arc(0, 0, r * 0.2, 0, Math.PI * 2);
      g.fill();
      break;
    }
    // Burrower: digging claws and a blunt snout.
    case 'burrower': {
      g.fillStyle = dark(0.55);
      g.beginPath();
      g.ellipse(0, -r * 0.25, r * 0.35, r * 0.25, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = pale(0.7);
      g.lineWidth = pen(r * 0.08);
      g.lineCap = 'round';
      for (const dir of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          g.beginPath();
          g.moveTo(dir * r * (0.35 + i * 0.12), r * 0.2);
          g.lineTo(dir * r * (0.45 + i * 0.14), r * 0.6);
          g.stroke();
        }
      }
      break;
    }
    // Shardling: facets catching the light.
    case 'shardling': {
      g.strokeStyle = pale(0.7);
      g.lineWidth = pen(r * 0.07);
      g.beginPath();
      g.moveTo(0, -r);
      g.lineTo(0, r * 0.5);
      g.moveTo(-r * 0.85, r * 0.5);
      g.lineTo(0, 0);
      g.lineTo(r * 0.85, r * 0.5);
      g.stroke();
      break;
    }
    // Bomber: a lit fuse and a hot core: it is going to go off.
    case 'bomber': {
      const core = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.7);
      core.addColorStop(0, withAlpha(FX.gold, 0.9));
      core.addColorStop(1, withAlpha(FX.ember, 0));
      g.fillStyle = core;
      g.beginPath();
      g.arc(0, 0, r * 0.7, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = dark(0.8);
      g.lineWidth = pen(r * 0.12);
      g.beginPath();
      g.moveTo(0, -r * 0.6);
      g.quadraticCurveTo(r * 0.3, -r, r * 0.1, -r * 1.2);
      g.stroke();
      break;
    }
    // Blinker: a spiral that never sits still.
    case 'blinker': {
      g.strokeStyle = pale(0.75);
      g.lineWidth = pen(r * 0.09);
      g.beginPath();
      for (let i = 0; i <= 24; i++) {
        const a = i * 0.45;
        const rr = (i / 24) * r * 0.7;
        if (i === 0) g.moveTo(0, 0);
        else g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      g.stroke();
      break;
    }
    // Siege Engine: a throwing arm over plated wheels.
    case 'siege-engine': {
      g.strokeStyle = dark(0.7);
      g.lineWidth = pen(r * 0.12);
      g.beginPath();
      g.moveTo(-r * 0.6, r * 0.4);
      g.lineTo(r * 0.5, -r * 0.6);
      g.stroke();
      g.fillStyle = withAlpha(FX.ember, 0.85);
      g.beginPath();
      g.arc(r * 0.5, -r * 0.6, r * 0.18, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = dark(0.6);
      for (const dir of [-1, 1]) {
        g.beginPath();
        g.arc(dir * r * 0.5, r * 0.55, r * 0.22, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    // Phantom: two hollow eyes and a trailing hem.
    case 'phantom': {
      g.fillStyle = dark(0.85);
      for (const dir of [-1, 1]) {
        g.beginPath();
        g.ellipse(dir * r * 0.3, -r * 0.2, r * 0.14, r * 0.22, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = pale(0.5);
      g.lineWidth = pen(r * 0.08);
      g.beginPath();
      for (let i = 0; i <= 6; i++) {
        const x = -r + (i / 6) * r * 2;
        const y = r * 0.55 + (i % 2 ? r * 0.15 : 0);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      break;
    }
    // Leech: a ring of teeth round a dark mouth.
    case 'leech': {
      g.fillStyle = dark(0.9);
      g.beginPath();
      g.arc(0, 0, r * 0.45, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = withAlpha(def.borderColor, 0.9);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.beginPath();
        g.moveTo(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45);
        g.lineTo(Math.cos(a + 0.2) * r * 0.25, Math.sin(a + 0.2) * r * 0.25);
        g.lineTo(Math.cos(a - 0.2) * r * 0.25, Math.sin(a - 0.2) * r * 0.25);
        g.fill();
      }
      break;
    }
    // Summoner: a five-point sigil, glowing.
    case 'summoner': {
      g.strokeStyle = withAlpha(def.borderColor, 0.9);
      g.lineWidth = pen(r * 0.08);
      g.beginPath();
      for (let i = 0; i <= 5; i++) {
        const a = ((i * 2) / 5) * Math.PI * 2 - Math.PI / 2;
        if (i === 0) g.moveTo(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6);
        else g.lineTo(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6);
      }
      g.stroke();
      break;
    }
    // Imp: two horns and a grin.
    case 'imp': {
      g.fillStyle = pale(0.85);
      g.beginPath();
      g.arc(-r * 0.25, 0, r * 0.12, 0, Math.PI * 2);
      g.arc(r * 0.25, 0, r * 0.12, 0, Math.PI * 2);
      g.fill();
      break;
    }
    // Harbinger: one great eye.
    case 'harbinger': {
      g.fillStyle = pale(0.85);
      g.beginPath();
      g.ellipse(0, 0, r * 0.6, r * 0.32, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = withAlpha(def.borderColor, 1);
      g.beginPath();
      g.arc(0, 0, r * 0.24, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = dark(0.95);
      g.beginPath();
      g.ellipse(0, 0, r * 0.07, r * 0.2, 0, 0, Math.PI * 2);
      g.fill();
      break;
    }
    // Chorus: an open singing mouth over a soft glow.
    case 'chorus': {
      const glow = g.createRadialGradient(0, 0, 0, 0, 0, r);
      glow.addColorStop(0, pale(0.5));
      glow.addColorStop(1, pale(0));
      g.fillStyle = glow;
      g.fillRect(-r, -r, r * 2, r * 2);
      g.fillStyle = dark(0.85);
      g.beginPath();
      g.ellipse(0, r * 0.15, r * 0.22, r * 0.32, 0, 0, Math.PI * 2);
      g.fill();
      break;
    }
    // Husk: cracked plates over a dark seam.
    case 'husk': {
      g.strokeStyle = dark(0.7);
      g.lineWidth = pen(r * 0.08);
      g.beginPath();
      g.moveTo(-r * 0.5, -r * 0.3);
      g.lineTo(-r * 0.1, r * 0.05);
      g.lineTo(r * 0.2, -r * 0.2);
      g.lineTo(r * 0.5, r * 0.25);
      g.stroke();
      break;
    }
    // Ram: a lowered horn-plate, pointing at the wall.
    case 'ram': {
      g.fillStyle = pale(0.8);
      g.beginPath();
      g.moveTo(-r * 0.55, -r * 0.3);
      g.quadraticCurveTo(0, -r * 0.75, r * 0.55, -r * 0.3);
      g.lineTo(r * 0.3, -r * 0.15);
      g.quadraticCurveTo(0, -r * 0.45, -r * 0.3, -r * 0.15);
      g.closePath();
      g.fill();
      break;
    }
    // Wardstone: a carved glyph, cold blue.
    case 'wardstone': {
      g.strokeStyle = withAlpha(def.borderColor, 0.9);
      g.lineWidth = pen(r * 0.09);
      g.beginPath();
      g.arc(0, 0, r * 0.35, 0, Math.PI * 2);
      g.moveTo(0, -r * 0.6);
      g.lineTo(0, r * 0.6);
      g.moveTo(-r * 0.5, 0);
      g.lineTo(r * 0.5, 0);
      g.stroke();
      break;
    }
    // Lurker: two slit eyes, slanted, and a seam down its back.
    case 'lurker': {
      g.fillStyle = withAlpha(def.borderColor, 0.95);
      for (const dir of [-1, 1]) {
        g.beginPath();
        g.ellipse(dir * r * 0.24, -r * 0.08, r * 0.17, r * 0.05, dir * 0.4, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = dark(0.6);
      g.lineWidth = pen(r * 0.06);
      g.beginPath();
      g.moveTo(0, r * 0.12);
      g.lineTo(0, r * 0.6);
      g.stroke();
      break;
    }
    // Tidecaller: rings rolling out from a bright core, the current it calls.
    case 'tidecaller': {
      g.strokeStyle = withAlpha(def.borderColor, 0.8);
      g.lineWidth = pen(r * 0.07);
      for (const k of [0.3, 0.52]) {
        g.beginPath();
        g.arc(0, 0, r * k, -Math.PI * 0.8, Math.PI * 0.3);
        g.stroke();
      }
      g.fillStyle = pale(0.9);
      g.beginPath();
      g.arc(0, 0, r * 0.13, 0, Math.PI * 2);
      g.fill();
      break;
    }
    // Maw: a wide mouth, all teeth.
    case 'maw': {
      g.fillStyle = dark(0.9);
      g.beginPath();
      g.ellipse(0, r * 0.05, r * 0.6, r * 0.4, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = withAlpha(def.borderColor, 0.95);
      for (let i = 0; i < 6; i++) {
        const x = -r * 0.45 + (i / 5) * r * 0.9;
        g.beginPath();
        g.moveTo(x - r * 0.07, -r * 0.3);
        g.lineTo(x + r * 0.07, -r * 0.3);
        g.lineTo(x, -r * 0.08);
        g.fill();
        g.beginPath();
        g.moveTo(x - r * 0.07, r * 0.4);
        g.lineTo(x + r * 0.07, r * 0.4);
        g.lineTo(x, r * 0.18);
        g.fill();
      }
      break;
    }
    // The Wake's natives (plans/late-game/12 §9.1).
    // Ringer: a small bell on its chest, its clapper hanging, and the rings it passes on.
    case 'ringer': {
      g.fillStyle = dark(0.45);
      g.beginPath();
      g.moveTo(-r * 0.36, r * 0.24);
      g.quadraticCurveTo(-r * 0.3, -r * 0.42, 0, -r * 0.44);
      g.quadraticCurveTo(r * 0.3, -r * 0.42, r * 0.36, r * 0.24);
      g.closePath();
      g.fill();
      g.fillStyle = withAlpha(def.borderColor, 0.85);
      g.beginPath();
      g.arc(0, r * 0.3, r * 0.1, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = withAlpha(def.borderColor, 0.4);
      g.lineWidth = pen(r * 0.07);
      for (const dir of [-1, 1]) {
        g.beginPath();
        g.arc(0, -r * 0.08, r * 0.62, Math.PI / 2 - dir * Math.PI * 0.42 - 0.3, Math.PI / 2 - dir * Math.PI * 0.42 + 0.3);
        g.stroke();
      }
      break;
    }
    // Sleepwalker: closed eyes, two lidded arcs, and a drowsy slack mouth.
    case 'sleepwalker': {
      g.strokeStyle = withAlpha(def.borderColor, 0.8);
      g.lineWidth = pen(r * 0.09);
      g.lineCap = 'round';
      for (const dir of [-1, 1]) {
        g.beginPath();
        g.arc(dir * r * 0.3, -r * 0.18, r * 0.16, 0.15, Math.PI - 0.15);
        g.stroke();
      }
      g.fillStyle = dark(0.45);
      g.beginPath();
      g.ellipse(0, r * 0.28, r * 0.14, r * 0.09, 0, 0, Math.PI * 2);
      g.fill();
      break;
    }
    // Straggler: a limping gait, one long stride mark trailing the other.
    case 'straggler': {
      g.strokeStyle = dark(0.45);
      g.lineWidth = pen(r * 0.14);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-r * 0.46, -r * 0.2);
      g.lineTo(r * 0.12, -r * 0.2);
      g.moveTo(-r * 0.2, r * 0.22);
      g.lineTo(r * 0.46, r * 0.22);
      g.stroke();
      g.fillStyle = pale(0.7);
      g.beginPath();
      g.arc(r * 0.3, -r * 0.2, r * 0.09, 0, Math.PI * 2);
      g.fill();
      break;
    }
    // Giants' Rest's (plans/late-game/12 §9.1).
    // Titan: a heavy brow over two deep sockets, and a cracked slab of a jaw.
    case 'titan': {
      g.fillStyle = dark(0.5);
      g.fillRect(-r * 0.6, -r * 0.34, r * 1.2, r * 0.16);
      for (const dir of [-1, 1]) {
        g.beginPath();
        g.ellipse(dir * r * 0.28, -r * 0.08, r * 0.14, r * 0.11, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = withAlpha(def.borderColor, 0.85);
      for (const dir of [-1, 1]) {
        g.beginPath();
        g.arc(dir * r * 0.28, -r * 0.08, r * 0.045, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = dark(0.45);
      g.lineWidth = pen(r * 0.08);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-r * 0.4, r * 0.3);
      g.lineTo(r * 0.4, r * 0.3);
      g.moveTo(-r * 0.1, r * 0.3);
      g.lineTo(-r * 0.02, r * 0.46);
      g.stroke();
      break;
    }
    // Tick: a hard little shell split down the back, and its biting head.
    case 'tick': {
      g.strokeStyle = dark(0.5);
      g.lineWidth = pen(r * 0.12);
      g.beginPath();
      g.moveTo(0, -r * 0.1);
      g.lineTo(0, r * 0.5);
      g.stroke();
      g.fillStyle = withAlpha(def.borderColor, 0.9);
      g.beginPath();
      g.arc(0, -r * 0.32, r * 0.16, 0, Math.PI * 2);
      g.fill();
      break;
    }
    // Herdkeeper: a shepherd's crook across it, and a calm eye.
    case 'herdkeeper': {
      g.strokeStyle = withAlpha(def.borderColor, 0.8);
      g.lineWidth = pen(r * 0.1);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-r * 0.3, r * 0.55);
      g.lineTo(r * 0.12, -r * 0.3);
      g.arc(r * 0.26, -r * 0.3, r * 0.14, Math.PI, Math.PI * 2.2);
      g.stroke();
      g.fillStyle = dark(0.55);
      g.beginPath();
      g.arc(-r * 0.18, -r * 0.12, r * 0.09, 0, Math.PI * 2);
      g.fill();
      break;
    }
    // Satellite: a small round body caught in a tilted ring, a little world of its own.
    case 'satellite': {
      g.strokeStyle = withAlpha(def.borderColor, 0.7);
      g.lineWidth = pen(r * 0.1);
      g.beginPath();
      g.ellipse(0, 0, r * 0.95, r * 0.3, -0.4, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = dark(0.45);
      g.beginPath();
      g.arc(0, 0, r * 0.38, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = withAlpha(def.borderColor, 0.85);
      g.beginPath();
      g.arc(-r * 0.1, -r * 0.1, r * 0.1, 0, Math.PI * 2);
      g.fill();
      break;
    }
    // Comet: a bright head and three streaks of tail behind it, so it reads as straight-line speed.
    case 'comet': {
      g.strokeStyle = withAlpha(def.borderColor, 0.75);
      g.lineWidth = pen(r * 0.12);
      g.lineCap = 'round';
      for (const dx of [-0.32, 0, 0.32]) {
        g.beginPath();
        g.moveTo(dx * r, r * 0.05);
        g.lineTo(dx * r * 1.3, r * (0.6 - Math.abs(dx) * 0.4));
        g.stroke();
      }
      g.fillStyle = pale(0.9);
      g.beginPath();
      g.arc(0, -r * 0.22, r * 0.2, 0, Math.PI * 2);
      g.fill();
      break;
    }
    // Moon: pale craters, and a dark crescent of shadow down one side.
    case 'moon': {
      g.fillStyle = dark(0.3);
      g.beginPath();
      g.arc(0, 0, r * 0.82, -Math.PI / 2, Math.PI / 2);
      g.arc(r * 0.3, 0, r * 0.88, Math.PI / 2, -Math.PI / 2, true);
      g.closePath();
      g.fill();
      g.fillStyle = dark(0.25);
      for (const [cx, cy, cr] of [[-0.3, -0.25, 0.16], [-0.12, 0.3, 0.12], [-0.45, 0.15, 0.08]] as const) {
        g.beginPath();
        g.arc(cx * r, cy * r, cr * r, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = withAlpha(def.borderColor, 0.5);
      g.lineWidth = pen(r * 0.05);
      g.beginPath();
      g.arc(-r * 0.3, -r * 0.25, r * 0.16, Math.PI * 0.9, Math.PI * 1.6);
      g.stroke();
      break;
    }
    // The Frozen Sea's (plans/late-game/12 §9.1).
    // Skater: two runner blades under it, and a scarf of cold streaming back.
    case 'skater': {
      g.strokeStyle = pale(0.8);
      g.lineWidth = pen(r * 0.08);
      g.lineCap = 'round';
      for (const dx of [-0.28, 0.28]) {
        g.beginPath();
        g.moveTo(dx * r - r * 0.18, r * 0.5);
        g.lineTo(dx * r + r * 0.2, r * 0.5);
        g.stroke();
      }
      g.fillStyle = dark(0.45);
      g.beginPath();
      g.ellipse(0, -r * 0.12, r * 0.34, r * 0.14, 0, 0, Math.PI * 2);
      g.fill();
      break;
    }
    // Floe: a slab of ice, cracked across, with a pale bevel on its top edge.
    case 'floe': {
      g.strokeStyle = pale(0.55);
      g.lineWidth = pen(r * 0.06);
      g.beginPath();
      g.moveTo(-r * 0.6, -r * 0.55);
      g.lineTo(r * 0.6, -r * 0.55);
      g.stroke();
      g.strokeStyle = withAlpha(def.borderColor, 0.7);
      g.lineWidth = pen(r * 0.05);
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(-r * 0.5, -r * 0.2);
      g.lineTo(-r * 0.1, r * 0.05);
      g.lineTo(r * 0.05, -r * 0.3);
      g.lineTo(r * 0.45, r * 0.25);
      g.moveTo(-r * 0.1, r * 0.05);
      g.lineTo(-r * 0.2, r * 0.45);
      g.stroke();
      break;
    }
    // Sledge: a broad push-plate across its front, braced by two struts.
    case 'sledge': {
      g.fillStyle = withAlpha(def.borderColor, 0.8);
      g.fillRect(-r * 0.62, -r * 0.62, r * 1.24, r * 0.18);
      g.strokeStyle = dark(0.5);
      g.lineWidth = pen(r * 0.1);
      g.lineCap = 'round';
      for (const dx of [-0.3, 0.3]) {
        g.beginPath();
        g.moveTo(dx * r, -r * 0.44);
        g.lineTo(dx * r * 0.6, r * 0.3);
        g.stroke();
      }
      break;
    }
    // Groundling: a squat block with roots spread beneath it, held to the ground.
    case 'groundling': {
      g.strokeStyle = withAlpha(def.borderColor, 0.75);
      g.lineWidth = pen(r * 0.09);
      g.lineCap = 'round';
      for (const dx of [-0.45, 0, 0.45]) {
        g.beginPath();
        g.moveTo(dx * r, r * 0.2);
        g.quadraticCurveTo(dx * r * 1.3, r * 0.55, dx * r * 1.5 + (dx === 0 ? r * 0.1 : 0), r * 0.85);
        g.stroke();
      }
      g.fillStyle = dark(0.45);
      g.fillRect(-r * 0.4, -r * 0.35, r * 0.8, r * 0.18);
      break;
    }
    // Conductor: a rod of old iron through its middle, its tip gilt (the halo is drawn each frame).
    case 'conductor': {
      g.strokeStyle = dark(0.6);
      g.lineWidth = pen(r * 0.16);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(0, r * 0.6);
      g.lineTo(0, -r * 0.55);
      g.stroke();
      g.fillStyle = withAlpha(def.borderColor, 0.95);
      g.beginPath();
      g.arc(0, -r * 0.6, r * 0.16, 0, Math.PI * 2);
      g.fill();
      break;
    }
    // Squallcaller: a forked bolt down its face.
    case 'squallcaller': {
      g.strokeStyle = withAlpha(def.borderColor, 0.9);
      g.lineWidth = pen(r * 0.1);
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(r * 0.1, -r * 0.55);
      g.lineTo(-r * 0.15, r * 0.02);
      g.lineTo(r * 0.12, r * 0.02);
      g.lineTo(-r * 0.08, r * 0.5);
      g.stroke();
      break;
    }
    default: {
      const exhaustive: never = def.id;
      return exhaustive;
    }
  }
}
